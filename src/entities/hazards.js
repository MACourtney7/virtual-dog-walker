// Park Hazards, Critters, and Dog Park Gate Goal
import { AABB } from '../engine/physics.js';

export class Squirrel {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 24;
    this.height = 20;
    this.facing = -1;
    this.isStartled = false;
    this.startleTimer = 0;
    this.chatterTimer = 0;
  }

  get aabb() {
    return new AABB(this.x, this.y, this.width, this.height);
  }

  update(dt, barkWaves = []) {
    this.chatterTimer += dt * 8;

    // Check if startled by a bark wave!
    if (!this.isStartled) {
      for (const bw of barkWaves) {
        const dist = Math.hypot(bw.x - (this.x + 12), bw.y - (this.y + 10));
        if (dist <= bw.radius + 15) {
          this.isStartled = true;
          this.startleTimer = 0;
          break;
        }
      }
    } else {
      this.startleTimer += dt;
      // Flee upwards/away
      this.y -= 140 * dt;
      this.x += this.facing * 110 * dt;
    }
  }

  draw(ctx) {
    if (this.startleTimer > 1.5) return; // Disappeared off-screen

    ctx.save();
    ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
    if (this.facing < 0) ctx.scale(-1, 1);

    const tailBob = Math.sin(this.chatterTimer) * 2;

    // Bushy squirrel tail
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.ellipse(-8, -4 + tailBob, 7, 10, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.ellipse(0, 2, 7, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.arc(6, -2, 5, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(7, -3, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Acorn
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.arc(6, 4, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

export class MudPuddle {
  constructor(x, y, width = 64) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = 10;
  }

  get aabb() {
    return new AABB(this.x, this.y, this.width, this.height);
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = '#543d2b';
    ctx.beginPath();
    ctx.ellipse(this.x + this.width / 2, this.y + 4, this.width / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class GoalGate {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 60;
    this.height = 90;
    this.isCleared = false;
  }

  get aabb() {
    return new AABB(this.x + 10, this.y, 40, this.height);
  }

  draw(ctx) {
    ctx.save();
    // Wooden Dog Park Posts
    ctx.fillStyle = '#78350f';
    ctx.fillRect(this.x, this.y, 10, this.height);
    ctx.fillRect(this.x + 50, this.y, 10, this.height);

    // Archway Header
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.roundRect(this.x - 4, this.y - 14, 68, 16, 4);
    ctx.fill();

    // Sign text
    ctx.fillStyle = '#f3c948';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DOG PARK', this.x + 30, this.y - 3);

    // Bone Ornament
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(this.x + 22, this.y - 24, 16, 6, 2);
    ctx.fill();

    // Swinging picket gate doors
    ctx.fillStyle = '#d97706';
    ctx.fillRect(this.x + 10, this.y + 30, 20, 45);
    ctx.fillRect(this.x + 30, this.y + 30, 20, 45);

    ctx.restore();
  }
}
