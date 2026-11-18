/**
 * HomeHungerAnimator
 *
 * Periodically triggers the dog's hungry animation while the player is in the
 * home view. The controller is intentionally dumb: it only reads hunger state
 * from an injected store and invokes optional animation hooks on an injected
 * dog object. It has no knowledge of the Feed button, the home menu DOM, or any
 * other view concerns.
 *
 * All timing primitives (clock + interval functions) are injectable so tests
 * never need to wait on real timers.
 */

// Single source of truth for the hungry-animation cadence lives in the state
// store. Re-export it here so existing imports keep working.
import { DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS } from '../state/dog_state_store.js';

export { DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS };

// Resolve the host object that owns `setInterval`/`clearInterval`. In browsers
// this is `window`; in Node/workers it is `globalThis`. Captured once so the
// default timer wrappers always target the correct receiver.
const timerRoot = typeof window !== 'undefined' ? window : globalThis;

export class HomeHungerAnimator {
  /**
   * @param {Object} options
   * @param {Object} options.dogStateStore - Store exposing getHunger(nowMs).
   * @param {Object} options.dog - Dog instance exposing optional
   *   setHunger(hungerInfo) and playHungryAnimation() hooks.
   * @param {number} [options.tickIntervalMs=1000] - How often to poll hunger.
   * @param {number} [options.animationIntervalMs] - Minimum gap between hungry
   *   animation triggers while the dog stays hungry.
   * @param {Function} [options.now] - Clock returning epoch ms.
   * @param {Function} [options.setIntervalFn] - setInterval-compatible fn.
   * @param {Function} [options.clearIntervalFn] - clearInterval-compatible fn.
   */
  constructor({
    dogStateStore,
    dog,
    tickIntervalMs = 1000,
    animationIntervalMs = DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS,
    now = () => Date.now(),
    setIntervalFn = (...args) => timerRoot.setInterval(...args),
    clearIntervalFn = (...args) => timerRoot.clearInterval(...args)
  } = {}) {
    this._dogStateStore = dogStateStore;
    this._dog = dog;
    this._tickIntervalMs = tickIntervalMs;
    this._animationIntervalMs = animationIntervalMs;
    this._now = now;
    // Host timer functions must be invoked with `this === window` (or
    // `globalThis`), otherwise Chrome throws `TypeError: Illegal invocation`.
    // Binding to `timerRoot` (or wrapping in an arrow that calls through
    // `timerRoot`) guarantees the correct receiver regardless of how the
    // function is later invoked.
    this._setIntervalFn = typeof setIntervalFn === 'function'
      ? (setIntervalFn === timerRoot.setInterval
        ? setIntervalFn.bind(timerRoot)
        : (...args) => setIntervalFn(...args))
      : null;
    this._clearIntervalFn = typeof clearIntervalFn === 'function'
      ? (clearIntervalFn === timerRoot.clearInterval
        ? clearIntervalFn.bind(timerRoot)
        : (...args) => clearIntervalFn(...args))
      : null;

    this._intervalId = null;
    this._lastAnimationAt = null;
    // Persistent rotation index across due needs (hungry / grooming / rest).
    this._emoteIndex = 0;
  }

  /**
   * Begin polling hunger state. Idempotent: calling twice will not create a
   * second interval.
   */
  start() {
    if (this._intervalId !== null) return;
    if (!this._setIntervalFn) return;
    // Invoke via a local variable so `this` is never the animator instance.
    const fn = this._setIntervalFn;
    this._intervalId = fn(() => this.tick(), this._tickIntervalMs);
  }

  /**
   * Stop polling. Safe to call multiple times.
   */
  stop() {
    if (this._intervalId === null) return;
    if (this._clearIntervalFn) {
      // Invoke via a local variable so `this` is never the animator instance.
      const fn = this._clearIntervalFn;
      fn(this._intervalId);
    }
    this._intervalId = null;
  }

  /**
   * Evaluate needs once and trigger a single need animation as needed.
   * @param {number} [nowMs] - Current time in epoch ms.
   */
  tick(nowMs = this._now()) {
    const store = this._dogStateStore;
    if (!store || typeof store.getHunger !== 'function') return;

    // Defensive: a malformed or throwing injected store must never crash the
    // animation loop.
    let hungerInfo;
    try {
      hungerInfo = store.getHunger(nowMs);
    } catch (_err) {
      return;
    }

    let groomingInfo;
    if (typeof store.getGrooming === 'function') {
      try {
        groomingInfo = store.getGrooming(nowMs);
      } catch (_err) {
        groomingInfo = undefined;
      }
    }

    let tirednessInfo;
    if (typeof store.getTiredness === 'function') {
      try {
        tirednessInfo = store.getTiredness(nowMs);
      } catch (_err) {
        tirednessInfo = undefined;
      }
    }

    const dog = this._dog;
    if (dog) {
      if (typeof dog.setHunger === 'function') {
        try {
          dog.setHunger(hungerInfo);
        } catch (_err) {
          // A throwing dog hook must never break the animation loop.
        }
      }
      if (typeof dog.setGroomingState === 'function') {
        try {
          dog.setGroomingState(groomingInfo);
        } catch (_err) {
          // A throwing dog hook must never break the animation loop.
        }
      } else if (typeof dog.setGrooming === 'function') {
        try {
          dog.setGrooming(groomingInfo);
        } catch (_err) {
          // A throwing dog hook must never break the animation loop.
        }
      }
      if (typeof dog.setTirednessState === 'function') {
        try {
          dog.setTirednessState(tirednessInfo);
        } catch (_err) {
          // A throwing dog hook must never break the animation loop.
        }
      } else if (typeof dog.setTiredness === 'function') {
        try {
          dog.setTiredness(tirednessInfo);
        } catch (_err) {
          // A throwing dog hook must never break the animation loop.
        }
      }
    }

    const isHungry = Boolean(hungerInfo && hungerInfo.isHungry);
    const needsGrooming = Boolean(groomingInfo && groomingInfo.needsGrooming);
    const isTired = Boolean(tirednessInfo && tirednessInfo.isTired);

    // Ordered list of every need that is currently due. Rotation happens
    // across this list so all due needs get a turn instead of the first one
    // starving the others.
    const dueAnimations = [
      { kind: 'hungry', fn: 'playHungryAnimation', due: isHungry },
      { kind: 'grooming', fn: 'playNeedGroomingAnimation', due: needsGrooming },
      { kind: 'rest', fn: 'playNeedRestAnimation', due: isTired }
    ].filter((x) => x.due);

    if (dueAnimations.length === 0) {
      this._lastAnimationAt = null;
      return;
    }

    // Single-emote policy: never overwrite an active emote.
    if (this._hasActiveEmote(dog)) return;

    const due =
      this._lastAnimationAt === null ||
      nowMs - this._lastAnimationAt >= this._animationIntervalMs;
    if (!due) return;

    // Round-robin: pick the next due need, then advance the persistent index.
    // The modulo keeps the index in range even if the due set shrinks.
    const next = dueAnimations[this._emoteIndex % dueAnimations.length];
    this._emoteIndex = (this._emoteIndex + 1) % dueAnimations.length;

    if (dog && next && typeof dog[next.fn] === 'function') {
      try {
        dog[next.fn]();
      } catch (_err) {
        // Swallow: a throwing hook must not break the interval loop.
      }
    }
    this._lastAnimationAt = nowMs;
  }

  /**
   * @param {Object} dog
   * @returns {boolean} True when the dog currently has an active emote.
   */
  _hasActiveEmote(dog) {
    if (!dog) return false;
    if (typeof dog.getEmoteTimer === 'function') {
      try {
        return Number(dog.getEmoteTimer()) > 0;
      } catch (_err) {
        return false;
      }
    }
    return Number(dog.emoteTimer) > 0;
  }
}

export default HomeHungerAnimator;

// Expose on globalThis so non-module / IIFE consumers (e.g. home_sanctuary.js)
// can resolve `global.HomeHungerAnimator` without a hard import cycle.
if (typeof globalThis !== 'undefined') {
  globalThis.HomeHungerAnimator = HomeHungerAnimator;
  globalThis.DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS = DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS;
}
