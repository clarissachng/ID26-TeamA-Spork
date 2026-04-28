/**
 * Multiplayer page — choose between starting a new round or viewing the leaderboard.
 * "New Round" opens a popup for player names, then navigates to the split-screen game.
 */
import { router } from './router.ts';

export function createMultiplayer(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'multiplayer';
  page.className = 'page menu-bg';

  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>

    <div class="mp-menu-wrapper">
      <div class="mp-menu-header">
        <h2>Multiplayer</h2>
        <p class="subtitle">Brew together — who's the better barista?</p>
      </div>
      <div class="mp-menu-buttons">
        <button class="mp-choice-btn mp-choice-btn--primary" data-action="new-round">New Round</button>
        <button class="mp-choice-btn" data-action="view-leaderboard">View Leaderboard</button>
      </div>
    </div>

    <!-- Name input popup -->
    <div class="mp-popup hidden" id="mp-name-popup">
      <div class="mp-popup__card">
        <h3 class="mp-popup__title">Enter Player Names</h3>
        <div class="mp-popup__fields">
          <label class="mp-popup__label">
            Player 1
            <input
              class="mp-popup__input"
              id="mp-p1-name"
              type="text"
              placeholder="Player 1"
              maxlength="20"
            />
          </label>
          <label class="mp-popup__label">
            Player 2
            <input
              class="mp-popup__input"
              id="mp-p2-name"
              type="text"
              placeholder="Player 2"
              maxlength="20"
            />
          </label>
        </div>
        <div class="mp-popup__actions">
          <button class="btn btn--ghost btn--small" data-popup="cancel">Cancel</button>
          <button class="btn btn--gold btn--small" data-popup="start">Let's Brew!</button>
        </div>
      </div>
    </div>
  `;

  const popup   = page.querySelector('#mp-name-popup') as HTMLElement;
  const p1Input = page.querySelector('#mp-p1-name')   as HTMLInputElement;
  const p2Input = page.querySelector('#mp-p2-name')   as HTMLInputElement;

  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => router.go('main-menu'));

  page.querySelector('[data-action="view-leaderboard"]')!
    .addEventListener('click', () => router.go('leaderboard'));

  page.querySelector('[data-action="new-round"]')!
    .addEventListener('click', () => {
      p1Input.value = '';
      p2Input.value = '';
      popup.classList.remove('hidden');
      p1Input.focus();
    });

  page.querySelector('[data-popup="cancel"]')!
    .addEventListener('click', () => popup.classList.add('hidden'));

  page.querySelector('[data-popup="start"]')!
    .addEventListener('click', () => {
      const p1 = p1Input.value.trim() || 'Player 1';
      const p2 = p2Input.value.trim() || 'Player 2';
      popup.classList.add('hidden');
      router.go('multiplayer-play', { p1Name: p1, p2Name: p2 });
    });

  // Allow Enter key to submit from either input
  [p1Input, p2Input].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const p1 = p1Input.value.trim() || 'Player 1';
        const p2 = p2Input.value.trim() || 'Player 2';
        popup.classList.add('hidden');
        router.go('multiplayer-play', { p1Name: p1, p2Name: p2 });
      }
    });
  });

  return page;
}
