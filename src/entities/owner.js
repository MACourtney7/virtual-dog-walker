// Human Owner Player Avatar - Cruise-and-Helm Player Locomotion, Continuous Heading Steering, Ground Halo & Directional 2.5D Silhouette
import { resolveFieldCollision, getWasmSim, getBufferView } from '../engine/wasm_sim_bridge.js';
import { MAX_LEASH_LENGTH, clampOwnerToLeash } from '../world/leash.js';

// --- Wasm OwnerSimBuffer contract (mirror crates/dog_walker_core/src/owner_sim.rs) -----------
// Slot indices within the 64-float owner buffer.
const OWNER_SLOT_X = 0;
const OWNER_SLOT_Y = 1;
const OWNER_SLOT_VX = 2;
const OWNER_SLOT_VY = 3;
const OWNER_SLOT_ANGLE = 4;
const OWNER_SLOT_SPEED = 5;
const OWNER_SLOT_GAIT = 6;
const OWNER_SLOT_WALK_PHASE = 7;
const OWNER_SLOT_INPUT_X = 8;
const OWNER_SLOT_INPUT_Y = 9;
const OWNER_SLOT_CMD_FLAGS = 10;
const OWNER_SLOT_EVENT_BITMASK = 11;
const OWNER_SLOT_STEP_OFF_TIMER = 12;
const OWNER_SLOT_JOG_TIMER = 13;
const OWNER_SLOT_JOG_COOLDOWN = 14;
const OWNER_SLOT_WANDER_HEADING = 15;
const OWNER_SLOT_WANDER_TIMER = 16;
const OWNER_SLOT_LEASH_TENSION = 21;
const OWNER_SLOT_LEASH_TAUT = 22;
const OWNER_SLOT_HAND_LOCAL_X = 23;
const OWNER_SLOT_HAND_LOCAL_Y = 24;
const OWNER_SLOT_WARP_GATE_ID = 25;
const OWNER_SLOT_WANDER_BLOCKED = 31;
const OWNER_SLOT_DESIRED_GAIT = 34;
const OWNER_SLOT_SPEED_MULTIPLIER = 35;
// Last known safe (non-colliding) position, used by the Wasm sim to recover
// from teleports/warps that would otherwise leave the owner stuck in geometry.
const OWNER_SLOT_LAST_SAFE_X = 36;
const OWNER_SLOT_LAST_SAFE_Y = 37;

// Gait ids.
const OWNER_GAIT_STAND = 0;
const OWNER_GAIT_STROLL = 1;
const OWNER_GAIT_WALK = 2;
const OWNER_GAIT_JOG = 3;
const OWNER_GAIT_WANDER = 4;

// Command flags.
const OWNER_CMD_RESET = 1 << 0;
const OWNER_CMD_STOP = 1 << 1;
const OWNER_CMD_JOG = 1 << 2;
const OWNER_CMD_WALK = 1 << 3;
const OWNER_CMD_STROLL = 1 << 4;
const OWNER_CMD_WANDER = 1 << 5;
const OWNER_CMD_CLEAR_WANDER = 1 << 6;
const OWNER_CMD_FACE_DOG = 1 << 7;

// Event bits.
const OWNER_EVENT_GAIT_CHANGED = 1 << 1;
const OWNER_EVENT_STEP_OFF_STARTED = 1 << 3;
const OWNER_EVENT_STEP_OFF_FINISHED = 1 << 4;
const OWNER_EVENT_WANDER_STARTED = 1 << 5;
const OWNER_EVENT_WANDER_BLOCKED = 1 << 6;
const OWNER_EVENT_BOUNDARY_BLOCKED = 1 << 7;
const OWNER_EVENT_OBSTACLE_DEFLECTED = 1 << 8;
const OWNER_EVENT_LEASH_FORCED_STAND = 1 << 12;
const OWNER_EVENT_JOG_STARTED = 1 << 15;

// Number of Float32 slots in the owner buffer contract.
const OWNER_BUFFER_SLOTS = 64;

// Gait model constants
export const Gait = Object.freeze({
  STAND: 'STAND',
  STROLL: 'STROLL',
  WALK: 'WALK',
  JOG: 'JOG',
  WANDER: 'WANDER'
});

// JS gait string <-> Wasm gait id mapping.
const GAIT_TO_ID = Object.freeze({
  [Gait.STAND]: OWNER_GAIT_STAND,
  [Gait.STROLL]: OWNER_GAIT_STROLL,
  [Gait.WALK]: OWNER_GAIT_WALK,
  [Gait.JOG]: OWNER_GAIT_JOG,
  [Gait.WANDER]: OWNER_GAIT_WANDER
});

const ID_TO_GAIT = Object.freeze({
  [OWNER_GAIT_STAND]: Gait.STAND,
  [OWNER_GAIT_STROLL]: Gait.STROLL,
  [OWNER_GAIT_WALK]: Gait.WALK,
  [OWNER_GAIT_JOG]: Gait.JOG,
  [OWNER_GAIT_WANDER]: Gait.WANDER
});

function gaitToId(gait) {
  const id = GAIT_TO_ID[gait];
  return typeof id === 'number' ? id : OWNER_GAIT_STAND;
}

function idToGait(id) {
  const gait = ID_TO_GAIT[id | 0];
  return gait || Gait.STAND;
}

// NOTE: Gait.WANDER is intentionally excluded from GAIT_ORDER. GAIT_ORDER
// drives the manual click-to-cycle pace progression (STAND -> STROLL -> WALK
// -> JOG); WANDER is an autopilot-only gait.
const GAIT_ORDER = [Gait.STAND, Gait.STROLL, Gait.WALK, Gait.JOG];

const GAIT_SPEEDS = Object.freeze({
  [Gait.STAND]: 0,
  [Gait.STROLL]: 75,
  [Gait.WALK]: 100,
  [Gait.JOG]: 185,
  [Gait.WANDER]: 60
});

// Max turn rate (radians/sec) per gait
const GAIT_TURN_RATES = Object.freeze({
  [Gait.STAND]: Math.PI, // effectively free while standing
  [Gait.STROLL]: (180 * Math.PI) / 180,
  [Gait.WALK]: (115 * Math.PI) / 180,
  [Gait.JOG]: (65 * Math.PI) / 180
});

const STEP_OFF_TURN_RATE = (300 * Math.PI) / 180; // 300 deg/s
const STEP_OFF_ALIGN_TOLERANCE = (5 * Math.PI) / 180; // ~5 deg
const STEP_OFF_MAX_DURATION = 0.5; // seconds

// Player body hit-test radius (px)
const PLAYER_HIT_RADIUS = 26;

const JOG_DURATION = 2.0;
const JOG_COOLDOWN = 2.0;

// Wander mode (KeyW autopilot stroll) constants
export const WANDER_SPEED = Gait.WANDER;            // 60 px/s (20% slower than STROLL)
export const WANDER_MAX_TURN_RATE = Math.PI * 1.4;  // rad/s
export const WANDER_DRIFT_AMPLITUDE = 0;            // 0 rad (smooth path to warp, no weaving)
export const WANDER_DRIFT_FREQUENCY = 0.35;         // Hz
export const WANDER_LOOKAHEAD_PX = 120;

// Leash arm pose constants (exported for tests/tooling)
export const LEASH_ARM_SWING_SCALE = 0.15;
export const LEASH_ARM_BASE_REACH_PX = 14;
export const LEASH_ARM_MAX_REACH_PX = 30;
export const LEASH_ARM_TENSION_RAMP_PX = 140; // distance that maps to tension = 1
export const LEASH_ARM_SHOULDER_OFFSET_PX = 8;
export const LEASH_ARM_HAND_RADIUS_PX = 3.5;
export const LEASH_ARM_SIDE_EXTEND_PX = 6.5; // horizontal offset from shoulder (keeps hand outside torso)
export const LEASH_ARM_DROP_PX = 9.5;        // vertical drop below shoulder (matches 12px normal arm length)

function clamp01(v) {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function lerpNum(a, b, t) {
  return a + (b - a) * t;
}

// Wrapped shortest-arc delta from a to b
function angleDelta(a, b) {
  let delta = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export class Owner {
  constructor(x = 1200, y = 900, name = 'Walker', isLocal = true) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.speed = 190; // px/s
    this.facing = 'S';
    this.angle = Math.PI / 2; // Facing downward (South)

    this.name = name;
    this.isLocal = isLocal;
    this.radius = 16;
    this.depthY = this.y + 12;

    // Customization tokens
    this.hairStyle = 'SHORT'; // Supported: 'SHORT', 'WAVY', 'PONYTAIL', 'BEANIE'
    this.hairColor = '#451a03'; // Chestnut brown
    this.skinTone = '#fed7aa'; // Warm light peach
    this.jacketColor = '#1e3a8a'; // Deep blue
    this.pantsColor = '#334155'; // Slate dark trousers
    this.shoeColor = '#0f172a';
    this.accessory = 'BACKPACK'; // Supported: 'BACKPACK', 'SCARF', 'HOODIE', 'NONE'

    // State & Animations
    this.isMoving = false;
    this.walkPhase = 0;
    this.isPetting = false;
    this.petTimer = 0;
    this.isBending = false;
    this.bendTimer = 0;
    this.isLeashed = true;
    this.leashHandSide = 'left';

    // Chat / Emote bubble
    this.chatText = null;
    this.chatTimer = 0;
    this.emote = null;
    this.emoteTimer = 0;

    // Input state
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };

    // Gait & heading state
    this.gait = Gait.STAND;
    this.targetHeading = this.angle;
    this.jogTimer = 0;
    this.jogCooldown = 0;
    this.stepOffTimer = 0;
    this.stepOffActive = false;

    // Leash arm pose state (updated each frame while leashed)
    this.leashArmExtensionPx = LEASH_ARM_BASE_REACH_PX;
    this.leashArmTension = 0;
    this.leashDistance = 0;

    // Wander mode (KeyW autopilot stroll) state
    this.wanderMode = false;
    this.wanderPhase = 0;
    this.wanderBaseHeading = this.angle;
    this.wanderTargetHeading = this.angle;
    // Zone id the owner most recently arrived from (used to avoid immediately
    // re-targeting the warp gate we just came through).
    this.lastArrivedFromZoneId = null;

    // Brake-light feedback pulse (rear brake sector flash)
    this.brakeLightFeedback = {
      active: false,
      startedAt: 0,
      durationMs: 250,
      peakFillAlpha: 0.6,
      peakStrokeAlpha: 0.9,
      color: '#ef4444'
    };

    // Gait-change event hook (wired by main.js to spawn speed badges).
    // Signature: (prevGait, nextGait) => void
    this.onGaitChange = null;

    // --- Wasm OwnerSimBuffer state -----------------------------------------------------------
    // Cached Float32Array view over the Wasm owner buffer (64 slots). Resolved lazily on the
    // first step; null when Wasm is unavailable (JS fallback path is used instead).
    this._ownerBuffer = null;
    // Pointer the cached view was created from (0 = not yet resolved).
    this._ownerBufferPtr = 0;
    // True once the persistent buffer has been seeded from the JS state.
    this._ownerBufferSeeded = false;
    // Pending command flags to OR into the buffer on the next step.
    this._pendingCmdFlags = 0;
    // Pending input steering vector (world-space direction).
    this._inputX = 0;
    this._inputY = 0;
    // Wander heading mirrored from the Wasm buffer for external readers.
    this.wanderHeading = this.angle;
  }

  /**
   * Resolves (and caches) the Float32Array view over the Wasm owner buffer. Returns null when
   * the Wasm sim is unavailable so callers fall back to the JS implementation.
   */
  _getOwnerBuffer() {
    let sim = null;
    try {
      sim = getWasmSim();
    } catch (e) {
      return null;
    }
    if (!sim || typeof sim.owner_buffer_ptr !== 'function' || typeof sim.step_owner_buffer !== 'function') {
      return null;
    }
    let ptr = 0;
    try {
      ptr = sim.owner_buffer_ptr();
    } catch (e) {
      return null;
    }
    if (!ptr) return null;
    // Reuse the cached view only while it still points at the same live memory buffer AND
    // the underlying ArrayBuffer has not been detached by memory.grow() (byteLength === 0).
    if (
      this._ownerBuffer &&
      this._ownerBufferPtr === ptr &&
      this._ownerBuffer.buffer &&
      this._ownerBuffer.buffer.byteLength > 0
    ) {
      return this._ownerBuffer;
    }
    // Build the view over the Wasm linear memory via the bridge helper. The view is recreated
    // whenever the underlying memory buffer has grown (buffer identity changed) or the pointer
    // moved, so a stale view is never reused after memory.grow().
    try {
      const len = (typeof sim.owner_buffer_len === 'function')
        ? (sim.owner_buffer_len() | 0)
        : OWNER_BUFFER_SLOTS;
      const view = getBufferView(ptr, len > 0 ? len : OWNER_BUFFER_SLOTS);
      if (!view || view.length !== OWNER_BUFFER_SLOTS) return null;
      if (!view.buffer || view.buffer.byteLength === 0) return null;
      this._ownerBuffer = view;
      this._ownerBufferPtr = ptr;
      return view;
    } catch (e) {
      return null;
    }
  }

  /**
   * Seeds the persistent Wasm owner buffer from the current JS state (once). Subsequent steps
   * continue from the Wasm-authoritative state.
   */
  _seedOwnerBuffer(buf) {
    if (this._ownerBufferSeeded) return;
    buf[OWNER_SLOT_X] = Number.isFinite(this.x) ? this.x : 0;
    buf[OWNER_SLOT_Y] = Number.isFinite(this.y) ? this.y : 0;
    buf[OWNER_SLOT_VX] = Number.isFinite(this.vx) ? this.vx : 0;
    buf[OWNER_SLOT_VY] = Number.isFinite(this.vy) ? this.vy : 0;
    buf[OWNER_SLOT_ANGLE] = Number.isFinite(this.angle) ? this.angle : 0;
    buf[OWNER_SLOT_SPEED] = 0;
    buf[OWNER_SLOT_GAIT] = gaitToId(this.gait);
    buf[OWNER_SLOT_WALK_PHASE] = Number.isFinite(this.walkPhase) ? this.walkPhase : 0;
    buf[OWNER_SLOT_WANDER_HEADING] = Number.isFinite(this.wanderBaseHeading) ? this.wanderBaseHeading : this.angle;
    buf[OWNER_SLOT_SPEED_MULTIPLIER] = 1.0;
    this._ownerBufferSeeded = true;
  }

  /**
   * Hydrates the JS-visible owner state from the Wasm owner buffer after a step.
   */
  _hydrateFromOwnerBuffer(buf, events) {
    this.x = buf[OWNER_SLOT_X];
    this.y = buf[OWNER_SLOT_Y];
    this.vx = buf[OWNER_SLOT_VX];
    this.vy = buf[OWNER_SLOT_VY];
    this.angle = buf[OWNER_SLOT_ANGLE];
    this.speed = buf[OWNER_SLOT_SPEED];
    this.walkPhase = buf[OWNER_SLOT_WALK_PHASE];
    this.wanderHeading = buf[OWNER_SLOT_WANDER_HEADING];

    const nextGait = idToGait(buf[OWNER_SLOT_GAIT]);
    if (nextGait !== this.gait) {
      const prevGait = this.gait;
      this.gait = nextGait;
      if (typeof this.onGaitChange === 'function') {
        this.onGaitChange(prevGait, nextGait);
      }
    }

    // Mirror timers so external readers (and the JS fallback) stay consistent.
    this.stepOffTimer = buf[OWNER_SLOT_STEP_OFF_TIMER];
    this.stepOffActive = this.stepOffTimer > 0;
    this.jogTimer = buf[OWNER_SLOT_JOG_TIMER];
    this.jogCooldown = buf[OWNER_SLOT_JOG_COOLDOWN];

    // Leash arm pose state.
    this.leashArmTension = buf[OWNER_SLOT_LEASH_TENSION];
    this.leashDistance = this.dog ? Math.hypot(this.dog.x - this.x, this.dog.y - this.y) : 0;

    // Motion flags.
    this.isMoving = this.gait !== Gait.STAND;
    if (!this.isMoving) {
      this.vx = 0;
      this.vy = 0;
    }

    // Wander mode mirrors the Wasm gait.
    if (this.gait === Gait.WANDER) {
      this.wanderMode = true;
      this.wanderBaseHeading = this.wanderHeading;
    } else if (this.wanderMode && (events & OWNER_EVENT_WANDER_STARTED) === 0) {
      // Leaving WANDER via a non-wander command clears the autopilot flag.
      this.wanderMode = false;
    }

    // Boundary stop: the Wasm sim zeroes speed but keeps the gait; mirror the
    // legacy JS behaviour of forcing STAND on a boundary block.
    if (events & OWNER_EVENT_BOUNDARY_BLOCKED) {
      this.setGait(Gait.STAND);
    }
  }

  /**
   * Teleports the owner to (x, y) and mirrors the new position into the Wasm
   * owner buffer so the authoritative sim does not snap the owner back to its
   * pre-warp coordinates on the next step. Used by zone warps.
   */
  syncPositionToWasm(x, y) {
    const nx = Number.isFinite(x) ? x : this.x;
    const ny = Number.isFinite(y) ? y : this.y;
    this.x = nx;
    this.y = ny;
    this.vx = 0;
    this.vy = 0;

    const buf = this._getOwnerBuffer();
    if (buf) {
      buf[OWNER_SLOT_X] = nx;
      buf[OWNER_SLOT_Y] = ny;
      buf[OWNER_SLOT_VX] = 0;
      buf[OWNER_SLOT_VY] = 0;
      buf[OWNER_SLOT_LAST_SAFE_X] = nx;
      buf[OWNER_SLOT_LAST_SAFE_Y] = ny;
      this._ownerBufferSeeded = true;
    } else {
      // Wasm not ready yet: force a re-seed from the new JS coordinates once
      // the buffer becomes available.
      this._ownerBufferSeeded = false;
    }
  }

  triggerBrakeLight(now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this.brakeLightFeedback.active = true;
    this.brakeLightFeedback.startedAt = now;
  }

  // Normalized leash tension in [0, 1]. Derived from leash distance and the
  // dog's pulling state. Falls back gracefully when no dog reference exists.
  getLeashTension() {
    const dog = this.dog || null;
    let dist = this.leashDistance;
    if ((!dist || !isFinite(dist)) && dog) {
      dist = Math.hypot(dog.x - this.x, dog.y - this.y);
    }
    if (!dist || !isFinite(dist)) dist = 0;
    let tension = clamp01(dist / LEASH_ARM_TENSION_RAMP_PX);
    if (dog && dog.isPullingLeash) {
      tension = Math.max(tension, 0.85);
    }
    return tension;
  }

  // Compute the leash hand position in owner-local space.
  // Local frame: +x = forward (heading), +y = screen-right of heading.
  // This is the SINGLE SOURCE OF TRUTH for both rendering and the anchor.
  computeLeashHandLocal() {
    const sideSign = this.leashHandSide === 'left' ? -1 : 1;
    const tension = this.getLeashTension();

    const shoulderX = 0;
    const shoulderY = sideSign * LEASH_ARM_SHOULDER_OFFSET_PX;

    // Keep the visual arm reach natural so the arm never telescopes 30px down
    // past the owner's feet.
    const reach = Math.min(
      20,
      lerpNum(LEASH_ARM_BASE_REACH_PX, LEASH_ARM_MAX_REACH_PX, tension)
    );

    // Reduced stride oscillation on the holding arm only.
    // NOTE: armAngle is in RADIANS, so the swing must be an angular amplitude
    // (not a pixel displacement). 0.35 rad * LEASH_ARM_SWING_SCALE (0.15)
    // yields ~0.0525 rad (~3 deg) of gentle, stabilized leash-hand vibration.
    const swingAngle = this.isMoving ? 0.35 : 0;
    const swing = Math.sin(this.walkPhase) * swingAngle * LEASH_ARM_SWING_SCALE * sideSign;

    const dog = this.dog;
    const hasDog = Boolean(
      dog && typeof dog.x === 'number' && typeof dog.y === 'number'
    );

    // Transform the dog vector into owner-local coordinates.
    // +x = forward (heading), +y = screen-right of heading.
    let dogLocalX = 0;
    let dogLocalY = 0;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    if (hasDog) {
      const dxW = dog.x - this.x;
      const dyW = dog.y - (this.y - 3);
      dogLocalX = dxW * c + dyW * s;  // +forward, -behind
      dogLocalY = -dxW * s + dyW * c; // -left, +right
    }

    // A needy/pooping dog anchors the owner (hold-up), so the arm may tuck to
    // the hip. During normal movement the dog is kept ahead of the shoulder
    // line, so a 90°+ turn must never snap the arm behind the back.
    const dogAnchoring = Boolean(
      dog && (dog.isPooping || dog.isHungry || dog.needsGrooming || dog.isTired)
    );
    if (hasDog && (dogLocalX < -2 || (dogAnchoring && (dogLocalX < 18 || (dogLocalY * sideSign) < 0)))) {
      // "tucked_hip": the dog lags behind the forward heel slot OR has crossed
      // to the opposite lateral side of the owner's heading. Compute the hand
      // directly in the 2.5D screen space of the leash-holding shoulder so it
      // always hangs compactly at the owner's hip across all 360° angles.
      const shoulderSpan = 10.5;
      const shScreenX = -sideSign * s * shoulderSpan;
      const shScreenY = -7 + (sideSign * c * 0.36 * shoulderSpan);

      // Always extend the arm OUTSIDE the torso silhouette so the sleeve is
      // never hidden inside the blue jacket rectangle (|x| <= 10.5).
      const baseSign = (c < -0.25)
        ? 1
        : ((c > 0.25 && s < 0.25) || s < -0.15 ? -1 : 1);
      const outSign = sideSign === -1 ? baseSign : -baseSign;
      // Always clear the torso silhouette (10.5px half-width) across all
      // headings, even when the shoulder projects near the body centre
      // (e.g. walking due East/West where |shScreenX| < 5).
      const handWorldX = outSign * Math.max(
        11.5,
        Math.abs(shScreenX) + LEASH_ARM_SIDE_EXTEND_PX
      );
      const handWorldY = shScreenY + LEASH_ARM_DROP_PX;

      // Back-project (handWorldX, handWorldY) into owner-local (x, y).
      const x = handWorldX * c + handWorldY * s;
      const y = -handWorldX * s + handWorldY * c;

      return {
        x,
        y,
        shoulderX,
        shoulderY,
        armAngle: Math.atan2(y - shoulderY, x - shoulderX),
        reach: Math.hypot(x - shoulderX, y - shoulderY),
        tension,
        pose: 'straight_behind',
        hasElbowBend: false,
        elbowBendScreenX: 0,
        elbowBendScreenY: 0,
        elbowLocalX: (shoulderX + x) * 0.5,
        elbowLocalY: (shoulderY + y) * 0.5
      };
    }

    // "forward_heel": standard forward-flank pose on the leash-hand side.
    // Used when there is no dog reference or the dog is beside/ahead.
    const armAngle = sideSign * (0.08 + 0.10 * (1 - tension)) + swing;
    const x = shoulderX + Math.cos(armAngle) * reach;
    const y = shoulderY + Math.sin(armAngle) * reach;
    return {
      x,
      y,
      shoulderX,
      shoulderY,
      armAngle,
      reach,
      tension,
      pose: 'forward_heel',
      hasElbowBend: false,
      elbowBendScreenX: 0,
      elbowBendScreenY: 0,
      elbowLocalX: (shoulderX + x) * 0.5,
      elbowLocalY: (shoulderY + y) * 0.5
    };
  }

  getLeashHandAnchor(preferredSide = this.leashHandSide || 'left') {
    const side = preferredSide === 'left' ? 'left' : 'right';
    this.leashHandSide = side;

    const local = this.computeLeashHandLocal();
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    // Match the rendered grip hand exactly: draw() places the torso at
    // `this.y - 3 + kneelDrop` and the leash arm hand at torso-relative
    // coordinates, so the anchor must include the same -3 vertical offset.
    const torsoYOffset = -3;
    return {
      x: this.x + local.x * c - local.y * s,
      y: this.y + torsoYOffset + local.x * s + local.y * c
    };
  }

  // --- Gait API ---

  getCurrentSpeed() {
    return GAIT_SPEEDS[this.gait] || 0;
  }

  setTargetHeading(radians) {
    if (typeof radians !== 'number' || !isFinite(radians)) return;
    // Heading-only update. Gait transitions are the caller's responsibility
    // (e.g. main.js explicitly promotes STAND -> STROLL on a field press).
    this.targetHeading = radians;
    // Record the world-space steering direction for the Wasm input vector.
    this._inputX = Math.cos(radians);
    this._inputY = Math.sin(radians);
    // Turn-on-the-spot: while STAND, snap the facing angle immediately and
    // mirror it into the Wasm owner buffer so the next Wasm step does not
    // whiplash the owner back to the stale pre-turn heading.
    if (this.gait === Gait.STAND) {
      this.angle = radians;
      if (this._ownerBufferSeeded) {
        const buf = this._getOwnerBuffer();
        if (buf) {
          buf[OWNER_SLOT_ANGLE] = radians;
        }
      }
    }
  }

  setGait(nextGait, options = {}) {
    // WANDER is a valid autopilot gait even though it is not part of the
    // manual GAIT_ORDER cycle.
    if (nextGait !== Gait.WANDER && !GAIT_ORDER.includes(nextGait)) return;
    if (nextGait === this.gait) return;

    // When the Wasm owner buffer is active, route the gait change through the
    // command flags so the authoritative sim applies it on the next step.
    if (this._ownerBuffer) {
      this._queueGaitCommand(nextGait);
      return;
    }

    const prevGait = this.gait;

    // Clamp upward transitions into JOG while cooldown is active
    if (nextGait === Gait.JOG && this.jogCooldown > 0) {
      nextGait = Gait.WALK;
    }

    // If the clamp collapsed the transition back to the current gait, bail.
    if (nextGait === this.gait) return;

    // Leaving JOG starts cooldown
    if (this.gait === Gait.JOG && nextGait !== Gait.JOG) {
      this.jogCooldown = JOG_COOLDOWN;
      this.jogTimer = 0;
    }

    // Entering JOG starts timer
    if (nextGait === Gait.JOG) {
      this.jogTimer = JOG_DURATION;
    }

    // Leaving STAND begins step-off alignment window
    if (this.gait === Gait.STAND && nextGait !== Gait.STAND) {
      this.stepOffActive = true;
      this.stepOffTimer = STEP_OFF_MAX_DURATION;
    }

    this.gait = nextGait;

    // Keep the legacy `speed` field in sync with the active gait speed.
    if (nextGait === Gait.WANDER) {
      this.speed = GAIT_SPEEDS[Gait.WANDER];
    }

    // Keep targetHeading synced to current angle when stopping
    if (nextGait === Gait.STAND) {
      this.targetHeading = this.angle;
      this.stepOffActive = false;
      this.stepOffTimer = 0;
    }

    // Keep isMoving and velocity in sync immediately so no stale motion
    // survives a gait change (e.g. boundary collision forcing STAND).
    this.isMoving = this.gait !== Gait.STAND;
    if (!this.isMoving) {
      this.vx = 0;
      this.vy = 0;
    }

    // Fire the gait-change hook at the transition source so downstream
    // consumers (e.g. speed badges) never rely on fragile frame polling.
    if (typeof this.onGaitChange === 'function') {
      this.onGaitChange(prevGait, this.gait);
    }
  }

  stepGait(delta) {
    const dir = delta > 0 ? 1 : (delta < 0 ? -1 : 0);
    if (dir === 0) return;
    const idx = GAIT_ORDER.indexOf(this.gait);
    const nextIdx = Math.max(0, Math.min(GAIT_ORDER.length - 1, idx + dir));
    if (nextIdx === idx) return;
    this.setGait(GAIT_ORDER[nextIdx]);
  }

  /**
   * Queues a gait command flag for the next Wasm owner step. Mirrors the
   * command priority in owner_sim.rs (STOP > JOG > WALK > STROLL > WANDER).
   */
  _queueGaitCommand(nextGait) {
    switch (nextGait) {
      case Gait.STAND:
        this._pendingCmdFlags |= OWNER_CMD_STOP;
        break;
      case Gait.JOG:
        this._pendingCmdFlags |= OWNER_CMD_JOG;
        break;
      case Gait.WALK:
        this._pendingCmdFlags |= OWNER_CMD_WALK;
        break;
      case Gait.STROLL:
        this._pendingCmdFlags |= OWNER_CMD_STROLL;
        break;
      case Gait.WANDER:
        this._pendingCmdFlags |= OWNER_CMD_WANDER;
        break;
      default:
        break;
    }
  }

  /**
   * Steps the owner through the Wasm OwnerSimBuffer authority. Writes inputs,
   * calls step_owner_buffer(), hydrates outputs, and returns the event bitmask.
   * Returns null when the Wasm buffer is unavailable (caller uses JS fallback).
   */
  _stepOwnerWasm(dt, field) {
    const buf = this._getOwnerBuffer();
    if (!buf) return null;
    this._seedOwnerBuffer(buf);

    // Inputs: steering vector + queued command flags (consumed this step).
    buf[OWNER_SLOT_INPUT_X] = this._inputX;
    buf[OWNER_SLOT_INPUT_Y] = this._inputY;
    buf[OWNER_SLOT_CMD_FLAGS] = this._pendingCmdFlags >>> 0;
    this._pendingCmdFlags = 0;

    // Step the authoritative sim with the exact generated signature: step_owner_buffer(dt_s).
    let events = 0;
    try {
      events = getWasmSim().step_owner_buffer(dt) >>> 0;
    } catch (e) {
      return null;
    }

    // Re-acquire the view in case memory.grow() detached the previous buffer.
    const outBuf = this._getOwnerBuffer() || buf;

    this._hydrateFromOwnerBuffer(outBuf, events);
    return events;
  }

  // --- Wander mode (autopilot stroll) ---

  getWanderSpeed() {
    return GAIT_SPEEDS[WANDER_SPEED] || 0;
  }

  // Resolve the list of warp gates available in the current world.
  _getWarpGates(world) {
    if (!world) return [];
    if (Array.isArray(world.warpGates)) return world.warpGates;
    if (world.zoneConfig && Array.isArray(world.zoneConfig.warpGates)) {
      return world.zoneConfig.warpGates;
    }
    return [];
  }

  // Pick the next warp gate to journey toward. Prefers gates whose
  // targetZoneId differs from the zone we most recently arrived from so the
  // owner journeys through all locations one after another.
  _pickWanderWarpGate(world) {
    const gates = this._getWarpGates(world);
    if (!gates.length) return null;

    const candidates = gates.filter(g =>
      g && g.targetZoneId && g.targetZoneId !== this.lastArrivedFromZoneId
    );
    const pool = candidates.length ? candidates : gates;

    // Prefer the closest candidate so the journey feels natural.
    let best = null;
    let bestDistSq = Infinity;
    for (const g of pool) {
      if (!g || typeof g.x !== 'number' || typeof g.y !== 'number') continue;
      const dx = g.x - this.x;
      const dy = g.y - this.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = g;
      }
    }
    return best;
  }

  // Probe a point ahead of the owner for world-boundary or obstacle blockage.
  // Returns true when the probe point is blocked.
  _isWanderProbeBlocked(px, py, world) {
    if (!world) return false;

    const selfRadius = (this.radius || 16);
    const clearancePad = 10;

    // World bounds check (respect owner radius + small margin)
    const w = (typeof world.width === 'number') ? world.width : null;
    const h = (typeof world.height === 'number') ? world.height : null;
    if (w !== null && h !== null) {
      const margin = selfRadius + 16;
      if (px < margin || py < margin || px > w - margin || py > h - margin) {
        return true;
      }
    }

    // Real Field getWorldObstacles() check (circles & rects)
    if (typeof world.getWorldObstacles === 'function') {
      const worldObs = world.getWorldObstacles();
      if (Array.isArray(worldObs)) {
        for (const o of worldObs) {
          if (!o || typeof o.x !== 'number' || typeof o.y !== 'number') continue;
          if (o.kind === 'rect' || o.type === 'rect' || o.shape === 'rect') {
            const baseHw = typeof o.hw === 'number' ? o.hw : (typeof o.w === 'number' ? o.w / 2 : 20);
            const baseHh = typeof o.hh === 'number' ? o.hh : (typeof o.h === 'number' ? o.h / 2 : 15);
            const hw = baseHw + selfRadius + clearancePad;
            const hh = baseHh + selfRadius + clearancePad;
            if (Math.abs(px - o.x) < hw && Math.abs(py - o.y) < hh) return true;
          } else {
            const baseR = typeof o.r === 'number' ? o.r : (typeof o.radius === 'number' ? o.radius : 20);
            const reach = baseR + selfRadius + clearancePad;
            const dx = px - o.x;
            const dy = py - o.y;
            if (dx * dx + dy * dy < reach * reach) return true;
          }
        }
      }
    }

    // Direct Field scenery arrays check (trees, benches, bins, waterTower, rockOutcrops, landmarks)
    if (Array.isArray(world.trees)) {
      for (const t of world.trees) {
        if (!t || typeof t.x !== 'number') continue;
        const ty = (typeof t.depthY === 'number') ? t.depthY : t.y;
        if (typeof ty !== 'number') continue;
        const tr = (typeof t.trunkRadius === 'number') ? t.trunkRadius : ((typeof t.radius === 'number') ? t.radius * 0.28 : 18);
        const reach = tr + selfRadius + clearancePad;
        const dx = px - t.x;
        const dy = py - ty;
        if (dx * dx + dy * dy < reach * reach) return true;
      }
    }
    if (Array.isArray(world.benches)) {
      for (const b of world.benches) {
        if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') continue;
        const isVertical = b.angle && Math.abs(Math.sin(b.angle)) > 0.7;
        const hw = ((isVertical ? b.h : b.w) || 64) / 2 + selfRadius + clearancePad;
        const hh = ((isVertical ? b.w : b.h) || 26) / 2 + selfRadius + clearancePad;
        if (Math.abs(px - b.x) < hw && Math.abs(py - b.y) < hh) return true;
      }
    }
    if (Array.isArray(world.bins)) {
      for (const b of world.bins) {
        if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') continue;
        const reach = (typeof b.radius === 'number' ? b.radius : (typeof b.r === 'number' ? b.r : 12)) + selfRadius + clearancePad;
        const dx = px - b.x;
        const dy = py - b.y;
        if (dx * dx + dy * dy < reach * reach) return true;
      }
    }
    if (world.waterTower && typeof world.waterTower.x === 'number' && typeof world.waterTower.y === 'number') {
      const reach = (typeof world.waterTower.radius === 'number' ? world.waterTower.radius : (typeof world.waterTower.r === 'number' ? world.waterTower.r : 42)) + selfRadius + clearancePad;
      const dx = px - world.waterTower.x;
      const dy = py - world.waterTower.y;
      if (dx * dx + dy * dy < reach * reach) return true;
    }
    if (Array.isArray(world.rockOutcrops)) {
      for (const r of world.rockOutcrops) {
        if (!r || typeof r.x !== 'number') continue;
        const ry = (typeof r.depthY === 'number') ? (r.depthY - 8) : r.y;
        if (typeof ry !== 'number') continue;
        const reach = (typeof r.r === 'number' ? r.r : (typeof r.radius === 'number' ? r.radius : 24)) + selfRadius + clearancePad;
        const dx = px - r.x;
        const dy = py - ry;
        if (dx * dx + dy * dy < reach * reach) return true;
      }
    }
    if (Array.isArray(world.landmarks)) {
      for (const l of world.landmarks) {
        if (!l || typeof l.x !== 'number') continue;
        const ly = (typeof l.depthY === 'number') ? l.depthY : l.y;
        if (typeof ly !== 'number') continue;
        const reach = (typeof l.radius === 'number' ? l.radius : (typeof l.r === 'number' ? l.r : 32)) + selfRadius + clearancePad;
        const dx = px - l.x;
        const dy = py - ly;
        if (dx * dx + dy * dy < reach * reach) return true;
      }
    }

    // Obstacle colliders check (world.getColliders() and/or world.colliders)
    const collidersList = [];
    if (typeof world.getColliders === 'function') {
      const gc = world.getColliders();
      if (Array.isArray(gc)) collidersList.push(...gc);
    }
    if (Array.isArray(world.colliders)) {
      collidersList.push(...world.colliders);
    }
    for (const c of collidersList) {
      if (!c) continue;
      const cx = (typeof c.x === 'number') ? c.x : null;
      const cy = (typeof c.y === 'number') ? c.y : null;
      if (cx === null || cy === null) continue;
      const cr = (typeof c.radius === 'number') ? c.radius : (typeof c.r === 'number' ? c.r : 0);
      const reach = cr + selfRadius + clearancePad;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy < reach * reach) return true;
    }

    // World obstacles (rectangular) check
    const obstacles = Array.isArray(world.obstacles) ? world.obstacles : null;
    if (obstacles) {
      for (const o of obstacles) {
        if (!o) continue;
        const ox = (typeof o.x === 'number') ? o.x : null;
        const oy = (typeof o.y === 'number') ? o.y : null;
        if (ox === null || oy === null) continue;
        const ow = (typeof o.w === 'number') ? o.w : (typeof o.width === 'number' ? o.width : 0);
        const oh = (typeof o.h === 'number') ? o.h : (typeof o.height === 'number' ? o.height : 0);
        const pad = (this.radius || 16);
        if (px > ox - pad && px < ox + ow + pad && py > oy - pad && py < oy + oh + pad) {
          return true;
        }
      }
    }

    return false;
  }

  // Multi-sample corridor check: probes several points along a ray from the
  // owner's current position in the given heading. Returns true if any sample
  // is blocked.
  _isWanderRayBlocked(heading, maxDist = WANDER_LOOKAHEAD_PX, world = null, sampleCount = 4) {
    let resolvedWorld = world;
    let resolvedDist = maxDist;
    if (typeof maxDist === 'object' && maxDist !== null) {
      resolvedWorld = maxDist;
      resolvedDist = (typeof world === 'number') ? world : WANDER_LOOKAHEAD_PX;
    }
    if (!resolvedWorld) return false;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const count = (typeof sampleCount === 'number' && sampleCount > 0) ? Math.floor(sampleCount) : 4;
    for (let i = 1; i <= count; i++) {
      const dist = resolvedDist * (i / count);
      if (this._isWanderProbeBlocked(this.x + cosH * dist, this.y + sinH * dist, resolvedWorld)) {
        return true;
      }
    }
    return false;
  }

  // Per-frame autopilot stepper. Advances a smooth meandering heading at
  // Gait.STROLL speed, steering away from obstacles and world boundaries.
  updateWander(dt, world) {
    if (!this.wanderMode) return;

    // When the Wasm owner buffer is active, the authoritative sim drives the
    // wander autopilot. Queue the WANDER command and let step_owner_buffer()
    // steer; the JS fallback below is skipped.
    if (this._ownerBuffer) {
      this._pendingCmdFlags |= OWNER_CMD_WANDER;
      return;
    }

    // Advance drift phase
    this.wanderPhase += WANDER_DRIFT_FREQUENCY * Math.PI * 2 * dt;

    const probeDist = WANDER_LOOKAHEAD_PX;

    // Warp-journey steering: bias the base heading toward the next warp gate.
    const gate = this._pickWanderWarpGate(world);
    if (gate) {
      const gateAngle = Math.atan2(gate.y - this.y, gate.x - this.x);
      if (!this._isWanderRayBlocked(gateAngle, probeDist, world)) {
        // Direct corridor to the gate is clear: smoothly rotate toward it.
        const gateDelta = angleDelta(this.wanderBaseHeading, gateAngle);
        const gateTurn = Math.min(Math.abs(gateDelta), 1.8 * dt);
        this.wanderBaseHeading += Math.sign(gateDelta) * gateTurn;
      }
      // Else: keep the current base heading steady until clear of the
      // obstacle so we do not pull back into the tree.
    }

    // Base target heading (no sinusoidal weaving).
    let targetHeading = this.wanderBaseHeading;

    // Multi-sample corridor check: if the base heading is blocked, search a
    // fan of candidate offsets and pick the unblocked one closest to the
    // owner's current heading (prevents left/right oscillation).
    if (this._isWanderRayBlocked(targetHeading, probeDist, world)) {
      const offsets = [
        Math.PI / 12, -Math.PI / 12,
        Math.PI / 6, -Math.PI / 6,
        Math.PI / 4, -Math.PI / 4,
        Math.PI / 3, -Math.PI / 3,
        Math.PI / 2, -Math.PI / 2,
        (2 * Math.PI) / 3, -(2 * Math.PI) / 3
      ];
      let chosen = null;
      let bestAngularDist = Infinity;
      for (const off of offsets) {
        const testHeading = targetHeading + off;
        if (!this._isWanderRayBlocked(testHeading, probeDist, world)) {
          const angDist = Math.abs(angleDelta(this.angle, testHeading));
          if (angDist < bestAngularDist) {
            bestAngularDist = angDist;
            chosen = testHeading;
          }
        }
      }
      if (chosen !== null) {
        targetHeading = chosen;
        // Steer the base heading toward the chosen tangent at the max turn
        // rate so we do not re-target the obstacle every frame.
        const baseDelta = angleDelta(this.wanderBaseHeading, chosen);
        this.wanderBaseHeading += Math.sign(baseDelta) *
          Math.min(Math.abs(baseDelta), WANDER_MAX_TURN_RATE * dt);
      } else {
        // Fully boxed in: reverse the base heading to escape.
        this.wanderBaseHeading += Math.PI;
        targetHeading = this.wanderBaseHeading;
      }
    }

    this.wanderTargetHeading = targetHeading;

    // Clamp heading change to the wander max turn rate.
    const maxStep = WANDER_MAX_TURN_RATE * dt;
    const delta = angleDelta(this.angle, targetHeading);
    if (Math.abs(delta) <= maxStep) {
      this.angle = targetHeading;
    } else {
      this.angle += Math.sign(delta) * maxStep;
    }
    this.angle = ((this.angle + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (this.angle < -Math.PI) this.angle += Math.PI * 2;

    // Keep targetHeading synced so external readers see the wander intent.
    this.targetHeading = this.angle;

    // Force WANDER gait while wandering. Route through setGait so that
    // leaving JOG starts the normal JOG_COOLDOWN, isMoving is synced, and
    // onGaitChange fires for downstream consumers (e.g. speed badges).
    if (this.gait !== Gait.WANDER) {
      this.setGait(Gait.WANDER);
    }
    this.stepOffActive = false;
    this.stepOffTimer = 0;
  }

  // --- Heading integration ---

  _updateHeading(dt) {
    if (this.gait === Gait.STAND) {
      this.angle = this.targetHeading;
      return;
    }

    const delta = angleDelta(this.angle, this.targetHeading);
    const absDelta = Math.abs(delta);

    // Determine max turn rate
    let maxRate = GAIT_TURN_RATES[this.gait] || GAIT_TURN_RATES[Gait.WALK];
    // The 300 deg/s step-off rate applies strictly to the STAND -> STROLL transition.
    if (this.stepOffActive && this.gait === Gait.STROLL) {
      if (absDelta <= STEP_OFF_ALIGN_TOLERANCE || this.stepOffTimer <= 0) {
        this.stepOffActive = false;
        this.stepOffTimer = 0;
      } else {
        maxRate = STEP_OFF_TURN_RATE;
      }
    } else if (this.stepOffActive) {
      // Any other gait cancels the step-off window
      this.stepOffActive = false;
      this.stepOffTimer = 0;
    }

    const maxStep = maxRate * dt;
    if (absDelta <= maxStep) {
      this.angle = this.targetHeading;
    } else {
      this.angle += Math.sign(delta) * maxStep;
    }

    // Normalize angle to [-PI, PI]
    this.angle = ((this.angle + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (this.angle < -Math.PI) this.angle += Math.PI * 2;
  }

  // --- Rear brake arc helper ---

  isPointOnRearBrakeArc(worldX, worldY) {
    if (this.gait === Gait.STAND) return false;

    // Match the rendered ground halo ellipse geometry (see drawGroundHalo)
    const centerX = this.x;
    const centerY = this.y + 12;
    const Rx = 22;
    const Ry = 12.1;

    const dx = worldX - centerX;
    const dy = worldY - centerY;

    // Normalized elliptical distance
    const normDist = Math.hypot(dx / Rx, dy / Ry);
    if (normDist < 0.7 || normDist > 3.5) return false;

    // Normalized angle in ellipse space
    const normAngle = Math.atan2(dy / Ry, dx / Rx);
    const rearHeading = this.angle + Math.PI;
    const delta = Math.abs(angleDelta(rearHeading, normAngle));

    const halfSpan = (110 * Math.PI) / 180 / 2; // ~55 deg each side
    return delta <= halfSpan;
  }

  isPointOnPlayer(worldX, worldY) {
    const dx = worldX - this.x;
    const dy = worldY - this.y;
    return (dx * dx + dy * dy) < (PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS);
  }

  setChat(text, duration = 4.0) {
    this.chatText = text;
    this.chatTimer = duration;
  }

  setEmote(emote, duration = 3.0) {
    this.emote = emote;
    this.emoteTimer = duration;
  }

  triggerPet(duration = 0.8) {
    this.isPetting = true;
    this.petTimer = duration;
  }

  triggerPickup(duration = 0.8) {
    this.isBending = true;
    this.bendTimer = duration;
  }

  update(dt, field) {
    // Remote peers are driven authoritatively by the network interpolator.
    // Only the local owner integrates movement, gait, turning and collisions.
    if (!this.isLocal) {
      this.depthY = this.y + 12;
      return;
    }

    // --- Wasm authority path -------------------------------------------------------------
    // When the Wasm owner buffer is available, delegate locomotion/gait/wander/leash
    // stepping to step_owner_buffer() and hydrate the JS state from the result.
    if (this._getOwnerBuffer()) {
      const events = this._stepOwnerWasm(dt, field);
      if (events !== null) {
        // Advance the leash arm pose state from the hydrated values.
        if (this.isLeashed) {
          this.leashArmExtensionPx = lerpNum(
            LEASH_ARM_BASE_REACH_PX,
            LEASH_ARM_MAX_REACH_PX,
            this.leashArmTension
          );
        } else {
          this.leashArmTension = 0;
          this.leashArmExtensionPx = LEASH_ARM_BASE_REACH_PX;
        }

        this.depthY = this.y + 12;

        // Update timers (petting, bending, chat, emote) — these are JS-only.
        if (this.petTimer > 0) {
          this.petTimer -= dt;
          if (this.petTimer <= 0) this.isPetting = false;
        }
        if (this.bendTimer > 0) {
          this.bendTimer -= dt;
          if (this.bendTimer <= 0) this.isBending = false;
        }
        if (this.chatTimer > 0) {
          this.chatTimer -= dt;
          if (this.chatTimer <= 0) this.chatText = null;
        }
        if (this.emoteTimer > 0) {
          this.emoteTimer -= dt;
          if (this.emoteTimer <= 0) this.emote = null;
        }
        return;
      }
    }

    // 0. Leash state: while the dog is pooping on-leash the owner may still
    //    walk inside the MAX_LEASH_LENGTH radius. The owner is only stopped
    //    once the leash goes taut at the limit (handled after integration).
    const leashDog = this.dog || null;
    const leashActive = Boolean(leashDog && leashDog.isOnLeash);

    // 1. Gait persists autonomously until changed via setGait / stepGait.
    //    (Legacy directional key handling removed in movement redesign.)

    // 2. Advance gait timers
    // Decrement cooldown BEFORE the JOG expiry check so a cooldown that is
    // freshly initialised this tick is not decremented on the same tick.
    if (this.jogCooldown > 0) {
      this.jogCooldown = Math.max(0, this.jogCooldown - dt);
    }
    if (this.jogTimer > 0) {
      this.jogTimer -= dt;
      if (this.jogTimer <= 0) {
        this.jogTimer = 0;
        if (this.gait === Gait.JOG) {
          // Expire JOG -> WALK and start cooldown (do not decrement this tick)
          this.setGait(Gait.WALK);
          this.jogCooldown = JOG_COOLDOWN;
        }
      }
    }
    if (this.stepOffActive) {
      this.stepOffTimer = Math.max(0, this.stepOffTimer - dt);
    }

    // 3. Wander mode overrides normal heading integration.
    if (this.wanderMode) {
      this.updateWander(dt, field);
    } else {
      this._updateHeading(dt);
    }
    // Keep the wander heading mirror in sync for external readers.
    this.wanderHeading = this.wanderMode ? this.wanderBaseHeading : this.angle;

    // 4. Compute velocity from gait speed and current angle
    const speed = this.getCurrentSpeed();
    if (speed > 0) {
      this.vx = Math.cos(this.angle) * speed;
      this.vy = Math.sin(this.angle) * speed;
      this.isMoving = true;
    } else {
      this.vx = 0;
      this.vy = 0;
      this.isMoving = false;
    }

    // Record the pre-integration position so the walk stride cadence can be
    // scaled by the ACTUAL ground displacement (held back by the leash).
    const prevX = this.x;
    const prevY = this.y;

    // Step-off alignment gate: hold position until facing target heading.
    if (this.stepOffActive) {
      const alignErr = Math.abs(angleDelta(this.angle, this.targetHeading));
      if (alignErr > STEP_OFF_ALIGN_TOLERANCE) {
        this.vx = 0;
        this.vy = 0;
      } else {
        this.stepOffActive = false;
      }
    }
    // Keep isMoving boolean in sync with gait for Protocol.createSyncState & rendering
    this.isMoving = this.gait !== Gait.STAND;

    // Apply movement
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Resolve world obstacle & boundary collisions with result contract
    if (field && typeof field.resolveCollisionWithResult === 'function') {
      const res = field.resolveCollisionWithResult(this.x, this.y, this.radius, this.targetHeading);
      if (res) {
        this.x = res.x;
        this.y = res.y;
        if (res.kind === 'boundary') {
          this.setGait(Gait.STAND);
        } else if (res.kind === 'obstacle' && res.deflectedHeading !== undefined) {
          this.setTargetHeading(res.deflectedHeading);
        }
      }
    } else if (field) {
      resolveFieldCollision(this, this.radius, field);
    }

    // Re-sync motion flags after collision resolution so a boundary stop
    // never leaves stale velocity or isMoving state behind.
    this.isMoving = this.gait !== Gait.STAND;
    if (!this.isMoving) {
      this.vx = 0;
      this.vy = 0;
    }

    // Leash tether: clamp the owner within MAX_LEASH_LENGTH of the dog while
    // on-leash. Off-leash movement bypasses the clamp entirely.
    if (leashActive) {
      const dist = Math.hypot(this.x - leashDog.x, this.y - leashDog.y);
      const clamped = clampOwnerToLeash(
        { x: this.x, y: this.y },
        { x: leashDog.x, y: leashDog.y },
        MAX_LEASH_LENGTH
      );
      if (clamped) {
        this.x = clamped.x;
        this.y = clamped.y;
      }
      // On-leash pooping: once the owner hits the taut leash limit while the
      // dog is pooping, force the owner to stop walking.
      if (leashDog.isPooping && dist >= MAX_LEASH_LENGTH - 1e-3) {
        this.setGait(Gait.STAND);
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
      }
    }

    // Advance the walk stride cadence using the ACTUAL ground displacement so
    // the owner's legs walk slowly when held back by a slow dog and stop
    // pumping when stopped at the leash limit.
    const actualDist = Math.hypot(this.x - prevX, this.y - prevY);
    const actualSpeed = dt > 0 ? actualDist / dt : 0;
    if (actualSpeed > 2) {
      const cadence = 4.0 + (actualSpeed / 265) * 8.0;
      this.walkPhase += dt * cadence;
    }

    // Update leash arm pose state (tension + extension) each frame.
    if (this.isLeashed) {
      const dog = this.dog || null;
      this.leashDistance = dog ? Math.hypot(dog.x - this.x, dog.y - this.y) : 0;
      this.leashArmTension = this.getLeashTension();
      this.leashArmExtensionPx = lerpNum(
        LEASH_ARM_BASE_REACH_PX,
        LEASH_ARM_MAX_REACH_PX,
        this.leashArmTension
      );
    } else {
      this.leashArmTension = 0;
      this.leashArmExtensionPx = LEASH_ARM_BASE_REACH_PX;
    }

    this.depthY = this.y + 12;

    // Update timers
    if (this.petTimer > 0) {
      this.petTimer -= dt;
      if (this.petTimer <= 0) this.isPetting = false;
    }

    if (this.bendTimer > 0) {
      this.bendTimer -= dt;
      if (this.bendTimer <= 0) this.isBending = false;
    }

    if (this.chatTimer > 0) {
      this.chatTimer -= dt;
      if (this.chatTimer <= 0) this.chatText = null;
    }

    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) this.emote = null;
    }
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
    ctx.save();

    const angle = this.angle !== undefined ? this.angle : Math.PI / 2;

    // Ground halo (drawn first, beneath everything)
    this.drawGroundHalo(ctx, angle);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Animated kneeling/bending pose when petting or picking up waste
    const isKneeling = this.isPetting || this.isBending;
    const kneelProgress = isKneeling
      ? Math.sin(Math.min(1.0, Math.max(0, (this.petTimer || this.bendTimer || 0.4) / 0.8)) * Math.PI)
      : 0;
    const kneelDrop = kneelProgress * 7;
    const kneelLeanX = cosA * kneelProgress * 6;
    const kneelLeanY = sinA * kneelProgress * 4;

    // 1. Soft ground drop shadow (directionally oriented and widens when kneeling)
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(
      this.x + kneelLeanX * 0.4,
      this.y + 14 + kneelDrop * 0.3,
      15 + kneelProgress * 3,
      7 + kneelProgress * 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // 2. Directional Shoulder/Hip Axes:
    // Transverse axis perpendicular to facing direction with 2.5D vertical foreshortening
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

    // Walk phase strides
    const legSwing = this.isMoving ? Math.sin(this.walkPhase) * 6.5 : 0;
    const armSwing = this.isMoving ? Math.cos(this.walkPhase) * 5.5 : 0;

    const torsoX = this.x + kneelLeanX;
    const torsoY = this.y - 3 + kneelDrop;

    // Helper for legs
    const drawLeg = (hipX, hipY, swing, isFar) => {
      ctx.save();
      const strideX = cosA * swing * 0.45;
      const strideY = sinA * swing * 0.45 + (Math.abs(swing) * 0.4);
      const lx = this.x + hipX + strideX;
      const ly = this.y + 1 + hipY + (isKneeling ? (isFar ? kneelDrop * 0.7 : kneelDrop * 0.3) : strideY);

      // Pants
      ctx.fillStyle = isFar ? this.getShadedColor(this.pantsColor, -0.15) : this.pantsColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - 2.8, ly, 5.6, 9 - (isKneeling ? kneelProgress * 3 : 0), 2);
      } else {
        ctx.rect(lx - 2.8, ly, 5.6, 9);
      }
      ctx.fill();

      // Shoe
      ctx.fillStyle = isFar ? this.getShadedColor(this.shoeColor, -0.15) : this.shoeColor;
      ctx.beginPath();
      const shoeW = Math.abs(cosA) > 0.4 ? 7.8 : 6.8;
      const shoeH = 5.0;
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - 3.2 + cosA * 1.5, ly + 8 - (isKneeling ? kneelProgress * 3 : 0), shoeW, shoeH, 2.5);
      } else {
        ctx.rect(lx - 3.2, ly + 8, shoeW, shoeH);
      }
      ctx.fill();

      // Shoe sole stripe
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(lx - 3.2 + cosA * 1.5, ly + 12 - (isKneeling ? kneelProgress * 3 : 0), shoeW, 1.2);
      ctx.restore();
    };

    // Helper for arms
    const drawArm = (shX, shY, swing, isFar, isLeashArm = false) => {
      ctx.save();
      const ax = torsoX + shX;
      const ay = torsoY - 7 + shY;

      const strokeCol = (isFar && !isLeashArm)
        ? this.getShadedColor(this.jacketColor, -0.18)
        : this.jacketColor;
      ctx.fillStyle = strokeCol;

      if (isLeashArm && this.isLeashed) {
        // Leash-holding arm: bent elbow reaching toward the dog's flank.
        const local = this.computeLeashHandLocal();
        const c = cosA;
        const s = sinA;
        // Convert owner-local (forward, right) to world offset.
        const handWorldX = local.x * c - local.y * s;
        const handWorldY = local.x * s + local.y * c;
        const handX = this.x + handWorldX;
        const handY = this.y - 3 + handWorldY;

        // Rigid arm: elbow is the straight midpoint from shoulder to hand.
        // Only the "dog behind and to the right" pose applies a subtle bend.
        let elbowX = (ax + handX) / 2;
        let elbowY = (ay + handY) / 2;
        if (local.hasElbowBend) {
          elbowX += (local.elbowBendScreenX || 0);
          elbowY += (local.elbowBendScreenY || 0);
        }

        // Upper arm (shoulder -> elbow)
        ctx.strokeStyle = this.jacketColor;
        ctx.lineWidth = 4.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(elbowX, elbowY);
        ctx.stroke();

        // Forearm (elbow -> hand)
        ctx.beginPath();
        ctx.moveTo(elbowX, elbowY);
        ctx.lineTo(handX, handY);
        ctx.stroke();

        // Grip hand
        ctx.fillStyle = this.skinTone;
        ctx.beginPath();
        ctx.arc(handX, handY, LEASH_ARM_HAND_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();

        // Short thumb stroke across the grip
        ctx.strokeStyle = this.getShadedColor(this.skinTone, -0.15);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(handX - 1.5, handY - 1.5);
        ctx.lineTo(handX + 1.5, handY + 1.5);
        ctx.stroke();

        ctx.restore();
        return;
      }

      if (isKneeling && !isFar) {
        // Kneeling / bending gesture: arm reaches down toward pet or waste
        ctx.beginPath();
        ctx.moveTo(ax - 2.5, ay);
        ctx.lineTo(ax + 2.5, ay);
        ctx.lineTo(ax + cosA * 6 + 2, ay + 13);
        ctx.lineTo(ax + cosA * 6 - 2, ay + 13);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = this.skinTone;
        ctx.beginPath();
        ctx.arc(ax + cosA * 6, ay + 14.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const reachX = cosA * swing * 0.4;
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
      }
      ctx.restore();
    };

    // Determine which shoulder is the leash-holding side.
    const leashSideSign = this.leashHandSide === 'left' ? -1 : 1;
    const leftIsLeashArm = this.isLeashed && leashSideSign === -1;
    const rightIsLeashArm = this.isLeashed && leashSideSign === 1;

    // --- DEPTH LAYER 1: Far Arm & Far Leg (behind torso) ---
    // The leash arm must never be shaded dark blue when facing South/East/West
    // (sinA >= -0.2); it is promoted to the near layer instead.
    const promoteLeashArm = sinA >= -0.2;
    if (leftIsFar) {
      drawLeg(-perpX * hipSpan, -perpY * hipSpan, legSwing, true);
      if (!(leftIsLeashArm && promoteLeashArm)) {
        drawArm(leftShoulderX, leftShoulderY, -armSwing, true, leftIsLeashArm);
      }
    } else {
      drawLeg(perpX * hipSpan, perpY * hipSpan, -legSwing, true);
      if (!(rightIsLeashArm && promoteLeashArm)) {
        drawArm(rightShoulderX, rightShoulderY, armSwing, true, rightIsLeashArm);
      }
    }

    // --- DEPTH LAYER 2: Accessory (Backpack when facing South / from front) ---
    if (this.accessory === 'BACKPACK' && sinA > 0.25) {
      this.drawBackpack(ctx, torsoX, torsoY, angle, true);
    }

    // --- DEPTH LAYER 3: 3D Directional Torso / Jacket ---
    ctx.save();
    ctx.translate(torsoX, torsoY);
    ctx.rotate(angle - Math.PI / 2); // Orient so angle = Math.PI / 2 (South) has zero rotation

    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(-10.5, -9, 21, 18, 5);
    } else {
      ctx.rect(-10.5, -9, 21, 18);
    }
    ctx.fill();

    // 3D elliptical thickness shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.ellipse(0, 7, 10.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // Restore torso local transform

    // Torso Front Details if facing South / towards camera
    if (sinA > -0.2) {
      ctx.save();
      ctx.translate(torsoX, torsoY);

      // White inner shirt neckline
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-4, -9);
      ctx.lineTo(4, -9);
      ctx.lineTo(0, -3);
      ctx.closePath();
      ctx.fill();

      // Lapels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
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

      // Jacket zipper / seam line
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(0, 8);
      ctx.stroke();

      ctx.restore();
    } else {
      // Facing North / away from camera: Back jacket seams
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

    // --- DEPTH LAYER 4: Accessory (Backpack when facing North/Side, Scarf, or Hoodie) ---
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
    // Every arm is drawn exactly once: the near arm always renders in front.
    // A leash arm promoted from the far layer is drawn here with isFar = false
    // so it uses the normal bright jacket color.
    if (leftIsFar) {
      drawLeg(perpX * hipSpan, perpY * hipSpan, -legSwing, false);
      drawArm(rightShoulderX, rightShoulderY, armSwing, false, rightIsLeashArm);
      if (leftIsLeashArm && promoteLeashArm) {
        drawArm(leftShoulderX, leftShoulderY, -armSwing, false, leftIsLeashArm);
      }
    } else {
      drawLeg(-perpX * hipSpan, -perpY * hipSpan, legSwing, false);
      drawArm(leftShoulderX, leftShoulderY, -armSwing, false, leftIsLeashArm);
      if (rightIsLeashArm && promoteLeashArm) {
        drawArm(rightShoulderX, rightShoulderY, armSwing, false, rightIsLeashArm);
      }
    }

    // --- DEPTH LAYER 6: Head, Face, Ears & Hairstyle ---
    this.drawHeadAndFace(ctx, torsoX, torsoY, angle, cosA, sinA, kneelDrop);

    // --- DEPTH LAYER 7: Nametag Badge ---
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const displayNametag = this.isLocal ? `${this.name} (You)` : this.name;
    const textWidth = ctx.measureText(displayNametag).width;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x - textWidth / 2 - 6, this.y - 42 + kneelDrop, textWidth + 12, 16, 8);
    } else {
      ctx.rect(this.x - textWidth / 2 - 6, this.y - 42 + kneelDrop, textWidth + 12, 16);
    }
    ctx.fill();

    ctx.fillStyle = this.isLocal ? '#fde047' : '#f8fafc';
    ctx.fillText(displayNametag, this.x, this.y - 30 + kneelDrop);

    // --- DEPTH LAYER 8: Speech Bubble or Emote ---
    if (this.chatText) {
      this.drawSpeechBubble(ctx, this.chatText);
    } else if (this.emote) {
      this.drawEmoteBubble(ctx, this.emote);
    }

    ctx.restore();
  }

  drawGroundHalo(ctx, angle) {
    ctx.save();

    const cx = this.x;
    const cy = this.y + 12;
    const radius = 22;

    // Base halo ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Forward arrowhead on front perimeter
    const frontX = cx + Math.cos(angle) * radius;
    const frontY = cy + Math.sin(angle) * radius * 0.55;
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle) * 0.55;
    const arrowSize = 5;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(frontX + Math.cos(angle) * arrowSize, frontY + Math.sin(angle) * arrowSize * 0.55);
    ctx.lineTo(frontX + perpX * arrowSize, frontY + perpY * arrowSize);
    ctx.lineTo(frontX - perpX * arrowSize, frontY - perpY * arrowSize);
    ctx.closePath();
    ctx.fill();

    // Faint target indicator when turning and misaligned
    if (this.gait !== Gait.STAND) {
      const misalign = Math.abs(angleDelta(this.angle, this.targetHeading));
      if (misalign > (10 * Math.PI) / 180) {
        const tx = cx + Math.cos(this.targetHeading) * radius;
        const ty = cy + Math.sin(this.targetHeading) * radius * 0.55;
        ctx.fillStyle = 'rgba(253, 224, 71, 0.45)';
        ctx.beginPath();
        ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Enlarged rear brake sector (hidden in STAND unless a brake flash is
    // currently active, e.g. after a single-click or double-click stop).
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const isBrakeFlashing = Boolean(
      this.brakeLightFeedback &&
      this.brakeLightFeedback.active &&
      (now - this.brakeLightFeedback.startedAt) < this.brakeLightFeedback.durationMs
    );
    if (this.gait !== Gait.STAND || isBrakeFlashing) {
      const baseX = radius;         // 22
      const baseY = radius * 0.55;  // 12.1
      const outerScale = 3.5;
      const rearHeading = this.angle + Math.PI;
      const halfSpan = (110 * Math.PI) / 180 / 2;
      const startAngle = rearHeading - halfSpan;
      const endAngle = rearHeading + halfSpan;

      // Brake-light feedback pulse: brighten the sector briefly on brake.
      let fillAlpha = 0.20;
      let strokeAlpha = 0.55;
      if (this.brakeLightFeedback && this.brakeLightFeedback.active) {
        const elapsed = now - this.brakeLightFeedback.startedAt;
        if (elapsed < this.brakeLightFeedback.durationMs) {
          const decay = 1.0 - (elapsed / this.brakeLightFeedback.durationMs);
          fillAlpha = 0.20 + (this.brakeLightFeedback.peakFillAlpha - 0.20) * decay;
          strokeAlpha = 0.55 + (this.brakeLightFeedback.peakStrokeAlpha - 0.55) * decay;
        } else {
          this.brakeLightFeedback.active = false;
        }
      }

      // Filled wedge from origin across the full sector
      ctx.fillStyle = `rgba(239, 68, 68, ${fillAlpha})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const t = startAngle + (i / steps) * (endAngle - startAngle);
        const px = cx + Math.cos(t) * baseX * outerScale;
        const py = cy + Math.sin(t) * baseY * outerScale;
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      // Contour arc at the outer ring of the sector
      ctx.strokeStyle = `rgba(239, 68, 68, ${strokeAlpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = startAngle + (i / steps) * (endAngle - startAngle);
        const px = cx + Math.cos(t) * baseX * outerScale;
        const py = cy + Math.sin(t) * baseY * outerScale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  drawBackpack(ctx, torsoX, torsoY, angle, isFront) {
    ctx.save();
    const packX = torsoX - Math.cos(angle) * 7.0;
    const packY = torsoY - Math.sin(angle) * 5.5;

    // Structured daypack body
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(packX - 7.5, packY - 8, 15, 16, 4);
    } else {
      ctx.rect(packX - 7.5, packY - 8, 15, 16);
    }
    ctx.fill();

    // Top pack flap with accent trim
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(packX - 7, packY - 8, 14, 6.5, 2.5);
    } else {
      ctx.rect(packX - 7, packY - 8, 14, 6.5);
    }
    ctx.fill();

    // Metallic buckle
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(packX - 1.5, packY - 2.5, 3.0, 2.5);

    // Side water bottle mesh pocket
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

    // Left strap
    ctx.beginPath();
    ctx.moveTo(torsoX - 6.5, torsoY - 8);
    ctx.lineTo(torsoX - 5.5, torsoY + 7);
    ctx.stroke();

    // Right strap
    ctx.beginPath();
    ctx.moveTo(torsoX + 6.5, torsoY - 8);
    ctx.lineTo(torsoX + 5.5, torsoY + 7);
    ctx.stroke();

    // Sternum strap across chest
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
    ctx.fillStyle = '#b91c1c'; // Warm crimson red
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoY - 8.5, 8.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trailing fluttering tail in the wind
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

  drawHeadAndFace(ctx, torsoX, torsoY, angle, cosA, sinA, kneelDrop) {
    const headX = this.x + (torsoX - this.x) * 0.8;
    const headY = this.y - 20 + kneelDrop;
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

        const beanieMain = '#c2410c';
        const beanieCuff = '#9a3412';
        ctx.fillStyle = beanieMain;
        ctx.beginPath();
        ctx.ellipse(headX, headY - 4, 10.0, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = beanieCuff;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(headX - 9.5, headY - 3, 19, 5.5, 2.5);
        } else {
          ctx.rect(headX - 9.5, headY - 3, 19, 5.5);
        }
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        for (let rx = -7.5; rx <= 7.5; rx += 2.5) {
          ctx.beginPath();
          ctx.moveTo(headX + rx, headY - 3);
          ctx.lineTo(headX + rx, headY + 2);
          ctx.stroke();
        }

        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(headX, headY - 12.5, 3.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(headX - 1, headY - 12.5, 2.2, 0, Math.PI * 2);
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

  drawSpeechBubble(ctx, text) {
    ctx.save();
    ctx.font = '500 12px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const textWidth = Math.min(200, ctx.measureText(text).width);
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

    // Triangle pointer
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

  drawEmoteBubble(ctx, emote) {
    ctx.save();
    const bx = this.x - 16;
    const by = this.y - 68;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, 32, 28, 8);
    } else {
      ctx.rect(bx, by, 32, 28);
    }
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(this.x - 4, by + 28);
    ctx.lineTo(this.x, by + 34);
    ctx.lineTo(this.x + 4, by + 28);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.fillText(emote, this.x, by + 20);
    ctx.restore();
  }
}

// Static exports for test/tooling access
Owner.GAIT_SPEEDS = GAIT_SPEEDS;
Owner.PLAYER_HIT_RADIUS = PLAYER_HIT_RADIUS;
Owner.STEP_OFF_ALIGN_TOLERANCE = STEP_OFF_ALIGN_TOLERANCE;
Owner.LEASH_ARM_SWING_SCALE = LEASH_ARM_SWING_SCALE;
Owner.LEASH_ARM_BASE_REACH_PX = LEASH_ARM_BASE_REACH_PX;
Owner.LEASH_ARM_MAX_REACH_PX = LEASH_ARM_MAX_REACH_PX;
Owner.LEASH_ARM_TENSION_RAMP_PX = LEASH_ARM_TENSION_RAMP_PX;
Owner.LEASH_ARM_SHOULDER_OFFSET_PX = LEASH_ARM_SHOULDER_OFFSET_PX;
Owner.LEASH_ARM_HAND_RADIUS_PX = LEASH_ARM_HAND_RADIUS_PX;
Owner.LEASH_ARM_SIDE_EXTEND_PX = LEASH_ARM_SIDE_EXTEND_PX;
Owner.LEASH_ARM_DROP_PX = LEASH_ARM_DROP_PX;
Owner.WANDER_SPEED = WANDER_SPEED;
Owner.WANDER_MAX_TURN_RATE = WANDER_MAX_TURN_RATE;
Owner.WANDER_DRIFT_AMPLITUDE = WANDER_DRIFT_AMPLITUDE;
Owner.WANDER_DRIFT_FREQUENCY = WANDER_DRIFT_FREQUENCY;
Owner.WANDER_LOOKAHEAD_PX = WANDER_LOOKAHEAD_PX;
Owner.OWNER_BUFFER_SLOTS = OWNER_BUFFER_SLOTS;
Owner.OWNER_GAIT_STAND = OWNER_GAIT_STAND;
Owner.OWNER_GAIT_STROLL = OWNER_GAIT_STROLL;
Owner.OWNER_GAIT_WALK = OWNER_GAIT_WALK;
Owner.OWNER_GAIT_JOG = OWNER_GAIT_JOG;
Owner.OWNER_GAIT_WANDER = OWNER_GAIT_WANDER;
Owner.OWNER_CMD_RESET = OWNER_CMD_RESET;
Owner.OWNER_CMD_STOP = OWNER_CMD_STOP;
Owner.OWNER_CMD_JOG = OWNER_CMD_JOG;
Owner.OWNER_CMD_WALK = OWNER_CMD_WALK;
Owner.OWNER_CMD_STROLL = OWNER_CMD_STROLL;
Owner.OWNER_CMD_WANDER = OWNER_CMD_WANDER;
Owner.OWNER_CMD_CLEAR_WANDER = OWNER_CMD_CLEAR_WANDER;
Owner.OWNER_CMD_FACE_DOG = OWNER_CMD_FACE_DOG;
Owner.OWNER_EVENT_GAIT_CHANGED = OWNER_EVENT_GAIT_CHANGED;
Owner.OWNER_EVENT_STEP_OFF_STARTED = OWNER_EVENT_STEP_OFF_STARTED;
Owner.OWNER_EVENT_STEP_OFF_FINISHED = OWNER_EVENT_STEP_OFF_FINISHED;
Owner.OWNER_EVENT_WANDER_STARTED = OWNER_EVENT_WANDER_STARTED;
Owner.OWNER_EVENT_WANDER_BLOCKED = OWNER_EVENT_WANDER_BLOCKED;
Owner.OWNER_EVENT_BOUNDARY_BLOCKED = OWNER_EVENT_BOUNDARY_BLOCKED;
Owner.OWNER_EVENT_OBSTACLE_DEFLECTED = OWNER_EVENT_OBSTACLE_DEFLECTED;
Owner.OWNER_EVENT_LEASH_FORCED_STAND = OWNER_EVENT_LEASH_FORCED_STAND;
Owner.OWNER_EVENT_JOG_STARTED = OWNER_EVENT_JOG_STARTED;
