// Ziggy the Cocker Spaniel - Hero Entity & Procedural Character Engine
import { KinematicBody } from '../engine/physics.js';

export const ZiggyState = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  JUMPING: 'JUMPING',
  FALLING: 'FALLING',
  FLUTTERING: 'FLUTTERING',
  BARKING: 'BARKING'
};

export class BarkWave {
  constructor(x, y, facing) {
    this.x = x;
    this.y = y;
    this.facing = facing;
    this.radius = 8;
    this.maxRadius = 75;
    this.speed = 220; // px/s
    this.alpha = 1.0;
    this.isFinished = false;
  }

  update(dt) {
    this.radius += this.speed * dt;
    this.alpha = Math.max(0, 1 - (this.radius / this.maxRadius));
    if (this.radius >= this.maxRadius) {
      this.isFinished = true;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = `rgba(243, 201, 72, ${this.alpha * 0.85})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, -Math.PI / 2, Math.PI / 2, this.facing < 0);
    ctx.stroke();

    // Secondary sonic ring
    if (this.radius > 20) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${this.alpha * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius - 12, -Math.PI / 2, Math.PI / 2, this.facing < 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class Ziggy extends KinematicBody {
  constructor(x = 100, y = 300) {
    super(x, y, 52, 38);

    // Movement parameters
    this.moveSpeed = 240;
    this.sprintSpeed = 350;
    this.accel = 1600;
    this.friction = 1400;
    this.jumpForce = 490;

    // Cocker Spaniel Ear Spring Physics
    this.earAngle = 0;
    this.earVel = 0;
    this.earTarget = 0;

    // Tail Wag Physics
    this.tailTimer = 0;
    this.walkCycle = 0;

    // Ear-Flap Flutter (Double Jump Glide)
    this.canFlutter = true;
    this.isFluttering = false;
    this.flutterTimer = 0;
    this.flutterMax = 0.85; // seconds of hangtime

    // Bark ability
    this.barkCooldownTimer = 0;
    this.barkCooldownMax = 0.45;
    this.activeBarks = [];
    this.isBarkingAnimation = 0;

    // State & Callbacks
    this.state = ZiggyState.IDLE;
    this.onBarkTrigger = null; // Audio hook
  }

  handleInput(input, dt) {
    // Horizontal steering
    const moveDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (moveDir !== 0) {
      this.facing = moveDir;
      const targetSpeed = (input.sprint ? this.sprintSpeed : this.moveSpeed) * moveDir;
      this.vel.x += moveDir * this.accel * dt;
      if (Math.abs(this.vel.x) > Math.abs(targetSpeed)) {
        this.vel.x = targetSpeed;
      }
    } else {
      // Friction deceleration
      if (Math.abs(this.vel.x) > 10) {
        const sign = Math.sign(this.vel.x);
        this.vel.x -= sign * this.friction * dt;
        if (Math.sign(this.vel.x) !== sign) this.vel.x = 0;
      } else {
        this.vel.x = 0;
      }
    }

    // Jump / Drop Through
    if (input.jumpPressed) {
      if (input.down) {
        this.dropThrough();
      } else if (this.isGrounded || this.coyoteTimer > 0) {
        this.executeJump(this.jumpForce);
        this.canFlutter = true;
      } else if (this.canFlutter && !this.isGrounded && this.vel.y > -150) {
        // Trigger Ear-Flap Flutter!
        this.triggerFlutter();
      }
    }

    if (input.jumpReleased) {
      this.cutJump(0.5);
      if (this.isFluttering) {
        this.endFlutter();
      }
    }

    // Bark Action
    if (input.barkPressed && this.barkCooldownTimer <= 0) {
      this.triggerBark();
    }
  }

  triggerFlutter() {
    this.canFlutter = false;
    this.isFluttering = true;
    this.flutterTimer = this.flutterMax;
    this.vel.y = -180; // Gentle upward hop
  }

  endFlutter() {
    this.isFluttering = false;
    this.flutterTimer = 0;
  }

  triggerBark() {
    this.barkCooldownTimer = this.barkCooldownMax;
    this.isBarkingAnimation = 0.22;
    const snoutX = this.pos.x + (this.facing > 0 ? this.size.x + 4 : -4);
    const snoutY = this.pos.y + 16;
    this.activeBarks.push(new BarkWave(snoutX, snoutY, this.facing));
    if (this.onBarkTrigger) this.onBarkTrigger();
  }

  update(dt, platforms = []) {
    // Update bark waves
    for (let i = this.activeBarks.length - 1; i >= 0; i--) {
      const b = this.activeBarks[i];
      b.update(dt);
      if (b.isFinished) this.activeBarks.splice(i, 1);
    }

    if (this.barkCooldownTimer > 0) this.barkCooldownTimer -= dt;
    if (this.isBarkingAnimation > 0) this.isBarkingAnimation -= dt;

    // Flutter gravity modification
    if (this.isFluttering) {
      this.flutterTimer -= dt;
      this.gravity = 240; // Reduced hangtime gravity
      if (this.flutterTimer <= 0) {
        this.endFlutter();
      }
    } else {
      this.gravity = 1100;
    }

    // Standard kinematic physics update
    super.update(dt, platforms);

    if (this.isGrounded) {
      this.canFlutter = true;
      this.isFluttering = false;
    }

    // Determine state
    if (this.isBarkingAnimation > 0) {
      this.state = ZiggyState.BARKING;
    } else if (this.isFluttering) {
      this.state = ZiggyState.FLUTTERING;
    } else if (!this.isGrounded) {
      this.state = this.vel.y < 0 ? ZiggyState.JUMPING : ZiggyState.FALLING;
    } else if (Math.abs(this.vel.x) > 20) {
      this.state = ZiggyState.RUNNING;
    } else {
      this.state = ZiggyState.IDLE;
    }

    // Floppy Ear Spring Simulation
    let targetAngle = 0;
    if (this.state === ZiggyState.RUNNING) {
      targetAngle = -0.35 * this.facing; // ears trail behind
      this.walkCycle += dt * 14;
    } else if (this.state === ZiggyState.FLUTTERING) {
      targetAngle = Math.sin(performance.now() * 0.035) * 0.6; // rapid fluttering flapping
    } else if (this.state === ZiggyState.JUMPING) {
      targetAngle = 0.45; // drag down as he rises
    } else if (this.state === ZiggyState.FALLING) {
      targetAngle = -0.5; // fly up as he drops
    } else {
      targetAngle = Math.sin(performance.now() * 0.003) * 0.05; // gentle idle breathing
    }

    // Spring damper equation
    const stiffness = 120;
    const damping = 12;
    const displacement = this.earAngle - targetAngle;
    const force = -stiffness * displacement;
    this.earVel += force * dt;
    this.earVel *= Math.max(0, 1 - damping * dt);
    this.earAngle += this.earVel * dt;

    // Tail wag timer
    const wagSpeed = (Math.abs(this.vel.x) > 20) ? 18 : 6;
    this.tailTimer += dt * wagSpeed;
  }

  draw(ctx) {
    // Draw active bark soundwave rings in world space
    for (const b of this.activeBarks) {
      b.draw(ctx);
    }

    ctx.save();
    // Center coordinate for Ziggy
    const cx = this.pos.x + this.size.x / 2;
    const cy = this.pos.y + this.size.y / 2;

    ctx.translate(cx, cy);
    if (this.facing < 0) {
      ctx.scale(-1, 1);
    }

    this.renderCockerSpaniel(ctx);
    ctx.restore();
  }

  renderCockerSpaniel(ctx) {
    // Palette Tokens matching authentic Ziggy reference photos:
    const C_CHOCOLATE = '#321d16';
    const C_DARK_CHOCOLATE = '#22130e';
    const C_TAN_PIP = '#e2aa68';
    const C_TAN_MUZZLE = '#d49a58';
    const C_NOSE = '#543128';
    const C_AMBER_EYE = '#c6933a';
    const C_WHITE_CHEST = '#f4efe6';
    const C_EAR_HIGHLIGHT = '#9e5528';
    const C_HARNESS = '#1e2229';
    const C_COLLAR_TEAL = '#1b6b65';
    const C_BONE_GOLD = '#f3c948';

    const bounce = (this.state === ZiggyState.RUNNING) ? Math.sin(this.walkCycle * 2) * 2.5 : 0;
    const legSwing = (this.state === ZiggyState.RUNNING) ? Math.sin(this.walkCycle) * 10 : 0;

    // 1. Back Tail with Golden-Tan Feathering & Wagging
    ctx.save();
    const tailWag = Math.sin(this.tailTimer) * 0.35;
    ctx.translate(-20, -6 + bounce);
    ctx.rotate(-0.6 + tailWag);
    // Dark root
    ctx.fillStyle = C_CHOCOLATE;
    ctx.beginPath();
    ctx.ellipse(0, -6, 5, 12, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Feathered golden fringe
    ctx.fillStyle = C_TAN_PIP;
    ctx.beginPath();
    ctx.ellipse(2, -12, 4, 8, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Back Legs with Tan Feathering / Boots
    ctx.fillStyle = C_DARK_CHOCOLATE;
    // Back-left leg
    ctx.fillRect(-16 - legSwing * 0.4, 6 + bounce, 7, 12);
    ctx.fillStyle = C_TAN_MUZZLE; // Tan boot
    ctx.fillRect(-16 - legSwing * 0.4, 14 + bounce, 7, 4);

    // Front-left leg
    ctx.fillStyle = C_DARK_CHOCOLATE;
    ctx.fillRect(10 + legSwing * 0.4, 6 + bounce, 7, 12);
    ctx.fillStyle = C_TAN_MUZZLE;
    ctx.fillRect(10 + legSwing * 0.4, 14 + bounce, 7, 4);

    // 3. Torso (Rich Chocolate Body)
    ctx.fillStyle = C_CHOCOLATE;
    ctx.beginPath();
    ctx.roundRect(-20, -10 + bounce, 38, 22, [12, 12, 10, 10]);
    ctx.fill();

    // 4. White Chest Patch (Bib beneath neck)
    ctx.fillStyle = C_WHITE_CHEST;
    ctx.beginPath();
    ctx.ellipse(12, 0 + bounce, 6, 9, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // 5. Harness & Teal Collar
    ctx.fillStyle = C_HARNESS;
    ctx.beginPath();
    ctx.roundRect(-4, -10 + bounce, 9, 22, 4);
    ctx.fill();
    // Teal Collar
    ctx.fillStyle = C_COLLAR_TEAL;
    ctx.beginPath();
    ctx.roundRect(8, -12 + bounce, 7, 10, 3);
    ctx.fill();
    // Golden Bone Tag
    ctx.fillStyle = C_BONE_GOLD;
    ctx.beginPath();
    ctx.ellipse(12, 0 + bounce, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 6. Foreground Legs (Front-Right & Back-Right)
    ctx.fillStyle = C_CHOCOLATE;
    // Front-right leg
    ctx.fillRect(14 - legSwing * 0.6, 7 + bounce, 8, 12);
    ctx.fillStyle = C_TAN_MUZZLE; // tan boot
    ctx.fillRect(14 - legSwing * 0.6, 15 + bounce, 8, 4);

    // Back-right leg
    ctx.fillStyle = C_CHOCOLATE;
    ctx.fillRect(-12 + legSwing * 0.6, 7 + bounce, 8, 12);
    ctx.fillStyle = C_TAN_MUZZLE;
    ctx.fillRect(-12 + legSwing * 0.6, 15 + bounce, 8, 4);

    // 7. Head (Chocolate Crown)
    ctx.save();
    ctx.translate(14, -14 + bounce);

    ctx.fillStyle = C_CHOCOLATE;
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // 8. Tan Muzzle & Snout
    ctx.fillStyle = C_TAN_MUZZLE;
    ctx.beginPath();
    ctx.ellipse(8, 4, 9, 7, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Dark Liver Nose
    ctx.fillStyle = C_NOSE;
    ctx.beginPath();
    ctx.ellipse(14, 2, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 9. Amber Eye & Soulful Pupil
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(4, -3, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = C_AMBER_EYE;
    ctx.beginPath();
    ctx.ellipse(5, -3, 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#111111'; // pupil
    ctx.beginPath();
    ctx.arc(5.5, -3, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // White eye shine
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(6.5, -4, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // 10. Ziggy's Signature Honey-Tan Eyebrow Pip!
    ctx.fillStyle = C_TAN_PIP;
    ctx.beginPath();
    ctx.ellipse(3, -9, 3.5, 2.2, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // 11. Floppy Cocker Spaniel Ears with Spring Physics & Curls!
    ctx.save();
    ctx.translate(-4, -6);
    ctx.rotate(this.earAngle);

    // Ear body (Dark Chocolate)
    ctx.fillStyle = C_CHOCOLATE;
    ctx.beginPath();
    ctx.ellipse(0, 16, 7, 18, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Chestnut Crimped Ear Highlights & Texture
    ctx.fillStyle = C_EAR_HIGHLIGHT;
    ctx.beginPath();
    ctx.ellipse(2, 22, 5, 12, 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Ear tip curl
    ctx.fillStyle = C_TAN_MUZZLE;
    ctx.beginPath();
    ctx.arc(4, 28, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // restore ear
    ctx.restore(); // restore head
  }
}
