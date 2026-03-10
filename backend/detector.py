#!/usr/bin/env python3
"""
Gesture Detector — signal-processing-based motion classification.
=================================================================
Replaces the old DTW-based system with simple feature extraction
(zero crossings, direction changes, magnitude stats) and rule-based
classification.

Also provides a Detector class with the same state-machine interface
as the old GuidedDetector, for use by bridge_v2.py.

Usage:
    python detector.py --test    # offline test against CSVs in backend/data/
"""

import argparse
import glob
import math
import os
import sys
import time

import numpy as np
import pandas as pd
from scipy.signal import butter, filtfilt, find_peaks

# -- Constants ---------------------------------------------
SAMPLE_RATE = 25            # Hz
CALIBRATION_SECONDS = 2.0
COUNTDOWN_SECONDS = 3.0
RECORDING_SECONDS = 8.0
COOLDOWN_SECONDS = 3.0
MIN_MOTION_SAMPLES = 8
LOW_PASS_CUTOFF_HZ = 3.0
NOISE_FLOOR_MIN = 15.0
NOISE_FLOOR_MAX = 50.0
BASELINE_SAMPLES = 50       # first 2s at 25 Hz

NO_MOTION_THRESHOLD = 5.0
CIRCULAR_START_NOISE_MULTIPLIER = 2.0
CIRCULAR_REST_FRACTION = 0.15
UP_DOWN_MAX_DURATION = 2.5   # was 4.0, actual durations are 1.2-1.7s
CIRCULAR_MAG_CONFIDENCE_SCALE = 100.0
TEABAG_MIN_ACTIVE_DURATION = 3.0   # teabag must be active for at least 3s
TEABAG_RHYTHM_LOW_HZ = 1.5
TEABAG_RHYTHM_HIGH_HZ = 3.5
TEABAG_RHYTHM_RATIO = 0.30
ACTIVE_MAGNITUDE_MULTIPLIER = 2.0
UP_DOWN_MIN_PEAK = 200.0
UP_DOWN_MAX_PEAKS = 3
CV_THRESHOLD = 0.5
UP_DOWN_AXIS_RATIO = 0.7


# -- Low-pass filter ---------------------------------------
def low_pass_filter(data: np.ndarray, cutoff_hz: float = LOW_PASS_CUTOFF_HZ,
                    sample_rate: float = SAMPLE_RATE) -> np.ndarray:
    """Apply a 2nd-order Butterworth low-pass filter (zero-phase)."""
    nyq = sample_rate / 2.0
    norm_cutoff = cutoff_hz / nyq
    b, a = butter(2, norm_cutoff, btype="low")
    return filtfilt(b, a, data)


# -- Feature extraction ------------------------------------
def extract_features(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> dict:
    """
    Extract simple signal features from calibrated, filtered x/y/z arrays.
    Returns a dict of feature values.
    """
    mag = np.sqrt(x ** 2 + y ** 2 + z ** 2)

    # Zero crossings per axis and magnitude
    def zero_crossings(signal: np.ndarray) -> int:
        centered = signal - signal.mean()
        return int(np.sum(np.diff(np.sign(centered)) != 0))

    zc_x = zero_crossings(x)
    zc_y = zero_crossings(y)
    zc_z = zero_crossings(z)
    zc_mag = zero_crossings(mag)

    # Direction changes (gradient reversals)
    def direction_changes(signal: np.ndarray) -> int:
        grad = np.gradient(signal)
        return int(np.sum(np.diff(np.sign(grad)) != 0))

    dc_x = direction_changes(x)
    dc_y = direction_changes(y)
    dc_z = direction_changes(z)

    # Magnitude stats
    mag_mean = float(mag.mean())
    mag_std = float(mag.std())

    # Dominant axis (active samples only)
    active_mask = mag > mag.mean()
    if np.sum(active_mask) > 5:
        x_active = x[active_mask]
        y_active = y[active_mask]
        z_active = z[active_mask]
    else:
        x_active, y_active, z_active = x, y, z

    axis_stds = {
        'x': float(np.std(x_active)),
        'y': float(np.std(y_active)),
        'z': float(np.std(z_active))
    }
    dominant_axis = max(axis_stds, key=axis_stds.get)

    return {
        "zc_x": zc_x,
        "zc_y": zc_y,
        "zc_z": zc_z,
        "zc_mag": zc_mag,
        "dc_x": dc_x,
        "dc_y": dc_y,
        "dc_z": dc_z,
        "mag_mean": round(mag_mean, 2),
        "mag_std": round(mag_std, 2),
        "mag_max": round(float(np.max(mag)), 2),
        "x_std": round(axis_stds['x'], 2),
        "y_std": round(axis_stds['y'], 2),
        "z_std": round(axis_stds['z'], 2),
        "dominant_axis": dominant_axis,
    }


# -- Classification helpers --------------------------------
def starts_from_rest(magnitude: np.ndarray, noise_floor: float) -> bool:
    prefix = magnitude[:int(len(magnitude) * CIRCULAR_REST_FRACTION)]
    if len(prefix) == 0:
        return False
    return float(np.mean(prefix)) < noise_floor * CIRCULAR_START_NOISE_MULTIPLIER


def active_duration(magnitude: np.ndarray, noise_floor: float,
                    sample_rate: int = 25) -> float:
    return float(np.sum(magnitude > noise_floor * ACTIVE_MAGNITUDE_MULTIPLIER)) / sample_rate


def has_rhythmic_content(magnitude: np.ndarray, sample_rate: int = 25) -> bool:
    fft_vals = np.abs(np.fft.rfft(magnitude - magnitude.mean()))
    freqs = np.fft.rfftfreq(len(magnitude), d=1.0 / sample_rate)
    low_mask = (freqs >= 0) & (freqs < 1.0)
    rhythm_mask = (freqs >= TEABAG_RHYTHM_LOW_HZ) & (freqs <= TEABAG_RHYTHM_HIGH_HZ)
    if not np.any(low_mask) or not np.any(rhythm_mask):
        return False
    low_energy = float(np.max(fft_vals[low_mask]))
    rhythm_energy = float(np.max(fft_vals[rhythm_mask]))
    if low_energy == 0:
        return False
    return rhythm_energy > low_energy * TEABAG_RHYTHM_RATIO


# -- Rule-based classifier --------------------------------
def classify(features: dict, magnitude: np.ndarray | None = None,
             noise_floor: float = 15.0) -> tuple[str | None, float]:
    if magnitude is not None and len(magnitude) > 0:
        # Reject if signal never significantly exceeds noise
        if float(np.max(magnitude)) < noise_floor * 5.0:
            return (None, 0.0)
    if features["mag_mean"] < NO_MOTION_THRESHOLD:
        return (None, 0.0)
    if magnitude is None or len(magnitude) == 0:
        return (None, 0.0)
    # Check teabag first — rhythm is the strongest signal
    if has_rhythmic_content(magnitude):
        duration = active_duration(magnitude, noise_floor)
        if duration >= TEABAG_MIN_ACTIVE_DURATION:
            # confidence = hardcoded 0.9 — detection is binary, rhythm either present or not
            return ("up_down", 0.9)  # frontend expects 'up_down' for teabag
    # Check up_down — requires peaks, high CV, high peak, dominant axis z
    cv = features['mag_std'] / (features['mag_mean'] + 0.1)
    peaks, _ = find_peaks(magnitude, height=noise_floor * 3.0, distance=SAMPLE_RATE // 2)
    if (1 <= len(peaks) <= UP_DOWN_MAX_PEAKS
            and features['mag_max'] > UP_DOWN_MIN_PEAK
            and cv > CV_THRESHOLD
            and features['z_std'] >= features['y_std'] * UP_DOWN_AXIS_RATIO
            and features['z_std'] >= features['x_std'] * UP_DOWN_AXIS_RATIO):
        peak_conf = min(1.0, features['mag_max'] / 500.0)
        return ('press_down', round(peak_conf, 2))  # frontend expects 'press_down' for up_down
    # Circular fallback — should only occur on horizontal axes
    if features['dominant_axis'] == 'z':
        return (None, 0.0)
    active_fraction = float(np.sum(magnitude > noise_floor)) / len(magnitude)
    active_conf = min(1.0, active_fraction / 0.7)
    mag_conf = min(1.0, features['mag_mean'] / 100.0)
    return ('grinding', round((active_conf + mag_conf) / 2.0, 2))  # frontend expects 'grinding' for circular


# -- Detector state machine --------------------------------
class Detector:
    """
    Guided motion detector with fixed-time phases.
    Same interface as the old GuidedDetector for use by bridge_v2.py.

    Cycle:
      CALIBRATING (2s) -> COUNTDOWN (3s) -> RECORDING (8s)
      -> CLASSIFYING (instant) -> COOLDOWN (3s) -> repeat
    """

    CALIBRATING = "calibrating"
    COUNTDOWN = "countdown"
    RECORDING = "recording"
    CLASSIFYING = "classifying"
    COOLDOWN = "cooldown"

    def __init__(self):
        self.state = self.CALIBRATING
        self._phase_start = time.time()
        self._cal_buffer: list[tuple[float, float, float]] = []
        self._rec_buffer: list[tuple[float, float, float]] = []
        self._baseline_x = 0.0
        self._baseline_y = 0.0
        self._baseline_z = 0.0
        self._noise_floor = 999.0
        self.last_result: dict | None = None
        self.last_mag = 0.0
        self._printed_countdown: set[int] = set()
        self._printed_recording: set[int] = set()
        self._announced_phase = False

    @property
    def phase_remaining(self) -> float:
        elapsed = time.time() - self._phase_start
        if self.state == self.CALIBRATING:
            return max(0.0, CALIBRATION_SECONDS - elapsed)
        if self.state == self.COUNTDOWN:
            return max(0.0, COUNTDOWN_SECONDS - elapsed)
        if self.state == self.RECORDING:
            return max(0.0, RECORDING_SECONDS - elapsed)
        if self.state == self.COOLDOWN:
            return max(0.0, COOLDOWN_SECONDS - elapsed)
        return 0.0

    def _enter_state(self, new_state: str):
        self.state = new_state
        self._phase_start = time.time()
        self._announced_phase = False
        self._printed_countdown = set()
        self._printed_recording = set()

    def add_sample(self, x_raw: float, y_raw: float, z_raw: float) -> list[dict]:
        """Feed a raw sensor sample. Returns detection events (usually 0 or 1)."""
        xc = x_raw - self._baseline_x
        yc = y_raw - self._baseline_y
        zc = z_raw - self._baseline_z
        self.last_mag = math.sqrt(xc * xc + yc * yc + zc * zc)
        remaining = self.phase_remaining

        # -- CALIBRATING ------------------------------------------------
        if self.state == self.CALIBRATING:
            if not self._announced_phase:
                print(f"\n  [CALIBRATING] Hold the sensor still... ({CALIBRATION_SECONDS:.0f}s)")
                self._announced_phase = True
            self._cal_buffer.append((x_raw, y_raw, z_raw))
            if remaining <= 0:
                self._finish_calibration()
            return []

        # -- COUNTDOWN --------------------------------------------------
        if self.state == self.COUNTDOWN:
            if not self._announced_phase:
                print(f"\n  [COUNTDOWN] Get ready... motion starts in {COUNTDOWN_SECONDS:.0f}s")
                self._announced_phase = True
            self._cal_buffer.append((x_raw, y_raw, z_raw))
            sec = int(remaining) + 1
            if sec not in self._printed_countdown and sec <= COUNTDOWN_SECONDS:
                self._printed_countdown.add(sec)
                print(f"    {sec}...")
            if remaining <= 0:
                self._finish_countdown()
            return []

        # -- RECORDING --------------------------------------------------
        if self.state == self.RECORDING:
            if not self._announced_phase:
                print(f"\n  [RECORDING] >>> GO! Perform your motion now! ({RECORDING_SECONDS:.0f}s) <<<")
                self._announced_phase = True
            self._rec_buffer.append((x_raw, y_raw, z_raw))
            sec = int(remaining)
            if sec not in self._printed_recording and sec < RECORDING_SECONDS:
                self._printed_recording.add(sec)
                n = len(self._rec_buffer)
                print(f"    {sec + 1}s remaining... ({n} samples, |mag|={self.last_mag:.1f})")
            if remaining <= 0:
                return self._finish_recording()
            return []

        # -- COOLDOWN ---------------------------------------------------
        if self.state == self.COOLDOWN:
            if not self._announced_phase:
                if self.last_result:
                    print(f"\n  [RESULT] >>> {self.last_result['motion'].upper()} "
                          f"(confidence: {self.last_result['confidence']:.0%}) <<<")
                else:
                    print(f"\n  [RESULT] No confident match.")
                print(f"  [COOLDOWN] Next round in {COOLDOWN_SECONDS:.0f}s...")
                self._announced_phase = True
            if remaining <= 0:
                self._cal_buffer = []
                self._enter_state(self.CALIBRATING)
            return []

        return []

    def _finish_calibration(self):
        """Compute baseline and noise floor from calibration samples."""
        if not self._cal_buffer:
            self._enter_state(self.COUNTDOWN)
            return
        arr = np.array(self._cal_buffer)
        self._baseline_x = float(arr[:, 0].mean())
        self._baseline_y = float(arr[:, 1].mean())
        self._baseline_z = float(arr[:, 2].mean())
        centered = arr - np.array([self._baseline_x, self._baseline_y, self._baseline_z])
        mags = np.sqrt(np.sum(centered ** 2, axis=1))
        self._noise_floor = min(NOISE_FLOOR_MAX, max(NOISE_FLOOR_MIN, float(mags.mean() + 3.0 * mags.std())))
        print(f"    baseline: x={self._baseline_x:.1f} y={self._baseline_y:.1f} z={self._baseline_z:.1f}")
        print(f"    noise floor: {self._noise_floor:.1f} uT")
        if self._noise_floor >= 45.0:
            print("  [!] WARNING: High noise floor \u2014 move magnet away during calibration")
        if self._noise_floor >= 45.0:
            self._noise_floor = 15.0
            print("  [!] Resetting noise floor to 15.0 \u2014 ignoring saturated baseline")
        self._cal_buffer = []
        self._enter_state(self.COUNTDOWN)

    def _finish_countdown(self):
        """Use countdown samples as fresh baseline, then start recording."""
        if self._cal_buffer:
            arr = np.array(self._cal_buffer)
            self._baseline_x = float(arr[:, 0].mean())
            self._baseline_y = float(arr[:, 1].mean())
            self._baseline_z = float(arr[:, 2].mean())
            centered = arr - np.array([self._baseline_x, self._baseline_y, self._baseline_z])
            mags = np.sqrt(np.sum(centered ** 2, axis=1))
            self._noise_floor = min(NOISE_FLOOR_MAX, max(NOISE_FLOOR_MIN, float(mags.mean() + 3.0 * mags.std())))
        self._rec_buffer = []
        self._enter_state(self.RECORDING)

    def _finish_recording(self) -> list[dict]:
        """Subtract baseline, filter, extract features, classify."""
        n_samples = len(self._rec_buffer)
        print(f"\n  [CLASSIFYING] Captured {n_samples} samples ({n_samples / SAMPLE_RATE:.1f}s)")

        if n_samples < MIN_MOTION_SAMPLES:
            print(f"    Too few samples ({n_samples})")
            self.last_result = None
            self._enter_state(self.COOLDOWN)
            return []

        arr = np.array(self._rec_buffer)
        x = arr[:, 0] - self._baseline_x
        y = arr[:, 1] - self._baseline_y
        z = arr[:, 2] - self._baseline_z

        # Low-pass filter each axis
        x_f = low_pass_filter(x)
        y_f = low_pass_filter(y)
        z_f = low_pass_filter(z)

        # Extract features and classify
        magnitude = np.sqrt(x_f ** 2 + y_f ** 2 + z_f ** 2)
        features = extract_features(x_f, y_f, z_f)
        print(f"    Features: {features}")

        motion, confidence = classify(features, magnitude=magnitude, noise_floor=self._noise_floor)

        if motion is None:
            print(f"    No motion detected.")
            self.last_result = None
            self._enter_state(self.COOLDOWN)
            return []

        print(f"    -> {motion} (confidence={confidence:.0%})")
        self.last_result = {
            "motion": motion,
            "detected": True,
            "confidence": round(confidence, 2),
        }
        self._enter_state(self.COOLDOWN)
        return [self.last_result]


# -- Offline CSV test --------------------------------------
def run_test():
    """Load every CSV from backend/data/, extract features, and print results."""
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    csv_files = sorted(glob.glob(os.path.join(data_dir, "*.csv")))

    if not csv_files:
        print(f"  No CSV files found in {data_dir}")
        return

    print(f"\n  Found {len(csv_files)} CSV files in {data_dir}\n")
    noise_floor = 15.0
    print(f"  {'File':<30} {'Detected':<12} {'Conf':>6}  "
          f"{'rest':>5} {'dur':>5} {'rhythm':>7} {'mag_m':>6} {'mag_x':>7} {'dom':>4} {'x_std':>6} {'y_std':>6} {'z_std':>6}")
    print("  " + "-" * 107)

    for path in csv_files:
        filename = os.path.basename(path)
        try:
            df = pd.read_csv(path)
        except Exception as e:
            print(f"  {filename:<30} ERROR: {e}")
            continue

        if len(df) < 20:
            print(f"  {filename:<30} TOO SHORT ({len(df)} rows)")
            continue

        # Baseline subtraction (first BASELINE_SAMPLES)
        n_bl = min(BASELINE_SAMPLES, len(df) // 4)
        n_bl = max(n_bl, 1)
        x = df["x_uT"].values.copy()
        y = df["y_uT"].values.copy()
        z = df["z_uT"].values.copy()
        x -= x[:n_bl].mean()
        y -= y[:n_bl].mean()
        z -= z[:n_bl].mean()

        # Use motion portion only (after baseline)
        x_m = x[n_bl:]
        y_m = y[n_bl:]
        z_m = z[n_bl:]

        if len(x_m) < MIN_MOTION_SAMPLES:
            print(f"  {filename:<30} TOO FEW MOTION SAMPLES ({len(x_m)})")
            continue

        # Filter
        x_f = low_pass_filter(x_m)
        y_f = low_pass_filter(y_m)
        z_f = low_pass_filter(z_m)

        # Features and classify
        mag_signal = np.sqrt(x_f ** 2 + y_f ** 2 + z_f ** 2)
        feat = extract_features(x_f, y_f, z_f)
        motion, conf = classify(feat, magnitude=mag_signal, noise_floor=noise_floor)

        from_rest = starts_from_rest(mag_signal, noise_floor)
        dur = active_duration(mag_signal, noise_floor)
        has_rhythm = has_rhythmic_content(mag_signal)

        det_str = motion if motion else "--"
        rest_str = "Y" if from_rest else "N"
        rhythm_str = "Y" if has_rhythm else "N"
        print(f"  {filename:<30} {det_str:<12} {conf:>5.0%}  "
              f"{rest_str:>5} {dur:>5.1f} {rhythm_str:>7} {feat['mag_mean']:>6.1f} {feat['mag_max']:>7.1f}"
              f" {feat['dominant_axis']:>4} {feat['x_std']:>6.1f} {feat['y_std']:>6.1f} {feat['z_std']:>6.1f}")

    print()


# -- Main --------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gesture detector (signal-processing based)")
    parser.add_argument("--test", "-t", action="store_true",
                        help="Run offline test against CSVs in backend/data/")
    args = parser.parse_args()

    if args.test:
        run_test()
    else:
        print("  Use --test to run offline CSV analysis.")
        print("  For live detection, run bridge_v2.py instead.")
