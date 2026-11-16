// DogStateStore: persistent hunger/needs state for the companion dog.
// ES module with a globalThis fallback for non-module consumers.

export const DOG_STATE_STORAGE_KEY = 'virtual_dog_walker.dog_state.v1';
export const DEFAULT_HUNGER_DURATION_MS = 120000; // 2 minutes
export const DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS = 5000; // 5 seconds

export function createInitialDogState(nowMs = Date.now(), hungerDurationMs = DEFAULT_HUNGER_DURATION_MS) {
  return {
    version: 1,
    needs: {
      hunger: {
        lastFedAt: nowMs,
        durationMs: hungerDurationMs
      }
    }
  };
}

function defaultStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (_e) {
    // Access to localStorage can throw (e.g. security errors); fall through.
  }
  return null;
}

function isValidState(state) {
  return Boolean(
    state &&
    typeof state === 'object' &&
    state.version === 1 &&
    state.needs &&
    typeof state.needs === 'object' &&
    state.needs.hunger &&
    typeof state.needs.hunger === 'object' &&
    typeof state.needs.hunger.lastFedAt === 'number' &&
    Number.isFinite(state.needs.hunger.lastFedAt)
  );
}

export class DogStateStore {
  constructor({
    storage = defaultStorage(),
    now = () => Date.now(),
    storageKey = DOG_STATE_STORAGE_KEY,
    hungerDurationMs = DEFAULT_HUNGER_DURATION_MS
  } = {}) {
    this._storage = storage;
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._storageKey = storageKey;
    this._hungerDurationMs = hungerDurationMs;
    this._listeners = new Set();
    this._state = this._load();
  }

  _load() {
    let raw = null;
    try {
      if (this._storage && typeof this._storage.getItem === 'function') {
        raw = this._storage.getItem(this._storageKey);
      }
    } catch (_e) {
      raw = null;
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (isValidState(parsed)) {
          // Normalise durationMs in case it was missing/invalid.
          if (typeof parsed.needs.hunger.durationMs !== 'number' ||
              !Number.isFinite(parsed.needs.hunger.durationMs)) {
            parsed.needs.hunger.durationMs = this._hungerDurationMs;
          }
          return parsed;
        }
      } catch (_e) {
        // Corrupt JSON: fall through to reset.
      }
    }

    const initial = createInitialDogState(this._now(), this._hungerDurationMs);
    this._persist(initial);
    return initial;
  }

  _persist(state) {
    try {
      if (this._storage && typeof this._storage.setItem === 'function') {
        this._storage.setItem(this._storageKey, JSON.stringify(state));
      }
    } catch (_e) {
      // Quota / security errors must not crash the store.
    }
  }

  _notify(snapshot) {
    for (const listener of Array.from(this._listeners)) {
      try {
        listener(snapshot);
      } catch (_e) {
        // Listener errors must not break other listeners.
      }
    }
  }

  getHunger(nowMs = this._now()) {
    const hunger = this._state.needs.hunger;
    const lastFedAt = hunger.lastFedAt;
    const durationMs = hunger.durationMs;
    const elapsedMs = Math.max(0, nowMs - lastFedAt);
    const remainingMs = Math.max(0, durationMs - elapsedMs);
    const isHungry = elapsedMs >= durationMs;
    return { lastFedAt, durationMs, elapsedMs, remainingMs, isHungry };
  }

  getSnapshot(nowMs = this._now()) {
    return {
      version: 1,
      needs: {
        hunger: this.getHunger(nowMs)
      }
    };
  }

  isHungry(nowMs = this._now()) {
    return this.getHunger(nowMs).isHungry;
  }

  feed(nowMs = this._now()) {
    this._state = {
      version: 1,
      needs: {
        hunger: {
          lastFedAt: nowMs,
          durationMs: this._hungerDurationMs
        }
      }
    };
    this._persist(this._state);
    const snapshot = this.getSnapshot(nowMs);
    this._notify(snapshot);
    return snapshot;
  }

  reset(nowMs = this._now()) {
    this._state = createInitialDogState(nowMs, this._hungerDurationMs);
    this._persist(this._state);
    const snapshot = this.getSnapshot(nowMs);
    this._notify(snapshot);
    return snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.DogStateStore = DogStateStore;
  globalThis.createInitialDogState = createInitialDogState;
  globalThis.DOG_STATE_STORAGE_KEY = DOG_STATE_STORAGE_KEY;
  globalThis.DEFAULT_HUNGER_DURATION_MS = DEFAULT_HUNGER_DURATION_MS;
  globalThis.DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS = DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS;
}
