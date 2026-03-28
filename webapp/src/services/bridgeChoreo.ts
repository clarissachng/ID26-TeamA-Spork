import { WebSocketBridge } from '../websocketBridge.ts';

/**
 * Choreograph bridge service — handles communication with bridge_choreo.py.
 * Similar to playBridge and tutorialBridge but for the creative mode.
 */
class BridgeChoreo extends WebSocketBridge {
  constructor() {
    super('ChoreoBridge');
    
    // Listen for events from the shared WebSocketBridge bus
    import('../modules/eventBus').then(({ bus }) => {
      bus.on('sensor-data', (data) => {
        document.dispatchEvent(new CustomEvent('choreo-sensor', { detail: data }));
      });
    });
  }

  // Override handleMessage to emit choreo-specific events
  protected handleMessage(msg: Record<string, unknown>): void {
    if (msg.type === 'prompt') {
      document.dispatchEvent(new CustomEvent('choreo-prompt', { detail: msg }));
    } else if (msg.type === 'countdown') {
      document.dispatchEvent(new CustomEvent('choreo-countdown', { detail: msg }));
    } else if (msg.type === 'recording') {
      document.dispatchEvent(new CustomEvent('choreo-recording', { detail: msg }));
    } else if (msg.type === 'result') {
      document.dispatchEvent(new CustomEvent('choreo-result', { detail: msg }));
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  sendUiState(page: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'ui_state', page }));
  }

  async waitForConnection(timeoutMs = 5000): Promise<boolean> {
    if (this.connected) return true;
    
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (this.connected) resolve(true);
        else if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(check, 100);
      };
      check();
    });
  }
}

export const bridgeChoreo = new BridgeChoreo();
