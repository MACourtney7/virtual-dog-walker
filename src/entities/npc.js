// Ambient Park NPC Entities (Walkers & Joggers) for The Downs
// Implements waypoint trail loops, arrival detection, bench pausing, and mutual soft avoidance steering

export const NPCState = {
  WALKING: 'WALKING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED'
};

const SKIN_TONES = [
  '#fed7aa', // Warm light peach
  '#fcd34d', // Warm golden
  '#fbcfe8', // Fair rosy
  '#d4a373', // Light tan
  '#a3704c', // Olive brown
  '#6f4e37', // Deep bronze
  '#e2b59a', // Peach neutral
  '#fecdd3'  // Pale pink
];

const HAIR_COLORS = [
  '#451a03', // Chestnut brown
  '#1e293b', // Midnight black
  '#78350f', // Russet dark auburn
  '#b45309', // Golden amber
  '#e2e8f0', // Silver blonde
  '#92400e', // Warm ginger
  '#292524'  // Dark espresso
];

const HAIR_STYLES = ['SHORT', 'WAVY', 'PONYTAIL', 'BEANIE'];

const WALKER_JACKETS = [
  '#1e3a8a', // Deep navy
  '#047857', // Forest green
  '#b91c1c', // Crimson red
  '#b45309', // Amber parka
  '#475569', // Slate grey
  '#0f766e', // Teal anorak
  '#6d28d9', // Deep violet
  '#3b82f6', // Royal blue
  '#334155'  // Charcoal
];

const JOGGER_JACKETS = [
  '#10b981', // Fluorescent emerald
  '#f59e0b', // High-vis amber
  '#ef4444', // Neon red
  '#06b6d4', // Bright cyan
  '#8b5cf6', // Electric purple
  '#ec4899', // Hot pink
  '#84cc16', // High-vis lime
  '#3b82f6', // Vivid blue
  '#f97316'  // Neon orange
];

const WALKER_PANTS = [
  '#334155', // Slate dark trousers
  '#1e293b', // Deep indigo denim
  '#475569', // Classic grey chinos
  '#374151', // Olive cargo
  '#1f2937'  // Dark charcoal
];

const JOGGER_PANTS = [
  '#0f172a', // Midnight athletic leggings
  '#1e1b4b', // Deep navy tights
  '#18181b', // Carbon black shorts
  '#0284c7', // Cyan trim shorts
  '#374151', // Slate grey leggings
  '#4338ca'  // Indigo tights
];

const HAT_COLORS = [
  '#c2410c', // Rust orange
  '#0284c7', // Sky blue
  '#15803d', // Pine green
  '#4338ca', // Indigo
  '#334155', // Slate
  '#64748b', // Fog grey
  '#e11d48'  // Berry red
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class ParkNPC {
  constructor(x, y, options = {}) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.speed = options.speed || 85;
    this.radius = options.radius || 14;
    this.depthY = this.y + 12;
    this.waypointIndex = options.waypointIndex || 0;
    this.waypoints = options.waypoints || [];
    this.pauseTimer = options.pauseTimer || 0;
    this.isNPC = true;
    this.isJogger = Boolean(options.isJogger);
    this.state = options.state || (this.pauseTimer > 0 ? NPCState.PAUSED : (this.isJogger ? NPCState.RUNNING : NPCState.WALKING));
    this.type = options.type || (this.isJogger ? 'jogger' : 'walker');
    this.name = options.name || 'Passerby';

    // Appearance properties
    this.skinTone = options.skinTone || pickRandom(SKIN_TONES);
    this.hairColor = options.hairColor || pickRandom(HAIR_COLORS);
    this.hairStyle = options.hairStyle || pickRandom(HAIR_STYLES);
    this.hatColor = options.hatColor || pickRandom(HAT_COLORS);
    this.jacketColor = options.jacketColor || (this.isJogger ? pickRandom(JOGGER_JACKETS) : pickRandom(WALKER_JACKETS));
    this.pantsColor = options.pantsColor || (this.isJogger ? pickRandom(JOGGER_PANTS) : pickRandom(WALKER_PANTS));
    this.shoeColor = options.shoeColor || (this.isJogger ? '#f8fafc' : '#0f172a');

    // Facing angle and animation state
    this.angle = options.angle !== undefined ? options.angle : Math.PI / 2;
    this.walkPhase = options.walkPhase !== undefined ? options.walkPhase : Math.random() * Math.PI * 2;
  }

  update(dt, obstacles = null, avoidanceEntities = []) {
    // 1. Paused State
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      this.vx = 0;
      this.vy = 0;
      if (this.pauseTimer <= 0) {
        this.pauseTimer = 0;
        this.state = this.isJogger ? NPCState.RUNNING : NPCState.WALKING;
      }
      this.depthY = this.y + 12;
      return;
    }

    // 2. Waypoint Path Navigation
    let desiredVx = 0;
    let desiredVy = 0;

    if (this.waypoints.length > 0) {
      const target = this.waypoints[this.waypointIndex];
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      const arrivalRadius = target.radius || 24;

      if (dist < arrivalRadius) {
        this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
        // Pause handling for walkers: If target has isBench or isOverlook or pauseDuration
        if (target.isBench || target.isOverlook || target.pauseDuration) {
          if (!this.isJogger) {
            this.pauseTimer = target.pauseDuration || (4.0 + Math.random() * 6.0);
            this.state = NPCState.PAUSED;
            this.vx = 0;
            this.vy = 0;
            this.depthY = this.y + 12;
            return;
          }
        }
      }

      const activeTarget = this.waypoints[this.waypointIndex];
      const tdx = activeTarget.x - this.x;
      const tdy = activeTarget.y - this.y;
      const tdist = Math.hypot(tdx, tdy);
      desiredVx = tdist > 0.001 ? (tdx / tdist) * this.speed : 0;
      desiredVy = tdist > 0.001 ? (tdy / tdist) * this.speed : 0;
    }

    // 3. Mutual Soft Avoidance Steering
    if (avoidanceEntities && Array.isArray(avoidanceEntities)) {
      for (const entity of avoidanceEntities) {
        if (entity && entity !== this) {
          const edx = this.x - entity.x;
          const edy = this.y - entity.y;
          const edist = Math.hypot(edx, edy);
          const minSep = this.radius + (entity.radius || 15) + 20;
          if (edist > 0.001 && edist < minSep) {
            const repForce = (1.0 - edist / minSep) * this.speed * 0.85;
            desiredVx += (edx / edist) * repForce;
            desiredVy += (edy / edist) * repForce;
          }
        }
      }
    }

    // 4. Velocity Integration & Speed Clamping
    const desiredSpeed = Math.hypot(desiredVx, desiredVy);
    if (desiredSpeed > this.speed) {
      desiredVx = (desiredVx / desiredSpeed) * this.speed;
      desiredVy = (desiredVy / desiredSpeed) * this.speed;
    }

    this.vx = desiredVx;
    this.vy = desiredVy;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 5. Obstacle Collision Resolution
    if (obstacles && typeof obstacles.resolveCircleCollision === 'function') {
      const resolved = obstacles.resolveCircleCollision(this.x, this.y, this.radius);
      if (resolved) {
        this.x = resolved.x;
        this.y = resolved.y;
      }
    }

    this.depthY = this.y + 12;

    // 6. Facing Angle & Walk Animation Phase
    const moveSpeed = Math.hypot(this.vx, this.vy);
    if (moveSpeed > 5) {
      this.angle = Math.atan2(this.vy, this.vx);
      this.walkPhase += dt * (this.isJogger ? 14 : 9.5);
    }
  }

  draw(ctx) {
    ctx.save();

    // 1. Soft ground drop shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 10, 14, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Walking / Running Legs & Shoes
    const isMoving = Math.hypot(this.vx, this.vy) > 5;
    const legSwing = isMoving ? Math.sin(this.walkPhase) * (this.isJogger ? 7.5 : 5.5) : 0;
    const legSpread = 7;

    // Left leg & shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    ctx.roundRect(this.x - legSpread - 3.5, this.y + 1 + legSwing, 5.5, 9, 2);
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    ctx.roundRect(this.x - legSpread - 4, this.y + 9 + legSwing, 6.8, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(this.x - legSpread - 4, this.y + 13 + legSwing, 6.8, 1.2);

    // Right leg & shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    ctx.roundRect(this.x + legSpread - 2, this.y + 1 - legSwing, 5.5, 9, 2);
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    ctx.roundRect(this.x + legSpread - 2.5, this.y + 9 - legSwing, 6.8, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(this.x + legSpread - 2.5, this.y + 13 - legSwing, 6.8, 1.2);

    // 3. Torso / Top
    if (this.isJogger) {
      // Athletic technical running top
      ctx.fillStyle = this.jacketColor;
      ctx.beginPath();
      ctx.roundRect(this.x - 10.5, this.y - 12, 21, 17, 4.5);
      ctx.fill();

      // Reflective chest stripe
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(this.x - 10, this.y - 5, 20, 2.5);

      // Sport bib / accent
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(this.x - 4, this.y - 2, 8, 6.5, 1.5);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(this.x - 2.5, this.y, 5, 1.2);
    } else {
      // Casual outdoor jacket / windbreaker
      ctx.fillStyle = this.jacketColor;
      ctx.beginPath();
      ctx.roundRect(this.x - 11, this.y - 12, 22, 18, 5);
      ctx.fill();

      // Lapels & collar
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(this.x - 4, this.y - 12);
      ctx.lineTo(this.x + 4, this.y - 12);
      ctx.lineTo(this.x, this.y - 6);
      ctx.closePath();
      ctx.fill();

      // Collar trim
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.beginPath();
      ctx.moveTo(this.x - 7, this.y - 12);
      ctx.lineTo(this.x - 3, this.y - 12);
      ctx.lineTo(this.x, this.y - 5);
      ctx.lineTo(this.x - 5, this.y - 5);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(this.x + 7, this.y - 12);
      ctx.lineTo(this.x + 3, this.y - 12);
      ctx.lineTo(this.x, this.y - 5);
      ctx.lineTo(this.x + 5, this.y - 5);
      ctx.closePath();
      ctx.fill();

      // Jacket zipper line
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - 5);
      ctx.lineTo(this.x, this.y + 6);
      ctx.stroke();
    }

    // 4. Arms & Hands
    const armSwing = isMoving ? Math.cos(this.walkPhase) * (this.isJogger ? 6 : 4.5) : 0;
    // Left arm
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    ctx.roundRect(this.x - 15.5, this.y - 10 - armSwing, 4.5, 12, 2);
    ctx.fill();
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x - 13.25, this.y + 3 - armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Right arm
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    ctx.roundRect(this.x + 11, this.y - 10 + armSwing, 4.5, 12, 2);
    ctx.fill();
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x + 13.25, this.y + 3 + armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 5. Head & Face
    const style = (this.hairStyle || 'SHORT').toUpperCase();

    // Rear hair layer for WAVY or PONYTAIL
    if (style === 'WAVY') {
      ctx.fillStyle = this.hairColor;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y - 18, 11.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'PONYTAIL') {
      const backAngle = (this.angle || Math.PI / 2) + Math.PI;
      const pBaseX = this.x + Math.cos(backAngle) * 7.5;
      const pBaseY = this.y - 22 + Math.sin(backAngle) * 6.5;

      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(pBaseX, pBaseY, 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = this.hairColor;
      const pTipX = pBaseX + Math.cos(backAngle) * 9.5;
      const pTipY = pBaseY + Math.sin(backAngle) * 9.5;
      ctx.beginPath();
      ctx.ellipse(pTipX, pTipY, 4.8, 7.8, backAngle + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head base with skin tone
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 20, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Ears on sides
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x - 8.8, this.y - 20, 2.2, 0, Math.PI * 2);
    ctx.arc(this.x + 8.8, this.y - 20, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Directional facial cues based on angle
    const angle = this.angle || Math.PI / 2;
    const eyeForwardX = Math.cos(angle) * 3.5;
    const eyeForwardY = Math.sin(angle) * 3.5;
    const eyeSideX = Math.sin(angle) * 2.8;
    const eyeSideY = -Math.cos(angle) * 2.8;

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(this.x + eyeForwardX + eyeSideX, this.y - 20 + eyeForwardY + eyeSideY, 1.1, 0, Math.PI * 2);
    ctx.arc(this.x + eyeForwardX - eyeSideX, this.y - 20 + eyeForwardY - eyeSideY, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Subtle nose directional indicator
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(this.x + Math.cos(angle) * 4.6, this.y - 20 + Math.sin(angle) * 4.6, 1.0, 0, Math.PI * 2);
    ctx.fill();

    // 6. Hairstyle
    this.drawHair(ctx, style);

    // Jogger athletic headband
    if (this.isJogger) {
      ctx.fillStyle = this.hatColor;
      ctx.beginPath();
      ctx.roundRect(this.x - 8.5, this.y - 24, 17, 3.8, 1.9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // 7. Nametag Display Badge
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const displayNametag = this.isJogger ? `${this.name} (Jogger)` : this.name;
    const textWidth = ctx.measureText(displayNametag).width;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.roundRect(this.x - textWidth / 2 - 6, this.y - 42, textWidth + 12, 16, 8);
    ctx.fill();

    ctx.fillStyle = this.isJogger ? '#67e8f9' : '#f8fafc';
    ctx.fillText(displayNametag, this.x, this.y - 30);

    ctx.restore();
  }

  drawHair(ctx, style) {
    ctx.save();
    switch (style) {
      case 'WAVY': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(this.x - 8.5, this.y - 17, 3.8, 6.5, -0.25, 0, Math.PI * 2);
        ctx.ellipse(this.x - 8.0, this.y - 11, 3.2, 5.0, 0.15, 0, Math.PI * 2);
        ctx.ellipse(this.x + 8.5, this.y - 17, 3.8, 6.5, 0.25, 0, Math.PI * 2);
        ctx.ellipse(this.x + 8.0, this.y - 11, 3.2, 5.0, -0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y - 23, 9.5, Math.PI * 0.9, Math.PI * 2.1);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(this.x - 8, this.y - 22);
        ctx.quadraticCurveTo(this.x - 4, this.y - 18.5, this.x, this.y - 21.5);
        ctx.quadraticCurveTo(this.x + 4, this.y - 18.5, this.x + 8, this.y - 22);
        ctx.lineTo(this.x + 7, this.y - 26);
        ctx.lineTo(this.x - 7, this.y - 26);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this.x - 3, this.y - 25, 5.5, Math.PI * 1.15, Math.PI * 1.75);
        ctx.stroke();
        break;
      }

      case 'PONYTAIL': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(this.x, this.y - 22, 9.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(this.x - 7.5, this.y - 21, 2.2, 3.8, -0.15, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.5, this.y - 21, 2.2, 3.8, 0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(this.x, this.y - 25.5, 4.2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();
        break;
      }

      case 'BEANIE': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(this.x - 7.2, this.y - 19, 2.5, 4.0, -0.2, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.2, this.y - 19, 2.5, 4.0, 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y - 21, 8.5, Math.PI * 0.95, Math.PI * 1.25);
        ctx.arc(this.x, this.y - 21, 8.5, Math.PI * 1.75, Math.PI * 2.05);
        ctx.fill();

        const beanieMain = this.hatColor || '#c2410c';
        ctx.fillStyle = beanieMain;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - 24, 10.0, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.roundRect(this.x - 9.5, this.y - 23, 19, 5.5, 2.5);
        ctx.fill();
        break;
      }

      case 'SHORT':
      default: {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(this.x, this.y - 22, 9.2, Math.PI * 0.85, Math.PI * 2.15);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(this.x - 7.5, this.y - 20.5, 2.5, 4.2, -0.2, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.5, this.y - 20.5, 2.5, 4.2, 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(this.x - 8, this.y - 22);
        ctx.quadraticCurveTo(this.x - 4, this.y - 19.5, this.x - 2, this.y - 22.5);
        ctx.quadraticCurveTo(this.x + 1, this.y - 19, this.x + 3.5, this.y - 22.5);
        ctx.quadraticCurveTo(this.x + 6, this.y - 20, this.x + 8, this.y - 22);
        ctx.lineTo(this.x + 7, this.y - 26);
        ctx.lineTo(this.x - 7, this.y - 26);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this.x - 2, this.y - 26, 4.5, Math.PI * 1.1, Math.PI * 1.8);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}

export class WalkerNPC extends ParkNPC {
  constructor(x, y, options = {}) {
    super(x, y, { speed: 85, ...options, type: 'walker', isJogger: false });
  }
}

export class JoggerNPC extends ParkNPC {
  constructor(x, y, options = {}) {
    super(x, y, { speed: 260, ...options, type: 'jogger', isJogger: true });
  }
}
