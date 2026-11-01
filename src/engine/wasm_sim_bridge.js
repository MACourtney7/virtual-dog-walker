// src/engine/wasm_sim_bridge.js
// Strangler-Fig Simulation Bridge: Rust/Wasm accelerated simulation with transparent JS fallback.

let wasmSimInstance = null;
let initPromise = null;

export async function initWasmSim() {
  if (wasmSimInstance) return wasmSimInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (typeof window !== 'undefined') {
        const mod = await import('../wasm_core/dog_walker_core.js');
        if (typeof mod.default === 'function') {
          await mod.default();
        }
        if (typeof mod.WasmWorldSim === 'function') {
          wasmSimInstance = new mod.WasmWorldSim(2000.0, 2000.0);
          console.log('[WasmSimBridge] Core simulation engine initialized (Rust/Wasm).');
          return wasmSimInstance;
        }
      }
    } catch (err) {
      console.warn('[WasmSimBridge] Running in headless or non-Wasm environment; using JS fallback.', err);
    }
    return null;
  })();

  return initPromise;
}

export function getWasmSim() {
  return wasmSimInstance;
}

export function stepLeashConstraint(dog, owner, maxLength, stiffness, damping, dt) {
  if (wasmSimInstance) {
    const res = wasmSimInstance.step_leash(
      dog.x, dog.y, dog.vx, dog.vy,
      owner.x, owner.y,
      maxLength, stiffness, damping, dt
    );
    dog.x = res[0];
    dog.y = res[1];
    dog.vx = res[2];
    dog.vy = res[3];
    return res[4] > 0.5;
  }

  // JS Fallback
  const dx = dog.x - owner.x;
  const dy = dog.y - owner.y;
  const dist = Math.hypot(dx, dy);

  if (dist > maxLength && dist > 1e-6) {
    const excess = dist - maxLength;
    const nx = dx / dist;
    const ny = dy / dist;

    const springForce = excess * stiffness;
    dog.vx -= nx * springForce * dt;
    dog.vy -= ny * springForce * dt;

    const radialV = dog.vx * nx + dog.vy * ny;
    if (radialV > 0) {
      dog.vx -= nx * radialV * damping * dt;
      dog.vy -= ny * radialV * damping * dt;
    }

    if (excess > 40) {
      dog.x = owner.x + nx * (maxLength + 40);
      dog.y = owner.y + ny * (maxLength + 40);
    }
    return true;
  }
  return false;
}

export function resolveWorldCollision(entity, radius, worldW, worldH, colliders = []) {
  if (wasmSimInstance) {
    const res = wasmSimInstance.resolve_collision(entity.x, entity.y, radius);
    entity.x = res[0];
    entity.y = res[1];
    return;
  }

  // JS Fallback
  const margin = 36 + radius;
  entity.x = Math.max(margin, Math.min(worldW - margin, entity.x));
  entity.y = Math.max(margin, Math.min(worldH - margin, entity.y));

  for (const c of colliders) {
    const dx = entity.x - c.x;
    const dy = entity.y - c.y;
    const dist = Math.hypot(dx, dy);
    const minD = radius + c.r;
    if (dist < minD && dist > 1e-6) {
      const overlap = minD - dist;
      entity.x += (dx / dist) * overlap;
      entity.y += (dy / dist) * overlap;
    }
  }

  entity.x = Math.max(margin, Math.min(worldW - margin, entity.x));
  entity.y = Math.max(margin, Math.min(worldH - margin, entity.y));
}

export function sampleNpcState(waypoints, speed, spawnTime, now) {
  if (wasmSimInstance && waypoints && waypoints.length >= 2) {
    const flat = [];
    for (const pt of waypoints) {
      flat.push(pt[0], pt[1]);
    }
    const res = wasmSimInstance.sample_npc(new Float64Array(flat), speed, spawnTime, now);
    return {
      x: res[0],
      y: res[1],
      vx: res[2],
      vy: res[3],
      angle: res[4],
      walkPhase: res[5],
      opacity: res[6],
      finished: res[7] > 0.5
    };
  }

  // JS Fallback
  const tNow = (now > 1e10) ? now / 1000 : now;
  const tSpawn = (spawnTime > 1e10) ? spawnTime / 1000 : spawnTime;
  const elapsed = Math.max(0, tNow - tSpawn);
  const distance = elapsed * speed;

  let totalLen = 0;
  const cumDist = [0];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = Math.hypot(waypoints[i + 1][0] - waypoints[i][0], waypoints[i + 1][1] - waypoints[i][1]);
    totalLen += d;
    cumDist.push(totalLen);
  }

  if (distance >= totalLen) {
    const last = waypoints[waypoints.length - 1];
    return {
      x: last[0],
      y: last[1],
      vx: 0,
      vy: 0,
      angle: 0,
      walkPhase: totalLen * 0.1,
      opacity: 0,
      finished: true
    };
  }

  let segIdx = 0;
  while (segIdx < cumDist.length - 2 && cumDist[segIdx + 1] <= distance) {
    segIdx++;
  }

  const p0 = waypoints[segIdx];
  const p1 = waypoints[segIdx + 1];
  const segLen = Math.max(1e-6, cumDist[segIdx + 1] - cumDist[segIdx]);
  const segDist = distance - cumDist[segIdx];
  const frac = Math.max(0, Math.min(1, segDist / segLen));

  const x = p0[0] + (p1[0] - p0[0]) * frac;
  const y = p0[1] + (p1[1] - p0[1]) * frac;
  const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);

  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    walkPhase: distance * 0.08,
    opacity: 1.0,
    finished: false
  };
}

