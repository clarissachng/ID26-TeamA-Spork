#!/usr/bin/env python3
"""
Motion Detection Accuracy Tester
==================================
Guided detection loop via serial. Prompts you for the expected motion,
then runs: calibrate -> countdown -> record -> classify via DTW.
Tracks correct/incorrect/rejected results across a session and prints
a confusion-style accuracy summary at the end.

Usage:
    python detect.py                        # auto-detect serial port
    python detect.py --port COM3            # specify port
    python detect.py --rounds 3             # 3 rounds per motion (default: 3)

Requirements:
    pip install pyserial numpy
"""

import argparse
import json
import math
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import serial
import serial.tools.list_ports

# -- Configuration -----------------------------------------
BAUD_RATE = 115200
SAMPLE_RATE = 25

CALIBRATION_SECONDS = 2.0
COUNTDOWN_SECONDS = 3.0
RECORDING_SECONDS = 8.0
MIN_MOTION_SAMPLES = 8
RESAMPLE_LENGTH = 50
REJECT_THRESHOLD = 12.0

ALL_MOTIONS = [
    "coffee_grinder", "pour", "press_down", "scoop",
    "sieve", "stir", "tea_bag", "whisk",
]

TEMPLATES_PATH = Path(__file__).parent.parent / "data" / "dtw_templates.json"


# -- Load DTW templates ------------------------------------
def load_templates() -> dict:
    if not TEMPLATES_PATH.exists():
        print("  [!] No dtw_templates.json found -- run build_templates.py first!")
        return {}
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
                # Feature metadata for gating
                "mag_mean": t.get("mag_mean", 0),
                "mag_std": t.get("mag_std", 0),
                "dom_freq": t.get("dom_freq", 0),
                "zero_crossings": t.get("zero_crossings", 0),
                "axis_weights": t.get("axis_weights", [0.333, 0.333, 0.333]),
            })
    n_total = sum(len(v) for v in templates.values())
    print(f"  [OK] Loaded {n_total} DTW templates across {len(templates)} motions")
    return templates


# -- Auto-detect serial port -------------------------------
def find_serial_port() -> str | None:
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
def read_sample(ser: serial.Serial) -> tuple[float, float, float] | None:
    """Read one JSON sample from serial. Returns (x, y, z) or None."""
    line = ser.readline()
    if not line:
        return None
    try:
        text = line.decode("utf-8", errors="ignore").strip()
        if not text:
            return None
        data = json.loads(text)
        return (data.get("x", 0.0), data.get("y", 0.0), data.get("z", 0.0))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def collect_samples(ser: serial.Serial, duration: float) -> list[tuple[float, float, float]]:
    """Collect raw (x,y,z) samples for a given duration."""
    samples = []
    t0 = time.time()
    while time.time() - t0 < duration:
        xyz = read_sample(ser)
        if xyz:
            samples.append(xyz)
    return samples


# -- DTW functions -----------------------------------------
def resample(signal: np.ndarray, target_len: int) -> np.ndarray:
    if len(signal) == target_len:
        return signal
    x_old = np.linspace(0, 1, len(signal))
    x_new = np.linspace(0, 1, target_len)
    return np.interp(x_new, x_old, signal)


def z_normalize(signal: np.ndarray) -> np.ndarray:
    std = signal.std()
    if std < 1e-6:
        return signal - signal.mean()
    return (signal - signal.mean()) / std


def dtw_distance(a: np.ndarray, b: np.ndarray) -> float:
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


def multi_axis_dtw(gesture: dict, template: dict) -> float:
    """Equal-weight DTW across all 4 channels."""
    total = 0.0
    for axis in ["x", "y", "z", "mag"]:
        total += dtw_distance(gesture[axis], template[axis])
    return total / 4.0


# -- Classification ----------------------------------------
def classify(rec_buffer: list[tuple[float, float, float]],
             baseline: tuple[float, float, float],
             noise_floor: float,
             templates_db: dict) -> dict | None:
    """
    Classify a recorded motion window using DTW k-NN.
    Returns {"motion": str, "confidence": float, "dist": float} or None.
    """
    arr = np.array(rec_buffer)
    x = arr[:, 0] - baseline[0]
    y = arr[:, 1] - baseline[1]
    z = arr[:, 2] - baseline[2]
    mag = np.sqrt(x ** 2 + y ** 2 + z ** 2)

    # Extract motion portion
    above = mag > noise_floor
    indices = np.where(above)[0]

    if len(indices) < MIN_MOTION_SAMPLES:
        print(f"    No significant motion ({len(indices)} samples above floor)")
        return None

    start_idx = max(0, indices[0] - 2)
    end_idx = min(len(mag), indices[-1] + 3)

    x_m, y_m, z_m, mag_m = x[start_idx:end_idx], y[start_idx:end_idx], z[start_idx:end_idx], mag[start_idx:end_idx]
    print(f"    Motion portion: {len(x_m)} samples ({len(x_m) / SAMPLE_RATE:.1f}s)")

    # Resample + z-normalize
    g = {
        "x": z_normalize(resample(x_m, RESAMPLE_LENGTH)),
        "y": z_normalize(resample(y_m, RESAMPLE_LENGTH)),
        "z": z_normalize(resample(z_m, RESAMPLE_LENGTH)),
        "mag": z_normalize(resample(mag_m, RESAMPLE_LENGTH)),
    }

    # DTW against all templates
    all_dists: list[tuple[str, float, str]] = []
    for motion_name, tmpl_list in templates_db.items():
        for tmpl in tmpl_list:
            dist = multi_axis_dtw(g, tmpl)
            all_dists.append((motion_name, dist, tmpl["source"]))

    all_dists.sort(key=lambda x: x[1])

    # Print top 5
    print(f"    Top 5 matches:")
    for name, dist, src in all_dists[:5]:
        print(f"      {name:>16} = {dist:.2f}  ({src})")

    # k-NN k=3
    k = min(3, len(all_dists))
    top_k = all_dists[:k]
    votes: dict[str, int] = {}
    best_per: dict[str, float] = {}
    for name, dist, _ in top_k:
        votes[name] = votes.get(name, 0) + 1
        if name not in best_per or dist < best_per[name]:
            best_per[name] = dist

    best_name = max(votes, key=lambda n: (votes[n], -best_per[n]))
    best_dist = best_per[best_name]
    best_votes = votes[best_name]

    if best_dist > REJECT_THRESHOLD:
        print(f"    REJECTED: dist {best_dist:.2f} > threshold {REJECT_THRESHOLD}")
        return None

    confidence = max(0.0, min(1.0, 1.0 - (best_dist / REJECT_THRESHOLD)))

    # Ambiguity check
    second_dist = float("inf")
    for name, dist, _ in all_dists:
        if name != best_name:
            second_dist = dist
            break
    gap = second_dist - best_dist

    if gap < 0.5 and confidence < 0.5:
        print(f"    AMBIGUOUS: gap={gap:.2f}, conf={confidence:.0%}")
        return None

    print(f"    -> {best_name} (dist={best_dist:.2f}, votes={best_votes}/{k}, "
          f"gap={gap:.2f}, conf={confidence:.0%})")

    return {
        "motion": best_name,
        "confidence": round(confidence, 2),
        "dist": round(best_dist, 2),
    }


# -- Calibration -------------------------------------------
def calibrate(ser: serial.Serial, duration: float) -> tuple[tuple[float, float, float], float]:
    """Collect baseline samples and compute noise floor."""
    samples = collect_samples(ser, duration)
    if not samples:
        return (0.0, 0.0, 0.0), 15.0
    arr = np.array(samples)
    bx, by, bz = float(arr[:, 0].mean()), float(arr[:, 1].mean()), float(arr[:, 2].mean())
    centered = arr - np.array([bx, by, bz])
    mags = np.sqrt(np.sum(centered ** 2, axis=1))
    noise_floor = min(50.0, max(15.0, float(mags.mean() + 3.0 * mags.std())))
    return (bx, by, bz), noise_floor


# -- One detection round -----------------------------------
def run_one_round(ser: serial.Serial, expected: str, templates_db: dict) -> str:
    """
    Run one guided detection cycle. Returns:
      "correct"   - classified == expected
      "wrong:X"   - classified as X instead
      "rejected"  - no confident match
    """
    # Phase 1: Calibrate
    print(f"\n  [CALIBRATING] Hold still... ({CALIBRATION_SECONDS:.0f}s)")
    baseline, noise_floor = calibrate(ser, CALIBRATION_SECONDS)
    print(f"    baseline: x={baseline[0]:.1f} y={baseline[1]:.1f} z={baseline[2]:.1f}")
    print(f"    noise floor: {noise_floor:.1f} uT")

    # Phase 2: Countdown (also refines baseline)
    print(f"\n  [COUNTDOWN] Get ready...")
    countdown_t0 = time.time()
    countdown_samples = []
    printed = set()
    while time.time() - countdown_t0 < COUNTDOWN_SECONDS:
        xyz = read_sample(ser)
        if xyz:
            countdown_samples.append(xyz)
        remaining = COUNTDOWN_SECONDS - (time.time() - countdown_t0)
        sec = int(remaining) + 1
        if sec not in printed and 1 <= sec <= COUNTDOWN_SECONDS:
            printed.add(sec)
            print(f"    {sec}...")

    # Refine baseline with countdown samples
    if countdown_samples:
        arr = np.array(countdown_samples)
        baseline = (float(arr[:, 0].mean()), float(arr[:, 1].mean()), float(arr[:, 2].mean()))
        centered = arr - np.array(baseline)
        mags = np.sqrt(np.sum(centered ** 2, axis=1))
        noise_floor = min(50.0, max(15.0, float(mags.mean() + 3.0 * mags.std())))

    # Phase 3: Record
    print(f"\n  [RECORDING] >>> GO! Perform '{expected}' now! ({RECORDING_SECONDS:.0f}s) <<<")
    rec_buffer = collect_samples(ser, RECORDING_SECONDS)
    print(f"    Captured {len(rec_buffer)} samples")

    # Phase 4: Classify
    print(f"\n  [CLASSIFYING]")
    result = classify(rec_buffer, baseline, noise_floor, templates_db)

    if result is None:
        print(f"\n  [RESULT] REJECTED (no confident match)")
        return "rejected"
    elif result["motion"] == expected:
        print(f"\n  [RESULT] CORRECT! {result['motion']} ({result['confidence']:.0%})")
        return "correct"
    else:
        print(f"\n  [RESULT] WRONG -- detected '{result['motion']}' "
              f"(expected '{expected}', conf={result['confidence']:.0%})")
        return f"wrong:{result['motion']}"


# -- Main --------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Motion detection accuracy tester")
    parser.add_argument("--port", "-p", help="Serial port. Auto-detects if omitted.")
    parser.add_argument("--baud", "-b", type=int, default=BAUD_RATE, help=f"Baud rate (default: {BAUD_RATE})")
    parser.add_argument("--rounds", "-n", type=int, default=3, help="Rounds per motion (default: 3)")
    parser.add_argument("--motions", "-m", nargs="+", choices=ALL_MOTIONS,
                        help="Specific motions to test (default: all)")
    args = parser.parse_args()

    port = args.port or find_serial_port()
    if not port:
        print("  [X] No Arduino serial port found.")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  -- {p.description}")
        sys.exit(1)

    templates_db = load_templates()
    if not templates_db:
        sys.exit(1)

    motions = args.motions or ALL_MOTIONS
    rounds = args.rounds

    print()
    print("  ===========================================")
    print("    MOTION DETECTION ACCURACY TESTER")
    print("  ===========================================")
    print()
    print(f"  Port    : {port}")
    print(f"  Motions : {', '.join(motions)}")
    print(f"  Rounds  : {rounds} per motion")
    print(f"  Total   : {len(motions) * rounds} tests")
    print()
    print(f"  Each round: {CALIBRATION_SECONDS:.0f}s calibrate + "
          f"{COUNTDOWN_SECONDS:.0f}s countdown + "
          f"{RECORDING_SECONDS:.0f}s record")
    print()

    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=1)
    except serial.SerialException as e:
        print(f"  [X] Could not open {port}: {e}")
        sys.exit(1)

    time.sleep(0.5)
    ser.reset_input_buffer()
    print(f"  [OK] Serial connected\n")

    # Results tracking
    results: list[dict] = []  # {"expected", "got", "outcome"}

    try:
        for motion in motions:
            print(f"\n  {'#' * 55}")
            print(f"  #  TESTING: {motion.upper():<38} #")
            print(f"  #  {rounds} rounds{' ' * 43}#")
            print(f"  {'#' * 55}")

            for r in range(1, rounds + 1):
                print(f"\n  --- Round {r}/{rounds}: {motion} ---")
                input("  Press ENTER when ready...")

                outcome = run_one_round(ser, motion, templates_db)

                got = motion if outcome == "correct" else (
                    outcome.split(":")[1] if outcome.startswith("wrong:") else "rejected"
                )
                results.append({
                    "expected": motion,
                    "got": got,
                    "outcome": outcome,
                })

    except KeyboardInterrupt:
        print("\n\n  Session interrupted (Ctrl+C)")
    finally:
        ser.close()

    # -- Print summary -------------------------------------
    if not results:
        print("\n  No tests completed.")
        return

    print(f"\n\n  {'=' * 60}")
    print(f"  ACCURACY SUMMARY")
    print(f"  {'=' * 60}")

    total = len(results)
    correct = sum(1 for r in results if r["outcome"] == "correct")
    rejected = sum(1 for r in results if r["outcome"] == "rejected")
    wrong = total - correct - rejected

    print(f"\n  Total tests : {total}")
    print(f"  Correct     : {correct} ({correct / total:.0%})")
    print(f"  Wrong       : {wrong} ({wrong / total:.0%})")
    print(f"  Rejected    : {rejected} ({rejected / total:.0%})")

    # Per-motion breakdown
    print(f"\n  {'Motion':<18} {'Correct':>8} {'Wrong':>8} {'Rejected':>8} {'Accuracy':>9}")
    print(f"  {'-' * 53}")

    tested_motions = sorted(set(r["expected"] for r in results))
    for m in tested_motions:
        m_results = [r for r in results if r["expected"] == m]
        m_correct = sum(1 for r in m_results if r["outcome"] == "correct")
        m_wrong = sum(1 for r in m_results if r["outcome"].startswith("wrong"))
        m_rejected = sum(1 for r in m_results if r["outcome"] == "rejected")
        m_total = len(m_results)
        acc = m_correct / m_total if m_total > 0 else 0
        print(f"  {m:<18} {m_correct:>8} {m_wrong:>8} {m_rejected:>8} {acc:>8.0%}")

    # Confusion details (which motions got confused)
    wrong_results = [r for r in results if r["outcome"].startswith("wrong")]
    if wrong_results:
        print(f"\n  Confusion details:")
        for r in wrong_results:
            print(f"    Expected '{r['expected']}' -> got '{r['got']}'")

    print(f"\n  {'=' * 60}")


if __name__ == "__main__":
    main()
