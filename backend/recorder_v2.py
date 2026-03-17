#!/usr/bin/env python3
"""
Training Data Recorder (v2)
=============================
Reads magnetometer JSON from Arduino over serial and guides the user
through recording training data for each motion. Saves CSVs to backend/data/.

Usage:
    python recorder_v2.py                  # auto-detect port, start recording
    python recorder_v2.py --port COM3      # specify serial port

Requirements:
    pip install pyserial
"""

import argparse
import csv
import json
import math
import os
import sys
import time
from pathlib import Path

# Fix Windows terminal encoding for special characters
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import serial
import serial.tools.list_ports


# -- Configuration -----------------------------------------
BAUD_RATE = 115200
SAMPLE_RATE = 25  # Hz  (Arduino sends every 40ms)

RECORD_DIR = Path(__file__).parent / "data"
ALL_MOTIONS = [
    "circular",
    "up_down",
    "press_down",
]
RECORDINGS_PER_MOTION = 5
CALIBRATION_SECONDS = 2.0
COUNTDOWN_SECONDS = 3.0
RECORD_DURATION_SECONDS = 8.0


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


# -- Recording session -------------------------------------
def record_session(port: str, baud_rate: int = BAUD_RATE):
    """
    Interactive recording session. Guides user through recording
    training data for each motion, saved as CSV to backend/data/.
    Protocol: calibrate -> countdown -> record.
    """
    os.makedirs(RECORD_DIR, exist_ok=True)

    print()
    print("  ===========================================")
    print("    RECORDING MODE")
    print("  ===========================================")
    print()
    print(f"  Output dir : {RECORD_DIR}")
    print(f"  Motions    : {', '.join(ALL_MOTIONS)}")
    print(f"  Recs each  : {RECORDINGS_PER_MOTION}")
    print(f"  Protocol   : {CALIBRATION_SECONDS:.0f}s calibrate + "
          f"{COUNTDOWN_SECONDS:.0f}s countdown + "
          f"{RECORD_DURATION_SECONDS:.0f}s record")
    print()

    try:
        ser = serial.Serial(port, baud_rate, timeout=1)
    except serial.SerialException as e:
        print(f"  [X] Could not open {port}: {e}")
        return

    time.sleep(0.5)
    ser.reset_input_buffer()
    print(f"  [OK] Serial connected on {port}\n")

    def read_sample():
        """Read one JSON sample from serial. Returns (x, y, z) or None."""
        while True:
            line = ser.readline()
            if not line:
                continue
            try:
                text = line.decode("utf-8", errors="ignore").strip()
                if not text:
                    continue
                data = json.loads(text)
                return (data.get("x", 0), data.get("y", 0), data.get("z", 0))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue

    def collect_samples(duration: float) -> list[tuple[float, float, float, float]]:
        """Collect samples for a given duration. Returns list of (timestamp_ms, x, y, z)."""
        samples = []
        t0 = time.time()
        while time.time() - t0 < duration:
            xyz = read_sample()
            if xyz:
                ts_ms = (time.time() - t0) * 1000.0
                samples.append((ts_ms, xyz[0], xyz[1], xyz[2]))
        return samples

    total_saved = 0

    TOOLS = {
        "044F7730C72A81": "Tongs",
        "048C7630C72A81": "Kettle",
        "049AA730C72A81": "Coffee Press",
        "044BA230C72A81": "Coffee Grinder",
        "04728F30C72A81": "Spork",
        "0481AD30C72A81": "Sieve",
        "049CA830C72A81": "Tea Bag",
    }

    for tool_uid, tool_name in TOOLS.items():
        print(f"\n{'#' * 60}")
        print(f"  TOOL: {tool_name} ({tool_uid})")
        print(f"{'#' * 60}\n")
        for motion in ALL_MOTIONS:
            start_idx = 1
            print(f"\n  {'=' * 50}")
            print(f"  MOTION: {motion.upper()} (Tool: {tool_name})")
            print(f"  Recording {RECORDINGS_PER_MOTION} samples (starting at #{start_idx})")
            print(f"  {'=' * 50}")
            for i in range(RECORDINGS_PER_MOTION):
                rec_idx = start_idx + i
                filename = f"{tool_name}_{motion}_{rec_idx}.csv"
                filepath = RECORD_DIR / filename
                print(f"\n  --- {filename} ({i + 1}/{RECORDINGS_PER_MOTION}) ---")
                input("  Press ENTER when ready (hold sensor still)...")

            # Phase 1: Calibrate
            print(f"  [CALIBRATING] Hold still... ({CALIBRATION_SECONDS:.0f}s)")
            cal_samples = collect_samples(CALIBRATION_SECONDS)
            print(f"    Collected {len(cal_samples)} calibration samples")

            # Phase 2: Countdown
            print(f"  [COUNTDOWN] Get ready...")
            countdown_t0 = time.time()
            countdown_samples = []
            printed_secs = set()
            while time.time() - countdown_t0 < COUNTDOWN_SECONDS:
                xyz = read_sample()
                if xyz:
                    ts_ms = (time.time() - countdown_t0) * 1000.0
                    countdown_samples.append((ts_ms, xyz[0], xyz[1], xyz[2]))
                remaining = COUNTDOWN_SECONDS - (time.time() - countdown_t0)
                sec = int(remaining) + 1
                if sec not in printed_secs and 1 <= sec <= COUNTDOWN_SECONDS:
                    printed_secs.add(sec)
                    print(f"    {sec}...")

            # Phase 3: Record
            print(f"  [RECORDING] >>> GO! Perform '{motion}' now! ({RECORD_DURATION_SECONDS:.0f}s) <<<")
            rec_t0 = time.time()

            # We save ALL samples (baseline prefix + motion) in one CSV,
            # same format as web dashboard: timestamp,x_uT,y_uT,z_uT
            all_rows = []

            # Add calibration samples as baseline prefix
            for ts_ms, x, y, z in cal_samples:
                all_rows.append((ts_ms, x, y, z))

            # Add countdown samples (extends baseline)
            offset_ms = cal_samples[-1][0] if cal_samples else 0.0
            for ts_ms, x, y, z in countdown_samples:
                all_rows.append((offset_ms + ts_ms, x, y, z))

            # Record motion samples
            base_offset = all_rows[-1][0] if all_rows else 0.0
            rec_count = 0
            printed_rec_secs = set()
            while time.time() - rec_t0 < RECORD_DURATION_SECONDS:
                xyz = read_sample()
                if xyz:
                    ts_ms = base_offset + (time.time() - rec_t0) * 1000.0
                    all_rows.append((ts_ms, xyz[0], xyz[1], xyz[2]))
                    rec_count += 1
                remaining = RECORD_DURATION_SECONDS - (time.time() - rec_t0)
                sec = int(remaining)
                if sec not in printed_rec_secs and sec < RECORD_DURATION_SECONDS:
                    printed_rec_secs.add(sec)
                    x_c, y_c, z_c = xyz
                    mag = math.sqrt(x_c**2 + y_c**2 + z_c**2)
                    print(f"    {sec + 1}s remaining... ({rec_count} samples, |raw|={mag:.1f})")

            # Save CSV
            with open(filepath, "w", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["timestamp", "x_uT", "y_uT", "z_uT"])
                for ts_ms, x, y, z in all_rows:
                    writer.writerow([f"{ts_ms:.1f}", f"{x:.2f}", f"{y:.2f}", f"{z:.2f}"])

            total_saved += 1
            print(f"  [SAVED] {filepath.name}  ({len(all_rows)} total samples, {rec_count} motion samples)")

    ser.close()
    print(f"\n  {'=' * 50}")
    print(f"  DONE! Saved {total_saved} new recordings to {RECORD_DIR}")
    print(f"  Run 'python detector.py --test' to test detection on your recordings")
    print(f"  {'=' * 50}")


# -- Main --------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Record training data from Arduino magnetometer")
    parser.add_argument("--port", "-p", help="Serial port. Auto-detects if omitted.")
    parser.add_argument("--baud", "-b", type=int, default=BAUD_RATE, help=f"Baud rate (default: {BAUD_RATE})")
    args = parser.parse_args()

    port = args.port or find_serial_port()
    if not port:
        print("  [X] No Arduino serial port found.")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  -- {p.description}")
        sys.exit(1)

    record_session(port, baud_rate=args.baud)


if __name__ == "__main__":
    main()
