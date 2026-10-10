// Particle FX System for Ziggy's Park Adventure

export class Particle {
  constructor(x, y, vx, vy, color, radius, maxLife, gravity = 180) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.radius = radius;
    this.maxLife = maxLife;
    this.life = maxLife;
    this.gravity = gravity;
    this.alpha = 1.0;
  }

  update(dt) {
    this.life -= dt;
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.alpha = Math.max(0, this.life / this.maxLife);
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  // Dirt & grass specks when running or jumping
  emitDust(x, y, facing = 1) {
    const colors = ['#855836', '#4a7c39', '#a67c52', '#3a632d'];
    for (let i = 0; i < 5; i++) {
      const vx = (-facing * (40 + Math.random() * 60)) + (Math.random() * 30 - 15);
      const vy = -30 - Math.random() * 50;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 2 + Math.random() * 2.5;
      const life = 0.25 + Math.random() * 0.25;
      this.particles.push(new Particle(x, y, vx, vy, color, radius, life, 350));
    }
  }

  // Shimmering golden stars when picking up bones
  emitSparkles(x, y) {
    const colors = ['#f3c948', '#ffffff', '#ffe082', '#ffd54f'];
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 120;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 1.8 + Math.random() * 2.2;
      const life = 0.4 + Math.random() * 0.4;
      this.particles.push(new Particle(x, y, vx, vy, color, radius, life, 80));
    }
  }

  // Confetti explosion at victory dog park gate
  emitConfetti(x, y) {
    const colors = ['#e04848', '#f3c948', '#22c55e', '#38bdf8', '#a855f7'];
    for (let i = 0; i < 40; i++) {
      const vx = (Math.random() - 0.5) * 320;
      const vy = -150 - Math.random() * 250;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 3 + Math.random() * 3;
      const life = 1.0 + Math.random() * 0.8;
      this.particles.push(new Particle(x, y, vx, vy, color, radius, life, 220));
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      p.draw(ctx);
    }
  }
}
