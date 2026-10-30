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

export const NPCState = {
  WALKING: 'WALKING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED'
};

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
    this.spawnTime = opts.spawnTime !== undefined ? Number(opts.spawnTime) : 0;
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
    this.currentTime = now;
    const elapsed = Math.max(0, now - this.spawnTime);
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
      const timeSinceFinish = now - this.finishTime;
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
      let accumulated = 0;
      let interpolated = false;
      let dx = 0;
      let dy = 0;
      let segLen = 0;

      for (let i = 0; i < this.segmentLengths.length; i++) {
        segLen = this.segmentLengths[i];
        if (accumulated + segLen >= distance) {
          const remaining = distance - accumulated;
          const segT = segLen > 0.000001 ? (remaining / segLen) : 0;
          const p1 = this.waypoints[i];
          const p2 = this.waypoints[i + 1];
          dx = p2.x - p1.x;
          dy = p2.y - p1.y;
          this.x = p1.x + dx * segT;
          this.y = p1.y + dy * segT;
          interpolated = true;
          break;
        }
        accumulated += segLen;
      }

      if (!interpolated && this.waypoints.length >= 2) {
        const lastIdx = this.waypoints.length - 2;
        const p1 = this.waypoints[lastIdx];
        const p2 = this.waypoints[lastIdx + 1];
        dx = p2.x - p1.x;
        dy = p2.y - p1.y;
        segLen = this.segmentLengths[lastIdx] || 0;
        this.x = p2.x;
        this.y = p2.y;
      }

      this.depthY = this.y + 12;
      if (Math.hypot(dx, dy) > 0.000001) {
        this.angle = Math.atan2(dy, dx);
      }
      this.vx = segLen > 0.000001 ? (dx / segLen) * this.speed : 0;
      this.vy = segLen > 0.000001 ? (dy / segLen) * this.speed : 0;
      this.opacity = 1.0;
      this.done = false;
      this.isFinishedState = false;
    }

    const speech = this.getSpeech(now);
    this.speechBubble = this.done ? null : speech;
    this.currentSpeech = this.speechBubble;
  }

  update(dt, now, avoidanceEntities = []) {
    // avoidanceEntities, minSep legacy references
    // isBench, isOverlook, pauseTimer legacy references
    this.depthY = this.y + 12;
    if (typeof now === 'number') {
      this.currentTime = now;
      this.setClock(now);
    } else {
      this.currentTime = (this.currentTime !== undefined ? this.currentTime + dt : this.spawnTime + dt);
      this.setClock(this.currentTime);
    }

    if (this.speed > 0 && !this.isFinished(this.currentTime)) {
      this.walkPhase += dt * (this.isJogger ? 14 : 9.5);
    }
  }

  isFinished(now) {
    if (typeof now === 'number') {
      if (now >= this.finishTime) return true;
      if (this.totalLength > 0) {
        const elapsed = Math.max(0, now - this.spawnTime);
        return (this.speed * elapsed) >= this.totalLength;
      }
      return false;
    }
    return this.isFinishedState;
  }

  isDone(now) {
    if (this.done) return true;
    if (typeof now === 'number') {
      return now >= this.finishTime + 0.5;
    }
    return false;
  }

  getSpeech(now) {
    if (typeof now !== 'number') return null;
    if (!Array.isArray(this.speechTimeline)) return null;
    for (let i = 0; i < this.speechTimeline.length; i++) {
      const ev = this.speechTimeline[i];
      if (ev.startTime <= now && now < ev.endTime) {
        return ev.phrase;
      }
    }
    return null;
  }

  draw(ctx) {
    if (this.done || this.opacity <= 0) {
      return;
    }

    ctx.save();
    ctx.globalAlpha = this.opacity;

    // 1. Soft ground drop shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 10, 14, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Walking / Running Legs & Shoes
    const isMoving = Math.hypot(this.vx, this.vy) > 0.1;
    const legSwing = isMoving ? Math.sin(this.walkPhase) * (this.isJogger ? 7.5 : 5.5) : 0;
    const legSpread = 7;

    // Left leg & shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x - legSpread - 3.5, this.y + 1 + legSwing, 5.5, 9, 2);
    } else {
      ctx.rect(this.x - legSpread - 3.5, this.y + 1 + legSwing, 5.5, 9);
    }
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x - legSpread - 4, this.y + 9 + legSwing, 6.8, 5, 2.5);
    } else {
      ctx.rect(this.x - legSpread - 4, this.y + 9 + legSwing, 6.8, 5);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(this.x - legSpread - 4, this.y + 13 + legSwing, 6.8, 1.2);

    // Right leg & shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x + legSpread - 2, this.y + 1 - legSwing, 5.5, 9, 2);
    } else {
      ctx.rect(this.x + legSpread - 2, this.y + 1 - legSwing, 5.5, 9);
    }
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x + legSpread - 2.5, this.y + 9 - legSwing, 6.8, 5, 2.5);
    } else {
      ctx.rect(this.x + legSpread - 2.5, this.y + 9 - legSwing, 6.8, 5);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(this.x + legSpread - 2.5, this.y + 13 - legSwing, 6.8, 1.2);

    // 3. Torso / Top
    if (this.isJogger) {
      // Athletic technical running top
      ctx.fillStyle = this.jacketColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 10.5, this.y - 12, 21, 17, 4.5);
      } else {
        ctx.rect(this.x - 10.5, this.y - 12, 21, 17);
      }
      ctx.fill();

      // Reflective chest stripe
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(this.x - 10, this.y - 5, 20, 2.5);

      // Sport bib / accent
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 4, this.y - 2, 8, 6.5, 1.5);
      } else {
        ctx.rect(this.x - 4, this.y - 2, 8, 6.5);
      }
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(this.x - 2.5, this.y, 5, 1.2);
    } else {
      // Casual outdoor jacket / windbreaker
      ctx.fillStyle = this.jacketColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 11, this.y - 12, 22, 18, 5);
      } else {
        ctx.rect(this.x - 11, this.y - 12, 22, 18);
      }
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
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x - 15.5, this.y - 10 - armSwing, 4.5, 12, 2);
    } else {
      ctx.rect(this.x - 15.5, this.y - 10 - armSwing, 4.5, 12);
    }
    ctx.fill();
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x - 13.25, this.y + 3 - armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Right arm
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x + 11, this.y - 10 + armSwing, 4.5, 12, 2);
    } else {
      ctx.rect(this.x + 11, this.y - 10 + armSwing, 4.5, 12);
    }
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

    // 7. Overhead Nametag Badge
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
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(this.x - 9.5, this.y - 23, 19, 5.5, 2.5);
        } else {
          ctx.rect(this.x - 9.5, this.y - 23, 19, 5.5);
        }
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
