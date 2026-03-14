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
  private cup: HTMLImageElement;
  private motionHandler: ((e: Event) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dip-tutorial';

    const wrapper = document.createElement('div');
    wrapper.className = 'dip-wrapper';

    const scene = document.createElement('div');
    scene.className = 'dip-scene';

    this.teabag = document.createElement('img');
    this.teabag.src = '/assets/tutorial-tea/teabag.PNG';
    this.teabag.alt = 'Teabag';
    this.teabag.className = 'dip-layer dip-teabag';
    this.teabag.draggable = false;

    this.cup = document.createElement('img');
    this.cup.src = '/assets/tutorial-tea/cup.PNG';
    this.cup.alt = 'Cup';
    this.cup.className = 'dip-layer dip-cup';
    this.cup.draggable = false;

    scene.appendChild(this.teabag);
    scene.appendChild(this.cup);

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
      }
    });
    document.addEventListener('motion-detected', this.motionHandler);
  }

  /** Idle loop: teabag hovers above cup with a gentle bobbing hint */
  private startIdle(): void {
    this.el.classList.remove('success', 'wrong');
    this.teabag.style.animation = 'none';
  }

  /** Correct motion: teabag dips twice into cup, then returns to still state */
  private triggerSuccess(): void {
    this.el.classList.add('success');
    this.teabag.style.animation = '';
    void this.teabag.offsetWidth; // force reflow so re-trigger works
    this.teabag.style.animation = 'dipSuccess 1.6s cubic-bezier(0.22, 1, 0.36, 1) forwards';

    // Resume idle hover after the dip completes.
    this.teabag.addEventListener('animationend', () => {
      this.el.classList.remove('success');
      this.teabag.style.animation = 'none';
    }, { once: true });
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
