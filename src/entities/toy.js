// Tennis Ball Toy - Ballistic 2.5D Trajectory, Bouncing & Canine Fetching Mechanics
//
// Thin command/event/hydration wrapper over the Wasm `BallSimBuffer` (32 floats).
// Throw/bounce/drop/attach/retrieve physics is delegated to `step_ball_buffer(dt)`
// in dog_walker_core; the exact JS fallback (`stepToyBall`) is used when Wasm is
// unavailable (headless tests, load failure).
import { stepToyBall, getWasmSim, getBufferView } from '../engine/wasm_sim_bridge.js';

// --- BallSimBuffer slot layout (mirrors crates/dog_walker_core/src/ball_physics.rs) ----------
const BALL_SLOT_STATE_ID = 0;
const BALL_SLOT_POS_X = 1;
const BALL_SLOT_POS_Y = 2;
const BALL_SLOT_POS_Z = 3;
const BALL_SLOT_VEL_X = 4;
const BALL_SLOT_VEL_Y = 5;
const BALL_SLOT_VEL_Z = 6;
const BALL_SLOT_SPIN = 7;
const BALL_SLOT_AGE_S = 8;
const BALL_SLOT_BOUNCE_COUNT = 9;
const BALL_SLOT_IS_THROWN = 10;
const BALL_SLOT_IS_CARRIED = 11;
const BALL_SLOT_ATTACHED_TO_DOG = 12;
const BALL_SLOT_IN_OWNER_POSSESSION = 13;
const BALL_SLOT_RADIUS = 14;
const BALL_SLOT_GRAVITY = 15;
const BALL_SLOT_RESTITUTION = 16;
const BALL_SLOT_DRAG_PER_S = 17;
const BALL_SLOT_FIELD_MIN_X = 18;
const BALL_SLOT_FIELD_MAX_X = 19;
const BALL_SLOT_FIELD_MIN_Y = 20;
const BALL_SLOT_FIELD_MAX_Y = 21;
const BALL_SLOT_GROUND_Z = 22;
const BALL_SLOT_CEILING_Z = 23;
const BALL_SLOT_COMMAND_FLAGS = 24;
const BALL_SLOT_MAX_BOUNCES = 25;
const BALL_SLOT_SETTLE_EPS = 26;
const BALL_SLOT_IS_AIRBORNE = 27;
const BALL_SLOT_LAST_EVENT_MASK = 28;
const BALL_SLOT_CONFIG_FLAGS = 29;

const BALL_BUFFER_SLOTS = 32;

const BALL_STATE_IDLE = 0;
const BALL_STATE_THROWN = 1;
const BALL_STATE_CARRIED = 2;
const BALL_STATE_DOG_POSSESSION = 3;
const BALL_STATE_OWNER_POSSESSION = 4;

const BALL_CMD_RESET = 1 << 0;
const BALL_CMD_THROW = 1 << 1;
const BALL_CMD_DROP = 1 << 2;
const BALL_CMD_ATTACH_TO_DOG = 1 << 3;
const BALL_CMD_RETRIEVE_BY_OWNER = 1 << 4;
const BALL_CMD_SET_POSITION = 1 << 5;

const BALL_EVENT_BOUNCED = 1 << 8;
const BALL_EVENT_LANDED = 1 << 6;

const BALL_CONFIG_FLAGS_INITIALIZED = 1.0;

export class TennisBall {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.z = 0; // Height off the ground (px)
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.spin = 0;

    this.radius = 7;
    this.gravity = 720;
    this.restitution = 0.62; // Bounce elasticity
    this.friction = 0.94; // Ground rolling friction

    this.isThrown = false;
    this.isCarried = false;
    this.carrier = null; // Dog currently holding the ball
    this.inOwnerPossession = true;
    this.depthY = this.y;

    // Rust-owned Wasm ball buffer view (32 floats), resolved lazily from the sim's
    // `ball_buffer_ptr()`. Re-resolved whenever Wasm memory grows (buffer identity changes).
    this._ballBuffer = null;
    this._ballBufferPtr = 0;
    this._ballBufferMemory = null;
    // Pending config to apply once the Rust-owned view is available.
    this._ballConfigPending = true;
    this._ballConfig = {
      x,
      y,
      radius: this.radius,
      gravity: this.gravity,
      restitution: this.restitution,
      friction: this.friction,
    };
  }

  /** Returns the Wasm sim instance, or null when Wasm is unavailable. */
  _wasm() {
    try {
      return getWasmSim();
    } catch (e) {
      return null;
    }
  }

  /**
   * Resolves (and caches) the Rust-owned Float32Array view over the ball buffer via
   * `getBufferView(sim.ball_buffer_ptr(), 32)`. Re-resolves when the pointer or the
   * underlying Wasm memory buffer changes (memory.grow detaches old views).
   * Returns null when Wasm is unavailable or the pointer is not yet valid.
   */
  _getBallBufferView(sim) {
    if (!sim || typeof sim.ball_buffer_ptr !== 'function') return null;
    let ptr = 0;
    try {
      ptr = sim.ball_buffer_ptr() >>> 0;
    } catch (e) {
      return null;
    }
    if (!ptr) return null;
    if (this._ballBuffer && this._ballBufferPtr === ptr) {
      // Re-validate the cached view against the current memory buffer.
      try {
        if (this._ballBuffer.buffer && this._ballBuffer.buffer.byteLength > 0) {
          return this._ballBuffer;
        }
      } catch (e) {
        // Detached buffer (memory grew) — fall through and re-resolve.
      }
    }
    let view = null;
    try {
      view = getBufferView(ptr, BALL_BUFFER_SLOTS);
    } catch (e) {
      return null;
    }
    if (!view || view.length !== BALL_BUFFER_SLOTS) return null;
    this._ballBuffer = view;
    this._ballBufferPtr = ptr;
    this._ballBufferMemory = view.buffer;
    return view;
  }

  /** Applies the one-time config slots to the Rust-owned buffer. */
  _applyConfigIfNeeded(buf) {
    if (!this._ballConfigPending) return;
    const cfg = this._ballConfig;
    buf[BALL_SLOT_RADIUS] = cfg.radius;
    buf[BALL_SLOT_GRAVITY] = -cfg.gravity;
    buf[BALL_SLOT_RESTITUTION] = cfg.restitution;
    buf[BALL_SLOT_DRAG_PER_S] = 0.35;
    buf[BALL_SLOT_GROUND_Z] = 0;
    buf[BALL_SLOT_CEILING_Z] = 1.0e6;
    buf[BALL_SLOT_MAX_BOUNCES] = 6;
    buf[BALL_SLOT_SETTLE_EPS] = 10;
    buf[BALL_SLOT_CONFIG_FLAGS] = BALL_CONFIG_FLAGS_INITIALIZED;
    this._ballConfigPending = false;
  }

  /** ORs a command bit into the buffer's command-flag slot. */
  _queueCommand(buf, bit) {
    if (!buf) return;
    buf[BALL_SLOT_COMMAND_FLAGS] = (buf[BALL_SLOT_COMMAND_FLAGS] >>> 0 | (bit >>> 0)) >>> 0;
  }

  /** Writes the current JS kinematic state into the Rust-owned buffer (before a command). */
  _seedBufferFromJs(buf) {
    if (!buf) return;
    buf[BALL_SLOT_POS_X] = Number.isFinite(this.x) ? this.x : 0;
    buf[BALL_SLOT_POS_Y] = Number.isFinite(this.y) ? this.y : 0;
    buf[BALL_SLOT_POS_Z] = Number.isFinite(this.z) ? this.z : 0;
    buf[BALL_SLOT_VEL_X] = Number.isFinite(this.vx) ? this.vx : 0;
    buf[BALL_SLOT_VEL_Y] = Number.isFinite(this.vy) ? this.vy : 0;
    buf[BALL_SLOT_VEL_Z] = Number.isFinite(this.vz) ? this.vz : 0;
  }

  /** Hydrates the public JS fields from the Rust-owned ball buffer after a step. */
  _hydrateFromBuffer(buf) {
    if (!buf) return;
    this.x = buf[BALL_SLOT_POS_X];
    this.y = buf[BALL_SLOT_POS_Y];
    this.z = buf[BALL_SLOT_POS_Z];
    this.vx = buf[BALL_SLOT_VEL_X];
    this.vy = buf[BALL_SLOT_VEL_Y];
    this.vz = buf[BALL_SLOT_VEL_Z];
    this.spin = buf[BALL_SLOT_SPIN];
    this.isThrown = buf[BALL_SLOT_IS_THROWN] !== 0;
    this.isCarried = buf[BALL_SLOT_IS_CARRIED] !== 0;
    this.inOwnerPossession = buf[BALL_SLOT_IN_OWNER_POSSESSION] !== 0;
  }

  /**
   * Seeds the Rust-owned buffer from JS state and queues a command bit. No-op when Wasm
   * is unavailable (the JS fallback path handles the command via public fields).
   */
  _seedAndQueue(bit) {
    const sim = this._wasm();
    if (!sim) return;
    const buf = this._getBallBufferView(sim);
    if (!buf) return;
    this._applyConfigIfNeeded(buf);
    this._seedBufferFromJs(buf);
    this._queueCommand(buf, bit);
  }

  throw(fromX, fromY, dirX, dirY, speed = 360, launchZ = 180) {
    this.x = fromX;
    this.y = fromY;
    this.z = 12;

    const len = Math.hypot(dirX, dirY) || 1;
    this.vx = (dirX / len) * speed;
    this.vy = (dirY / len) * speed;
    this.vz = launchZ;

    this.isThrown = true;
    this.isCarried = false;
    this.carrier = null;
    this.inOwnerPossession = false;

    // Seed the Rust-owned buffer with the launch kinematics and queue a THROW command.
    this._seedAndQueue(BALL_CMD_THROW);
  }

  attachToDog(dog) {
    this.isCarried = true;
    this.isThrown = false;
    this.carrier = dog;
    this.inOwnerPossession = false;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.z = 8;

    this._seedAndQueue(BALL_CMD_ATTACH_TO_DOG);
  }

  drop(x, y) {
    this.isCarried = false;
    this.carrier = null;
    this.inOwnerPossession = false;
    this.x = x;
    this.y = y;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;

    this._seedAndQueue(BALL_CMD_DROP);
  }

  retrieveByOwner() {
    this.inOwnerPossession = true;
    this.isThrown = false;
    this.isCarried = false;
    this.carrier = null;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.z = 0;

    this._seedAndQueue(BALL_CMD_RETRIEVE_BY_OWNER);
  }

  update(dt, field) {
    if (this.inOwnerPossession) {
      return;
    }

    if (this.isCarried && this.carrier) {
      // Offset ball at the dog's mouth position
      const mouthOffset = 18;
      this.x = this.carrier.x + Math.cos(this.carrier.angle) * mouthOffset;
      this.y = this.carrier.y + Math.sin(this.carrier.angle) * mouthOffset;
      this.z = 8;
      this.depthY = this.y + 4;
      return;
    }

    if (!this.isThrown && Math.hypot(this.vx, this.vy) < 1 && this.z <= 0) {
      this.z = 0;
      this.depthY = this.y;
      return;
    }

    const sim = this._wasm();
    if (sim && typeof sim.step_ball_buffer === 'function') {
      // Wasm authority: resolve the Rust-owned buffer view, seed the current JS state
      // and field bounds, then advance one tick via the exact generated signature
      // `step_ball_buffer(dt)` (single argument) and hydrate the public fields.
      const buf = this._getBallBufferView(sim);
      if (buf) {
        this._applyConfigIfNeeded(buf);
        this._seedBufferFromJs(buf);
        if (field) {
          buf[BALL_SLOT_FIELD_MIN_X] = 70;
          buf[BALL_SLOT_FIELD_MAX_X] = field.width - 70;
          buf[BALL_SLOT_FIELD_MIN_Y] = 70;
          buf[BALL_SLOT_FIELD_MAX_Y] = field.height - 70;
        }
        let events = 0;
        try {
          events = sim.step_ball_buffer(dt) >>> 0;
        } catch (e) {
          events = 0;
        }
        // Re-resolve the view in case memory.grow detached the previous buffer.
        const outBuf = this._getBallBufferView(sim) || buf;
        this._hydrateFromBuffer(outBuf);
        this._handleEvents(events);
        this.depthY = this.y;
        return;
      }
    }

    // 2.5D Ballistic motion (gravity, bounce, rolling friction, world-edge bounce):
    // exact JS fallback lives in the bridge.
    stepToyBall(this, dt, field);

    // Depth sorting base Y is the ground position
    this.depthY = this.y;
  }

  /**
   * Applies event-bitmask side effects returned from `step_ball_buffer(dt)`.
   * Keeps the public JS flags consistent with the Rust authority.
   */
  _handleEvents(events) {
    if (!events) return;
    if (events & BALL_EVENT_LANDED) {
      // Ball touched the ground; nothing extra to mirror beyond hydrated state.
    }
    if (events & BALL_EVENT_BOUNCED) {
      // Bounce already reflected in hydrated vz/vx/vy.
    }
  }

  draw(ctx) {
    if (this.inOwnerPossession) {
      return;
    }

    ctx.save();
    // 1. Soft Shadow on the ground
    const shadowScale = Math.max(0.3, 1 - this.z / 180);
    const shadowAlpha = Math.max(0.12, 0.45 * (1 - this.z / 200));
    ctx.fillStyle = `rgba(20, 35, 15, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.radius * 1.3 * shadowScale, this.radius * 0.7 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Optic Yellow Tennis Ball (elevated by z)
    const drawY = this.y - this.z;
    ctx.fillStyle = '#d9f92e'; // Bright tennis felt green/yellow
    ctx.beginPath();
    ctx.arc(this.x, drawY, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Curved white felt seam
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(this.x - 2, drawY, this.radius * 0.65, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();

    // Subtle 3D ball highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(this.x - 2, drawY - 2, this.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
