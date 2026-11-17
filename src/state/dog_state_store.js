// DogStateStore: persistent hunger/needs state for the companion dog.
// ES module with a globalThis fallback for non-module consumers.

export const DOG_STATE_STORAGE_KEY = 'virtual_dog_walker.dog_state.v1';
export const DEFAULT_HUNGER_DURATION_MS = 120000; // 2 minutes
export const DEFAULT_GROOMING_DURATION_MS = 180000; // 3 minutes
export const DEFAULT_TIREDNESS_DURATION_MS = 180000; // 3 minutes
export const DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS = 5000; // 5 seconds

export function createInitialDogState(nowMs = Date.now(), hungerDurationMs = DEFAULT_HUNGER_DURATION_MS) {
  return {
    version: 1,
    needs: {
      hunger: {
        lastFedAt: nowMs,
        lastCompletedAt: nowMs,
        durationMs: hungerDurationMs
      },
      grooming: {
        lastGroomedAt: null,
        durationMs: DEFAULT_GROOMING_DURATION_MS
      },
      tiredness: {
        lastRestedAt: null,
        durationMs: DEFAULT_TIREDNESS_DURATION_MS
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

// Backfill grooming/tiredness needs on a hydrated state without touching
// existing needs.hunger. Preserves any custom top-level metadata keys.
function backfillNeeds(state) {
  if (!state || typeof state !== 'object') return state;
  if (!state.needs || typeof state.needs !== 'object') {
    state.needs = {};
  }
  var needs = state.needs;

  if (!needs.grooming || typeof needs.grooming !== 'object') {
    needs.grooming = {
      lastGroomedAt: null,
      durationMs: DEFAULT_GROOMING_DURATION_MS
    };
  } else {
    if (needs.grooming.lastGroomedAt === undefined) {
      needs.grooming.lastGroomedAt = null;
    }
    if (typeof needs.grooming.durationMs !== 'number' ||
        !Number.isFinite(needs.grooming.durationMs) ||
        needs.grooming.durationMs <= 0) {
      needs.grooming.durationMs = DEFAULT_GROOMING_DURATION_MS;
    }
  }

  if (!needs.tiredness || typeof needs.tiredness !== 'object') {
    needs.tiredness = {
      lastRestedAt: null,
      durationMs: DEFAULT_TIREDNESS_DURATION_MS
    };
  } else {
    if (needs.tiredness.lastRestedAt === undefined) {
      needs.tiredness.lastRestedAt = null;
    }
    if (typeof needs.tiredness.durationMs !== 'number' ||
        !Number.isFinite(needs.tiredness.durationMs) ||
        needs.tiredness.durationMs <= 0) {
      needs.tiredness.durationMs = DEFAULT_TIREDNESS_DURATION_MS;
    }
  }

  // Mirror lastFedAt -> lastCompletedAt for legacy states.
  if (needs.hunger && typeof needs.hunger === 'object' &&
      needs.hunger.lastCompletedAt === undefined &&
      typeof needs.hunger.lastFedAt === 'number') {
    needs.hunger.lastCompletedAt = needs.hunger.lastFedAt;
  }

  return state;
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
          const durationMs = parsed.needs.hunger.durationMs;
          if (typeof durationMs !== 'number' ||
              !Number.isFinite(durationMs) ||
              durationMs <= 0) {
            // Invalid duration: reset to a clean initial state and persist it.
            const initial = createInitialDogState(this._now(), this._hungerDurationMs);
            this._persist(initial);
            return initial;
          }
          // Strip any stale persisted derived boolean mirrors: they must
          // always be derived from timestamps/durationMs, never trusted
          // from storage.
          if (parsed.needs.hunger &&
              Object.prototype.hasOwnProperty.call(parsed.needs.hunger, 'isHungry')) {
            delete parsed.needs.hunger.isHungry;
          }
          if (parsed.needs.grooming &&
              Object.prototype.hasOwnProperty.call(parsed.needs.grooming, 'needsGrooming')) {
            delete parsed.needs.grooming.needsGrooming;
          }
          if (parsed.needs.tiredness &&
              Object.prototype.hasOwnProperty.call(parsed.needs.tiredness, 'isTired')) {
            delete parsed.needs.tiredness.isTired;
          }
          return backfillNeeds(parsed);
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
    const hungryAt = lastFedAt + durationMs;
    const isHungry = elapsedMs >= durationMs;
    return { lastFedAt, durationMs, elapsedMs, remainingMs, hungryAt, isHungry };
  }

  getSnapshot(nowMs = this._now()) {
    return {
      version: 1,
      needs: {
        ...this._state.needs,
        hunger: {
          ...this._state.needs.hunger,
          ...this.getHunger(nowMs)
        }
      }
    };
  }

  isHungry(nowMs = this._now()) {
    return this.getHunger(nowMs).isHungry;
  }

  getGrooming(nowMs = this._now()) {
    const grooming = (this._state.needs && this._state.needs.grooming) || {};
    const lastGroomedAt = typeof grooming.lastGroomedAt === 'number' ? grooming.lastGroomedAt : null;
    const durationMs = Number.isFinite(grooming.durationMs) && grooming.durationMs > 0
      ? grooming.durationMs
      : DEFAULT_GROOMING_DURATION_MS;
    const needsGrooming = lastGroomedAt === null || (nowMs - lastGroomedAt) >= durationMs;
    const elapsedMs = lastGroomedAt === null ? null : Math.max(0, nowMs - lastGroomedAt);
    const remainingMs = lastGroomedAt === null ? 0 : Math.max(0, durationMs - elapsedMs);
    return { lastGroomedAt, durationMs, elapsedMs, remainingMs, needsGrooming };
  }

  needsGrooming(nowMs = this._now()) {
    return this.getGrooming(nowMs).needsGrooming;
  }

  getTiredness(nowMs = this._now()) {
    const tiredness = (this._state.needs && this._state.needs.tiredness) || {};
    const lastRestedAt = typeof tiredness.lastRestedAt === 'number' ? tiredness.lastRestedAt : null;
    const durationMs = Number.isFinite(tiredness.durationMs) && tiredness.durationMs > 0
      ? tiredness.durationMs
      : DEFAULT_TIREDNESS_DURATION_MS;
    const isTired = lastRestedAt === null || (nowMs - lastRestedAt) >= durationMs;
    const elapsedMs = lastRestedAt === null ? null : Math.max(0, nowMs - lastRestedAt);
    const remainingMs = lastRestedAt === null ? 0 : Math.max(0, durationMs - elapsedMs);
    return { lastRestedAt, durationMs, elapsedMs, remainingMs, isTired };
  }

  isTired(nowMs = this._now()) {
    return this.getTiredness(nowMs).isTired;
  }

  // Snapshot of all needs with derived flags. Never persisted.
  getNeeds(nowMs = this._now()) {
    return {
      hunger: this.getHunger(nowMs),
      grooming: this.getGrooming(nowMs),
      tiredness: this.getTiredness(nowMs)
    };
  }

  feed(nowMs = this._now()) {
    const existingNeeds = (this._state && this._state.needs) || {};
    const existingHunger = existingNeeds.hunger || {};
    this._state = {
      ...this._state,
      version: 1,
      needs: {
        ...existingNeeds,
        hunger: {
          ...existingHunger,
          lastFedAt: nowMs,
          lastCompletedAt: nowMs,
          durationMs: Number.isFinite(existingHunger.durationMs) && existingHunger.durationMs > 0
            ? existingHunger.durationMs
            : this._hungerDurationMs
        }
      }
    };
    this._persist(this._state);
    const snapshot = this.getSnapshot(nowMs);
    this._notify(snapshot);
    return snapshot;
  }

  groom(nowMs = this._now()) {
    const existingNeeds = (this._state && this._state.needs) || {};
    const existingGrooming = existingNeeds.grooming || {};
    this._state = {
      ...this._state,
      version: 1,
      needs: {
        ...existingNeeds,
        grooming: {
          ...existingGrooming,
          lastGroomedAt: nowMs,
          durationMs: Number.isFinite(existingGrooming.durationMs) && existingGrooming.durationMs > 0
            ? existingGrooming.durationMs
            : DEFAULT_GROOMING_DURATION_MS
        }
      }
    };
    this._persist(this._state);
    const snapshot = this.getSnapshot(nowMs);
    this._notify(snapshot);
    return snapshot;
  }

  rest(nowMs = this._now()) {
    const existingNeeds = (this._state && this._state.needs) || {};
    const existingTiredness = existingNeeds.tiredness || {};
    this._state = {
      ...this._state,
      version: 1,
      needs: {
        ...existingNeeds,
        tiredness: {
          ...existingTiredness,
          lastRestedAt: nowMs,
          durationMs: Number.isFinite(existingTiredness.durationMs) && existingTiredness.durationMs > 0
            ? existingTiredness.durationMs
            : DEFAULT_TIREDNESS_DURATION_MS
        }
      }
    };
    this._persist(this._state);
    const snapshot = this.getSnapshot(nowMs);
    this._notify(snapshot);
    return snapshot;
  }

  reset(nowMs = this._now()) {
    const existingNeeds = (this._state && this._state.needs) || {};
    const initial = createInitialDogState(nowMs, this._hungerDurationMs);
    this._state = {
      ...this._state,
      version: 1,
      needs: {
        ...existingNeeds,
        hunger: initial.needs.hunger,
        grooming: initial.needs.grooming,
        tiredness: initial.needs.tiredness
      }
    };
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
  globalThis.DEFAULT_GROOMING_DURATION_MS = DEFAULT_GROOMING_DURATION_MS;
  globalThis.DEFAULT_TIREDNESS_DURATION_MS = DEFAULT_TIREDNESS_DURATION_MS;
  globalThis.DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS = DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS;
}
