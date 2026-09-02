/* The `window.runtime` half of the shim: Wails' event bus, in memory.
 *
 * frontend/wailsjs/runtime/runtime.js is a set of one-line derefs of
 * `window.runtime.*` made *inside* each function body, so importing it is
 * always safe and only calling it throws. That is what lets this stand in for
 * the real runtime without the app knowing: everything below matches the
 * signatures the vendored runtime forwards to.
 *
 * EventsOn/EventsOnce both funnel through EventsOnMultiple upstream, so that
 * is the only registration function that needs implementing. It returns an
 * unsubscriber, which callers do store and call — tiles/mods/useMods.ts keeps
 * three of them and calls all three on cleanup.
 */

/** @type {Map<string, Set<{cb: Function, remaining: number}>>} */
const listeners = new Map();

export function EventsOnMultiple(eventName, callback, maxCallbacks) {
  const entry = { cb: callback, remaining: maxCallbacks ?? -1 };
  let set = listeners.get(eventName);
  if (!set) {
    set = new Set();
    listeners.set(eventName, set);
  }
  set.add(entry);
  return () => set.delete(entry);
}

export function EventsOn(eventName, callback) {
  return EventsOnMultiple(eventName, callback, -1);
}

export function EventsOnce(eventName, callback) {
  return EventsOnMultiple(eventName, callback, 1);
}

export function EventsOff(eventName, ...additional) {
  for (const name of [eventName, ...additional]) listeners.delete(name);
}

export function EventsOffAll() {
  listeners.clear();
}

export function EventsEmit(eventName, ...args) {
  const set = listeners.get(eventName);
  if (!set) return;
  // Copied before iterating: a handler that unsubscribes itself — which the
  // one-shot path below does — would otherwise mutate the set mid-loop.
  for (const entry of [...set]) {
    try {
      entry.cb(...args);
    } catch (e) {
      // One bad subscriber must not stop the rest, exactly as the real bus
      // behaves. Logged rather than swallowed so a broken fixture is findable.
      console.error(`demo: listener for "${eventName}" threw`, e);
    }
    if (entry.remaining > 0 && --entry.remaining === 0) set.delete(entry);
  }
}
