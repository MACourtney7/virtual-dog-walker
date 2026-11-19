// Companion Dog Entity - Canine Steering AI, Floppy Ear Springs, Leash Mechanics & Ball Fetching
import { PoopPile } from './waste.js';
import { stepLeashConstraint, resolveFieldCollision, stepEarSpringsToTargets } from '../engine/wasm_sim_bridge.js';

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
// Needs never stack multiplicatively: a single 0.4x factor applies regardless
// of how many needs are active.
export const NEED_SPEED_MULTIPLIER = 0.4;

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
    this.coat = coat;
    this.collarColor = collarColor;
    this.radius = 14;
    this.depthY = this.y + 6;

    // Canine Personality Model (1-5 scale)
    this.personality = {
      playfulness: 3,
      shyness: 2,
      barkyness: 2,
      obedience: 4,
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
    this.followAngleOffset = FLANK_RIGHT.mid; // forward-right flank by default
    this.preferredSide = 'right'; // 'right' | 'left'
    this.flankAngle = FLANK_RIGHT.mid; // smoothed flank bearing relative to owner.angle

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
  }

  // --- Read-only need/state getters ---
  // These expose derived need signals without allowing external mutation of
  // the backing fields. Use the corresponding setters to change them.

  get isHungry() {
    return Boolean(this._isHungry);
  }

  get needsGrooming() {
    return Boolean(this._needsGrooming);
  }

  get isTired() {
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

    if (p.playfulness !== undefined) {
      this.personality.playfulness = clampTrait(p.playfulness, this.personality.playfulness || 3);
    }
    if (p.shyness !== undefined) {
      this.personality.shyness = clampTrait(p.shyness, this.personality.shyness || 2);
    }
    if (p.barkyness !== undefined) {
      this.personality.barkyness = clampTrait(p.barkyness, this.personality.barkyness || 2);
    }
    if (p.obedience !== undefined) {
      this.personality.obedience = clampTrait(p.obedience, this.personality.obedience || 4);
    }

    // Increases enthusiasm and speed during ball fetch sprint
    this.sprintSpeed = 260 + this.personality.playfulness * 15;
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
    const respondChance = 0.18 * this.personality.barkyness;
    if (Math.random() < respondChance && !this.isBarking && this.state !== DogState.FETCHING) {
      this.bark();
    }
  }

  bark(audioEngine = null) {
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
    const wasLost = this.state === DogState.LOST || this.isLost;

    // Whistle is the play breaker: dissolve any active pack-play bond.
    // Only an actual pack-play breakup applies the stat-driven social cool-off.
    const wasInPackPlay = Boolean(this.packPlayPartner || this.state === DogState.PACK_PLAY);
    if (this.packPlayPartner) {
      this._breakPackPlay();
    }

    // Stat-driven social cool-off post-whistle: high obedience and shyness
    // increase the cool-off (up to 45s), high playfulness decreases it
    // (down to 8s). Normalised 1..5 -> 0..1 so the bands are exact:
    //   (5,1,5) -> 41s, (3,3,3) -> 23s, (2,4,1) -> 13.5s, (1,5,1) -> 8s
    if (wasInPackPlay) {
      const obedNorm = ((this.personality?.obedience || 3) - 1) / 4; // 0..1
      const shyNorm = ((this.personality?.shyness || 3) - 1) / 4; // 0..1
      const playNorm = ((this.personality?.playfulness || 3) - 1) / 4; // 0..1
      const cd = 18.0 + obedNorm * 18.0 + shyNorm * 4.0 - playNorm * 12.0;
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
    const isLeashed = Boolean(this.owner && this.owner.isLeashed);
    const nearbyNPCs = npcs || [];
    this.checkNPCInteractions(nearbyNPCs);

    // Sync current zone reference for sunny-zone rolling evaluation
    if (field && field.zoneConfig) {
      this.currentZone = field.zoneConfig;
    }

    // Rare zoomies cooldown tick (off-leash only)
    if (!isLeashed && this.zoomiesCooldown > 0 && this.state !== DogState.ZOOMIES) {
      this.zoomiesCooldown = Math.max(0, this.zoomiesCooldown - dt);
    }

    // Social / leash tug cooldown ticks
    if (this.socialCooldown > 0) this.socialCooldown = Math.max(0, this.socialCooldown - dt);
    if (this.leashPullCooldown > 0) this.leashPullCooldown = Math.max(0, this.leashPullCooldown - dt);
    if (this.socialGazeTimer > 0) this.socialGazeTimer = Math.max(0, this.socialGazeTimer - dt);

    // Idle Tracking & Whistle/Leash Reset
    if (this.owner && !isLeashed && this.state !== DogState.LOST) {
      const ownerVx = this.owner.vx || 0;
      const ownerVy = this.owner.vy || 0;
      const ownerSpeed = Math.hypot(ownerVx, ownerVy);
      if (ownerSpeed < 2) {
        this.ownerStillTimer += dt;
      } else {
        this.ownerStillTimer = 0;
        this.strayCheckTimer = 0;
      }

      // Obedience-Scaled Stray Run-Off Trigger
      if (this.ownerStillTimer > 35) {
        this.strayCheckTimer += dt;
        if (this.strayCheckTimer >= 5.0) {
          this.strayCheckTimer = 0;
          const ob = Math.max(1, Math.min(5, Math.round(this.personality.obedience || 4)));
          const probMap = { 1: 0.50, 2: 0.30, 3: 0.15, 4: 0.05, 5: 0.01 };
          const prob = probMap[ob] ?? 0.05;

          if (Math.random() < prob) {
            this.state = DogState.LOST;
            this.isLost = true;
            const rx = 250 + Math.random() * 2600;
            const ry = 250 + Math.random() * 1800;
            this.lostTargetX = rx;
            this.lostTargetY = ry;
            this.x = rx;
            this.y = ry;
            this.vx = 0;
            this.vy = 0;
            if (typeof this.onStrayTriggered === 'function') {
              this.onStrayTriggered(this);
            }
          }
        }
      }
    } else {
      this.ownerStillTimer = 0;
      this.strayCheckTimer = 0;
      if (isLeashed && (this.state === DogState.LOST || this.isLost)) {
        this.state = DogState.FOLLOWING;
        this.isLost = false;
        if (typeof this.onStrayResolved === 'function') {
          this.onStrayResolved(this);
        }
      }
    }

    // Whine audio hook when the dog is far from its owner (throttled)
    if (this.owner && !isLeashed && this.state !== DogState.LOST) {
      const distToOwnerAudio = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
      this._whineCooldown -= dt;
      if ((distToOwnerAudio > 220 || this.isReturningToOwner || this.returnTrotActive) && this._whineCooldown <= 0 && this.audio && typeof this.audio.playWhine === 'function') {
        this.audio.playWhine();
        this._whineCooldown = 1.5;
      }
    }

    // Ambient resting transitions: lie down after 15s of continuous owner stillness (off-leash).
    // Only ambient resting-capable states may enter LYING_DOWN; active/interactive states are excluded.
    const ownerSpeed = Math.hypot(this.owner?.vx || 0, this.owner?.vy || 0);
    if (this.owner && !this.owner.isLeashed && ownerSpeed < 5 && !ACTIVE_REST_BLOCKED_STATES.has(this.state)) {
      this.idleRestTimer += dt;
      if (this.idleRestTimer > 15) {
        this.transitionTo(DogState.LYING_DOWN);
        // Bounded rest: never freeze permanently while off-leash.
        this.stateTimer = 2.5 + Math.random() * 2.5;
        this.restStartAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      }
    } else if (ownerSpeed > 5) {
      this.idleRestTimer = 0;
      if (this.state === DogState.LYING_DOWN) {
        this.transitionTo(DogState.ROAMING);
      }
    } else if (ACTIVE_REST_BLOCKED_STATES.has(this.state)) {
      // Reset rest timer during active interactions
      this.idleRestTimer = 0;
    }

    // Walking time accumulation for Dog Poop Event
    const curSpeed = Math.hypot(this.vx, this.vy);
    if ((this.state === DogState.FOLLOWING || this.state === DogState.ROAMING) && curSpeed > 10) {
      this.poopTimer += dt;
      if (this.poopTimer >= this.nextPoopTime) {
        this.poopTimer = 0;
        this.nextPoopTime = 160 + Math.random() * 80;
        this.state = DogState.POOPING;
        this.poopSquatDuration = 2.0;
        this.vx = 0;
        this.vy = 0;
      }
    }

    // Dynamic Gait cadence & galloping particles
    if (curSpeed < 10) {
      this.gaitMode = 'IDLE';
    } else if (this.state === DogState.FETCHING || this.state === DogState.RECALLED || this.state === DogState.ZOOMIES || curSpeed >= 220) {
      this.gaitMode = 'GALLOP';
      this.gaitPhase += dt * 16.5;
      this.gallopPuffTimer += dt;
      if (this.gallopPuffTimer >= 0.28) {
        this.gallopPuffTimer = 0;
        if (field && field.particleSystem) {
          field.particleSystem.emitGallopPuff(this.x, this.y, this.angle);
        }
      }
    } else if (curSpeed >= 65) {
      this.gaitMode = 'TROT';
      this.gaitPhase += dt * 11.0;
    } else {
      this.gaitMode = 'WALK';
      this.gaitPhase += dt * 6.5;
    }

    // Scent trail deposition: dog leaves subtle scent nodes while trotting/walking
    if (field && typeof field.addScent === 'function') {
      this.scentDropTimer += dt;
      if (this.scentDropTimer >= 2.2 && curSpeed > 15) {
        this.scentDropTimer = 0;
        field.addScent(this.x, this.y, 'dog', this);
      }
    }

    // 1. Check ball status & enforce strict prohibition of ball chasing on-leash / while lost / while pooping
    if (isLeashed) {
      if (this.state === DogState.FETCHING) {
        this.state = DogState.FOLLOWING;
        this.targetBall = null;
        this.hasBall = false;
      }
      if (activeBall && activeBall.isThrown) {
        // Turns head eagerly toward ball position
        this.angle = Math.atan2(activeBall.y - this.y, activeBall.x - this.x);
        // Wags tail actively if playful
        this.wagSpeed = 10 + this.personality.playfulness * 2;
        // Pulls against leash toward the ball direction
        this.isPullingLeash = true;
      }
    } else {
      if (activeBall && (activeBall.isThrown || (this.state === DogState.FETCHING && !this.hasBall))) {
        if (this.state !== DogState.LOST && this.state !== DogState.POOPING) {
          this.targetBall = activeBall;
          this.state = DogState.FETCHING;
        }
      }
    }

    // Sensitivity to remote bark triggers: higher barkyness responds more promptly
    if (otherDogs && Array.isArray(otherDogs) && !this.isBarking && this.state !== DogState.FETCHING && this.state !== DogState.POOPING) {
      for (const other of otherDogs) {
        if (other && other !== this && other.isBarking) {
          const dist = Math.hypot(this.x - other.x, this.y - other.y);
          if (dist < 260 && Math.random() < (0.008 * this.personality.barkyness)) {
            this.bark();
            break;
          }
        }
      }
    }

    // 2. State Machine & Steering Behaviors
    switch (this.state) {
      case DogState.LOST:
        this.updateLost(dt);
        break;

      case DogState.POOPING:
        this.updatePooping(dt, field);
        break;

      case DogState.FETCHING:
        this.updateFetching(dt);
        break;

      case DogState.RECALLED:
        this.updateRecalled(dt);
        break;

      case DogState.ZOOMIES:
        this.updateZoomies(dt, field);
        break;

      case DogState.SNIFFING_TRAIL:
        this.updateSniffingTrail(dt, field);
        break;

      case DogState.SOCIAL_GREET:
        this.updateSocialGreet(dt, otherDogs);
        break;

      case DogState.PACK_PLAY:
        this.updatePackPlay(dt, field);
        break;

      case DogState.ROAMING:
        this.updateRoaming(dt, otherDogs, field);
        break;

      case DogState.PLAY_BOW:
        this.updatePlayBow(dt);
        break;

      case DogState.IDLE_SNIFF:
        this.updateSniff(dt);
        break;

      case DogState.SITTING:
        this.updateSitting(dt);
        break;

      case DogState.LYING_DOWN:
        this.vx = 0;
        this.vy = 0;
        this.wagSpeed = 3;
        if (this.owner && Math.hypot(this.owner.vx || 0, this.owner.vy || 0) > 5) {
          this.transitionTo(DogState.ROAMING);
          this.idleRestTimer = 0;
        } else if (!this.owner?.isLeashed) {
          // Off-leash resting is bounded: wake up and resume roaming indefinitely.
          this.stateTimer -= dt;
          if (this.stateTimer <= 0) {
            this.transitionTo(DogState.ROAMING);
            this.idleRestTimer = 0;
          }
        }
        break;

      case DogState.ROLLING:
        this.vx *= 0.6;
        this.vy *= 0.6;
        this.wagSpeed = 20;
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          // Route through transitionTo for consistency, then force a positive sitting
          // duration so the dog never re-rolls immediately after finishing a roll.
          this.transitionTo(DogState.SITTING);
          if (this.state === DogState.SITTING) {
            this.stateTimer = 2.0 + Math.random() * 2.0;
          }
        }
        break;

      case DogState.BARKING:
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
          this.isBarking = false;
        }
        break;

      case DogState.FOLLOWING:
      default:
        this.updateFollowing(dt, otherDogs, field);
        break;
    }

    // When on-leash and an active ball is thrown, pull toward the ball direction against leash
    if (isLeashed && activeBall && activeBall.isThrown) {
      this.angle = Math.atan2(activeBall.y - this.y, activeBall.x - this.x);
      const pullSpeed = 50 + this.personality.playfulness * 12;
      this.vx = Math.cos(this.angle) * pullSpeed;
      this.vy = Math.sin(this.angle) * pullSpeed;
      this.wagSpeed = 10 + this.personality.playfulness * 2;
      this.isPullingLeash = true;
    }

    // Stat-driven social leash tug: pull dog toward target & slide the player.
    // Runs BEFORE movement integration so the tug velocity is applied this frame.
    if (this.leashTugTimer > 0 && this.leashTugTarget && this.owner && this.owner.isLeashed) {
      this.leashTugTimer = Math.max(0, this.leashTugTimer - dt);
      const tdx = this.leashTugTarget.x - this.owner.x;
      const tdy = this.leashTugTarget.y - this.owner.y;
      const tdist = Math.hypot(tdx, tdy) || 1;
      const ux = tdx / tdist;
      const uy = tdy / tdist;
      const play = this.personality.playfulness || 3;
      const obed = this.personality.obedience || 4;
      const shy = this.personality.shyness || 2;
      const pullFactor = (play / 5) * ((6 - obed) / 5) * ((6 - shy) / 5);
      const tugSpeed = 95 + 65 * pullFactor;
      this.vx = ux * tugSpeed;
      this.vy = uy * tugSpeed;
      this.angle = Math.atan2(uy, ux);
      this.isPullingLeash = true;

      const slideSpeed = 28 + 27 * pullFactor;
      this.owner.x += ux * slideSpeed * dt;
      this.owner.y += uy * slideSpeed * dt;
      if (field && typeof field.resolveCircleCollision === 'function') {
        const resolved = field.resolveCircleCollision(this.owner.x, this.owner.y, this.owner.radius || 16);
        this.owner.x = resolved.x;
        this.owner.y = resolved.y;
      }
      this.owner.depthY = this.owner.y + 12;

      if (this.leashTugTimer <= 0) {
        this.isPullingLeash = false;
        this.leashTugTarget = null;
      }
    } else if (this.leashTugTimer > 0 && (!this.leashTugTarget || !this.owner || !this.owner.isLeashed)) {
      this.leashTugTimer = 0;
      this.leashTugTarget = null;
      this.isPullingLeash = false;
    }

    // 3. Movement integration
    // Need-based speed reduction: scale the velocity by the ratio of effective
    // speed to base speed for THIS frame's position integration only. The
    // persistent `this.vx` / `this.vy` are never mutated, so the dog returns
    // to `baseSpeed` on the next tick once needs clear. Needs never stack
    // (single flat multiplier).
    const baseSpeed = this.baseSpeed;
    const speedScale = baseSpeed > 0 ? (this.getEffectiveSpeed() / baseSpeed) : 1.0;
    const effVx = this.vx * speedScale;
    const effVy = this.vy * speedScale;
    // Zoomies set x/y directly from the parametric curve; skip integration to avoid double movement.
    if (this.state !== DogState.ZOOMIES) {
      this.x += effVx * dt;
      this.y += effVy * dt;
    }

    // Screen-space perimeter clamp for off-leash free movement
    if (!isLeashed && this.state !== DogState.ZOOMIES && this.state !== DogState.FETCHING && this.state !== DogState.LOST) {
      const screen = this._getScreenPerimeter(field);
      if (screen) {
        this.x = Math.max(screen.left + 32, Math.min(screen.right - 32, this.x));
        this.y = Math.max(screen.top + 32, Math.min(screen.bottom - 32, this.y));
      }
    }

    // Sync carried stick position
    if (this.hasStick && this.carriedStick) {
      this.carriedStick.x = this.x;
      this.carriedStick.y = this.y;
    }

    // Leash constraint & pulling physics: If leashed to owner, hard clamp to max leash length
    if (this.owner && this.owner.isLeashed && this.state !== DogState.FETCHING) {
      stepLeashConstraint(this, this.owner, 65, 4.0, 5.0, dt);
      const maxLeash = 105;
      const dx = this.x - this.owner.x;
      const dy = this.y - this.owner.y;
      const dist = Math.hypot(dx, dy);

      // Leash pulling physics
      if (activeBall && activeBall.isThrown) {
        this.isPullingLeash = true;
      } else if (dist > 95) {
        const dotAway = dx * this.vx + dy * this.vy;
        if (dotAway > 0 || dist >= maxLeash) {
          // High obedience reduces propensity to pull against leash
          if (this.personality.obedience < 4 || dist >= 100) {
            this.isPullingLeash = true;
          }
        }
      } else if (this.leashTugTimer <= 0 && (dist < 48 || (!this.owner.isMoving && Math.hypot(this.vx, this.vy) < 12))) {
        // Dog is at heel or owner stopped and dog is resting
        this.isPullingLeash = false;
      }

      if (dist > maxLeash) {
        this.x = this.owner.x + (dx / dist) * maxLeash;
        this.y = this.owner.y + (dy / dist) * maxLeash;
        this.vx *= 0.5;
        this.vy *= 0.5;
        this.isPullingLeash = true;
      }
    } else if (this.owner && !this.owner.isLeashed) {
      this.isPullingLeash = false;
    }

    // Clear the resolved slot when off-leash so tests can distinguish states.
    if (!this.owner || !this.owner.isLeashed) {
      this.targetSlot = null;
    }

    // Update leash tension state (on-leash implies taut; sag/vibration derived)
    if (this.owner && this.owner.isLeashed) {
      // Keep the owner's leash hand on the same side as the dog's flank.
      this.owner.leashHandSide = this.preferredSide;
      const leashDist = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
      this.leashTaut = true;
      this.leashTension = 1.0;
      // Minimal sag: never more than 2px (and <= 3% of leash length)
      const sagCap = Math.min(2.0, leashDist * 0.03);
      this.leashSagPx = Math.min(sagCap, Math.max(0.0, (90 - leashDist) * 0.05));
      // Subtle vibration only while the owner is moving
      const isMoving = Boolean(this.owner && this.owner.gait !== 'STAND');
      this.leashVibrationPx = isMoving ? 0.8 : 0;
    } else {
      this.leashTaut = false;
      this.leashTension = 0.0;
      this.leashSagPx = 0;
      this.leashVibrationPx = 0;
    }

    // Obstacle and world boundary collisions
    if (field) {
      resolveFieldCollision(this, this.radius, field);
    }

    this.depthY = this.y + 6;

    // 4. Ear Secondary Spring Physics responding to trot speed inertia
    const speedMag = Math.hypot(this.vx, this.vy);
    const trotBob = speedMag > 10 ? Math.sin(Date.now() * 0.014) * 0.12 : 0;
    const lateralLag = -Math.sin(this.angle) * this.vx * 0.0025 + Math.cos(this.angle) * this.vy * 0.0025;
    const speedLag = -speedMag * 0.0007;
    const targetLeftEar = speedLag - trotBob + lateralLag;
    const targetRightEar = speedLag + trotBob - lateralLag;

    // Ear springs integrated by dog_walker_core (exact JS fallback in the bridge)
    stepEarSpringsToTargets(this.leftEar, this.rightEar, targetLeftEar, targetRightEar, this.springK, this.springDamp, dt);

    // 5. Tail Wagging - scales wag frequency proportional to playfulness
    const movingWag = Math.hypot(this.vx, this.vy) > 10 ? 1.5 : 1.0;
    const playfulnessMultiplier = 0.6 + this.personality.playfulness * 0.15;
    this.tailAngle = Math.sin(Date.now() * 0.001 * this.wagSpeed * movingWag * playfulnessMultiplier) * this.wagAmp;

    // 6. Bark Wave Animation
    if (this.isBarking) {
      this.barkWaveRadius += 160 * dt;
      this.barkWaveAlpha = Math.max(0, 1.0 - this.barkWaveRadius / 60);
      if (this.barkWaveAlpha <= 0) this.isBarking = false;
    }

    // 7. Emote Timers & Particles
    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) {
        this.emoteTimer = 0;
        this.emoteBubble = null;
        // Drop transient animation flags and reset pose, but never clobber
        // a long-lived pose such as 'camera'.
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

  checkNPCInteractions(npcs) {
    if (!npcs || !Array.isArray(npcs) || npcs.length === 0) return;

    for (const npc of npcs) {
      if (!npc) continue;
      const dist = Math.hypot(this.x - npc.x, this.y - npc.y);
      if (dist >= 80) continue;

      // 1. Barkyness roll (Joggers)
      if ((npc.isJogger || npc.type === 'jogger') && this.personality.barkyness >= 3) {
        if (!this.isBarking && this.state !== DogState.FETCHING && Math.random() < (0.015 * (this.personality.barkyness - 2))) {
          this.bark();
        }
      }

      // 2. Shyness roll (Berth avoidance)
      if (this.personality.shyness >= 3) {
        if (dist < 75 && dist > 0.001) {
          const shyForce = (1.0 - dist / 75) * (this.speed * 0.45) * ((this.personality.shyness - 2) / 3);
          this.vx += ((this.x - npc.x) / dist) * shyForce;
          this.vy += ((this.y - npc.y) / dist) * shyForce;
        }
      }

      // 3. Playfulness roll (Wag / Bow)
      if (this.personality.playfulness >= 4) {
        this.wagSpeed = Math.max(this.wagSpeed, 14 + this.personality.playfulness * 2);
        if (!this.owner?.isLeashed && this.state === DogState.ROAMING && dist < 50 && Math.random() < 0.008) {
          this.state = DogState.PLAY_BOW;
          this.stateTimer = 1.8;
          this.emoteBubble = '🐾';
          this.emoteTimer = 1.8;
        }
      }
    }
  }

  updateLost(dt) {
    this.vx = 0;
    this.vy = 0;
    this.wagSpeed = 4;

    // Retrieval check
    if (this.owner) {
      const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
      if (distToOwner < 55) {
        this.state = DogState.RECALLED;
        this.isLost = false;
        this.ownerStillTimer = 0;
        this.strayCheckTimer = 0;
        this.emoteBubble = '❤️';
        this.emoteTimer = 2.5;
        this.wagSpeed = 18;
        if (typeof this.onStrayResolved === 'function') {
          this.onStrayResolved(this);
        }
      }
    }
  }

  updatePooping(dt, field) {
    this.vx = 0;
    this.vy = 0;
    this.wagSpeed = 3;
    this.poopSquatDuration -= dt;

    if (this.poopSquatDuration <= 0) {
      const pile = new PoopPile(null, this.x, this.y);
      if (field && typeof field.addPoopPile === 'function') {
        field.addPoopPile(pile);
      }
      if (typeof this.onPoopDropped === 'function') {
        this.onPoopDropped(this, pile);
      }
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }
  checkSocialInteractions(otherDogs, dt = 0.016, field = null) {
    if (!otherDogs || !Array.isArray(otherDogs)) return false;
    if (this.state === DogState.FETCHING || this.state === DogState.RECALLED || this.state === DogState.LOST || this.state === DogState.POOPING) return false;

    const selfLeashed = Boolean(this.owner && this.owner.isLeashed);
    // Approach probability modified by shyness: low shyness dogs approach eagerly, high shyness approach with lower probability
    const baseProb = Math.max(0.008, 0.045 - (this.personality.shyness - 1) * 0.009);

    for (const other of otherDogs) {
      if (!other || other === this) continue;
      if (other.state === DogState.FETCHING || this.state === DogState.FETCHING) continue;

      const otherLeashed = Boolean(other.owner && other.owner.isLeashed);
      const dogDist = Math.hypot(this.x - other.x, this.y - other.y);

      // Regime A: both off-leash -> high-affinity active play
      if (!selfLeashed && !otherLeashed) {
        const socialRange = 220;
        const offLeashProb = baseProb * 2.2 * (0.8 + (this.personality.playfulness || 3) * 0.15);
        if (dogDist < socialRange && this.socialCooldown <= 0 &&
            this.state !== DogState.SOCIAL_GREET && this.state !== DogState.PLAY_BOW &&
            Math.random() < offLeashProb) {
          const playBowDirectChance = (this.personality.playfulness - 1) * 0.12;
          if (Math.random() < playBowDirectChance) {
            this.state = DogState.PLAY_BOW;
            this.stateTimer = 2.4;
            this.wagSpeed = 14 + this.personality.playfulness * 2;
            this.emoteBubble = '🐾';
            this.emoteTimer = 2.0;
          } else {
            this.state = DogState.SOCIAL_GREET;
            this.stateTimer = 3.2;
            this.wagSpeed = 12 + this.personality.playfulness * 2;
            this.emoteBubble = Math.random() < 0.5 ? '🐾' : (Math.random() < 0.5 ? '🐶' : '❤️');
            this.emoteTimer = 2.5;
          }
          this.socialTargetDog = other;
          this.socialCooldown = 12.0;
          return true;
        }
        continue;
      }

      // Regime B1: self off-leash, other on-leash -> reduced approach
      if (!selfLeashed && otherLeashed) {
        const mixedOffProb = baseProb * 0.25;
        if (dogDist < 110 && this.socialCooldown <= 0 &&
            this.state !== DogState.SOCIAL_GREET && this.state !== DogState.PLAY_BOW &&
            Math.random() < mixedOffProb) {
          this.state = DogState.SOCIAL_GREET;
          this.stateTimer = 2.2;
          this.wagSpeed = 12 + this.personality.playfulness * 2;
          this.emoteBubble = Math.random() < 0.5 ? '🐾' : '🐶';
          this.emoteTimer = 2.0;
          this.socialTargetDog = other;
          this.socialCooldown = 14.0;
          return true;
        }
        continue;
      }

      // Regime B2: self on-leash, other off-leash -> subtle interaction + stat-driven leash tug
      if (selfLeashed && !otherLeashed) {
        if (dogDist < 150 || other.socialTargetDog === this) {
          this.angle = lerpAngle(this.angle, Math.atan2(other.y - this.y, other.x - this.x), Math.min(1, dt * 8));
          this.wagSpeed = Math.max(this.wagSpeed, 14 + (this.personality.playfulness || 3) * 2);
          this.socialGazeAngle = Math.atan2(other.y - this.y, other.x - this.x);
          this.socialGazeTimer = 0.5;
          if (!this.emoteBubble && this.socialCooldown <= 0) {
            this.emoteBubble = Math.random() < 0.5 ? '🐾' : '🐶';
            this.emoteTimer = 2.0;
            this.socialCooldown = 6.0;
          }
          if ((dogDist < 120 || other.socialTargetDog === this) && this.leashPullCooldown <= 0) {
            const play = this.personality.playfulness || 3;
            const obed = this.personality.obedience || 4;
            const shy = this.personality.shyness || 2;
            const pullFactor = (play / 5) * ((6 - obed) / 5) * ((6 - shy) / 5);
            if (Math.random() < pullFactor * 0.45 * dt) {
              this.triggerSocialLeashTug(other);
            }
          }
        }
        continue;
      }

      // Regime C: both on-leash -> minimal passing glance
      if (selfLeashed && otherLeashed) {
        if (dogDist < 90 && this.socialCooldown <= 0 && Math.random() < baseProb * 0.15) {
          this.socialGazeAngle = Math.atan2(other.y - this.y, other.x - this.x);
          this.socialGazeTimer = 0.5;
          this.angle = lerpAngle(this.angle, this.socialGazeAngle, Math.min(1, dt * 5));
          this.wagSpeed = Math.max(this.wagSpeed, 11);
          this.socialCooldown = 10.0;
        }
        continue;
      }
    }
    return false;
  }

  triggerSocialLeashTug(targetDog) {
    if (!this.owner || !this.owner.isLeashed || !targetDog) return false;
    this.leashTugTarget = targetDog;
    this.leashTugTimer = 0.45;
    this.leashPullCooldown = 14.0 + Math.random() * 6.0;
    this.isPullingLeash = true;
    this.emoteBubble = '🐾';
    this.emoteTimer = 1.8;
    this.wagSpeed = 16 + (this.personality.playfulness || 3) * 2;
    return true;
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
    if (!this.owner) return;

    if (!this.owner.isLeashed) {
      this.state = DogState.ROAMING;
      this.updateRoaming(dt, otherDogs, field);
      return;
    }

    const tuning = this._getGaitTuning();
    this.followDistance = tuning.followDistance;

    if (this.checkSocialInteractions(otherDogs, dt, field)) {
      return;
    }

    // Desired position: leash slot in the owner's local frame (forward flank,
    // forward of the shoulder line, with velocity feed-forward).
    // Only resolve the leash slot while actually leashed; off-leash callers
    // are routed to updateRoaming() above.
    if (!this.owner || !this.owner.isLeashed) {
      this.targetSlot = null;
      this.state = DogState.ROAMING;
      this.updateRoaming(dt, otherDogs, field);
      return;
    }
    const slot = getLeashSlot(this.owner);
    this.targetSlot = slot;
    const targetX = slot.x;
    const targetY = slot.y;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);

    // If owner stopped for a while, transition to idle sniff or sit
    // High obedience dogs stay attentive at heel longer with smaller stray chance
    const idleTransitionChance = Math.max(0.001, 0.009 - this.personality.obedience * 0.0015);
    if (!this.owner.isMoving && dist < 8) {
      this.vx *= 0.8;
      this.vy *= 0.8;
      this.wagSpeed = 6;
      // Smoothly align with owner heading while standing still (or hold a
      // brief social gaze toward a nearby dog).
      const ownerHeading = this.socialGazeTimer > 0 ? this.socialGazeAngle : resolveOwnerHeading(this.owner);
      this.angle = lerpAngle(this.angle, ownerHeading, Math.min(1, dt * 10));
      if (Math.random() < idleTransitionChance) {
        this.transitionTo(Math.random() < 0.5 ? DogState.IDLE_SNIFF : DogState.SITTING);
        if (this.state !== DogState.ROLLING) {
          this.stateTimer = 2.0 + Math.random() * 3.0;
        }
      }
      return;
    }

    // Arrival steering calculation matching owner's pace
    const slowingRadius = 40;
    const baseSpeed = this.speed * tuning.speedScale;
    let targetSpeed = baseSpeed;
    if (dist < slowingRadius) {
      targetSpeed = baseSpeed * (dist / slowingRadius);
    }

    // Higher obedience adheres strictly to heel follow offset with smaller arrival deadband
    const arrivalDeadband = Math.max(3, 11 - this.personality.obedience * 1.5);
    if (dist > arrivalDeadband) {
      this.vx = (dx / dist) * targetSpeed;
      this.vy = (dy / dist) * targetSpeed;
      // When owner is moving, face travel direction; when owner stops, align to owner's heading
      const targetAngle = (!this.owner.isMoving) ? resolveOwnerHeading(this.owner) : Math.atan2(this.vy, this.vx);
      this.angle = lerpAngle(this.angle, targetAngle, Math.min(1, dt * 12));
      this.wagSpeed = 10;
    } else {
      this.vx = 0;
      this.vy = 0;
      this.wagSpeed = 6;
      const ownerHeading = this.socialGazeTimer > 0 ? this.socialGazeAngle : resolveOwnerHeading(this.owner);
      this.angle = lerpAngle(this.angle, ownerHeading, Math.min(1, dt * 10));
    }

    // Rendered-position shoulder-line clamp: after arrival damping, the dog's
    // actual position must never lag behind the owner's transverse shoulder
    // line during sharp turns while on leash.
    const heading = resolveOwnerHeading(this.owner);
    const fwdX = Math.cos(heading);
    const fwdY = Math.sin(heading);
    const proj = (this.x - this.owner.x) * fwdX + (this.y - this.owner.y) * fwdY;
    if (proj < LEASH_SHOULDER_LINE_FORWARD_MARGIN_PX) {
      const push = LEASH_SHOULDER_LINE_FORWARD_MARGIN_PX - proj;
      this.x += fwdX * push;
      this.y += fwdY * push;
    }
  }

  updateRoaming(dt, otherDogs = [], field = null) {
    if (!this.owner) return;

    if (this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
      this.followDistance = 42;
      return;
    }

    const tuning = this._getGaitTuning();

    if (this.checkSocialInteractions(otherDogs, dt, field)) {
      return;
    }

    // Baseline-first interlacing: spend the baseline window in smooth
    // FREE_EXPLORE wander before any episodic sub-mode can interrupt.
    if (this.roamBaselineTimer > 0) {
      this.roamBaselineTimer = Math.max(0, this.roamBaselineTimer - dt);
      this.roamSubMode = RoamSubMode.FREE_EXPLORE;
    }

    // Off-leash roaming sub-mode selection with personality weighting.
    if (this.roamBaselineTimer <= 0) {
      this.roamSubModeTimer -= dt;
      if (this.roamSubModeTimer <= 0) {
        // Episodic sub-mode timeout: interlace back to baseline FREE_EXPLORE
        // instead of chaining another episode back-to-back.
        if (this.roamSubMode !== RoamSubMode.FREE_EXPLORE) {
          this.roamSubMode = RoamSubMode.FREE_EXPLORE;
          this.roamBaselineTimer = 4.5 + Math.random() * 3.5;
          this.roamWaypoint = null;
          this.roamTargetSpeed = 125 + Math.random() * 50;
          this.roamSubModeTimer = 0;
          this.roamLookBackDone = false;
        } else {
        this.roamSubModeTimer = 3.0 + Math.random() * 3.0;
        const energy = Number(this.personality?.energy ?? 3);
        const curiosity = Number(this.personality?.curiosity ?? 3);
        const obedience = Number(this.personality?.obedience ?? 4);
        // Weighted mode selection: energetic dogs scout/dart more, curious dogs
        // lag-and-sniff more, obedient dogs check in more.
        const weights = [
          [RoamSubMode.SCOUT_AHEAD, 1.0 + energy * 0.4],
          [RoamSubMode.FLANK_PACE, 1.0 + obedience * 0.2],
          [RoamSubMode.LAG_AND_SNIFF, 1.0 + curiosity * 0.5],
          [RoamSubMode.CHECK_IN, 0.5 + obedience * 0.4],
          [RoamSubMode.FREE_EXPLORE, 1.0]
        ];
        const total = weights.reduce((s, w) => s + w[1], 0);
        let roll = Math.random() * total;
        let chosen = RoamSubMode.FREE_EXPLORE;
        for (const [mode, w] of weights) {
          roll -= w;
          if (roll <= 0) { chosen = mode; break; }
        }

        // Stationary/slow owner guard: never hover at a stationary offset.
        const ownerSpeed = Math.hypot(this.owner.vx || 0, this.owner.vy || 0);
        if ((!this.owner.isMoving || ownerSpeed < 20) &&
            (chosen === RoamSubMode.SCOUT_AHEAD || chosen === RoamSubMode.FLANK_PACE)) {
          chosen = RoamSubMode.FREE_EXPLORE;
        }

        this.roamSubMode = chosen;
        this.roamLookBackDone = false;
        this.roamWaypoint = null;

        // Set the persistent target speed once per sub-mode selection.
        switch (chosen) {
          case RoamSubMode.LAG_AND_SNIFF:
            this.roamTargetSpeed = 48 + Math.random() * 28; // 48-76 px/s
            break;
          case RoamSubMode.SCOUT_AHEAD:
            this.roamTargetSpeed = 185 + Math.random() * 55; // 185-240 px/s
            break;
          case RoamSubMode.CHECK_IN:
            this.roamTargetSpeed = 235 + Math.random() * 40; // 235-275 px/s
            break;
          case RoamSubMode.FLANK_PACE:
          case RoamSubMode.FREE_EXPLORE:
          default:
            this.roamTargetSpeed = 125 + Math.random() * 50; // 125-175 px/s
            break;
        }

        // Once-per-episode waypoint computation (no per-frame Math.random()).
        const headingSel = resolveOwnerHeading(this.owner);
        const fwdSelX = Math.cos(headingSel);
        const fwdSelY = Math.sin(headingSel);
        const rightSelX = -Math.sin(headingSel);
        const rightSelY = Math.cos(headingSel);
        const sideSel = this.preferredSide === 'left' ? -1 : 1;

        if (chosen === RoamSubMode.SCOUT_AHEAD) {
          this.roamSubModeOptionLead = 120 + Math.random() * 40;
          const lead = this.roamSubModeOptionLead;
          this.roamWaypoint = {
            x: this.owner.x + fwdSelX * lead + rightSelX * sideSel * 20,
            y: this.owner.y + fwdSelY * lead + rightSelY * sideSel * 20
          };
        } else if (chosen === RoamSubMode.FLANK_PACE) {
          this.roamSubModeOptionLateral = 55 + Math.random() * 15;
          this.roamSubModeOptionForward = 10 + Math.random() * 20;
          const lateral = this.roamSubModeOptionLateral;
          const forward = this.roamSubModeOptionForward;
          this.roamWaypoint = {
            x: this.owner.x + fwdSelX * forward + rightSelX * sideSel * lateral,
            y: this.owner.y + fwdSelY * forward + rightSelY * sideSel * lateral
          };
        } else if (chosen === RoamSubMode.LAG_AND_SNIFF) {
          const obstaclesSel = this._getFieldObstacles(field);
          let landmark = null;
          if (obstaclesSel.length > 0) {
            const candidates = obstaclesSel.filter(o => {
              const dOwner = Math.hypot(o.x - this.owner.x, o.y - this.owner.y);
              return dOwner >= 80 && dOwner <= 320;
            });
            if (candidates.length > 0) {
              landmark = candidates[Math.floor(Math.random() * candidates.length)];
            }
          }
          if (landmark) {
            const dxL = landmark.x - this.x;
            const dyL = landmark.y - this.y;
            const dL = Math.hypot(dxL, dyL) || 1;
            const skirt = (landmark.r || 20) + 22;
            this.roamWaypoint = {
              x: landmark.x - (dxL / dL) * skirt,
              y: landmark.y - (dyL / dL) * skirt
            };
          } else {
            this.roamSubModeOptionLag = 70 + Math.random() * 40;
            const lag = this.roamSubModeOptionLag;
            this.roamWaypoint = {
              x: this.owner.x - fwdSelX * lag + rightSelX * sideSel * 15,
              y: this.owner.y - fwdSelY * lag + rightSelY * sideSel * 15
            };
          }
        } else if (chosen === RoamSubMode.FREE_EXPLORE) {
          const obstaclesSel = this._getFieldObstacles(field);
          if (obstaclesSel.length > 0) {
            const candidates = obstaclesSel.filter(o => {
              const dOwner = Math.hypot(o.x - this.owner.x, o.y - this.owner.y);
              return dOwner >= 80 && dOwner <= 320;
            });
            if (candidates.length > 0) {
              const landmark = candidates[Math.floor(Math.random() * candidates.length)];
              const dxL = landmark.x - this.x;
              const dyL = landmark.y - this.y;
              const dL = Math.hypot(dxL, dyL) || 1;
              const skirt = (landmark.r || 20) + 22;
              this.roamWaypoint = {
                x: landmark.x - (dxL / dL) * skirt,
                y: landmark.y - (dyL / dL) * skirt
              };
            }
          }
        }
        }
      }
    }

    // Look-back wait moment: during SCOUT_AHEAD, once the dog is far enough
    // ahead it pauses briefly, faces the owner, then continues.
    if (this.roamLookBackActive) {
      this.roamLookBackTimer -= dt;
      this.vx *= 0.6;
      this.vy *= 0.6;
      this.wagSpeed = 6;
      if (this.owner) {
        this.angle = lerpAngle(
          this.angle,
          Math.atan2(this.owner.y - this.y, this.owner.x - this.x),
          Math.min(1, dt * 8)
        );
      }
      if (this.roamLookBackTimer <= 0) {
        this.roamLookBackActive = false;
      }
      return;
    }

    // 1. Woodland stick pickup check (trotting near fallen oak/chestnut grove sticks)
    if (!this.hasStick && !this.hasBall && field && Array.isArray(field.sticks)) {
      for (const stick of field.sticks) {
        if (!stick.isCarried && Math.hypot(this.x - stick.x, this.y - stick.y) < 28) {
          if (Math.random() < 0.35) {
            this.pickupStick(stick);
            break;
          }
        }
      }
    }

    // 2. Scent trail detection (investigating squirrel or canine scent trails)
    if (!this.hasStick && !this.hasBall && field && typeof field.getNearbyScents === 'function') {
      if (Math.random() < tuning.sniffChance) {
        const nearbyScents = field.getNearbyScents(this.x, this.y, 85);
        if (nearbyScents.length > 0) {
          const chosen = nearbyScents[Math.floor(Math.random() * nearbyScents.length)];
          this.targetScent = chosen;
          this.state = DogState.SNIFFING_TRAIL;
          this.stateTimer = 2.8 + Math.random() * 2.0;
          this.emoteBubble = '👃';
          this.emoteTimer = 1.8;
          return;
        }
      }
    }

    // 3. Rare zoomies burst when happiness reaches 100% (cooldown-gated)
    if (this.zoomiesCooldown <= 0 && this.happiness >= 100 && !this.owner.isLeashed && Math.random() < 0.015 * dt) {
      this.triggerZoomies();
      return;
    }

    const fromOwnerX = this.x - this.owner.x;
    const fromOwnerY = this.y - this.owner.y;
    const distToOwner = Math.hypot(fromOwnerX, fromOwnerY);

    // Resolve the visible screen perimeter once for catch-up + tether logic.
    const screen = this._getScreenPerimeter(field);

    // Trailing-edge catch-up: engage return trot near any screen edge.
    if (screen && (this.x < screen.left + 55 || this.x > screen.right - 55 ||
        this.y < screen.top + 55 || this.y > screen.bottom - 55)) {
      this.returnTrotActive = true;
    }

    // Distance-scaled catch-up: probabilistic return-trot when the dog drifts far from owner
    if (distToOwner > 220) {
      this.catchUpTimer += dt;
      if (this.catchUpTimer >= 1.2) {
        const base = Math.min(0.90, Math.max(0.08, (distToOwner - 220) / 260));
        const obedience = Number(this.personality?.obedience ?? 4);
        const p = Math.min(1, Math.max(0, base * (0.45 + 0.11 * obedience)));
        if (Math.random() < p) {
          this.returnTrotActive = true;
        }
        this.catchUpTimer = 0;
      }
    } else {
      this.catchUpTimer = 0;
    }

    if (this.returnTrotActive) {
      const insideScreenSafe = screen
        ? (this.x > screen.left + 120 && this.x < screen.right - 120 &&
           this.y > screen.top + 120 && this.y < screen.bottom - 120)
        : false;
      if ((screen && insideScreenSafe) || (!screen && distToOwner <= 110)) {
        this.returnTrotActive = false;
      } else {
        const targetX = screen ? screen.centerX : this.owner.x;
        const targetY = screen ? screen.centerY : this.owner.y;
        const toTargetX = targetX - this.x;
        const toTargetY = targetY - this.y;
        const dirDist = Math.hypot(toTargetX, toTargetY) || 1;
        const catchUpSpeed = screen ? Math.max(this.speed, 195) : this.speed;
        this.vx = (toTargetX / dirDist) * catchUpSpeed;
        this.vy = (toTargetY / dirDist) * catchUpSpeed;
        this.angle = lerpAngle(this.angle, Math.atan2(this.vy, this.vx), Math.min(1, dt * 12));
        this.wagSpeed = 10;
        return;
      }
    }

    // Maintain exploratory wander target (only ticked during FREE_EXPLORE so
    // episodic sub-modes interlace cleanly into baseline movement).
    if (this.roamSubMode === RoamSubMode.FREE_EXPLORE) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2.0 + Math.random() * 2.0;

        // Periodically pauses for 2-3s to sniff a spot (IDLE_SNIFF)
        if (Math.random() < 0.25) {
          this.transitionTo(DogState.IDLE_SNIFF);
          if (this.state !== DogState.ROLLING) {
            this.stateTimer = 2.0 + Math.random() * 1.0;
          }
          this.vx = 0;
          this.vy = 0;
          return;
        }

        // Trotting ahead or to the sides of walking path
        if (this.owner.isMoving) {
          const spread = (Math.random() - 0.5) * (Math.PI * 0.75);
          this.wanderAngle = this.owner.angle + spread;
        } else {
          this.wanderAngle = Math.random() * Math.PI * 2;
        }
      }
    }

    // Smoothly interpolate the current roam speed toward the persistent target.
    this.roamCurrentSpeed += (this.roamTargetSpeed - this.roamCurrentSpeed) * Math.min(1, dt * 5);

    // Mode-specific waypoint steering & decoupled speed selection.
    const heading = resolveOwnerHeading(this.owner);
    const fwdX = Math.cos(heading);
    const fwdY = Math.sin(heading);
    const rightX = -Math.sin(heading);
    const rightY = Math.cos(heading);
    const sideSign = this.preferredSide === 'left' ? -1 : 1;

    let desiredX = this.x + Math.cos(this.wanderAngle);
    let desiredY = this.y + Math.sin(this.wanderAngle);
    let modeSpeed = this.roamCurrentSpeed;

    switch (this.roamSubMode) {
      case RoamSubMode.SCOUT_AHEAD: {
        // Run ahead of the owner along their heading (stored lead, no jitter).
        // Prefer the stored waypoint when present so the target is stable.
        if (this.roamWaypoint) {
          desiredX = this.roamWaypoint.x;
          desiredY = this.roamWaypoint.y;
        } else {
          const lead = this.roamSubModeOptionLead || (120 + Math.random() * 40);
          desiredX = this.owner.x + fwdX * lead + rightX * sideSign * 20;
          desiredY = this.owner.y + fwdY * lead + rightY * sideSign * 20;
        }
        // Look-back wait moment when far enough ahead.
        if (distToOwner > 175 && !this.roamLookBackDone && !this.roamLookBackActive) {
          this.roamLookBackActive = true;
          this.roamLookBackTimer = 0.7 + Math.random() * 0.5;
          this.roamLookBackDone = true;
          return;
        }
        // Arrival: hand off back to baseline free exploration.
        if (Math.hypot(desiredX - this.x, desiredY - this.y) < 24) {
          this.roamSubMode = RoamSubMode.FREE_EXPLORE;
          this.roamBaselineTimer = 4.5 + Math.random() * 3.5;
          this.roamSubModeTimer = 0;
          this.roamTargetSpeed = 125 + Math.random() * 50;
          this.roamLookBackDone = false;
          this.roamWaypoint = null;
          desiredX = this.x + Math.cos(this.wanderAngle) * 100;
          desiredY = this.y + Math.sin(this.wanderAngle) * 100;
        }
        break;
      }
      case RoamSubMode.FLANK_PACE: {
        // Pace alongside the owner on the preferred flank (stored offsets).
        // Prefer the stored waypoint when present so the target is stable.
        if (this.roamWaypoint) {
          desiredX = this.roamWaypoint.x;
          desiredY = this.roamWaypoint.y;
        } else {
          const lateral = this.roamSubModeOptionLateral || (55 + Math.random() * 15);
          const forward = this.roamSubModeOptionForward || (10 + Math.random() * 20);
          desiredX = this.owner.x + fwdX * forward + rightX * sideSign * lateral;
          desiredY = this.owner.y + fwdY * forward + rightY * sideSign * lateral;
        }
        // Arrival or stationary owner: hand off back to baseline.
        if (!this.owner.isMoving || Math.hypot(desiredX - this.x, desiredY - this.y) < 24) {
          this.roamSubMode = RoamSubMode.FREE_EXPLORE;
          this.roamBaselineTimer = 4.5 + Math.random() * 3.5;
          this.roamSubModeTimer = 0;
          this.roamTargetSpeed = 125 + Math.random() * 50;
          this.roamLookBackDone = false;
          this.roamWaypoint = null;
          desiredX = this.x + Math.cos(this.wanderAngle) * 100;
          desiredY = this.y + Math.sin(this.wanderAngle) * 100;
        }
        break;
      }
      case RoamSubMode.LAG_AND_SNIFF: {
        // Trail behind the owner, ambling slowly toward the stored waypoint.
        if (this.roamWaypoint) {
          desiredX = this.roamWaypoint.x;
          desiredY = this.roamWaypoint.y;
        } else {
          const lag = this.roamSubModeOptionLag || (70 + Math.random() * 40);
          desiredX = this.owner.x - fwdX * lag + rightX * sideSign * 15;
          desiredY = this.owner.y - fwdY * lag + rightY * sideSign * 15;
        }
        // Arrival: sniff the spot, then hand off back to baseline.
        if (Math.hypot(desiredX - this.x, desiredY - this.y) < 24) {
          this.transitionTo(DogState.IDLE_SNIFF);
          if (this.state !== DogState.ROLLING) {
            this.stateTimer = 2.0 + Math.random() * 1.0;
          }
          this.roamSubMode = RoamSubMode.FREE_EXPLORE;
          this.roamBaselineTimer = 4.5 + Math.random() * 3.5;
          this.roamSubModeTimer = 0;
          this.roamTargetSpeed = 125 + Math.random() * 50;
          this.roamLookBackDone = false;
          this.roamWaypoint = null;
          return;
        }
        break;
      }
      case RoamSubMode.CHECK_IN: {
        // Dart back toward the owner for a check-in.
        desiredX = this.owner.x + rightX * sideSign * 30;
        desiredY = this.owner.y + rightY * sideSign * 30;
        // Arrival: hand off to baseline free exploration immediately.
        if (distToOwner < 48) {
          this.wagSpeed = 16;
          this.roamSubMode = RoamSubMode.FREE_EXPLORE;
          this.roamBaselineTimer = 4.5 + Math.random() * 3.5;
          this.roamSubModeTimer = 0;
          this.roamTargetSpeed = 125 + Math.random() * 50;
          this.roamLookBackDone = false;
          this.roamWaypoint = null;
        }
        break;
      }
      case RoamSubMode.FREE_EXPLORE:
      default: {
        // Baseline free wander, biased toward a stored landmark when available.
        if (this.roamWaypoint) {
          desiredX = this.roamWaypoint.x;
          desiredY = this.roamWaypoint.y;
          if (Math.hypot(desiredX - this.x, desiredY - this.y) < 24) {
            this.roamWaypoint = null;
          }
        } else {
          desiredX = this.x + Math.cos(this.wanderAngle) * 100;
          desiredY = this.y + Math.sin(this.wanderAngle) * 100;
        }
        break;
      }
    }

    // Micro-pause: occasionally freeze in place for 0.8-1.6s.
    if (this.roamMicroPauseTimer > 0) {
      this.roamMicroPauseTimer -= dt;
      this.vx = 0;
      this.vy = 0;
      this.wagSpeed = 5;
      return;
    }
    if (Math.random() < 0.004) {
      this.roamMicroPauseTimer = 0.8 + Math.random() * 0.8;
      this.vx = 0;
      this.vy = 0;
      return;
    }

    let dirX = desiredX - this.x;
    let dirY = desiredY - this.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    dirX /= dirLen;
    dirY /= dirLen;

    let wanderVx = dirX * modeSpeed;
    let wanderVy = dirY * modeSpeed;

    // Obstacle avoidance: skirt around trunks/props with a smooth tangent push.
    const roamObstacles = this._getFieldObstacles(field);
    if (roamObstacles.length > 0) {
      for (const obs of roamObstacles) {
        const odx = this.x - obs.x;
        const ody = this.y - obs.y;
        const odist = Math.hypot(odx, ody);
        const avoidRadius = (obs.r || 18) + this.radius + 18;
        if (odist < avoidRadius && odist > 0.001) {
          const nx = odx / odist;
          const ny = ody / odist;
          const strength = (avoidRadius - odist) / avoidRadius;
          // Repulsive normal + tangential slide so the dog skirts the trunk.
          const tangentX = -ny;
          const tangentY = nx;
          wanderVx += (nx * 0.7 + tangentX * 0.6) * modeSpeed * strength;
          wanderVy += (ny * 0.7 + tangentY * 0.6) * modeSpeed * strength;
        }
      }
    }

    // Screen-space perimeter steering (physical viewport) with headless fallback.
    if (screen) {
      const softMargin = 85;
      let inwardX = 0;
      let inwardY = 0;
      if (this.x < screen.left + softMargin) inwardX += 1;
      if (this.x > screen.right - softMargin) inwardX -= 1;
      if (this.y < screen.top + softMargin) inwardY += 1;
      if (this.y > screen.bottom - softMargin) inwardY -= 1;

      if (inwardX !== 0 || inwardY !== 0) {
        const toCenterX = screen.centerX - this.x;
        const toCenterY = screen.centerY - this.y;
        const toCenterLen = Math.hypot(toCenterX, toCenterY) || 1;
        const blend = 0.55;
        wanderVx = wanderVx * (1 - blend) + (toCenterX / toCenterLen) * modeSpeed * blend;
        wanderVy = wanderVy * (1 - blend) + (toCenterY / toCenterLen) * modeSpeed * blend;
        // Rotate wanderAngle toward the screen center so the dog turns back in.
        const centerAngle = Math.atan2(toCenterY, toCenterX);
        this.wanderAngle = lerpAngle(this.wanderAngle, centerAngle, Math.min(1, dt * 3));
      }

    }

    // Wide soft tether at 300px (headless fallback when no camera is present):
    // only bias back toward the owner once the dog has drifted far.
    if (!screen) {
      if (distToOwner > 300) {
        const bias = Math.min(1.0, (distToOwner - 300) / 80); // 0 at 300, 1 at 380
        const toOwnerX = (this.owner.x - this.x) / (distToOwner || 1);
        const toOwnerY = (this.owner.y - this.y) / (distToOwner || 1);
        this.vx = wanderVx * (1.0 - bias) + toOwnerX * modeSpeed * bias;
        this.vy = wanderVy * (1.0 - bias) + toOwnerY * modeSpeed * bias;
      } else {
        this.vx = wanderVx;
        this.vy = wanderVy;
      }
    } else {
      this.vx = wanderVx;
      this.vy = wanderVy;
    }

    if (this.roamSubMode === RoamSubMode.CHECK_IN && distToOwner < 48) {
      this.wagSpeed = 16;
    } else if (Math.hypot(this.vx, this.vy) > 8) {
      this.angle = lerpAngle(this.angle, Math.atan2(this.vy, this.vx), Math.min(1, dt * 12));
      this.wagSpeed = 9;
    } else {
      this.wagSpeed = 6;
    }

    // Spontaneous barking influenced by barkyness
    if (Math.random() < (this.personality.barkyness * 0.0006) && !this.isBarking) {
      this.bark();
    }
  }

  updateSocialGreet(dt, otherDogs = []) {
    if (!this.socialTargetDog || this.socialTargetDog.state === DogState.FETCHING) {
      this.socialTargetDog = null;
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      return;
    }

    if (this.owner && this.owner.isLeashed) {
      const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
      if (distToOwner > 95) {
        this.socialTargetDog = null;
        this.state = DogState.FOLLOWING;
        return;
      }
    }

    const dx = this.socialTargetDog.x - this.x;
    const dy = this.socialTargetDog.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 160) {
      this.socialTargetDog = null;
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      return;
    }

    // Shyness modifies social berth: low shyness dogs approach to ~28px, high shyness dogs keep a wider berth (~45px)
    const minBerth = 24 + this.personality.shyness * 4.2;
    const maxBerth = minBerth + 8;

    if (dist > maxBerth) {
      const approachSpeed = this.speed * 0.75;
      this.vx = (dx / dist) * approachSpeed;
      this.vy = (dy / dist) * approachSpeed;
      this.angle = Math.atan2(this.vy, this.vx);
    } else if (dist < minBerth) {
      const backSpeed = this.speed * 0.25;
      this.vx = -(dx / (dist || 1)) * backSpeed;
      this.vy = -(dy / (dist || 1)) * backSpeed;
      this.angle = Math.atan2(dy, dx);
    } else {
      const tangentX = -dy / dist;
      const tangentY = dx / dist;
      const circleSpeed = (!this.owner?.isLeashed && !this.socialTargetDog?.owner?.isLeashed) ? 65 : 30;
      this.vx = tangentX * circleSpeed;
      this.vy = tangentY * circleSpeed;
      this.angle = Math.atan2(dy, dx);
    }

    this.wagSpeed = 12 + this.personality.playfulness * 2;
    this.stateTimer -= dt;

    if (this.stateTimer <= 0) {
      const wasBothOffLeash = Boolean(!this.owner?.isLeashed && this.socialTargetDog && !this.socialTargetDog.owner?.isLeashed);
      const partner = this.socialTargetDog;
      this.socialTargetDog = null;
      // Playfulness modifies play-bow transition chance
      const playBowChance = 0.15 + (this.personality.playfulness / 5) * 0.45;
      if (wasBothOffLeash && this._tryStartPackPlay(partner)) {
        return;
      }
      if (Math.random() < playBowChance) {
        this.state = DogState.PLAY_BOW;
        this.stateTimer = 2.2;
        this.emoteBubble = '🐾';
        this.emoteTimer = 2.0;
        this.wagSpeed = 14 + this.personality.playfulness * 2;
      } else if (wasBothOffLeash && this.zoomiesCooldown <= 0 && Math.random() < 0.25) {
        this.triggerZoomies();
      } else {
        this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      }
    }
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
    this.wagSpeed = Math.min(22, Math.max(16, 16 + (this.personality?.playfulness || 3)));
    partner.wagSpeed = Math.min(22, Math.max(16, 16 + (partner.personality?.playfulness || 3)));
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

  updatePackPlay(dt, field = null) {
    const partner = this.packPlayPartner;

    // Safety: break the bond if the partner vanished, left pack play, or either
    // dog became leashed.
    if (!partner || partner.state !== DogState.PACK_PLAY ||
        (this.owner && this.owner.isLeashed) ||
        (partner.owner && partner.owner.isLeashed)) {
      this._breakPackPlay();
      this.transitionTo((this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING);
      return;
    }

    const dx = partner.x - this.x;
    const dy = partner.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;

    // Coordinated role swapping: only the LEAD dog drives the swap so both
    // dogs always hold complementary roles (never two LEADs / two CHASEs).
    if (this.packPlayRole === 'LEAD') {
      this.packPlayRoleTimer -= dt;
      if (this.packPlayRoleTimer <= 0) {
        this.packPlayRole = 'CHASE';
        if (this.packPlayPartner) this.packPlayPartner.packPlayRole = 'LEAD';
        this.packPlayRoleTimer = 4.0 + Math.random() * 3.0;
        if (this.packPlayPartner) this.packPlayPartner.packPlayRoleTimer = this.packPlayRoleTimer;
      }
    } else if (this.packPlayPartner) {
      // CHASE dog mirrors the partner's role to stay strictly complementary.
      this.packPlayRole = (this.packPlayPartner.packPlayRole === 'LEAD') ? 'CHASE' : 'LEAD';
    }
    this.packPlayTimer = this.packPlayRoleTimer;

    const playfulness = this.personality?.playfulness || 3;
    const screen = this._getScreenPerimeter(field);

    // Shared landmark exploration: bias the lead waypoint toward the nearest
    // landmark (tree, bench, or scent node/prop) within 220px so both dogs
    // investigate it together.
    let nearestLandmark = null;
    let nearestLandmarkDist = Infinity;
    const considerLandmark = (lm, defaultR) => {
      if (!lm || typeof lm.x !== 'number') return;
      const ly = (typeof lm.depthY === 'number') ? lm.depthY : lm.y;
      if (typeof ly !== 'number') return;
      const d = Math.hypot(lm.x - this.x, ly - this.y);
      if (d < 220 && d < nearestLandmarkDist) {
        nearestLandmark = { x: lm.x, y: ly, r: lm.r || lm.radius || lm.trunkRadius || defaultR };
        nearestLandmarkDist = d;
      }
    };
    if (field) {
      if (Array.isArray(field.trees)) {
        for (const tree of field.trees) considerLandmark(tree, 18);
      }
      if (Array.isArray(field.benches)) {
        for (const bench of field.benches) considerLandmark(bench, 32);
      }
      const scentNodes = Array.isArray(field.scentNodes)
        ? field.scentNodes
        : (Array.isArray(field.props) ? field.props : null);
      if (scentNodes) {
        for (const node of scentNodes) considerLandmark(node, 16);
      }
    }

    let desiredX;
    let desiredY;
    let modeSpeed;

    if (this.packPlayRole === 'LEAD') {
      // Lead dog canters toward a looping waypoint around the owner/field.
      this.packPlayWaypointTimer -= dt;
      if (!this.packPlayWaypoint || this.packPlayWaypointTimer <= 0 ||
          Math.hypot(this.packPlayWaypoint.x - this.x, this.packPlayWaypoint.y - this.y) < 30) {
        this.packPlayWaypointTimer = 2.5 + Math.random() * 2.0;
        if (nearestLandmark) {
          // Skirt the landmark so both dogs converge on it together.
          const dxL = nearestLandmark.x - this.x;
          const dyL = nearestLandmark.y - this.y;
          const dL = Math.hypot(dxL, dyL) || 1;
          const skirt = (nearestLandmark.r || 20) + 40;
          this.packPlayWaypoint = {
            x: nearestLandmark.x - (dxL / dL) * skirt,
            y: nearestLandmark.y - (dyL / dL) * skirt
          };
        } else {
          const anchorX = this.owner ? this.owner.x : this.x;
          const anchorY = this.owner ? this.owner.y : this.y;
          const angle = Math.random() * Math.PI * 2;
          const radius = 90 + Math.random() * 110;
          this.packPlayWaypoint = {
            x: anchorX + Math.cos(angle) * radius,
            y: anchorY + Math.sin(angle) * radius
          };
        }
      }
      desiredX = this.packPlayWaypoint.x;
      desiredY = this.packPlayWaypoint.y;
      modeSpeed = Math.min(200, Math.max(150, 150 + Math.random() * 60)); // [150, 200] px/s
    } else {
      // Chase dog pursues the lead dog, flanking when close.
      if (dist > 75) {
        desiredX = partner.x;
        desiredY = partner.y;
        modeSpeed = Math.min(210, Math.max(150, 170 + Math.random() * 50)); // [150, 210] px/s
      } else if (dist < 35) {
        // Veer/flank alongside at matching speed.
        const tangentX = -dy / dist;
        const tangentY = dx / dist;
        desiredX = this.x + tangentX * 60;
        desiredY = this.y + tangentY * 60;
        modeSpeed = Math.min(210, Math.max(150, 150 + Math.random() * 40));
      } else {
        desiredX = partner.x;
        desiredY = partner.y;
        modeSpeed = Math.min(210, Math.max(150, 150 + Math.random() * 40));
      }
    }
    // Final clamp: chase speed must never exceed 210 px/s.
    modeSpeed = Math.min(210, Math.max(150, modeSpeed));

    let dirX = desiredX - this.x;
    let dirY = desiredY - this.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    dirX /= dirLen;
    dirY /= dirLen;

    let vx = dirX * modeSpeed;
    let vy = dirY * modeSpeed;

    // Obstacle avoidance: skirt around trunks/props.
    const obstacles = this._getFieldObstacles(field);
    for (const obs of obstacles) {
      const odx = this.x - obs.x;
      const ody = this.y - obs.y;
      const odist = Math.hypot(odx, ody);
      const avoidRadius = (obs.r || 18) + this.radius + 18;
      if (odist < avoidRadius && odist > 0.001) {
        const nx = odx / odist;
        const ny = ody / odist;
        const strength = (avoidRadius - odist) / avoidRadius;
        vx += (nx * 0.7 + -ny * 0.6) * modeSpeed * strength;
        vy += (ny * 0.7 + nx * 0.6) * modeSpeed * strength;
      }
    }

    // Screen perimeter steering (soft margin 85px, hard clamp 32px).
    if (screen) {
      const softMargin = 85;
      let inwardX = 0;
      let inwardY = 0;
      if (this.x < screen.left + softMargin) inwardX += 1;
      if (this.x > screen.right - softMargin) inwardX -= 1;
      if (this.y < screen.top + softMargin) inwardY += 1;
      if (this.y > screen.bottom - softMargin) inwardY -= 1;
      if (inwardX !== 0 || inwardY !== 0) {
        const toCenterX = screen.centerX - this.x;
        const toCenterY = screen.centerY - this.y;
        const toCenterLen = Math.hypot(toCenterX, toCenterY) || 1;
        const blend = 0.55;
        vx = vx * (1 - blend) + (toCenterX / toCenterLen) * modeSpeed * blend;
        vy = vy * (1 - blend) + (toCenterY / toCenterLen) * modeSpeed * blend;
      }
    }

    // Owner-distance tether: keep within max roam distance of the owner.
    if (this.owner) {
      const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
      if (distToOwner > 320) {
        const bias = Math.min(1.0, (distToOwner - 320) / 80);
        const toOwnerX = (this.owner.x - this.x) / (distToOwner || 1);
        const toOwnerY = (this.owner.y - this.y) / (distToOwner || 1);
        vx = vx * (1.0 - bias) + toOwnerX * modeSpeed * bias;
        vy = vy * (1.0 - bias) + toOwnerY * modeSpeed * bias;
      }
    }

    this.vx = vx;
    this.vy = vy;

    if (Math.hypot(this.vx, this.vy) > 8) {
      this.angle = lerpAngle(this.angle, Math.atan2(this.vy, this.vx), Math.min(1, dt * 12));
    }

    this.wagSpeed = Math.min(22, Math.max(16, 16 + playfulness));

    // Periodic playful emote/pant burst every 6-8s.
    this.packPlayEmoteTimer -= dt;
    if (this.packPlayEmoteTimer <= 0) {
      this.packPlayEmoteTimer = 6.0 + Math.random() * 2.0;
      const emotes = ['🐾', '🐶', '❤️'];
      this.emoteBubble = emotes[Math.floor(Math.random() * emotes.length)];
      this.emoteTimer = 1.8;
      if (this.audio && typeof this.audio.playPant === 'function') {
        this.audio.playPant();
      }
    }

    // Hard clamp to the visible screen perimeter.
    if (screen) {
      this.x = Math.max(screen.left + 32, Math.min(screen.right - 32, this.x));
      this.y = Math.max(screen.top + 32, Math.min(screen.bottom - 32, this.y));
    }

    // Obstacle and world boundary collisions.
    if (field) {
      resolveFieldCollision(this, this.radius, field);
    }

    // Re-apply the screen hard clamp (32px inset) so collision pushback never
    // pushes the dog off-screen or into the edge band.
    if (this.camera) {
      const perim = this._getScreenPerimeter();
      if (perim) {
        this.x = Math.max(perim.left + 32, Math.min(perim.right - 32, this.x));
        this.y = Math.max(perim.top + 32, Math.min(perim.bottom - 32, this.y));
      }
    }

    // Final speed magnitude clamp: obstacle avoidance and perimeter steering
    // must never push the pack-play speed above 210 px/s.
    const currentSpeed = Math.hypot(this.vx, this.vy);
    if (currentSpeed > 210) {
      const scale = 210 / currentSpeed;
      this.vx *= scale;
      this.vy *= scale;
    }
  }

  updateRecalled(dt) {
    if (!this.owner) {
      this.state = DogState.ROAMING;
      return;
    }

    if (!this.isRecalledToHeel) {
      // Sprints back directly to owner
      const dx = this.owner.x - this.x;
      const dy = this.owner.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 40) {
        this.isRecalledToHeel = true;
        this.emoteBubble = '🐾';
        this.emoteTimer = 1.5;
        this.vx = 0;
        this.vy = 0;
      } else {
        const targetSpeed = this.sprintSpeed;
        this.vx = (dx / dist) * targetSpeed;
        this.vy = (dy / dist) * targetSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 18;
      }
    }

    if (this.isRecalledToHeel) {
      // Executes tight close heel following. When on-leash, use the leash
      // slot geometry; when off-leash, preserve the tight-heel follow offset
      // relative to the owner's forward flank.
      this.followDistance = 35;
      let targetX;
      let targetY;
      if (this.owner && this.owner.isLeashed) {
        const slot = getLeashSlot(this.owner);
        this.targetSlot = slot;
        targetX = slot.x;
        targetY = slot.y;
      } else {
        this.targetSlot = null;
        const heading = resolveOwnerHeading(this.owner);
        const sideSign = this.preferredSide === 'left' ? -1 : 1;
        const bearing = heading + sideSign * FLANK_RIGHT.mid;
        targetX = this.owner.x + Math.cos(bearing) * this.followDistance;
        targetY = this.owner.y + Math.sin(bearing) * this.followDistance;
      }

      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const dist = Math.hypot(dx, dy);

      const slowingRadius = 35;
      let targetSpeed = this.speed;
      if (dist < slowingRadius) {
        targetSpeed = this.speed * (dist / slowingRadius);
      }

      if (dist > 6) {
        this.vx = (dx / dist) * targetSpeed;
        this.vy = (dy / dist) * targetSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 12;
      } else {
        this.vx = 0;
        this.vy = 0;
        this.wagSpeed = 8;
      }

      this.recallHeelTimer -= dt;
      if (this.recallHeelTimer <= 0) {
        this.isRecalledToHeel = false;
        this.followDistance = 42;
        this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      }
    }
  }

  updateFetching(dt) {
    if (!this.targetBall) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      return;
    }

    if (!this.hasBall) {
      // Sprint toward ball
      const dx = this.targetBall.x - this.x;
      const dy = this.targetBall.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 14) {
        this.vx = (dx / dist) * this.sprintSpeed;
        this.vy = (dy / dist) * this.sprintSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 16;
      } else {
        // Grab the ball!
        this.hasBall = true;
        this.targetBall.attachToDog(this);
        this.emoteBubble = '🎾';
        this.emoteTimer = 2.0;
      }
    } else {
      // Return ball to owner
      if (!this.owner) {
        this.hasBall = false;
        this.targetBall.drop(this.x, this.y);
        this.targetBall = null;
        this.state = DogState.ROAMING;
        return;
      }

      const dx = this.owner.x - this.x;
      const dy = this.owner.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 36) {
        this.vx = (dx / dist) * this.speed;
        this.vy = (dy / dist) * this.speed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 14;
      } else {
        // Hand off ball to owner
        if (typeof this.targetBall.retrieveByOwner === 'function') {
          this.targetBall.retrieveByOwner();
        } else {
          this.targetBall.inOwnerPossession = true;
          this.targetBall.isCarried = false;
          this.targetBall.carrier = null;
        }
        this.hasBall = false;
        this.targetBall = null;
        this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
        this.pet();
        this.emoteBubble = '❤️';
        this.emoteTimer = 2.0;
      }
    }
  }

  updatePlayBow(dt) {
    this.vx *= 0.5;
    this.vy *= 0.5;
    this.stateTimer -= dt;
    this.wagSpeed = 14 + this.personality.playfulness * 2;
    if (this.stateTimer <= 0) {
      // Both off-leash: escalate into sustained pack play when a partner is available.
      const partner = this.socialTargetDog;
      const wasBothOffLeash = Boolean(!this.owner?.isLeashed && partner && !partner.owner?.isLeashed);
      if (wasBothOffLeash && this._tryStartPackPlay(partner)) {
        this.socialTargetDog = null;
        return;
      }
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }

  updateSniff(dt) {
    this.vx *= 0.4;
    this.vy *= 0.4;
    this.stateTimer -= dt;
    this.wagSpeed = 4;
    // Spontaneous barking influenced by barkyness
    if (Math.random() < (this.personality.barkyness * 0.001) && !this.isBarking) {
      this.bark();
    }
    if (this.owner && this.owner.isMoving && this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
    } else if (this.stateTimer <= 0) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }

  updateSitting(dt) {
    this.vx = 0;
    this.vy = 0;
    this.stateTimer -= dt;
    this.wagSpeed = 4;
    // Spontaneous barking influenced by barkyness
    if (Math.random() < (this.personality.barkyness * 0.001) && !this.isBarking) {
      this.bark();
    }
    if (this.owner && this.owner.isMoving && this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
    } else if (this.stateTimer <= 0) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }

  updateZoomies(dt, field) {
    if (this.owner && this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
      return;
    }
    this.zoomiesTimer -= dt;
    if (this.zoomiesTimer <= 0) {
      this.vx = 0;
      this.vy = 0;
      this.zoomiesPhase = 0;
      this.emoteBubble = '👅';
      this.emoteTimer = 2.0;
      this.transitionTo((this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING);
      return;
    }
    this.zoomiesPhase += dt * this.zoomiesSpeed;

    const t = this.zoomiesPhase;
    const cx = this.zoomiesCenter.x;
    const cy = this.zoomiesCenter.y;
    const rx = 135;
    const ry = 80;

    const activePath = this.zoomiesPath || ZoomiePath.FIGURE_EIGHT;

    let expectedX;
    let expectedY;
    let dx;
    let dy;

    if (activePath === ZoomiePath.ORBIT_OWNER) {
      // Circular orbit around the owner's LIVE position.
      const ownerX = this.owner ? this.owner.x : cx;
      const ownerY = this.owner ? this.owner.y : cy;
      this.zoomiesOrbitAngle += dt * this.zoomiesSpeed * (this.zoomiesOrbitDir || 1);
      const orbitR = this.zoomiesOrbitRadius;
      expectedX = ownerX + Math.cos(this.zoomiesOrbitAngle) * orbitR;
      expectedY = ownerY + Math.sin(this.zoomiesOrbitAngle) * orbitR;
      if (this.zoomiesOrbitOffset) {
        expectedX += this.zoomiesOrbitOffset.x;
        expectedY += this.zoomiesOrbitOffset.y;
      }
      dx = -Math.sin(this.zoomiesOrbitAngle) * orbitR * (this.zoomiesOrbitDir || 1);
      dy = Math.cos(this.zoomiesOrbitAngle) * orbitR * (this.zoomiesOrbitDir || 1);
    } else if (activePath === ZoomiePath.SHUTTLE) {
      // Shuttle back and forth between two anchors along the owner's heading.
      const s = Math.sin(this.zoomiesPhase);
      const ax = this.zoomiesShuttleA.x;
      const ay = this.zoomiesShuttleA.y;
      const bx = this.zoomiesShuttleB.x;
      const by = this.zoomiesShuttleB.y;
      expectedX = ax + (bx - ax) * 0.5 * (s + 1);
      expectedY = ay + (by - ay) * 0.5 * (s + 1);
      // Analytic derivative: d(expected)/dt = 0.5 * (b - a) * cos(phase) * zoomiesSpeed
      dx = (bx - ax) * 0.5 * Math.cos(this.zoomiesPhase);
      dy = (by - ay) * 0.5 * Math.cos(this.zoomiesPhase);
    } else {
      // Parametric figure-eight retaining Phase 3 regex compatibility.
      expectedX = cx + rx * Math.sin(this.zoomiesPhase);
      expectedY = cy + ry * (Math.sin(this.zoomiesPhase * 2) * 0.5);
      dx = rx * Math.cos(t);
      dy = ry * Math.cos(2 * t);
    }

    // Proactive obstacle repulsion: steer the path clear of trunks/props.
    let orbitObstacleHit = false;
    if (field) {
      const obstacles = this._getFieldObstacles(field);
      for (const obs of obstacles) {
        const odx = expectedX - obs.x;
        const ody = expectedY - obs.y;
        const odist = Math.hypot(odx, ody);
        const minClearance = (obs.r || 18) + this.radius + 22;
        if (odist < minClearance) {
          let nx = 0;
          let ny = 1;
          if (odist > 0.001) {
            nx = odx / odist;
            ny = ody / odist;
          }
          const push = minClearance - odist;
          const pushX = nx * push;
          const pushY = ny * push;
          expectedX += pushX;
          expectedY += pushY;
          this.zoomiesCenter.x += pushX;
          this.zoomiesCenter.y += pushY;
          if (this.zoomiesOrbitOffset) {
            this.zoomiesOrbitOffset.x += pushX;
            this.zoomiesOrbitOffset.y += pushY;
          }
          if (this.zoomiesShuttleA && this.zoomiesShuttleB) {
            this.zoomiesShuttleA.x += pushX;
            this.zoomiesShuttleA.y += pushY;
            this.zoomiesShuttleB.x += pushX;
            this.zoomiesShuttleB.y += pushY;
          }
          orbitObstacleHit = true;
        }
      }
    }

    // Decay the persistent orbit offset when no obstacle is pushing it.
    if (activePath === ZoomiePath.ORBIT_OWNER && !orbitObstacleHit && this.zoomiesOrbitOffset) {
      this.zoomiesOrbitOffset.x *= Math.max(0, 1 - dt * 1.5);
      this.zoomiesOrbitOffset.y *= Math.max(0, 1 - dt * 1.5);
    }

    // Set position to the expected position FIRST, then resolve collisions so
    // the push-out operates on fresh coordinates (no stale-position oscillation).
    this.x = expectedX;
    this.y = expectedY;

    // Collision-aware: resolve obstacles/bounds and shift the orbit center if displaced.
    if (field) {
      resolveFieldCollision(this, this.radius, field);
      const dispX = this.x - expectedX;
      const dispY = this.y - expectedY;
      this.zoomiesCenter.x += (this.x - expectedX);
      this.zoomiesCenter.y += (this.y - expectedY);
      if (this.zoomiesOrbitOffset) {
        this.zoomiesOrbitOffset.x += dispX;
        this.zoomiesOrbitOffset.y += dispY;
      }
      if (this.zoomiesShuttleA && this.zoomiesShuttleB) {
        this.zoomiesShuttleA.x += dispX;
        this.zoomiesShuttleA.y += dispY;
        this.zoomiesShuttleB.x += dispX;
        this.zoomiesShuttleB.y += dispY;
      }
    }

    // Analytic tangent velocity vector
    this.vx = dx * this.zoomiesSpeed;
    this.vy = dy * this.zoomiesSpeed;

    const targetAngle = Math.atan2(dy, dx);
    this.angle = lerpAngle(this.angle, targetAngle, Math.min(1, dt * 12));
    this.wagSpeed = 24;

    // Panting audio during zoomies (throttled)
    this._pantCooldown -= dt;
    if (this._pantCooldown <= 0 && this.audio && typeof this.audio.playPant === 'function') {
      this.audio.playPant();
      this._pantCooldown = 1.2;
    }

    if (field && field.particleSystem && Math.random() < 0.35) {
      field.particleSystem.emitGallopPuff(this.x, this.y, this.angle);
    }
  }

  updateSniffingTrail(dt, field) {
    this.stateTimer -= dt;
    this.sniffTime += dt;
    this.noseTwitch = Math.sin(this.sniffTime * 25) * 1.6;

    const now = Date.now();
    const cooldownActive = (now - this.lastSniffFollowAt) < 14000;

    // Snout position for vapor particles
    const snoutDist = 20;
    const sx = this.x + Math.cos(this.angle) * snoutDist;
    const sy = this.y + Math.sin(this.angle) * snoutDist;
    if (field && field.particleSystem && Math.random() < 0.22) {
      field.particleSystem.emitSniffParticles(sx, sy, this.angle);
    }

    // Sniffing audio (throttled)
    this._pantCooldown -= dt;
    if (this._pantCooldown <= 0 && this.audio && typeof this.audio.playSniff === 'function') {
      this.audio.playSniff();
      this._pantCooldown = 0.9;
    }

    // Follow or inspect target scent node (gated by 14s cooldown)
    if (this.targetScent && this.targetScent.life > 0) {
      const dx = this.targetScent.x - this.x;
      const dy = this.targetScent.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 12) {
        if (!cooldownActive) {
          const sniffSpeed = this.speed * 0.38;
          this.vx = (dx / dist) * sniffSpeed;
          this.vy = (dy / dist) * sniffSpeed;
          this.angle = lerpAngle(this.angle, Math.atan2(this.vy, this.vx), Math.min(1, dt * 10));
        } else {
          this.vx *= 0.5;
          this.vy *= 0.5;
        }
      } else {
        this.vx *= 0.5;
        this.vy *= 0.5;
        // Reached node: record cooldown timestamp once on first arrival only
        if (this.targetScent && this.lastReachedScent !== this.targetScent) {
          this.lastReachedScent = this.targetScent;
          this.lastSniffFollowAt = now;
          this.visitedScents.add(this.targetScent);
        }
        // Seek next connected scent if available (exclude own scents and already-visited nodes)
        if (field && typeof field.getNearbyScents === 'function') {
          const nearby = field.getNearbyScents(this.x, this.y, 65).filter(s =>
            s !== this.targetScent &&
            s.sourceId !== (this.id || 'self') &&
            s.source !== this &&
            !this.visitedScents.has(s)
          );
          if (nearby.length > 0) {
            const next = nearby[Math.floor(Math.random() * nearby.length)];
            this.targetScent = next;
          }
        }
      }
    } else {
      this.vx *= 0.5;
      this.vy *= 0.5;
    }

    this.wagSpeed = 8;
    if (this.owner && this.owner.isMoving && this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
    } else if (this.owner && !this.owner.isLeashed && Math.hypot(this.x - this.owner.x, this.y - this.owner.y) > 160) {
      this.state = DogState.ROAMING;
    } else if (this.stateTimer <= 0) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      this.targetScent = null;
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
    const sagCap = Math.min(2.0, leashLen * 0.03);
    const sag = Math.min(sagCap, this.leashSagPx || 0);

    ctx.strokeStyle = '#dc2626'; // Vivid crimson red nylon
    ctx.lineWidth = this.isPullingLeash ? 2.6 : 2.2;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(collarX, collarY);
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

// Browser global exposure so the Home Sanctuary can reuse the authentic model.
if (typeof window !== 'undefined') {
  window.CompanionDog = CompanionDog;
  window.CoatPreset = CoatPreset;
  window.DogState = DogState;
  window.NEED_SPEED_MULTIPLIER = NEED_SPEED_MULTIPLIER;
}
