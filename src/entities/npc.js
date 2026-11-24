// Ambient Park NPC Entities (Walkers & Joggers) for The Downs
// Implements deterministic polyline traversal, finite lifecycle fading, italic nametags, and seeded speech timelines

import {
  mulberry32,
  NPC_SPEED,
  NPC_TAG_STYLE,
  npcIdentityFromSeed,
  pickPhrase,
  nextSpeechDelay,
  COMMON_PHRASES,
  ODD_PHRASES
} from './npc_content.js';
import { getNpcPath, NPC_PATHS } from '../world/npc_paths.js';
import {
  getBufferView,
  getWasmSim,
  sampleNpcPath,
  NPC_SLOT_STATE,
  NPC_SLOT_X,
  NPC_SLOT_Y,
  NPC_SLOT_HEADING_RAD,
  NPC_SLOT_SPEED_SCALE,
  NPC_SLOT_OPACITY,
  NPC_SLOT_DONE,
  NPC_SLOT_IS_FINISHED_STATE,
  NPC_SLOT_SPEECH_VISIBLE,
  NPC_SLOT_SPEECH_PHRASE_ID,
  NPC_SLOT_CMD_FLAGS,
  NPC_SLOT_SEED,
  NPC_SLOT_RNG_STATE,
  NPC_SLOT_NEXT_SPEECH_DELAY_S,
  NPC_SLOT_FADE_COMPLETED,
  NPC_CMD_RESET,
  NPC_CMD_PAUSE,
  NPC_CMD_RESUME,
  NPC_CMD_SET_WALKING,
  NPC_CMD_SET_RUNNING,
  NPC_CMD_FORCE_SPEECH,
  NPC_EVENT_RESET,
  NPC_EVENT_PAUSED,
  NPC_EVENT_RESUMED,
  NPC_EVENT_STATE_CHANGED,
  NPC_EVENT_SPEECH_TRIGGERED,
  NPC_EVENT_SPEECH_HIDDEN,
  NPC_EVENT_PATH_FINISHED,
  NPC_EVENT_FADE_STARTED,
  NPC_EVENT_FADE_COMPLETED,
  NPC_EVENT_CMD_REJECTED,
  NPC_BUFFER_SLOTS,
  NPC_SPEECH_BASE_DELAY_S,
  NPC_STATE_WALKING,
  NPC_STATE_RUNNING,
  NPC_STATE_PAUSED
} from '../engine/wasm_sim_bridge.js';

// Number of Rust-owned NPC simulation slots exposed by the Wasm core (MAX_PARK_NPCS = 8).
const NPC_SLOT_COUNT = 8;
// Valid explicit slot range is [0, 7] inclusive (8 slots).
const NPC_SLOT_MAX_EXCLUSIVE = 8;
// Bitmask of every event bit the JS side understands (used to warn on unknown bits).
const NPC_KNOWN_EVENT_BITS =
  NPC_EVENT_RESET |
  NPC_EVENT_PAUSED |
  NPC_EVENT_RESUMED |
  NPC_EVENT_STATE_CHANGED |
  NPC_EVENT_SPEECH_TRIGGERED |
  NPC_EVENT_SPEECH_HIDDEN |
  NPC_EVENT_PATH_FINISHED |
  NPC_EVENT_FADE_STARTED |
  NPC_EVENT_FADE_COMPLETED |
  NPC_EVENT_CMD_REJECTED;
// Round-robin allocator so each live NPC owns a distinct Rust-side slot.
let _nextNpcSlot = 0;
function allocateNpcSlot() {
  const slot = _nextNpcSlot % NPC_SLOT_COUNT;
  _nextNpcSlot = (_nextNpcSlot + 1) % NPC_SLOT_COUNT;
  return slot;
}

export const NPCState = {
  WALKING: 'WALKING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED'
};

export function toSeconds(t) {
  const n = Number(t) || 0;
  return n > 1e10 ? n / 1000 : n;
}

export class ParkNPC {
  constructor(x = {}, y = 0, options = {}) {
    let opts = {};
    let isLegacy = false;
    let legacyX = 0;
    let legacyY = 0;

    if (typeof x === 'object' && x !== null) {
      opts = x;
    } else if (typeof x === 'number') {
      isLegacy = true;
      legacyX = x;
      legacyY = typeof y === 'number' ? y : 0;
      opts = (typeof options === 'object' && options !== null) ? options : {};
    } else {
      opts = {};
    }

    this.id = opts.id !== undefined && opts.id !== null ? String(opts.id) : ('npc-' + Math.floor(Math.random() * 1000000));
    const rawType = opts.type || (opts.isJogger ? 'jogger' : 'walker');
    this.type = (String(rawType).toLowerCase() === 'jogger') ? 'jogger' : 'walker';
    this.isJogger = this.type === 'jogger';
    this.seed = opts.seed !== undefined ? (Math.floor(Number(opts.seed)) || 0) : 0;
    this.spawnTime = toSeconds(opts.spawnTime !== undefined ? opts.spawnTime : 0);
    this.speed = opts.speed !== undefined
      ? Number(opts.speed)
      : (NPC_SPEED[this.type] || NPC_SPEED.walker);
    this.radius = opts.radius !== undefined ? opts.radius : 14;

    // Appearance from seed & type
    const identity = npcIdentityFromSeed(this.seed, this.type);
    this.name = opts.name !== undefined ? opts.name : identity.name;
    this.skinTone = opts.skinTone !== undefined ? opts.skinTone : identity.skinTone;
    this.hairColor = opts.hairColor !== undefined ? opts.hairColor : identity.hairColor;
    this.hairStyle = opts.hairStyle !== undefined ? opts.hairStyle : identity.hairStyle;
    this.hatColor = opts.hatColor !== undefined ? opts.hatColor : identity.hatColor;
    this.jacketColor = opts.jacketColor !== undefined ? opts.jacketColor : identity.jacketColor;
    this.pantsColor = opts.pantsColor !== undefined ? opts.pantsColor : identity.pantsColor;
    this.shoeColor = opts.shoeColor !== undefined ? opts.shoeColor : identity.shoeColor;
    this.accessory = opts.accessory !== undefined ? opts.accessory : (identity.accessory || (['BACKPACK', 'SCARF', 'HOODIE', 'NONE'][this.seed % 4]));

    // Path & Waypoints
    const path = opts.path || (opts.pathId ? getNpcPath(opts.pathId) : null);
    this.path = path;
    this.pathId = opts.pathId || (path ? path.id : null);
    if (path && Array.isArray(path.waypoints) && path.waypoints.length > 0) {
      this.waypoints = path.waypoints;
    } else if (Array.isArray(opts.waypoints) && opts.waypoints.length > 0) {
      this.waypoints = opts.waypoints;
    } else if (isLegacy) {
      this.waypoints = [{ x: legacyX, y: legacyY }];
    } else {
      this.waypoints = [];
    }

    // Precompute segment lengths and total Euclidean length
    this.segmentLengths = [];
    this.totalLength = 0;
    if (this.waypoints.length >= 2) {
      for (let i = 0; i < this.waypoints.length - 1; i++) {
        const p1 = this.waypoints[i];
        const p2 = this.waypoints[i + 1];
        const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        this.segmentLengths.push(segLen);
        this.totalLength += segLen;
      }
    }

    // Flat [x0,y0,x1,y1,...] copy for the dog_walker_core path sampler
    this.flatWaypoints = new Float64Array(this.waypoints.length * 2);
    for (let i = 0; i < this.waypoints.length; i++) {
      this.flatWaypoints[2 * i] = this.waypoints[i].x;
      this.flatWaypoints[2 * i + 1] = this.waypoints[i].y;
    }

    // Precompute finish time (kept for legacy API compatibility; Wasm is authoritative).
    this.finishTime = (this.totalLength > 0 && this.speed > 0)
      ? (this.spawnTime + this.totalLength / this.speed)
      : this.spawnTime;

    // Deterministic speech timeline (legacy API surface; Wasm drives live speech).
    this.speechTimeline = [];
    const speechRng = mulberry32(this.seed);
    let speechTime = this.spawnTime + nextSpeechDelay(speechRng);
    const maxSpeechTime = (this.totalLength > 0 && this.finishTime > this.spawnTime)
      ? (this.finishTime + 0.5)
      : (this.spawnTime + 120.0);
    while (speechTime < maxSpeechTime) {
      const phrase = pickPhrase(speechRng);
      this.speechTimeline.push({
        startTime: speechTime,
        endTime: speechTime + 4.0,
        phrase: phrase
      });
      speechTime += 4.0 + nextSpeechDelay(speechRng);
    }

    // --- Wasm NpcSimBuffer (authoritative simulation state) ---
    // The Rust core owns the buffer; we only hold a slot index and a zero-copy view.
    if (opts.npcSlot !== undefined && opts.npcSlot !== null) {
      const requestedSlot = Math.floor(Number(opts.npcSlot));
      if (!Number.isFinite(requestedSlot) || requestedSlot < 0 || requestedSlot >= NPC_SLOT_MAX_EXCLUSIVE) {
        throw new RangeError('NPC slot out of range');
      }
      this.npcSlot = requestedSlot;
    } else {
      this.npcSlot = allocateNpcSlot();
    }
    this.npcBuffer = null; // resolved lazily from the Rust-owned view
    this._lastStepTime = this.spawnTime;
    this._speechPhrase = null;
    this._pendingEvents = 0;
    this._initRustNpcBuffer();

    // Entity state
    if (this.waypoints.length > 0) {
      this.x = this.waypoints[0].x;
      this.y = this.waypoints[0].y;
    } else if (isLegacy) {
      this.x = legacyX;
      this.y = legacyY;
    } else {
      this.x = opts.x !== undefined ? opts.x : 0;
      this.y = opts.y !== undefined ? opts.y : 0;
    }
    this.vx = 0;
    this.vy = 0;
    this.angle = opts.angle !== undefined ? opts.angle : Math.PI / 2;
    this.depthY = this.y + 12;
    this.walkPhase = opts.walkPhase !== undefined ? opts.walkPhase : 0;
    this.opacity = 1.0;
    this.done = false;
    this.isFinishedState = false;
    this.speechBubble = null;
    this.currentSpeech = null;
    this.isNPC = true;

    // Legacy pause and avoidance compatibility
    this.pauseTimer = opts.pauseTimer || 0;
    this.waypointIndex = opts.waypointIndex || 0;
    this.state = opts.state || (this.pauseTimer > 0 ? NPCState.PAUSED : (this.isJogger ? NPCState.RUNNING : NPCState.WALKING));

    // Initialize clock positioning at spawnTime
    this.currentTime = this.spawnTime;
    this.setClock(this.spawnTime);
  }

  /**
   * Resolves the Rust-owned NPC buffer view for this NPC's slot and seeds the initial
   * simulation state (seed, speed scale, state, reset command). Safe to call repeatedly;
   * the view is re-acquired if Wasm memory has grown.
   */
  _initRustNpcBuffer() {
    let sim = null;
    let view = null;
    try {
      sim = getWasmSim();
      if (sim && typeof sim.npc_buffer_ptr === 'function') {
        const ptr = sim.npc_buffer_ptr(this.npcSlot);
        if (ptr) {
          const len = (typeof sim.npc_buffer_len === 'function')
            ? (sim.npc_buffer_len() | 0)
            : NPC_BUFFER_SLOTS;
          view = getBufferView(ptr, len > 0 ? len : NPC_BUFFER_SLOTS);
        }
      }
    } catch (e) {
      view = null;
    }
    this.npcBuffer = view;
    if (!view) return;

    // Upload the NPC's polyline path and phrase count so Rust steps the real path
    // and speech timeline (rather than an empty/default path).
    if (sim && typeof sim.set_npc_path === 'function') {
      try {
        const flatXY = (this.flatWaypoints instanceof Float64Array)
          ? this.flatWaypoints
          : new Float64Array(this.flatWaypoints || []);
        const phrases = (this.seed % 2 === 0) ? COMMON_PHRASES : ODD_PHRASES;
        const phraseCount = (phrases && phrases.length > 0) ? phrases.length : 0;
        sim.set_npc_path(this.npcSlot, flatXY, phraseCount);
      } catch (e) {
        // Non-fatal: Rust will fall back to its default path handling.
      }
    }

    view[NPC_SLOT_SEED] = this.seed >>> 0;
    view[NPC_SLOT_RNG_STATE] = this.seed >>> 0;
    view[NPC_SLOT_SPEED_SCALE] = 1.0;
    view[NPC_SLOT_OPACITY] = 1.0;
    view[NPC_SLOT_NEXT_SPEECH_DELAY_S] = NPC_SPEECH_BASE_DELAY_S;
    view[NPC_SLOT_STATE] = this.isJogger ? NPC_STATE_RUNNING : NPC_STATE_WALKING;
    view[NPC_SLOT_CMD_FLAGS] = NPC_CMD_RESET;
  }

  /**
   * Re-acquires the live Rust-owned NPC buffer view for this slot. Always fetches a fresh
   * view so a `memory.grow()` that detached the previous ArrayBuffer cannot leave us with a
   * stale view. Returns null when Wasm is unavailable.
   */
  _refreshNpcBufferView() {
    let sim = null;
    try {
      sim = getWasmSim();
    } catch (e) {
      sim = null;
    }
    if (!sim || typeof sim.npc_buffer_ptr !== 'function') {
      this.npcBuffer = null;
      return null;
    }
    try {
      const ptr = sim.npc_buffer_ptr(this.npcSlot);
      if (!ptr) {
        this.npcBuffer = null;
        return null;
      }
      const len = (typeof sim.npc_buffer_len === 'function')
        ? (sim.npc_buffer_len() | 0)
        : NPC_BUFFER_SLOTS;
      this.npcBuffer = getBufferView(ptr, len > 0 ? len : NPC_BUFFER_SLOTS);
    } catch (e) {
      this.npcBuffer = null;
    }
    return this.npcBuffer;
  }

  /** Issues a command bitmask into the Rust-owned NPC buffer (ORed with any pending flags). */
  _issueCommand(flag) {
    const buf = this._refreshNpcBufferView();
    if (!buf) return;
    buf[NPC_SLOT_CMD_FLAGS] = (buf[NPC_SLOT_CMD_FLAGS] | flag) >>> 0;
  }

  /** Hydrates public fields from the Rust-owned NPC buffer after a step. */
  _hydrateFromBuffer() {
    const buf = this._refreshNpcBufferView();
    if (!buf) return;
    this.x = buf[NPC_SLOT_X];
    this.y = buf[NPC_SLOT_Y];
    this.depthY = this.y + 12;
    this.angle = buf[NPC_SLOT_HEADING_RAD];
    this.opacity = buf[NPC_SLOT_OPACITY];
    this.done = buf[NPC_SLOT_DONE] > 0.5;
    this.isFinishedState = buf[NPC_SLOT_IS_FINISHED_STATE] > 0.5;

    const stateId = buf[NPC_SLOT_STATE] | 0;
    if (stateId === NPC_STATE_PAUSED) {
      this.state = NPCState.PAUSED;
    } else if (stateId === NPC_STATE_RUNNING) {
      this.state = NPCState.RUNNING;
    } else {
      this.state = NPCState.WALKING;
    }

    // Velocity derived from heading + effective speed (Wasm owns position/heading).
    const speedScale = buf[NPC_SLOT_SPEED_SCALE];
    const baseSpeed = stateId === NPC_STATE_RUNNING ? 95.0 : 40.0;
    const effSpeed = baseSpeed * speedScale;
    if (this.isFinishedState || this.done) {
      this.vx = 0;
      this.vy = 0;
    } else {
      this.vx = Math.cos(this.angle) * effSpeed;
      this.vy = Math.sin(this.angle) * effSpeed;
    }

    // Speech hydration.
    const visible = buf[NPC_SLOT_SPEECH_VISIBLE] > 0.5;
    if (visible) {
      const phraseId = buf[NPC_SLOT_SPEECH_PHRASE_ID] | 0;
      const phrases = (this.seed % 2 === 0) ? COMMON_PHRASES : ODD_PHRASES;
      this._speechPhrase = (phrases && phrases.length > 0)
        ? phrases[phraseId % phrases.length]
        : null;
    } else {
      this._speechPhrase = null;
    }
    this.speechBubble = this.done ? null : this._speechPhrase;
    this.currentSpeech = this.speechBubble;
  }

  setClock(now) {
    if (typeof now !== 'number' || isNaN(now)) return;
    const nowSec = toSeconds(now);
    this.currentTime = nowSec;

    // Advance the Rust-owned NPC buffer by the elapsed wall-clock delta.
    const dt = Math.max(0, nowSec - this._lastStepTime);
    this._lastStepTime = nowSec;
    if (dt > 0) {
      this._stepRustNpcBuffer(dt);
    }
    this._hydrateFromBuffer();
  }

  /**
   * Steps the Rust-owned NPC simulation via the exact generated signature
   * `step_npc_buffer(slot, dt_s)` and records the returned event bitmask.
   */
  _stepRustNpcBuffer(dt) {
    if (!this._refreshNpcBufferView()) {
      this._initRustNpcBuffer();
      if (!this.npcBuffer) return;
    }
    let sim = null;
    try {
      sim = getWasmSim();
    } catch (e) {
      sim = null;
    }
    if (!sim || typeof sim.step_npc_buffer !== 'function') return;
    try {
      const events = sim.step_npc_buffer(this.npcSlot, dt);
      this._pendingEvents = (events >>> 0);
      this._processNpcEvents(this._pendingEvents);
    } catch (e) {
      // Leave state untouched on Wasm-side failure; JS fallback is not authoritative here.
      this._pendingEvents = 0;
    }
  }

  /** Handles the event bitmask returned by `step_npc_buffer`. */
  _processNpcEvents(events) {
    if (!events) return;
    if (events & NPC_EVENT_PATH_FINISHED) {
      this.isFinishedState = true;
    }
    if (events & NPC_EVENT_FADE_COMPLETED) {
      this.done = true;
    }
    if (events & NPC_EVENT_SPEECH_HIDDEN) {
      this._speechPhrase = null;
    }
    const unknownBits = (events & ~NPC_KNOWN_EVENT_BITS) >>> 0;
    if (unknownBits !== 0 && !this._warnedUnknownEventBits) {
      this._warnedUnknownEventBits = true;
      console.warn(`[ParkNPC] Unrecognized NPC event bits: 0x${unknownBits.toString(16)}`);
    }
  }

  update(dt, now, avoidanceEntities = []) {
    // avoidanceEntities, minSep legacy references
    // isBench, isOverlook, pauseTimer legacy references
    this.depthY = this.y + 12;
    if (typeof now === 'number') {
      const nowSec = toSeconds(now);
      this.currentTime = nowSec;
      this.setClock(nowSec);
    } else {
      this.currentTime = (this.currentTime !== undefined ? this.currentTime + dt : this.spawnTime + dt);
      this.setClock(this.currentTime);
    }

    if (this.speed > 0 && !this.isFinished(this.currentTime)) {
      this.walkPhase += dt * (this.isJogger ? 9.8 : 6.2);
    }
  }

  isFinished(now) {
    if (typeof now === 'number') {
      const nowSec = toSeconds(now);
      if (nowSec >= this.finishTime) return true;
      if (this.totalLength > 0) {
        const elapsed = Math.max(0, nowSec - this.spawnTime);
        return (this.speed * elapsed) >= this.totalLength;
      }
      return false;
    }
    return this.isFinishedState;
  }

  isDone(now) {
    if (this.done) return true;
    if (typeof now === 'number') {
      const nowSec = toSeconds(now);
      return nowSec >= this.finishTime + 0.5;
    }
    return false;
  }

  /** Returns the currently visible speech phrase (Wasm-authoritative), or null. */
  getSpeech(now) {
    if (typeof now === 'number') {
      const nowSec = toSeconds(now);
      if (nowSec !== this.currentTime) {
        this.setClock(nowSec);
      }
    }
    return this._speechPhrase || null;
  }

  /**
   * Legacy path sampler hook. Delegates to the Wasm `sample_npc_path` authority (via
   * `sampleNpcPath`) for callers that still sample the polyline directly. The live NPC
   * simulation itself is driven by `stepNpcBuffer`.
   */
  samplePathAt(distance) {
    return sampleNpcPath(this.flatWaypoints, this.speed, distance);
  }

  /** Issues a pause command to the Rust-owned NPC buffer. */
  pause() {
    this._issueCommand(NPC_CMD_PAUSE);
  }

  /** Issues a resume command to the Rust-owned NPC buffer. */
  resume() {
    this._issueCommand(NPC_CMD_RESUME);
  }

  /** Issues a set-walking command to the Rust-owned NPC buffer. */
  setWalking() {
    this._issueCommand(NPC_CMD_SET_WALKING);
  }

  /** Issues a set-running command to the Rust-owned NPC buffer. */
  setRunning() {
    this._issueCommand(NPC_CMD_SET_RUNNING);
  }

  /** Issues a force-speech command to the Rust-owned NPC buffer. */
  forceSpeech() {
    this._issueCommand(NPC_CMD_FORCE_SPEECH);
  }

  getShadedColor(color, percent) {
    if (!color || typeof color !== 'string' || !color.startsWith('#')) return color;
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(255 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  draw(ctx) {
    if (this.done || this.opacity <= 0) {
      return;
    }

    ctx.save();
    ctx.globalAlpha = this.opacity;

    const angle = this.angle !== undefined ? this.angle : Math.PI / 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // 1. Soft ground drop shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 11, 14, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Directional Shoulder/Hip Axes:
    // Transverse axis perpendicular to facing angle with 2.5D vertical foreshortening
    const perpX = -sinA;
    const perpY = cosA * 0.36;

    const shoulderSpan = 10.5;
    const hipSpan = 6.2;

    const leftShoulderX = -perpX * shoulderSpan;
    const leftShoulderY = -perpY * shoulderSpan;
    const rightShoulderX = perpX * shoulderSpan;
    const rightShoulderY = perpY * shoulderSpan;

    // Depth metric for arm & leg layering: higher screen Y means closer to camera (foreground)
    const leftDepthY = leftShoulderY - sinA * 2.5;
    const rightDepthY = rightShoulderY - sinA * 2.5;
    const leftIsFar = leftDepthY < rightDepthY;

    // Walking / running strides
    const isMoving = Math.hypot(this.vx, this.vy) > 0.1;
    const legSwing = isMoving ? Math.sin(this.walkPhase) * (this.isJogger ? 7.5 : 5.5) : 0;
    const armSwing = isMoving ? Math.cos(this.walkPhase) * (this.isJogger ? 6.5 : 5.0) : 0;

    const torsoX = this.x;
    const torsoY = this.y - 3;

    // Helper for legs
    const drawLeg = (hipX, hipY, swing, isFar) => {
      ctx.save();
      const strideX = cosA * swing * 0.45;
      const strideY = sinA * swing * 0.45 + (Math.abs(swing) * 0.4);
      const lx = this.x + hipX + strideX;
      const ly = this.y + 1 + hipY + strideY;

      ctx.fillStyle = isFar ? this.getShadedColor(this.pantsColor, -0.15) : this.pantsColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - 2.8, ly, 5.5, 9, 2);
      } else {
        ctx.rect(lx - 2.8, ly, 5.5, 9);
      }
      ctx.fill();

      ctx.fillStyle = isFar ? this.getShadedColor(this.shoeColor, -0.15) : this.shoeColor;
      ctx.beginPath();
      const shoeW = Math.abs(cosA) > 0.4 ? 7.8 : 6.8;
      const shoeH = 5.0;
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - 3.2 + cosA * 1.5, ly + 8, shoeW, shoeH, 2.5);
      } else {
        ctx.rect(lx - 3.2, ly + 8, shoeW, shoeH);
      }
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(lx - 3.2 + cosA * 1.5, ly + 12, shoeW, 1.2);
      ctx.restore();
    };

    // Helper for arms
    const drawArm = (shX, shY, swing, isFar) => {
      ctx.save();
      const ax = torsoX + shX;
      const ay = torsoY - 7 + shY;

      ctx.fillStyle = isFar ? this.getShadedColor(this.jacketColor, -0.18) : this.jacketColor;
      const reachX = cosA * swing * 0.45;
      const reachY = swing * 0.8;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(ax - 2.3 + reachX, ay - reachY, 4.6, 12, 2.3);
      } else {
        ctx.rect(ax - 2.3 + reachX, ay - reachY, 4.6, 12);
      }
      ctx.fill();

      ctx.fillStyle = this.skinTone;
      ctx.beginPath();
      ctx.arc(ax + reachX, ay + 12 - reachY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // --- DEPTH LAYER 1: Far Arm & Far Leg (behind torso) ---
    if (leftIsFar) {
      drawLeg(-perpX * hipSpan, -perpY * hipSpan, legSwing, true);
      drawArm(leftShoulderX, leftShoulderY, -armSwing, true);
    } else {
      drawLeg(perpX * hipSpan, perpY * hipSpan, -legSwing, true);
      drawArm(rightShoulderX, rightShoulderY, armSwing, true);
    }

    // --- DEPTH LAYER 2: Accessory (Backpack when facing South / from front) ---
    if (this.accessory === 'BACKPACK' && sinA > 0.25) {
      this.drawBackpack(ctx, torsoX, torsoY, angle, true);
    }

    // --- DEPTH LAYER 3: 3D Directional Torso / Top ---
    ctx.save();
    ctx.translate(torsoX, torsoY);
    ctx.rotate(angle - Math.PI / 2);

    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(-10.5, -9, 21, 18, 5);
    } else {
      ctx.rect(-10.5, -9, 21, 18);
    }
    ctx.fill();

    // 3D elliptical depth shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.ellipse(0, 7, 10.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Torso Front Details if facing South / towards camera
    if (sinA > -0.2) {
      ctx.save();
      ctx.translate(torsoX, torsoY);

      if (this.isJogger) {
        // Reflective chest stripe
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillRect(-9, -2, 18, 2.5);

        // Sport bib / accent
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-4, 1, 8, 6.0, 1.5);
        } else {
          ctx.rect(-4, 1, 8, 6.0);
        }
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-2.5, 3, 5, 1.2);
      } else {
        // Lapels & collar
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(-4, -9);
        ctx.lineTo(4, -9);
        ctx.lineTo(0, -3);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.beginPath();
        ctx.moveTo(-7, -9);
        ctx.lineTo(-3, -9);
        ctx.lineTo(0, -2);
        ctx.lineTo(-5, -2);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(7, -9);
        ctx.lineTo(3, -9);
        ctx.lineTo(0, -2);
        ctx.lineTo(5, -2);
        ctx.closePath();
        ctx.fill();

        // Jacket zipper line
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -2);
        ctx.lineTo(0, 8);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // Facing North / away from camera
      ctx.save();
      ctx.translate(torsoX, torsoY);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 8);
      ctx.stroke();
      ctx.restore();
    }

    // --- DEPTH LAYER 4: Accessory (Backpack, Scarf, or Hoodie) ---
    if (this.accessory === 'BACKPACK') {
      if (sinA <= 0.25) {
        this.drawBackpack(ctx, torsoX, torsoY, angle, false);
      } else {
        this.drawBackpackStraps(ctx, torsoX, torsoY);
      }
    } else if (this.accessory === 'SCARF') {
      this.drawScarf(ctx, torsoX, torsoY, angle);
    } else if (this.accessory === 'HOODIE') {
      this.drawHoodie(ctx, torsoX, torsoY, angle);
    }

    // --- DEPTH LAYER 5: Near Leg & Near Arm (in front of torso) ---
    if (leftIsFar) {
      drawLeg(perpX * hipSpan, perpY * hipSpan, -legSwing, false);
      drawArm(rightShoulderX, rightShoulderY, armSwing, false);
    } else {
      drawLeg(-perpX * hipSpan, -perpY * hipSpan, legSwing, false);
      drawArm(leftShoulderX, leftShoulderY, -armSwing, false);
    }

    // --- DEPTH LAYER 6: Head, Face, Ears & Hairstyle ---
    this.drawHeadAndFace(ctx, torsoX, torsoY, angle, cosA, sinA);

    // Jogger athletic headband
    if (this.isJogger) {
      ctx.fillStyle = this.hatColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 8.5, this.y - 24, 17, 3.8, 1.9);
      } else {
        ctx.rect(this.x - 8.5, this.y - 24, 17, 3.8);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // --- DEPTH LAYER 7: Overhead Nametag Badge ---
    ctx.font = NPC_TAG_STYLE.font;
    ctx.textAlign = 'center';
    const displayNametag = this.name || (this.isJogger ? 'Jogger' : 'Walker');
    const textWidth = ctx.measureText(displayNametag).width;
    const pillW = textWidth + 14;
    const pillH = 16;
    const pillX = this.x - pillW / 2;
    const pillY = this.y - 42;

    ctx.fillStyle = NPC_TAG_STYLE.background;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(pillX, pillY, pillW, pillH, 8);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();

    ctx.strokeStyle = NPC_TAG_STYLE.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = NPC_TAG_STYLE.text;
    ctx.fillText(displayNametag, this.x, this.y - 30);

    // 8. Speech Bubble
    if (this.speechBubble) {
      this.drawSpeechBubble(ctx, this.speechBubble);
    }

    ctx.restore();
  }

  drawBackpack(ctx, torsoX, torsoY, angle, isFront) {
    ctx.save();
    const packX = torsoX - Math.cos(angle) * 7.0;
    const packY = torsoY - Math.sin(angle) * 5.5;

    ctx.fillStyle = '#334155';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(packX - 7.5, packY - 8, 15, 16, 4);
    } else {
      ctx.rect(packX - 7.5, packY - 8, 15, 16);
    }
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(packX - 7, packY - 8, 14, 6.5, 2.5);
    } else {
      ctx.rect(packX - 7, packY - 8, 14, 6.5);
    }
    ctx.fill();

    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(packX - 1.5, packY - 2.5, 3.0, 2.5);

    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(packX + 7, packY + 2, 2.0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawBackpackStraps(ctx, torsoX, torsoY) {
    ctx.save();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.0;

    ctx.beginPath();
    ctx.moveTo(torsoX - 6.5, torsoY - 8);
    ctx.lineTo(torsoX - 5.5, torsoY + 7);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(torsoX + 6.5, torsoY - 8);
    ctx.lineTo(torsoX + 5.5, torsoY + 7);
    ctx.stroke();

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(torsoX - 5.5, torsoY);
    ctx.lineTo(torsoX + 5.5, torsoY);
    ctx.stroke();

    ctx.restore();
  }

  drawScarf(ctx, torsoX, torsoY, angle) {
    ctx.save();
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoY - 8.5, 8.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const flutter = Math.sin(this.walkPhase * 0.8 + Date.now() * 0.005) * 4.0;
    ctx.fillStyle = '#991b1b';
    ctx.beginPath();
    ctx.moveTo(torsoX + 2, torsoY - 7);
    ctx.lineTo(torsoX + 7 + flutter, torsoY + 5);
    ctx.lineTo(torsoX + 3 + flutter, torsoY + 6);
    ctx.lineTo(torsoX - 1, torsoY - 6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(torsoX + 3 + flutter, torsoY + 6);
    ctx.lineTo(torsoX + 6 + flutter, torsoY + 8);
    ctx.stroke();

    ctx.restore();
  }

  drawHoodie(ctx, torsoX, torsoY, angle) {
    ctx.save();
    ctx.fillStyle = this.getShadedColor(this.jacketColor, -0.15);
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoY - 8.5, 9.5, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(torsoX - 3.5, torsoY - 7);
    ctx.lineTo(torsoX - 3.0, torsoY + 1);
    ctx.moveTo(torsoX + 3.5, torsoY - 7);
    ctx.lineTo(torsoX + 3.0, torsoY + 1);
    ctx.stroke();

    ctx.restore();
  }

  drawHeadAndFace(ctx, torsoX, torsoY, angle, cosA, sinA) {
    const headX = this.x;
    const headY = this.y - 20;
    const style = (this.hairStyle || 'SHORT').toUpperCase();

    // 1. Rear hair layer for WAVY or PONYTAIL
    if (style === 'WAVY') {
      ctx.fillStyle = this.hairColor;
      ctx.beginPath();
      ctx.ellipse(headX, headY + 2, 11.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'PONYTAIL') {
      const backAngle = angle + Math.PI;
      const pBaseX = headX + Math.cos(backAngle) * 7.5;
      const pBaseY = headY - 2 + Math.sin(backAngle) * 6.5;

      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(pBaseX, pBaseY, 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = this.hairColor;
      const pTipX = pBaseX + Math.cos(backAngle) * 9.5;
      const pTipY = pBaseY + Math.sin(backAngle) * 9.5;
      ctx.beginPath();
      ctx.ellipse(pTipX, pTipY, 4.8, 7.8, backAngle + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Base Head
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(headX, headY, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // 3. Directional Ears
    if (sinA > -0.5) {
      ctx.fillStyle = this.skinTone;
      const earOffsetX = -sinA * 8.6;
      const earOffsetY = cosA * 2.8;
      ctx.beginPath();
      ctx.arc(headX - earOffsetX, headY + earOffsetY, 2.2, 0, Math.PI * 2);
      ctx.arc(headX + earOffsetX, headY - earOffsetY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Directional Eyes & Nose (only when facing South or Side)
    if (sinA > -0.2) {
      const eyeForwardX = cosA * 3.5;
      const eyeForwardY = sinA * 3.5;
      const eyeSideX = sinA * 2.8;
      const eyeSideY = -cosA * 2.8;

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(headX + eyeForwardX + eyeSideX, headY + eyeForwardY + eyeSideY, 1.1, 0, Math.PI * 2);
      ctx.arc(headX + eyeForwardX - eyeSideX, headY + eyeForwardY - eyeSideY, 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.arc(headX + cosA * 4.6, headY + sinA * 4.6, 1.0, 0, Math.PI * 2);
      ctx.fill();
    } else if (Math.abs(cosA) > 0.4) {
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(headX + cosA * 4.2, headY - 0.5, 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = this.skinTone;
      ctx.beginPath();
      ctx.arc(headX + cosA * 7.5, headY + 1.0, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Hairstyle
    this.drawHair(ctx, style, headX, headY, angle, sinA, cosA);
  }

  drawSpeechBubble(ctx, text) {
    if (!text) return;
    ctx.save();
    ctx.font = '500 12px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const textWidth = Math.min(260, ctx.measureText(text).width);
    const bubbleW = textWidth + 16;
    const bubbleH = 24;
    const bx = this.x - bubbleW / 2;
    const by = this.y - 68;

    // Bubble body
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, bubbleW, bubbleH, 8);
    } else {
      ctx.rect(bx, by, bubbleW, bubbleH);
    }
    ctx.fill();

    // Small triangle pointer pointing down
    ctx.beginPath();
    ctx.moveTo(this.x - 4, by + bubbleH);
    ctx.lineTo(this.x, by + bubbleH + 6);
    ctx.lineTo(this.x + 4, by + bubbleH);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(text, this.x, by + 16);
    ctx.restore();
  }

  drawHair(ctx, style, headX = this.x, headY = this.y - 20, angle = Math.PI / 2, sinA = 1, cosA = 0) {
    ctx.save();
    switch (style) {
      case 'WAVY': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(headX - 8.5, headY + 3, 3.8, 6.5, -0.25, 0, Math.PI * 2);
        ctx.ellipse(headX - 8.0, headY + 9, 3.2, 5.0, 0.15, 0, Math.PI * 2);
        ctx.ellipse(headX + 8.5, headY + 3, 3.8, 6.5, 0.25, 0, Math.PI * 2);
        ctx.ellipse(headX + 8.0, headY + 9, 3.2, 5.0, -0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(headX, headY - 3, 9.5, Math.PI * 0.9, Math.PI * 2.1);
        ctx.fill();

        if (sinA > -0.2) {
          ctx.beginPath();
          ctx.moveTo(headX - 8, headY - 2);
          ctx.quadraticCurveTo(headX - 4, headY + 1.5, headX, headY - 1.5);
          ctx.quadraticCurveTo(headX + 4, headY + 1.5, headX + 8, headY - 2);
          ctx.lineTo(headX + 7, headY - 6);
          ctx.lineTo(headX - 7, headY - 6);
          ctx.closePath();
          ctx.fill();
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(headX - 3, headY - 5, 5.5, Math.PI * 1.15, Math.PI * 1.75);
        ctx.stroke();
        break;
      }

      case 'PONYTAIL': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(headX, headY - 2, 9.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(headX - 7.5, headY - 1, 2.2, 3.8, -0.15, 0, Math.PI * 2);
        ctx.ellipse(headX + 7.5, headY - 1, 2.2, 3.8, 0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(headX, headY - 5.5, 4.2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();
        break;
      }

      case 'BEANIE': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(headX - 7.2, headY + 1, 2.5, 4.0, -0.2, 0, Math.PI * 2);
        ctx.ellipse(headX + 7.2, headY + 1, 2.5, 4.0, 0.2, 0, Math.PI * 2);
        ctx.fill();

        if (sinA > -0.2) {
          ctx.beginPath();
          ctx.arc(headX, headY - 1, 8.5, Math.PI * 0.95, Math.PI * 1.25);
          ctx.arc(headX, headY - 1, 8.5, Math.PI * 1.75, Math.PI * 2.05);
          ctx.fill();
        }

        const beanieMain = this.hatColor || '#c2410c';
        ctx.fillStyle = beanieMain;
        ctx.beginPath();
        ctx.ellipse(headX, headY - 4, 10.0, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(headX - 9.5, headY - 3, 19, 5.5, 2.5);
        } else {
          ctx.rect(headX - 9.5, headY - 3, 19, 5.5);
        }
        ctx.fill();
        break;
      }

      case 'SHORT':
      default: {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(headX, headY - 2, 9.2, Math.PI * 0.85, Math.PI * 2.15);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(headX - 7.5, headY - 0.5, 2.5, 4.2, -0.2, 0, Math.PI * 2);
        ctx.ellipse(headX + 7.5, headY - 0.5, 2.5, 4.2, 0.2, 0, Math.PI * 2);
        ctx.fill();

        if (sinA > -0.2) {
          ctx.beginPath();
          ctx.moveTo(headX - 8, headY - 2);
          ctx.quadraticCurveTo(headX - 4, headY + 0.5, headX - 2, headY - 2.5);
          ctx.quadraticCurveTo(headX + 1, headY + 1.0, headX + 3.5, headY - 2.5);
          ctx.quadraticCurveTo(headX + 6, headY, headX + 8, headY - 2);
          ctx.lineTo(headX + 7, headY - 6);
          ctx.lineTo(headX - 7, headY - 6);
          ctx.closePath();
          ctx.fill();
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(headX - 2, headY - 6, 4.5, Math.PI * 1.1, Math.PI * 1.8);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}

export class WalkerNPC extends ParkNPC {
  // Legacy default speed: 85
  constructor(x, y, options = {}) {
    if (typeof x === 'object' && x !== null) {
      const opts = { type: 'walker', ...x };
      if (opts.speed === undefined) {
        opts.speed = NPC_SPEED.walker;
      }
      super(opts);
    } else {
      super(x, y, { speed: 85, type: 'walker', isJogger: false, ...options });
    }
    this._issueCommand(NPC_CMD_SET_WALKING);
  }
}

export class JoggerNPC extends ParkNPC {
  // Legacy default speed: 260
  constructor(x, y, options = {}) {
    if (typeof x === 'object' && x !== null) {
      const opts = { type: 'jogger', ...x };
      if (opts.speed === undefined) {
        opts.speed = NPC_SPEED.jogger;
      }
      super(opts);
    } else {
      super(x, y, { speed: 260, type: 'jogger', isJogger: true, ...options });
    }
    this._issueCommand(NPC_CMD_SET_RUNNING);
  }
}
