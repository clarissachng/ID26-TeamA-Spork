/**
 * TutorialDetail page — shows what motion to perform for a specific prop,
 * with a visual demonstration area and real-time sensor feedback.
 *
 * Special case: "circle" motion uses the GrinderTutorial component.
 */
import { router } from './router.ts';
import { MOTION_META, type MotionType } from '../types/motion.types.ts';
import { GrinderTutorial } from '../components/GrinderTutorial.ts';

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

      <!-- Special grinder demo for circle motion — will be populated by setupDetail -->
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
  `;

  /* ── Back ── */
  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => router.go('tutorial'));

  /* ── Update content when page becomes active ── */
  let motionHandler: ((e: Event) => void) | null = null;
  let grinder: GrinderTutorial | null = null;

  const observer = new MutationObserver(() => {
    if (page.classList.contains('active')) {
      const motion = (page.dataset.motion ?? 'stir') as MotionType;
      setupDetail(page, motion);

      if (motion === 'circle') {
        // Use grinder component for circle motion
        const grinderContainer = page.querySelector('#td-grinder-container') as HTMLElement;
        grinder = new GrinderTutorial(grinderContainer);
        grinder.start();
        // Hide generic demo and feedback
        (page.querySelector('#td-demo') as HTMLElement).style.display = 'none';
        (page.querySelector('#td-feedback') as HTMLElement).style.display = 'none';
      } else {
        // Use generic demo for other motions
        (page.querySelector('#td-demo') as HTMLElement).style.display = 'flex';
        (page.querySelector('#td-feedback') as HTMLElement).style.display = 'flex';
        motionHandler = createMotionListener(page, motion);
        document.addEventListener('motion-detected', motionHandler);
      }
    } else {
      // Clean up listener when leaving
      if (motionHandler) {
        document.removeEventListener('motion-detected', motionHandler);
        motionHandler = null;
      }
      if (grinder) {
        grinder.destroy();
        grinder = null;
      }
    }
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });

  return page;
}

function setupDetail(page: HTMLElement, motion: MotionType): void {
  const meta = MOTION_META[motion];
  (page.querySelector('#td-emoji') as HTMLElement).textContent = meta.emoji;
  (page.querySelector('#td-prop') as HTMLElement).textContent = meta.prop;
  (page.querySelector('#td-label') as HTMLElement).textContent = meta.label;
  (page.querySelector('#td-desc') as HTMLElement).textContent = meta.description;
  (page.querySelector('#td-status') as HTMLElement).textContent = 'Waiting for motion…';
  (page.querySelector('#td-status') as HTMLElement).style.color = 'var(--text-muted)';
  (page.querySelector('#td-confidence-fill') as HTMLElement).style.width = '0%';
  (page.querySelector('#td-demo-text') as HTMLElement).textContent = 'Perform the motion to see feedback';
}

function createMotionListener(page: HTMLElement, expectedMotion: MotionType) {
  return (e: Event) => {
    const { motion, confidence } = (e as CustomEvent).detail as { motion: MotionType; confidence: number };
    const statusEl = page.querySelector('#td-status') as HTMLElement;
    const fillEl = page.querySelector('#td-confidence-fill') as HTMLElement;
    const demoText = page.querySelector('#td-demo-text') as HTMLElement;

    if (motion === expectedMotion) {
      const pct = Math.round(confidence * 100);
      statusEl.textContent = `✅ Detected! ${pct}% confidence`;
      statusEl.style.color = 'var(--accent-sage)';
      fillEl.style.width = `${pct}%`;
      fillEl.style.background = 'var(--accent-sage)';
      demoText.textContent = '🎉 Great job!';
    } else {
      const meta = MOTION_META[motion];
      statusEl.textContent = `Detected "${meta.label}" — try the correct motion`;
      statusEl.style.color = 'var(--accent-rose)';
      fillEl.style.width = '20%';
      fillEl.style.background = 'var(--accent-rose)';
    }
  };
}
