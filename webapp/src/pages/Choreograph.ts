/**
 * Choreograph page — tool-first creative mode.
 *
 * Recording and replay both use a strict two-phase loop per step:
 * 1. Scan a tool
 * 2. Perform the motion
 */
import { router } from './router.ts';
import { MOTION_META, type MotionType, type RecordedStep, type SavedChoreography } from '../types/motion.types.ts';
import { CupFill } from '../components/CupFill.ts';
import { MotionPrompt } from '../components/MotionPrompt.ts';

const STORAGE_KEY = 'spork_choreographies';
const KEY_MOTION_MAP: Record<string, MotionType> = {
  '1': 'grinding',
  '2': 'up_down',
  '3': 'press_down',
};
const FALLBACK_TOOL = 'placeholder-tool';

type RecordPhase = 'idle' | 'scan' | 'motion';
type ReplayPhase = 'scan' | 'motion' | 'complete';

export function createChoreograph(): HTMLElement {
  const page = document.createElement('div');
  page.id = 'choreograph';
  page.className = 'page choreograph-bg';

  page.innerHTML = `
    <button class="btn btn--ghost btn--small back-btn" data-action="back">
      <span class="btn-icon btn-back-icon"></span>
      Back
    </button>

    <div class="stack stack--lg page-scroll choreograph-shell">
      <div id="ch-book-view" class="stack ch-book">
        <div class="ch-book-cover">
          <div class="ch-book-cover__ornament" aria-hidden="true"></div>
          <p class="ch-book-cover__eyebrow">Mr Spork's</p>
          <h2>Recipe Book</h2>
          <p class="subtitle">Browse your saved recipes, then add a new one step by step with scan-first choreography.</p>
        </div>

        <div id="ch-saved-section" class="stack ch-panel ch-saved-panel ch-book-page">
          <div class="ch-book-page__header">
            <h3>Your Recipes</h3>
            <p class="subtitle">Each recipe stores a sequence of scanned tools and motions.</p>
          </div>
          <div id="ch-saved-list" class="stack ch-saved-list"></div>
          <p id="ch-empty-msg" class="subtitle">No saved recipes yet</p>
          <button class="btn btn--gold btn--large ch-add-recipe-btn" id="ch-btn-open-record">Add Recipe</button>
        </div>
      </div>

      <div id="ch-record-section" class="stack ch-panel hidden">
        <div class="ch-record-header">
          <div>
            <h3>Build a New Recipe</h3>
            <p class="subtitle">Scan a tool, perform one motion, then repeat for the next step.</p>
          </div>
          <button class="btn btn--ghost btn--small" id="ch-btn-close-record">Back to Recipe Book</button>
        </div>

        <div class="ch-status-strip">
          <span id="ch-phase-badge" class="ch-phase-badge" data-phase="idle">Ready</span>
          <span id="ch-step-counter" class="ch-step-counter">0 steps recorded</span>
        </div>

        <div class="ch-stage" id="ch-stage">
          <div class="ch-stage-card" id="ch-tool-card">
            <div class="ch-stage-card__eyebrow">Phase 1</div>
            <div class="ch-stage-card__visual" id="ch-tool-visual"></div>
            <div class="ch-stage-card__label" id="ch-tool-label">Scan a tool</div>
            <div class="ch-stage-card__caption" id="ch-tool-caption">Present an NFC-tagged tool to begin the next step.</div>
          </div>

          <div class="ch-stage-arrow" id="ch-stage-arrow" aria-hidden="true">
            <span class="ch-stage-arrow__glyph">→</span>
          </div>

          <div class="ch-stage-card ch-stage-card--muted" id="ch-motion-card">
            <div class="ch-stage-card__eyebrow">Phase 2</div>
            <div class="ch-stage-card__visual" id="ch-motion-visual"></div>
            <div class="ch-stage-card__label" id="ch-motion-label">Perform the motion</div>
            <div class="ch-stage-card__caption" id="ch-motion-caption">Once a tool is scanned, the motion capture becomes active.</div>
          </div>
        </div>

        <div id="ch-live-feed" class="ch-live-feed">
          Press Record to start a tool-first choreography.
        </div>

        <div class="ch-hint" id="ch-record-hint">
          NFC required per step. Keyboard fallback: <strong>Space</strong> to fake a scan, then <strong>1</strong>, <strong>2</strong>, or <strong>3</strong> to record Grind, Dip, or Press.
        </div>

        <div id="ch-recorded-list" class="ch-recorded-list"></div>

        <div class="row ch-action-row">
          <button class="btn btn--rose" id="ch-btn-record">🔴 Record</button>
          <button class="btn btn--gold hidden" id="ch-btn-save">💾 Save</button>
        </div>
      </div>

      <div id="ch-replay-section" class="stack ch-panel hidden">
        <div class="ch-status-strip">
          <span id="ch-replay-phase" class="ch-phase-badge" data-phase="scan">Scan</span>
          <span id="ch-replay-step" class="ch-step-counter"></span>
        </div>
        <h3 id="ch-replay-title"></h3>
        <div class="ch-stage ch-stage--replay">
          <div class="ch-stage-card">
            <div class="ch-stage-card__eyebrow">Tool</div>
            <div class="ch-stage-card__visual" id="ch-replay-tool-visual"></div>
            <div class="ch-stage-card__label" id="ch-replay-tool-label"></div>
            <div class="ch-stage-card__caption" id="ch-replay-tool-caption"></div>
          </div>

          <div class="ch-stage-arrow" id="ch-replay-arrow" aria-hidden="true">
            <span class="ch-stage-arrow__glyph">→</span>
          </div>

          <div class="ch-stage-card ch-stage-card--muted" id="ch-replay-motion-card">
            <div class="ch-stage-card__eyebrow">Motion</div>
            <div class="ch-stage-card__visual" id="ch-replay-motion-visual"></div>
            <div class="ch-stage-card__label" id="ch-replay-motion-label"></div>
            <div class="ch-stage-card__caption" id="ch-replay-motion-caption"></div>
          </div>
        </div>
        <div id="ch-replay-prompt-area" class="ch-replay-prompt"></div>
        <div id="ch-replay-cup-area" class="ch-replay-cup"></div>
        <div id="ch-replay-result"></div>
        <button class="btn btn--ghost btn--small" id="ch-replay-back">Back to list</button>
      </div>
    </div>
  `;

  let recording = false;
  let recordStart = 0;
  let recorded: RecordedStep[] = [];
  let recordPhase: RecordPhase = 'idle';
  let pendingTool: string | null = null;
  let motionHandler: ((e: Event) => void) | null = null;
  let scanHandler: ((e: Event) => void) | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let replayCleanup: (() => void) | null = null;

  const liveFeed = page.querySelector('#ch-live-feed') as HTMLElement;
  const recordedList = page.querySelector('#ch-recorded-list') as HTMLElement;
  const btnRecord = page.querySelector('#ch-btn-record') as HTMLButtonElement;
  const btnSave = page.querySelector('#ch-btn-save') as HTMLButtonElement;
  const btnOpenRecord = page.querySelector('#ch-btn-open-record') as HTMLButtonElement;
  const btnCloseRecord = page.querySelector('#ch-btn-close-record') as HTMLButtonElement;
  const bookView = page.querySelector('#ch-book-view') as HTMLElement;
  const savedList = page.querySelector('#ch-saved-list') as HTMLElement;
  const emptyMsg = page.querySelector('#ch-empty-msg') as HTMLElement;
  const recordSection = page.querySelector('#ch-record-section') as HTMLElement;
  const savedSection = page.querySelector('#ch-saved-section') as HTMLElement;
  const replaySection = page.querySelector('#ch-replay-section') as HTMLElement;
  const replayBack = page.querySelector('#ch-replay-back') as HTMLButtonElement;
  const phaseBadge = page.querySelector('#ch-phase-badge') as HTMLElement;
  const stepCounter = page.querySelector('#ch-step-counter') as HTMLElement;
  const toolCard = page.querySelector('#ch-tool-card') as HTMLElement;
  const motionCard = page.querySelector('#ch-motion-card') as HTMLElement;
  const stageArrow = page.querySelector('#ch-stage-arrow') as HTMLElement;
  const toolVisual = page.querySelector('#ch-tool-visual') as HTMLElement;
  const toolLabel = page.querySelector('#ch-tool-label') as HTMLElement;
  const toolCaption = page.querySelector('#ch-tool-caption') as HTMLElement;
  const motionVisual = page.querySelector('#ch-motion-visual') as HTMLElement;
  const motionLabel = page.querySelector('#ch-motion-label') as HTMLElement;
  const motionCaption = page.querySelector('#ch-motion-caption') as HTMLElement;

  function showBookView(): void {
    bookView.classList.remove('hidden');
    recordSection.classList.add('hidden');
    replaySection.classList.add('hidden');
  }

  function showRecordView(): void {
    bookView.classList.add('hidden');
    recordSection.classList.remove('hidden');
    replaySection.classList.add('hidden');
  }

  function formatToolName(tool?: string, fallback?: string): string {
    const raw = (tool ?? fallback ?? 'Tool').trim();
    if (!raw) return fallback ?? 'Tool';
    return raw
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function renderToken(container: HTMLElement, text: string): void {
    container.innerHTML = '';
    const token = document.createElement('span');
    token.className = 'ch-stage-token';
    token.textContent = text;
    container.appendChild(token);
  }

  function renderMotionAsset(container: HTMLElement, motion: MotionType, useArrow = false): void {
    const meta = MOTION_META[motion];
    container.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'ch-stage-asset';
    img.src = useArrow ? meta.arrow : meta.asset;
    img.alt = useArrow ? `${meta.label} motion` : meta.label;
    container.appendChild(img);
  }

  function setStepCounter(): void {
    stepCounter.textContent = `${recorded.length} step${recorded.length === 1 ? '' : 's'} recorded`;
  }

  function setRecordPhaseUi(nextPhase: RecordPhase, options?: { tool?: string; motion?: MotionType }): void {
    recordPhase = nextPhase;
    phaseBadge.dataset.phase = nextPhase;
    setStepCounter();

    toolCard.classList.toggle('ch-stage-card--active', nextPhase === 'scan' || nextPhase === 'motion');
    motionCard.classList.toggle('ch-stage-card--active', nextPhase === 'motion');
    motionCard.classList.toggle('ch-stage-card--muted', nextPhase !== 'motion');
    stageArrow.classList.toggle('is-active', nextPhase === 'motion');

    if (nextPhase === 'idle') {
      phaseBadge.textContent = 'Ready';
      renderToken(toolVisual, 'NFC');
      toolLabel.textContent = 'Scan a tool';
      toolCaption.textContent = 'Each choreography step begins with a tool scan.';
      renderToken(motionVisual, 'Move');
      motionLabel.textContent = 'Perform the motion';
      motionCaption.textContent = 'After the scan, motion capture unlocks for one gesture.';
      return;
    }

    if (nextPhase === 'scan') {
      phaseBadge.textContent = 'Scan';
      renderToken(toolVisual, 'NFC');
      toolLabel.textContent = 'Waiting for a tool scan';
      toolCaption.textContent = 'Present the next physical tool to begin this step.';
      renderToken(motionVisual, options?.motion ? MOTION_META[options.motion].label : 'Move');
      motionLabel.textContent = 'Motion locked';
      motionCaption.textContent = 'A motion will only record after a tool has been scanned.';
      return;
    }

    phaseBadge.textContent = 'Move';
    renderToken(toolVisual, formatToolName(options?.tool, pendingTool ?? undefined));
    toolLabel.textContent = formatToolName(options?.tool, pendingTool ?? undefined);
    toolCaption.textContent = 'Tool scanned. This step is now armed for one motion.';

    if (options?.motion) {
      renderMotionAsset(motionVisual, options.motion, true);
      motionLabel.textContent = MOTION_META[options.motion].label;
      motionCaption.textContent = MOTION_META[options.motion].description;
    } else {
      renderToken(motionVisual, 'Go');
      motionLabel.textContent = 'Now perform the motion';
      motionCaption.textContent = 'The next detected gesture will be saved as this step.';
    }
  }

  function appendRecordedStep(step: RecordedStep): void {
    const pill = document.createElement('div');
    pill.className = 'ch-record-pill';

    const toolEl = document.createElement('span');
    toolEl.className = 'ch-record-pill__tool';
    toolEl.textContent = formatToolName(step.tool, MOTION_META[step.motion].prop);

    const arrowEl = document.createElement('span');
    arrowEl.className = 'ch-record-pill__arrow';
    arrowEl.textContent = '→';

    const motionEl = document.createElement('span');
    motionEl.className = 'ch-record-pill__motion';
    motionEl.textContent = MOTION_META[step.motion].label;

    pill.append(toolEl, arrowEl, motionEl);
    recordedList.appendChild(pill);
  }

  function cleanupRecordingListeners(): void {
    if (scanHandler) {
      document.removeEventListener('tool-scanned', scanHandler);
      scanHandler = null;
    }
    if (motionHandler) {
      document.removeEventListener('motion-detected', motionHandler);
      motionHandler = null;
    }
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  }

  btnRecord.addEventListener('click', () => {
    if (!recording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  btnOpenRecord.addEventListener('click', () => {
    showRecordView();
    liveFeed.dataset.state = 'idle';
    liveFeed.textContent = 'Press Record to start a new recipe.';
    setRecordPhaseUi('idle');
  });

  btnCloseRecord.addEventListener('click', () => {
    if (recording) stopRecording();
    recorded = [];
    pendingTool = null;
    recordedList.innerHTML = '';
    btnSave.classList.add('hidden');
    liveFeed.dataset.state = 'idle';
    liveFeed.textContent = 'Press Record to start a new recipe.';
    setRecordPhaseUi('idle');
    showBookView();
  });

  function startRecording(): void {
    recording = true;
    recordStart = Date.now();
    recorded = [];
    pendingTool = null;
    recordedList.innerHTML = '';
    btnRecord.textContent = '⏹ Stop';
    btnRecord.classList.remove('btn--rose');
    btnRecord.classList.add('btn--gold');
    btnSave.classList.add('hidden');
    liveFeed.textContent = 'Recording started. Scan a tool to arm the next step.';
    liveFeed.dataset.state = 'active';
    setRecordPhaseUi('scan');

    scanHandler = (e: Event) => {
      if (!recording || recordPhase !== 'scan') return;
      const { tool } = (e as CustomEvent).detail as { tool?: string };
      pendingTool = tool?.trim() || FALLBACK_TOOL;
      setRecordPhaseUi('motion', { tool: pendingTool });
      liveFeed.textContent = `${formatToolName(pendingTool)} scanned. Now perform one motion.`;
    };

    motionHandler = (e: Event) => {
      if (!recording || recordPhase !== 'motion' || !pendingTool) return;

      const { motion, confidence } = (e as CustomEvent).detail as { motion: MotionType; confidence: number };
      const step: RecordedStep = {
        motion,
        timestamp: Date.now() - recordStart,
        confidence,
        tool: pendingTool,
      };

      recorded.push(step);
      appendRecordedStep(step);
      setStepCounter();
      setRecordPhaseUi('scan', { motion });
      liveFeed.innerHTML = `<span class="ch-live-feed-content"><img class="ch-live-feed-asset" src="${MOTION_META[motion].asset}" alt="${MOTION_META[motion].label}" /> ${formatToolName(pendingTool)} → ${MOTION_META[motion].label} captured</span>`;
      pendingTool = null;
    };

    keyHandler = (e: KeyboardEvent) => {
      if (!page.classList.contains('active') || !recording) return;

      if ((e.key === ' ' || e.key === 'Enter') && recordPhase === 'scan') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('tool-scanned', { detail: { tool: FALLBACK_TOOL } }));
        return;
      }

      const syntheticMotion = KEY_MOTION_MAP[e.key];
      if (syntheticMotion && recordPhase === 'motion') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('motion-detected', {
          detail: { motion: syntheticMotion, confidence: 1 },
        }));
      }
    };

    document.addEventListener('tool-scanned', scanHandler);
    document.addEventListener('motion-detected', motionHandler);
    document.addEventListener('keydown', keyHandler);
  }

  function stopRecording(): void {
    recording = false;
    pendingTool = null;
    btnRecord.textContent = '🔴 Record';
    btnRecord.classList.remove('btn--gold');
    btnRecord.classList.add('btn--rose');
    liveFeed.dataset.state = 'idle';
    liveFeed.textContent = recorded.length > 0
      ? `Recorded ${recorded.length} tool-first step${recorded.length > 1 ? 's' : ''}. Save it or record again.`
      : 'No tool-motion pairs captured.';
    setRecordPhaseUi('idle');
    cleanupRecordingListeners();

    if (recorded.length > 0) {
      btnSave.classList.remove('hidden');
    }
  }

  btnSave.addEventListener('click', () => {
    const name = prompt('Name your choreography:', 'My Brew') ?? '';
    if (!name.trim()) return;

    const choreo: SavedChoreography = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: Date.now(),
      steps: [...recorded],
    };

    const saved = loadSaved();
    saved.push(choreo);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));

    recorded = [];
    pendingTool = null;
    recordedList.innerHTML = '';
    btnSave.classList.add('hidden');
    liveFeed.textContent = 'Saved! Press Record to create another.';
    liveFeed.dataset.state = 'idle';
    setRecordPhaseUi('idle');

    renderSavedList();
    showBookView();
    liveFeed.textContent = 'Recipe saved. Return any time to add another one.';
  });

  function renderSavedList(): void {
    const saved = loadSaved();
    savedList.innerHTML = '';
    emptyMsg.classList.toggle('hidden', saved.length > 0);

    saved.forEach((choreo) => {
      const row = document.createElement('div');
      row.className = 'card ch-saved-card';

      const copy = document.createElement('div');
      copy.className = 'ch-saved-copy';

      const title = document.createElement('div');
      title.className = 'card__title';
      title.textContent = choreo.name;

      const subtitle = document.createElement('div');
      subtitle.className = 'card__subtitle';
      subtitle.textContent = `${choreo.steps.length} step${choreo.steps.length === 1 ? '' : 's'} · ${new Date(choreo.createdAt).toLocaleDateString()}`;

      copy.append(title, subtitle);

      const actions = document.createElement('div');
      actions.className = 'row ch-saved-actions';

      const replayBtn = document.createElement('button');
      replayBtn.className = 'btn btn--sage btn--small ch-replay-btn';
      replayBtn.textContent = '▶ Replay';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn--ghost btn--small ch-delete-btn';
      deleteBtn.textContent = '🗑';

      replayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startReplay(choreo);
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChoreo(choreo.id);
      });

      actions.append(replayBtn, deleteBtn);
      row.append(copy, actions);

      savedList.appendChild(row);
    });
  }

  function deleteChoreo(id: string): void {
    const saved = loadSaved().filter(c => c.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    renderSavedList();
  }

  function startReplay(choreo: SavedChoreography): void {
    replayCleanup?.();

    bookView.classList.add('hidden');
    recordSection.classList.add('hidden');
    replaySection.classList.remove('hidden');
    savedSection.classList.add('hidden');

    const titleEl = page.querySelector('#ch-replay-title') as HTMLElement;
    const replayPhaseEl = page.querySelector('#ch-replay-phase') as HTMLElement;
    const replayStepEl = page.querySelector('#ch-replay-step') as HTMLElement;
    const replayToolVisual = page.querySelector('#ch-replay-tool-visual') as HTMLElement;
    const replayToolLabel = page.querySelector('#ch-replay-tool-label') as HTMLElement;
    const replayToolCaption = page.querySelector('#ch-replay-tool-caption') as HTMLElement;
    const replayArrow = page.querySelector('#ch-replay-arrow') as HTMLElement;
    const replayMotionCard = page.querySelector('#ch-replay-motion-card') as HTMLElement;
    const replayMotionVisual = page.querySelector('#ch-replay-motion-visual') as HTMLElement;
    const replayMotionLabel = page.querySelector('#ch-replay-motion-label') as HTMLElement;
    const replayMotionCaption = page.querySelector('#ch-replay-motion-caption') as HTMLElement;
    const promptArea = page.querySelector('#ch-replay-prompt-area') as HTMLElement;
    const cupArea = page.querySelector('#ch-replay-cup-area') as HTMLElement;
    const resultEl = page.querySelector('#ch-replay-result') as HTMLElement;

    titleEl.textContent = `Replaying: ${choreo.name}`;
    promptArea.innerHTML = '';
    cupArea.innerHTML = '';
    resultEl.innerHTML = '';

    const cup = new CupFill(cupArea);
    const motionPrompt = new MotionPrompt(promptArea);

    let idx = 0;
    let score = 0;
    let replayPhase: ReplayPhase = 'scan';
    let replayMotionHandler: ((e: Event) => void) | null = null;
    let replayScanHandler: ((e: Event) => void) | null = null;
    let replayKeyHandler: ((e: KeyboardEvent) => void) | null = null;

    function cleanupReplayListeners(): void {
      if (replayScanHandler) {
        document.removeEventListener('tool-scanned', replayScanHandler);
        replayScanHandler = null;
      }
      if (replayMotionHandler) {
        document.removeEventListener('motion-detected', replayMotionHandler);
        replayMotionHandler = null;
      }
      if (replayKeyHandler) {
        document.removeEventListener('keydown', replayKeyHandler);
        replayKeyHandler = null;
      }
    }

    function setReplayPhase(step: RecordedStep, nextPhase: ReplayPhase): void {
      replayPhase = nextPhase;
      replayPhaseEl.dataset.phase = nextPhase === 'complete' ? 'idle' : nextPhase;
      replayStepEl.textContent = `Step ${Math.min(idx + 1, choreo.steps.length)} of ${choreo.steps.length}`;
      replayArrow.classList.toggle('is-active', nextPhase === 'motion');
      replayMotionCard.classList.toggle('ch-stage-card--muted', nextPhase !== 'motion');
      replayMotionCard.classList.toggle('ch-stage-card--active', nextPhase === 'motion');

      renderMotionAsset(replayToolVisual, step.motion);
      replayToolLabel.textContent = formatToolName(step.tool, MOTION_META[step.motion].prop);

      if (nextPhase === 'scan') {
        replayPhaseEl.textContent = 'Scan';
        replayToolCaption.textContent = 'Scan this tool before the gesture can begin.';
        renderToken(replayMotionVisual, 'Locked');
        replayMotionLabel.textContent = 'Motion locked';
        replayMotionCaption.textContent = 'Scanning arms the expected motion for this step.';
        motionPrompt.clear();
        return;
      }

      if (nextPhase === 'motion') {
        replayPhaseEl.textContent = 'Move';
        replayToolCaption.textContent = 'Tool confirmed. Match the recorded gesture now.';
        renderMotionAsset(replayMotionVisual, step.motion, true);
        replayMotionLabel.textContent = MOTION_META[step.motion].label;
        replayMotionCaption.textContent = MOTION_META[step.motion].description;
        return;
      }

      replayPhaseEl.textContent = 'Done';
      replayToolCaption.textContent = 'Replay complete.';
      renderToken(replayMotionVisual, 'Done');
      replayMotionLabel.textContent = 'Sequence complete';
      replayMotionCaption.textContent = 'Your score is ready below.';
      motionPrompt.clear();
    }

    function nextStep(): void {
      cleanupReplayListeners();

      if (idx >= choreo.steps.length) {
        finishReplay();
        return;
      }

      const step = choreo.steps[idx];
      setReplayPhase(step, 'scan');

      replayScanHandler = () => {
        cleanupReplayListeners();
        setReplayPhase(step, 'motion');
        motionPrompt.show(step.motion);
        motionPrompt.startTimer(10, () => {
          motionPrompt.markFail();
          cleanupReplayListeners();
          idx++;
          setTimeout(nextStep, 800);
        });

        replayMotionHandler = (e: Event) => {
          const { motion, confidence } = (e as CustomEvent).detail as { motion: MotionType; confidence: number };
          if (motion === step.motion) {
            motionPrompt.stopTimer();
            motionPrompt.markSuccess();
            score += confidence;
            cup.setFill(score / choreo.steps.length);
            cleanupReplayListeners();
            idx++;
            setTimeout(nextStep, 800);
          }
        };

        replayKeyHandler = (e: KeyboardEvent) => {
          if (!page.classList.contains('active') || replayPhase !== 'motion') return;
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('motion-detected', {
              detail: { motion: step.motion, confidence: 1 },
            }));
          }
        };

        document.addEventListener('motion-detected', replayMotionHandler);
        document.addEventListener('keydown', replayKeyHandler);
      };

      replayKeyHandler = (e: KeyboardEvent) => {
        if (!page.classList.contains('active') || replayPhase !== 'scan') return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('tool-scanned', {
            detail: { tool: step.tool ?? MOTION_META[step.motion].prop },
          }));
        }
      };

      document.addEventListener('tool-scanned', replayScanHandler);
      document.addEventListener('keydown', replayKeyHandler);
    }

    function finishReplay(): void {
      cleanupReplayListeners();
      setReplayPhase(choreo.steps[choreo.steps.length - 1], 'complete');
      motionPrompt.destroy();
      const pct = Math.round((score / choreo.steps.length) * 100);
      resultEl.innerHTML = `
        <div class="stack ch-replay-result-stack">
          <span style="font-size: 3rem;">${pct >= 70 ? '🎉' : '😅'}</span>
          <h3>${pct >= 70 ? 'Nailed it!' : 'Keep practising!'}</h3>
          <p>Accuracy: <strong>${pct}%</strong></p>
        </div>
      `;
    }

    replayCleanup = () => {
      cleanupReplayListeners();
      motionPrompt.destroy();
      cup.destroy();
      resultEl.innerHTML = '';
    };

    nextStep();
  }

  replayBack.addEventListener('click', () => {
    replayCleanup?.();
    replayCleanup = null;
    replaySection.classList.add('hidden');
    savedSection.classList.remove('hidden');
    showBookView();
  });

  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => {
      replayCleanup?.();
      replayCleanup = null;
      if (recording) stopRecording();
      router.home();
    });

  const observer = new MutationObserver(() => {
    if (page.classList.contains('active')) {
      renderSavedList();
      replayCleanup?.();
      replayCleanup = null;
      if (recording) stopRecording();
      showBookView();
      savedSection.classList.remove('hidden');
      liveFeed.dataset.state = 'idle';
      setRecordPhaseUi('idle');
      liveFeed.textContent = 'Press Record to start a new recipe.';
    } else {
      replayCleanup?.();
      replayCleanup = null;
      if (recording) stopRecording();
    }
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });

  setRecordPhaseUi('idle');

  return page;
}

function loadSaved(): SavedChoreography[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}
