/**
 * Choreograph page — tool-first creative mode.
 *
 * Recording uses a strict two-phase loop per step:
 * 1. Scan a tool
 * 2. Perform the motion
 */
import { router } from './router.ts';
import { MOTION_META, type MotionType, type RecordedStep, type SavedChoreography } from '../types/motion.types.ts';
import { assetUrl } from '../utils/asset.ts';
import { bridgeChoreo } from '../services/bridgeChoreo.ts';

const STORAGE_KEY = 'spork_choreographies';
const CHOREO_REPLAY_STORAGE_KEY = 'spork_choreo_replay';
const KEY_MOTION_MAP: Record<string, MotionType> = {
  '1': 'grinding',
  '2': 'up_down',
  '3': 'press_down',
};
const FALLBACK_TOOL = 'placeholder-tool';

type RecordPhase = 'idle' | 'scan' | 'motion';

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
        <div class="ch-book-spread">
          <div id="ch-saved-section" class="stack ch-panel ch-saved-panel ch-book-page">
            <div class="ch-book-page__header">
              <h3>Recorded Choreographs</h3>
              <p class="subtitle">Your saved recipe sessions.</p>
            </div>
            <div id="ch-saved-list" class="stack ch-saved-list"></div>
            <p id="ch-empty-msg" class="subtitle">No recorded recipes</p>
          </div>

          <div class="stack ch-panel ch-book-page ch-record-intro-page">
            <div class="ch-book-page__header">
              <h3>Record A New Choreograph</h3>
              <p class="subtitle">Quick guide:</p>
            </div>
            <ol class="ch-record-intro-list">
              <li>Press Record.</li>
              <li>Scan one tool.</li>
              <li>Do one motion.</li>
              <li>Repeat, then save.</li>
            </ol>
            <button class="btn btn--gold btn--medium ch-add-recipe-btn" id="ch-btn-open-record">Add Choreograph</button>
          </div>
        </div>
      </div>

      <div id="ch-record-section" class="stack ch-panel hidden">
        <div class="ch-record-header">
          <div>
            <h3>Build A New Choreograph</h3>
            <p class="subtitle">Scan tool -> do motion -> repeat.</p>
          </div>
          <button class="btn btn--ghost btn--small" id="ch-btn-close-record">Back to Recipe Book</button>
        </div>

        <div class="ch-record-layout">
          <div class="stack ch-record-process">
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

              <div class="ch-stage-card" id="ch-motion-card">
                <div class="ch-stage-card__eyebrow">Phase 2</div>
                <div class="ch-stage-card__visual" id="ch-motion-visual"></div>
                <div class="ch-stage-card__label" id="ch-motion-label">Perform the motion</div>
                <div class="ch-stage-card__caption" id="ch-motion-caption">Once a tool is scanned, the motion capture becomes active.</div>
              </div>
            </div>

            <div id="ch-live-feed" class="ch-live-feed">
              Press Record to start.
            </div>

            <div class="ch-hint" id="ch-record-hint">
              Keyboard test: <strong>Space</strong> = scan, <strong>1</strong>/<strong>2</strong>/<strong>3</strong> = Grind/Dip/Press.
            </div>

            <div class="row ch-action-row">
              <button class="btn btn--rose" id="ch-btn-record">🔴 Record</button>
              <button class="btn btn--gold hidden" id="ch-btn-save">💾 Save</button>
            </div>
          </div>

          <aside class="stack ch-record-captured">
            <div class="ch-book-page__header">
              <h4>Captured Steps</h4>
              <p class="subtitle">What has been recorded so far.</p>
            </div>
            <div id="ch-capture-preview" class="ch-capture-preview">
              <img id="ch-capture-tool-icon" class="ch-capture-tool-icon hidden" src="${assetUrl('/assets/front_spork.png')}" alt="Scanned tool" />
              <span id="ch-capture-tool-text">No tool scanned yet.</span>
            </div>
            <div id="ch-recorded-list" class="ch-recorded-list"></div>
          </aside>
        </div>
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
  const captureToolIcon = page.querySelector('#ch-capture-tool-icon') as HTMLImageElement;
  const captureToolText = page.querySelector('#ch-capture-tool-text') as HTMLElement;

  function showBookView(): void {
    bookView.classList.remove('hidden');
    recordSection.classList.add('hidden');
  }

  function showRecordView(): void {
    bookView.classList.add('hidden');
    recordSection.classList.remove('hidden');
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

  function renderToolIcon(container: HTMLElement, toolLabelText: string): void {
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'ch-tool-visual';

    const asset = TOOL_ASSETS[toolLabelText] || assetUrl('/assets/front_spork.png');

    const img = document.createElement('img');
    img.className = 'ch-tool-visual__icon';
    img.src = asset;
    img.alt = 'Scanned tool';

    const label = document.createElement('span');
    label.className = 'ch-tool-visual__label';
    label.textContent = toolLabelText;

    wrap.append(img, label);
    container.appendChild(wrap);
  }

  function setCapturePreview(tool?: string): void {
    const previewContainer = page.querySelector('#ch-capture-preview') as HTMLElement;
    if (tool) {
      captureToolIcon.classList.remove('hidden');
      captureToolIcon.src = TOOL_ASSETS[tool] || assetUrl('/assets/front_spork.png');
      captureToolText.textContent = `Scanned: ${formatToolName(tool)}`;
      previewContainer.classList.add('hidden'); // Hide "No tool scanned" when tool is active
      return;
    }

    captureToolIcon.classList.add('hidden');
    captureToolText.textContent = 'No tool scanned yet.';
    if (recorded.length === 0) {
      previewContainer.classList.remove('hidden');
    }
  }

  function setStepCounter(): void {
    stepCounter.textContent = `${recorded.length} step${recorded.length === 1 ? '' : 's'} recorded`;
    const previewContainer = page.querySelector('#ch-capture-preview') as HTMLElement;
    if (recorded.length > 0) {
      previewContainer.classList.add('hidden');
    } else if (recordPhase === 'idle' || recordPhase === 'scan') {
      previewContainer.classList.remove('hidden');
    }
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
      toolCaption.textContent = 'Start each step with a scan.';
      renderToken(motionVisual, 'Move');
      motionLabel.textContent = 'Perform the motion';
      motionCaption.textContent = 'Then do one motion.';
      setCapturePreview();
      return;
    }

    if (nextPhase === 'scan') {
      phaseBadge.textContent = 'Scan';
      renderToken(toolVisual, 'NFC');
      toolLabel.textContent = 'Waiting for a tool scan';
      toolCaption.textContent = 'Scan the next tool.';
      renderToken(motionVisual, options?.motion ? MOTION_META[options.motion].label : 'Move');
      motionLabel.textContent = 'Motion locked';
      motionCaption.textContent = 'Motion records after scan.';
      setCapturePreview();
      return;
    }

    phaseBadge.textContent = 'Move';
    const scannedTool = formatToolName(options?.tool, pendingTool ?? undefined);
    renderToolIcon(toolVisual, scannedTool);
    toolLabel.textContent = scannedTool;
    toolCaption.textContent = 'Tool scanned.';

    if (options?.motion) {
      renderMotionAsset(motionVisual, options.motion, true);
      motionLabel.textContent = MOTION_META[options.motion].label;
      motionCaption.textContent = MOTION_META[options.motion].description;
    } else {
      renderToken(motionVisual, 'Go');
      motionLabel.textContent = 'Perform the motion';
      motionCaption.textContent = 'Your next motion is saved.';
    }
  }

  function appendRecordedStep(step: RecordedStep, index: number): void {
    const pill = document.createElement('div');
    pill.className = 'ch-record-pill';

    const toolImg = document.createElement('img');
    toolImg.className = 'ch-record-pill__icon';
    toolImg.src = TOOL_ASSETS[step.tool ?? ''] || assetUrl('/assets/front_spork.png');
    toolImg.style.width = '24px';
    toolImg.style.height = '24px';
    toolImg.style.objectFit = 'contain';

    const toolEl = document.createElement('span');
    toolEl.className = 'ch-record-pill__tool';
    toolEl.textContent = formatToolName(step.tool, MOTION_META[step.motion].prop);

    const arrowEl = document.createElement('span');
    arrowEl.className = 'ch-record-pill__arrow';
    arrowEl.textContent = '→';

    const motionEl = document.createElement('span');
    motionEl.className = 'ch-record-pill__motion';
    motionEl.textContent = MOTION_META[step.motion].label;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn--ghost btn--small ch-pill-delete';
    deleteBtn.innerHTML = '✕';
    deleteBtn.style.marginLeft = 'auto';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      recorded.splice(index, 1);
      renderRecordedList();
      setStepCounter();
    });

    pill.append(toolImg, toolEl, arrowEl, motionEl, deleteBtn);
    recordedList.appendChild(pill);
  }

  function renderRecordedList(): void {
    recordedList.innerHTML = '';
    recorded.forEach((step, idx) => appendRecordedStep(step, idx));
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
    liveFeed.textContent = 'Press Record to start.';
    setCapturePreview();
    setRecordPhaseUi('idle');

    // Tell backend we are in choreograph mode
    void bridgeChoreo.waitForConnection(2000).then(connected => {
      if (connected) bridgeChoreo.sendUiState('choreograph');
    });
  });

  btnCloseRecord.addEventListener('click', () => {
    if (recording) stopRecording();
    recorded = [];
    pendingTool = null;
    recordedList.innerHTML = '';
    btnSave.classList.add('hidden');
    liveFeed.dataset.state = 'idle';
    liveFeed.textContent = 'Press Record to start a new recipe.';
    setCapturePreview();
    setRecordPhaseUi('idle');
    showBookView();

    // Reset backend state
    if (bridgeChoreo.connected) {
      bridgeChoreo.sendUiState('idle');
    }
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
    liveFeed.textContent = 'Recording started. Scan a tool for the next step.';
    liveFeed.dataset.state = 'active';
    setCapturePreview();
    setRecordPhaseUi('scan');

    scanHandler = (e: Event) => {
      if (!recording || recordPhase !== 'scan') return;
      const { tool } = (e as CustomEvent).detail as { tool?: string };
      pendingTool = tool?.trim() || FALLBACK_TOOL;
      setCapturePreview(pendingTool);
      setRecordPhaseUi('motion', { tool: pendingTool });
      liveFeed.textContent = `${formatToolName(pendingTool)} scanned. Perform your motion.`;
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
      renderRecordedList();
      setStepCounter();
      setRecordPhaseUi('scan', { motion });
      liveFeed.innerHTML = `<span class="ch-live-feed-content"><img class="ch-live-feed-asset" src="${MOTION_META[motion].asset}" alt="${MOTION_META[motion].label}" /> ${formatToolName(pendingTool)} → ${MOTION_META[motion].label} captured</span>`;
      pendingTool = null;
      setCapturePreview();
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

    // ── Wire backend or keyboard ─────────────────────────────────────────
    bridgeChoreo.connect();

    const onBackendResult = (e: Event) => {
      if (!recording) return;
      const { motion, tool, score, passed } = (e as CustomEvent).detail as { 
        motion: MotionType; 
        tool: string; 
        score: number; 
        passed: boolean 
      };
      
      if (passed) {
        const step: RecordedStep = {
          motion,
          timestamp: Date.now() - recordStart,
          confidence: score,
          tool: tool,
        };
        recorded.push(step);
        renderRecordedList();
        setStepCounter();
        liveFeed.innerHTML = `<span class="ch-live-feed-content"><img class="ch-live-feed-asset" src="${MOTION_META[motion].asset}" alt="${MOTION_META[motion].label}" /> Detected: ${formatToolName(tool)} → ${MOTION_META[motion].label}</span>`;
      } else {
        liveFeed.textContent = `Motion too weak. Try scanning again.`;
      }
    };

    const onBackendPrompt = (e: Event) => {
      if (!recording) return;
      const { instruction } = (e as CustomEvent).detail as { instruction: string };
      liveFeed.textContent = instruction || "Scan a tool to continue...";
      setRecordPhaseUi('scan');
    };

    const onBackendCountdown = (e: Event) => {
      if (!recording) return;
      const { seconds } = (e as CustomEvent).detail as { seconds: number };
      liveFeed.textContent = `Get ready... ${seconds}`;
      setRecordPhaseUi('motion');
    };

    const onBackendRecording = (e: Event) => {
      if (!recording) return;
      const { seconds_remaining } = (e as CustomEvent).detail as { seconds_remaining: number };
      liveFeed.textContent = `Recording... ${seconds_remaining}s`;
    };

    document.addEventListener('choreo-result', onBackendResult);
    document.addEventListener('choreo-prompt', onBackendPrompt);
    document.addEventListener('choreo-countdown', onBackendCountdown);
    document.addEventListener('choreo-recording', onBackendRecording);
  }

  function stopRecording(): void {
    recording = false;
    pendingTool = null;
    btnRecord.textContent = '🔴 Record';
    btnRecord.classList.remove('btn--gold');
    btnRecord.classList.add('btn--rose');
    liveFeed.dataset.state = 'idle';
    liveFeed.textContent = recorded.length > 0
      ? `Recorded ${recorded.length} step${recorded.length > 1 ? 's' : ''}. Save or record again.`
      : 'No steps captured.';
    setCapturePreview();
    setRecordPhaseUi('idle');
    cleanupRecordingListeners();

    if (recorded.length > 0) {
      btnSave.classList.remove('hidden');
    }

    // Stop bridge communication
    if (bridgeChoreo.connected) {
      bridgeChoreo.disconnect();
    }
  }

  btnSave.addEventListener('click', () => {
    const name = prompt('Name this choreograph:', 'My Brew') ?? '';
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
    liveFeed.textContent = 'Saved. Press Record to create another.';
    liveFeed.dataset.state = 'idle';
    setCapturePreview();
    setRecordPhaseUi('idle');

    renderSavedList();
    showBookView();
    liveFeed.textContent = 'Recipe saved. Return any time to add another one.';
  });

  function renderSavedList(): void {
    const saved = loadSaved();
    savedList.innerHTML = '';
    emptyMsg.classList.toggle('hidden', saved.length > 0);

    saved.forEach((choreo, index) => {
      const row = document.createElement('div');
      row.className = 'card ch-saved-card';

      const copy = document.createElement('div');
      copy.className = 'ch-saved-copy';

      const title = document.createElement('div');
      title.className = 'card__title';
      title.textContent = `${index + 1}. ${choreo.name}`;

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
    try {
      sessionStorage.setItem(CHOREO_REPLAY_STORAGE_KEY, JSON.stringify(choreo));
    } catch {
      // Ignore storage write failures and still attempt navigation.
    }
    router.go('play', { replayId: choreo.id });
  }

  page.querySelector('[data-action="back"]')!
    .addEventListener('click', () => {
      if (recording) stopRecording();
      router.home();
    });

  const observer = new MutationObserver(() => {
    if (page.classList.contains('active')) {
      renderSavedList();
      if (recording) stopRecording();
      showBookView();
      liveFeed.dataset.state = 'idle';
      setCapturePreview();
      setRecordPhaseUi('idle');
      liveFeed.textContent = 'Press Record to start.';
    } else {
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
