// Human Owner Player Avatar - 8-Way Movement, Customization & Interaction Controller

export class Owner {
  constructor(x = 1200, y = 900, name = 'Walker', isLocal = true) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.speed = 190; // px/s
    this.facing = 'S';
    this.angle = Math.PI / 2; // Facing downward

    this.name = name;
    this.isLocal = isLocal;
    this.radius = 16;
    this.depthY = this.y + 12;

    // Customization tokens
    this.hairStyle = 'SHORT'; // Supported: 'SHORT', 'WAVY', 'PONYTAIL', 'BEANIE'
    this.hairColor = '#451a03'; // Chestnut brown
    this.skinTone = '#fed7aa'; // Warm light peach
    this.jacketColor = '#1e3a8a'; // Deep blue
    this.pantsColor = '#334155'; // Slate dark trousers
    this.shoeColor = '#0f172a';

    // State & Animations
    this.isMoving = false;
    this.walkPhase = 0;
    this.isPetting = false;
    this.petTimer = 0;
    this.isLeashed = true;

    // Chat / Emote bubble
    this.chatText = null;
    this.chatTimer = 0;
    this.emote = null;
    this.emoteTimer = 0;

    // Input state
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };
  }

  setChat(text, duration = 4.0) {
    this.chatText = text;
    this.chatTimer = duration;
  }

  setEmote(emote, duration = 3.0) {
    this.emote = emote;
    this.emoteTimer = duration;
  }

  update(dt, field) {
    // 1. Process movement inputs if local player
    if (this.isLocal) {
      let dx = 0;
      let dy = 0;
      if (this.keys.up) dy -= 1;
      if (this.keys.down) dy += 1;
      if (this.keys.left) dx -= 1;
      if (this.keys.right) dx += 1;

      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        this.vx = (dx / mag) * this.speed;
        this.vy = (dy / mag) * this.speed;
        this.isMoving = true;
        this.angle = Math.atan2(this.vy, this.vx);
        this.walkPhase += dt * 9.5;
      } else {
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
      }
    }

    // Apply movement
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Resolve world obstacle & boundary collisions
    if (field) {
      const resolved = field.resolveCircleCollision(this.x, this.y, this.radius);
      this.x = resolved.x;
      this.y = resolved.y;
    }

    this.depthY = this.y + 12;

    // Update timers
    if (this.petTimer > 0) {
      this.petTimer -= dt;
      if (this.petTimer <= 0) this.isPetting = false;
    }

    if (this.chatTimer > 0) {
      this.chatTimer -= dt;
      if (this.chatTimer <= 0) this.chatText = null;
    }

    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) this.emote = null;
    }
  }

  draw(ctx) {
    ctx.save();
    // 1. Soft ground drop shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 14, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Walking Legs / Shoes
    const legSwing = this.isMoving ? Math.sin(this.walkPhase) * 6 : 0;
    const legSpread = 7;

    // Left leg / shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    ctx.roundRect(this.x - legSpread - 3.5, this.y + 1 + legSwing, 5.5, 9, 2);
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    ctx.roundRect(this.x - legSpread - 4, this.y + 9 + legSwing, 6.8, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(this.x - legSpread - 4, this.y + 13 + legSwing, 6.8, 1.2);

    // Right leg / shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    ctx.roundRect(this.x + legSpread - 2, this.y + 1 - legSwing, 5.5, 9, 2);
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    ctx.roundRect(this.x + legSpread - 2.5, this.y + 9 - legSwing, 6.8, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(this.x + legSpread - 2.5, this.y + 13 - legSwing, 6.8, 1.2);

    // 3. Torso / Jacket with lapels
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    ctx.roundRect(this.x - 11, this.y - 12, 22, 18, 5);
    ctx.fill();

    // Shoulder lapels & collar
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(this.x - 4, this.y - 12);
    ctx.lineTo(this.x + 4, this.y - 12);
    ctx.lineTo(this.x, this.y - 6);
    ctx.closePath();
    ctx.fill();

    // Lapels over neckline
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

    // Jacket zipper / seam line
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 5);
    ctx.lineTo(this.x, this.y + 6);
    ctx.stroke();

    // 4. Arms & Hands swinging based on walkPhase
    const armSwing = this.isMoving ? Math.cos(this.walkPhase) * 5 : 0;
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
      const backAngle = this.angle + Math.PI;
      const pBaseX = this.x + Math.cos(backAngle) * 7.5;
      const pBaseY = this.y - 22 + Math.sin(backAngle) * 6.5;

      // Scrunchie tie
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(pBaseX, pBaseY, 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Tied ponytail plume extending behind head
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

    // Subtle facial direction cues based on angle
    const eyeForwardX = Math.cos(this.angle) * 3.5;
    const eyeForwardY = Math.sin(this.angle) * 3.5;
    const eyeSideX = Math.sin(this.angle) * 2.8;
    const eyeSideY = -Math.cos(this.angle) * 2.8;

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(this.x + eyeForwardX + eyeSideX, this.y - 20 + eyeForwardY + eyeSideY, 1.1, 0, Math.PI * 2);
    ctx.arc(this.x + eyeForwardX - eyeSideX, this.y - 20 + eyeForwardY - eyeSideY, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Subtle nose directional indicator
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(this.x + Math.cos(this.angle) * 4.6, this.y - 20 + Math.sin(this.angle) * 4.6, 1.0, 0, Math.PI * 2);
    ctx.fill();

    // 6. Hairstyle silhouettes
    this.drawHair(ctx, style);

    // 7. Name Label Badge
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const displayNametag = this.isLocal ? `${this.name} (You)` : this.name;
    const textWidth = ctx.measureText(displayNametag).width;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.roundRect(this.x - textWidth / 2 - 6, this.y - 42, textWidth + 12, 16, 8);
    ctx.fill();

    ctx.fillStyle = this.isLocal ? '#fde047' : '#f8fafc';
    ctx.fillText(displayNametag, this.x, this.y - 30);

    // 8. Speech Bubble or Emote
    if (this.chatText) {
      this.drawSpeechBubble(ctx, this.chatText);
    } else if (this.emote) {
      this.drawEmoteBubble(ctx, this.emote);
    }

    ctx.restore();
  }

  drawHair(ctx, style) {
    ctx.save();
    switch (style) {
      case 'WAVY': {
        ctx.fillStyle = this.hairColor;
        // Wavy locks framing face
        ctx.beginPath();
        ctx.ellipse(this.x - 8.5, this.y - 17, 3.8, 6.5, -0.25, 0, Math.PI * 2);
        ctx.ellipse(this.x - 8.0, this.y - 11, 3.2, 5.0, 0.15, 0, Math.PI * 2);
        ctx.ellipse(this.x + 8.5, this.y - 17, 3.8, 6.5, 0.25, 0, Math.PI * 2);
        ctx.ellipse(this.x + 8.0, this.y - 11, 3.2, 5.0, -0.15, 0, Math.PI * 2);
        ctx.fill();

        // Crown volume
        ctx.beginPath();
        ctx.arc(this.x, this.y - 23, 9.5, Math.PI * 0.9, Math.PI * 2.1);
        ctx.fill();

        // Soft parted wavy bangs
        ctx.beginPath();
        ctx.moveTo(this.x - 8, this.y - 22);
        ctx.quadraticCurveTo(this.x - 4, this.y - 18.5, this.x, this.y - 21.5);
        ctx.quadraticCurveTo(this.x + 4, this.y - 18.5, this.x + 8, this.y - 22);
        ctx.lineTo(this.x + 7, this.y - 26);
        ctx.lineTo(this.x - 7, this.y - 26);
        ctx.closePath();
        ctx.fill();

        // Highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this.x - 3, this.y - 25, 5.5, Math.PI * 1.15, Math.PI * 1.75);
        ctx.stroke();
        break;
      }

      case 'PONYTAIL': {
        ctx.fillStyle = this.hairColor;
        // Swept-back hair over crown
        ctx.beginPath();
        ctx.arc(this.x, this.y - 22, 9.2, 0, Math.PI * 2);
        ctx.fill();

        // Temple strands
        ctx.beginPath();
        ctx.ellipse(this.x - 7.5, this.y - 21, 2.2, 3.8, -0.15, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.5, this.y - 21, 2.2, 3.8, 0.15, 0, Math.PI * 2);
        ctx.fill();

        // Crown shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(this.x, this.y - 25.5, 4.2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();
        break;
      }

      case 'BEANIE': {
        // Peeking hair tufts below beanie brim
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(this.x - 7.2, this.y - 19, 2.5, 4.0, -0.2, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.2, this.y - 19, 2.5, 4.0, 0.2, 0, Math.PI * 2);
        ctx.fill();

        // Hair bangs peeking out
        ctx.beginPath();
        ctx.arc(this.x, this.y - 21, 8.5, Math.PI * 0.95, Math.PI * 1.25);
        ctx.arc(this.x, this.y - 21, 8.5, Math.PI * 1.75, Math.PI * 2.05);
        ctx.fill();

        // Beanie dome
        const beanieMain = '#c2410c';
        const beanieCuff = '#9a3412';
        ctx.fillStyle = beanieMain;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - 24, 10.0, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Ribbed folded cuff
        ctx.fillStyle = beanieCuff;
        ctx.beginPath();
        ctx.roundRect(this.x - 9.5, this.y - 23, 19, 5.5, 2.5);
        ctx.fill();

        // Vertical ribbed knit stitches on cuff
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        for (let rx = -7.5; rx <= 7.5; rx += 2.5) {
          ctx.beginPath();
          ctx.moveTo(this.x + rx, this.y - 23);
          ctx.lineTo(this.x + rx, this.y - 18);
          ctx.stroke();
        }

        // Fluffy pom-pom on top
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(this.x, this.y - 32.5, 3.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(this.x - 1, this.y - 32.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'SHORT':
      default: {
        ctx.fillStyle = this.hairColor;
        // Main cropped crown
        ctx.beginPath();
        ctx.arc(this.x, this.y - 22, 9.2, Math.PI * 0.85, Math.PI * 2.15);
        ctx.fill();

        // Side crops
        ctx.beginPath();
        ctx.ellipse(this.x - 7.5, this.y - 20.5, 2.5, 4.2, -0.2, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.5, this.y - 20.5, 2.5, 4.2, 0.2, 0, Math.PI * 2);
        ctx.fill();

        // Textured bangs across forehead
        ctx.beginPath();
        ctx.moveTo(this.x - 8, this.y - 22);
        ctx.quadraticCurveTo(this.x - 4, this.y - 19.5, this.x - 2, this.y - 22.5);
        ctx.quadraticCurveTo(this.x + 1, this.y - 19, this.x + 3.5, this.y - 22.5);
        ctx.quadraticCurveTo(this.x + 6, this.y - 20, this.x + 8, this.y - 22);
        ctx.lineTo(this.x + 7, this.y - 26);
        ctx.lineTo(this.x - 7, this.y - 26);
        ctx.closePath();
        ctx.fill();

        // Hair crown highlight
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

  drawSpeechBubble(ctx, text) {
    ctx.save();
    ctx.font = '500 12px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const textWidth = Math.min(200, ctx.measureText(text).width);
    const bubbleW = textWidth + 16;
    const bubbleH = 24;
    const bx = this.x - bubbleW / 2;
    const by = this.y - 68;

    // Bubble body
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 8);
    ctx.fill();

    // Small triangle pointer
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

  drawEmoteBubble(ctx, emote) {
    ctx.save();
    const bx = this.x - 16;
    const by = this.y - 68;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(bx, by, 32, 28, 8);
    ctx.fill();

    // Pointer
    ctx.beginPath();
    ctx.moveTo(this.x - 4, by + 28);
    ctx.lineTo(this.x, by + 34);
    ctx.lineTo(this.x + 4, by + 28);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.fillText(emote, this.x, by + 20);
    ctx.restore();
  }
}
