// Companion Dog Entity - Canine Steering AI, Floppy Ear Springs, Leash Mechanics & Ball Fetching
import { PoopPile } from './waste.js';

export const DogState = {
  FOLLOWING: 'FOLLOWING',
  ROAMING: 'ROAMING',
  SOCIAL_GREET: 'SOCIAL_GREET',
  IDLE_SNIFF: 'IDLE_SNIFF',
  SITTING: 'SITTING',
  FETCHING: 'FETCHING',
  PLAY_BOW: 'PLAY_BOW',
  BARKING: 'BARKING',
  RECALLED: 'RECALLED',
  LOST: 'LOST',
  POOPING: 'POOPING'
};

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

    // Event callbacks
    this.onStrayTriggered = null;
    this.onStrayResolved = null;
    this.onPoopDropped = null;
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
  }

  fetchBall(ball) {
    // If leashed, lost, or pooping, the dog NEVER enters FETCHING state and does not chase balls
    if (this.owner && this.owner.isLeashed) {
      return;
    }
    if (this.state === DogState.LOST || this.state === DogState.POOPING) {
      return;
    }
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

      case DogState.SOCIAL_GREET:
        this.updateSocialGreet(dt);
        break;

      case DogState.ROAMING:
        this.updateRoaming(dt, otherDogs);
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

      case DogState.BARKING:
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
          this.isBarking = false;
        }
        break;

      case DogState.FOLLOWING:
      default:
        this.updateFollowing(dt, otherDogs);
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

    // Leash constraint & pulling physics: If leashed to owner, hard clamp to max leash length
    if (this.owner && this.owner.isLeashed && this.state !== DogState.FETCHING) {
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
    } else if (this.owner && !this.owner.isLeashed && this.state !== DogState.LOST && this.state !== DogState.FETCHING) {
      this.isPullingLeash = false;
      // Off-leash bounded perimeter constraint: hard clamp to 230px so dog never strays out of sight
      const maxRoam = 230;
      const dx = this.x - this.owner.x;
      const dy = this.y - this.owner.y;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRoam) {
        this.x = this.owner.x + (dx / dist) * maxRoam;
        this.y = this.owner.y + (dy / dist) * maxRoam;
      }
    }

    // Obstacle and world boundary collisions
    if (field) {
      const resolved = field.resolveCircleCollision(this.x, this.y, this.radius);
      this.x = resolved.x;
      this.y = resolved.y;
    }

    this.depthY = this.y + 6;

    // 4. Ear Secondary Spring Physics responding to trot speed inertia
    const speedMag = Math.hypot(this.vx, this.vy);
    const trotBob = speedMag > 10 ? Math.sin(Date.now() * 0.014) * 0.12 : 0;
    const lateralLag = -Math.sin(this.angle) * this.vx * 0.0025 + Math.cos(this.angle) * this.vy * 0.0025;
    const speedLag = -speedMag * 0.0007;
    const targetLeftEar = speedLag - trotBob + lateralLag;
    const targetRightEar = speedLag + trotBob - lateralLag;

    // Left ear spring
    const leftForce = -this.springK * (this.leftEar.angle - targetLeftEar) - this.springDamp * this.leftEar.vel;
    this.leftEar.vel += leftForce * dt;
    this.leftEar.angle += this.leftEar.vel * dt;

    // Right ear spring
    const rightForce = -this.springK * (this.rightEar.angle - targetRightEar) - this.springDamp * this.rightEar.vel;
    this.rightEar.vel += rightForce * dt;
    this.rightEar.angle += this.rightEar.vel * dt;

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

  updateFollowing(dt, otherDogs = []) {
    if (!this.owner) return;

    if (!this.owner.isLeashed) {
      this.state = DogState.ROAMING;
      this.updateRoaming(dt, otherDogs);
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

  updateRoaming(dt, otherDogs = []) {
    if (!this.owner) return;

    if (this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
      this.followDistance = 42;
      return;
    }

    if (this.checkSocialInteractions(otherDogs)) {
      return;
    }

    const fromOwnerX = this.x - this.owner.x;
    const fromOwnerY = this.y - this.owner.y;
    let distToOwner = Math.hypot(fromOwnerX, fromOwnerY);

    // Hard boundary clamp: if distToOwner > 230, clamp position along the vector to owner
    if (distToOwner > 230) {
      this.x = this.owner.x + (fromOwnerX / distToOwner) * 230;
      this.y = this.owner.y + (fromOwnerY / distToOwner) * 230;
      distToOwner = 230;
    }

    // If distToOwner > 200: steer directly back toward the owner at normal trot speed until within 120px
    if (distToOwner > 200) {
      this.isReturningToOwner = true;
    }

    if (this.isReturningToOwner) {
      if (distToOwner <= 120) {
        this.isReturningToOwner = false;
      } else {
        const toOwnerX = this.owner.x - this.x;
        const toOwnerY = this.owner.y - this.y;
        const dirDist = Math.hypot(toOwnerX, toOwnerY) || 1;
        const trotSpeed = this.speed;
        this.vx = (toOwnerX / dirDist) * trotSpeed;
        this.vy = (toOwnerY / dirDist) * trotSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
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
      this.angle = Math.atan2(this.vy, this.vx);
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

    // Play-bow or squat posture squash/stretch
    if (this.state === DogState.PLAY_BOW) {
      ctx.scale(1.1, 0.85);
    } else if (this.state === DogState.POOPING) {
      ctx.scale(0.88, 1.12);
      ctx.translate(-2, 0);
    }

    // Paws (front and back)
    const legOffset = Math.sin(Date.now() * 0.012) * (Math.hypot(this.vx, this.vy) > 10 ? 3 : 0);
    const pawColor = this.coat.hasEyePatch ? '#f1f5f9' : (this.coat.tanColor || this.coat.bodyColor);
    ctx.fillStyle = pawColor;
    ctx.fillRect(-10, -9 - legOffset, 5, 4);
    ctx.fillRect(-10, 5 + legOffset, 5, 4);
    ctx.fillRect(8, -9 + legOffset, 5, 4);
    ctx.fillRect(8, 5 - legOffset, 5, 4);

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

    // Torso (rich coat)
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 13, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Subtle coat dorsal sheen
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.ellipse(-2, -2, 10, 4.5, -0.05, 0, Math.PI * 2);
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

    // Truffle Nose
    ctx.fillStyle = this.coat.noseColor || '#1e293b';
    ctx.beginPath();
    ctx.ellipse(19.2, 0, 1.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose specular shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(18.8, -0.6, 0.6, 0, Math.PI * 2);
    ctx.fill();

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

    // Floppy Ears (with spring rotation responding to trot speed inertia)
    // Left ear
    ctx.save();
    ctx.translate(9, -6);
    ctx.rotate(this.leftEar.angle);
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
    ctx.rotate(this.rightEar.angle);
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
