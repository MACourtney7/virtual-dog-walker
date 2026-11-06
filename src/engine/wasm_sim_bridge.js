// src/engine/wasm_sim_bridge.js
// Strangler-Fig Simulation Bridge: Rust/Wasm accelerated simulation with transparent JS fallback.

let wasmSimInstance = null;
let initPromise = null;
let simWorldWidth = 3200.0;
let simWorldHeight = 2400.0;
// True once the exact field obstacle set has been uploaded to the Wasm sim (see syncWorldObstacles).
let worldObstaclesReady = false;

export async function initWasmSim(worldWidth = 3200.0, worldHeight = 2400.0) {
  simWorldWidth = worldWidth;
  simWorldHeight = worldHeight;
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
          wasmSimInstance = new mod.WasmWorldSim(worldWidth, worldHeight);
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

export function stepEarSprings(leftEar, rightEar, dogVx, dogVy, dogAngle, dt) {
  if (wasmSimInstance && typeof wasmSimInstance.step_ears === 'function') {
    const lAngle = leftEar ? (leftEar.angle || 0) : 0;
    const lVel = leftEar ? (leftEar.vel ?? leftEar.v ?? 0) : 0;
    const rAngle = rightEar ? (rightEar.angle || 0) : 0;
    const rVel = rightEar ? (rightEar.vel ?? rightEar.v ?? 0) : 0;
    const res = wasmSimInstance.step_ears(
      lAngle, lVel,
      rAngle, rVel,
      dogVx, dogVy, dogAngle, dt
    );
    if (leftEar) {
      leftEar.angle = res[0];
      if ('vel' in leftEar) leftEar.vel = res[1];
      if ('v' in leftEar) leftEar.v = res[1];
    }
    if (rightEar) {
      rightEar.angle = res[2];
      if ('vel' in rightEar) rightEar.vel = res[3];
      if ('v' in rightEar) rightEar.v = res[3];
    }
    return;
  }

  // JS Fallback
  const springK = 180.0;
  const damping = 14.0;
  const forwardSpeed = dogVx * Math.cos(dogAngle) + dogVy * Math.sin(dogAngle);
  const targetOffset = Math.max(-0.4, Math.min(0.4, forwardSpeed * 0.003));

  if (leftEar) {
    const lAngle = leftEar.angle || 0;
    const lVel = leftEar.vel ?? leftEar.v ?? 0;
    const leftForce = -springK * (lAngle - targetOffset) - damping * lVel;
    const newLVel = lVel + leftForce * dt;
    leftEar.angle = lAngle + newLVel * dt;
    if ('vel' in leftEar) leftEar.vel = newLVel;
    if ('v' in leftEar) leftEar.v = newLVel;
  }
  if (rightEar) {
    const rAngle = rightEar.angle || 0;
    const rVel = rightEar.vel ?? rightEar.v ?? 0;
    const rightForce = -springK * (rAngle - targetOffset) - damping * rVel;
    const newRVel = rVel + rightForce * dt;
    rightEar.angle = rAngle + newRVel * dt;
    if ('vel' in rightEar) rightEar.vel = newRVel;
    if ('v' in rightEar) rightEar.v = newRVel;
  }
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


// ---------------------------------------------------------------------------------------------
// Authoritative simulation helpers (dog_walker_core). Every helper has a behaviourally
// identical JS fallback used when Wasm is unavailable (headless tests, load failure) or when
// the world data has not been uploaded yet.
// ---------------------------------------------------------------------------------------------

/**
 * Uploads the exact field obstacle set to the Wasm sim so `resolveFieldCollision` can delegate.
 * Safe to call repeatedly (e.g. after the field is rebuilt). Returns true when Wasm is active.
 */
export function syncWorldObstacles(field) {
  worldObstaclesReady = false;
  if (!wasmSimInstance || !field || typeof wasmSimInstance.set_world_obstacles !== 'function') return false;
  if (typeof field.getWorldObstacles !== 'function') return false;
  if (field.width !== simWorldWidth || field.height !== simWorldHeight) return false;
  try {
    worldObstaclesReady = wasmSimInstance.set_world_obstacles(JSON.stringify(field.getWorldObstacles())) === true;
  } catch (e) {
    worldObstaclesReady = false;
  }
  return worldObstaclesReady;
}

export function isWorldObstaclesReady() {
  return worldObstaclesReady;
}

/** Resolves a circle entity against the field (Wasm authority, `field.resolveCircleCollision` fallback). */
export function resolveFieldCollision(entity, radius, field) {
  if (wasmSimInstance && worldObstaclesReady && typeof wasmSimInstance.resolve_field_collision === 'function') {
    const res = wasmSimInstance.resolve_field_collision(entity.x, entity.y, radius);
    entity.x = res[0];
    entity.y = res[1];
    return;
  }
  if (field) {
    const resolved = field.resolveCircleCollision(entity.x, entity.y, radius);
    entity.x = resolved.x;
    entity.y = resolved.y;
  }
}

/** Integrates both ear springs towards JS-computed targets (Wasm authority, exact JS fallback). */
export function stepEarSpringsToTargets(leftEar, rightEar, targetLeft, targetRight, springK, springDamp, dt) {
  if (wasmSimInstance && typeof wasmSimInstance.step_ear_targets === 'function') {
    const res = wasmSimInstance.step_ear_targets(
      leftEar.angle, leftEar.vel,
      rightEar.angle, rightEar.vel,
      targetLeft, targetRight,
      springK, springDamp, dt
    );
    leftEar.angle = res[0];
    leftEar.vel = res[1];
    rightEar.angle = res[2];
    rightEar.vel = res[3];
    return;
  }
  const leftForce = -springK * (leftEar.angle - targetLeft) - springDamp * leftEar.vel;
  leftEar.vel += leftForce * dt;
  leftEar.angle += leftEar.vel * dt;

  const rightForce = -springK * (rightEar.angle - targetRight) - springDamp * rightEar.vel;
  rightEar.vel += rightForce * dt;
  rightEar.angle += rightEar.vel * dt;
}

/**
 * One 2.5D tennis-ball ballistic step (gravity, bounce, rolling friction, world-edge bounce).
 * `ball` needs x,y,z,vx,vy,vz,gravity,restitution,friction. Wasm authority only when the ball
 * uses the default TennisBall tuning (so custom-tuned balls keep exact JS behaviour).
 */
export function stepToyBall(ball, dt, field) {
  const usesDefaults = ball.gravity === 720 && ball.restitution === 0.62 && ball.friction === 0.94;
  if (wasmSimInstance && field && usesDefaults && typeof wasmSimInstance.step_toy_ball === 'function') {
    const res = wasmSimInstance.step_toy_ball(
      ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz, dt, field.width, field.height
    );
    ball.x = res[0];
    ball.y = res[1];
    ball.z = res[2];
    ball.vx = res[3];
    ball.vy = res[4];
    ball.vz = res[5];
    return;
  }

  // JS Fallback (exact original TennisBall.update ballistics)
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.vz -= ball.gravity * dt;
  ball.z += ball.vz * dt;

  if (ball.z <= 0) {
    ball.z = 0;
    if (Math.abs(ball.vz) > 40) {
      ball.vz = -ball.vz * ball.restitution;
      ball.vx *= 0.82;
      ball.vy *= 0.82;
    } else {
      ball.vz = 0;
      ball.vx *= Math.pow(ball.friction, dt * 60);
      ball.vy *= Math.pow(ball.friction, dt * 60);
    }
  }

  if (field) {
    const minX = 70;
    const maxX = field.width - 70;
    const minY = 70;
    const maxY = field.height - 70;
    if (ball.x < minX) { ball.x = minX; ball.vx = -ball.vx * 0.7; }
    if (ball.x > maxX) { ball.x = maxX; ball.vx = -ball.vx * 0.7; }
    if (ball.y < minY) { ball.y = minY; ball.vy = -ball.vy * 0.7; }
    if (ball.y > maxY) { ball.y = maxY; ball.vy = -ball.vy * 0.7; }
  }
}

/**
 * Samples the in-progress part of an NPC polyline path (exact port of the interpolating branch
 * of ParkNPC.setClock). `flat` = Float64Array/array [x0,y0,x1,y1,...]. Returns
 * {x,y,vx,vy,angle,hasAngle}. Wasm authority with exact JS fallback.
 */
export function sampleNpcPath(flat, speed, distance) {
  if (wasmSimInstance && typeof wasmSimInstance.sample_npc_path === 'function') {
    const res = wasmSimInstance.sample_npc_path(flat, speed, distance);
    return { x: res[0], y: res[1], vx: res[2], vy: res[3], angle: res[4], hasAngle: res[5] > 0.5 };
  }

  const n = Math.floor(flat.length / 2);
  const segLens = [];
  for (let i = 0; i < n - 1; i++) {
    segLens.push(Math.hypot(flat[2 * i + 2] - flat[2 * i], flat[2 * i + 3] - flat[2 * i + 1]));
  }
  let accumulated = 0;
  let interpolated = false;
  let x = flat[0];
  let y = flat[1];
  let dx = 0;
  let dy = 0;
  let segLen = 0;
  let activeIndex = -1;
  let activeRemaining = 0;

  for (let i = 0; i < segLens.length; i++) {
    segLen = segLens[i];
    if (accumulated + segLen >= distance) {
      const remaining = distance - accumulated;
      const segT = segLen > 0.000001 ? (remaining / segLen) : 0;
      dx = flat[2 * i + 2] - flat[2 * i];
      dy = flat[2 * i + 3] - flat[2 * i + 1];
      x = flat[2 * i] + dx * segT;
      y = flat[2 * i + 1] + dy * segT;
      interpolated = true;
      activeIndex = i;
      activeRemaining = remaining;
      break;
    }
    accumulated += segLen;
  }

  if (!interpolated && n >= 2) {
    const lastIdx = n - 2;
    dx = flat[2 * lastIdx + 2] - flat[2 * lastIdx];
    dy = flat[2 * lastIdx + 3] - flat[2 * lastIdx + 1];
    segLen = segLens[lastIdx] || 0;
    x = flat[2 * lastIdx + 2];
    y = flat[2 * lastIdx + 3];
    activeIndex = lastIdx;
    activeRemaining = segLen;
  }

  let angle = 0;
  let hasAngle = false;
  if (Math.hypot(dx, dy) > 0.000001) {
    const segAngle = Math.atan2(dy, dx);
    const distToNext = segLen - activeRemaining;
    if (activeIndex >= 0 && activeIndex + 1 < segLens.length && distToNext < 25.0) {
      const nextAngle = Math.atan2(
        flat[2 * activeIndex + 5] - flat[2 * activeIndex + 3],
        flat[2 * activeIndex + 4] - flat[2 * activeIndex + 2]
      );
      let angleDiff = nextAngle - segAngle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      const blendFactor = Math.max(0, Math.min(0.5, (1.0 - distToNext / 25.0) * 0.5));
      angle = segAngle + angleDiff * blendFactor;
    } else {
      angle = segAngle;
    }
    hasAngle = true;
  }
  return {
    x,
    y,
    vx: segLen > 0.000001 ? (dx / segLen) * speed : 0,
    vy: segLen > 0.000001 ? (dy / segLen) * speed : 0,
    angle,
    hasAngle
  };
}
