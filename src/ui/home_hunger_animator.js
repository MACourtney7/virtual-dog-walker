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
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = {}) {
    this._dogStateStore = dogStateStore;
    this._dog = dog;
    this._tickIntervalMs = tickIntervalMs;
    this._animationIntervalMs = animationIntervalMs;
    this._now = now;
    this._setIntervalFn = setIntervalFn;
    this._clearIntervalFn = clearIntervalFn;

    this._intervalId = null;
    this._lastAnimationAt = null;
  }

  /**
   * Begin polling hunger state. Idempotent: calling twice will not create a
   * second interval.
   */
  start() {
    if (this._intervalId !== null) return;
    this._intervalId = this._setIntervalFn(() => this.tick(), this._tickIntervalMs);
  }

  /**
   * Stop polling. Safe to call multiple times.
   */
  stop() {
    if (this._intervalId === null) return;
    this._clearIntervalFn(this._intervalId);
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
      if (typeof dog.setGrooming === 'function') {
        try {
          dog.setGrooming(groomingInfo);
        } catch (_err) {
          // A throwing dog hook must never break the animation loop.
        }
      }
      if (typeof dog.setTiredness === 'function') {
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

    if (!isHungry && !needsGrooming && !isTired) {
      this._lastAnimationAt = null;
      return;
    }

    // Single-emote policy: never overwrite an active emote.
    if (this._hasActiveEmote(dog)) return;

    const due =
      this._lastAnimationAt === null ||
      nowMs - this._lastAnimationAt >= this._animationIntervalMs;
    if (!due) return;

    let hook = null;
    if (isHungry) {
      hook = 'playHungryAnimation';
    } else if (needsGrooming) {
      hook = 'playNeedGroomingAnimation';
    } else if (isTired) {
      hook = 'playNeedRestAnimation';
    }

    if (dog && hook && typeof dog[hook] === 'function') {
      try {
        dog[hook]();
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
