/**
 * Simple typed event emitter for decoupled communication between modules
 */
import type { EventCallback } from './types';

export class EventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (e) {
        console.error(`EventBus error in "${event}":`, e);
      }
    });
  }
}

export const bus = new EventBus();
