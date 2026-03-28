/**
 * Play page — runs through a level's sequence of motions.
 *
 * Flow per step:
 *   1. Show "Show your <Tool> to Mr Spork"  (scan phase)
 *      → Space simulates scan in keyboard fallback
 *   2. NFC scanned → countdown 3…2…1 flashes fullscreen
 *      → Sensor graph activates on first countdown tick
 *   3. 8-second motion window
 *      → Space simulates correct motion in keyboard fallback
 *   4. Result ≥ 60% confidence → pass, else fail
 */
import { router } from "./router.ts";
import {
  LEVELS,
  MOTION_META,
  type MotionType,
  type GameLevel,
  type SavedChoreography,
} from "../types/motion.types.ts";
import { playBridge } from "../services/playBridge.ts";
import { CupFill } from "../components/CupFill.ts";
import { MotionPrompt } from "../components/MotionPrompt.ts";
import { CountdownFlash } from "../components/CountdownFlash.ts";
import { SensorXYMap } from "../components/SensorXYMap.ts";
import { SensorZStrip } from "../components/SensorZStrip.ts";
import { assetUrl } from "../utils/asset.ts";

const CHOREO_REPLAY_STORAGE_KEY = "spork_choreo_replay";
const BACKEND_PROMPT_TIMEOUT_MS = 15000;
const PASS_THRESHOLD = 0.6;

/**
 * Every physical NFC tool → its display asset path.
 * Keys must exactly match NFC_TAGS values in classifier.py.
 */
const TOOL_ASSETS: Record<string, string> = {
  "Coffee Grinder": assetUrl("/assets/front_grinder.PNG"),
  Kettle: assetUrl("/assets/front_milk.PNG"),
  "Coffee Press": assetUrl("/assets/front_press.PNG"),
  Sieve: assetUrl("/assets/front_sieve.PNG"),
  Spork: assetUrl("/assets/front_spork.png"),
  "Tea Bag": assetUrl("/assets/front_tea.PNG"),
  Tongs: assetUrl("/assets/front_tongs.png"),
};

/** All physical tool names — must match NFC_TAGS values in classifier.py */
const ALL_TOOLS = Object.keys(TOOL_ASSETS);

type PlayStep = {
  motion: MotionType;
  duration: number;
  label: string;
  description: string;
  tool?: string;
};

function formatToolName(tool?: string, fallback?: string): string {
  const raw = (tool ?? fallback ?? "Tool").trim();
  if (!raw) return fallback ?? "Tool";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function loadChoreographyReplay(replayId?: string): SavedChoreography | null {
  if (!replayId) return null;
  try {
    const raw = sessionStorage.getItem(CHOREO_REPLAY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedChoreography;
    if (
      parsed.id !== replayId ||
      !Array.isArray(parsed.steps) ||
      parsed.steps.length === 0
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createPlayPage(): HTMLElement {
  const page = document.createElement("div");
  page.id = "play";
  page.className = "page";

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
    <!-- Sensor graph — bottom-right, same position as tutorial -->
    <div id="play-sensor-container" class="play-sensor-container"></div>
  `;

  page.querySelector('[data-action="back"]')!.addEventListener("click", () => {
    if (page.dataset.replayId) {
      router.go("choreograph");
      return;
    }
    router.go("level-select");
  });

  const observer = new MutationObserver(() => {
    if (page.classList.contains("active")) startLevel(page);
  });
  observer.observe(page, { attributes: true, attributeFilter: ["class"] });

  return page;
}

/* ── Level runner ── */
function startLevel(page: HTMLElement): void {
  const replayId = page.dataset.replayId?.trim();
  const replay = loadChoreographyReplay(replayId);

  const levelId = parseInt(page.dataset.levelId ?? "1", 10);
  const level: GameLevel = LEVELS.find((l) => l.id === levelId) ?? LEVELS[0];

  const isChoreographyReplay = Boolean(replay);
  const runName = replay ? replay.name : level.name;
  const runPassingScore = replay ? 70 : level.passingScore;

  /**
   * Generate random steps using all 8 tools and 3 motions independently,
   * matching the level's step count and duration — same as the backend does.
   * When the backend IS connected, applyBackendPromptToStep() will overwrite
   * each step's motion/tool as the backend sends prompts.
   */
  function makeRandomSteps(count: number, duration: number): PlayStep[] {
    const motions: MotionType[] = ["grinding", "up_down", "press_down"];
    const toolCounts: Record<string, number> = Object.fromEntries(
      ALL_TOOLS.map((t) => [t, 0]),
    );
    let lastTool: string | null = null;
    let lastMotion: MotionType | null = null;
    const steps: PlayStep[] = [];
    for (let i = 0; i < count; i++) {
      // Filter tools: not same as last, not used more than twice
      const availableTools = ALL_TOOLS.filter(
        (t) => t !== lastTool && toolCounts[t] < 2,
      );
      // Filter motions: not same as last
      const availableMotions = motions.filter((m) => m !== lastMotion);
      // If no available tools (shouldn't happen unless count > tools.length*2), fallback to all tools except last
      const tool =
        availableTools.length > 0
          ? availableTools[Math.floor(Math.random() * availableTools.length)]
          : ALL_TOOLS.filter((t) => t !== lastTool)[
              Math.floor(Math.random() * (ALL_TOOLS.length - 1))
            ];
      // If no available motions (shouldn't happen unless count > motions.length), fallback to all except last
      const motion =
        availableMotions.length > 0
          ? availableMotions[
              Math.floor(Math.random() * availableMotions.length)
            ]
          : motions.filter((m) => m !== lastMotion)[
              Math.floor(Math.random() * (motions.length - 1))
            ];
      steps.push({
        motion,
        duration,
        label: `Step ${i + 1}`,
        description: MOTION_META[motion].description,
        tool,
      });
      toolCounts[tool]++;
      lastTool = tool;
      lastMotion = motion;
    }
    return steps;
  }

  const runSteps: PlayStep[] = replay
    ? replay.steps.map((step, index) => ({
        motion: step.motion,
        duration: 8,
        label: `Step ${index + 1}`,
        description: MOTION_META[step.motion].description,
        tool: step.tool,
      }))
    : makeRandomSteps(level.steps.length, level.steps[0]?.duration ?? 8);

  const VISUAL_STAMP_COUNT = runSteps.length;
  const stampVisualClasses = Array.from(
    { length: VISUAL_STAMP_COUNT },
    (_, i) => `stamp-${i + 1}`,
  );

  const titleEl = page.querySelector("#play-title") as HTMLElement;
  const progressEl = page.querySelector("#play-progress") as HTMLElement;
  const stampsEl = page.querySelector("#play-stamps") as HTMLElement;
  const promptArea = page.querySelector("#play-prompt-area") as HTMLElement;
  const scanPromptEl = page.querySelector("#play-scan-prompt") as HTMLElement;
  const arrowArea = page.querySelector("#play-arrow-area") as HTMLElement;
  const cupArea = page.querySelector("#play-cup-area") as HTMLElement;
  const timerEl = page.querySelector("#play-timer") as HTMLElement;
  const resultArea = page.querySelector("#play-result") as HTMLElement;
  const sensorContainer = page.querySelector(
    "#play-sensor-container",
  ) as HTMLElement;

  // Reset UI
  titleEl.textContent = isChoreographyReplay ? `Replay: ${runName}` : runName;
  progressEl.innerHTML = stampsEl.innerHTML = promptArea.innerHTML = "";
  scanPromptEl.innerHTML = "";
  scanPromptEl.classList.add("hidden");
  arrowArea.innerHTML = cupArea.innerHTML = resultArea.innerHTML = "";
  resultArea.classList.add("hidden");
  sensorContainer.innerHTML = "";

  // Progress dots
  const dots: HTMLElement[] = Array.from(
    { length: VISUAL_STAMP_COUNT },
    (_, i) => {
      const dot = document.createElement("span");
      dot.className = "play-progress-dot";
      dot.title = `Step ${i + 1}`;
      progressEl.appendChild(dot);
      return dot;
    },
  );

  // Stamps — show the tool asset (what to scan), not the motion asset
  const stamps: HTMLElement[] = Array.from(
    { length: VISUAL_STAMP_COUNT },
    (_, i) => {
      const step = runSteps[i];
      const assetSrc =
        (step.tool && TOOL_ASSETS[step.tool]) ?? MOTION_META[step.motion].asset;
      const assetAlt = step.tool ?? MOTION_META[step.motion].label;
      const stamp = document.createElement("div");
      stamp.className = `play-stamp ${stampVisualClasses[i]}`;
      stamp.title = formatToolName(step.tool, MOTION_META[step.motion].prop);
      stamp.innerHTML = `
      <div class="play-stamp__inner">
        <img class="play-stamp__asset" src="${assetSrc}" alt="${assetAlt}" />
      </div>`;
      stampsEl.appendChild(stamp);
      return stamp;
    },
  );

  const cup = new CupFill(cupArea);
  const prompt = new MotionPrompt(promptArea);
  const countdownFlash = new CountdownFlash(page);

  // Sensor graph refs — rebuilt per step based on the required motion
  let xyMap: SensorXYMap | null = null;
  let zStrip: SensorZStrip | null = null;

  /** Tear down the current sensor graph */
  function destroySensorGraph(): void {
    if (xyMap) {
      xyMap.destroy();
      xyMap = null;
    }
    if (zStrip) {
      zStrip.destroy();
      zStrip = null;
    }
    sensorContainer.innerHTML = "";
  }

  /**
   * Build the correct sensor graph for the given motion and start listening.
   * - grinding  → SensorXYMap  (circular X/Y pattern)
   * - up_down   → SensorZStrip (vertical Z bounce)
   * - press_down→ SensorZStrip (downward Z push)
   */
  function buildSensorGraph(motion: MotionType): void {
    destroySensorGraph();
    if (motion === "grinding") {
      xyMap = new SensorXYMap(
        sensorContainer,
        MOTION_META["grinding"].arrow,
        0.65,
      );
      xyMap.startListening();
    } else if (motion === "up_down") {
      zStrip = new SensorZStrip(
        sensorContainer,
        MOTION_META["up_down"].arrow,
        0.65,
      );
      zStrip.startListening();
    } else if (motion === "press_down") {
      zStrip = new SensorZStrip(
        sensorContainer,
        MOTION_META["press_down"].arrow,
        0.65,
      );
      zStrip.startListening();
    }
    // Unknown motion types get no sensor graph — container stays empty
  }

  const useBackendRandom = !isChoreographyReplay;
  playBridge.connect();
  if (useBackendRandom) playBridge.clearPromptQueue();

  let currentStep = 0;
  let completedCorrect = 0;
  let score = 0;

  let motionHandler: ((e: Event) => void) | null = null;
  let scanHandler: ((e: Event) => void) | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let backendFailHandler: ((e: Event) => void) | null = null;
  let backendNfcWrongHandler: ((e: Event) => void) | null = null;
  let countdownHandler: ((e: Event) => void) | null = null;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let timerRaf: number | null = null;

  function applyBackendPromptToStep(
    stepIndex: number,
    motion: MotionType,
    tool?: string,
  ): void {
    const step = runSteps[stepIndex];
    if (!step) return;
    step.motion = motion;
    step.tool = tool;
    const stamp = stamps[stepIndex];
    if (!stamp) return;
    stamp.title = formatToolName(tool, MOTION_META[motion].prop);
    const img = stamp.querySelector(
      ".play-stamp__asset",
    ) as HTMLImageElement | null;
    if (img) {
      img.src = (tool && TOOL_ASSETS[tool]) ?? MOTION_META[motion].asset;
      img.alt = tool ?? MOTION_META[motion].label;
    }
  }

  function updateVisualProgress(): void {
    dots.forEach((dot, i) =>
      dot.classList.toggle("is-complete", i < completedCorrect),
    );
    stamps.forEach((stamp, i) =>
      stamp.classList.toggle("is-active", i < completedCorrect),
    );
    cup.setFill(
      Math.min(completedCorrect, VISUAL_STAMP_COUNT) / VISUAL_STAMP_COUNT,
    );
  }

  function flashWrongStamp(): void {
    const stamp = stamps[Math.min(completedCorrect, VISUAL_STAMP_COUNT - 1)];
    if (!stamp) return;
    stamp.classList.remove("is-wrong");
    void stamp.offsetWidth;
    stamp.classList.add("is-wrong");
    setTimeout(() => stamp.classList.remove("is-wrong"), 320);
  }

  updateVisualProgress();

  function cleanupListeners(): void {
    if (motionHandler) {
      document.removeEventListener("motion-detected", motionHandler);
      motionHandler = null;
    }
    if (scanHandler) {
      document.removeEventListener("tool-scanned", scanHandler);
      scanHandler = null;
    }
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
    if (backendFailHandler) {
      document.removeEventListener("backend-motion-failed", backendFailHandler);
      backendFailHandler = null;
    }
    if (backendNfcWrongHandler) {
      document.removeEventListener("backend-nfc-wrong", backendNfcWrongHandler);
      backendNfcWrongHandler = null;
    }
    if (countdownHandler) {
      document.removeEventListener("play-countdown", countdownHandler);
      countdownHandler = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (timerRaf) {
      cancelAnimationFrame(timerRaf);
      timerRaf = null;
    }
    timerEl.textContent = "";
    timerEl.style.removeProperty("--sweep");
    timerEl.removeAttribute("data-state");
  }

  // ── Shared: register motion handler + keyboard fallback ─────────────────
  // Called after countdown finishes (both backend and local paths).

  function startMotionPhase(
    step: PlayStep,
    _meta: (typeof MOTION_META)[MotionType],
    backendDriven: boolean,
  ): void {
    motionHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        motion: MotionType;
        confidence: number;
      };
      if (detail.motion === step.motion) {
        if ((detail.confidence ?? 0) >= PASS_THRESHOLD) {
          if (!backendDriven) prompt.stopTimer();
          prompt.markSuccess();
          score += detail.confidence ?? 0;
          // Confirm the sensor graph (turns green)
          xyMap?.confirm();
          zStrip?.confirm();
          completedCorrect++;
          updateVisualProgress();
          cup.splash();
          cleanupListeners();
          currentStep++;
          setTimeout(advance, 800);
        } else {
          flashWrongStamp();
        }
      } else {
        flashWrongStamp();
      }
    };
    document.addEventListener("motion-detected", motionHandler);

    if (!backendDriven) {
      keyHandler = (e: KeyboardEvent) => {
        if (!page.classList.contains("active")) return;
        if (!resultArea.classList.contains("hidden")) return;
        if (e.key === " ") {
          e.preventDefault();
          document.dispatchEvent(
            new CustomEvent("motion-detected", {
              detail: { motion: step.motion, confidence: 1 },
            }),
          );
        }
      };
      document.addEventListener("keydown", keyHandler);
    }
  }

  function startVisualTimer(duration: number) {
    if (timerInterval) clearInterval(timerInterval);
    if (timerRaf) cancelAnimationFrame(timerRaf);

    let remaining = duration;
    const startMs = performance.now();
    const totalMs = duration * 1000;

    timerEl.textContent = String(remaining);
    timerEl.dataset.state = "high";

    const animate = () => {
      const elapsed = performance.now() - startMs;
      const fraction = Math.max(0, 1 - elapsed / totalMs);
      timerEl.style.setProperty("--sweep", `${(fraction * 360).toFixed(1)}deg`);
      if (fraction > 0) timerRaf = requestAnimationFrame(animate);
    };
    timerRaf = requestAnimationFrame(animate);

    timerInterval = setInterval(() => {
      remaining--;
      timerEl.textContent = remaining > 0 ? String(remaining) : "";
      const pct = remaining / duration;
      timerEl.dataset.state =
        pct > 0.4 ? "high" : pct > 0.15 ? "medium" : "low";
      if (remaining <= 0) {
        clearInterval(timerInterval!);
        timerInterval = null;
      }
    }, 1000);
  }

  // ── Phase 1: Scan ────────────────────────────────────────────────────────

  let sensorStarted = false; // Track if sensor graph started for current step

  function advance(): void {
    if (currentStep >= runSteps.length) {
      finish();
      return;
    }

    // Destroy any leftover sensor graph from the previous step
    destroySensorGraph();

    const stepIndex = currentStep;
    const backendDriven = useBackendRandom && playBridge.isConnected();

    const beginScanPhase = (): void => {
      if (stepIndex !== currentStep) return;

      const step = runSteps[currentStep];
      const meta = MOTION_META[step.motion];

      prompt.show(step.motion);
      arrowArea.innerHTML = "";

      scanPromptEl.classList.remove("hidden");
      scanPromptEl.textContent = `Show your ${formatToolName(step.tool, meta.prop)} to Mr Spork`;

      scanHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail as { tool?: string };
        if (detail?.tool) onScanComplete();
      };
      document.addEventListener("tool-scanned", scanHandler);

      if (backendDriven) {
        backendNfcWrongHandler = () => flashWrongStamp();
        document.addEventListener("backend-nfc-wrong", backendNfcWrongHandler);

        // Set up countdown listener EARLY — before NFC scan can complete
        // (so we don't miss the first countdown message)
        sensorStarted = false;
        timerEl.textContent = "";
        timerEl.style.removeProperty("--sweep");
        timerEl.removeAttribute("data-state");

        countdownHandler = (e: Event) => {
          const detail = (e as CustomEvent).detail as { seconds: number };

          if (detail.seconds > 0) {
            countdownFlash.flash(detail.seconds);
            scanPromptEl.textContent = `Get ready… ${detail.seconds}`;
            if (!sensorStarted) {
              sensorStarted = true;
              buildSensorGraph(step.motion);
            }
          } else {
            // This runs when detail.seconds <= 0
            countdownFlash.hide();

            // IMPORTANT: Remove the listener so it doesn't fire again for this step
            document.removeEventListener("play-countdown", countdownHandler!);

            const currentMeta = MOTION_META[runSteps[currentStep].motion];
            scanPromptEl.innerHTML = `Do the <strong>${currentMeta.label}</strong> motion!`;

            // Explicitly trigger the 8-second visual timer
            startVisualTimer(8);
          }
        };
        document.addEventListener("play-countdown", countdownHandler);

        backendFailHandler = (e: Event) => {
          const detail = (e as CustomEvent).detail as { motion: MotionType };
          if (detail.motion === step.motion) {
            flashWrongStamp();
            xyMap?.reset();
            zStrip?.reset();
          }
        };
        document.addEventListener("backend-motion-failed", backendFailHandler);
      } else {
        // Space = simulate NFC scan
        keyHandler = (e: KeyboardEvent) => {
          if (!page.classList.contains("active")) return;
          if (!resultArea.classList.contains("hidden")) return;
          if (e.key === " ") {
            e.preventDefault();
            onScanComplete();
          }
        };
        document.addEventListener("keydown", keyHandler);
      }
    };

    if (backendDriven) {
      scanPromptEl.classList.remove("hidden");
      scanPromptEl.textContent = "Loading...";

      const waitForPrompt = (): void => {
        void playBridge
          .nextPrompt(stepIndex + 1, BACKEND_PROMPT_TIMEOUT_MS)
          .then((msg) => {
            if (stepIndex !== currentStep) return;
            if (!msg) {
              scanPromptEl.textContent = "Loading...";
              waitForPrompt();
              return;
            }
            applyBackendPromptToStep(stepIndex, msg.motion, msg.tool);
            beginScanPhase();
          });
      };

      waitForPrompt();
      return;
    }

    beginScanPhase();
  }

  // ── Phase 2: Countdown → Motion ─────────────────────────────────────────

  function onScanComplete(): void {
    if (scanHandler) {
      document.removeEventListener("tool-scanned", scanHandler);
      scanHandler = null;
    }
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
    if (backendNfcWrongHandler) {
      document.removeEventListener("backend-nfc-wrong", backendNfcWrongHandler);
      backendNfcWrongHandler = null;
    }

    const step = runSteps[currentStep];
    const meta = MOTION_META[step.motion];
    const backendDriven = useBackendRandom && playBridge.isConnected();

    // Stamp lights up on scan
    if (currentStep < VISUAL_STAMP_COUNT) {
      const stamp = stamps[currentStep];
      stamp.classList.add("is-scanned");
      stamp.classList.remove("pop");
      void stamp.offsetWidth;
      stamp.classList.add("pop");
      setTimeout(() => stamp.classList.remove("pop"), 320);
    }

    scanPromptEl.classList.remove("hidden");
    scanPromptEl.textContent = "Get ready…";

    if (backendDriven) {
      // ── Backend path ─────────────────────────────────────────────────────
      startMotionPhase(step, meta, true);
    } else {
      // ── Local keyboard fallback path ─────────────────────────────────────
      arrowArea.innerHTML = "";

      let count = 3;
      countdownFlash.flash(count);
      scanPromptEl.textContent = `Get ready… ${count}`;

      // Start sensor graph immediately on first countdown tick
      buildSensorGraph(step.motion);

      const countInterval = setInterval(() => {
        count--;
        if (count > 0) {
          countdownFlash.flash(count);
          scanPromptEl.textContent = `Get ready… ${count}`;
        } else {
          clearInterval(countInterval);
          countdownFlash.hide();

          scanPromptEl.innerHTML = `Do the <strong>${meta.label}</strong> motion!`;
          arrowArea.innerHTML = "";

          startVisualTimer(8);

          prompt.startTimer(step.duration, () => {
            prompt.markFail();
            flashWrongStamp();
            destroySensorGraph();
            cleanupListeners();
            currentStep++;
            setTimeout(advance, 800);
          });

          startMotionPhase(step, meta, false);
        }
      }, 1000);
    }
  }

  // ── Finish ───────────────────────────────────────────────────────────────

  function finish(): void {
    prompt.destroy();
    countdownFlash.destroy();
    destroySensorGraph();
    cleanupListeners();

    const pct = Math.round((score / runSteps.length) * 100);
    const passed = pct >= runPassingScore;
    const nextLevel = isChoreographyReplay
      ? null
      : LEVELS.find((l) => l.id === level.id + 1);

    resultArea.classList.remove("hidden");
    resultArea.innerHTML = `
      <span style="font-size: 3rem;">${passed ? "🎉" : "😅"}</span>
      <h2>${passed ? "Well Brewed!" : "Almost There…"}</h2>
      <p>You scored <strong>${pct}%</strong></p>
      <div class="row" style="justify-content: center; gap: var(--space-md); margin-top: var(--space-md);">
        <button class="btn btn--ghost btn--small" data-action="retry">Retry</button>
        ${nextLevel ? '<button class="btn btn--gold btn--small" data-action="next">Next Round</button>' : ""}
        <button class="btn btn--primary btn--small" data-action="menu">${isChoreographyReplay ? "Back to Recipes" : "Back to Menu"}</button>
      </div>
    `;

    resultArea
      .querySelector('[data-action="retry"]')!
      .addEventListener("click", () => {
        if (useBackendRandom && playBridge.isConnected()) {
          playBridge.sendUiState("play", levelId);
        }
        startLevel(page);
      });

    if (nextLevel) {
      resultArea
        .querySelector('[data-action="next"]')!
        .addEventListener("click", () => {
          // ui_state for the next level is sent by startLevel when it runs
          router.go("play", { levelId: String(nextLevel.id) });
        });
    }

    resultArea
      .querySelector('[data-action="menu"]')!
      .addEventListener("click", () => {
        if (isChoreographyReplay) {
          router.go("choreograph");
          return;
        }
        router.home();
      });
  }

  // Connect WebSocket and wait for connection before starting game
  if (useBackendRandom) {
    void playBridge.waitForConnection(10000).then((connected) => {
      console.log("[Play] Backend connection ready:", connected);
      if (connected) {
        // Tell the state manager which round to run
        playBridge.sendUiState("play", levelId);
      }
      advance();
    });
  } else {
    // No backend — start immediately
    advance();
  }
}
