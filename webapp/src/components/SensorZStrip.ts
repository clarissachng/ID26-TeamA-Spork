/**
 * SensorZStrip — vertical Z-axis motion visualiser.
 *
 * Shows a bouncing dot (+ fading trail) that tracks the Z magnetometer value,
 * so users can see vertical motion in real time.
 *
 * States:
 *  - sensing: dot and trail drawn in muted brown
 *  - confirmed: trail turns green on correct motion detection
 */

const TRAIL_LENGTH = 50;
const CANVAS_W = 60;
const CANVAS_H = 200;
const DOT_RADIUS = 5;
const TRAIL_WIDTH = 2.5;

export class SensorZStrip {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private trail: number[] = [];   // recent Z values
  private confirmed = false;
  private sensorHandler: ((e: Event) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sensor-z-strip';

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.canvas.className = 'sensor-z-strip__canvas';
    this.ctx = this.canvas.getContext('2d')!;

    this.el.appendChild(this.canvas);
    parent.appendChild(this.el);

    this.drawTrack();
  }

  /** Start listening to live sensor-data events */
  startListening(): void {
    this.sensorHandler = (e: Event) => {
      if (this.confirmed) return;
      const { z } = (e as CustomEvent).detail as { z: number };
      this.addSample(z);
    };
    document.addEventListener('sensor-data', this.sensorHandler);
  }

  /** Stop listening */
  stopListening(): void {
    if (this.sensorHandler) {
      document.removeEventListener('sensor-data', this.sensorHandler);
      this.sensorHandler = null;
    }
  }

  private addSample(z: number): void {
    this.trail.push(z);
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    this.draw();
  }

  /** Lock display and turn green */
  confirm(): void {
    this.confirmed = true;
    this.draw();
  }

  /** Reset to sensing state */
  reset(): void {
    this.confirmed = false;
    this.trail = [];
    this.draw();
  }

  /** Clean up */
  destroy(): void {
    this.stopListening();
    this.el.remove();
  }

  /* ── Drawing ─────────────────────────────────────── */

  private draw(): void {
    const ctx = this.ctx;
    const w = CANVAS_W;
    const h = CANVAS_H;
    const pad = 16;
    const usableH = h - pad * 2;

    ctx.clearRect(0, 0, w, h);
    this.drawTrack();

    if (this.trail.length < 2) return;

    // Auto-scale Z to canvas: map range to [pad, h - pad]
    const maxAbs = this.trail.reduce((m, z) => Math.max(m, Math.abs(z)), 1);
    const toY = (z: number) => h / 2 - (z / maxAbs) * (usableH / 2);

    const trailColor = this.confirmed
      ? 'rgba(100, 210, 80, 0.7)'
      : 'rgba(180, 140, 100, 0.7)';
    const dotColor = this.confirmed ? '#5ece4b' : '#8b6f47';

    // Draw scrolling line graph (left = oldest, right = newest)
    ctx.beginPath();
    for (let i = 0; i < this.trail.length; i++) {
      const x = (i / (TRAIL_LENGTH - 1)) * (w - pad * 2) + pad;
      const y = toY(this.trail[i]);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = TRAIL_WIDTH;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Current position dot (rightmost)
    const lastX = ((this.trail.length - 1) / (TRAIL_LENGTH - 1)) * (w - pad * 2) + pad;
    const lastY = toY(this.trail[this.trail.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Subtle glow around dot
    ctx.beginPath();
    ctx.arc(lastX, lastY, DOT_RADIUS + 4, 0, Math.PI * 2);
    ctx.fillStyle = this.confirmed
      ? 'rgba(100, 210, 80, 0.2)'
      : 'rgba(180, 140, 100, 0.15)';
    ctx.fill();
  }

  /** Draw the vertical track (guide rail) */
  private drawTrack(): void {
    const ctx = this.ctx;
    const w = CANVAS_W;
    const h = CANVAS_H;
    const centerX = w / 2;

    // Vertical guide line
    ctx.strokeStyle = 'rgba(120, 100, 80, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX, 12);
    ctx.lineTo(centerX, h - 12);
    ctx.stroke();
    ctx.setLineDash([]);

    // Top/bottom tick marks
    ctx.strokeStyle = 'rgba(120, 100, 80, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX - 8, 16);
    ctx.lineTo(centerX + 8, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX - 8, h - 16);
    ctx.lineTo(centerX + 8, h - 16);
    ctx.stroke();

    // Center tick
    ctx.beginPath();
    ctx.moveTo(centerX - 6, h / 2);
    ctx.lineTo(centerX + 6, h / 2);
    ctx.stroke();

    // Label
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(120, 100, 80, 0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('Z', centerX, 10);
  }
}
