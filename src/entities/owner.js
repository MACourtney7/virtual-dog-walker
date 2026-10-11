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
    this.jacketColor = '#1e3a8a'; // Deep blue
    this.pantsColor = '#334155'; // Slate dark trousers
    this.skinTone = '#fed7aa'; // Warm light peach
    this.hairColor = '#451a03'; // Chestnut brown
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
    ctx.fillRect(this.x - legSpread - 3, this.y + 2 + legSwing, 5, 8);
    ctx.fillStyle = this.shoeColor;
    ctx.fillRect(this.x - legSpread - 3, this.y + 10 + legSwing, 6, 4);

    // Right leg / shoe
    ctx.fillStyle = this.pantsColor;
    ctx.fillRect(this.x + legSpread - 2, this.y + 2 - legSwing, 5, 8);
    ctx.fillStyle = this.shoeColor;
    ctx.fillRect(this.x + legSpread - 2, this.y + 10 - legSwing, 6, 4);

    // 3. Torso / Jacket
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    ctx.roundRect(this.x - 11, this.y - 12, 22, 18, 5);
    ctx.fill();

    // Jacket zipper / seam line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 12);
    ctx.lineTo(this.x, this.y + 6);
    ctx.stroke();

    // 4. Arms & Hands
    const armSwing = this.isMoving ? Math.cos(this.walkPhase) * 5 : 0;
    // Left arm
    ctx.fillStyle = this.jacketColor;
    ctx.fillRect(this.x - 15, this.y - 10 - armSwing, 4, 12);
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x - 13, this.y + 3 - armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Right arm
    ctx.fillStyle = this.jacketColor;
    ctx.fillRect(this.x + 11, this.y - 10 + armSwing, 4, 12);
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x + 13, this.y + 3 + armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 5. Head, Hair & Cap
    // Head base
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 20, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = this.hairColor;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 22, 9, Math.PI, Math.PI * 2);
    ctx.fill();

    // Subtle facial orientation dot
    const faceDx = Math.cos(this.angle) * 3;
    const faceDy = Math.sin(this.angle) * 3;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(this.x + faceDx, this.y - 19 + faceDy, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // 6. Name Label Badge
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

    // 7. Speech Bubble or Emote
    if (this.chatText) {
      this.drawSpeechBubble(ctx, this.chatText);
    } else if (this.emote) {
      this.drawEmoteBubble(ctx, this.emote);
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
