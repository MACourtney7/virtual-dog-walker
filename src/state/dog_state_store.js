// DogStateStore: persistent hunger/needs state for the companion dog.
// ES module with a globalThis fallback for non-module consumers.
//
// Thin command/event/hydration wrapper over the Wasm `CareSimBuffer`
// (crates/dog_walker_core/src/care_sim.rs). Timer advancement and
// accept/reject logic are delegated to `step_care_buffer(dtMs)` when the
// Wasm core is available; otherwise an exact JS port of `care_sim.rs` runs.

import { getWasmSim, getBufferView } from '../engine/wasm_sim_bridge.js';

export const DOG_STATE_STORAGE_KEY = 'virtual_dog_walker.dog_state.v1';
export const DEFAULT_HUNGER_DURATION_MS = 120000; // 2 minutes
export const DEFAULT_GROOMING_DURATION_MS = 180000; // 3 minutes
export const DEFAULT_TIREDNESS_DURATION_MS = 180000; // 3 minutes
export const DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS = 5000; // 5 seconds

// ---------------------------------------------------------------------------
// CareSimBuffer slot layout (mirror crates/dog_walker_core/src/care_sim.rs).
// ---------------------------------------------------------------------------

export const CARE_BUFFER_SLOTS = 32;
export const CARE_SLOT_LAST_STEP_DT_MS = 0;
export const CARE_SLOT_NOW_MS = 1;
export const CARE_SLOT_HUNGER_ELAPSED_MS = 2;
export const CARE_SLOT_HUNGER_REMAINING_MS = 3;
export const CARE_SLOT_GROOMING_ELAPSED_MS = 4;
export const CARE_SLOT_GROOMING_REMAINING_MS = 5;
export const CARE_SLOT_TIREDNESS_ELAPSED_MS = 6;
export const CARE_SLOT_TIREDNESS_REMAINING_MS = 7;
export const CARE_SLOT_IS_HUNGRY = 8;
export const CARE_SLOT_NEEDS_GROOMING = 9;
export const CARE_SLOT_IS_TIRED = 10;
export const CARE_SLOT_ACTION_FLAGS = 11;
export const CARE_SLOT_EVENT_BITMASK = 12;
export const CARE_SLOT_REJECTION_ANIM_TIMER_MS = 13;
export const CARE_SLOT_FEED_FLASH_TIMER_MS = 14;
export const CARE_SLOT_GROOM_FLASH_TIMER_MS = 15;
export const CARE_SLOT_REST_FLASH_TIMER_MS = 16;
export const CARE_SLOT_HUNGER_LAST_FED_MS = 17;
export const CARE_SLOT_GROOMING_LAST_GROOMED_MS = 18;
export const CARE_SLOT_TIREDNESS_LAST_RESTED_MS = 19;
export const CARE_SLOT_LAST_ACTION_ELAPSED_MS = 20;
export const CARE_SLOT_FEED_COUNT = 21;
export const CARE_SLOT_GROOM_COUNT = 22;
export const CARE_SLOT_REST_COUNT = 23;
export const CARE_SLOT_LAST_ACTION = 24;
export const CARE_SLOT_UI_TOAST_KIND = 25;
export const CARE_SLOT_REJECTION_KIND = 26;
export const CARE_SLOT_HUNGER_DURATION_MS = 27;
export const CARE_SLOT_GROOMING_DURATION_MS = 28;
export const CARE_SLOT_TIREDNESS_DURATION_MS = 29;

// Command bitmask (written into CARE_SLOT_ACTION_FLAGS).
export const CARE_CMD_FEED = 1 << 0;
export const CARE_CMD_GROOM = 1 << 1;
export const CARE_CMD_REST = 1 << 2;
export const CARE_CMD_RESET = 1 << 3;

// Event bitmask (returned from step_care_buffer).
export const CARE_EVENT_HUNGER_STARTED = 1 << 0;
export const CARE_EVENT_GROOMING_NEEDED = 1 << 1;
export const CARE_EVENT_TIREDNESS_STARTED = 1 << 2;
export const CARE_EVENT_REJECTION_ANIM_FINISHED = 1 << 3;
export const CARE_EVENT_FEED_ACCEPTED = 1 << 4;
export const CARE_EVENT_GROOM_ACCEPTED = 1 << 5;
export const CARE_EVENT_REST_ACCEPTED = 1 << 6;
export const CARE_EVENT_HUNGER_RESOLVED = 1 << 7;
export const CARE_EVENT_GROOMING_RESOLVED = 1 << 8;
export const CARE_EVENT_TIREDNESS_RESOLVED = 1 << 9;
export const CARE_EVENT_ACTION_REJECTED = 1 << 10;
export const CARE_EVENT_UI_FLASH = 1 << 11;
export const CARE_EVENT_TOAST = 1 << 12;
export const CARE_EVENT_RESET = 1 << 13;

// Action kinds (CARE_SLOT_LAST_ACTION).
export const CARE_ACTION_NONE = 0;
export const CARE_ACTION_FEED = 1;
export const CARE_ACTION_GROOM = 2;
export const CARE_ACTION_REST = 3;
export const CARE_ACTION_RESET = 4;

// Toast kinds (CARE_SLOT_UI_TOAST_KIND).
export const CARE_TOAST_NONE = 0;
export const CARE_TOAST_FED = 1;
export const CARE_TOAST_GROOMED = 2;
export const CARE_TOAST_RESTED = 3;
export const CARE_TOAST_REJECTED_HUNGRY = 4;
export const CARE_TOAST_REJECTED_GROOM = 5;
export const CARE_TOAST_REJECTED_REST = 6;
export const CARE_TOAST_RESET = 7;

// Rejection kinds (CARE_SLOT_REJECTION_KIND).
export const CARE_REJECTION_NONE = 0;
export const CARE_REJECTION_NOT_HUNGRY = 1;
export const CARE_REJECTION_NOT_DIRTY = 2;
export const CARE_REJECTION_NOT_TIRED = 3;

// Flash / rejection animation durations (ms).
// Largest gap (ms) advanced via the chunked loop; larger gaps are applied
// directly to elapsed slots to avoid spinning the loop billions of times.
export const CARE_MAX_CHUNKED_ADVANCE_MS = 600000; // 10 minutes

export const CARE_REJECTION_ANIM_MS = 500;
export const CARE_FEED_FLASH_MS = 500;
export const CARE_GROOM_FLASH_MS = 500;
export const CARE_REST_FLASH_MS = 500;

function careSanitizeDtMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1000, n));
}

function careSaturatingAdd(a, b) {
  const sum = a + b;
  return Number.isFinite(sum) ? sum : Number.MAX_VALUE;
}

function careDurationSlot(buf, index, fallback) {
  const v = buf[index];
  return (Number.isFinite(v) && v > 0) ? v : fallback;
}

/**
 * Exact JS port of `step_care_buffer` (crates/dog_walker_core/src/care_sim.rs).
 * Mutates `buf` (Float32Array of CARE_BUFFER_SLOTS) and returns the event bitmask.
 */
export function stepCareBufferJs(buf, dtMs) {
  const dt = careSanitizeDtMs(dtMs);
  buf[CARE_SLOT_LAST_STEP_DT_MS] = dt;
  buf[CARE_SLOT_NOW_MS] = careSaturatingAdd(buf[CARE_SLOT_NOW_MS], dt);

  buf[CARE_SLOT_HUNGER_ELAPSED_MS] = careSaturatingAdd(buf[CARE_SLOT_HUNGER_ELAPSED_MS], dt);
  buf[CARE_SLOT_GROOMING_ELAPSED_MS] = careSaturatingAdd(buf[CARE_SLOT_GROOMING_ELAPSED_MS], dt);
  buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] = careSaturatingAdd(buf[CARE_SLOT_TIREDNESS_ELAPSED_MS], dt);

  const hungerDuration = careDurationSlot(buf, CARE_SLOT_HUNGER_DURATION_MS, DEFAULT_HUNGER_DURATION_MS);
  const groomingDuration = careDurationSlot(buf, CARE_SLOT_GROOMING_DURATION_MS, DEFAULT_GROOMING_DURATION_MS);
  const tirednessDuration = careDurationSlot(buf, CARE_SLOT_TIREDNESS_DURATION_MS, DEFAULT_TIREDNESS_DURATION_MS);

  buf[CARE_SLOT_HUNGER_REMAINING_MS] = Math.max(0, hungerDuration - buf[CARE_SLOT_HUNGER_ELAPSED_MS]);
  buf[CARE_SLOT_GROOMING_REMAINING_MS] = Math.max(0, groomingDuration - buf[CARE_SLOT_GROOMING_ELAPSED_MS]);
  buf[CARE_SLOT_TIREDNESS_REMAINING_MS] = Math.max(0, tirednessDuration - buf[CARE_SLOT_TIREDNESS_ELAPSED_MS]);

  let events = 0;

  const wasHungry = buf[CARE_SLOT_IS_HUNGRY] > 0.5;
  const isHungry = buf[CARE_SLOT_HUNGER_REMAINING_MS] <= 0;
  buf[CARE_SLOT_IS_HUNGRY] = isHungry ? 1 : 0;
  if (!wasHungry && isHungry) events |= CARE_EVENT_HUNGER_STARTED;

  const wasGrooming = buf[CARE_SLOT_NEEDS_GROOMING] > 0.5;
  const needsGrooming = buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS] < 0 ||
    buf[CARE_SLOT_GROOMING_ELAPSED_MS] >= groomingDuration;
  buf[CARE_SLOT_NEEDS_GROOMING] = needsGrooming ? 1 : 0;
  if (!wasGrooming && needsGrooming) events |= CARE_EVENT_GROOMING_NEEDED;

  const wasTired = buf[CARE_SLOT_IS_TIRED] > 0.5;
  const isTired = buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] < 0 ||
    buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] >= tirednessDuration;
  buf[CARE_SLOT_IS_TIRED] = isTired ? 1 : 0;
  if (!wasTired && isTired) events |= CARE_EVENT_TIREDNESS_STARTED;

  events |= careProcessActionsJs(buf);

  const rejectionBefore = buf[CARE_SLOT_REJECTION_ANIM_TIMER_MS];
  const rejectionAfter = Math.max(0, rejectionBefore - dt);
  buf[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = rejectionAfter;
  if (rejectionBefore > 0 && rejectionAfter <= 0) events |= CARE_EVENT_REJECTION_ANIM_FINISHED;

  buf[CARE_SLOT_FEED_FLASH_TIMER_MS] = Math.max(0, buf[CARE_SLOT_FEED_FLASH_TIMER_MS] - dt);
  buf[CARE_SLOT_GROOM_FLASH_TIMER_MS] = Math.max(0, buf[CARE_SLOT_GROOM_FLASH_TIMER_MS] - dt);
  buf[CARE_SLOT_REST_FLASH_TIMER_MS] = Math.max(0, buf[CARE_SLOT_REST_FLASH_TIMER_MS] - dt);

  buf[CARE_SLOT_EVENT_BITMASK] = events;
  return events >>> 0;
}

function careProcessActionsJs(buf) {
  const flags = (buf[CARE_SLOT_ACTION_FLAGS] >>> 0);
  if (flags === 0) return 0;

  let events = 0;

  if (flags & CARE_CMD_RESET) {
    buf[CARE_SLOT_HUNGER_ELAPSED_MS] = 0;
    buf[CARE_SLOT_GROOMING_ELAPSED_MS] = 0;
    buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0;
    buf[CARE_SLOT_IS_HUNGRY] = 0;
    buf[CARE_SLOT_NEEDS_GROOMING] = 1;
    buf[CARE_SLOT_IS_TIRED] = 1;
    buf[CARE_SLOT_HUNGER_LAST_FED_MS] = -1;
    buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = -1;
    buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = -1;
    buf[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = -1;
    buf[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = 0;
    buf[CARE_SLOT_FEED_FLASH_TIMER_MS] = 0;
    buf[CARE_SLOT_GROOM_FLASH_TIMER_MS] = 0;
    buf[CARE_SLOT_REST_FLASH_TIMER_MS] = 0;
    buf[CARE_SLOT_FEED_COUNT] = 0;
    buf[CARE_SLOT_GROOM_COUNT] = 0;
    buf[CARE_SLOT_REST_COUNT] = 0;
    buf[CARE_SLOT_LAST_ACTION] = CARE_ACTION_RESET;
    buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_RESET;
    buf[CARE_SLOT_ACTION_FLAGS] = 0;
    return CARE_EVENT_RESET | CARE_EVENT_TOAST;
  }

  const now = buf[CARE_SLOT_NOW_MS];

  if (flags & CARE_CMD_FEED) {
    if (buf[CARE_SLOT_IS_HUNGRY] > 0.5) {
      const hungerDuration = careDurationSlot(buf, CARE_SLOT_HUNGER_DURATION_MS, DEFAULT_HUNGER_DURATION_MS);
      buf[CARE_SLOT_HUNGER_ELAPSED_MS] = 0;
      buf[CARE_SLOT_HUNGER_REMAINING_MS] = hungerDuration;
      buf[CARE_SLOT_HUNGER_LAST_FED_MS] = now;
      buf[CARE_SLOT_IS_HUNGRY] = 0;
      buf[CARE_SLOT_FEED_COUNT] = buf[CARE_SLOT_FEED_COUNT] + 1;
      buf[CARE_SLOT_LAST_ACTION] = CARE_ACTION_FEED;
      buf[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = now;
      buf[CARE_SLOT_FEED_FLASH_TIMER_MS] = CARE_FEED_FLASH_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_FED;
      events |= CARE_EVENT_FEED_ACCEPTED | CARE_EVENT_HUNGER_RESOLVED | CARE_EVENT_UI_FLASH | CARE_EVENT_TOAST;
    } else {
      buf[CARE_SLOT_REJECTION_KIND] = CARE_REJECTION_NOT_HUNGRY;
      buf[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = CARE_REJECTION_ANIM_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_REJECTED_HUNGRY;
      events |= CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST;
    }
  }

  if (flags & CARE_CMD_GROOM) {
    if (buf[CARE_SLOT_NEEDS_GROOMING] > 0.5) {
      const groomingDuration = careDurationSlot(buf, CARE_SLOT_GROOMING_DURATION_MS, DEFAULT_GROOMING_DURATION_MS);
      buf[CARE_SLOT_GROOMING_ELAPSED_MS] = 0;
      buf[CARE_SLOT_GROOMING_REMAINING_MS] = groomingDuration;
      buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = now;
      buf[CARE_SLOT_NEEDS_GROOMING] = 0;
      buf[CARE_SLOT_GROOM_COUNT] = buf[CARE_SLOT_GROOM_COUNT] + 1;
      buf[CARE_SLOT_LAST_ACTION] = CARE_ACTION_GROOM;
      buf[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = now;
      buf[CARE_SLOT_GROOM_FLASH_TIMER_MS] = CARE_GROOM_FLASH_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_GROOMED;
      events |= CARE_EVENT_GROOM_ACCEPTED | CARE_EVENT_GROOMING_RESOLVED | CARE_EVENT_UI_FLASH | CARE_EVENT_TOAST;
    } else {
      buf[CARE_SLOT_REJECTION_KIND] = CARE_REJECTION_NOT_DIRTY;
      buf[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = CARE_REJECTION_ANIM_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_REJECTED_GROOM;
      events |= CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST;
    }
  }

  if (flags & CARE_CMD_REST) {
    if (buf[CARE_SLOT_IS_TIRED] > 0.5) {
      const tirednessDuration = careDurationSlot(buf, CARE_SLOT_TIREDNESS_DURATION_MS, DEFAULT_TIREDNESS_DURATION_MS);
      buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0;
      buf[CARE_SLOT_TIREDNESS_REMAINING_MS] = tirednessDuration;
      buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = now;
      buf[CARE_SLOT_IS_TIRED] = 0;
      buf[CARE_SLOT_REST_COUNT] = buf[CARE_SLOT_REST_COUNT] + 1;
      buf[CARE_SLOT_LAST_ACTION] = CARE_ACTION_REST;
      buf[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = now;
      buf[CARE_SLOT_REST_FLASH_TIMER_MS] = CARE_REST_FLASH_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_RESTED;
      events |= CARE_EVENT_REST_ACCEPTED | CARE_EVENT_TIREDNESS_RESOLVED | CARE_EVENT_UI_FLASH | CARE_EVENT_TOAST;
    } else {
      buf[CARE_SLOT_REJECTION_KIND] = CARE_REJECTION_NOT_TIRED;
      buf[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = CARE_REJECTION_ANIM_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_REJECTED_REST;
      events |= CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST;
    }
  }

  buf[CARE_SLOT_ACTION_FLAGS] = 0;
  return events;
}

/**
 * Resolves the Rust-owned care buffer view (zero-copy over Wasm linear memory) when the Wasm
 * authority is available, else returns `fallbackBuf` (the local JS mirror).
 *
 * The generated binding exposes `care_buffer_ptr()` and `step_care_buffer(dt_ms)`; the buffer
 * itself lives in Wasm memory, so all reads/writes must go through this view.
 */
export function resolveCareBufferView(fallbackBuf) {
  try {
    const sim = getWasmSim();
    if (sim && typeof sim.care_buffer_ptr === 'function' &&
        typeof sim.step_care_buffer === 'function') {
      const ptr = sim.care_buffer_ptr();
      if (ptr) {
        return getBufferView(ptr, CARE_BUFFER_SLOTS);
      }
    }
  } catch (_e) {
    // Wasm unavailable: fall through to the local mirror.
  }
  return fallbackBuf;
}

/**
 * Steps a care buffer via the Wasm authority when available, else the exact JS port.
 * Returns the event bitmask.
 *
 * When Wasm is active the buffer is Rust-owned: `buf` is ignored and the generated
 * `step_care_buffer(dt_ms)` signature (single argument) is used.
 */
export function stepCareBuffer(buf, dtMs) {
  try {
    const sim = getWasmSim();
    if (sim && typeof sim.step_care_buffer === 'function') {
      return sim.step_care_buffer(dtMs) >>> 0;
    }
  } catch (_e) {
    // Wasm unavailable: fall through to the JS port.
  }
  return stepCareBufferJs(buf, dtMs);
}

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
  if (!(
    state &&
    typeof state === 'object' &&
    state.version === 1 &&
    state.needs &&
    typeof state.needs === 'object' &&
    state.needs.hunger &&
    typeof state.needs.hunger === 'object'
  )) {
    return false;
  }
  const hunger = state.needs.hunger;
  const hasLastFedAt = typeof hunger.lastFedAt === 'number' && Number.isFinite(hunger.lastFedAt);
  const hasLastCompletedAt = typeof hunger.lastCompletedAt === 'number' && Number.isFinite(hunger.lastCompletedAt);
  return hasLastFedAt || hasLastCompletedAt;
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

  // Mirror lastFedAt <-> lastCompletedAt so both fields are always present
  // and consistent, regardless of which one the persisted state carried.
  if (needs.hunger && typeof needs.hunger === 'object') {
    const hasLastFedAt = typeof needs.hunger.lastFedAt === 'number' &&
      Number.isFinite(needs.hunger.lastFedAt);
    const hasLastCompletedAt = typeof needs.hunger.lastCompletedAt === 'number' &&
      Number.isFinite(needs.hunger.lastCompletedAt);

    if (!hasLastFedAt && hasLastCompletedAt) {
      needs.hunger.lastFedAt = needs.hunger.lastCompletedAt;
    } else if (hasLastFedAt && !hasLastCompletedAt) {
      needs.hunger.lastCompletedAt = needs.hunger.lastFedAt;
    }
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
    // Local JS mirror of the CareSimBuffer (32 floats), used when Wasm is unavailable.
    this._careBuf = new Float32Array(CARE_BUFFER_SLOTS);
    this._careBuf[CARE_SLOT_HUNGER_DURATION_MS] = this._hungerDurationMs;
    this._careBuf[CARE_SLOT_GROOMING_DURATION_MS] = DEFAULT_GROOMING_DURATION_MS;
    this._careBuf[CARE_SLOT_TIREDNESS_DURATION_MS] = DEFAULT_TIREDNESS_DURATION_MS;
    // JS f64 clock for the care buffer. `CARE_SLOT_NOW_MS` is f32 and cannot
    // represent `Date.now()` precisely, so `dt` is always derived from this.
    this._lastCareNowMs = this._now();
    // Set once the Rust-owned Wasm buffer has been seeded from `_state`.
    this._wasmCareHydrated = false;
    this._hydrateCareFromState(this._state);
  }

  // Returns the active care buffer: the Rust-owned zero-copy view when Wasm is available,
  // else the local JS mirror. Re-resolved on every access so memory growth is handled.
  _careView() {
    const view = resolveCareBufferView(this._careBuf);
    // The Wasm buffer starts zero-initialized; seed it from `_state` the first
    // time we switch to it so `CARE_SLOT_NOW_MS` is never left at 0.
    if (view !== this._careBuf && !this._wasmCareHydrated) {
      this._wasmCareHydrated = true;
      this._hydrateCareFromState(this._state);
    }
    return view;
  }

  // --- CareSimBuffer hydration / stepping ---------------------------------

  // Seeds the care buffer from the persisted state timestamps so the Wasm
  // authority continues from the same logical point.
  _hydrateCareFromState(state) {
    const buf = this._careView();
    const nowMs = this._now();
    const needs = (state && state.needs) || {};
    const hunger = needs.hunger || {};
    const grooming = needs.grooming || {};
    const tiredness = needs.tiredness || {};

    const hungerDuration = Number.isFinite(hunger.durationMs) && hunger.durationMs > 0
      ? hunger.durationMs
      : this._hungerDurationMs;
    const groomingDuration = Number.isFinite(grooming.durationMs) && grooming.durationMs > 0
      ? grooming.durationMs
      : DEFAULT_GROOMING_DURATION_MS;
    const tirednessDuration = Number.isFinite(tiredness.durationMs) && tiredness.durationMs > 0
      ? tiredness.durationMs
      : DEFAULT_TIREDNESS_DURATION_MS;

    buf[CARE_SLOT_HUNGER_DURATION_MS] = hungerDuration;
    buf[CARE_SLOT_GROOMING_DURATION_MS] = groomingDuration;
    buf[CARE_SLOT_TIREDNESS_DURATION_MS] = tirednessDuration;

    const lastFedAt = Number.isFinite(hunger.lastFedAt)
      ? hunger.lastFedAt
      : (Number.isFinite(hunger.lastCompletedAt) ? hunger.lastCompletedAt : null);
    const lastGroomedAt = Number.isFinite(grooming.lastGroomedAt) ? grooming.lastGroomedAt : null;
    const lastRestedAt = Number.isFinite(tiredness.lastRestedAt) ? tiredness.lastRestedAt : null;

    buf[CARE_SLOT_HUNGER_LAST_FED_MS] = lastFedAt === null ? -1 : lastFedAt;
    buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = lastGroomedAt === null ? -1 : lastGroomedAt;
    buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = lastRestedAt === null ? -1 : lastRestedAt;

    buf[CARE_SLOT_HUNGER_ELAPSED_MS] = lastFedAt === null ? 0 : Math.max(0, nowMs - lastFedAt);
    buf[CARE_SLOT_GROOMING_ELAPSED_MS] = lastGroomedAt === null ? 0 : Math.max(0, nowMs - lastGroomedAt);
    buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] = lastRestedAt === null ? 0 : Math.max(0, nowMs - lastRestedAt);

    buf[CARE_SLOT_HUNGER_REMAINING_MS] = Math.max(0, hungerDuration - buf[CARE_SLOT_HUNGER_ELAPSED_MS]);
    buf[CARE_SLOT_GROOMING_REMAINING_MS] = Math.max(0, groomingDuration - buf[CARE_SLOT_GROOMING_ELAPSED_MS]);
    buf[CARE_SLOT_TIREDNESS_REMAINING_MS] = Math.max(0, tirednessDuration - buf[CARE_SLOT_TIREDNESS_ELAPSED_MS]);

    buf[CARE_SLOT_IS_HUNGRY] = buf[CARE_SLOT_HUNGER_REMAINING_MS] <= 0 ? 1 : 0;
    buf[CARE_SLOT_NEEDS_GROOMING] = (lastGroomedAt === null ||
      buf[CARE_SLOT_GROOMING_ELAPSED_MS] >= groomingDuration) ? 1 : 0;
    buf[CARE_SLOT_IS_TIRED] = (lastRestedAt === null ||
      buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] >= tirednessDuration) ? 1 : 0;

    buf[CARE_SLOT_NOW_MS] = nowMs;
    buf[CARE_SLOT_ACTION_FLAGS] = 0;
    this._lastCareNowMs = nowMs;
  }

  // Advances the care buffer to `nowMs` and returns the accumulated events.
  _advanceCare(nowMs) {
    const buf = this._careView();
    const target = Number.isFinite(nowMs) ? nowMs : this._now();
    // `dt` is derived from the JS f64 clock, never from the f32 `CARE_SLOT_NOW_MS`.
    const last = Number.isFinite(this._lastCareNowMs) ? this._lastCareNowMs : target;
    let dt = target - last;
    if (!Number.isFinite(dt)) dt = 0;
    this._lastCareNowMs = target;
    if (dt < 0) {
      // Clock rollback: re-derive elapsed from the last-action timestamps so
      // elapsed clamps to zero (legacy `Math.max(0, nowMs - lastFedAt)`).
      this._rehydrateElapsedForRollback(target);
      return 0;
    }
    if (dt === 0) {
      return stepCareBuffer(buf, 0) >>> 0;
    }
    // Large gaps (e.g. tab was backgrounded / offline for hours) must not spin
    // the chunked loop billions of times. Advance elapsed timers directly and
    // let a single zero-dt step recompute flags/events.
    if (dt > CARE_MAX_CHUNKED_ADVANCE_MS) {
      this._advanceElapsedDirect(dt);
      return stepCareBuffer(buf, 0) >>> 0;
    }
    // Step in <=1000ms chunks so the Wasm clamp never truncates elapsed time.
    let events = 0;
    let remaining = dt;
    while (remaining > 0) {
      const chunk = Math.min(1000, remaining);
      events |= stepCareBuffer(buf, chunk);
      remaining -= chunk;
    }
    return events >>> 0;
  }

  // Adds `dt` ms directly to the elapsed slots (and recomputes remaining/flags)
  // without looping. Used for large offline gaps.
  _advanceElapsedDirect(dt) {
    const buf = this._careView();
    const hungerDuration = careDurationSlot(buf, CARE_SLOT_HUNGER_DURATION_MS, this._hungerDurationMs);
    const groomingDuration = careDurationSlot(buf, CARE_SLOT_GROOMING_DURATION_MS, DEFAULT_GROOMING_DURATION_MS);
    const tirednessDuration = careDurationSlot(buf, CARE_SLOT_TIREDNESS_DURATION_MS, DEFAULT_TIREDNESS_DURATION_MS);

    buf[CARE_SLOT_HUNGER_ELAPSED_MS] = careSaturatingAdd(buf[CARE_SLOT_HUNGER_ELAPSED_MS], dt);
    buf[CARE_SLOT_GROOMING_ELAPSED_MS] = careSaturatingAdd(buf[CARE_SLOT_GROOMING_ELAPSED_MS], dt);
    buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] = careSaturatingAdd(buf[CARE_SLOT_TIREDNESS_ELAPSED_MS], dt);

    buf[CARE_SLOT_HUNGER_REMAINING_MS] = Math.max(0, hungerDuration - buf[CARE_SLOT_HUNGER_ELAPSED_MS]);
    buf[CARE_SLOT_GROOMING_REMAINING_MS] = Math.max(0, groomingDuration - buf[CARE_SLOT_GROOMING_ELAPSED_MS]);
    buf[CARE_SLOT_TIREDNESS_REMAINING_MS] = Math.max(0, tirednessDuration - buf[CARE_SLOT_TIREDNESS_ELAPSED_MS]);

    buf[CARE_SLOT_IS_HUNGRY] = buf[CARE_SLOT_HUNGER_REMAINING_MS] <= 0 ? 1 : 0;
    buf[CARE_SLOT_NEEDS_GROOMING] = (buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS] < 0 ||
      buf[CARE_SLOT_GROOMING_ELAPSED_MS] >= groomingDuration) ? 1 : 0;
    buf[CARE_SLOT_IS_TIRED] = (buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] < 0 ||
      buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] >= tirednessDuration) ? 1 : 0;

    buf[CARE_SLOT_NOW_MS] = careSaturatingAdd(buf[CARE_SLOT_NOW_MS], dt);
  }

  // Recomputes elapsed/remaining/need flags from the last-action timestamps
  // relative to `targetMs`. Used when the clock rolls backwards.
  _rehydrateElapsedForRollback(targetMs) {
    const buf = this._careView();
    const hungerDuration = careDurationSlot(buf, CARE_SLOT_HUNGER_DURATION_MS, this._hungerDurationMs);
    const groomingDuration = careDurationSlot(buf, CARE_SLOT_GROOMING_DURATION_MS, DEFAULT_GROOMING_DURATION_MS);
    const tirednessDuration = careDurationSlot(buf, CARE_SLOT_TIREDNESS_DURATION_MS, DEFAULT_TIREDNESS_DURATION_MS);

    const lastFed = buf[CARE_SLOT_HUNGER_LAST_FED_MS];
    const lastGroomed = buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS];
    const lastRested = buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS];

    buf[CARE_SLOT_HUNGER_ELAPSED_MS] = lastFed < 0 ? 0 : Math.max(0, targetMs - lastFed);
    buf[CARE_SLOT_GROOMING_ELAPSED_MS] = lastGroomed < 0 ? 0 : Math.max(0, targetMs - lastGroomed);
    buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] = lastRested < 0 ? 0 : Math.max(0, targetMs - lastRested);

    buf[CARE_SLOT_HUNGER_REMAINING_MS] = Math.max(0, hungerDuration - buf[CARE_SLOT_HUNGER_ELAPSED_MS]);
    buf[CARE_SLOT_GROOMING_REMAINING_MS] = Math.max(0, groomingDuration - buf[CARE_SLOT_GROOMING_ELAPSED_MS]);
    buf[CARE_SLOT_TIREDNESS_REMAINING_MS] = Math.max(0, tirednessDuration - buf[CARE_SLOT_TIREDNESS_ELAPSED_MS]);

    buf[CARE_SLOT_IS_HUNGRY] = buf[CARE_SLOT_HUNGER_REMAINING_MS] <= 0 ? 1 : 0;
    buf[CARE_SLOT_NEEDS_GROOMING] = (lastGroomed < 0 ||
      buf[CARE_SLOT_GROOMING_ELAPSED_MS] >= groomingDuration) ? 1 : 0;
    buf[CARE_SLOT_IS_TIRED] = (lastRested < 0 ||
      buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] >= tirednessDuration) ? 1 : 0;

    buf[CARE_SLOT_NOW_MS] = targetMs;
    this._lastCareNowMs = targetMs;
  }

  // Writes the care buffer's timestamps back into the persisted state shape.
  _syncStateFromCare() {
    const buf = this._careView();
    const existingNeeds = (this._state && this._state.needs) || {};
    const existingHunger = existingNeeds.hunger || {};
    const existingGrooming = existingNeeds.grooming || {};
    const existingTiredness = existingNeeds.tiredness || {};

    const lastFed = buf[CARE_SLOT_HUNGER_LAST_FED_MS];
    const lastGroomed = buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS];
    const lastRested = buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS];
    // A reset buffer holds -1 sentinels; persist the current clock instead so
    // the stored state stays valid for `isValidState` on reload.
    const nowMs = this._now();
    const fedAt = lastFed < 0 ? nowMs : lastFed;

    this._state = {
      ...this._state,
      version: 1,
      needs: {
        ...existingNeeds,
        hunger: {
          ...existingHunger,
          lastFedAt: fedAt,
          lastCompletedAt: fedAt,
          durationMs: buf[CARE_SLOT_HUNGER_DURATION_MS]
        },
        grooming: {
          ...existingGrooming,
          lastGroomedAt: lastGroomed < 0 ? null : lastGroomed,
          durationMs: buf[CARE_SLOT_GROOMING_DURATION_MS]
        },
        tiredness: {
          ...existingTiredness,
          lastRestedAt: lastRested < 0 ? null : lastRested,
          durationMs: buf[CARE_SLOT_TIREDNESS_DURATION_MS]
        }
      }
    };
  }

  // Issues a care command, advances to `nowMs`, persists, and notifies.
  //
  // The public action methods keep their legacy unconditional semantics: the
  // timestamp is always written (feed/groom/rest never reject). The care
  // buffer is then re-derived so timers/flags stay consistent, and the Wasm
  // step is still used to advance timers and emit events.
  _issueCommand(cmd, nowMs) {
    const target = Number.isFinite(nowMs) ? nowMs : this._now();
    // Re-hydrate from `_state` so direct mutations (e.g. custom durationMs or
    // extra metadata written by hosts/tests) are reflected in the care buffer.
    this._hydrateCareFromState(this._state);
    // Advance to the command time first so the action sees current needs.
    this._advanceCare(target);
    const buf = this._careView();

    if (cmd === CARE_CMD_RESET) {
      buf[CARE_SLOT_ACTION_FLAGS] = (buf[CARE_SLOT_ACTION_FLAGS] >>> 0) | CARE_CMD_RESET;
      const events = stepCareBuffer(buf, 0);
      // Reset leaves -1 sentinels; anchor the hunger timestamp at the reset
      // time so the emitted snapshot reports `target` and the persisted state
      // stays valid for `isValidState` on reload.
      buf[CARE_SLOT_HUNGER_LAST_FED_MS] = target;
      buf[CARE_SLOT_HUNGER_ELAPSED_MS] = 0;
      buf[CARE_SLOT_HUNGER_REMAINING_MS] = careDurationSlot(
        buf, CARE_SLOT_HUNGER_DURATION_MS, this._hungerDurationMs
      );
      buf[CARE_SLOT_IS_HUNGRY] = 0;
      this._syncStateFromCare();
      this._persist(this._state);
      const snapshot = this.getSnapshot(target);
      this._notify(snapshot);
      return { snapshot, events: events >>> 0 };
    }

    // Unconditional legacy semantics: write the timestamp, reset the timer.
    if (cmd === CARE_CMD_FEED) {
      const hungerDuration = careDurationSlot(buf, CARE_SLOT_HUNGER_DURATION_MS, this._hungerDurationMs);
      buf[CARE_SLOT_HUNGER_LAST_FED_MS] = target;
      buf[CARE_SLOT_HUNGER_ELAPSED_MS] = 0;
      buf[CARE_SLOT_HUNGER_REMAINING_MS] = hungerDuration;
      buf[CARE_SLOT_IS_HUNGRY] = 0;
      buf[CARE_SLOT_LAST_ACTION] = CARE_ACTION_FEED;
      buf[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = target;
      buf[CARE_SLOT_FEED_COUNT] = buf[CARE_SLOT_FEED_COUNT] + 1;
      buf[CARE_SLOT_FEED_FLASH_TIMER_MS] = CARE_FEED_FLASH_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_FED;
    } else if (cmd === CARE_CMD_GROOM) {
      const groomingDuration = careDurationSlot(buf, CARE_SLOT_GROOMING_DURATION_MS, DEFAULT_GROOMING_DURATION_MS);
      buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = target;
      buf[CARE_SLOT_GROOMING_ELAPSED_MS] = 0;
      buf[CARE_SLOT_GROOMING_REMAINING_MS] = groomingDuration;
      buf[CARE_SLOT_NEEDS_GROOMING] = 0;
      buf[CARE_SLOT_LAST_ACTION] = CARE_ACTION_GROOM;
      buf[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = target;
      buf[CARE_SLOT_GROOM_COUNT] = buf[CARE_SLOT_GROOM_COUNT] + 1;
      buf[CARE_SLOT_GROOM_FLASH_TIMER_MS] = CARE_GROOM_FLASH_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_GROOMED;
    } else if (cmd === CARE_CMD_REST) {
      const tirednessDuration = careDurationSlot(buf, CARE_SLOT_TIREDNESS_DURATION_MS, DEFAULT_TIREDNESS_DURATION_MS);
      buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = target;
      buf[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0;
      buf[CARE_SLOT_TIREDNESS_REMAINING_MS] = tirednessDuration;
      buf[CARE_SLOT_IS_TIRED] = 0;
      buf[CARE_SLOT_LAST_ACTION] = CARE_ACTION_REST;
      buf[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = target;
      buf[CARE_SLOT_REST_COUNT] = buf[CARE_SLOT_REST_COUNT] + 1;
      buf[CARE_SLOT_REST_FLASH_TIMER_MS] = CARE_REST_FLASH_MS;
      buf[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_RESTED;
    }

    // Advance timers by zero so the Wasm authority recomputes flags/events.
    const events = stepCareBuffer(buf, 0);
    this._syncStateFromCare();
    this._persist(this._state);
    const snapshot = this.getSnapshot(target);
    this._notify(snapshot);
    return { snapshot, events: events >>> 0 };
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
    this._advanceCare(nowMs);
    const buf = this._careView();
    const lastFedRaw = buf[CARE_SLOT_HUNGER_LAST_FED_MS];
    const lastFedAt = lastFedRaw < 0 ? 0 : lastFedRaw;
    const durationMs = buf[CARE_SLOT_HUNGER_DURATION_MS];
    const elapsedMs = Math.max(0, buf[CARE_SLOT_HUNGER_ELAPSED_MS]);
    const remainingMs = Math.max(0, buf[CARE_SLOT_HUNGER_REMAINING_MS]);
    const hungryAt = lastFedAt + durationMs;
    const isHungry = buf[CARE_SLOT_IS_HUNGRY] > 0.5;
    return { lastFedAt, durationMs, elapsedMs, remainingMs, hungryAt, isHungry };
  }

  getSnapshot(nowMs = this._now()) {
    // Read the care buffer directly (no re-advance) so a snapshot taken right
    // after an action reflects the timestamp just written.
    const buf = this._careView();
    const lastFedRaw = buf[CARE_SLOT_HUNGER_LAST_FED_MS];
    const lastFedAt = lastFedRaw < 0 ? 0 : lastFedRaw;
    const durationMs = buf[CARE_SLOT_HUNGER_DURATION_MS];
    const elapsedMs = Math.max(0, buf[CARE_SLOT_HUNGER_ELAPSED_MS]);
    const remainingMs = Math.max(0, buf[CARE_SLOT_HUNGER_REMAINING_MS]);
    const hunger = {
      lastFedAt,
      durationMs,
      elapsedMs,
      remainingMs,
      hungryAt: lastFedAt + durationMs,
      isHungry: buf[CARE_SLOT_IS_HUNGRY] > 0.5
    };
    return {
      version: 1,
      needs: {
        ...this._state.needs,
        hunger: {
          ...this._state.needs.hunger,
          ...hunger
        }
      }
    };
  }

  isHungry(nowMs = this._now()) {
    return this.getHunger(nowMs).isHungry;
  }

  // Read-only selector: true when the dog is hungry.
  selectIsHungry(nowMs = this._now()) {
    return this.getHunger(nowMs).isHungry;
  }

  getGrooming(nowMs = this._now()) {
    this._advanceCare(nowMs);
    const buf = this._careView();
    const lastRaw = buf[CARE_SLOT_GROOMING_LAST_GROOMED_MS];
    const lastGroomedAt = lastRaw < 0 ? null : lastRaw;
    const durationMs = buf[CARE_SLOT_GROOMING_DURATION_MS];
    const needsGrooming = buf[CARE_SLOT_NEEDS_GROOMING] > 0.5;
    const elapsedMs = lastGroomedAt === null ? null : Math.max(0, buf[CARE_SLOT_GROOMING_ELAPSED_MS]);
    const remainingMs = lastGroomedAt === null ? 0 : Math.max(0, buf[CARE_SLOT_GROOMING_REMAINING_MS]);
    return { lastGroomedAt, durationMs, elapsedMs, remainingMs, needsGrooming };
  }

  needsGrooming(nowMs = this._now()) {
    return this.getGrooming(nowMs).needsGrooming;
  }

  // Read-only selector: true when the dog needs grooming.
  selectNeedsGrooming(nowMs = this._now()) {
    return this.getGrooming(nowMs).needsGrooming;
  }

  getTiredness(nowMs = this._now()) {
    this._advanceCare(nowMs);
    const buf = this._careView();
    const lastRaw = buf[CARE_SLOT_TIREDNESS_LAST_RESTED_MS];
    const lastRestedAt = lastRaw < 0 ? null : lastRaw;
    const durationMs = buf[CARE_SLOT_TIREDNESS_DURATION_MS];
    const isTired = buf[CARE_SLOT_IS_TIRED] > 0.5;
    const elapsedMs = lastRestedAt === null ? null : Math.max(0, buf[CARE_SLOT_TIREDNESS_ELAPSED_MS]);
    const remainingMs = lastRestedAt === null ? 0 : Math.max(0, buf[CARE_SLOT_TIREDNESS_REMAINING_MS]);
    return { lastRestedAt, durationMs, elapsedMs, remainingMs, isTired };
  }

  isTired(nowMs = this._now()) {
    return this.getTiredness(nowMs).isTired;
  }

  // Read-only selector: true when the dog is tired.
  selectIsTired(nowMs = this._now()) {
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
    return this._issueCommand(CARE_CMD_FEED, nowMs).snapshot;
  }

  groom(nowMs = this._now()) {
    return this._issueCommand(CARE_CMD_GROOM, nowMs).snapshot;
  }

  rest(nowMs = this._now()) {
    return this._issueCommand(CARE_CMD_REST, nowMs).snapshot;
  }

  reset(nowMs = this._now()) {
    return this._issueCommand(CARE_CMD_RESET, nowMs).snapshot;
  }

  // --- Care buffer accessors (for hosts that need events / raw slots) ------

  /** Returns a copy of the current 32-slot care buffer. */
  getCareBuffer() {
    return new Float32Array(this._careView());
  }

  /** Returns the last event bitmask produced by a care step. */
  getLastCareEvents() {
    return this._careView()[CARE_SLOT_EVENT_BITMASK] >>> 0;
  }

  /** Returns the current UI toast kind (see CARE_TOAST_*). */
  getToastKind() {
    return this._careView()[CARE_SLOT_UI_TOAST_KIND] | 0;
  }

  /** Returns the current rejection kind (see CARE_REJECTION_*). */
  getRejectionKind() {
    return this._careView()[CARE_SLOT_REJECTION_KIND] | 0;
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
  globalThis.CARE_BUFFER_SLOTS = CARE_BUFFER_SLOTS;
  globalThis.CARE_MAX_CHUNKED_ADVANCE_MS = CARE_MAX_CHUNKED_ADVANCE_MS;
  globalThis.CARE_CMD_FEED = CARE_CMD_FEED;
  globalThis.CARE_CMD_GROOM = CARE_CMD_GROOM;
  globalThis.CARE_CMD_REST = CARE_CMD_REST;
  globalThis.CARE_CMD_RESET = CARE_CMD_RESET;
  globalThis.stepCareBuffer = stepCareBuffer;
  globalThis.stepCareBufferJs = stepCareBufferJs;
  globalThis.resolveCareBufferView = resolveCareBufferView;
}
