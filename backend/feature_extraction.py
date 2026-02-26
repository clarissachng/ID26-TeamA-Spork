"""
Motion Feature Extraction + Baseline Calibration
Reads all motion CSVs, subtracts the baseline (resting) values,
then extracts detection thresholds for each motion type.

Output:
  - Printed summary per motion
  - motion_profiles.json  → use this in your game for real-time detection
  - feature_comparison.png → visual comparison of all motions
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import json
import os
from scipy import signal

DATA_DIR = "../data/web"         
OUTPUT_DIR = "../plots"
os.makedirs(OUTPUT_DIR, exist_ok=True)

MOTION_FILES = {
    "baseline":   "baseline_no_action.csv",
    "circle":     "circle_motion.csv",
    "left_right": "left_right_motion.csv",
    "press_down": "press_down.csv",
    "scoop":      "scoop_motion.csv",
    "squeeze":    "squeeze_motion.csv",
    "up_down":    "up_down_tea.csv",
    "w_motion":   "w_motion.csv",
}

# Helper: load + normalise time

def load_csv(path):
    df = pd.read_csv(path)
    df["seconds"] = (df["timestamp"] - df["timestamp"].iloc[0]) / 1000.0
    return df

# Compute baseline offsets

print("Computing baseline offsets")

baseline_path = os.path.join(DATA_DIR, MOTION_FILES["baseline"])
baseline_df = load_csv(baseline_path)

baseline_offsets = {
    "x": baseline_df["x_uT"].mean(),
    "y": baseline_df["y_uT"].mean(),
    "z": baseline_df["z_uT"].mean(),
}

print(f"  X offset: {baseline_offsets['x']:.2f} µT")
print(f"  Y offset: {baseline_offsets['y']:.2f} µT")
print(f"  Z offset: {baseline_offsets['z']:.2f} µT")
print()

def subtract_baseline(df):
    """Subtract resting offsets so all signals are centred at 0."""
    df = df.copy()
    df["x_uT"] = df["x_uT"] - baseline_offsets["x"]
    df["y_uT"] = df["y_uT"] - baseline_offsets["y"]
    df["z_uT"] = df["z_uT"] - baseline_offsets["z"]
    return df

# Feature extraction per motion

def extract_features(df, name):
    """
    Extract detection-relevant features from a calibrated motion dataframe.
    Returns a dict of thresholds and characteristics.
    """
    axes = ["x_uT", "y_uT", "z_uT"]

    features = {"motion": name}

    # Amplitude per axis 
    for ax in axes:
        label = ax.replace("_uT", "")
        features[f"{label}_range"]  = round(float(df[ax].max() - df[ax].min()), 2)
        features[f"{label}_max"]    = round(float(df[ax].max()), 2)
        features[f"{label}_min"]    = round(float(df[ax].min()), 2)
        features[f"{label}_std"]    = round(float(df[ax].std()), 2)

    # Total magnitude signal
    df["magnitude"] = np.sqrt(df["x_uT"]**2 + df["y_uT"]**2 + df["z_uT"]**2)
    features["magnitude_mean"] = round(float(df["magnitude"].mean()), 2)
    features["magnitude_max"]  = round(float(df["magnitude"].max()), 2)
    features["magnitude_std"]  = round(float(df["magnitude"].std()), 2)

    # Dominant frequency via FFT (use magnitude signal)
    # Use a steady middle portion to avoid start/end noise
    n = len(df)
    crop = df["magnitude"].values[n//8 : 7*n//8]
    if len(crop) > 10:
        fft_vals = np.abs(np.fft.rfft(crop - crop.mean()))
        freqs    = np.fft.rfftfreq(len(crop), d=0.04)  # 25Hz sample rate → d=0.04s
        # Ignore DC (index 0)
        dominant_idx  = np.argmax(fft_vals[1:]) + 1
        features["dominant_freq_hz"] = round(float(freqs[dominant_idx]), 2)
    else:
        features["dominant_freq_hz"] = 0.0

    #  Which axes are most active? 
    axis_activity = {ax.replace("_uT",""): features[f"{ax.replace('_uT','')}_std"]
                     for ax in axes}
    features["most_active_axis"] = max(axis_activity, key=axis_activity.get)

    #  Motion energy: are all axes active (circular) or just one/two? 
    stds = [features[f"{ax.replace('_uT','')}_std"] for ax in axes]
    features["axes_all_active"] = bool(min(stds) > 20)  # True = all axes moving

    #  Spike detection: sharp discrete events vs continuous oscillation 
    mag_signal = df["magnitude"].values
    threshold  = mag_signal.mean() + 1.5 * mag_signal.std()
    peaks, _   = signal.find_peaks(mag_signal, height=threshold, distance=10)
    features["spike_count"]       = int(len(peaks))
    features["is_periodic_spikes"] = bool(len(peaks) >= 2)

    #  Detection thresholds for the game (conservative = easier to trigger) 
    # A motion is "detected" if magnitude exceeds this for N consecutive samples
    features["detection_threshold_uT"] = round(float(
        max(50.0, df["magnitude"].mean() + df["magnitude"].std())
    ), 2)
    features["min_active_samples"] = 5  # ~0.2s at 25Hz before confirming motion

    return features

# Run extraction on all motions 

print("Extracting features per motion")

all_features = {}
calibrated_dfs = {}

for motion_name, filename in MOTION_FILES.items():
    path = os.path.join(DATA_DIR, filename)
    df   = load_csv(path)
    df   = subtract_baseline(df)
    calibrated_dfs[motion_name] = df

    feats = extract_features(df, motion_name)
    all_features[motion_name] = feats

    print(f"\n {motion_name.upper()} ")
    print(f"  Most active axis : {feats['most_active_axis']}")
    print(f"  X range  : {feats['x_range']:>8.1f} µT   std: {feats['x_std']:.1f}")
    print(f"  Y range  : {feats['y_range']:>8.1f} µT   std: {feats['y_std']:.1f}")
    print(f"  Z range  : {feats['z_range']:>8.1f} µT   std: {feats['z_std']:.1f}")
    print(f"  Magnitude mean/std : {feats['magnitude_mean']:.1f} / {feats['magnitude_std']:.1f} µT")
    print(f"  Dominant frequency : {feats['dominant_freq_hz']:.2f} Hz")
    print(f"  All axes active    : {feats['axes_all_active']}")
    print(f"  Spike count        : {feats['spike_count']}")
    print(f"  Detection threshold: {feats['detection_threshold_uT']:.1f} µT")

# Save profiles as JSON for the game 

profile_path = os.path.join(OUTPUT_DIR, "motion_profiles.json")
with open(profile_path, "w") as f:
    json.dump({
        "baseline_offsets": baseline_offsets,
        "sample_rate_hz": 25,
        "motions": all_features
    }, f, indent=2)

print(f"\nSaved motion_profiles.json → {profile_path}")

# Comparison plot

motions_to_plot = [m for m in MOTION_FILES if m != "baseline"]
fig, axes_grid = plt.subplots(
    len(motions_to_plot), 1,
    figsize=(14, 3 * len(motions_to_plot)),
    sharex=False
)
fig.suptitle("Calibrated Motion Signatures (baseline subtracted)", fontsize=14, y=1.01)

for ax_plot, motion_name in zip(axes_grid, motions_to_plot):
    df  = calibrated_dfs[motion_name]
    mag = np.sqrt(df["x_uT"]**2 + df["y_uT"]**2 + df["z_uT"]**2)

    ax_plot.plot(df["seconds"], df["x_uT"], alpha=0.6, color="#ff6384", label="X", linewidth=0.8)
    ax_plot.plot(df["seconds"], df["y_uT"], alpha=0.6, color="#36a2eb", label="Y", linewidth=0.8)
    ax_plot.plot(df["seconds"], df["z_uT"], alpha=0.6, color="#4caf50", label="Z", linewidth=0.8)
    ax_plot.plot(df["seconds"], mag,         alpha=0.9, color="black",   label="|mag|", linewidth=1.2, linestyle="--")

    thresh = all_features[motion_name]["detection_threshold_uT"]
    ax_plot.axhline(thresh,  color="red",  linestyle=":", linewidth=1, label=f"threshold ({thresh:.0f}µT)")
    ax_plot.axhline(0,       color="gray", linestyle="-", linewidth=0.5, alpha=0.4)

    ax_plot.set_title(motion_name.replace("_", " ").title(), fontsize=10, loc="left")
    ax_plot.set_ylabel("µT")
    ax_plot.legend(loc="upper right", fontsize=7, ncol=5)
    ax_plot.grid(True, alpha=0.2)

axes_grid[-1].set_xlabel("Time (seconds)")
plt.tight_layout()

plot_path = os.path.join(OUTPUT_DIR, "feature_comparison.png")
plt.savefig(plot_path, dpi=150, bbox_inches="tight")
plt.show()
print(f"Saved feature_comparison.png → {plot_path}")

#Print game-ready summary 
print("GAME-READY DETECTION SUMMARY")

print("For each motion, trigger detection when:")
print()
for name, f in all_features.items():
    if name == "baseline":
        continue
    print(f"  {name.upper():<12} → magnitude > {f['detection_threshold_uT']:.0f} µT  |  "
          f"freq ≈ {f['dominant_freq_hz']:.1f} Hz  |  "
          f"primary axis: {f['most_active_axis']}")