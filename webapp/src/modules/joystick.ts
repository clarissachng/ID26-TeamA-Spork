/**
 * Joystick module — reads analog thumbstick from Arduino Mega
 * via Web Serial API and dispatches navigation and click events.
 */

const BAUD_RATE = 115200;
const DEAD_ZONE = 150;
const CENTRE = 512;
const REPEAT_MS = 150;

export type JoyDirection = 'up' | 'down' | 'left' | 'right' | 'none';

interface JoyState {
  jx: number;
  jy: number;
  btn: number;
  tool: string;
}

class Joystick {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private running = false;
  private lastDirection: JoyDirection = 'none';
  private lastRepeat = 0;
  private lastBtn = 0;
  private lastTool = 'none';

  onDirection: (dir: JoyDirection) => void = () => {};
  onClick: () => void = () => {};
  onToolScanned: (tool: string) => void = () => {};

  get isConnected(): boolean {
    return this.running;
  }

  async connect(): Promise<void> {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial not supported');
    }
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: BAUD_RATE });
    this.running = true;
    console.log('[JOY] Joystick connected');

    const decoder = new TextDecoderStream();
    (this.port.readable as unknown as ReadableStream).pipeTo(decoder.writable);
    this.reader = decoder.readable.getReader();
    this.readLoop();
  }

  async disconnect(): Promise<void> {
    this.running = false;
    await this.reader?.cancel();
    await this.port?.close();
    this.reader = null;
    this.port = null;
    console.log('[JOY] Joystick disconnected');
  }

  private async readLoop(): Promise<void> {
    let buffer = '';
    while (this.running && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const state: JoyState = JSON.parse(line.trim());
            this.process(state);
          } catch {
            // skip malformed lines
          }
        }
      } catch (e) {
        if (this.running) console.error('[JOY] Read error:', e);
        break;
      }
    }
  }

  private process(state: JoyState): void {
    console.log('[JOY] raw:', state);
    const now = Date.now();

    // Button — fire on press down only
    if (state.btn === 1 && this.lastBtn === 0) {
      this.onClick();
    }
    this.lastBtn = state.btn;

    // Tool scan — fire only when tool changes
    if (state.tool && state.tool !== 'none' && state.tool !== this.lastTool) {
      this.lastTool = state.tool;
      this.onToolScanned(state.tool);
    }
    if (state.tool === 'none') this.lastTool = 'none';

    // Direction with dead zone and repeat rate
    const dx = state.jx - CENTRE;
    const dy = state.jy - CENTRE;
    let dir: JoyDirection = 'none';

    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > DEAD_ZONE)  dir = 'right';
      if (dx < -DEAD_ZONE) dir = 'left';
    } else {
      if (dy > DEAD_ZONE)  dir = 'down';
      if (dy < -DEAD_ZONE) dir = 'up';
    }

    if (dir !== 'none') {
      if (dir !== this.lastDirection || now - this.lastRepeat > REPEAT_MS) {
        this.lastRepeat = now;
        this.onDirection(dir);
      }
    }
    this.lastDirection = dir;
  }
}

export const joystick = new Joystick();