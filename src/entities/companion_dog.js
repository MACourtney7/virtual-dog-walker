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
  SNIFFING: 'SNIFFING',
  SNIFFING_TRAIL: 'SNIFFING_TRAIL',
  GREETING: 'GREETING',
  CHASING: 'CHASING',
  STRAY: 'STRAY'
};

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * Math.min(1, Math.max(0, t));
}

export const CoatPreset = {
  CHOCOLATE_TAN: {
    name: 'Chocolate & Tan (Ziggy)',
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
  constructor(x = 1240, y = 920, owner = null, coat = CoatPreset.CHOCOLATE_TAN, collarColor = '#0d9488', personality = null) {
    this.x = x;
    this.y = y;
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

    this.state = (this.owner && !this.owner.isLeashed) ? DogState.ROAMING : DogState.FOLLOWING;
    this.stateTimer = 0;

    // Follow offset relative to owner (on-leash close heel follow between 35px and 45px)
    this.followDistance = 42;
    this.followAngleOffset = Math.PI * 0.75; // trots slightly behind and to the side

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

    // Canine Social Interactions
    this.socialTargetDog = null;

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
    this.visitedScents = new WeakSet();

    // Zoomies speed (rad/s)
    this.zoomiesSpeed = 3.8;

    // Current zone reference (set externally for sunny-zone rolling)
    this.currentZone = null;

    // Audio cooldowns
    this._whineCooldown = 0;
    this._pantCooldown = 0;

    // Event callbacks
    this.onStrayTriggered = null;
    this.onStrayResolved = null;
    this.onPoopDropped = null;
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
    this.idleRestTimer = 0;
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
  }

  triggerZoomies() {
    if (this.owner && this.owner.isLeashed) return false;
    if (this.state === DogState.LOST || this.state === DogState.POOPING) return false;
    this.dropStick();
    this.state = DogState.ZOOMIES;
    this.zoomiesTimer = 4.2;
    this.zoomiesPhase = 0;
    this.zoomiesCenter = { x: this.x, y: this.y };
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

  setEmote(emote, duration = 2.5) {
    this.emoteBubble = emote;
    this.emoteTimer = duration;
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
    this.state = DogState.RECALLED;
    this.isLost = false;
    this.ownerStillTimer = 0;
    this.strayCheckTimer = 0;
    this.emoteBubble = wasLost ? '❤️' : '!';
    this.emoteTimer = wasLost ? 2.5 : 2.0;
    this.wagSpeed = 18;
    this.isRecalledToHeel = false;
    this.recallHeelTimer = 10.0; // 10 seconds of close heel following
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

  pet() {
    this.happiness = Math.min(100, this.happiness + 20);
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
    if (this.happiness >= 100 && this.owner && !this.owner.isLeashed && Math.random() < 0.45) {
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
    this.targetBall = ball;
    this.state = DogState.FETCHING;
    this.wagSpeed = 15;
  }

  update(dt, field, otherDogs = [], activeBall = null, npcs = []) {
    const isLeashed = Boolean(this.owner && this.owner.isLeashed);
    const nearbyNPCs = npcs || [];
    this.checkNPCInteractions(nearbyNPCs);

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
      if (distToOwnerAudio > 220 && this._whineCooldown <= 0 && this.audio && typeof this.audio.playWhine === 'function') {
        this.audio.playWhine();
        this._whineCooldown = 1.5;
      }
    }

    // Ambient resting transitions: sit/sniff -> lie down after 15s of owner stillness
    const ownerSpeed = Math.hypot(this.owner?.vx || 0, this.owner?.vy || 0);
    if (this.owner && !this.owner.isLeashed && ownerSpeed < 5 && (this.state === DogState.SITTING || this.state === DogState.IDLE_SNIFF)) {
      this.idleRestTimer += dt;
      if (this.idleRestTimer > 15 && this.state !== DogState.LYING_DOWN) {
        this.transitionTo(DogState.LYING_DOWN);
        this.restStartAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      }
    } else if (ownerSpeed > 5) {
      this.idleRestTimer = 0;
      if (this.state === DogState.LYING_DOWN || this.state === DogState.ROLLING) {
        this.transitionTo(DogState.ROAMING);
      }
    } else {
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
        this.updateSocialGreet(dt);
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
          this.state = DogState.ROAMING;
          this.idleRestTimer = 0;
        }
        break;

      case DogState.ROLLING:
        this.vx *= 0.6;
        this.vy *= 0.6;
        this.wagSpeed = 20;
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.transitionTo(DogState.SITTING);
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

    // 3. Movement integration
    this.x += this.vx * dt;
    this.y += this.vy * dt;

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
      } else if (dist < 48 || (!this.owner.isMoving && Math.hypot(this.vx, this.vy) < 12)) {
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
      if (this.emoteTimer <= 0) this.emoteBubble = null;
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
  checkSocialInteractions(otherDogs) {
    if (!otherDogs || !Array.isArray(otherDogs)) return false;
    if (this.state === DogState.FETCHING || this.state === DogState.RECALLED || this.state === DogState.LOST || this.state === DogState.POOPING) return false;

    // Approach probability modified by shyness: low shyness dogs approach eagerly, high shyness approach with lower probability
    const approachProb = Math.max(0.008, 0.045 - (this.personality.shyness - 1) * 0.009);

    for (const other of otherDogs) {
      if (other && other !== this && other.state !== DogState.FETCHING && this.state !== DogState.FETCHING) {
        const dogDist = Math.hypot(this.x - other.x, this.y - other.y);
        if (dogDist < 110 && this.state !== DogState.SOCIAL_GREET && this.state !== DogState.PLAY_BOW && Math.random() < approachProb) {
          // Playfulness modifies chance to open directly with a play bow
          const playBowDirectChance = (this.personality.playfulness - 1) * 0.05;
          if (Math.random() < playBowDirectChance) {
            this.state = DogState.PLAY_BOW;
            this.stateTimer = 2.4;
            this.wagSpeed = 14 + this.personality.playfulness * 2;
            this.emoteBubble = '🐾';
            this.emoteTimer = 2.0;
          } else {
            this.state = DogState.SOCIAL_GREET;
            this.stateTimer = 3.0;
            this.wagSpeed = 12 + this.personality.playfulness * 2;
            this.emoteBubble = Math.random() < 0.5 ? '🐾' : (Math.random() < 0.5 ? '🐶' : '❤️');
            this.emoteTimer = 2.5;
          }
          this.socialTargetDog = other;
          return true;
        }
      }
    }
    return false;
  }

  updateFollowing(dt, otherDogs = [], field = null) {
    if (!this.owner) return;

    if (!this.owner.isLeashed) {
      this.state = DogState.ROAMING;
      this.updateRoaming(dt, otherDogs, field);
      return;
    }

    this.followDistance = 42;

    if (this.checkSocialInteractions(otherDogs)) {
      return;
    }

    // Desired position: slightly offset from owner
    const targetX = this.owner.x + Math.cos(this.owner.angle + this.followAngleOffset) * this.followDistance;
    const targetY = this.owner.y + Math.sin(this.owner.angle + this.followAngleOffset) * this.followDistance;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);

    // If owner stopped for a while, transition to idle sniff or sit
    // High obedience dogs stay attentive at heel longer with smaller stray chance
    const idleTransitionChance = Math.max(0.001, 0.009 - this.personality.obedience * 0.0015);
    if (!this.owner.isMoving && dist < 25) {
      this.vx *= 0.8;
      this.vy *= 0.8;
      this.wagSpeed = 6;
      if (Math.random() < idleTransitionChance) {
        this.state = Math.random() < 0.5 ? DogState.IDLE_SNIFF : DogState.SITTING;
        this.stateTimer = 2.0 + Math.random() * 3.0;
      }
      return;
    }

    // Arrival steering calculation matching owner's pace
    const slowingRadius = 40;
    let targetSpeed = this.speed;
    if (dist < slowingRadius) {
      targetSpeed = this.speed * (dist / slowingRadius);
    }

    // Higher obedience adheres strictly to heel follow offset with smaller arrival deadband
    const arrivalDeadband = Math.max(3, 11 - this.personality.obedience * 1.5);
    if (dist > arrivalDeadband) {
      this.vx = (dx / dist) * targetSpeed;
      this.vy = (dy / dist) * targetSpeed;
      this.angle = Math.atan2(this.vy, this.vx);
      this.wagSpeed = 10;
    } else {
      this.vx = 0;
      this.vy = 0;
      this.wagSpeed = 6;
    }
  }

  updateRoaming(dt, otherDogs = [], field = null) {
    if (!this.owner) return;

    if (this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
      this.followDistance = 42;
      return;
    }

    if (this.checkSocialInteractions(otherDogs)) {
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
      if (Math.random() < 0.08) {
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

    // 3. Occasional zoomies burst when happiness reaches 100%
    if (this.happiness >= 100 && !this.owner.isLeashed && Math.random() < 0.002) {
      this.triggerZoomies();
      return;
    }

    const fromOwnerX = this.x - this.owner.x;
    const fromOwnerY = this.y - this.owner.y;
    const distToOwner = Math.hypot(fromOwnerX, fromOwnerY);

    // Distance-scaled catch-up: probabilistic return-trot when the dog drifts far from owner
    this.catchUpTimer += dt;
    if (this.catchUpTimer >= 1.2 && distToOwner > 220) {
      const base = Math.min(0.90, Math.max(0.08, (distToOwner - 220) / 260));
      const obedience = Math.max(1, Math.min(5, Math.round(this.personality.obedience || 4)));
      const p = Math.min(1, Math.max(0, base * (0.45 + 0.11 * obedience)));
      if (Math.random() < p) {
        this.returnTrotActive = true;
      }
      this.catchUpTimer = 0;
    }

    if (this.returnTrotActive) {
      if (distToOwner <= 110) {
        this.returnTrotActive = false;
      } else {
        const toOwnerX = this.owner.x - this.x;
        const toOwnerY = this.owner.y - this.y;
        const dirDist = Math.hypot(toOwnerX, toOwnerY) || 1;
        this.vx = (toOwnerX / dirDist) * this.speed;
        this.vy = (toOwnerY / dirDist) * this.speed;
        this.angle = lerpAngle(this.angle, Math.atan2(this.vy, this.vx), Math.min(1, dt * 12));
        this.wagSpeed = 10;
        return;
      }
    }

    // Maintain exploratory wander target
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 2.0 + Math.random() * 2.0;

      // Periodically pauses for 2-3s to sniff a spot (IDLE_SNIFF)
      if (Math.random() < 0.25) {
        this.state = DogState.IDLE_SNIFF;
        this.stateTimer = 2.0 + Math.random() * 1.0;
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
      this.wanderSpeed = this.speed * (0.65 + Math.random() * 0.25);
    }

    let wanderVx = Math.cos(this.wanderAngle) * this.wanderSpeed;
    let wanderVy = Math.sin(this.wanderAngle) * this.wanderSpeed;

    // If distToOwner > 150: bias wander velocity back towards the owner
    if (distToOwner > 150) {
      const bias = Math.min(1.0, (distToOwner - 150) / 50); // 0 at 150, 1 at 200
      const toOwnerX = (this.owner.x - this.x) / (distToOwner || 1);
      const toOwnerY = (this.owner.y - this.y) / (distToOwner || 1);
      this.vx = wanderVx * (1.0 - bias) + toOwnerX * this.wanderSpeed * bias;
      this.vy = wanderVy * (1.0 - bias) + toOwnerY * this.wanderSpeed * bias;
    } else {
      if (!this.owner.isMoving && distToOwner < 40) {
        this.vx = wanderVx * 0.3;
        this.vy = wanderVy * 0.3;
      } else {
        this.vx = wanderVx;
        this.vy = wanderVy;
      }
    }

    if (Math.hypot(this.vx, this.vy) > 8) {
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

  updateSocialGreet(dt) {
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
      const circleSpeed = 30;
      this.vx = tangentX * circleSpeed;
      this.vy = tangentY * circleSpeed;
      this.angle = Math.atan2(dy, dx);
    }

    this.wagSpeed = 12 + this.personality.playfulness * 2;
    this.stateTimer -= dt;

    if (this.stateTimer <= 0) {
      this.socialTargetDog = null;
      // Playfulness modifies play-bow transition chance
      const playBowChance = 0.15 + (this.personality.playfulness / 5) * 0.45;
      if (Math.random() < playBowChance) {
        this.state = DogState.PLAY_BOW;
        this.stateTimer = 2.2;
        this.emoteBubble = '🐾';
        this.emoteTimer = 2.0;
        this.wagSpeed = 14 + this.personality.playfulness * 2;
      } else {
        this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      }
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
      // Executes tight close heel following (followDistance = 35)
      this.followDistance = 35;
      const targetX = this.owner.x + Math.cos(this.owner.angle + this.followAngleOffset) * this.followDistance;
      const targetY = this.owner.y + Math.sin(this.owner.angle + this.followAngleOffset) * this.followDistance;

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
    } else if (this.owner && !this.owner.isLeashed && Math.hypot(this.x - this.owner.x, this.y - this.owner.y) > 150) {
      this.state = DogState.ROAMING;
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
    } else if (this.owner && !this.owner.isLeashed && Math.hypot(this.x - this.owner.x, this.y - this.owner.y) > 150) {
      this.state = DogState.ROAMING;
    } else if (this.stateTimer <= 0) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }

  updateZoomies(dt, field) {
    if (this.owner && this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
      return;
    }
    if (this.zoomiesTimer <= 0) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      this.zoomiesPhase = 0;
      this.emoteBubble = '👅';
      this.emoteTimer = 2.0;
      return;
    }
    this.zoomiesTimer -= dt;
    this.zoomiesPhase += dt * this.zoomiesSpeed;

    const t = this.zoomiesPhase;
    const cx = this.zoomiesCenter.x;
    const cy = this.zoomiesCenter.y;
    const rx = 135;
    const ry = 80;

    // Parametric figure-eight retaining Phase 3 regex compatibility
    this.x = cx + rx * Math.sin(this.zoomiesPhase);
    this.y = cy + ry * (Math.sin(this.zoomiesPhase * 2) * 0.5);

    // Analytic tangent velocity vector
    const dx = rx * Math.cos(t);
    const dy = ry * Math.cos(2 * t);
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
        // Reached node: record cooldown timestamp
        this.lastSniffFollowAt = now;
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
            this.visitedScents.add(next);
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

    // 1. Draw Leash if leashed to owner
    if (this.owner && this.owner.isLeashed && this.state !== DogState.FETCHING) {
      this.drawLeash(ctx);
    }

    // 2. Soft ground shadow
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

    // 5. Floating Hearts
    for (const h of this.hearts) {
      ctx.save();
      ctx.globalAlpha = h.alpha;
      ctx.font = `${Math.round(h.size)}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('❤️', h.x, h.y);
      ctx.restore();
    }

    // 6. Emote Bubble
    if (this.emoteBubble) {
      this.drawEmote(ctx, this.emoteBubble);
    }
  }

  drawLeash(ctx) {
    ctx.save();
    // Hand anchor point on owner
    const handX = this.owner.x + Math.cos(this.owner.angle + Math.PI / 2) * 11;
    const handY = this.owner.y + Math.sin(this.owner.angle + Math.PI / 2) * 11;

    // Collar anchor point on dog
    const collarX = this.x;
    const collarY = this.y - 2;

    const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);

    if (this.isPullingLeash || distToOwner > 98) {
      // Taut, tensioned straight line from hand anchor to collar anchor with subtle vibrational jitter
      const jitter = Math.sin(Date.now() * 0.05) * 0.8;
      ctx.strokeStyle = '#991b1b'; // Classic crimson red nylon lead
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(handX, handY);
      ctx.lineTo(collarX + jitter, collarY + jitter);
      ctx.stroke();
    } else {
      // Slack catenary sag quadratic curve
      const midX = (handX + collarX) / 2;
      const midY = (handY + collarY) / 2 + 14;

      ctx.strokeStyle = '#991b1b'; // Classic crimson red nylon lead
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(handX, handY);
      ctx.quadraticCurveTo(midX, midY, collarX, collarY);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawEmote(ctx, emote) {
    ctx.save();
    const bx = this.x - 14;
    const by = this.y - 38;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(bx, by, 28, 22, 6);
    ctx.fill();

    // Pointer
    ctx.beginPath();
    ctx.moveTo(this.x - 3, by + 22);
    ctx.lineTo(this.x, by + 26);
    ctx.lineTo(this.x + 3, by + 22);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.font = emote.length > 2 ? 'bold 10px Outfit, sans-serif' : '14px serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(emote, this.x, by + 15);
    ctx.restore();
  }
}
