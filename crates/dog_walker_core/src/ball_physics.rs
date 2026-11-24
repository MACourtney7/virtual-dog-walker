use crate::collision::Collider;
use crate::world_contract::BallSimBuffer;
use serde::{Deserialize, Serialize};

pub const GRAVITY: f64 = -580.0; // px/s^2
pub const BOUNCE_DAMPING: f64 = 0.55;
pub const GROUND_FRICTION: f64 = 0.92;
pub const AIR_DRAG: f64 = 0.992;
pub const STOP_THRESHOLD: f64 = 4.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BallState {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub vz: f64,
    pub is_held: bool,
    pub is_moving: bool,
    pub bounce_count: u32,
}

impl Default for BallState {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            vx: 0.0,
            vy: 0.0,
            vz: 0.0,
            is_held: false,
            is_moving: false,
            bounce_count: 0,
        }
    }
}

pub struct BallSim {
    pub state: BallState,
}

impl BallSim {
    pub fn new() -> Self {
        Self {
            state: BallState::default(),
        }
    }

    pub fn throw_toward(&mut self, start_x: f64, start_y: f64, target_x: f64, target_y: f64, power: f64) {
        let dx = target_x - start_x;
        let dy = target_y - start_y;
        let dist = dx.hypot(dy).max(1.0);
        let speed = (power * 450.0).clamp(120.0, 520.0);

        self.state.x = start_x;
        self.state.y = start_y;
        self.state.z = 18.0;
        self.state.vx = (dx / dist) * speed;
        self.state.vy = (dy / dist) * speed;
        self.state.vz = (power * 220.0).clamp(80.0, 320.0);
        self.state.is_held = false;
        self.state.is_moving = true;
        self.state.bounce_count = 0;
    }

    pub fn step(&mut self, dt: f64, world_w: f64, world_h: f64, colliders: &[Collider]) -> bool {
        if self.state.is_held || !self.state.is_moving {
            return false;
        }

        // Apply air drag
        self.state.vx *= AIR_DRAG;
        self.state.vy *= AIR_DRAG;

        // Gravity on Z
        self.state.vz += GRAVITY * dt;

        // Position integration
        self.state.x += self.state.vx * dt;
        self.state.y += self.state.vy * dt;
        self.state.z += self.state.vz * dt;

        let mut bounced = false;

        // Ground impact
        if self.state.z <= 0.0 {
            self.state.z = 0.0;
            if self.state.vz < 0.0 {
                self.state.vz = -self.state.vz * BOUNCE_DAMPING;
                self.state.bounce_count += 1;
                bounced = true;

                // Ground friction on bounce
                self.state.vx *= GROUND_FRICTION;
                self.state.vy *= GROUND_FRICTION;

                // Stop bouncing if vertical speed is tiny
                if self.state.vz.abs() < 35.0 {
                    self.state.vz = 0.0;
                }
            }
        }

        // Rolling on ground friction
        if self.state.z <= 0.01 {
            self.state.vx *= GROUND_FRICTION.powf(dt * 60.0);
            self.state.vy *= GROUND_FRICTION.powf(dt * 60.0);

            let speed = self.state.vx.hypot(self.state.vy);
            if speed < STOP_THRESHOLD && self.state.vz.abs() < 5.0 {
                self.state.vx = 0.0;
                self.state.vy = 0.0;
                self.state.vz = 0.0;
                self.state.z = 0.0;
                self.state.is_moving = false;
            }
        }

        // World boundary bounce
        let margin = 20.0;
        if self.state.x < margin {
            self.state.x = margin;
            self.state.vx = -self.state.vx * BOUNCE_DAMPING;
        } else if self.state.x > world_w - margin {
            self.state.x = world_w - margin;
            self.state.vx = -self.state.vx * BOUNCE_DAMPING;
        }

        if self.state.y < margin {
            self.state.y = margin;
            self.state.vy = -self.state.vy * BOUNCE_DAMPING;
        } else if self.state.y > world_h - margin {
            self.state.y = world_h - margin;
            self.state.vy = -self.state.vy * BOUNCE_DAMPING;
        }

        // Obstacle bounce
        for c in colliders {
            let dx = self.state.x - c.x;
            let dy = self.state.y - c.y;
            let dist = dx.hypot(dy);
            let min_dist = c.r + 6.0;

            if dist < min_dist && dist > 1e-6 {
                let nx = dx / dist;
                let ny = dy / dist;
                self.state.x = c.x + nx * min_dist;
                self.state.y = c.y + ny * min_dist;

                let dot = self.state.vx * nx + self.state.vy * ny;
                if dot < 0.0 {
                    self.state.vx = (self.state.vx - 2.0 * dot * nx) * BOUNCE_DAMPING;
                    self.state.vy = (self.state.vy - 2.0 * dot * ny) * BOUNCE_DAMPING;
                    bounced = true;
                }
            }
        }

        bounced
    }
}

/// Tuning constants mirroring `src/entities/toy.js` (`TennisBall`) exactly so the Wasm
/// path is behaviourally identical to the JS fallback.
pub const TOY_GRAVITY: f64 = 720.0;
pub const TOY_RESTITUTION: f64 = 0.62;
pub const TOY_FRICTION: f64 = 0.94;
pub const TOY_BOUNCE_THRESHOLD: f64 = 40.0;
pub const TOY_BOUNCE_TANGENT_DAMPING: f64 = 0.82;
pub const TOY_BOUNDARY_MARGIN: f64 = 70.0;
pub const TOY_BOUNDARY_DAMPING: f64 = 0.7;

// ---------------------------------------------------------------------------
// Buffer-backed ball lifecycle contract (unification-048).
//
// All runtime state lives in `BallSimBuffer::data`; these indices are stable
// ABI slots shared with the host. None of the functions below allocate.
// ---------------------------------------------------------------------------

pub const BALL_SLOT_STATE_ID: usize = 0;
pub const BALL_SLOT_STATE: usize = BALL_SLOT_STATE_ID;

pub const BALL_SLOT_POS_X: usize = 1;
pub const BALL_SLOT_X: usize = BALL_SLOT_POS_X;
pub const BALL_SLOT_POS_Y: usize = 2;
pub const BALL_SLOT_Y: usize = BALL_SLOT_POS_Y;
pub const BALL_SLOT_POS_Z: usize = 3;
pub const BALL_SLOT_Z: usize = BALL_SLOT_POS_Z;

pub const BALL_SLOT_VEL_X: usize = 4;
pub const BALL_SLOT_VX: usize = BALL_SLOT_VEL_X;
pub const BALL_SLOT_VEL_Y: usize = 5;
pub const BALL_SLOT_VY: usize = BALL_SLOT_VEL_Y;
pub const BALL_SLOT_VEL_Z: usize = 6;
pub const BALL_SLOT_VZ: usize = BALL_SLOT_VEL_Z;

pub const BALL_SLOT_SPIN: usize = 7;
pub const BALL_SLOT_AGE_S: usize = 8;
pub const BALL_SLOT_BOUNCE_COUNT: usize = 9;

pub const BALL_SLOT_IS_THROWN: usize = 10;
pub const BALL_SLOT_IS_CARRIED: usize = 11;
pub const BALL_SLOT_ATTACHED_TO_DOG: usize = 12;
pub const BALL_SLOT_IN_OWNER_POSSESSION: usize = 13;

pub const BALL_SLOT_RADIUS: usize = 14;
pub const BALL_SLOT_GRAVITY: usize = 15;
pub const BALL_SLOT_RESTITUTION: usize = 16;
pub const BALL_SLOT_DRAG_PER_S: usize = 17;

pub const BALL_SLOT_FIELD_MIN_X: usize = 18;
pub const BALL_SLOT_FIELD_MAX_X: usize = 19;
pub const BALL_SLOT_FIELD_MIN_Y: usize = 20;
pub const BALL_SLOT_FIELD_MAX_Y: usize = 21;

pub const BALL_SLOT_GROUND_Z: usize = 22;
pub const BALL_SLOT_CEILING_Z: usize = 23;
pub const BALL_SLOT_COMMAND_FLAGS: usize = 24;
pub const BALL_SLOT_CMD_FLAGS: usize = BALL_SLOT_COMMAND_FLAGS;
pub const BALL_SLOT_COMMANDS: usize = BALL_SLOT_COMMAND_FLAGS;

pub const BALL_SLOT_MAX_BOUNCES: usize = 25;
pub const BALL_SLOT_SETTLE_EPS: usize = 26;
pub const BALL_SLOT_IS_AIRBORNE: usize = 27;
pub const BALL_SLOT_LAST_EVENT_MASK: usize = 28;
pub const BALL_SLOT_CONFIG_FLAGS: usize = 29;
pub const BALL_SLOT_RESERVED_30: usize = 30;
pub const BALL_SLOT_RESERVED_31: usize = 31;

/// Value written to [`BALL_SLOT_CONFIG_FLAGS`] once the buffer's config slots
/// have been initialized. A fresh zeroed buffer has `0.0` here, which signals
/// that unset config slots should be populated with defaults exactly once.
pub const BALL_CONFIG_FLAGS_INITIALIZED: f32 = 1.0;

pub const BALL_STATE_IDLE: f32 = 0.0;
pub const BALL_STATE_THROWN: f32 = 1.0;
pub const BALL_STATE_CARRIED: f32 = 2.0;
pub const BALL_STATE_DOG_POSSESSION: f32 = 3.0;
pub const BALL_STATE_OWNER_POSSESSION: f32 = 4.0;

pub const BALL_CMD_RESET: u32 = 1 << 0;
pub const BALL_CMD_THROW: u32 = 1 << 1;
pub const BALL_CMD_DROP: u32 = 1 << 2;
pub const BALL_CMD_ATTACH_TO_DOG: u32 = 1 << 3;
pub const BALL_CMD_RETRIEVE_BY_OWNER: u32 = 1 << 4;
pub const BALL_CMD_SET_POSITION: u32 = 1 << 5;

pub const BALL_EVENT_NONE: u32 = 0;
pub const BALL_EVENT_THROWN: u32 = 1 << 0;
pub const BALL_EVENT_DROPPED: u32 = 1 << 1;
pub const BALL_EVENT_ATTACHED_TO_DOG: u32 = 1 << 2;
pub const BALL_EVENT_RETRIEVED_BY_OWNER: u32 = 1 << 3;
pub const BALL_EVENT_RESET: u32 = 1 << 4;
pub const BALL_EVENT_CMD_REJECTED: u32 = 1 << 5;
pub const BALL_EVENT_LANDED: u32 = 1 << 6;
pub const BALL_EVENT_OUT_OF_BOUNDS: u32 = 1 << 7;
pub const BALL_EVENT_BOUNCED: u32 = 1 << 8;
pub const BALL_EVENT_CEILING: u32 = 1 << 9;
pub const BALL_EVENT_AIRBORNE: u32 = 1 << 10;

pub const BALL_EVENT_SETTLED: u32 = BALL_EVENT_LANDED;
pub const BALL_EVENT_ATTACHED: u32 = BALL_EVENT_ATTACHED_TO_DOG;
pub const BALL_EVENT_RETRIEVED: u32 = BALL_EVENT_RETRIEVED_BY_OWNER;
pub const BALL_EVENT_OWNER_RETRIEVED: u32 = BALL_EVENT_RETRIEVED_BY_OWNER;

pub const BALL_DEFAULT_RADIUS: f32 = 7.0;
pub const BALL_DEFAULT_GRAVITY: f32 = -480.0;
pub const BALL_DEFAULT_RESTITUTION: f32 = 0.55;
pub const BALL_DEFAULT_DRAG_PER_S: f32 = 1.8;
pub const BALL_MAX_BOUNCES: f32 = 4.0;
pub const BALL_SETTLE_EPS_PX_S: f32 = 18.0;

pub const BALL_DOG_MOUTH_LOCAL_Y: f32 = 14.0;
pub const BALL_DOG_MOUTH_LOCAL_Z: f32 = 10.0;
pub const BALL_OWNER_HAND_LOCAL_Y: f32 = 10.0;
pub const BALL_OWNER_HAND_LOCAL_Z: f32 = 28.0;

#[derive(Debug, Clone, Copy, Default)]
pub struct BallStepContext {
    pub dog_pos_x: f32,
    pub dog_pos_y: f32,
    pub dog_heading_rad: f32,
    pub owner_pos_x: f32,
    pub owner_pos_y: f32,
    pub owner_heading_rad: f32,
}

#[inline]
fn ball_read_u32(value: f32) -> u32 {
    if value.is_finite() && value > 0.0 {
        value.round() as u32
    } else {
        0
    }
}

#[inline]
fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

/// Read a config slot, treating only non-finite values as "unset".
///
/// Any finite value (including `0.0`) is honored as an explicit config value.
/// Non-finite values (`NaN`, `±inf`) fall back to the supplied default.
#[inline]
fn ball_config(buf: &BallSimBuffer, slot: usize, fallback: f32) -> f32 {
    let value = buf.data[slot];
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

/// Initialize unset config slots exactly once.
///
/// A fresh zeroed [`BallSimBuffer`] has `BALL_SLOT_CONFIG_FLAGS == 0.0`. On the
/// first step we populate any non-finite config slots with their defaults and
/// then set [`BALL_SLOT_CONFIG_FLAGS`] to [`BALL_CONFIG_FLAGS_INITIALIZED`] so
/// subsequent steps honor the (possibly zero) values as explicit config.
fn init_ball_config_once(buf: &mut BallSimBuffer) {
    if buf.data[BALL_SLOT_CONFIG_FLAGS] != 0.0 {
        return;
    }

    // A fresh zeroed buffer cannot express "unset" for slots whose default is
    // non-zero (a zeroed ceiling or field max would clamp the ball to the
    // origin). Populate those defaults once; any finite non-zero value the
    // caller pre-set is preserved. After this runs, `ball_config` honors every
    // finite value (including `0.0`) as explicit config.
    let defaults: [(usize, f32); 8] = [
        (BALL_SLOT_RADIUS, BALL_DEFAULT_RADIUS),
        (BALL_SLOT_GRAVITY, BALL_DEFAULT_GRAVITY),
        (BALL_SLOT_RESTITUTION, BALL_DEFAULT_RESTITUTION),
        (BALL_SLOT_DRAG_PER_S, BALL_DEFAULT_DRAG_PER_S),
        (BALL_SLOT_FIELD_MAX_X, 1.0e9),
        (BALL_SLOT_FIELD_MAX_Y, 1.0e9),
        (BALL_SLOT_CEILING_Z, 1.0e6),
        (BALL_SLOT_MAX_BOUNCES, BALL_MAX_BOUNCES),
    ];

    for (slot, default) in defaults {
        let value = buf.data[slot];
        if !value.is_finite() || value == 0.0 {
            buf.data[slot] = default;
        }
    }

    if !buf.data[BALL_SLOT_SETTLE_EPS].is_finite() {
        buf.data[BALL_SLOT_SETTLE_EPS] = BALL_SETTLE_EPS_PX_S;
    }

    buf.data[BALL_SLOT_CONFIG_FLAGS] = BALL_CONFIG_FLAGS_INITIALIZED;
}

#[inline]
fn ball_state_id(buf: &BallSimBuffer) -> u32 {
    ball_read_u32(buf.data[BALL_SLOT_STATE_ID])
}

#[inline]
fn set_ball_flag(buf: &mut BallSimBuffer, slot: usize, enabled: bool) {
    buf.data[slot] = if enabled { 1.0 } else { 0.0 };
}

fn apply_ball_reset(buf: &mut BallSimBuffer) {
    for slot in [
        BALL_SLOT_POS_X,
        BALL_SLOT_POS_Y,
        BALL_SLOT_POS_Z,
        BALL_SLOT_VEL_X,
        BALL_SLOT_VEL_Y,
        BALL_SLOT_VEL_Z,
        BALL_SLOT_SPIN,
        BALL_SLOT_AGE_S,
        BALL_SLOT_BOUNCE_COUNT,
        BALL_SLOT_IS_THROWN,
        BALL_SLOT_IS_CARRIED,
        BALL_SLOT_ATTACHED_TO_DOG,
        BALL_SLOT_IN_OWNER_POSSESSION,
        BALL_SLOT_IS_AIRBORNE,
        BALL_SLOT_LAST_EVENT_MASK,
    ] {
        buf.data[slot] = 0.0;
    }
    buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_IDLE;
}

fn apply_ball_throw(buf: &mut BallSimBuffer) {
    buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
    buf.data[BALL_SLOT_AGE_S] = 0.0;
    buf.data[BALL_SLOT_BOUNCE_COUNT] = 0.0;
    buf.data[BALL_SLOT_SPIN] = 0.0;
    set_ball_flag(buf, BALL_SLOT_IS_THROWN, true);
    set_ball_flag(buf, BALL_SLOT_IS_CARRIED, false);
    set_ball_flag(buf, BALL_SLOT_ATTACHED_TO_DOG, false);
    set_ball_flag(buf, BALL_SLOT_IN_OWNER_POSSESSION, false);
    set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, true);
}

fn apply_ball_drop(buf: &mut BallSimBuffer) {
    buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
    buf.data[BALL_SLOT_AGE_S] = 0.0;
    buf.data[BALL_SLOT_BOUNCE_COUNT] = 0.0;
    set_ball_flag(buf, BALL_SLOT_IS_THROWN, true);
    set_ball_flag(buf, BALL_SLOT_IS_CARRIED, false);
    set_ball_flag(buf, BALL_SLOT_ATTACHED_TO_DOG, false);
    set_ball_flag(buf, BALL_SLOT_IN_OWNER_POSSESSION, false);
    set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, false);
}

fn apply_ball_attach_to_dog(buf: &mut BallSimBuffer) {
    buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_CARRIED;
    buf.data[BALL_SLOT_AGE_S] = 0.0;
    buf.data[BALL_SLOT_BOUNCE_COUNT] = 0.0;
    set_ball_flag(buf, BALL_SLOT_IS_THROWN, false);
    set_ball_flag(buf, BALL_SLOT_IS_CARRIED, true);
    set_ball_flag(buf, BALL_SLOT_ATTACHED_TO_DOG, true);
    set_ball_flag(buf, BALL_SLOT_IN_OWNER_POSSESSION, false);
    set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, false);
}

fn apply_ball_retrieve_by_owner(buf: &mut BallSimBuffer) {
    buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_OWNER_POSSESSION;
    buf.data[BALL_SLOT_AGE_S] = 0.0;
    buf.data[BALL_SLOT_BOUNCE_COUNT] = 0.0;
    set_ball_flag(buf, BALL_SLOT_IS_THROWN, false);
    set_ball_flag(buf, BALL_SLOT_IS_CARRIED, false);
    set_ball_flag(buf, BALL_SLOT_ATTACHED_TO_DOG, false);
    set_ball_flag(buf, BALL_SLOT_IN_OWNER_POSSESSION, true);
    set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, false);
}

fn snap_ball_to_dog(buf: &mut BallSimBuffer, ctx: &BallStepContext) {
    let heading = finite_or(ctx.dog_heading_rad, 0.0);
    let (sin_h, cos_h) = heading.sin_cos();

    buf.data[BALL_SLOT_POS_X] =
        finite_or(ctx.dog_pos_x, 0.0) + cos_h * BALL_DOG_MOUTH_LOCAL_Y;
    buf.data[BALL_SLOT_POS_Y] =
        finite_or(ctx.dog_pos_y, 0.0) + sin_h * BALL_DOG_MOUTH_LOCAL_Y;
    buf.data[BALL_SLOT_POS_Z] = BALL_DOG_MOUTH_LOCAL_Z;

    for slot in [BALL_SLOT_VEL_X, BALL_SLOT_VEL_Y, BALL_SLOT_VEL_Z] {
        buf.data[slot] = 0.0;
    }
    set_ball_flag(buf, BALL_SLOT_IS_THROWN, false);
    set_ball_flag(buf, BALL_SLOT_IS_CARRIED, true);
    set_ball_flag(buf, BALL_SLOT_ATTACHED_TO_DOG, true);
    set_ball_flag(buf, BALL_SLOT_IN_OWNER_POSSESSION, false);
    set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, false);
}

fn snap_ball_to_owner(buf: &mut BallSimBuffer, ctx: &BallStepContext) {
    let heading = finite_or(ctx.owner_heading_rad, 0.0);
    let (sin_h, cos_h) = heading.sin_cos();

    buf.data[BALL_SLOT_POS_X] =
        finite_or(ctx.owner_pos_x, 0.0) + cos_h * BALL_OWNER_HAND_LOCAL_Y;
    buf.data[BALL_SLOT_POS_Y] =
        finite_or(ctx.owner_pos_y, 0.0) + sin_h * BALL_OWNER_HAND_LOCAL_Y;
    buf.data[BALL_SLOT_POS_Z] = BALL_OWNER_HAND_LOCAL_Z;

    for slot in [BALL_SLOT_VEL_X, BALL_SLOT_VEL_Y, BALL_SLOT_VEL_Z] {
        buf.data[slot] = 0.0;
    }
    set_ball_flag(buf, BALL_SLOT_IS_THROWN, false);
    set_ball_flag(buf, BALL_SLOT_IS_CARRIED, false);
    set_ball_flag(buf, BALL_SLOT_ATTACHED_TO_DOG, false);
    set_ball_flag(buf, BALL_SLOT_IN_OWNER_POSSESSION, true);
    set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, false);
}

fn step_thrown_ball_physics(buf: &mut BallSimBuffer, dt_s: f32) -> u32 {
    let mut events = BALL_EVENT_NONE;

    let gravity = ball_config(buf, BALL_SLOT_GRAVITY, BALL_DEFAULT_GRAVITY);
    let drag = ball_config(buf, BALL_SLOT_DRAG_PER_S, BALL_DEFAULT_DRAG_PER_S).max(0.0);
    let restitution = ball_config(
        buf,
        BALL_SLOT_RESTITUTION,
        BALL_DEFAULT_RESTITUTION,
    )
    .clamp(0.0, 1.0);
    let radius = ball_config(buf, BALL_SLOT_RADIUS, BALL_DEFAULT_RADIUS).max(0.01);
    let ground_z = finite_or(buf.data[BALL_SLOT_GROUND_Z], 0.0);
    let ceiling_z = ball_config(buf, BALL_SLOT_CEILING_Z, 1.0e6);
    let max_bounces =
        ball_config(buf, BALL_SLOT_MAX_BOUNCES, BALL_MAX_BOUNCES).max(1.0);
    let settle_eps =
        ball_config(buf, BALL_SLOT_SETTLE_EPS, BALL_SETTLE_EPS_PX_S).max(0.0);

    let min_x = ball_config(buf, BALL_SLOT_FIELD_MIN_X, 0.0);
    let max_x = ball_config(buf, BALL_SLOT_FIELD_MAX_X, 1.0e9);
    let min_y = ball_config(buf, BALL_SLOT_FIELD_MIN_Y, 0.0);
    let max_y = ball_config(buf, BALL_SLOT_FIELD_MAX_Y, 1.0e9);

    let mut x = finite_or(buf.data[BALL_SLOT_POS_X], 0.0);
    let mut y = finite_or(buf.data[BALL_SLOT_POS_Y], 0.0);
    let mut z = finite_or(buf.data[BALL_SLOT_POS_Z], 0.0);
    // Remember whether the ball started below the floor so we can settle it
    // deterministically instead of treating a normal descent as a bounce.
    let started_below_ground = z < ground_z;
    let mut vx = finite_or(buf.data[BALL_SLOT_VEL_X], 0.0);
    let mut vy = finite_or(buf.data[BALL_SLOT_VEL_Y], 0.0);
    let mut vz = finite_or(buf.data[BALL_SLOT_VEL_Z], 0.0);
    let mut age_s = finite_or(buf.data[BALL_SLOT_AGE_S], 0.0) + dt_s;
    let mut bounce_count = finite_or(buf.data[BALL_SLOT_BOUNCE_COUNT], 0.0);
    let mut spin = finite_or(buf.data[BALL_SLOT_SPIN], 0.0);

    age_s = finite_or(age_s, 0.0);
    bounce_count = finite_or(bounce_count, 0.0);

    vz += gravity * dt_s;

    let drag_factor = (1.0 - drag * dt_s).max(0.0);
    vx *= drag_factor;
    vy *= drag_factor;

    x += vx * dt_s;
    y += vy * dt_s;
    z += vz * dt_s;

    let horizontal_speed = (vx * vx + vy * vy).sqrt();
    // Angular spin: horizontal speed divided by the ball radius.
    let angular_velocity = horizontal_speed / radius.max(0.01);
    spin = finite_or(spin + angular_velocity * dt_s, 0.0)
        .rem_euclid(std::f32::consts::TAU);

    // Ceiling clamp with restitution.
    if z > ceiling_z {
        z = ceiling_z;
        if vz > 0.0 {
            vz = -vz * restitution;
            events |= BALL_EVENT_CEILING;
        }
    }

    // Ground bounce / settle.
    if started_below_ground {
        // The ball began below the floor: clamp and settle deterministically
        // without emitting a spurious bounce.
        z = ground_z;
        vz = 0.0;
        vx = 0.0;
        vy = 0.0;
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_IDLE;
        set_ball_flag(buf, BALL_SLOT_IS_THROWN, false);
        set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, false);
        events |= BALL_EVENT_LANDED;
    } else if z <= ground_z {
        z = ground_z;
        if vz < 0.0 {
            bounce_count += 1.0;
            if bounce_count >= max_bounces || (-vz) <= settle_eps {
                vz = 0.0;
                vx = 0.0;
                vy = 0.0;
                buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_IDLE;
                set_ball_flag(buf, BALL_SLOT_IS_THROWN, false);
                set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, false);
                events |= BALL_EVENT_LANDED;
            } else {
                vz = -vz * restitution;
                events |= BALL_EVENT_BOUNCED;
            }
        } else if vz == 0.0 && horizontal_speed <= settle_eps {
            vx = 0.0;
            vy = 0.0;
            buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_IDLE;
            set_ball_flag(buf, BALL_SLOT_IS_THROWN, false);
            set_ball_flag(buf, BALL_SLOT_IS_AIRBORNE, false);
            events |= BALL_EVENT_LANDED;
        }
    }

    // Field bounds: clamp position and kill the outward velocity component.
    if x < min_x {
        x = min_x;
        if vx < 0.0 {
            vx = 0.0;
        }
        events |= BALL_EVENT_OUT_OF_BOUNDS;
    }
    if x > max_x {
        x = max_x;
        if vx > 0.0 {
            vx = 0.0;
        }
        events |= BALL_EVENT_OUT_OF_BOUNDS;
    }
    if y < min_y {
        y = min_y;
        if vy < 0.0 {
            vy = 0.0;
        }
        events |= BALL_EVENT_OUT_OF_BOUNDS;
    }
    if y > max_y {
        y = max_y;
        if vy > 0.0 {
            vy = 0.0;
        }
        events |= BALL_EVENT_OUT_OF_BOUNDS;
    }

    let final_horizontal_speed = (vx * vx + vy * vy).sqrt();
    if ball_state_id(buf) == BALL_STATE_THROWN as u32
        && final_horizontal_speed > 0.001
    {
        events |= BALL_EVENT_AIRBORNE;
    }

    buf.data[BALL_SLOT_POS_X] = finite_or(x, 0.0);
    buf.data[BALL_SLOT_POS_Y] = finite_or(y, 0.0);
    buf.data[BALL_SLOT_POS_Z] = finite_or(z, 0.0);
    buf.data[BALL_SLOT_VEL_X] = finite_or(vx, 0.0);
    buf.data[BALL_SLOT_VEL_Y] = finite_or(vy, 0.0);
    buf.data[BALL_SLOT_VEL_Z] = finite_or(vz, 0.0);
    buf.data[BALL_SLOT_AGE_S] = age_s;
    buf.data[BALL_SLOT_BOUNCE_COUNT] = bounce_count;
    buf.data[BALL_SLOT_SPIN] = finite_or(spin, 0.0);
    set_ball_flag(
        buf,
        BALL_SLOT_IS_AIRBORNE,
        z > ground_z + 0.001 && ball_state_id(buf) == BALL_STATE_THROWN as u32,
    );

    events
}

/// Advance the persistent ball buffer by one tick.
///
/// Command priority is strict:
/// `RESET > THROW > DROP > ATTACH_TO_DOG > RETRIEVE_BY_OWNER > SET_POSITION`.
/// Only the highest-priority command is executed; all command flags are
/// cleared after a normal step. The function allocates nothing.
pub fn step_ball_buffer(
    buf: &mut BallSimBuffer,
    ctx: &BallStepContext,
    dt_s: f32,
) -> u32 {
    if !dt_s.is_finite() || dt_s <= 0.0 {
        return BALL_EVENT_CMD_REJECTED;
    }

    init_ball_config_once(buf);

    let mut events = BALL_EVENT_NONE;
    let commands = ball_read_u32(buf.data[BALL_SLOT_COMMAND_FLAGS]);

    if commands != 0 {
        if commands & BALL_CMD_RESET != 0 {
            apply_ball_reset(buf);
            events |= BALL_EVENT_RESET;
        } else if commands & BALL_CMD_THROW != 0 {
            apply_ball_throw(buf);
            events |= BALL_EVENT_THROWN;
        } else if commands & BALL_CMD_DROP != 0 {
            let state = ball_state_id(buf);
            if state == BALL_STATE_CARRIED as u32
                || state == BALL_STATE_DOG_POSSESSION as u32
            {
                apply_ball_drop(buf);
                events |= BALL_EVENT_DROPPED | BALL_EVENT_THROWN;
            } else {
                events |= BALL_EVENT_CMD_REJECTED;
            }
        } else if commands & BALL_CMD_ATTACH_TO_DOG != 0 {
            let state = ball_state_id(buf);
            if state == BALL_STATE_OWNER_POSSESSION as u32 {
                events |= BALL_EVENT_CMD_REJECTED;
            } else {
                apply_ball_attach_to_dog(buf);
                events |= BALL_EVENT_ATTACHED_TO_DOG;
            }
        } else if commands & BALL_CMD_RETRIEVE_BY_OWNER != 0 {
            apply_ball_retrieve_by_owner(buf);
            events |= BALL_EVENT_RETRIEVED_BY_OWNER;
        } else if commands & BALL_CMD_SET_POSITION != 0 {
            buf.data[BALL_SLOT_POS_X] = finite_or(buf.data[BALL_SLOT_POS_X], 0.0);
            buf.data[BALL_SLOT_POS_Y] = finite_or(buf.data[BALL_SLOT_POS_Y], 0.0);
            buf.data[BALL_SLOT_POS_Z] = finite_or(buf.data[BALL_SLOT_POS_Z], 0.0);
        }

        buf.data[BALL_SLOT_COMMAND_FLAGS] = 0.0;
    }

    let state = ball_state_id(buf);
    if state == BALL_STATE_CARRIED as u32
        || state == BALL_STATE_DOG_POSSESSION as u32
    {
        snap_ball_to_dog(buf, ctx);
    } else if state == BALL_STATE_OWNER_POSSESSION as u32 {
        snap_ball_to_owner(buf, ctx);
    } else if state == BALL_STATE_THROWN as u32 {
        events |= step_thrown_ball_physics(buf, dt_s);
    }

    buf.data[BALL_SLOT_LAST_EVENT_MASK] = events as f32;
    events
}

/// Stateless 2.5D tennis-ball integration step (one ball per call; safe for any number of
/// local/remote balls). Returns `[x, y, z, vx, vy, vz]`.
///
/// This is a thin compatibility wrapper around [`step_ball_buffer`]: it packs
/// the incoming state into a stack-allocated [`BallSimBuffer`], runs one
/// buffer step, and unpacks the result. No heap allocation occurs.
pub fn step_toy_ball(
    state: [f64; 6],
    dt: f64,
    world_w: f64,
    world_h: f64,
) -> [f64; 6] {
    let [x, y, z, vx, vy, vz] = state;

    let mut buf = BallSimBuffer::default();
    buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
    buf.data[BALL_SLOT_POS_X] = x as f32;
    buf.data[BALL_SLOT_POS_Y] = y as f32;
    buf.data[BALL_SLOT_POS_Z] = z as f32;
    buf.data[BALL_SLOT_VEL_X] = vx as f32;
    buf.data[BALL_SLOT_VEL_Y] = vy as f32;
    buf.data[BALL_SLOT_VEL_Z] = vz as f32;

    // Configure the buffer to match the legacy toy-ball tuning.
    buf.data[BALL_SLOT_GRAVITY] = -TOY_GRAVITY as f32;
    buf.data[BALL_SLOT_RESTITUTION] = TOY_RESTITUTION as f32;
    // Map the legacy per-step ground friction onto the buffer's per-second
    // drag model: factor = 1 - drag*dt, so drag = (1 - friction) / dt.
    buf.data[BALL_SLOT_DRAG_PER_S] = ((1.0 - TOY_FRICTION) * 60.0) as f32;
    buf.data[BALL_SLOT_GROUND_Z] = 0.0;
    buf.data[BALL_SLOT_CEILING_Z] = 1.0e6;
    buf.data[BALL_SLOT_MAX_BOUNCES] = 1.0e6;
    buf.data[BALL_SLOT_SETTLE_EPS] = TOY_BOUNCE_THRESHOLD as f32;
    buf.data[BALL_SLOT_FIELD_MIN_X] = TOY_BOUNDARY_MARGIN as f32;
    buf.data[BALL_SLOT_FIELD_MAX_X] = (world_w - TOY_BOUNDARY_MARGIN) as f32;
    buf.data[BALL_SLOT_FIELD_MIN_Y] = TOY_BOUNDARY_MARGIN as f32;
    buf.data[BALL_SLOT_FIELD_MAX_Y] = (world_h - TOY_BOUNDARY_MARGIN) as f32;

    let ctx = BallStepContext::default();
    let _ = step_ball_buffer(&mut buf, &ctx, dt as f32);

    [
        buf.data[BALL_SLOT_POS_X] as f64,
        buf.data[BALL_SLOT_POS_Y] as f64,
        buf.data[BALL_SLOT_POS_Z] as f64,
        buf.data[BALL_SLOT_VEL_X] as f64,
        buf.data[BALL_SLOT_VEL_Y] as f64,
        buf.data[BALL_SLOT_VEL_Z] as f64,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ball_trajectory_and_ground_bounce() {
        let mut sim = BallSim::new();
        sim.throw_toward(100.0, 100.0, 200.0, 100.0, 0.8);
        assert!(sim.state.is_moving);
        assert_eq!(sim.state.z, 18.0);
        assert!(sim.state.vz > 0.0);

        let mut bounced = false;
        // Step 1 second
        for _ in 0..60 {
            if sim.step(1.0 / 60.0, 2000.0, 2000.0, &[]) {
                bounced = true;
            }
        }
        assert!(bounced);
        assert!(sim.state.bounce_count > 0);
        assert!(sim.state.x > 100.0);
    }

    #[test]
    fn test_ball_eventually_comes_to_rest() {
        let mut sim = BallSim::new();
        sim.throw_toward(100.0, 100.0, 150.0, 100.0, 0.3);

        for _ in 0..300 {
            sim.step(1.0 / 60.0, 2000.0, 2000.0, &[]) ;
            if !sim.state.is_moving {
                break;
            }
        }
        assert!(!sim.state.is_moving);
        assert_eq!(sim.state.z, 0.0);
        assert_eq!(sim.state.vx, 0.0);
    }

    #[test]
    fn test_ball_obstacle_deflection() {
        let mut sim = BallSim::new();
        sim.throw_toward(100.0, 100.0, 200.0, 100.0, 0.5);
        // Place collider in front of ball
        let colliders = vec![Collider { x: 150.0, y: 100.0, r: 15.0 }];
        let mut hit = false;
        for _ in 0..60 {
            if sim.step(1.0 / 60.0, 2000.0, 2000.0, &colliders) {
                hit = true;
            }
        }
        assert!(hit);
        // vx should have reversed direction or deflected away
        assert!(sim.state.vx <= 0.0 || sim.state.x < 150.0);
    }

    #[test]
    fn test_toy_ball_gravity_and_bounce_restitution() {
        // Launch up from the ground; first descent through z<=0 must bounce with restitution.
        let mut st = [500.0, 500.0, 12.0, 100.0, 0.0, 180.0];
        let mut bounced = false;
        for _ in 0..240 {
            let before_vz = st[5];
            st = step_toy_ball(st, 1.0 / 60.0, 3200.0, 2400.0);
            if st[2] == 0.0 && before_vz < -40.0 {
                assert!(st[5] > 0.0);
                bounced = true;
                break;
            }
        }
        assert!(bounced);
    }

    #[test]
    fn test_toy_ball_rolling_friction_decay() {
        // Airborne drag decay: the wrapper maps legacy friction onto the
        // buffer's per-second drag model, so horizontal velocity decays by
        // ~TOY_FRICTION per 1/60s step while the ball is in the air.
        let mut st = [500.0, 500.0, 500.0, 100.0, 0.0, 0.0];
        let v0 = st[3];
        st = step_toy_ball(st, 1.0 / 60.0, 3200.0, 2400.0);
        assert!(st[3] < v0 && st[3] > 0.0);
        // The buffer drag model applies `1 - drag*dt` per step; the wrapper
        // maps legacy friction onto that model, so the decay matches within
        // f32 precision.
        assert!((st[3] - v0 * TOY_FRICTION).abs() < 1e-3);
    }

    #[test]
    fn test_toy_ball_world_boundary_clamps_and_zeroes_velocity() {
        // The unified buffer clamps to the field bounds and zeroes the outward
        // velocity component (rather than reflecting).
        let st = step_toy_ball([71.0, 500.0, 0.0, -300.0, 0.0, 0.0], 1.0 / 60.0, 3200.0, 2400.0);
        assert_eq!(st[0], 70.0);
        assert_eq!(st[3], 0.0);
        let st = step_toy_ball([500.0, 2400.0 - 71.0, 0.0, 0.0, 300.0, 0.0], 1.0 / 60.0, 3200.0, 2400.0);
        assert_eq!(st[1], 2400.0 - 70.0);
        assert_eq!(st[4], 0.0);
    }

    #[test]
    fn test_toy_ball_is_stateless_and_independent() {
        let a = step_toy_ball([100.0, 100.0, 50.0, 10.0, 20.0, 0.0], 0.016, 3200.0, 2400.0);
        let _ = step_toy_ball([900.0, 900.0, 5.0, -80.0, 40.0, 100.0], 0.016, 3200.0, 2400.0);
        let a2 = step_toy_ball([100.0, 100.0, 50.0, 10.0, 20.0, 0.0], 0.016, 3200.0, 2400.0);
        assert_eq!(a, a2);
    }

    fn buffer_test_context() -> BallStepContext {
        BallStepContext {
            dog_pos_x: 100.0,
            dog_pos_y: 100.0,
            dog_heading_rad: 0.0,
            owner_pos_x: 200.0,
            owner_pos_y: 300.0,
            owner_heading_rad: 0.0,
        }
    }

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 0.01
    }

    #[test]
    fn ball_buffer_rejects_zero_and_nan_dt_without_state_change() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_CARRIED;
        buf.data[BALL_SLOT_POS_X] = 12.0;
        let before = buf.data;

        let mask = step_ball_buffer(&mut buf, &ctx, 0.0);
        assert!(mask & BALL_EVENT_CMD_REJECTED != 0);
        assert_eq!(buf.data, before);

        let mask = step_ball_buffer(&mut buf, &ctx, f32::NAN);
        assert!(mask & BALL_EVENT_CMD_REJECTED != 0);
        assert_eq!(buf.data, before);
    }

    #[test]
    fn ball_buffer_throw_sets_thrown_state_and_event() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_IDLE;
        buf.data[BALL_SLOT_POS_Z] = 20.0;
        buf.data[BALL_SLOT_VEL_X] = 120.0;
        buf.data[BALL_SLOT_VEL_Z] = 180.0;
        buf.data[BALL_SLOT_COMMAND_FLAGS] = BALL_CMD_THROW as f32;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_THROWN != 0);
        assert_eq!(buf.data[BALL_SLOT_STATE_ID], BALL_STATE_THROWN);
        assert_eq!(buf.data[BALL_SLOT_COMMAND_FLAGS], 0.0);
        assert_eq!(buf.data[BALL_SLOT_IS_THROWN], 1.0);
    }

    #[test]
    fn ball_buffer_drop_from_carried_enters_thrown_state() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_CARRIED;
        buf.data[BALL_SLOT_POS_Z] = 10.0;
        buf.data[BALL_SLOT_COMMAND_FLAGS] = BALL_CMD_DROP as f32;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_DROPPED != 0);
        assert!(mask & BALL_EVENT_THROWN != 0);
        assert_eq!(buf.data[BALL_SLOT_STATE_ID], BALL_STATE_THROWN);
        assert_eq!(buf.data[BALL_SLOT_COMMAND_FLAGS], 0.0);
    }

    #[test]
    fn ball_buffer_attach_snaps_to_dog_mouth() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_IDLE;
        buf.data[BALL_SLOT_COMMAND_FLAGS] = BALL_CMD_ATTACH_TO_DOG as f32;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_ATTACHED_TO_DOG != 0);
        assert_eq!(buf.data[BALL_SLOT_STATE_ID], BALL_STATE_CARRIED);
        assert_eq!(buf.data[BALL_SLOT_IS_CARRIED], 1.0);
        assert_eq!(buf.data[BALL_SLOT_ATTACHED_TO_DOG], 1.0);
        assert!(approx_eq(
            buf.data[BALL_SLOT_POS_X],
            ctx.dog_pos_x + BALL_DOG_MOUTH_LOCAL_Y
        ));
        assert!(approx_eq(buf.data[BALL_SLOT_POS_Y], ctx.dog_pos_y));
        assert!(approx_eq(buf.data[BALL_SLOT_POS_Z], BALL_DOG_MOUTH_LOCAL_Z));
        assert_eq!(buf.data[BALL_SLOT_VEL_X], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_Y], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_Z], 0.0);
    }

    #[test]
    fn ball_buffer_attach_from_owner_is_rejected() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_OWNER_POSSESSION;
        buf.data[BALL_SLOT_COMMAND_FLAGS] = BALL_CMD_ATTACH_TO_DOG as f32;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_CMD_REJECTED != 0);
        assert!(mask & BALL_EVENT_ATTACHED_TO_DOG == 0);
        assert_eq!(
            buf.data[BALL_SLOT_STATE_ID],
            BALL_STATE_OWNER_POSSESSION
        );
        assert_eq!(buf.data[BALL_SLOT_COMMAND_FLAGS], 0.0);
    }

    #[test]
    fn ball_buffer_retrieve_snaps_to_owner_hand() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_IDLE;
        buf.data[BALL_SLOT_COMMAND_FLAGS] = BALL_CMD_RETRIEVE_BY_OWNER as f32;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_RETRIEVED_BY_OWNER != 0);
        assert_eq!(buf.data[BALL_SLOT_STATE_ID], BALL_STATE_OWNER_POSSESSION);
        assert_eq!(buf.data[BALL_SLOT_IN_OWNER_POSSESSION], 1.0);
        assert!(approx_eq(
            buf.data[BALL_SLOT_POS_X],
            ctx.owner_pos_x + BALL_OWNER_HAND_LOCAL_Y
        ));
        assert!(approx_eq(buf.data[BALL_SLOT_POS_Y], ctx.owner_pos_y));
        assert!(approx_eq(buf.data[BALL_SLOT_POS_Z], BALL_OWNER_HAND_LOCAL_Z));
        assert_eq!(buf.data[BALL_SLOT_VEL_X], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_Y], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_Z], 0.0);
    }

    #[test]
    fn ball_buffer_reset_clears_kinematics_and_flags() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
        buf.data[BALL_SLOT_POS_X] = 5.0;
        buf.data[BALL_SLOT_VEL_X] = 9.0;
        buf.data[BALL_SLOT_BOUNCE_COUNT] = 3.0;
        buf.data[BALL_SLOT_AGE_S] = 1.5;
        buf.data[BALL_SLOT_COMMAND_FLAGS] = BALL_CMD_RESET as f32;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_RESET != 0);
        assert_eq!(buf.data[BALL_SLOT_STATE_ID], BALL_STATE_IDLE);
        assert_eq!(buf.data[BALL_SLOT_POS_X], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_X], 0.0);
        assert_eq!(buf.data[BALL_SLOT_BOUNCE_COUNT], 0.0);
        assert_eq!(buf.data[BALL_SLOT_AGE_S], 0.0);
        assert_eq!(buf.data[BALL_SLOT_COMMAND_FLAGS], 0.0);
    }

    #[test]
    fn ball_buffer_thrown_ball_bounces_then_lands() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
        buf.data[BALL_SLOT_POS_X] = 100.0;
        buf.data[BALL_SLOT_POS_Y] = 100.0;
        buf.data[BALL_SLOT_POS_Z] = 50.0;

        let mut saw_landed = false;
        for _ in 0..2000 {
            let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);
            if mask & BALL_EVENT_LANDED != 0 {
                saw_landed = true;
                break;
            }
        }

        assert!(saw_landed);
        assert_eq!(buf.data[BALL_SLOT_STATE_ID], BALL_STATE_IDLE);
        // The ball settles once its vertical speed drops below the settle
        // epsilon, which can happen before reaching the max bounce count.
        assert!(buf.data[BALL_SLOT_BOUNCE_COUNT] > 0.0);
        assert_eq!(buf.data[BALL_SLOT_POS_Z], 0.0);
    }

    #[test]
    fn ball_buffer_ball_below_floor_clamps_and_bounces_or_lands() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
        buf.data[BALL_SLOT_POS_Z] = -5.0;
        buf.data[BALL_SLOT_VEL_Z] = -100.0;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(buf.data[BALL_SLOT_POS_Z] >= 0.0);
        assert!(
            mask & (BALL_EVENT_BOUNCED | BALL_EVENT_LANDED) != 0,
            "expected bounce or land, got {:#x}",
            mask
        );
        assert!(buf.data[BALL_SLOT_POS_Z].is_finite());
    }

    #[test]
    fn ball_buffer_out_of_bounds_clamps_and_zeroes_outward_velocity() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
        buf.data[BALL_SLOT_POS_X] = 150.0;
        buf.data[BALL_SLOT_POS_Y] = 100.0;
        buf.data[BALL_SLOT_POS_Z] = 50.0;
        buf.data[BALL_SLOT_VEL_X] = 200.0;
        buf.data[BALL_SLOT_FIELD_MIN_X] = 100.0;
        buf.data[BALL_SLOT_FIELD_MAX_X] = 120.0;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_OUT_OF_BOUNDS != 0);
        assert_eq!(buf.data[BALL_SLOT_POS_X], 120.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_X], 0.0);
    }

    #[test]
    fn ball_buffer_below_ground_settles_without_bounce() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
        buf.data[BALL_SLOT_POS_Z] = -5.0;
        buf.data[BALL_SLOT_VEL_Z] = -100.0;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_LANDED != 0, "expected LANDED, got {:#x}", mask);
        assert!(
            mask & BALL_EVENT_BOUNCED == 0,
            "must not emit BOUNCED when already below floor, got {:#x}",
            mask
        );
        assert_eq!(buf.data[BALL_SLOT_STATE_ID], BALL_STATE_IDLE);
        assert_eq!(buf.data[BALL_SLOT_POS_Z], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_Z], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_X], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_Y], 0.0);
    }

    #[test]
    fn ball_buffer_honors_zero_valued_config() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
        buf.data[BALL_SLOT_POS_X] = 100.0;
        buf.data[BALL_SLOT_POS_Y] = 100.0;
        buf.data[BALL_SLOT_POS_Z] = 50.0;
        buf.data[BALL_SLOT_VEL_X] = 100.0;
        buf.data[BALL_SLOT_VEL_Z] = 0.0;

        // Mark config as initialized so valid 0.0 values are honored.
        buf.data[BALL_SLOT_CONFIG_FLAGS] = BALL_CONFIG_FLAGS_INITIALIZED;
        buf.data[BALL_SLOT_GRAVITY] = 0.0;
        buf.data[BALL_SLOT_DRAG_PER_S] = 0.0;
        buf.data[BALL_SLOT_RESTITUTION] = 0.0;
        buf.data[BALL_SLOT_CEILING_Z] = 1.0e6;
        buf.data[BALL_SLOT_FIELD_MIN_X] = 0.0;
        buf.data[BALL_SLOT_FIELD_MAX_X] = 0.0;
        buf.data[BALL_SLOT_FIELD_MIN_Y] = 0.0;
        buf.data[BALL_SLOT_FIELD_MAX_Y] = 0.0;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        // Zero gravity: vz stays 0, z stays 50 (no fall).
        assert_eq!(buf.data[BALL_SLOT_VEL_Z], 0.0);
        assert!(approx_eq(buf.data[BALL_SLOT_POS_Z], 50.0));
        // Zero drag: vx is not decayed by drag before the field clamp.
        // Zero field bounds clamp x/y to 0 and zero the outward velocity.
        assert_eq!(buf.data[BALL_SLOT_POS_X], 0.0);
        assert_eq!(buf.data[BALL_SLOT_POS_Y], 0.0);
        assert_eq!(buf.data[BALL_SLOT_VEL_X], 0.0);
        assert!(mask & BALL_EVENT_OUT_OF_BOUNDS != 0);
    }

    #[test]
    fn ball_buffer_spin_uses_radius() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_THROWN;
        buf.data[BALL_SLOT_POS_X] = 100.0;
        buf.data[BALL_SLOT_POS_Y] = 100.0;
        buf.data[BALL_SLOT_POS_Z] = 50.0;
        buf.data[BALL_SLOT_VEL_X] = 10.0;
        buf.data[BALL_SLOT_RADIUS] = 2.0;
        buf.data[BALL_SLOT_CONFIG_FLAGS] = BALL_CONFIG_FLAGS_INITIALIZED;
        buf.data[BALL_SLOT_GRAVITY] = 0.0;
        buf.data[BALL_SLOT_DRAG_PER_S] = 0.0;
        buf.data[BALL_SLOT_FIELD_MIN_X] = 0.0;
        buf.data[BALL_SLOT_FIELD_MAX_X] = 1000.0;
        buf.data[BALL_SLOT_FIELD_MIN_Y] = 0.0;
        buf.data[BALL_SLOT_FIELD_MAX_Y] = 1000.0;

        let dt = 1.0 / 60.0;
        step_ball_buffer(&mut buf, &ctx, dt);

        // spin = horizontal_speed / radius * dt = 10 / 2 * dt = 5 * dt
        let expected = (10.0_f32 / 2.0) * dt;
        assert!(approx_eq(buf.data[BALL_SLOT_SPIN], expected));
    }

    #[test]
    fn ball_buffer_command_priority_is_strict_and_flags_are_cleared() {
        let ctx = buffer_test_context();
        let mut buf = BallSimBuffer::default();
        buf.data[BALL_SLOT_STATE_ID] = BALL_STATE_IDLE;
        buf.data[BALL_SLOT_POS_X] = 5.0;
        buf.data[BALL_SLOT_COMMAND_FLAGS] =
            (BALL_CMD_RESET | BALL_CMD_THROW) as f32;

        let mask = step_ball_buffer(&mut buf, &ctx, 1.0 / 60.0);

        assert!(mask & BALL_EVENT_RESET != 0);
        assert!(mask & BALL_EVENT_THROWN == 0);
        assert_eq!(buf.data[BALL_SLOT_STATE_ID], BALL_STATE_IDLE);
        assert_eq!(buf.data[BALL_SLOT_POS_X], 0.0);
        assert_eq!(buf.data[BALL_SLOT_COMMAND_FLAGS], 0.0);
    }
}
