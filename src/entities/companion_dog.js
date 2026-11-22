// Companion Dog Entity - Canine Steering AI, Floppy Ear Springs, Leash Mechanics & Ball Fetching
import { PoopPile } from './waste.js';
import { stepCompanionDogWasm, getWasmSim, stepLeashConstraint } from '../engine/wasm_sim_bridge.js';
import { MAX_LEASH_LENGTH } from '../world/leash.js';

export const DogState = {
  FOLLOWING: 'FOLLOWING',
  ROAMING: 'ROAMING',
  SOCIAL_GREET: 'SOCIAL_GREET',
  IDLE_SNIFF: 'IDLE_SNIFF',
  SITTING: 'SITTING',
  LYING_DOWN: 'LYING_DOWN',
  ROLLING: 'ROLLING',
  FETCHING: 'FETCHING',
  PLAY_BOW: 'PLAY_BOW',
  BARKING: 'BARKING',
  RECALLED: 'RECALLED',
  LOST: 'LOST',
  POOPING: 'POOPING',
  ZOOMIES: 'ZOOMIES',
  SNIFFING_TRAIL: 'SNIFFING_TRAIL',
  PACK_PLAY: 'PACK_PLAY'
};

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * Math.min(1, Math.max(0, t));
}

// Forward-flank bearing bands (relative to owner.angle). The dog must never
// land in the straight-behind zone (180° ± 25°).
const FLANK_RIGHT = {
  min: (15 * Math.PI) / 180,
  mid: (30 * Math.PI) / 180, // ~1 o'clock, leading slightly ahead of owner
  max: (60 * Math.PI) / 180
};
const FLANK_LEFT = {
  min: (-60 * Math.PI) / 180,
  mid: (-30 * Math.PI) / 180, // ~11 o'clock, leading slightly ahead of owner
  max: (-15 * Math.PI) / 180
};

// Leash hand anchor geometry (must stay OUTSIDE the 26px body radius so the
// leash never clips the owner torso).
const HAND_RADIUS = 28;
const HAND_SIDE = (60 * Math.PI) / 180;
const PLAYER_HIT_RADIUS = 26;

// Leash slot spacing constants (owner-local frame).
// Flank clearance is measured from the owner's hip/half-width out to the dog.
export const LEASH_FLANK_CLEARANCE_MIN_PX = 0;
export const LEASH_FLANK_CLEARANCE_MAX_PX = 4;
export const LEASH_FLANK_CLEARANCE_TARGET_PX = 2;
// Forward lead is measured ahead of the owner's transverse shoulder line.
export const LEASH_FORWARD_LEAD_MIN_PX = 38;
export const LEASH_FORWARD_LEAD_MAX_PX = 50;
export const LEASH_FORWARD_LEAD_TARGET_PX = 48;
// Velocity feed-forward horizon (seconds) so the dog leads rather than trails.
export const LEASH_FEEDFORWARD_SECONDS = 0.12;
// Minimum forward projection of the slot past the shoulder line.
export const LEASH_SHOULDER_LINE_FORWARD_MARGIN_PX = 2;

// Speed multiplier applied when any need (hunger/grooming/tiredness) is active.
// Needs never stack multiplicatively: a single 0.15x factor applies regardless
// of how many needs are active.
export const NEED_SPEED_MULTIPLIER = 0.15;

// Event bitmask flags emitted by the Wasm companion-dog simulation step.
// Each bit corresponds to a discrete side-effect the JS layer must execute.
export const DogEventBit = {
  POOP_DROPPED: 1 << 0,
  BARK_TRIGGERED: 1 << 1,
  GALLOP_PUFF: 1 << 2,
  SCENT_DEPOSITED: 1 << 3,
  WHINE_AUDIO: 1 << 4,
  PANT_AUDIO: 1 << 5,
  SNIFF_AUDIO: 1 << 6,
  BALL_GRABBED: 1 << 7,
  BALL_HANDOFF: 1 << 8,
  STICK_PICKED_UP: 1 << 9,
  STRAY_TRIGGERED: 1 << 10,
  STRAY_RESOLVED: 1 << 11,
  HEARTS_SPAWNED: 1 << 12
};

// Compatibility constant for care/rejection animation timing.
export const REJECTION_ANIM_MS = 500;

// Zoomies path types: the dog can run a figure-eight, orbit the owner, or
// shuttle back and forth between two points.
export const ZoomiePath = {
  FIGURE_EIGHT: 'FIGURE_EIGHT',
  ORBIT_OWNER: 'ORBIT_OWNER',
  SHUTTLE: 'SHUTTLE'
};

export const ZOOMIE_PATH_TYPES = [
  ZoomiePath.FIGURE_EIGHT,
  ZoomiePath.ORBIT_OWNER,
  ZoomiePath.SHUTTLE
];

// Off-leash roaming sub-modes. These describe the dog's intent while roaming
// so the steering layer can vary its behaviour instead of pure random wander.
export const RoamSubMode = {
  SCOUT_AHEAD: 'SCOUT_AHEAD',
  FLANK_PACE: 'FLANK_PACE',
  LAG_AND_SNIFF: 'LAG_AND_SNIFF',
  CHECK_IN: 'CHECK_IN',
  FREE_EXPLORE: 'FREE_EXPLORE'
};

// Resolve the owner's heading in radians. Prefers `owner.heading`, then
// `owner.angle`, then a sane default (facing South).
function resolveOwnerHeading(owner) {
  if (!owner) return Math.PI / 2;
  if (typeof owner.heading === 'number' && isFinite(owner.heading)) return owner.heading;
  if (typeof owner.angle === 'number' && isFinite(owner.angle)) return owner.angle;
  return Math.PI / 2;
}

// Resolve the owner's hip/half-width used as the flank clearance baseline.
function resolveOwnerHalfWidth(owner) {
  if (!owner) return 10.5;
  if (typeof owner.halfWidth === 'number' && isFinite(owner.halfWidth)) return owner.halfWidth;
  if (typeof owner.hipHalfWidth === 'number' && isFinite(owner.hipHalfWidth)) return owner.hipHalfWidth;
  if (typeof owner.radius === 'number' && isFinite(owner.radius)) return owner.radius;
  return 10.5;
}

// Resolve the owner's world position.
function resolveOwnerPos(owner) {
  if (!owner) return { x: 0, y: 0 };
  return { x: owner.x || 0, y: owner.y || 0 };
}

// Resolve the owner's velocity.
function resolveOwnerVelocity(owner) {
  if (!owner) return { x: 0, y: 0 };
  return { x: owner.vx || 0, y: owner.vy || 0 };
}

// Compute the leash target slot in world space for the given owner.
// The slot sits on the owner's leash-hand flank, forward of the shoulder line.
export function getLeashSlot(owner) {
  const heading = resolveOwnerHeading(owner);
  const pos = resolveOwnerPos(owner);
  const vel = resolveOwnerVelocity(owner);

  const forward = { x: Math.cos(heading), y: Math.sin(heading) };
  // Screen-space right vector (consistent with the rest of the file).
  const right = { x: -Math.sin(heading), y: Math.cos(heading) };

  const flankSign = (owner && owner.leashHandSide === 'left') ? -1 : 1;

  const halfWidth = resolveOwnerHalfWidth(owner);
  const rawLateral = halfWidth + LEASH_FLANK_CLEARANCE_TARGET_PX;
  const lateral = Math.max(
    halfWidth + LEASH_FLANK_CLEARANCE_MIN_PX,
    Math.min(halfWidth + LEASH_FLANK_CLEARANCE_MAX_PX, rawLateral)
  );

  // Velocity feed-forward is applied STRICTLY along the forward axis so that
  // lateral velocity (e.g. wall-collision sliding) can never push the slot
  // outside the [LEASH_FLANK_CLEARANCE_MIN_PX, LEASH_FLANK_CLEARANCE_MAX_PX]
  // lateral band.
  const forwardSpeed = vel.x * forward.x + vel.y * forward.y;
  let forwardLead = LEASH_FORWARD_LEAD_TARGET_PX + forwardSpeed * LEASH_FEEDFORWARD_SECONDS;

  // Clamp forward lead strictly to [MIN, MAX] so it never exceeds 52px ahead
  // even at high gaits or with large feed-forward velocity.
  forwardLead = Math.max(
    LEASH_FORWARD_LEAD_MIN_PX,
    Math.min(LEASH_FORWARD_LEAD_MAX_PX, forwardLead)
  );

  // Compose the slot from the (already clamped) forward lead and lateral
  // clearance. Because both components are clamped independently, the
  // resulting slot is guaranteed to satisfy both bounds.
  let slotX = pos.x + forward.x * forwardLead + right.x * flankSign * lateral;
  let slotY = pos.y + forward.y * forwardLead + right.y * flankSign * lateral;

  // Shoulder-line clamp: the slot must stay forward of the owner's transverse
  // shoulder line by at least LEASH_SHOULDER_LINE_FORWARD_MARGIN_PX.
  const shoulderCentre = pos;
  const relX = slotX - shoulderCentre.x;
  const relY = slotY - shoulderCentre.y;
  const projection = relX * forward.x + relY * forward.y;
  if (projection < LEASH_SHOULDER_LINE_FORWARD_MARGIN_PX) {
    const push = LEASH_SHOULDER_LINE_FORWARD_MARGIN_PX - projection;
    slotX += forward.x * push;
    slotY += forward.y * push;
  }

  return { x: slotX, y: slotY };
}

// Resolve a CoatPreset from a coat name string, accepting both the current
// preset labels and legacy labels (e.g. 'Chocolate & Tan (Ziggy)').
export function resolveCoatPresetByName(coatName) {
  if (!coatName) return CoatPreset.CHOCOLATE_TAN;
  const cn = String(coatName).toLowerCase();
  if (cn.includes('golden')) return CoatPreset.GOLDEN;
  if (cn.includes('black')) return CoatPreset.BLACK_LAB;
  if (cn.includes('jack') || cn.includes('russell')) return CoatPreset.JACK_RUSSELL || CoatPreset.CHOCOLATE_TAN;
  if (cn.includes('setter') || cn.includes('red')) return CoatPreset.RED_SETTER || CoatPreset.CHOCOLATE_TAN;
  // Both 'Chocolate & Tan Cocker Spaniel' and legacy 'Chocolate & Tan (Ziggy)'.
  if (cn.includes('chocolate') || cn.includes('ziggy') || cn.includes('cocker')) return CoatPreset.CHOCOLATE_TAN;
  return CoatPreset.CHOCOLATE_TAN;
}

// States that must never be interrupted by ambient resting (LYING_DOWN) transitions.
const ACTIVE_REST_BLOCKED_STATES = new Set([
  DogState.FETCHING,
  DogState.ZOOMIES,
  DogState.BARKING,
  DogState.POOPING,
  DogState.LOST,
  DogState.RECALLED,
  DogState.PLAY_BOW,
  DogState.ROLLING,
  DogState.LYING_DOWN,
  DogState.SNIFFING_TRAIL,
  DogState.SOCIAL_GREET,
  DogState.PACK_PLAY
]);

export const CoatPreset = {
  CHOCOLATE_TAN: {
    name: 'Chocolate & Tan Cocker Spaniel',
    bodyColor: '#2e1a14',
    bodyShade: '#22130e',
    tanColor: '#d89b54',
    tanHighlight: '#e2aa68',
    earRoot: '#2e1a14',
    earHighlight: '#9e5528',
    noseColor: '#5e372e',
    bibColor: '#f4efe6'
  },
  GOLDEN: {
    name: 'Golden Retriever',
    bodyColor: '#d4a373',
    bodyShade: '#b8824f',
    tanColor: '#faedcd',
    tanHighlight: '#fefae0',
    earRoot: '#c58b54',
    earHighlight: '#e0a96d',
    noseColor: '#3d261d',
    bibColor: '#fffdfa'
  },
  BLACK_LAB: {
    name: 'Black Lab',
    bodyColor: '#1e2022',
    bodyShade: '#374151',
    tanColor: '#4b5563',
    tanHighlight: '#6b7280',
    earRoot: '#1e2022',
    earHighlight: '#374151',
    noseColor: '#090a0f',
    bibColor: '#f1f5f9'
  },
  JACK_RUSSELL: {
    name: 'Jack Russell Terrier',
    bodyColor: '#f8fafc',
    bodyShade: '#e2e8f0',
    tanColor: '#b45309',
    tanHighlight: '#d97706',
    earRoot: '#b45309',
    earHighlight: '#92400e',
    noseColor: '#1e293b',
    bibColor: '#ffffff',
    hasEyePatch: true
  },
  RED_SETTER: {
    name: 'Irish Red Setter',
    bodyColor: '#7c2d12',
    bodyShade: '#991b1b',
    tanColor: '#b45309',
    tanHighlight: '#d97706',
    earRoot: '#7c2d12',
    earHighlight: '#991b1b',
    noseColor: '#27100b',
    bibColor: '#fef2f2'
  }
};

export class CompanionDog {
  constructor(x = 1240, y = 920, owner = null, coat = CoatPreset.CHOCOLATE_TAN, collarColor = '#0d9488', personality = null, name = 'Ziggy') {
    this.x = x;
    this.y = y;
    // Custom dog name (rendered as a floating canvas name tag).
    this.name = name || 'Ziggy';
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.speed = 195; // px/s
    this.sprintSpeed = 290; // px/s while fetching or recalling

    this.owner = owner;
    // Wire the back-reference so Owner.update() can resolve the leash dog.
    if (this.owner) {
      this.owner.dog = this;
    }
    this.coat = coat;
    this.collarColor = collarColor;
    this.radius = 14;
    this.depthY = this.y + 6;

    // Canine Personality Model (1-5 scale).
    // Canonical traits: curiosity, energy, stubbornness, loyalty.
    this.personality = {
      curiosity: 3,
      energy: 3,
      stubbornness: 2,
      loyalty: 4,
      ...(personality || {})
    };
    this.setPersonality(this.personality);

    // Leash pulling physics state
    this.isPullingLeash = false;

    // Leash tension state (exposed for rendering & tests)
    this.leashTaut = Boolean(this.owner && this.owner.isLeashed);
    this.leashTension = 1.0;
    this.leashSagPx = 0;
    this.leashVibrationPx = 0;

    this.state = (this.owner && !this.owner.isLeashed) ? DogState.ROAMING : DogState.FOLLOWING;
    this.stateTimer = 0;

    // Follow offset relative to owner (forward flank, never straight behind)
    this.followDistance = 42;
    this.followAngleOffset = FLANK_LEFT.mid; // forward-left flank by default
    this.preferredSide = 'left'; // 'right' | 'left'
    this.flankAngle = FLANK_LEFT.mid; // smoothed flank bearing relative to owner.angle

    // Ear spring physics (secondary damper system)
    this.leftEar = { angle: 0, vel: 0 };
    this.rightEar = { angle: 0, vel: 0 };
    this.springK = 180;
    this.springDamp = 14;

    // Tail wagging
    this.tailAngle = 0;
    this.wagSpeed = 8;
    this.wagAmp = 0.55;

    // Fetching state
    this.targetBall = null;
    this.hasBall = false;

    // Barking & Emotes
    this.isBarking = false;
    this.barkWaveRadius = 0;
    this.barkWaveAlpha = 0;
    this.emoteBubble = null;
    this.emoteTimer = 0;

    // Happiness / Heart particles
    this.happiness = 100;
    this.hearts = [];

    // Bounded Off-Leash Roaming state
    this.wanderAngle = 0;
    this.wanderTimer = 0;
    this.wanderSpeed = 135;
    this.isReturningToOwner = false;

    // Off-leash roaming sub-mode & look-back wait moment
    this.roamSubMode = RoamSubMode.FREE_EXPLORE;
    this.roamSubModeTimer = 0;
    this.roamLookBackActive = false;
    this.roamLookBackTimer = 0;
    this.roamLookBackDone = false;
    this.roamMicroPauseTimer = 0;

    // Persistent roam speed state (target set on sub-mode selection, current
    // smoothly interpolated each frame so the dog never snaps between gaits).
    this.roamTargetSpeed = 135;
    this.roamCurrentSpeed = 135;

    // Canine Social Interactions
    this.socialTargetDog = null;

    // Sustained multi-dog pack play (coordinated romping)
    this.packPlayPartner = null;
    this.packPlayRole = 'LEAD'; // 'LEAD' | 'CHASE'
    this.packPlayRoleTimer = 0;
    this.packPlayEmoteTimer = 0;
    this.packPlayWaypoint = null;
    this.packPlayWaypointTimer = 0;

    // Whistle Recall & Timed Heel state
    this.isRecalledToHeel = false;
    this.recallHeelTimer = 0;

    // Canine Idle Stray Run-Off Engine state
    this.ownerStillTimer = 0;
    this.strayCheckTimer = 0;
    this.isLost = false;
    this.lostTargetX = 0;
    this.lostTargetY = 0;

    // Dog Poop Event state
    this.poopTimer = 0;
    this.nextPoopTime = 150 + Math.random() * 90;
    this.poopSquatDuration = 0;

    // Richer Canine Mechanics: Scent trails, Sticks, Zoomies & Gait
    this.hasStick = false;
    this.carriedStick = null;
    this.zoomiesTimer = 0;
    this.zoomiesPhase = 0;
    this.zoomiesCenter = { x: this.x, y: this.y };
    this.zoomiesPath = ZoomiePath.FIGURE_EIGHT;
    this.zoomiesShuttleA = { x: this.x, y: this.y };
    this.zoomiesShuttleB = { x: this.x, y: this.y };
    this.zoomiesShuttleHalfSpan = 120;
    this.zoomiesOrbitRadius = 110;
    this.zoomiesOrbitAngle = 0;
    this.zoomiesOrbitDir = 1;
    this.scentDropTimer = 0;
    this.targetScent = null;
    this.sniffTime = 0;
    this.noseTwitch = 0;
    this.gaitMode = 'IDLE'; // 'IDLE' | 'WALK' | 'TROT' | 'GALLOP'
    this.gaitPhase = 0;
    this.gallopPuffTimer = 0;

    // Audio engine hook (resolved lazily via getter below)
    this._audio = null;

    // Catch-up / return-trot state
    this.catchUpTimer = 0;
    this.returnTrotActive = false;

    // Ambient resting state
    this.idleRestTimer = 0;
    this.restStartAt = 0;
    this.rollingTimer = 0;

    // Scent tracking
    this.lastSniffFollowAt = 0;
    this.lastReachedScent = null;
    this.visitedScents = new WeakSet();

    // Zoomies speed (rad/s)
    this.zoomiesSpeed = 3.8;

    // Current zone reference (set externally for sunny-zone rolling)
    this.currentZone = null;

    // Resolved leash target slot (world space), updated each frame while leashed.
    this.targetSlot = null;

    // Audio cooldowns
    this._whineCooldown = 0;
    this._pantCooldown = 0;

    // Event callbacks
    this.onStrayTriggered = null;
    this.onStrayResolved = null;
    this.onPoopDropped = null;

    // Camera reference (for screen-space perimeter steering)
    this.camera = null;

    // Baseline-first roaming interlacing state
    this.roamBaselineTimer = 4.0;
    this.roamWaypoint = null;
    this.roamSubModeOptionLead = 0;
    this.roamSubModeOptionLateral = 0;
    this.roamSubModeOptionForward = 0;
    this.roamSubModeOptionLag = 0;

    // Rare zoomies cooldown & persistent orbit obstacle offset
    this.zoomiesCooldown = 25 + Math.random() * 20;
    this.zoomiesOrbitOffset = { x: 0, y: 0 };

    // Social / leash tug cooldowns
    this.socialCooldown = 0;
    this.leashPullCooldown = 0;
    this.leashTugTimer = 0;
    this.leashTugTarget = null;
    this.socialGazeTimer = 0;
    this.socialGazeAngle = 0;

    // Hunger state (driven by an external DogStateStore via setDogStateStore).
    this.hunger = null;
    this._isHungry = false;
    this.dogStateStore = null;
    this._dogStateUnsubscribe = null;

    // Grooming / tiredness / poop / leash state backing fields.
    this._needsGrooming = false;
    this._isTired = false;
    this._isPooping = false;

    // Pending command flags consumed by the Wasm simulation step.
    this.pendingCommands = {
      whistleRecall: false,
      pet: false,
      praise: false,
      bark: false,
      triggerZoomies: false,
      fetchBall: false
    };
  }

  // --- Read-only need/state getters ---
  // These expose derived need signals without allowing external mutation of
  // the backing fields. Use the corresponding setters to change them.

  get isHungry() {
    // When a store exposes the signal it is authoritative: the backing field
    // is only consulted as a fallback for stores that lack the method.
    if (this.dogStateStore && typeof this.dogStateStore.isHungry === 'function') {
      return Boolean(this.dogStateStore.isHungry());
    }
    return Boolean(this._isHungry);
  }

  get needsGrooming() {
    if (this.dogStateStore && typeof this.dogStateStore.needsGrooming === 'function') {
      return Boolean(this.dogStateStore.needsGrooming());
    }
    return Boolean(this._needsGrooming);
  }

  get isTired() {
    if (this.dogStateStore && typeof this.dogStateStore.isTired === 'function') {
      return Boolean(this.dogStateStore.isTired());
    }
    return Boolean(this._isTired);
  }

  get isPooping() {
    return this.state === DogState.POOPING || Boolean(this._isPooping);
  }

  get isOnLeash() {
    return Boolean(this.owner && this.owner.isLeashed);
  }

  // Base (unmodified) movement speed. Proxies `this.speed` so both names stay
  // in sync regardless of which one callers read or write.
  get baseSpeed() {
    return this.speed;
  }

  set baseSpeed(v) {
    this.speed = v;
  }

  // Effective movement speed: base speed reduced by a single flat multiplier
  // when ANY need is active. Needs never stack multiplicatively.
  getEffectiveSpeed() {
    const baseSpeed = this.baseSpeed;
    const hasActiveNeed = this.isHungry || this.needsGrooming || this.isTired;
    return baseSpeed * (hasActiveNeed ? NEED_SPEED_MULTIPLIER : 1.0);
  }

  // packPlayTimer is an alias of packPlayRoleTimer (kept in sync via accessor).
  get packPlayTimer() {
    return this.packPlayRoleTimer;
  }

  set packPlayTimer(v) {
    this.packPlayRoleTimer = v;
  }

  // Lazy audio getter: resolves dynamically from window.audioEngine / window.sound
  get audio() {
    return this._audio || (typeof window !== 'undefined' ? (window.audioEngine || window.sound) : null);
  }

  set audio(val) {
    this._audio = val;
  }

  // State-entry gated transition (rolling chance evaluated only on entry)
  transitionTo(newState) {
    if (this.state === newState) return;
    this.state = newState;
    if (newState === DogState.SITTING || newState === DogState.IDLE_SNIFF) {
      if (!this.owner?.isLeashed && this.happiness >= 80) {
        const isSunny = Boolean(this.currentZone?.sunny || (this.owner?.field?.zoneConfig?.sunny));
        const rollChance = isSunny ? 0.08 : 0.04;
        if (Math.random() < rollChance) {
          this.state = DogState.ROLLING;
          this.stateTimer = 2.5;
          this.wagSpeed = 20;
        }
      }
    }
    // Lock rolling duration so callers cannot overwrite it with random roaming timers
    if (this.state === DogState.ROLLING) {
      this.stateTimer = 2.5;
    }
    // Ambient resting is never permanent: give LYING_DOWN a bounded duration so
    // an off-leash dog with a stationary owner wakes up and resumes roaming.
    if (this.state === DogState.LYING_DOWN) {
      this.stateTimer = 2.5 + Math.random() * 2.5;
    }
  }

  triggerZoomies(pathType = null) {
    if (this.pendingCommands) this.pendingCommands.triggerZoomies = true;
    if (this.owner && this.owner.isLeashed) return false;
    if (this.state === DogState.LOST || this.state === DogState.POOPING) return false;
    this.dropStick();
    this.idleRestTimer = 0;
    this.state = DogState.ZOOMIES;
    this.zoomiesTimer = 4.2;
    this.zoomiesPhase = 0;
    this.zoomiesCenter = { x: this.x, y: this.y };
    this.zoomiesCooldown = 60 + Math.random() * 30;
    this.zoomiesOrbitOffset = { x: 0, y: 0 };

    // Resolve the zoomies path type (explicit override or random selection).
    const validPath = ZOOMIE_PATH_TYPES.includes(pathType) ? pathType : null;
    this.zoomiesPath = validPath ||
      ZOOMIE_PATH_TYPES[Math.floor(Math.random() * ZOOMIE_PATH_TYPES.length)];

    // Pre-compute path-specific anchors.
    if (this.zoomiesPath === ZoomiePath.ORBIT_OWNER) {
      const ownerX = this.owner ? this.owner.x : this.x;
      const ownerY = this.owner ? this.owner.y : this.y;
      this.zoomiesCenter = { x: ownerX, y: ownerY };
      this.zoomiesOrbitRadius = 95 + Math.random() * 30; // 95-125 px
      this.zoomiesOrbitDir = Math.random() < 0.5 ? 1 : -1;
      this.zoomiesOrbitAngle = Math.atan2(this.y - ownerY, this.x - ownerX);
    } else if (this.zoomiesPath === ZoomiePath.SHUTTLE) {
      const heading = this.owner ? resolveOwnerHeading(this.owner) : this.angle;
      this.zoomiesShuttleHalfSpan = 115 + Math.random() * 15; // 115-130 px
      const span = this.zoomiesShuttleHalfSpan;
      this.zoomiesShuttleA = {
        x: this.x - Math.cos(heading) * span,
        y: this.y - Math.sin(heading) * span
      };
      this.zoomiesShuttleB = {
        x: this.x + Math.cos(heading) * span,
        y: this.y + Math.sin(heading) * span
      };
    }

    this.emoteBubble = '⚡';
    this.emoteTimer = 2.0;
    this.wagSpeed = 22;
    return true;
  }

  pickupStick(stick) {
    if (!stick || this.hasBall || this.hasStick) return false;
    this.hasStick = true;
    this.carriedStick = stick;
    stick.isCarried = true;
    stick.carrier = this;
    this.emoteBubble = '🪵';
    this.emoteTimer = 2.5;
    this.wagSpeed = 15;
    return true;
  }

  dropStick() {
    if (this.carriedStick) {
      this.carriedStick.x = this.x;
      this.carriedStick.y = this.y;
      this.carriedStick.isCarried = false;
      this.carriedStick.carrier = null;
      this.carriedStick = null;
    }
    this.hasStick = false;
  }

  setPersonality(p) {
    if (!p || typeof p !== 'object') return;
    const clampTrait = (val, def) => {
      if (val === undefined || val === null) return def;
      const num = Number(val);
      if (isNaN(num)) return def;
      return Math.max(1, Math.min(5, Math.round(num)));
    };

    if (p.curiosity !== undefined) {
      this.personality.curiosity = clampTrait(p.curiosity, this.personality.curiosity || 3);
    }
    if (p.energy !== undefined) {
      this.personality.energy = clampTrait(p.energy, this.personality.energy || 3);
    }
    if (p.stubbornness !== undefined) {
      this.personality.stubbornness = clampTrait(p.stubbornness, this.personality.stubbornness || 2);
    }
    if (p.loyalty !== undefined) {
      this.personality.loyalty = clampTrait(p.loyalty, this.personality.loyalty || 4);
    }
    // Increases enthusiasm and speed during ball fetch sprint
    this.sprintSpeed = 260 + this.personality.energy * 15;
  }

  setChat(text, duration = 3.5) {
    this.emoteBubble = text;
    this.emoteTimer = duration;
  }

  // Store the hunger snapshot and derive the boolean hungry flag.
  // Idempotent and safe when passed undefined/null.
  setHunger(hungerInfo) {
    this.hunger = hungerInfo === undefined ? null : hungerInfo;
    this._isHungry = Boolean(hungerInfo && hungerInfo.isHungry);
    return this._isHungry;
  }

  // Attach an external DogStateStore. Subscribes (if supported), syncs
  // immediately from the current snapshot, and stores an unsubscribe handle.
  // Never throws when the store is null or lacks expected methods.
  setDogStateStore(store) {
    // Tear down any previous subscription before replacing the store.
    if (typeof this._dogStateUnsubscribe === 'function') {
      try {
        this._dogStateUnsubscribe();
      } catch (_err) {
        // Ignore cleanup errors from a stale store.
      }
    }
    this._dogStateUnsubscribe = null;
    this.dogStateStore = store || null;

    if (!store || typeof store !== 'object') {
      return null;
    }

    // Subscribe first so we don't miss notifications between sync and listen.
    if (typeof store.subscribe === 'function') {
      try {
        const unsub = store.subscribe((snapshot) => {
          this._applyHungerSnapshot(snapshot);
        });
        if (typeof unsub === 'function') {
          this._dogStateUnsubscribe = unsub;
        }
      } catch (_err) {
        // A misbehaving store must never break the dog entity.
      }
    }

    // Immediate sync from the current snapshot.
    let snapshot = null;
    try {
      if (typeof store.getSnapshot === 'function') {
        snapshot = store.getSnapshot();
      } else if (typeof store.getHunger === 'function') {
        snapshot = store.getHunger();
      }
    } catch (_err) {
      snapshot = null;
    }
    this._applyHungerSnapshot(snapshot);

    return this._dogStateUnsubscribe;
  }

  // Internal: normalise a store snapshot into a hunger info object.
  // Accepts all persisted shapes:
  //   - Full state: { version, needs: { hunger: { lastFedAt, durationMs } } }
  //   - Wrapper:    { hunger: { ... } }
  //   - Bare:       { lastFedAt, durationMs, isHungry? }
  // When `isHungry` is not an explicit boolean it is derived from
  // `nowMs - lastFedAt >= durationMs`.
  _applyHungerSnapshot(snapshot, nowMs = Date.now()) {
    if (snapshot === undefined || snapshot === null) {
      this.setHunger(undefined);
      return;
    }
    if (typeof snapshot !== 'object') {
      this.setHunger(undefined);
      return;
    }

    let hungerInfo = null;
    if (snapshot.needs && typeof snapshot.needs === 'object' && snapshot.needs.hunger !== undefined) {
      hungerInfo = snapshot.needs.hunger;
    } else if (snapshot.hunger !== undefined) {
      hungerInfo = snapshot.hunger;
    } else {
      hungerInfo = snapshot;
    }

    if (hungerInfo === undefined || hungerInfo === null || typeof hungerInfo !== 'object') {
      this.setHunger(undefined);
      return;
    }

    // Derive isHungry when not explicitly provided as a boolean.
    if (typeof hungerInfo.isHungry !== 'boolean') {
      const lastFedAt = Number(hungerInfo.lastFedAt);
      const durationMs = Number(hungerInfo.durationMs);
      if (isFinite(lastFedAt) && isFinite(durationMs)) {
        const elapsedMs = Math.max(0, nowMs - lastFedAt);
        hungerInfo = {
          ...hungerInfo,
          elapsedMs,
          remainingMs: Math.max(0, durationMs - elapsedMs),
          isHungry: elapsedMs >= durationMs
        };
      }
    }

    this.setHunger(hungerInfo);
  }

  // Delegate to the existing emote/cue system for the hungry reaction.
  // Guarded so it is a no-op when animation dependencies are unavailable.
  playHungryAnimation() {
    try {
      this.setEmote('🍖', 2.0);
      this.wagSpeed = Math.max(this.wagSpeed || 0, 8);
      if (this.audio && typeof this.audio.playWhine === 'function') {
        this.audio.playWhine();
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  // Delegate to the existing emote/cue system for the feed reaction.
  // Guarded so it is a no-op when animation dependencies are unavailable.
  playFeedReaction() {
    try {
      this.setEmote('❤️', 2.2);
      this.wagSpeed = Math.max(this.wagSpeed || 0, 18);
      if (this.audio && typeof this.audio.playPant === 'function') {
        this.audio.playPant();
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  setEmote(emote, duration = 2.5) {
    this.emoteBubble = emote;
    this.emoteTimer = duration;
  }

  // --- Prototype animation hooks (home view / hunger / grooming / rest) ---
  // These are intentionally plain-field setters so they resolve on the
  // prototype and work for Object.create(CompanionDog.prototype) entities.

  setGroomingState(state) {
    this.grooming = Boolean(state);
    this._needsGrooming = Boolean(state);
    return this.grooming;
  }

  playNeedGroomingAnimation(durationMs = 3000) {
    this.emoteBubble = '🫧';
    this.emoteTimer = durationMs / 1000;
    return true;
  }

  playGroomingAnimation(durationMs = 3000) {
    this.beingGroomed = true;
    this.emoteBubble = '🫧';
    this.emoteTimer = durationMs / 1000;
    this.pose = 'groomed';
    return true;
  }

  setTirednessState(state) {
    this.tired = Boolean(state);
    this._isTired = Boolean(state);
    return this.tired;
  }

  playNeedRestAnimation(durationMs = 3000) {
    this.emoteBubble = '💤';
    this.emoteTimer = durationMs / 1000;
    return true;
  }

  playSleepingAnimation(durationMs = 5000) {
    this.sleeping = true;
    this.pose = 'sleeping';
    this.emoteTimer = durationMs / 1000;
    return true;
  }

  playNeedMetReaction(durationMs = 2000) {
    this.emoteBubble = '❤️';
    this.emoteTimer = durationMs / 1000;
    return true;
  }

  playHungryAnimation(durationMs = 3000) {
    this.setEmote('🍖', durationMs / 1000);
    return true;
  }

  onRemoteBark(sourceDog = null) {
    const respondChance = 0.18 * this.personality.energy;
    if (Math.random() < respondChance && !this.isBarking && this.state !== DogState.FETCHING) {
      this.bark();
    }
  }

  bark(audioEngine = null) {
    if (this.pendingCommands) this.pendingCommands.bark = true;
    this.state = DogState.BARKING;
    this.stateTimer = 0.45;
    this.isBarking = true;
    this.barkWaveRadius = 6;
    this.barkWaveAlpha = 1.0;
    this.emoteBubble = 'Woof!';
    this.emoteTimer = 1.8;
    this.wagSpeed = 16;

    if (audioEngine && typeof audioEngine.playBark === 'function') {
      audioEngine.playBark();
    }
  }

  whistleRecall() {
    if (this.pendingCommands) this.pendingCommands.whistleRecall = true;
    const wasLost = this.state === DogState.LOST || this.isLost;

    // Whistle is the play breaker: dissolve any active pack-play bond.
    // Only an actual pack-play breakup applies the stat-driven social cool-off.
    const wasInPackPlay = Boolean(this.packPlayPartner || this.state === DogState.PACK_PLAY);
    if (this.packPlayPartner) {
      this._breakPackPlay();
    }

    // Stat-driven social cool-off post-whistle: high loyalty and stubbornness
    // increase the cool-off (up to 45s), high energy decreases it
    // (down to 8s). Normalised 1..5 -> 0..1 so the bands are exact.
    if (wasInPackPlay) {
      const loyalNorm = ((this.personality?.loyalty || 3) - 1) / 4; // 0..1
      const stubbornNorm = ((this.personality?.stubbornness || 3) - 1) / 4; // 0..1
      const energyNorm = ((this.personality?.energy || 3) - 1) / 4; // 0..1
      const cd = 18.0 + loyalNorm * 18.0 + stubbornNorm * 4.0 - energyNorm * 12.0;
      this.socialCooldown = Math.max(8.0, Math.min(45.0, cd));
    }

    this.state = DogState.RECALLED;
    this.isLost = false;
    this.ownerStillTimer = 0;
    this.strayCheckTimer = 0;
    this.emoteBubble = wasLost ? '❤️' : '!';
    this.emoteTimer = wasLost ? 2.5 : 2.0;
    this.wagSpeed = 18;
    this.isRecalledToHeel = false;
    this.recallHeelTimer = 10.0; // 10 seconds of close heel following
    this.idleRestTimer = 0;
    this.socialTargetDog = null;
    this.isReturningToOwner = false;
    this.isPullingLeash = false;
    this.dropStick();
    if (this.hasBall && this.targetBall) {
      this.hasBall = false;
      this.targetBall.drop(this.x, this.y);
      this.targetBall = null;
    }

    if (wasLost && typeof this.onStrayResolved === 'function') {
      this.onStrayResolved(this);
    }

    // Whistle recall promptness: sprint speed immediately engages without delay
    if (this.owner) {
      const dx = this.owner.x - this.x;
      const dy = this.owner.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 10) {
        this.vx = (dx / dist) * this.sprintSpeed;
        this.vy = (dy / dist) * this.sprintSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
      }
    }
  }

  triggerPet(duration = 0.45) {
    this.pet();
    this.emoteBubble = '❤️';
    this.emoteTimer = duration;
  }

  // Owner praise: boosts happiness, wags tail, spawns hearts and shows the
  // '❤️' emote WITHOUT interrupting locomotion. Unlike pet(), this never
  // resets idleRestTimer-driven state or triggers zoomies, so a leashed dog
  // keeps following smoothly while being praised.
  praise() {
    if (this.pendingCommands) this.pendingCommands.praise = true;
    this.happiness = Math.min(100, this.happiness + 20);
    this.wagSpeed = 18;
    this.emoteBubble = '❤️';
    this.emoteTimer = 2.2;

    // Spawn floating heart particles
    for (let i = 0; i < 3; i++) {
      this.hearts.push({
        x: this.x + (Math.random() - 0.5) * 20,
        y: this.y - 10,
        vy: -35 - Math.random() * 25,
        alpha: 1.0,
        size: 10 + Math.random() * 4
      });
    }

    return true;
  }

  pet() {
    if (this.pendingCommands) this.pendingCommands.pet = true;
    this.happiness = Math.min(100, this.happiness + 20);
    this.idleRestTimer = 0;
    this.wagSpeed = 18;
    this.emoteBubble = '❤️';
    this.emoteTimer = 2.2;

    // Spawn floating heart particle
    for (let i = 0; i < 3; i++) {
      this.hearts.push({
        x: this.x + (Math.random() - 0.5) * 20,
        y: this.y - 10,
        vy: -35 - Math.random() * 25,
        alpha: 1.0,
        size: 10 + Math.random() * 4
      });
    }

    // Occasional burst of figure-eight zoomies when happiness reaches 100%
    if (this.zoomiesCooldown <= 0 && this.happiness >= 100 && this.owner && !this.owner.isLeashed && Math.random() < 0.12) {
      this.triggerZoomies();
    }
  }

  fetchBall(ball) {
    if (this.pendingCommands) this.pendingCommands.fetchBall = true;
    // If leashed, lost, or pooping, the dog NEVER enters FETCHING state and does not chase balls
    if (this.owner && this.owner.isLeashed) {
      return;
    }
    if (this.state === DogState.LOST || this.state === DogState.POOPING) {
      return;
    }
    this.dropStick();
    this.idleRestTimer = 0;
    this.targetBall = ball;
    this.state = DogState.FETCHING;
    this.wagSpeed = 15;
  }

  update(dt, field, otherDogs = [], activeBall = null, npcs = []) {
    // Keep the owner's leash hand on the dog's flank side and expose the
    // leash-taut signal for rendering/tests. This runs before the Wasm guard
    // so the leash state stays correct even while the sim is still loading.
    if (this.owner) {
      this.owner.leashHandSide = this.preferredSide;
    }
    this.leashTaut = Boolean(this.owner && this.owner.isLeashed);

    // Safe no-op while the browser async Wasm init hasn't finished yet.
    if (!getWasmSim()) return;

    // Sync current zone reference for sunny-zone rolling evaluation
    if (field && field.zoneConfig) {
      this.currentZone = field.zoneConfig;
    }

    // Delegate all decision, steering, leash, and need math to the Wasm
    // simulation step. The bridge returns an event bitmask describing the
    // discrete side-effects the JS layer must execute this frame.
    const bitmask = stepCompanionDogWasm(this, dt, field, otherDogs, activeBall, npcs);
    this.executeDogEventBitmask(bitmask, field, activeBall);

    // Enforce the leash constraint through the Wasm bridge when available.
    if (this.owner && this.owner.isLeashed && typeof stepLeashConstraint === 'function') {
      stepLeashConstraint(this, this.owner, Math.round(MAX_LEASH_LENGTH * 0.75), 4.0, 5.0, dt);
    }

    // Hydrate owner from Wasm-side clamp/freeze flags.
    if (this.owner && this.ownerWasClamped) {
      this.owner.x = this.ownerClampedX;
      this.owner.y = this.ownerClampedY;
    }
    if (this.owner && this.ownerFrozen) {
      if (typeof this.owner.setGait === 'function') {
        this.owner.setGait('STAND');
      } else {
        this.owner.gait = 'STAND';
      }
    }

    // Keep the carried stick glued to the dog's position.
    if (this.hasStick && this.carriedStick) {
      this.carriedStick.x = this.x;
      this.carriedStick.y = this.y;
    }

    // Post-step bookkeeping: depth sort, bark wave decay, emote timer, hearts.
    this.depthY = this.y + 6;

    // Bark Wave Animation
    if (this.isBarking) {
      this.barkWaveRadius += 160 * dt;
      this.barkWaveAlpha = Math.max(0, 1.0 - this.barkWaveRadius / 60);
      if (this.barkWaveAlpha <= 0) this.isBarking = false;
    }

    // Emote Timers & Particles
    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) {
        this.emoteTimer = 0;
        this.emoteBubble = null;
        this.beingGroomed = false;
        this.sleeping = false;
        if (this.pose !== 'camera') {
          this.pose = 'idle';
        }
      }
    }

    // Update hearts
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.y += h.vy * dt;
      h.alpha -= dt * 0.7;
      if (h.alpha <= 0) this.hearts.splice(i, 1);
    }
  }

  // Execute the discrete side-effects described by the Wasm event bitmask.
  // Each handler is isolated so one exception never stops the remaining
  // events or the simulation.
  executeDogEventBitmask(bitmask, field = null, activeBall = null) {
    if (!bitmask) return;
    const run = (fn) => {
      try {
        fn();
      } catch (err) {
        console.warn('[CompanionDog] event error', err);
      }
    };

    if (bitmask & DogEventBit.POOP_DROPPED) {
      run(() => {
        const pile = new PoopPile(null, this.x, this.y);
        if (field && typeof field.addPoopPile === 'function') {
          field.addPoopPile(pile);
        }
        if (typeof this.onPoopDropped === 'function') {
          this.onPoopDropped(this, pile);
        }
      });
    }

    if (bitmask & DogEventBit.BARK_TRIGGERED) {
      run(() => {
        this.isBarking = true;
        this.barkWaveRadius = 6;
        this.barkWaveAlpha = 1.0;
        this.setEmote('Woof!', 1.8);
        this.wagSpeed = 16;
        this.audio?.playBark?.();
      });
    }

    if (bitmask & DogEventBit.GALLOP_PUFF) {
      run(() => {
        field?.particleSystem?.emitGallopPuff?.(this.x, this.y, this.angle);
      });
    }

    if (bitmask & DogEventBit.SCENT_DEPOSITED) {
      run(() => {
        field?.addScent?.(this.x, this.y, 'dog', this);
      });
    }

    if (bitmask & DogEventBit.WHINE_AUDIO) {
      run(() => {
        this.audio?.playWhine?.();
      });
    }

    if (bitmask & DogEventBit.PANT_AUDIO) {
      run(() => {
        this.audio?.playPant?.();
      });
    }

    if (bitmask & DogEventBit.SNIFF_AUDIO) {
      run(() => {
        this.audio?.playSniff?.();
      });
    }

    if (bitmask & DogEventBit.BALL_GRABBED) {
      run(() => {
        this.hasBall = true;
        activeBall?.attachToDog?.(this);
        this.setEmote('🎾', 2.0);
      });
    }

    if (bitmask & DogEventBit.BALL_HANDOFF) {
      run(() => {
        // Hand the ball back to the owner. Prefer the dog's tracked target ball
        // so the retrieveByOwner contract is honoured, then fall back to the
        // active ball passed into the step.
        if (this.targetBall && typeof this.targetBall.retrieveByOwner === 'function') {
          this.targetBall.retrieveByOwner();
        } else {
          activeBall?.retrieveByOwner?.();
        }
        this.hasBall = false;
        this.targetBall = null;
        this.setEmote('❤️', 2.0);
      });
    }

    if (bitmask & DogEventBit.STICK_PICKED_UP) {
      run(() => {
        // Attach the nearest uncarried stick within 28px if not already held.
        if (!this.carriedStick && field && Array.isArray(field.sticks)) {
          let nearest = null;
          let nearestDist = Infinity;
          for (const stick of field.sticks) {
            if (!stick || stick.isCarried) continue;
            if (typeof stick.x !== 'number' || typeof stick.y !== 'number') continue;
            const d = Math.hypot(stick.x - this.x, stick.y - this.y);
            if (d < 28 && d < nearestDist) {
              nearestDist = d;
              nearest = stick;
            }
          }
          if (nearest) {
            this.carriedStick = nearest;
            nearest.isCarried = true;
            nearest.carrier = this;
          }
        }
        // Only flag the stick as held when one is actually attached.
        if (this.carriedStick) {
          this.hasStick = true;
          this.setEmote('🪵', 2.5);
        }
      });
    }

    if (bitmask & DogEventBit.STRAY_TRIGGERED) {
      run(() => {
        this.isStray = true;
        this.isLost = true;
        this.state = DogState.LOST;
        if (typeof this.onStrayTriggered === 'function') {
          this.onStrayTriggered(this);
        }
      });
    }

    if (bitmask & DogEventBit.STRAY_RESOLVED) {
      run(() => {
        this.isStray = false;
        this.isLost = false;
        if (typeof this.onStrayResolved === 'function') {
          this.onStrayResolved(this);
        }
      });
    }

    if (bitmask & DogEventBit.HEARTS_SPAWNED) {
      run(() => {
        this.hearts.push({
          x: this.x + (Math.random() - 0.5) * 20,
          y: this.y - 10,
          vy: -35 - Math.random() * 25,
          alpha: 1.0,
          size: 10 + Math.random() * 4
        });
        this.setEmote('❤️', 2.0);
      });
    }

  }

  // Public helper: compute the leash target slot for the given owner.
  getLeashSlot(owner = this.owner) {
    return getLeashSlot(owner);
  }

  // Collect circular/bounding obstacles from the field for steering & zoomies.
  _getFieldObstacles(field) {
    const out = [];
    if (!field) return out;

    if (typeof field.getWorldObstacles === 'function') {
      const list = field.getWorldObstacles();
      if (Array.isArray(list)) {
        for (const o of list) {
          if (!o || typeof o.x !== 'number' || typeof o.y !== 'number') continue;
          if (o.kind === 'rect' || o.type === 'rect' || o.shape === 'rect') {
            const hw = typeof o.hw === 'number' ? o.hw : (typeof o.w === 'number' ? o.w / 2 : 20);
            const hh = typeof o.hh === 'number' ? o.hh : (typeof o.h === 'number' ? o.h / 2 : 15);
            out.push({ x: o.x, y: o.y, r: Math.hypot(hw, hh), kind: 'rect', hw, hh });
          } else {
            out.push({ x: o.x, y: o.y, r: typeof o.r === 'number' ? o.r : (o.radius || 20), kind: 'circle' });
          }
        }
      }
    }

    // Collider sources (non-exclusive with getWorldObstacles).
    const colliders = [];
    if (typeof field.getColliders === 'function') {
      const gc = field.getColliders();
      if (Array.isArray(gc)) colliders.push(...gc);
    }
    if (Array.isArray(field.colliders)) {
      colliders.push(...field.colliders);
    }
    for (const c of colliders) {
      if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') continue;
      out.push({ x: c.x, y: c.y, r: typeof c.r === 'number' ? c.r : (c.radius || 20) });
    }

    if (Array.isArray(field.trees)) {
      for (const t of field.trees) {
        if (!t || typeof t.x !== 'number') continue;
        const ty = (typeof t.depthY === 'number') ? t.depthY : t.y;
        if (typeof ty !== 'number') continue;
        out.push({ x: t.x, y: ty, r: t.trunkRadius || 18 });
      }
    }
    if (Array.isArray(field.benches)) {
      for (const b of field.benches) {
        if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') continue;
        out.push({
          x: b.x,
          y: b.y,
          r: b.r || b.radius || Math.hypot((b.w || 64) / 2, (b.h || 26) / 2)
        });
      }
    }
    if (Array.isArray(field.bins)) {
      for (const b of field.bins) {
        if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') continue;
        out.push({ x: b.x, y: b.y, r: b.r || b.radius || 16 });
      }
    }
    if (field.waterTower && typeof field.waterTower.x === 'number' && typeof field.waterTower.y === 'number') {
      out.push({
        x: field.waterTower.x,
        y: field.waterTower.y,
        r: field.waterTower.r || field.waterTower.radius || 42
      });
    }
    if (Array.isArray(field.rockOutcrops)) {
      for (const r of field.rockOutcrops) {
        if (!r || typeof r.x !== 'number') continue;
        const ry = (typeof r.depthY === 'number') ? (r.depthY - 8) : r.y;
        if (typeof ry !== 'number') continue;
        out.push({
          x: r.x,
          y: ry,
          r: r.r || r.radius || 26
        });
      }
    }
    if (Array.isArray(field.landmarks)) {
      for (const l of field.landmarks) {
        if (!l || typeof l.x !== 'number') continue;
        const ly = (typeof l.depthY === 'number') ? l.depthY : l.y;
        if (typeof ly !== 'number') continue;
        out.push({
          x: l.x,
          y: ly,
          r: l.r || l.radius || 32
        });
      }
    }

    if (Array.isArray(field.obstacles)) {
      for (const o of field.obstacles) {
        if (!o || typeof o.x !== 'number' || typeof o.y !== 'number') continue;
        out.push({ x: o.x, y: o.y, r: typeof o.r === 'number' ? o.r : (o.radius || 20) });
      }
    }

    return out;
  }

  // Resolve the visible screen-space perimeter (world coords) or null when headless.
  _getScreenPerimeter(field = null) {
    const cam = this.camera || (this.owner && this.owner.camera) || (field && field.camera) || null;
    if (cam && typeof cam.x === 'number' && typeof cam.y === 'number' &&
        typeof cam.viewportWidth === 'number' && typeof cam.viewportHeight === 'number') {
      const zoom = (typeof cam.zoom === 'number' && cam.zoom > 0) ? cam.zoom : 1.0;
      const viewW = cam.viewportWidth / zoom;
      const viewH = cam.viewportHeight / zoom;
      return {
        left: cam.x,
        top: cam.y,
        right: cam.x + viewW,
        bottom: cam.y + viewH,
        width: viewW,
        height: viewH,
        centerX: cam.x + viewW * 0.5,
        centerY: cam.y + viewH * 0.5
      };
    }
    return null;
  }

  // Resolve the current flank band based on preferred side.
  _getFlankBand() {
    return this.preferredSide === 'left' ? FLANK_LEFT : FLANK_RIGHT;
  }

  // Resolve the smoothed flank bearing (relative to owner.angle), clamped to the band.
  _resolveFlankAngle(dt) {
    const band = this._getFlankBand();
    const target = band.mid;
    // Exponential smoothing toward the target flank bearing.
    const smooth = Math.min(1, dt * 6);
    this.flankAngle += (target - this.flankAngle) * smooth;
    // Clamp into the band so the dog never lands straight behind.
    return Math.max(band.min, Math.min(band.max, this.flankAngle));
  }

  // Resolve owner gait into dog tuning parameters.
  // Follow distance scales strictly with gait speed (STAND < STROLL < WALK < JOG).
  _getGaitTuning() {
    const gait = (this.owner && this.owner.gait) ? this.owner.gait : 'STAND';
    const speeds = (typeof window !== 'undefined' && window.Owner && window.Owner.GAIT_SPEEDS)
      ? window.Owner.GAIT_SPEEDS
      : null;
    const speedFor = (g, fallback) => (speeds && speeds[g] !== undefined) ? speeds[g] : fallback;

    // distance = base + k * speed, with base chosen so STAND gives the at-heel gap.
    // Follow distance is strictly monotonic with gait speed:
    // STAND (0) < STROLL (75) < WALK (100) < JOG (185).
    const base = 30;
    const k = 0.065;

    switch (gait) {
      case 'STAND':
        return { followDistance: base, speedScale: 0.0, sniffChance: 0.0, roamSuppressed: true };
      case 'STROLL':
        return {
          followDistance: base + k * speedFor('STROLL', 75),
          speedScale: 0.55,
          sniffChance: 0.35,
          roamSuppressed: false
        };
      case 'JOG':
        return {
          followDistance: base + k * speedFor('JOG', 185),
          speedScale: 1.35,
          sniffChance: 0.05,
          roamSuppressed: false
        };
      case 'WALK':
      default:
        return {
          followDistance: base + k * speedFor('WALK', 100),
          speedScale: 1.0,
          sniffChance: 0.08,
          roamSuppressed: false
        };
    }
  }

  updateFollowing(dt, otherDogs = [], field = null) {
    // Legacy entry point retained for compatibility. All steering is now
    // delegated to the Wasm simulation step via update().
    if (!this.owner) return;
    const bitmask = stepCompanionDogWasm(this, dt, field, otherDogs, null, []);
    this.executeDogEventBitmask(bitmask, field, null);
  }


  // Attempt to pair up with a partner dog for sustained pack play.
  // Returns true when the pack-play bond was established.
  _tryStartPackPlay(partner) {
    if (!partner || partner === this) return false;
    // Mutual pairing guard: never hijack an existing pack-play bond.
    if (this.packPlayPartner !== null || partner.packPlayPartner !== null) return false;
    if (this.state === DogState.PACK_PLAY || partner.state === DogState.PACK_PLAY) return false;
    if (this.owner && this.owner.isLeashed) return false;
    if (partner.owner && partner.owner.isLeashed) return false;
    if (partner.state === DogState.LOST || partner.state === DogState.POOPING ||
        partner.state === DogState.RECALLED || partner.state === DogState.FETCHING) {
      return false;
    }
    if (this.state === DogState.LOST || this.state === DogState.POOPING ||
        this.state === DogState.RECALLED || this.state === DogState.FETCHING) {
      return false;
    }
    if (this.socialCooldown > 0 || partner.socialCooldown > 0) return false;

    // Third-dog hijack guard: never steal a partner that is already engaged
    // with another dog (greeting or bonded in pack play).
    if (partner.socialTargetDog && partner.socialTargetDog !== this) return false;
    if (partner.state === DogState.PACK_PLAY || partner.packPlayPartner !== null) return false;

    // Mutual pairing interest: the partner must be receptive. Either it is
    // actively greeting/bowing, or it is roaming and (optionally) already
    // targeting this dog.
    const partnerReceptive =
      partner.state === DogState.SOCIAL_GREET ||
      partner.state === DogState.PLAY_BOW ||
      partner.state === DogState.ROAMING;
    if (!partnerReceptive) return false;

    this.packPlayPartner = partner;
    partner.packPlayPartner = this;
    this.packPlayRole = 'LEAD';
    partner.packPlayRole = 'CHASE';
    this.packPlayRoleTimer = 4.0 + Math.random() * 3.0;
    partner.packPlayRoleTimer = this.packPlayRoleTimer;
    this.packPlayWaypoint = null;
    partner.packPlayWaypoint = null;
    this.packPlayWaypointTimer = 0;
    partner.packPlayWaypointTimer = 0;
    this.packPlayEmoteTimer = 2.5;
    partner.packPlayEmoteTimer = 2.5;
    this.state = DogState.PACK_PLAY;
    partner.state = DogState.PACK_PLAY;
    partner.socialTargetDog = null;
    this.emoteBubble = '🐾';
    partner.emoteBubble = '🐶';
    this.emoteTimer = 2.5;
    partner.emoteTimer = 2.5;
    this.wagSpeed = Math.min(22, Math.max(16, 16 + (this.personality?.energy || 3)));
    partner.wagSpeed = Math.min(22, Math.max(16, 16 + (partner.personality?.energy || 3)));
    return true;
  }

  // Break the pack-play bond cleanly (both sides).
  _breakPackPlay() {
    const partner = this.packPlayPartner;
    this.packPlayPartner = null;
    this.packPlayWaypoint = null;
    if (partner && partner.packPlayPartner === this) {
      partner.packPlayPartner = null;
      partner.packPlayWaypoint = null;
      if (partner.state === DogState.PACK_PLAY) {
        const partnerLeashed = Boolean(partner.owner && partner.owner.isLeashed);
        partner.transitionTo(partnerLeashed ? DogState.FOLLOWING : DogState.ROAMING);
        partner.idleRestTimer = 0;
      }
    }
    // Transition this dog out of PACK_PLAY based on its own leash state.
    if (this.state === DogState.PACK_PLAY) {
      const selfLeashed = Boolean(this.owner && this.owner.isLeashed);
      this.transitionTo(selfLeashed ? DogState.FOLLOWING : DogState.ROAMING);
      this.idleRestTimer = 0;
    }
  }

  draw(ctx) {
    ctx.save();

    // 1. Soft ground shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 7, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Bark Shockwave ring
    if (this.isBarking && this.barkWaveAlpha > 0) {
      ctx.strokeStyle = `rgba(243, 201, 72, ${this.barkWaveAlpha * 0.8})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.barkWaveRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Oriented Canine Body
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Play-bow, squat posture, or dynamic gait squash/stretch
    let stretchX = 1.0;
    let stretchY = 1.0;
    let trotBob = 0;
    if (this.state === DogState.PLAY_BOW) {
      stretchX = 1.1;
      stretchY = 0.85;
    } else if (this.state === DogState.POOPING) {
      stretchX = 0.88;
      stretchY = 1.12;
      ctx.translate(-2, 0);
    } else if (this.state === DogState.LYING_DOWN) {
      stretchX = 1.15;
      stretchY = 0.72;
      ctx.translate(0, 2);
    } else if (this.state === DogState.ROLLING) {
      // Rolling wiggle: oscillate rotation and squash
      const rollPhase = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.012;
      ctx.rotate(Math.sin(rollPhase) * 0.35);
      stretchX = 1.0 + Math.sin(rollPhase * 2) * 0.08;
      stretchY = 0.9;
    } else if (this.gaitMode === 'GALLOP') {
      const cycle = Math.sin(this.gaitPhase);
      const stretch = 1.0 + Math.max(0, cycle) * 0.28 - Math.max(0, -cycle) * 0.12;
      stretchX = stretch;
      stretchY = 1.0 / Math.sqrt(stretch);
    } else if (this.gaitMode === 'TROT') {
      trotBob = Math.abs(Math.sin(this.gaitPhase)) * 1.5;
    }
    ctx.scale(stretchX, stretchY);

    // Paws (front and back) responding to dynamic gait transitions (walk, rhythmic Spaniel trot, gallop)
    const pawColor = this.coat.hasEyePatch ? '#f1f5f9' : (this.coat.tanColor || this.coat.bodyColor);
    ctx.fillStyle = pawColor;

    let flx = 8, fly = -9;
    let frx = 8, fry = 5;
    let rlx = -10, rly = -9;
    let rrx = -10, rry = 5;

    if (this.gaitMode === 'GALLOP') {
      const reach = Math.sin(this.gaitPhase) * 6.5;
      flx += reach;
      frx += reach;
      rlx -= reach;
      rrx -= reach;
    } else if (this.gaitMode === 'TROT') {
      const diag1 = Math.sin(this.gaitPhase) * 4.5;
      const diag2 = Math.sin(this.gaitPhase + Math.PI) * 4.5;
      flx += diag1;
      rrx += diag1;
      frx += diag2;
      rlx += diag2;
    } else if (this.gaitMode === 'WALK') {
      flx += Math.sin(this.gaitPhase) * 3.0;
      frx += Math.sin(this.gaitPhase + Math.PI * 0.5) * 3.0;
      rlx += Math.sin(this.gaitPhase + Math.PI) * 3.0;
      rrx += Math.sin(this.gaitPhase + Math.PI * 1.5) * 3.0;
    }

    ctx.fillRect(rlx, rly, 5, 4);
    ctx.fillRect(rrx, rry, 5, 4);
    ctx.fillRect(flx, fly, 5, 4);
    ctx.fillRect(frx, fry, 5, 4);

    // Feathered Wagging Tail matching breed coat colors with tufted brush tip
    ctx.save();
    ctx.translate(-14, 0);
    ctx.rotate(this.tailAngle);
    // Base tail shaft
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-5, 0, 7.5, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tufted feathered brush tip matching breed highlight/tan
    const brushColor = this.coat.tanHighlight || this.coat.tanColor || this.coat.earHighlight || this.coat.bodyColor;
    ctx.fillStyle = brushColor;
    ctx.beginPath();
    ctx.ellipse(-9.5, 0, 4.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-13, 0, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Torso (rich coat, with Spaniel trot bounce)
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-2, -trotBob, 13, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Subtle coat dorsal sheen
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.ellipse(-2, -2 - trotBob, 10, 4.5, -0.05, 0, Math.PI * 2);
    ctx.fill();

    // Creamy white chest bib
    ctx.fillStyle = this.coat.bibColor || '#f4efe6';
    ctx.beginPath();
    ctx.ellipse(5, 0, 4.2, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Collar band rendered using this.collarColor with a metallic gold charm tag
    const collar = this.collarColor || '#0d9488';
    ctx.fillStyle = collar;
    ctx.beginPath();
    ctx.roundRect(5.5, -6.5, 3.0, 13, 1.5);
    ctx.fill();

    // Metallic gold charm tag
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(8.5, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // Metallic gold gleam / catchlight
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(8.0, -0.6, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(11, 0, 7.8, 6.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Signature tan eye patch for Jack Russell Terrier
    if (this.coat.hasEyePatch) {
      ctx.fillStyle = this.coat.tanColor;
      ctx.beginPath();
      ctx.ellipse(12, -3.2, 3.8, 3.2, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tan Muzzle & Snout
    ctx.fillStyle = this.coat.tanColor;
    ctx.beginPath();
    ctx.ellipse(16, 0, 4.8, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Snout highlighting
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(15.5, -1.0, 2.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Whisker dots
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(15.2, -2.0, 0.5, 0, Math.PI * 2);
    ctx.arc(16.5, -1.8, 0.5, 0, Math.PI * 2);
    ctx.arc(15.8, -1.0, 0.5, 0, Math.PI * 2);
    ctx.arc(15.2, 2.0, 0.5, 0, Math.PI * 2);
    ctx.arc(16.5, 1.8, 0.5, 0, Math.PI * 2);
    ctx.arc(15.8, 1.0, 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Truffle Nose (with sniffing twitch)
    const noseTwitchY = (this.state === DogState.SNIFFING_TRAIL || this.state === DogState.IDLE_SNIFF) ? (this.noseTwitch || 0) : 0;
    ctx.fillStyle = this.coat.noseColor || '#1e293b';
    ctx.beginPath();
    ctx.ellipse(19.2, noseTwitchY, 1.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose specular shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(18.8, -0.6 + noseTwitchY, 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Clamped woodland stick held proudly across jaws
    if (this.hasStick) {
      ctx.save();
      // Soft stick shadow
      ctx.fillStyle = 'rgba(20, 35, 15, 0.35)';
      ctx.fillRect(16, -13, 3.5, 26);

      // Bark body
      ctx.fillStyle = '#4a2e18';
      ctx.fillRect(15.5, -14, 3.5, 28);

      // Wood grain core
      ctx.fillStyle = '#85512b';
      ctx.fillRect(16.5, -10, 1.5, 20);

      // Small green leaf/bud on branch tip
      ctx.fillStyle = '#65a30d';
      ctx.beginPath();
      ctx.arc(17.2, -14, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Expressive Eyes with amber iris, dark pupils, and specular catchlights
    ctx.fillStyle = '#261b12';
    ctx.beginPath();
    ctx.arc(12, -3.2, 1.6, 0, Math.PI * 2);
    ctx.arc(12, 3.2, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#c6933a';
    ctx.beginPath();
    ctx.arc(12.1, -3.2, 1.2, 0, Math.PI * 2);
    ctx.arc(12.1, 3.2, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(12.2, -3.2, 0.8, 0, Math.PI * 2);
    ctx.arc(12.2, 3.2, 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(11.7, -3.6, 0.55, 0, Math.PI * 2);
    ctx.arc(11.7, 2.8, 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Eyebrow pips (for Cocker Spaniel, Black Lab, Red Setter)
    if (this.coat.tanHighlight && !this.coat.hasEyePatch) {
      ctx.fillStyle = this.coat.tanHighlight;
      ctx.beginPath();
      ctx.arc(10.5, -3.5, 1.1, 0, Math.PI * 2);
      ctx.arc(10.5, 3.5, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Floppy Ears (with spring rotation responding to trot speed inertia and streamlined gallop sweep)
    const gallopSweep = (this.gaitMode === 'GALLOP') ? -0.52 : 0;
    // Left ear
    ctx.save();
    ctx.translate(9, -6);
    ctx.rotate(this.leftEar.angle + gallopSweep);
    ctx.fillStyle = this.coat.earRoot || this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-1, -4, 4.6, 8.2, -Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.coat.earHighlight || this.coat.tanHighlight || this.coat.tanColor;
    ctx.beginPath();
    ctx.ellipse(-1, -5.5, 3.2, 5.5, -Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Right ear
    ctx.save();
    ctx.translate(9, 6);
    ctx.rotate(this.rightEar.angle + gallopSweep);
    ctx.fillStyle = this.coat.earRoot || this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-1, 4, 4.6, 8.2, Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.coat.earHighlight || this.coat.tanHighlight || this.coat.tanColor;
    ctx.beginPath();
    ctx.ellipse(-1, 5.5, 3.2, 5.5, Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore(); // Restore orientation transform

    // Draw leash on top of the dog's body & collar
    if (this.owner && this.owner.isLeashed && this.state !== DogState.FETCHING) {
      this.drawLeash(ctx);
    }

    // 5. Floating Hearts
    for (const h of this.hearts) {
      ctx.save();
      ctx.globalAlpha = h.alpha;
      ctx.font = `${Math.round(h.size)}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('❤️', h.x, h.y);
      ctx.restore();
    }

    // 6. Emote Bubble (only when truthy; safe for plain-object `this`)
    if (this.emoteBubble) {
      const drawEmoteFn = typeof this.drawEmote === 'function'
        ? this.drawEmote
        : CompanionDog.prototype.drawEmote;
      drawEmoteFn.call(this, ctx, this.emoteBubble);
    }

    // 7. Floating Dog Name Tag (world coordinates, below the dog)
    if (this.name) {
      ctx.save();
      ctx.font = '600 11px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const nameText = this.name;
      const textWidth = ctx.measureText(nameText).width;
      const pillW = textWidth + 12;
      const pillH = 16;
      const pillX = this.x - pillW / 2;
      const pillY = this.y + 18;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(pillX, pillY, pillW, pillH, 8);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.fillText(nameText, this.x, pillY + pillH / 2);
      ctx.restore();
    }
  }

  getCollarAnchor() {
    return { x: this.x, y: this.y - 2 };
  }

  drawLeash(ctx) {
    ctx.save();

    // Keep the owner's leash hand on the same side as the dog's flank.
    if (this.owner) {
      this.owner.leashHandSide = this.preferredSide;
    }

    // Hand anchor on the flank side the dog is currently on (matches flank band).
    // Prefer the owner's rendered grip hand so the leash starts exactly there.
    const sideSign = this.preferredSide === 'left' ? -1 : 1;
    let handSide = sideSign * HAND_SIDE;
    let handX;
    let handY;
    if (this.owner && typeof this.owner.getLeashHandAnchor === 'function') {
      const anchor = this.owner.getLeashHandAnchor(this.preferredSide);
      handX = anchor.x;
      handY = anchor.y;
    } else {
      handX = this.owner.x + Math.cos(this.owner.angle + handSide) * HAND_RADIUS;
      handY = this.owner.y + Math.sin(this.owner.angle + handSide) * HAND_RADIUS;
    }

    // Collar anchor point on dog
    const collar = this.getCollarAnchor();
    const collarX = collar.x;
    const collarY = collar.y;

    // Guard: if the leash midpoint would clip the owner torso, widen the hand
    // offset further so the sag point clears the body radius. When the owner
    // exposes a real grip anchor we keep it fixed (never detach from the hand).
    const hasAnchor = Boolean(this.owner && typeof this.owner.getLeashHandAnchor === 'function');
    const midX0 = (handX + collarX) / 2;
    const midY0 = (handY + collarY) / 2;
    if (!hasAnchor && Math.hypot(midX0 - this.owner.x, midY0 - this.owner.y) <= PLAYER_HIT_RADIUS) {
      handSide = sideSign * (HAND_SIDE + (10 * Math.PI) / 180);
      handX = this.owner.x + Math.cos(this.owner.angle + handSide) * HAND_RADIUS;
      handY = this.owner.y + Math.sin(this.owner.angle + handSide) * HAND_RADIUS;
    }

    // Perpendicular vibration while the owner is moving (0 while STAND).
    // The jitter is applied strictly along the leash line's normal so the
    // lead never appears to stretch or shorten. `this.leashVibrationPx` is
    // the amplitude (owned by update()); it must NOT be overwritten here.
    const isMoving = Boolean(this.owner) && this.owner.gait !== 'STAND';
    const jitter = isMoving ? Math.sin(Date.now() * 0.05) * this.leashVibrationPx : 0;

    const leashDx = collarX - handX;
    const leashDy = collarY - handY;
    const leashLen = Math.hypot(leashDx, leashDy) || 1;
    const ux = leashDx / leashLen;
    const uy = leashDy / leashLen;
    const perpX = -uy;
    const perpY = ux;
    const jitterX = perpX * jitter;
    const jitterY = perpY * jitter;

    // Minimal sag (<= 2px and <= 3% of leash length) so the lead reads as taut.
    // Under high tension / pulling the lead must stay taut: never increase sag.
    // The shared MAX_LEASH_LENGTH constant bounds the rendered lead length.
    const sagCap = Math.min(2.0, leashLen * 0.03);
    const sag = Math.min(sagCap, this.leashSagPx || 0);
    const clampedLeashLen = Math.min(leashLen, MAX_LEASH_LENGTH);

    ctx.strokeStyle = '#dc2626'; // Vivid crimson red nylon
    ctx.lineWidth = this.isPullingLeash ? 2.6 : 2.2;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(handX + ux * clampedLeashLen, handY + uy * clampedLeashLen);
    ctx.stroke();
    ctx.restore();
  }

  // Instantiation-proof emote bubble renderer. Reads only plain fields
  // (x, y, scale, emoteScale) so it is safe to invoke via
  // CompanionDog.prototype.drawEmote.call(plainEntity, ctx, emote).
  drawEmote(ctx, emote) {
    if (!ctx || !emote) return;
    const x = typeof this.x === 'number' ? this.x : 0;
    const y = typeof this.y === 'number' ? this.y : 0;
    const scale = (typeof this.emoteScale === 'number' && this.emoteScale > 0)
      ? this.emoteScale
      : ((typeof this.scale === 'number' && this.scale > 0) ? this.scale : 1);
    const text = String(emote);

    ctx.save();
    if (typeof ctx.translate === 'function' && scale !== 1) {
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.translate(-x, -y);
    }

    const bx = x - 14;
    const by = y - 38;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, 28, 22, 6);
    } else {
      ctx.rect(bx, by, 28, 22);
    }
    ctx.fill();

    // Pointer
    ctx.beginPath();
    ctx.moveTo(x - 3, by + 22);
    ctx.lineTo(x, by + 26);
    ctx.lineTo(x + 3, by + 22);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.font = text.length > 2 ? 'bold 10px Outfit, sans-serif' : '14px serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(text, x, by + 15);
    ctx.restore();
  }
}

// Static exports for test/tooling access
CompanionDog.LEASH_FLANK_CLEARANCE_MIN_PX = LEASH_FLANK_CLEARANCE_MIN_PX;
CompanionDog.LEASH_FLANK_CLEARANCE_MAX_PX = LEASH_FLANK_CLEARANCE_MAX_PX;
CompanionDog.LEASH_FLANK_CLEARANCE_TARGET_PX = LEASH_FLANK_CLEARANCE_TARGET_PX;
CompanionDog.LEASH_FORWARD_LEAD_MIN_PX = LEASH_FORWARD_LEAD_MIN_PX;
CompanionDog.LEASH_FORWARD_LEAD_MAX_PX = LEASH_FORWARD_LEAD_MAX_PX;
CompanionDog.LEASH_FORWARD_LEAD_TARGET_PX = LEASH_FORWARD_LEAD_TARGET_PX;
CompanionDog.LEASH_FEEDFORWARD_SECONDS = LEASH_FEEDFORWARD_SECONDS;
CompanionDog.LEASH_SHOULDER_LINE_FORWARD_MARGIN_PX = LEASH_SHOULDER_LINE_FORWARD_MARGIN_PX;
CompanionDog.NEED_SPEED_MULTIPLIER = NEED_SPEED_MULTIPLIER;
CompanionDog.getLeashSlot = getLeashSlot;
CompanionDog.ZoomiePath = ZoomiePath;
CompanionDog.ZOOMIE_PATH_TYPES = ZOOMIE_PATH_TYPES;
CompanionDog.RoamSubMode = RoamSubMode;
CompanionDog.resolveCoatPresetByName = resolveCoatPresetByName;
CompanionDog.ACTIVE_REST_BLOCKED_STATES = Object.freeze(new Set([...ACTIVE_REST_BLOCKED_STATES]));
CompanionDog.DogEventBit = DogEventBit;
CompanionDog.REJECTION_ANIM_MS = REJECTION_ANIM_MS;

// Browser global exposure so the Home Sanctuary can reuse the authentic model.
if (typeof window !== 'undefined') {
  window.CompanionDog = CompanionDog;
  window.CoatPreset = CoatPreset;
  window.DogState = DogState;
  window.NEED_SPEED_MULTIPLIER = NEED_SPEED_MULTIPLIER;
  window.DogEventBit = DogEventBit;
  window.REJECTION_ANIM_MS = REJECTION_ANIM_MS;
}
