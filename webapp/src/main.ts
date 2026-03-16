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


function init(): void {

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

  // 5. Keyboard navigation for main menu (A/S keys)
  function setupMainMenuKeyboardNav() {
    const menuNavSelector = '#main-menu .menu-nav-btn';
    let menuBtns: HTMLElement[] = [];
    let focusedIdx = 0;

    function updateMenuBtns() {
      menuBtns = Array.from(document.querySelectorAll(menuNavSelector)) as HTMLElement[];
    }

    function focusBtn(idx: number) {
      updateMenuBtns();
      if (menuBtns.length === 0) return;
      focusedIdx = ((idx % menuBtns.length) + menuBtns.length) % menuBtns.length;
      menuBtns.forEach((btn, i) => {
        if (i === focusedIdx) {
          btn.focus();
          // ...existing code...
        } else {
          // ...existing code...
        }
      });
    }

    // Focus Play by default when menu is shown
    function tryAutoFocus() {
      if (document.getElementById('main-menu')?.classList.contains('active')) {
        updateMenuBtns();
        focusBtn(0);
      }
    }

    // Listen for page changes to re-focus

    router.onNavigate((_, to: string) => {
      if (to === 'main-menu') {
        setTimeout(tryAutoFocus, 50);
      }
    });

    // Keydown handler
    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('main-menu')?.classList.contains('active')) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      updateMenuBtns();
      if (menuBtns.length === 0) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        focusBtn(focusedIdx + 1);
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        menuBtns[focusedIdx].click();
      }
    });

    // Initial focus if menu is already active
    setTimeout(tryAutoFocus, 100);
  }

  setupMainMenuKeyboardNav();

  // 4. Connect WebSocket to Python backend
  motionDetector.connect();



  // 5. Debug logging
  document.addEventListener('motion-detected', ((e: CustomEvent) => {
    const { motion, confidence } = e.detail;
    console.log(`🎯 Motion: ${motion} (${Math.round(confidence * 100)}%)`);
  }) as EventListener);

  router.onNavigate((_from, to) => console.log(`📄 Page → ${to}`));

  console.log('☕ While It Steeps — Ready!');
}

init();
