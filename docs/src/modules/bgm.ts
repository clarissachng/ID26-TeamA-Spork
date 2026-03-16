/**
 * BGM Module — global background music manager.
 *
 * Manages a single <audio> element that loops the selected track.
 * Persists mute preference and last-played track in localStorage.
 */

const BGM_TRACKS = [
  { label: 'Café Morning', src: '/assets/bgm/bgm01.mp3' },
  { label: 'Matcha Hours', src: '/assets/bgm/bgm02.mp3' },
  { label: 'Rainy Kettle', src: '/assets/bgm/bgm03.mp3' },
];

class BgmManager {
  private audio: HTMLAudioElement;
  private muted: boolean;
  private started = false;
  private _currentIdx = -1;

  readonly tracks = BGM_TRACKS;

  constructor() {
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.volume = 0.4;

    this.muted = localStorage.getItem('spork-bgm-muted') === 'true';

    // Restore last track or pick first
    const savedIdx = parseInt(localStorage.getItem('spork-bgm-track') ?? '0', 10);
    this._currentIdx = savedIdx >= 0 && savedIdx < BGM_TRACKS.length ? savedIdx : 0;
    this.audio.src = BGM_TRACKS[this._currentIdx].src;
  }

  /** Play a specific track by index */
  playTrack(idx: number): void {
    if (idx < 0 || idx >= BGM_TRACKS.length) return;

    // If same track tapped again → toggle pause/play
    if (idx === this._currentIdx && this.started) {
      this.toggle();
      return;
    }

    this._currentIdx = idx;
    localStorage.setItem('spork-bgm-track', String(idx));
    this.audio.src = BGM_TRACKS[idx].src;

    // Unmute and play
    if (this.muted) {
      this.muted = false;
      localStorage.setItem('spork-bgm-muted', 'false');
    }
    this.started = true;
    this.audio.play().catch(() => {});
  }

  /** Start playback of current track — call from user gesture */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.muted) {
      this.audio.play().catch(() => { this.started = false; });
    }
  }

  tryStart(): void {
    if (!this.started) this.start();
  }

  toggle(): void {
    this.muted = !this.muted;
    localStorage.setItem('spork-bgm-muted', String(this.muted));
    if (this.muted) {
      this.audio.pause();
    } else {
      this.started = true;
      this.audio.play().catch(() => {});
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get currentIdx(): number {
    return this.muted ? -1 : this._currentIdx;
  }

  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }
}

export const bgm = new BgmManager();
