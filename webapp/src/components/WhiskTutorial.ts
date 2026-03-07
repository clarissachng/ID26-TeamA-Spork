/**
 * WhiskTutorial — interactive matcha whisk animation component.
 *
 * Layered PNG assets:
 *  - whisk_bowl.png   (static chawan bowl)
 *  - whisk_chasen.png (bamboo whisk — whisks side-to-side)
 *
 * States:
 *  - idle: slow gentle left-right sway
 *  - success: rapid whisking burst
 *  - wrong: shake
 */

export class WhiskTutorial {
  private el: HTMLElement;
  private chasen: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'whisk-tutorial';

    const wrapper = document.createElement('div');
    wrapper.className = 'whisk-wrapper';

    const scene = document.createElement('div');
    scene.className = 'whisk-scene';

    const bowl = document.createElement('img');
    bowl.src = '/assets/whisk_bowl.png';
    bowl.alt = 'Matcha bowl';
    bowl.className = 'whisk-layer whisk-bowl';
    bowl.draggable = false;

    this.chasen = document.createElement('img');
    this.chasen.src = '/assets/whisk_chasen.png';
    this.chasen.alt = 'Bamboo whisk';
    this.chasen.className = 'whisk-layer whisk-chasen';
    this.chasen.draggable = false;

    scene.appendChild(bowl);
    scene.appendChild(this.chasen);

    // Motion arrow hint
    const arrow = document.createElement('img');
    arrow.src = '/assets/motion_arrows/3.png';
    arrow.alt = 'Whisk motion hint';
    arrow.className = 'whisk-hint-arrow';
    arrow.draggable = false;

    wrapper.appendChild(scene);
    wrapper.appendChild(arrow);

    this.el.appendChild(wrapper);
    parent.appendChild(this.el);
  }

  /** Start idle animation */
  start(): void {
    this.startIdle();
  }

  /** Slow left-right sway */
  private startIdle(): void {
    this.el.classList.remove('success', 'wrong');
    this.chasen.style.animation = 'whiskIdle 1.8s ease-in-out infinite';
  }

  /** Correct motion: rapid whisk burst */
  triggerSuccess(): void {
    this.el.classList.add('success');
    this.chasen.style.animation = 'whiskSuccess 0.6s ease-out forwards';
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
    this.el.remove();
  }

  get element(): HTMLElement {
    return this.el;
  }
}
