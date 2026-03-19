import type { MotionType } from '../types/motion.types.ts';

export type BackendPrompt = {
  motion: MotionType;
  tool?: string;
  action: number;
  totalActions: number;
};

type PendingPrompt = {
  expectedAction: number;
  resolve: (value: BackendPrompt | null) => void;
  timer: number;
};

class PlayBridge {
  private ws: WebSocket | null = null;
  private connected = false;
  private prompts: BackendPrompt[] = [];
  private pending: PendingPrompt | null = null;
  private scanEmittedForAction = false;

  connect(url = 'ws://localhost:8765'): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.connected = true;
      console.info('[playBridge] connected');
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.ws = null;
      console.info('[playBridge] disconnected');
    });

    this.ws.addEventListener('message', (event) => this.handleMessage(event.data));
    this.ws.addEventListener('error', () => console.warn('[playBridge] websocket error'));
  }

  isConnected(): boolean {
    return this.connected;
  }

  clearPromptQueue(): void {
    this.prompts = [];
  }

  async nextPrompt(expectedAction: number, timeoutMs = 15000): Promise<BackendPrompt | null> {
    const immediate = this.takePrompt(expectedAction);
    if (immediate) return immediate;

    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(null);
      this.pending = null;
    }

    return new Promise<BackendPrompt | null>((resolve) => {
      const timer = window.setTimeout(() => {
        if (this.pending) this.pending = null;
        resolve(null);
      }, timeoutMs);

      this.pending = { expectedAction, resolve, timer };
    });
  }

  sendReady(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ ready: true }));
  }

  private emit(type: string, detail: unknown): void {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private pushPrompt(prompt: BackendPrompt): void {
    if (this.pending && this.pending.expectedAction === prompt.action) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(prompt);
      return;
    }
    this.prompts.push(prompt);
  }

  private takePrompt(expectedAction: number): BackendPrompt | null {
    // Drop stale prompts
    this.prompts = this.prompts.filter((p) => p.action >= expectedAction);

    const idx = this.prompts.findIndex((p) => p.action === expectedAction);
    if (idx < 0) return null;

    const [prompt] = this.prompts.splice(idx, 1);
    return prompt ?? null;
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;

    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg?.type) {
      case 'prompt': {
        this.scanEmittedForAction = false;
        this.pushPrompt({
          motion: String(msg.motion) as MotionType,
          tool: msg.tool ? String(msg.tool) : undefined,
          action: Number(msg.action ?? 0),
          totalActions: Number(msg.total_actions ?? 0),
        });
        return;
      }

      case 'countdown': {
        // Backend only starts countdown after correct NFC (or retry skip NFC)
        if (!this.scanEmittedForAction) {
          this.scanEmittedForAction = true;
          this.emit('tool-scanned', { tool: 'backend-confirmed' });
        }
        return;
      }

      case 'nfc_wrong':
        this.emit('backend-nfc-wrong', msg);
        return;

      case 'result': {
        const motion = String(msg.motion ?? '') as MotionType;
        const confidence = Number(msg.score ?? 0);
        if (msg.passed) {
          this.emit('motion-detected', { motion, confidence });
        } else {
          this.emit('backend-motion-failed', { motion, confidence });
        }
        return;
      }

      case 'round_complete':
        this.emit('backend-round-complete', msg);
        return;

      default:
        return;
    }
  }
}

export const playBridge = new PlayBridge();