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
import { playBridge } from './services/playBridge.ts';
import { tutorialBridge } from './services/tutorialBridge.ts';


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
  function setupGlobalKeyboardNav() {
    // Select all visible/selectable buttons in the active page
    function getSelectableButtons(): HTMLElement[] {
      // Only buttons that are visible and not disabled
      const btns = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
      return btns.filter(btn => {
        const style = window.getComputedStyle(btn);
        return style.display !== 'none' && style.visibility !== 'hidden' && !btn.hasAttribute('disabled') && btn.offsetParent !== null;
      });
    }

    let focusedIdx = 0;

    function focusBtn(idx: number) {
      const btns = getSelectableButtons();
      if (btns.length === 0) return;
      focusedIdx = ((idx % btns.length) + btns.length) % btns.length;
      btns[focusedIdx].focus();
    }

    function tryAutoFocus() {
      // Focus first button in the active page
      setTimeout(() => {
        const btns = getSelectableButtons();
        if (btns.length > 0) {
          focusedIdx = 0;
          btns[0].focus();
        }
      }, 50);
    }

    // Listen for page changes to re-focus
    router.onNavigate((_, _to: string) => {
      tryAutoFocus();
    });

    // Keydown handler
    document.addEventListener('keydown', (e) => {
      // Only handle if not typing in input/textarea
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;
      const btns = getSelectableButtons();
      if (btns.length === 0) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        focusBtn(focusedIdx + 1);
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        btns[focusedIdx].click();
      }
    });

    // Initial focus
    setTimeout(tryAutoFocus, 100);
  }

  setupGlobalKeyboardNav();

  // 4. Connect WebSocket to Python backend
  motionDetector.connect();



  // 5. Debug logging
  document.addEventListener('motion-detected', ((e: CustomEvent) => {
    const { motion, confidence } = e.detail;
    console.log(`🎯 Motion: ${motion} (${Math.round(confidence * 100)}%)`);
  }) as EventListener);

  router.onNavigate((_from, to) => {
    console.log(`📄 Page → ${to}`);
    // If we're not on a gameplay or tutorial page, tell the backend to go idle.
    // This stops any running round/tutorial task in the background.
    if (to !== 'play' && to !== 'tutorial-detail') {
      if (playBridge.isConnected()) playBridge.sendUiState('idle');
      else if (tutorialBridge.isConnected()) tutorialBridge.sendUiState('idle');
    }
  });

  console.log('☕ While It Steeps — Ready!');
}

init();
