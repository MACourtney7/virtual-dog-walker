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

// Default cadence for re-triggering the hungry animation while the dog remains
// hungry. Matches spec.md R8 (DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS = 5000).
export const DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS = 5000; // 5 seconds

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
   * Evaluate hunger once and trigger the hungry animation as needed.
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

    const dog = this._dog;
    if (dog && typeof dog.setHunger === 'function') {
      dog.setHunger(hungerInfo);
    }

    if (!hungerInfo || !hungerInfo.isHungry) {
      this._lastAnimationAt = null;
      return;
    }

    const canPlay = dog && typeof dog.playHungryAnimation === 'function';

    if (this._lastAnimationAt === null) {
      if (canPlay) dog.playHungryAnimation();
      this._lastAnimationAt = nowMs;
      return;
    }

    if (nowMs - this._lastAnimationAt >= this._animationIntervalMs) {
      if (canPlay) dog.playHungryAnimation();
      this._lastAnimationAt = nowMs;
    }
  }
}

export default HomeHungerAnimator;
