import type { MotionType } from '../types/motion.types.ts';

export type TutorialPrompt = {
  motion: MotionType;
  tool: string | undefined;
  action: number;
  totalActions: number;
};

class TutorialBridge {
  private ws: WebSocket | null = null;
  private connected = false;

  connect(url = 'ws://localhost:8765'): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.connected = true;
      console.info('[tutorialBridge] connected');
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.ws = null;
      console.info('[tutorialBridge] disconnected');
    });

    this.ws.addEventListener('message', (event) =>
      this.handleMessage(event.data)
    );

    this.ws.addEventListener('error', () =>
      console.warn('[tutorialBridge] websocket error')
    );
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
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
      // Backend is ready for next step — tells frontend what motion + tool
      case 'prompt':
        this.emit('tutorial-prompt', {
          motion: String(msg.motion) as MotionType,
          tool: msg.tool ? String(msg.tool) : undefined,
          action: Number(msg.action ?? 0),
          totalActions: Number(msg.total_actions ?? 0),
        } satisfies TutorialPrompt);
        return;

      // Correct NFC scanned — backend starting countdown
      case 'countdown':
        this.emit('tutorial-countdown', { seconds: Number(msg.seconds ?? 0) });
        return;

      // Wrong NFC tag scanned
      case 'nfc_wrong':
        this.emit('tutorial-nfc-wrong', {
          scanned: msg.scanned,
          expected: msg.expected,
        });
        return;

      // Motion scoring result from backend
      case 'result': {
        const motion = String(msg.motion ?? '') as MotionType;
        const confidence = Number(msg.score ?? 0);
        if (msg.passed) {
          this.emit('motion-detected', { motion, confidence });
        } else {
          this.emit('tutorial-motion-failed', { motion, confidence });
        }
        return;
      }

      // All 3 tutorial steps complete
      case 'tutorial_complete':
        this.emit('tutorial-complete', {});
        return;

      // Raw sensor data (optional — for live visualisation)
      case 'sensor':
        this.emit('tutorial-sensor', {
          x: msg.x,
          y: msg.y,
          z: msg.z,
          mag: msg.mag,
          state: msg.state,
        });
        return;

      default:
        return;
    }
  }
}

export const tutorialBridge = new TutorialBridge();