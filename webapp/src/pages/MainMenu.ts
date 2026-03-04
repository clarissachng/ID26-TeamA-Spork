/**
 * MainMenu page — the landing screen with 3 warm, tactile buttons.
 *
 * ┌─────────────────────────────┐
 * │                    ♪ Music  │  ← BGM picker (top-right)
 * │         ☕ While It Steeps  │
 * │    the motion brewing game  │
 * │                             │
 * │      [ ▶ Play       ]       │
 * │      [ 📖 Tutorial  ]       │
 * │      [ 🎨 Create    ]       │
 * │                             │
 * │  ⬤ Connected                │  ← Arduino status (bottom-left)
 * └─────────────────────────────┘
 */
import { router } from './router.ts';
import { motionDetector } from '../components/MotionDetector.ts';

/* ── BGM Track list — swap src paths when real audio is ready ── */
const BGM_TRACKS = [
  { label: 'Café Morning', src: '/audio/cafe-morning.mp3' },
  { label: 'Rainy Kettle', src: '/audio/rainy-kettle.mp3' },
  { label: 'Matcha Hours', src: '/audio/matcha-hours.mp3' },
];

/** Persistent audio element — lives across navigations */
let bgmAudio: HTMLAudioElement | null = null;
let currentTrackIdx = -1;

export function createMainMenu(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'main-menu';
  page.className = 'page menu-bg';

  page.innerHTML = `
    <!-- ── Main hero: logo top-left, illustration on table ── -->
    <div class="main-menu-hero" id="main-menu-hero">
      <header class="menu-header">
        <div class="menu-logo-block" id="main-menu-logo" aria-label="While It Steeps logo">
          <img
            src="/assets/logo.png"
            alt="While It Steeps - motion brewing game logo"
            class="menu-logo-img"
            width="120"
            height="120"
          />
          <div class="menu-logo-text">
            <h1>While It Steeps</h1>
            <p class="subtitle">a motion brewing game for everyone</p>
          </div>
        </div>

        <!-- ── Top-right controls: Theme toggle + BGM Picker ── -->
        <div class="top-right-controls">
          <button class="theme-toggle" id="theme-toggle" aria-label="Toggle light/dark theme">
            <span class="theme-toggle__icon" id="theme-icon">☀️</span>
            <span id="theme-label">Light</span>
          </button>
          <div class="bgm-picker" id="bgm-picker">
            <button class="bgm-picker__toggle" id="bgm-toggle" aria-label="Background music">
              <span class="bgm-picker__note">♪</span>
              <span class="bgm-picker__label">Music</span>
            </button>
            <div class="bgm-picker__panel hidden" id="bgm-panel">
              <div class="bgm-picker__panel-title">Background Music</div>
              <ul class="bgm-picker__track-list" id="bgm-track-list"></ul>
              <div class="bgm-picker__volume-row">
                <span class="bgm-picker__vol-icon">🔈</span>
                <input
                  type="range"
                  class="bgm-picker__volume"
                  id="bgm-volume"
                  min="0"
                  max="1"
                  step="0.05"
                  value="0.5"
                />
                <span class="bgm-picker__vol-icon">🔊</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <!-- ── Illustration sitting on warm wooden table ── -->
      <div class="menu-stage">
        <div class="menu-illustration" id="menu-illustration">
        </div>
      </div>

      <!-- ── Centered navigation buttons ── -->
      <nav class="menu-nav" id="menu-nav">
        <button class="menu-nav-btn menu-nav-btn--play" data-action="play">Play</button>
        <button class="menu-nav-btn menu-nav-btn--tutorial" data-action="tutorial">Tutorial</button>
        <button class="menu-nav-btn menu-nav-btn--choreograph" data-action="choreograph">Choreograph</button>
      </nav>
    </div>

    <!-- ── Arduino Connection Button (bottom-left) ── -->
    <button class="arduino-status-btn" id="arduino-status-btn" aria-label="Arduino connection status">
      <span class="arduino-status-btn__dot" id="ws-dot"></span>
      <span class="arduino-status-btn__label" id="ws-label">Connecting…</span>
    </button>
  `;

  // ── Wire up illustration hotspots as navigation buttons ──
  function navigateFromHero(target: 'level-select' | 'tutorial' | 'choreograph'): void {
    router.go(target);
  }

  page.querySelector('[data-action="play"]')!
    .addEventListener('click', () => navigateFromHero('level-select'));

  page.querySelector('[data-action="tutorial"]')!
    .addEventListener('click', () => navigateFromHero('tutorial'));

  page.querySelector('[data-action="choreograph"]')!
    .addEventListener('click', () => navigateFromHero('choreograph'));

  // ═══════════════════════════════════════════════════════
  //  BGM Picker
  // ═══════════════════════════════════════════════════════
  const bgmToggle = page.querySelector('#bgm-toggle') as HTMLButtonElement;
  const bgmPanel = page.querySelector('#bgm-panel') as HTMLElement;
  const bgmTrackList = page.querySelector('#bgm-track-list') as HTMLUListElement;
  const bgmVolume = page.querySelector('#bgm-volume') as HTMLInputElement;

  // Build track list
  BGM_TRACKS.forEach((track, idx) => {
    const li = document.createElement('li');
    li.className = 'bgm-picker__track';
    li.dataset.idx = String(idx);
    li.innerHTML = `
      <span class="bgm-picker__track-icon">${idx === currentTrackIdx ? '🔊' : '♪'}</span>
      <span class="bgm-picker__track-name">${track.label}</span>
    `;
    if (idx === currentTrackIdx) li.classList.add('active');
    li.addEventListener('click', () => selectTrack(idx));
    bgmTrackList.appendChild(li);
  });

  // Toggle panel open/close
  bgmToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    bgmPanel.classList.toggle('hidden');
  });

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!bgmPanel.classList.contains('hidden') &&
        !(e.target as HTMLElement).closest('#bgm-picker')) {
      bgmPanel.classList.add('hidden');
    }
  });

  // Volume slider
  if (bgmAudio) bgmVolume.value = String(bgmAudio.volume);
  bgmVolume.addEventListener('input', () => {
    if (bgmAudio) bgmAudio.volume = parseFloat(bgmVolume.value);
  });

  function selectTrack(idx: number): void {
    // If same track is already playing, stop it
    if (idx === currentTrackIdx && bgmAudio && !bgmAudio.paused) {
      bgmAudio.pause();
      currentTrackIdx = -1;
      refreshTrackList();
      return;
    }

    // Play selected track
    if (!bgmAudio) {
      bgmAudio = new Audio();
      bgmAudio.loop = true;
      bgmAudio.volume = parseFloat(bgmVolume.value);
    }

    bgmAudio.src = BGM_TRACKS[idx].src;
    bgmAudio.volume = parseFloat(bgmVolume.value);
    bgmAudio.play().catch(() => {
      // Autoplay blocked — user gesture needed; will play on next interaction
      console.warn('BGM autoplay blocked — tap again to play');
    });

    currentTrackIdx = idx;
    refreshTrackList();
  }

  function refreshTrackList(): void {
    bgmTrackList.querySelectorAll('.bgm-picker__track').forEach((li) => {
      const elIdx = parseInt((li as HTMLElement).dataset.idx ?? '-1', 10);
      const isActive = elIdx === currentTrackIdx;
      li.classList.toggle('active', isActive);
      const icon = li.querySelector('.bgm-picker__track-icon') as HTMLElement;
      if (icon) icon.textContent = isActive ? '🔊' : '♪';
    });
  }

  // ═══════════════════════════════════════════════════════
  //  Arduino Connection Button (bottom-left)
  // ═══════════════════════════════════════════════════════
  const statusBtn = page.querySelector('#arduino-status-btn') as HTMLButtonElement;
  const dot = page.querySelector('#ws-dot') as HTMLElement;
  const label = page.querySelector('#ws-label') as HTMLElement;

  type ConnectionState = 'connecting' | 'connected' | 'disconnected';

  function getState(): ConnectionState {
    if (motionDetector.connected) return 'connected';
    // If not connected but we haven't explicitly disconnected, we're trying
    return 'connecting';
  }

  function updateStatus(): void {
    const state = getState();
    // Update dot colour class
    dot.className = 'arduino-status-btn__dot';
    if (state === 'connected') dot.classList.add('dot--connected');
    else if (state === 'disconnected') dot.classList.add('dot--disconnected');
    else dot.classList.add('dot--connecting');

    // Update label
    const labels: Record<ConnectionState, string> = {
      connecting: 'Connecting…',
      connected: 'Connected',
      disconnected: 'Disconnected',
    };
    label.textContent = labels[state];
  }

  statusBtn.addEventListener('click', () => {
    if (motionDetector.connected) {
      // Already connected — brief confirmation flash
      label.textContent = '✓ Live';
      setTimeout(updateStatus, 1200);
    } else {
      // Attempt to reconnect
      label.textContent = 'Reconnecting…';
      dot.className = 'arduino-status-btn__dot dot--connecting';
      motionDetector.disconnect();
      motionDetector.connect();
    }
  });

  document.addEventListener('ws-status', updateStatus);
  updateStatus();

  // ═══════════════════════════════════════════════════════
  //  Theme Toggle
  // ═══════════════════════════════════════════════════════
  const themeToggleBtn = page.querySelector('#theme-toggle') as HTMLButtonElement;
  const themeIcon = page.querySelector('#theme-icon') as HTMLElement;
  const themeLabel = page.querySelector('#theme-label') as HTMLElement;

  function getCurrentTheme(): string {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function updateThemeButton(): void {
    const theme = getCurrentTheme();
    if (theme === 'light') {
      themeIcon.textContent = '\u{1F319}';
      themeLabel.textContent = 'Dark';
    } else {
      themeIcon.textContent = '\u{2600}\u{FE0F}';
      themeLabel.textContent = 'Light';
    }
  }

  themeToggleBtn.addEventListener('click', () => {
    const current = getCurrentTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('spork-theme', next);
    updateThemeButton();
  });

  updateThemeButton();

  return page;
}
