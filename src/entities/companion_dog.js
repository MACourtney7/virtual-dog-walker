// Companion Dog Entity - Canine Steering AI, Floppy Ear Springs, Leash Mechanics & Ball Fetching

export const DogState = {
  FOLLOWING: 'FOLLOWING',
  IDLE_SNIFF: 'IDLE_SNIFF',
  SITTING: 'SITTING',
  FETCHING: 'FETCHING',
  PLAY_BOW: 'PLAY_BOW',
  BARKING: 'BARKING'
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
    bodyShade: '#121314',
    tanColor: '#4b5563',
    tanHighlight: '#6b7280',
    earRoot: '#1e2022',
    earHighlight: '#374151',
    noseColor: '#090a0f',
    bibColor: '#f1f5f9'
  }
};

export class CompanionDog {
  constructor(x = 1240, y = 920, owner = null, coat = CoatPreset.CHOCOLATE_TAN) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.speed = 195; // px/s
    this.sprintSpeed = 290; // px/s while fetching

    this.owner = owner;
    this.coat = coat;
    this.radius = 14;
    this.depthY = this.y + 6;

    this.state = DogState.FOLLOWING;
    this.stateTimer = 0;

    // Follow offset relative to owner
    this.followDistance = 62;
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
    this.targetBall = ball;
    this.state = DogState.FETCHING;
    this.wagSpeed = 15;
  }

  update(dt, field, otherDogs = [], activeBall = null) {
    // 1. Check ball status
    if (activeBall && (activeBall.isThrown || (this.state === DogState.FETCHING && !this.hasBall))) {
      this.targetBall = activeBall;
      this.state = DogState.FETCHING;
    }

    // 2. State Machine & Steering Behaviors
    switch (this.state) {
      case DogState.FETCHING:
        this.updateFetching(dt);
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
          this.state = DogState.FOLLOWING;
          this.isBarking = false;
        }
        break;

      case DogState.FOLLOWING:
      default:
        this.updateFollowing(dt, otherDogs);
        break;
    }

    // 3. Movement integration
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Leash constraint: If leashed to owner, hard clamp to max leash length
    if (this.owner && this.owner.isLeashed && this.state !== DogState.FETCHING) {
      const maxLeash = 105;
      const dx = this.x - this.owner.x;
      const dy = this.y - this.owner.y;
      const dist = Math.hypot(dx, dy);

      if (dist > maxLeash) {
        this.x = this.owner.x + (dx / dist) * maxLeash;
        this.y = this.owner.y + (dy / dist) * maxLeash;
        this.vx *= 0.5;
        this.vy *= 0.5;
      }
    }

    // Obstacle and world boundary collisions
    if (field) {
      const resolved = field.resolveCircleCollision(this.x, this.y, this.radius);
      this.x = resolved.x;
      this.y = resolved.y;
    }

    this.depthY = this.y + 6;

    // 4. Ear Secondary Spring Physics
    const targetLeftEar = -this.vx * 0.003;
    const targetRightEar = -this.vx * 0.003;

    // Left ear spring
    const leftForce = -this.springK * (this.leftEar.angle - targetLeftEar) - this.springDamp * this.leftEar.vel;
    this.leftEar.vel += leftForce * dt;
    this.leftEar.angle += this.leftEar.vel * dt;

    // Right ear spring
    const rightForce = -this.springK * (this.rightEar.angle - targetRightEar) - this.springDamp * this.rightEar.vel;
    this.rightEar.vel += rightForce * dt;
    this.rightEar.angle += this.rightEar.vel * dt;

    // 5. Tail Wagging
    const movingWag = Math.hypot(this.vx, this.vy) > 10 ? 1.5 : 1.0;
    this.tailAngle = Math.sin(Date.now() * 0.001 * this.wagSpeed * movingWag) * this.wagAmp;

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

  updateFollowing(dt, otherDogs) {
    if (!this.owner) return;

    // Desired position: slightly offset from owner
    const targetX = this.owner.x + Math.cos(this.owner.angle + this.followAngleOffset) * this.followDistance;
    const targetY = this.owner.y + Math.sin(this.owner.angle + this.followAngleOffset) * this.followDistance;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);

    // Check proximity to other dogs for Play-Bow interaction
    for (const other of otherDogs) {
      if (other !== this) {
        const dogDist = Math.hypot(this.x - other.x, this.y - other.y);
        if (dogDist < 58 && Math.random() < 0.02) {
          this.state = DogState.PLAY_BOW;
          this.stateTimer = 2.4;
          this.emoteBubble = '🐾';
          this.emoteTimer = 2.0;
          this.wagSpeed = 16;
          return;
        }
      }
    }

    // If owner stopped for a while, transition to idle sniff or sit
    if (!this.owner.isMoving && dist < 25) {
      this.vx *= 0.8;
      this.vy *= 0.8;
      this.wagSpeed = 6;
      if (Math.random() < 0.006) {
        this.state = Math.random() < 0.5 ? DogState.IDLE_SNIFF : DogState.SITTING;
        this.stateTimer = 2.0 + Math.random() * 3.0;
      }
      return;
    }

    // Arrival steering calculation
    const slowingRadius = 40;
    let targetSpeed = this.speed;
    if (dist < slowingRadius) {
      targetSpeed = this.speed * (dist / slowingRadius);
    }

    if (dist > 8) {
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

  updateFetching(dt) {
    if (!this.targetBall) {
      this.state = DogState.FOLLOWING;
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
        this.state = DogState.FOLLOWING;
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
        // Drop ball at owner's feet
        this.hasBall = false;
        this.targetBall.drop(this.x + Math.cos(this.angle) * 14, this.y + Math.sin(this.angle) * 14);
        this.targetBall = null;
        this.state = DogState.FOLLOWING;
        this.pet(); // reward with happiness!
      }
    }
  }

  updatePlayBow(dt) {
    this.vx *= 0.5;
    this.vy *= 0.5;
    this.stateTimer -= dt;
    this.wagSpeed = 18;
    if (this.stateTimer <= 0) {
      this.state = DogState.FOLLOWING;
    }
  }

  updateSniff(dt) {
    this.vx *= 0.4;
    this.vy *= 0.4;
    this.stateTimer -= dt;
    this.wagSpeed = 4;
    if (this.owner && this.owner.isMoving) {
      this.state = DogState.FOLLOWING;
    } else if (this.stateTimer <= 0) {
      this.state = DogState.FOLLOWING;
    }
  }

  updateSitting(dt) {
    this.vx = 0;
    this.vy = 0;
    this.stateTimer -= dt;
    this.wagSpeed = 4;
    if (this.owner && this.owner.isMoving) {
      this.state = DogState.FOLLOWING;
    } else if (this.stateTimer <= 0) {
      this.state = DogState.FOLLOWING;
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

    // Play-bow posture squash/stretch
    if (this.state === DogState.PLAY_BOW) {
      ctx.scale(1.1, 0.85);
    }

    // Paws (front and back)
    ctx.fillStyle = this.coat.tanColor;
    const legOffset = Math.sin(Date.now() * 0.012) * (Math.hypot(this.vx, this.vy) > 10 ? 3 : 0);
    ctx.fillRect(-10, -9 - legOffset, 5, 4);
    ctx.fillRect(-10, 5 + legOffset, 5, 4);
    ctx.fillRect(8, -9 + legOffset, 5, 4);
    ctx.fillRect(8, 5 - legOffset, 5, 4);

    // Feathered Tail
    ctx.save();
    ctx.translate(-14, 0);
    ctx.rotate(this.tailAngle);
    ctx.fillStyle = this.coat.tanColor;
    ctx.beginPath();
    ctx.ellipse(-6, 0, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Torso (rich coat)
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Creamy white chest bib
    ctx.fillStyle = this.coat.bibColor;
    ctx.beginPath();
    ctx.ellipse(5, 0, 4, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Teal collar with golden bone charm
    ctx.fillStyle = '#1b6b65';
    ctx.fillRect(6, -6, 2.5, 12);
    ctx.fillStyle = '#f3c948';
    ctx.beginPath();
    ctx.arc(8, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(11, 0, 7.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tan Muzzle & Nose
    ctx.fillStyle = this.coat.tanColor;
    ctx.beginPath();
    ctx.ellipse(16, 0, 4.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Liver Truffle Nose
    ctx.fillStyle = this.coat.noseColor;
    ctx.beginPath();
    ctx.arc(19, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Amber Eyes & Tan Eyebrow Pips
    // Eyes
    ctx.fillStyle = '#c6933a';
    ctx.beginPath();
    ctx.arc(12, -3.2, 1.4, 0, Math.PI * 2);
    ctx.arc(12, 3.2, 1.4, 0, Math.PI * 2);
    ctx.fill();

    // Honey-tan circular eyebrow pips (iconic cocker spaniel feature)
    ctx.fillStyle = this.coat.tanHighlight;
    ctx.beginPath();
    ctx.arc(10.5, -3.5, 1.1, 0, Math.PI * 2);
    ctx.arc(10.5, 3.5, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Floppy Cocker Spaniel Ears (with spring rotation)
    // Left ear
    ctx.save();
    ctx.translate(9, -6);
    ctx.rotate(this.leftEar.angle);
    ctx.fillStyle = this.coat.earHighlight;
    ctx.beginPath();
    ctx.ellipse(-1, -4, 4.5, 8, -Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Right ear
    ctx.save();
    ctx.translate(9, 6);
    ctx.rotate(this.rightEar.angle);
    ctx.fillStyle = this.coat.earHighlight;
    ctx.beginPath();
    ctx.ellipse(-1, 4, 4.5, 8, Math.PI * 0.15, 0, Math.PI * 2);
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

    // Catenary sag curve
    const midX = (handX + collarX) / 2;
    const midY = (handY + collarY) / 2 + 14;

    ctx.strokeStyle = '#991b1b'; // Classic crimson red nylon lead
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.quadraticCurveTo(midX, midY, collarX, collarY);
    ctx.stroke();
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
