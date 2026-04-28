/**
 * Leaderboard page — shows multiplayer round history saved in localStorage.
 */
import { router } from './router.ts';
import { loadScores } from './MultiplayerPlay.ts';

export function createLeaderboard(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'leaderboard';
  page.className = 'page leaderboard-bg';

  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>
    <button class="btn btn--ghost btn--small home-btn" data-action="home">
      <span class="btn-icon btn-home-icon"></span>
    </button>
    <div class="lb-wrapper">
      <h2>Leaderboard</h2>
      <p class="subtitle">Recent multiplayer rounds</p>
      <div id="lb-table" class="lb-table"></div>
    </div>
  `;

  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => router.go('multiplayer'));

  page.querySelector('[data-action="home"]')!
    .addEventListener('click', () => router.home());

  /* Re-render scores each time the page becomes active */
  const observer = new MutationObserver(() => {
    if (page.classList.contains('active')) renderScores(page);
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });

  return page;
}

function renderScores(page: HTMLElement): void {
  const tableEl = page.querySelector('#lb-table') as HTMLElement;
  const scores = loadScores();

  if (scores.length === 0) {
    tableEl.innerHTML = '<p style="text-align:center;opacity:0.6;">No rounds played yet.</p>';
    return;
  }

  tableEl.innerHTML = `
    <div class="lb-row lb-row--header">
      <span class="lb-cell lb-cell--date">Date</span>
      <span class="lb-cell">Player 1</span>
      <span class="lb-cell lb-cell--score">Score</span>
      <span class="lb-cell lb-cell--vs">vs</span>
      <span class="lb-cell">Player 2</span>
      <span class="lb-cell lb-cell--score">Score</span>
    </div>
    ${scores.map(s => {
      const p1Pct = Math.round((s.p1.correct / 3) * 100);
      const p2Pct = Math.round((s.p2.correct / 3) * 100);
      const winner = p1Pct > p2Pct ? 'p1' : p2Pct > p1Pct ? 'p2' : 'tie';
      return `
        <div class="lb-row">
          <span class="lb-cell lb-cell--date">${s.date}</span>
          <span class="lb-cell ${winner === 'p1' ? 'lb-cell--winner' : ''}">${s.p1.name}</span>
          <span class="lb-cell lb-cell--score ${winner === 'p1' ? 'lb-cell--winner' : ''}">${p1Pct}%</span>
          <span class="lb-cell lb-cell--vs">vs</span>
          <span class="lb-cell ${winner === 'p2' ? 'lb-cell--winner' : ''}">${s.p2.name}</span>
          <span class="lb-cell lb-cell--score ${winner === 'p2' ? 'lb-cell--winner' : ''}">${p2Pct}%</span>
        </div>`;
    }).join('')}
  `;
}
