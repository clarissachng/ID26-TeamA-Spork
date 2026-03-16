/**
 * Page Router — lightweight client-side page manager.
 *
 * Manages .page elements with enter / exit transitions.
 * No hash or History API needed — purely in-memory.
 */
import type { PageId } from '../types/motion.types.ts';

type NavigateCallback = (from: PageId | null, to: PageId) => void;

class Router {
  private currentPage: PageId | null = null;
  private listeners: NavigateCallback[] = [];

  /** Navigate to a page by ID. Handles CSS transition classes. */
  go(pageId: PageId, meta?: Record<string, string>): void {
    const prev = this.currentPage;

    // Same page with new meta — update data attrs and re-trigger active
    if (prev === pageId) {
      const el = document.getElementById(pageId);
      if (el && meta) {
        Object.entries(meta).forEach(([k, v]) => el.dataset[k] = v);
        // Re-trigger the MutationObserver by toggling the active class
        el.classList.remove('active');
        requestAnimationFrame(() => {
          el.style.display = 'block';
          el.classList.add('active');
        });
      }
      return;
    }

    const performNav = () => {
      // Exit current page
      if (prev) {
        const prevEl = document.getElementById(prev);
        if (prevEl) {
          prevEl.classList.remove('active');
          prevEl.classList.add('exit');
          // Clean up exit class after transition
          const onEnd = () => {
            prevEl.classList.remove('exit');
            prevEl.style.display = 'none';
            prevEl.removeEventListener('transitionend', onEnd);
          };
          prevEl.addEventListener('transitionend', onEnd, { once: true });
          // Fallback in case transitionend doesn't fire
          setTimeout(() => {
            prevEl.classList.remove('exit');
            prevEl.style.display = 'none';
          }, 600);
        }
      }

      // Enter new page
      const nextEl = document.getElementById(pageId);
      if (nextEl) {
        // Set data-* attributes for passing state (e.g. selected level)
        if (meta) {
          Object.entries(meta).forEach(([k, v]) => nextEl.dataset[k] = v);
        }
        // Make sure the new page is visible
        nextEl.style.display = 'block';
        // Small delay so the exit transition can start first
        requestAnimationFrame(() => {
          nextEl.classList.add('active');
        });
      }

      this.currentPage = pageId;
      this.listeners.forEach(cb => cb(prev, pageId));
    };

    const hero = document.getElementById('main-menu-hero');

    // Custom transition: leaving main menu → slide hero down, new page from top
    if (prev === 'main-menu' && pageId !== 'main-menu' && hero) {
      hero.classList.add('slide-out-down');

      setTimeout(() => {
        const incoming = document.getElementById(pageId);
        if (incoming) {
          incoming.classList.add('slide-in-from-top');
        }
        performNav();
      }, 500);

      return;
    }

    // Custom transition: returning to main menu → current page up, hero from below
    if (prev && prev !== 'main-menu' && pageId === 'main-menu' && hero) {
      const prevEl = document.getElementById(prev);
      if (prevEl) {
        prevEl.classList.add('slide-out-up-page');
      }

      // Prepare hero to rise from below
      hero.classList.remove('slide-out-down');
      hero.classList.add('slide-in-from-bottom');

      setTimeout(() => {
        if (prevEl) {
          prevEl.classList.remove('slide-out-up-page');
        }
        hero.classList.remove('slide-in-from-bottom');
        performNav();
      }, 500);

      return;
    }

    // Fallback: default fade/slide transitions
    performNav();
  }

  /** Get the currently active page */
  get current(): PageId | null {
    return this.currentPage;
  }

  /** Listen for page navigation events */
  onNavigate(cb: NavigateCallback): void {
    this.listeners.push(cb);
  }

  /** Go back to main menu */
  home(): void {
    this.go('main-menu');
  }
}

export const router = new Router();
