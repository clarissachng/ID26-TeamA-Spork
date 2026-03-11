/**
 * DipTutorial — interactive teabag dipping animation component.
 *
 * Uses front_tea.PNG asset, animating it with an up-and-down bobbing motion
 * to demonstrate the "dip" gesture (like dunking a teabag).
 *
 * States:
 *  - idle: gentle up-down bob hint
 *  - success: enthusiastic dip burst
 *  - wrong: shake
 */

export class DipTutorial {
  private el: HTMLElement;
  private teabag: HTMLImageElement;
  private motionHandler: ((e: Event) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dip-tutorial';

    const wrapper = document.createElement('div');
    wrapper.className = 'dip-wrapper';

    const scene = document.createElement('div');
    scene.className = 'dip-scene';

    this.teabag = document.createElement('img');
    this.teabag.src = '/assets/front_tea.PNG';
    this.teabag.alt = 'Teabag';
    this.teabag.className = 'dip-layer dip-teabag';
    this.teabag.draggable = false;

    scene.appendChild(this.teabag);

    wrapper.appendChild(scene);

    this.el.appendChild(wrapper);
    parent.appendChild(this.el);
  }

  /** Start idle animation and listen for motion events */
  start(): void {
    this.startIdle();

    this.motionHandler = ((e: Event) => {
      const detail = (e as CustomEvent).detail as { motion: string; confidence: number };
      if (detail.motion === 'up_down') {
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
    this.teabag.style.animation = 'none';
  }

  /** Correct motion: fast spin, then reset to still for the next round */
  private triggerSuccess(): void {
    this.el.classList.add('success');
    this.teabag.style.animation = '';
    void this.teabag.offsetWidth; // force reflow so re-trigger works
    this.teabag.style.animation = 'dipSuccess 0.8s ease-out forwards';

    // After the spin finishes, go back to still so it can animate again
    this.teabag.addEventListener('animationend', () => {
      this.el.classList.remove('success');
      this.teabag.style.animation = 'none';
    }, { once: true });
  }

  /** Wrong motion: shake + red flash */
  private triggerWrong(): void {
    this.el.classList.add('wrong');

    setTimeout(() => {
      this.el.classList.remove('wrong');
    }, 500);
  }

  /** Reset to still state */
  reset(): void {
    this.teabag.style.animation = 'none';
    this.el.classList.remove('success', 'wrong');
  }

  /** Stop listening for motion events */
  stop(): void {
    if (this.motionHandler) {
      document.removeEventListener('motion-detected', this.motionHandler);
      this.motionHandler = null;
    }
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
