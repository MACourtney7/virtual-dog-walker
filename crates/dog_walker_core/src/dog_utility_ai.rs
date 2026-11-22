//! Dog utility AI: utility scoring, steering composition, and micro-expression
//! integration.
//!
//! Public APIs are allocation free. All mutable state lives in the fixed-size
//! [`DogSimBuffer`] slot array (see `dog_contract`).

use crate::collision::WorldObstacle;
use crate::dog_contract::*;
use crate::math::Mulberry32;

// ---------------------------------------------------------------------------
// Utility identifiers
// ---------------------------------------------------------------------------

pub const UTIL_HEEL_FOLLOW: u32 = 0;
pub const UTIL_FETCH_BALL: u32 = 1;
pub const UTIL_RECALL: u32 = 2;
pub const UTIL_ROAM_EXPLORE: u32 = 3;
pub const UTIL_SCOUT_AHEAD: u32 = 4;
pub const UTIL_LAG_AND_SNIFF: u32 = 5;
pub const UTIL_CHECK_IN: u32 = 6;
pub const UTIL_SOCIAL_GREET: u32 = 7;
pub const UTIL_PACK_PLAY: u32 = 8;
pub const UTIL_ZOOMIES: u32 = 9;
pub const UTIL_AMBIENT_REST: u32 = 10;
pub const UTIL_BARK_IMPULSE: u32 = 11;

const UTIL_COUNT: usize = 12;

// ---------------------------------------------------------------------------
// Buffer aliases (contract indices live in `dog_contract`)
// ---------------------------------------------------------------------------

const DOG_BUF_POS_X: usize = DOG_BUF_DOG_X;
const DOG_BUF_POS_Y: usize = DOG_BUF_DOG_Y;
const DOG_BUF_VEL_X: usize = DOG_BUF_DOG_VX;
const DOG_BUF_VEL_Y: usize = DOG_BUF_DOG_VY;

const DOG_BUF_NPC_X: usize = DOG_BUF_NPC0_X;
const DOG_BUF_NPC_Y: usize = DOG_BUF_NPC0_Y;
const DOG_BUF_PEER_X: usize = DOG_BUF_PEER0_X;
const DOG_BUF_PEER_Y: usize = DOG_BUF_PEER0_Y;

const DOG_BUF_TRAIT_CURIOSITY: usize = DOG_BUF_CURIOSITY;
const DOG_BUF_TRAIT_ENERGY: usize = DOG_BUF_ENERGY;
const DOG_BUF_TRAIT_STUBBORNNESS: usize = DOG_BUF_STUBBORNNESS;
const DOG_BUF_TRAIT_LOYALTY: usize = DOG_BUF_LOYALTY;

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

pub struct UtilityInput<'a> {
    pub buffer: &'a DogSimBuffer,
    pub combo: DiscreteCombo,
    pub traits: PersonalityTraits,
    pub obstacles: &'a [WorldObstacle],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UtilityOutput {
    pub active_utility_id: u32,
    pub active_utility_score: f32,
    pub steer_x: f32,
    pub steer_y: f32,
    pub desired_speed: f32,
    pub desired_gait: GaitModeId,
    pub roam_submode: RoamSubModeId,
    pub zoomie_path: ZoomiePathId,
    pub ear_target_left: f32,
    pub ear_target_right: f32,
    pub tail_wag_speed: f32,
    pub tail_angle: f32,
    pub nose_twitch: f32,
    pub events: u32,
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

#[inline]
fn unit(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
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

#[inline]
fn magnitude(x: f32, y: f32) -> f32 {
    let m = (x * x + y * y).sqrt();
    if m.is_finite() {
        m
    } else {
        0.0
    }
}

#[inline]
fn speed_of(buffer: &DogSimBuffer) -> f32 {
    let vx = finite_or(buffer.slots[DOG_BUF_VEL_X], 0.0);
    let vy = finite_or(buffer.slots[DOG_BUF_VEL_Y], 0.0);
    magnitude(vx, vy)
}

fn gait_from_speed(speed: f32) -> GaitModeId {
    if speed < 1.0 {
        GaitModeId::Idle
    } else if speed < 20.0 {
        GaitModeId::Walk
    } else if speed < 40.0 {
        GaitModeId::Trot
    } else {
        GaitModeId::Gallop
    }
}

#[inline]
fn gait_index(gait: GaitModeId) -> f32 {
    gait as u32 as f32
}

#[inline]
fn roam_index(submode: RoamSubModeId) -> f32 {
    submode as u32 as f32
}

#[inline]
fn zoomie_index(path: ZoomiePathId) -> f32 {
    path as u32 as f32
}

/// Camera "openness" proxy: fewer obstacles means more room to roam.
fn camera_open_space(input: &UtilityInput<'_>) -> f32 {
    let n = input.obstacles.len() as f32;
    unit(1.0 / (1.0 + n * 0.25))
}

fn ball_available(input: &UtilityInput<'_>) -> bool {
    if input.combo.has_ball {
        return true;
    }
    finite_or(input.buffer.slots[DOG_BUF_BALL_ACTIVE], 0.0) > 0.5
}

// ---------------------------------------------------------------------------
// Utility scores (each clamped to [0.0, 1.0] and finite)
// ---------------------------------------------------------------------------

pub fn score_heel_follow(input: &UtilityInput<'_>) -> f32 {
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    let loyalty = unit(input.traits.loyalty as f32);
    let base = 0.20 + 0.45 * loyalty + 0.15 * energy - 0.20 * curiosity;
    let leash_bonus = if input.combo.is_on_leash { 0.20 } else { 0.0 };
    unit(base + leash_bonus)
}

pub fn score_fetch_ball(input: &UtilityInput<'_>) -> f32 {
    if input.combo.is_on_leash
        || input.combo.is_pooping
        || input.combo.has_need
        || !ball_available(input)
    {
        return 0.0;
    }
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    unit(0.30 + 0.40 * energy + 0.30 * curiosity)
}

pub fn score_recall(input: &UtilityInput<'_>) -> f32 {
    if finite_or(input.buffer.slots[DOG_BUF_CMD_WHISTLE_RECALL], 0.0) <= 0.5 {
        return 0.0;
    }
    let loyalty = unit(input.traits.loyalty as f32);
    let stubbornness = unit(input.traits.stubbornness as f32);
    unit(0.35 + 0.50 * loyalty - 0.35 * stubbornness)
}

pub fn score_roam_explore(input: &UtilityInput<'_>) -> f32 {
    if input.combo.is_on_leash {
        return 0.0;
    }
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    unit(0.20 + 0.45 * curiosity + 0.15 * energy + 0.20 * camera_open_space(input))
}

pub fn score_scout_ahead(input: &UtilityInput<'_>) -> f32 {
    if input.combo.is_on_leash {
        return 0.0;
    }
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    let loyalty = unit(input.traits.loyalty as f32);
    unit(0.15 + 0.40 * curiosity + 0.25 * energy - 0.20 * loyalty)
}

pub fn score_lag_and_sniff(input: &UtilityInput<'_>) -> f32 {
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    let stubbornness = unit(input.traits.stubbornness as f32);
    unit(0.10 + 0.45 * curiosity + 0.20 * stubbornness - 0.15 * energy)
}

pub fn score_check_in(input: &UtilityInput<'_>) -> f32 {
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    let loyalty = unit(input.traits.loyalty as f32);
    unit(0.15 + 0.50 * loyalty + 0.15 * curiosity + 0.10 * energy)
}

pub fn score_social_greet(input: &UtilityInput<'_>) -> f32 {
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    let loyalty = unit(input.traits.loyalty as f32);
    unit(0.10 + 0.35 * energy + 0.25 * curiosity + 0.15 * loyalty)
}

pub fn score_pack_play(input: &UtilityInput<'_>) -> f32 {
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    let stubbornness = unit(input.traits.stubbornness as f32);
    unit(0.10 + 0.45 * energy + 0.20 * curiosity - 0.15 * stubbornness)
}

pub fn score_zoomies(input: &UtilityInput<'_>) -> f32 {
    if input.combo.is_on_leash
        || finite_or(input.buffer.slots[DOG_BUF_ZOOMIES_COOLDOWN], 0.0) > 0.0
    {
        return 0.0;
    }
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    unit(0.15 + 0.65 * energy + 0.20 * curiosity)
}

pub fn score_ambient_rest(input: &UtilityInput<'_>) -> f32 {
    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    let stubbornness = unit(input.traits.stubbornness as f32);
    unit(0.25 + 0.40 * (1.0 - energy) + 0.15 * stubbornness - 0.15 * curiosity)
}

pub fn score_bark_impulse(input: &UtilityInput<'_>) -> f32 {
    let energy = unit(input.traits.energy as f32);
    let stubbornness = unit(input.traits.stubbornness as f32);
    let loyalty = unit(input.traits.loyalty as f32);
    unit(0.05 + 0.30 * stubbornness + 0.15 * energy - 0.10 * loyalty)
}

fn score_all(input: &UtilityInput<'_>) -> [f32; UTIL_COUNT] {
    [
        score_heel_follow(input),
        score_fetch_ball(input),
        score_recall(input),
        score_roam_explore(input),
        score_scout_ahead(input),
        score_lag_and_sniff(input),
        score_check_in(input),
        score_social_greet(input),
        score_pack_play(input),
        score_zoomies(input),
        score_ambient_rest(input),
        score_bark_impulse(input),
    ]
}

// ---------------------------------------------------------------------------
// Utility orchestration
// ---------------------------------------------------------------------------

fn pick_best(scores: &[f32; UTIL_COUNT], current: Option<u32>) -> (u32, f32) {
    let mut best_id: u32 = 0;
    let mut best_score = f32::NEG_INFINITY;

    for (index, raw) in scores.iter().enumerate() {
        let id = index as u32;
        let mut score = unit(*raw);
        if Some(id) == current {
            score = unit(score + 0.12);
        }
        // Strictly greater: ties break towards the lower utility id.
        if score > best_score {
            best_score = score;
            best_id = id;
        }
    }

    (best_id, unit(best_score))
}

pub fn select_best_utility(input: &UtilityInput<'_>) -> (u32, f32) {
    let scores = score_all(input);
    let stored = finite_or(input.buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID], -1.0) as i32;
    let current = if (0..UTIL_COUNT as i32).contains(&stored) {
        Some(stored as u32)
    } else {
        None
    };
    pick_best(&scores, current)
}

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

fn target_for(active: u32, input: &UtilityInput<'_>) -> (f32, f32, f32) {
    let b = &input.buffer.slots;
    let px = finite_or(b[DOG_BUF_POS_X], 0.0);
    let py = finite_or(b[DOG_BUF_POS_Y], 0.0);
    let ox = finite_or(b[DOG_BUF_OWNER_X], px);
    let oy = finite_or(b[DOG_BUF_OWNER_Y], py);
    let now = finite_or(b[DOG_BUF_NOW_SEC], 0.0);

    match active {
        UTIL_HEEL_FOLLOW | UTIL_RECALL | UTIL_CHECK_IN => (ox, oy, 0.90),
        UTIL_FETCH_BALL => (
            finite_or(b[DOG_BUF_BALL_X], ox),
            finite_or(b[DOG_BUF_BALL_Y], oy),
            0.85,
        ),
        UTIL_ROAM_EXPLORE | UTIL_LAG_AND_SNIFF | UTIL_SCOUT_AHEAD => (
            ox + (now * 0.7).sin() * 120.0,
            oy + (now * 0.9).cos() * 120.0,
            0.60,
        ),
        UTIL_SOCIAL_GREET | UTIL_PACK_PLAY => (
            finite_or(b[DOG_BUF_PEER_X], ox),
            finite_or(b[DOG_BUF_PEER_Y], oy),
            0.70,
        ),
        UTIL_ZOOMIES => (
            ox + (now * 1.3).sin() * 80.0,
            oy + (now * 1.3).cos() * 80.0,
            0.80,
        ),
        UTIL_AMBIENT_REST | UTIL_BARK_IMPULSE => (px, py, 0.0),
        _ => (ox, oy, 0.50),
    }
}

fn seek_force(input: &UtilityInput<'_>, active: u32, px: f32, py: f32) -> (f32, f32) {
    let (tx, ty, strength) = target_for(active, input);
    let dx = tx - px;
    let dy = ty - py;
    let distance = magnitude(dx, dy);
    if distance > 1e-4 && strength > 0.0 {
        (dx / distance * strength, dy / distance * strength)
    } else {
        (0.0, 0.0)
    }
}

fn arrive_force(input: &UtilityInput<'_>) -> (f32, f32) {
    let vx = finite_or(input.buffer.slots[DOG_BUF_VEL_X], 0.0);
    let vy = finite_or(input.buffer.slots[DOG_BUF_VEL_Y], 0.0);
    (-vx * 0.05, -vy * 0.05)
}

fn obstacle_center_radius(obstacle: &WorldObstacle) -> (f32, f32, f32) {
    match obstacle {
        WorldObstacle::Circle { x, y, r } => (*x as f32, *y as f32, *r as f32),
        WorldObstacle::Rect { x, y, hw, hh } => {
            let hw = *hw as f32;
            let hh = *hh as f32;
            (*x as f32, *y as f32, (hw * hw + hh * hh).sqrt())
        }
    }
}

fn obstacle_skirt_force(input: &UtilityInput<'_>, px: f32, py: f32) -> (f32, f32) {
    let mut fx = 0.0;
    let mut fy = 0.0;

    for obstacle in input.obstacles {
        let (ox, oy, radius) = obstacle_center_radius(obstacle);
        let limit = radius + 24.0 + 8.0;
        let dx = px - ox;
        let dy = py - oy;
        let distance = magnitude(dx, dy);
        if distance > 1e-4 && distance < limit {
            let strength = (1.0 - distance / limit) * 1.5;
            fx += dx / distance * strength;
            fy += dy / distance * strength;
        }
    }

    (fx, fy)
}

fn screen_perimeter_force(input: &UtilityInput<'_>, px: f32, py: f32) -> (f32, f32) {
    let b = &input.buffer.slots;
    if finite_or(b[DOG_BUF_CAM_ACTIVE], 0.0) <= 0.5 {
        return (0.0, 0.0);
    }

    let left = finite_or(b[DOG_BUF_CAM_LEFT], 0.0);
    let top = finite_or(b[DOG_BUF_CAM_TOP], 0.0);
    let right = finite_or(b[DOG_BUF_CAM_RIGHT], 0.0);
    let bottom = finite_or(b[DOG_BUF_CAM_BOTTOM], 0.0);

    if !(right > left) || !(bottom > top) {
        return (0.0, 0.0);
    }

    let margin = 24.0;
    let mut fx = 0.0;
    let mut fy = 0.0;

    if px < left + margin {
        fx += ((left + margin - px) / margin).clamp(0.0, 1.0);
    }
    if px > right - margin {
        fx -= ((px - (right - margin)) / margin).clamp(0.0, 1.0);
    }
    if py < top + margin {
        fy += ((top + margin - py) / margin).clamp(0.0, 1.0);
    }
    if py > bottom - margin {
        fy -= ((py - (bottom - margin)) / margin).clamp(0.0, 1.0);
    }

    (fx, fy)
}

fn soft_tether_force(input: &UtilityInput<'_>, px: f32, py: f32) -> (f32, f32) {
    if !input.combo.is_on_leash {
        return (0.0, 0.0);
    }

    let ox = finite_or(input.buffer.slots[DOG_BUF_OWNER_X], px);
    let oy = finite_or(input.buffer.slots[DOG_BUF_OWNER_Y], py);
    let dx = ox - px;
    let dy = oy - py;
    let distance = magnitude(dx, dy);

    if distance > 39.0 {
        let strength = ((distance - 39.0) * 0.02).min(1.0);
        (dx / distance * strength, dy / distance * strength)
    } else {
        (0.0, 0.0)
    }
}

fn npc_berth_force(input: &UtilityInput<'_>, px: f32, py: f32) -> (f32, f32) {
    let nx = finite_or(input.buffer.slots[DOG_BUF_NPC_X], px);
    let ny = finite_or(input.buffer.slots[DOG_BUF_NPC_Y], py);
    let dx = px - nx;
    let dy = py - ny;
    let distance = magnitude(dx, dy);

    if distance > 1e-4 && distance < 30.0 {
        let strength = (30.0 - distance) / 30.0 * 1.2;
        (dx / distance * strength, dy / distance * strength)
    } else {
        (0.0, 0.0)
    }
}

fn social_circle_force(input: &UtilityInput<'_>, px: f32, py: f32) -> (f32, f32) {
    let ox = finite_or(input.buffer.slots[DOG_BUF_PEER_X], px);
    let oy = finite_or(input.buffer.slots[DOG_BUF_PEER_Y], py);
    let dx = ox - px;
    let dy = oy - py;
    let distance = magnitude(dx, dy);

    if distance > 1e-4 && distance < 80.0 {
        let ux = dx / distance;
        let uy = dy / distance;
        let falloff = 1.0 - distance / 80.0;
        let attract = 0.25 * falloff;
        let tangent = 0.20 * falloff;
        (ux * attract - uy * tangent, uy * attract + ux * tangent)
    } else {
        (0.0, 0.0)
    }
}

fn zoomies_parametric_step(input: &UtilityInput<'_>, active: u32) -> (f32, f32) {
    if active != UTIL_ZOOMIES {
        return (0.0, 0.0);
    }
    let now = finite_or(input.buffer.slots[DOG_BUF_NOW_SEC], 0.0);
    ((now * 2.1).sin() * 0.5, (now * 2.7).cos() * 0.5)
}

pub fn compute_steering(input: &UtilityInput<'_>, active_utility_id: u32) -> (f32, f32) {
    let b = &input.buffer.slots;
    let px = finite_or(b[DOG_BUF_POS_X], 0.0);
    let py = finite_or(b[DOG_BUF_POS_Y], 0.0);

    let (sx, sy) = seek_force(input, active_utility_id, px, py);
    let (ax, ay) = arrive_force(input);
    let (ox, oy) = obstacle_skirt_force(input, px, py);
    let (mx, my) = screen_perimeter_force(input, px, py);
    let (tx, ty) = soft_tether_force(input, px, py);
    let (nx, ny) = npc_berth_force(input, px, py);
    let (cx, cy) = social_circle_force(input, px, py);
    let (zx, zy) = zoomies_parametric_step(input, active_utility_id);

    let fx = sx + ax + ox + mx + tx + nx + cx + zx;
    let fy = sy + ay + oy + my + ty + ny + cy + zy;
    let mag = magnitude(fx, fy);

    if mag <= 1e-6 {
        (0.0, 0.0)
    } else if mag > 1.0 {
        (fx / mag, fy / mag)
    } else {
        (fx, fy)
    }
}

// ---------------------------------------------------------------------------
// Sub-mode selection
// ---------------------------------------------------------------------------

pub fn select_roam_submode(input: &UtilityInput<'_>, active_utility_id: u32) -> RoamSubModeId {
    match active_utility_id {
        UTIL_SCOUT_AHEAD => RoamSubModeId::ScoutAhead,
        UTIL_LAG_AND_SNIFF => RoamSubModeId::LagAndSniff,
        UTIL_CHECK_IN => RoamSubModeId::CheckIn,
        UTIL_ROAM_EXPLORE => {
            let curiosity = unit(input.traits.curiosity as f32);
            let energy = unit(input.traits.energy as f32);
            if curiosity >= 0.66 {
                RoamSubModeId::Explore
            } else if energy >= 0.66 {
                RoamSubModeId::CatchUp
            } else if curiosity >= 0.33 {
                RoamSubModeId::LookBack
            } else {
                RoamSubModeId::MicroPause
            }
        }
        _ => RoamSubModeId::Baseline,
    }
}

pub fn select_zoomie_path(input: &UtilityInput<'_>) -> ZoomiePathId {
    let (best, _) = select_best_utility(input);
    if best != UTIL_ZOOMIES {
        return ZoomiePathId::None;
    }

    let seed = finite_or(input.buffer.slots[DOG_BUF_RNG_SEED], 0.0).to_bits()
        ^ finite_or(input.buffer.slots[DOG_BUF_NOW_SEC], 0.0).to_bits();
    let mut rng = Mulberry32::new(seed);
    let roll = rng.next_f64();

    match (roll * 3.0) as u32 {
        0 => ZoomiePathId::FigureEight,
        1 => ZoomiePathId::OrbitOwner,
        _ => ZoomiePathId::Shuttle,    }
}

// ---------------------------------------------------------------------------
// Micro-expression integration
// ---------------------------------------------------------------------------

fn step_ear_spring(
    buffer: &mut DogSimBuffer,
    angle_index: usize,
    velocity_index: usize,
    target: f32,
    dt: f32,
) -> f32 {
    let angle = finite_or(buffer.slots[angle_index], 0.0);
    let velocity = finite_or(buffer.slots[velocity_index], 0.0);

    let mut next_velocity = velocity + (target - angle) * 8.0 * dt - velocity * 5.0 * dt;
    if !next_velocity.is_finite() {
        next_velocity = 0.0;
    }

    let mut next_angle = angle + next_velocity * dt;
    if !next_angle.is_finite() {
        next_angle = 0.0;
    }
    next_angle = next_angle.clamp(-0.5, 0.5);

    buffer.slots[velocity_index] = next_velocity;
    buffer.slots[angle_index] = next_angle;
    next_angle
}

pub fn integrate_micro_expressions(
    buffer: &mut DogSimBuffer,
    input: &UtilityInput<'_>,
    dt: f32,
) -> u32 {
    let dt = if dt.is_finite() {
        dt.clamp(0.0, 0.1)
    } else {
        0.0
    };

    let curiosity = unit(input.traits.curiosity as f32);
    let energy = unit(input.traits.energy as f32);
    let stubbornness = unit(input.traits.stubbornness as f32);
    let loyalty = unit(input.traits.loyalty as f32);

    // Ear targets ---------------------------------------------------------
    let target_raw = 0.15 + 0.35 * curiosity + 0.20 * energy + 0.10 * loyalty;
    let ear_target = if target_raw.is_finite() {
        target_raw.clamp(0.0, 0.5)
    } else {
        0.0
    };

    let _left = step_ear_spring(
        buffer,
        DOG_BUF_LEFT_EAR_ANGLE,
        DOG_BUF_LEFT_EAR_VEL,
        ear_target,
        dt,
    );
    let _right = step_ear_spring(
        buffer,
        DOG_BUF_RIGHT_EAR_ANGLE,
        DOG_BUF_RIGHT_EAR_VEL,
        ear_target,
        dt,
    );

    // Gait + phase --------------------------------------------------------
    let speed = speed_of(buffer);
    let gait = gait_from_speed(speed);

    let previous_phase = finite_or(buffer.slots[DOG_BUF_GAIT_PHASE], 0.0).rem_euclid(1.0);
    let mut next_phase = previous_phase + speed / 12.0 * dt;
    let wrapped = next_phase >= 1.0;
    next_phase %= 1.0;
    if !next_phase.is_finite() {
        next_phase = 0.0;
    }

    // Tail ----------------------------------------------------------------
    let tail_wag_raw = 2.0 + 8.0 * energy + 3.0 * curiosity - 2.0 * stubbornness;
    let tail_wag_speed = if tail_wag_raw.is_finite() {
        tail_wag_raw.clamp(0.0, 12.0)
    } else {
        0.0
    };

    let tail_angle_raw = 0.35 * next_phase.sin() + 0.15 * (2.0 * next_phase).sin();
    let tail_angle = if tail_angle_raw.is_finite() {
        tail_angle_raw.clamp(-0.6, 0.6)
    } else {
        0.0
    };

    // Nose ----------------------------------------------------------------
    let now = finite_or(buffer.slots[DOG_BUF_NOW_SEC], 0.0);
    let nose_base = unit(0.1 + 0.5 * curiosity + 0.2 * energy);
    let nose_oscillator = 0.5 + 0.5 * (now * 4.0).sin();
    let nose_twitch = unit(nose_base * nose_oscillator);

    // Events --------------------------------------------------------------
    let active = finite_or(buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID], -1.0) as i32;
    let active = if (0..UTIL_COUNT as i32).contains(&active) {
        active as u32
    } else {
        u32::MAX
    };

    let mut events = 0u32;

    if active == UTIL_BARK_IMPULSE {
        events |= DOG_EVENT_BARK_TRIGGERED;
    }
    if wrapped && matches!(gait, GaitModeId::Gallop) {
        events |= DOG_EVENT_GALLOP_PUFF;
    }
    if active == UTIL_LAG_AND_SNIFF {
        events |= DOG_EVENT_SNIFF_AUDIO;
        if nose_twitch > 0.5 {
            events |= DOG_EVENT_SCENT_DEPOSITED;
        }
    }
    if active == UTIL_RECALL && loyalty < 0.4 {
        events |= DOG_EVENT_WHINE_AUDIO;
    }
    if input.combo.has_need {
        events |= DOG_EVENT_WHINE_AUDIO;
    }
    if energy > 0.7 && speed > 1.0 {
        events |= DOG_EVENT_PANT_AUDIO;
    }

    if active == UTIL_FETCH_BALL && ball_available(input) {
        if speed < 2.0 {
            events |= DOG_EVENT_BALL_GRABBED;
        }
        let ox = finite_or(buffer.slots[DOG_BUF_OWNER_X], 0.0);
        let oy = finite_or(buffer.slots[DOG_BUF_OWNER_Y], 0.0);
        let px = finite_or(buffer.slots[DOG_BUF_POS_X], 0.0);
        let py = finite_or(buffer.slots[DOG_BUF_POS_Y], 0.0);
        if magnitude(px - ox, py - oy) < 24.0 {
            events |= DOG_EVENT_BALL_HANDOFF;
        }
    }

    if active == UTIL_ROAM_EXPLORE && wrapped && speed > 5.0 {
        events |= DOG_EVENT_STICK_PICKED_UP;
    }

    if active == UTIL_SOCIAL_GREET {
        let nx = finite_or(buffer.slots[DOG_BUF_NPC_X], 0.0);
        let ny = finite_or(buffer.slots[DOG_BUF_NPC_Y], 0.0);
        let px = finite_or(buffer.slots[DOG_BUF_POS_X], 0.0);
        let py = finite_or(buffer.slots[DOG_BUF_POS_Y], 0.0);
        let distance = magnitude(px - nx, py - ny);
        if distance < 60.0 {
            events |= DOG_EVENT_STRAY_TRIGGERED;
        }
        if distance < 20.0 {
            events |= DOG_EVENT_STRAY_RESOLVED;
        }
        if loyalty > 0.5 {
            events |= DOG_EVENT_HEARTS_SPAWNED;
        }
    }

    // Persist outputs -----------------------------------------------------
    buffer.slots[DOG_BUF_GAIT_MODE_ID] = gait_index(gait);
    buffer.slots[DOG_BUF_GAIT_PHASE] = next_phase;
    buffer.slots[DOG_BUF_WAG_SPEED] = tail_wag_speed;
    buffer.slots[DOG_BUF_TAIL_ANGLE] = tail_angle;
    buffer.slots[DOG_BUF_NOSE_TWITCH] = nose_twitch;
    buffer.slots[DOG_BUF_EVENT_BITMASK] = events as f32;

    events
}

// ---------------------------------------------------------------------------
// Top level step
// ---------------------------------------------------------------------------

pub fn step_utility_ai(
    buffer: &mut DogSimBuffer,
    obstacles: &[WorldObstacle],
    combo: DiscreteCombo,
    dt: f32,
) -> UtilityOutput {
    // A stack snapshot keeps the immutable input view separate from the mutable
    // buffer used by the micro-expression integrator.
    let snapshot = DogSimBuffer {
        slots: buffer.slots,
    };

    let traits = PersonalityTraits {
        curiosity: unit(snapshot.slots[DOG_BUF_TRAIT_CURIOSITY] as f32),
        energy: unit(snapshot.slots[DOG_BUF_TRAIT_ENERGY] as f32),
        stubbornness: unit(snapshot.slots[DOG_BUF_TRAIT_STUBBORNNESS] as f32),
        loyalty: unit(snapshot.slots[DOG_BUF_TRAIT_LOYALTY] as f32),
    };

    let input = UtilityInput {
        buffer: &snapshot,
        combo,
        traits,
        obstacles,
    };

    let (active_utility_id, active_utility_score) = select_best_utility(&input);
    let (steer_x, steer_y) = compute_steering(&input, active_utility_id);
    let roam_submode = select_roam_submode(&input, active_utility_id);
    let zoomie_path = select_zoomie_path(&input);

    buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = active_utility_id as f32;
    buffer.slots[DOG_BUF_ACTIVE_UTILITY_SCORE] = active_utility_score;
    buffer.slots[DOG_BUF_ROAM_SUBMODE_ID] = roam_index(roam_submode);
    buffer.slots[DOG_BUF_ZOOMIE_PATH_ID] = zoomie_index(zoomie_path);

    let events = integrate_micro_expressions(buffer, &input, dt);

    let desired_speed = speed_of(buffer);
    let desired_gait = gait_from_speed(desired_speed);

    let ear_target_raw = 0.15
        + 0.35 * unit(input.traits.curiosity as f32)
        + 0.20 * unit(input.traits.energy as f32)
        + 0.10 * unit(input.traits.loyalty as f32);
    let ear_target = if ear_target_raw.is_finite() {
        ear_target_raw.clamp(0.0, 0.5)
    } else {
        0.0
    };

    UtilityOutput {
        active_utility_id,
        active_utility_score,
        steer_x,
        steer_y,
        desired_speed,
        desired_gait,
        roam_submode,
        zoomie_path,
        ear_target_left: ear_target,
        ear_target_right: ear_target,
        tail_wag_speed: finite_or(buffer.slots[DOG_BUF_WAG_SPEED], 0.0),
        tail_angle: finite_or(buffer.slots[DOG_BUF_TAIL_ANGLE], 0.0),
        nose_twitch: finite_or(buffer.slots[DOG_BUF_NOSE_TWITCH], 0.0),
        events,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_buffer() -> DogSimBuffer {
        DogSimBuffer {
            slots: [0.0; DOG_SIM_BUFFER_LEN],
        }
    }

    fn snapshot(buffer: &DogSimBuffer) -> DogSimBuffer {
        DogSimBuffer {
            slots: buffer.slots,
        }
    }

    fn base_traits() -> PersonalityTraits {
        PersonalityTraits {
            curiosity: 0.5,
            energy: 0.5,
            stubbornness: 0.5,
            loyalty: 0.5,
        }
    }

    fn blank_combo() -> DiscreteCombo {
        DiscreteCombo {
            is_on_leash: false,
            is_pooping: false,
            has_need: false,
            has_ball: false,
        }
    }

    #[test]
    fn all_scores_are_unit_and_finite() {
        let buffer = blank_buffer();
        let obstacles: [WorldObstacle; 0] = [];
        let input = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits: base_traits(),
            obstacles: &obstacles,
        };

        let scores = [
            score_heel_follow(&input),
            score_fetch_ball(&input),
            score_recall(&input),
            score_roam_explore(&input),
            score_scout_ahead(&input),
            score_lag_and_sniff(&input),
            score_check_in(&input),
            score_social_greet(&input),
            score_pack_play(&input),
            score_zoomies(&input),
            score_ambient_rest(&input),
            score_bark_impulse(&input),
        ];

        for (index, score) in scores.iter().enumerate() {
            assert!(score.is_finite(), "score {} was not finite", index);
            assert!(
                *score >= 0.0 && *score <= 1.0,
                "score {} out of range: {}",
                index,
                score
            );
        }
    }

    #[test]
    fn fetch_requires_free_paws_and_live_ball() {
        let buffer = blank_buffer();
        let obstacles: [WorldObstacle; 0] = [];

        let mut combo = blank_combo();
        combo.has_ball = true;
        combo.is_on_leash = true;
        let input = UtilityInput {
            buffer: &buffer,
            combo,
            traits: base_traits(),
            obstacles: &obstacles,
        };
        assert_eq!(score_fetch_ball(&input), 0.0);

        let mut combo = blank_combo();
        combo.has_ball = true;
        let input = UtilityInput {
            buffer: &buffer,
            combo,
            traits: base_traits(),
            obstacles: &obstacles,
        };
        assert!(score_fetch_ball(&input) > 0.0);
    }

    #[test]
    fn recall_requires_whistle_and_favours_loyalty() {
        let mut buffer = blank_buffer();
        let obstacles: [WorldObstacle; 0] = [];

        {
            let input = UtilityInput {
                buffer: &buffer,
                combo: blank_combo(),
                traits: base_traits(),
                obstacles: &obstacles,
            };
            assert_eq!(score_recall(&input), 0.0);
        }

        buffer.slots[DOG_BUF_CMD_WHISTLE_RECALL] = 1.0;
        let input = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits: PersonalityTraits {
                loyalty: 1.0,
                stubbornness: 0.0,
                ..base_traits()
            },
            obstacles: &obstacles,
        };
        assert!(score_recall(&input) > 0.5);
    }

    #[test]
    fn leash_and_cooldown_block_free_roaming_utilities() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();

        {
            let mut combo = blank_combo();
            combo.is_on_leash = true;
            let input = UtilityInput {
                buffer: &buffer,
                combo,
                traits: base_traits(),
                obstacles: &obstacles,
            };
            assert_eq!(score_roam_explore(&input), 0.0);
            assert_eq!(score_zoomies(&input), 0.0);
        }

        buffer.slots[DOG_BUF_ZOOMIES_COOLDOWN] = 2.0;
        let input = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits: base_traits(),
            obstacles: &obstacles,
        };
        assert_eq!(score_zoomies(&input), 0.0);
    }

    #[test]
    fn hysteresis_keeps_current_on_marginal_win() {
        let mut scores = [0.0f32; UTIL_COUNT];
        scores[UTIL_HEEL_FOLLOW as usize] = 0.60;
        scores[UTIL_FETCH_BALL as usize] = 0.65;

        let (best, _) = pick_best(&scores, Some(UTIL_HEEL_FOLLOW));
        assert_eq!(best, UTIL_HEEL_FOLLOW);

        scores[UTIL_FETCH_BALL as usize] = 0.73;
        let (best, _) = pick_best(&scores, Some(UTIL_HEEL_FOLLOW));
        assert_eq!(best, UTIL_FETCH_BALL);
    }

    #[test]
    fn steering_is_bounded_with_dense_obstacles() {
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_POS_X] = 100.0;
        buffer.slots[DOG_BUF_POS_Y] = 100.0;
        buffer.slots[DOG_BUF_OWNER_X] = 100.0;
        buffer.slots[DOG_BUF_OWNER_Y] = 100.0;

        let obstacles = [
            WorldObstacle::Circle {
                x: 100.0,
                y: 100.0,
                r: 16.0,
            },
            WorldObstacle::Circle {
                x: 110.0,
                y: 100.0,
                r: 20.0,
            },
            WorldObstacle::Rect {
                x: 100.0,
                y: 115.0,
                hw: 12.0,
                hh: 8.0,
            },
            WorldObstacle::Circle {
                x: 90.0,
                y: 105.0,
                r: 30.0,
            },
        ];

        let input = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits: base_traits(),
            obstacles: &obstacles,
        };

        let (sx, sy) = compute_steering(&input, UTIL_HEEL_FOLLOW);
        assert!(sx.is_finite() && sy.is_finite());
        assert!(magnitude(sx, sy) <= 1.0 + 1e-5);
    }

    #[test]
    fn obstacle_force_points_away_and_decays_with_distance() {
        let buffer = blank_buffer();
        let obstacles_near = [WorldObstacle::Circle {
            x: 110.0,
            y: 100.0,
            r: 20.0,
        }];
        let obstacles_far = [WorldObstacle::Circle {
            x: 140.0,
            y: 100.0,
            r: 20.0,
        }];
        let obstacles_outside = [WorldObstacle::Circle {
            x: 200.0,
            y: 100.0,
            r: 20.0,
        }];

        let input_near = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits: base_traits(),
            obstacles: &obstacles_near,
        };
        let (nx, ny) = obstacle_skirt_force(&input_near, 100.0, 100.0);
        assert!(nx < 0.0);
        assert!(ny.abs() < 1e-4);

        let input_far = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits: base_traits(),
            obstacles: &obstacles_far,
        };
        let (fx, fy) = obstacle_skirt_force(&input_far, 100.0, 100.0);
        assert!(magnitude(fx, fy) < magnitude(nx, ny));

        let input_outside = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits: base_traits(),
            obstacles: &obstacles_outside,
        };
        let (ox, oy) = obstacle_skirt_force(&input_outside, 100.0, 100.0);
        assert!(magnitude(ox, oy) < 1e-6);
    }

    #[test]
    fn gallop_puff_is_emitted_on_phase_wrap() {
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_DOG_VX] = 50.0;
        buffer.slots[DOG_BUF_GAIT_PHASE] = 0.99;
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = UTIL_ZOOMIES as f32;

        let obstacles: [WorldObstacle; 0] = [];
        let snap = snapshot(&buffer);
        let input = UtilityInput {
            buffer: &snap,
            combo: blank_combo(),
            traits: PersonalityTraits {
                energy: 1.0,
                ..base_traits()
            },
            obstacles: &obstacles,
        };

        let events = integrate_micro_expressions(&mut buffer, &input, 0.1);
        assert_ne!(events & DOG_EVENT_GALLOP_PUFF, 0);
        assert_eq!(buffer.slots[DOG_BUF_EVENT_BITMASK] as u32, events);
        assert_eq!(buffer.slots[DOG_BUF_GAIT_MODE_ID], 3.0);
    }

    #[test]
    fn micro_expression_outputs_are_clamped() {
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_LEFT_EAR_ANGLE] = 9.0;
        buffer.slots[DOG_BUF_LEFT_EAR_VEL] = 3.0;
        buffer.slots[DOG_BUF_RIGHT_EAR_ANGLE] = -9.0;
        buffer.slots[DOG_BUF_RIGHT_EAR_VEL] = -3.0;
        buffer.slots[DOG_BUF_GAIT_PHASE] = 0.5;

        let obstacles: [WorldObstacle; 0] = [];
        let snap = snapshot(&buffer);
        let input = UtilityInput {
            buffer: &snap,
            combo: blank_combo(),
            traits: PersonalityTraits {
                curiosity: 1.0,
                energy: 1.0,
                stubbornness: 1.0,
                loyalty: 1.0,
            },
            obstacles: &obstacles,
        };

        integrate_micro_expressions(&mut buffer, &input, 0.1);

        let left = buffer.slots[DOG_BUF_LEFT_EAR_ANGLE];
        let right = buffer.slots[DOG_BUF_RIGHT_EAR_ANGLE];
        assert!(left >= -0.5 && left <= 0.5);
        assert!(right >= -0.5 && right <= 0.5);

        let wag = buffer.slots[DOG_BUF_WAG_SPEED];
        assert!(wag >= 0.0 && wag <= 12.0);

        let tail = buffer.slots[DOG_BUF_TAIL_ANGLE];
        assert!(tail >= -0.6 && tail <= 0.6);

        let nose = buffer.slots[DOG_BUF_NOSE_TWITCH];
        assert!(nose >= 0.0 && nose <= 1.0);
    }

    #[test]
    fn step_writes_contract_outputs() {
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_TRAIT_CURIOSITY] = 0.8;
        buffer.slots[DOG_BUF_TRAIT_ENERGY] = 0.9;
        buffer.slots[DOG_BUF_TRAIT_STUBBORNNESS] = 0.2;
        buffer.slots[DOG_BUF_TRAIT_LOYALTY] = 0.6;

        let obstacles: [WorldObstacle; 0] = [];
        let output = step_utility_ai(&mut buffer, &obstacles, blank_combo(), 0.016);

        assert_eq!(
            buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] as u32,
            output.active_utility_id
        );
        assert!(output.active_utility_score.is_finite());
        assert_eq!(output.events, buffer.slots[DOG_BUF_EVENT_BITMASK] as u32);
        assert!(output.steer_x.is_finite() && output.steer_y.is_finite());
        assert!(magnitude(output.steer_x, output.steer_y) <= 1.0 + 1e-5);
    }
}
