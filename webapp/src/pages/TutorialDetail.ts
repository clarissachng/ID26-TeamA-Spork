/**
 * TutorialDetail page — shows what motion to perform for a specific prop,
 * with a visual demonstration area and real-time sensor feedback.
 *
 * Special case: "grinding" motion uses the GrinderTutorial component.
 *
 * Input: Arduino magnetometer when connected, keyboard fallback otherwise.
 *   - Space / Enter = correct motion
 *   - Any other key  = wrong motion
 */
import { router } from './router.ts';
import { MOTION_META, type MotionType } from '../types/motion.types.ts';
import { GrinderTutorial } from '../components/GrinderTutorial.ts';
import { DipTutorial } from '../components/DipTutorial.ts';
import { PressTutorial } from '../components/PressTutorial.ts';
import { serial } from '../modules/serial.ts';
import { CupFill } from '../components/CupFill.ts';
import { SensorXYMap } from '../components/SensorXYMap.ts';
import { SensorZStrip } from '../components/SensorZStrip.ts';

/** Tutorial order — matches the cards on the Tutorial page */
const TUTORIAL_ORDER: MotionType[] = ['grinding', 'up_down', 'press_down'];

export function createTutorialDetail(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'tutorial-detail';
  page.className = 'page tutorial-bg';

  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>
    <div class="stack stack--lg" style="text-align: center; width: 100%; max-width: 480px;">
      <div id="td-emoji" style="font-size: 5rem;"></div>
      <h2 id="td-prop"></h2>
      <p id="td-label" class="subtitle"></p>
      <p id="td-desc"></p>

      <!-- Special grinder demo for circle motion -->
      <div id="td-grinder-container"></div>

      <!-- Visual demonstration placeholder for other motions -->
      <div id="td-demo" class="tutorial-demo-area" style="
        width: 100%;
        height: 180px;
        border-radius: var(--radius-lg);
        background: var(--bg-card);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        color: var(--text-muted);
        box-shadow: var(--shadow-soft);
      ">
        <span id="td-demo-text">Perform the motion to see feedback</span>
      </div>

      <!-- Real-time feedback indicator -->
      <div id="td-feedback" class="stack" style="min-height: 60px;">
        <div id="td-status" style="
          font-family: var(--font-display);
          font-size: 1.3rem;
          color: var(--text-muted);
          transition: color var(--duration-mid);
        ">Waiting for motion…</div>
        <div id="td-confidence-bar" style="
          width: 100%;
          max-width: 300px;
          height: 8px;
          border-radius: var(--radius-pill);
          background: var(--bg-card);
          overflow: hidden;
        ">
          <div id="td-confidence-fill" style="
            width: 0%;
            height: 100%;
            background: var(--accent-sage);
            border-radius: var(--radius-pill);
            transition: width var(--duration-mid) var(--ease-out-soft), background var(--duration-mid);
          "></div>
        </div>
      </div>
    </div>

    <!-- Sensor-reactive cup -->
    <div id="td-cup-container" class="td-cup-container"></div>

    <!-- Radial flash overlay (success / wrong) -->
    <div id="td-flash" class="td-flash"></div>

    <!-- Motion counter -->
    <div id="td-counter" class="td-counter"></div>

    <!-- Success popup -->
    <div id="td-popup" class="td-popup hidden">
      <div class="td-popup__card">
        <h3 class="td-popup__title">Nice work!</h3>
        <p class="td-popup__text">You completed this motion.</p>
        <div class="td-popup__actions">
          <button class="btn btn--ghost btn--small" data-popup="stay">Try Again</button>
          <button class="btn btn--ghost btn--small hidden" data-popup="redo">Redo Tutorial</button>
          <button class="btn btn--gold btn--small" data-popup="next">Next Tutorial</button>
        </div>
      </div>
    </div>
  `;

  /* ── Back ── */
  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => router.go('tutorial'));

  /* ── Popup buttons ── */
  page.querySelector('[data-popup="stay"]')!
    .addEventListener('click', () => handleStay(page));
  page.querySelector('[data-popup="redo"]')!
    .addEventListener('click', () => handleRedo(page));
  page.querySelector('[data-popup="next"]')!
    .addEventListener('click', () => handleNext(page));

  /* ── State ── */
  let motionHandler: ((e: Event) => void) | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let grinder: GrinderTutorial | null = null;
  let dipTut: DipTutorial | null = null;
  let pressTut: PressTutorial | null = null;
  let cup: CupFill | null = null;
  let xyMap: SensorXYMap | null = null;
  let zStrip: SensorZStrip | null = null;
  let resolved = false; // whether the round already succeeded
  let successCount = 0;  // number of successful motions (need 2 to pass)
  let lastSuccessAt = 0;
  const SUCCESS_STEP = 1;
  const SUCCESS_DEBOUNCE_MS = 600;
  const REQUIRED_SUCCESSES = 2;

  /* ── Activate / deactivate ── */
  const observer = new MutationObserver(() => {
    if (page.classList.contains('active')) {
      resolved = false;
      successCount = 0;
      lastSuccessAt = 0;
      hidePopup(page);
      updateCounter(page, 0, REQUIRED_SUCCESSES);

      const motion = (page.dataset.motion ?? 'grinding') as MotionType;
      setupDetail(page, motion);

      // Clean previous tutorial component HTML
      (page.querySelector('#td-grinder-container') as HTMLElement).innerHTML = '';

      // Set up sensor feedback per motion type
      const cupContainer = page.querySelector('#td-cup-container') as HTMLElement;
      cupContainer.innerHTML = '';
      if (motion === 'grinding') {
        xyMap = new SensorXYMap(cupContainer);
        xyMap.startListening();
      } else if (motion === 'up_down' || motion === 'press_down') {
        zStrip = new SensorZStrip(cupContainer);
        zStrip.startListening();
      } else {
        cup = new CupFill(cupContainer);
        cup.startListening();
      }

      const container = page.querySelector('#td-grinder-container') as HTMLElement;

      if (motion === 'grinding') {
        grinder = new GrinderTutorial(container);
        grinder.start();
        (page.querySelector('#td-demo') as HTMLElement).style.display = 'none';
        (page.querySelector('#td-feedback') as HTMLElement).style.display = 'none';
      } else if (motion === 'up_down') {
        dipTut = new DipTutorial(container);
        dipTut.start();
        (page.querySelector('#td-demo') as HTMLElement).style.display = 'none';
        (page.querySelector('#td-feedback') as HTMLElement).style.display = 'none';
      } else if (motion === 'press_down') {
        pressTut = new PressTutorial(container);
        pressTut.start();
        (page.querySelector('#td-demo') as HTMLElement).style.display = 'none';
        (page.querySelector('#td-feedback') as HTMLElement).style.display = 'none';
      } else {
        (page.querySelector('#td-demo') as HTMLElement).style.display = 'flex';
        (page.querySelector('#td-feedback') as HTMLElement).style.display = 'flex';
      }

      // Arduino path
      if (serial.isConnected) {
        motionHandler = createMotionListener(page, motion, (confidence: number) => {
          if (!resolved) {
            const now = Date.now();
            if (now - lastSuccessAt < SUCCESS_DEBOUNCE_MS) return;
            lastSuccessAt = now;

            cup?.confirmFill(confidence);
            xyMap?.confirm();
            zStrip?.confirm();
            successCount = Math.min(REQUIRED_SUCCESSES, successCount + SUCCESS_STEP);
            updateCounter(page, successCount, REQUIRED_SUCCESSES);
            if (successCount >= REQUIRED_SUCCESSES) {
              resolved = true;
              onSuccess(page);
            } else {
              // Reset sensor viz back to sensing for the next attempt
              setTimeout(() => { cup?.reset(); xyMap?.reset(); zStrip?.reset(); }, 1200);
              flashRadial(page, 'success');
            }
          }
        });
        document.addEventListener('motion-detected', motionHandler);
      }

      // Keyboard fallback (always active so devs can test without hardware)
      keyHandler = (e: KeyboardEvent) => {
        if (!page.classList.contains('active')) return;
        // Ignore if popup is showing
        if (!page.querySelector('#td-popup')!.classList.contains('hidden')) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          // Dispatch motion-detected so tutorial components (Grinder etc.) react
          document.dispatchEvent(new CustomEvent('motion-detected', {
            detail: { motion, confidence: 1 },
          }));
          // Only count here if no Arduino motionHandler (it would double-count)
          if (!motionHandler && !resolved) {
            const now = Date.now();
            if (now - lastSuccessAt < SUCCESS_DEBOUNCE_MS) return;
            lastSuccessAt = now;

            cup?.confirmFill(1);
            xyMap?.confirm();
            zStrip?.confirm();
            successCount = Math.min(REQUIRED_SUCCESSES, successCount + SUCCESS_STEP);
            updateCounter(page, successCount, REQUIRED_SUCCESSES);
            if (successCount >= REQUIRED_SUCCESSES) {
              resolved = true;
              onSuccess(page);
            } else {
              setTimeout(() => { cup?.reset(); xyMap?.reset(); zStrip?.reset(); }, 1200);
              flashRadial(page, 'success');
            }
          }
        } else if (e.key.length === 1) {
          // Any printable key = wrong — dispatch a mismatched motion
          document.dispatchEvent(new CustomEvent('motion-detected', {
            detail: { motion: 'unknown', confidence: 0 },
          }));
          if (!motionHandler) onWrong(page);
        }
      };
      document.addEventListener('keydown', keyHandler);

    } else {
      // Leaving page — clean up
      if (motionHandler) {
        document.removeEventListener('motion-detected', motionHandler);
        motionHandler = null;
      }
      if (keyHandler) {
        document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
      }
      if (grinder) { grinder.destroy(); grinder = null; }
      if (dipTut) { dipTut.destroy(); dipTut = null; }
      if (pressTut) { pressTut.destroy(); pressTut = null; }
      if (cup) { cup.destroy(); cup = null; }
      if (xyMap) { xyMap.destroy(); xyMap = null; }
      if (zStrip) { zStrip.destroy(); zStrip = null; }
    }
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });

  return page;
}

/* ── Helpers ────────────────────────────────────────────── */

function setupDetail(page: HTMLElement, motion: MotionType): void {
  const meta = MOTION_META[motion];
  (page.querySelector('#td-emoji') as HTMLElement).innerHTML =
    `<img class="tutorial-detail__asset" src="${meta.asset}" alt="${meta.label}" />`;
  (page.querySelector('#td-prop') as HTMLElement).textContent = meta.prop;
  (page.querySelector('#td-label') as HTMLElement).textContent = meta.label;
  (page.querySelector('#td-desc') as HTMLElement).textContent = meta.description;
  (page.querySelector('#td-status') as HTMLElement).textContent = 'Waiting for motion…';
  (page.querySelector('#td-status') as HTMLElement).style.color = 'var(--text-muted)';
  (page.querySelector('#td-confidence-fill') as HTMLElement).style.width = '0%';
  (page.querySelector('#td-demo-text') as HTMLElement).textContent = 'Perform the motion to see feedback';
}

function createMotionListener(
  page: HTMLElement,
  expectedMotion: MotionType,
  onCorrect: (confidence: number) => void
) {
  return (e: Event) => {
    const { motion, confidence } = (e as CustomEvent).detail as {
      motion: MotionType;
      confidence: number;
    };
    const statusEl = page.querySelector('#td-status') as HTMLElement;
    const fillEl = page.querySelector('#td-confidence-fill') as HTMLElement;
    const demoText = page.querySelector('#td-demo-text') as HTMLElement;

    if (motion === expectedMotion) {
      const pct = Math.round(confidence * 100);
      statusEl.textContent = `Detected! ${pct}% confidence`;
      statusEl.style.color = 'var(--accent-sage)';
      fillEl.style.width = `${pct}%`;
      fillEl.style.background = 'var(--accent-sage)';
      demoText.textContent = 'Great job!';
      onCorrect(confidence);
    } else {
      const meta = MOTION_META[motion];
      statusEl.textContent = `Detected "${meta.label}" — try the correct motion`;
      statusEl.style.color = 'var(--accent-rose)';
      fillEl.style.width = '20%';
      fillEl.style.background = 'var(--accent-rose)';
      onWrong(page);
    }
  };
}

/* ── Visual feedback ───────────────────────────────────── */

function flashRadial(page: HTMLElement, type: 'success' | 'wrong'): void {
  const flash = page.querySelector('#td-flash') as HTMLElement;
  flash.classList.remove('td-flash--success', 'td-flash--wrong');
  void flash.offsetWidth; // force reflow
  flash.classList.add(type === 'success' ? 'td-flash--success' : 'td-flash--wrong');
  setTimeout(() => flash.classList.remove('td-flash--success', 'td-flash--wrong'), 700);
}

function onSuccess(page: HTMLElement): void {
  flashRadial(page, 'success');
  setTimeout(() => showPopup(page), 500);
}

function onWrong(page: HTMLElement): void {
  flashRadial(page, 'wrong');

  const demoContainer = page.querySelector('#td-grinder-container') as HTMLElement;
  demoContainer.classList.remove('td-wrong-shake');
  void demoContainer.offsetWidth; // force reflow for quick re-trigger
  demoContainer.classList.add('td-wrong-shake');
  setTimeout(() => demoContainer.classList.remove('td-wrong-shake'), 450);
}

function updateCounter(page: HTMLElement, count: number, total: number): void {
  const el = page.querySelector('#td-counter') as HTMLElement;
  el.textContent = `${count} / ${total}`;
}

function showPopup(page: HTMLElement): void {
  const popup = page.querySelector('#td-popup') as HTMLElement;
  const currentMotion = (page.dataset.motion ?? 'grinding') as MotionType;
  const idx = TUTORIAL_ORDER.indexOf(currentMotion);
  const isLast = idx === TUTORIAL_ORDER.length - 1;

  const stayBtn = popup.querySelector('[data-popup="stay"]') as HTMLButtonElement;
  const redoBtn = popup.querySelector('[data-popup="redo"]') as HTMLButtonElement;
  const nextBtn = popup.querySelector('[data-popup="next"]') as HTMLButtonElement;

  if (isLast) {
    // Last tutorial: show all 3 buttons
    stayBtn.textContent = 'Try Again';
    redoBtn.classList.remove('hidden');
    redoBtn.textContent = 'Redo Tutorial';
    nextBtn.textContent = 'Start Game';
    (popup.querySelector('.td-popup__title') as HTMLElement).textContent = 'Tutorials Complete!';
    (popup.querySelector('.td-popup__text') as HTMLElement).textContent =
      'You\'ve practised all the motions. Ready to play?';
  } else {
    stayBtn.textContent = 'Try Again';
    redoBtn.classList.add('hidden');
    nextBtn.textContent = 'Next Tutorial';
    (popup.querySelector('.td-popup__title') as HTMLElement).textContent = 'Nice work!';
    (popup.querySelector('.td-popup__text') as HTMLElement).textContent = 'You completed this motion.';
  }

  popup.classList.remove('hidden');
}

function hidePopup(page: HTMLElement): void {
  page.querySelector('#td-popup')!.classList.add('hidden');
}

function handleStay(page: HTMLElement): void {
  hidePopup(page);
  // Re-arm the page by toggling active class to retrigger the observer
  page.classList.remove('active');
  requestAnimationFrame(() => page.classList.add('active'));
}

function handleRedo(page: HTMLElement): void {
  hidePopup(page);
  // Start from the first tutorial again
  page.classList.add('td-slide-out-left');
  setTimeout(() => {
    page.classList.remove('td-slide-out-left', 'active');
    page.style.display = 'none';
    router.go('tutorial-detail', { motion: TUTORIAL_ORDER[0] });
  }, 450);
}

function handleNext(page: HTMLElement): void {
  hidePopup(page);
  const currentMotion = (page.dataset.motion ?? 'grinding') as MotionType;
  const idx = TUTORIAL_ORDER.indexOf(currentMotion);

  if (idx < TUTORIAL_ORDER.length - 1) {
    const nextMotion = TUTORIAL_ORDER[idx + 1];
    // Add slide-out-left class for the transition
    page.classList.add('td-slide-out-left');
    setTimeout(() => {
      page.classList.remove('td-slide-out-left', 'active');
      page.style.display = 'none';
      router.go('tutorial-detail', { motion: nextMotion });
    }, 450);
  } else {
    // Last tutorial — go to gameplay
    router.go('play', { levelId: '1' });
  }
}
