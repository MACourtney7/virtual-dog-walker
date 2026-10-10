// Collectibles System: Golden Bones, Tennis Balls, and Sausages
import { AABB } from '../engine/physics.js';

export const CollectibleType = {
  BONE: 'BONE',
  TENNIS_BALL: 'TENNIS_BALL',
  SAUSAGE: 'SAUSAGE'
};

export class Collectible {
  constructor(x, y, type = CollectibleType.BONE) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.size = 22;
    this.isCollected = false;
    this.floatTimer = Math.random() * Math.PI * 2;
  }

  get aabb() {
    return new AABB(this.x, this.y, this.size, this.size);
  }

  update(dt) {
    this.floatTimer += dt * 3.5;
  }

  draw(ctx) {
    if (this.isCollected) return;

    const bobY = this.y + Math.sin(this.floatTimer) * 4;

    ctx.save();
    ctx.translate(this.x + this.size / 2, bobY + this.size / 2);

    if (this.type === CollectibleType.BONE) {
      // Golden Bone
      ctx.fillStyle = '#f3c948';
      ctx.strokeStyle = '#c4971c';
      ctx.lineWidth = 1.5;

      // Center bridge
      ctx.fillRect(-7, -2.5, 14, 5);
      // Knobs
      ctx.beginPath();
      ctx.arc(-7, -4, 3.2, 0, Math.PI * 2);
      ctx.arc(-7, 4, 3.2, 0, Math.PI * 2);
      ctx.arc(7, -4, 3.2, 0, Math.PI * 2);
      ctx.arc(7, 4, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Shimmer highlight
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-2, -1, 1.5, 0, Math.PI * 2);
      ctx.fill();

    } else if (this.type === CollectibleType.TENNIS_BALL) {
      // Bright Neon Tennis Ball
      ctx.fillStyle = '#bef264';
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
      ctx.fill();

      // Curved seam
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-3, 0, 6, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();

    } else if (this.type === CollectibleType.SAUSAGE) {
      // Meaty Sausage
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.roundRect(-8, -4, 16, 8, 4);
      ctx.fill();

      ctx.fillStyle = '#f87171';
      ctx.fillRect(-4, -2, 8, 4);
    }

    ctx.restore();
  }
}
