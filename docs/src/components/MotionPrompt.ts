/**
 * MotionPrompt — shows the current expected motion with image asset,
 * label, description, and optional countdown timer.
 *
 * Usage:
 *   const prompt = new MotionPrompt(parentEl);
 *   prompt.show('circle');
 *   prompt.startTimer(8);
 *   prompt.markSuccess();
 */
import { MOTION_META, type MotionType } from '../types/motion.types.ts';

export class MotionPrompt {
  private el: HTMLElement;
  private assetEl: HTMLElement;
  private labelEl: HTMLElement;
  private descEl: HTMLElement;
  private timerEl: HTMLElement;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'motion-prompt';

    this.assetEl = document.createElement('div');
    this.assetEl.className = 'motion-prompt__emoji';

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'motion-prompt__label';

    this.descEl = document.createElement('div');
    this.descEl.className = 'motion-prompt__desc';

    this.timerEl = document.createElement('div');
    this.timerEl.className = 'motion-prompt__timer';

    this.el.append(this.assetEl, this.labelEl, this.descEl, this.timerEl);
    parent.appendChild(this.el);
  }

  /** Show a motion prompt */
  show(motion: MotionType): void {
    const meta = MOTION_META[motion];
    this.assetEl.innerHTML = `<img class="motion-prompt__asset" src="${meta.asset}" alt="${meta.label}" />`;
    this.labelEl.textContent = meta.label;
    this.descEl.textContent = meta.description;
    this.timerEl.textContent = '';
    // Re-trigger animation
    this.el.style.animation = 'none';
    void this.el.offsetHeight; // force reflow
    this.el.style.animation = '';
    this.el.classList.remove('success', 'fail');
  }

  /** Start a countdown timer (seconds). Calls onExpire when done. */
  startTimer(seconds: number, onExpire?: () => void): void {
    this.stopTimer();
    let remaining = seconds;
    this.timerEl.textContent = String(remaining);

    this.timerInterval = setInterval(() => {
      remaining--;
      this.timerEl.textContent = remaining > 0 ? String(remaining) : '';

      if (remaining <= 3 && remaining > 0) {
        this.timerEl.style.color = 'var(--accent-rose)';
      }

      if (remaining <= 0) {
        this.stopTimer();
        onExpire?.();
      }
    }, 1000);
  }

  /** Stop the running timer */
  stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.timerEl.style.color = '';
  }

  /** Flash success on this prompt */
  markSuccess(): void {
    this.el.classList.add('success');
    this.assetEl.textContent = '✅';
  }

  /** Flash failure on this prompt */
  markFail(): void {
    this.el.classList.add('fail');
    this.assetEl.textContent = '❌';
  }

  /** Hide / clear the prompt */
  clear(): void {
    this.stopTimer();
    this.assetEl.textContent = '';
    this.labelEl.textContent = '';
    this.descEl.textContent = '';
    this.timerEl.textContent = '';
  }

  /** Remove from DOM */
  destroy(): void {
    this.stopTimer();
    this.el.remove();
  }

  get element(): HTMLElement {
    return this.el;
  }
}
