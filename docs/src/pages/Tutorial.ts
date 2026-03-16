/**
 * Tutorial page — 3 core motions displayed as tools sitting on the table.
 * Tapping one opens the TutorialDetail screen for that motion.
 */
import { router } from './router.ts';
import { MOTION_META } from '../types/motion.types.ts';
import type { MotionType } from '../types/motion.types.ts';

/** The 4 core motions to teach, in display order */
const CORE_MOTIONS: { motion: MotionType; motionName: string; instruction: string }[] = [
  { motion: 'grinding', motionName: 'Circular',  instruction: 'Rotate in a circle' },
  { motion: 'up_down',     motionName: 'Dip',        instruction: 'Dip up and down rhythmically' },
  { motion: 'press_down',    motionName: 'Press',      instruction: 'Press firmly downward' },
];

export function createTutorial(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'tutorial';
  page.className = 'page tutorial-bg';

  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>
    <div class="tutorial-header">
      <h2>Learn the Moves</h2>
      <p class="subtitle">Pick up each tool and try the motion</p>
    </div>
    <div class="tutorial-table-row stagger-children" id="tool-items"></div>
  `;

  const row = page.querySelector('#tool-items')!;

  CORE_MOTIONS.forEach(({ motion, motionName, instruction }) => {
    const meta = MOTION_META[motion];
    const item = document.createElement('div');
    item.className = 'tutorial-tool-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('title', 'Pick up and scan ↻');

    item.innerHTML = `
      <div class="tutorial-tool-placemat"></div>
      <img class="tutorial-tool-img" src="${meta.asset}" alt="${meta.prop}" />
      <div class="tutorial-tool-label">
        <span class="tutorial-tool-motion">${motionName}</span>
        <span class="tutorial-tool-instruction">${instruction}</span>
      </div>
    `;

    // TODO: replace click with NFC scan trigger
    item.addEventListener('click', () => {
      router.go('tutorial-detail', { motion });
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        router.go('tutorial-detail', { motion });
      }
    });

    row.appendChild(item);
  });

  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => router.home());

  return page;
}
