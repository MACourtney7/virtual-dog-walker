//! Pure Rust owner simulation: locomotion, gait matrix, wander autopilot,
//! collision response, warp gates, and leash kinematics.
//!
//! All state lives inside the persistent 64-slot [`OwnerSimBuffer`].
//! [`step_owner_buffer`] mutates that buffer in place and never allocates.
//!
//! See `openspec/changes/unification-046/spec.md` for the locked contract.

use std::f32::consts::PI;

use crate::collision::{resolve_field_collisions, WorldObstacle};
use crate::math::Mulberry32;
use crate::world_contract::OwnerSimBuffer;

// ---------------------------------------------------------------------------
// Buffer slot layout (usize indices within 0..63).
// ---------------------------------------------------------------------------

pub const OWNER_SLOT_X: usize = 0;
pub const OWNER_SLOT_Y: usize = 1;
pub const OWNER_SLOT_VX: usize = 2;
pub const OWNER_SLOT_VY: usize = 3;
pub const OWNER_SLOT_ANGLE: usize = 4;
pub const OWNER_SLOT_SPEED: usize = 5;
pub const OWNER_SLOT_GAIT: usize = 6;
pub const OWNER_SLOT_WALK_PHASE: usize = 7;
pub const OWNER_SLOT_INPUT_X: usize = 8;
pub const OWNER_SLOT_INPUT_Y: usize = 9;
pub const OWNER_SLOT_CMD_FLAGS: usize = 10;
pub const OWNER_SLOT_EVENT_BITMASK: usize = 11;
pub const OWNER_SLOT_STEP_OFF_TIMER: usize = 12;
pub const OWNER_SLOT_JOG_TIMER: usize = 13;
pub const OWNER_SLOT_JOG_COOLDOWN: usize = 14;
pub const OWNER_SLOT_WANDER_HEADING: usize = 15;
pub const OWNER_SLOT_WANDER_TIMER: usize = 16;
pub const OWNER_SLOT_RNG_HI: usize = 17;
pub const OWNER_SLOT_RNG_LO: usize = 18;
pub const OWNER_SLOT_LAST_SAFE_X: usize = 19;
pub const OWNER_SLOT_LAST_SAFE_Y: usize = 20;
pub const OWNER_SLOT_LEASH_TENSION: usize = 21;
pub const OWNER_SLOT_LEASH_TAUT: usize = 22;
pub const OWNER_SLOT_HAND_LOCAL_X: usize = 23;
pub const OWNER_SLOT_HAND_LOCAL_Y: usize = 24;
pub const OWNER_SLOT_WARP_GATE_ID: usize = 25;
pub const OWNER_SLOT_DOG_REL_X: usize = 26;
pub const OWNER_SLOT_DOG_REL_Y: usize = 27;
pub const OWNER_SLOT_PREV_GAIT: usize = 28;
pub const OWNER_SLOT_DIST_TRAVELED: usize = 29;
pub const OWNER_SLOT_DT: usize = 30;
pub const OWNER_SLOT_WANDER_BLOCKED: usize = 31;
pub const OWNER_SLOT_STEP_COUNT: usize = 32;
pub const OWNER_SLOT_LAST_STEP_DT: usize = 33;
pub const OWNER_SLOT_DESIRED_GAIT: usize = 34;
pub const OWNER_SLOT_SPEED_MULTIPLIER: usize = 35;
pub const OWNER_SLOT_WARP_COOLDOWN: usize = 36;
pub const OWNER_SLOT_POOP_HOLD_TIMER: usize = 37;
pub const OWNER_SLOT_WALK_CYCLE: usize = 38;
pub const OWNER_SLOT_FACE_DOG_LATCH: usize = 39;

// ---------------------------------------------------------------------------
// Gait ids (locked by unification-046/spec.md).
// ---------------------------------------------------------------------------

pub const OWNER_GAIT_STAND: u32 = 0;
pub const OWNER_GAIT_STROLL: u32 = 1;
pub const OWNER_GAIT_WALK: u32 = 2;
pub const OWNER_GAIT_JOG: u32 = 3;
pub const OWNER_GAIT_WANDER: u32 = 4;

/// Highest valid gait id.
pub const OWNER_GAIT_MAX: u32 = OWNER_GAIT_WANDER;

// ---------------------------------------------------------------------------
// Command flags (buffer slot `OWNER_SLOT_CMD_FLAGS`, cleared each step).
// ---------------------------------------------------------------------------

pub const OWNER_CMD_NONE: u32 = 0;
pub const OWNER_CMD_RESET: u32 = 1 << 0;
pub const OWNER_CMD_STOP: u32 = 1 << 1;
pub const OWNER_CMD_JOG: u32 = 1 << 2;
pub const OWNER_CMD_WALK: u32 = 1 << 3;
pub const OWNER_CMD_STROLL: u32 = 1 << 4;
pub const OWNER_CMD_WANDER: u32 = 1 << 5;
pub const OWNER_CMD_CLEAR_WANDER: u32 = 1 << 6;
pub const OWNER_CMD_FACE_DOG: u32 = 1 << 7;
pub const OWNER_CMD_CLEAR_FACE_DOG: u32 = 1 << 8;

// ---------------------------------------------------------------------------
// Event bits returned from `step_owner_buffer`.
// ---------------------------------------------------------------------------

pub const OWNER_EVENT_RESET: u32 = 1 << 0;
pub const OWNER_EVENT_GAIT_CHANGED: u32 = 1 << 1;
pub const OWNER_EVENT_COMMAND_REJECTED: u32 = 1 << 2;
pub const OWNER_EVENT_STEP_OFF_STARTED: u32 = 1 << 3;
pub const OWNER_EVENT_STEP_OFF_FINISHED: u32 = 1 << 4;
pub const OWNER_EVENT_WANDER_STARTED: u32 = 1 << 5;
pub const OWNER_EVENT_WANDER_BLOCKED: u32 = 1 << 6;
pub const OWNER_EVENT_BOUNDARY_BLOCKED: u32 = 1 << 7;
pub const OWNER_EVENT_OBSTACLE_DEFLECTED: u32 = 1 << 8;
pub const OWNER_EVENT_WARP_GATE_ENTERED: u32 = 1 << 9;
pub const OWNER_EVENT_WARP_GATE_EXITED: u32 = 1 << 10;
pub const OWNER_EVENT_POOP_HOLD: u32 = 1 << 11;
pub const OWNER_EVENT_LEASH_FORCED_STAND: u32 = 1 << 12;
pub const OWNER_EVENT_WALK_CYCLE: u32 = 1 << 13;
pub const OWNER_EVENT_JOG_COOLDOWN_READY: u32 = 1 << 14;
pub const OWNER_EVENT_JOG_STARTED: u32 = 1 << 15;
pub const OWNER_EVENT_LEASH_TAUT: u32 = 1 << 16;
pub const OWNER_EVENT_LEASH_SLACK: u32 = 1 << 17;

// ---------------------------------------------------------------------------
// Locked constants.
// ---------------------------------------------------------------------------

/// Legacy dt clamp constant. Retained for API compatibility; valid positive
/// `dt_s` values are honored as-is (no upper clamp).
pub const OWNER_DT_MAX: f32 = 0.1;

// Locked gait matrix (unification-046/spec.md).
pub const STAND_SPEED: f32 = 0.0;
pub const STAND_TURN_RATE: f32 = PI;
pub const STROLL_SPEED: f32 = 75.0;
pub const STROLL_TURN_RATE: f32 = PI;
pub const WALK_SPEED: f32 = 100.0;
pub const WALK_TURN_RATE: f32 = 115.0 * PI / 180.0;
pub const JOG_SPEED: f32 = 185.0;
pub const JOG_TURN_RATE: f32 = 65.0 * PI / 180.0;
pub const WANDER_SPEED: f32 = 60.0;
pub const WANDER_TURN_RATE: f32 = PI * 1.4;

pub const JOG_DURATION_S: f32 = 2.0;
pub const JOG_COOLDOWN_S: f32 = 2.0;
pub const STEP_OFF_MAX_S: f32 = 0.5;
/// Public alias for the locked step-off duration.
pub const STEP_OFF_MAX_DURATION_S: f32 = STEP_OFF_MAX_S;
pub const STEP_OFF_ALIGN_TOLERANCE_RAD: f32 = 5.0 * PI / 180.0;
pub const STEP_OFF_TURN_RATE_RAD_S: f32 = 300.0 * PI / 180.0;

pub const WANDER_MAX_TURN_RATE_RAD_S: f32 = PI * 1.4;

pub const MAX_LEASH_LENGTH_PX: f32 = 52.5;
/// Backwards-compatible alias.
pub const MAX_LEASH_LENGTH: f32 = MAX_LEASH_LENGTH_PX;

pub const WANDER_LOOKAHEAD: f32 = 120.0;
/// Public alias for the locked wander lookahead distance.
pub const WANDER_LOOKAHEAD_PX: f32 = WANDER_LOOKAHEAD;
pub const WANDER_REFRESH_S: f32 = 1.0;
pub const WANDER_RAY_SPREAD: f32 = PI / 6.0;

pub const OWNER_BODY_RADIUS: f32 = 14.0;
/// Public alias for the locked owner body radius.
pub const OWNER_RADIUS_PX: f32 = OWNER_BODY_RADIUS;

pub const LEASH_HAND_POOP_X: f32 = -12.0;
pub const LEASH_HAND_POOP_Y: f32 = 0.0;
pub const LEASH_HAND_FORWARD_X: f32 = 18.0;
pub const LEASH_HAND_FORWARD_Y: f32 = 4.0;

/// Public alias: forward heel hand offset (x).
pub const LEASH_HEEL_FORWARD_X: f32 = LEASH_HAND_FORWARD_X;
/// Public alias: forward heel hand offset (y).
pub const LEASH_HEEL_RIGHT_Y: f32 = LEASH_HAND_FORWARD_Y;
/// Public alias: hip-behind hand offset (x).
pub const LEASH_HIP_BEHIND_X: f32 = LEASH_HAND_POOP_X;
/// Public alias: hip-behind hand offset (y).
pub const LEASH_HIP_RIGHT_Y: f32 = LEASH_HAND_POOP_Y;

pub const REAR_BRAKE_ARC_RADIUS: f32 = 26.0;
pub const REAR_BRAKE_ARC_HALF_ANGLE: f32 = PI * 0.5;

pub const WALK_STRIDE_BASE_HZ: f32 = 4.0;
pub const WALK_STRIDE_REF_SPEED: f32 = 265.0;
pub const WALK_STRIDE_SWING_HZ: f32 = 8.0;
/// Public alias for the stride speed divisor.
pub const WALK_STRIDE_SPEED_DIVISOR: f32 = WALK_STRIDE_REF_SPEED;
/// Public alias for the stride swing gain.
pub const WALK_STRIDE_GAIN_HZ: f32 = WALK_STRIDE_SWING_HZ;

pub const WARP_COOLDOWN_S: f32 = 1.0;

// ---------------------------------------------------------------------------
// Runtime types.
// ---------------------------------------------------------------------------

/// A warp gate the owner can walk onto. Entering a gate automatically warps
/// the owner to the next gate in the list (wrapping around).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WarpGate {
    pub id: u16,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
}

/// Per-tick inputs that cannot be derived from the persistent buffer.
pub struct OwnerStepInput<'a> {
    pub dt_s: f32,
    /// Dog world position.
    pub dog_pos_x: f32,
    pub dog_pos_y: f32,
    /// Dog heading in radians.
    pub dog_heading_rad: f32,
    /// Walkable field bounds (inclusive).
    pub field_min_x: f32,
    pub field_min_y: f32,
    pub field_max_x: f32,
    pub field_max_y: f32,
    pub dog_is_pooping: bool,
    pub warp_gates: &'a [WarpGate],
    pub obstacles: &'a [WorldObstacle],
}

// ---------------------------------------------------------------------------
// Gait matrix.
// ---------------------------------------------------------------------------

/// Coerce an arbitrary gait id to a valid one. Invalid ids become `STAND`
/// in release; debug builds assert.
pub fn coerce_gait(gait: u32) -> u32 {
    if gait <= OWNER_GAIT_MAX {
        gait
    } else {
        debug_assert!(false, "invalid owner gait id: {}", gait);
        OWNER_GAIT_STAND
    }
}

pub fn gait_speed(gait: u32) -> f32 {
    match coerce_gait(gait) {
        OWNER_GAIT_STROLL => STROLL_SPEED,
        OWNER_GAIT_WALK => WALK_SPEED,
        OWNER_GAIT_JOG => JOG_SPEED,
        OWNER_GAIT_WANDER => WANDER_SPEED,
        _ => STAND_SPEED,
    }
}

pub fn gait_turn_rate(gait: u32) -> f32 {
    match coerce_gait(gait) {
        OWNER_GAIT_STROLL => STROLL_TURN_RATE,
        OWNER_GAIT_WALK => WALK_TURN_RATE,
        OWNER_GAIT_JOG => JOG_TURN_RATE,
        OWNER_GAIT_WANDER => WANDER_TURN_RATE,
        _ => STAND_TURN_RATE,
    }
}

/// Locked walk cadence: `4.0 + (speed / 265.0) * 8.0`.
pub fn walk_stride_hz(speed: f32) -> f32 {
    WALK_STRIDE_BASE_HZ + (speed.max(0.0) / WALK_STRIDE_REF_SPEED) * WALK_STRIDE_SWING_HZ
}

// ---------------------------------------------------------------------------
// Leash + hit-test helpers.
// ---------------------------------------------------------------------------

/// Local-space position of the leash hand relative to the owner.
///
/// The owner frame uses `+x = forward`, `+y = right`. While pooping (or when
/// the dog is well behind the owner) the hand is held behind; otherwise it
/// rests in a forward heel.
pub fn compute_leash_hand_local(dog_rel_x: f32, dog_is_pooping: bool) -> (f32, f32) {
    if dog_is_pooping || dog_rel_x < -2.0 {
        (LEASH_HAND_POOP_X, LEASH_HAND_POOP_Y)
    } else {
        (LEASH_HAND_FORWARD_X, LEASH_HAND_FORWARD_Y)
    }
}

/// True when `(point_x, point_y)` falls inside the owner body circle.
pub fn is_point_on_player(
    point_x: f32,
    point_y: f32,
    owner_x: f32,
    owner_y: f32,
    radius: f32,
) -> bool {
    if !radius.is_finite() || radius < 0.0 {
        return false;
    }
    let dx = point_x - owner_x;
    let dy = point_y - owner_y;
    let d2 = dx * dx + dy * dy;
    d2 <= radius * radius
}

/// True when a point lies inside the rear brake arc behind the owner.
pub fn is_point_on_rear_brake_arc(
    point_x: f32,
    point_y: f32,
    owner_x: f32,
    owner_y: f32,
    owner_angle: f32,
    radius: f32,
) -> bool {
    if !radius.is_finite() || radius < 0.0 {
        return false;
    }
    let dx = point_x - owner_x;
    let dy = point_y - owner_y;
    let dist = (dx * dx + dy * dy).sqrt();
    if !dist.is_finite() || dist > radius {
        return false;
    }
    if dist < 1e-4 {
        return true;
    }
    let rear = normalize_angle(owner_angle + PI);
    let point_angle = dy.atan2(dx);
    angle_delta(rear, point_angle).abs() <= REAR_BRAKE_ARC_HALF_ANGLE
}

// ---------------------------------------------------------------------------
// Scalar helpers.
// ---------------------------------------------------------------------------

fn sanitize_dt(raw: f32) -> f32 {
    if raw.is_finite() && raw > 0.0 {
        raw
    } else {
        0.0
    }
}

fn sanitize_f32(v: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        0.0
    }
}

fn sanitize_non_negative(v: f32) -> f32 {
    if v.is_finite() {
        v.max(0.0)
    } else {
        0.0
    }
}

fn to_u32(v: f32) -> u32 {
    if v.is_finite() && v > 0.0 {
        v.round() as u32
    } else {
        0
    }
}

fn normalize_angle(a: f32) -> f32 {
    let two_pi = 2.0 * PI;
    let mut r = a % two_pi;
    if r > PI {
        r -= two_pi;
    } else if r < -PI {
        r += two_pi;
    }
    r
}

fn angle_delta(from: f32, to: f32) -> f32 {
    normalize_angle(to - from)
}

fn rotate_toward(current: f32, target: f32, max_delta: f32) -> f32 {
    if max_delta <= 0.0 {
        return current;
    }
    let delta = angle_delta(current, target);
    if delta > max_delta {
        normalize_angle(current + max_delta)
    } else if delta < -max_delta {
        normalize_angle(current - max_delta)
    } else {
        normalize_angle(current + delta)
    }
}

fn read_rng_state(buf: &OwnerSimBuffer) -> u32 {
    let hi = (sanitize_f32(buf.data[OWNER_SLOT_RNG_HI]).max(0.0) as u32) & 0xFFFF;
    let lo = (sanitize_f32(buf.data[OWNER_SLOT_RNG_LO]).max(0.0) as u32) & 0xFFFF;
    (hi << 16) | lo
}

fn write_rng_state(buf: &mut OwnerSimBuffer, state: u32) {
    buf.data[OWNER_SLOT_RNG_HI] = ((state >> 16) & 0xFFFF) as f32;
    buf.data[OWNER_SLOT_RNG_LO] = (state & 0xFFFF) as f32;
}

/// A wander ray is clear when the full 120px lookahead segment stays inside
/// the walkable bounds and no obstacle / rect push-out moves any sample point.
fn wander_ray_clear(
    origin_x: f32,
    origin_y: f32,
    angle: f32,
    input: &OwnerStepInput<'_>,
) -> bool {
    let min_x = input.field_min_x + OWNER_BODY_RADIUS;
    let max_x = input.field_max_x - OWNER_BODY_RADIUS;
    let min_y = input.field_min_y + OWNER_BODY_RADIUS;
    let max_y = input.field_max_y - OWNER_BODY_RADIUS;

    let cos = angle.cos();
    let sin = angle.sin();
    // Sample the full 120px segment at fine-grained steps (including the
    // endpoint) so thin obstacles cannot slip between samples.
    const SAMPLES: usize = 24;
    for i in 1..=SAMPLES {
        let t = WANDER_LOOKAHEAD * (i as f32 / SAMPLES as f32);
        let tx = origin_x + cos * t;
        let ty = origin_y + sin * t;
        if tx < min_x || tx > max_x || ty < min_y || ty > max_y {
            return false;
        }
        let (rx, ry) = resolve_field_collisions(
            tx as f64,
            ty as f64,
            OWNER_BODY_RADIUS as f64,
            input.field_max_x as f64,
            input.field_max_y as f64,
            input.obstacles,
        );
        if (rx - tx as f64).abs() >= 1e-3 || (ry - ty as f64).abs() >= 1e-3 {
            return false;
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Main step.
// ---------------------------------------------------------------------------

pub fn step_owner_buffer(buf: &mut OwnerSimBuffer, input: &OwnerStepInput<'_>) -> u32 {
    // Invalid dt: preserve stored event bitmask, OR-in COMMAND_REJECTED,
    // and return without integrating.
    if !input.dt_s.is_finite() || input.dt_s <= 0.0 {
        let stored = to_u32(buf.data[OWNER_SLOT_EVENT_BITMASK]);
        let events = stored | OWNER_EVENT_COMMAND_REJECTED;
        buf.data[OWNER_SLOT_EVENT_BITMASK] = events as f32;
        buf.data[OWNER_SLOT_LAST_STEP_DT] = 0.0;
        return events;
    }

    let dt = sanitize_dt(input.dt_s);
    let mut events: u32 = 0;

    for slot in [
        OWNER_SLOT_X,
        OWNER_SLOT_Y,
        OWNER_SLOT_VX,
        OWNER_SLOT_VY,
        OWNER_SLOT_ANGLE,
        OWNER_SLOT_WALK_PHASE,
        OWNER_SLOT_WANDER_HEADING,
    ] {
        buf.data[slot] = sanitize_f32(buf.data[slot]);
    }

    let mut x = buf.data[OWNER_SLOT_X];
    let mut y = buf.data[OWNER_SLOT_Y];
    let mut heading = buf.data[OWNER_SLOT_ANGLE];
    let mut walk_phase = buf.data[OWNER_SLOT_WALK_PHASE];

    let prev_gait = coerce_gait(to_u32(buf.data[OWNER_SLOT_GAIT]));

    let cmd_flags = to_u32(buf.data[OWNER_SLOT_CMD_FLAGS]);
    buf.data[OWNER_SLOT_CMD_FLAGS] = 0.0;

    let mut step_off_timer = sanitize_non_negative(buf.data[OWNER_SLOT_STEP_OFF_TIMER]);
    let mut jog_timer = sanitize_non_negative(buf.data[OWNER_SLOT_JOG_TIMER]);
    let mut jog_cooldown = sanitize_non_negative(buf.data[OWNER_SLOT_JOG_COOLDOWN]);
    let mut wander_timer = sanitize_non_negative(buf.data[OWNER_SLOT_WANDER_TIMER]);
    let mut wander_heading = buf.data[OWNER_SLOT_WANDER_HEADING];
    let mut warp_cooldown = sanitize_non_negative(buf.data[OWNER_SLOT_WARP_COOLDOWN]);
    let mut poop_hold_timer = sanitize_non_negative(buf.data[OWNER_SLOT_POOP_HOLD_TIMER]);
    let mut speed_multiplier = sanitize_f32(buf.data[OWNER_SLOT_SPEED_MULTIPLIER]);
    if speed_multiplier <= 0.0 {
        speed_multiplier = 1.0;
    }

    let dog_rel_x = sanitize_f32(input.dog_pos_x - x);
    let dog_rel_y = sanitize_f32(input.dog_pos_y - y);
    let leash_dist = (dog_rel_x * dog_rel_x + dog_rel_y * dog_rel_y).sqrt();
    let _ = leash_dist;
    // Previous tick's taut state, used for edge detection.
    let prev_leash_taut = buf.data[OWNER_SLOT_LEASH_TAUT] >= 0.5;
    // Hysteresis threshold for the slack transition.
    let leash_slack_threshold = MAX_LEASH_LENGTH_PX - 2.0;

    // --- RESET: highest priority. ---
    if (cmd_flags & OWNER_CMD_RESET) != 0 {
        x = 0.0;
        y = 0.0;
        heading = 0.0;
        walk_phase = 0.0;
        step_off_timer = 0.0;
        jog_timer = 0.0;
        jog_cooldown = 0.0;
        wander_timer = 0.0;
        warp_cooldown = 0.0;
        poop_hold_timer = 0.0;
        events |= OWNER_EVENT_RESET;
    }

    // --- Input steering vector (world-space direction). ---
    let input_x = sanitize_f32(buf.data[OWNER_SLOT_INPUT_X]);
    let input_y = sanitize_f32(buf.data[OWNER_SLOT_INPUT_Y]);
    let input_mag_sq = input_x * input_x + input_y * input_y;
    let has_input = input_mag_sq > 1e-8;
    let input_heading = if has_input {
        Some(input_y.atan2(input_x))
    } else {
        None
    };

    // --- FACE_DOG latch: persists across steps until cleared or overridden. ---
    // The latch is stored in a dedicated slot so it survives the per-step
    // command-flag clear.
    let mut face_dog_latched = buf.data[OWNER_SLOT_FACE_DOG_LATCH] >= 0.5;

    // --- Command priority: RESET > STOP > JOG > WALK > STROLL > WANDER > CLEAR_WANDER > FACE_DOG. ---
    let mut desired_gait = prev_gait;
    let mut target_heading: Option<f32> = None;
    let mut wander_active = prev_gait == OWNER_GAIT_WANDER;
    let mut wander_blocked = false;

    // Tracks whether JOG started this step so its timer is not decremented
    // on the same tick (effective duration is exactly JOG_DURATION_S).
    let mut jog_started_this_step = false;

    if (cmd_flags & OWNER_CMD_RESET) != 0 {
        desired_gait = OWNER_GAIT_STAND;
        face_dog_latched = false;
    } else if (cmd_flags & OWNER_CMD_STOP) != 0 {
        desired_gait = OWNER_GAIT_STAND;
        wander_active = false;
        face_dog_latched = false;
    } else if (cmd_flags & OWNER_CMD_JOG) != 0 {
        face_dog_latched = false;
        if jog_cooldown > 0.0 {
            // Rejected: keep the current gait, do not force WALK.
            events |= OWNER_EVENT_COMMAND_REJECTED;
        } else if jog_timer > 0.0 {
            // Already jogging: repeated JOG is rejected.
            desired_gait = OWNER_GAIT_JOG;
            events |= OWNER_EVENT_COMMAND_REJECTED;
        } else {
            jog_timer = JOG_DURATION_S;
            jog_cooldown = JOG_COOLDOWN_S;
            desired_gait = OWNER_GAIT_JOG;
            jog_started_this_step = true;
            events |= OWNER_EVENT_JOG_STARTED;
        }
    } else if (cmd_flags & OWNER_CMD_WALK) != 0 {
        desired_gait = OWNER_GAIT_WALK;
        face_dog_latched = false;
    } else if (cmd_flags & OWNER_CMD_STROLL) != 0 {
        desired_gait = OWNER_GAIT_STROLL;
        face_dog_latched = false;
    } else if (cmd_flags & OWNER_CMD_WANDER) != 0 {
        desired_gait = OWNER_GAIT_WANDER;
        wander_active = true;
        wander_timer = 0.0;
        face_dog_latched = false;
        events |= OWNER_EVENT_WANDER_STARTED;
    } else if (cmd_flags & OWNER_CMD_CLEAR_WANDER) != 0 {
        wander_active = false;
        desired_gait = OWNER_GAIT_STAND;
    } else if (cmd_flags & OWNER_CMD_CLEAR_FACE_DOG) != 0 {
        face_dog_latched = false;
        desired_gait = OWNER_GAIT_STAND;
    } else if (cmd_flags & OWNER_CMD_FACE_DOG) != 0 {
        face_dog_latched = true;
        desired_gait = OWNER_GAIT_STAND;
    } else if wander_active {
        desired_gait = OWNER_GAIT_WANDER;
    }

    // --- Apply latched FACE_DOG when no higher-priority command overrode it. ---
    if face_dog_latched && desired_gait == OWNER_GAIT_STAND {
        target_heading = Some(normalize_angle(input.dog_heading_rad));
    }

    // --- Input steering for WALK / STROLL / JOG. ---
    if !face_dog_latched
        && matches!(
            desired_gait,
            OWNER_GAIT_WALK | OWNER_GAIT_STROLL | OWNER_GAIT_JOG
        )
    {
        if let Some(h) = input_heading {
            target_heading = Some(h);
        }
    }

    // --- Wander autopilot: choose nearest clear ray. ---
    if wander_active && desired_gait == OWNER_GAIT_WANDER {
        wander_timer -= dt;
        if wander_timer <= 0.0 {
            let mut rng = Mulberry32::new(read_rng_state(buf));
            let r = rng.next_f64() as f32;
            write_rng_state(buf, rng.state());
            wander_heading = (r * 2.0 * PI).rem_euclid(2.0 * PI);
            wander_timer = WANDER_REFRESH_S;
        }

        let mut chosen: Option<f32> = None;
        for offset in [0.0f32, -WANDER_RAY_SPREAD, WANDER_RAY_SPREAD] {
            let a = normalize_angle(wander_heading + offset);
            if wander_ray_clear(x, y, a, input) {
                chosen = Some(a);
                break;
            }
        }

        if let Some(a) = chosen {
            wander_heading = a;
            target_heading = Some(a);
            wander_blocked = false;
        } else {
            events |= OWNER_EVENT_WANDER_BLOCKED;
            // Rotate in place at the locked wander turn rate. The heading is
            // applied directly (no step-off) so the owner spins until a clear
            // ray is found.
            wander_heading = normalize_angle(wander_heading + WANDER_MAX_TURN_RATE_RAD_S * dt);
            heading = wander_heading;
            target_heading = None;
            // Keep WANDER gait: rotate in place until a clear ray is found.
            desired_gait = OWNER_GAIT_WANDER;
            wander_blocked = true;
        }
    }

    // --- Jog timers: decrement only while in JOG gait, and never on the
    // step JOG started (so effective duration is exactly JOG_DURATION_S). ---
    if desired_gait == OWNER_GAIT_JOG && jog_timer > 0.0 && !jog_started_this_step {
        jog_timer = (jog_timer - dt).max(0.0);
        if jog_timer == 0.0 {
            jog_cooldown = JOG_COOLDOWN_S;
            // Jog expired: force WALK.
            desired_gait = OWNER_GAIT_WALK;
        }
    } else if jog_cooldown > 0.0 && !jog_started_this_step {
        let before = jog_cooldown;
        jog_cooldown = (jog_cooldown - dt).max(0.0);
        if before > 0.0 && jog_cooldown == 0.0 {
            events |= OWNER_EVENT_JOG_COOLDOWN_READY;
        }
    }

    // --- Gait change event. ---
    if desired_gait != prev_gait {
        events |= OWNER_EVENT_GAIT_CHANGED;
    }

    // --- Warp cooldown. ---
    if warp_cooldown > 0.0 {
        warp_cooldown = (warp_cooldown - dt).max(0.0);
    }

    // --- Step-off entry: check BEFORE rotating so large errors are caught. ---
    // Blocked wander rotates in place and must not trigger step-off.
    let intended_speed = gait_speed(desired_gait) * speed_multiplier;
    if step_off_timer <= 0.0 && intended_speed > 0.0 && !wander_blocked {
        if let Some(t) = target_heading {
            let err = angle_delta(heading, t).abs();
            if err > STEP_OFF_ALIGN_TOLERANCE_RAD {
                step_off_timer = 1e-6;
                events |= OWNER_EVENT_STEP_OFF_STARTED;
            }
        }
    }

    // --- Heading rotation. ---
    let turn_rate = if step_off_timer > 0.0 {
        STEP_OFF_TURN_RATE_RAD_S
    } else {
        gait_turn_rate(desired_gait)
    };
    if let Some(t) = target_heading {
        heading = rotate_toward(heading, t, turn_rate * dt);
    }

    // --- Step-off timer: elapsed time counting up to the max duration. ---
    if step_off_timer > 0.0 {
        let aligned = match target_heading {
            Some(t) => angle_delta(heading, t).abs() <= STEP_OFF_ALIGN_TOLERANCE_RAD,
            None => true,
        };
        if aligned {
            step_off_timer = 0.0;
            events |= OWNER_EVENT_STEP_OFF_FINISHED;
        } else {
            step_off_timer += dt;
            if step_off_timer >= STEP_OFF_MAX_DURATION_S {
                step_off_timer = 0.0;
                events |= OWNER_EVENT_STEP_OFF_FINISHED;
            }
        }
    }

    // --- Locomotion: first-order speed clamp, move along heading. ---
    let speed_cap = gait_speed(desired_gait) * speed_multiplier;
    let mut actual_speed = sanitize_f32(buf.data[OWNER_SLOT_SPEED]);
    if step_off_timer > 0.0 {
        actual_speed = 0.0;
    } else if actual_speed > speed_cap {
        actual_speed = speed_cap;
    } else if actual_speed < speed_cap {
        // Locked first-order clamp: approach the target at `target * dt`.
        let step = speed_cap * dt;
        actual_speed = (actual_speed + step).min(speed_cap);
    }
    if speed_cap <= 0.0 {
        actual_speed = 0.0;
    }

    let mut vx = heading.cos() * actual_speed;
    let mut vy = heading.sin() * actual_speed;

    x = sanitize_f32(x + vx * dt);
    y = sanitize_f32(y + vy * dt);

    // --- Collision + boundary response. ---
    // The walkable bounds are the raw field bounds (NOT inset by the body
    // radius); the owner's center may reach the field edge.
    let (lo_x, hi_x) = if input.field_min_x <= input.field_max_x {
        (input.field_min_x, input.field_max_x)
    } else {
        let mid = (input.field_min_x + input.field_max_x) * 0.5;
        (mid, mid)
    };
    let (lo_y, hi_y) = if input.field_min_y <= input.field_max_y {
        (input.field_min_y, input.field_max_y)
    } else {
        let mid = (input.field_min_y + input.field_max_y) * 0.5;
        (mid, mid)
    };

    // `outside` must be derived from the raw integrated position, before the
    // clamp collapses it onto the boundary.
    let outside = x < lo_x || x > hi_x || y < lo_y || y > hi_y;
    let pre_x = sanitize_f32(x.clamp(lo_x, hi_x));
    let pre_y = sanitize_f32(y.clamp(lo_y, hi_y));

    // When the owner is outside the walkable bounds, clamp directly and skip
    // obstacle resolution so boundary edges are never misreported as obstacle
    // deflections.
    let (post_x, post_y) = if outside || input.obstacles.is_empty() {
        // Boundary edges are handled by the raw-bounds clamp above; with no
        // obstacles there is nothing else to resolve. Skipping the resolver
        // here avoids its internal field-margin push moving a point that is
        // already inside the raw bounds (e.g. RESET to (0,0)).
        (pre_x, pre_y)
    } else {
        let (rx, ry) = resolve_field_collisions(
            pre_x as f64,
            pre_y as f64,
            OWNER_BODY_RADIUS as f64,
            input.field_max_x as f64,
            input.field_max_y as f64,
            input.obstacles,
        );
        (
            sanitize_f32((rx as f32).clamp(lo_x, hi_x)),
            sanitize_f32((ry as f32).clamp(lo_y, hi_y)),
        )
    };

    let mut boundary_blocked = false;
    let mut obstacle_blocked = false;
    if outside {
        boundary_blocked = true;
        events |= OWNER_EVENT_BOUNDARY_BLOCKED;
    } else if (post_x - pre_x).abs() > 1e-4 || (post_y - pre_y).abs() > 1e-4 {
        obstacle_blocked = true;
        events |= OWNER_EVENT_OBSTACLE_DEFLECTED;
        // Deflect heading by half the push-out normal.
        let nx = post_x - pre_x;
        let ny = post_y - pre_y;
        if nx.abs() > 1e-6 || ny.abs() > 1e-6 {
            heading = normalize_angle(heading + 0.5 * ny.atan2(nx));
        }
    }
    x = post_x;
    y = post_y;

    // Only boundary blocking zeroes speed; obstacle deflection preserves the
    // owner's momentum (the resolver already pushed them out).
    let blocked = boundary_blocked || obstacle_blocked;
    if boundary_blocked {
        actual_speed = 0.0;
        vx = 0.0;
        vy = 0.0;
    }

    // --- Warp gates: detect the entered gate BEFORE teleporting. ---
    let prev_gate = to_u32(buf.data[OWNER_SLOT_WARP_GATE_ID]);
    let mut entered_index: Option<usize> = None;
    for (i, g) in input.warp_gates.iter().enumerate() {
        let dx = x - g.x;
        let dy = y - g.y;
        if dx * dx + dy * dy <= g.radius * g.radius {
            entered_index = Some(i);
            break;
        }
    }

    // The source gate id is the gate the owner actually stepped onto. Emit
    // ENTERED even when no teleport occurs (e.g. a lone gate with no pair).
    let mut source_gate_id: u32 = 0;
    if let Some(i) = entered_index {
        let source = &input.warp_gates[i];
        source_gate_id = source.id as u32;
        // ENTERED fires only when the owner steps onto a new gate while the
        // warp cooldown is inactive (i.e. a genuine entry, not a lingering
        // overlap during cooldown).
        if source_gate_id != 0 && source_gate_id != prev_gate && warp_cooldown <= 0.0 {
            events |= OWNER_EVENT_WARP_GATE_ENTERED;
        }
        // Teleport to the next gate in the list (wrapping) when off cooldown.
        // A lone gate has no pair, so no teleport occurs.
        if warp_cooldown <= 0.0 && input.warp_gates.len() > 1 {
            let target = &input.warp_gates[(i + 1) % input.warp_gates.len()];
            x = sanitize_f32(target.x);
            y = sanitize_f32(target.y);
            warp_cooldown = WARP_COOLDOWN_S;
        }
    }

    // --- Warp-gate exit edge detection (post-teleport position). ---
    let mut inside_gate: u32 = 0;
    for g in input.warp_gates {
        let dx = x - g.x;
        let dy = y - g.y;
        if dx * dx + dy * dy <= g.radius * g.radius {
            inside_gate = g.id as u32;
            break;
        }
    }
    if inside_gate == 0 && prev_gate != 0 {
        events |= OWNER_EVENT_WARP_GATE_EXITED;
    }
    // Persist the source gate id when the owner stepped onto a gate; otherwise
    // fall back to whatever gate the post-teleport position sits inside.
    let stored_gate_id = if source_gate_id != 0 {
        source_gate_id
    } else {
        inside_gate
    };

    // --- Leash: recompute distance after integration, project owner back. ---
    let post_dog_rel_x = sanitize_f32(input.dog_pos_x - x);
    let post_dog_rel_y = sanitize_f32(input.dog_pos_y - y);
    let post_leash_dist = (post_dog_rel_x * post_dog_rel_x + post_dog_rel_y * post_dog_rel_y).sqrt();
    // Hysteresis: the leash becomes taut at MAX_LEASH_LENGTH_PX but only
    // relaxes once the distance drops below MAX_LEASH_LENGTH_PX - 2.0. The
    // persisted taut flag therefore stays set inside the hysteresis band.
    let post_leash_taut = if prev_leash_taut {
        post_leash_dist > leash_slack_threshold
    } else {
        post_leash_dist >= MAX_LEASH_LENGTH_PX
    };

    if post_leash_dist >= MAX_LEASH_LENGTH_PX && post_leash_dist > 1e-6 {
        // Pull the owner back toward the dog so the leash is exactly taut.
        let scale = MAX_LEASH_LENGTH_PX / post_leash_dist;
        x = sanitize_f32(input.dog_pos_x - post_dog_rel_x * scale);
        y = sanitize_f32(input.dog_pos_y - post_dog_rel_y * scale);
    }

    if post_leash_taut && !prev_leash_taut {
        events |= OWNER_EVENT_LEASH_TAUT;
    } else if !post_leash_taut && prev_leash_taut {
        // Hysteresis: only report slack once the leash has clearly relaxed.
        events |= OWNER_EVENT_LEASH_SLACK;
    }

    // --- Forced stand / poop hold, derived from the post-integration leash. ---
    // The owner is held in place only while the dog is pooping AND the leash
    // is taut after integration.
    let forced_stand = input.dog_is_pooping && post_leash_taut;
    if forced_stand {
        events |= OWNER_EVENT_LEASH_FORCED_STAND;
        events |= OWNER_EVENT_POOP_HOLD;
        poop_hold_timer += dt;
        // Force STAND and freeze the owner: no residual velocity while held.
        desired_gait = OWNER_GAIT_STAND;
        actual_speed = 0.0;
        vx = 0.0;
        vy = 0.0;
    } else if poop_hold_timer > 0.0 {
        poop_hold_timer = (poop_hold_timer - dt).max(0.0);
    }

    let final_dog_rel_x = sanitize_f32(input.dog_pos_x - x);
    let final_dog_rel_y = sanitize_f32(input.dog_pos_y - y);
    let leash_tension = (post_leash_dist / MAX_LEASH_LENGTH_PX).clamp(0.0, 1.0);
    // Pass the owner-local forward coordinate (dot of dog-relative vector with
    // the owner's forward axis), not the world-space x delta.
    let dog_forward_local = final_dog_rel_x * heading.cos() + final_dog_rel_y * heading.sin();
    let (hand_lx, hand_ly) = compute_leash_hand_local(dog_forward_local, input.dog_is_pooping);

    // --- Walk cadence (phase in radians). Emit only on full 2*PI wrap. ---
    let stride_hz = walk_stride_hz(actual_speed);
    let prev_phase = walk_phase;
    let raw_phase = walk_phase + stride_hz * dt * 2.0 * PI;
    walk_phase = raw_phase.rem_euclid(2.0 * PI);
    if raw_phase >= 2.0 * PI {
        events |= OWNER_EVENT_WALK_CYCLE;
    }
    let _ = prev_phase;

    // --- Last known safe position. ---
    let mut last_safe_x = sanitize_f32(buf.data[OWNER_SLOT_LAST_SAFE_X]);
    let mut last_safe_y = sanitize_f32(buf.data[OWNER_SLOT_LAST_SAFE_Y]);
    // Update the safe position whenever the owner is not boundary-blocked.
    // Obstacle deflection still yields a valid (pushed-out) position, so it
    // counts as safe.
    if !boundary_blocked {
        last_safe_x = x;
        last_safe_y = y;
    }
    let _ = blocked;

    let dist_traveled = sanitize_f32(buf.data[OWNER_SLOT_DIST_TRAVELED]) + actual_speed * dt;
    let step_count = sanitize_non_negative(buf.data[OWNER_SLOT_STEP_COUNT]) + 1.0;

    // --- Commit. ---
    buf.data[OWNER_SLOT_X] = x;
    buf.data[OWNER_SLOT_Y] = y;
    buf.data[OWNER_SLOT_VX] = sanitize_f32(vx);
    buf.data[OWNER_SLOT_VY] = sanitize_f32(vy);
    buf.data[OWNER_SLOT_ANGLE] = heading;
    buf.data[OWNER_SLOT_SPEED] = sanitize_f32(actual_speed);
    buf.data[OWNER_SLOT_GAIT] = desired_gait as f32;
    buf.data[OWNER_SLOT_WALK_PHASE] = walk_phase;
    buf.data[OWNER_SLOT_PREV_GAIT] = prev_gait as f32;
    buf.data[OWNER_SLOT_EVENT_BITMASK] = events as f32;
    buf.data[OWNER_SLOT_STEP_OFF_TIMER] = step_off_timer;
    buf.data[OWNER_SLOT_JOG_TIMER] = jog_timer;
    buf.data[OWNER_SLOT_JOG_COOLDOWN] = jog_cooldown;
    buf.data[OWNER_SLOT_WANDER_HEADING] = wander_heading;
    buf.data[OWNER_SLOT_WANDER_TIMER] = wander_timer;
    buf.data[OWNER_SLOT_LAST_SAFE_X] = last_safe_x;
    buf.data[OWNER_SLOT_LAST_SAFE_Y] = last_safe_y;
    buf.data[OWNER_SLOT_LEASH_TENSION] = leash_tension;
    buf.data[OWNER_SLOT_LEASH_TAUT] = if post_leash_taut { 1.0 } else { 0.0 };
    buf.data[OWNER_SLOT_HAND_LOCAL_X] = hand_lx;
    buf.data[OWNER_SLOT_HAND_LOCAL_Y] = hand_ly;
    buf.data[OWNER_SLOT_WARP_GATE_ID] = stored_gate_id as f32;
    buf.data[OWNER_SLOT_DOG_REL_X] = final_dog_rel_x;
    buf.data[OWNER_SLOT_DOG_REL_Y] = final_dog_rel_y;
    buf.data[OWNER_SLOT_DIST_TRAVELED] = dist_traveled;
    buf.data[OWNER_SLOT_DT] = dt;
    buf.data[OWNER_SLOT_STEP_COUNT] = step_count;
    buf.data[OWNER_SLOT_LAST_STEP_DT] = input.dt_s;
    buf.data[OWNER_SLOT_FACE_DOG_LATCH] = if face_dog_latched { 1.0 } else { 0.0 };
    buf.data[OWNER_SLOT_DESIRED_GAIT] = desired_gait as f32;
    buf.data[OWNER_SLOT_SPEED_MULTIPLIER] = speed_multiplier;
    buf.data[OWNER_SLOT_WARP_COOLDOWN] = warp_cooldown;
    buf.data[OWNER_SLOT_POOP_HOLD_TIMER] = poop_hold_timer;
    buf.data[OWNER_SLOT_WALK_CYCLE] = walk_phase;
    buf.data[OWNER_SLOT_WANDER_BLOCKED] = if wander_blocked { 1.0 } else { 0.0 };

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_input<'a>(
        gates: &'a [WarpGate],
        obstacles: &'a [WorldObstacle],
    ) -> OwnerStepInput<'a> {
        OwnerStepInput {
            dt_s: 0.1,
            dog_pos_x: 1600.0,
            dog_pos_y: 1200.0,
            dog_heading_rad: 0.0,
            field_min_x: 0.0,
            field_min_y: 0.0,
            field_max_x: 3200.0,
            field_max_y: 2400.0,
            dog_is_pooping: false,
            warp_gates: gates,
            obstacles,
        }
    }

    fn buf_at(x: f32, y: f32) -> OwnerSimBuffer {
        let mut buf = OwnerSimBuffer::default();
        buf.data[OWNER_SLOT_X] = x;
        buf.data[OWNER_SLOT_Y] = y;
        buf
    }

    #[test]
    fn owner_sim_gait_matrix_speeds_and_turn_rates() {
        assert_eq!(gait_speed(OWNER_GAIT_STAND), 0.0);
        assert_eq!(gait_speed(OWNER_GAIT_STROLL), 75.0);
        assert_eq!(gait_speed(OWNER_GAIT_WALK), 100.0);
        assert_eq!(gait_speed(OWNER_GAIT_JOG), 185.0);
        assert_eq!(gait_speed(OWNER_GAIT_WANDER), 60.0);

        assert!((gait_turn_rate(OWNER_GAIT_STAND) - PI).abs() < 1e-6);
        assert!((gait_turn_rate(OWNER_GAIT_STROLL) - PI).abs() < 1e-6);
        assert!((gait_turn_rate(OWNER_GAIT_WALK) - 115.0_f32.to_radians()).abs() < 1e-6);
        assert!((gait_turn_rate(OWNER_GAIT_JOG) - 65.0_f32.to_radians()).abs() < 1e-6);
        assert!((gait_turn_rate(OWNER_GAIT_WANDER) - PI * 1.4).abs() < 1e-6);
    }

    #[test]
    fn owner_sim_walk_stride_formula() {
        assert!((walk_stride_hz(0.0) - 4.0).abs() < 1e-6);
        assert!((walk_stride_hz(265.0) - 12.0).abs() < 1e-6);
        assert!((walk_stride_hz(132.5) - 8.0).abs() < 1e-6);
    }

    #[test]
    fn owner_sim_leash_hand_anchor_branches() {
        let (fx, fy) = compute_leash_hand_local(10.0, false);
        assert_eq!((fx, fy), (18.0, 4.0));

        let (bx, by) = compute_leash_hand_local(10.0, true);
        assert_eq!((bx, by), (-12.0, 0.0));

        let (lx, ly) = compute_leash_hand_local(-5.0, false);
        assert_eq!((lx, ly), (-12.0, 0.0));
    }

    #[test]
    fn owner_sim_invalid_dt_rejected() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        input.dt_s = 0.0;

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_EVENT_BITMASK] = OWNER_EVENT_RESET as f32;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_COMMAND_REJECTED, 0);
        // Stored bitmask is preserved.
        assert_ne!(events & OWNER_EVENT_RESET, 0);
        assert_eq!(buf.data[OWNER_SLOT_X], 1600.0);
        assert_eq!(buf.data[OWNER_SLOT_Y], 1200.0);

        input.dt_s = f32::NAN;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_COMMAND_REJECTED, 0);
    }

    #[test]
    fn owner_sim_command_priority_stop_over_walk() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = (OWNER_CMD_STOP | OWNER_CMD_WALK) as f32;
        step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, OWNER_GAIT_STAND);
    }

    #[test]
    fn owner_sim_command_priority_jog_over_walk() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = (OWNER_CMD_JOG | OWNER_CMD_WALK) as f32;
        step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, OWNER_GAIT_JOG);
    }

    #[test]
    fn owner_sim_gait_changed_event() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_GAIT_CHANGED, 0);
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, OWNER_GAIT_WALK);
    }

    #[test]
    fn owner_sim_step_count_and_dt() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        step_owner_buffer(&mut buf, &input);
        step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_STEP_COUNT], 2.0);
        assert!((buf.data[OWNER_SLOT_LAST_STEP_DT] - 0.1).abs() < 1e-6);
    }

    #[test]
    fn owner_sim_leash_projection() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        input.dog_pos_x = 1600.0 + MAX_LEASH_LENGTH_PX + 20.0;
        input.dog_pos_y = 1200.0;

        let mut buf = buf_at(1600.0, 1200.0);
        step_owner_buffer(&mut buf, &input);
        let rel_x = buf.data[OWNER_SLOT_DOG_REL_X];
        let rel_y = buf.data[OWNER_SLOT_DOG_REL_Y];
        let dist = (rel_x * rel_x + rel_y * rel_y).sqrt();
        assert!((dist - MAX_LEASH_LENGTH_PX).abs() < 1e-3);
    }

    #[test]
    fn owner_sim_leash_taut_and_slack_events() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        // Start slack: dog close to owner.
        input.dog_pos_x = 1600.0;

        let mut buf = buf_at(1600.0, 1200.0);
        let events = step_owner_buffer(&mut buf, &input);
        assert_eq!(events & OWNER_EVENT_LEASH_TAUT, 0);

        // Move dog far: leash becomes taut.
        input.dog_pos_x = 1600.0 + MAX_LEASH_LENGTH_PX + 20.0;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_LEASH_TAUT, 0);

        // Move dog back close: leash becomes slack.
        input.dog_pos_x = 1600.0;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_LEASH_SLACK, 0);
    }

    #[test]
    fn owner_sim_forced_stand_when_pooping_and_taut() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];

        let mut input = base_input(&gates, &obstacles);
        input.dog_is_pooping = true;
        input.dog_pos_x = 1600.0 + MAX_LEASH_LENGTH_PX + 5.0;

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_JOG as f32;

        let events = step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, OWNER_GAIT_STAND);
        assert_eq!(buf.data[OWNER_SLOT_SPEED], 0.0);
        assert_ne!(events & OWNER_EVENT_LEASH_FORCED_STAND, 0);
        assert_ne!(events & OWNER_EVENT_POOP_HOLD, 0);
    }

    #[test]
    fn owner_sim_boundary_blocked() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        // Keep the dog near the owner so leash projection does not interfere.
        input.dog_pos_x = 0.0;
        input.dog_pos_y = 0.0;

        // Start outside the field bounds (negative coords).
        let mut buf = buf_at(-50.0, -50.0);
        let events = step_owner_buffer(&mut buf, &input);
        // Bounds are the raw field bounds, not inset by the body radius.
        assert!((buf.data[OWNER_SLOT_X] - 0.0).abs() < 1e-4);
        assert!((buf.data[OWNER_SLOT_Y] - 0.0).abs() < 1e-4);
        assert_ne!(events & OWNER_EVENT_BOUNDARY_BLOCKED, 0);
        // Boundary edges must not be misreported as obstacle deflections.
        assert_eq!(events & OWNER_EVENT_OBSTACLE_DEFLECTED, 0);
    }

    #[test]
    fn owner_sim_obstacle_deflection() {
        let gates: [WarpGate; 0] = [];
        let obstacles = [WorldObstacle::Circle { x: 1610.0, y: 1200.0, r: 20.0 }];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        let events = step_owner_buffer(&mut buf, &input);
        let dx = buf.data[OWNER_SLOT_X] - 1610.0;
        let dy = buf.data[OWNER_SLOT_Y] - 1200.0;
        let dist = (dx * dx + dy * dy).sqrt();
        assert!(
            dist >= (20.0 + OWNER_BODY_RADIUS) - 1e-3,
            "owner must be pushed outside the obstacle, dist = {}",
            dist
        );
        assert_ne!(events & OWNER_EVENT_OBSTACLE_DEFLECTED, 0);
    }

    #[test]
    fn owner_sim_jog_duration_and_cooldown() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(400.0, 400.0);

        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_JOG as f32;
        step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, OWNER_GAIT_JOG);
        assert!(buf.data[OWNER_SLOT_JOG_TIMER] > 0.0);

        let mut ticks = 1;
        while buf.data[OWNER_SLOT_JOG_TIMER] > 0.0 && ticks < 100 {
            buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_JOG as f32;
            step_owner_buffer(&mut buf, &input);
            ticks += 1;
        }
        // Effective duration is exactly JOG_DURATION_S (2.0s = 20 ticks at
        // dt=0.1) because the start step does not decrement the timer.
        assert!((ticks as f32 - 20.0).abs() <= 1.0, "jog lasted {} ticks", ticks);
        assert!(buf.data[OWNER_SLOT_JOG_COOLDOWN] > 0.0);

        // During cooldown a fresh request is rejected but the current gait is
        // preserved (no forced WALK).
        let gait_before = buf.data[OWNER_SLOT_GAIT] as u32;
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_JOG as f32;
        let events = step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, gait_before);
        assert_ne!(events & OWNER_EVENT_COMMAND_REJECTED, 0);
    }

    #[test]
    fn owner_sim_warp_automatic_and_cooldown() {
        let gates = [
            WarpGate { id: 1, x: 1600.0, y: 1200.0, radius: 30.0 },
            WarpGate { id: 2, x: 2400.0, y: 1200.0, radius: 30.0 },
        ];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        // Keep the dog near the destination gate so leash projection does not
        // pull the owner back after the warp.
        input.dog_pos_x = 2400.0;
        input.dog_pos_y = 1200.0;

        let mut buf = buf_at(1600.0, 1200.0);
        step_owner_buffer(&mut buf, &input);
        assert!((buf.data[OWNER_SLOT_X] - 2400.0).abs() < 1e-3);
        assert!(buf.data[OWNER_SLOT_WARP_COOLDOWN] > 0.0);
    }

    #[test]
    fn owner_sim_warp_gate_enter_and_exit() {
        let gates = [
            WarpGate { id: 7, x: 1600.0, y: 1200.0, radius: 30.0 },
            WarpGate { id: 9, x: 2400.0, y: 1200.0, radius: 30.0 },
        ];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_WARP_GATE_ENTERED, 0);
        // The stored id is the SOURCE gate the owner stepped onto.
        assert_eq!(buf.data[OWNER_SLOT_WARP_GATE_ID] as u32, 7);

        buf.data[OWNER_SLOT_X] = 1000.0;
        buf.data[OWNER_SLOT_Y] = 1000.0;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_WARP_GATE_EXITED, 0);
        assert_eq!(buf.data[OWNER_SLOT_WARP_GATE_ID], 0.0);
    }

    #[test]
    fn owner_sim_warp_source_id_without_pair() {
        // A lone gate: entering it must emit ENTERED and store its id even
        // though no teleport can occur.
        let gates = [WarpGate { id: 42, x: 1600.0, y: 1200.0, radius: 30.0 }];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_WARP_GATE_ENTERED, 0);
        assert_eq!(buf.data[OWNER_SLOT_WARP_GATE_ID] as u32, 42);
        // No teleport: owner stays put.
        assert!((buf.data[OWNER_SLOT_X] - 1600.0).abs() < 1e-3);
        assert!((buf.data[OWNER_SLOT_Y] - 1200.0).abs() < 1e-3);
    }

    #[test]
    fn owner_sim_walk_cycle_event() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;

        let mut saw_cycle = false;
        for _ in 0..40 {
            buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;
            let events = step_owner_buffer(&mut buf, &input);
            if events & OWNER_EVENT_WALK_CYCLE != 0 {
                saw_cycle = true;
                break;
            }
        }
        assert!(saw_cycle, "walk cycle event should fire while walking");
    }

    #[test]
    fn owner_sim_point_hit_tests() {
        assert!(is_point_on_player(0.0, 0.0, 0.0, 0.0, OWNER_BODY_RADIUS));
        assert!(is_point_on_player(10.0, 0.0, 0.0, 0.0, OWNER_BODY_RADIUS));
        assert!(!is_point_on_player(100.0, 0.0, 0.0, 0.0, OWNER_BODY_RADIUS));

        assert!(is_point_on_rear_brake_arc(-20.0, 0.0, 0.0, 0.0, 0.0, REAR_BRAKE_ARC_RADIUS));
        assert!(!is_point_on_rear_brake_arc(20.0, 0.0, 0.0, 0.0, 0.0, REAR_BRAKE_ARC_RADIUS));
        assert!(!is_point_on_rear_brake_arc(-100.0, 0.0, 0.0, 0.0, 0.0, REAR_BRAKE_ARC_RADIUS));
    }

    #[test]
    fn owner_sim_wander_ray_lookahead() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);
        assert!(wander_ray_clear(1600.0, 1200.0, 0.0, &input));

        let blocked = [WorldObstacle::Circle { x: 1720.0, y: 1200.0, r: 10.0 }];
        let input2 = base_input(&gates, &blocked);
        assert!(!wander_ray_clear(1600.0, 1200.0, 0.0, &input2));
        assert_eq!(WANDER_LOOKAHEAD, 120.0);
    }

    #[test]
    fn owner_sim_wander_chooses_nearest_clear_ray() {
        let gates: [WarpGate; 0] = [];
        let obstacles = [WorldObstacle::Circle { x: 1720.0, y: 1200.0, r: 10.0 }];
        let input = base_input(&gates, &obstacles);

        // Enter WANDER on a prior step so the command does not reset the
        // wander timer/heading on the step under test.
        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WANDER as f32;
        step_owner_buffer(&mut buf, &input);

        // Now pin the heading straight at the obstacle and keep the timer
        // fresh so no random refresh occurs.
        buf.data[OWNER_SLOT_WANDER_HEADING] = 0.0;
        buf.data[OWNER_SLOT_WANDER_TIMER] = 10.0;

        let events = step_owner_buffer(&mut buf, &input);
        let heading = buf.data[OWNER_SLOT_WANDER_HEADING];
        assert!(heading.abs() > 0.01, "should steer to a side ray, got {}", heading);
        assert_eq!(events & OWNER_EVENT_WANDER_BLOCKED, 0);
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, OWNER_GAIT_WANDER);
    }

    #[test]
    fn owner_sim_wander_all_rays_blocked_rotates_in_place() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];

        // Place the owner at the far corner so every ray leaves the field.
        let max_x = 3200.0 - OWNER_BODY_RADIUS;
        let max_y = 2400.0 - OWNER_BODY_RADIUS;

        // Keep the dog at the same corner so leash projection does not pull
        // the owner back toward the field interior.
        let mut input = base_input(&gates, &obstacles);
        input.dog_pos_x = max_x;
        input.dog_pos_y = max_y;

        let mut buf = buf_at(max_x, max_y);

        // Enter WANDER on a prior step so the command does not reset the
        // wander timer/heading on the step under test.
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WANDER as f32;
        step_owner_buffer(&mut buf, &input);

        // Pin the heading toward the corner (out of bounds) and keep the
        // timer fresh so no random refresh occurs.
        buf.data[OWNER_SLOT_WANDER_HEADING] = PI * 0.25;
        buf.data[OWNER_SLOT_WANDER_TIMER] = 10.0;

        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_WANDER_BLOCKED, 0);
        // Blocked wander keeps WANDER gait and rotates in place.
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, OWNER_GAIT_WANDER);
        assert_eq!(buf.data[OWNER_SLOT_WANDER_BLOCKED], 1.0);
        let heading = buf.data[OWNER_SLOT_WANDER_HEADING];
        assert!(
            (heading - (PI * 0.25 + WANDER_MAX_TURN_RATE_RAD_S * 0.1)).abs() < 1e-3,
            "should rotate in place at the locked rate, got {}",
            heading
        );
        // Blocked wander must not trigger step-off.
        assert_eq!(events & OWNER_EVENT_STEP_OFF_STARTED, 0);
    }

    #[test]
    fn owner_sim_wander_refresh_uses_mulberry32() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WANDER as f32;
        buf.data[OWNER_SLOT_WANDER_TIMER] = 0.0;

        step_owner_buffer(&mut buf, &input);
        assert!((buf.data[OWNER_SLOT_WANDER_TIMER] - WANDER_REFRESH_S).abs() < 1e-4);
        let rng_hi = buf.data[OWNER_SLOT_RNG_HI];
        let rng_lo = buf.data[OWNER_SLOT_RNG_LO];
        assert!(rng_hi != 0.0 || rng_lo != 0.0, "mulberry32 state must be persisted");
        assert!(buf.data[OWNER_SLOT_WANDER_HEADING].is_finite());
    }

    #[test]
    fn owner_sim_reset_places_owner_at_origin() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        // Keep the dog near the origin so leash projection does not interfere.
        input.dog_pos_x = 0.0;
        input.dog_pos_y = 0.0;

        let mut buf = buf_at(100.0, 100.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_RESET as f32;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_RESET, 0);
        // RESET places the owner at (0,0); with field_min == 0 the raw bounds
        // clamp leaves it exactly at the origin.
        assert!((buf.data[OWNER_SLOT_X] - 0.0).abs() < 1e-3);
        assert!((buf.data[OWNER_SLOT_Y] - 0.0).abs() < 1e-3);
    }

    #[test]
    fn owner_sim_jog_cooldown_ready_event() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(400.0, 400.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_JOG as f32;
        step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_GAIT] as u32, OWNER_GAIT_JOG);

        // Run out the jog duration, then the cooldown, watching for the
        // JOG_COOLDOWN_READY edge.
        let mut saw_ready = false;
        for _ in 0..200 {
            let events = step_owner_buffer(&mut buf, &input);
            if events & OWNER_EVENT_JOG_COOLDOWN_READY != 0 {
                saw_ready = true;
                break;
            }
        }
        assert!(saw_ready, "JOG_COOLDOWN_READY should fire once cooldown ends");
        assert_eq!(buf.data[OWNER_SLOT_JOG_COOLDOWN], 0.0);
    }

    #[test]
    fn owner_sim_jog_started_event() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(400.0, 400.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_JOG as f32;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_JOG_STARTED, 0);
    }

    #[test]
    fn owner_sim_input_vector_steers_walk() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_INPUT_X] = 0.0;
        buf.data[OWNER_SLOT_INPUT_Y] = 1.0;
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;

        for _ in 0..40 {
            buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;
            step_owner_buffer(&mut buf, &input);
        }
        let heading = buf.data[OWNER_SLOT_ANGLE];
        assert!(
            (heading - PI * 0.5).abs() < 1e-2,
            "owner should steer toward +y input, got {}",
            heading
        );
    }

    #[test]
    fn owner_sim_face_dog_latches_dog_heading() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        input.dog_heading_rad = PI * 0.5;

        let mut buf = buf_at(1600.0, 1200.0);
        // FACE_DOG latches across steps; STAND turn rate is PI rad/s, so at
        // dt=0.1 that is ~0.314 rad/tick and several ticks reach PI/2.
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_FACE_DOG as f32;
        for _ in 0..20 {
            step_owner_buffer(&mut buf, &input);
        }
        let heading = buf.data[OWNER_SLOT_ANGLE];
        assert!((heading - PI * 0.5).abs() < 1e-3);
    }

    #[test]
    fn owner_sim_face_dog_latch_after_clear() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        input.dog_heading_rad = PI * 0.5;

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_FACE_DOG as f32;
        step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_FACE_DOG_LATCH], 1.0);

        // CLEAR_FACE_DOG releases the latch.
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_CLEAR_FACE_DOG as f32;
        step_owner_buffer(&mut buf, &input);
        assert_eq!(buf.data[OWNER_SLOT_FACE_DOG_LATCH], 0.0);

        // With the latch cleared and no command, the owner holds its heading.
        let held = buf.data[OWNER_SLOT_ANGLE];
        step_owner_buffer(&mut buf, &input);
        assert!((buf.data[OWNER_SLOT_ANGLE] - held).abs() < 1e-4);
    }

    #[test]
    fn owner_sim_wander_turn_rate_constant() {
        assert!((gait_turn_rate(OWNER_GAIT_WANDER) - PI * 1.4).abs() < 1e-6);
        assert!((WANDER_MAX_TURN_RATE_RAD_S - PI * 1.4).abs() < 1e-6);
    }

    #[test]
    fn owner_sim_step_off_max_duration_and_tolerance() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        // Target heading is +y (PI/2); owner starts facing +x (0).
        input.dog_heading_rad = 0.0;

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_INPUT_X] = 0.0;
        buf.data[OWNER_SLOT_INPUT_Y] = 1.0;
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;

        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_STEP_OFF_STARTED, 0);
        // Step-off freezes locomotion.
        assert_eq!(buf.data[OWNER_SLOT_SPEED], 0.0);

        // Step-off must finish within the locked max duration.
        let mut finished = false;
        let mut ticks = 0;
        while ticks < 100 {
            buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;
            let events = step_owner_buffer(&mut buf, &input);
            ticks += 1;
            if events & OWNER_EVENT_STEP_OFF_FINISHED != 0 {
                finished = true;
                break;
            }
        }
        assert!(finished, "step-off should finish");
        assert!(
            (ticks as f32) * 0.1 <= STEP_OFF_MAX_DURATION_S + 0.1,
            "step-off exceeded max duration: {} ticks",
            ticks
        );
        // Locked 5 degree alignment tolerance.
        assert!((STEP_OFF_ALIGN_TOLERANCE_RAD - 5.0_f32.to_radians()).abs() < 1e-6);
        // After finishing, the owner is aligned within the tolerance.
        let heading = buf.data[OWNER_SLOT_ANGLE];
        let err = angle_delta(heading, PI * 0.5).abs();
        assert!(
            err <= STEP_OFF_ALIGN_TOLERANCE_RAD + 1e-3,
            "owner should be aligned within tolerance, err = {}",
            err
        );
    }

    #[test]
    fn owner_sim_input_vector_heading() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        buf.data[OWNER_SLOT_INPUT_X] = 1.0;
        buf.data[OWNER_SLOT_INPUT_Y] = 0.0;
        buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;

        for _ in 0..40 {
            buf.data[OWNER_SLOT_CMD_FLAGS] = OWNER_CMD_WALK as f32;
            step_owner_buffer(&mut buf, &input);
        }
        let heading = buf.data[OWNER_SLOT_ANGLE];
        assert!(heading.abs() < 1e-2, "owner should face +x, got {}", heading);
    }

    #[test]
    fn owner_sim_leash_slack_hysteresis() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);

        let mut buf = buf_at(1600.0, 1200.0);
        // Make the leash taut. The owner is projected to exactly
        // MAX_LEASH_LENGTH_PX from the dog.
        input.dog_pos_x = 1600.0 + MAX_LEASH_LENGTH_PX + 20.0;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_LEASH_TAUT, 0);

        // The owner is now at dog_x - MAX. With STAND gait and no input the
        // owner stays put, so we can control the leash distance precisely.
        let owner_x = buf.data[OWNER_SLOT_X];

        // Relax just below the taut threshold but above the hysteresis band:
        // no SLACK event yet.
        input.dog_pos_x = owner_x + (MAX_LEASH_LENGTH_PX - 1.0);
        let events = step_owner_buffer(&mut buf, &input);
        assert_eq!(events & OWNER_EVENT_LEASH_SLACK, 0);

        // Relax clearly below the hysteresis threshold: SLACK fires.
        input.dog_pos_x = owner_x + (MAX_LEASH_LENGTH_PX - 10.0);
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_LEASH_SLACK, 0);
    }

    #[test]
    fn owner_sim_poop_hold_requires_taut() {
        let gates: [WarpGate; 0] = [];
        let obstacles: [WorldObstacle; 0] = [];
        let mut input = base_input(&gates, &obstacles);
        input.dog_is_pooping = true;
        // Dog close: leash slack.
        input.dog_pos_x = 1600.0;
        input.dog_pos_y = 1200.0;

        let mut buf = buf_at(1600.0, 1200.0);
        let events = step_owner_buffer(&mut buf, &input);
        assert_eq!(events & OWNER_EVENT_POOP_HOLD, 0);

        // Dog far: leash taut -> POOP_HOLD fires.
        input.dog_pos_x = 1600.0 + MAX_LEASH_LENGTH_PX + 20.0;
        let events = step_owner_buffer(&mut buf, &input);
        assert_ne!(events & OWNER_EVENT_POOP_HOLD, 0);
    }

    #[test]
    fn owner_sim_hit_test_guards() {
        // Negative / non-finite radius must not report a hit.
        assert!(!is_point_on_player(0.0, 0.0, 0.0, 0.0, -1.0));
        assert!(!is_point_on_player(0.0, 0.0, 0.0, 0.0, f32::NAN));
        assert!(!is_point_on_rear_brake_arc(
            -20.0,
            0.0,
            0.0,
            0.0,
            0.0,
            f32::NAN
        ));
    }
}
