/**
 * LevelSelect page — pick one of 3 rounds.
 *
 * Round 1 → 3-step sequence
 * Round 2 → 5-step sequence
 * Round 3 → 7-step sequence
 */
import { router } from './router.ts';
import { LEVELS } from '../types/motion.types.ts';
import { assetUrl } from '../utils/asset.ts';

export function createLevelSelect(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'level-select';
  page.className = 'page level-select-bg';

  /* ── Static shell ── */
  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>
    <div class="stack stack--xl" style="text-align: center; width: 100%; max-width: 720px;">
      <div>
        <h2>Choose Your Brew</h2>
        <p class="subtitle">Each recipe gets more complex</p>
      </div>
      <div class="grid-3 stagger-children" id="level-cards"></div>
    </div>
  `;

  /* ── Generate round cards ── */
  const grid = page.querySelector('#level-cards')!;

  LEVELS.forEach((level) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const stepsText = `${level.steps.length} step${level.steps.length > 1 ? 's' : ''}`;
    const roundLabel = `Round ${level.id}`;

    card.innerHTML = `
      <div class="card__emoji"><img class="card__asset" src="${levelAsset(level.id)}" alt="${roundLabel}" /></div>
      <div class="card__title">${roundLabel}: ${level.name}</div>
      <div class="card__subtitle">${stepsText} · ${level.description}</div>
    `;

    card.addEventListener('click', () => {
      router.go('play', { levelId: String(level.id) });
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        router.go('play', { levelId: String(level.id) });
      }
    });

    grid.appendChild(card);
  });

  /* ── Back button ── */
  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => router.home());

  return page;
}

function levelAsset(id: number): string {
  if (id === 1) return assetUrl('/assets/front_tea.PNG');
  if (id === 2) return assetUrl('/assets/front_grinder.PNG');
  return assetUrl('/assets/front_whisk.PNG');
}
