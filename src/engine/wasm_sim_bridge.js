// src/engine/wasm_sim_bridge.js
// @ts-check
// src/engine/wasm_sim_bridge.js
// Strangler-Fig Simulation Bridge: Rust/Wasm accelerated simulation with transparent JS fallback.

import { initSync, WasmWorldSim } from '../wasm_core/dog_walker_core.js';
import { WASM_CONSTANTS } from './wasm_constants.js';

/**
 * @typedef {Object} OwnerLike
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [vx]
 * @property {number} [vy]
 * @property {number} [angle]
 * @property {number} [heading]
 * @property {number} [halfWidth]
 * @property {number} [gaitId]
 * @property {number} [gait]
 * @property {boolean} [isMoving]
 * @property {boolean} [isLeashed]
 */

/**
 * @typedef {Object} BallLike
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 * @property {number} [vx]
 * @property {number} [vy]
 * @property {number} [vz]
 * @property {number} [gravity]
 * @property {number} [restitution]
 * @property {number} [friction]
 * @property {boolean} [isThrown]
 * @property {boolean} [isCarried]
 * @property {boolean} [inOwnerPossession]
 */

/**
 * @typedef {Object} NpcLike
 * @property {number} [x]
 * @property {number} [y]
 */

/**
 * @typedef {Object} FieldLike
 * @property {number} [width]
 * @property {number} [height]
 * @property {boolean} [isSunny]
 * @property {boolean} [zoneIsSunny]
 * @property {{ sunny?: boolean }} [zoneConfig]
 * @property {{ active?: boolean, left?: number, top?: number, right?: number, bottom?: number } | null} [camera]
 * @property {() => unknown} [getWorldObstacles]
 * @property {(x: number, y: number, r: number) => { x: number, y: number }} [resolveCircleCollision]
 */

/**
 * @typedef {Object} DogLike
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [vx]
 * @property {number} [vy]
 * @property {number} [angle]
 * @property {string} [state]
 * @property {string} [roamSubMode]
 * @property {string | null} [zoomiesPath]
 * @property {string} [gaitMode]
 * @property {number} [gaitPhase]
 * @property {number} [zoomiesTimer]
 * @property {boolean} [isOnLeash]
 * @property {boolean} [hasBall]
 * @property {boolean} [isHungry]
 * @property {boolean} [needsGrooming]
 * @property {boolean} [isTired]
 * @property {string} [preferredSide]
 * @property {number} [nowSec]
 * @property {OwnerLike} [owner]
 * @property {BallLike} [activeBall]
 * @property {{ active?: boolean, left?: number, top?: number, right?: number, bottom?: number } | null} [camera]
 * @property {Record<string, number>} [personality]
 * @property {{ whistleRecall?: boolean, pet?: boolean, praise?: boolean, bark?: boolean, triggerZoomies?: boolean, fetchBall?: boolean }} [pendingCommands]
 * @property {Array<{ x: number, y: number }>} [scents]
 * @property {Record<string, unknown>} [dogStateStore]
 * @property {{ angle?: number, vel?: number }} [leftEar]
 * @property {{ angle?: number, vel?: number }} [rightEar]
 * @property {number} [wagSpeed]
 * @property {number} [tailAngle]
 * @property {number} [noseTwitch]
 * @property {{ x: number, y: number } | null} [targetSlot]
 * @property {boolean} [isPullingLeash]
 * @property {number} [leashTension]
 * @property {number} [leashSagPx]
 * @property {number} [leashVibrationPx]
 * @property {number} [ownerClampedX]
 * @property {number} [ownerClampedY]
 * @property {boolean} [ownerWasClamped]
 * @property {boolean} [ownerFrozen]
 */

/** @type {InstanceType<typeof WasmWorldSim> | null} */
let wasmSimInstance = null;
/** @type {Promise<InstanceType<typeof WasmWorldSim> | null> | null} */
let initPromise = null;
let simWorldWidth = 3200.0;
let simWorldHeight = 2400.0;
// True once the exact field obstacle set has been uploaded to the Wasm sim (see syncWorldObstacles).
let worldObstaclesReady = false;

// --- Zero-copy step bridge state -------------------------------------------------------------
// Raw Wasm linear memory (from initSync / default()), used to build the Float32Array view.
/** @type {WebAssembly.Memory | null} */
let wasmMemory = null;
// Cached Float32Array view over the 128-slot dog buffer (recreated only on memory growth).
/** @type {Float32Array | null} */
let dogBufferView = null;
// The buffer pointer the cached view was created from (0 = not yet resolved).
/** @type {number} */
let dogBufferPtr = 0;
// Number of Float32 slots in the dog buffer contract.
const DOG_BUFFER_SLOTS = WASM_CONSTANTS.dog.DOG_SIM_BUFFER_LEN;

/**
 * Initializes the Wasm simulation singleton (browser path). Idempotent: returns the cached
 * instance or the in-flight init promise. Falls back to `null` in headless/non-Wasm environments.
 * @param {number} [worldWidth]
 * @param {number} [worldHeight]
 * @returns {Promise<InstanceType<typeof WasmWorldSim> | null>}
 */
export async function initWasmSim(worldWidth = 3200.0, worldHeight = 2400.0) {
  simWorldWidth = worldWidth;
  simWorldHeight = worldHeight;
  if (wasmSimInstance) return wasmSimInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (typeof window !== 'undefined') {
        const mod = await import('../wasm_core/dog_walker_core.js');
        if (typeof mod.default === 'function') {
          const initResult = await mod.default();
          if (initResult && initResult.memory) {
            wasmMemory = initResult.memory;
          }
        }
        if (typeof mod.WasmWorldSim === 'function') {
          wasmSimInstance = new mod.WasmWorldSim(worldWidth, worldHeight);
          console.log('[WasmSimBridge] Core simulation engine initialized (Rust/Wasm).');
          return wasmSimInstance;
        }
      }
    } catch (err) {
      console.warn('[WasmSimBridge] Running in headless or non-Wasm environment; using JS fallback.', err);
    }
    return null;
  })();

  return initPromise;
}

/**
 * Returns the initialized Wasm sim singleton.
 * @returns {InstanceType<typeof WasmWorldSim>}
 * @throws {Error} When the Wasm sim has not been initialized.
 */
export function getWasmSim() {
  if (!wasmSimInstance) {
    throw new Error('Wasm sim not initialized');
  }
  return wasmSimInstance;
}

/**
 * Non-throwing Wasm availability check. Returns true only when the Wasm sim singleton has been
 * initialized. Safe to call from hot paths and headless environments where Wasm may never load.
 * @returns {boolean} True only when the Wasm sim singleton has been initialized.
 */
export function isWasmSimReady() {
  return Boolean(wasmSimInstance);
}

/**
 * Returns a Float32Array view over the Wasm linear memory at `ptr` for `lengthFloats` slots.
 * @param {number} ptr
 * @param {number} lengthFloats
 * @returns {Float32Array}
 * @throws {Error} When the pointer or memory is unavailable.
 */
export function getBufferView(ptr, lengthFloats) {
  if (!wasmMemory || !wasmMemory.buffer) {
    throw new Error('Wasm buffer pointer unavailable');
  }
  if (!ptr || !Number.isFinite(ptr) || ptr <= 0) {
    throw new Error('Wasm buffer pointer unavailable');
  }
  const len = Math.max(0, lengthFloats | 0);
  const byteOffset = ptr >>> 0;
  // Always build a fresh view over the *current* buffer: memory.grow detaches the old
  // ArrayBuffer (byteLength becomes 0), so any cached view would be stale.
  const buffer = wasmMemory.buffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Wasm buffer pointer unavailable');
  }
  if (byteOffset + len * 4 > buffer.byteLength) {
    throw new Error('Wasm buffer pointer unavailable');
  }
  return new Float32Array(buffer, byteOffset, len);
}

/**
 * ORs `bit` (a command mask) into the Float32 slot at `offset`, preserving existing bits.
 * The slot is coerced to an unsigned 32-bit integer before the OR and written back as a float.
 * @param {Float32Array | null} bufferView
 * @param {number} offset
 * @param {number} bit
 * @returns {void}
 */
export function writeCommandFlag(bufferView, offset, bit) {
  if (!bufferView) return;
  const idx = offset | 0;
  const current = bufferView[idx] >>> 0;
  const mask = bit >>> 0;
  bufferView[idx] = (current | mask) >>> 0;
}

/**
 * Reads the Float32 slot at `offset` coerced to an unsigned 32-bit integer (event bitmask).
 * @param {Float32Array | null} bufferView
 * @param {number} offset
 * @returns {number}
 */
export function readEventBitmask(bufferView, offset) {
  if (!bufferView) return 0;
  return bufferView[offset | 0] >>> 0;
}

/**
 * Returns the Node.js `process` object when running under Node, otherwise undefined.
 * @returns {{ versions?: { node?: string }, getBuiltinModule?: (name: string) => unknown } | undefined}
 */
function getNodeProcess() {
  return /** @type {{ process?: { versions?: { node?: string }, getBuiltinModule?: (name: string) => unknown } }} */ (
    globalThis
  ).process;
}

function isNodeRuntime() {
  const nodeProc = getNodeProcess();
  return !!nodeProc && !!nodeProc.versions && !!nodeProc.versions.node;
}

/**
 * Synchronously initializes the Wasm core in Node.js. Locates the .wasm file relative to this
 * module (never the process cwd), reads it with fs.readFileSync, and calls initSync(bytes).
 * Returns true on success. Throws an actionable error on failure (non-Node runtime, missing
 * built-ins, or wasm load error).
 * @param {number} [worldWidth]
 * @param {number} [worldHeight]
 * @returns {boolean} True on success.
 * @throws {Error} On failure (non-Node runtime, missing built-ins, or wasm load error).
 */
export function initWasmSimSync(worldWidth = 3200.0, worldHeight = 2400.0) {
  simWorldWidth = worldWidth;
  simWorldHeight = worldHeight;
  if (wasmSimInstance) return true;
  if (!isNodeRuntime()) {
    throw new Error('Wasm sim not initialized');
  }

  // Resolve the wasm path relative to this module, not the process cwd.
  // Node built-ins are loaded via process.getBuiltinModule() so browser bundlers never see
  // static `node:` imports and no `require()` is needed in this ESM module.
  const nodeProc = getNodeProcess();
  const getBuiltin = (nodeProc && typeof nodeProc.getBuiltinModule === 'function')
    ? nodeProc.getBuiltinModule.bind(nodeProc)
    : null;
  if (!getBuiltin) {
    throw new Error('initWasmSimSync requires Node.js >= 22.3 (process.getBuiltinModule is unavailable).');
  }
  const urlMod = /** @type {{ fileURLToPath: (u: string | URL) => string }} */ (getBuiltin('node:url'));
  const fs = /** @type {{ readFileSync: (p: string) => Uint8Array }} */ (getBuiltin('node:fs'));
  const path = /** @type {{ dirname: (p: string) => string, resolve: (...parts: string[]) => string }} */ (getBuiltin('node:path'));
  if (!urlMod || !fs || !path) {
    throw new Error('initWasmSimSync failed to load Node.js built-in modules (node:url, node:fs, node:path).');
  }
  const moduleDir = path.dirname(urlMod.fileURLToPath(import.meta.url));
  const wasmPath = path.resolve(moduleDir, '..', 'wasm_core', 'dog_walker_core_bg.wasm');

  let wasmBytes;
  try {
    wasmBytes = fs.readFileSync(wasmPath);
  } catch {
    throw new Error(`dog_walker_core wasm init failed: ${wasmPath}`);
  }

  try {
    const initResult = initSync(wasmBytes);
    if (initResult && initResult.memory) {
      wasmMemory = initResult.memory;
    }
    wasmSimInstance = new WasmWorldSim(worldWidth, worldHeight);
  } catch {
    throw new Error(`dog_walker_core wasm init failed: ${wasmPath}`);
  }

  console.log('[WasmSimBridge] Core simulation engine initialized synchronously (Rust/Wasm).');
  return true;
}

/**
 * Returns the cached 128-slot Float32Array view over the dog buffer, recreating it only when the
 * underlying Wasm memory has grown (buffer identity changed). Throws on invalid pointer/length.
 */
function getDogBufferView() {
  if (!wasmSimInstance || typeof wasmSimInstance.dog_buffer_ptr !== 'function') {
    throw new Error('Wasm sim not initialized');
  }
  if (!wasmMemory) {
    throw new Error('Wasm sim not initialized');
  }
  const ptr = wasmSimInstance.dog_buffer_ptr();
  if (!ptr) {
    throw new Error('Wasm dog buffer pointer is 0');
  }
  if (dogBufferView && dogBufferView.buffer === wasmMemory.buffer && dogBufferPtr === ptr) {
    return dogBufferView;
  }
  const view = new Float32Array(wasmMemory.buffer, ptr, DOG_BUFFER_SLOTS);
  if (view.length !== DOG_BUFFER_SLOTS) {
    throw new Error(`Wasm dog buffer view length ${view.length} !== ${DOG_BUFFER_SLOTS}`);
  }
  dogBufferView = view;
  dogBufferPtr = ptr;
  return dogBufferView;
}

// --- NPC simulation buffer bridge (mirror npc_sim.rs) ----------------------------------------

// NpcSimBuffer slot indices (0..63).
export const NPC_SLOT_STATE = WASM_CONSTANTS.npc.NPC_SLOT_STATE;
export const NPC_SLOT_X = WASM_CONSTANTS.npc.NPC_SLOT_X;
export const NPC_SLOT_Y = WASM_CONSTANTS.npc.NPC_SLOT_Y;
export const NPC_SLOT_HEADING_RAD = WASM_CONSTANTS.npc.NPC_SLOT_HEADING_RAD;
export const NPC_SLOT_SPEED_SCALE = WASM_CONSTANTS.npc.NPC_SLOT_SPEED_SCALE;
export const NPC_SLOT_SEGMENT_INDEX = WASM_CONSTANTS.npc.NPC_SLOT_SEGMENT_INDEX;
export const NPC_SLOT_SEGMENT_T = WASM_CONSTANTS.npc.NPC_SLOT_SEGMENT_T;
export const NPC_SLOT_ELAPSED_S = WASM_CONSTANTS.npc.NPC_SLOT_ELAPSED_S;
export const NPC_SLOT_OPACITY = WASM_CONSTANTS.npc.NPC_SLOT_OPACITY;
export const NPC_SLOT_OPACITY_TARGET = WASM_CONSTANTS.npc.NPC_SLOT_OPACITY_TARGET;
export const NPC_SLOT_DONE = WASM_CONSTANTS.npc.NPC_SLOT_DONE;
export const NPC_SLOT_IS_FINISHED_STATE = WASM_CONSTANTS.npc.NPC_SLOT_IS_FINISHED_STATE;
export const NPC_SLOT_FINISH_TIME_S = WASM_CONSTANTS.npc.NPC_SLOT_FINISH_TIME_S;
export const NPC_SLOT_FADE_START_S = WASM_CONSTANTS.npc.NPC_SLOT_FADE_START_S;
export const NPC_SLOT_FADE_ELAPSED_S = WASM_CONSTANTS.npc.NPC_SLOT_FADE_ELAPSED_S;
export const NPC_SLOT_PAUSE_REMAINING_S = WASM_CONSTANTS.npc.NPC_SLOT_PAUSE_REMAINING_S;
export const NPC_SLOT_SPEECH_VISIBLE = WASM_CONSTANTS.npc.NPC_SLOT_SPEECH_VISIBLE;
export const NPC_SLOT_SPEECH_PHRASE_ID = WASM_CONSTANTS.npc.NPC_SLOT_SPEECH_PHRASE_ID;
export const NPC_SLOT_SPEECH_TIMER_S = WASM_CONSTANTS.npc.NPC_SLOT_SPEECH_TIMER_S;
export const NPC_SLOT_SPEECH_WINDOW_S = WASM_CONSTANTS.npc.NPC_SLOT_SPEECH_WINDOW_S;
export const NPC_SLOT_PHRASE_TIMER_S = WASM_CONSTANTS.npc.NPC_SLOT_PHRASE_TIMER_S;
export const NPC_SLOT_NEXT_SPEECH_DELAY_S = WASM_CONSTANTS.npc.NPC_SLOT_NEXT_SPEECH_DELAY_S;
export const NPC_SLOT_RNG_STATE = WASM_CONSTANTS.npc.NPC_SLOT_RNG_STATE;
export const NPC_SLOT_SEED = WASM_CONSTANTS.npc.NPC_SLOT_SEED;
export const NPC_SLOT_PATH_POINT_COUNT = WASM_CONSTANTS.npc.NPC_SLOT_PATH_POINT_COUNT;
export const NPC_SLOT_PATH_TOTAL_LENGTH_PX = WASM_CONSTANTS.npc.NPC_SLOT_PATH_TOTAL_LENGTH_PX;
export const NPC_SLOT_PATH_HASH = WASM_CONSTANTS.npc.NPC_SLOT_PATH_HASH;
export const NPC_SLOT_CMD_FLAGS = WASM_CONSTANTS.npc.NPC_SLOT_CMD_FLAGS;
export const NPC_SLOT_FADE_COMPLETED = WASM_CONSTANTS.npc.NPC_SLOT_FADE_COMPLETED;

// Command flags (stored in NPC_SLOT_CMD_FLAGS).
export const NPC_CMD_RESET = WASM_CONSTANTS.npc.NPC_CMD_RESET;
export const NPC_CMD_PAUSE = WASM_CONSTANTS.npc.NPC_CMD_PAUSE;
export const NPC_CMD_RESUME = WASM_CONSTANTS.npc.NPC_CMD_RESUME;
export const NPC_CMD_SET_WALKING = WASM_CONSTANTS.npc.NPC_CMD_SET_WALKING;
export const NPC_CMD_SET_RUNNING = WASM_CONSTANTS.npc.NPC_CMD_SET_RUNNING;
export const NPC_CMD_FORCE_SPEECH = WASM_CONSTANTS.npc.NPC_CMD_FORCE_SPEECH;

// Event bitmask constants returned from stepNpcBuffer.
export const NPC_EVENT_RESET = WASM_CONSTANTS.npc.NPC_EVENT_RESET;
export const NPC_EVENT_PAUSED = WASM_CONSTANTS.npc.NPC_EVENT_PAUSED;
export const NPC_EVENT_RESUMED = WASM_CONSTANTS.npc.NPC_EVENT_RESUMED;
export const NPC_EVENT_STATE_CHANGED = WASM_CONSTANTS.npc.NPC_EVENT_STATE_CHANGED;
export const NPC_EVENT_SPEECH_TRIGGERED = WASM_CONSTANTS.npc.NPC_EVENT_SPEECH_TRIGGERED;
export const NPC_EVENT_SPEECH_HIDDEN = WASM_CONSTANTS.npc.NPC_EVENT_SPEECH_HIDDEN;
export const NPC_EVENT_PATH_FINISHED = WASM_CONSTANTS.npc.NPC_EVENT_PATH_FINISHED;
export const NPC_EVENT_FADE_STARTED = WASM_CONSTANTS.npc.NPC_EVENT_FADE_STARTED;
export const NPC_EVENT_FADE_COMPLETED = WASM_CONSTANTS.npc.NPC_EVENT_FADE_COMPLETED;
export const NPC_EVENT_CMD_REJECTED = WASM_CONSTANTS.npc.NPC_EVENT_CMD_REJECTED;

// NpcSimBuffer contract constants (mirror npc_sim.rs).
export const NPC_BUFFER_SLOTS = WASM_CONSTANTS.world.NPC_SIM_BUFFER_LEN;
export const NPC_FADE_DURATION_S = 0.5;
export const NPC_SPEECH_WINDOW_S = 4.0;
export const NPC_SPEECH_BASE_DELAY_S = 4.0;
export const NPC_SPEECH_DELAY_JITTER_S = 4.0;
export const NPC_WALK_SPEED_PX_S = 40.0;
export const NPC_RUN_SPEED_PX_S = 95.0;
export const NPC_STATE_WALKING = 0;
export const NPC_STATE_RUNNING = 1;
export const NPC_STATE_PAUSED = 2;

function npcSlotGetU32(buf, index) {
  const v = buf[index];
  return (Number.isFinite(v) && v > 0) ? (Math.round(v) >>> 0) : 0;
}

function npcSlotSetU32(buf, index, value) {
  buf[index] = value >>> 0;
}

function npcSlotGetBits(buf, index) {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = buf[index];
  return u32[0];
}

function npcSlotSetBits(buf, index, value) {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  u32[0] = value >>> 0;
  buf[index] = f32[0];
}

function npcMulberry32Next(state) {
  // Mirror crate::math::Mulberry32 (single draw) and advance the state.
  let t = (state + 0x6D2B79F5) >>> 0;
  const nextState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState };
}

function npcComputePathTotalLength(flat) {
  const n = Math.floor(flat.length / 2);
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const dx = flat[2 * i + 2] - flat[2 * i];
    const dy = flat[2 * i + 3] - flat[2 * i + 1];
    total += Math.max(0.001, Math.hypot(dx, dy));
  }
  return total;
}

/**
 * JS fallback for `step_npc_buffer` (exact port of crates/dog_walker_core/src/npc_sim.rs).
 * Mutates `buf` (Float32Array of NPC_BUFFER_SLOTS) and returns the event bitmask.
 */
function stepNpcBufferJs(buf, flat, phraseCount, dt) {
  if (!(dt > 0) || !Number.isFinite(dt)) return NPC_EVENT_CMD_REJECTED;

  let events = 0;
  const n = Math.floor(flat.length / 2);
  const pathTotalLength = npcComputePathTotalLength(flat);
  npcSlotSetU32(buf, NPC_SLOT_PATH_POINT_COUNT, n);
  buf[NPC_SLOT_PATH_TOTAL_LENGTH_PX] = pathTotalLength;
  const pathTooShort = n < 2;

  const cmdFlags = npcSlotGetU32(buf, NPC_SLOT_CMD_FLAGS);
  let didReset = false;
  if (cmdFlags & NPC_CMD_RESET) {
    const x0 = n >= 1 ? flat[0] : 0;
    const y0 = n >= 1 ? flat[1] : 0;
    buf[NPC_SLOT_X] = x0;
    buf[NPC_SLOT_Y] = y0;
    buf[NPC_SLOT_STATE] = NPC_STATE_WALKING;
    buf[NPC_SLOT_OPACITY] = 1.0;
    buf[NPC_SLOT_OPACITY_TARGET] = 1.0;
    buf[NPC_SLOT_DONE] = 0.0;
    buf[NPC_SLOT_IS_FINISHED_STATE] = 0.0;
    buf[NPC_SLOT_ELAPSED_S] = 0.0;
    buf[NPC_SLOT_SEGMENT_INDEX] = 0.0;
    buf[NPC_SLOT_SEGMENT_T] = 0.0;
    buf[NPC_SLOT_FADE_ELAPSED_S] = 0.0;
    buf[NPC_SLOT_FINISH_TIME_S] = 0.0;
    buf[NPC_SLOT_FADE_START_S] = 0.0;
    buf[NPC_SLOT_FADE_COMPLETED] = 0.0;
    buf[NPC_SLOT_PAUSE_REMAINING_S] = 0.0;
    buf[NPC_SLOT_SPEECH_VISIBLE] = 0.0;
    buf[NPC_SLOT_SPEECH_PHRASE_ID] = 0.0;
    buf[NPC_SLOT_SPEECH_TIMER_S] = 0.0;
    buf[NPC_SLOT_SPEECH_WINDOW_S] = 0.0;
    buf[NPC_SLOT_PHRASE_TIMER_S] = 0.0;
    buf[NPC_SLOT_NEXT_SPEECH_DELAY_S] = NPC_SPEECH_BASE_DELAY_S;
    buf[NPC_SLOT_SPEED_SCALE] = 1.0;
    const seed = npcSlotGetBits(buf, NPC_SLOT_SEED);
    npcSlotSetBits(buf, NPC_SLOT_RNG_STATE, seed);
    didReset = true;
    events |= NPC_EVENT_RESET;
  } else if (cmdFlags & NPC_CMD_PAUSE) {
    buf[NPC_SLOT_STATE] = NPC_STATE_PAUSED;
    buf[NPC_SLOT_PAUSE_REMAINING_S] = Infinity;
    events |= NPC_EVENT_PAUSED;
  } else if (cmdFlags & NPC_CMD_RESUME) {
    buf[NPC_SLOT_STATE] = NPC_STATE_WALKING;
    buf[NPC_SLOT_PAUSE_REMAINING_S] = 0.0;
    events |= NPC_EVENT_RESUMED;
  } else if (cmdFlags & NPC_CMD_SET_WALKING) {
    buf[NPC_SLOT_STATE] = NPC_STATE_WALKING;
    events |= NPC_EVENT_STATE_CHANGED;
  } else if (cmdFlags & NPC_CMD_SET_RUNNING) {
    buf[NPC_SLOT_STATE] = NPC_STATE_RUNNING;
    events |= NPC_EVENT_STATE_CHANGED;
  } else if (cmdFlags & NPC_CMD_FORCE_SPEECH) {
    if (phraseCount === 0) {
      events |= NPC_EVENT_CMD_REJECTED;
    } else {
      let rng = npcSlotGetBits(buf, NPC_SLOT_RNG_STATE);
      const draw = npcMulberry32Next(rng);
      rng = draw.nextState;
      npcSlotSetBits(buf, NPC_SLOT_RNG_STATE, rng);
      const phraseId = (Math.floor(draw.value * 4294967296) >>> 0) % phraseCount;
      buf[NPC_SLOT_SPEECH_VISIBLE] = 1.0;
      npcSlotSetU32(buf, NPC_SLOT_SPEECH_PHRASE_ID, phraseId);
      buf[NPC_SLOT_SPEECH_TIMER_S] = 0.0;
      buf[NPC_SLOT_SPEECH_WINDOW_S] = NPC_SPEECH_WINDOW_S;
      buf[NPC_SLOT_PHRASE_TIMER_S] = 0.0;
      events |= NPC_EVENT_SPEECH_TRIGGERED;
    }
  }
  npcSlotSetU32(buf, NPC_SLOT_CMD_FLAGS, 0);

  if (pathTooShort) {
    buf[NPC_SLOT_DONE] = 1.0;
    buf[NPC_SLOT_OPACITY_TARGET] = 0.0;
    events |= NPC_EVENT_PATH_FINISHED;
    return events;
  }

  let state = buf[NPC_SLOT_STATE];
  if (state === NPC_STATE_PAUSED) {
    const remaining = buf[NPC_SLOT_PAUSE_REMAINING_S];
    if (Number.isFinite(remaining)) {
      const next = remaining - dt;
      if (next <= 0) {
        buf[NPC_SLOT_PAUSE_REMAINING_S] = 0.0;
        buf[NPC_SLOT_STATE] = NPC_STATE_WALKING;
        state = NPC_STATE_WALKING;
        events |= NPC_EVENT_RESUMED;
      } else {
        buf[NPC_SLOT_PAUSE_REMAINING_S] = next;
      }
    }
  }

  const done = buf[NPC_SLOT_DONE] > 0.5;
  let finishedThisTick = false;
  if (!done && !didReset && state !== NPC_STATE_PAUSED) {
    const speedScale = buf[NPC_SLOT_SPEED_SCALE];
    const baseSpeed = state === NPC_STATE_RUNNING ? NPC_RUN_SPEED_PX_S : NPC_WALK_SPEED_PX_S;
    const speed = baseSpeed * speedScale;
    const distance = speed * dt;

    let segIndex = buf[NPC_SLOT_SEGMENT_INDEX] | 0;
    let segT = buf[NPC_SLOT_SEGMENT_T];
    const lastSegIndex = n - 2;
    if (segIndex > lastSegIndex) segIndex = lastSegIndex;

    let segLen = Math.max(0.001, Math.hypot(
      flat[2 * (segIndex + 1)] - flat[2 * segIndex],
      flat[2 * (segIndex + 1) + 1] - flat[2 * segIndex + 1]
    ));
    segT += distance / segLen;

    while (segT >= 1.0 && segIndex < lastSegIndex) {
      const oldLen = segLen;
      segIndex += 1;
      segLen = Math.max(0.001, Math.hypot(
        flat[2 * (segIndex + 1)] - flat[2 * segIndex],
        flat[2 * (segIndex + 1) + 1] - flat[2 * segIndex + 1]
      ));
      segT = (segT - 1.0) * oldLen / segLen;
    }

    const prevX = flat[2 * segIndex];
    const prevY = flat[2 * segIndex + 1];
    const nextX = flat[2 * (segIndex + 1)];
    const nextY = flat[2 * (segIndex + 1) + 1];

    if (segIndex === lastSegIndex && segT >= 1.0) {
      buf[NPC_SLOT_X] = nextX;
      buf[NPC_SLOT_Y] = nextY;
      buf[NPC_SLOT_SEGMENT_INDEX] = segIndex;
      buf[NPC_SLOT_SEGMENT_T] = 1.0;
      buf[NPC_SLOT_HEADING_RAD] = Math.atan2(nextY - prevY, nextX - prevX);
      const elapsed = buf[NPC_SLOT_ELAPSED_S] + dt;
      buf[NPC_SLOT_ELAPSED_S] = elapsed;
      buf[NPC_SLOT_DONE] = 1.0;
      buf[NPC_SLOT_IS_FINISHED_STATE] = 1.0;
      buf[NPC_SLOT_FINISH_TIME_S] = elapsed;
      buf[NPC_SLOT_FADE_START_S] = elapsed;
      buf[NPC_SLOT_FADE_ELAPSED_S] = 0.0;
      buf[NPC_SLOT_FADE_COMPLETED] = 0.0;
      buf[NPC_SLOT_OPACITY_TARGET] = 0.0;
      finishedThisTick = true;
      events |= NPC_EVENT_PATH_FINISHED | NPC_EVENT_FADE_STARTED;
    } else {
      const t = Math.max(0, Math.min(1, segT));
      buf[NPC_SLOT_X] = prevX + (nextX - prevX) * t;
      buf[NPC_SLOT_Y] = prevY + (nextY - prevY) * t;
      buf[NPC_SLOT_SEGMENT_INDEX] = segIndex;
      buf[NPC_SLOT_SEGMENT_T] = segT;
      buf[NPC_SLOT_HEADING_RAD] = Math.atan2(nextY - prevY, nextX - prevX);
      buf[NPC_SLOT_ELAPSED_S] = buf[NPC_SLOT_ELAPSED_S] + dt;
    }
  }

  if (buf[NPC_SLOT_IS_FINISHED_STATE] > 0.5 && !finishedThisTick) {
    const fadeElapsed = buf[NPC_SLOT_FADE_ELAPSED_S] + dt;
    buf[NPC_SLOT_FADE_ELAPSED_S] = fadeElapsed;
    const opacity = Math.max(0, Math.min(1, 1.0 - fadeElapsed / NPC_FADE_DURATION_S));
    buf[NPC_SLOT_OPACITY] = opacity;
    if (opacity <= 0 && buf[NPC_SLOT_FADE_COMPLETED] <= 0.5) {
      buf[NPC_SLOT_FADE_COMPLETED] = 1.0;
      buf[NPC_SLOT_DONE] = 1.0;
      events |= NPC_EVENT_FADE_COMPLETED;
    }
  }

  const speechVisible = buf[NPC_SLOT_SPEECH_VISIBLE] > 0.5;
  if (speechVisible) {
    const phraseTimer = buf[NPC_SLOT_PHRASE_TIMER_S] + dt;
    buf[NPC_SLOT_PHRASE_TIMER_S] = phraseTimer;
    if (phraseTimer >= NPC_SPEECH_WINDOW_S) {
      buf[NPC_SLOT_SPEECH_VISIBLE] = 0.0;
      buf[NPC_SLOT_PHRASE_TIMER_S] = 0.0;
      buf[NPC_SLOT_SPEECH_TIMER_S] = 0.0;
      let rng = npcSlotGetBits(buf, NPC_SLOT_RNG_STATE);
      const draw = npcMulberry32Next(rng);
      rng = draw.nextState;
      npcSlotSetBits(buf, NPC_SLOT_RNG_STATE, rng);
      buf[NPC_SLOT_NEXT_SPEECH_DELAY_S] = NPC_SPEECH_BASE_DELAY_S + draw.value * NPC_SPEECH_DELAY_JITTER_S;
      events |= NPC_EVENT_SPEECH_HIDDEN;
    }
  } else {
    const speechTimer = buf[NPC_SLOT_SPEECH_TIMER_S] + dt;
    buf[NPC_SLOT_SPEECH_TIMER_S] = speechTimer;
    const nextDelay = buf[NPC_SLOT_NEXT_SPEECH_DELAY_S];
    if (speechTimer >= nextDelay) {
      if (phraseCount === 0) {
        buf[NPC_SLOT_SPEECH_TIMER_S] = 0.0;
        buf[NPC_SLOT_NEXT_SPEECH_DELAY_S] = NPC_SPEECH_BASE_DELAY_S;
        events |= NPC_EVENT_CMD_REJECTED;
      } else {
        let rng = npcSlotGetBits(buf, NPC_SLOT_RNG_STATE);
        const draw = npcMulberry32Next(rng);
        rng = draw.nextState;
        npcSlotSetBits(buf, NPC_SLOT_RNG_STATE, rng);
        const phraseId = (Math.floor(draw.value * 4294967296) >>> 0) % phraseCount;
        buf[NPC_SLOT_SPEECH_VISIBLE] = 1.0;
        npcSlotSetU32(buf, NPC_SLOT_SPEECH_PHRASE_ID, phraseId);
        buf[NPC_SLOT_SPEECH_TIMER_S] = 0.0;
        buf[NPC_SLOT_SPEECH_WINDOW_S] = NPC_SPEECH_WINDOW_S;
        buf[NPC_SLOT_PHRASE_TIMER_S] = 0.0;
        events |= NPC_EVENT_SPEECH_TRIGGERED;
      }
    }
  }

  return events;
}

/**
 * Advances an NPC simulation buffer by one tick. Delegates to the Wasm `step_npc_buffer`
 * authority when available, otherwise runs the exact JS fallback. `buf` is a Float32Array of
 * NPC_BUFFER_SLOTS; `flat` is the path as [x0,y0,x1,y1,...]. Returns the event bitmask.
 * @param {Float32Array} buf Float32Array of NPC_BUFFER_SLOTS.
 * @param {ArrayLike<number>} flat Path as [x0,y0,x1,y1,...].
 * @param {number} phraseCount
 * @param {number} dt Tick delta in seconds.
 * @param {number} [slot] NPC buffer slot index.
 * @returns {number} Event bitmask.
 */
export function stepNpcBuffer(buf, flat, phraseCount, dt, slot = 0) {
  if (wasmSimInstance && typeof wasmSimInstance.step_npc_buffer === 'function') {
    try {
      // Wasm authority uses the 2-arg signature: step_npc_buffer(slot, dt).
      // `slot` is the NPC buffer slot index; `dt` is the tick delta in seconds.
      const resolvedSlot = Number.isFinite(slot) ? (slot | 0) : 0;
      return wasmSimInstance.step_npc_buffer(resolvedSlot, dt) >>> 0;
    } catch {
      // Fall through to the JS fallback on any Wasm-side error.
    }
  }
  return stepNpcBufferJs(buf, flat, phraseCount | 0, dt) >>> 0;
}

// --- Enum mapping helpers (mirror dog_contract.rs) -------------------------------------------

/**
 * Maps a DogStateId numeric id to the JS dog state string.
 * @param {number} id
 * @param {boolean} [isOnLeash]
 * @returns {string}
 */
export function dogStateIdToState(id, isOnLeash = false) {
  switch (id | 0) {
    case 0: return isOnLeash ? 'FOLLOWING' : 'IDLE_SNIFF';
    case 1: return 'FOLLOWING';
    case 2: return 'ROAMING';
    case 3: return 'POOPING';
    case 4: return 'FETCHING';
    case 5: return 'SOCIAL_GREET';
    case 6: return 'ZOOMIES';
    case 7: return 'LYING_DOWN';
    case 8: return 'LOST';
    case 9: return 'RECALLED';
    case 10: return 'BARKING';
    case 11: return 'SNIFFING_TRAIL';
    default: return 'IDLE_SNIFF';
  }
}

/**
 * Maps a JS dog state string to its DogStateId numeric id.
 * @param {string} state
 * @returns {number}
 */
export function dogStateToId(state) {
  switch (state) {
    case 'FOLLOWING': return 1;
    case 'ROAMING': return 2;
    case 'POOPING': return 3;
    case 'FETCHING': return 4;
    case 'SOCIAL_GREET': return 5;
    case 'PACK_PLAY': return 5;
    case 'ZOOMIES': return 6;
    case 'LYING_DOWN': return 7;
    case 'SITTING': return 7;
    case 'ROLLING': return 7;
    case 'LOST': return 8;
    case 'RECALLED': return 9;
    case 'BARKING': return 10;
    case 'SNIFFING_TRAIL': return 11;
    case 'IDLE_SNIFF': return 0;
    default: return 0;
  }
}

/**
 * Maps a RoamSubModeId numeric id to the JS roam sub-mode string.
 * @param {number} id
 * @returns {string}
 */
export function roamSubModeIdToSubMode(id) {
  switch (id | 0) {
    case 0: return 'FREE_EXPLORE';
    case 1: return 'FREE_EXPLORE';
    case 2: return 'SCOUT_AHEAD';
    case 3: return 'LAG_AND_SNIFF';
    case 4: return 'CHECK_IN';
    case 5: return 'FLANK_PACE';
    case 6: return 'FLANK_PACE';
    case 7: return 'FLANK_PACE';
    default: return 'FREE_EXPLORE';
  }
}

/**
 * Maps a ZoomiePathId numeric id to the JS zoomie path string (null for None).
 * @param {number} id
 * @returns {string | null}
 */
export function zoomiePathIdToPath(id) {
  switch (id | 0) {
    case 0: return null;
    case 1: return 'FIGURE_EIGHT';
    case 2: return 'ORBIT_OWNER';
    case 3: return 'SHUTTLE';
    default: return null;
  }
}

/**
 * Maps a GaitModeId numeric id to the JS gait mode string.
 * @param {number} id
 * @returns {string}
 */
export function gaitModeIdToMode(id) {
  switch (id | 0) {
    case 0: return 'IDLE';
    case 1: return 'WALK';
    case 2: return 'TROT';
    case 3: return 'GALLOP';
    default: return 'IDLE';
  }
}

/**
 * Narrows a possibly-undefined numeric value to a finite number, defaulting to 0.
 * @param {number | undefined | null} v
 * @returns {number}
 */
function finiteOrZero(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function normalizeTrait(v) {
  const n = (Number(v) - 1) / 4;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function writePoint(buf, base, x, y) {
  buf[base] = Number.isFinite(x) ? x : NaN;
  buf[base + 1] = Number.isFinite(y) ? y : NaN;
}

// Owner gait string -> numeric gait id (owner gait vocabulary, not GaitModeId).
const OWNER_GAIT_IDS = {
  STAND: 0,
  STROLL: 1,
  WALK: 2,
  JOG: 3,
  WANDER: 4,
};

/**
 * Resolves the owner's numeric gait id. Prefers a numeric `owner.gaitId`, then a numeric
 * `owner.gait`, then maps the string `owner.gait` ('STAND'|'STROLL'|'WALK'|'JOG'|'WANDER').
 * Defaults to 0 (STAND) when unknown.
 */
function ownerGaitToId(owner) {
  if (!owner) return 0;
  if (Number.isFinite(owner.gaitId)) return owner.gaitId;
  if (Number.isFinite(owner.gait)) return owner.gait;
  if (typeof owner.gait === 'string') {
    const id = OWNER_GAIT_IDS[owner.gait.toUpperCase()];
    if (Number.isFinite(id)) return id;
  }
  return 0;
}

/**
 * Steps the companion dog through the Wasm authority buffer. Writes inputs [0..63], calls
 * step_dog_buffer(), hydrates outputs [64..127] onto `dog`, and returns the event bitmask.
 * @param {DogLike} dog
 * @param {number} dt
 * @param {FieldLike | null} field
 * @param {DogLike[]} otherDogs
 * @param {BallLike | null} activeBall
 * @param {NpcLike[]} npcs
 * @returns {number} Event bitmask.
 */
export function stepCompanionDogWasm(dog, dt, field, otherDogs, activeBall, npcs) {
  if (!wasmSimInstance) {
    throw new Error('Wasm sim not initialized');
  }
  const buf = getDogBufferView();

  const owner = dog && dog.owner ? dog.owner : null;
  const isOnLeash = Boolean((dog && dog.isOnLeash) || (owner && owner.isLeashed));
  const nowSec = (dog && dog.nowSec != null)
    ? dog.nowSec
    : ((typeof performance !== 'undefined' && performance.now)
      ? performance.now() / 1000
      : Date.now() / 1000);

  // Inputs [0..63]
  buf[WASM_CONSTANTS.dog.DOG_BUF_DT] = dt;
  buf[WASM_CONSTANTS.dog.DOG_BUF_NOW_SEC] = nowSec;
  buf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_X] = finiteOrZero(owner && owner.x);
  buf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_Y] = finiteOrZero(owner && owner.y);
  buf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_VX] = finiteOrZero(owner && owner.vx);
  buf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_VY] = finiteOrZero(owner && owner.vy);
  const ownerHeading = owner
    ? (typeof owner.angle === 'number' && Number.isFinite(owner.angle)
      ? owner.angle
      : finiteOrZero(owner.heading))
    : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_HEADING] = ownerHeading;
  buf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_HALF_WIDTH] = finiteOrZero(owner && owner.halfWidth);
  buf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_GAIT_ID] = ownerGaitToId(owner);
  buf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_IS_MOVING] = owner && owner.isMoving ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_IS_ON_LEASH] = isOnLeash ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_PREFERRED_SIDE_SIGN] = (dog && dog.preferredSide === 'right') ? 1 : -1;
  const store = (dog && dog.dogStateStore) ? dog.dogStateStore : null;
  const isHungry = store && store.isHungry != null
    ? (typeof store.isHungry === 'function' ? store.isHungry() : store.isHungry)
    : (dog && dog.isHungry);
  const needsGrooming = store && store.needsGrooming != null
    ? (typeof store.needsGrooming === 'function' ? store.needsGrooming() : store.needsGrooming)
    : (dog && dog.needsGrooming);
  const isTired = store && store.isTired != null
    ? (typeof store.isTired === 'function' ? store.isTired() : store.isTired)
    : (dog && dog.isTired);
  buf[WASM_CONSTANTS.dog.DOG_BUF_IS_HUNGRY] = isHungry ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_NEEDS_GROOMING] = needsGrooming ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_IS_TIRED] = isTired ? 1 : 0;
  const ball = (activeBall != null) ? activeBall : (dog && dog.activeBall ? dog.activeBall : null);
  const ballInPlay = Boolean(ball && (ball.isThrown || (!ball.inOwnerPossession && !ball.isCarried)));
  const dogCarryingBall = Boolean(dog && dog.hasBall);
  buf[WASM_CONSTANTS.dog.DOG_BUF_BALL_ACTIVE] = (ballInPlay || dogCarryingBall) ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_BALL_IS_THROWN] = ball && ball.isThrown ? 1 : 0;
  if (dogCarryingBall && owner) {
    buf[WASM_CONSTANTS.dog.DOG_BUF_BALL_X] = finiteOrZero(owner.x);
    buf[WASM_CONSTANTS.dog.DOG_BUF_BALL_Y] = finiteOrZero(owner.y);
  } else {
    buf[WASM_CONSTANTS.dog.DOG_BUF_BALL_X] = finiteOrZero(ball && ball.x);
    buf[WASM_CONSTANTS.dog.DOG_BUF_BALL_Y] = finiteOrZero(ball && ball.y);
  }
  /** @type {{ active?: boolean, left?: number, top?: number, right?: number, bottom?: number } | null} */
  const cam = (field && field.camera) ? field.camera : ((dog && dog.camera) ? dog.camera : null);
  buf[WASM_CONSTANTS.dog.DOG_BUF_CAM_ACTIVE] = cam && cam.active ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_CAM_LEFT] = finiteOrZero(cam && cam.left);
  buf[WASM_CONSTANTS.dog.DOG_BUF_CAM_TOP] = finiteOrZero(cam && cam.top);
  buf[WASM_CONSTANTS.dog.DOG_BUF_CAM_RIGHT] = finiteOrZero(cam && cam.right);
  buf[WASM_CONSTANTS.dog.DOG_BUF_CAM_BOTTOM] = finiteOrZero(cam && cam.bottom);
  const isSunny = field
    ? (field.isSunny ?? field.zoneConfig?.sunny ?? field.zoneIsSunny)
    : false;
  buf[WASM_CONSTANTS.dog.DOG_BUF_ZONE_IS_SUNNY] = isSunny ? 1 : 0;
  const personality = (dog && dog.personality) ? dog.personality : {};
  buf[WASM_CONSTANTS.dog.DOG_BUF_CURIOSITY] = normalizeTrait(personality.curiosity ?? 3);
  buf[WASM_CONSTANTS.dog.DOG_BUF_ENERGY] = normalizeTrait(personality.energy ?? 3);
  buf[WASM_CONSTANTS.dog.DOG_BUF_STUBBORNNESS] = normalizeTrait(personality.stubbornness ?? 2);
  buf[WASM_CONSTANTS.dog.DOG_BUF_LOYALTY] = normalizeTrait(personality.loyalty ?? 4);
  const cmds = (dog && dog.pendingCommands) ? dog.pendingCommands : null;
  buf[WASM_CONSTANTS.dog.DOG_BUF_CMD_WHISTLE_RECALL] = cmds && cmds.whistleRecall ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_CMD_PET] = cmds && cmds.pet ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_CMD_PRAISE] = cmds && cmds.praise ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_CMD_BARK] = cmds && cmds.bark ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_CMD_TRIGGER_ZOOMIES] = cmds && cmds.triggerZoomies ? 1 : 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_CMD_FETCH_BALL] = cmds && cmds.fetchBall ? 1 : 0;

  // Peers [38..45], NPCs [46..53], scents [54..61]
  const peers = Array.isArray(otherDogs) ? otherDogs.filter((p) => p && p !== dog) : [];
  const peerCount = Math.min(4, peers.length);
  buf[WASM_CONSTANTS.dog.DOG_BUF_PEER_COUNT] = peerCount;
  for (let i = 0; i < 4; i++) {
    const p = i < peerCount ? peers[i] : null;
    writePoint(buf, WASM_CONSTANTS.dog.DOG_BUF_PEER0_X + i * 2, p ? p.x : NaN, p ? p.y : NaN);
  }

  const npcList = Array.isArray(npcs) ? npcs : [];
  const npcCount = Math.min(4, npcList.length);
  buf[WASM_CONSTANTS.dog.DOG_BUF_NPC_COUNT] = npcCount;
  for (let i = 0; i < 4; i++) {
    const n = i < npcCount ? npcList[i] : null;
    writePoint(buf, WASM_CONSTANTS.dog.DOG_BUF_NPC0_X + i * 2, n ? n.x : NaN, n ? n.y : NaN);
  }

  const scents = (dog && Array.isArray(dog.scents)) ? dog.scents : [];
  const scentCount = Math.min(4, scents.length);
  buf[WASM_CONSTANTS.dog.DOG_BUF_SCENT_COUNT] = scentCount;
  for (let i = 0; i < 4; i++) {
    const s = i < scentCount ? scents[i] : null;
    writePoint(buf, WASM_CONSTANTS.dog.DOG_BUF_SCENT0_X + i * 2, s ? s.x : NaN, s ? s.y : NaN);
  }

  // Seed persistent dog state slots [64..69] so the sim continues from the JS state.
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_X] = finiteOrZero(dog.x);
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_Y] = finiteOrZero(dog.y);
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_VX] = finiteOrZero(dog.vx);
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_VY] = finiteOrZero(dog.vy);
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_ANGLE] = finiteOrZero(dog.angle);
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_STATE_ID] = dogStateToId(dog.state || '');

  // Step the authoritative simulation.
  wasmSimInstance.step_dog_buffer();

  // Re-acquire the view in case memory.grow detached the previous buffer.
  const outBuf = getDogBufferView();

  // Clear pending commands only after a successful step.
  if (cmds) {
    cmds.whistleRecall = false;
    cmds.pet = false;
    cmds.praise = false;
    cmds.bark = false;
    cmds.triggerZoomies = false;
    cmds.fetchBall = false;
  }

  // Outputs [64..127]
  dog.x = outBuf[WASM_CONSTANTS.dog.DOG_BUF_DOG_X];
  dog.y = outBuf[WASM_CONSTANTS.dog.DOG_BUF_DOG_Y];
  dog.vx = outBuf[WASM_CONSTANTS.dog.DOG_BUF_DOG_VX];
  dog.vy = outBuf[WASM_CONSTANTS.dog.DOG_BUF_DOG_VY];
  dog.angle = outBuf[WASM_CONSTANTS.dog.DOG_BUF_DOG_ANGLE];
  dog.state = dogStateIdToState(outBuf[WASM_CONSTANTS.dog.DOG_BUF_DOG_STATE_ID], isOnLeash);
  dog.roamSubMode = roamSubModeIdToSubMode(outBuf[WASM_CONSTANTS.dog.DOG_BUF_ROAM_SUBMODE_ID]);
  const zoomiePathId = outBuf[WASM_CONSTANTS.dog.DOG_BUF_ZOOMIE_PATH_ID] | 0;
  if (zoomiePathId !== 0) {
    dog.zoomiesPath = zoomiePathIdToPath(zoomiePathId);
  } else if (!dog.zoomiesPath) {
    dog.zoomiesPath = 'FIGURE_EIGHT';
  }
  dog.gaitMode = gaitModeIdToMode(outBuf[WASM_CONSTANTS.dog.DOG_BUF_GAIT_MODE_ID]);
  // DOG_BUF_GAIT_PHASE is normalized in [0.0, 1.0); CompanionDog.draw() feeds gaitPhase
  // directly into Math.sin(), which expects radians in [0, 2*PI).
  dog.gaitPhase = outBuf[WASM_CONSTANTS.dog.DOG_BUF_GAIT_PHASE] * Math.PI * 2;
  // DOG_BUF_ZOOMIES_TIMER: live Wasm zoomies countdown for JS UI/snapshots.
  dog.zoomiesTimer = outBuf[WASM_CONSTANTS.dog.DOG_BUF_ZOOMIES_TIMER];

  dog.leftEar = dog.leftEar || {};
  dog.leftEar.angle = outBuf[WASM_CONSTANTS.dog.DOG_BUF_LEFT_EAR_ANGLE];
  dog.leftEar.vel = outBuf[WASM_CONSTANTS.dog.DOG_BUF_LEFT_EAR_VEL];
  dog.rightEar = dog.rightEar || {};
  dog.rightEar.angle = outBuf[WASM_CONSTANTS.dog.DOG_BUF_RIGHT_EAR_ANGLE];
  dog.rightEar.vel = outBuf[WASM_CONSTANTS.dog.DOG_BUF_RIGHT_EAR_VEL];
  dog.wagSpeed = outBuf[WASM_CONSTANTS.dog.DOG_BUF_WAG_SPEED];
  dog.tailAngle = outBuf[WASM_CONSTANTS.dog.DOG_BUF_TAIL_ANGLE];
  dog.noseTwitch = outBuf[WASM_CONSTANTS.dog.DOG_BUF_NOSE_TWITCH];
  dog.targetSlot = isOnLeash
    ? { x: outBuf[WASM_CONSTANTS.dog.DOG_BUF_TARGET_SLOT_X], y: outBuf[WASM_CONSTANTS.dog.DOG_BUF_TARGET_SLOT_Y] }
    : null;

  const leashFlags = outBuf[WASM_CONSTANTS.dog.DOG_BUF_LEASH_FLAGS] | 0;
  dog.isPullingLeash = (leashFlags & 1) !== 0;
  dog.leashTension = outBuf[WASM_CONSTANTS.dog.DOG_BUF_LEASH_TENSION];
  dog.leashSagPx = outBuf[WASM_CONSTANTS.dog.DOG_BUF_LEASH_SAG_PX];
  dog.leashVibrationPx = outBuf[WASM_CONSTANTS.dog.DOG_BUF_LEASH_VIBRATION_PX];
  dog.ownerClampedX = outBuf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_CLAMPED_X];
  dog.ownerClampedY = outBuf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_CLAMPED_Y];
  const ownerFlags = outBuf[WASM_CONSTANTS.dog.DOG_BUF_OWNER_FLAGS] | 0;
  dog.ownerWasClamped = (ownerFlags & 1) !== 0;
  dog.ownerFrozen = (ownerFlags & 2) !== 0;

  return outBuf[WASM_CONSTANTS.dog.DOG_BUF_EVENT_BITMASK] | 0;
}

/**
 * Mirrors the dog's on-leash flag into the persistent Wasm dog buffer input slot (index 10) so
 * the authoritative sim sees the current leash state even when the JS-side toggle happens
 * outside a normal step. Returns true when the buffer was updated.
 * @param {boolean} isOnLeash
 * @returns {boolean} True when the buffer was updated.
 */
export function syncDogLeashToWasm(isOnLeash) {
  let buf = null;
  try {
    buf = getDogBufferView();
  } catch {
    return false;
  }
  if (!buf) return false;
  if (buf[WASM_CONSTANTS.dog.DOG_BUF_DT] <= 0) buf[WASM_CONSTANTS.dog.DOG_BUF_DT] = 1 / 60;
  buf[WASM_CONSTANTS.dog.DOG_BUF_IS_ON_LEASH] = isOnLeash ? 1 : 0;
  return true;
}

/**
 * Mirrors a teleported dog position into the persistent Wasm dog buffer so `owner_sim.rs` and
 * `dog_utility_ai.rs` do not see stale pre-warp dog coordinates (which caused the on-leash clamp
 * to yank the owner back to the old zone). Returns true when the buffer was updated.
 * @param {number} x
 * @param {number} y
 * @returns {boolean} True when the buffer was updated.
 */
export function syncDogPositionToWasm(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let buf = null;
  try {
    buf = getDogBufferView();
  } catch {
    return false;
  }
  if (!buf) return false;
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_X] = x;
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_Y] = y;
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_VX] = 0;
  buf[WASM_CONSTANTS.dog.DOG_BUF_DOG_VY] = 0;
  return true;
}

/**
 * Steps both ear springs (Wasm authority, exact JS fallback).
 * @param {{ angle?: number, vel?: number, v?: number } | null} leftEar
 * @param {{ angle?: number, vel?: number, v?: number } | null} rightEar
 * @param {number} dogVx
 * @param {number} dogVy
 * @param {number} dogAngle
 * @param {number} dt
 * @returns {void}
 */
export function stepEarSprings(leftEar, rightEar, dogVx, dogVy, dogAngle, dt) {
  if (wasmSimInstance && typeof wasmSimInstance.step_ears === 'function') {
    const lAngle = leftEar ? (leftEar.angle || 0) : 0;
    const lVel = leftEar ? (leftEar.vel ?? leftEar.v ?? 0) : 0;
    const rAngle = rightEar ? (rightEar.angle || 0) : 0;
    const rVel = rightEar ? (rightEar.vel ?? rightEar.v ?? 0) : 0;
    const res = wasmSimInstance.step_ears(
      lAngle, lVel,
      rAngle, rVel,
      dogVx, dogVy, dogAngle, dt
    );
    if (leftEar) {
      leftEar.angle = res[0];
      if ('vel' in leftEar) leftEar.vel = res[1];
      if ('v' in leftEar) leftEar.v = res[1];
    }
    if (rightEar) {
      rightEar.angle = res[2];
      if ('vel' in rightEar) rightEar.vel = res[3];
      if ('v' in rightEar) rightEar.v = res[3];
    }
    return;
  }

  // JS Fallback
  const springK = 180.0;
  const damping = 14.0;
  const forwardSpeed = dogVx * Math.cos(dogAngle) + dogVy * Math.sin(dogAngle);
  const targetOffset = Math.max(-0.4, Math.min(0.4, forwardSpeed * 0.003));

  if (leftEar) {
    const lAngle = leftEar.angle || 0;
    const lVel = leftEar.vel ?? leftEar.v ?? 0;
    const leftForce = -springK * (lAngle - targetOffset) - damping * lVel;
    const newLVel = lVel + leftForce * dt;
    leftEar.angle = lAngle + newLVel * dt;
    if ('vel' in leftEar) leftEar.vel = newLVel;
    if ('v' in leftEar) leftEar.v = newLVel;
  }
  if (rightEar) {
    const rAngle = rightEar.angle || 0;
    const rVel = rightEar.vel ?? rightEar.v ?? 0;
    const rightForce = -springK * (rAngle - targetOffset) - damping * rVel;
    const newRVel = rVel + rightForce * dt;
    rightEar.angle = rAngle + newRVel * dt;
    if ('vel' in rightEar) rightEar.vel = newRVel;
    if ('v' in rightEar) rightEar.v = newRVel;
  }
}

/**
 * Applies the leash constraint to the dog (Wasm authority, exact JS fallback).
 * @param {{ x: number, y: number, vx: number, vy: number }} dog
 * @param {{ x: number, y: number }} owner
 * @param {number} maxLength
 * @param {number} stiffness
 * @param {number} damping
 * @param {number} dt
 * @returns {boolean} True when the leash is taut.
 */
export function stepLeashConstraint(dog, owner, maxLength, stiffness, damping, dt) {
  if (wasmSimInstance) {
    const res = wasmSimInstance.step_leash(
      dog.x, dog.y, dog.vx, dog.vy,
      owner.x, owner.y,
      maxLength, stiffness, damping, dt
    );
    dog.x = res[0];
    dog.y = res[1];
    dog.vx = res[2];
    dog.vy = res[3];
    return res[4] > 0.5;
  }

  // JS Fallback
  const dx = dog.x - owner.x;
  const dy = dog.y - owner.y;
  const dist = Math.hypot(dx, dy);

  if (dist > maxLength && dist > 1e-6) {
    const excess = dist - maxLength;
    const nx = dx / dist;
    const ny = dy / dist;

    const springForce = excess * stiffness;
    dog.vx -= nx * springForce * dt;
    dog.vy -= ny * springForce * dt;

    const radialV = dog.vx * nx + dog.vy * ny;
    if (radialV > 0) {
      dog.vx -= nx * radialV * damping * dt;
      dog.vy -= ny * radialV * damping * dt;
    }

    if (excess > 40) {
      dog.x = owner.x + nx * (maxLength + 40);
      dog.y = owner.y + ny * (maxLength + 40);
    }
    return true;
  }
  return false;
}

/**
 * Resolves a circle entity against world bounds and colliders (Wasm authority, JS fallback).
 * @param {{ x: number, y: number }} entity
 * @param {number} radius
 * @param {number} worldW
 * @param {number} worldH
 * @param {{ x: number, y: number, r: number }[]} [colliders]
 * @returns {void}
 */
export function resolveWorldCollision(entity, radius, worldW, worldH, colliders = []) {
  if (wasmSimInstance) {
    const res = wasmSimInstance.resolve_collision(entity.x, entity.y, radius);
    entity.x = res[0];
    entity.y = res[1];
    return;
  }

  // JS Fallback
  const margin = 36 + radius;
  entity.x = Math.max(margin, Math.min(worldW - margin, entity.x));
  entity.y = Math.max(margin, Math.min(worldH - margin, entity.y));

  for (const c of colliders) {
    const dx = entity.x - c.x;
    const dy = entity.y - c.y;
    const dist = Math.hypot(dx, dy);
    const minD = radius + c.r;
    if (dist < minD && dist > 1e-6) {
      const overlap = minD - dist;
      entity.x += (dx / dist) * overlap;
      entity.y += (dy / dist) * overlap;
    }
  }

  entity.x = Math.max(margin, Math.min(worldW - margin, entity.x));
  entity.y = Math.max(margin, Math.min(worldH - margin, entity.y));
}

/**
 * Samples an NPC's state along a waypoint path at time `now` (Wasm authority, JS fallback).
 * @param {number[][]} waypoints
 * @param {number} speed
 * @param {number} spawnTime
 * @param {number} now
 * @returns {{ x: number, y: number, vx: number, vy: number, angle: number, walkPhase: number, opacity: number, finished: boolean }}
 */
export function sampleNpcState(waypoints, speed, spawnTime, now) {
  if (wasmSimInstance && waypoints && waypoints.length >= 2) {
    const flat = [];
    for (const pt of waypoints) {
      flat.push(pt[0], pt[1]);
    }
    const res = wasmSimInstance.sample_npc(new Float64Array(flat), speed, spawnTime, now);
    return {
      x: res[0],
      y: res[1],
      vx: res[2],
      vy: res[3],
      angle: res[4],
      walkPhase: res[5],
      opacity: res[6],
      finished: res[7] > 0.5
    };
  }

  // JS Fallback
  const tNow = (now > 1e10) ? now / 1000 : now;
  const tSpawn = (spawnTime > 1e10) ? spawnTime / 1000 : spawnTime;
  const elapsed = Math.max(0, tNow - tSpawn);
  const distance = elapsed * speed;

  let totalLen = 0;
  const cumDist = [0];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = Math.hypot(waypoints[i + 1][0] - waypoints[i][0], waypoints[i + 1][1] - waypoints[i][1]);
    totalLen += d;
    cumDist.push(totalLen);
  }

  if (distance >= totalLen) {
    const last = waypoints[waypoints.length - 1];
    return {
      x: last[0],
      y: last[1],
      vx: 0,
      vy: 0,
      angle: 0,
      walkPhase: totalLen * 0.1,
      opacity: 0,
      finished: true
    };
  }

  let segIdx = 0;
  while (segIdx < cumDist.length - 2 && cumDist[segIdx + 1] <= distance) {
    segIdx++;
  }

  const p0 = waypoints[segIdx];
  const p1 = waypoints[segIdx + 1];
  const segLen = Math.max(1e-6, cumDist[segIdx + 1] - cumDist[segIdx]);
  const segDist = distance - cumDist[segIdx];
  const frac = Math.max(0, Math.min(1, segDist / segLen));

  const x = p0[0] + (p1[0] - p0[0]) * frac;
  const y = p0[1] + (p1[1] - p0[1]) * frac;
  const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);

  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    walkPhase: distance * 0.08,
    opacity: 1.0,
    finished: false
  };
}


// ---------------------------------------------------------------------------------------------
// Authoritative simulation helpers (dog_walker_core). Every helper has a behaviourally
// identical JS fallback used when Wasm is unavailable (headless tests, load failure) or when
// the world data has not been uploaded yet.
// ---------------------------------------------------------------------------------------------

/**
 * Uploads the exact field obstacle set to the Wasm sim so `resolveFieldCollision` can delegate.
 * Safe to call repeatedly (e.g. after the field is rebuilt). Returns true when Wasm is active.
 * @param {FieldLike | null} field
 * @returns {boolean} True when Wasm is active and the upload succeeded.
 */
export function syncWorldObstacles(field) {
  worldObstaclesReady = false;
  if (!wasmSimInstance || !field || typeof wasmSimInstance.set_world_obstacles !== 'function') return false;
  if (typeof field.getWorldObstacles !== 'function') return false;
  if (field.width !== simWorldWidth || field.height !== simWorldHeight) return false;
  try {
    worldObstaclesReady = wasmSimInstance.set_world_obstacles(JSON.stringify(field.getWorldObstacles())) === true;
  } catch {
    worldObstaclesReady = false;
  }
  return worldObstaclesReady;
}

/**
 * @returns {boolean} True once the field obstacle set has been uploaded to the Wasm sim.
 */
export function isWorldObstaclesReady() {
  return worldObstaclesReady;
}

/**
 * Resolves a circle entity against the field (Wasm authority, `field.resolveCircleCollision` fallback).
 * @param {{ x: number, y: number }} entity
 * @param {number} radius
 * @param {FieldLike | null} field
 * @returns {void}
 */
export function resolveFieldCollision(entity, radius, field) {
  if (wasmSimInstance && worldObstaclesReady && typeof wasmSimInstance.resolve_field_collision === 'function') {
    const res = wasmSimInstance.resolve_field_collision(entity.x, entity.y, radius);
    entity.x = res[0];
    entity.y = res[1];
    return;
  }
  if (field) {
    const resolved = /** @type {{ resolveCircleCollision: (x: number, y: number, r: number) => { x: number, y: number } }} */ (field)
      .resolveCircleCollision(entity.x, entity.y, radius);
    entity.x = resolved.x;
    entity.y = resolved.y;
  }
}

/**
 * Integrates both ear springs towards JS-computed targets (Wasm authority, exact JS fallback).
 * @param {{ angle: number, vel: number }} leftEar
 * @param {{ angle: number, vel: number }} rightEar
 * @param {number} targetLeft
 * @param {number} targetRight
 * @param {number} springK
 * @param {number} springDamp
 * @param {number} dt
 * @returns {void}
 */
export function stepEarSpringsToTargets(leftEar, rightEar, targetLeft, targetRight, springK, springDamp, dt) {
  if (wasmSimInstance && typeof wasmSimInstance.step_ear_targets === 'function') {
    const res = wasmSimInstance.step_ear_targets(
      leftEar.angle, leftEar.vel,
      rightEar.angle, rightEar.vel,
      targetLeft, targetRight,
      springK, springDamp, dt
    );
    leftEar.angle = res[0];
    leftEar.vel = res[1];
    rightEar.angle = res[2];
    rightEar.vel = res[3];
    return;
  }
  const leftForce = -springK * (leftEar.angle - targetLeft) - springDamp * leftEar.vel;
  leftEar.vel += leftForce * dt;
  leftEar.angle += leftEar.vel * dt;

  const rightForce = -springK * (rightEar.angle - targetRight) - springDamp * rightEar.vel;
  rightEar.vel += rightForce * dt;
  rightEar.angle += rightEar.vel * dt;
}

/**
 * One 2.5D tennis-ball ballistic step (gravity, bounce, rolling friction, world-edge bounce).
 * `ball` needs x,y,z,vx,vy,vz,gravity,restitution,friction. Wasm authority only when the ball
 * uses the default TennisBall tuning (so custom-tuned balls keep exact JS behaviour).
 * @param {{ x: number, y: number, z: number, vx: number, vy: number, vz: number, gravity: number, restitution: number, friction: number }} ball
 * @param {number} dt
 * @param {{ width: number, height: number } | null} field
 * @returns {void}
 */
export function stepToyBall(ball, dt, field) {
  const usesDefaults = ball.gravity === 720 && ball.restitution === 0.62 && ball.friction === 0.94;
  if (wasmSimInstance && field && usesDefaults && typeof wasmSimInstance.step_toy_ball === 'function') {
    const res = wasmSimInstance.step_toy_ball(
      ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz, dt, field.width, field.height
    );
    ball.x = res[0];
    ball.y = res[1];
    ball.z = res[2];
    ball.vx = res[3];
    ball.vy = res[4];
    ball.vz = res[5];
    return;
  }

  // JS Fallback (exact original TennisBall.update ballistics)
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.vz -= ball.gravity * dt;
  ball.z += ball.vz * dt;

  if (ball.z <= 0) {
    ball.z = 0;
    if (Math.abs(ball.vz) > 40) {
      ball.vz = -ball.vz * ball.restitution;
      ball.vx *= 0.82;
      ball.vy *= 0.82;
    } else {
      ball.vz = 0;
      ball.vx *= Math.pow(ball.friction, dt * 60);
      ball.vy *= Math.pow(ball.friction, dt * 60);
    }
  }

  if (field) {
    const minX = 70;
    const maxX = field.width - 70;
    const minY = 70;
    const maxY = field.height - 70;
    if (ball.x < minX) { ball.x = minX; ball.vx = -ball.vx * 0.7; }
    if (ball.x > maxX) { ball.x = maxX; ball.vx = -ball.vx * 0.7; }
    if (ball.y < minY) { ball.y = minY; ball.vy = -ball.vy * 0.7; }
    if (ball.y > maxY) { ball.y = maxY; ball.vy = -ball.vy * 0.7; }
  }
}

/**
 * Samples the in-progress part of an NPC polyline path (exact port of the interpolating branch
 * of ParkNPC.setClock). `flat` = Float64Array/array [x0,y0,x1,y1,...]. Returns
 * {x,y,vx,vy,angle,hasAngle}. Wasm authority with exact JS fallback.
 * @param {number[] | Float64Array} flat Path as [x0,y0,x1,y1,...].
 * @param {number} speed
 * @param {number} distance
 * @returns {{ x: number, y: number, vx: number, vy: number, angle: number, hasAngle: boolean }}
 */
export function sampleNpcPath(flat, speed, distance) {
  if (wasmSimInstance && typeof wasmSimInstance.sample_npc_path === 'function') {
    const res = wasmSimInstance.sample_npc_path(flat, speed, distance);
    return { x: res[0], y: res[1], vx: res[2], vy: res[3], angle: res[4], hasAngle: res[5] > 0.5 };
  }

  const n = Math.floor(flat.length / 2);
  const segLens = [];
  for (let i = 0; i < n - 1; i++) {
    segLens.push(Math.hypot(flat[2 * i + 2] - flat[2 * i], flat[2 * i + 3] - flat[2 * i + 1]));
  }
  let accumulated = 0;
  let interpolated = false;
  let x = flat[0];
  let y = flat[1];
  let dx = 0;
  let dy = 0;
  let segLen = 0;
  let activeIndex = -1;
  let activeRemaining = 0;

  for (let i = 0; i < segLens.length; i++) {
    segLen = segLens[i];
    if (accumulated + segLen >= distance) {
      const remaining = distance - accumulated;
      const segT = segLen > 0.000001 ? (remaining / segLen) : 0;
      dx = flat[2 * i + 2] - flat[2 * i];
      dy = flat[2 * i + 3] - flat[2 * i + 1];
      x = flat[2 * i] + dx * segT;
      y = flat[2 * i + 1] + dy * segT;
      interpolated = true;
      activeIndex = i;
      activeRemaining = remaining;
      break;
    }
    accumulated += segLen;
  }

  if (!interpolated && n >= 2) {
    const lastIdx = n - 2;
    dx = flat[2 * lastIdx + 2] - flat[2 * lastIdx];
    dy = flat[2 * lastIdx + 3] - flat[2 * lastIdx + 1];
    segLen = segLens[lastIdx] || 0;
    x = flat[2 * lastIdx + 2];
    y = flat[2 * lastIdx + 3];
    activeIndex = lastIdx;
    activeRemaining = segLen;
  }

  let angle = 0;
  let hasAngle = false;
  if (Math.hypot(dx, dy) > 0.000001) {
    const segAngle = Math.atan2(dy, dx);
    const distToNext = segLen - activeRemaining;
    if (activeIndex >= 0 && activeIndex + 1 < segLens.length && distToNext < 25.0) {
      const nextAngle = Math.atan2(
        flat[2 * activeIndex + 5] - flat[2 * activeIndex + 3],
        flat[2 * activeIndex + 4] - flat[2 * activeIndex + 2]
      );
      let angleDiff = nextAngle - segAngle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      const blendFactor = Math.max(0, Math.min(0.5, (1.0 - distToNext / 25.0) * 0.5));
      angle = segAngle + angleDiff * blendFactor;
    } else {
      angle = segAngle;
    }
    hasAngle = true;
  }
  return {
    x,
    y,
    vx: segLen > 0.000001 ? (dx / segLen) * speed : 0,
    vy: segLen > 0.000001 ? (dy / segLen) * speed : 0,
    angle,
    hasAngle
  };
}
