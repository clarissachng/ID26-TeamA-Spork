/**
 * Main entry point — Spork Motion Brewing Game
 *
 * Sets up the page-based UI and WebSocket motion detection.
 */
import './styles/main.css';

import { router } from './pages/router.ts';
import { createMainMenu } from './pages/MainMenu.ts';
import { createLevelSelect } from './pages/LevelSelect.ts';
import { createPlayPage } from './pages/Play.ts';
import { createTutorial } from './pages/Tutorial.ts';
import { createTutorialDetail } from './pages/TutorialDetail.ts';
import { createChoreograph } from './pages/Choreograph.ts';
import { motionDetector } from './components/MotionDetector.ts';
import { bgm } from './modules/bgm.ts';
import { joystick } from './modules/joystick.ts';

function init(): void {
    function setJoystickFocus(el: HTMLElement): void {
      document.querySelectorAll('.joystick-focus').forEach(e => {
        e.classList.remove('joystick-focus');
        (e as HTMLElement).style.transform = '';
      });
      el.focus();
      el.classList.add('joystick-focus');
    }
  // Apply saved theme (default: dark)
  const savedTheme = localStorage.getItem('spork-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  console.log('While It Steeps — Initializing…');

  const app = document.getElementById('app')!;

  // 1. Mount all pages into #app
  app.appendChild(createMainMenu());
  app.appendChild(createLevelSelect());
  app.appendChild(createPlayPage());
  app.appendChild(createTutorial());
  app.appendChild(createTutorialDetail());
  app.appendChild(createChoreograph());

  // 2. Global controls bar (visible on all pages)
  const globalControls = document.createElement('div');
  globalControls.id = 'global-controls';
  globalControls.className = 'global-controls';

  // ── Theme toggle ──
  const savedThemeForBtn = localStorage.getItem('spork-theme') || 'dark';
  const themeIsLight = savedThemeForBtn === 'light';
  globalControls.innerHTML = `
    <button class="global-controls__btn" id="global-theme-toggle" aria-label="Toggle light/dark theme">
      <span class="global-controls__icon" id="global-theme-icon">${themeIsLight ? '\u{1F319}' : '\u{2600}\u{FE0F}'}</span>
      <span class="global-controls__label" id="global-theme-label">${themeIsLight ? 'Dark' : 'Light'}</span>
    </button>
  `;

  // ── BGM picker ──
  const bgmPicker = document.createElement('div');
  bgmPicker.id = 'global-bgm-picker';
  bgmPicker.className = 'global-bgm-picker';
  bgmPicker.innerHTML = `
    <button class="global-controls__btn" id="global-bgm-toggle" aria-label="Background music">
      <span class="global-controls__icon">♪</span>
      <span class="global-controls__label">Music</span>
    </button>
    <div class="global-bgm-picker__panel hidden" id="global-bgm-panel">
      <div class="global-bgm-picker__panel-title">Background Music</div>
      <p class="global-bgm-picker__hint">Tap a track to play — tap again to pause</p>
      <ul class="global-bgm-picker__track-list" id="global-bgm-track-list"></ul>
      <div class="global-bgm-picker__volume-row">
        <span class="global-bgm-picker__vol-icon">\u{1F508}</span>
        <input type="range" class="global-bgm-picker__volume" id="global-bgm-volume"
               min="0" max="1" step="0.05" value="0.4" />
        <span class="global-bgm-picker__vol-icon">\u{1F50A}</span>
      </div>
    </div>
  `;
  globalControls.appendChild(bgmPicker);
  document.body.appendChild(globalControls);

  // ── Theme toggle logic ──
  const themeToggleBtn = globalControls.querySelector('#global-theme-toggle') as HTMLButtonElement;
  const themeIcon = globalControls.querySelector('#global-theme-icon') as HTMLElement;
  const themeLabel = globalControls.querySelector('#global-theme-label') as HTMLElement;

  function updateThemeButton(): void {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    if (theme === 'light') {
      themeIcon.textContent = '\u{1F319}';
      themeLabel.textContent = 'Dark';
    } else {
      themeIcon.textContent = '\u{2600}\u{FE0F}';
      themeLabel.textContent = 'Light';
    }
  }

  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('spork-theme', next);
    updateThemeButton();
  });

  // Build track list
  const trackList = bgmPicker.querySelector('#global-bgm-track-list') as HTMLUListElement;
  const panel = bgmPicker.querySelector('#global-bgm-panel') as HTMLElement;
  const toggleBtn = bgmPicker.querySelector('#global-bgm-toggle') as HTMLButtonElement;
  const volSlider = bgmPicker.querySelector('#global-bgm-volume') as HTMLInputElement;

  bgm.tracks.forEach((track, idx) => {
    const li = document.createElement('li');
    li.className = 'global-bgm-picker__track';
    li.dataset.idx = String(idx);
    li.innerHTML = `
      <span class="global-bgm-picker__track-icon">♪</span>
      <span class="global-bgm-picker__track-name">${track.label}</span>
    `;
    li.addEventListener('click', () => {
      bgm.playTrack(idx);
      refreshGlobalTrackList();
    });
    trackList.appendChild(li);
  });

  function refreshGlobalTrackList(): void {
    trackList.querySelectorAll('.global-bgm-picker__track').forEach((li) => {
      const elIdx = parseInt((li as HTMLElement).dataset.idx ?? '-1', 10);
      const isActive = elIdx === bgm.currentIdx;
      li.classList.toggle('active', isActive);
      const icon = li.querySelector('.global-bgm-picker__track-icon') as HTMLElement;
      if (icon) icon.textContent = isActive ? '🔊' : '♪';
    });
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('hidden') &&
        !(e.target as HTMLElement).closest('#global-bgm-picker')) {
      panel.classList.add('hidden');
    }
  });

  volSlider.addEventListener('input', () => {
    bgm.setVolume(parseFloat(volSlider.value));
  });

  // Start BGM on first user interaction (autoplay policy)
  const startBgm = () => {
    bgm.tryStart();
    refreshGlobalTrackList();
    document.removeEventListener('click', startBgm);
    document.removeEventListener('keydown', startBgm);
  };
  document.addEventListener('click', startBgm);
  document.addEventListener('keydown', startBgm);

  // 3. Navigate to main menu
  router.go('main-menu');

  // 4. Connect WebSocket to Python backend
  motionDetector.connect();

    // 6. Wire up joystick navigation
    joystick.onDirection = (dir) => {
      const focusable = Array.from(
        document.querySelectorAll('button:not([disabled]), [tabindex="0"]')
      ).filter((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) as HTMLElement[];

      const current = document.activeElement as HTMLElement;
      let idx = focusable.indexOf(current);
      if (idx === -1) idx = 0;

      let next: HTMLElement | undefined;
      if (dir === 'down' || dir === 'right') next = focusable[idx + 1] ?? focusable[0];
      if (dir === 'up' || dir === 'left') next = focusable[idx - 1] ?? focusable[focusable.length - 1];

      if (next) {
        setJoystickFocus(next);
      }
    };

    joystick.onClick = () => {
      const focused = document.activeElement as HTMLElement;
      focused?.click();
    };

    joystick.onToolScanned = (tool) => {
      console.log('[NFC] Tool scanned:', tool);
      document.dispatchEvent(new CustomEvent('tool-scanned', { detail: { tool } }));
    };

    // Add a connect joystick button to global controls
    const joystickBtn = document.createElement('button');
    joystickBtn.className = 'global-controls__btn';
    joystickBtn.id = 'btn-connect-joystick';
    joystickBtn.innerHTML = '<span class="global-controls__icon">🕹️</span><span class="global-controls__label">Joystick</span>';
    joystickBtn.addEventListener('click', async () => {
      try {
        await joystick.connect();
        joystickBtn.querySelector('.global-controls__label')!.textContent = 'Connected';
        joystickBtn.style.opacity = '0.5';
        // Set default focus to play button after short delay (let page settle)
        setTimeout(() => {
          const playBtn = document.querySelector('[data-page="play"], #btn-play, .btn-play, button[id*="play"]') as HTMLElement;
          if (playBtn) setJoystickFocus(playBtn);
        }, 300);
      } catch (e) {
        console.error('[JOY] Connection failed:', e);
      }
    });
    globalControls.appendChild(joystickBtn);

  // 5. Debug logging
  document.addEventListener('motion-detected', ((e: CustomEvent) => {
    const { motion, confidence } = e.detail;
    console.log(`🎯 Motion: ${motion} (${Math.round(confidence * 100)}%)`);
  }) as EventListener);

  router.onNavigate((_from, to) => console.log(`📄 Page → ${to}`));

  console.log('☕ While It Steeps — Ready!');
}

init();
