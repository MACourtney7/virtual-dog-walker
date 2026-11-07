// Particle FX System for The Downs - Nature Soundscape, Canine Actions & Visual Overlays

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

export class LeafParticle extends Particle {
  constructor(x, y, vx, vy, color, width = 5, height = 3, angle = 0, rotSpeed = 2, maxLife = 1.8) {
    super(x, y, vx, vy, color, Math.max(width, height) / 2, maxLife, 35);
    this.w = width;
    this.h = height;
    this.angle = angle;
    this.rotSpeed = rotSpeed;
    this.flutterPhase = Math.random() * Math.PI * 2;
    this.flutterSpeed = 5.0 + Math.random() * 4.0;
  }

  update(dt) {
    super.update(dt);
    this.angle += this.rotSpeed * dt;
    this.flutterPhase += dt * this.flutterSpeed;
    this.x += Math.sin(this.flutterPhase) * 22 * dt;
    this.vx *= 0.94;
    this.vy *= 0.95;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.alpha * 0.95;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    // Render leaf shape with pointed tip and tapered stem
    ctx.ellipse(0, 0, this.w, this.h, 0, 0, Math.PI * 2);
    ctx.fill();
    // Subtle central leaf vein
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-this.w * 0.8, 0);
    ctx.lineTo(this.w * 0.8, 0);
    ctx.stroke();
    ctx.restore();
  }
}

export class SniffParticle extends Particle {
  constructor(x, y, vx, vy, color = 'rgba(251, 191, 36, 0.85)', radius = 1.5, maxLife = 0.7) {
    super(x, y, vx, vy, color, radius, maxLife, -10); // gentle buoyant upward waft
    this.ringRadius = 1.0;
    this.expandSpeed = 7.0 + Math.random() * 5.0;
  }

  update(dt) {
    super.update(dt);
    this.ringRadius += dt * this.expandSpeed;
    this.vx *= 0.92;
    this.vy *= 0.92;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.alpha * 0.8;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Center scent pip
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class ParticleSystem {
  constructor() {
    if (!Array.isArray(this.particles)) {
      this.particles = [];
    }
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

  // Gallop turf kick-up puffs behind sprinting canine/owner paws
  emitGallopPuff(x, y, angle = 0) {
    const colors = ['#3d682b', '#2e521e', '#593a20', '#422814', '#607d3b'];
    const oppAngle = angle + Math.PI;
    for (let i = 0; i < 4; i++) {
      const spread = (Math.random() - 0.5) * 0.9;
      const speed = 40 + Math.random() * 70;
      const vx = Math.cos(oppAngle + spread) * speed;
      const vy = Math.sin(oppAngle + spread) * speed - (15 + Math.random() * 25);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 1.4 + Math.random() * 1.8;
      const life = 0.3 + Math.random() * 0.25;
      this.particles.push(new Particle(x, y, vx, vy, color, radius, life, 220));
    }
  }

  // Fallen autumn leaves scattering when sprinted through
  emitFallenLeaves(x, y, impactVx = 0, impactVy = 0, clusterLeaves = null) {
    const leafColors = ['#b45309', '#c2410c', '#d97706', '#78350f', '#991b1b', '#ea580c', '#eab308'];
    const count = clusterLeaves && Array.isArray(clusterLeaves) ? clusterLeaves.length : 14;

    for (let i = 0; i < count; i++) {
      let color = leafColors[Math.floor(Math.random() * leafColors.length)];
      let w = 4.5 + Math.random() * 3.5;
      let h = 2.4 + Math.random() * 1.8;
      let initAngle = Math.random() * Math.PI * 2;
      let spawnX = x + (Math.random() - 0.5) * 20;
      let spawnY = y + (Math.random() - 0.5) * 20;

      if (clusterLeaves && clusterLeaves[i]) {
        const cl = clusterLeaves[i];
        if (cl.color) color = cl.color;
        if (cl.w) w = cl.w;
        if (cl.h) h = cl.h;
        if (cl.angle !== undefined) initAngle = cl.angle;
        if (cl.dx !== undefined) spawnX = x + cl.dx;
        if (cl.dy !== undefined) spawnY = y + cl.dy;
      }

      // Scatter outward radially with bias in the sprint direction
      const scatterAngle = Math.random() * Math.PI * 2;
      const scatterSpeed = 70 + Math.random() * 140;
      const vx = Math.cos(scatterAngle) * scatterSpeed + impactVx * 0.45;
      const vy = Math.sin(scatterAngle) * scatterSpeed + impactVy * 0.45 - (40 + Math.random() * 60);
      const rotSpeed = (Math.random() - 0.5) * 12;
      const maxLife = 1.4 + Math.random() * 1.0;

      this.particles.push(new LeafParticle(spawnX, spawnY, vx, vy, color, w, h, initAngle, rotSpeed, maxLife));
    }
  }

  // Nose-twitching sniffing scent particles wafting toward or from snout
  emitSniffParticles(x, y, angle = 0) {
    const colors = ['rgba(251, 191, 36, 0.75)', 'rgba(245, 158, 11, 0.75)', 'rgba(255, 255, 255, 0.85)', 'rgba(168, 85, 247, 0.65)'];
    for (let i = 0; i < 2; i++) {
      const spread = (Math.random() - 0.5) * 1.2;
      const speed = 12 + Math.random() * 18;
      // Drifts slightly toward / around nose
      const vx = Math.cos(angle + spread) * speed;
      const vy = Math.sin(angle + spread) * speed - 6;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 1.0 + Math.random() * 1.2;
      const life = 0.45 + Math.random() * 0.35;
      this.particles.push(new SniffParticle(x, y, vx, vy, color, radius, life));
    }
  }

  // Generic particle emitter. Safely handles malformed input.
  emit(config) {
    if (!Array.isArray(this.particles)) {
      this.particles = [];
    }
    if (!config || typeof config !== 'object') {
      return null;
    }

    const num = (value, fallback) => {
      const t = typeof value;
      if (t !== 'number' && t !== 'string' && t !== 'boolean') {
        return fallback;
      }
      try {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
      } catch (_err) {
        return fallback;
      }
    };

    const x = num(config.x, 0);
    const y = num(config.y, 0);
    const vx = num(config.vx, 0);
    const vy = num(config.vy, 0);
    const gravity = num(config.gravity, 180);

    // `radius` is an alias for `size`
    const sizeSource = config.size !== undefined ? config.size : config.radius;
    const radius = Math.max(0, num(sizeSource, 2));

    let life = num(config.life, 0.5);
    if (!(life > 0)) {
      life = 0.5;
    }

    const color = typeof config.color === 'string' && config.color
      ? config.color
      : '#ffffff';

    const particle = new Particle(x, y, vx, vy, color, radius, life, gravity);
    this.particles.push(particle);
    return particle;
  }

  // Water splash droplets (e.g. puddle / pond impacts)
  emitWaterSplash(x, y, count = 6) {
    if (!Array.isArray(this.particles)) {
      this.particles = [];
    }

    const safeNumber = (value) => {
      const t = typeof value;
      if (t !== 'number' && t !== 'string' && t !== 'boolean') {
        return NaN;
      }
      try {
        return Number(value);
      } catch (_err) {
        return NaN;
      }
    };

    const px = safeNumber(x);
    const py = safeNumber(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return 0;
    }

    let n = Math.floor(safeNumber(count));
    if (!Number.isFinite(n)) {
      n = 6;
    }
    n = Math.max(0, Math.min(100, n));
    if (!Number.isFinite(n)) {
      n = 6;
    }

    const colors = [
      'rgba(240, 253, 250, 0.8)',
      'rgba(56, 189, 248, 0.7)',
      'rgba(255, 255, 255, 0.9)'
    ];

    let emitted = 0;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 70;
      const vx = Math.cos(angle) * speed;
      const vy = -Math.abs(Math.sin(angle) * speed) - (40 + Math.random() * 60);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 1.2 + Math.random() * 1.8;
      const life = 0.35 + Math.random() * 0.35;

      const particle = this.emit({
        x: px,
        y: py,
        vx,
        vy,
        color,
        size: radius,
        life,
        gravity: 120
      });
      if (particle) {
        emitted++;
      }
    }
    return emitted;
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
