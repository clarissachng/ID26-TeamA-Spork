/**
 * PourTutorial — interactive pouring animation component.
 *
 * Layered PNG assets:
 *  - pour_cup.png    (static cup at bottom-right)
 *  - pour_kettle.png (tilts to pour)
 *  - pour_stream.png (water stream, fades in while tilted)
 *
 * States:
 *  - idle: gentle kettle rocking hint
 *  - success: full tilt + stream visible
 *  - wrong: shake
 */

export class PourTutorial {
  private el: HTMLElement;
  private kettle: HTMLElement;
  private stream: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pour-tutorial';

    const wrapper = document.createElement('div');
    wrapper.className = 'pour-wrapper';

    // Scene container — layers stack via position: absolute
    const scene = document.createElement('div');
    scene.className = 'pour-scene';

    const cup = document.createElement('img');
    cup.src = '/assets/pour_cup.png';
    cup.alt = 'Cup';
    cup.className = 'pour-layer pour-cup';
    cup.draggable = false;

    this.stream = document.createElement('img');
    this.stream.src = '/assets/pour_stream.png';
    this.stream.alt = 'Water stream';
    this.stream.className = 'pour-layer pour-stream';
    this.stream.draggable = false;

    this.kettle = document.createElement('img');
    this.kettle.src = '/assets/pour_kettle.png';
    this.kettle.alt = 'Kettle';
    this.kettle.className = 'pour-layer pour-kettle';
    this.kettle.draggable = false;

    scene.appendChild(cup);
    scene.appendChild(this.stream);
    scene.appendChild(this.kettle);

    // Motion arrow hint
    const arrow = document.createElement('img');
    arrow.src = '/assets/motion_arrows/2.png';
    arrow.alt = 'Pour motion hint';
    arrow.className = 'pour-hint-arrow';
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

  /** Gentle rocking hint */
  private startIdle(): void {
    this.el.classList.remove('success', 'wrong');
    this.kettle.style.animation = 'pourIdle 2.5s ease-in-out infinite';
    this.stream.style.animation = 'pourStreamIdle 2.5s ease-in-out infinite';
  }

  /** Correct motion: full pour */
  triggerSuccess(): void {
    this.el.classList.add('success');
    this.kettle.style.animation = 'pourSuccess 0.8s ease-out forwards';
    this.stream.style.animation = 'pourStreamSuccess 0.8s ease-out forwards';
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
