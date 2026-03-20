/**
 * PressTutorial — interactive french press animation component.
 *
 * Uses layered press assets (bottom, middle, top), with only the middle layer
 * animating downward to demonstrate the "press down" gesture.
 *
 * States:
 *  - success: full press down
 *  - wrong: shake
 */
import { assetUrl } from '../utils/asset.ts';

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
      { key: 'bottom', src: assetUrl('/assets/tutorial_press/press_bottom.png'), alt: 'Press bottom' },
      { key: 'middle', src: assetUrl('/assets/tutorial_press/press_middle.png'), alt: 'Press plunger' },
      { key: 'top',    src: assetUrl('/assets/tutorial_press/press_top.png'),    alt: 'Press top' },
    ] as const;

    layers.forEach((layer) => {
      const img = document.createElement('img');
      img.src = layer.src;
      img.alt = layer.alt;
      img.className = `press-layer press-${layer.key}`;
      img.draggable = false;
      scene.appendChild(img);
      if (layer.key === 'middle') this.middleLayer = img;
    });

    wrapper.appendChild(scene);
    this.el.appendChild(wrapper);
    parent.appendChild(this.el);
  }

  /** Start listening for motion events */
  start(): void {
    this.middleLayer.style.animation = 'none';
    this.el.classList.remove('success', 'wrong');
    this.motionHandler = ((e: Event) => {
      const detail = (e as CustomEvent).detail as { motion: string; confidence: number };
      if (detail.motion === 'press_down') this.triggerSuccess();
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

  /** Correct motion: full press down */
  triggerSuccess(): void {
    // Clear any inline animation left over from triggerWrong
    this.el.style.animation = '';
    this.el.classList.remove('wrong');
    this.el.classList.add('success');

    this.middleLayer.style.animation = '';
    void this.middleLayer.offsetWidth;
    this.middleLayer.style.animation = 'pressSuccess 0.9s ease-out forwards';
    this.middleLayer.addEventListener(
      'animationend',
      () => {
        this.el.classList.remove('success');
        this.middleLayer.style.animation = 'none';
      },
      { once: true }
    );
  }

  /** Wrong motion: shake — CSS class handles the animation */
  triggerWrong(): void {
    this.el.style.animation = '';
    this.el.classList.remove('wrong');
    void this.el.offsetWidth;
    this.el.classList.add('wrong');
    setTimeout(() => {
      this.el.classList.remove('wrong');
    }, 450);
  }

  /** Reset to idle */
  reset(): void {
    this.middleLayer.style.animation = 'none';
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