/**
 * MotionDetector.ts — WebSocket client for While It Steeps
 * =========================================================
 * Connects to ws://localhost:8765 (bridge_play.py or bridge_tutorial.py)
 * and converts every incoming message into a CustomEvent on `document`.
 *
 * Message types received → CustomEvent name dispatched on document:
 *
 *   sensor           → "sensor-data"        {x, y, z, mag, state}
 *   prompt           → "motion-prompt"      {motion, tool, action, totalActions}
 *   nfc              → "nfc-scan"           {uid, tool, valid}
 *   nfc_wrong        → "nfc-wrong"          {scanned, expected}
 *   countdown        → "countdown"          {seconds}
 *   recording        → "recording"          {secondsRemaining}
 *   result           → "motion-result"      {motion, tool, score, passed}
 *   round_complete   → "round-complete"     {round, score, passed, actions}
 *   tutorial_complete→ "tutorial-complete"  {}
 *   knob             → "knob"               {delta?, click?}
 *
 * Usage in any page/component:
 *   document.addEventListener('motion-prompt', (e) => { ... })
 *   document.addEventListener('motion-result', (e) => { ... })
 *
 * To advance to the next round (Play page only):
 *   motionDetector.sendReady()
 */

export class MotionDetectorWS {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  constructor(url = 'ws://localhost:8765') {
    this.url = url;
  }

  get connected(): boolean { return this._connected; }

  /** Call once from main.ts to open the connection. Auto-reconnects. */
  connect(): void {
    if (this.ws) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen    = () => this._onOpen();
      this.ws.onmessage = (ev) => this._onMessage(ev);
      this.ws.onclose   = () => this._onClose();
      this.ws.onerror   = () => this.ws?.close();
    } catch {
      this._scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  /** Tell the play bridge the player is ready for the next round */
  sendReady(): void {
    this._send({ ready: true });
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _send(msg: object): void {
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private _onOpen(): void {
    this._connected = true;
    console.log('[WS] Connected to bridge');
    this._fire('ws-connected', {});
  }

  private _onClose(): void {
    this._connected = false;
    this.ws = null;
    console.log('[WS] Disconnected — retrying in 3 s');
    this._fire('ws-disconnected', {});
    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private _onMessage(ev: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data as string) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = msg.type as string | undefined;

    switch (type) {

      case 'sensor':
        this._fire('sensor-data', {
          x:     msg.x   as number,
          y:     msg.y   as number,
          z:     msg.z   as number,
          mag:   msg.mag as number,
          state: msg.state as string,
        });
        break;

      case 'prompt':
        console.log(`[WS] prompt → motion="${msg.motion}"  tool="${msg.tool}"`);
        this._fire('motion-prompt', {
          motion:       msg.motion        as string,
          tool:         msg.tool          as string,
          action:       msg.action        as number,
          totalActions: msg.total_actions as number,
        });
        break;

      case 'nfc':
        this._fire('nfc-scan', {
          uid:   msg.uid   as string,
          tool:  msg.tool  as string | null,
          valid: msg.valid as boolean,
        });
        break;

      case 'nfc_wrong':
        this._fire('nfc-wrong', {
          scanned:  msg.scanned  as string,
          expected: msg.expected as string,
        });
        break;

      case 'countdown':
        this._fire('countdown', { seconds: msg.seconds as number });
        break;

      case 'recording':
        this._fire('recording', {
          secondsRemaining: msg.seconds_remaining as number,
        });
        break;

      case 'result':
        console.log(
          `[WS] result → motion="${msg.motion}" score=${
            ((msg.score as number) * 100).toFixed(0)
          }% passed=${msg.passed}`,
        );
        this._fire('motion-result', {
          motion: msg.motion as string,
          tool:   msg.tool   as string,
          score:  msg.score  as number,
          passed: msg.passed as boolean,
          detail: (msg.detail ?? {}) as object,
        });
        break;

      case 'round_complete':
        console.log(
          `[WS] round_complete → round=${msg.round} score=${
            ((msg.score as number) * 100).toFixed(0)
          }% passed=${msg.passed}`,
        );
        this._fire('round-complete', {
          round:   msg.round   as number,
          score:   msg.score   as number,
          passed:  msg.passed  as boolean,
          actions: msg.actions as number,
        });
        break;

      case 'tutorial_complete':
        console.log('[WS] tutorial_complete');
        this._fire('tutorial-complete', {});
        break;

      case 'knob':
        this._fire('knob', {
          delta: msg.delta as number | undefined,
          click: msg.click as boolean | undefined,
        });
        break;

      default:
        break;
    }
  }

  private _fire(eventName: string, detail: object): void {
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

/** Singleton — connect once from main.ts, use events everywhere else */
export const motionDetector = new MotionDetectorWS();