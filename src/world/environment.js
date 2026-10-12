// The Downs (Clifton & Durdham Downs, Bristol) - Dynamic Diurnal Sepia Lighting Pass & Weather Particle Overlays

export const TimeOfDay = Object.freeze({
  DAWN: 'DAWN',
  DAY: 'DAY',
  GOLDEN_HOUR: 'GOLDEN_HOUR',
  DUSK: 'DUSK',
  NIGHT: 'NIGHT'
});

export const WeatherType = Object.freeze({
  CLEAR: 'CLEAR',
  OVERCAST: 'OVERCAST',
  DRIZZLE: 'DRIZZLE',
  RAIN: 'RAIN',
  FOG: 'FOG'
});

/**
 * Calculates Bristol (Europe/London) local hour (float 0.0 - 24.0),
 * automatically respecting GMT (UTC+0) and BST (UTC+1).
 */
export function getBristolHour() {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    let h = 0, m = 0, s = 0;
    for (const part of parts) {
      if (part.type === 'hour') h = parseInt(part.value, 10);
      if (part.type === 'minute') m = parseInt(part.value, 10);
      if (part.type === 'second') s = parseInt(part.value, 10);
    }
    h = h % 24;
    return h + m / 60 + s / 3600;
  } catch (e) {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }
}

export class EnvironmentSystem {
  constructor(options = {}) {
    this.timeOverride = options.timeOverride !== undefined ? options.timeOverride : null;
    this.currentWeather = options.weather || WeatherType.CLEAR;
    this.viewportWidth = options.viewportWidth || 1280;
    this.viewportHeight = options.viewportHeight || 720;
    this.animTime = 0;

    // Particle pools
    this.rainParticles = [];
    this.drizzleParticles = [];
    this.mistSpecks = [];
    this.fogSheets = [];
    this.dustMotes = [];
    this.splashes = [];

    // Offscreen canvas cache for radial lighting compositing
    this.offscreenCanvas = null;
    this.offscreenCtx = null;

    this._initParticles();
  }

  // --- Time-of-Day Diurnal Engine ---

  setTimeOverride(hour) {
    if (typeof hour === 'number' && !isNaN(hour)) {
      this.timeOverride = ((hour % 24) + 24) % 24;
    } else {
      this.timeOverride = null;
    }
  }

  clearTimeOverride() {
    this.timeOverride = null;
  }

  getCurrentHour() {
    if (this.timeOverride !== null && this.timeOverride !== undefined) {
      return this.timeOverride;
    }
    return getBristolHour();
  }

  getTimeOfDay(hour = null) {
    const h = hour !== null && hour !== undefined
      ? ((hour % 24) + 24) % 24
      : this.getCurrentHour();

    if (h >= 5.0 && h < 7.0) {
      return TimeOfDay.DAWN;
    } else if (h >= 7.0 && h < 17.0) {
      return TimeOfDay.DAY;
    } else if (h >= 17.0 && h < 19.5) {
      return TimeOfDay.GOLDEN_HOUR;
    } else if (h >= 19.5 && h < 21.5) {
      return TimeOfDay.DUSK;
    } else {
      return TimeOfDay.NIGHT;
    }
  }

  getAmbientColor(hour = null) {
    const tod = this.getTimeOfDay(hour);
    let r, g, b, a;
    switch (tod) {
      case TimeOfDay.DAWN:
        r = 180; g = 150; b = 190; a = 0.25;
        break;
      case TimeOfDay.DAY:
        r = 255; g = 250; b = 230; a = 0.04;
        break;
      case TimeOfDay.GOLDEN_HOUR:
        r = 180; g = 110; b = 35; a = 0.28;
        break;
      case TimeOfDay.DUSK:
        r = 30; g = 35; b = 60; a = 0.55;
        break;
      case TimeOfDay.NIGHT:
      default:
        r = 10; g = 16; b = 32; a = 0.82;
        break;
    }
    const string = `rgba(${r}, ${g}, ${b}, ${a})`;
    return {
      r,
      g,
      b,
      a,
      string,
      toString() {
        return string;
      }
    };
  }

  getAmbientTint(asObject = false) {
    const color = this.getAmbientColor();
    if (asObject) {
      return color;
    }
    const strObj = new String(color.string);
    strObj.r = color.r;
    strObj.g = color.g;
    strObj.b = color.b;
    strObj.a = color.a;
    strObj.string = color.string;
    return strObj;
  }

  // --- Weather State Management ---

  setWeather(weather) {
    if (typeof weather === 'string') {
      this.currentWeather = weather.toUpperCase();
    }
  }

  getWeather() {
    return this.currentWeather;
  }

  resize(width, height) {
    if (width > 0 && height > 0) {
      this.viewportWidth = width;
      this.viewportHeight = height;
    }
  }

  // --- Offscreen Canvas Helper ---

  _getOffscreenCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
      if (!this.offscreenCanvas || this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
        this.offscreenCanvas = new OffscreenCanvas(width, height);
      }
      return this.offscreenCanvas;
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      if (!this.offscreenCanvas) {
        this.offscreenCanvas = document.createElement('canvas');
      }
      if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
      }
      return this.offscreenCanvas;
    }
    return null;
  }

  // --- Particle Initialization & Pools ---

  _initParticles() {
    const w = this.viewportWidth;
    const h = this.viewportHeight;

    // 1. Rain streaks (~220 particles, vy ~ 550-750, vx ~ -80 to -160)
    this.rainParticles = [];
    for (let i = 0; i < 220; i++) {
      this.rainParticles.push({
        x: Math.random() * (w + 200) - 50,
        y: Math.random() * (h + 100) - 50,
        vx: -80 - Math.random() * 80,
        vy: 550 + Math.random() * 200,
        len: 16 + Math.random() * 8,
        width: 1.2 + Math.random() * 0.6,
        alpha: 0.45 + Math.random() * 0.25
      });
    }

    // 2. Drizzle particles (~50 particles, drifting with wind slant)
    this.drizzleParticles = [];
    for (let i = 0; i < 50; i++) {
      this.drizzleParticles.push({
        x: Math.random() * (w + 100) - 30,
        y: Math.random() * (h + 60) - 30,
        vx: -30 - Math.random() * 35,
        vy: 260 + Math.random() * 110,
        len: 7 + Math.random() * 5,
        alpha: 0.35 + Math.random() * 0.2
      });
    }

    // 3. Transient mist specks (~25 specks)
    this.mistSpecks = [];
    for (let i = 0; i < 25; i++) {
      this.mistSpecks.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: -15 - Math.random() * 25,
        vy: 10 + Math.random() * 20,
        radius: 1.2 + Math.random() * 1.5,
        alpha: 0.12 + Math.random() * 0.18,
        phase: Math.random() * Math.PI * 2
      });
    }

    // 4. Fog clouds/sheets (7 translucent drifting sheets, alpha ~ 0.15 - 0.28)
    this.fogSheets = [];
    const fogRows = 7;
    for (let i = 0; i < fogRows; i++) {
      this.fogSheets.push({
        x: Math.random() * w,
        baseY: (i + 0.5) * (h / fogRows) + (Math.random() * 40 - 20),
        y: 0,
        radiusX: 200 + Math.random() * 160,
        radiusY: 75 + Math.random() * 55,
        vx: 20 + Math.random() * 25,
        amp: 18 + Math.random() * 16,
        freq: 0.4 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.15 + Math.random() * 0.13
      });
    }

    // 5. Golden hour dust motes (~25 glowing specks)
    this.dustMotes = [];
    for (let i = 0; i < 25; i++) {
      this.dustMotes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: 6 + Math.random() * 12,
        vy: -6 - Math.random() * 10,
        radius: 1.0 + Math.random() * 1.5,
        alpha: 0.2 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  // --- Simulation Update Loop ---

  update(dt, weatherState = null) {
    if (weatherState) {
      if (typeof weatherState === 'string') {
        this.currentWeather = weatherState.toUpperCase();
      } else if (typeof weatherState.getWeather === 'function') {
        this.currentWeather = weatherState.getWeather().toUpperCase();
      } else if (weatherState.currentWeather) {
        this.currentWeather = String(weatherState.currentWeather).toUpperCase();
      } else if (weatherState.type) {
        this.currentWeather = String(weatherState.type).toUpperCase();
      }
    }

    this.animTime += dt;
    const w = this.viewportWidth;
    const h = this.viewportHeight;

    // Update active weather particles
    if (this.currentWeather === WeatherType.RAIN) {
      this._updateRain(dt, w, h);
    } else if (this.currentWeather === WeatherType.DRIZZLE) {
      this._updateDrizzle(dt, w, h);
    } else if (this.currentWeather === WeatherType.FOG) {
      this._updateFog(dt, w, h);
    } else if (this.currentWeather === WeatherType.CLEAR) {
      if (this.getTimeOfDay() === TimeOfDay.GOLDEN_HOUR) {
        this._updateDustMotes(dt, w, h);
      }
    }

    // Update ground micro-splash ripple rings
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.life -= dt;
      s.radius += dt * 32;
      if (s.life <= 0) {
        this.splashes.splice(i, 1);
      }
    }
  }

  _updateRain(dt, w, h) {
    for (let i = 0; i < this.rainParticles.length; i++) {
      const p = this.rainParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Wrap-around bounds and spawn ground splashes
      if (p.y > h || p.x < -60) {
        if (p.y >= h && Math.random() < 0.25 && this.splashes.length < 40) {
          this.splashes.push({
            x: Math.max(0, Math.min(w, p.x)),
            y: Math.min(h - 4, p.y - 2),
            radius: 1.5,
            maxRadius: 4.5 + Math.random() * 5.5,
            life: 0.18,
            maxLife: 0.18,
            alpha: 0.45
          });
        }
        p.y = -20 - Math.random() * 40;
        p.x = Math.random() * (w + 140) - 20;
        p.vx = -80 - Math.random() * 80;
        p.vy = 550 + Math.random() * 200;
      }
    }
  }

  _updateDrizzle(dt, w, h) {
    for (let i = 0; i < this.drizzleParticles.length; i++) {
      const p = this.drizzleParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.y > h || p.x < -40) {
        p.y = -15 - Math.random() * 25;
        p.x = Math.random() * (w + 80) - 10;
        p.vx = -30 - Math.random() * 35;
        p.vy = 260 + Math.random() * 110;
      }
    }

    for (let i = 0; i < this.mistSpecks.length; i++) {
      const m = this.mistSpecks[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt + Math.sin(this.animTime * 1.5 + m.phase) * 6 * dt;

      if (m.y > h + 10 || m.x < -20) {
        m.y = Math.random() * h;
        m.x = w + 10;
      }
    }
  }

  _updateFog(dt, w, h) {
    for (let i = 0; i < this.fogSheets.length; i++) {
      const s = this.fogSheets[i];
      s.x += s.vx * dt;
      s.y = s.baseY + Math.sin(this.animTime * s.freq + s.phase) * s.amp;

      if (s.x - s.radiusX > w) {
        s.x = -s.radiusX;
      }
    }
  }

  _updateDustMotes(dt, w, h) {
    for (let i = 0; i < this.dustMotes.length; i++) {
      const d = this.dustMotes[i];
      d.x += d.vx * dt + Math.sin(this.animTime + d.phase) * 8 * dt;
      d.y += d.vy * dt + Math.cos(this.animTime * 0.8 + d.phase) * 6 * dt;

      if (d.x > w + 20 || d.y < -20) {
        d.x = Math.random() * (w * 0.7);
        d.y = h + 10;
      }
    }
  }

  // --- Rendering Pass ---

  render(ctx, camera, field, width, height, playerEntities = []) {
    if (!ctx) return;
    const w = width || (ctx.canvas ? ctx.canvas.width : (camera ? camera.viewportWidth : this.viewportWidth));
    const h = height || (ctx.canvas ? ctx.canvas.height : (camera ? camera.viewportHeight : this.viewportHeight));
    this.resize(w, h);

    // Extract light sources from field
    let lightSources = [];
    if (field && typeof field.getLightSources === 'function') {
      lightSources = field.getLightSources();
    } else if (field && Array.isArray(field.streetlamps)) {
      lightSources = field.streetlamps;
    } else if (Array.isArray(field)) {
      lightSources = field;
    }

    // Extract player entities
    const players = [];
    if (camera && camera.target) {
      players.push(camera.target);
    }
    if (field && Array.isArray(field.dynamicEntities)) {
      for (const ent of field.dynamicEntities) {
        if (ent && (ent.isOwner || ent.isDog || ent.isLocal)) {
          players.push(ent);
        }
      }
    }
    if (Array.isArray(playerEntities)) {
      players.push(...playerEntities);
    } else if (playerEntities) {
      players.push(playerEntities);
    }

    // 1. Atmospheric lighting overlay & radial streetlamp cutouts
    this.renderLighting(ctx, camera, lightSources, w, h, players);

    // 2. Live weather particle overlays
    this.renderParticles(ctx, camera, w, h);
  }

  renderLighting(ctx, camera, lightSources = [], width, height, playerEntities = []) {
    if (!ctx) return;
    const w = width || (ctx.canvas ? ctx.canvas.width : (camera ? camera.viewportWidth : this.viewportWidth));
    const h = height || (ctx.canvas ? ctx.canvas.height : (camera ? camera.viewportHeight : this.viewportHeight));
    this.resize(w, h);

    const tod = this.getTimeOfDay();

    // 1. Daytime: subtle warm sunlight wash
    if (tod === TimeOfDay.DAY) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 250, 230, 0.04)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    // 2. Golden Hour / Twilight: rich sepia-tinted amber gradient overlay
    if (tod === TimeOfDay.GOLDEN_HOUR) {
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(195, 115, 30, 0.32)');
      grad.addColorStop(0.5, 'rgba(195, 115, 30, 0.28)');
      grad.addColorStop(1, 'rgba(180, 100, 25, 0.24)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    // 3. Dawn: soft cool lavender-rose ambient
    if (tod === TimeOfDay.DAWN) {
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(190, 160, 205, 0.26)');
      grad.addColorStop(1, 'rgba(215, 170, 185, 0.20)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    // 4. Night & Dusk: deep ambient shadow with radial streetlamp illumination cutouts
    const isNight = tod === TimeOfDay.NIGHT;
    const ambientColor = isNight ? 'rgba(10, 16, 32, 0.82)' : 'rgba(30, 35, 60, 0.55)';

    const lights = Array.isArray(lightSources) ? lightSources : [];
    const players = [];
    if (camera && camera.target) players.push(camera.target);
    if (Array.isArray(playerEntities)) {
      players.push(...playerEntities);
    } else if (playerEntities) {
      players.push(playerEntities);
    }

    const offCanvas = this._getOffscreenCanvas(w, h);
    const offCtx = offCanvas && typeof offCanvas.getContext === 'function' ? offCanvas.getContext('2d') : null;

    if (offCtx) {
      offCtx.clearRect(0, 0, w, h);
      offCtx.fillStyle = ambientColor;
      offCtx.fillRect(0, 0, w, h);

      offCtx.save();
      offCtx.globalCompositeOperation = 'destination-out';

      // Soft radial cutouts for registered streetlamps & beacons
      for (const lamp of lights) {
        if (!lamp) continue;
        let sx = lamp.x;
        let sy = lamp.y;
        if (camera && typeof camera.worldToScreen === 'function') {
          const s = camera.worldToScreen(lamp.x, lamp.y);
          sx = s.x;
          sy = s.y;
        } else if (camera && camera.x !== undefined && camera.y !== undefined) {
          sx = lamp.x - camera.x;
          sy = lamp.y - camera.y;
        }

        const glowRadius = lamp.glowRadius || 120;
        if (sx < -glowRadius || sx > w + glowRadius || sy < -glowRadius || sy > h + glowRadius) {
          continue;
        }

        const intensity = typeof lamp.intensity === 'number' ? lamp.intensity : 0.9;
        const radial = offCtx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
        radial.addColorStop(0, `rgba(255, 240, 180, ${intensity})`);
        radial.addColorStop(0.35, `rgba(255, 240, 180, ${intensity * 0.75})`);
        radial.addColorStop(0.7, `rgba(255, 240, 180, ${intensity * 0.35})`);
        radial.addColorStop(1, 'rgba(255, 240, 180, 0.0)');

        offCtx.fillStyle = radial;
        offCtx.beginPath();
        offCtx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
        offCtx.fill();
      }

      // Soft halo cutout around player and dog so actors remain visible in dark
      for (const p of players) {
        if (!p || typeof p.x !== 'number') continue;
        let px = p.x;
        let py = p.y;
        if (camera && typeof camera.worldToScreen === 'function') {
          const s = camera.worldToScreen(p.x, p.y);
          px = s.x;
          py = s.y;
        } else if (camera && camera.x !== undefined && camera.y !== undefined) {
          px = p.x - camera.x;
          py = p.y - camera.y;
        }

        const pRadius = 75;
        if (px < -pRadius || px > w + pRadius || py < -pRadius || py > h + pRadius) {
          continue;
        }

        const pRadial = offCtx.createRadialGradient(px, py, 0, px, py, pRadius);
        pRadial.addColorStop(0, 'rgba(255, 240, 180, 0.65)');
        pRadial.addColorStop(0.5, 'rgba(255, 240, 180, 0.30)');
        pRadial.addColorStop(1, 'rgba(255, 240, 180, 0.0)');

        offCtx.fillStyle = pRadial;
        offCtx.beginPath();
        offCtx.arc(px, py, pRadius, 0, Math.PI * 2);
        offCtx.fill();
      }

      offCtx.restore();

      // Composite offscreen ambient mask onto scene
      ctx.drawImage(offCanvas, 0, 0);

      // Render subtle warm incandescent glow core for active lamps in lighter blend mode
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const lamp of lights) {
        if (!lamp) continue;
        let sx = lamp.x;
        let sy = lamp.y;
        if (camera && typeof camera.worldToScreen === 'function') {
          const s = camera.worldToScreen(lamp.x, lamp.y);
          sx = s.x;
          sy = s.y;
        } else if (camera && camera.x !== undefined && camera.y !== undefined) {
          sx = lamp.x - camera.x;
          sy = lamp.y - camera.y;
        }

        const glowRadius = lamp.glowRadius || 120;
        if (sx < -glowRadius || sx > w + glowRadius || sy < -glowRadius || sy > h + glowRadius) {
          continue;
        }

        const warmGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
        warmGrad.addColorStop(0, 'rgba(254, 240, 138, 0.28)');
        warmGrad.addColorStop(0.4, 'rgba(253, 224, 71, 0.12)');
        warmGrad.addColorStop(1, 'rgba(253, 224, 71, 0.0)');

        ctx.fillStyle = warmGrad;
        ctx.beginPath();
        ctx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

    } else {
      // Fallback ambient rectangle
      ctx.save();
      ctx.fillStyle = ambientColor;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // --- Weather Particles Rendering Pass ---

  renderParticles(ctx, camera, width, height) {
    if (!ctx) return;
    const w = width || (ctx.canvas ? ctx.canvas.width : (camera ? camera.viewportWidth : this.viewportWidth));
    const h = height || (ctx.canvas ? ctx.canvas.height : (camera ? camera.viewportHeight : this.viewportHeight));
    this.resize(w, h);

    if (this.currentWeather === WeatherType.RAIN) {
      this._renderRain(ctx, w, h);
    } else if (this.currentWeather === WeatherType.DRIZZLE) {
      this._renderDrizzle(ctx, w, h);
    } else if (this.currentWeather === WeatherType.FOG) {
      this._renderFog(ctx, w, h);
    } else if (this.currentWeather === WeatherType.OVERCAST) {
      this._renderOvercast(ctx, w, h);
    } else if (this.currentWeather === WeatherType.CLEAR) {
      if (this.getTimeOfDay() === TimeOfDay.GOLDEN_HOUR) {
        this._renderDustMotes(ctx, w, h);
      }
    }
  }

  _renderRain(ctx, w, h) {
    ctx.save();

    // Rain streaks
    ctx.strokeStyle = 'rgba(205, 225, 255, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < this.rainParticles.length; i++) {
      const p = this.rainParticles[i];
      if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;
      const norm = Math.hypot(p.vx, p.vy) || 1;
      const dx = (p.vx / norm) * p.len;
      const dy = (p.vy / norm) * p.len;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - dx, p.y - dy);
    }
    ctx.stroke();

    // Ground micro-splash ripple rings
    ctx.lineWidth = 1.1;
    for (let i = 0; i < this.splashes.length; i++) {
      const s = this.splashes[i];
      const progress = 1 - (s.life / s.maxLife);
      const alpha = Math.max(0, s.alpha * (1 - progress));
      ctx.strokeStyle = `rgba(215, 235, 255, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.radius, s.radius * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  _renderDrizzle(ctx, w, h) {
    ctx.save();

    // Drizzle streaks
    ctx.strokeStyle = 'rgba(195, 215, 240, 0.42)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let i = 0; i < this.drizzleParticles.length; i++) {
      const p = this.drizzleParticles[i];
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
      const norm = Math.hypot(p.vx, p.vy) || 1;
      const dx = (p.vx / norm) * p.len;
      const dy = (p.vy / norm) * p.len;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - dx, p.y - dy);
    }
    ctx.stroke();

    // Transient mist specks
    ctx.fillStyle = 'rgba(220, 235, 250, 0.22)';
    for (let i = 0; i < this.mistSpecks.length; i++) {
      const m = this.mistSpecks[i];
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _renderFog(ctx, w, h) {
    ctx.save();
    for (let i = 0; i < this.fogSheets.length; i++) {
      const s = this.fogSheets[i];
      if (s.x + s.radiusX < 0 || s.x - s.radiusX > w) continue;

      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radiusX);
      grad.addColorStop(0, `rgba(235, 242, 250, ${s.alpha.toFixed(2)})`);
      grad.addColorStop(0.55, `rgba(225, 235, 245, ${(s.alpha * 0.6).toFixed(2)})`);
      grad.addColorStop(1, 'rgba(215, 225, 235, 0.0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.radiusX, s.radiusY, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _renderOvercast(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(60, 70, 80, 0.12)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  _renderDustMotes(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 225, 140, 0.32)';
    for (let i = 0; i < this.dustMotes.length; i++) {
      const d = this.dustMotes[i];
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export const environmentSystem = new EnvironmentSystem();
export default environmentSystem;
