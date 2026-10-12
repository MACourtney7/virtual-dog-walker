// The Downs (Clifton & Durdham Downs, Bristol) - Top-Down Environment, Camera & Depth-Sorted Rendering Engine

export class Camera {
  constructor(viewportWidth = 1280, viewportHeight = 720, worldWidth = 3200, worldHeight = 2400) {
    if (worldWidth === 2600 && worldHeight === 1900) {
      worldWidth = 3200;
      worldHeight = 2400;
    }
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
  constructor(width = 3200, height = 2400) {
    if (width === 2600 && height === 1900) {
      width = 3200;
      height = 2400;
    }
    this.width = width;
    this.height = height;

    // Rich procedural grass tones
    this.grassBase = '#3e6b2c';
    this.grassDark = '#335824';
    this.grassLight = '#4c8237';
    this.grassMown = '#447831';

    // Path colors: Cotswold gravel avenue and secondary woodland trails
    this.pathColor = '#c8b693';
    this.pathEdge = '#968160';
    this.pathDetail = '#ded3be';
    this.dirtPathColor = '#8c7353';
    this.dirtPathEdge = '#6f573c';

    // Static park scenery objects
    this.trees = [];
    this.benches = [];
    this.bins = [];
    this.waterTower = null;
    this.landmarks = [];
    this.rockOutcrops = [];
    this.wildflowers = [];
    this.boundaries = [];
    this.ambientParticles = [];
    this.tombstones = [];
    this.streetlamps = [];
    this.windTime = 0;

    this.initScenery();
    this.initParticles();
  }

  initScenery() {
    // 1. Perimeter Boundary Walls
    // North, East, South: traditional stone boundary walls with corner pillars
    // West: dramatic "Sea Walls" cliff edge perimeter wall with iron railings overlooking Avon Gorge
    const margin = 36;
    this.boundaries = [
      { id: 'wall-north', x: margin, y: margin, w: this.width - margin * 2, h: 20, type: 'stone' },
      { id: 'wall-south', x: margin, y: this.height - margin - 20, w: this.width - margin * 2, h: 20, type: 'stone' },
      { id: 'wall-west', x: margin, y: margin, w: 22, h: this.height - margin * 2, type: 'seawall' },
      { id: 'wall-east', x: this.width - margin - 20, y: margin, w: 20, h: this.height - margin * 2, type: 'stone' }
    ];

    // 2. Durdham Down Water Tower Landmark Pavilion (x: 2400, y: 450, radius: 42)
    this.waterTower = {
      id: 'water-tower',
      name: 'Durdham Down Water Tower',
      x: 2400,
      y: 450,
      radius: 42,
      depthY: 485,
      isLandmark: true
    };
    this.landmarks = [this.waterTower];

    // 3. West Zone: Sea Walls Rocky Limestone Outcrops (x: 100-500, y: 800-1600)
    this.rockOutcrops = [
      { id: 'rock-1', x: 160, y: 860, w: 56, h: 34, depthY: 876, r: 26 },
      { id: 'rock-2', x: 190, y: 1040, w: 62, h: 38, depthY: 1058, r: 28 },
      { id: 'rock-3', x: 175, y: 1260, w: 58, h: 36, depthY: 1276, r: 26 },
      { id: 'rock-4', x: 210, y: 1400, w: 66, h: 42, depthY: 1418, r: 30 },
      { id: 'rock-5', x: 185, y: 1560, w: 50, h: 32, depthY: 1574, r: 24 }
    ];

    // 4. Public Dog-Waste Bins (Network of 8 bins at authentic Downs locations)
    const binDefinitions = [
      { id: 'bin-1', x: 280, y: 820 },
      { id: 'bin-2', x: 320, y: 1480 },
      { id: 'bin-3', x: 520, y: 1850 },
      { id: 'bin-4', x: 1550, y: 1200 },
      { id: 'bin-5', x: 2500, y: 620 },
      { id: 'bin-6', x: 2280, y: 480 },
      { id: 'bin-7', x: 1420, y: 820 },
      { id: 'bin-8', x: 1080, y: 1750 }
    ];

    this.bins = binDefinitions.map(b => ({
      id: b.id,
      x: b.x,
      y: b.y,
      radius: 12,
      depthY: b.y + 8,
      isBin: true
    }));

    // 5. Wooden Park Benches (including 3 panoramic teak benches along Sea Walls)
    const benchPositions = [
      // Sea Walls panoramic benches angled towards Avon Gorge overlook
      { id: 'bench-sw-1', x: 220, y: 920, angle: -Math.PI / 2 },
      { id: 'bench-sw-2', x: 240, y: 1200, angle: -Math.PI / 2 },
      { id: 'bench-sw-3', x: 260, y: 1480, angle: -Math.PI / 2 },

      // Ladies Mile avenue teak benches
      { id: 'bench-lm-1', x: 480, y: 1840, angle: -0.55 },
      { id: 'bench-lm-2', x: 1590, y: 1160, angle: -0.55 },
      { id: 'bench-lm-3', x: 2550, y: 580, angle: -0.55 },

      // Water Tower clearing benches
      { id: 'bench-wt-1', x: 2320, y: 520, angle: 0 },
      { id: 'bench-wt-2', x: 2480, y: 400, angle: Math.PI },

      // Central meadow grove & south woodland trail benches
      { id: 'bench-cg-1', x: 1380, y: 860, angle: 0 },
      { id: 'bench-sw-wood', x: 1120, y: 1780, angle: 0.3 },
      { id: 'bench-nm-1', x: 1950, y: 420, angle: 0 }
    ];

    this.benches = benchPositions.map((b, idx) => ({
      id: b.id || `bench-${idx}`,
      x: b.x,
      y: b.y,
      w: 64,
      h: 26,
      angle: b.angle || 0,
      depthY: b.y + 13
    }));

    // 6. Mature Tree Arboretum & Scenery Zones
    // A. Ladies Mile Avenue: SW (400, 1900) to NE (2700, 500) lined with sweet chestnut and lime trees
    // B. South Zone: Clifton Down woodland dense oak groves (600-1600, 1600-2200)
    // C. North Zone: Durdham Down open grassland meadow fringe (1800-3000, 200-800)
    // D. West Zone: Sea Walls verge
    // E. Central & East meadows: specimen oaks and chestnuts
    const treePositions = [
      // --- Ladies Mile Avenue Tree Rows (Chestnut & Lime) ---
      // Row 1 (North-West side of avenue)
      { x: 509, y: 1768, r: 62, type: 'chestnut' },
      { x: 693, y: 1656, r: 60, type: 'lime' },
      { x: 877, y: 1544, r: 64, type: 'chestnut' },
      { x: 1061, y: 1432, r: 62, type: 'lime' },
      { x: 1245, y: 1320, r: 66, type: 'chestnut' },
      { x: 1429, y: 1208, r: 64, type: 'lime' },
      { x: 1613, y: 1096, r: 65, type: 'chestnut' },
      { x: 1797, y: 984, r: 63, type: 'lime' },
      { x: 1981, y: 872, r: 66, type: 'chestnut' },
      { x: 2165, y: 760, r: 62, type: 'lime' },
      { x: 2349, y: 648, r: 64, type: 'chestnut' },
      { x: 2533, y: 536, r: 60, type: 'lime' },

      // Row 2 (South-East side of avenue)
      { x: 567, y: 1864, r: 64, type: 'lime' },
      { x: 751, y: 1752, r: 62, type: 'chestnut' },
      { x: 935, y: 1640, r: 65, type: 'lime' },
      { x: 1119, y: 1528, r: 64, type: 'chestnut' },
      { x: 1303, y: 1416, r: 66, type: 'lime' },
      { x: 1487, y: 1304, r: 62, type: 'chestnut' },
      { x: 1671, y: 1192, r: 65, type: 'lime' },
      { x: 1855, y: 1080, r: 63, type: 'chestnut' },
      { x: 2039, y: 968, r: 66, type: 'lime' },
      { x: 2223, y: 856, r: 64, type: 'chestnut' },
      { x: 2407, y: 744, r: 62, type: 'lime' },
      { x: 2591, y: 632, r: 60, type: 'chestnut' },

      // --- South Zone: Clifton Down Woodland Oak Groves (x: 600-1600, y: 1600-2200) ---
      { x: 680, y: 1720, r: 76, type: 'oak' },
      { x: 820, y: 1820, r: 80, type: 'oak' },
      { x: 740, y: 2020, r: 72, type: 'chestnut' },
      { x: 920, y: 1940, r: 82, type: 'oak' },
      { x: 1050, y: 2120, r: 78, type: 'oak' },
      { x: 1180, y: 1980, r: 76, type: 'chestnut' },
      { x: 1340, y: 2160, r: 84, type: 'oak' },
      { x: 1460, y: 2040, r: 76, type: 'oak' },
      { x: 1580, y: 1880, r: 72, type: 'chestnut' },
      { x: 890, y: 2200, r: 75, type: 'oak' },
      { x: 1140, y: 1720, r: 70, type: 'oak' },
      { x: 1280, y: 1840, r: 78, type: 'chestnut' },
      { x: 1440, y: 1700, r: 72, type: 'oak' },
      { x: 990, y: 1640, r: 74, type: 'oak' },
      { x: 640, y: 1880, r: 70, type: 'oak' },
      { x: 1220, y: 2260, r: 78, type: 'oak' },
      { x: 1520, y: 2200, r: 74, type: 'chestnut' },

      // --- North Zone: Durdham Down Grasslands Fringe (x: 1800-3000, y: 200-800) ---
      { x: 1880, y: 320, r: 66, type: 'lime' },
      { x: 2150, y: 260, r: 70, type: 'chestnut' },
      { x: 2680, y: 310, r: 72, type: 'lime' },
      { x: 2980, y: 460, r: 74, type: 'oak' },
      { x: 2880, y: 740, r: 68, type: 'lime' },
      { x: 1980, y: 720, r: 66, type: 'oak' },

      // --- West Zone: Sea Walls Verge (x: 100-500, y: 800-1600) ---
      { x: 420, y: 880, r: 62, type: 'oak' },
      { x: 440, y: 1120, r: 66, type: 'chestnut' },
      { x: 400, y: 1360, r: 64, type: 'oak' },
      { x: 460, y: 1540, r: 68, type: 'lime' },
      { x: 340, y: 680, r: 58, type: 'oak' },

      // --- Central & Open Meadow Specimen Trees ---
      { x: 620, y: 420, r: 74, type: 'oak' },
      { x: 920, y: 350, r: 70, type: 'chestnut' },
      { x: 1280, y: 320, r: 72, type: 'oak' },
      { x: 1580, y: 400, r: 68, type: 'lime' },
      { x: 780, y: 820, r: 76, type: 'oak' },
      { x: 1080, y: 760, r: 72, type: 'chestnut' },
      { x: 1360, y: 880, r: 78, type: 'oak' },
      { x: 1720, y: 1040, r: 70, type: 'lime' },
      { x: 2120, y: 1180, r: 68, type: 'chestnut' },
      { x: 2480, y: 1350, r: 74, type: 'oak' },
      { x: 2780, y: 1220, r: 72, type: 'chestnut' },
      { x: 2940, y: 1650, r: 76, type: 'oak' },
      { x: 2600, y: 1920, r: 70, type: 'lime' },
      { x: 2200, y: 2050, r: 74, type: 'chestnut' },
      { x: 1850, y: 2150, r: 72, type: 'oak' }
    ];

    this.trees = treePositions.map((t, idx) => ({
      id: `tree-${idx}`,
      x: t.x,
      y: t.y,
      radius: t.r,
      type: t.type,
      trunkRadius: Math.round(t.r * 0.28),
      depthY: t.y + 10
    }));

    // 7. Wildflower Patches across Meadows & Woodland Margins
    const flowerTypes = ['buttercup', 'clover', 'bluebell', 'rock_cress'];
    for (let i = 0; i < 110; i++) {
      const cx = 120 + Math.random() * (this.width - 240);
      const cy = 120 + Math.random() * (this.height - 240);
      const count = 5 + Math.floor(Math.random() * 8);
      const type = flowerTypes[i % flowerTypes.length];
      for (let j = 0; j < count; j++) {
        this.wildflowers.push({
          x: cx + (Math.random() - 0.5) * 65,
          y: cy + (Math.random() - 0.5) * 65,
          type: type,
          size: 2.2 + Math.random() * 2.2
        });
      }
    }

    // 8. Victorian Cast-Iron Streetlamps (Network of 12 streetlamps across The Downs)
    const lampPositions = [
      // Along Cotswold avenue path / Ladies Mile
      { id: 'streetlamp-1', x: 700, y: 520 },
      { id: 'streetlamp-2', x: 1100, y: 560 },
      { id: 'streetlamp-3', x: 1600, y: 600 },
      { id: 'streetlamp-4', x: 2100, y: 580 },
      // Near Durdham Down Water Tower landmark
      { id: 'streetlamp-5', x: 2300, y: 480 },
      { id: 'streetlamp-6', x: 2520, y: 490 },
      // Along Sea Walls path
      { id: 'streetlamp-7', x: 280, y: 950 },
      { id: 'streetlamp-8', x: 290, y: 1350 },
      // Central & south park intersections / avenue crossings
      { id: 'streetlamp-9', x: 1200, y: 1100 },
      { id: 'streetlamp-10', x: 1800, y: 1250 },
      { id: 'streetlamp-11', x: 800, y: 1500 },
      { id: 'streetlamp-12', x: 2200, y: 1600 }
    ];

    this.streetlamps = lampPositions.map(l => ({
      id: l.id,
      x: l.x,
      y: l.y,
      radius: 8,           // Base collision/interaction radius
      glowRadius: 120,     // Radius for radial light halo in lighting pass
      intensity: 0.9,      // Light intensity
      color: '#fef08a',    // Warm amber-yellow incandescent glow
      depthY: l.y + 8,     // y + 8 for accurate 2D Y-sorting
      isLamp: true
    }));
  }

  initParticles() {
    this.ambientParticles = [];
    // Floating dandelion seeds / pollen swaying in the Downs breeze
    for (let i = 0; i < 80; i++) {
      this.ambientParticles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: 16 + Math.random() * 26,
        vy: 4 + Math.random() * 14,
        swaySpeed: 1 + Math.random() * 2,
        swayAmp: 1.5 + Math.random() * 2.2,
        radius: 1.2 + Math.random() * 1.5,
        alpha: 0.35 + Math.random() * 0.45
      });
    }
  }

  addTombstone(tombstone) {
    if (tombstone) {
      this.tombstones.push(tombstone);
    }
  }

  update(dt) {
    this.windTime += dt;

    // Update active tombstones and cull dead ones
    for (let i = this.tombstones.length - 1; i >= 0; i--) {
      const tomb = this.tombstones[i];
      if (typeof tomb.update === 'function') {
        tomb.update(dt);
      }
      if (tomb.isDead) {
        this.tombstones.splice(i, 1);
      }
    }

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

  // Check collision for circle entity (Owner, Companion Dog, Tennis Ball, etc.)
  resolveCircleCollision(x, y, radius) {
    let nx = x;
    let ny = y;

    // 1. World Perimeter bounds clamping
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

      if (dist < minDist) {
        if (dist > 0.001) {
          const overlap = minDist - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += minDist;
        }
      }
    }

    // 3. Wooden bench collisions (oriented AABB vs circle)
    for (const bench of this.benches) {
      const isVertical = bench.angle && Math.abs(Math.sin(bench.angle)) > 0.7;
      const halfW = (isVertical ? bench.h : bench.w) / 2;
      const halfH = (isVertical ? bench.w : bench.h) / 2;
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

    // 4. Public dog-waste bin collisions
    for (const bin of this.bins) {
      const dx = nx - bin.x;
      const dy = ny - bin.y;
      const dist = Math.hypot(dx, dy);
      const minDist = radius + bin.radius;

      if (dist < minDist) {
        if (dist > 0.001) {
          const overlap = minDist - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += minDist;
        }
      }
    }

    // 5. Landmark collisions: Water Tower pavilion
    if (this.waterTower) {
      const dx = nx - this.waterTower.x;
      const dy = ny - this.waterTower.y;
      const dist = Math.hypot(dx, dy);
      const minDist = radius + this.waterTower.radius;

      if (dist < minDist) {
        if (dist > 0.001) {
          const overlap = minDist - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += minDist;
        }
      }
    }

    // 6. Sea Walls limestone rock outcrops
    for (const rock of this.rockOutcrops) {
      const dx = nx - rock.x;
      const dy = ny - (rock.depthY - 8);
      const dist = Math.hypot(dx, dy);
      const minDist = radius + (rock.r || 24);

      if (dist < minDist) {
        if (dist > 0.001) {
          const overlap = minDist - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += minDist;
        }
      }
    }

    return { x: nx, y: ny };
  }

  // Depth-Sorted (Y-sort) Render Pipeline
  render(ctx, camera, dynamicEntities = []) {
    const viewLeft = camera.x;
    const viewTop = camera.y;
    const viewRight = camera.x + camera.viewportWidth;
    const viewBottom = camera.y + camera.viewportHeight;

    // 1. Procedural Background Turf & Pathways
    this.renderGround(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 2. Gather Scenery and Dynamic Entities for Depth-Sorted Pass
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

    // Add dog-waste bins
    for (const bin of this.bins) {
      if (
        bin.x + bin.radius + 15 > viewLeft &&
        bin.x - bin.radius - 15 < viewRight &&
        bin.y + bin.radius + 25 > viewTop &&
        bin.y - bin.radius - 35 < viewBottom
      ) {
        renderList.push({
          type: 'bin',
          y: bin.depthY,
          data: bin
        });
      }
    }

    // Add Water Tower landmark
    if (this.waterTower) {
      const wt = this.waterTower;
      if (
        wt.x + wt.radius + 40 > viewLeft &&
        wt.x - wt.radius - 40 < viewRight &&
        wt.y + wt.radius + 60 > viewTop &&
        wt.y - wt.radius - 60 < viewBottom
      ) {
        renderList.push({
          type: 'water_tower',
          y: wt.depthY,
          data: wt
        });
      }
    }

    // Add rocky limestone outcrops
    for (const rock of this.rockOutcrops) {
      if (
        rock.x + rock.w > viewLeft &&
        rock.x - rock.w < viewRight &&
        rock.y + rock.h > viewTop &&
        rock.y - rock.h < viewBottom
      ) {
        renderList.push({
          type: 'rock',
          y: rock.depthY,
          data: rock
        });
      }
    }

    // Add Victorian streetlamps
    for (const lamp of this.streetlamps) {
      if (
        lamp.x + 30 > viewLeft &&
        lamp.x - 30 < viewRight &&
        lamp.y + 20 > viewTop &&
        lamp.y - 70 < viewBottom
      ) {
        renderList.push({
          type: 'streetlamp',
          y: lamp.depthY,
          data: lamp
        });
      }
    }

    // Add active tombstones
    const renderedEntities = new Set(dynamicEntities);
    for (const tomb of this.tombstones) {
      if (renderedEntities.has(tomb)) continue;
      if (
        tomb.x + 50 > viewLeft &&
        tomb.x - 50 < viewRight &&
        tomb.y + 50 > viewTop &&
        tomb.y - 50 < viewBottom
      ) {
        renderList.push({
          type: 'entity',
          y: tomb.depthY !== undefined ? tomb.depthY : tomb.y + 8,
          data: tomb
        });
      }
    }

    // Add dynamic entities (Owner, Companion Dogs, Tennis Balls, etc.)
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
      } else if (item.type === 'bin') {
        this.renderBin(ctx, item.data);
      } else if (item.type === 'water_tower') {
        this.renderWaterTower(ctx, item.data);
      } else if (item.type === 'rock') {
        this.renderRock(ctx, item.data);
      } else if (item.type === 'streetlamp') {
        this.renderStreetlamp(ctx, item.data);
      } else if (item.type === 'entity') {
        item.data.draw(ctx);
      }
    }

    // 4. Overpass Tree Canopies (Subtle transparent foliage sun glints)
    this.renderCanopyHighlights(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 5. Ambient Dandelion / Pollen Particles
    this.renderParticles(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 6. Perimeter Boundary Walls
    this.renderPerimeterWalls(ctx);
  }

  renderGround(ctx, left, top, right, bottom) {
    // 1. Fill base turf
    ctx.fillStyle = this.grassBase;
    ctx.fillRect(left, top, right - left, bottom - top);

    // 2. Avon Gorge Cliff Edge Backdrop (beyond West perimeter wall)
    if (left < 100) {
      const cliffGrad = ctx.createLinearGradient(0, top, 80, top);
      cliffGrad.addColorStop(0, '#1a2332');
      cliffGrad.addColorStop(0.5, '#2e3d4f');
      cliffGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = cliffGrad;
      ctx.fillRect(0, top, 80, bottom - top);
    }

    // 3. Durdham Down Meadow Mown Stripes (x: 1800-3050, y: 200-850)
    ctx.save();
    const stripeAngle = -0.22;
    const mownLeft = Math.max(left, 1750);
    const mownRight = Math.min(right, 3050);
    const mownTop = Math.max(top, 180);
    const mownBottom = Math.min(bottom, 880);

    if (mownRight > mownLeft && mownBottom > mownTop) {
      ctx.beginPath();
      ctx.rect(mownLeft, mownTop, mownRight - mownLeft, mownBottom - mownTop);
      ctx.clip();

      const stripeWidth = 44;
      for (let sx = mownLeft - 200; sx < mownRight + 200; sx += stripeWidth * 2) {
        ctx.fillStyle = 'rgba(76, 130, 55, 0.14)';
        ctx.beginPath();
        ctx.moveTo(sx, mownTop);
        ctx.lineTo(sx + Math.tan(stripeAngle) * (mownBottom - mownTop) + stripeWidth, mownTop);
        ctx.lineTo(sx + Math.tan(stripeAngle) * (mownBottom - mownTop), mownBottom);
        ctx.lineTo(sx - stripeWidth, mownBottom);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // 4. Rich Procedural Grass Variations & Subtle Blade Flecks
    ctx.save();
    const patchSize = 80;
    const startX = Math.floor(left / patchSize) * patchSize;
    const startY = Math.floor(top / patchSize) * patchSize;

    for (let x = startX; x <= right; x += patchSize) {
      for (let y = startY; y <= bottom; y += patchSize) {
        const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const noise = hash - Math.floor(hash);

        if (noise > 0.62) {
          ctx.fillStyle = this.grassLight;
          ctx.beginPath();
          ctx.ellipse(x + 40, y + 40, 26, 18, 0, 0, Math.PI * 2);
          ctx.fill();

          // Subtle grass blade flecks
          ctx.strokeStyle = '#5da347';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x + 36, y + 44);
          ctx.lineTo(x + 34, y + 38);
          ctx.moveTo(x + 40, y + 45);
          ctx.lineTo(x + 42, y + 37);
          ctx.stroke();
        } else if (noise < 0.28) {
          ctx.fillStyle = this.grassDark;
          ctx.beginPath();
          ctx.ellipse(x + 40, y + 40, 22, 15, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // 5. Pathways & Avenues
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // A. Central Boulevard: Ladies Mile Avenue (Broad diagonal gravel avenue, width ~54px)
    // Southwest (400, 1900) to Northeast (2700, 500)
    // Soft grass edging
    ctx.strokeStyle = 'rgba(68, 115, 51, 0.45)';
    ctx.lineWidth = 64;
    ctx.beginPath();
    ctx.moveTo(400, 1900);
    ctx.bezierCurveTo(1150, 1450, 1950, 950, 2700, 500);
    ctx.stroke();

    // Cotswold gravel bed
    ctx.strokeStyle = this.pathColor;
    ctx.lineWidth = 54;
    ctx.beginPath();
    ctx.moveTo(400, 1900);
    ctx.bezierCurveTo(1150, 1450, 1950, 950, 2700, 500);
    ctx.stroke();

    // Fine inner gravel walking track
    ctx.strokeStyle = this.pathDetail;
    ctx.lineWidth = 36;
    ctx.beginPath();
    ctx.moveTo(400, 1900);
    ctx.bezierCurveTo(1150, 1450, 1950, 950, 2700, 500);
    ctx.stroke();

    // B. Water Tower Landmark Clearing Plaza (x: 2400, y: 450)
    ctx.fillStyle = 'rgba(72, 118, 55, 0.4)';
    ctx.beginPath();
    ctx.arc(2400, 450, 74, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.pathColor;
    ctx.beginPath();
    ctx.arc(2400, 450, 66, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.pathDetail;
    ctx.beginPath();
    ctx.arc(2400, 450, 54, 0, Math.PI * 2);
    ctx.fill();

    // Spur from Ladies Mile junction (2500, 620) to Water Tower (2400, 450)
    ctx.strokeStyle = this.pathColor;
    ctx.lineWidth = 38;
    ctx.beginPath();
    ctx.moveTo(2500, 620);
    ctx.lineTo(2400, 450);
    ctx.stroke();

    // C. Secondary Woodland Dirt Trails (width ~30px) linking to Ladies Mile
    // Trail 1: South woodland trail connecting to Ladies Mile SW entry (520, 1850)
    ctx.strokeStyle = this.dirtPathEdge;
    ctx.lineWidth = 34;
    ctx.beginPath();
    ctx.moveTo(760, 2240);
    ctx.bezierCurveTo(680, 2080, 560, 1950, 520, 1850);
    ctx.stroke();

    ctx.strokeStyle = this.dirtPathColor;
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(760, 2240);
    ctx.bezierCurveTo(680, 2080, 560, 1950, 520, 1850);
    ctx.stroke();

    // Trail 2: South woodland trail winding through junction (1080, 1750) to Ladies Mile midpoint (1550, 1200)
    ctx.strokeStyle = this.dirtPathEdge;
    ctx.lineWidth = 34;
    ctx.beginPath();
    ctx.moveTo(1350, 2200);
    ctx.bezierCurveTo(1240, 1980, 1120, 1820, 1080, 1750);
    ctx.bezierCurveTo(1040, 1620, 1380, 1400, 1550, 1200);
    ctx.stroke();

    ctx.strokeStyle = this.dirtPathColor;
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(1350, 2200);
    ctx.bezierCurveTo(1240, 1980, 1120, 1820, 1080, 1750);
    ctx.bezierCurveTo(1040, 1620, 1380, 1400, 1550, 1200);
    ctx.stroke();

    // Trail 3: Cross-meadow trail linking Ladies Mile midpoint (1550, 1200) to Sea Walls lookout (280, 1200)
    ctx.strokeStyle = this.dirtPathEdge;
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(1550, 1200);
    ctx.bezierCurveTo(1150, 1220, 680, 1180, 280, 1200);
    ctx.stroke();

    ctx.strokeStyle = this.dirtPathColor;
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(1550, 1200);
    ctx.bezierCurveTo(1150, 1220, 680, 1180, 280, 1200);
    ctx.stroke();

    // Trail 4: Sea Walls panoramic cliff-top trail (north-south along x: 280)
    ctx.strokeStyle = this.pathColor;
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(280, 780);
    ctx.bezierCurveTo(260, 1050, 270, 1350, 320, 1550);
    ctx.stroke();

    // Trail 5: Trail branch to central meadow grove (1420, 820)
    ctx.strokeStyle = this.dirtPathColor;
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(1797, 984);
    ctx.bezierCurveTo(1620, 920, 1520, 850, 1420, 820);
    ctx.stroke();

    ctx.restore();

    // 6. Render Wildflowers
    ctx.save();
    for (const f of this.wildflowers) {
      if (f.x >= left && f.x <= right && f.y >= top && f.y <= bottom) {
        if (f.type === 'buttercup') {
          ctx.fillStyle = '#f3c948';
        } else if (f.type === 'clover') {
          ctx.fillStyle = '#f8fafc';
        } else if (f.type === 'bluebell') {
          ctx.fillStyle = '#6b8be8';
        } else {
          ctx.fillStyle = '#e879a8';
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Render mature tree with layered leafy canopies, distinct species hues, and soft ground shadows
  renderTree(ctx, tree) {
    ctx.save();

    // 1. Soft Ground Shadow
    ctx.fillStyle = 'rgba(22, 42, 16, 0.35)';
    ctx.beginPath();
    ctx.ellipse(tree.x + 8, tree.depthY + 6, tree.radius * 0.92, tree.radius * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Trunk with textured bark details
    ctx.fillStyle = '#3a2114';
    ctx.beginPath();
    ctx.ellipse(tree.x, tree.depthY, tree.trunkRadius, tree.trunkRadius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4e2d1c';
    ctx.fillRect(tree.x - tree.trunkRadius * 0.75, tree.y - 12, tree.trunkRadius * 1.5, tree.depthY - (tree.y - 12));

    // Vertical bark ridges
    ctx.fillStyle = '#2d180c';
    ctx.fillRect(tree.x - 2, tree.y, 4, tree.depthY - tree.y);

    // 3. Species-Specific Canopy Hues
    let baseColor = '#25481d';
    let midColor = '#34652a';
    let lightColor = '#478239';

    if (tree.type === 'chestnut') {
      baseColor = '#2e4a1a';
      midColor = '#426b26';
      lightColor = '#598c36';
    } else if (tree.type === 'lime') {
      baseColor = '#2f581e';
      midColor = '#467b2d';
      lightColor = '#63a03f';
    }

    // Base dark canopy
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
    ctx.fill();

    // Mid puff foliage clusters
    ctx.fillStyle = midColor;
    const puffs = [
      { dx: -tree.radius * 0.45, dy: -tree.radius * 0.22, r: tree.radius * 0.55 },
      { dx: tree.radius * 0.42, dy: -tree.radius * 0.26, r: tree.radius * 0.52 },
      { dx: 0, dy: -tree.radius * 0.42, r: tree.radius * 0.5 },
      { dx: -tree.radius * 0.28, dy: tree.radius * 0.24, r: tree.radius * 0.46 },
      { dx: tree.radius * 0.32, dy: tree.radius * 0.22, r: tree.radius * 0.48 }
    ];
    for (const p of puffs) {
      ctx.beginPath();
      ctx.arc(tree.x + p.dx, tree.y + p.dy, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Top sunlight highlights
    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.arc(tree.x - tree.radius * 0.18, tree.y - tree.radius * 0.28, tree.radius * 0.44, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Render wooden park bench with orientation support
  renderBench(ctx, bench) {
    ctx.save();
    ctx.translate(bench.x, bench.y);
    if (bench.angle) {
      ctx.rotate(bench.angle);
    }

    // Drop shadow
    ctx.fillStyle = 'rgba(22, 42, 16, 0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 12, bench.w / 2 + 4, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    const halfW = bench.w / 2;
    const halfH = bench.h / 2;

    // Cast iron frame legs
    ctx.fillStyle = '#2d3748';
    ctx.fillRect(-halfW + 6, -halfH + 4, 6, bench.h);
    ctx.fillRect(halfW - 12, -halfH + 4, 6, bench.h);

    // Warm teak wood slats
    ctx.fillStyle = '#8f562b';
    ctx.fillRect(-halfW, -halfH + 4, bench.w, 7);
    ctx.fillStyle = '#a66735';
    ctx.fillRect(-halfW, -halfH + 13, bench.w, 8);

    // Subtle slat divider lines
    ctx.strokeStyle = '#5a3418';
    ctx.lineWidth = 1;
    ctx.strokeRect(-halfW, -halfH + 4, bench.w, 7);
    ctx.strokeRect(-halfW, -halfH + 13, bench.w, 8);

    ctx.restore();
  }

  // Render authentic public dog-waste bin (dark green cylinder, red canister band, white paw decal)
  renderBin(ctx, bin) {
    ctx.save();

    // 1. Soft Drop Shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.38)';
    ctx.beginPath();
    ctx.ellipse(bin.x, bin.depthY, bin.radius * 1.15, bin.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Mounting bracket post
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(bin.x - 2, bin.depthY - 26, 4, 26);

    // 3. Dark Green Cylinder Body (#1b4332)
    const bodyW = bin.radius * 2;
    const bodyTop = bin.depthY - 24;

    ctx.fillStyle = '#1b4332';
    // Rounded bottom curve of cylinder
    ctx.beginPath();
    ctx.ellipse(bin.x, bin.depthY - 4, bin.radius, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main cylinder body
    ctx.fillRect(bin.x - bin.radius, bodyTop, bodyW, 20);

    // Cylindrical subtle highlight / shade
    const grad = ctx.createLinearGradient(bin.x - bin.radius, bodyTop, bin.x + bin.radius, bodyTop);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.16)');
    grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.08)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(bin.x - bin.radius, bodyTop, bodyW, 20);

    // 4. Red Canister Band (#b91c1c)
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(bin.x - bin.radius, bin.depthY - 17, bodyW, 7);

    // 5. White Paw / Dog Decal on red band
    ctx.fillStyle = '#ffffff';
    // Main paw pad
    ctx.beginPath();
    ctx.ellipse(bin.x, bin.depthY - 13.5, 2.4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 3 small toe pads
    ctx.beginPath();
    ctx.arc(bin.x - 2.5, bin.depthY - 16, 0.9, 0, Math.PI * 2);
    ctx.arc(bin.x, bin.depthY - 16.5, 0.9, 0, Math.PI * 2);
    ctx.arc(bin.x + 2.5, bin.depthY - 16, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // 6. Top Hood / Lid
    ctx.fillStyle = '#143124';
    ctx.beginPath();
    ctx.ellipse(bin.x, bodyTop, bin.radius, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 7. Dark Top Slot
    ctx.fillStyle = '#09130e';
    ctx.beginPath();
    ctx.ellipse(bin.x, bodyTop - 1, bin.radius * 0.65, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Render Victorian Stone Water Tower landmark pavilion
  renderWaterTower(ctx, wt) {
    ctx.save();

    // 1. Soft Ground Shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.35)';
    ctx.beginPath();
    ctx.ellipse(wt.x + 12, wt.depthY + 6, wt.radius * 1.3, wt.radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Base Stone Plinth & Flagstone Terrace
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.ellipse(wt.x, wt.depthY, wt.radius * 1.15, wt.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Victorian Masonry Stone Cylinder Tower
    const towerH = 58;
    const towerTop = wt.depthY - towerH;

    const stoneGrad = ctx.createLinearGradient(wt.x - wt.radius, towerTop, wt.x + wt.radius, towerTop);
    stoneGrad.addColorStop(0, '#475569');
    stoneGrad.addColorStop(0.35, '#94a3b8');
    stoneGrad.addColorStop(0.7, '#64748b');
    stoneGrad.addColorStop(1, '#334155');

    ctx.fillStyle = stoneGrad;
    ctx.fillRect(wt.x - wt.radius, towerTop, wt.radius * 2, towerH);

    // Stone base curve
    ctx.beginPath();
    ctx.ellipse(wt.x, wt.depthY, wt.radius, wt.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // 4. Arched Victorian Windows
    const windowY = wt.depthY - 32;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.ellipse(wt.x - 18, windowY, 5, 9, 0, 0, Math.PI * 2);
    ctx.ellipse(wt.x + 18, windowY, 5, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Window lintels
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(wt.x - 18, windowY - 4, 6, Math.PI, 0);
    ctx.arc(wt.x + 18, windowY - 4, 6, Math.PI, 0);
    ctx.stroke();

    // 5. Decorative Stone Corbel Ring & Cornice
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(wt.x - wt.radius - 4, towerTop - 4, (wt.radius + 4) * 2, 6);

    ctx.fillStyle = '#334155';
    // Corbel brackets
    for (let bx = wt.x - wt.radius; bx <= wt.x + wt.radius; bx += 10) {
      ctx.fillRect(bx, towerTop + 2, 4, 5);
    }

    // 6. Conical Slate / Patina Roof Ring with Decorative Finial
    const roofH = 34;
    const roofTop = towerTop - roofH;

    const roofGrad = ctx.createLinearGradient(wt.x - wt.radius, roofTop, wt.x + wt.radius, towerTop);
    roofGrad.addColorStop(0, '#2e4a42');
    roofGrad.addColorStop(0.4, '#477a6e');
    roofGrad.addColorStop(1, '#1b302a');

    ctx.fillStyle = roofGrad;
    ctx.beginPath();
    ctx.moveTo(wt.x, roofTop);
    ctx.lineTo(wt.x - wt.radius - 6, towerTop);
    ctx.lineTo(wt.x + wt.radius + 6, towerTop);
    ctx.closePath();
    ctx.fill();

    // Decorative roof ring
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(wt.x, towerTop - 12, wt.radius * 0.6, 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Decorative brass finial sphere
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(wt.x, roofTop - 3, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Render rocky limestone outcrop along Sea Walls overlook
  renderRock(ctx, rock) {
    ctx.save();

    // Ground shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.35)';
    ctx.beginPath();
    ctx.ellipse(rock.x, rock.depthY, rock.w / 2 + 4, rock.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Weathered Bristol limestone crag
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(rock.x - rock.w / 2, rock.depthY - 4);
    ctx.lineTo(rock.x - rock.w * 0.3, rock.depthY - rock.h);
    ctx.lineTo(rock.x + rock.w * 0.2, rock.depthY - rock.h + 2);
    ctx.lineTo(rock.x + rock.w / 2, rock.depthY - 6);
    ctx.lineTo(rock.x + rock.w * 0.3, rock.depthY + 4);
    ctx.closePath();
    ctx.fill();

    // Sunlight facet
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(rock.x - rock.w * 0.3, rock.depthY - rock.h);
    ctx.lineTo(rock.x + rock.w * 0.1, rock.depthY - rock.h + 2);
    ctx.lineTo(rock.x, rock.depthY - rock.h * 0.4);
    ctx.lineTo(rock.x - rock.w * 0.35, rock.depthY - rock.h * 0.3);
    ctx.closePath();
    ctx.fill();

    // Moss / Lichen spots
    ctx.fillStyle = '#556b3e';
    ctx.beginPath();
    ctx.arc(rock.x - 8, rock.depthY - 12, 3.5, 0, Math.PI * 2);
    ctx.arc(rock.x + 10, rock.depthY - 10, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Render authentic Victorian cast-iron park streetlamp
  renderStreetlamp(ctx, lamp) {
    ctx.save();

    // 1. Elliptical base ground shadow (rgba(0, 0, 0, 0.25))
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(lamp.x + 3, lamp.depthY, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Cast-iron post: flared base and decorative plinth (#1e293b / #262626)
    ctx.fillStyle = '#1e293b';
    // Flared tiered base
    ctx.beginPath();
    ctx.moveTo(lamp.x - 7, lamp.depthY);
    ctx.lineTo(lamp.x - 5, lamp.depthY - 5);
    ctx.lineTo(lamp.x - 3, lamp.depthY - 10);
    ctx.lineTo(lamp.x + 3, lamp.depthY - 10);
    ctx.lineTo(lamp.x + 5, lamp.depthY - 5);
    ctx.lineTo(lamp.x + 7, lamp.depthY);
    ctx.closePath();
    ctx.fill();

    // Base collar ring
    ctx.fillStyle = '#262626';
    ctx.fillRect(lamp.x - 4, lamp.depthY - 12, 8, 2.5);

    // Tapered vertical shaft (from y - 12 up to lantern base y - 44)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(lamp.x - 2.5, lamp.depthY - 12);
    ctx.lineTo(lamp.x - 2, lamp.depthY - 44);
    ctx.lineTo(lamp.x + 2, lamp.depthY - 44);
    ctx.lineTo(lamp.x + 2.5, lamp.depthY - 12);
    ctx.closePath();
    ctx.fill();

    // Shaft middle decorative ring
    ctx.fillStyle = '#262626';
    ctx.fillRect(lamp.x - 3.5, lamp.depthY - 28, 7, 2);

    // 3. Decorative ladder bar crossarm (Victorian lamplighter ladder rest)
    ctx.fillStyle = '#262626';
    ctx.fillRect(lamp.x - 9, lamp.depthY - 40, 18, 2);
    // Ladder bar end finial knobs
    ctx.beginPath();
    ctx.arc(lamp.x - 9, lamp.depthY - 39, 1.5, 0, Math.PI * 2);
    ctx.arc(lamp.x + 9, lamp.depthY - 39, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 4. Lantern cradle / base bracket
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(lamp.x - 4, lamp.depthY - 44);
    ctx.lineTo(lamp.x - 6.5, lamp.depthY - 47);
    ctx.lineTo(lamp.x + 6.5, lamp.depthY - 47);
    ctx.lineTo(lamp.x + 4, lamp.depthY - 44);
    ctx.closePath();
    ctx.fill();

    // 5. Four-pane glass lantern casing with black iron framing
    const lanternBottomY = lamp.depthY - 47;
    const lanternTopY = lamp.depthY - 58;
    const lanternHalfWBottom = 6;
    const lanternHalfWTop = 7.5;

    // Glass chamber fill (subtle warm glow background)
    ctx.fillStyle = 'rgba(254, 240, 138, 0.45)';
    ctx.beginPath();
    ctx.moveTo(lamp.x - lanternHalfWBottom, lanternBottomY);
    ctx.lineTo(lamp.x - lanternHalfWTop, lanternTopY);
    ctx.lineTo(lamp.x + lanternHalfWTop, lanternTopY);
    ctx.lineTo(lamp.x + lanternHalfWBottom, lanternBottomY);
    ctx.closePath();
    ctx.fill();

    // 6. Warm luminous lantern glow core inside glass chamber
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(lamp.x, (lanternBottomY + lanternTopY) / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(lamp.x, (lanternBottomY + lanternTopY) / 2, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Lantern glass panes black iron frame & vertical divider
    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(lamp.x - lanternHalfWBottom, lanternBottomY);
    ctx.lineTo(lamp.x - lanternHalfWTop, lanternTopY);
    ctx.lineTo(lamp.x + lanternHalfWTop, lanternTopY);
    ctx.lineTo(lamp.x + lanternHalfWBottom, lanternBottomY);
    ctx.closePath();
    ctx.stroke();

    // Center vertical pane strut
    ctx.beginPath();
    ctx.moveTo(lamp.x, lanternBottomY);
    ctx.lineTo(lamp.x, lanternTopY);
    ctx.stroke();

    // 7. Victorian Lantern Cap / Hood and pointed top finial
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(lamp.x - lanternHalfWTop - 1.5, lanternTopY);
    ctx.lineTo(lamp.x, lanternTopY - 5);
    ctx.lineTo(lamp.x + lanternHalfWTop + 1.5, lanternTopY);
    ctx.closePath();
    ctx.fill();

    // Pointed top finial spire
    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lamp.x, lanternTopY - 5);
    ctx.lineTo(lamp.x, lanternTopY - 9);
    ctx.stroke();

    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(lamp.x, lanternTopY - 7, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Provider method returning all active illumination emitters for environment lighting pass
  getLightSources() {
    const sources = [];

    // 1. All registered streetlamps
    if (this.streetlamps && Array.isArray(this.streetlamps)) {
      for (const lamp of this.streetlamps) {
        sources.push({
          id: lamp.id,
          x: lamp.x,
          y: lamp.y,
          radius: lamp.radius,
          glowRadius: lamp.glowRadius,
          intensity: lamp.intensity,
          color: lamp.color
        });
      }
    }

    // 2. Landmark beacon for Durdham Down Water Tower
    if (this.waterTower) {
      sources.push({
        id: 'water-tower-beacon',
        x: this.waterTower.x,
        y: this.waterTower.y - 20,
        radius: 36,
        glowRadius: 150,
        intensity: 0.85,
        color: '#fef3c7'
      });
    }

    return sources;
  }

  renderCanopyHighlights(ctx, left, top, right, bottom) {
    // Subtle golden hour sun-glint across the top leaves
    ctx.save();
    ctx.fillStyle = 'rgba(243, 201, 72, 0.09)';
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

    for (const b of this.boundaries) {
      if (b.type === 'seawall') {
        // West: Dramatic "Sea Walls" cliff edge perimeter wall with iron railings overlooking Avon Gorge
        // 1. Heavy stone parapet base
        ctx.fillStyle = '#475569';
        ctx.fillRect(b.x, b.y, b.w, b.h);

        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);

        // Stone cap slab
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(b.x + b.w - 6, b.y, 6, b.h);

        // 2. Iron railings overlooking the Avon Gorge
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;

        // Horizontal iron top rail
        ctx.beginPath();
        ctx.moveTo(b.x + 8, b.y);
        ctx.lineTo(b.x + 8, b.y + b.h);
        ctx.stroke();

        // Vertical railing pickets every 12px
        for (let ry = b.y + 6; ry < b.y + b.h - 6; ry += 12) {
          ctx.beginPath();
          ctx.moveTo(b.x + 2, ry);
          ctx.lineTo(b.x + 14, ry);
          ctx.stroke();

          // Spearhead finial
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(b.x + 8, ry, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Traditional Pennant stone boundary wall (North, East, South)
        ctx.fillStyle = '#4a5568';
        ctx.fillRect(b.x, b.y, b.w, b.h);

        ctx.strokeStyle = '#2d3748';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x, b.y, b.w, b.h);

        // Stone cap texture highlights
        ctx.fillStyle = '#718096';
        if (b.w > b.h) {
          ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, 3);
        } else {
          ctx.fillRect(b.x + 2, b.y + 2, 3, b.h - 4);
        }
      }
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
