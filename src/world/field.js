// Clifton Down Meadow - Top-Down Environment, Camera & Depth-Sorted Rendering Engine

export class Camera {
  constructor(viewportWidth = 1280, viewportHeight = 720, worldWidth = 2600, worldHeight = 1900) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.x = (worldWidth - viewportWidth) / 2;
    this.y = (worldHeight - viewportHeight) / 2;
    this.target = null;
    this.lerpSpeed = 0.08;
  }

  resize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  follow(target) {
    this.target = target;
  }

  update(dt) {
    if (!this.target) return;

    const targetCenterX = this.target.x - this.viewportWidth / 2;
    const targetCenterY = this.target.y - this.viewportHeight / 2;

    this.x += (targetCenterX - this.x) * (1 - Math.exp(-this.lerpSpeed * 60 * dt));
    this.y += (targetCenterY - this.y) * (1 - Math.exp(-this.lerpSpeed * 60 * dt));

    // Clamp camera within world bounds
    const maxX = Math.max(0, this.worldWidth - this.viewportWidth);
    const maxY = Math.max(0, this.worldHeight - this.viewportHeight);
    this.x = Math.max(0, Math.min(maxX, this.x));
    this.y = Math.max(0, Math.min(maxY, this.y));
  }

  apply(ctx) {
    ctx.save();
    ctx.translate(-Math.round(this.x), -Math.round(this.y));
  }

  restore(ctx) {
    ctx.restore();
  }

  worldToScreen(worldX, worldY) {
    return { x: worldX - this.x, y: worldY - this.y };
  }

  screenToWorld(screenX, screenY) {
    const rawX = screenX + this.x;
    const rawY = screenY + this.y;
    return {
      x: Math.max(0, Math.min(this.worldWidth, rawX)),
      y: Math.max(0, Math.min(this.worldHeight, rawY))
    };
  }
}

export class Field {
  constructor(width = 2600, height = 1900) {
    this.width = width;
    this.height = height;

    // Grass colors
    this.grassBase = '#437332';
    this.grassDark = '#375e28';
    this.grassLight = '#538c3e';
    this.pathColor = '#b89f78';
    this.pathEdge = '#968160';

    // Static park scenery objects
    this.trees = [];
    this.benches = [];
    this.wildflowers = [];
    this.boundaries = [];
    this.ambientParticles = [];
    this.windTime = 0;

    this.initScenery();
    this.initParticles();
  }

  initScenery() {
    // 1. Perimeter Boundary Walls (stone wall with iron railings)
    const margin = 36;
    this.boundaries = [
      { x: margin, y: margin, w: this.width - margin * 2, h: 20 }, // North
      { x: margin, y: this.height - margin - 20, w: this.width - margin * 2, h: 20 }, // South
      { x: margin, y: margin, w: 20, h: this.height - margin * 2 }, // West
      { x: this.width - margin - 20, y: margin, w: 20, h: this.height - margin * 2 } // East
    ];

    // 2. Mature English Oak & Sweet Chestnut Trees
    // Placed naturally across Clifton Down meadow with open clearings
    const treePositions = [
      { x: 300, y: 280, r: 55, type: 'oak' },
      { x: 520, y: 340, r: 65, type: 'chestnut' },
      { x: 880, y: 240, r: 70, type: 'oak' },
      { x: 1300, y: 260, r: 75, type: 'chestnut' },
      { x: 1750, y: 320, r: 60, type: 'oak' },
      { x: 2200, y: 380, r: 65, type: 'oak' },

      { x: 260, y: 750, r: 60, type: 'chestnut' },
      { x: 680, y: 820, r: 75, type: 'oak' },
      { x: 1950, y: 780, r: 70, type: 'chestnut' },
      { x: 2320, y: 860, r: 58, type: 'oak' },

      { x: 340, y: 1300, r: 65, type: 'oak' },
      { x: 740, y: 1420, r: 70, type: 'chestnut' },
      { x: 1400, y: 1550, r: 80, type: 'oak' },
      { x: 1820, y: 1380, r: 65, type: 'oak' },
      { x: 2250, y: 1460, r: 60, type: 'chestnut' },

      // Central feature grove
      { x: 1150, y: 920, r: 80, type: 'oak' },
      { x: 1480, y: 980, r: 72, type: 'chestnut' }
    ];

    this.trees = treePositions.map((t, idx) => ({
      id: `tree-${idx}`,
      x: t.x,
      y: t.y,
      radius: t.r,
      type: t.type,
      trunkRadius: Math.round(t.r * 0.28),
      depthY: t.y + 10 // sorting anchor at trunk base
    }));

    // 3. Wooden Park Benches
    const benchPositions = [
      { x: 450, y: 440, angle: 0 },
      { x: 980, y: 360, angle: 0 },
      { x: 1650, y: 410, angle: 0 },
      { x: 420, y: 960, angle: Math.PI / 2 },
      { x: 2150, y: 940, angle: -Math.PI / 2 },
      { x: 880, y: 1320, angle: 0 },
      { x: 1680, y: 1450, angle: 0 },
      { x: 1320, y: 1080, angle: 0 }
    ];

    this.benches = benchPositions.map((b, idx) => ({
      id: `bench-${idx}`,
      x: b.x,
      y: b.y,
      w: 64,
      h: 26,
      depthY: b.y + 13
    }));

    // 4. Wildflower Patches (Buttercups, White Clover, Bluebells)
    const flowerTypes = ['buttercup', 'clover', 'bluebell'];
    for (let i = 0; i < 75; i++) {
      const cx = 100 + Math.random() * (this.width - 200);
      const cy = 100 + Math.random() * (this.height - 200);
      const count = 5 + Math.floor(Math.random() * 8);
      const type = flowerTypes[i % flowerTypes.length];
      for (let j = 0; j < count; j++) {
        this.wildflowers.push({
          x: cx + (Math.random() - 0.5) * 60,
          y: cy + (Math.random() - 0.5) * 60,
          type: type,
          size: 2.5 + Math.random() * 2
        });
      }
    }
  }

  initParticles() {
    this.ambientParticles = [];
    // Floating dandelion seeds / pollen
    for (let i = 0; i < 60; i++) {
      this.ambientParticles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: 15 + Math.random() * 25,
        vy: 5 + Math.random() * 15,
        swaySpeed: 1 + Math.random() * 2,
        swayAmp: 1.5 + Math.random() * 2,
        radius: 1.2 + Math.random() * 1.5,
        alpha: 0.35 + Math.random() * 0.45
      });
    }
  }

  update(dt) {
    this.windTime += dt;

    // Update ambient dandelion seeds
    for (const p of this.ambientParticles) {
      p.x += (p.vx + Math.sin(this.windTime * p.swaySpeed) * 8) * dt;
      p.y += (p.vy + Math.cos(this.windTime * p.swaySpeed * 0.5) * 4) * dt;

      // Wrap around world borders
      if (p.x > this.width) p.x = 0;
      if (p.y > this.height) p.y = 0;
      if (p.x < 0) p.x = this.width;
      if (p.y < 0) p.y = this.height;
    }
  }

  // Check collision for circle entity (e.g. Owner or Dog)
  resolveCircleCollision(x, y, radius) {
    let nx = x;
    let ny = y;

    // 1. World Perimeter bounds
    const minX = 56 + radius;
    const maxX = this.width - 56 - radius;
    const minY = 56 + radius;
    const maxY = this.height - 56 - radius;

    nx = Math.max(minX, Math.min(maxX, nx));
    ny = Math.max(minY, Math.min(maxY, ny));

    // 2. Tree trunk collisions
    for (const tree of this.trees) {
      const dx = nx - tree.x;
      const dy = ny - tree.depthY;
      const dist = Math.hypot(dx, dy);
      const minDist = radius + tree.trunkRadius;

      if (dist < minDist && dist > 0.001) {
        const overlap = minDist - dist;
        nx += (dx / dist) * overlap;
        ny += (dy / dist) * overlap;
      }
    }

    // 3. Bench collisions (AABB vs circle)
    for (const bench of this.benches) {
      const halfW = bench.w / 2;
      const halfH = bench.h / 2;
      const closestX = Math.max(bench.x - halfW, Math.min(nx, bench.x + halfW));
      const closestY = Math.max(bench.y - halfH, Math.min(ny, bench.y + halfH));
      const dx = nx - closestX;
      const dy = ny - closestY;
      const dist = Math.hypot(dx, dy);

      if (dist < radius) {
        if (dist > 0.001) {
          const overlap = radius - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += radius;
        }
      }
    }

    return { x: nx, y: ny };
  }

  // Y-Sorted Render Pipeline
  render(ctx, camera, dynamicEntities = []) {
    const viewLeft = camera.x;
    const viewTop = camera.y;
    const viewRight = camera.x + camera.viewportWidth;
    const viewBottom = camera.y + camera.viewportHeight;

    // 1. Background Turf & Paths
    this.renderGround(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 2. Gather Scenery and Dynamic Entities for Depth-Sorted (Y-sort) Pass
    const renderList = [];

    // Add trees
    for (const tree of this.trees) {
      if (
        tree.x + tree.radius > viewLeft &&
        tree.x - tree.radius < viewRight &&
        tree.y + tree.radius > viewTop &&
        tree.y - tree.radius < viewBottom
      ) {
        renderList.push({
          type: 'tree',
          y: tree.depthY,
          data: tree
        });
      }
    }

    // Add benches
    for (const bench of this.benches) {
      if (
        bench.x + bench.w > viewLeft &&
        bench.x - bench.w < viewRight &&
        bench.y + bench.h > viewTop &&
        bench.y - bench.h < viewBottom
      ) {
        renderList.push({
          type: 'bench',
          y: bench.depthY,
          data: bench
        });
      }
    }

    // Add dynamic entities (Owners, Dogs, Toys, etc.)
    for (const ent of dynamicEntities) {
      if (!ent) continue;
      const ey = ent.depthY !== undefined ? ent.depthY : ent.y;
      renderList.push({
        type: 'entity',
        y: ey,
        data: ent
      });
    }

    // Sort ascending by base Y coordinate (back to front)
    renderList.sort((a, b) => a.y - b.y);

    // 3. Render all sorted items
    for (const item of renderList) {
      if (item.type === 'tree') {
        this.renderTree(ctx, item.data);
      } else if (item.type === 'bench') {
        this.renderBench(ctx, item.data);
      } else if (item.type === 'entity') {
        item.data.draw(ctx);
      }
    }

    // 4. Overpass Tree Canopies (Draw subtle transparent foliage highlights)
    this.renderCanopyHighlights(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 5. Ambient Dandelion / Pollen Particles
    this.renderParticles(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 6. Perimeter Boundary Walls
    this.renderPerimeterWalls(ctx);
  }

  renderGround(ctx, left, top, right, bottom) {
    // Fill base turf
    ctx.fillStyle = this.grassBase;
    ctx.fillRect(left, top, right - left, bottom - top);

    // Soft subtle grid texture / lush grass variation
    ctx.save();
    const patchSize = 80;
    const startX = Math.floor(left / patchSize) * patchSize;
    const startY = Math.floor(top / patchSize) * patchSize;

    for (let x = startX; x <= right; x += patchSize) {
      for (let y = startY; y <= bottom; y += patchSize) {
        const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const noise = hash - Math.floor(hash);
        if (noise > 0.6) {
          ctx.fillStyle = this.grassLight;
          ctx.beginPath();
          ctx.ellipse(x + 40, y + 40, 24, 18, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (noise < 0.25) {
          ctx.fillStyle = this.grassDark;
          ctx.beginPath();
          ctx.ellipse(x + 40, y + 40, 20, 14, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Natural curved dirt footpaths
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Main diagonal path across Clifton Down
    ctx.strokeStyle = this.pathColor;
    ctx.lineWidth = 42;
    ctx.beginPath();
    ctx.moveTo(120, 250);
    ctx.bezierCurveTo(700, 380, 1100, 750, 1550, 950);
    ctx.bezierCurveTo(1900, 1100, 2200, 1450, 2480, 1700);
    ctx.stroke();

    // Secondary pathway to the tree grove
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(1550, 950);
    ctx.bezierCurveTo(1300, 1150, 950, 1250, 500, 1500);
    ctx.stroke();

    // Path soft grass edging
    ctx.strokeStyle = 'rgba(74, 124, 56, 0.4)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    // Render Wildflowers
    ctx.save();
    for (const f of this.wildflowers) {
      if (f.x >= left && f.x <= right && f.y >= top && f.y <= bottom) {
        if (f.type === 'buttercup') {
          ctx.fillStyle = '#f3c948';
        } else if (f.type === 'clover') {
          ctx.fillStyle = '#f8fafc';
        } else {
          ctx.fillStyle = '#6b8be8';
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  renderTree(ctx, tree) {
    ctx.save();
    // 1. Soft Ground Shadow
    ctx.fillStyle = 'rgba(25, 45, 18, 0.35)';
    ctx.beginPath();
    ctx.ellipse(tree.x + 8, tree.depthY + 6, tree.radius * 0.9, tree.radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Trunk with bark details
    ctx.fillStyle = '#3e2417';
    ctx.beginPath();
    ctx.ellipse(tree.x, tree.depthY, tree.trunkRadius, tree.trunkRadius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#553422';
    ctx.fillRect(tree.x - tree.trunkRadius * 0.7, tree.y - 10, tree.trunkRadius * 1.4, tree.depthY - (tree.y - 10));

    // 3. Lush Canopy Foliage (Layered circles)
    const baseColor = tree.type === 'oak' ? '#2d5322' : '#335e26';
    const midColor = tree.type === 'oak' ? '#3d6d2e' : '#457a34';
    const lightColor = tree.type === 'oak' ? '#4d883b' : '#579643';

    // Base dark foliage
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
    ctx.fill();

    // Mid puff clusters
    ctx.fillStyle = midColor;
    const puffs = [
      { dx: -tree.radius * 0.45, dy: -tree.radius * 0.2, r: tree.radius * 0.55 },
      { dx: tree.radius * 0.4, dy: -tree.radius * 0.25, r: tree.radius * 0.52 },
      { dx: 0, dy: -tree.radius * 0.4, r: tree.radius * 0.5 },
      { dx: -tree.radius * 0.25, dy: tree.radius * 0.25, r: tree.radius * 0.45 },
      { dx: tree.radius * 0.3, dy: tree.radius * 0.2, r: tree.radius * 0.48 }
    ];
    for (const p of puffs) {
      ctx.beginPath();
      ctx.arc(tree.x + p.dx, tree.y + p.dy, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Top sunlight highlights
    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.arc(tree.x - tree.radius * 0.18, tree.y - tree.radius * 0.28, tree.radius * 0.42, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  renderBench(ctx, bench) {
    ctx.save();
    // Drop shadow
    ctx.fillStyle = 'rgba(25, 45, 18, 0.3)';
    ctx.beginPath();
    ctx.ellipse(bench.x, bench.y + 12, bench.w / 2 + 4, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wooden Slats
    const halfW = bench.w / 2;
    const halfH = bench.h / 2;

    // Cast iron frame legs
    ctx.fillStyle = '#2d3748';
    ctx.fillRect(bench.x - halfW + 6, bench.y - halfH + 4, 6, bench.h);
    ctx.fillRect(bench.x + halfW - 12, bench.y - halfH + 4, 6, bench.h);

    // Warm teak wood slats
    ctx.fillStyle = '#8f562b';
    ctx.fillRect(bench.x - halfW, bench.y - halfH + 4, bench.w, 7);
    ctx.fillStyle = '#a66735';
    ctx.fillRect(bench.x - halfW, bench.y - halfH + 13, bench.w, 8);

    // Subtle slat divider lines
    ctx.strokeStyle = '#5a3418';
    ctx.lineWidth = 1;
    ctx.strokeRect(bench.x - halfW, bench.y - halfH + 4, bench.w, 7);
    ctx.strokeRect(bench.x - halfW, bench.y - halfH + 13, bench.w, 8);
    ctx.restore();
  }

  renderCanopyHighlights(ctx, left, top, right, bottom) {
    // Subtle golden hour sun-glint across the top leaves
    ctx.save();
    ctx.fillStyle = 'rgba(243, 201, 72, 0.08)';
    for (const tree of this.trees) {
      if (tree.x > left - 100 && tree.x < right + 100 && tree.y > top - 100 && tree.y < bottom + 100) {
        ctx.beginPath();
        ctx.arc(tree.x - tree.radius * 0.3, tree.y - tree.radius * 0.3, tree.radius * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  renderParticles(ctx, left, top, right, bottom) {
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    for (const p of this.ambientParticles) {
      if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) {
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  renderPerimeterWalls(ctx) {
    ctx.save();
    ctx.fillStyle = '#4a5568'; // Stone wall cap
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 3;

    for (const b of this.boundaries) {
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);

      // Stone cap texture highlights
      ctx.fillStyle = '#718096';
      ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, 3);
      ctx.fillStyle = '#4a5568';
    }

    // Four corner stone pillars
    const margin = 36;
    const corners = [
      { x: margin - 6, y: margin - 6 },
      { x: this.width - margin - 14, y: margin - 6 },
      { x: margin - 6, y: this.height - margin - 14 },
      { x: this.width - margin - 14, y: this.height - margin - 14 }
    ];

    ctx.fillStyle = '#2d3748';
    for (const c of corners) {
      ctx.fillRect(c.x, c.y, 24, 24);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(c.x + 4, c.y + 4, 16, 16);
      ctx.fillStyle = '#2d3748';
    }
    ctx.restore();
  }
}
