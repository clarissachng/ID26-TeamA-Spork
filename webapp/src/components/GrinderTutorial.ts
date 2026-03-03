/**
 * GrinderTutorial — interactive coffee grinder animation component.
 *
 * Shows three layered PNG assets stacked:
 *  - grinder_body.png (static base)
 *  - grinder_full.png (reference, hidden)
 *  - grinder_handle.png (rotating handle)
 *
 * States:
 *  - idle: slow continuous rotation
 *  - success: fast spin on correct motion (circle)
 *  - wrong: shake animation on incorrect motion
 */
import type { MotionType } from '../types/motion.types.ts';

export class GrinderTutorial {
  private el: HTMLElement;
  private container: HTMLElement;
  private handle: HTMLElement;
  private motionHandler: ((e: Event) => void) | null = null;
  private expectedMotion: MotionType = 'circle';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'grinder-tutorial';

    this.container = document.createElement('div');
    this.container.className = 'grinder-container';

    // Three layers: body (static), full (hidden reference), handle (rotating)
    const body = document.createElement('img');
    body.src = '/assets/grinder_body.png';
    body.alt = 'Grinder body (static)';
    body.className = 'grinder-layer grinder-body';
    body.draggable = false;

    const full = document.createElement('img');
    full.src = '/assets/grinder_full.png';
    full.alt = 'Full grinder (reference)';
    full.className = 'grinder-layer grinder-full hidden';
    full.draggable = false;

    this.handle = document.createElement('img');
    this.handle.src = '/assets/grinder_handle.png';
    this.handle.alt = 'Grinder handle';
    this.handle.className = 'grinder-layer grinder-handle';
    this.handle.draggable = false;

    this.container.appendChild(body);
    this.container.appendChild(full);
    this.container.appendChild(this.handle);

    // Wrapper div for instruction and arrow
    const wrapper = document.createElement('div');
    wrapper.className = 'grinder-wrapper';

    const instruction = document.createElement('p');
    instruction.className = 'grinder-instruction';
    instruction.textContent = 'Rotate the grinder handle';

    const arrow = document.createElement('div');
    arrow.className = 'grinder-hint-arrow';

    wrapper.appendChild(instruction);
    wrapper.appendChild(this.container);
    wrapper.appendChild(arrow);

    this.el.appendChild(wrapper);
    parent.appendChild(this.el);
  }

  /** Start listening for motion events */
  start(): void {
    this.motionHandler = ((e: Event) => {
      const detail = (e as CustomEvent).detail as { motion: MotionType; confidence: number };

      if (detail.motion === this.expectedMotion) {
        this.triggerSuccess();
      } else {
        this.triggerWrong();
      }
    });

    // Start with idle animation
    this.startIdle();
    document.addEventListener('motion-detected', this.motionHandler);
  }

  /** Stop listening for motion events */
  stop(): void {
    if (this.motionHandler) {
      document.removeEventListener('motion-detected', this.motionHandler);
      this.motionHandler = null;
    }
  }

  /** Slow idle rotation animation */
  private startIdle(): void {
    this.el.classList.remove('success', 'wrong');
    this.handle.style.animation = '';
    void this.handle.offsetWidth; // force reflow
    this.handle.style.animation = 'grindIdle 3s linear infinite';
  }

  /** Correct motion: fast spin + background change */
  private triggerSuccess(): void {
    this.el.classList.add('success');
    this.handle.style.animation = 'grindSuccess 0.8s ease-out forwards';
    document.removeEventListener('motion-detected', this.motionHandler!);
    this.motionHandler = null;
  }

  /** Wrong motion: shake + red flash */
  private triggerWrong(): void {
    this.el.classList.add('wrong');
    this.el.style.animation = 'shake 0.4s ease';

    setTimeout(() => {
      this.el.style.animation = '';
      this.el.classList.remove('wrong');
    }, 400);
  }

  /** Reset to idle state */
  reset(): void {
    this.startIdle();
    this.el.classList.remove('success', 'wrong');
  }

  /** Remove from DOM and clean up */
  destroy(): void {
    this.stop();
    this.el.remove();
  }

  get element(): HTMLElement {
    return this.el;
  }
}
