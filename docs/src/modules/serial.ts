/**
 * Serial connection module — connects to Arduino magnetometer via Web Serial API.
 * Reads JSON lines at 115200 baud, applies exponential smoothing,
 * and emits 'sensor-data' events on the bus.
 */
import { bus } from './eventBus';
import type { MagReading, SensorData } from './types';

const BAUD_RATE = 115200;
const ALPHA = 0.4; // exponential smoothing factor

class SerialConnection {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private running = false;

  // Smoothed values
  private sX = 0;
  private sY = 0;
  private sZ = 0;

  // Tare / zero offsets
  private offsetX = 0;
  private offsetY = 0;
  private offsetZ = 0;

  get isConnected(): boolean {
    return this.running;
  }

  /** Prompt user to select serial port and begin reading */
  async connect(): Promise<void> {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API not supported. Use Chrome or Edge.');
    }

    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: BAUD_RATE });
    this.running = true;
    bus.emit('serial-connected');

    const decoder = new TextDecoderStream();
    (this.port.readable as unknown as ReadableStream).pipeTo(decoder.writable);
    this.reader = decoder.readable.getReader();
    this.readLoop();
  }

  /** Disconnect and clean up */
  async disconnect(): Promise<void> {
    this.running = false;
    if (this.reader) {
      await this.reader.cancel();
      this.reader = null;
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
    bus.emit('serial-disconnected');
  }

  /** Zero / tare the sensor at the current smoothed position */
  tare(): void {
    this.offsetX = this.sX;
    this.offsetY = this.sY;
    this.offsetZ = this.sZ;
  }

  /** Internal read loop — parses JSON lines from serial stream */
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
            const raw: MagReading = JSON.parse(line.trim());
            this.processReading(raw);
          } catch {
            // skip malformed lines
          }
        }
      } catch (e) {
        if (this.running) {
          console.error('Serial read error:', e);
          bus.emit('serial-error', e);
        }
        break;
      }
    }
  }

  /** Apply smoothing, subtract offset, emit sensor-data */
  private processReading(raw: MagReading): void {
    this.sX = ALPHA * raw.x + (1 - ALPHA) * this.sX;
    this.sY = ALPHA * raw.y + (1 - ALPHA) * this.sY;
    this.sZ = ALPHA * raw.z + (1 - ALPHA) * this.sZ;

    const x = this.sX - this.offsetX;
    const y = this.sY - this.offsetY;
    const z = this.sZ - this.offsetZ;
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    const data: SensorData = { x, y, z, magnitude, timestamp: Date.now() };
    bus.emit('sensor-data', data);
  }
}

export const serial = new SerialConnection();
