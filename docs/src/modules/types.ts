/**
 * Shared type definitions for the Motion Game
 */

/** Raw magnetometer reading from Arduino */
export interface MagReading {
  x: number;
  y: number;
  z: number;
  x2?: number;
  y2?: number;
}

/** Smoothed & offset-corrected sensor data */
export interface SensorData {
  x: number;
  y: number;
  z: number;
  magnitude: number;
  timestamp: number;
}

/** Motion profile loaded from motion_profiles.json */
export interface MotionProfile {
  motion: string;
  x_range: number;
  x_max: number;
  x_min: number;
  x_std: number;
  y_range: number;
  y_max: number;
  y_min: number;
  y_std: number;
  z_range: number;
  z_max: number;
  z_min: number;
  z_std: number;
  magnitude_mean: number;
  magnitude_max: number;
  magnitude_std: number;
  dominant_freq_hz: number;
  most_active_axis: 'x' | 'y' | 'z';
  axes_all_active: boolean;
  spike_count: number;
  is_periodic_spikes: boolean;
  detection_threshold_uT: number;
  min_active_samples: number;
}

/** Full profiles JSON structure */
export interface MotionProfilesData {
  baseline_offsets: { x: number; y: number; z: number };
  sample_rate_hz: number;
  motions: Record<string, MotionProfile>;
}

/** Game motion types the player can perform */
export type MotionType =
  | 'coffee_grinder'
  | 'grinding'
  | 'pour'
  | 'press_down'
  | 'scoop'
  | 'sieve'
  | 'squeeze'
  | 'stir'
  | 'tea_bag'
  | 'whisk'
  // Legacy motions (single recording)
  | 'circle'
  | 'left_right'
  | 'up_down'
  | 'w_motion';

/** A single step in a game level */
export interface LevelStep {
  motion: MotionType;
  label: string;
  duration: number; // seconds allowed
  description: string;
}

/** Game level definition */
export interface GameLevel {
  id: number;
  name: string;
  description: string;
  steps: LevelStep[];
  passingScore: number; // 0-100
}

/** Current game state */
export type GameScreen =
  | 'menu'
  | 'connecting'
  | 'tutorial'
  | 'playing'
  | 'level-complete'
  | 'game-over'
  | 'creative';

/** Event emitter callback */
export type EventCallback = (...args: any[]) => void;
