/**
 * Play page — runs through a level's sequence of motions.
 *
 * Shows:
 *  - Current motion prompt
 *  - Cup fill (accuracy)
 *  - Step progress indicator
 */
import { router } from './router.ts';
import { LEVELS, MOTION_META, type MotionType, type GameLevel } from '../types/motion.types.ts';

import { CupFill } from '../components/CupFill.ts';
import { MotionPrompt } from '../components/MotionPrompt.ts';

export function createPlayPage(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'play';
  page.className = 'page';

  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>
    <div class="play-round">
      <h2 id="play-title"></h2>
      <div id="play-progress" class="play-progress-dots"></div>
      <div id="play-stamps" class="play-stamps"></div>
      <div id="play-prompt-area" class="sr-only"></div>
      <div id="play-cup-area" class="play-cup-wrap"></div>
      <div id="play-result" class="hidden stack play-result-overlay" style="text-align: center;"></div>
    </div>
  `;

  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => router.go('level-select'));

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
  const levelId = parseInt(page.dataset.levelId ?? '1', 10);
  const level: GameLevel = LEVELS.find(l => l.id === levelId) ?? LEVELS[0];

  const VISUAL_STAMP_COUNT = level.steps.length;
  const stampVisualClasses = Array.from({ length: VISUAL_STAMP_COUNT }, (_, i) => `stamp-${i + 1}`);

  const titleEl = page.querySelector('#play-title') as HTMLElement;
  const progressEl = page.querySelector('#play-progress') as HTMLElement;
  const stampsEl = page.querySelector('#play-stamps') as HTMLElement;
  const promptArea = page.querySelector('#play-prompt-area') as HTMLElement;
  const cupArea = page.querySelector('#play-cup-area') as HTMLElement;
  const resultArea = page.querySelector('#play-result') as HTMLElement;

  // Reset
  titleEl.textContent = level.name;
  progressEl.innerHTML = '';
  stampsEl.innerHTML = '';
  promptArea.innerHTML = '';
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
    const motion = level.steps[i]?.motion;
    const assetSrc = motion ? MOTION_META[motion].asset : '';
    const assetAlt = motion ? MOTION_META[motion].label : `Stamp ${i + 1}`;
    const stamp = document.createElement('div');
    stamp.className = `play-stamp ${stampVisualClasses[i]}`;
    stamp.title = `Stamp ${i + 1}`;
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
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

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

  function advance(): void {
    if (currentStep >= level.steps.length) {
      finish();
      return;
    }

    const step = level.steps[currentStep];

    prompt.show(step.motion);
    prompt.startTimer(step.duration, () => {
      // Timer expired — fail this step
      prompt.markFail();
      flashWrongStamp();
      if (motionHandler) {
        document.removeEventListener('motion-detected', motionHandler);
        motionHandler = null;
      }
      if (keyHandler) {
        document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
      }
      currentStep++;
      setTimeout(advance, 800);
    });

    // Listen for matching motion
    motionHandler = ((e: Event) => {
      const detail = (e as CustomEvent).detail as { motion: MotionType; confidence: number };

      if (detail.motion === step.motion) {
        prompt.stopTimer();
        prompt.markSuccess();
        score += detail.confidence;
        if (completedCorrect < VISUAL_STAMP_COUNT) {
          const activatedStamp = stamps[completedCorrect];
          activatedStamp.classList.remove('pop');
          void activatedStamp.offsetWidth;
          activatedStamp.classList.add('pop');
          setTimeout(() => activatedStamp.classList.remove('pop'), 320);
        }

        completedCorrect++;
        updateVisualProgress();
        cup.splash();

        document.removeEventListener('motion-detected', motionHandler!);
        motionHandler = null;
        if (keyHandler) {
          document.removeEventListener('keydown', keyHandler);
          keyHandler = null;
        }
        currentStep++;
        setTimeout(advance, 800);
      } else {
        flashWrongStamp();
      }
    });
    document.addEventListener('motion-detected', motionHandler);

    // Keyboard fallback (when Arduino is not connected)
    keyHandler = (e: KeyboardEvent) => {
      if (!page.classList.contains('active')) return;
      if (!resultArea.classList.contains('hidden')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        // Simulate correct motion
        const synth = new CustomEvent('motion-detected', {
          detail: { motion: step.motion, confidence: 1 },
        });
        document.dispatchEvent(synth);
      } else if (e.key.length === 1) {
        // Any other printable key = wrong
        flashWrongStamp();
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  function finish(): void {
    prompt.destroy();
    if (motionHandler) document.removeEventListener('motion-detected', motionHandler);
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }

    const pct = Math.round((score / level.steps.length) * 100);
    const passed = pct >= level.passingScore;
    const nextLevel = LEVELS.find(l => l.id === level.id + 1);

    resultArea.classList.remove('hidden');
    resultArea.innerHTML = `
      <span style="font-size: 3rem;">${passed ? '🎉' : '😅'}</span>
      <h2>${passed ? 'Well Brewed!' : 'Almost There…'}</h2>
      <p>You scored <strong>${pct}%</strong></p>
      <div class="row" style="justify-content: center; gap: var(--space-md); margin-top: var(--space-md);">
        <button class="btn btn--ghost btn--small" data-action="retry">Retry</button>
        ${nextLevel ? '<button class="btn btn--gold btn--small" data-action="next">Next Round</button>' : ''}
        <button class="btn btn--primary btn--small" data-action="menu">Back to Menu</button>
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
      .addEventListener('click', () => router.home());
  }

  advance();
}
