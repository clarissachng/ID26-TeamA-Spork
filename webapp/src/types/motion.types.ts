/**
 * Shared type definitions for the Motion Brewing Game.
 */

/* ── Sensor Types ──────────────────────────────────────── */

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

/* ── Motion Profiles ───────────────────────────────────── */

/** Single motion profile from motion_profiles.json */
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

/* ── Game Motion Types ─────────────────────────────────── */

export type MotionType =
  | 'pour'
  | 'press_down'
  | 'scoop'
  | 'squeeze'
  | 'stir'
  | 'whisk'
  // Legacy motions (single recording)
  | 'grinding'
  | 'left_right'
  | 'up_down';

export const ALL_MOTIONS: MotionType[] = [
  'pour', 'press_down', 'scoop',
  'squeeze', 'stir','whisk',
  'grinding', 'left_right', 'up_down',
];

/** Human-friendly labels for each motion */
export const MOTION_META: Record<MotionType, { label: string; asset: string; description: string; prop: string }> = {
  pour:           { label: 'Pour',           asset: '🫖', description: 'Pour to get some water/milk to your drink',          prop: 'Pour' },
  press_down:     { label: 'Press Down',     asset: '⬇️',  description: 'Press the tool firmly downward',                    prop: 'French Press' },
  scoop:          { label: 'Scoop',          asset: '🥄', description: 'Scoop upward in a smooth arc',                      prop: 'Spoon' },
  squeeze:        { label: 'Squeeze',        asset: '🧊', description: 'Squeeze to get some ice cubes',                     prop: 'Tongs' },
  stir:           { label: 'Stir',           asset: '🥄', description: 'Stir in a circular motion',                         prop: 'Spoon' },
  whisk:          { label: 'Whisk',          asset: '🧋', description: 'Whisk to get a smooth texture',                     prop: 'Whisk' },
  grinding:       { label: 'Grinding',       asset: '🔄', description: 'Move in a circular motion to grind the coffee beans', prop: 'Coffee Grinder' },
  left_right:     { label: 'Left-Right',     asset: '↔️',  description: 'Sway the tool side to side',                        prop: 'Sieve' },
  up_down:        { label: 'Up-Down',        asset: '🍵',  description: 'Dip the tool up and down rhythmically',             prop: 'Teabag' },
};

/* ── Level Definitions ─────────────────────────────────── */

export interface LevelStep {
  motion: MotionType;
  label: string;
  duration: number; // seconds allowed
  description: string;
}

export interface GameLevel {
  id: number;
  name: string;
  description: string;
  steps: LevelStep[];
  passingScore: number; // 0–100
}

/** Pre-built levels for Play mode */
export const LEVELS: GameLevel[] = [
  {
    id: 1,
    name: 'Tea Time',
    description: 'A simple recipe — make a cup of tea.',
    passingScore: 50,
    steps: [
      { motion: 'scoop',      label: 'Scoop tea leaves',   duration: 8, description: 'Scoop the leaves into the cup' },
      { motion: 'pour',       label: 'Pour hot water',      duration: 8, description: 'Pour water over the leaves' },
      { motion: 'stir',       label: 'Stir it up',          duration: 8, description: 'Stir in a quick circle' },
    ],
  },
  {
    id: 2,
    name: 'Barista Basics',
    description: 'A 5-step recipe — things are heating up.',
    passingScore: 60,
    steps: [
      { motion: 'grinding', label: 'Grind the beans',   duration: 7, description: 'Grind coffee beans' },
      { motion: 'scoop',           label: 'Scoop grounds',     duration: 7, description: 'Scoop into the filter' },
      { motion: 'pour',            label: 'Pour water',        duration: 6, description: 'Pour hot water over grounds' },
      { motion: 'stir',            label: 'Stir gently',       duration: 6, description: 'Stir to bloom' },
      { motion: 'press_down',      label: 'Press the plunger', duration: 6, description: 'Push down steadily' },
    ],
  },
  {
    id: 3,
    name: 'Master Brew',
    description: 'The full 7-step routine — precision counts!',
    passingScore: 70,
    steps: [
      { motion: 'grinding', label: 'Grind beans',      duration: 5, description: 'Grind fresh beans' },
      { motion: 'scoop',          label: 'Scoop into filter', duration: 5, description: 'Precise scoop' },
      { motion: 'pour',           label: 'Pour over',         duration: 5, description: 'Steady pour' },
      { motion: 'whisk',          label: 'Whisk the milk',    duration: 5, description: 'Froth the milk' },
      { motion: 'squeeze',        label: 'Squeeze the bag',   duration: 5, description: 'Squeeze out the last drops' },
      { motion: 'stir',           label: 'Final stir',        duration: 4, description: 'Quick finishing stir' },
      { motion: 'scoop',          label: 'Scoop into filter', duration: 5, description: 'Precise scoop' },
    ],
  },
];

/* ── WebSocket Messages ────────────────────────────────── */

/** Message from the Python WebSocket backend */
export interface MotionDetectionMessage {
  motion: MotionType;
  detected: boolean;
  confidence: number;
}

/* ── Choreograph Mode ──────────────────────────────────── */

export interface RecordedStep {
  motion: MotionType;
  timestamp: number;    // ms since recording start
  confidence: number;
}

export interface SavedChoreography {
  id: string;
  name: string;
  createdAt: number;
  steps: RecordedStep[];
}

/* ── Page Router ───────────────────────────────────────── */

export type PageId =
  | 'main-menu'
  | 'level-select'
  | 'play'
  | 'tutorial'
  | 'tutorial-detail'
  | 'choreograph';
