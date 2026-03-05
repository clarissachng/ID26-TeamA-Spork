#!/usr/bin/env python3
"""
Build DTW Templates from Recorded CSVs
========================================
Loads all motion recordings from data/web/, preprocesses them
(baseline subtraction, motion extraction, resampling, z-normalization),
and saves them as dtw_templates.json for use by bridge.py.

Usage:
    python build_templates.py               # uses data/web/ (default)
    python build_templates.py --source serial  # uses data/serial/
    python build_templates.py --source both    # merges both directories

Output:
    ../data/dtw_templates.json
"""

import argparse
import glob
import json
import os
import sys

import numpy as np
import pandas as pd

# -- Configuration -----------------------------------------
DATA_DIR_WEB = os.path.join(os.path.dirname(__file__), "..", "data", "web")
DATA_DIR_SERIAL = os.path.join(os.path.dirname(__file__), "..", "data", "serial")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "dtw_templates.json")

SAMPLE_RATE = 25          # Hz
BASELINE_SAMPLES = 50     # first 2s = baseline (hold still phase)
RESAMPLE_LENGTH = 50      # all templates resampled to this many points

# The 9 motions and their file patterns
MOTIONS = {
    "coffee_grinder": "coffee_grinder *.csv",
    "pour":           "pour *.csv",
    "press_down":     "press_down *.csv",
    "scoop":          "scoop *.csv",
    "sieve":          "sieve *.csv",
    "squeeze":        "squeeze *.csv",
    "stir":           "stir *.csv",
    "tea_bag":        "tea_bag *.csv",
    "whisk":          "whisk *.csv",
}


def load_csv(path: str) -> pd.DataFrame:
    """Load a recording CSV."""
    df = pd.read_csv(path)
    return df


def subtract_baseline(df: pd.DataFrame, n_baseline: int = BASELINE_SAMPLES) -> pd.DataFrame:
    """Subtract the mean of the first n_baseline samples (resting phase) from each axis."""
    n = min(n_baseline, len(df) // 4)
    n = max(n, 1)
    df = df.copy()
    for col in ["x_uT", "y_uT", "z_uT"]:
        offset = df[col].iloc[:n].mean()
        df[col] = df[col] - offset
    return df


def extract_motion_portion(df: pd.DataFrame, n_baseline: int = BASELINE_SAMPLES) -> pd.DataFrame:
    """
    Extract just the motion portion: skip the baseline period and trailing tail.
    Uses magnitude threshold to find where motion actually happens.
    """
    df = df.copy()
    df["mag"] = np.sqrt(df["x_uT"]**2 + df["y_uT"]**2 + df["z_uT"]**2)

    # Find noise floor from baseline region
    baseline_mags = df["mag"].iloc[:n_baseline]
    noise_threshold = baseline_mags.mean() + 2.0 * baseline_mags.std()
    noise_threshold = max(noise_threshold, 5.0)  # minimum threshold

    # Find first and last sample above noise (with some padding)
    above_noise = df["mag"] > noise_threshold
    active_indices = above_noise[above_noise].index.tolist()

    if len(active_indices) < 5:
        # Very little motion detected — use everything after baseline
        start = n_baseline
        end = len(df)
    else:
        start = max(0, active_indices[0] - 2)   # 2 samples padding before
        end = min(len(df), active_indices[-1] + 3)  # 2 samples padding after

    motion_df = df.iloc[start:end].reset_index(drop=True)

    # Ensure we have at least some samples
    if len(motion_df) < 5:
        return df.iloc[n_baseline:].reset_index(drop=True)

    return motion_df


def resample_signal(signal: np.ndarray, target_len: int) -> np.ndarray:
    """Resample a 1D signal to target_len points using linear interpolation."""
    if len(signal) == target_len:
        return signal
    x_old = np.linspace(0, 1, len(signal))
    x_new = np.linspace(0, 1, target_len)
    return np.interp(x_new, x_old, signal)


def z_normalize(signal: np.ndarray) -> np.ndarray:
    """Zero mean, unit variance normalization."""
    std = signal.std()
    if std < 1e-6:
        return signal - signal.mean()
    return (signal - signal.mean()) / std


def process_recording(path: str) -> dict | None:
    """
    Process a single CSV recording into a DTW template.
    Returns dict with x, y, z, mag arrays (each length RESAMPLE_LENGTH) or None.
    """
    try:
        df = load_csv(path)
    except Exception as e:
        print(f"  ⚠ Failed to load {path}: {e}")
        return None

    if len(df) < 20:
        print(f"  ⚠ Too few samples in {path}: {len(df)}")
        return None

    # Step 1: Subtract baseline
    df = subtract_baseline(df)

    # Step 2: Extract motion portion
    motion = extract_motion_portion(df)

    # Step 3: Get raw axis signals
    x = motion["x_uT"].values
    y = motion["y_uT"].values
    z = motion["z_uT"].values
    mag = np.sqrt(x**2 + y**2 + z**2)

    # Step 4: Resample to fixed length
    x_r = resample_signal(x, RESAMPLE_LENGTH)
    y_r = resample_signal(y, RESAMPLE_LENGTH)
    z_r = resample_signal(z, RESAMPLE_LENGTH)
    mag_r = resample_signal(mag, RESAMPLE_LENGTH)

    # Step 5: Compute feature metadata BEFORE normalization
    mag_raw = np.sqrt(x**2 + y**2 + z**2)
    mag_mean = float(mag_raw.mean())
    mag_std = float(mag_raw.std())
    x_var = float(x.var())
    y_var = float(y.var())
    z_var = float(z.var())

    # Axis weights: proportion of total variance per axis
    total_var = x_var + y_var + z_var + 1e-6
    w_x = x_var / total_var
    w_y = y_var / total_var
    w_z = z_var / total_var

    # Dominant frequency from magnitude FFT
    dom_freq = 0.0
    if len(mag_raw) > 10:
        centered = mag_raw - mag_raw.mean()
        fft_vals = np.abs(np.fft.rfft(centered))
        freqs = np.fft.rfftfreq(len(centered), d=1.0 / SAMPLE_RATE)
        if len(fft_vals) > 2:
            dom_idx = int(np.argmax(fft_vals[1:])) + 1
            dom_freq = float(freqs[dom_idx])

    # Zero crossings (oscillation proxy)
    centered_mag = mag_raw - mag_raw.mean()
    zero_crossings = int(np.sum(np.diff(np.sign(centered_mag)) != 0))

    # Step 6: Z-normalize each axis independently
    x_n = z_normalize(x_r)
    y_n = z_normalize(y_r)
    z_n = z_normalize(z_r)
    mag_n = z_normalize(mag_r)

    return {
        "x": x_n.tolist(),
        "y": y_n.tolist(),
        "z": z_n.tolist(),
        "mag": mag_n.tolist(),
        "original_samples": len(motion),
        "source_file": os.path.basename(path),
        # Feature metadata for gating
        "mag_mean": round(mag_mean, 2),
        "mag_std": round(mag_std, 2),
        "dom_freq": round(dom_freq, 3),
        "zero_crossings": zero_crossings,
        "axis_weights": [round(w_x, 4), round(w_y, 4), round(w_z, 4)],
    }


def main():
    parser = argparse.ArgumentParser(description="Build DTW templates from recorded CSVs")
    parser.add_argument(
        "--source", "-s",
        choices=["web", "serial", "both"],
        default="web",
        help="Data source directory: web (default), serial, or both",
    )
    args = parser.parse_args()

    # Determine which directories to scan
    data_dirs = []
    if args.source in ("web", "both"):
        data_dirs.append(("web", DATA_DIR_WEB))
    if args.source in ("serial", "both"):
        data_dirs.append(("serial", DATA_DIR_SERIAL))

    print("=" * 60)
    print("  Building DTW Templates")
    print(f"  Source: {args.source}")
    print("=" * 60)

    templates = {}
    total = 0

    for source_label, data_dir in data_dirs:
        print(f"\n  --- Scanning {source_label}: {data_dir} ---")

        for motion_name, pattern in sorted(MOTIONS.items()):
            full_pattern = os.path.join(data_dir, pattern)
            files = sorted(glob.glob(full_pattern))

            if not files:
                continue

            print(f"\n  {motion_name}: {len(files)} recordings ({source_label})")
            if motion_name not in templates:
                templates[motion_name] = []

            for f in files:
                template = process_recording(f)
                if template:
                    templates[motion_name].append(template)
                    total += 1
                    print(f"    [OK] {template['source_file']} "
                          f"({template['original_samples']} -> {RESAMPLE_LENGTH} pts)")

    # Save
    output = {
        "resample_length": RESAMPLE_LENGTH,
        "sample_rate": SAMPLE_RATE,
        "motions": list(templates.keys()),
        "templates": templates,
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"  Saved {total} templates across {len(templates)} motions")
    print(f"  → {OUTPUT_PATH}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
