/**
 * PressTutorial — interactive french press animation component.
 *
 * Uses layered press assets (bottom, middle, top), with only the middle layer
 * animating downward to demonstrate the "press down" gesture.
 *
 * States:
 *  - idle: gentle downward nudge hint
 *  - success: full press down
 *  - wrong: shake
 */

export class PressTutorial {
  private el: HTMLElement;
  private middleLayer!: HTMLImageElement;
  private motionHandler: ((e: Event) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'press-tutorial';

    const wrapper = document.createElement('div');
    wrapper.className = 'press-wrapper';

    const scene = document.createElement('div');
    scene.className = 'press-scene';

    const layers = [
      { key: 'bottom', src: '/assets/tutorial_press/press_bottom.png', alt: 'Press bottom' },
      { key: 'middle', src: '/assets/tutorial_press/press_middle.png', alt: 'Press plunger' },
      { key: 'top', src: '/assets/tutorial_press/press_top.png', alt: 'Press top' }
    ] as const;

    layers.forEach((layer) => {
      const img = document.createElement('img');
      img.src = layer.src;
      img.alt = layer.alt;
      img.className = `press-layer press-${layer.key}`;
      img.draggable = false;
      scene.appendChild(img);

      if (layer.key === 'middle') {
        this.middleLayer = img;
      }
    });

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
      }
    });
    document.addEventListener('motion-detected', this.motionHandler);
  }

  /** Static idle — no animation until visuals are added */
  private startIdle(): void {
    this.el.classList.remove('success', 'wrong');
    this.middleLayer.style.animation = 'none';
  }

  /** Correct motion: full press down */
  triggerSuccess(): void {
    this.el.classList.add('success');
    this.middleLayer.style.animation = '';
    void this.middleLayer.offsetWidth;
    this.middleLayer.style.animation = 'pressSuccess 1.25s cubic-bezier(0.22, 1, 0.36, 1) forwards';

    this.middleLayer.addEventListener('animationend', () => {
      this.el.classList.remove('success');
      this.middleLayer.style.animation = 'none';
    }, { once: true });
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
