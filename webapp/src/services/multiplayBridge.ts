import type { MotionType } from '../types/motion.types.ts';

export type MultiplayerMessage = {
  type: 'start_game' | 'ui_state' | 'player_ready' | 'motion_result';
  [key: string]: unknown;
};

type PendingMotion = {
  player: 1 | 2;
  stepIdx: number;
  resolve: (value: { motion: MotionType; confidence: number } | null) => void;
  timer: number;
};

class MultiplayerBridge {
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingMotions: Map<string, PendingMotion> = new Map();

  connect(url = 'ws://localhost:8765'): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.connected = true;
      console.info('[multiplayBridge] connected');
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.ws = null;
      console.info('[multiplayBridge] disconnected');
    });

    this.ws.addEventListener('message', (event) => this.handleMessage(event.data));
    this.ws.addEventListener('error', () => console.warn('[multiplayBridge] websocket error'));
  }

  isConnected(): boolean {
    return this.connected;
  }

  async waitForConnection(timeoutMs = 5000): Promise<boolean> {
    if (this.connected) return true;

    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        resolve(this.connected);
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        if (this.ws) {
          this.ws.removeEventListener('open', onOpen);
        }
      };

      const onOpen = () => {
        cleanup();
        resolve(true);
      };

      if (this.ws) {
        this.ws.addEventListener('open', onOpen);
      }
    });
  }

  sendGameStart(p1Name: string, p2Name: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'start_game',
      p1_name: p1Name,
      p2_name: p2Name,
    }));
  }

  sendUiState(page: string, gameMode?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: any = { type: 'ui_state', page };
    if (gameMode) msg.game_mode = gameMode;
    this.ws.send(JSON.stringify(msg));
  }

  sendPlayerReady(player: 1 | 2, stepIdx: number, motion: string, tool: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type:   'player_ready',
      player,
      step:   stepIdx,
      motion,
      tool,
    }));
  }

  async waitForMotion(
    player: 1 | 2,
    stepIdx: number,
    timeoutMs = 10000,
  ): Promise<{ motion: MotionType; confidence: number } | null> {
    const key = `${player}_${stepIdx}`;
    const existing = this.pendingMotions.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.pendingMotions.delete(key);
    }

    return new Promise<{ motion: MotionType; confidence: number } | null>((resolve) => {
      const timer = window.setTimeout(() => {
        this.pendingMotions.delete(key);
        resolve(null);
      }, timeoutMs);

      this.pendingMotions.set(key, { player, stepIdx, resolve, timer });
    });
  }

  private emit(type: string, detail: unknown): void {
    document.dispatchEvent(new CustomEvent(type, { detail }));
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
      case 'motion_result': {
        const player = Number(msg.player ?? 0) as 1 | 2;
        const stepIdx = Number(msg.step ?? 0);
        const motion = String(msg.motion ?? '') as MotionType;
        const confidence = Number(msg.confidence ?? 0);
        const key = `${player}_${stepIdx}`;

        const pending = this.pendingMotions.get(key);
        if (pending) {
          this.pendingMotions.delete(key);
          clearTimeout(pending.timer);
          if (msg.passed) {
            pending.resolve({ motion, confidence });
          } else {
            pending.resolve(null);
          }
        }

        // Also emit as event for other listeners
        this.emit('multiplayer-motion-result', {
          player,
          step: stepIdx,
          motion,
          confidence,
          passed: msg.passed,
        });
        return;
      }

      case 'countdown': {
        this.emit('multiplayer-countdown', {
          seconds: Number(msg.seconds ?? 0),
        });
        return;
      }

      case 'game_complete':
        this.emit('multiplayer-game-complete', msg);
        return;

      case 'error':
        console.warn('[multiplayBridge] backend error:', msg.message);
        this.emit('multiplayer-error', msg);
        return;

      default:
        return;
    }
  }
}

export const multiplayBridge = new MultiplayerBridge();
