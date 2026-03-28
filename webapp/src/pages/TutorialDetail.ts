/**
 * TutorialDetail page — shows what motion to perform for a specific prop,
 * with a visual demonstration area and real-time sensor feedback.
 *
 * When bridge_tutorial.py is running (ws://localhost:8765):
 *   - Backend drives the sequence: prompt → NFC scan → countdown → score → result
 *   - Frontend listens for CustomEvents emitted by tutorialBridge
 *
 * Keyboard fallback (no backend):
 *   - Space / Enter = correct motion
 *   - Any other key  = wrong motion
 */
import { router } from './router.ts';
import { MOTION_META, type MotionType } from '../types/motion.types.ts';
import { GrinderTutorial } from '../components/GrinderTutorial.ts';
import { DipTutorial } from '../components/DipTutorial.ts';
import { PressTutorial } from '../components/PressTutorial.ts';
import { CupFill } from '../components/CupFill.ts';
import { SensorXYMap } from '../components/SensorXYMap.ts';
import { SensorZStrip } from '../components/SensorZStrip.ts';
import { CountdownFlash } from '../components/CountdownFlash.ts';
import { tutorialBridge } from '../services/tutorialBridge.ts';

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

      <!-- Tutorial animation component mounts here -->
      <div id="td-grinder-container"></div>

      <!-- Visual demonstration placeholder for unknown motions -->
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

      <!-- Backend scan instruction -->
      <div id="td-scan-prompt" class="play-scan-prompt hidden"></div>
    </div>

    <!-- 8-second motion timer — same sweep ring as play page -->
    <div class="play-timer" id="td-timer"></div>

    <!-- Sensor-reactive visualiser -->
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
  let motionHandler:           ((e: Event) => void) | null = null;
  let keyHandler:              ((e: KeyboardEvent) => void) | null = null;
  let promptHandler:           ((e: Event) => void) | null = null;
  let countdownHandler:        ((e: Event) => void) | null = null;
  let nfcWrongHandler:         ((e: Event) => void) | null = null;
  let motionFailedHandler:     ((e: Event) => void) | null = null;
  let tutorialCompleteHandler: ((e: Event) => void) | null = null;

  let grinder:  GrinderTutorial | null = null;
  let dipTut:   DipTutorial     | null = null;
  let pressTut: PressTutorial   | null = null;
  let cup:      CupFill         | null = null;
  let xyMap:    SensorXYMap     | null = null;
  let zStrip:   SensorZStrip    | null = null;

  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let timerRaf:      number | null = null;
  const countdownFlash = new CountdownFlash(page);

  let resolved      = false;
  let successCount  = 0;
  let lastSuccessAt = 0;
  const SUCCESS_STEP        = 1;
  const SUCCESS_DEBOUNCE_MS = 600;
  const REQUIRED_SUCCESSES  = 1;

  // Gate backend flow per page:
  // countdown/result events are ignored until this page gets its own prompt.
  let hasMatchingPrompt = false;

  // ── Animation helpers — now just direct method calls ──────────────────────

  function triggerSuccess(): void {
    grinder?.triggerSuccess();
    dipTut?.triggerSuccess();
    pressTut?.triggerSuccess();
  }

  function triggerWrong(): void {
    grinder?.triggerWrong();
    dipTut?.triggerWrong();
    pressTut?.triggerWrong();
  }

  function motionInstructionText(targetMotion: MotionType): string {
    if (targetMotion === 'grinding') return 'Make a circular motion!';
    if (targetMotion === 'up_down') return 'Dip it many times!';
    if (targetMotion === 'press_down') return 'Press down once firmly!';
    return 'Do the motion now!';
  }

  // ── Listener cleanup ──────────────────────────────────────────────────────

  function cleanupListeners(): void {
    if (motionHandler)           { document.removeEventListener('motion-detected',       motionHandler);           motionHandler = null; }
    if (keyHandler)              { document.removeEventListener('keydown',                keyHandler);              keyHandler = null; }
    if (promptHandler)           { document.removeEventListener('tutorial-prompt',        promptHandler);           promptHandler = null; }
    if (countdownHandler)        { document.removeEventListener('tutorial-countdown',     countdownHandler);        countdownHandler = null; }
    if (nfcWrongHandler)         { document.removeEventListener('tutorial-nfc-wrong',     nfcWrongHandler);         nfcWrongHandler = null; }
    if (motionFailedHandler)     { document.removeEventListener('tutorial-motion-failed', motionFailedHandler);     motionFailedHandler = null; }
    if (tutorialCompleteHandler) { document.removeEventListener('tutorial-complete',      tutorialCompleteHandler); tutorialCompleteHandler = null; }
    stopMotionTimer();
  }

  function stopMotionTimer(): void {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (timerRaf)      { cancelAnimationFrame(timerRaf); timerRaf = null; }
    const timerEl = page.querySelector('#td-timer') as HTMLElement | null;
    if (timerEl) {
      timerEl.textContent = '';
      timerEl.style.removeProperty('--sweep');
      timerEl.removeAttribute('data-state');
    }
  }

  /** Start the 8-second sweep ring timer. Calls onExpire when time runs out. */
  function startMotionTimer(duration: number, onExpire: () => void): void {
    stopMotionTimer();
    const timerEl = page.querySelector('#td-timer') as HTMLElement | null;
    if (!timerEl) return;

    let remaining     = duration;
    const totalMs     = duration * 1000;
    const startMs     = performance.now();
    timerEl.textContent   = String(remaining);
    timerEl.dataset.state = 'high';

    function animateTimer(): void {
      const elapsed  = performance.now() - startMs;
      const fraction = Math.max(0, 1 - elapsed / totalMs);
      timerEl!.style.setProperty('--sweep', `${(fraction * 360).toFixed(1)}deg`);
      if (fraction > 0) timerRaf = requestAnimationFrame(animateTimer);
    }
    timerRaf = requestAnimationFrame(animateTimer);

    timerInterval = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        timerEl.textContent   = String(remaining);
        const pct = remaining / duration;
        timerEl.dataset.state = pct > 0.4 ? 'high' : pct > 0.15 ? 'medium' : 'low';
      } else {
        timerEl.textContent = '';
        clearInterval(timerInterval!);
        timerInterval = null;
        onExpire();
      }
    }, 1000);
  }

  /* ── Activate / deactivate ── */
  const observer = new MutationObserver(() => {
    if (page.classList.contains('active')) {
      resolved      = false;
      successCount  = 0;
      lastSuccessAt = 0;
      hasMatchingPrompt = false;
      hidePopup(page);
      updateCounter(page, 0, REQUIRED_SUCCESSES);

      const motion = (page.dataset.motion ?? 'grinding') as MotionType;
      setupDetail(page, motion);

      // Tell backend we are in tutorial mode
      void tutorialBridge.waitForConnection(2000).then(connected => {
        if (connected) tutorialBridge.sendUiState('tutorial', motion);
      });

      // Tear down previous component
      (page.querySelector('#td-grinder-container') as HTMLElement).innerHTML = '';
      grinder = dipTut = pressTut = null;
      cup = xyMap = zStrip = null;

      // Sensor visualiser
      const cupContainer = page.querySelector('#td-cup-container') as HTMLElement;
      cupContainer.innerHTML = '';
      const motionStr = motion as string;
      if (motionStr === 'grinding') {
        xyMap = new SensorXYMap(cupContainer, MOTION_META['grinding'].arrow, 0.65);
        xyMap.startListening();
      } else if (motionStr === 'up_down') {
        zStrip = new SensorZStrip(cupContainer, MOTION_META['up_down'].arrow, 0.65);
        zStrip.startListening();
      } else if (motionStr === 'press_down') {
        zStrip = new SensorZStrip(cupContainer, MOTION_META['press_down'].arrow, 0.65);
        zStrip.startListening();
      } else {
        cup = new CupFill(cupContainer);
        cup.startListening();
      }

      // Tutorial animation component
      const container = page.querySelector('#td-grinder-container') as HTMLElement;
      const demoEl    = page.querySelector('#td-demo')     as HTMLElement;
      const feedbackEl = page.querySelector('#td-feedback') as HTMLElement;

      if (motion === 'grinding') {
        grinder = new GrinderTutorial(container);
        // start() registers the internal motion-detected listener for self-driven
        // mode; TutorialDetail also calls triggerSuccess/Wrong directly as needed.
        grinder.start();
        demoEl.style.display    = 'none';
        feedbackEl.style.display = 'none';
      } else if (motion === 'up_down') {
        dipTut = new DipTutorial(container);
        dipTut.start();
        demoEl.style.display    = 'none';
        feedbackEl.style.display = 'none';
      } else if (motion === 'press_down') {
        pressTut = new PressTutorial(container);
        pressTut.start();
        demoEl.style.display    = 'none';
        feedbackEl.style.display = 'none';
      } else {
        demoEl.style.display    = 'flex';
        feedbackEl.style.display = 'flex';
      }

      const resetFeedbackVisuals = (): void => {
        setTimeout(() => { cup?.reset(); xyMap?.reset(); zStrip?.reset(); }, 500);
      };

      // ── Wire backend or keyboard ─────────────────────────────────────────
      tutorialBridge.connect();
      const scanPromptEl = page.querySelector('#td-scan-prompt') as HTMLElement;

      let usingKeyboardFallback = false;

      const setupBackendOrKeyboard = (backendConnected: boolean): void => {
        if (backendConnected) {
        usingKeyboardFallback = false;
        let motionWindowStarted = false;

        const startBackendMotionWindow = (): void => {
          if (motionWindowStarted || resolved) return;
          motionWindowStarted = true;
          countdownFlash.hide();
          startMotionTimer(8, () => {
            stopMotionTimer();
            flashRadial(page, 'wrong');
            triggerWrong();
            resetFeedbackVisuals();
          });
        };

        // ── Backend path ───────────────────────────────────────────────────

        promptHandler = ((e: Event) => {
          const detail = (e as CustomEvent).detail as {
            motion: MotionType; tool: string; action: number; totalActions: number;
          };
          if (detail.motion !== motion) return;

          hasMatchingPrompt = true; // unlock countdown handling for this page
          motionWindowStarted = false;
          stopMotionTimer();

          scanPromptEl.classList.remove('hidden');
          scanPromptEl.textContent = `Show your ${detail.tool} to Mr Spork`;
          updateStatus(page, 'Waiting for NFC scan…', 'var(--text-muted)');
        });
        document.addEventListener('tutorial-prompt', promptHandler);

        countdownHandler = ((e: Event) => {
          // If prompt arrived before this page listener, recover on first countdown tick.
          if (!hasMatchingPrompt) {
            hasMatchingPrompt = true;
          }

          const detail = (e as CustomEvent).detail as { seconds: number };
          scanPromptEl.classList.remove('hidden');
          scanPromptEl.textContent =
            detail.seconds > 0 ? 'Get ready...' : motionInstructionText(motion);

          if (detail.seconds <= 1) {
            updateStatus(page, motionInstructionText(motion), 'var(--accent-gold)');
          }

          if (detail.seconds > 0) {
            countdownFlash.flash(detail.seconds);
            if (detail.seconds === 1) {
              setTimeout(() => {
                if (!page.classList.contains('active')) return;
                startBackendMotionWindow();
              }, 1000);
            }
          } else {
            startBackendMotionWindow();
          }
        });
        document.addEventListener('tutorial-countdown', countdownHandler);

        nfcWrongHandler = (() => {
          if (!hasMatchingPrompt) return;
          scanPromptEl.classList.remove('hidden');
          scanPromptEl.textContent = 'Wrong tool — try again!';
          flashRadial(page, 'wrong');
          triggerWrong();
          resetFeedbackVisuals();
        });
        document.addEventListener('tutorial-nfc-wrong', nfcWrongHandler);

        motionFailedHandler = (() => {
          if (!hasMatchingPrompt) return;
          stopMotionTimer();
          scanPromptEl.classList.add('hidden');
          updateStatus(page, 'Not quite — try again!', 'var(--accent-rose)');
          flashRadial(page, 'wrong');
          triggerWrong();
          resetFeedbackVisuals();
        });
        document.addEventListener('tutorial-motion-failed', motionFailedHandler);

        // motion-detected is emitted by tutorialBridge when result.passed === true
        motionHandler = createMotionListener(page, motion,
          (confidence) => {
            if (resolved) return;
            const now = Date.now();
            if (now - lastSuccessAt < SUCCESS_DEBOUNCE_MS) return;
            lastSuccessAt = now;

            stopMotionTimer();
            scanPromptEl.classList.add('hidden');
            triggerSuccess();
            cup?.confirmFill(confidence);
            xyMap?.confirm();
            zStrip?.confirm();
            successCount = Math.min(REQUIRED_SUCCESSES, successCount + SUCCESS_STEP);
            updateCounter(page, successCount, REQUIRED_SUCCESSES);

            if (successCount >= REQUIRED_SUCCESSES) {
              resolved = true;
              flashRadial(page, 'success');
              setTimeout(() => autoNavigateToNext(page), 500);
            } else {
              setTimeout(() => { cup?.reset(); xyMap?.reset(); zStrip?.reset(); }, 1200);
              flashRadial(page, 'success');
            }
          },
          () => { triggerWrong(); resetFeedbackVisuals(); },
        );
        document.addEventListener('motion-detected', motionHandler);

        // tutorial-complete fires after all 3 steps — only relevant on last step
        if (motion === TUTORIAL_ORDER[TUTORIAL_ORDER.length - 1]) {
          tutorialCompleteHandler = (() => {
            if (resolved) return;
            resolved = true;
            triggerSuccess();
            onSuccess(page);
          });
          document.addEventListener('tutorial-complete', tutorialCompleteHandler);
        }

      } else {
        usingKeyboardFallback = true;
        // ── Keyboard fallback ──────────────────────────────────────────────
        // Flow: Space = simulate NFC scan → 3-2-1 countdown flash →
        //       8s motion timer → Space = correct, any key = wrong

        let scanDone = false;

        // Phase 1: show scan prompt, wait for Space to simulate NFC
        scanPromptEl.classList.remove('hidden');
        scanPromptEl.textContent = `Show your ${MOTION_META[motion].prop} to Mr Spork`;

        const enterMotionPhase = (): void => {
          // Phase 3: 8-second motion window — register handlers + start timer
          // Always clean up any stale handlers before registering new ones
          if (motionHandler) { document.removeEventListener('motion-detected', motionHandler); motionHandler = null; }
          if (keyHandler)    { document.removeEventListener('keydown', keyHandler);             keyHandler = null; }

          scanPromptEl.classList.remove('hidden');
          scanPromptEl.textContent = motionInstructionText(motion);
          updateStatus(page, motionInstructionText(motion), 'var(--accent-gold)');
          // Show the motion instruction in the main demo area
          const demoText = page.querySelector('#td-demo-text') as HTMLElement | null;
          if (demoText) demoText.textContent = motionInstructionText(motion);

          // Remove scan keyHandler, register motion keyHandler
          if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }

          motionHandler = createMotionListener(page, motion,
            (confidence) => {
              if (resolved) return;
              const now = Date.now();
              if (now - lastSuccessAt < SUCCESS_DEBOUNCE_MS) return;
              lastSuccessAt = now;
              stopMotionTimer();
              triggerSuccess();
              cup?.confirmFill(confidence);
              xyMap?.confirm();
              zStrip?.confirm();
              successCount = Math.min(REQUIRED_SUCCESSES, successCount + SUCCESS_STEP);
              updateCounter(page, successCount, REQUIRED_SUCCESSES);
              if (successCount >= REQUIRED_SUCCESSES) {
                resolved = true;
                flashRadial(page, 'success');
                setTimeout(() => autoNavigateToNext(page), 500);
              } else {
                flashRadial(page, 'success');
                setTimeout(() => {
                  cup?.reset(); xyMap?.reset(); zStrip?.reset();
                  if (!resolved) enterMotionPhase(); // restart motion window
                }, 1200);
              }
            },
            () => { triggerWrong(); resetFeedbackVisuals(); },
          );
          document.addEventListener('motion-detected', motionHandler);

          keyHandler = (e: KeyboardEvent) => {
            if (!page.classList.contains('active')) return;
            if (page.querySelector('#td-popup')!.classList.contains('hidden') === false) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              document.dispatchEvent(new CustomEvent('motion-detected', {
                detail: { motion, confidence: 1 },
              }));
            } else if (e.key.length === 1) {
              triggerWrong();
              resetFeedbackVisuals();
            }
          };
          document.addEventListener('keydown', keyHandler);

          // 8-second timer — on expire treat as fail, restart motion phase
          startMotionTimer(8, () => {
            if (resolved) return;
            flashRadial(page, 'wrong');
            triggerWrong();
            resetFeedbackVisuals();
            setTimeout(() => {
              if (!resolved) enterMotionPhase();
            }, 800);
          });
        };

        const startCountdown = (): void => {
          // Phase 2: 3-2-1 countdown flash, then enter motion phase
          // Clean up all active handlers — nothing should fire during countdown
          if (motionHandler) { document.removeEventListener('motion-detected', motionHandler); motionHandler = null; }
          if (keyHandler)    { document.removeEventListener('keydown', keyHandler);             keyHandler = null; }
          scanPromptEl.textContent = 'Get ready… 3';
          let count = 3;
          countdownFlash?.flash(count);

          const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
              scanPromptEl.textContent = `Get ready… ${count}`;
              countdownFlash?.flash(count);
            } else {
              clearInterval(countInterval);
              countdownFlash?.hide();
              enterMotionPhase();
            }
          }, 1000);
        };

        // Phase 1 keyHandler: Space = simulate NFC scan
        keyHandler = (e: KeyboardEvent) => {
          if (!page.classList.contains('active')) return;
          if (page.querySelector('#td-popup')!.classList.contains('hidden') === false) return;
          if (e.key === ' ' && !scanDone) {
            e.preventDefault();
            scanDone = true;
            startCountdown();
          }
        };
        document.addEventListener('keydown', keyHandler);
      }
      };

      // Register backend listeners immediately so first prompt/countdown cannot be missed.
      setupBackendOrKeyboard(true);

      // If backend doesn't connect shortly, switch to keyboard fallback.
      void tutorialBridge.waitForConnection(2500).then((isConnected) => {
        if (!page.classList.contains('active')) return;
        if (isConnected || hasMatchingPrompt || usingKeyboardFallback) return;
        cleanupListeners();
        setupBackendOrKeyboard(false);
      });

    } else {
      // Leaving page — clean up everything
      cleanupListeners(); // already calls stopMotionTimer()
      countdownFlash.hide();
      if (grinder)  { grinder.destroy();  grinder  = null; }
      if (dipTut)   { dipTut.destroy();   dipTut   = null; }
      if (pressTut) { pressTut.destroy(); pressTut = null; }
      if (cup)      { cup.destroy();      cup      = null; }
      if (xyMap)    { xyMap.destroy();    xyMap    = null; }
      if (zStrip)   { zStrip.destroy();   zStrip   = null; }
    }
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });

  return page;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function setupDetail(page: HTMLElement, motion: MotionType): void {
  const meta = MOTION_META[motion];
  (page.querySelector('#td-emoji') as HTMLElement).innerHTML =
    `<img class="tutorial-detail__asset" src="${meta.asset}" alt="${meta.label}" />`;
  (page.querySelector('#td-prop') as HTMLElement).textContent      = meta.prop;
  (page.querySelector('#td-label') as HTMLElement).textContent     = meta.label;
  (page.querySelector('#td-desc') as HTMLElement).textContent      = meta.description;
  (page.querySelector('#td-status') as HTMLElement).textContent    = 'Waiting for motion…';
  (page.querySelector('#td-status') as HTMLElement).style.color    = 'var(--text-muted)';
  (page.querySelector('#td-confidence-fill') as HTMLElement).style.width = '0%';
  (page.querySelector('#td-demo-text') as HTMLElement).textContent = 'Perform the motion to see feedback';
}

function updateStatus(page: HTMLElement, text: string, color: string): void {
  const el = page.querySelector('#td-status') as HTMLElement;
  el.textContent = text;
  el.style.color = color;
}

function createMotionListener(
  page: HTMLElement,
  expectedMotion: MotionType,
  onCorrect: (confidence: number) => void,
  onWrongMotion?: () => void,
) {
  return (e: Event) => {
    const { motion, confidence } = (e as CustomEvent).detail as {
      motion: MotionType; confidence: number;
    };
    const statusEl = page.querySelector('#td-status') as HTMLElement;
    const fillEl   = page.querySelector('#td-confidence-fill') as HTMLElement;
    const demoText = page.querySelector('#td-demo-text') as HTMLElement;

    if (motion === expectedMotion) {
      const pct = Math.round(confidence * 100);
      statusEl.textContent    = `Detected! ${pct}% confidence`;
      statusEl.style.color    = 'var(--accent-sage)';
      fillEl.style.width      = `${pct}%`;
      fillEl.style.background = 'var(--accent-sage)';
      demoText.textContent    = 'Great job!';
      onCorrect(confidence);
    } else {
      const label = MOTION_META[motion]?.label ?? 'wrong motion';
      statusEl.textContent    = `Detected "${label}" — try the correct motion`;
      statusEl.style.color    = 'var(--accent-rose)';
      fillEl.style.width      = '20%';
      fillEl.style.background = 'var(--accent-rose)';
      onWrongMotion?.();
    }
  };
}

/* ── Visual feedback ─────────────────────────────────────────────────────── */

function flashRadial(page: HTMLElement, type: 'success' | 'wrong'): void {
  const flash = page.querySelector('#td-flash') as HTMLElement;
  flash.classList.remove('td-flash--success', 'td-flash--wrong');
  void flash.offsetWidth;
  flash.classList.add(type === 'success' ? 'td-flash--success' : 'td-flash--wrong');
  setTimeout(() => flash.classList.remove('td-flash--success', 'td-flash--wrong'), 700);
}

function onSuccess(page: HTMLElement): void {
  flashRadial(page, 'success');
  setTimeout(() => showPopup(page), 500);
}

function updateCounter(page: HTMLElement, count: number, total: number): void {
  (page.querySelector('#td-counter') as HTMLElement).textContent = `${count} / ${total}`;
}

function showPopup(page: HTMLElement): void {
  const popup = page.querySelector('#td-popup') as HTMLElement;
  const currentMotion = (page.dataset.motion ?? 'grinding') as MotionType;
  const idx    = TUTORIAL_ORDER.indexOf(currentMotion);
  const isLast = idx === TUTORIAL_ORDER.length - 1;

  const stayBtn = popup.querySelector('[data-popup="stay"]') as HTMLButtonElement;
  const redoBtn = popup.querySelector('[data-popup="redo"]') as HTMLButtonElement;
  const nextBtn = popup.querySelector('[data-popup="next"]') as HTMLButtonElement;

  if (isLast) {
    stayBtn.textContent = 'Try Again';
    redoBtn.classList.remove('hidden');
    redoBtn.textContent = 'Redo Tutorial';
    nextBtn.textContent = 'Start Game';
    (popup.querySelector('.td-popup__title') as HTMLElement).textContent = 'Tutorials Complete!';
    (popup.querySelector('.td-popup__text') as HTMLElement).textContent  =
      'You\'ve practised all the motions. Ready to play?';
  } else {
    stayBtn.textContent = 'Try Again';
    redoBtn.classList.add('hidden');
    nextBtn.textContent = 'Next Tutorial';
    (popup.querySelector('.td-popup__title') as HTMLElement).textContent = 'Nice work!';
    (popup.querySelector('.td-popup__text') as HTMLElement).textContent  = 'You completed this motion.';
  }

  popup.classList.remove('hidden');
}

function hidePopup(page: HTMLElement): void {
  page.querySelector('#td-popup')!.classList.add('hidden');
}

function handleStay(page: HTMLElement): void {
  hidePopup(page);
  page.classList.remove('active');
  requestAnimationFrame(() => page.classList.add('active'));
}

function handleRedo(page: HTMLElement): void {
  hidePopup(page);
  page.classList.add('td-slide-out-left');
  setTimeout(() => {
    page.classList.remove('td-slide-out-left', 'active');
    page.style.display = 'none';
    router.go('tutorial-detail', { motion: TUTORIAL_ORDER[0] });
  }, 450);
}

function handleNext(page: HTMLElement): void {
  hidePopup(page);
  autoNavigateToNext(page);
}

function autoNavigateToNext(page: HTMLElement): void {
  const currentMotion = (page.dataset.motion ?? 'grinding') as MotionType;
  const idx = TUTORIAL_ORDER.indexOf(currentMotion);

  if (idx < TUTORIAL_ORDER.length - 1) {
    const nextMotion = TUTORIAL_ORDER[idx + 1];
    page.classList.add('td-slide-out-left');
    setTimeout(() => {
      page.classList.remove('td-slide-out-left', 'active');
      page.style.display = 'none';
      router.go('tutorial-detail', { motion: nextMotion });
    }, 450);
  } else {
    router.go('play', { levelId: '1' });
  }
}