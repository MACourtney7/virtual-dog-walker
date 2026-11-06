// Ambient Park NPC Entities (Walkers & Joggers) for The Downs
// Implements deterministic polyline traversal, finite lifecycle fading, italic nametags, and seeded speech timelines

import {
  mulberry32,
  NPC_SPEED,
  NPC_TAG_STYLE,
  npcIdentityFromSeed,
  pickPhrase,
  nextSpeechDelay,
  COMMON_PHRASES,
  ODD_PHRASES
} from './npc_content.js';
import { getNpcPath, NPC_PATHS } from '../world/npc_paths.js';
import { sampleNpcPath } from '../engine/wasm_sim_bridge.js';

export const NPCState = {
  WALKING: 'WALKING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED'
};

export function toSeconds(t) {
  const n = Number(t) || 0;
  return n > 1e10 ? n / 1000 : n;
}

export class ParkNPC {
  constructor(x = {}, y = 0, options = {}) {
    let opts = {};
    let isLegacy = false;
    let legacyX = 0;
    let legacyY = 0;

    if (typeof x === 'object' && x !== null) {
      opts = x;
    } else if (typeof x === 'number') {
      isLegacy = true;
      legacyX = x;
      legacyY = typeof y === 'number' ? y : 0;
      opts = (typeof options === 'object' && options !== null) ? options : {};
    } else {
      opts = {};
    }

    this.id = opts.id !== undefined && opts.id !== null ? String(opts.id) : ('npc-' + Math.floor(Math.random() * 1000000));
    const rawType = opts.type || (opts.isJogger ? 'jogger' : 'walker');
    this.type = (String(rawType).toLowerCase() === 'jogger') ? 'jogger' : 'walker';
    this.isJogger = this.type === 'jogger';
    this.seed = opts.seed !== undefined ? (Math.floor(Number(opts.seed)) || 0) : 0;
    this.spawnTime = toSeconds(opts.spawnTime !== undefined ? opts.spawnTime : 0);
    this.speed = opts.speed !== undefined
      ? Number(opts.speed)
      : (NPC_SPEED[this.type] || NPC_SPEED.walker);
    this.radius = opts.radius !== undefined ? opts.radius : 14;

    // Appearance from seed & type
    const identity = npcIdentityFromSeed(this.seed, this.type);
    this.name = opts.name !== undefined ? opts.name : identity.name;
    this.skinTone = opts.skinTone !== undefined ? opts.skinTone : identity.skinTone;
    this.hairColor = opts.hairColor !== undefined ? opts.hairColor : identity.hairColor;
    this.hairStyle = opts.hairStyle !== undefined ? opts.hairStyle : identity.hairStyle;
    this.hatColor = opts.hatColor !== undefined ? opts.hatColor : identity.hatColor;
    this.jacketColor = opts.jacketColor !== undefined ? opts.jacketColor : identity.jacketColor;
    this.pantsColor = opts.pantsColor !== undefined ? opts.pantsColor : identity.pantsColor;
    this.shoeColor = opts.shoeColor !== undefined ? opts.shoeColor : identity.shoeColor;
    this.accessory = opts.accessory !== undefined ? opts.accessory : (identity.accessory || (['BACKPACK', 'SCARF', 'HOODIE', 'NONE'][this.seed % 4]));

    // Path & Waypoints
    const path = opts.path || (opts.pathId ? getNpcPath(opts.pathId) : null);
    this.path = path;
    this.pathId = opts.pathId || (path ? path.id : null);
    if (path && Array.isArray(path.waypoints) && path.waypoints.length > 0) {
      this.waypoints = path.waypoints;
    } else if (Array.isArray(opts.waypoints) && opts.waypoints.length > 0) {
      this.waypoints = opts.waypoints;
    } else if (isLegacy) {
      this.waypoints = [{ x: legacyX, y: legacyY }];
    } else {
      this.waypoints = [];
    }

    // Precompute segment lengths and total Euclidean length
    this.segmentLengths = [];
    this.totalLength = 0;
    if (this.waypoints.length >= 2) {
      for (let i = 0; i < this.waypoints.length - 1; i++) {
        const p1 = this.waypoints[i];
        const p2 = this.waypoints[i + 1];
        const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        this.segmentLengths.push(segLen);
        this.totalLength += segLen;
      }
    }

    // Flat [x0,y0,x1,y1,...] copy for the dog_walker_core path sampler
    this.flatWaypoints = new Float64Array(this.waypoints.length * 2);
    for (let i = 0; i < this.waypoints.length; i++) {
      this.flatWaypoints[2 * i] = this.waypoints[i].x;
      this.flatWaypoints[2 * i + 1] = this.waypoints[i].y;
    }

    // Precompute finish time
    this.finishTime = (this.totalLength > 0 && this.speed > 0)
      ? (this.spawnTime + this.totalLength / this.speed)
      : this.spawnTime;

    // Deterministic speech timeline
    this.speechTimeline = [];
    const speechRng = mulberry32(this.seed);
    let speechTime = this.spawnTime + nextSpeechDelay(speechRng);
    const maxSpeechTime = (this.totalLength > 0 && this.finishTime > this.spawnTime)
      ? (this.finishTime + 0.5)
      : (this.spawnTime + 120.0);
    while (speechTime < maxSpeechTime) {
      const phrase = pickPhrase(speechRng);
      this.speechTimeline.push({
        startTime: speechTime,
        endTime: speechTime + 4.0,
        phrase: phrase
      });
      speechTime += 4.0 + nextSpeechDelay(speechRng);
    }

    // Entity state
    if (this.waypoints.length > 0) {
      this.x = this.waypoints[0].x;
      this.y = this.waypoints[0].y;
    } else if (isLegacy) {
      this.x = legacyX;
      this.y = legacyY;
    } else {
      this.x = opts.x !== undefined ? opts.x : 0;
      this.y = opts.y !== undefined ? opts.y : 0;
    }
    this.vx = 0;
    this.vy = 0;
    this.angle = opts.angle !== undefined ? opts.angle : Math.PI / 2;
    this.depthY = this.y + 12;
    this.walkPhase = opts.walkPhase !== undefined ? opts.walkPhase : 0;
    this.opacity = 1.0;
    this.done = false;
    this.isFinishedState = false;
    this.speechBubble = null;
    this.currentSpeech = null;
    this.isNPC = true;

    // Legacy pause and avoidance compatibility
    this.pauseTimer = opts.pauseTimer || 0;
    this.waypointIndex = opts.waypointIndex || 0;
    this.state = opts.state || (this.pauseTimer > 0 ? NPCState.PAUSED : (this.isJogger ? NPCState.RUNNING : NPCState.WALKING));

    // Initialize clock positioning at spawnTime
    this.currentTime = this.spawnTime;
    this.setClock(this.spawnTime);
  }

  setClock(now) {
    if (typeof now !== 'number' || isNaN(now)) return;
    const nowSec = toSeconds(now);
    this.currentTime = nowSec;
    const elapsed = Math.max(0, nowSec - this.spawnTime);
    const distance = this.speed * elapsed;

    if (this.totalLength === 0 || distance >= this.totalLength) {
      if (this.waypoints.length > 0) {
        const last = this.waypoints[this.waypoints.length - 1];
        this.x = last.x;
        this.y = last.y;
      }
      this.vx = 0;
      this.vy = 0;
      this.depthY = this.y + 12;
      this.isFinishedState = true;

      // Fade out over 0.5s after finishing path
      const timeSinceFinish = nowSec - this.finishTime;
      if (timeSinceFinish >= 0.5) {
        this.opacity = 0.0;
        this.done = true;
      } else if (timeSinceFinish > 0) {
        this.opacity = Math.max(0, 1.0 - timeSinceFinish / 0.5);
        this.done = false;
      } else {
        this.opacity = 1.0;
        this.done = false;
      }
    } else {
      // In-progress polyline sampling: dog_walker_core Wasm is the authority
      // (exact JS fallback lives in the bridge).
      const sample = sampleNpcPath(this.flatWaypoints, this.speed, distance);
      this.x = sample.x;
      this.y = sample.y;
      this.depthY = this.y + 12;
      if (sample.hasAngle) {
        this.angle = sample.angle;
      }
      this.vx = sample.vx;
      this.vy = sample.vy;
      if (elapsed > 0 && elapsed < 0.5) {
        this.opacity = 0.25 + 0.75 * (elapsed / 0.5);
      } else {
        this.opacity = 1.0;
      }
      this.done = false;
      this.isFinishedState = false;
    }

    const speech = this.getSpeech(nowSec);
    this.speechBubble = this.done ? null : speech;
    this.currentSpeech = this.speechBubble;
  }

  update(dt, now, avoidanceEntities = []) {
    // avoidanceEntities, minSep legacy references
    // isBench, isOverlook, pauseTimer legacy references
    this.depthY = this.y + 12;
    if (typeof now === 'number') {
      const nowSec = toSeconds(now);
      this.currentTime = nowSec;
      this.setClock(nowSec);
    } else {
      this.currentTime = (this.currentTime !== undefined ? this.currentTime + dt : this.spawnTime + dt);
      this.setClock(this.currentTime);
    }

    if (this.speed > 0 && !this.isFinished(this.currentTime)) {
      this.walkPhase += dt * (this.isJogger ? 9.8 : 6.2);
    }
  }

  isFinished(now) {
    if (typeof now === 'number') {
      const nowSec = toSeconds(now);
      if (nowSec >= this.finishTime) return true;
      if (this.totalLength > 0) {
        const elapsed = Math.max(0, nowSec - this.spawnTime);
        return (this.speed * elapsed) >= this.totalLength;
      }
      return false;
    }
    return this.isFinishedState;
  }

  isDone(now) {
    if (this.done) return true;
    if (typeof now === 'number') {
      const nowSec = toSeconds(now);
      return nowSec >= this.finishTime + 0.5;
    }
    return false;
  }

  getSpeech(now) {
    if (typeof now !== 'number') return null;
    const nowSec = toSeconds(now);
    if (!Array.isArray(this.speechTimeline)) return null;
    for (let i = 0; i < this.speechTimeline.length; i++) {
      const ev = this.speechTimeline[i];
      if (ev.startTime <= nowSec && nowSec < ev.endTime) {
        return ev.phrase;
      }
    }
    return null;
  }

  getShadedColor(color, percent) {
    if (!color || typeof color !== 'string' || !color.startsWith('#')) return color;
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(255 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  draw(ctx) {
    if (this.done || this.opacity <= 0) {
      return;
    }

    ctx.save();
    ctx.globalAlpha = this.opacity;

    const angle = this.angle !== undefined ? this.angle : Math.PI / 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // 1. Soft ground drop shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 11, 14, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Directional Shoulder/Hip Axes:
    // Transverse axis perpendicular to facing angle with 2.5D vertical foreshortening
    const perpX = -sinA;
    const perpY = cosA * 0.36;

    const shoulderSpan = 10.5;
    const hipSpan = 6.2;

    const leftShoulderX = -perpX * shoulderSpan;
    const leftShoulderY = -perpY * shoulderSpan;
    const rightShoulderX = perpX * shoulderSpan;
    const rightShoulderY = perpY * shoulderSpan;

    // Depth metric for arm & leg layering: higher screen Y means closer to camera (foreground)
    const leftDepthY = leftShoulderY - sinA * 2.5;
    const rightDepthY = rightShoulderY - sinA * 2.5;
    const leftIsFar = leftDepthY < rightDepthY;

    // Walking / running strides
    const isMoving = Math.hypot(this.vx, this.vy) > 0.1;
    const legSwing = isMoving ? Math.sin(this.walkPhase) * (this.isJogger ? 7.5 : 5.5) : 0;
    const armSwing = isMoving ? Math.cos(this.walkPhase) * (this.isJogger ? 6.5 : 5.0) : 0;

    const torsoX = this.x;
    const torsoY = this.y - 3;

    // Helper for legs
    const drawLeg = (hipX, hipY, swing, isFar) => {
      ctx.save();
      const strideX = cosA * swing * 0.45;
      const strideY = sinA * swing * 0.45 + (Math.abs(swing) * 0.4);
      const lx = this.x + hipX + strideX;
      const ly = this.y + 1 + hipY + strideY;

      ctx.fillStyle = isFar ? this.getShadedColor(this.pantsColor, -0.15) : this.pantsColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - 2.8, ly, 5.5, 9, 2);
      } else {
        ctx.rect(lx - 2.8, ly, 5.5, 9);
      }
      ctx.fill();

      ctx.fillStyle = isFar ? this.getShadedColor(this.shoeColor, -0.15) : this.shoeColor;
      ctx.beginPath();
      const shoeW = Math.abs(cosA) > 0.4 ? 7.8 : 6.8;
      const shoeH = 5.0;
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - 3.2 + cosA * 1.5, ly + 8, shoeW, shoeH, 2.5);
      } else {
        ctx.rect(lx - 3.2, ly + 8, shoeW, shoeH);
      }
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(lx - 3.2 + cosA * 1.5, ly + 12, shoeW, 1.2);
      ctx.restore();
    };

    // Helper for arms
    const drawArm = (shX, shY, swing, isFar) => {
      ctx.save();
      const ax = torsoX + shX;
      const ay = torsoY - 7 + shY;

      ctx.fillStyle = isFar ? this.getShadedColor(this.jacketColor, -0.18) : this.jacketColor;
      const reachX = cosA * swing * 0.45;
      const reachY = swing * 0.8;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(ax - 2.3 + reachX, ay - reachY, 4.6, 12, 2.3);
      } else {
        ctx.rect(ax - 2.3 + reachX, ay - reachY, 4.6, 12);
      }
      ctx.fill();

      ctx.fillStyle = this.skinTone;
      ctx.beginPath();
      ctx.arc(ax + reachX, ay + 12 - reachY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // --- DEPTH LAYER 1: Far Arm & Far Leg (behind torso) ---
    if (leftIsFar) {
      drawLeg(-perpX * hipSpan, -perpY * hipSpan, legSwing, true);
      drawArm(leftShoulderX, leftShoulderY, -armSwing, true);
    } else {
      drawLeg(perpX * hipSpan, perpY * hipSpan, -legSwing, true);
      drawArm(rightShoulderX, rightShoulderY, armSwing, true);
    }

    // --- DEPTH LAYER 2: Accessory (Backpack when facing South / from front) ---
    if (this.accessory === 'BACKPACK' && sinA > 0.25) {
      this.drawBackpack(ctx, torsoX, torsoY, angle, true);
    }

    // --- DEPTH LAYER 3: 3D Directional Torso / Top ---
    ctx.save();
    ctx.translate(torsoX, torsoY);
    ctx.rotate(angle - Math.PI / 2);

    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(-10.5, -9, 21, 18, 5);
    } else {
      ctx.rect(-10.5, -9, 21, 18);
    }
    ctx.fill();

    // 3D elliptical depth shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.ellipse(0, 7, 10.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Torso Front Details if facing South / towards camera
    if (sinA > -0.2) {
      ctx.save();
      ctx.translate(torsoX, torsoY);

      if (this.isJogger) {
        // Reflective chest stripe
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillRect(-9, -2, 18, 2.5);

        // Sport bib / accent
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-4, 1, 8, 6.0, 1.5);
        } else {
          ctx.rect(-4, 1, 8, 6.0);
        }
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-2.5, 3, 5, 1.2);
      } else {
        // Lapels & collar
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(-4, -9);
        ctx.lineTo(4, -9);
        ctx.lineTo(0, -3);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.beginPath();
        ctx.moveTo(-7, -9);
        ctx.lineTo(-3, -9);
        ctx.lineTo(0, -2);
        ctx.lineTo(-5, -2);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(7, -9);
        ctx.lineTo(3, -9);
        ctx.lineTo(0, -2);
        ctx.lineTo(5, -2);
        ctx.closePath();
        ctx.fill();

        // Jacket zipper line
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -2);
        ctx.lineTo(0, 8);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // Facing North / away from camera
      ctx.save();
      ctx.translate(torsoX, torsoY);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 8);
      ctx.stroke();
      ctx.restore();
    }

    // --- DEPTH LAYER 4: Accessory (Backpack, Scarf, or Hoodie) ---
    if (this.accessory === 'BACKPACK') {
      if (sinA <= 0.25) {
        this.drawBackpack(ctx, torsoX, torsoY, angle, false);
      } else {
        this.drawBackpackStraps(ctx, torsoX, torsoY);
      }
    } else if (this.accessory === 'SCARF') {
      this.drawScarf(ctx, torsoX, torsoY, angle);
    } else if (this.accessory === 'HOODIE') {
      this.drawHoodie(ctx, torsoX, torsoY, angle);
    }

    // --- DEPTH LAYER 5: Near Leg & Near Arm (in front of torso) ---
    if (leftIsFar) {
      drawLeg(perpX * hipSpan, perpY * hipSpan, -legSwing, false);
      drawArm(rightShoulderX, rightShoulderY, armSwing, false);
    } else {
      drawLeg(-perpX * hipSpan, -perpY * hipSpan, legSwing, false);
      drawArm(leftShoulderX, leftShoulderY, -armSwing, false);
    }

    // --- DEPTH LAYER 6: Head, Face, Ears & Hairstyle ---
    this.drawHeadAndFace(ctx, torsoX, torsoY, angle, cosA, sinA);

    // Jogger athletic headband
    if (this.isJogger) {
      ctx.fillStyle = this.hatColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 8.5, this.y - 24, 17, 3.8, 1.9);
      } else {
        ctx.rect(this.x - 8.5, this.y - 24, 17, 3.8);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // --- DEPTH LAYER 7: Overhead Nametag Badge ---
    ctx.font = NPC_TAG_STYLE.font;
    ctx.textAlign = 'center';
    const displayNametag = this.name || (this.isJogger ? 'Jogger' : 'Walker');
    const textWidth = ctx.measureText(displayNametag).width;
    const pillW = textWidth + 14;
    const pillH = 16;
    const pillX = this.x - pillW / 2;
    const pillY = this.y - 42;

    ctx.fillStyle = NPC_TAG_STYLE.background;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(pillX, pillY, pillW, pillH, 8);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();

    ctx.strokeStyle = NPC_TAG_STYLE.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = NPC_TAG_STYLE.text;
    ctx.fillText(displayNametag, this.x, this.y - 30);

    // 8. Speech Bubble
    if (this.speechBubble) {
      this.drawSpeechBubble(ctx, this.speechBubble);
    }

    ctx.restore();
  }

  drawBackpack(ctx, torsoX, torsoY, angle, isFront) {
    ctx.save();
    const packX = torsoX - Math.cos(angle) * 7.0;
    const packY = torsoY - Math.sin(angle) * 5.5;

    ctx.fillStyle = '#334155';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(packX - 7.5, packY - 8, 15, 16, 4);
    } else {
      ctx.rect(packX - 7.5, packY - 8, 15, 16);
    }
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(packX - 7, packY - 8, 14, 6.5, 2.5);
    } else {
      ctx.rect(packX - 7, packY - 8, 14, 6.5);
    }
    ctx.fill();

    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(packX - 1.5, packY - 2.5, 3.0, 2.5);

    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(packX + 7, packY + 2, 2.0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawBackpackStraps(ctx, torsoX, torsoY) {
    ctx.save();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.0;

    ctx.beginPath();
    ctx.moveTo(torsoX - 6.5, torsoY - 8);
    ctx.lineTo(torsoX - 5.5, torsoY + 7);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(torsoX + 6.5, torsoY - 8);
    ctx.lineTo(torsoX + 5.5, torsoY + 7);
    ctx.stroke();

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(torsoX - 5.5, torsoY);
    ctx.lineTo(torsoX + 5.5, torsoY);
    ctx.stroke();

    ctx.restore();
  }

  drawScarf(ctx, torsoX, torsoY, angle) {
    ctx.save();
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoY - 8.5, 8.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const flutter = Math.sin(this.walkPhase * 0.8 + Date.now() * 0.005) * 4.0;
    ctx.fillStyle = '#991b1b';
    ctx.beginPath();
    ctx.moveTo(torsoX + 2, torsoY - 7);
    ctx.lineTo(torsoX + 7 + flutter, torsoY + 5);
    ctx.lineTo(torsoX + 3 + flutter, torsoY + 6);
    ctx.lineTo(torsoX - 1, torsoY - 6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(torsoX + 3 + flutter, torsoY + 6);
    ctx.lineTo(torsoX + 6 + flutter, torsoY + 8);
    ctx.stroke();

    ctx.restore();
  }

  drawHoodie(ctx, torsoX, torsoY, angle) {
    ctx.save();
    ctx.fillStyle = this.getShadedColor(this.jacketColor, -0.15);
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoY - 8.5, 9.5, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(torsoX - 3.5, torsoY - 7);
    ctx.lineTo(torsoX - 3.0, torsoY + 1);
    ctx.moveTo(torsoX + 3.5, torsoY - 7);
    ctx.lineTo(torsoX + 3.0, torsoY + 1);
    ctx.stroke();

    ctx.restore();
  }

  drawHeadAndFace(ctx, torsoX, torsoY, angle, cosA, sinA) {
    const headX = this.x;
    const headY = this.y - 20;
    const style = (this.hairStyle || 'SHORT').toUpperCase();

    // 1. Rear hair layer for WAVY or PONYTAIL
    if (style === 'WAVY') {
      ctx.fillStyle = this.hairColor;
      ctx.beginPath();
      ctx.ellipse(headX, headY + 2, 11.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'PONYTAIL') {
      const backAngle = angle + Math.PI;
      const pBaseX = headX + Math.cos(backAngle) * 7.5;
      const pBaseY = headY - 2 + Math.sin(backAngle) * 6.5;

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

    // 2. Base Head
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(headX, headY, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // 3. Directional Ears
    if (sinA > -0.5) {
      ctx.fillStyle = this.skinTone;
      const earOffsetX = -sinA * 8.6;
      const earOffsetY = cosA * 2.8;
      ctx.beginPath();
      ctx.arc(headX - earOffsetX, headY + earOffsetY, 2.2, 0, Math.PI * 2);
      ctx.arc(headX + earOffsetX, headY - earOffsetY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Directional Eyes & Nose (only when facing South or Side)
    if (sinA > -0.2) {
      const eyeForwardX = cosA * 3.5;
      const eyeForwardY = sinA * 3.5;
      const eyeSideX = sinA * 2.8;
      const eyeSideY = -cosA * 2.8;

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(headX + eyeForwardX + eyeSideX, headY + eyeForwardY + eyeSideY, 1.1, 0, Math.PI * 2);
      ctx.arc(headX + eyeForwardX - eyeSideX, headY + eyeForwardY - eyeSideY, 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.arc(headX + cosA * 4.6, headY + sinA * 4.6, 1.0, 0, Math.PI * 2);
      ctx.fill();
    } else if (Math.abs(cosA) > 0.4) {
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(headX + cosA * 4.2, headY - 0.5, 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = this.skinTone;
      ctx.beginPath();
      ctx.arc(headX + cosA * 7.5, headY + 1.0, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Hairstyle
    this.drawHair(ctx, style, headX, headY, angle, sinA, cosA);
  }

  drawSpeechBubble(ctx, text) {
    if (!text) return;
    ctx.save();
    ctx.font = '500 12px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const textWidth = Math.min(260, ctx.measureText(text).width);
    const bubbleW = textWidth + 16;
    const bubbleH = 24;
    const bx = this.x - bubbleW / 2;
    const by = this.y - 68;

    // Bubble body
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, bubbleW, bubbleH, 8);
    } else {
      ctx.rect(bx, by, bubbleW, bubbleH);
    }
    ctx.fill();

    // Small triangle pointer pointing down
    ctx.beginPath();
    ctx.moveTo(this.x - 4, by + bubbleH);
    ctx.lineTo(this.x, by + bubbleH + 6);
    ctx.lineTo(this.x + 4, by + bubbleH);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(text, this.x, by + 16);
    ctx.restore();
  }

  drawHair(ctx, style, headX = this.x, headY = this.y - 20, angle = Math.PI / 2, sinA = 1, cosA = 0) {
    ctx.save();
    switch (style) {
      case 'WAVY': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(headX - 8.5, headY + 3, 3.8, 6.5, -0.25, 0, Math.PI * 2);
        ctx.ellipse(headX - 8.0, headY + 9, 3.2, 5.0, 0.15, 0, Math.PI * 2);
        ctx.ellipse(headX + 8.5, headY + 3, 3.8, 6.5, 0.25, 0, Math.PI * 2);
        ctx.ellipse(headX + 8.0, headY + 9, 3.2, 5.0, -0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(headX, headY - 3, 9.5, Math.PI * 0.9, Math.PI * 2.1);
        ctx.fill();

        if (sinA > -0.2) {
          ctx.beginPath();
          ctx.moveTo(headX - 8, headY - 2);
          ctx.quadraticCurveTo(headX - 4, headY + 1.5, headX, headY - 1.5);
          ctx.quadraticCurveTo(headX + 4, headY + 1.5, headX + 8, headY - 2);
          ctx.lineTo(headX + 7, headY - 6);
          ctx.lineTo(headX - 7, headY - 6);
          ctx.closePath();
          ctx.fill();
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(headX - 3, headY - 5, 5.5, Math.PI * 1.15, Math.PI * 1.75);
        ctx.stroke();
        break;
      }

      case 'PONYTAIL': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(headX, headY - 2, 9.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(headX - 7.5, headY - 1, 2.2, 3.8, -0.15, 0, Math.PI * 2);
        ctx.ellipse(headX + 7.5, headY - 1, 2.2, 3.8, 0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(headX, headY - 5.5, 4.2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();
        break;
      }

      case 'BEANIE': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(headX - 7.2, headY + 1, 2.5, 4.0, -0.2, 0, Math.PI * 2);
        ctx.ellipse(headX + 7.2, headY + 1, 2.5, 4.0, 0.2, 0, Math.PI * 2);
        ctx.fill();

        if (sinA > -0.2) {
          ctx.beginPath();
          ctx.arc(headX, headY - 1, 8.5, Math.PI * 0.95, Math.PI * 1.25);
          ctx.arc(headX, headY - 1, 8.5, Math.PI * 1.75, Math.PI * 2.05);
          ctx.fill();
        }

        const beanieMain = this.hatColor || '#c2410c';
        ctx.fillStyle = beanieMain;
        ctx.beginPath();
        ctx.ellipse(headX, headY - 4, 10.0, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(headX - 9.5, headY - 3, 19, 5.5, 2.5);
        } else {
          ctx.rect(headX - 9.5, headY - 3, 19, 5.5);
        }
        ctx.fill();
        break;
      }

      case 'SHORT':
      default: {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(headX, headY - 2, 9.2, Math.PI * 0.85, Math.PI * 2.15);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(headX - 7.5, headY - 0.5, 2.5, 4.2, -0.2, 0, Math.PI * 2);
        ctx.ellipse(headX + 7.5, headY - 0.5, 2.5, 4.2, 0.2, 0, Math.PI * 2);
        ctx.fill();

        if (sinA > -0.2) {
          ctx.beginPath();
          ctx.moveTo(headX - 8, headY - 2);
          ctx.quadraticCurveTo(headX - 4, headY + 0.5, headX - 2, headY - 2.5);
          ctx.quadraticCurveTo(headX + 1, headY + 1.0, headX + 3.5, headY - 2.5);
          ctx.quadraticCurveTo(headX + 6, headY, headX + 8, headY - 2);
          ctx.lineTo(headX + 7, headY - 6);
          ctx.lineTo(headX - 7, headY - 6);
          ctx.closePath();
          ctx.fill();
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(headX - 2, headY - 6, 4.5, Math.PI * 1.1, Math.PI * 1.8);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}

export class WalkerNPC extends ParkNPC {
  // Legacy default speed: 85
  constructor(x, y, options = {}) {
    if (typeof x === 'object' && x !== null) {
      const opts = { type: 'walker', ...x };
      if (opts.speed === undefined) {
        opts.speed = NPC_SPEED.walker;
      }
      super(opts);
    } else {
      super(x, y, { speed: 85, type: 'walker', isJogger: false, ...options });
    }
  }
}

export class JoggerNPC extends ParkNPC {
  // Legacy default speed: 260
  constructor(x, y, options = {}) {
    if (typeof x === 'object' && x !== null) {
      const opts = { type: 'jogger', ...x };
      if (opts.speed === undefined) {
        opts.speed = NPC_SPEED.jogger;
      }
      super(opts);
    } else {
      super(x, y, { speed: 260, type: 'jogger', isJogger: true, ...options });
    }
  }
}
