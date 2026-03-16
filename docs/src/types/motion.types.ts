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
  | 'grinding'
  | 'up_down'
  | 'press_down';

export const ALL_MOTIONS: MotionType[] = ['grinding', 'up_down', 'press_down'];

/** Human-friendly labels for each motion */
export const MOTION_META: Record<MotionType, { label: string; asset: string; description: string; prop: string; arrow: string }> = {
  grinding:   { label: 'Grind',     asset: '/assets/front_grinder.PNG', description: 'Rotate in a circular grinding motion', prop: 'Coffee Grinder', arrow: '/assets/motion_arrows/2.png' },
  up_down:    { label: 'Dip',       asset: '/assets/front_tea.PNG',     description: 'Dip the tool up and down rhythmically', prop: 'Teabag',        arrow: '/assets/motion_arrows/3.png' },
  press_down: { label: 'Press',     asset: '/assets/front_press.PNG',   description: 'Press the tool firmly downward',        prop: 'French Press',  arrow: '/assets/motion_arrows/1.png' },
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
      { motion: 'up_down',    label: 'Dip the teabag',     duration: 8, description: 'Dip the teabag up and down' },
      { motion: 'press_down', label: 'Press out the bag',  duration: 8, description: 'Press the teabag firmly' },
      { motion: 'grinding',   label: 'Stir it up',         duration: 8, description: 'Stir in a circular motion' },
    ],
  },
  {
    id: 2,
    name: 'Barista Basics',
    description: 'A 5-step recipe — things are heating up.',
    passingScore: 60,
    steps: [
      { motion: 'grinding',   label: 'Grind the beans',    duration: 7, description: 'Grind coffee beans in circles' },
      { motion: 'press_down', label: 'Tamp the grounds',   duration: 7, description: 'Press down firmly' },
      { motion: 'up_down',    label: 'Dip and steep',      duration: 6, description: 'Dip repeatedly' },
      { motion: 'grinding',   label: 'Stir gently',        duration: 6, description: 'Stir in circles' },
      { motion: 'press_down', label: 'Press the plunger',  duration: 6, description: 'Push down steadily' },
    ],
  },
  {
    id: 3,
    name: 'Master Brew',
    description: 'The full routine — precision counts!',
    passingScore: 70,
    steps: [
      { motion: 'grinding',   label: 'Grind beans',        duration: 5, description: 'Grind fresh beans' },
      { motion: 'press_down', label: 'Tamp down',          duration: 5, description: 'Tamp the grounds' },
      { motion: 'up_down',    label: 'Dip and steep',      duration: 5, description: 'Steep the tea' },
      { motion: 'grinding',   label: 'Stir the brew',      duration: 5, description: 'Stir it all together' },
      { motion: 'press_down', label: 'Press firmly',       duration: 5, description: 'Final press' },
      { motion: 'up_down',    label: 'Final dip',          duration: 4, description: 'Last steep' },
      { motion: 'grinding',   label: 'Final stir',         duration: 4, description: 'Finishing stir' },
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
  tool?: string;
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
