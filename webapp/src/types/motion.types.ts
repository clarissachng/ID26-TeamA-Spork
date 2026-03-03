/**
 * Shared type definitions for the Spork Motion Brewing Game.
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
  | 'coffee_grinder'
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
  | 'w_motion'
  | 'pour';

export const ALL_MOTIONS: MotionType[] = [
  'coffee_grinder', 'pour', 'press_down', 'scoop', 'sieve',
  'squeeze', 'stir', 'tea_bag', 'whisk',
  'circle', 'left_right', 'up_down', 'w_motion',
];

/** Human-friendly labels for each motion */
export const MOTION_META: Record<MotionType, { label: string; emoji: string; description: string; prop: string }> = {
  coffee_grinder: { label: 'Grind',      emoji: '⚙️',  description: 'Rotate the grinder handle in circles',    prop: 'Coffee Grinder' },
  pour:           { label: 'Pour',       emoji: '🫗',  description: 'Tilt and pour steadily',                  prop: 'Kettle' },
  press_down:     { label: 'Press Down', emoji: '⬇️',  description: 'Press the tool firmly downward',          prop: 'French Press' },
  scoop:          { label: 'Scoop',      emoji: '🥄', description: 'Scoop upward in a smooth arc',            prop: 'Sieve' },
  sieve:          { label: 'Sieve',      emoji: '🪣',  description: 'Shake side to side to sieve',             prop: 'Sieve' },
  squeeze:        { label: 'Squeeze',    emoji: '✊', description: 'Squeeze the tool firmly',                 prop: 'Tea Bag' },
  stir:           { label: 'Stir',       emoji: '🥄', description: 'Stir in quick circular motions',          prop: 'Stirring Spoon' },
  tea_bag:        { label: 'Tea Bag',    emoji: '🍵', description: 'Dip the tea bag up and down',             prop: 'Tea Bag' },
  whisk:          { label: 'Whisk',      emoji: '🥚', description: 'Whisk rapidly back and forth',            prop: 'Whisk' },
  circle:         { label: 'Circle',     emoji: '🔄', description: 'Move in a circular stirring motion',      prop: 'Matcha Whisk' },
  left_right:     { label: 'Left-Right', emoji: '↔️',  description: 'Sway the tool side to side',              prop: 'Stirring Spoon' },
  up_down:        { label: 'Up-Down',    emoji: '↕️',  description: 'Dip the tool up and down rhythmically',   prop: 'Kettle' },
  w_motion:       { label: 'W-Motion',   emoji: '〰️', description: 'Trace a W shape with the tool',           prop: 'Pour-Over Kettle' },
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
      { motion: 'tea_bag',    label: 'Dip the tea bag',     duration: 8, description: 'Dip up and down gently' },
      { motion: 'stir',       label: 'Stir it up',          duration: 8, description: 'Stir in a quick circle' },
    ],
  },
  {
    id: 2,
    name: 'Barista Basics',
    description: 'A 5-step recipe — things are heating up.',
    passingScore: 60,
    steps: [
      { motion: 'coffee_grinder', label: 'Grind the beans',   duration: 7, description: 'Grind coffee beans' },
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
      { motion: 'coffee_grinder', label: 'Grind beans',      duration: 5, description: 'Grind fresh beans' },
      { motion: 'sieve',          label: 'Sieve the grounds', duration: 5, description: 'Sieve out coarse bits' },
      { motion: 'scoop',          label: 'Scoop into filter', duration: 5, description: 'Precise scoop' },
      { motion: 'pour',           label: 'Pour over',         duration: 5, description: 'Steady pour' },
      { motion: 'whisk',          label: 'Whisk the milk',    duration: 5, description: 'Froth the milk' },
      { motion: 'squeeze',        label: 'Squeeze the bag',   duration: 5, description: 'Squeeze out the last drops' },
      { motion: 'stir',           label: 'Final stir',        duration: 4, description: 'Quick finishing stir' },
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
