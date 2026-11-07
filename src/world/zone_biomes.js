/**
 * Modular multi-biome scenery generation and rendering.
 *
 * Provides deterministic scenery layout, ground baking, and landmark visuals
 * for the 'woodland' and 'coastal' biomes. Falls back to the parkland
 * scenery defined by `field.initScenery()` for any other biome.
 */

const WOODLAND_CLEARING = { x: 1550, y: 1100, radius: 40 };

// Warp gates and arrival targets that scenery must keep clear of.
const WOODLAND_KEEPOUT = [
  { x: 3090, y: 1200 },
  { x: 110, y: 1900 },
  { x: 3000, y: 1200 },
  { x: 220, y: 1900 },
];

const COASTAL_KEEPOUT = [
  { x: 1600, y: 110 },
  { x: 110, y: 1200 },
  { x: 1600, y: 200 },
  { x: 220, y: 1200 },
];

const DOWNS_KEEPOUT = [
  { x: 110, y: 1200 },
  { x: 1600, y: 2290 },
  { x: 220, y: 1200 },
  { x: 1600, y: 2180 },
];

const KEEPOUT_RADIUS = 80;

/**
 * Deterministic pseudo-random generator (mulberry32) so scenery layout is
 * stable across reloads.
 */
function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = (z ^ (z >>> 15)) * (z | 1);
    z ^= z + (z ^ (z >>> 7)) * (z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function isClearOfKeepouts(x, y, keepouts, radius = KEEPOUT_RADIUS) {
  for (const k of keepouts) {
    if (dist2(x, y, k.x, k.y) < radius * radius) return false;
  }
  return true;
}

function isInsideClearing(x, y) {
  return (
    x >= WOODLAND_CLEARING.x - 100 &&
    x <= WOODLAND_CLEARING.x + 100 &&
    y >= WOODLAND_CLEARING.y - 100 &&
    y <= WOODLAND_CLEARING.y + 100
  );
}

/**
 * Initialise biome-specific scenery on the given field.
 *
 * @param {object} field - The Field instance to mutate.
 * @param {string} biome - 'woodland' | 'coastal' | 'parkland'
 */
export function initBiomeScenery(field, biome) {
  if (!field) return;

  if (biome === 'woodland') {
    initWoodlandScenery(field);
    return;
  }

  if (biome === 'coastal') {
    initCoastalScenery(field);
    return;
  }

  // Default / parkland: restore the original park scenery.
  if (typeof field.initScenery === 'function') {
    field.initScenery();
  }
  // Ensure biome landmarks do not leak back into parkland.
  field.landmarks = field.waterTower ? [field.waterTower] : [];
}

function initWoodlandScenery(field) {
  field.grassBase = '#2b4c20';
  field.grassDark = '#223d19';
  field.grassLight = '#3a662c';
  field.grassMown = '#2f5223';

  field.pathColor = '#785c42';
  field.pathEdge = '#594431';
  field.pathDetail = '#8e6f51';
  field.dirtPathColor = '#594431';
  field.dirtPathEdge = '#3e2e21';

  field.trees = [];
  field.benches = [];
  field.bins = [];
  field.waterTower = null;
  field.rockOutcrops = [];
  field.landmarks = [];
  field.sticks = [];

  if (isClearOfKeepouts(WOODLAND_CLEARING.x, WOODLAND_CLEARING.y, WOODLAND_KEEPOUT, 80)) {
    field.landmarks.push({
      id: 'woodland-clearing',
      name: 'Ancient Woodland Clearing',
      x: WOODLAND_CLEARING.x,
      y: WOODLAND_CLEARING.y,
      radius: 40,
      depthY: 1120,
      isLandmark: true,
    });
  }

  const rng = makeRng(0x5eed1234);
  const width = field.width || 3200;
  const height = field.height || 2400;
  const margin = 120;

  // 28 ancient oak/beech trees.
  let placed = 0;
  let attempts = 0;
  while (placed < 28 && attempts < 2000) {
    attempts += 1;
    const x = margin + rng() * (width - margin * 2);
    const y = margin + rng() * (height - margin * 2);
    if (isInsideClearing(x, y)) continue;
    if (!isClearOfKeepouts(x, y, WOODLAND_KEEPOUT, 80)) continue;
    // Avoid overlapping other trees.
    let tooClose = false;
    for (const t of field.trees) {
      if (dist2(x, y, t.x, t.y) < 90 * 90) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const variant = rng() < 0.5 ? 'oak' : 'beech';
    field.trees.push({
      id: `tree-woodland-${placed}`,
      x,
      y,
      radius: 26 + rng() * 10,
      variant,
      isAncient: true,
    });
    placed += 1;
  }

  // 4 woodland benches along trails.
  const benchSpots = [
    { x: 700, y: 700 },
    { x: 2400, y: 800 },
    { x: 900, y: 1700 },
    { x: 2500, y: 1800 },
  ];
  benchSpots.forEach((spot, i) => {
    if (!isClearOfKeepouts(spot.x, spot.y, WOODLAND_KEEPOUT, 80)) return;
    field.benches.push({
      id: `bench-woodland-${i}`,
      x: spot.x,
      y: spot.y,
      angle: 0,
      variant: 'woodland',
    });
  });

  // 4 dog-waste bins.
  const binSpots = [
    { x: 500, y: 500 },
    { x: 2700, y: 600 },
    { x: 600, y: 2000 },
    { x: 2700, y: 2000 },
  ];
  binSpots.forEach((spot, i) => {
    if (!isClearOfKeepouts(spot.x, spot.y, WOODLAND_KEEPOUT, 80)) return;
    field.bins.push({
      id: `bin-woodland-${i}`,
      x: spot.x,
      y: spot.y,
    });
  });

  // 6 mossy rock outcrops.
  const rockSpots = [
    { x: 400, y: 900 },
    { x: 2800, y: 1000 },
    { x: 1200, y: 400 },
    { x: 2000, y: 400 },
    { x: 1200, y: 2100 },
    { x: 2000, y: 2100 },
  ];
  rockSpots.forEach((spot, i) => {
    if (!isClearOfKeepouts(spot.x, spot.y, WOODLAND_KEEPOUT, 80)) return;
    field.rockOutcrops.push({
      id: `rock-woodland-${i}`,
      x: spot.x,
      y: spot.y,
      radius: 22 + (i % 3) * 6,
      mossy: true,
    });
  });

  // 14+ fallen woodland sticks.
  let stickCount = 0;
  let stickAttempts = 0;
  while (stickCount < 16 && stickAttempts < 500) {
    stickAttempts += 1;
    const x = margin + rng() * (width - margin * 2);
    const y = margin + rng() * (height - margin * 2);
    if (!isClearOfKeepouts(x, y, WOODLAND_KEEPOUT, 80)) continue;
    field.sticks.push({
      id: `stick-woodland-${stickCount}`,
      x,
      y,
      angle: rng() * Math.PI * 2,
      length: 32,
      radius: 10,
      isStick: true,
    });
    stickCount += 1;
  }
}

function initCoastalScenery(field) {
  field.grassBase = '#dfbe82';
  field.grassDark = '#d4b070';
  field.grassLight = '#e6c994';
  field.grassMown = '#d4b070';

  field.pathColor = '#c2a675';
  field.pathEdge = '#a68c5b';
  field.pathDetail = '#ded3be';
  field.dirtPathColor = '#c2a675';
  field.dirtPathEdge = '#a68c5b';

  field.trees = [];
  field.waterTower = null;
  field.benches = [];
  field.bins = [];
  field.rockOutcrops = [];
  field.sticks = [];
  field.landmarks = [];

  if (isClearOfKeepouts(2350, 1450, COASTAL_KEEPOUT, 80)) {
    field.landmarks.push({
      id: 'shipwreck-ribs',
      name: 'Weathered Timber Shipwreck Ribs',
      x: 2350,
      y: 1450,
      radius: 36,
      depthY: 1470,
      isLandmark: true,
    });
  }
  if (isClearOfKeepouts(900, 340, COASTAL_KEEPOUT, 80)) {
    field.landmarks.push({
      id: 'dune-lookout',
      name: 'Coastal Dune Lookout Post',
      x: 900,
      y: 340,
      radius: 32,
      depthY: 360,
      isLandmark: true,
    });
  }

  // Upper dunes (y < 420): 3 benches along boardwalk.
  const benchSpots = [
    { x: 500, y: 260 },
    { x: 1200, y: 300 },
    { x: 1900, y: 260 },
  ];
  benchSpots.forEach((spot, i) => {
    if (!isClearOfKeepouts(spot.x, spot.y, COASTAL_KEEPOUT, 80)) return;
    field.benches.push({
      id: `bench-coastal-${i}`,
      x: spot.x,
      y: spot.y,
      angle: 0,
      variant: 'coastal',
    });
  });

  // 3 bins on upper dunes.
  const binSpots = [
    { x: 700, y: 200 },
    { x: 1500, y: 220 },
    { x: 2200, y: 200 },
  ];
  binSpots.forEach((spot, i) => {
    if (!isClearOfKeepouts(spot.x, spot.y, COASTAL_KEEPOUT, 80)) return;
    field.bins.push({
      id: `bin-coastal-${i}`,
      x: spot.x,
      y: spot.y,
    });
  });

  // 4 rock outcrops on upper dunes.
  const rockSpots = [
    { x: 300, y: 300 },
    { x: 1000, y: 180 },
    { x: 1700, y: 320 },
    { x: 2400, y: 260 },
  ];
  rockSpots.forEach((spot, i) => {
    if (!isClearOfKeepouts(spot.x, spot.y, COASTAL_KEEPOUT, 80)) return;
    field.rockOutcrops.push({
      id: `rock-coastal-${i}`,
      x: spot.x,
      y: spot.y,
      radius: 20 + (i % 3) * 5,
      mossy: false,
    });
  });

  // Tide line (y: 1550..1780): 10 weathered driftwood sticks.
  const rng = makeRng(0xc0a57a1);
  const width = field.width || 3200;
  for (let i = 0; i < 10; i += 1) {
    const x = 200 + rng() * (width - 400);
    const y = 1550 + rng() * 230;
    if (!isClearOfKeepouts(x, y, COASTAL_KEEPOUT, 80)) {
      // Nudge away from keepouts deterministically.
      continue;
    }
    field.sticks.push({
      id: `stick-coastal-${i}`,
      x,
      y,
      angle: rng() * Math.PI * 2,
      length: 32,
      radius: 10,
      isStick: true,
      driftwood: true,
    });
  }
}

/**
 * Bake the biome ground layer onto the given canvas context.
 *
 * @param {object} field
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} biome
 */
export function bakeBiomeGround(field, ctx, biome) {
  if (!field || !ctx) return;

  if (biome === 'woodland') {
    bakeWoodlandGround(field, ctx);
    return;
  }

  if (biome === 'coastal') {
    bakeCoastalGround(field, ctx);
    return;
  }
}

function bakeWoodlandGround(field, ctx) {
  const w = field.width || 3200;
  const h = field.height || 2400;

  ctx.fillStyle = '#2b4c20';
  ctx.fillRect(0, 0, w, h);

  // Soft earth trails across the clearing.
  ctx.fillStyle = '#785c42';
  ctx.beginPath();
  ctx.ellipse(WOODLAND_CLEARING.x, WOODLAND_CLEARING.y, 140, 90, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(WOODLAND_CLEARING.x - 400, WOODLAND_CLEARING.y + 60, 260, 40, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(WOODLAND_CLEARING.x + 420, WOODLAND_CLEARING.y - 40, 260, 40, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Soft circular canopy shadow patches.
  ctx.fillStyle = 'rgba(18, 32, 12, 0.25)';
  const trees = field.trees || [];
  for (const t of trees) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, (t.radius || 26) * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function bakeCoastalGround(field, ctx) {
  const w = field.width || 3200;
  const h = field.height || 2400;

  // Upper dune sand.
  ctx.fillStyle = '#c2a675';
  ctx.fillRect(0, 0, w, 420);

  // Marram grass tufts on upper dunes.
  ctx.fillStyle = '#6e8c42';
  const rng = makeRng(0x6d617272);
  for (let i = 0; i < 120; i += 1) {
    const x = rng() * w;
    const y = rng() * 400;
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + rng() * 4, 3 + rng() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vast golden sand.
  ctx.fillStyle = '#dfbe82';
  ctx.fillRect(0, 420, w, 1850 - 420);

  // Subtle horizontal sandbar ripple lines.
  ctx.strokeStyle = 'rgba(180, 150, 100, 0.25)';
  ctx.lineWidth = 2;
  for (let y = 460; y < 1850; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 80) {
      const yy = y + Math.sin(x * 0.01 + y * 0.05) * 4;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // Wet sand mirror band.
  ctx.fillStyle = '#b59a68';
  ctx.fillRect(0, 1800, w, 50);

  // Ocean shallows gradient.
  const grad = ctx.createLinearGradient(0, 1850, 0, h);
  grad.addColorStop(0, '#38bdf8');
  grad.addColorStop(1, '#0284c7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 1850, w, h - 1850);
}

/**
 * Render animated coastal surf along the tide line.
 *
 * @param {object} field
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderCoastalSurf(field, ctx) {
  if (!field || !ctx) return;
  const w = field.width || 3200;
  const windTime = field.windTime || 0;
  const baseY = 1850 + Math.sin(windTime * 1.4) * 18;

  ctx.save();
  ctx.strokeStyle = 'rgba(240, 253, 250, 0.5)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 40) {
    const y = baseY + Math.sin(x * 0.02 + windTime * 2) * 6;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Secondary foam crest.
  ctx.strokeStyle = 'rgba(240, 253, 250, 0.3)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 40) {
    const y = baseY + 14 + Math.sin(x * 0.025 + windTime * 2.4) * 5;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Render a rustic warp signpost at the given gate.
 *
 * @param {object} field
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} gate - { x, y, label }
 */
export function renderWarpSignpost(field, ctx, gate) {
  if (!field || !ctx || !gate) return;
  const { x, y } = gate;
  const label = gate.label || 'Warp';

  ctx.save();
  ctx.translate(x, y);

  // Wooden post.
  ctx.fillStyle = '#5b3f28';
  ctx.fillRect(-4, -60, 8, 60);
  ctx.fillStyle = '#7a5636';
  ctx.fillRect(-3, -60, 3, 60);

  // Directional plank.
  ctx.fillStyle = '#8a6239';
  ctx.beginPath();
  ctx.moveTo(-40, -70);
  ctx.lineTo(40, -70);
  ctx.lineTo(52, -58);
  ctx.lineTo(40, -46);
  ctx.lineTo(-40, -46);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5b3f28';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Ambient pulse glow.
  const pulse = 0.5 + 0.5 * Math.sin((field.windTime || 0) * 3);
  ctx.globalAlpha = 0.25 + pulse * 0.25;
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(0, -58, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Floating glassmorphic pill badge.
  ctx.font = 'bold 14px sans-serif';
  const textWidth = ctx.measureText(label).width;
  const pillW = textWidth + 24;
  const pillH = 26;
  const pillX = -pillW / 2;
  const pillY = -110;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillW, pillH, 13);
  } else {
    ctx.rect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, pillY + pillH / 2);

  ctx.restore();
}

/**
 * Render a biome landmark.
 *
 * @param {object} field
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} landmark
 */
export function renderLandmark(field, ctx, landmark) {
  if (!field || !ctx || !landmark) return;

  if (landmark.id === 'shipwreck-ribs') {
    renderShipwreckRibs(ctx, landmark);
    return;
  }

  if (landmark.id === 'woodland-clearing') {
    renderWoodlandClearing(ctx, landmark);
    return;
  }

  if (landmark.id === 'dune-lookout') {
    renderDuneLookout(ctx, landmark);
    return;
  }
}

function renderShipwreckRibs(ctx, landmark) {
  ctx.save();
  ctx.translate(landmark.x, landmark.y);

  // Sand shadow.
  ctx.fillStyle = 'rgba(120, 90, 50, 0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 70, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Weathered dark oak timber ribs arching from the sand.
  ctx.strokeStyle = '#3b2a1a';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  for (let i = -3; i <= 3; i += 1) {
    const offset = i * 18;
    ctx.beginPath();
    ctx.moveTo(offset, 6);
    ctx.quadraticCurveTo(offset + 6, -50 - Math.abs(i) * 4, offset + 2, -70 - Math.abs(i) * 3);
    ctx.stroke();
  }

  // Central keel beam.
  ctx.strokeStyle = '#4a3520';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(-60, 4);
  ctx.lineTo(60, 4);
  ctx.stroke();

  ctx.restore();
}

function renderWoodlandClearing(ctx, landmark) {
  ctx.save();
  ctx.translate(landmark.x, landmark.y);

  // Mossy ground patch.
  ctx.fillStyle = 'rgba(58, 102, 44, 0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, landmark.radius + 20, 0, Math.PI * 2);
  ctx.fill();

  // Circle of rustic fallen mossy logs.
  const count = 8;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const lx = Math.cos(angle) * (landmark.radius + 10);
    const ly = Math.sin(angle) * (landmark.radius + 10);
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = '#5b3f28';
    ctx.fillRect(-22, -6, 44, 12);
    ctx.fillStyle = '#3a662c';
    ctx.fillRect(-22, -6, 44, 4);
    ctx.restore();
  }

  ctx.restore();
}

function renderDuneLookout(ctx, landmark) {
  ctx.save();
  ctx.translate(landmark.x, landmark.y);

  // Shadow.
  ctx.fillStyle = 'rgba(120, 90, 50, 0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 40, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Support posts.
  ctx.fillStyle = '#5b3f28';
  ctx.fillRect(-28, -40, 6, 50);
  ctx.fillRect(22, -40, 6, 50);

  // Raised platform.
  ctx.fillStyle = '#8a6239';
  ctx.fillRect(-36, -52, 72, 14);
  ctx.strokeStyle = '#5b3f28';
  ctx.lineWidth = 2;
  ctx.strokeRect(-36, -52, 72, 14);

  // Railing.
  ctx.strokeStyle = '#7a5636';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-36, -52);
  ctx.lineTo(-36, -72);
  ctx.moveTo(36, -52);
  ctx.lineTo(36, -72);
  ctx.moveTo(-36, -72);
  ctx.lineTo(36, -72);
  ctx.stroke();

  ctx.restore();
}
