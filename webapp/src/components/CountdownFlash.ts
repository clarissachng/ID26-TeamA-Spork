export class CountdownFlash {
  private overlayEl: HTMLDivElement;
  private numberEl: HTMLSpanElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'countdown-flash';

    this.numberEl = document.createElement('span');
    this.numberEl.className = 'countdown-flash__number';
    this.overlayEl.appendChild(this.numberEl);

    parent.appendChild(this.overlayEl);
  }

  flash(seconds: number): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.numberEl.textContent = String(seconds);

    // Retrigger pop animation reliably
    this.overlayEl.classList.remove('countdown-flash--visible', 'countdown-flash--pop');
    void this.overlayEl.offsetWidth; // force reflow
    this.overlayEl.classList.add('countdown-flash--visible', 'countdown-flash--pop');

    this.hideTimer = setTimeout(() => {
      this.hide();
    }, 800);
  }

  hide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.overlayEl.classList.remove('countdown-flash--visible', 'countdown-flash--pop');
  }

  destroy(): void {
    this.hide();
    this.overlayEl.remove();
  }
}

