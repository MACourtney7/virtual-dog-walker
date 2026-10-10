// Ziggy: The Great Park Adventure - Main Entry Point (Vanilla ES6)
export class GameEngine {
  constructor(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      throw new Error(`Canvas element with id '${canvasId}' not found.`);
    }
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not acquire 2D rendering context from canvas.');
    }
    this.ctx = ctx;
    this.isRunning = false;
    this.lastTime = 0;

    this.initCanvasSize();
    window.addEventListener('resize', () => this.initCanvasSize());
  }

  initCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = (rect.width || 1280) * dpr;
    this.canvas.height = (rect.height || 720) * dpr;
    if (this.ctx.resetTransform) {
      this.ctx.resetTransform();
    }
    this.ctx.scale(dpr, dpr);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  stop() {
    this.isRunning = false;
  }

  loop(currentTime) {
    if (!this.isRunning) return;

    const dt = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    // Engine update hook
  }

  render() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 1280;
    const height = rect.height || 720;

    this.ctx.clearRect(0, 0, width, height);

    // Warm park sky gradient
    const grad = this.ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#38bdf8');
    grad.addColorStop(0.65, '#bae6fd');
    grad.addColorStop(0.65, '#4ade80');
    grad.addColorStop(1, '#22c55e');

    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, width, height);
  }
}

// Bootstrap on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  const engine = new GameEngine('game-canvas');
  engine.start();
});
