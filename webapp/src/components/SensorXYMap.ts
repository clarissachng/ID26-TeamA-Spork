/**
 * SensorXYMap — real-time X-Y axis plot showing magnetometer position.
 *
 * Draws a trail of recent sensor (x, y) readings on a canvas, so the user
 * can see if they are moving the magnet in a circle.
 *
 * States:
 *  - sensing: trail drawn in a muted colour
 *  - confirmed: trail turns green on correct motion detection
 */

const TRAIL_LENGTH = 60;   // number of recent points to keep
const CANVAS_SIZE = 160;   // px — square canvas
const DOT_RADIUS = 3;
const TRAIL_WIDTH = 2;

interface Point { x: number; y: number }


export class SensorXYMap {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlayImg?: HTMLImageElement;
  private trail: Point[] = [];
  private confirmed = false;
  private sensorHandler: ((e: Event) => void) | null = null;

  constructor(parent: HTMLElement, overlayImgSrc?: string) {
    this.el = document.createElement('div');
    this.el.className = 'sensor-xy-map';
    this.el.style.position = 'relative';
    this.el.style.width = `${CANVAS_SIZE}px`;
    this.el.style.height = `${CANVAS_SIZE}px`;
    this.el.style.background = 'none';

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.canvas.className = 'sensor-xy-map__canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.zIndex = '1';
    this.ctx = this.canvas.getContext('2d')!;

    if (overlayImgSrc) {
      this.overlayImg = document.createElement('img');
      this.overlayImg.src = overlayImgSrc;
      this.overlayImg.alt = 'Motion Guide';
      this.overlayImg.style.position = 'absolute';
      this.overlayImg.style.top = '0';
      this.overlayImg.style.left = '0';
      this.overlayImg.style.width = `${CANVAS_SIZE}px`;
      this.overlayImg.style.height = `${CANVAS_SIZE}px`;
      this.overlayImg.style.pointerEvents = 'none';
      this.overlayImg.style.zIndex = '2';
      this.el.appendChild(this.overlayImg);
    }

    this.el.appendChild(this.canvas);
    parent.appendChild(this.el);

    this.drawAxes();
  }

  /** Start listening to live sensor-data events */
  startListening(): void {
    this.sensorHandler = (e: Event) => {
      if (this.confirmed) return;
      const { x, y } = (e as CustomEvent).detail as { x: number; y: number };
      this.addPoint(x, y);
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

  /** Add a sensor reading and redraw */
  private addPoint(x: number, y: number): void {
    this.trail.push({ x, y });
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    this.draw();
  }

  /** Lock the display and turn the trail green */
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
    const size = CANVAS_SIZE;
    const half = size / 2;

    ctx.clearRect(0, 0, size, size);
    this.drawAxes();

    if (this.trail.length < 2) return;

    // Map sensor values to canvas coords. Auto-scale to fit trail.
    const maxAbs = this.trail.reduce(
      (m, p) => Math.max(m, Math.abs(p.x), Math.abs(p.y)), 1,
    );
    const scale = (half - 12) / maxAbs; // leave padding

    const toCanvas = (p: Point) => ({
      cx: half + p.x * scale,
      cy: half - p.y * scale, // flip y so up is positive
    });

    // Trail line
    ctx.beginPath();
    const start = toCanvas(this.trail[0]);
    ctx.moveTo(start.cx, start.cy);

    for (let i = 1; i < this.trail.length; i++) {
      const { cx, cy } = toCanvas(this.trail[i]);
      ctx.lineTo(cx, cy);
    }

    ctx.strokeStyle = this.confirmed
      ? 'rgba(100, 210, 80, 0.9)'
      : 'rgba(180, 140, 100, 0.6)';
    ctx.lineWidth = TRAIL_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Current position dot
    const last = toCanvas(this.trail[this.trail.length - 1]);
    ctx.beginPath();
    ctx.arc(last.cx, last.cy, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = this.confirmed ? '#5ece4b' : '#8b6f47';
    ctx.fill();
  }

  private drawAxes(): void {
    const ctx = this.ctx;
    const size = CANVAS_SIZE;
    const half = size / 2;

    ctx.strokeStyle = 'rgba(120, 100, 80, 0.2)';
    ctx.lineWidth = 1;

    // Horizontal axis
    ctx.beginPath();
    ctx.moveTo(8, half);
    ctx.lineTo(size - 8, half);
    ctx.stroke();

    // Vertical axis
    ctx.beginPath();
    ctx.moveTo(half, 8);
    ctx.lineTo(half, size - 8);
    ctx.stroke();

    // Labels
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(120, 100, 80, 0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('X', size - 10, half - 4);
    ctx.fillText('Y', half + 10, 14);
  }
}
