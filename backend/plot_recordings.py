#!/usr/bin/env python3
"""
Plot Recordings — Visualise recorded motion data for threshold tuning.
======================================================================
Loads CSVs from backend/data/, preprocesses (baseline subtraction,
low-pass filter), and generates 4 diagnostic figures.

Usage:
    python plot_recordings.py

Output:
    backend/plots/raw_axes.png
    backend/plots/magnitude.png
    backend/plots/fft.png
    backend/plots/overlay_all.png
"""

import glob
import os
import re
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.signal import butter, filtfilt

# -- Configuration -----------------------------------------
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
PLOT_DIR = os.path.join(os.path.dirname(__file__), "plots")
SAMPLE_RATE = 25
BASELINE_SAMPLES = 50
LOW_PASS_CUTOFF_HZ = 3.0
MOTION_COLORS = {
    "circular": "#e6194b",
    "up_down":  "#3cb44b",
    "whisk":    "#4363d8",
    "press_down": "#ffe119",
}


# -- Preprocessing -----------------------------------------
def low_pass_filter(data: np.ndarray, cutoff_hz: float = LOW_PASS_CUTOFF_HZ,
                    sample_rate: float = SAMPLE_RATE) -> np.ndarray:
    nyq = sample_rate / 2.0
    norm_cutoff = cutoff_hz / nyq
    b, a = butter(2, norm_cutoff, btype="low")
    return filtfilt(b, a, data)


def load_and_preprocess(path: str) -> dict | None:
    """Load a CSV, subtract baseline, filter, compute magnitude."""
    try:
        df = pd.read_csv(path)
    except Exception:
        return None
    if len(df) < 20:
        return None

    n_bl = min(BASELINE_SAMPLES, len(df) // 4)
    n_bl = max(n_bl, 1)

    x = df["x_uT"].values.copy()
    y = df["y_uT"].values.copy()
    z = df["z_uT"].values.copy()

    # Baseline subtraction
    x -= x[:n_bl].mean()
    y -= y[:n_bl].mean()
    z -= z[:n_bl].mean()

    # Motion portion only (after baseline)
    x_m = x[n_bl:]
    y_m = y[n_bl:]
    z_m = z[n_bl:]

    if len(x_m) < 10:
        return None

    # Low-pass filter
    x_f = low_pass_filter(x_m)
    y_f = low_pass_filter(y_m)
    z_f = low_pass_filter(z_m)

    mag = np.sqrt(x_f ** 2 + y_f ** 2 + z_f ** 2)
    time_s = np.arange(len(x_f)) / SAMPLE_RATE

    return {"x": x_f, "y": y_f, "z": z_f, "mag": mag, "time_s": time_s}


def group_recordings() -> dict[str, list[dict]]:
    """Scan backend/data/ for CSVs, group by motion name."""
    csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    groups: dict[str, list[dict]] = {}

    for path in csv_files:
        filename = os.path.basename(path)
        # Support new naming: Tool_Motion_Index.csv
        match = re.match(r"^([\w\s]+)_([\w]+)_\d+\.csv$", filename)
        if match:
            tool = match.group(1)
            motion = match.group(2)
        else:
            # Fallback: old naming convention
            match_old = re.match(r"^(.+?)\s+\d+\.csv$", filename)
            if match_old:
                motion = match_old.group(1)
            else:
                continue
        rec = load_and_preprocess(path)
        if rec:
            rec["filename"] = filename
            groups.setdefault(motion, []).append(rec)

    return groups


# -- Plotting helpers --------------------------------------
def resample_to_common(arrays: list[np.ndarray], n_points: int = 200) -> list[np.ndarray]:
    """Resample all arrays to the same length for averaging."""
    resampled = []
    for arr in arrays:
        x_old = np.linspace(0, 1, len(arr))
        x_new = np.linspace(0, 1, n_points)
        resampled.append(np.interp(x_new, x_old, arr))
    return resampled


# -- Figure 1: Raw axes -----------------------------------
def plot_raw_axes(groups: dict[str, list[dict]]) -> str:
    motions = sorted(groups.keys())
    n_motions = len(motions)
    axes_names = ["x", "y", "z"]

    fig, axs = plt.subplots(n_motions, 3, figsize=(18, 4 * n_motions), squeeze=False)
    fig.suptitle("Filtered Axis Signals (all recordings overlaid)", fontsize=16, y=1.01)

    for row, motion in enumerate(motions):
        recs = groups[motion]
        color = MOTION_COLORS.get(motion, "gray")

        for col, axis in enumerate(axes_names):
            ax = axs[row][col]
            all_resampled = resample_to_common([r[axis] for r in recs])
            common_time = np.linspace(0, len(recs[0][axis]) / SAMPLE_RATE, 200)

            for i, rs in enumerate(all_resampled):
                ax.plot(common_time, rs, alpha=0.3, color=color, linewidth=1)

            mean_signal = np.mean(all_resampled, axis=0)
            ax.plot(common_time, mean_signal, color=color, linewidth=2.5, label="mean")

            ax.set_title(f"{motion} — {axis}", fontsize=12, fontweight="bold")
            ax.set_xlabel("Time (s)")
            ax.set_ylabel("µT")
            ax.grid(True, alpha=0.3)
            ax.legend(fontsize=8)

    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "raw_axes.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    return path


# -- Figure 2: Magnitude ----------------------------------
def plot_magnitude(groups: dict[str, list[dict]]) -> str:
    motions = sorted(groups.keys())
    n_motions = len(motions)

    fig, axs = plt.subplots(n_motions, 1, figsize=(14, 4 * n_motions), squeeze=False)
    fig.suptitle("Magnitude (all recordings overlaid)", fontsize=16, y=1.01)

    for row, motion in enumerate(motions):
        recs = groups[motion]
        color = MOTION_COLORS.get(motion, "gray")
        ax = axs[row][0]

        all_resampled = resample_to_common([r["mag"] for r in recs])
        common_time = np.linspace(0, len(recs[0]["mag"]) / SAMPLE_RATE, 200)

        all_mag_means = []
        for i, rs in enumerate(all_resampled):
            ax.plot(common_time, rs, alpha=0.3, color=color, linewidth=1)
            all_mag_means.append(rs.mean())

        mean_signal = np.mean(all_resampled, axis=0)
        ax.plot(common_time, mean_signal, color=color, linewidth=2.5, label="mean")

        overall_mean = np.mean(all_mag_means)
        ax.axhline(overall_mean, color="black", linestyle="--", linewidth=1.5,
                    alpha=0.7, label=f"overall mean = {overall_mean:.1f}")

        ax.set_title(f"{motion} — magnitude", fontsize=12, fontweight="bold")
        ax.set_xlabel("Time (s)")
        ax.set_ylabel("|mag| (µT)")
        ax.set_ylim(bottom=0)
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=9)

    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "magnitude.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    return path


# -- Figure 3: FFT ----------------------------------------
def plot_fft(groups: dict[str, list[dict]]) -> str:
    motions = sorted(groups.keys())
    n_motions = len(motions)
    max_freq = 6.0

    fig, axs = plt.subplots(n_motions, 1, figsize=(14, 4 * n_motions), squeeze=False)
    fig.suptitle("Frequency Spectrum of Magnitude (0–6 Hz)", fontsize=16, y=1.01)

    for row, motion in enumerate(motions):
        recs = groups[motion]
        color = MOTION_COLORS.get(motion, "gray")
        ax = axs[row][0]

        all_fft_amplitudes = []

        for rec in recs:
            mag = rec["mag"]
            centered = mag - mag.mean()
            n = len(centered)
            fft_vals = np.abs(np.fft.rfft(centered))
            freqs = np.fft.rfftfreq(n, d=1.0 / SAMPLE_RATE)

            # Limit to max_freq
            mask = freqs <= max_freq
            f_plot = freqs[mask]
            a_plot = fft_vals[mask]

            ax.plot(f_plot, a_plot, alpha=0.3, color=color, linewidth=1)

            # Resample FFT to common length for averaging
            common_f = np.linspace(0, max_freq, 200)
            a_interp = np.interp(common_f, f_plot, a_plot)
            all_fft_amplitudes.append(a_interp)

        if all_fft_amplitudes:
            common_f = np.linspace(0, max_freq, 200)
            mean_fft = np.mean(all_fft_amplitudes, axis=0)
            ax.plot(common_f, mean_fft, color=color, linewidth=2.5, label="mean")

        ax.set_title(f"{motion} — frequency spectrum", fontsize=12, fontweight="bold")
        ax.set_xlabel("Frequency (Hz)")
        ax.set_ylabel("Amplitude")
        ax.set_xlim(0, max_freq)
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=9)

    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "fft.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    return path


# -- Figure 4: Overlay all motions -------------------------
def plot_overlay(groups: dict[str, list[dict]]) -> str:
    fig, ax = plt.subplots(figsize=(14, 6))
    ax.set_title("Mean Magnitude — All Motions Overlaid", fontsize=14)

    common_time = np.linspace(0, 1, 200)  # normalised time

    for motion in sorted(groups.keys()):
        recs = groups[motion]
        color = MOTION_COLORS.get(motion, "gray")
        all_resampled = resample_to_common([r["mag"] for r in recs])
        mean_signal = np.mean(all_resampled, axis=0)
        ax.plot(common_time, mean_signal, color=color, linewidth=2.5, label=motion)

    ax.set_xlabel("Normalised time")
    ax.set_ylabel("|mag| (µT)")
    ax.set_ylim(bottom=0)
    ax.legend(fontsize=11)
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(PLOT_DIR, "overlay_all.png")
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    return path


# -- Summary table -----------------------------------------
def print_summary(groups: dict[str, list[dict]]):
    print(f"\n  {'Motion':<12} {'MagMean':>8} {'MagStd':>8} {'DomFreq':>9} {'ZC_mag':>7}")
    print("  " + "-" * 48)

    for motion in sorted(groups.keys()):
        mag_means, mag_stds, dom_freqs, zc_mags = [], [], [], []

        for rec in groups[motion]:
            mag = rec["mag"]
            mag_means.append(mag.mean())
            mag_stds.append(mag.std())

            # Dominant frequency
            centered = mag - mag.mean()
            fft_vals = np.abs(np.fft.rfft(centered))
            freqs = np.fft.rfftfreq(len(centered), d=1.0 / SAMPLE_RATE)
            if len(fft_vals) > 2:
                dom_idx = int(np.argmax(fft_vals[1:])) + 1
                dom_freqs.append(freqs[dom_idx])

            # Zero crossings
            centered_mag = mag - mag.mean()
            zc = int(np.sum(np.diff(np.sign(centered_mag)) != 0))
            zc_mags.append(zc)

        print(f"  {motion:<12} {np.mean(mag_means):>8.1f} {np.mean(mag_stds):>8.1f} "
              f"{np.mean(dom_freqs):>8.2f}Hz {np.mean(zc_mags):>6.1f}")

    print()


# -- Main --------------------------------------------------
def main():
    os.makedirs(PLOT_DIR, exist_ok=True)

    print(f"  Scanning {DATA_DIR} for CSVs...")
    groups = group_recordings()

    if not groups:
        print(f"  No CSV recordings found in {DATA_DIR}")
        sys.exit(1)

    for motion, recs in sorted(groups.items()):
        print(f"  {motion}: {len(recs)} recordings")

    print(f"\n  Generating plots...")

    paths = []
    paths.append(plot_raw_axes(groups))
    paths.append(plot_magnitude(groups))
    paths.append(plot_fft(groups))
    paths.append(plot_overlay(groups))

    print(f"\n  Saved plots:")
    for p in paths:
        print(f"    -> {p}")

    print_summary(groups)


if __name__ == "__main__":
    main()
