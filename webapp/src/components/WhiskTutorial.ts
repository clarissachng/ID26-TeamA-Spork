/**
 * WhiskTutorial — interactive matcha whisk animation component.
 *


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
