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
import { assetUrl } from '../utils/asset.ts';

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
            src="${assetUrl('/assets/logo.png')}"
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

  return page;
}
