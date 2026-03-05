#!/usr/bin/env python3
"""
Analyse & Plot Motion Recordings
==================================
Loads all CSVs from data/web/, subtracts per-recording baseline,
and generates plots to visually inspect patterns across motions.

Usage:
    python analyse_data.py                  # analyse data/web/, plot to plots/
    python analyse_data.py --source serial  # analyse data/serial/, plot to plots/serial/

Output:
    ../plots/ or ../plots/serial/  (PNG files)
"""

import argparse
import glob
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

SAMPLE_RATE = 25
BASELINE_SAMPLES = 50  # first 2s

# These are set in main() based on --source flag
DATA_DIR = ""
PLOT_DIR = ""

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

COLORS = {
    "coffee_grinder": "#e6194b",
    "pour":           "#3cb44b",
    "press_down":     "#4363d8",
    "scoop":          "#f58231",
    "sieve":          "#911eb4",
    "squeeze":        "#42d4f4",
    "stir":           "#f032e6",
    "tea_bag":        "#bfef45",
    "whisk":          "#fabebe",
}


def load_and_calibrate(path):
    """Load CSV, subtract baseline from first N samples."""
    df = pd.read_csv(path)
    n = min(BASELINE_SAMPLES, len(df) // 4)
    n = max(n, 1)
    for col in ["x_uT", "y_uT", "z_uT"]:
        offset = df[col].iloc[:n].mean()
        df[col] = df[col] - offset
    df["mag"] = np.sqrt(df["x_uT"]**2 + df["y_uT"]**2 + df["z_uT"]**2)
    df["time_s"] = (df["timestamp"] - df["timestamp"].iloc[0]) / 1000.0
    return df


def load_all():
    """Load all recordings grouped by motion."""
    data = {}
    for name, pattern in sorted(MOTIONS.items()):
        files = sorted(glob.glob(os.path.join(DATA_DIR, pattern)))
        if files:
            data[name] = [load_and_calibrate(f) for f in files]
            print(f"  {name}: {len(files)} recordings")
    return data


def plot_all_motions_magnitude(data):
    """Plot 1: Magnitude over time for each motion (subplots grid)."""
    motions = sorted(data.keys())
    n = len(motions)
    cols = 3
    rows = (n + cols - 1) // cols

    fig, axes = plt.subplots(rows, cols, figsize=(18, 4 * rows), squeeze=False)
    fig.suptitle("Magnitude Over Time (baseline-subtracted)", fontsize=16, y=1.01)

    for idx, motion in enumerate(motions):
        ax = axes[idx // cols][idx % cols]
        for i, df in enumerate(data[motion]):
            ax.plot(df["time_s"], df["mag"], alpha=0.7, label=f"rec {i+1}")
        ax.set_title(motion, fontsize=13, fontweight="bold")
        ax.set_xlabel("Time (s)")
        ax.set_ylabel("|mag| (uT)")
        ax.set_ylim(bottom=0)
        ax.legend(fontsize=7, loc="upper right")
        ax.grid(True, alpha=0.3)

    # Hide empty subplots
    for idx in range(n, rows * cols):
        axes[idx // cols][idx % cols].set_visible(False)

    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "01_magnitude_timeseries.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> {path}")


def plot_all_motions_xyz(data):
    """Plot 2: X, Y, Z axes for each motion (one recording per motion)."""
    motions = sorted(data.keys())
    n = len(motions)
    cols = 3
    rows = (n + cols - 1) // cols

    fig, axes = plt.subplots(rows, cols, figsize=(18, 4 * rows), squeeze=False)
    fig.suptitle("X / Y / Z Axes (1st recording, baseline-subtracted)", fontsize=16, y=1.01)

    for idx, motion in enumerate(motions):
        ax = axes[idx // cols][idx % cols]
        df = data[motion][0]  # first recording
        ax.plot(df["time_s"], df["x_uT"], label="X", alpha=0.8)
        ax.plot(df["time_s"], df["y_uT"], label="Y", alpha=0.8)
        ax.plot(df["time_s"], df["z_uT"], label="Z", alpha=0.8)
        ax.set_title(motion, fontsize=13, fontweight="bold")
        ax.set_xlabel("Time (s)")
        ax.set_ylabel("uT")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.3)

    for idx in range(n, rows * cols):
        axes[idx // cols][idx % cols].set_visible(False)

    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "02_xyz_timeseries.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> {path}")


def plot_overlay_magnitude(data):
    """Plot 3: All motions overlaid on one chart (first recording each, resampled)."""
    fig, ax = plt.subplots(figsize=(14, 6))
    ax.set_title("All Motions Overlaid (Magnitude, resampled to 50 pts)", fontsize=14)

    for motion in sorted(data.keys()):
        df = data[motion][0]
        mag = df["mag"].values
        # Resample to 50 points
        x_old = np.linspace(0, 1, len(mag))
        x_new = np.linspace(0, 1, 50)
        mag_r = np.interp(x_new, x_old, mag)
        ax.plot(x_new, mag_r, label=motion, color=COLORS.get(motion, "gray"),
                linewidth=2, alpha=0.8)

    ax.set_xlabel("Normalized time")
    ax.set_ylabel("|mag| (uT)")
    ax.legend(fontsize=9, loc="upper right")
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "03_overlay_magnitude.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> {path}")


def plot_axis_std_comparison(data):
    """Plot 4: Per-axis std deviation bar chart for each motion."""
    motions = sorted(data.keys())
    x_stds, y_stds, z_stds = [], [], []

    for motion in motions:
        all_x_std, all_y_std, all_z_std = [], [], []
        for df in data[motion]:
            # Use motion portion only (after baseline)
            m = df.iloc[BASELINE_SAMPLES:]
            all_x_std.append(m["x_uT"].std())
            all_y_std.append(m["y_uT"].std())
            all_z_std.append(m["z_uT"].std())
        x_stds.append(np.mean(all_x_std))
        y_stds.append(np.mean(all_y_std))
        z_stds.append(np.mean(all_z_std))

    x_pos = np.arange(len(motions))
    width = 0.25

    fig, ax = plt.subplots(figsize=(14, 6))
    ax.bar(x_pos - width, x_stds, width, label="X std", color="#ff6384")
    ax.bar(x_pos, y_stds, width, label="Y std", color="#36a2eb")
    ax.bar(x_pos + width, z_stds, width, label="Z std", color="#4caf50")

    ax.set_xticks(x_pos)
    ax.set_xticklabels(motions, rotation=30, ha="right")
    ax.set_ylabel("Std Deviation (uT)")
    ax.set_title("Per-Axis Activity (Std Dev) by Motion", fontsize=14)
    ax.legend()
    ax.grid(True, alpha=0.3, axis="y")
    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "04_axis_std_comparison.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> {path}")


def plot_fft_comparison(data):
    """Plot 5: FFT of magnitude signal for each motion."""
    motions = sorted(data.keys())
    n = len(motions)
    cols = 3
    rows = (n + cols - 1) // cols

    fig, axes = plt.subplots(rows, cols, figsize=(18, 4 * rows), squeeze=False)
    fig.suptitle("FFT of Magnitude Signal (motion portion)", fontsize=16, y=1.01)

    for idx, motion in enumerate(motions):
        ax = axes[idx // cols][idx % cols]
        for i, df in enumerate(data[motion]):
            m = df.iloc[BASELINE_SAMPLES:]
            mag = m["mag"].values
            if len(mag) < 10:
                continue
            centered = mag - mag.mean()
            fft_vals = np.abs(np.fft.rfft(centered))
            freqs = np.fft.rfftfreq(len(centered), d=1.0 / SAMPLE_RATE)
            # Skip DC
            ax.plot(freqs[1:], fft_vals[1:], alpha=0.6, label=f"rec {i+1}")

        ax.set_title(motion, fontsize=13, fontweight="bold")
        ax.set_xlabel("Frequency (Hz)")
        ax.set_ylabel("Amplitude")
        ax.set_xlim(0, SAMPLE_RATE / 2)
        ax.legend(fontsize=7)
        ax.grid(True, alpha=0.3)

    for idx in range(n, rows * cols):
        axes[idx // cols][idx % cols].set_visible(False)

    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "05_fft_comparison.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> {path}")


def plot_recording_consistency(data):
    """Plot 6: Overlay all recordings per motion (resampled magnitude) to show consistency."""
    motions = sorted(data.keys())
    n = len(motions)
    cols = 3
    rows = (n + cols - 1) // cols

    fig, axes = plt.subplots(rows, cols, figsize=(18, 4 * rows), squeeze=False)
    fig.suptitle("Recording Consistency (all recordings overlaid, resampled)", fontsize=16, y=1.01)

    for idx, motion in enumerate(motions):
        ax = axes[idx // cols][idx % cols]
        all_resampled = []
        for i, df in enumerate(data[motion]):
            mag = df["mag"].values
            x_old = np.linspace(0, 1, len(mag))
            x_new = np.linspace(0, 1, 50)
            mag_r = np.interp(x_new, x_old, mag)
            all_resampled.append(mag_r)
            ax.plot(x_new, mag_r, alpha=0.4, color=COLORS.get(motion, "gray"))

        # Plot mean as bold line
        if all_resampled:
            mean_r = np.mean(all_resampled, axis=0)
            ax.plot(x_new, mean_r, linewidth=3, color="white",
                    label="mean", zorder=10)
            ax.plot(x_new, mean_r, linewidth=2, color=COLORS.get(motion, "gray"),
                    label="mean", zorder=11)

        ax.set_title(f"{motion} ({len(data[motion])} recs)", fontsize=13, fontweight="bold")
        ax.set_xlabel("Normalized time")
        ax.set_ylabel("|mag| (uT)")
        ax.set_ylim(bottom=0)
        ax.grid(True, alpha=0.3)

    for idx in range(n, rows * cols):
        axes[idx // cols][idx % cols].set_visible(False)

    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "06_recording_consistency.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> {path}")


def print_summary_stats(data):
    """Print a table of key features per motion."""
    print("\n" + "=" * 90)
    print(f"  {'Motion':<16} {'MagMean':>8} {'MagStd':>8} {'MagMax':>8} "
          f"{'Xstd':>8} {'Ystd':>8} {'Zstd':>8} {'DomFreq':>8}")
    print("-" * 90)

    for motion in sorted(data.keys()):
        mag_means, mag_stds, mag_maxs = [], [], []
        x_stds, y_stds, z_stds = [], [], []
        dom_freqs = []

        for df in data[motion]:
            m = df.iloc[BASELINE_SAMPLES:]
            mag_means.append(m["mag"].mean())
            mag_stds.append(m["mag"].std())
            mag_maxs.append(m["mag"].max())
            x_stds.append(m["x_uT"].std())
            y_stds.append(m["y_uT"].std())
            z_stds.append(m["z_uT"].std())

            mag = m["mag"].values
            if len(mag) > 10:
                centered = mag - mag.mean()
                fft_vals = np.abs(np.fft.rfft(centered))
                freqs = np.fft.rfftfreq(len(centered), d=1.0 / SAMPLE_RATE)
                if len(fft_vals) > 2:
                    dom_idx = np.argmax(fft_vals[1:]) + 1
                    dom_freqs.append(freqs[dom_idx])

        print(f"  {motion:<16} {np.mean(mag_means):>8.1f} {np.mean(mag_stds):>8.1f} "
              f"{np.mean(mag_maxs):>8.1f} {np.mean(x_stds):>8.1f} {np.mean(y_stds):>8.1f} "
              f"{np.mean(z_stds):>8.1f} {np.mean(dom_freqs):>7.2f}Hz")

    print("=" * 90)


def main():
    parser = argparse.ArgumentParser(description="Analyse & plot motion recordings")
    parser.add_argument("--source", "-s", choices=["web", "serial"], default="web",
                        help="Data source: web (default) or serial")
    args = parser.parse_args()

    global DATA_DIR, PLOT_DIR
    base = os.path.dirname(__file__)
    if args.source == "serial":
        DATA_DIR = os.path.join(base, "..", "data", "serial")
        PLOT_DIR = os.path.join(base, "..", "plots", "serial")
    else:
        DATA_DIR = os.path.join(base, "..", "data", "web")
        PLOT_DIR = os.path.join(base, "..", "plots")
    os.makedirs(PLOT_DIR, exist_ok=True)

    print("=" * 60)
    print(f"  Analysing Motion Data ({args.source})")
    print(f"  Source: {os.path.abspath(DATA_DIR)}")
    print("=" * 60)

    data = load_all()
    if not data:
        print("No data found!")
        sys.exit(1)

    print(f"\nGenerating plots...")
    plot_all_motions_magnitude(data)
    plot_all_motions_xyz(data)
    plot_overlay_magnitude(data)
    plot_axis_std_comparison(data)
    plot_fft_comparison(data)
    plot_recording_consistency(data)

    print_summary_stats(data)

    print(f"\nAll plots saved to {os.path.abspath(PLOT_DIR)}/")


if __name__ == "__main__":
    main()
