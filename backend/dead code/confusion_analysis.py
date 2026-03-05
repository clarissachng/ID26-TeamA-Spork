#!/usr/bin/env python3
"""
Confusion Analysis: Compare confusable motions.
Focuses on whisk, stir, tea_bag, sieve to find what differentiates them.
"""

import glob
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "serial")
PLOT_DIR = os.path.join(os.path.dirname(__file__), "..", "plots", "confusion_analysis")
os.makedirs(PLOT_DIR, exist_ok=True)

SAMPLE_RATE = 25
BASELINE_SAMPLES = 50
RESAMPLE_LENGTH = 50

CONFUSABLE = ["whisk", "stir", "tea_bag", "sieve"]
ALL_MOTIONS = [
    "coffee_grinder", "pour", "press_down", "scoop",
    "sieve", "stir", "tea_bag", "whisk",
]

COLORS = {
    "whisk": "#e6194b",
    "stir": "#3cb44b",
    "tea_bag": "#4363d8",
    "sieve": "#f58231",
    "coffee_grinder": "#911eb4",
    "pour": "#42d4f4",
    "press_down": "#f032e6",
    "scoop": "#bfef45",
}


def load_recording(path):
    df = pd.read_csv(path)
    n = min(BASELINE_SAMPLES, len(df) // 4)
    n = max(n, 1)
    for col in ["x_uT", "y_uT", "z_uT"]:
        offset = df[col].iloc[:n].mean()
        df[col] = df[col] - offset
    df["mag"] = np.sqrt(df["x_uT"]**2 + df["y_uT"]**2 + df["z_uT"]**2)
    df["time_s"] = (df["timestamp"] - df["timestamp"].iloc[0]) / 1000.0
    return df


def load_motion(name):
    pattern = os.path.join(DATA_DIR, f"{name} *.csv")
    files = sorted(glob.glob(pattern))
    return [load_recording(f) for f in files]


def extract_motion_portion(df):
    """Extract just the active motion portion."""
    mag = df["mag"].values
    threshold = mag[:BASELINE_SAMPLES].mean() + 2.0 * mag[:BASELINE_SAMPLES].std()
    threshold = max(threshold, 15.0)
    above = mag > threshold
    indices = np.where(above)[0]
    if len(indices) < 5:
        return mag[BASELINE_SAMPLES:]  # fallback: skip baseline
    start = max(0, indices[0] - 2)
    end = min(len(mag), indices[-1] + 3)
    return mag[start:end]


def resample(signal, length):
    x_old = np.linspace(0, 1, len(signal))
    x_new = np.linspace(0, 1, length)
    return np.interp(x_new, x_old, signal)


def z_normalize(signal):
    std = signal.std()
    if std < 1e-6:
        return signal - signal.mean()
    return (signal - signal.mean()) / std


def main():
    print("=" * 60)
    print("  Confusion Analysis: whisk / stir / tea_bag / sieve")
    print("=" * 60)

    # Load all confusable motions
    data = {}
    for name in CONFUSABLE:
        recordings = load_motion(name)
        if recordings:
            data[name] = recordings
            print(f"  {name}: {len(recordings)} recordings")

    if not data:
        print("No data found!")
        sys.exit(1)

    # ================================================================
    # PLOT 1: Raw magnitude time series (all recordings, side by side)
    # ================================================================
    fig, axes = plt.subplots(1, 4, figsize=(24, 5), sharey=True)
    fig.suptitle("Raw Magnitude: whisk vs stir vs tea_bag vs sieve", fontsize=14)

    for idx, name in enumerate(CONFUSABLE):
        ax = axes[idx]
        for i, df in enumerate(data.get(name, [])):
            ax.plot(df["time_s"], df["mag"], alpha=0.5, label=f"rec {i+1}")
        ax.set_title(name, fontsize=13, fontweight="bold", color=COLORS[name])
        ax.set_xlabel("Time (s)")
        if idx == 0:
            ax.set_ylabel("|mag| (uT)")
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=7)

    plt.tight_layout()
    fig.savefig(os.path.join(PLOT_DIR, "01_raw_magnitude.png"), dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"\n  -> 01_raw_magnitude.png")

    # ================================================================
    # PLOT 2: Resampled + normalized magnitude (what DTW actually sees)
    # ================================================================
    fig, axes = plt.subplots(1, 4, figsize=(24, 5), sharey=True)
    fig.suptitle("Normalized Magnitude (what DTW compares) — motion portion only", fontsize=14)

    for idx, name in enumerate(CONFUSABLE):
        ax = axes[idx]
        for i, df in enumerate(data.get(name, [])):
            motion = extract_motion_portion(df)
            resampled = resample(motion, RESAMPLE_LENGTH)
            normalized = z_normalize(resampled)
            ax.plot(np.linspace(0, 1, RESAMPLE_LENGTH), normalized,
                    alpha=0.5, label=f"rec {i+1}")
        ax.set_title(name, fontsize=13, fontweight="bold", color=COLORS[name])
        ax.set_xlabel("Normalized time")
        if idx == 0:
            ax.set_ylabel("Z-normalized magnitude")
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=7)

    plt.tight_layout()
    fig.savefig(os.path.join(PLOT_DIR, "02_normalized_magnitude.png"), dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> 02_normalized_magnitude.png")

    # ================================================================
    # PLOT 3: All 4 motions overlaid (normalized)
    # ================================================================
    fig, ax = plt.subplots(figsize=(14, 6))
    ax.set_title("All Confusable Motions Overlaid (Z-normalized magnitude)", fontsize=14)

    for name in CONFUSABLE:
        all_norm = []
        for df in data.get(name, []):
            motion = extract_motion_portion(df)
            resampled = resample(motion, RESAMPLE_LENGTH)
            normalized = z_normalize(resampled)
            all_norm.append(normalized)
            ax.plot(np.linspace(0, 1, RESAMPLE_LENGTH), normalized,
                    alpha=0.15, color=COLORS[name])

        if all_norm:
            mean_norm = np.mean(all_norm, axis=0)
            ax.plot(np.linspace(0, 1, RESAMPLE_LENGTH), mean_norm,
                    linewidth=3, color=COLORS[name], label=f"{name} (mean)")

    ax.set_xlabel("Normalized time")
    ax.set_ylabel("Z-normalized magnitude")
    ax.legend(fontsize=11)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(PLOT_DIR, "03_overlaid_normalized.png"), dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> 03_overlaid_normalized.png")

    # ================================================================
    # PLOT 4: Per-axis comparison (X, Y, Z separately)
    # ================================================================
    fig, axes = plt.subplots(3, 4, figsize=(24, 12), sharey="row")
    fig.suptitle("Per-Axis Comparison (baseline-subtracted)", fontsize=14, y=1.01)

    axis_labels = ["x_uT", "y_uT", "z_uT"]
    axis_names = ["X axis", "Y axis", "Z axis"]

    for row, (col_name, ax_name) in enumerate(zip(axis_labels, axis_names)):
        for col_idx, name in enumerate(CONFUSABLE):
            ax = axes[row][col_idx]
            for i, df in enumerate(data.get(name, [])):
                ax.plot(df["time_s"], df[col_name], alpha=0.5)
            ax.set_title(f"{name} — {ax_name}", fontsize=11, fontweight="bold")
            ax.grid(True, alpha=0.3)
            if col_idx == 0:
                ax.set_ylabel(f"{ax_name} (uT)")
            if row == 2:
                ax.set_xlabel("Time (s)")

    plt.tight_layout()
    fig.savefig(os.path.join(PLOT_DIR, "04_per_axis_comparison.png"), dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> 04_per_axis_comparison.png")

    # ================================================================
    # PLOT 5: FFT comparison (frequency domain)
    # ================================================================
    fig, axes = plt.subplots(1, 4, figsize=(24, 5), sharey=True)
    fig.suptitle("FFT of Magnitude (motion portion) — Frequency Signatures", fontsize=14)

    for idx, name in enumerate(CONFUSABLE):
        ax = axes[idx]
        for i, df in enumerate(data.get(name, [])):
            motion = extract_motion_portion(df)
            if len(motion) < 10:
                continue
            centered = motion - motion.mean()
            fft_vals = np.abs(np.fft.rfft(centered))
            freqs = np.fft.rfftfreq(len(centered), d=1.0 / SAMPLE_RATE)
            ax.plot(freqs[1:], fft_vals[1:], alpha=0.5, label=f"rec {i+1}")
        ax.set_title(name, fontsize=13, fontweight="bold", color=COLORS[name])
        ax.set_xlabel("Frequency (Hz)")
        if idx == 0:
            ax.set_ylabel("FFT Amplitude")
        ax.set_xlim(0, SAMPLE_RATE / 2)
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=7)

    plt.tight_layout()
    fig.savefig(os.path.join(PLOT_DIR, "05_fft_comparison.png"), dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> 05_fft_comparison.png")

    # ================================================================
    # PLOT 6: Key distinguishing features bar chart
    # ================================================================
    features = {}
    for name in CONFUSABLE:
        mag_means, mag_stds, mag_maxs = [], [], []
        x_stds, y_stds, z_stds = [], [], []
        dom_freqs, peak_counts = [], []

        for df in data.get(name, []):
            motion = extract_motion_portion(df)
            mag_means.append(motion.mean())
            mag_stds.append(motion.std())
            mag_maxs.append(motion.max())

            m = df.iloc[BASELINE_SAMPLES:]
            x_stds.append(m["x_uT"].std())
            y_stds.append(m["y_uT"].std())
            z_stds.append(m["z_uT"].std())

            # Dominant frequency
            if len(motion) > 10:
                centered = motion - motion.mean()
                fft_vals = np.abs(np.fft.rfft(centered))
                freqs = np.fft.rfftfreq(len(centered), d=1.0 / SAMPLE_RATE)
                if len(fft_vals) > 2:
                    dom_idx = np.argmax(fft_vals[1:]) + 1
                    dom_freqs.append(freqs[dom_idx])

            # Zero-crossing count (proxy for oscillation frequency)
            centered_mag = motion - motion.mean()
            crossings = np.sum(np.diff(np.sign(centered_mag)) != 0)
            peak_counts.append(crossings)

        features[name] = {
            "mag_mean": np.mean(mag_means),
            "mag_std": np.mean(mag_stds),
            "mag_max": np.mean(mag_maxs),
            "x_std": np.mean(x_stds),
            "y_std": np.mean(y_stds),
            "z_std": np.mean(z_stds),
            "dom_freq": np.mean(dom_freqs) if dom_freqs else 0,
            "zero_crossings": np.mean(peak_counts),
        }

    fig, axes = plt.subplots(2, 4, figsize=(22, 8))
    fig.suptitle("Distinguishing Features Comparison", fontsize=14)

    feature_names = ["mag_mean", "mag_std", "mag_max", "dom_freq",
                     "x_std", "y_std", "z_std", "zero_crossings"]
    feature_labels = ["Mag Mean", "Mag Std", "Mag Max", "Dom Freq (Hz)",
                      "X Std", "Y Std", "Z Std", "Zero Crossings"]

    for i, (feat, label) in enumerate(zip(feature_names, feature_labels)):
        ax = axes[i // 4][i % 4]
        vals = [features[n][feat] for n in CONFUSABLE]
        bars = ax.bar(CONFUSABLE, vals, color=[COLORS[n] for n in CONFUSABLE])
        ax.set_title(label, fontsize=11)
        ax.grid(True, alpha=0.3, axis="y")
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height(),
                    f"{val:.1f}", ha="center", va="bottom", fontsize=9)

    plt.tight_layout()
    fig.savefig(os.path.join(PLOT_DIR, "06_distinguishing_features.png"), dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> 06_distinguishing_features.png")

    # ================================================================
    # Print summary table
    # ================================================================
    print(f"\n  {'=' * 75}")
    print(f"  {'Motion':<12} {'MagMean':>8} {'MagStd':>8} {'MagMax':>8} "
          f"{'DomFreq':>8} {'Xstd':>8} {'Ystd':>8} {'Zstd':>8} {'ZeroCr':>8}")
    print(f"  {'-' * 75}")
    for name in CONFUSABLE:
        f = features[name]
        print(f"  {name:<12} {f['mag_mean']:>8.1f} {f['mag_std']:>8.1f} {f['mag_max']:>8.1f} "
              f"{f['dom_freq']:>7.2f}Hz {f['x_std']:>8.1f} {f['y_std']:>8.1f} "
              f"{f['z_std']:>8.1f} {f['zero_crossings']:>8.1f}")
    print(f"  {'=' * 75}")

    # ================================================================
    # Analysis: what separates them
    # ================================================================
    print(f"\n  ANALYSIS:")
    print(f"  ---------")

    # Check frequency separation
    freqs = {n: features[n]["dom_freq"] for n in CONFUSABLE}
    sorted_by_freq = sorted(freqs.items(), key=lambda x: x[1], reverse=True)
    print(f"\n  By frequency (high to low):")
    for n, f in sorted_by_freq:
        print(f"    {n:<12} {f:.2f} Hz")

    # Check axis dominance
    print(f"\n  Axis dominance (highest std axis):")
    for name in CONFUSABLE:
        f = features[name]
        axes_vals = {"X": f["x_std"], "Y": f["y_std"], "Z": f["z_std"]}
        dominant = max(axes_vals, key=axes_vals.get)
        ratio = max(axes_vals.values()) / (min(axes_vals.values()) + 0.01)
        print(f"    {name:<12} -> {dominant} axis (ratio {ratio:.1f}x)")

    # Check zero crossings
    print(f"\n  Zero crossings (oscillation count):")
    sorted_by_zc = sorted(features.items(), key=lambda x: x[1]["zero_crossings"], reverse=True)
    for n, f in sorted_by_zc:
        print(f"    {n:<12} {f['zero_crossings']:.0f} crossings")

    print(f"\n  All plots saved to {os.path.abspath(PLOT_DIR)}/")


if __name__ == "__main__":
    main()
