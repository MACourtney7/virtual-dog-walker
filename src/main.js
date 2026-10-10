// Ziggy: The Great Park Adventure - Full Game Engine & Loop
import { Ziggy, ZiggyState } from './entities/ziggy.js';
import { ParkLevel } from './level/park_level.js';
import { ParticleSystem } from './systems/particles.js';
import { sound } from './systems/audio.js';
import { CollectibleType } from './entities/collectibles.js';

export class GameEngine {
  constructor(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) throw new Error(`Canvas '${canvasId}' not found.`);
    this.canvas = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D context.');
    this.ctx = ctx;

    this.isRunning = false;
    this.lastTime = 0;

    // Viewport & Camera
    this.viewWidth = 1280;
    this.viewHeight = 720;
    this.cameraX = 0;

    // Game Objects
    this.level = new ParkLevel();
    this.ziggy = new Ziggy(80, 500);
    this.particles = new ParticleSystem();

    // Game Stats
    this.lives = 3;
    this.bonesCollected = 0;
    this.score = 0;
    this.isVictory = false;
    this.sprintTimer = 0;

    // Hook Ziggy Audio
    this.ziggy.onBarkTrigger = () => {
      sound.playBark();
      this.particles.emitDust(this.ziggy.pos.x + 20, this.ziggy.pos.y + 36, this.ziggy.facing);
    };

    // Input state
    this.keys = {
      left: false,
      right: false,
      down: false,
      sprint: false,
      jumpPressed: false,
      jumpReleased: false,
      barkPressed: false
    };

    this.initCanvasSize();
    this.bindEvents();
    this.updateHUD();
  }

  initCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.viewWidth = rect.width || 1280;
    this.viewHeight = rect.height || 720;

    this.canvas.width = this.viewWidth * dpr;
    this.canvas.height = this.viewHeight * dpr;
    if (this.ctx.resetTransform) this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.initCanvasSize());

    window.addEventListener('keydown', (e) => {
      sound.ensureContext();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.keys.left = true;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.keys.right = true;
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.keys.down = true;
      if (e.key === 'Shift') this.keys.sprint = true;

      if (e.key === ' ' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        this.keys.jumpPressed = true;
        if (this.ziggy.isGrounded) sound.playJump();
        else if (this.ziggy.canFlutter) sound.playFlutter();
      }

      if (e.key === 'b' || e.key === 'B' || e.key === 'k' || e.key === 'K') {
        this.keys.barkPressed = true;
      }

      if (e.key === 'r' || e.key === 'R') {
        if (this.isVictory || this.lives <= 0) this.restart();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.keys.left = false;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.keys.right = false;
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.keys.down = false;
      if (e.key === 'Shift') this.keys.sprint = false;

      if (e.key === ' ' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        this.keys.jumpReleased = true;
      }
    });

    // Click/touch bark
    this.canvas.addEventListener('pointerdown', () => {
      sound.ensureContext();
      this.keys.barkPressed = true;
    });
  }

  restart() {
    this.level = new ParkLevel();
    this.ziggy = new Ziggy(80, 500);
    this.ziggy.onBarkTrigger = () => sound.playBark();
    this.lives = 3;
    this.bonesCollected = 0;
    this.score = 0;
    this.isVictory = false;
    this.sprintTimer = 0;
    this.updateHUD();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  loop(currentTime) {
    if (!this.isRunning) return;
    const dt = Math.min((currentTime - this.lastTime) / 1000, 0.05);
    this.lastTime = currentTime;

    this.update(dt);
    this.render();

    // Reset single-frame input flags
    this.keys.jumpPressed = false;
    this.keys.jumpReleased = false;
    this.keys.barkPressed = false;

    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    if (this.isVictory) return;

    // Tennis ball speed boost decay
    if (this.sprintTimer > 0) {
      this.sprintTimer -= dt;
      this.keys.sprint = true;
    }

    // Check Mud Puddle Traction Reduction
    let inMud = false;
    for (const mud of this.level.mudPuddles) {
      if (this.ziggy.aabb.intersects(mud.aabb)) {
        inMud = true;
        break;
      }
    }
    const speedScale = inMud ? 0.55 : 1.0;
    this.ziggy.moveSpeed = 240 * speedScale;

    // Dust particles on running
    if (this.ziggy.isGrounded && Math.abs(this.ziggy.vel.x) > 100 && Math.random() < 0.25) {
      this.particles.emitDust(this.ziggy.pos.x + 20, this.ziggy.pos.y + 36, this.ziggy.facing);
    }

    // Ziggy Physics & Input
    this.ziggy.handleInput(this.keys, dt);
    this.ziggy.update(dt, this.level.platforms);

    // Pitfall check
    if (this.ziggy.pos.y > this.level.height + 40) {
      this.lives = Math.max(0, this.lives - 1);
      this.ziggy.pos.set(80, 500);
      this.ziggy.vel.set(0, 0);
      this.updateHUD();
    }

    // Update critters
    for (const sq of this.level.squirrels) {
      sq.update(dt, this.ziggy.activeBarks);
    }

    // Collectibles Collision Check
    const ziggyBox = this.ziggy.aabb;
    for (const c of this.level.collectibles) {
      if (!c.isCollected) {
        c.update(dt);
        if (ziggyBox.intersects(c.aabb)) {
          c.isCollected = true;
          if (c.type === CollectibleType.BONE) {
            this.bonesCollected++;
            this.score += 100;
            sound.playBoneCollect();
            this.particles.emitSparkles(c.x + 10, c.y + 10);
          } else if (c.type === CollectibleType.TENNIS_BALL) {
            this.sprintTimer = 5.0; // 5 seconds speed boost!
            this.score += 50;
            sound.playBallPickup();
            this.particles.emitSparkles(c.x + 10, c.y + 10);
          } else if (c.type === CollectibleType.SAUSAGE) {
            this.lives = Math.min(3, this.lives + 1);
            this.score += 150;
            sound.playBoneCollect();
            this.particles.emitSparkles(c.x + 10, c.y + 10);
          }
          this.updateHUD();
        }
      }
    }

    // Goal Check: Dog Park Gate
    if (this.level.goalGate && !this.isVictory) {
      if (ziggyBox.intersects(this.level.goalGate.aabb)) {
        this.isVictory = true;
        this.score += 500;
        sound.playVictory();
        this.particles.emitConfetti(this.level.goalGate.x + 30, this.level.goalGate.y + 20);
        this.updateHUD();
      }
    }

    this.particles.update(dt);

    // Smooth Camera Tracking (keep Ziggy roughly 35% from left)
    const targetCamX = this.ziggy.pos.x - this.viewWidth * 0.35;
    const maxCamX = Math.max(0, this.level.width - this.viewWidth);
    this.cameraX += (Math.max(0, Math.min(targetCamX, maxCamX)) - this.cameraX) * 0.1;
  }

  updateHUD() {
    const livesEl = document.getElementById('lives-val');
    const bonesEl = document.getElementById('bones-val');
    const scoreEl = document.getElementById('score-val');

    if (livesEl) livesEl.textContent = '🐾'.repeat(this.lives) || '💀';
    if (bonesEl) bonesEl.textContent = String(this.bonesCollected).padStart(2, '0');
    if (scoreEl) scoreEl.textContent = String(this.score).padStart(5, '0');
  }

  render() {
    this.ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);

    // 1. Parallax Sky & Scenic Backgrounds
    this.level.drawBackground(this.ctx, this.cameraX, this.viewWidth, this.viewHeight);

    // 2. World Space Transformation
    this.ctx.save();
    this.ctx.translate(-this.cameraX, 0);

    // Level Platforms, Benches, Walls
    this.level.drawPlatforms(this.ctx);

    // Critters (Squirrels)
    for (const sq of this.level.squirrels) {
      sq.draw(this.ctx);
    }

    // Collectibles (Bones & Balls)
    for (const c of this.level.collectibles) {
      c.draw(this.ctx);
    }

    // Hero: Ziggy the Cocker Spaniel
    this.ziggy.draw(this.ctx);

    // Particles
    this.particles.draw(this.ctx);

    this.ctx.restore();

    // 3. Victory or Game Over Overlay
    if (this.isVictory) {
      this.renderVictoryOverlay();
    } else if (this.lives <= 0) {
      this.renderGameOverOverlay();
    }
  }

  renderVictoryOverlay() {
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    this.ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

    this.ctx.fillStyle = '#f3c948';
    this.ctx.font = 'bold 36px "Outfit", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('🎉 LEVEL CLEARED! 🎉', this.viewWidth / 2, this.viewHeight / 2 - 40);

    this.ctx.fillStyle = '#f8fafc';
    this.ctx.font = '22px "Outfit", sans-serif';
    this.ctx.fillText('Ziggy reached the Dog Park!', this.viewWidth / 2, this.viewHeight / 2 + 10);

    this.ctx.fillStyle = '#38bdf8';
    this.ctx.font = '16px monospace';
    this.ctx.fillText(`Final Score: ${this.score}  •  Bones: ${this.bonesCollected}`, this.viewWidth / 2, this.viewHeight / 2 + 50);

    this.ctx.fillStyle = '#94a3b8';
    this.ctx.font = '14px sans-serif';
    this.ctx.fillText('Press R to play again', this.viewWidth / 2, this.viewHeight / 2 + 90);
    this.ctx.restore();
  }

  renderGameOverOverlay() {
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    this.ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

    this.ctx.fillStyle = '#ef4444';
    this.ctx.font = 'bold 36px "Outfit", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('NAPS TIME! 😴', this.viewWidth / 2, this.viewHeight / 2 - 20);

    this.ctx.fillStyle = '#94a3b8';
    this.ctx.font = '16px sans-serif';
    this.ctx.fillText('Ziggy got a bit too tired. Press R to try again!', this.viewWidth / 2, this.viewHeight / 2 + 30);
    this.ctx.restore();
  }
}

// Auto-boot on load
window.addEventListener('DOMContentLoaded', () => {
  const engine = new GameEngine('game-canvas');
  engine.start();
});
