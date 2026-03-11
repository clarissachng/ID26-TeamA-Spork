# Archive — DTW-Based Backend (v1)

## Overview
This folder contains the original gesture recognition backend, replaced in favour
of a simpler signal-processing approach. It is preserved for documentation and
reporting purposes.

## What This Was
The v1 backend used Dynamic Time Warping (DTW) with k-Nearest Neighbours (k=3)
voting to classify gestures against pre-built motion templates. It supported 8
kitchen motions: coffee grinder, pour, press down, scoop, sieve, stir, tea bag,
and whisk.

### Pipeline
1. Raw CSV recordings collected via recorder.py (serial) or web dashboard
2. build_templates.py preprocessed recordings into DTW templates:
   - Baseline subtraction (mean of first 50 samples)
   - Motion extraction via magnitude thresholding
   - Resampling to 50 points (time-invariance)
   - Z-normalisation (amplitude-invariance)
3. bridge.py ran real-time detection via GuidedDetector class
4. Classification used Sakoe-Chiba band-constrained DTW across 4 channels
   (x, y, z, magnitude), averaged equally
5. Results broadcast over WebSocket to frontend

## Why It Was Replaced
- HMC5883L magnetometer produced noisy signals that DTW struggled to match
  reliably against clean templates
- 8-motion classification was overly complex for the project's research goals
- DTW is opaque — difficult to explain why a gesture was accepted or rejected
- Real-time performance was inconsistent due to template quality variance
- Supervisor feedback: strip back to simple signal properties instead

## Key Methodological Limitations
- Z-normalisation discarded absolute intensity (useful discriminating information)
- Equal axis weighting ignored that some axes carry more information per motion
- Fixed 50-point resampling lost temporal resolution for longer gestures
- Hard rejection threshold of 12.0 was empirically chosen with no principled basis
- Single recording per template meant DTW was sensitive to outlier recordings

## Files
| File | Purpose |
|---|---|
| bridge.py | Serial reader, GuidedDetector state machine, WebSocket broadcaster |
| build_templates.py | Built dtw_templates.json from training CSVs |
| motion_tester.py | Accuracy test harness (prompted serial testing) |
| analyse_data.py | Diagnostic plots and feature analysis |
| recorder.py | Guided CSV recording protocol |
| dtw_templates.json | Pre-built motion templates (now obsolete) |

## What Replaced It
See /backend/ — low pass filter + signal feature detection across 3 motions
(circular, teabag, up_down) using duration, rhythm, peak count and axis activity.
