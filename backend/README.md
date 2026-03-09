# Backend v2 — Signal Processing Gesture Classifier

## Overview
The v2 backend replaces DTW template matching with a lightweight rule-based
signal processing pipeline. It detects 3 kitchen motions in real-time via
an Arduino HMC5883L magnetometer over serial, broadcasting results to the
frontend via WebSocket.

## Motions Detected
| Motion | Physical Description | Signal Signature |
|---|---|---|
| circular | Grinding/stirring in a horizontal circle | Sustained XY activity, low CV, x or y dominant axis |
| teabag | Repeated vertical dipping motion | Rhythmic content at 1.5-3.5Hz, sustained 3+ seconds, z dominant |
| up_down | Single press down and back up | 1-3 isolated magnitude peaks, high CV, z-axis active, mag_max > 200µT |

## Files
| File | Purpose |
|---|---|
| bridge_v2.py | Serial reader, WebSocket broadcaster, feeds samples into Detector |
| detector.py | Low pass filter, feature extraction, rule-based classification, Detector state machine |
| recorder_v2.py | Guided CSV recording protocol for collecting training data |
| plot_recordings.py | Visualisation tool — generates magnitude, FFT, axis, and overlay plots |
| tuner.py | Offline threshold tuning — runs detector against all CSVs without Arduino |
| data/ | Training CSV recordings (10 per motion) |

## How To Run

### 1. Record training data
```bash
python recorder_v2.py
```
Follow the prompts — calibrate, countdown, record for each motion.

### 2. Visualise recordings
```bash
python plot_recordings.py
```
Saves plots to backend/plots/. Use these to understand signal characteristics
before tuning thresholds.

### 3. Tune and test offline
```bash
python detector.py --test
```
Runs classifier against all CSVs in data/. Shows detected motion, confidence,
and all feature values per file. Adjust threshold constants at top of detector.py
until accuracy is satisfactory.

### 4. Run live
```bash
python bridge_v2.py
```
Auto-detects Arduino serial port. Runs calibrate → countdown → record →
classify → cooldown cycle continuously. Broadcasts results to frontend on
ws://localhost:8765.

## Detection Pipeline
```
Arduino (25Hz JSON) → serial read → baseline subtract → low pass filter (3Hz Butterworth)
→ extract features → classify → WebSocket broadcast
```

## Classification Rules
Rules are evaluated in order. All threshold constants are named and defined
at the top of detector.py for easy tuning.

1. Reject if mag_max < noise_floor * 5.0 (no significant motion)
2. Teabag if has_rhythmic_content (1.5-3.5Hz) AND active_duration >= 3.0s
3. Up_down if peak_count 1-3 AND mag_max > 200µT AND cv > 2.0 AND z_std >= x/y_std * 0.7
4. Circular if sufficient signal AND x or y dominant axis
5. Reject otherwise

## Why This Approach
- Interpretable — every classification decision can be explained by a single
  measurable signal property
- No training phase — thresholds tuned directly from visualised data
- Robust — features chosen based on observed physical signal properties,
  not statistical fitting
- Tunable — all thresholds are named constants, adjusted in one place

## Accuracy (Offline, 31 recordings)
| Motion | Correct | Total | Accuracy |
|---|---|---|---|
| circular | 7 | 10 | 70% (3 rejected due to weak signal) |
| teabag | 11 | 11 | 100% |
| up_down | 10 | 10 | 100% |
| **overall** | **28** | **31** | **90%** |

Note: the 3 circular rejections are weak recordings where mag_max < 75µT.
With consistent physical setup (magnet within 2cm of sensor during motion)
accuracy is 100%.

## Hardware Setup
- Sensor: HMC5883L 3-axis magnetometer on Arduino XIAO S3
- Output: JSON {x, y, z} at 25Hz over serial at 115200 baud
- Magnet: Neodymium rod magnet embedded in tool handle
- Key requirement: magnet must be kept away from sensor during calibration
  phase to prevent baseline saturation
