// Coastal shallow-water interaction helper.
// Pure, testable, and guaranteed not to throw from the game loop.

const SHALLOW_WATER_Y = 1820;
const SPLASH_PROBABILITY = 0.25;
const ZOOMIES_RATE = 12;
const ZOOMIES_MAX = 100;

function isShallow(entity) {
  return Boolean(entity) && Number.isFinite(entity?.y) && entity.y > SHALLOW_WATER_Y;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Apply coastal shallow-water splash + zoomies effects.
 *
 * Supports both an options object and positional arguments:
 *   applyCoastalShallowWaterInteraction({ owner, dog, particleSystem, dt, randomValue })
 *   applyCoastalShallowWaterInteraction(owner, dog, particleSystem, dt, randomValue)
 *
 * @param {Object|Object} [optionsOrOwner]
 * @param {Object} [dogArg]
 * @param {Object} [particleSystemArg]
 * @param {number} [dtArg]
 * @param {number} [randomValueArg]
 * @returns {{ emitted: boolean, usedFallback: boolean, zoomiesIncremented: boolean }}
 */
export function applyCoastalShallowWaterInteraction(
  optionsOrOwner,
  dogArg,
  particleSystemArg,
  dtArg,
  randomValueArg,
) {
  const result = {
    emitted: false,
    usedFallback: false,
    zoomiesIncremented: false,
  };

  // Top-level guard: throwing getters/proxies must never escape the helper.
  try {
    // Resolve arguments: options object vs positional.
    let particleSystem;
    let owner;
    let dog;
    let dt;
    let randomValue;

    if (isPlainObject(optionsOrOwner) && (
      'owner' in optionsOrOwner ||
      'dog' in optionsOrOwner ||
      'particleSystem' in optionsOrOwner ||
      'dt' in optionsOrOwner ||
      'randomValue' in optionsOrOwner
    )) {
      ({ particleSystem, owner, dog, dt, randomValue } = optionsOrOwner);
    } else {
      owner = optionsOrOwner;
      dog = dogArg;
      particleSystem = particleSystemArg;
      dt = dtArg;
      randomValue = randomValueArg;
    }

    if (randomValue === undefined) {
      randomValue = Math.random();
    }

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
          const emittedCount = particleSystem.emitWaterSplash(px, py);
          if (typeof emittedCount === 'number' && emittedCount > 0) {
            result.emitted = true;
          }
        } else if (particleSystem && typeof particleSystem.emit === 'function') {
          const particle = particleSystem.emit({
            x: px,
            y: py,
            color: 'rgba(240, 253, 250, 0.7)',
            size: 3,
            life: 0.4,
          });
          if (particle) {
            result.emitted = true;
            result.usedFallback = true;
          }
        }
      } catch (_err) {
        // Swallow particle errors; gameplay must continue.
      }
    }

    // Independently update zoomies when dog is shallow.
    if (dogShallow && typeof dog?.zoomiesLevel === 'number' && Number.isFinite(dog.zoomiesLevel)) {
      const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      dog.zoomiesLevel = Math.min(ZOOMIES_MAX, dog.zoomiesLevel + ZOOMIES_RATE * safeDt);
      result.zoomiesIncremented = true;
    }
  } catch (_err) {
    // Swallow any unexpected error (throwing getters, proxies, etc.).
  }

  return result;
}

export default applyCoastalShallowWaterInteraction;
