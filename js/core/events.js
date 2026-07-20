/**
 * events.js — minimal pub/sub event bus.
 * Modules communicate through events instead of importing each other,
 * which keeps the architecture loosely coupled and easy to extend.
 *
 * Well-known events:
 *   "profile:changed"  — the active profile was mutated and saved
 *   "data:ready"       — all JSON datasets finished loading
 *   "save:status"      — { state: "saving" | "saved" | "error" }
 *   "route:changed"    — { pageId }
 */
const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler); // return unsubscribe fn
}

export function off(event, handler) {
  listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((handler) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[events] handler for "${event}" failed:`, err);
    }
  });
}
