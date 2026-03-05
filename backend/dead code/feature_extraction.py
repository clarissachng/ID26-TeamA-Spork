"""
Motion Feature Extraction + Per-Recording Baseline Calibration
================================================================
Reads all motion CSVs (supports multiple recordings per motion),
subtracts per-recording baselines from the first ~1 s of each file,
then extracts detection thresholds averaged across recordings.

Output:
  - Printed summary per motion
  - motion_profiles.json  → use this in your game for real-time detection
  - feature_comparison.png → visual comparison of all motions
"""

import glob
import json
import os
from collections import Counter

import matplotlib
matplotlib.use("Agg")          # non-interactive backend (no plt.show() needed)
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import signal

DATA_DIR = "../data/web"
OUTPUT_DIR = "../plots"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Motion → file mapping ────────────────────────────────
# Each motion maps to a list of glob patterns that match its CSV files.
# Files are searched relative to DATA_DIR.
MOTION_FILES: dict[str, list[str]] = {
    "baseline":        ["baseline_no_action.csv"],
    # New multi-recording motions (3+ recordings each)
    "coffee_grinder":  ["coffee grinder *.csv"],
    "pour":            ["pour *.csv"],
    "press_down":      ["press down *.csv"],
    "scoop":           ["scoop *.csv"],
    "sieve":           ["sieve *.csv"],
    "squeeze":         ["squeeze *.csv"],
    "stir":            ["stir *.csv"],
    "tea_bag":         ["tea bag *.csv"],
    "whisk":           ["whisk *.csv", "whisk.csv"],
    # Legacy single-recording motions (kept for backwards compat)
    "circle":          ["circle_motion.csv"],
    "left_right":      ["left_right_motion.csv"],
    "up_down":         ["up_down_tea.csv"],
    "w_motion":        ["w_motion.csv"],
}

# How many samples at the start of each recording to use as that
# recording's resting baseline (25 Hz → 25 samples ≈ 1 second)
PER_RECORDING_BASELINE_SAMPLES = 25


# ── Helpers ───────────────────────────────────────────────

def resolve_files(patterns: list[str]) -> list[str]:
    """Expand glob patterns relative to DATA_DIR, return sorted unique paths."""
    paths: set[str] = set()
    for pat in patterns:
        for p in glob.glob(os.path.join(DATA_DIR, pat)):
            paths.add(os.path.normpath(p))
    return sorted(paths)


def load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["seconds"] = (df["timestamp"] - df["timestamp"].iloc[0]) / 1000.0
    return df


def subtract_per_recording_baseline(df: pd.DataFrame) -> pd.DataFrame:
    """
    Use the first N samples of this recording as its own resting reference.
    This handles the fact that each recording session may have a completely
    different magnetic environment.
    """
    n = min(PER_RECORDING_BASELINE_SAMPLES, len(df) // 4)  # at most 25% of data
    n = max(n, 1)
    df = df.copy()
    for ax in ["x_uT", "y_uT", "z_uT"]:
        offset = df[ax].iloc[:n].mean()
        df[ax] = df[ax] - offset
    return df


def extract_features(df: pd.DataFrame, name: str) -> dict:
    """
    Extract detection-relevant features from a calibrated motion dataframe.
    Returns a dict of thresholds and characteristics.
    """
    axes = ["x_uT", "y_uT", "z_uT"]
    features: dict = {"motion": name}

    # Amplitude per axis
    for ax in axes:
        label = ax.replace("_uT", "")
        features[f"{label}_range"] = round(float(df[ax].max() - df[ax].min()), 2)
        features[f"{label}_max"]   = round(float(df[ax].max()), 2)
        features[f"{label}_min"]   = round(float(df[ax].min()), 2)
        features[f"{label}_std"]   = round(float(df[ax].std()), 2)

    # Total magnitude signal
    df = df.copy()
    df["magnitude"] = np.sqrt(df["x_uT"]**2 + df["y_uT"]**2 + df["z_uT"]**2)
    features["magnitude_mean"] = round(float(df["magnitude"].mean()), 2)
    features["magnitude_max"]  = round(float(df["magnitude"].max()), 2)
    features["magnitude_std"]  = round(float(df["magnitude"].std()), 2)

    # Dominant frequency via FFT (use magnitude signal)
    n = len(df)
    crop = df["magnitude"].values[n // 8: 7 * n // 8]
    if len(crop) > 10:
        fft_vals = np.abs(np.fft.rfft(crop - crop.mean()))
        freqs = np.fft.rfftfreq(len(crop), d=0.04)  # 25 Hz → d=0.04 s
        dominant_idx = np.argmax(fft_vals[1:]) + 1
        features["dominant_freq_hz"] = round(float(freqs[dominant_idx]), 2)
    else:
        features["dominant_freq_hz"] = 0.0

    # Which axis is most active?
    axis_activity = {
        ax.replace("_uT", ""): features[f"{ax.replace('_uT', '')}_std"]
        for ax in axes
    }
    features["most_active_axis"] = max(axis_activity, key=axis_activity.get)

    # Are all axes active? (circular / 3D motion)
    stds = [features[f"{ax.replace('_uT', '')}_std"] for ax in axes]
    features["axes_all_active"] = bool(min(stds) > 15)

    # Spike detection
    mag_signal = df["magnitude"].values
    threshold = mag_signal.mean() + 1.5 * mag_signal.std()
    peaks, _ = signal.find_peaks(mag_signal, height=threshold, distance=10)
    features["spike_count"] = int(len(peaks))
    features["is_periodic_spikes"] = bool(len(peaks) >= 2)

    # Detection threshold: mean + 1.5×std with a floor of 30 µT
    features["detection_threshold_uT"] = round(float(
        max(30.0, df["magnitude"].mean() + 1.5 * df["magnitude"].std())
    ), 2)
    features["min_active_samples"] = 5  # ~0.2 s at 25 Hz

    return features


def merge_features(feature_list: list[dict]) -> dict:
    """
    Average numeric features across multiple recordings of the same motion.
    For string/bool fields, take the most common value.
    """
    if len(feature_list) == 1:
        return feature_list[0]

    merged: dict = {"motion": feature_list[0]["motion"]}

    # Numeric keys to average
    numeric_keys = [k for k in feature_list[0]
                    if k != "motion" and isinstance(feature_list[0][k], (int, float))]
    for key in numeric_keys:
        vals = [f[key] for f in feature_list]
        merged[key] = round(float(np.mean(vals)), 2)

    # String keys: majority vote
    for key in ["most_active_axis"]:
        vals = [f.get(key) for f in feature_list if key in f]
        merged[key] = Counter(vals).most_common(1)[0][0] if vals else "x"

    # Bool keys: majority vote
    for key in ["axes_all_active", "is_periodic_spikes"]:
        vals = [f.get(key) for f in feature_list if key in f]
        merged[key] = bool(sum(vals) > len(vals) / 2) if vals else False

    # min_active_samples should be int
    if "min_active_samples" in merged:
        merged["min_active_samples"] = int(round(merged["min_active_samples"]))

    return merged


# ══════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════

print("═" * 60)
print("  Motion Feature Extraction (multi-recording support)")
print("═" * 60)

# ── 1. Compute a global baseline from the dedicated baseline file ──
baseline_files = resolve_files(MOTION_FILES["baseline"])
if baseline_files:
    bl_df = load_csv(baseline_files[0])
    baseline_offsets = {
        "x": float(bl_df["x_uT"].mean()),
        "y": float(bl_df["y_uT"].mean()),
        "z": float(bl_df["z_uT"].mean()),
    }
    print(f"\n  Global baseline (from {os.path.basename(baseline_files[0])}):")
    print(f"    X={baseline_offsets['x']:.2f}  Y={baseline_offsets['y']:.2f}  "
          f"Z={baseline_offsets['z']:.2f} µT")
else:
    baseline_offsets = {"x": 0, "y": 0, "z": 0}
    print("\n  ⚠ No baseline file found — using zero offsets")

# ── 2. Process each motion (load, per-recording calibrate, extract, merge) ──
print("\n  Extracting features per motion...\n")

all_features: dict = {}
calibrated_dfs: dict[str, pd.DataFrame] = {}  # for plotting (use first recording)

for motion_name, patterns in MOTION_FILES.items():
    if motion_name == "baseline":
        continue

    files = resolve_files(patterns)
    if not files:
        print(f"  ⚠ {motion_name}: no files found — skipping")
        continue

    per_recording_features: list[dict] = []
    first_df = None

    for fpath in files:
        df = load_csv(fpath)
        df = subtract_per_recording_baseline(df)
        feats = extract_features(df, motion_name)
        per_recording_features.append(feats)

        if first_df is None:
            first_df = df

    merged = merge_features(per_recording_features)
    all_features[motion_name] = merged
    calibrated_dfs[motion_name] = first_df

    print(f"  {motion_name.upper():<16} ({len(files)} recording{'s' if len(files)>1 else ''})")
    print(f"    Most active axis : {merged['most_active_axis']}")
    print(f"    X range: {merged['x_range']:>7.1f} µT   std: {merged['x_std']:.1f}")
    print(f"    Y range: {merged['y_range']:>7.1f} µT   std: {merged['y_std']:.1f}")
    print(f"    Z range: {merged['z_range']:>7.1f} µT   std: {merged['z_std']:.1f}")
    print(f"    Mag mean/std : {merged['magnitude_mean']:.1f} / {merged['magnitude_std']:.1f} µT")
    print(f"    Frequency    : {merged['dominant_freq_hz']:.2f} Hz")
    print(f"    Threshold    : {merged['detection_threshold_uT']:.1f} µT")
    print()

# ── 3. Save motion_profiles.json ─────────────────────────
profile_path = os.path.join(OUTPUT_DIR, "motion_profiles.json")
with open(profile_path, "w") as f:
    json.dump({
        "baseline_offsets": baseline_offsets,
        "sample_rate_hz": 25,
        "motions": all_features,
    }, f, indent=2)
print(f"  ✓ Saved motion_profiles.json → {profile_path}")

# Also copy to webapp
webapp_path = os.path.normpath(
    os.path.join(OUTPUT_DIR, "..", "webapp", "public", "motion_profiles.json")
)
try:
    with open(webapp_path, "w") as f:
        json.dump({
            "baseline_offsets": baseline_offsets,
            "sample_rate_hz": 25,
            "motions": all_features,
        }, f, indent=2)
    print(f"  ✓ Copied to {webapp_path}")
except Exception:
    pass

# ── 4. Comparison plot ────────────────────────────────────
motions_to_plot = [m for m in all_features if m != "baseline"]
n_plots = len(motions_to_plot)

fig, axes_grid = plt.subplots(
    n_plots, 1,
    figsize=(14, 3 * n_plots),
    sharex=False,
)
if n_plots == 1:
    axes_grid = [axes_grid]

fig.suptitle("Calibrated Motion Signatures (per-recording baseline subtracted)",
             fontsize=14, y=1.01)

for ax_plot, motion_name in zip(axes_grid, motions_to_plot):
    df = calibrated_dfs[motion_name]
    mag = np.sqrt(df["x_uT"]**2 + df["y_uT"]**2 + df["z_uT"]**2)

    ax_plot.plot(df["seconds"], df["x_uT"], alpha=0.6, color="#ff6384",
                 label="X", linewidth=0.8)
    ax_plot.plot(df["seconds"], df["y_uT"], alpha=0.6, color="#36a2eb",
                 label="Y", linewidth=0.8)
    ax_plot.plot(df["seconds"], df["z_uT"], alpha=0.6, color="#4caf50",
                 label="Z", linewidth=0.8)
    ax_plot.plot(df["seconds"], mag, alpha=0.9, color="black",
                 label="|mag|", linewidth=1.2, linestyle="--")

    thresh = all_features[motion_name]["detection_threshold_uT"]
    ax_plot.axhline(thresh, color="red", linestyle=":", linewidth=1,
                    label=f"threshold ({thresh:.0f}µT)")
    ax_plot.axhline(0, color="gray", linestyle="-", linewidth=0.5, alpha=0.4)

    ax_plot.set_title(motion_name.replace("_", " ").title(), fontsize=10, loc="left")
    ax_plot.set_ylabel("µT")
    ax_plot.legend(loc="upper right", fontsize=7, ncol=5)
    ax_plot.grid(True, alpha=0.2)

axes_grid[-1].set_xlabel("Time (seconds)")
plt.tight_layout()

plot_path = os.path.join(OUTPUT_DIR, "feature_comparison.png")
plt.savefig(plot_path, dpi=150, bbox_inches="tight")
print(f"  ✓ Saved feature_comparison.png → {plot_path}")

# ── 5. Game-ready summary ────────────────────────────────
print("\n" + "═" * 60)
print("  GAME-READY DETECTION SUMMARY")
print("═" * 60)
for name, f in all_features.items():
    if name == "baseline":
        continue
    print(f"  {name.upper():<16} → mag > {f['detection_threshold_uT']:>6.0f} µT  |  "
          f"freq ≈ {f['dominant_freq_hz']:.1f} Hz  |  "
          f"axis: {f['most_active_axis']}  |  "
          f"std: {f['magnitude_std']:.0f}")
print()
