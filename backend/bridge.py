#!/usr/bin/env python3
"""
Serial -> WebSocket Bridge for Game
====================================
Reads magnetometer JSON from Arduino over serial, runs real-time
motion detection (DTW + amplitude/frequency gating), and broadcasts
results to the webapp via WebSocket (ws://localhost:8765).

Usage:
    python bridge.py                  # auto-detect port, guided detection
    python bridge.py --raw            # just print raw data (hardware test)
    python bridge.py --port COM3      # specify serial port

Requirements:
    pip install pyserial websockets numpy
"""

import argparse
import asyncio
import json
import math
import sys
import time
from pathlib import Path

# Fix Windows terminal encoding for special characters
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import serial
import serial.tools.list_ports
import websockets


# -- Configuration -----------------------------------------
WS_HOST = "localhost"
WS_PORT = 8765
BAUD_RATE = 115200
SAMPLE_RATE = 25           # Hz  (Arduino sends every 40ms)

# Guided detection timing
CALIBRATION_SECONDS = 2.0  # hold-still baseline collection
COUNTDOWN_SECONDS = 3.0    # "get ready" phase before recording
RECORDING_SECONDS = 8.0    # motion capture window
COOLDOWN_SECONDS = 3.0     # pause between rounds (shows result)
MIN_MOTION_SAMPLES = 8     # minimum samples in extracted motion portion

# -- Load DTW templates ------------------------------------
TEMPLATES_PATH = Path(__file__).parent.parent / "data" / "dtw_templates.json"
RESAMPLE_LENGTH = 50  # must match build_templates.py


def load_templates() -> dict:
    """Load DTW templates from dtw_templates.json."""
    if TEMPLATES_PATH.exists():
        with open(TEMPLATES_PATH) as f:
            data = json.load(f)
        templates = {}
        for motion_name, tmpl_list in data.get("templates", {}).items():
            templates[motion_name] = []
            for t in tmpl_list:
                templates[motion_name].append({
                    "x": np.array(t["x"]),
                    "y": np.array(t["y"]),
                    "z": np.array(t["z"]),
                    "mag": np.array(t["mag"]),
                    "source": t.get("source_file", "?"),
                    "mag_mean": t.get("mag_mean", 0),
                    "mag_std": t.get("mag_std", 0),
                    "dom_freq": t.get("dom_freq", 0),
                    "zero_crossings": t.get("zero_crossings", 0),
                    "axis_weights": t.get("axis_weights", [0.333, 0.333, 0.333]),
                })
        n_total = sum(len(v) for v in templates.values())
        print(f"  [OK] Loaded {n_total} DTW templates across {len(templates)} motions")
        return templates
    print("  [!] No dtw_templates.json found -- run build_templates.py first!")
    return {}


templates_db = load_templates()


# -- Auto-detect Arduino serial port ----------------------
def find_serial_port() -> str | None:
    """Find the first likely Arduino/USB serial port."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = (p.description or "").lower()
        mfr = (p.manufacturer or "").lower()
        if any(kw in desc for kw in ["arduino", "ch340", "cp210", "ftdi", "usbmodem", "usbserial", "usb serial", "esp32", "esp"]):
            return p.device
        if any(kw in mfr for kw in ["arduino", "wch", "silicon labs", "ftdi", "espressif"]):
            return p.device
    # Fallback: any non-Bluetooth serial port
    for p in ports:
        desc = (p.description or "").lower()
        if "bluetooth" not in desc:
            return p.device
    return None


# -- Guided motion detector --------------------------------
start_event = asyncio.Event()


class GuidedDetector:
    """
    Guided motion detector with fixed-time phases.

    Cycle:
      CALIBRATING (2s, hold still)
      -> COUNTDOWN (3s, get ready)
      -> RECORDING (8s, perform motion)
      -> CLASSIFYING (instant)
      -> COOLDOWN (3s, shows result)
      -> back to CALIBRATING
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
        self._noise_floor = min(50.0, max(15.0, float(mags.mean() + 3.0 * mags.std())))
        print(f"    baseline: x={self._baseline_x:.1f} y={self._baseline_y:.1f} z={self._baseline_z:.1f}")
        print(f"    noise floor: {self._noise_floor:.1f} uT")
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
            self._noise_floor = min(50.0, max(15.0, float(mags.mean() + 3.0 * mags.std())))
        self._rec_buffer = []
        self._enter_state(self.RECORDING)

    def _finish_recording(self) -> list[dict]:
        """Extract motion, classify, enter cooldown."""
        n_samples = len(self._rec_buffer)
        print(f"\n  [CLASSIFYING] Captured {n_samples} samples ({n_samples / SAMPLE_RATE:.1f}s)")
        self.last_result = self._classify()
        self._enter_state(self.COOLDOWN)
        if self.last_result:
            return [self.last_result]
        return []

    def _classify(self) -> dict | None:
        """Classify the recorded motion using DTW with amplitude/frequency gating."""
        if not templates_db:
            print("    [!] No DTW templates loaded!")
            return None

        arr = np.array(self._rec_buffer)
        x = arr[:, 0] - self._baseline_x
        y = arr[:, 1] - self._baseline_y
        z = arr[:, 2] - self._baseline_z
        mag = np.sqrt(x ** 2 + y ** 2 + z ** 2)

        # Extract motion portion using noise floor threshold
        above = mag > self._noise_floor
        indices = np.where(above)[0]

        if len(indices) < MIN_MOTION_SAMPLES:
            print(f"    No significant motion detected ({len(indices)} samples above floor)")
            return None

        start_idx = max(0, indices[0] - 2)
        end_idx = min(len(mag), indices[-1] + 3)

        x_m = x[start_idx:end_idx]
        y_m = y[start_idx:end_idx]
        z_m = z[start_idx:end_idx]
        mag_m = mag[start_idx:end_idx]

        n_motion = len(x_m)
        print(f"    Motion portion: {n_motion} samples ({n_motion / SAMPLE_RATE:.1f}s)")

        # Resample + z-normalize
        g = {
            "x": self._z_normalize(self._resample(x_m, RESAMPLE_LENGTH)),
            "y": self._z_normalize(self._resample(y_m, RESAMPLE_LENGTH)),
            "z": self._z_normalize(self._resample(z_m, RESAMPLE_LENGTH)),
            "mag": self._z_normalize(self._resample(mag_m, RESAMPLE_LENGTH)),
        }

        # DTW against all templates
        all_distances: list[tuple[str, float, str]] = []
        for motion_name, tmpl_list in templates_db.items():
            for tmpl in tmpl_list:
                dist = self._multi_axis_dtw(g, tmpl)
                all_distances.append((motion_name, dist, tmpl["source"]))

        all_distances.sort(key=lambda x: x[1])

        # Top 5
        print(f"    Top 5 DTW matches:")
        for name, dist, src in all_distances[:5]:
            print(f"      {name:>16} = {dist:.2f}  ({src})")

        # k-NN k=3
        k = min(3, len(all_distances))
        top_k = all_distances[:k]
        vote_counts: dict[str, int] = {}
        vote_dists: dict[str, float] = {}
        for name, dist, _ in top_k:
            vote_counts[name] = vote_counts.get(name, 0) + 1
            if name not in vote_dists or dist < vote_dists[name]:
                vote_dists[name] = dist

        best_name = max(vote_counts, key=lambda n: (vote_counts[n], -vote_dists[n]))
        best_dist = vote_dists[best_name]
        best_votes = vote_counts[best_name]

        REJECT_THRESHOLD = 12.0
        if best_dist > REJECT_THRESHOLD:
            print(f"    Rejected: dist {best_dist:.2f} > threshold {REJECT_THRESHOLD}")
            return None

        confidence = max(0.0, min(1.0, 1.0 - (best_dist / REJECT_THRESHOLD)))

        # Ambiguity check
        second_best_dist = float("inf")
        for name, dist, _ in all_distances:
            if name != best_name:
                second_best_dist = dist
                break
        gap = second_best_dist - best_dist

        if gap < 0.5 and confidence < 0.5:
            print(f"    Ambiguous: gap={gap:.2f}, confidence={confidence:.0%}")
            return None

        print(f"    -> {best_name} (dist={best_dist:.2f}, votes={best_votes}/{k}, "
              f"gap={gap:.2f}, conf={confidence:.0%})")

        return {
            "motion": best_name,
            "detected": True,
            "confidence": round(confidence, 2),
        }

    # -- DTW helpers ----------------------------------------

    @staticmethod
    def _resample(signal: np.ndarray, target_len: int) -> np.ndarray:
        if len(signal) == target_len:
            return signal
        x_old = np.linspace(0, 1, len(signal))
        x_new = np.linspace(0, 1, target_len)
        return np.interp(x_new, x_old, signal)

    @staticmethod
    def _z_normalize(signal: np.ndarray) -> np.ndarray:
        std = signal.std()
        if std < 1e-6:
            return signal - signal.mean()
        return (signal - signal.mean()) / std

    @staticmethod
    def _dtw_distance(a: np.ndarray, b: np.ndarray) -> float:
        n, m = len(a), len(b)
        w = max(5, abs(n - m))
        cost = np.full((n + 1, m + 1), np.inf)
        cost[0, 0] = 0.0
        for i in range(1, n + 1):
            jmin = max(1, i - w)
            jmax = min(m, i + w)
            for j in range(jmin, jmax + 1):
                d = (a[i - 1] - b[j - 1]) ** 2
                cost[i, j] = d + min(cost[i - 1, j], cost[i, j - 1], cost[i - 1, j - 1])
        return float(np.sqrt(cost[n, m]))

    def _multi_axis_dtw(self, gesture_axes: dict, template: dict) -> float:
        """Equal-weight DTW across all 4 channels."""
        total = 0.0
        for axis in ["x", "y", "z", "mag"]:
            total += self._dtw_distance(gesture_axes[axis], template[axis])
        return total / 4.0


# -- WebSocket server --------------------------------------
connected_clients: set = set()


async def ws_handler(websocket):
    """Handle a new WebSocket client connection."""
    connected_clients.add(websocket)
    remote = websocket.remote_address
    print(f"  [WS] Client connected: {remote}")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                cmd = data.get("command", "")
                if cmd == "start":
                    start_event.set()
                    print("  [WS] Received 'start' command")
            except (json.JSONDecodeError, AttributeError):
                pass
    finally:
        connected_clients.discard(websocket)
        print(f"  [WS] Client disconnected: {remote}")


async def broadcast(message: dict):
    """Send a JSON message to all connected WebSocket clients."""
    if not connected_clients:
        return
    data = json.dumps(message)
    await asyncio.gather(
        *[client.send(data) for client in connected_clients],
        return_exceptions=True,
    )


# -- Serial reader ----------------------------------------
async def serial_reader(port: str, raw_mode: bool = False, baud_rate: int = BAUD_RATE):
    """
    Read JSON lines from Arduino serial, run guided detection,
    and broadcast results over WebSocket.
    """
    detector = GuidedDetector()
    sample_count = 0

    print(f"\n  [SER] Opening serial port: {port} @ {baud_rate} baud")

    try:
        ser = serial.Serial(port, baud_rate, timeout=1)
    except serial.SerialException as e:
        print(f"  [X] Could not open {port}: {e}")
        print("    Available ports:")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  -- {p.description}")
        return

    # Flush stale data
    await asyncio.sleep(0.5)
    ser.reset_input_buffer()
    print("  [OK] Serial connected -- reading data...\n")

    try:
        while True:
            line = await asyncio.get_event_loop().run_in_executor(
                None, ser.readline
            )

            if not line:
                continue

            try:
                text = line.decode("utf-8", errors="ignore").strip()
                if not text:
                    continue
                data = json.loads(text)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue

            x_raw = data.get("x", 0)
            y_raw = data.get("y", 0)
            z_raw = data.get("z", 0)

            sample_count += 1

            if raw_mode:
                mag_d = math.sqrt(x_raw * x_raw + y_raw * y_raw + z_raw * z_raw)
                print(
                    f"  #{sample_count:>5}  "
                    f"x={x_raw:>8.1f}  y={y_raw:>8.1f}  z={z_raw:>8.1f}  "
                    f"|mag|={mag_d:>7.1f}"
                )
                await broadcast({
                    "raw": True,
                    "x": round(x_raw, 2),
                    "y": round(y_raw, 2),
                    "z": round(z_raw, 2),
                    "mag": round(mag_d, 2),
                })
                continue

            # Guided detection mode
            events = detector.add_sample(x_raw, y_raw, z_raw)

            # Broadcast state on every sample
            await broadcast({
                "sensor": True,
                "x": round(x_raw - detector._baseline_x, 2),
                "y": round(y_raw - detector._baseline_y, 2),
                "z": round(z_raw - detector._baseline_z, 2),
                "mag": round(detector.last_mag, 2),
                "state": detector.state,
                "phase_remaining": round(detector.phase_remaining, 1),
                "noise_floor": round(detector._noise_floor, 1),
                "recording_samples": len(detector._rec_buffer),
            })

            for event in events:
                print(
                    f"\n  [>>] DETECTED: {event['motion'].upper()}  "
                    f"confidence={event['confidence']:.0%}"
                )
                await broadcast(event)

    except KeyboardInterrupt:
        pass
    finally:
        ser.close()
        print("\n  Serial port closed.")


# -- Main --------------------------------------------------
async def main():
    parser = argparse.ArgumentParser(description="While It Steeps: Arduino -> WebSocket bridge")
    parser.add_argument("--port", "-p", help="Serial port. Auto-detects if omitted.")
    parser.add_argument("--raw", "-r", action="store_true", help="Raw mode -- just print sensor values.")
    parser.add_argument("--baud", "-b", type=int, default=BAUD_RATE, help=f"Baud rate (default: {BAUD_RATE})")
    args = parser.parse_args()

    port = args.port or find_serial_port()
    if not port:
        print("  [X] No Arduino serial port found.")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  -- {p.description}")
        sys.exit(1)

    mode = "RAW (hardware test)" if args.raw else "GUIDED DETECTION"
    print()
    print("  ===========================================")
    print("    While It Steeps -- Arduino Bridge")
    print("  ===========================================")
    print()
    print(f"  Mode : {mode}")
    print(f"  Port : {port}")
    print(f"  Baud : {args.baud}")
    print(f"  WS   : ws://{WS_HOST}:{WS_PORT}")
    print()
    print(f"  Detection cycle:")
    print(f"    1. CALIBRATE   {CALIBRATION_SECONDS:.0f}s  (hold still)")
    print(f"    2. COUNTDOWN   {COUNTDOWN_SECONDS:.0f}s  (get ready)")
    print(f"    3. RECORDING   {RECORDING_SECONDS:.0f}s  (perform motion)")
    print(f"    4. CLASSIFY    (instant)")
    print(f"    5. COOLDOWN    {COOLDOWN_SECONDS:.0f}s  (shows result)")
    print(f"    -> repeat from step 1")
    print()

    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        print(f"  [OK] WebSocket server on ws://{WS_HOST}:{WS_PORT}")
        print(f"  [OK] Starting serial reader...\n")
        await serial_reader(port, raw_mode=args.raw, baud_rate=args.baud)


if __name__ == "__main__":
    asyncio.run(main())
