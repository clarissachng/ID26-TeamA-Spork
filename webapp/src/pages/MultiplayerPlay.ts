/**
 * MultiplayerPlay page — split-screen 2-player game.
 *
 * Flow for each of 3 steps:
 *   1. Player 1 scans → countdown → does the motion
 *   2. Player 2 scans → countdown → does the motion
 * Repeat for 3 steps, then save to leaderboard.
 *
 * Generation counter ensures stale async callbacks from old games can't fire.
 * Keyboard fallback: Space/Enter = scan, then Space/Enter = correct motion.
 */
import { router } from './router.ts';
import { MOTION_META, type MotionType } from '../types/motion.types.ts';
import { CupFill } from '../components/CupFill.ts';
import { CountdownFlash } from '../components/CountdownFlash.ts';
import { SensorXYMap } from '../components/SensorXYMap.ts';
import { SensorZStrip } from '../components/SensorZStrip.ts';
import { assetUrl } from '../utils/asset.ts';

const TOTAL_STEPS    = 3;
const STEP_DURATION  = 8;
const PASS_THRESHOLD = 0.6;
const LEADERBOARD_KEY = 'spork_multiplayer_scores';

const ALL_MOTIONS: MotionType[] = ['grinding', 'up_down', 'press_down'];

const TOOL_ASSETS: Record<string, string> = {
  'Coffee Grinder': assetUrl('/assets/front_grinder.PNG'),
  'Kettle':         assetUrl('/assets/front_milk.PNG'),
  'Coffee Press':   assetUrl('/assets/front_press.PNG'),
  'Sieve':          assetUrl('/assets/front_sieve.PNG'),
  'Spork':          assetUrl('/assets/front_spork.png'),
  'Tea Bag':        assetUrl('/assets/front_tea.PNG'),
  'Tongs':          assetUrl('/assets/front_tongs.png'),
  'Whisk':          assetUrl('/assets/front_whisk.PNG'),
};
const ALL_TOOLS = Object.keys(TOOL_ASSETS);

interface Step { motion: MotionType; tool: string; }

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate 3 steps for each player where:
 *  - Each player uses all 3 motions exactly once (no repeats within a player)
 *  - P1 and P2 never use the same motion on the same step
 *  - All 6 tools across both players are unique (no overlap)
 *  - P1 and P2 never use the same tool on the same step
 */
function randomBothPlayers(): [Step[], Step[]] {
  // Shuffle P1's motions
  const p1Motions = shuffle([...ALL_MOTIONS]);

  // P2's motions: a derangement of P1's (no same motion at same position)
  // With 3 elements there are exactly 2 derangements — pick one at random
  let p2Motions: MotionType[];
  const derangements: MotionType[][] = [
    [p1Motions[1], p1Motions[2], p1Motions[0]],
    [p1Motions[2], p1Motions[0], p1Motions[1]],
  ];
  p2Motions = derangements[Math.floor(Math.random() * 2)];

  // Pick 6 unique tools total, split into two groups of 3
  const toolPool = shuffle([...ALL_TOOLS]);
  const p1Tools = toolPool.slice(0, TOTAL_STEPS);
  const p2Tools = toolPool.slice(TOTAL_STEPS, TOTAL_STEPS * 2);

  const p1Steps: Step[] = p1Motions.map((motion, i) => ({ motion, tool: p1Tools[i] }));
  const p2Steps: Step[] = p2Motions.map((motion, i) => ({ motion, tool: p2Tools[i] }));

  return [p1Steps, p2Steps];
}

/* ── Leaderboard persistence ── */

export interface MultiplayerScore {
  p1: { name: string; correct: number };
  p2: { name: string; correct: number };
  date: string;
}

export function saveScore(score: MultiplayerScore): void {
  const raw = localStorage.getItem(LEADERBOARD_KEY);
  const all: MultiplayerScore[] = raw ? (JSON.parse(raw) as MultiplayerScore[]) : [];
  all.unshift(score);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(all.slice(0, 20)));
}

export function loadScores(): MultiplayerScore[] {
  const raw = localStorage.getItem(LEADERBOARD_KEY);
  return raw ? (JSON.parse(raw) as MultiplayerScore[]) : [];
}

/* ── Page factory ── */

// Active game generation — incremented on every startGame call so stale
// async callbacks from a previous game can detect they're no longer current.
let gameGen = 0;

// Cleanup function for the current game — called by the observer on deactivate
let activeCleanup: (() => void) | null = null;

export function createMultiplayerPlay(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'multiplayer-play';
  page.className = 'page';

  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>

    <div class="mp-status-bar" id="mp-status-bar">Get ready…</div>

    <div class="mp-split-screen">
      <div class="mp-player-panel mp-player-panel--1" id="mp-panel-1">
        <h2 class="mp-player-name" id="mp-name-1">Player 1</h2>
        <div id="play-progress" class="play-progress-dots"></div>
        <div id="mp-stamps-1"></div>
        <div class="mp-player-scan hidden" id="mp-scan-1"></div>
        <div class="mp-player-cup" id="mp-cup-1"></div>
      </div>

      <div class="mp-divider"></div>

      <div class="mp-player-panel mp-player-panel--2" id="mp-panel-2">
        <h2 class="mp-player-name" id="mp-name-2">Player 2</h2>
        <div id="play-progress" class="play-progress-dots"></div>
        <div id="mp-stamps-2"></div>
        <div id="play-scan-prompt" class="play-scan-prompt hidden"></div>

        <div class="mp-player-cup" id="mp-cup-2"></div>
        
      </div>
    </div>

    <div class="play-timer"      id="mp-timer"></div>
    <div class="td-flash"        id="mp-flash"></div>
    <div class="play-sensor-container" id="mp-sensor"></div>
    <div class="mp-result hidden" id="mp-result"></div>
  `;

  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => {
      activeCleanup?.();
      activeCleanup = null;
      router.go('multiplayer');
    });

  const observer = new MutationObserver(() => {
    if (page.classList.contains('active')) {
      startGame(page);
    } else {
      // Page deactivating — tear down the current game immediately
      activeCleanup?.();
      activeCleanup = null;
    }
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });

  return page;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Game runner
   ═══════════════════════════════════════════════════════════════════════════ */

function startGame(page: HTMLElement): void {
  const myGen = ++gameGen;
  const alive = (): boolean => myGen === gameGen && page.classList.contains('active');

  const p1Name = page.dataset.p1Name || 'Player 1';
  const p2Name = page.dataset.p2Name || 'Player 2';

  const [p1Steps, p2Steps] = randomBothPlayers();
  let p1Correct = 0;
  let p2Correct = 0;
  let currentStep = 0;

  /* ── DOM refs ── */
  const statusBar = page.querySelector('#mp-status-bar') as HTMLElement;
  const timerEl   = page.querySelector('#mp-timer')       as HTMLElement;
  const flashEl   = page.querySelector('#mp-flash')       as HTMLElement;
  const resultEl  = page.querySelector('#mp-result')      as HTMLElement;
  const panel1    = page.querySelector('#mp-panel-1')     as HTMLElement;
  const panel2    = page.querySelector('#mp-panel-2')     as HTMLElement;
  const name1El   = page.querySelector('#mp-name-1')      as HTMLElement;
  const name2El   = page.querySelector('#mp-name-2')      as HTMLElement;
  const stamps1El = page.querySelector('#mp-stamps-1')    as HTMLElement;
  const stamps2El = page.querySelector('#mp-stamps-2')    as HTMLElement;
  const cup1El    = page.querySelector('#mp-cup-1')       as HTMLElement;
  const cup2El    = page.querySelector('#mp-cup-2')       as HTMLElement;
  const scan1El   = page.querySelector('#mp-scan-1')      as HTMLElement;
  const scan2El   = page.querySelector('#mp-scan-2')      as HTMLElement;
  const sensorEl  = page.querySelector('#mp-sensor')      as HTMLElement;

  name1El.textContent = p1Name;
  name2El.textContent = p2Name;
  resultEl.classList.add('hidden');
  resultEl.innerHTML = '';

  /* ── Stamps — reuse play-stamp visual style ── */
  const buildStamps = (container: HTMLElement, steps: Step[]): HTMLElement[] => {
    container.innerHTML = '';
    container.className = 'play-stamps mp-play-stamps';
    return steps.map((step, i) => {
      const el = document.createElement('div');
      el.className = `play-stamp stamp-${i + 1}`;
      el.title = step.tool;
      const src = TOOL_ASSETS[step.tool] ?? '';
      el.innerHTML = `<div class="play-stamp__inner">
        <img class="play-stamp__asset" src="${src}" alt="${step.tool}" />
      </div>`;
      container.appendChild(el);
      return el;
    });
  };

  const stamps1 = buildStamps(stamps1El, p1Steps);
  const stamps2 = buildStamps(stamps2El, p2Steps);

  /* ── Cups ── */
  cup1El.innerHTML = '';
  cup2El.innerHTML = '';
  const cup1 = new CupFill(cup1El);
  const cup2 = new CupFill(cup2El);
  const countdown = new CountdownFlash(page);

  /* ── Sensor graph ── */
  let xyMap:  SensorXYMap  | null = null;
  let zStrip: SensorZStrip | null = null;

  function buildSensor(motion: MotionType): void {
    destroySensor();
    if (motion === 'grinding') {
      xyMap = new SensorXYMap(sensorEl, MOTION_META['grinding'].arrow, 0.65);
      xyMap.startListening();
    } else {
      zStrip = new SensorZStrip(
        sensorEl,
        motion === 'up_down' ? MOTION_META['up_down'].arrow : MOTION_META['press_down'].arrow,
        0.65,
      );
      zStrip.startListening();
    }
  }

  function destroySensor(): void {
    xyMap?.destroy();  xyMap  = null;
    zStrip?.destroy(); zStrip = null;
    sensorEl.innerHTML = '';
  }

  /* ── Timer ── */
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let timerRaf: number | null = null;

  function stopTimer(): void {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (timerRaf)      { cancelAnimationFrame(timerRaf); timerRaf = null; }
    timerEl.textContent = '';
    timerEl.style.removeProperty('--sweep');
    timerEl.removeAttribute('data-state');
  }

  function startTimer(duration: number, onExpire: () => void): void {
    stopTimer();
    let remaining = duration;
    const startMs = performance.now();
    const totalMs = duration * 1000;
    timerEl.textContent   = String(remaining);
    timerEl.dataset.state = 'high';

    const animate = (): void => {
      const elapsed  = performance.now() - startMs;
      const fraction = Math.max(0, 1 - elapsed / totalMs);
      timerEl.style.setProperty('--sweep', `${(fraction * 360).toFixed(1)}deg`);
      if (fraction > 0) timerRaf = requestAnimationFrame(animate);
    };
    timerRaf = requestAnimationFrame(animate);

    timerInterval = setInterval(() => {
      remaining--;
      timerEl.textContent = remaining > 0 ? String(remaining) : '';
      const pct = remaining / duration;
      timerEl.dataset.state = pct > 0.4 ? 'high' : pct > 0.15 ? 'medium' : 'low';
      if (remaining <= 0) {
        clearInterval(timerInterval!);
        timerInterval = null;
        onExpire();
      }
    }, 1000);
  }

  /* ── Flash ── */
  function flash(type: 'success' | 'wrong'): void {
    flashEl.classList.remove('td-flash--success', 'td-flash--wrong');
    void flashEl.offsetWidth;
    flashEl.classList.add(type === 'success' ? 'td-flash--success' : 'td-flash--wrong');
    setTimeout(() => flashEl.classList.remove('td-flash--success', 'td-flash--wrong'), 700);
  }

  /* ── Panel dim ── */
  function setActivePanel(player: 1 | 2 | null): void {
    panel1.classList.toggle('mp-player-panel--active', player === 1);
    panel2.classList.toggle('mp-player-panel--active', player === 2);
    panel1.classList.toggle('mp-player-panel--dim',    player === 2);
    panel2.classList.toggle('mp-player-panel--dim',    player === 1);
  }

  /* ── Stamp state ── */
  function markStamp(stamps: HTMLElement[], idx: number, state: 'active' | 'correct' | 'wrong'): void {
    const stamp = stamps[idx];
    if (!stamp) return;
    stamp.classList.remove('is-scanned', 'is-active', 'is-wrong');
    if (state === 'active')  stamp.classList.add('is-scanned');
    if (state === 'correct') stamp.classList.add('is-active');
    if (state === 'wrong')   stamp.classList.add('is-wrong');
  }

  /* ── Handler teardown ── */
  let motionHandler: ((e: Event) => void) | null = null;
  let keyHandler:    ((e: KeyboardEvent) => void) | null = null;

  function cleanupHandlers(): void {
    if (motionHandler) { document.removeEventListener('motion-detected', motionHandler); motionHandler = null; }
    if (keyHandler)    { document.removeEventListener('keydown', keyHandler);             keyHandler = null; }
    stopTimer();
    destroySensor();
    countdown.hide();
  }

  /* Register with the module so the observer can tear down on deactivate */
  activeCleanup = () => {
    cleanupHandlers();
    countdown.destroy();
  };

  /* ═══════════════════════════════════════════════════════════════
     Turn runner
     ═══════════════════════════════════════════════════════════════ */

  function runPlayerTurn(
    player: 1 | 2,
    step: Step,
    stampEls: HTMLElement[],
    stepIdx: number,
    cup: CupFill,
    scanEl: HTMLElement,
    onDone: (correct: boolean) => void,
  ): void {
    if (!alive()) return;

    setActivePanel(player);
    markStamp(stampEls, stepIdx, 'active');

    const playerName = player === 1 ? name1El.textContent : name2El.textContent;
    const motionLabel = MOTION_META[step.motion].label;
    statusBar.textContent = `${playerName}'s turn — scan your ${step.tool}!`;

    scanEl.textContent = `Scan your ${step.tool}`;
    scanEl.classList.remove('hidden');

    let scanDone = false;

    const doCountdown = (): void => {
      if (!alive()) return;
      cleanupHandlers();
      let count = 3;
      countdown.flash(count);
      scanEl.textContent = `Get ready… ${count}`;
      statusBar.textContent = 'Get ready…';

      const interval = setInterval(() => {
        if (!alive()) { clearInterval(interval); return; }
        count--;
        if (count > 0) {
          countdown.flash(count);
          scanEl.textContent = `Get ready… ${count}`;
        } else {
          clearInterval(interval);
          countdown.hide();
          enterMotionPhase();
        }
      }, 1000);
    };

    const enterMotionPhase = (): void => {
      if (!alive()) return;
      buildSensor(step.motion);
      scanEl.textContent = `Do the ${motionLabel} motion!`;
      statusBar.textContent = `${playerName} — do the ${motionLabel} motion!`;

      let resolved = false;

      const onCorrect = (): void => {
        if (resolved || !alive()) return;
        resolved = true;
        cleanupHandlers();
        flash('success');
        cup.splash();
        markStamp(stampEls, stepIdx, 'correct');
        xyMap?.confirm(); zStrip?.confirm();
        scanEl.classList.add('hidden');
        setTimeout(() => { if (alive()) onDone(true); }, 700);
      };

      const onFail = (): void => {
        if (resolved || !alive()) return;
        resolved = true;
        cleanupHandlers();
        flash('wrong');
        markStamp(stampEls, stepIdx, 'wrong');
        scanEl.classList.add('hidden');
        setTimeout(() => { if (alive()) onDone(false); }, 700);
      };

      motionHandler = (e: Event) => {
        if (!alive()) return;
        const { motion, confidence } = (e as CustomEvent).detail as { motion: MotionType; confidence: number };
        if (motion === step.motion && confidence >= PASS_THRESHOLD) onCorrect();
      };
      document.addEventListener('motion-detected', motionHandler);

      keyHandler = (e: KeyboardEvent) => {
        if (!alive()) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('motion-detected', {
            detail: { motion: step.motion, confidence: 1 },
          }));
        }
      };
      document.addEventListener('keydown', keyHandler);

      startTimer(STEP_DURATION, () => { if (!resolved) onFail(); });
    };

    // Phase 1: wait for scan (Space/Enter)
    keyHandler = (e: KeyboardEvent) => {
      if (!alive()) return;
      if ((e.key === ' ' || e.key === 'Enter') && !scanDone) {
        e.preventDefault();
        scanDone = true;
        document.removeEventListener('keydown', keyHandler!);
        keyHandler = null;
        doCountdown();
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  /* ═══════════════════════════════════════════════════════════════
     Step orchestration
     ═══════════════════════════════════════════════════════════════ */

  function runStep(stepIdx: number): void {
    if (!alive()) return;
    if (stepIdx >= TOTAL_STEPS) { finish(); return; }

    statusBar.textContent = `Step ${stepIdx + 1} of ${TOTAL_STEPS}`;
    cup1.setFill(p1Correct / TOTAL_STEPS);
    cup2.setFill(p2Correct / TOTAL_STEPS);

    runPlayerTurn(1, p1Steps[stepIdx], stamps1, stepIdx, cup1, scan1El, (p1ok) => {
      if (!alive()) return;
      if (p1ok) p1Correct++;
      cup1.setFill(p1Correct / TOTAL_STEPS);

      runPlayerTurn(2, p2Steps[stepIdx], stamps2, stepIdx, cup2, scan2El, (p2ok) => {
        if (!alive()) return;
        if (p2ok) p2Correct++;
        cup2.setFill(p2Correct / TOTAL_STEPS);
        currentStep++;
        setActivePanel(null);
        setTimeout(() => { if (alive()) runStep(currentStep); }, 800);
      });
    });
  }

  /* ── Finish ── */
  function finish(): void {
    cleanupHandlers();
    countdown.destroy();
    stopTimer();
    setActivePanel(null);

    const p1Pct = Math.round((p1Correct / TOTAL_STEPS) * 100);
    const p2Pct = Math.round((p2Correct / TOTAL_STEPS) * 100);

    saveScore({
      p1: { name: p1Name, correct: p1Correct },
      p2: { name: p2Name, correct: p2Correct },
      date: new Date().toLocaleDateString(),
    });

    statusBar.textContent = 'Round complete!';
    const winner = p1Correct > p2Correct ? p1Name : p2Correct > p1Correct ? p2Name : 'Tie';

    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `
      <div class="mp-result__card">
        <h2 class="mp-result__title">${winner === 'Tie' ? "It's a Tie!" : `${winner} wins!`}</h2>
        <div class="mp-result__scores">
          <div class="mp-result__score">
            <span class="mp-result__player">${p1Name}</span>
            <span class="mp-result__pct">${p1Pct}%</span>
          </div>
          <div class="mp-result__vs">vs</div>
          <div class="mp-result__score">
            <span class="mp-result__player">${p2Name}</span>
            <span class="mp-result__pct">${p2Pct}%</span>
          </div>
        </div>
        <div class="mp-result__actions">
          <button class="btn btn--ghost btn--small" data-result="leaderboard">View Leaderboard</button>
          <button class="btn btn--gold btn--small"  data-result="again">Play Again</button>
        </div>
      </div>
    `;

    resultEl.querySelector('[data-result="leaderboard"]')!
      .addEventListener('click', () => router.go('leaderboard'));

    resultEl.querySelector('[data-result="again"]')!
      .addEventListener('click', () => {
        resultEl.classList.add('hidden');
        startGame(page);
      });
  }

  runStep(0);
}
