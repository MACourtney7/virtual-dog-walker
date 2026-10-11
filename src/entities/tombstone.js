// ChatTombstone: Memorial marker left behind when players leave conversation proximity
// Smoothly fades out over its lifespan, displaying an inscribed chat snippet and participants.

export class ChatTombstone {
  constructor(x, y, options = {}) {
    this.x = x;
    this.y = y;
    this.depthY = y + 8;
    this.text = options.text || options.snippet || '';
    this.participants = options.participants || [];
    this.maxLifespan = options.lifespan !== undefined ? options.lifespan : 10.0;
    this.lifespan = this.maxLifespan;
    this.alpha = 1.0;
    this.isDead = false;
  }

  update(dt) {
    this.lifespan -= dt;
    this.alpha = Math.max(0, Math.min(1.0, this.lifespan / this.maxLifespan));
    if (this.lifespan <= 0) {
      this.isDead = true;
    }
    return !this.isDead;
  }

  draw(ctx) {
    if (this.alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.alpha;

    // 1. Soft ground drop shadow ellipse beneath the base
    ctx.fillStyle = 'rgba(20, 35, 15, 0.4)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.depthY - 2, 22, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dimensions for arched stone slab
    const w = 44;
    const h = 32;
    const left = this.x - w / 2;
    const right = this.x + w / 2;
    const bottom = this.depthY - 2;
    const top = bottom - h;
    const archRadius = w / 2; // Arched top cap

    // 2. Carved stone marker silhouette with weathered limestone/slate gradient
    const stoneGrad = ctx.createLinearGradient(left, top, right, bottom);
    stoneGrad.addColorStop(0, '#64748b');
    stoneGrad.addColorStop(0.3, '#475569');
    stoneGrad.addColorStop(1, '#334155');

    ctx.fillStyle = stoneGrad;
    ctx.beginPath();
    // Start bottom-left
    ctx.moveTo(left, bottom);
    // Vertical left edge up to start of arch
    ctx.lineTo(left, top + archRadius);
    // Arched semicircular top
    ctx.arc(this.x, top + archRadius, archRadius, Math.PI, 0, false);
    // Vertical right edge down to bottom
    ctx.lineTo(right, bottom);
    ctx.closePath();
    ctx.fill();

    // 3. Stone bevel edge / carved border (#64748b)
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Inner highlight / subtle bevel ridge
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + 2, bottom - 1);
    ctx.lineTo(left + 2, top + archRadius + 1);
    ctx.arc(this.x, top + archRadius, archRadius - 2, Math.PI, -Math.PI / 4, false);
    ctx.stroke();

    // 4. Inscribed conversation snippet or icon
    // Small subtle speech bubble icon 💬 or carved bubble
    ctx.fillStyle = '#94a3b8';
    const iconY = top + archRadius - 4;
    ctx.beginPath();
    ctx.roundRect(this.x - 7, iconY - 5, 14, 9, 3);
    ctx.fill();
    // Little speech bubble pointer tail
    ctx.beginPath();
    ctx.moveTo(this.x - 2, iconY + 4);
    ctx.lineTo(this.x - 5, iconY + 7);
    ctx.lineTo(this.x + 1, iconY + 4);
    ctx.closePath();
    ctx.fill();

    // Speech bubble inner dot
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(this.x - 2.5, iconY - 0.5, 0.8, 0, Math.PI * 2);
    ctx.arc(this.x, iconY - 0.5, 0.8, 0, Math.PI * 2);
    ctx.arc(this.x + 2.5, iconY - 0.5, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Inscribed text line
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text content: snippet truncated to 18 chars, or participant names
    let displayText = '';
    if (this.text && this.text.trim().length > 0) {
      displayText = this.text.trim();
      if (displayText.length > 18) {
        displayText = displayText.slice(0, 15) + '...';
      }
    } else if (this.participants && this.participants.length > 0) {
      displayText = this.participants.join(', ');
      if (displayText.length > 18) {
        displayText = displayText.slice(0, 15) + '...';
      }
    } else {
      displayText = 'RIP CHAT';
    }

    // Carved shadow/emboss
    ctx.fillStyle = '#1e293b';
    ctx.fillText(displayText, this.x + 0.5, bottom - 9.5);

    // Carved text
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(displayText, this.x, bottom - 10);

    ctx.restore();
  }
}
