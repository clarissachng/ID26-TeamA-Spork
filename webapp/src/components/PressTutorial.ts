/**
 * PressTutorial — interactive french press animation component.
 *
 * Uses front_press.PNG asset, animating it with a downward pressing motion
 * to demonstrate the "press down" gesture (like pushing a french press plunger).
 *
 * States:
 *  - idle: gentle downward nudge hint
 *  - success: full press down
 *  - wrong: shake
 */

export class PressTutorial {
  private el: HTMLElement;
  private press: HTMLImageElement;
  private motionHandler: ((e: Event) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'press-tutorial';

    const wrapper = document.createElement('div');
    wrapper.className = 'press-wrapper';

    const scene = document.createElement('div');
    scene.className = 'press-scene';

    this.press = document.createElement('img');
    this.press.src = '/assets/front_press.PNG';
    this.press.alt = 'French Press';
    this.press.className = 'press-layer press-plunger';
    this.press.draggable = false;

    scene.appendChild(this.press);

    wrapper.appendChild(scene);

    this.el.appendChild(wrapper);
    parent.appendChild(this.el);
  }

  /** Start idle animation and listen for motion events */
  start(): void {
    this.startIdle();

    this.motionHandler = ((e: Event) => {
      const detail = (e as CustomEvent).detail as { motion: string; confidence: number };
      if (detail.motion === 'press_down') {
        this.triggerSuccess();
      } else {
        this.triggerWrong();
      }
    });
    document.addEventListener('motion-detected', this.motionHandler);
  }

  /** Static idle — no animation until visuals are added */
  private startIdle(): void {
    this.el.classList.remove('success', 'wrong');
    this.press.style.animation = 'none';
  }

  /** Correct motion: full press down */
  triggerSuccess(): void {
    this.el.classList.add('success');
    this.press.style.animation = 'pressSuccess 0.7s ease-out forwards';
  }

  /** Wrong motion: shake */
  triggerWrong(): void {
    this.el.classList.add('wrong');
    this.el.style.animation = 'shake 0.4s ease';
    setTimeout(() => {
      this.el.style.animation = '';
      this.el.classList.remove('wrong');
    }, 400);
  }

  /** Reset to idle */
  reset(): void {
    this.startIdle();
    this.el.classList.remove('success', 'wrong');
  }

  destroy(): void {
    if (this.motionHandler) {
      document.removeEventListener('motion-detected', this.motionHandler);
      this.motionHandler = null;
    }
    this.el.remove();
  }

  get element(): HTMLElement {
    return this.el;
  }
}
