/**
 * GrinderTutorial — interactive coffee grinder animation component.
 *
 * Shows three layered PNG assets stacked:
 *  - grinder_body.png (static base)
 *  - grinder_handle.png (rotating handle)
 *
 * States:
 *  - success: fast spin on correct motion (circle)
 *  - wrong: shake animation on incorrect motion
 */
import type { MotionType } from '../types/motion.types.ts';
import { assetUrl } from '../utils/asset.ts';

export class GrinderTutorial {
  private el: HTMLElement;
  private container: HTMLElement;
  private handle: HTMLImageElement;
  private motionHandler: ((e: Event) => void) | null = null;
  private expectedMotion: MotionType = 'grinding';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'grinder-tutorial';

    this.container = document.createElement('div');
    this.container.className = 'grinder-container';

    const body = document.createElement('img');
    body.src = assetUrl('/assets/tutorial_grinder/grinder_body.png');
    body.alt = 'Grinder body';
    body.className = 'grinder-layer grinder-body';
    body.draggable = false;

    this.handle = document.createElement('img');
    this.handle.src = assetUrl('/assets/tutorial_grinder/grinder_handle.png');
    this.handle.alt = 'Grinder handle';
    this.handle.className = 'grinder-layer grinder-handle';
    this.handle.draggable = false;

    this.container.appendChild(body);
    this.container.appendChild(this.handle);

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
    this.handle.style.animation = 'none';
    this.motionHandler = ((e: Event) => {
      const detail = (e as CustomEvent).detail as { motion: MotionType; confidence: number };
      if (detail.motion === this.expectedMotion) this.triggerSuccess();
    });
    document.addEventListener('motion-detected', this.motionHandler);
  }

  /** Stop listening for motion events */
  stop(): void {
    if (this.motionHandler) {
      document.removeEventListener('motion-detected', this.motionHandler);
      this.motionHandler = null;
    }
  }

  /** Correct motion: fast spin, then reset to still */
  triggerSuccess(): void {
    this.el.classList.remove('wrong');
    this.el.classList.add('success');
    this.handle.style.animation = '';
    void this.handle.offsetWidth;
    this.handle.style.animation = 'grindSuccess 0.8s ease-out forwards';
    this.handle.addEventListener('animationend', () => {
      this.el.classList.remove('success');
      this.handle.style.animation = 'none';
    }, { once: true });
  }

  /** Wrong motion: shake the container */
  triggerWrong(): void {
    this.el.classList.remove('wrong');
    void this.el.offsetWidth;
    this.el.classList.add('wrong');
    setTimeout(() => this.el.classList.remove('wrong'), 450);
  }

  /** Reset to still state */
  reset(): void {
    this.handle.style.animation = 'none';
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