// Human Owner Player Avatar - Cruise-and-Helm Player Locomotion, Continuous Heading Steering, Ground Halo & Directional 2.5D Silhouette
import { resolveFieldCollision } from '../engine/wasm_sim_bridge.js';

// Gait model constants
export const Gait = Object.freeze({
  STAND: 'STAND',
  STROLL: 'STROLL',
  WALK: 'WALK',
  JOG: 'JOG'
});

const GAIT_ORDER = [Gait.STAND, Gait.STROLL, Gait.WALK, Gait.JOG];

const GAIT_SPEEDS = Object.freeze({
  [Gait.STAND]: 0,
  [Gait.STROLL]: 75,
  [Gait.WALK]: 100,
  [Gait.JOG]: 185
});

// Max turn rate (radians/sec) per gait
const GAIT_TURN_RATES = Object.freeze({
  [Gait.STAND]: Math.PI, // effectively free while standing
  [Gait.STROLL]: (180 * Math.PI) / 180,
  [Gait.WALK]: (115 * Math.PI) / 180,
  [Gait.JOG]: (65 * Math.PI) / 180
});

const STEP_OFF_TURN_RATE = (300 * Math.PI) / 180; // 300 deg/s
const STEP_OFF_ALIGN_TOLERANCE = (5 * Math.PI) / 180; // ~5 deg
const STEP_OFF_MAX_DURATION = 0.5; // seconds

// Player body hit-test radius (px)
const PLAYER_HIT_RADIUS = 26;

const JOG_DURATION = 2.0;
const JOG_COOLDOWN = 2.0;

// Wrapped shortest-arc delta from a to b
function angleDelta(a, b) {
  let delta = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export class Owner {
  constructor(x = 1200, y = 900, name = 'Walker', isLocal = true) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.speed = 190; // px/s
    this.facing = 'S';
    this.angle = Math.PI / 2; // Facing downward (South)

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
    this.accessory = 'BACKPACK'; // Supported: 'BACKPACK', 'SCARF', 'HOODIE', 'NONE'

    // State & Animations
    this.isMoving = false;
    this.walkPhase = 0;
    this.isPetting = false;
    this.petTimer = 0;
    this.isBending = false;
    this.bendTimer = 0;
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

    // Gait & heading state
    this.gait = Gait.STAND;
    this.targetHeading = this.angle;
    this.jogTimer = 0;
    this.jogCooldown = 0;
    this.stepOffTimer = 0;
    this.stepOffActive = false;
  }

  // --- Gait API ---

  getCurrentSpeed() {
    return GAIT_SPEEDS[this.gait] || 0;
  }

  setTargetHeading(radians) {
    if (typeof radians !== 'number' || !isFinite(radians)) return;
    // Heading-only update. Gait transitions are the caller's responsibility
    // (e.g. main.js explicitly promotes STAND -> STROLL on a field press).
    this.targetHeading = radians;
    // Turn-on-the-spot: while STAND, snap the facing angle immediately.
    if (this.gait === Gait.STAND) {
      this.angle = radians;
    }
  }

  setGait(nextGait, options = {}) {
    if (!GAIT_ORDER.includes(nextGait)) return;
    if (nextGait === this.gait) return;

    const prevIndex = GAIT_ORDER.indexOf(this.gait);
    const nextIndex = GAIT_ORDER.indexOf(nextGait);

    // Clamp upward transitions into JOG while cooldown is active
    if (nextGait === Gait.JOG && this.jogCooldown > 0) {
      nextGait = Gait.WALK;
    }

    // Leaving JOG starts cooldown
    if (this.gait === Gait.JOG && nextGait !== Gait.JOG) {
      this.jogCooldown = JOG_COOLDOWN;
      this.jogTimer = 0;
    }

    // Entering JOG starts timer
    if (nextGait === Gait.JOG) {
      this.jogTimer = JOG_DURATION;
    }

    // Leaving STAND begins step-off alignment window
    if (this.gait === Gait.STAND && nextGait !== Gait.STAND) {
      this.stepOffActive = true;
      this.stepOffTimer = STEP_OFF_MAX_DURATION;
    }

    this.gait = nextGait;

    // Keep targetHeading synced to current angle when stopping
    if (nextGait === Gait.STAND) {
      this.targetHeading = this.angle;
      this.stepOffActive = false;
      this.stepOffTimer = 0;
    }

    // Keep isMoving and velocity in sync immediately so no stale motion
    // survives a gait change (e.g. boundary collision forcing STAND).
    this.isMoving = this.gait !== Gait.STAND;
    if (!this.isMoving) {
      this.vx = 0;
      this.vy = 0;
    }
  }

  stepGait(delta) {
    const dir = delta > 0 ? 1 : (delta < 0 ? -1 : 0);
    if (dir === 0) return;
    const idx = GAIT_ORDER.indexOf(this.gait);
    const nextIdx = Math.max(0, Math.min(GAIT_ORDER.length - 1, idx + dir));
    if (nextIdx === idx) return;
    this.setGait(GAIT_ORDER[nextIdx]);
  }

  // --- Heading integration ---

  _updateHeading(dt) {
    if (this.gait === Gait.STAND) {
      this.angle = this.targetHeading;
      return;
    }

    const delta = angleDelta(this.angle, this.targetHeading);
    const absDelta = Math.abs(delta);

    // Determine max turn rate
    let maxRate = GAIT_TURN_RATES[this.gait] || GAIT_TURN_RATES[Gait.WALK];
    // The 300 deg/s step-off rate applies strictly to the STAND -> STROLL transition.
    if (this.stepOffActive && this.gait === Gait.STROLL) {
      if (absDelta <= STEP_OFF_ALIGN_TOLERANCE || this.stepOffTimer <= 0) {
        this.stepOffActive = false;
        this.stepOffTimer = 0;
      } else {
        maxRate = STEP_OFF_TURN_RATE;
      }
    } else if (this.stepOffActive) {
      // Any other gait cancels the step-off window
      this.stepOffActive = false;
      this.stepOffTimer = 0;
    }

    const maxStep = maxRate * dt;
    if (absDelta <= maxStep) {
      this.angle = this.targetHeading;
    } else {
      this.angle += Math.sign(delta) * maxStep;
    }

    // Normalize angle to [-PI, PI]
    this.angle = ((this.angle + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (this.angle < -Math.PI) this.angle += Math.PI * 2;
  }

  // --- Rear brake arc helper ---

  isPointOnRearBrakeArc(worldX, worldY) {
    if (this.gait === Gait.STAND) return false;

    // Match the rendered ground halo ellipse geometry (see drawGroundHalo)
    const centerX = this.x;
    const centerY = this.y + 12;
    const Rx = 22;
    const Ry = 12.1;

    const dx = worldX - centerX;
    const dy = worldY - centerY;

    // Normalized elliptical distance
    const normDist = Math.hypot(dx / Rx, dy / Ry);
    if (normDist < 0.7 || normDist > 3.5) return false;

    // Normalized angle in ellipse space
    const normAngle = Math.atan2(dy / Ry, dx / Rx);
    const rearHeading = this.angle + Math.PI;
    const delta = Math.abs(angleDelta(rearHeading, normAngle));

    const halfSpan = (110 * Math.PI) / 180 / 2; // ~55 deg each side
    return delta <= halfSpan;
  }

  isPointOnPlayer(worldX, worldY) {
    const dx = worldX - this.x;
    const dy = worldY - this.y;
    return (dx * dx + dy * dy) < (PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS);
  }

  setChat(text, duration = 4.0) {
    this.chatText = text;
    this.chatTimer = duration;
  }

  setEmote(emote, duration = 3.0) {
    this.emote = emote;
    this.emoteTimer = duration;
  }

  triggerPet(duration = 0.8) {
    this.isPetting = true;
    this.petTimer = duration;
  }

  triggerPickup(duration = 0.8) {
    this.isBending = true;
    this.bendTimer = duration;
  }

  update(dt, field) {
    // Remote peers are driven authoritatively by the network interpolator.
    // Only the local owner integrates movement, gait, turning and collisions.
    if (!this.isLocal) {
      this.depthY = this.y + 12;
      return;
    }

    // 1. Gait persists autonomously until changed via setGait / stepGait.
    //    (Legacy directional key handling removed in movement redesign.)

    // 2. Advance gait timers
    // Decrement cooldown BEFORE the JOG expiry check so a cooldown that is
    // freshly initialised this tick is not decremented on the same tick.
    if (this.jogCooldown > 0) {
      this.jogCooldown = Math.max(0, this.jogCooldown - dt);
    }
    if (this.jogTimer > 0) {
      this.jogTimer -= dt;
      if (this.jogTimer <= 0) {
        this.jogTimer = 0;
        if (this.gait === Gait.JOG) {
          // Expire JOG -> WALK and start cooldown (do not decrement this tick)
          this.setGait(Gait.WALK);
          this.jogCooldown = JOG_COOLDOWN;
        }
      }
    }
    if (this.stepOffActive) {
      this.stepOffTimer = Math.max(0, this.stepOffTimer - dt);
    }

    // 3. Update heading toward target
    this._updateHeading(dt);

    // 4. Compute velocity from gait speed and current angle
    const speed = this.getCurrentSpeed();
    if (speed > 0) {
      this.vx = Math.cos(this.angle) * speed;
      this.vy = Math.sin(this.angle) * speed;
      this.isMoving = true;
      // Cadence scales with gait speed
      const cadence = 4.0 + (speed / 265) * 8.0;
      this.walkPhase += dt * cadence;
    } else {
      this.vx = 0;
      this.vy = 0;
      this.isMoving = false;
    }

    // Step-off alignment gate: hold position until facing target heading.
    if (this.stepOffActive) {
      const alignErr = Math.abs(angleDelta(this.angle, this.targetHeading));
      if (alignErr > STEP_OFF_ALIGN_TOLERANCE) {
        this.vx = 0;
        this.vy = 0;
      } else {
        this.stepOffActive = false;
      }
    }
    // Keep isMoving boolean in sync with gait for Protocol.createSyncState & rendering
    this.isMoving = this.gait !== Gait.STAND;

    // Apply movement
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Resolve world obstacle & boundary collisions with result contract
    if (field && typeof field.resolveCollisionWithResult === 'function') {
      const res = field.resolveCollisionWithResult(this.x, this.y, this.radius, this.targetHeading);
      if (res) {
        this.x = res.x;
        this.y = res.y;
        if (res.kind === 'boundary') {
          this.setGait(Gait.STAND);
        } else if (res.kind === 'obstacle' && res.deflectedHeading !== undefined) {
          this.setTargetHeading(res.deflectedHeading);
        }
      }
    } else if (field) {
      resolveFieldCollision(this, this.radius, field);
    }

    // Re-sync motion flags after collision resolution so a boundary stop
    // never leaves stale velocity or isMoving state behind.
    this.isMoving = this.gait !== Gait.STAND;
    if (!this.isMoving) {
      this.vx = 0;
      this.vy = 0;
    }

    this.depthY = this.y + 12;

    // Update timers
    if (this.petTimer > 0) {
      this.petTimer -= dt;
      if (this.petTimer <= 0) this.isPetting = false;
    }

    if (this.bendTimer > 0) {
      this.bendTimer -= dt;
      if (this.bendTimer <= 0) this.isBending = false;
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
    ctx.save();

    const angle = this.angle !== undefined ? this.angle : Math.PI / 2;

    // Ground halo (drawn first, beneath everything)
    this.drawGroundHalo(ctx, angle);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Animated kneeling/bending pose when petting or picking up waste
    const isKneeling = this.isPetting || this.isBending;
    const kneelProgress = isKneeling
      ? Math.sin(Math.min(1.0, Math.max(0, (this.petTimer || this.bendTimer || 0.4) / 0.8)) * Math.PI)
      : 0;
    const kneelDrop = kneelProgress * 7;
    const kneelLeanX = cosA * kneelProgress * 6;
    const kneelLeanY = sinA * kneelProgress * 4;

    // 1. Soft ground drop shadow (directionally oriented and widens when kneeling)
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(
      this.x + kneelLeanX * 0.4,
      this.y + 14 + kneelDrop * 0.3,
      15 + kneelProgress * 3,
      7 + kneelProgress * 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // 2. Directional Shoulder/Hip Axes:
    // Transverse axis perpendicular to facing direction with 2.5D vertical foreshortening
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

    // Walk phase strides
    const legSwing = this.isMoving ? Math.sin(this.walkPhase) * 6.5 : 0;
    const armSwing = this.isMoving ? Math.cos(this.walkPhase) * 5.5 : 0;

    const torsoX = this.x + kneelLeanX;
    const torsoY = this.y - 3 + kneelDrop;

    // Helper for legs
    const drawLeg = (hipX, hipY, swing, isFar) => {
      ctx.save();
      const strideX = cosA * swing * 0.45;
      const strideY = sinA * swing * 0.45 + (Math.abs(swing) * 0.4);
      const lx = this.x + hipX + strideX;
      const ly = this.y + 1 + hipY + (isKneeling ? (isFar ? kneelDrop * 0.7 : kneelDrop * 0.3) : strideY);

      // Pants
      ctx.fillStyle = isFar ? this.getShadedColor(this.pantsColor, -0.15) : this.pantsColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - 2.8, ly, 5.6, 9 - (isKneeling ? kneelProgress * 3 : 0), 2);
      } else {
        ctx.rect(lx - 2.8, ly, 5.6, 9);
      }
      ctx.fill();

      // Shoe
      ctx.fillStyle = isFar ? this.getShadedColor(this.shoeColor, -0.15) : this.shoeColor;
      ctx.beginPath();
      const shoeW = Math.abs(cosA) > 0.4 ? 7.8 : 6.8;
      const shoeH = 5.0;
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - 3.2 + cosA * 1.5, ly + 8 - (isKneeling ? kneelProgress * 3 : 0), shoeW, shoeH, 2.5);
      } else {
        ctx.rect(lx - 3.2, ly + 8, shoeW, shoeH);
      }
      ctx.fill();

      // Shoe sole stripe
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(lx - 3.2 + cosA * 1.5, ly + 12 - (isKneeling ? kneelProgress * 3 : 0), shoeW, 1.2);
      ctx.restore();
    };

    // Helper for arms
    const drawArm = (shX, shY, swing, isFar) => {
      ctx.save();
      const ax = torsoX + shX;
      const ay = torsoY - 7 + shY;

      ctx.fillStyle = isFar ? this.getShadedColor(this.jacketColor, -0.18) : this.jacketColor;

      if (isKneeling && !isFar) {
        // Kneeling / bending gesture: arm reaches down toward pet or waste
        ctx.beginPath();
        ctx.moveTo(ax - 2.5, ay);
        ctx.lineTo(ax + 2.5, ay);
        ctx.lineTo(ax + cosA * 6 + 2, ay + 13);
        ctx.lineTo(ax + cosA * 6 - 2, ay + 13);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = this.skinTone;
        ctx.beginPath();
        ctx.arc(ax + cosA * 6, ay + 14.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const reachX = cosA * swing * 0.4;
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
      }
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

    // --- DEPTH LAYER 3: 3D Directional Torso / Jacket ---
    ctx.save();
    ctx.translate(torsoX, torsoY);
    ctx.rotate(angle - Math.PI / 2); // Orient so angle = Math.PI / 2 (South) has zero rotation

    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(-10.5, -9, 21, 18, 5);
    } else {
      ctx.rect(-10.5, -9, 21, 18);
    }
    ctx.fill();

    // 3D elliptical thickness shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.ellipse(0, 7, 10.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // Restore torso local transform

    // Torso Front Details if facing South / towards camera
    if (sinA > -0.2) {
      ctx.save();
      ctx.translate(torsoX, torsoY);

      // White inner shirt neckline
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-4, -9);
      ctx.lineTo(4, -9);
      ctx.lineTo(0, -3);
      ctx.closePath();
      ctx.fill();

      // Lapels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
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

      // Jacket zipper / seam line
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(0, 8);
      ctx.stroke();

      ctx.restore();
    } else {
      // Facing North / away from camera: Back jacket seams
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

    // --- DEPTH LAYER 4: Accessory (Backpack when facing North/Side, Scarf, or Hoodie) ---
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
    this.drawHeadAndFace(ctx, torsoX, torsoY, angle, cosA, sinA, kneelDrop);

    // --- DEPTH LAYER 7: Nametag Badge ---
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const displayNametag = this.isLocal ? `${this.name} (You)` : this.name;
    const textWidth = ctx.measureText(displayNametag).width;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x - textWidth / 2 - 6, this.y - 42 + kneelDrop, textWidth + 12, 16, 8);
    } else {
      ctx.rect(this.x - textWidth / 2 - 6, this.y - 42 + kneelDrop, textWidth + 12, 16);
    }
    ctx.fill();

    ctx.fillStyle = this.isLocal ? '#fde047' : '#f8fafc';
    ctx.fillText(displayNametag, this.x, this.y - 30 + kneelDrop);

    // --- DEPTH LAYER 8: Speech Bubble or Emote ---
    if (this.chatText) {
      this.drawSpeechBubble(ctx, this.chatText);
    } else if (this.emote) {
      this.drawEmoteBubble(ctx, this.emote);
    }

    ctx.restore();
  }

  drawGroundHalo(ctx, angle) {
    ctx.save();

    const cx = this.x;
    const cy = this.y + 12;
    const radius = 22;

    // Base halo ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Forward arrowhead on front perimeter
    const frontX = cx + Math.cos(angle) * radius;
    const frontY = cy + Math.sin(angle) * radius * 0.55;
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle) * 0.55;
    const arrowSize = 5;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(frontX + Math.cos(angle) * arrowSize, frontY + Math.sin(angle) * arrowSize * 0.55);
    ctx.lineTo(frontX + perpX * arrowSize, frontY + perpY * arrowSize);
    ctx.lineTo(frontX - perpX * arrowSize, frontY - perpY * arrowSize);
    ctx.closePath();
    ctx.fill();

    // Faint target indicator when turning and misaligned
    if (this.gait !== Gait.STAND) {
      const misalign = Math.abs(angleDelta(this.angle, this.targetHeading));
      if (misalign > (10 * Math.PI) / 180) {
        const tx = cx + Math.cos(this.targetHeading) * radius;
        const ty = cy + Math.sin(this.targetHeading) * radius * 0.55;
        ctx.fillStyle = 'rgba(253, 224, 71, 0.45)';
        ctx.beginPath();
        ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Enlarged rear brake sector (hidden in STAND)
    if (this.gait !== Gait.STAND) {
      const baseX = radius;         // 22
      const baseY = radius * 0.55;  // 12.1
      const outerScale = 3.5;
      const rearHeading = this.angle + Math.PI;
      const halfSpan = (110 * Math.PI) / 180 / 2;
      const startAngle = rearHeading - halfSpan;
      const endAngle = rearHeading + halfSpan;

      // Filled wedge from origin across the full sector
      ctx.fillStyle = 'rgba(239, 68, 68, 0.20)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const t = startAngle + (i / steps) * (endAngle - startAngle);
        const px = cx + Math.cos(t) * baseX * outerScale;
        const py = cy + Math.sin(t) * baseY * outerScale;
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      // Contour arc at the outer ring of the sector
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = startAngle + (i / steps) * (endAngle - startAngle);
        const px = cx + Math.cos(t) * baseX * outerScale;
        const py = cy + Math.sin(t) * baseY * outerScale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  drawBackpack(ctx, torsoX, torsoY, angle, isFront) {
    ctx.save();
    const packX = torsoX - Math.cos(angle) * 7.0;
    const packY = torsoY - Math.sin(angle) * 5.5;

    // Structured daypack body
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(packX - 7.5, packY - 8, 15, 16, 4);
    } else {
      ctx.rect(packX - 7.5, packY - 8, 15, 16);
    }
    ctx.fill();

    // Top pack flap with accent trim
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(packX - 7, packY - 8, 14, 6.5, 2.5);
    } else {
      ctx.rect(packX - 7, packY - 8, 14, 6.5);
    }
    ctx.fill();

    // Metallic buckle
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(packX - 1.5, packY - 2.5, 3.0, 2.5);

    // Side water bottle mesh pocket
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

    // Left strap
    ctx.beginPath();
    ctx.moveTo(torsoX - 6.5, torsoY - 8);
    ctx.lineTo(torsoX - 5.5, torsoY + 7);
    ctx.stroke();

    // Right strap
    ctx.beginPath();
    ctx.moveTo(torsoX + 6.5, torsoY - 8);
    ctx.lineTo(torsoX + 5.5, torsoY + 7);
    ctx.stroke();

    // Sternum strap across chest
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
    ctx.fillStyle = '#b91c1c'; // Warm crimson red
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoY - 8.5, 8.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trailing fluttering tail in the wind
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

  drawHeadAndFace(ctx, torsoX, torsoY, angle, cosA, sinA, kneelDrop) {
    const headX = this.x + (torsoX - this.x) * 0.8;
    const headY = this.y - 20 + kneelDrop;
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

        const beanieMain = '#c2410c';
        const beanieCuff = '#9a3412';
        ctx.fillStyle = beanieMain;
        ctx.beginPath();
        ctx.ellipse(headX, headY - 4, 10.0, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = beanieCuff;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(headX - 9.5, headY - 3, 19, 5.5, 2.5);
        } else {
          ctx.rect(headX - 9.5, headY - 3, 19, 5.5);
        }
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        for (let rx = -7.5; rx <= 7.5; rx += 2.5) {
          ctx.beginPath();
          ctx.moveTo(headX + rx, headY - 3);
          ctx.lineTo(headX + rx, headY + 2);
          ctx.stroke();
        }

        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(headX, headY - 12.5, 3.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(headX - 1, headY - 12.5, 2.2, 0, Math.PI * 2);
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
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, bubbleW, bubbleH, 8);
    } else {
      ctx.rect(bx, by, bubbleW, bubbleH);
    }
    ctx.fill();

    // Triangle pointer
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
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, 32, 28, 8);
    } else {
      ctx.rect(bx, by, 32, 28);
    }
    ctx.fill();

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

// Static exports for test/tooling access
Owner.GAIT_SPEEDS = GAIT_SPEEDS;
Owner.PLAYER_HIT_RADIUS = PLAYER_HIT_RADIUS;
Owner.STEP_OFF_ALIGN_TOLERANCE = STEP_OFF_ALIGN_TOLERANCE;
