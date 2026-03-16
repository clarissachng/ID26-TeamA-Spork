/**
 * Motion detection engine.
 * Buffers incoming sensor data and classifies it against loaded motion profiles.
 * Emits 'motion-detected' when a known gesture is recognized.
 */
import { bus } from './eventBus';
import type { SensorData, MotionProfilesData, MotionType, MotionProfile } from './types';

const BUFFER_SIZE = 50; // ~2 seconds at 25Hz
const GAME_MOTIONS: MotionType[] = [
  // Primary motions (multi-recording profiles)
  'coffee_grinder', 'pour', 'press_down', 'scoop', 'sieve',
  'squeeze', 'stir', 'tea_bag', 'whisk',
  // Legacy motions
  'circle', 'left_right', 'up_down', 'w_motion',
];

class MotionDetector {
  private profiles: MotionProfilesData | null = null;
  private buffer: SensorData[] = [];
  private consecutiveAbove: Map<string, number> = new Map();
  private lastDetectionTime = 0;
  private cooldownMs = 800; // prevent rapid re-detection

  /** Load motion profiles from JSON */
  async loadProfiles(): Promise<void> {
    const res = await fetch('/motion_profiles.json');
    this.profiles = await res.json();
    console.log('Motion profiles loaded', this.profiles);
  }

  /** Get the loaded profiles */
  getProfiles(): MotionProfilesData | null {
    return this.profiles;
  }

  /** Get profile for a specific motion */
  getMotionProfile(motion: MotionType): MotionProfile | undefined {
    return this.profiles?.motions[motion];
  }

  /** Initialize — listen for sensor data */
  init(): void {
    bus.on('sensor-data', (data: SensorData) => this.onSensorData(data));
  }

  /** Process incoming sensor reading */
  private onSensorData(data: SensorData): void {
    this.buffer.push(data);
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.shift();
    }

    if (!this.profiles) return;

    // Check each motion type
    for (const motionName of GAME_MOTIONS) {
      const profile = this.profiles.motions[motionName];
      if (!profile) continue;

      const count = this.consecutiveAbove.get(motionName) ?? 0;

      if (data.magnitude >= profile.detection_threshold_uT) {
        // Use full threshold (matches bridge.py detection logic)
        this.consecutiveAbove.set(motionName, count + 1);
      } else {
        this.consecutiveAbove.set(motionName, Math.max(0, count - 1));
      }
    }

    // Find the best match — motion with highest consecutive count above threshold
    this.classifyCurrent();
  }

  /** Classify the current motion based on buffered data */
  private classifyCurrent(): void {
    const now = Date.now();
    if (now - this.lastDetectionTime < this.cooldownMs) return;

    let bestMotion: string | null = null;
    let bestScore = 0;

    for (const motionName of GAME_MOTIONS) {
      const profile = this.profiles?.motions[motionName];
      if (!profile) continue;

      const count = this.consecutiveAbove.get(motionName) ?? 0;
      if (count >= profile.min_active_samples) {
        // Score based on how well the axis activity pattern matches
        const score = this.computeMatchScore(motionName, profile);
        if (score > bestScore) {
          bestScore = score;
          bestMotion = motionName;
        }
      }
    }

    if (bestMotion && bestScore > 0.3) {
      this.lastDetectionTime = now;
      // Reset consecutive count for the detected motion
      this.consecutiveAbove.set(bestMotion, 0);
      bus.emit('motion-detected', bestMotion as MotionType, bestScore);
    }
  }

  /** Compute how well current buffer matches a specific motion profile */
  private computeMatchScore(_motionName: string, profile: MotionProfile): number {
    if (this.buffer.length < 10) return 0;

    const recent = this.buffer.slice(-20);

    // Compute statistics on the recent window
    const xs = recent.map((d) => d.x);
    const ys = recent.map((d) => d.y);
    const zs = recent.map((d) => d.z);

    const xStd = std(xs);
    const yStd = std(ys);
    const zStd = std(zs);

    // Check which axis is most active
    const axisMap: Record<string, number> = { x: xStd, y: yStd, z: zStd };
    const mostActive = Object.entries(axisMap).sort((a, b) => b[1] - a[1])[0][0];

    let score = 0;

    // Axis match bonus
    if (mostActive === profile.most_active_axis) {
      score += 0.4;
    }

    // All-axes-active match
    const allActive = Math.min(xStd, yStd, zStd) > 15;
    if (allActive === profile.axes_all_active) {
      score += 0.2;
    }

    // Magnitude range match
    const mags = recent.map((d) => d.magnitude);
    const magMean = mean(mags);
    const magStd = std(mags);

    // How close is our magnitude pattern to the profile?
    const magRatio = magMean / (profile.magnitude_mean || 1);
    if (magRatio > 0.3 && magRatio < 3.0) {
      score += 0.2;
    }

    // Periodicity match (rough)
    if (profile.is_periodic_spikes && magStd > 30) {
      score += 0.2;
    } else if (!profile.is_periodic_spikes && magStd < 80) {
      score += 0.1;
    }

    // Suppress false positives: ignore if basically baseline
    if (magMean < 20 && magStd < 10) {
      return 0;
    }

    return score;
  }

  /** Check if a specific expected motion is currently being performed */
  checkForMotion(expected: MotionType): { detected: boolean; confidence: number } {
    const profile = this.profiles?.motions[expected];
    if (!profile || this.buffer.length < 5) {
      return { detected: false, confidence: 0 };
    }

    const recent = this.buffer.slice(-15);
    const mags = recent.map((d) => d.magnitude);
    const avgMag = mean(mags);

    // Softer threshold for targeted detection
    const threshold = profile.detection_threshold_uT * 0.4;
    const confidence = Math.min(1, avgMag / profile.detection_threshold_uT);

    return {
      detected: avgMag >= threshold && confidence > 0.25,
      confidence,
    };
  }

  /** Get current magnitude for UI display */
  getCurrentMagnitude(): number {
    if (this.buffer.length === 0) return 0;
    return this.buffer[this.buffer.length - 1].magnitude;
  }

  /** Get the last few readings for visualization */
  getRecentBuffer(): SensorData[] {
    return [...this.buffer];
  }
}

// Helpers
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length);
}

export const detector = new MotionDetector();
