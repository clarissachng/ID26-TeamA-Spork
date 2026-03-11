/**
 * WebSocket bridge — connects to Python backend on ws://localhost:8765
 * and translates detection events onto the shared event bus.
 */
import { bus } from './modules/eventBus';

const WS_URL = 'ws://localhost:8765';
const RECONNECT_DELAY_MS = 2000;

const MOTION_MAP: Record<string, string> = {
  'circular': 'grinding',
  'teabag':   'up_down',
  'up_down':  'press_down',
};

class WebSocketBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;

  connect(): void {
    this.enabled = true;
    this.open();
  }

  disconnect(): void {
    this.enabled = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private open(): void {
    if (!this.enabled) return;
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('[WS] Connected to Python backend');
      bus.emit('backend-connected');
    };

    this.ws.onclose = () => {
      console.warn('[WS] Disconnected — reconnecting in', RECONNECT_DELAY_MS, 'ms');
      bus.emit('backend-disconnected');
      if (this.enabled) {
        this.reconnectTimer = setTimeout(() => this.open(), RECONNECT_DELAY_MS);
      }
    };

    this.ws.onerror = (e) => console.error('[WS] Error:', e);

    this.ws.onmessage = (event) => {
      try {
        this.handleMessage(JSON.parse(event.data));
      } catch {
        // ignore malformed messages
      }
    };
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Forward raw sensor data onto the bus (feeds chart + compass visualiser)
    if (msg.sensor === true) {
      bus.emit('sensor-data', {
        x: msg.x as number,
        y: msg.y as number,
        z: msg.z as number,
        magnitude: msg.mag as number,
        timestamp: Date.now(),
      });
      bus.emit('backend-state', {
        state: msg.state as string,
        phase_remaining: msg.phase_remaining as number,
        noise_floor: msg.noise_floor as number,
      });
    }

    // Forward detection events onto the bus
    if (msg.detected === true && typeof msg.motion === 'string') {
      const frontendMotion = MOTION_MAP[msg.motion];
      if (frontendMotion) {
        console.log('[WS] Motion detected:', msg.motion, '->', frontendMotion, 'confidence:', msg.confidence);
        bus.emit('motion-detected', frontendMotion, msg.confidence as number);
      } else {
        console.warn('[WS] Unknown motion from backend:', msg.motion);
      }
    }
  }
}

export const wsBridge = new WebSocketBridge();
