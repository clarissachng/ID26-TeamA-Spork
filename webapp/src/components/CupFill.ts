/**
 * CupFill — animated cup component that reacts to sensor magnitude.
 *
 * Two visual states:
 *  - **sensing**: fill tracks live sensor magnitude in a light tan colour
 *  - **confirmed**: on correct motion detection the fill locks and turns dark brown
 *
 * Usage:
 *   const cup = new CupFill(parentEl);
 *   cup.setSensorFill(0.4);       // live magnitude → light fill
 *   cup.confirmFill(0.85);        // correct motion → dark brown at 85%
 *   cup.reset();
 *   cup.destroy();
 */

/** Magnitude value (µT) that maps to 100% fill */
const MAG_SCALE = 300;

export class CupFill {
  private el: HTMLElement;
  private fillEl: HTMLElement;
  private labelEl: HTMLElement;
  private confirmed = false;
  private sensorHandler: ((e: Event) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cup cup--sensing';
    this.el.setAttribute('role', 'progressbar');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    this.el.setAttribute('aria-valuenow', '0');

    this.fillEl = document.createElement('div');
    this.fillEl.className = 'cup__fill';

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'cup__label';
    this.labelEl.textContent = '';

    this.el.appendChild(this.fillEl);
    this.el.appendChild(this.labelEl);
    parent.appendChild(this.el);
  }

  /** Start listening to live sensor-data events from the WebSocket */
  startListening(): void {
    this.sensorHandler = (e: Event) => {
      if (this.confirmed) return;
      const { mag } = (e as CustomEvent).detail as { mag: number };
      const fraction = Math.min(1, Math.abs(mag) / MAG_SCALE);
      this.setSensorFill(fraction);
    };
    document.addEventListener('sensor-data', this.sensorHandler);
  }

  /** Stop listening to sensor events */
  stopListening(): void {
    if (this.sensorHandler) {
      document.removeEventListener('sensor-data', this.sensorHandler);
      this.sensorHandler = null;
    }
  }

  /** Set fill from live sensor magnitude (light colour). 0–1. */
  setSensorFill(fraction: number): void {
    if (this.confirmed) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    this.fillEl.style.transform = `scaleY(${clamped})`;
    this.el.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
  }

  /**
   * Lock the fill at the given level and switch to the dark "confirmed" colour.
   * Call this when the correct motion is detected.
   */
  confirmFill(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.confirmed = true;
    this.el.classList.remove('cup--sensing');
    this.el.classList.add('cup--confirmed');
    this.fillEl.style.transform = `scaleY(${clamped})`;
    const pct = Math.round(clamped * 100);
    this.labelEl.textContent = `${pct}%`;
    this.el.setAttribute('aria-valuenow', String(pct));
    this.splash();
  }

  /** Set fill level directly (0–1). Animates via CSS transition. */
  setFill(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    const pct = Math.round(clamped * 100);
    this.fillEl.style.transform = `scaleY(${clamped})`;
    this.labelEl.textContent = `${pct}%`;
    this.el.setAttribute('aria-valuenow', String(pct));
  }

  /** Get current fill fraction (0–1) */
  getFill(): number {
    const match = this.fillEl.style.transform.match(/scaleY\(([\d.]+)\)/);
    return match ? parseFloat(match[1]) : 0;
  }

  /** Animate a quick "splash" highlight */
  splash(): void {
    this.fillEl.style.filter = 'brightness(1.4)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.fillEl.style.filter = '';
      });
    });
  }

  /** Reset to empty, sensing state */
  reset(): void {
    this.confirmed = false;
    this.el.classList.remove('cup--confirmed');
    this.el.classList.add('cup--sensing');
    this.fillEl.style.transform = 'scaleY(0)';
    this.labelEl.textContent = '';
    this.el.setAttribute('aria-valuenow', '0');
  }

  /** Remove from DOM and clean up listeners */
  destroy(): void {
    this.stopListening();
    this.el.remove();
  }

  /** Get the root element (for custom positioning) */
  get element(): HTMLElement {
    return this.el;
  }
}
