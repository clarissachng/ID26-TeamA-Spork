#!/usr/bin/env python3
"""
classifier.py — Motion scorer for While It Steeps
==================================================
Given a recorded buffer of (x, y, z) samples and an expected motion,
returns a score 0.0–1.0 indicating how well the recording matches.

Used by both bridge_play.py and bridge_tutorial.py.

Three motions:
  "grinding"   — circular XY rotation
  "up_down"    — rhythmic vertical dipping
  "press_down" — single sharp downward spike

Per-tool profiles set classification thresholds because magnet
signal strength varies between tools.

Usage (offline test):
    python classifier.py --test
"""

import argparse
import glob
import os

import numpy as np
import pandas as pd
from scipy.signal import butter, filtfilt

# ── Constants ──────────────────────────────────────────────────────────────
SAMPLE_RATE         = 25        # Hz
LOW_PASS_CUTOFF_HZ  = 3.0
BASELINE_SAMPLES    = 50        # first 2 s at 25 Hz
PASS_THRESHOLD      = 0.60      # score >= this = passed

TEABAG_RHYTHM_LOW_HZ  = 1.5
TEABAG_RHYTHM_HIGH_HZ = 3.5
TEABAG_RHYTHM_RATIO   = 0.25

# ── NFC tag → tool name ────────────────────────────────────────────────────
NFC_TAGS: dict[str, str] = {
    "044F7730C72A81": "Tongs",
    "048C7630C72A81": "Kettle",
    "046A9130C72A81": "Coffee Press",
    "044BA230C72A81": "Coffee Grinder",
    "04728F30C72A81": "Spork",
    "0481AD30C72A81": "Sieve",
    "049CA830C72A81": "Tea Bag",
    "04899130C72A81": "Whisk",
}

# ── Per-tool thresholds ────────────────────────────────────────────────────
# Tuned from offline --test analysis on recorded CSVs.
#   press_zc_max      ZC at or below → press_down
#   up_down_zc_min    ZC at or above → up_down candidate
#   up_down_freq_min  dom_freq above → also up_down candidate (OR logic)
#   circular_zc_min   ZC lower bound for circular
#   circular_zc_max   ZC upper bound for circular
#   peak_reject_uT    hard reject if mag_max below this

TOOL_PROFILES: dict[str, dict] = {
    "Whisk": {
        "peak_reject_uT":   2.0,
        "press_zc_max":     5,
        "up_down_zc_min":   18,
        "up_down_freq_min": 0.8,
        "circular_zc_min":  18,
        "circular_zc_max":  28,
    },
    "Coffee Grinder": {
        "peak_reject_uT":   2.0,
        "press_zc_max":     10,
        "up_down_zc_min":   35,
        "up_down_freq_min": 0.5,
        "circular_zc_min":  15,
        "circular_zc_max":  32,
    },
    "Coffee Press": {
        "peak_reject_uT":   2.0,
        "press_zc_max":     16,
        "up_down_zc_min":   28,
        "up_down_freq_min": 0.6,
        "circular_zc_min":  17,
        "circular_zc_max":  27,
    },
    "Kettle": {
        "peak_reject_uT":   3.0,
        "press_zc_max":     5,
        "up_down_zc_min":   55,
        "up_down_freq_min": 0.8,
        "circular_zc_min":  6,
        "circular_zc_max":  20,
    },
    "Sieve": {
        "peak_reject_uT":   2.0,
        "press_zc_max":     3,
        "up_down_zc_min":   40,
        "up_down_freq_min": 1.5,
        "circular_zc_min":  12,
        "circular_zc_max":  25,
    },
    "Spork": {
        "peak_reject_uT":   3.0,
        "press_zc_max":     4,
        "up_down_zc_min":   15,
        "up_down_freq_min": 0.5,
        "circular_zc_min":  17,
        "circular_zc_max":  35,
    },
    "Tea Bag": {
        "peak_reject_uT":   2.0,
        "press_zc_max":     5,
        "up_down_zc_min":   18,
        "up_down_freq_min": 0.8,
        "circular_zc_min":  18,
        "circular_zc_max":  28,
    },
    "Tongs": {
        "peak_reject_uT":   2.0,
        "press_zc_max":     5,
        "up_down_zc_min":   50,
        "up_down_freq_min": 2.0,
        "circular_zc_min":  18,
        "circular_zc_max":  28,
    },
}

ALL_MOTIONS = ["grinding", "up_down", "press_down"]


# ── Signal processing ──────────────────────────────────────────────────────

def low_pass_filter(data: np.ndarray,
                    cutoff_hz: float = LOW_PASS_CUTOFF_HZ,
                    sample_rate: float = SAMPLE_RATE) -> np.ndarray:
    nyq  = sample_rate / 2.0
    b, a = butter(2, cutoff_hz / nyq, btype="low")
    return filtfilt(b, a, data)


def zero_crossings(signal: np.ndarray) -> int:
    centered = signal - signal.mean()
    return int(np.sum(np.diff(np.sign(centered)) != 0))


def dominant_frequency(signal: np.ndarray,
                       sample_rate: float = SAMPLE_RATE) -> float:
    fft_vals    = np.abs(np.fft.rfft(signal - signal.mean()))
    freqs       = np.fft.rfftfreq(len(signal), d=1.0 / sample_rate)
    fft_vals[0] = 0
    return float(freqs[np.argmax(fft_vals)]) if len(freqs) > 1 else 0.0


def has_rhythmic_content(magnitude: np.ndarray,
                         sample_rate: float = SAMPLE_RATE) -> bool:
    fft_vals    = np.abs(np.fft.rfft(magnitude - magnitude.mean()))
    freqs       = np.fft.rfftfreq(len(magnitude), d=1.0 / sample_rate)
    low_mask    = (freqs >= 0) & (freqs < 1.0)
    rhythm_mask = (freqs >= TEABAG_RHYTHM_LOW_HZ) & (freqs <= TEABAG_RHYTHM_HIGH_HZ)
    if not np.any(low_mask) or not np.any(rhythm_mask):
        return False
    low_e    = float(np.max(fft_vals[low_mask]))
    rhythm_e = float(np.max(fft_vals[rhythm_mask]))
    return low_e > 0 and rhythm_e > low_e * TEABAG_RHYTHM_RATIO


def compute_xy_rotation(x: np.ndarray,
                        y: np.ndarray) -> tuple[float, float]:
    """Returns (n_full_circles, sweep_consistency 0-1)."""
    if len(x) < 4:
        return 0.0, 0.0
    angles    = np.arctan2(y, x)
    unwrapped = np.unwrap(angles)
    total_rot = unwrapped[-1] - unwrapped[0]
    n_circles = total_rot / (2.0 * np.pi)
    diffs     = np.diff(unwrapped)
    if len(diffs) == 0 or total_rot == 0:
        return n_circles, 0.0
    same_dir    = float(np.sum(np.sign(diffs) == np.sign(total_rot)))
    consistency = same_dir / len(diffs)
    return n_circles, consistency


def extract_features(x: np.ndarray,
                     y: np.ndarray,
                     z: np.ndarray) -> dict:
    mag      = np.sqrt(x**2 + y**2 + z**2)
    zc_mag   = zero_crossings(mag)
    mag_mean = float(mag.mean())
    mag_std  = float(mag.std())
    mag_max  = float(np.max(mag))
    dom_freq = dominant_frequency(mag)

    active_mask = mag > mag.mean()
    xa, ya, za  = (x[active_mask], y[active_mask], z[active_mask]) \
                  if np.sum(active_mask) > 5 else (x, y, z)

    xy_circles, xy_consistency = compute_xy_rotation(xa, ya)
    xy_mag_mean = float(np.sqrt(xa**2 + ya**2).mean()) if len(xa) > 0 else 0.0

    return {
        "zc_mag":         zc_mag,
        "mag_mean":       mag_mean,
        "mag_std":        mag_std,
        "mag_max":        mag_max,
        "dom_freq":       dom_freq,
        "xy_circles":     xy_circles,
        "xy_consistency": xy_consistency,
        "xy_mag_mean":    xy_mag_mean,
        "rhythmic":       has_rhythmic_content(mag),
    }


# ── Core scorer ────────────────────────────────────────────────────────────

def score_motion(
    samples: list[tuple[float, float, float]],
    expected_motion: str,
    tool_name: str,
    baseline: tuple[float, float, float] | None = None,
) -> dict:
    """
    Score a buffer of raw (x, y, z) samples against an expected motion.

    Parameters
    ----------
    samples         List of (x_raw, y_raw, z_raw) tuples from the recording.
    expected_motion One of "grinding", "up_down", "press_down".
    tool_name       Tool name matching a key in TOOL_PROFILES.
    baseline        Optional (bx, by, bz) pre-computed baseline offsets.
                    If None, uses the mean of the first BASELINE_SAMPLES.

    Returns
    -------
    dict with keys:
        score    float 0–1
        passed   bool  (score >= PASS_THRESHOLD)
        motion   str   expected_motion (echoed back)
        tool     str   tool_name
        detail   dict  raw feature values for debugging
    """
    profile = TOOL_PROFILES.get(tool_name)
    if not profile or expected_motion not in ALL_MOTIONS or len(samples) < 8:
        return _null_result(expected_motion, tool_name, "no_profile_or_too_short")

    arr = np.array(samples, dtype=float)

    # Baseline subtraction
    if baseline is not None:
        bx, by, bz = baseline
    else:
        n  = min(BASELINE_SAMPLES, len(arr) // 4)
        n  = max(n, 1)
        bx = float(arr[:n, 0].mean())
        by = float(arr[:n, 1].mean())
        bz = float(arr[:n, 2].mean())

    x = arr[:, 0] - bx
    y = arr[:, 1] - by
    z = arr[:, 2] - bz

    # Low-pass filter
    xf = low_pass_filter(x)
    yf = low_pass_filter(y)
    zf = low_pass_filter(z)

    feat = extract_features(xf, yf, zf)

    # Hard reject: too weak a signal
    if feat["mag_max"] < profile["peak_reject_uT"]:
        return _null_result(expected_motion, tool_name, "signal_too_weak", feat)

    raw_score = _compute_score(feat, expected_motion, profile)
    passed    = bool(raw_score >= PASS_THRESHOLD)

    return {
        "score":  round(raw_score, 3),
        "passed": passed,
        "motion": expected_motion,
        "tool":   tool_name,
        "detail": {k: round(v, 3) if isinstance(v, float) else v
                   for k, v in feat.items()},
    }


def _compute_score(feat: dict, motion: str, profile: dict) -> float:
    zc  = feat["zc_mag"]
    df  = feat["dom_freq"]
    std = feat["mag_std"]

    if motion == "press_down":
        # Low ZC + sharp spike
        zc_score    = max(0.0, 1.0 - zc / max(1, profile["press_zc_max"] * 2))
        spike_score = min(1.0, feat["mag_max"] / 50.0) \
                      if std > feat["mag_mean"] * 0.3 else 0.0
        return (zc_score + spike_score) / 2.0

    elif motion == "up_down":
        # High ZC or high freq + bonus for rhythmic content
        zc_conf   = min(1.0, zc / max(1, profile["up_down_zc_min"] + 10))
        freq_conf = min(1.0, df / max(0.1, profile["up_down_freq_min"] + 0.5))
        raw       = max(zc_conf, freq_conf) + (0.1 if feat["rhythmic"] else 0.0)
        return min(1.0, raw)

    elif motion == "grinding":
        # XY rotation quality
        rot_score  = min(1.0, abs(feat["xy_circles"]) / 2.0)
        cons_score = feat["xy_consistency"]
        mag_score  = min(1.0, feat["xy_mag_mean"] / 20.0)
        in_range   = profile["circular_zc_min"] <= zc <= profile["circular_zc_max"]
        raw        = (rot_score + cons_score + mag_score) / 3.0 + (0.1 if in_range else 0.0)
        return min(1.0, raw)

    return 0.0


def _null_result(motion: str, tool: str,
                 reason: str = "", feat: dict | None = None) -> dict:
    return {
        "score":  0.0,
        "passed": False,
        "motion": motion,
        "tool":   tool,
        "reason": reason,
        "detail": feat or {},
    }


# ── Offline test ───────────────────────────────────────────────────────────

def run_test() -> None:
    data_dir  = os.path.join(os.path.dirname(__file__), "data")
    csv_files = sorted(glob.glob(os.path.join(data_dir, "*.csv")))
    known     = set(TOOL_PROFILES.keys())

    csv_files = [p for p in csv_files
                 if any(os.path.basename(p).startswith(t) for t in known)]

    if not csv_files:
        print(f"No matching CSVs in {data_dir}")
        return

    motion_map = {"circular": "grinding", "up_down": "up_down", "press_down": "press_down"}

    totals: dict[str, int]  = {}
    correct: dict[str, int] = {}
    passed_scored: dict[str, int] = {}

    print(f"\n{'File':<42} {'Tool':<16} {'Expected':<12} {'Score':>6} {'Pass':>5}")
    print("─" * 85)

    for path in csv_files:
        fname     = os.path.basename(path)
        tool_name = None
        expected  = None

        for t in known:
            if fname.startswith(t):
                tool_name = t
                rest = fname[len(t):].lstrip("_ ")
                for m in ["circular", "press_down", "up_down"]:
                    if rest.startswith(m):
                        expected = m
                        break
                break

        if not tool_name or not expected:
            continue

        expected_fe = motion_map[expected]

        try:
            df_csv = pd.read_csv(path)
        except Exception as e:
            print(f"{fname:<42} ERROR: {e}")
            continue

        if len(df_csv) < 20:
            continue

        samples = list(zip(df_csv["x_uT"], df_csv["y_uT"], df_csv["z_uT"]))
        result  = score_motion(samples, expected_fe, tool_name)

        totals[expected]  = totals.get(expected, 0) + 1
        correct[expected] = correct.get(expected, 0) + 1   # always count
        if result["passed"]:
            passed_scored[expected] = passed_scored.get(expected, 0) + 1

        mark = "✓" if result["passed"] else "✗"
        print(f"  {fname:<40} {tool_name:<16} {expected_fe:<12} "
              f"{result['score']:>5.0%} {mark}")

    print("\n" + "═" * 60)
    print("SCORED ACCURACY (score >= 70%)")
    print("═" * 60)
    overall_t = overall_p = 0
    for m in ["circular", "press_down", "up_down"]:
        t = totals.get(m, 0)
        p = passed_scored.get(m, 0)
        overall_t += t
        overall_p += p
        print(f"  {m:<12}: {p}/{t}  {p/t:.0%}" if t else f"  {m:<12}: n/a")
    if overall_t:
        print(f"  {'TOTAL':<12}: {overall_p}/{overall_t}  {overall_p/overall_t:.0%}")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", "-t", action="store_true")
    args = parser.parse_args()
    if args.test:
        run_test()
    else:
        print("Run with --test to score all CSVs in backend/data/")