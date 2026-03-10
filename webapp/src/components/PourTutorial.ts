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

