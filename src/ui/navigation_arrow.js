// Directional Navigation Compass Arrow HUD Component
// Renders glassmorphic off-screen directional indicator pointing to active targets (DOG, BIN, etc.)

export class NavigationArrow {
  /**
   * @param {Object} [options]
   * @param {number} [options.padding=45] Distance in pixels from viewport edge to clamp arrow indicator
   */
  constructor(options = {}) {
    this.target = null;
    this.pulseTimer = 0;
    this.active = false;
    this.padding = typeof options.padding === 'number' ? options.padding : 45;
  }

  /**
   * Set target world coordinates and metadata
   * @param {number} x
   * @param {number} y
   * @param {'DOG' | 'BIN' | string} [type='DOG']
   * @param {string} [label='']
   * @param {string} [color='#f59e0b']
   */
  setTarget(x, y, type = 'DOG', label = '', color = '#f59e0b') {
    this.target = {
      x,
      y,
      type,
      label,
      color: color || (type === 'BIN' ? '#10b981' : '#f59e0b')
    };
    this.active = true;
  }

  /**
   * Clear active target and deactivate HUD arrow
   */
  clearTarget() {
    this.target = null;
    this.active = false;
  }

  /**
   * Return current target object or null
   * @returns {Object|null}
   */
  getTarget() {
    return this.target;
  }

  /**
   * Advance pulse timer for smooth animations
   * @param {number} dt Delta time in seconds
   */
  update(dt = 0) {
    this.pulseTimer += dt;
  }

  /**
   * Helper to get target icon emoji based on type
   * @param {string} type
   * @returns {string}
   */
  getTargetIcon(type) {
    if (type === 'DOG') return '🐕';
    if (type === 'BIN') return '🗑️';
    if (type === 'BALL') return '🎾';
    if (type === 'PLAYER') return '🚶';
    return '📍';
  }

  /**
   * Draw directional arrow HUD
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} camera Camera object with x, y, width/viewportWidth, height/viewportHeight
   * @param {number} playerX
   * @param {number} playerY
   */
  draw(ctx, camera, playerX, playerY) {
    if (!this.active || !this.target || !ctx) {
      return;
    }

    // Safety checks for coordinates and camera
    const px = typeof playerX === 'number' ? playerX : 0;
    const py = typeof playerY === 'number' ? playerY : 0;

    const camX = camera && typeof camera.x === 'number' ? camera.x : 0;
    const camY = camera && typeof camera.y === 'number' ? camera.y : 0;
    const viewW = camera && (camera.viewportWidth || camera.width || (ctx.canvas ? ctx.canvas.width : 1280));
    const viewH = camera && (camera.viewportHeight || camera.height || (ctx.canvas ? ctx.canvas.height : 720));

    if (!viewW || !viewH) return;

    // Calculate displacement from player to target
    const dx = this.target.x - px;
    const dy = this.target.y - py;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    // Target position in screen coordinates
    const targetScreenX = this.target.x - camX;
    const targetScreenY = this.target.y - camY;

    // Viewport bounds with padding
    const pad = Math.max(10, this.padding);
    const minX = pad;
    const maxX = viewW - pad;
    const minY = pad;
    const maxY = viewH - pad;

    const isOnScreen = (
      targetScreenX >= minX &&
      targetScreenX <= maxX &&
      targetScreenY >= minY &&
      targetScreenY <= maxY
    );

    // Proximity threshold (< 80px): if on-screen and close, render subtle beacon above target
    if (isOnScreen && dist < 80) {
      this.drawCloseBeacon(ctx, targetScreenX, targetScreenY);
      return;
    }

    // If on-screen and nearby (>80px), or off-screen:
    // Determine screen position for the perimeter compass arrow
    let screenX, screenY;

    if (isOnScreen) {
      // Gentle floating indicator right over or near target
      screenX = targetScreenX;
      screenY = targetScreenY;
    } else {
      // Off-screen: Project ray from viewport center to clamp at perimeter boundary
      const cx = viewW / 2;
      const cy = viewH / 2;
      const clamped = this.clampRayToBox(cx, cy, angle, minX, maxX, minY, maxY);
      screenX = clamped.x;
      screenY = clamped.y;
    }

    this.drawCompassIndicator(ctx, screenX, screenY, angle, dist);
  }

  /**
   * Clamps a ray starting from (cx, cy) along angle to the rectangle [minX, maxX] x [minY, maxY]
   */
  clampRayToBox(cx, cy, angle, minX, maxX, minY, maxY) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    let tMin = Infinity;

    // Right edge
    if (cos > 1e-6) {
      const t = (maxX - cx) / cos;
      if (t > 0 && t < tMin) tMin = t;
    }
    // Left edge
    if (cos < -1e-6) {
      const t = (minX - cx) / cos;
      if (t > 0 && t < tMin) tMin = t;
    }
    // Bottom edge
    if (sin > 1e-6) {
      const t = (maxY - cy) / sin;
      if (t > 0 && t < tMin) tMin = t;
    }
    // Top edge
    if (sin < -1e-6) {
      const t = (minY - cy) / sin;
      if (t > 0 && t < tMin) tMin = t;
    }

    if (!isFinite(tMin) || tMin <= 0) {
      return { x: cx, y: cy };
    }

    const x = Math.max(minX, Math.min(maxX, cx + cos * tMin));
    const y = Math.max(minY, Math.min(maxY, cy + sin * tMin));
    return { x, y };
  }

  /**
   * Draw subtle beacon when player is within immediate proximity (<80px) and on screen
   */
  drawCloseBeacon(ctx, x, y) {
    const pulse = 1.0 + 0.15 * Math.sin(this.pulseTimer * 5);
    const targetColor = this.target.color || '#f59e0b';
    const icon = this.getTargetIcon(this.target.type);

    ctx.save();
    ctx.translate(x, y - 36);

    // Glowing ring
    ctx.beginPath();
    ctx.arc(0, 0, 16 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = targetColor;
    ctx.stroke();

    // Icon emoji
    ctx.font = '16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 0, 1);

    ctx.restore();
  }

  /**
   * Draw glassmorphic circular backdrop disc, chevron arrow, icon, and distance pill badge
   */
  drawCompassIndicator(ctx, x, y, angle, dist) {
    const pulseScale = 1.0 + 0.08 * Math.sin(this.pulseTimer * 4);
    const targetColor = this.target.color || '#f59e0b';
    const icon = this.getTargetIcon(this.target.type);
    const radius = 22;

    ctx.save();
    ctx.translate(x, y);

    // 1. Outer Glassmorphic Disc
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'; // Slate-900 glass
    ctx.fill();
    ctx.restore();

    // Disc Border
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.stroke();

    // 2. Directional Chevron / Arrow
    ctx.save();
    ctx.rotate(angle);
    ctx.scale(pulseScale, pulseScale);

    // Chevron pointing outward along angle
    const chevronDist = radius + 6;
    ctx.beginPath();
    ctx.moveTo(chevronDist + 10, 0); // Tip
    ctx.lineTo(chevronDist - 2, -7);  // Top wing
    ctx.lineTo(chevronDist + 2, 0);   // Inward notch
    ctx.lineTo(chevronDist - 2, 7);   // Bottom wing
    ctx.closePath();

    ctx.fillStyle = targetColor;
    ctx.shadowColor = targetColor;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();

    // 3. Central Target Icon / Emoji
    ctx.save();
    ctx.font = '16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 0, 1);
    ctx.restore();

    // 4. Distance Badge Pill
    // Calculate distance text: e.g. "12m" (assuming 20 world units per meter)
    const meters = Math.max(1, Math.round(dist / 20));
    const distText = `${meters}m`;

    ctx.save();
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textMetrics = ctx.measureText(distText);
    const pillW = Math.max(34, textMetrics.width + 12);
    const pillH = 18;
    const pillY = radius + 14;

    // Draw Pill Background
    ctx.beginPath();
    const r = pillH / 2;
    ctx.roundRect
      ? ctx.roundRect(-pillW / 2, pillY - pillH / 2, pillW, pillH, r)
      : ctx.arc(0, pillY, r, 0, Math.PI * 2); // fallback if roundRect unsupported
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.stroke();

    // Draw Pill Text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(distText, 0, pillY + 0.5);

    ctx.restore();

    ctx.restore();
  }
}
