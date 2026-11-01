// Tennis Ball Toy - Ballistic 2.5D Trajectory, Bouncing & Canine Fetching Mechanics

export class TennisBall {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.z = 0; // Height off the ground (px)
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;

    this.radius = 7;
    this.gravity = 720;
    this.restitution = 0.62; // Bounce elasticity
    this.friction = 0.94; // Ground rolling friction

    this.isThrown = false;
    this.isCarried = false;
    this.carrier = null; // Dog currently holding the ball
    this.inOwnerPossession = true;
    this.depthY = this.y;
  }

  throw(fromX, fromY, dirX, dirY, speed = 360, launchZ = 180) {
    this.x = fromX;
    this.y = fromY;
    this.z = 12;

    const len = Math.hypot(dirX, dirY) || 1;
    this.vx = (dirX / len) * speed;
    this.vy = (dirY / len) * speed;
    this.vz = launchZ;

    this.isThrown = true;
    this.isCarried = false;
    this.carrier = null;
    this.inOwnerPossession = false;
  }

  attachToDog(dog) {
    this.isCarried = true;
    this.isThrown = false;
    this.carrier = dog;
    this.inOwnerPossession = false;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.z = 8;
  }

  drop(x, y) {
    this.isCarried = false;
    this.carrier = null;
    this.inOwnerPossession = false;
    this.x = x;
    this.y = y;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }

  retrieveByOwner() {
    this.inOwnerPossession = true;
    this.isThrown = false;
    this.isCarried = false;
    this.carrier = null;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.z = 0;
  }

  update(dt, field) {
    if (this.inOwnerPossession) {
      return;
    }

    if (this.isCarried && this.carrier) {
      // Offset ball at the dog's mouth position
      const mouthOffset = 18;
      this.x = this.carrier.x + Math.cos(this.carrier.angle) * mouthOffset;
      this.y = this.carrier.y + Math.sin(this.carrier.angle) * mouthOffset;
      this.z = 8;
      this.depthY = this.y + 4;
      return;
    }

    if (!this.isThrown && Math.hypot(this.vx, this.vy) < 1 && this.z <= 0) {
      this.z = 0;
      this.depthY = this.y;
      return;
    }

    // 2.5D Ballistic motion
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vz -= this.gravity * dt;
    this.z += this.vz * dt;

    // Ground bounce
    if (this.z <= 0) {
      this.z = 0;
      if (Math.abs(this.vz) > 40) {
        this.vz = -this.vz * this.restitution;
        this.vx *= 0.82;
        this.vy *= 0.82;
      } else {
        this.vz = 0;
        this.vx *= Math.pow(this.friction, dt * 60);
        this.vy *= Math.pow(this.friction, dt * 60);
      }
    }

    // World boundary bounce
    if (field) {
      const minX = 70;
      const maxX = field.width - 70;
      const minY = 70;
      const maxY = field.height - 70;

      if (this.x < minX) { this.x = minX; this.vx = -this.vx * 0.7; }
      if (this.x > maxX) { this.x = maxX; this.vx = -this.vx * 0.7; }
      if (this.y < minY) { this.y = minY; this.vy = -this.vy * 0.7; }
      if (this.y > maxY) { this.y = maxY; this.vy = -this.vy * 0.7; }
    }

    // Depth sorting base Y is the ground position
    this.depthY = this.y;
  }

  draw(ctx) {
    if (this.inOwnerPossession) {
      return;
    }

    ctx.save();
    // 1. Soft Shadow on the ground
    const shadowScale = Math.max(0.3, 1 - this.z / 180);
    const shadowAlpha = Math.max(0.12, 0.45 * (1 - this.z / 200));
    ctx.fillStyle = `rgba(20, 35, 15, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.radius * 1.3 * shadowScale, this.radius * 0.7 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Optic Yellow Tennis Ball (elevated by z)
    const drawY = this.y - this.z;
    ctx.fillStyle = '#d9f92e'; // Bright tennis felt green/yellow
    ctx.beginPath();
    ctx.arc(this.x, drawY, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Curved white felt seam
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(this.x - 2, drawY, this.radius * 0.65, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();

    // Subtle 3D ball highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(this.x - 2, drawY - 2, this.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
