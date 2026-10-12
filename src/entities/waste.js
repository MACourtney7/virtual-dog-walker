// Park Waste Entity: Dog Waste Piles and Park Sanitation Management

export class PoopPile {
  constructor(id, x, y) {
    this.id = id || ('poop-' + Math.random().toString(36).substr(2, 9));
    this.x = x;
    this.y = y;
    this.radius = 10;
    this.depthY = y + 4;
    this.isCleaned = false;
    this.pulse = 0;
  }

  update(dt) {
    this.pulse += dt;
  }

  draw(ctx, player = null) {
    if (this.isCleaned) return;

    ctx.save();

    // 1. Subtle ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 3, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Interaction pulse ring when player is within range (<40px)
    let isNear = false;
    if (player && typeof player.x === 'number' && typeof player.y === 'number') {
      const dist = Math.hypot(this.x - player.x, this.y - player.y);
      if (dist < 40) isNear = true;
    }

    if (isNear) {
      const ringScale = 1.0 + Math.sin(this.pulse * 5) * 0.15;
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 16 * ringScale, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle sparkle
      const sparkleAlpha = 0.5 + Math.sin(this.pulse * 6) * 0.4;
      ctx.fillStyle = `rgba(255, 255, 255, ${sparkleAlpha})`;
      ctx.beginPath();
      ctx.arc(this.x + 5, this.y - 7, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Layered organic coils in rich earthy brown (#5a3825, #3e2415), with subtle highlight #7d5035
    // Bottom coil
    ctx.fillStyle = '#3e2415';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 2, 8, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Middle coil
    ctx.fillStyle = '#5a3825';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y - 1, 6, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Top coil tip
    ctx.fillStyle = '#5a3825';
    ctx.beginPath();
    ctx.ellipse(this.x - 0.5, this.y - 4, 3.5, 2.5, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Swirl highlight
    ctx.fillStyle = '#7d5035';
    ctx.beginPath();
    ctx.ellipse(this.x - 1.2, this.y - 2, 2.8, 1.2, 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
