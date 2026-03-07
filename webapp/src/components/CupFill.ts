/**
 * CupFill — animated cup component that fills based on accuracy %.
 *
 * Usage:
 *   const cup = new CupFill(parentEl);
 *   cup.setFill(0.65);   // 65 %
 *   cup.destroy();
 */

export class CupFill {
  private el: HTMLElement;
  private fillEl: HTMLElement;
  private labelEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cup';
    this.el.setAttribute('role', 'progressbar');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    this.el.setAttribute('aria-valuenow', '0');

    this.fillEl = document.createElement('div');
    this.fillEl.className = 'cup__fill';

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'cup__label';
    this.labelEl.textContent = '0%';

    this.el.appendChild(this.fillEl);
    this.el.appendChild(this.labelEl);
    parent.appendChild(this.el);
  }

  /** Set fill level (0–1). Animates via CSS transition. */
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
    this.fillEl.style.transition = 'none';
    this.fillEl.style.filter = 'brightness(1.4)';
    requestAnimationFrame(() => {
      this.fillEl.style.transition = '';
      requestAnimationFrame(() => {
        this.fillEl.style.filter = '';
      });
    });
  }

  /** Reset to 0 */
  reset(): void {
    this.setFill(0);
  }

  /** Remove from DOM */
  destroy(): void {
    this.el.remove();
  }

  /** Get the root element (for custom positioning) */
  get element(): HTMLElement {
    return this.el;
  }
}
