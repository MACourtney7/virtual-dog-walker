// Coastal shallow-water interaction helper.
// Pure, testable, and guaranteed not to throw from the game loop.

const SHALLOW_WATER_Y = 1820;
const SPLASH_PROBABILITY = 0.25;
const ZOOMIES_RATE = 12;
const ZOOMIES_MAX = 100;

function isShallow(entity) {
  return Boolean(entity) && Number.isFinite(entity.y) && entity.y > SHALLOW_WATER_Y;
}

/**
 * Apply coastal shallow-water splash + zoomies effects.
 *
 * @param {Object} [options]
 * @param {Object} [options.particleSystem]
 * @param {Object} [options.owner]
 * @param {Object} [options.dog]
 * @param {number} [options.dt]
 * @param {number} [options.randomValue]
 * @returns {{ emitted: boolean, usedFallback: boolean, zoomiesIncremented: boolean }}
 */
export function applyCoastalShallowWaterInteraction({
  particleSystem,
  owner,
  dog,
  dt,
  randomValue = Math.random(),
} = {}) {
  const result = {
    emitted: false,
    usedFallback: false,
    zoomiesIncremented: false,
  };

  const ownerShallow = isShallow(owner);
  const dogShallow = isShallow(dog);

  if (!ownerShallow && !dogShallow) {
    return result;
  }

  // Choose splash coordinates: prefer dog when shallow.
  let px;
  let py;
  if (dogShallow) {
    px = dog.x;
    py = dog.y;
  } else {
    px = owner.x;
    py = owner.y;
  }

  // Attempt splash emission (never propagate errors).
  if (Number.isFinite(randomValue) && randomValue < SPLASH_PROBABILITY) {
    try {
      if (particleSystem && typeof particleSystem.emitWaterSplash === 'function') {
        particleSystem.emitWaterSplash(px, py);
        result.emitted = true;
      } else if (particleSystem && typeof particleSystem.emit === 'function') {
        particleSystem.emit({
          x: px,
          y: py,
          color: 'rgba(240, 253, 250, 0.7)',
          size: 3,
          life: 0.4,
        });
        result.emitted = true;
        result.usedFallback = true;
      }
    } catch (_err) {
      // Swallow particle errors; gameplay must continue.
    }
  }

  // Independently update zoomies when dog is shallow.
  if (dogShallow && typeof dog.zoomiesLevel === 'number' && Number.isFinite(dog.zoomiesLevel)) {
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    dog.zoomiesLevel = Math.min(ZOOMIES_MAX, dog.zoomiesLevel + ZOOMIES_RATE * safeDt);
    result.zoomiesIncremented = true;
  }

  return result;
}

export default applyCoastalShallowWaterInteraction;
