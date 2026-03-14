/**
 * Play page — runs through a level's sequence of motions.
 *
 * Shows:
 *  - Current motion prompt
 *  - Cup fill (accuracy)
 *  - Step progress indicator
 */
import { router } from './router.ts';
import { LEVELS, MOTION_META, type MotionType, type GameLevel, type SavedChoreography } from '../types/motion.types.ts';

import { CupFill } from '../components/CupFill.ts';
import { MotionPrompt } from '../components/MotionPrompt.ts';

const CHOREO_REPLAY_STORAGE_KEY = 'spork_choreo_replay';

type PlayStep = {
  motion: MotionType;
  duration: number;
  label: string;
  description: string;
  tool?: string;
};

function formatToolName(tool?: string, fallback?: string): string {
  const raw = (tool ?? fallback ?? 'Tool').trim();
  if (!raw) return fallback ?? 'Tool';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function loadChoreographyReplay(replayId?: string): SavedChoreography | null {
  if (!replayId) return null;

  try {
    const raw = sessionStorage.getItem(CHOREO_REPLAY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedChoreography;
    if (parsed.id !== replayId || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createPlayPage(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'play';
  page.className = 'page';

  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>
    <div class="play-timer" id="play-timer"></div>
    <div class="play-round">
      <h2 id="play-title"></h2>
      <div id="play-progress" class="play-progress-dots"></div>
      <div id="play-stamps" class="play-stamps"></div>
      <div id="play-prompt-area" class="sr-only"></div>
      <div id="play-scan-prompt" class="play-scan-prompt hidden"></div>
      <div id="play-arrow-area" class="play-arrow-wrap"></div>
      <div id="play-cup-area" class="play-cup-wrap"></div>
      <div id="play-result" class="hidden stack play-result-overlay" style="text-align: center;"></div>
    </div>
  `;

  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => {
      if (page.dataset.replayId) {
        router.go('choreograph');
        return;
      }
      router.go('level-select');
    });

  /* ── Game logic runs when page becomes active ── */
  const observer = new MutationObserver(() => {
    if (page.classList.contains('active')) {
      startLevel(page);
    }
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });

  return page;
}

/* ── Level runner ── */
function startLevel(page: HTMLElement): void {
  const replayId = page.dataset.replayId?.trim();
  const replay = loadChoreographyReplay(replayId);

  const levelId = parseInt(page.dataset.levelId ?? '1', 10);
  const level: GameLevel = LEVELS.find(l => l.id === levelId) ?? LEVELS[0];

  const isChoreographyReplay = Boolean(replay);
  const runName = replay ? replay.name : level.name;
  const runPassingScore = replay ? 70 : level.passingScore;
  const runSteps: PlayStep[] = replay
    ? replay.steps.map((step, index) => ({
      motion: step.motion,
      duration: 8,
      label: `Step ${index + 1}`,
      description: MOTION_META[step.motion].description,
      tool: step.tool,
    }))
    : level.steps;

  const VISUAL_STAMP_COUNT = runSteps.length;
  const stampVisualClasses = Array.from({ length: VISUAL_STAMP_COUNT }, (_, i) => `stamp-${i + 1}`);

  const titleEl = page.querySelector('#play-title') as HTMLElement;
  const progressEl = page.querySelector('#play-progress') as HTMLElement;
  const stampsEl = page.querySelector('#play-stamps') as HTMLElement;
  const promptArea = page.querySelector('#play-prompt-area') as HTMLElement;
  const scanPromptEl = page.querySelector('#play-scan-prompt') as HTMLElement;
  const arrowArea = page.querySelector('#play-arrow-area') as HTMLElement;
  const cupArea = page.querySelector('#play-cup-area') as HTMLElement;
  const timerEl = page.querySelector('#play-timer') as HTMLElement;
  const resultArea = page.querySelector('#play-result') as HTMLElement;

  // Reset
  titleEl.textContent = isChoreographyReplay ? `Replay: ${runName}` : runName;
  progressEl.innerHTML = '';
  stampsEl.innerHTML = '';
  promptArea.innerHTML = '';
  scanPromptEl.innerHTML = '';
  scanPromptEl.classList.add('hidden');
  arrowArea.innerHTML = '';
  cupArea.innerHTML = '';
  resultArea.innerHTML = '';
  resultArea.classList.add('hidden');

  // Build progress dots
  const dots: HTMLElement[] = Array.from({ length: VISUAL_STAMP_COUNT }, (_, i) => {
    const dot = document.createElement('span');
    dot.className = 'play-progress-dot';
    dot.title = `Step ${i + 1}`;
    progressEl.appendChild(dot);
    return dot;
  });

  const stamps: HTMLElement[] = Array.from({ length: VISUAL_STAMP_COUNT }, (_, i) => {
    const stepMotion = runSteps[i].motion;
    const assetSrc = MOTION_META[stepMotion].asset;
    const assetAlt = MOTION_META[stepMotion].label;
    const stamp = document.createElement('div');
    stamp.className = `play-stamp ${stampVisualClasses[i]}`;
    stamp.title = formatToolName(runSteps[i].tool, MOTION_META[stepMotion].prop);
    stamp.innerHTML = `
      <div class="play-stamp__inner">
        <img class="play-stamp__asset" src="${assetSrc}" alt="${assetAlt}" />
      </div>
    `;
    stampsEl.appendChild(stamp);
    return stamp;
  });

  const cup = new CupFill(cupArea);
  const prompt = new MotionPrompt(promptArea);

  let currentStep = 0;
  let completedCorrect = 0;
  let score = 0;
  let motionHandler: ((e: Event) => void) | null = null;
  let scanHandler: ((e: Event) => void) | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let timerRaf: number | null = null;

  function updateVisualProgress(): void {
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-complete', i < completedCorrect);
    });

    stamps.forEach((stamp, i) => {
      stamp.classList.toggle('is-active', i < completedCorrect);
    });

    cup.setFill(Math.min(completedCorrect, VISUAL_STAMP_COUNT) / VISUAL_STAMP_COUNT);
  }

  function flashWrongStamp(): void {
    const targetIndex = Math.min(completedCorrect, VISUAL_STAMP_COUNT - 1);
    const stamp = stamps[targetIndex];
    if (!stamp) return;

    stamp.classList.remove('is-wrong');
    void stamp.offsetWidth;
    stamp.classList.add('is-wrong');

    setTimeout(() => {
      stamp.classList.remove('is-wrong');
    }, 320);
  }

  updateVisualProgress();

  /** Clean up all active listeners and timers */
  function cleanupListeners(): void {
    if (motionHandler) { document.removeEventListener('motion-detected', motionHandler); motionHandler = null; }
    if (scanHandler) { document.removeEventListener('tool-scanned', scanHandler); scanHandler = null; }
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (timerRaf) { cancelAnimationFrame(timerRaf); timerRaf = null; }
    timerEl.textContent = '';
    timerEl.style.removeProperty('--sweep');
    timerEl.removeAttribute('data-state');
  }

  /**
   * Phase 1 — Scan: show the component and ask the user to scan it.
   * Waits for an NFC `tool-scanned` event or a keypress fallback.
   */
  function advance(): void {
    if (currentStep >= runSteps.length) {
      finish();
      return;
    }

    const step = runSteps[currentStep];
    const meta = MOTION_META[step.motion];

    // Show component prompt (hidden arrow for now)
    prompt.show(step.motion);
    arrowArea.innerHTML = '';

    // Show scan instruction
    scanPromptEl.classList.remove('hidden');
    scanPromptEl.textContent = `Show your ${formatToolName(step.tool, meta.prop)} to Mr Spork`;

    // Listen for NFC scan
    scanHandler = ((e: Event) => {
      const detail = (e as CustomEvent).detail as { tool: string };
      // Accept any scan for now; can validate tool type later
      if (detail.tool) {
        onScanComplete();
      }
    });
    document.addEventListener('tool-scanned', scanHandler);

    // Keyboard fallback for scan phase (Space / Enter = simulate scan)
    keyHandler = (e: KeyboardEvent) => {
      if (!page.classList.contains('active')) return;
      if (!resultArea.classList.contains('hidden')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onScanComplete();
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  /**
   * Phase 2 — Motion: stamp is colourful, show the arrow, start timer.
   */
  function onScanComplete(): void {
    // Clean up scan listeners
    if (scanHandler) { document.removeEventListener('tool-scanned', scanHandler); scanHandler = null; }
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }

    const step = runSteps[currentStep];
    const meta = MOTION_META[step.motion];

    // Update scan prompt to motion instruction
    scanPromptEl.classList.remove('hidden');
    scanPromptEl.textContent = 'Do the following motion!';

    // Activate stamp (colourful) on scan
    if (currentStep < VISUAL_STAMP_COUNT) {
      const stamp = stamps[currentStep];
      stamp.classList.add('is-scanned');
      stamp.classList.remove('pop');
      void stamp.offsetWidth;
      stamp.classList.add('pop');
      setTimeout(() => stamp.classList.remove('pop'), 320);
    }

    // Now show the motion arrow
    const arrowSrc = meta.arrow;
    arrowArea.innerHTML = `<img class="play-arrow" src="${arrowSrc}" alt="${meta.label} motion" />`;

    // Start countdown for the motion
    prompt.startTimer(step.duration, () => {
      // Timer expired — fail this step
      prompt.markFail();
      flashWrongStamp();
      cleanupListeners();
      currentStep++;
      setTimeout(advance, 800);
    });

    // Start bottom-left timer — sweeping ring (rAF) + inner colour change (interval)
    if (timerInterval) clearInterval(timerInterval);
    if (timerRaf) { cancelAnimationFrame(timerRaf); timerRaf = null; }
    let remaining = step.duration;
    const totalDuration = step.duration;
    const startMs = performance.now();
    const totalMs = totalDuration * 1000;
    timerEl.textContent = String(remaining);
    timerEl.dataset.state = 'high';

    // Smooth ring sweep via rAF
    function animateTimer(): void {
      const elapsed = performance.now() - startMs;
      const fraction = Math.max(0, 1 - elapsed / totalMs);
      timerEl.style.setProperty('--sweep', `${(fraction * 360).toFixed(1)}deg`);
      if (fraction > 0) timerRaf = requestAnimationFrame(animateTimer);
    }
    timerRaf = requestAnimationFrame(animateTimer);

    // Countdown text + inner colour state each second
    timerInterval = setInterval(() => {
      remaining--;
      timerEl.textContent = remaining > 0 ? String(remaining) : '';

      const pct = remaining / totalDuration;
      if (pct > 0.4) timerEl.dataset.state = 'high';
      else if (pct > 0.15) timerEl.dataset.state = 'medium';
      else timerEl.dataset.state = 'low';

      if (remaining <= 0) {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      }
    }, 1000);

    // Listen for matching motion
    motionHandler = ((e: Event) => {
      const detail = (e as CustomEvent).detail as { motion: MotionType; confidence: number };

      if (detail.motion === step.motion) {
        prompt.stopTimer();
        prompt.markSuccess();
        score += detail.confidence;

        completedCorrect++;
        updateVisualProgress();
        cup.splash();

        cleanupListeners();
        currentStep++;
        setTimeout(advance, 800);
      } else {
        flashWrongStamp();
      }
    });
    document.addEventListener('motion-detected', motionHandler);

    // Keyboard fallback for motion phase (Space / Enter = simulate correct motion)
    keyHandler = (e: KeyboardEvent) => {
      if (!page.classList.contains('active')) return;
      if (!resultArea.classList.contains('hidden')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const synth = new CustomEvent('motion-detected', {
          detail: { motion: step.motion, confidence: 1 },
        });
        document.dispatchEvent(synth);
      } else if (e.key.length === 1) {
        flashWrongStamp();
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  function finish(): void {
    prompt.destroy();
    cleanupListeners();

    const pct = Math.round((score / runSteps.length) * 100);
    const passed = pct >= runPassingScore;
    const nextLevel = isChoreographyReplay ? null : LEVELS.find(l => l.id === level.id + 1);

    resultArea.classList.remove('hidden');
    resultArea.innerHTML = `
      <span style="font-size: 3rem;">${passed ? '🎉' : '😅'}</span>
      <h2>${passed ? 'Well Brewed!' : 'Almost There…'}</h2>
      <p>You scored <strong>${pct}%</strong></p>
      <div class="row" style="justify-content: center; gap: var(--space-md); margin-top: var(--space-md);">
        <button class="btn btn--ghost btn--small" data-action="retry">Retry</button>
        ${nextLevel ? '<button class="btn btn--gold btn--small" data-action="next">Next Round</button>' : ''}
        <button class="btn btn--primary btn--small" data-action="menu">${isChoreographyReplay ? 'Back to Recipes' : 'Back to Menu'}</button>
      </div>
    `;

    resultArea.querySelector('[data-action="retry"]')!
      .addEventListener('click', () => startLevel(page));
    if (nextLevel) {
      resultArea.querySelector('[data-action="next"]')!
        .addEventListener('click', () => {
          router.go('play', { levelId: String(nextLevel.id) });
        });
    }
    resultArea.querySelector('[data-action="menu"]')!
      .addEventListener('click', () => {
        if (isChoreographyReplay) {
          router.go('choreograph');
          return;
        }
        router.home();
      });
  }

  advance();
}
