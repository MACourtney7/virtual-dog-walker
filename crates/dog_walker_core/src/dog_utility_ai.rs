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
    if speed < 5.0 {
        GaitModeId::Idle
    } else if speed < 90.0 {
        GaitModeId::Walk
    } else if speed < 170.0 {
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

/// Camera "openness" proxy derived from the visible camera rect.
fn camera_open_space(input: &UtilityInput<'_>) -> f32 {
    let b = &input.buffer.slots;
    if finite_or(b[DOG_BUF_CAM_ACTIVE], 0.0) <= 0.5 {
        return 0.5;
    }
    let left = finite_or(b[DOG_BUF_CAM_LEFT], 0.0);
    let top = finite_or(b[DOG_BUF_CAM_TOP], 0.0);
    let right = finite_or(b[DOG_BUF_CAM_RIGHT], 0.0);
    let bottom = finite_or(b[DOG_BUF_CAM_BOTTOM], 0.0);
    if !(right > left) || !(bottom > top) {
        return 0.0;
    }
    let area = (right - left) * (bottom - top);
    if !area.is_finite() || area <= 0.0 {
        return 0.0;
    }
    unit((area / (1920.0 * 1080.0)).sqrt())
}

fn ball_active(buffer: &DogSimBuffer) -> bool {
    finite_or(buffer.slots[DOG_BUF_BALL_ACTIVE], 0.0) > 0.5
}

fn peer_count(buffer: &DogSimBuffer) -> usize {
    let n = finite_or(buffer.slots[DOG_BUF_PEER_COUNT], 0.0);
    if n <= 0.0 {
        0
    } else {
        (n as usize).min(4)
    }
}

fn npc_count(buffer: &DogSimBuffer) -> usize {
    let n = finite_or(buffer.slots[DOG_BUF_NPC_COUNT], 0.0);
    if n <= 0.0 {
        0
    } else {
        (n as usize).min(4)
    }
}

fn scent_count(buffer: &DogSimBuffer) -> usize {
    let n = finite_or(buffer.slots[DOG_BUF_SCENT_COUNT], 0.0);
    if n <= 0.0 {
        0
    } else {
        (n as usize).min(4)
    }
}

fn slot_xy(buffer: &DogSimBuffer, base_x: usize, base_y: usize, i: usize) -> (f32, f32) {
    (
        finite_or(buffer.slots[base_x + 2 * i], 0.0),
        finite_or(buffer.slots[base_y + 2 * i], 0.0),
    )
}

fn nearest_peer_distance(buffer: &DogSimBuffer, px: f32, py: f32) -> Option<f32> {
    let mut best: Option<f32> = None;
    for i in 0..peer_count(buffer) {
        let (x, y) = slot_xy(buffer, DOG_BUF_PEER0_X, DOG_BUF_PEER0_Y, i);
        let d = magnitude(px - x, py - y);
        best = Some(best.map_or(d, |value| value.min(d)));
    }
    best
}

fn nearest_npc_distance(buffer: &DogSimBuffer, px: f32, py: f32) -> Option<f32> {
    let mut best: Option<f32> = None;
    for i in 0..npc_count(buffer) {
        let (x, y) = slot_xy(buffer, DOG_BUF_NPC0_X, DOG_BUF_NPC0_Y, i);
        let d = magnitude(px - x, py - y);
        best = Some(best.map_or(d, |value| value.min(d)));
    }
    best
}

fn nearest_scent_distance(buffer: &DogSimBuffer, px: f32, py: f32) -> Option<f32> {
    let mut best: Option<f32> = None;
    for i in 0..scent_count(buffer) {
        let (x, y) = slot_xy(buffer, DOG_BUF_SCENT0_X, DOG_BUF_SCENT0_Y, i);
        let d = magnitude(px - x, py - y);
        best = Some(best.map_or(d, |value| value.min(d)));
    }
    best
}

fn nearest_company_distance(buffer: &DogSimBuffer, px: f32, py: f32) -> Option<f32> {
    match (
        nearest_peer_distance(buffer, px, py),
        nearest_npc_distance(buffer, px, py),
    ) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

#[inline]
fn dog_position(buffer: &DogSimBuffer) -> (f32, f32) {
    (
        finite_or(buffer.slots[DOG_BUF_POS_X], 0.0),
        finite_or(buffer.slots[DOG_BUF_POS_Y], 0.0),
    )
}

// ---------------------------------------------------------------------------
// Utility scores (each clamped to [0.0, 1.0] and finite)
// ---------------------------------------------------------------------------

pub fn score_heel_follow(input: &UtilityInput<'_>) -> f32 {
    let loyalty = unit(input.traits.loyalty);
    let stubbornness = unit(input.traits.stubbornness);
    // On-leash heel-following must reliably outrank competing utilities
    // (social greet, ambient rest, lag-and-sniff, check-in, pack play) while
    // preserving monotonic ordering in `loyalty`.
    if input.combo.is_on_leash && !input.combo.is_pooping {
        return unit(0.82 + 0.15 * loyalty - 0.05 * stubbornness);
    }
    if input.combo.is_pooping {
        return 0.0;
    }
    // Off-leash heel-following must not outrank roaming/scouting/zoomies, so
    // it is scored low and ignores proximity entirely.
    unit(0.10 + 0.20 * loyalty - 0.10 * stubbornness)
}

pub fn score_fetch_ball(input: &UtilityInput<'_>) -> f32 {
    if !ball_active(input.buffer)
        || input.combo.is_on_leash
        || input.combo.is_pooping
        || input.combo.has_need
    {
        return 0.0;
    }
    let curiosity = unit(input.traits.curiosity);
    let energy = unit(input.traits.energy);
    unit(0.30 + 0.40 * energy + 0.30 * curiosity)
}

pub fn score_recall(input: &UtilityInput<'_>) -> f32 {
    if finite_or(input.buffer.slots[DOG_BUF_CMD_WHISTLE_RECALL], 0.0) <= 0.5 {
        return 0.0;
    }
    let loyalty = unit(input.traits.loyalty);
    let stubbornness = unit(input.traits.stubbornness);
    unit(0.35 + 0.50 * loyalty - 0.35 * stubbornness)
}

pub fn score_roam_explore(input: &UtilityInput<'_>) -> f32 {
    if input.combo.is_on_leash {
        return 0.0;
    }
    let curiosity = unit(input.traits.curiosity);
    unit(0.20 + 0.45 * curiosity + 0.35 * camera_open_space(input))
}

pub fn score_scout_ahead(input: &UtilityInput<'_>) -> f32 {
    if input.combo.is_on_leash {
        return 0.0;
    }
    let energy = unit(input.traits.energy);
    let (px, py) = dog_position(input.buffer);
    let ox = finite_or(input.buffer.slots[DOG_BUF_OWNER_X], px);
    let oy = finite_or(input.buffer.slots[DOG_BUF_OWNER_Y], py);
    let heading = finite_or(input.buffer.slots[DOG_BUF_OWNER_HEADING], 0.0);
    let forward = (px - ox) * heading.cos() + (py - oy) * heading.sin();
    let forward_norm = unit(forward / 160.0);
    unit(0.15 + 0.40 * energy + 0.35 * forward_norm)
}

pub fn score_lag_and_sniff(input: &UtilityInput<'_>) -> f32 {
    let curiosity = unit(input.traits.curiosity);
    let energy = unit(input.traits.energy);
    let (px, py) = dog_position(input.buffer);
    let proximity = nearest_scent_distance(input.buffer, px, py)
        .map(|d| unit(1.0 - d / 200.0))
        .unwrap_or(0.0);
    unit(0.10 + 0.45 * curiosity + 0.30 * proximity - 0.15 * energy)
}

pub fn score_check_in(input: &UtilityInput<'_>) -> f32 {
    let loyalty = unit(input.traits.loyalty);
    let stubbornness = unit(input.traits.stubbornness);
    let (px, py) = dog_position(input.buffer);
    let ox = finite_or(input.buffer.slots[DOG_BUF_OWNER_X], px);
    let oy = finite_or(input.buffer.slots[DOG_BUF_OWNER_Y], py);
    let distance_norm = unit(magnitude(px - ox, py - oy) / 240.0);
    unit(0.15 + 0.50 * loyalty + 0.25 * distance_norm - 0.25 * stubbornness)
}

pub fn score_social_greet(input: &UtilityInput<'_>) -> f32 {
    let loyalty = unit(input.traits.loyalty);
    let stubbornness = unit(input.traits.stubbornness);
    let (px, py) = dog_position(input.buffer);
    let proximity = nearest_company_distance(input.buffer, px, py)
        .map(|d| unit(1.0 - d / 160.0))
        .unwrap_or(0.0);
    unit(0.10 + 0.40 * loyalty + 0.40 * proximity - 0.20 * stubbornness)
}

pub fn score_pack_play(input: &UtilityInput<'_>) -> f32 {
    let energy = unit(input.traits.energy);
    let peer_ratio = peer_count(input.buffer) as f32 / 4.0;
    unit(0.10 + 0.45 * energy + 0.35 * peer_ratio)
}

pub fn score_zoomies(input: &UtilityInput<'_>) -> f32 {
    if input.combo.is_on_leash
        || finite_or(input.buffer.slots[DOG_BUF_ZOOMIES_COOLDOWN], 0.0) > 0.0
    {
        return 0.0;
    }
    let energy = unit(input.traits.energy);
    unit(0.15 + 0.65 * energy + 0.20 * camera_open_space(input))
}

pub fn score_ambient_rest(input: &UtilityInput<'_>) -> f32 {
    let energy = unit(input.traits.energy);
    let idle = unit(finite_or(input.buffer.slots[DOG_BUF_IDLE_REST_TIMER], 0.0) / 4.0);
    unit(0.25 + 0.45 * (1.0 - energy) + 0.30 * idle)
}

pub fn score_bark_impulse(input: &UtilityInput<'_>) -> f32 {
    // Cooldown is authoritative: a bark command cannot bypass it.
    let cooldown = finite_or(input.buffer.slots[DOG_BUF_SOCIAL_COOLDOWN], 0.0);
    if cooldown > 0.0 {
        return 0.0;
    }
    let stubbornness = unit(input.traits.stubbornness);
    let (px, py) = dog_position(input.buffer);
    let mut nearest = nearest_company_distance(input.buffer, px, py);
    if ball_active(input.buffer) {
        let bx = finite_or(input.buffer.slots[DOG_BUF_BALL_X], px);
        let by = finite_or(input.buffer.slots[DOG_BUF_BALL_Y], py);
        let ball_d = magnitude(px - bx, py - by);
        nearest = Some(nearest.map_or(ball_d, |value| value.min(ball_d)));
    }
    let proximity = nearest.map(|d| unit(1.0 - d / 160.0)).unwrap_or(0.0);
    unit(0.05 + 0.45 * stubbornness + 0.40 * proximity)
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
    let mut best_effective = f32::NEG_INFINITY;

    for index in 0..UTIL_COUNT {
        let base = unit(scores[index]);
        let effective = if current == Some(index as u32) {
            base + 0.12
        } else {
            base
        };
        // Strictly greater so ties break towards the lower utility id.
        if effective > best_effective {
            best_effective = effective;
            best_id = index as u32;
        }
    }

    (best_id, unit(scores[best_id as usize]))
}

fn active_utility_from_buffer(buffer: &DogSimBuffer) -> Option<u32> {
    let raw = finite_or(buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID], -1.0);
    if raw >= 0.0 && raw <= 11.0 && (raw - raw.round()).abs() < 1e-4 {
        Some(raw.round() as u32)
    } else {
        None
    }
}

pub fn select_best_utility(input: &UtilityInput<'_>) -> (u32, f32) {
    let scores = score_all(input);
    let current = active_utility_from_buffer(input.buffer);
    pick_best(&scores, current)
}

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

fn target_for(active: u32, input: &UtilityInput<'_>) -> (f32, f32) {
    let b = &input.buffer.slots;
    let px = finite_or(b[DOG_BUF_POS_X], 0.0);
    let py = finite_or(b[DOG_BUF_POS_Y], 0.0);
    let ox = finite_or(b[DOG_BUF_OWNER_X], px);
    let oy = finite_or(b[DOG_BUF_OWNER_Y], py);
    let now = finite_or(b[DOG_BUF_NOW_SEC], 0.0);

    match active {
        UTIL_HEEL_FOLLOW => {
            // Prefer the forward-flank heel slot when leashed so the dog walks
            // beside the owner instead of trailing behind the owner's center.
            if input.combo.is_on_leash {
                let slot_x = b[DOG_BUF_TARGET_SLOT_X];
                let slot_y = b[DOG_BUF_TARGET_SLOT_Y];
                if slot_x.is_finite() && slot_y.is_finite() && (slot_x != 0.0 || slot_y != 0.0) {
                    return (slot_x, slot_y);
                }
            }
            (ox, oy)
        }
        UTIL_RECALL | UTIL_CHECK_IN => (ox, oy),
        UTIL_FETCH_BALL => (
            finite_or(b[DOG_BUF_BALL_X], ox),
            finite_or(b[DOG_BUF_BALL_Y], oy),
        ),
        UTIL_ROAM_EXPLORE | UTIL_LAG_AND_SNIFF | UTIL_SCOUT_AHEAD => (
            ox + (now * 0.7).sin() * 120.0,
            oy + (now * 0.9).cos() * 120.0,
        ),
        UTIL_SOCIAL_GREET | UTIL_PACK_PLAY => {
            if nearest_peer_distance(input.buffer, px, py).is_some() {
                (
                    finite_or(b[DOG_BUF_PEER_X], ox),
                    finite_or(b[DOG_BUF_PEER_Y], oy),
                )
            } else {
                (
                    finite_or(b[DOG_BUF_NPC_X], ox),
                    finite_or(b[DOG_BUF_NPC_Y], oy),
                )
            }
        }
        UTIL_ZOOMIES => (
            ox + (now * 1.3).sin() * 80.0,
            oy + (now * 1.3).cos() * 80.0,
        ),
        UTIL_AMBIENT_REST | UTIL_BARK_IMPULSE => (px, py),
        _ => (ox, oy),
    }
}

fn seek_force(input: &UtilityInput<'_>, active: u32, px: f32, py: f32) -> (f32, f32) {
    let (tx, ty) = target_for(active, input);
    let dx = tx - px;
    let dy = ty - py;
    let distance = magnitude(dx, dy);
    if distance > 1e-4 {
        (dx / distance, dy / distance)
    } else {
        (0.0, 0.0)
    }
}

fn arrive_force(input: &UtilityInput<'_>, active: u32, px: f32, py: f32) -> (f32, f32) {
    let (tx, ty) = target_for(active, input);
    let dx = tx - px;
    let dy = ty - py;
    let distance = magnitude(dx, dy);
    if distance > 1e-4 {
        let scale = (distance / 24.0).clamp(0.0, 1.0);
        (dx / distance * scale, dy / distance * scale)
    } else {
        (0.0, 0.0)
    }
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
        let limit = radius + 32.0;
        let dx = px - ox;
        let dy = py - oy;
        let distance = magnitude(dx, dy);
        if limit > 0.0 && distance > 1e-4 && distance < limit {
            let strength = 1.0 - distance / limit;
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

    if distance > 39.0 && distance > 1e-4 {
        let strength = ((distance - 39.0) / (52.5 - 39.0)).clamp(0.0, 1.0);
        (dx / distance * strength, dy / distance * strength)
    } else {
        (0.0, 0.0)
    }
}

fn npc_berth_force(input: &UtilityInput<'_>, px: f32, py: f32) -> (f32, f32) {
    let mut fx = 0.0;
    let mut fy = 0.0;
    for i in 0..npc_count(input.buffer) {
        let (nx, ny) = slot_xy(input.buffer, DOG_BUF_NPC0_X, DOG_BUF_NPC0_Y, i);
        let dx = px - nx;
        let dy = py - ny;
        let distance = magnitude(dx, dy);
        if distance > 1e-4 && distance < 30.0 {
            let strength = (30.0 - distance) / 30.0 * 1.2;
            fx += dx / distance * strength;
            fy += dy / distance * strength;
        }
    }
    (fx, fy)
}

fn social_circle_force(
    input: &UtilityInput<'_>,
    active_utility_id: u32,
    px: f32,
    py: f32,
) -> (f32, f32) {
    if active_utility_id != UTIL_SOCIAL_GREET && active_utility_id != UTIL_PACK_PLAY {
        return (0.0, 0.0);
    }

    let mut nearest: Option<(f32, f32, f32)> = None;
    for i in 0..peer_count(input.buffer) {
        let (ox, oy) = slot_xy(input.buffer, DOG_BUF_PEER0_X, DOG_BUF_PEER0_Y, i);
        let dx = ox - px;
        let dy = oy - py;
        let distance = magnitude(dx, dy);
        if nearest.map_or(true, |(_, _, d)| distance < d) {
            nearest = Some((dx, dy, distance));
        }
    }

    if let Some((dx, dy, distance)) = nearest {
        if distance > 1e-4 {
            let ux = dx / distance;
            let uy = dy / distance;
            return (-uy, ux);
        }
    }

    (0.0, 0.0)
}

fn zoomies_parametric_step(input: &UtilityInput<'_>, active_utility_id: u32) -> (f32, f32) {
    if active_utility_id != UTIL_ZOOMIES {
        return (0.0, 0.0);
    }

    let b = &input.buffer.slots;
    let path = finite_or(b[DOG_BUF_ZOOMIE_PATH_ID], 0.0).round() as i32;
    let px = finite_or(b[DOG_BUF_POS_X], 0.0);
    let py = finite_or(b[DOG_BUF_POS_Y], 0.0);
    let phase = finite_or(b[DOG_BUF_ZOOMIES_PHASE], 0.0);

    let cx_default = finite_or(b[DOG_BUF_OWNER_X], px);
    let cy_default = finite_or(b[DOG_BUF_OWNER_Y], py);

    // A zeroed center slot means "unset": fall back to the owner position
    // rather than orbiting the world origin.
    let center_x = finite_or(b[DOG_BUF_ZOOMIES_CENTER_X], cx_default);
    let center_y = finite_or(b[DOG_BUF_ZOOMIES_CENTER_Y], cy_default);
    let (cx, cy) = if center_x == 0.0 && center_y == 0.0 {
        (cx_default, cy_default)
    } else {
        (center_x, center_y)
    };

    let (tx, ty) = match path {
        p if p == ZoomiePathId::FigureEight as u32 as i32 => {
            let a = (phase * core::f32::consts::TAU).sin() * 60.0;
            let c = (phase * core::f32::consts::TAU * 2.0).sin() * 30.0;
            (cx + a, cy + c)
        }
        p if p == ZoomiePathId::OrbitOwner as u32 as i32 => {
            let raw_radius = finite_or(b[DOG_BUF_ZOOMIES_ORBIT_RADIUS], 60.0);
            let radius = if raw_radius <= 1.0 { 60.0 } else { raw_radius };
            let angle = finite_or(b[DOG_BUF_ZOOMIES_ORBIT_ANGLE], 0.0);
            let dir = if finite_or(b[DOG_BUF_ZOOMIES_ORBIT_DIR], 1.0) >= 0.0 {
                1.0
            } else {
                -1.0
            };
            (
                cx + (angle * dir).cos() * radius,
                cy + (angle * dir).sin() * radius,
            )
        }
        p if p == ZoomiePathId::Shuttle as u32 as i32 => {
            let ax = finite_or(b[DOG_BUF_ZOOMIES_SHUTTLE_AX], cx_default);
            let ay = finite_or(b[DOG_BUF_ZOOMIES_SHUTTLE_AY], cy_default);
            let bx = finite_or(b[DOG_BUF_ZOOMIES_SHUTTLE_BX], cx_default);
            let by = finite_or(b[DOG_BUF_ZOOMIES_SHUTTLE_BY], cy_default);
            let t = 0.5 + 0.5 * (phase * core::f32::consts::TAU).sin();
            (ax + (bx - ax) * t, ay + (by - ay) * t)
        }
        _ => return (0.0, 0.0),
    };

    let dx = tx - px;
    let dy = ty - py;
    let distance = magnitude(dx, dy);
    if distance > 1e-4 {
        (dx / distance, dy / distance)
    } else {
        (0.0, 0.0)
    }
}

pub fn compute_steering(input: &UtilityInput<'_>, active_utility_id: u32) -> (f32, f32) {
    let b = &input.buffer.slots;
    let px = finite_or(b[DOG_BUF_POS_X], 0.0);
    let py = finite_or(b[DOG_BUF_POS_Y], 0.0);

    // Every steering utility relies on `arrive_force` alone so velocity tapers
    // smoothly to zero at the target. Adding a unit-magnitude `seek_force` on
    // top prevented deceleration and caused 180-degree overshoot jitter.
    // Zoomies are driven purely by the parametric path below.
    let (ax, ay) = if active_utility_id == UTIL_ZOOMIES {
        (0.0, 0.0)
    } else {
        arrive_force(input, active_utility_id, px, py)
    };
    let (ox, oy) = obstacle_skirt_force(input, px, py);
    let (mx, my) = screen_perimeter_force(input, px, py);
    let (tx, ty) = soft_tether_force(input, px, py);
    let (nx, ny) = npc_berth_force(input, px, py);
    let (cx, cy) = social_circle_force(input, active_utility_id, px, py);
    let (zx, zy) = zoomies_parametric_step(input, active_utility_id);

    let fx = ax + ox + mx + tx + nx + cx + zx;
    let fy = ay + oy + my + ty + ny + cy + zy;
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
    select_roam_submode_internal(input, active_utility_id).0
}

fn select_roam_submode_internal(
    input: &UtilityInput<'_>,
    active_utility_id: u32,
) -> (RoamSubModeId, bool) {
    match active_utility_id {
        UTIL_SCOUT_AHEAD => return (RoamSubModeId::ScoutAhead, false),
        UTIL_LAG_AND_SNIFF => return (RoamSubModeId::LagAndSniff, false),
        UTIL_CHECK_IN => return (RoamSubModeId::CheckIn, false),
        UTIL_ROAM_EXPLORE => {}
        _ => return (RoamSubModeId::Baseline, false),
    }

    let b = &input.buffer.slots;

    if finite_or(b[DOG_BUF_ROAM_LOOKBACK_TIMER], 0.0) > 0.0 {
        return (RoamSubModeId::LookBack, false);
    }
    if finite_or(b[DOG_BUF_ROAM_MICROPAUSE_TIMER], 0.0) > 0.0 {
        return (RoamSubModeId::MicroPause, false);
    }
    if finite_or(b[DOG_BUF_CATCH_UP_TIMER], 0.0) > 0.0 {
        return (RoamSubModeId::CatchUp, false);
    }

    let curiosity = unit(input.traits.curiosity);
    let energy = unit(input.traits.energy);

    if curiosity >= 0.66 {
        return (RoamSubModeId::Explore, false);
    }
    if energy >= 0.66 {
        return (RoamSubModeId::CatchUp, false);
    }

    // Micro-pause jitter uses the shared RNG seed. Signal the caller so the
    // advanced seed can be written back into the buffer.
    let seed = finite_or(b[DOG_BUF_RNG_SEED], 0.0) as u32;
    let mut rng = Mulberry32::new(seed);
    let roll = rng.next_f64();
    if roll < 0.25 {
        return (RoamSubModeId::MicroPause, true);
    }

    let baseline = finite_or(b[DOG_BUF_ROAM_BASELINE_TIMER], 0.0);
    let submode_timer = finite_or(b[DOG_BUF_ROAM_SUBMODE_TIMER], 0.0);
    if baseline > 0.0 || submode_timer > 0.0 {
        return (RoamSubModeId::Baseline, true);
    }

    if curiosity >= 0.33 {
        return (RoamSubModeId::LookBack, true);
    }

    (RoamSubModeId::Baseline, true)
}

fn zoomie_path_for(active_utility_id: u32, input: &UtilityInput<'_>) -> ZoomiePathId {
    if active_utility_id != UTIL_ZOOMIES {
        return ZoomiePathId::None;
    }
    let energy = unit(input.traits.energy);
    let space = camera_open_space(input);
    if energy >= 0.7 && space >= 0.5 {
        ZoomiePathId::FigureEight
    } else if space >= 0.5 {
        ZoomiePathId::OrbitOwner
    } else {
        ZoomiePathId::Shuttle
    }
}

pub fn select_zoomie_path(input: &UtilityInput<'_>) -> ZoomiePathId {
    // Contract: only the stored active utility id is authoritative here. We do
    // not fall back to `select_best_utility`, so a non-zoomie (or invalid)
    // stored id always yields `ZoomiePathId::None`.
    let active = match active_utility_from_buffer(input.buffer) {
        Some(id) if id == UTIL_ZOOMIES => UTIL_ZOOMIES,
        _ => u32::MAX,
    };
    zoomie_path_for(active, input)
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
    let mut next_phase = previous_phase + speed / 95.0 * dt;
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
    let active = active_utility_from_buffer(buffer).unwrap_or(u32::MAX);

    let (px, py) = dog_position(buffer);
    let (ox, oy) = (
        finite_or(buffer.slots[DOG_BUF_OWNER_X], px),
        finite_or(buffer.slots[DOG_BUF_OWNER_Y], py),
    );
    let owner_distance = magnitude(px - ox, py - oy);

    let nearest_scent_dist = nearest_scent_distance(buffer, px, py).unwrap_or(f32::INFINITY);

    // Cooldown is authoritative: a bark command cannot bypass it.
    let bark_ready = finite_or(buffer.slots[DOG_BUF_SOCIAL_COOLDOWN], 0.0) <= 0.0;

    let mut events = 0u32;

    if score_bark_impulse(input) > 0.85 && bark_ready {
        events |= DOG_EVENT_BARK_TRIGGERED;
    }
    if wrapped && matches!(gait, GaitModeId::Gallop) {
        events |= DOG_EVENT_GALLOP_PUFF;
    }
    // `DOG_BUF_SCENT0..3` slots represent both scents and sticks. The nose
    // twitch max is exactly 0.8 (0.1 + 0.5*1.0 + 0.2*1.0), so use `>=` to keep
    // this event reachable at full curiosity/energy.
    if nose_twitch >= 0.8 && nearest_scent_dist <= 16.0 {
        events |= DOG_EVENT_SCENT_DEPOSITED;
    }
    if score_recall(input) > 0.7 && score_ambient_rest(input) > 0.5 {
        events |= DOG_EVENT_WHINE_AUDIO;
    }
    if energy < 0.25 && matches!(gait, GaitModeId::Trot | GaitModeId::Gallop) {
        events |= DOG_EVENT_PANT_AUDIO;
    }
    if nose_twitch > 0.6 && nearest_scent_dist <= 24.0 {
        events |= DOG_EVENT_SNIFF_AUDIO;
    }

    if ball_active(buffer) {
        let bx = finite_or(buffer.slots[DOG_BUF_BALL_X], px);
        let by = finite_or(buffer.slots[DOG_BUF_BALL_Y], py);
        if magnitude(px - bx, py - by) <= 8.0 {
            events |= DOG_EVENT_BALL_GRABBED;
        }
        if active == UTIL_FETCH_BALL && owner_distance <= 16.0 {
            events |= DOG_EVENT_BALL_HANDOFF;
        }
    }

    if nearest_scent_dist <= 8.0 && curiosity > 0.4 {
        events |= DOG_EVENT_STICK_PICKED_UP;
    }

    if !input.combo.is_on_leash && owner_distance > 120.0 && curiosity > 0.6 {
        events |= DOG_EVENT_STRAY_TRIGGERED;
    }

    let state_id = finite_or(buffer.slots[DOG_BUF_DOG_STATE_ID], -1.0);
    if (state_id - DogStateId::Stray as u32 as f32).abs() < 1e-4 && owner_distance < 80.0 {
        events |= DOG_EVENT_STRAY_RESOLVED;
    }

    if score_social_greet(input) > 0.8 {
        events |= DOG_EVENT_HEARTS_SPAWNED;
    }

    // Persist outputs -----------------------------------------------------
    buffer.slots[DOG_BUF_GAIT_MODE_ID] = gait_index(gait);
    buffer.slots[DOG_BUF_GAIT_PHASE] = next_phase;
    buffer.slots[DOG_BUF_WAG_SPEED] = tail_wag_speed;
    buffer.slots[DOG_BUF_TAIL_ANGLE] = tail_angle;
    buffer.slots[DOG_BUF_NOSE_TWITCH] = nose_twitch;
    write_event_bitmask(buffer, events);

    events
}

// ---------------------------------------------------------------------------
// Top level step
// ---------------------------------------------------------------------------

/// Base target speed for an active utility prior to score/trait scaling.
pub(crate) fn base_desired_speed(active_utility_id: u32) -> f32 {
    match active_utility_id {
        UTIL_ZOOMIES | UTIL_FETCH_BALL => 290.0,
        UTIL_HEEL_FOLLOW | UTIL_RECALL => 220.0,
        UTIL_ROAM_EXPLORE | UTIL_SCOUT_AHEAD | UTIL_PACK_PLAY | UTIL_SOCIAL_GREET => 155.0,
        UTIL_CHECK_IN | UTIL_LAG_AND_SNIFF => 120.0,
        UTIL_AMBIENT_REST | UTIL_BARK_IMPULSE => 0.0,
        _ => 0.0,
    }
}

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
    let (roam_submode, rng_used) = select_roam_submode_internal(&input, active_utility_id);
    let zoomie_path = zoomie_path_for(active_utility_id, &input);

    // Advance the zoomies parametric path so the dog actually moves along the
    // figure-8 / orbit / shuttle trajectory instead of stalling at a fixed
    // phase.
    if active_utility_id == UTIL_ZOOMIES {
        let dt = if dt.is_finite() {
            dt.clamp(0.0, 0.1)
        } else {
            0.0
        };
        buffer.slots[DOG_BUF_ZOOMIES_PHASE] =
            (finite_or(buffer.slots[DOG_BUF_ZOOMIES_PHASE], 0.0) + dt * 0.45).rem_euclid(1.0);
        buffer.slots[DOG_BUF_ZOOMIES_ORBIT_ANGLE] =
            (finite_or(buffer.slots[DOG_BUF_ZOOMIES_ORBIT_ANGLE], 0.0) + dt * 3.2)
                .rem_euclid(core::f32::consts::TAU);
    }

    buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = active_utility_id as f32;
    buffer.slots[DOG_BUF_ACTIVE_UTILITY_SCORE] = active_utility_score;
    buffer.slots[DOG_BUF_ROAM_SUBMODE_ID] = roam_index(roam_submode);
    buffer.slots[DOG_BUF_ZOOMIE_PATH_ID] = zoomie_index(zoomie_path);

    if rng_used {
        let old_seed = finite_or(buffer.slots[DOG_BUF_RNG_SEED], 0.0) as u32;
        let mut rng = Mulberry32::new(old_seed);
        let advanced = (rng.next_f64() * (u32::MAX as f64)) as u32;
        buffer.slots[DOG_BUF_RNG_SEED] = advanced as f32;
    }

    let events = integrate_micro_expressions(buffer, &input, dt);

    let energy = unit(input.traits.energy);
    let stubbornness = unit(input.traits.stubbornness);
    let trait_scale = (0.85 + 0.25 * energy) * (1.0 - 0.10 * stubbornness);
    let score_scale = 0.75 + 0.25 * unit(active_utility_score);
    let base_speed = base_desired_speed(active_utility_id);
    let desired_speed = (base_speed * score_scale * trait_scale).clamp(0.0, 340.0);
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
// Command authority / state machine (unification-049)
// ---------------------------------------------------------------------------

pub const WHISTLE_COOLDOWN_S: f32 = 8.0;
pub const SOCIAL_COOLDOWN_S: f32 = 3.0;
pub const PRAISE_COOLDOWN_S: f32 = 2.0;
pub const PET_TIMER_S: f32 = 1.0;
pub const PRAISE_TIMER_S: f32 = 1.0;
pub const BARK_TIMER_S: f32 = 0.6;
pub const ZOOMIES_TIMER_S: f32 = 3.0;
pub const SUNNY_ROLL_DURATION_S: f32 = 2.0;
pub const SUNNY_ROLL_COOLDOWN_S: f32 = 5.0;
pub const PACK_PLAY_START_DISTANCE_PX: f32 = 40.0;
pub const PACK_PLAY_BREAK_DISTANCE_PX: f32 = 48.0;
pub const PACK_PLAY_DURATION_S: f32 = 8.0;
pub const PACK_PLAY_BREAK_TIME_S: f32 = 0.5;
pub const RECALL_ARRIVE_DISTANCE_PX: f32 = 24.0;

/// Fetch timeout (seconds) before the fetch transition is abandoned.
pub const FETCH_TIMER_S: f32 = 10.0;

// Command bits ordered from highest to lowest priority.
pub const DOG_CMD_CLEAR_PENDING: u32 = 1 << 0;
pub const DOG_CMD_WHISTLE_RECALL: u32 = 1 << 1;
pub const DOG_CMD_PET: u32 = 1 << 2;
pub const DOG_CMD_PRAISE: u32 = 1 << 3;
pub const DOG_CMD_BARK: u32 = 1 << 4;
pub const DOG_CMD_ZOOMIES: u32 = 1 << 5;
pub const DOG_CMD_FETCH_BALL: u32 = 1 << 6;
pub const DOG_CMD_PACK_PLAY_START: u32 = 1 << 7;
pub const DOG_CMD_PACK_PLAY_BREAK: u32 = 1 << 8;

// Command input slots (stable contract inputs). Pack-play start/break bits are
// carried in the packed `DOG_BUF_COMMAND_FLAGS` slot (62), not aliased to 63.
pub const DOG_BUF_CMD_CLEAR_PENDING: usize = DOG_BUF_RESERVED_INPUT_0;

// Transition-state model (unification-049). Recall and fetch cannot coexist.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransitionStateId {
    Idle = 0,
    ToOwner = 1,
    ToBall = 2,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SunnyRollStateId {
    None = 0,
    Rolling = 1,
    Finished = 2,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PackPlayStateId {
    None = 0,
    Active = 1,
    Breaking = 2,
    Broken = 3,
}

#[derive(Clone, Copy, Debug)]
pub struct DogAiContext<'a> {
    pub owner_x: f32,
    pub owner_y: f32,
    pub ball_available: bool,
    pub ball_held_by_dog: bool,
    pub sunny_zone_contains_dog: bool,
    pub pack_partner_available: bool,
    pub pack_partner_id: f32,
    pub pack_partner_x: f32,
    pub pack_partner_y: f32,
    pub care_is_hungry: bool,
    pub care_needs_grooming: bool,
    pub care_is_tired: bool,
    pub obstacles: &'a [WorldObstacle],
}

fn slot_value(buf: &DogSimBuffer, index: usize) -> f32 {
    finite_or(buf.slots[index], 0.0)
}

fn slot_flag(buf: &DogSimBuffer, index: usize) -> bool {
    buf.slots[index].is_finite() && buf.slots[index] > 0.5
}

fn slot_state(buf: &DogSimBuffer, index: usize) -> u32 {
    let raw = slot_value(buf, index);
    if raw <= 0.0 {
        0
    } else {
        raw.round() as u32
    }
}

fn decrement_slot(buf: &mut DogSimBuffer, index: usize, dt: f32) {
    let current = finite_or(buf.slots[index], 0.0);
    buf.slots[index] = (current - dt).max(0.0);
}

fn increment_accept_count(buf: &mut DogSimBuffer) {
    let current = finite_or(buf.slots[DOG_BUF_COMMAND_ACCEPT_COUNT], 0.0);
    buf.slots[DOG_BUF_COMMAND_ACCEPT_COUNT] = current + 1.0;
}

fn increment_reject_count(buf: &mut DogSimBuffer) {
    let current = finite_or(buf.slots[DOG_BUF_COMMAND_REJECT_COUNT], 0.0);
    buf.slots[DOG_BUF_COMMAND_REJECT_COUNT] = current + 1.0;
}

fn distance_between(ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let dx = finite_or(ax, 0.0) - finite_or(bx, 0.0);
    let dy = finite_or(ay, 0.0) - finite_or(by, 0.0);
    let d = (dx * dx + dy * dy).sqrt();
    if d.is_finite() {
        d
    } else {
        0.0
    }
}

fn collect_command_flags(buf: &DogSimBuffer) -> u32 {
    let mut flags = 0;
    if slot_flag(buf, DOG_BUF_CMD_WHISTLE_RECALL) {
        flags |= DOG_CMD_WHISTLE_RECALL;
    }
    if slot_flag(buf, DOG_BUF_CMD_PET) {
        flags |= DOG_CMD_PET;
    }
    if slot_flag(buf, DOG_BUF_CMD_PRAISE) {
        flags |= DOG_CMD_PRAISE;
    }
    if slot_flag(buf, DOG_BUF_CMD_BARK) {
        flags |= DOG_CMD_BARK;
    }
    if slot_flag(buf, DOG_BUF_CMD_TRIGGER_ZOOMIES) {
        flags |= DOG_CMD_ZOOMIES;
    }
    if slot_flag(buf, DOG_BUF_CMD_FETCH_BALL) {
        flags |= DOG_CMD_FETCH_BALL;
    }
    let packed = slot_value(buf, DOG_BUF_COMMAND_FLAGS);
    if packed > 0.0 {
        flags |= (packed.round() as u32) & 0x1FF;
    }
    flags
}

fn clear_command_flags(buf: &mut DogSimBuffer) {
    for index in [
        DOG_BUF_CMD_WHISTLE_RECALL,
        DOG_BUF_CMD_PET,
        DOG_BUF_CMD_PRAISE,
        DOG_BUF_CMD_BARK,
        DOG_BUF_CMD_TRIGGER_ZOOMIES,
        DOG_BUF_CMD_FETCH_BALL,
        DOG_BUF_COMMAND_FLAGS,
    ] {
        buf.slots[index] = 0.0;
    }
}

fn select_command(flags: u32) -> u32 {
    for bit in [
        DOG_CMD_CLEAR_PENDING,
        DOG_CMD_WHISTLE_RECALL,
        DOG_CMD_PET,
        DOG_CMD_PRAISE,
        DOG_CMD_BARK,
        DOG_CMD_ZOOMIES,
        DOG_CMD_FETCH_BALL,
        DOG_CMD_PACK_PLAY_START,
        DOG_CMD_PACK_PLAY_BREAK,
    ] {
        if flags & bit != 0 {
            return bit;
        }
    }
    0
}

fn finish_recall(buf: &mut DogSimBuffer, events: &mut u32) {
    buf.slots[DOG_BUF_TRANSITION_STATE] = TransitionStateId::Idle as u32 as f32;
    buf.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Idle as u32 as f32;
    buf.slots[DOG_BUF_DOG_VX] = 0.0;
    buf.slots[DOG_BUF_DOG_VY] = 0.0;
    *events |= DOG_EVENT_RECALL_ARRIVED;
}

fn advance_recall(buf: &mut DogSimBuffer, ctx: &DogAiContext<'_>, dt: f32, events: &mut u32) {
    if slot_state(buf, DOG_BUF_TRANSITION_STATE) != TransitionStateId::ToOwner as u32 {
        return;
    }
    let dog_x = slot_value(buf, DOG_BUF_DOG_X);
    let dog_y = slot_value(buf, DOG_BUF_DOG_Y);
    let dx = ctx.owner_x - dog_x;
    let dy = ctx.owner_y - dog_y;
    let dist = (dx * dx + dy * dy).sqrt();
    if !dist.is_finite() {
        return;
    }
    // Arrival is checked even while rolling so the recall can complete.
    if dist <= RECALL_ARRIVE_DISTANCE_PX {
        finish_recall(buf, events);
        return;
    }
    // Suppress movement while the dog is rolling in a sunny zone.
    if slot_state(buf, DOG_BUF_SUNNY_ROLL_STATE) == SunnyRollStateId::Rolling as u32 {
        return;
    }
    let speed = base_desired_speed(UTIL_RECALL);
    let step = (speed * dt).min(dist);
    let nx = dog_x + dx / dist * step;
    let ny = dog_y + dy / dist * step;
    buf.slots[DOG_BUF_DOG_X] = nx;
    buf.slots[DOG_BUF_DOG_Y] = ny;
    buf.slots[DOG_BUF_DOG_VX] = dx / dist * speed;
    buf.slots[DOG_BUF_DOG_VY] = dy / dist * speed;
    if distance_between(nx, ny, ctx.owner_x, ctx.owner_y) <= RECALL_ARRIVE_DISTANCE_PX {
        finish_recall(buf, events);
    }
}

fn advance_fetch(buf: &mut DogSimBuffer, ctx: &DogAiContext<'_>, events: &mut u32) {
    if slot_state(buf, DOG_BUF_TRANSITION_STATE) != TransitionStateId::ToBall as u32 {
        return;
    }
    if ctx.ball_held_by_dog {
        buf.slots[DOG_BUF_IS_BALL_HELD] = 1.0;
        buf.slots[DOG_BUF_TRANSITION_STATE] = TransitionStateId::Idle as u32 as f32;
        buf.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Idle as u32 as f32;
        *events |= DOG_EVENT_FETCH_COMPLETED;
    }
}

fn advance_sunny_roll(
    buf: &mut DogSimBuffer,
    ctx: &DogAiContext<'_>,
    events: &mut u32,
    events_hi: &mut u64,
) {
    let sunny = ctx.sunny_zone_contains_dog;
    let mut state = slot_state(buf, DOG_BUF_SUNNY_ROLL_STATE);
    let timer = slot_value(buf, DOG_BUF_SUNNY_ROLL_TIMER);

    if state == SunnyRollStateId::Rolling as u32 {
        if timer <= 0.0 {
            state = SunnyRollStateId::Finished as u32;
            buf.slots[DOG_BUF_SUNNY_ROLL_TIMER] = SUNNY_ROLL_COOLDOWN_S;
            *events |= DOG_EVENT_SUNNY_ROLL_FINISHED;
        }
    } else if state == SunnyRollStateId::Finished as u32 && timer <= 0.0 {
        state = SunnyRollStateId::None as u32;
    }

    // Entry detection also runs in the same step as cooldown expiry.
    if state == SunnyRollStateId::None as u32 {
        let was_sunny = (slot_value(buf, DOG_BUF_STATE_FLAGS) as u32) & 1 != 0;
        let pack_active =
            slot_state(buf, DOG_BUF_PACK_PLAY_STATE) == PackPlayStateId::Active as u32;
        let cooldown_ready = slot_value(buf, DOG_BUF_SUNNY_ROLL_TIMER) <= 0.0;
        if !was_sunny && sunny && !pack_active && cooldown_ready {
            state = SunnyRollStateId::Rolling as u32;
            buf.slots[DOG_BUF_SUNNY_ROLL_TIMER] = SUNNY_ROLL_DURATION_S;
            *events |= DOG_EVENT_SUNNY_ROLL_STARTED;
            *events_hi |= DOG_EVENT_SUNNY_ZONE_ENTERED;
        }
    }

    buf.slots[DOG_BUF_SUNNY_ROLL_STATE] = state as f32;
    let mut flags = slot_value(buf, DOG_BUF_STATE_FLAGS) as u32;
    if sunny {
        flags |= 1;
    } else {
        flags &= !1;
    }
    buf.slots[DOG_BUF_STATE_FLAGS] = flags as f32;
}

fn advance_pack_play(buf: &mut DogSimBuffer, ctx: &DogAiContext<'_>, events: &mut u32) {
    let state = slot_state(buf, DOG_BUF_PACK_PLAY_STATE);
    let timer = slot_value(buf, DOG_BUF_PACK_PLAY_TIMER);
    let mut next = state;

    if state == PackPlayStateId::Active as u32 {
        let distance = distance_between(
            slot_value(buf, DOG_BUF_DOG_X),
            slot_value(buf, DOG_BUF_DOG_Y),
            ctx.pack_partner_x,
            ctx.pack_partner_y,
        );
        if distance > PACK_PLAY_BREAK_DISTANCE_PX || timer <= 0.0 {
            next = PackPlayStateId::Breaking as u32;
            buf.slots[DOG_BUF_PACK_PLAY_TIMER] = PACK_PLAY_BREAK_TIME_S;
        }
    } else if state == PackPlayStateId::Breaking as u32 && timer <= 0.0 {
        next = PackPlayStateId::Broken as u32;
        *events |= DOG_EVENT_PACK_PLAY_BROKEN;
    }

    buf.slots[DOG_BUF_PACK_PLAY_STATE] = next as f32;
}

fn advance_needs(buf: &mut DogSimBuffer, ctx: &DogAiContext<'_>, events: &mut u32) {
    // Compare against the buffer's own need flags directly (no shadow bits in
    // `DOG_BUF_STATE_FLAGS`, which is reserved for the sunny-zone flag).
    let was_hungry = slot_flag(buf, DOG_BUF_IS_HUNGRY);
    let was_grooming = slot_flag(buf, DOG_BUF_NEEDS_GROOMING);
    let was_tired = slot_flag(buf, DOG_BUF_IS_TIRED);

    if ctx.care_is_hungry && !was_hungry {
        *events |= DOG_EVENT_NEED_HUNGRY;
    }
    if ctx.care_needs_grooming && !was_grooming {
        *events |= DOG_EVENT_NEED_GROOMING;
    }
    if ctx.care_is_tired && !was_tired {
        *events |= DOG_EVENT_NEED_TIRED;
    }

    // Hydrate the buffer's need flags from the context.
    buf.slots[DOG_BUF_IS_HUNGRY] = if ctx.care_is_hungry { 1.0 } else { 0.0 };
    buf.slots[DOG_BUF_NEEDS_GROOMING] = if ctx.care_needs_grooming { 1.0 } else { 0.0 };
    buf.slots[DOG_BUF_IS_TIRED] = if ctx.care_is_tired { 1.0 } else { 0.0 };
}

/// Advance the command-authority state machine by one tick.
///
/// Commands are processed exactly once in the locked priority order. Invalid
/// `dt_s` values are rejected before any timer is advanced. All state is stored
/// in the fixed-size shared buffer; this path is allocation free.
pub fn step_dog_utility_ai(buf: &mut DogSimBuffer, ctx: &DogAiContext<'_>, dt_s: f32) -> u32 {
    if !dt_s.is_finite() || dt_s <= 0.0 {
        write_event_mask64(buf, DOG_EVENT_COMMAND_REJECTED as u64);
        return DOG_EVENT_COMMAND_REJECTED;
    }

    for index in [
        DOG_BUF_SOCIAL_COOLDOWN,
        DOG_BUF_WHISTLE_COOLDOWN,
        DOG_BUF_PET_TIMER,
        DOG_BUF_PRAISE_TIMER,
        DOG_BUF_BARK_TIMER,
        DOG_BUF_ZOOMIES_TIMER,
        DOG_BUF_SUNNY_ROLL_TIMER,
        DOG_BUF_PACK_PLAY_TIMER,
        DOG_BUF_FETCH_TIMER,
    ] {
        decrement_slot(buf, index, dt_s);
    }

    let mut events = 0u32;
    let mut events_hi = 0u64;
    let flags = collect_command_flags(buf);
    if flags != 0 {
        let selected = select_command(flags);
        clear_command_flags(buf);

        // Any additional lower-priority command bits in the same step are
        // rejected: only the highest-priority command is processed.
        let extra = flags & !selected;
        if extra != 0 {
            increment_reject_count(buf);
            events |= DOG_EVENT_COMMAND_REJECTED;
        }

        match selected {
            DOG_CMD_CLEAR_PENDING => {
                // Only clears pending command flags; no state mutation.
            }
            DOG_CMD_WHISTLE_RECALL => {
                if slot_value(buf, DOG_BUF_SOCIAL_COOLDOWN) > 0.0 {
                    increment_reject_count(buf);
                    events |= DOG_EVENT_COMMAND_REJECTED;
                    events_hi |= DOG_EVENT_SOCIAL_COOLDOWN_REJECT;
                } else {
                    increment_accept_count(buf);
                    buf.slots[DOG_BUF_TRANSITION_STATE] =
                        TransitionStateId::ToOwner as u32 as f32;
                    buf.slots[DOG_BUF_SOCIAL_COOLDOWN] = SOCIAL_COOLDOWN_S;
                    buf.slots[DOG_BUF_WHISTLE_COOLDOWN] = WHISTLE_COOLDOWN_S;
                    buf.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Recall as u32 as f32;
                    events |= DOG_EVENT_WHISTLE_RECALL_STARTED;
                    // Emitted on every accepted whistle.
                    events |= DOG_EVENT_TRANSITION_STATE_CHANGED;
                }
            }
            DOG_CMD_PET => {
                if slot_value(buf, DOG_BUF_SOCIAL_COOLDOWN) > 0.0 {
                    increment_reject_count(buf);
                    events |= DOG_EVENT_COMMAND_REJECTED;
                    events_hi |= DOG_EVENT_SOCIAL_COOLDOWN_REJECT;
                } else {
                    increment_accept_count(buf);
                    buf.slots[DOG_BUF_PET_TIMER] = PET_TIMER_S;
                    buf.slots[DOG_BUF_SOCIAL_COOLDOWN] = SOCIAL_COOLDOWN_S;
                    events |= DOG_EVENT_PET_ACCEPTED;
                }
            }
            DOG_CMD_PRAISE => {
                if slot_value(buf, DOG_BUF_SOCIAL_COOLDOWN) > 0.0 {
                    increment_reject_count(buf);
                    events |= DOG_EVENT_COMMAND_REJECTED;
                    events_hi |= DOG_EVENT_SOCIAL_COOLDOWN_REJECT;
                } else {
                    increment_accept_count(buf);
                    buf.slots[DOG_BUF_PRAISE_TIMER] = PRAISE_TIMER_S;
                    buf.slots[DOG_BUF_SOCIAL_COOLDOWN] = PRAISE_COOLDOWN_S;
                    events |= DOG_EVENT_PRAISE_ACCEPTED;
                }
            }
            DOG_CMD_BARK => {
                increment_accept_count(buf);
                buf.slots[DOG_BUF_BARK_TIMER] = BARK_TIMER_S;
                buf.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Bark as u32 as f32;
                events |= DOG_EVENT_BARK;
            }
            DOG_CMD_ZOOMIES => {
                increment_accept_count(buf);
                buf.slots[DOG_BUF_ZOOMIES_TIMER] = ZOOMIES_TIMER_S;
                buf.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Zoomies as u32 as f32;
                events |= DOG_EVENT_ZOOMIES_STARTED;
            }
            DOG_CMD_FETCH_BALL => {
                let already_held = ctx.ball_held_by_dog || slot_flag(buf, DOG_BUF_IS_BALL_HELD);
                if !ctx.ball_available || already_held {
                    increment_reject_count(buf);
                    events |= DOG_EVENT_COMMAND_REJECTED;
                } else {
                    increment_accept_count(buf);
                    buf.slots[DOG_BUF_TRANSITION_STATE] =
                        TransitionStateId::ToBall as u32 as f32;
                    buf.slots[DOG_BUF_FETCH_TIMER] = FETCH_TIMER_S;
                    buf.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Fetch as u32 as f32;
                    events |= DOG_EVENT_FETCH_STARTED;
                }
            }
            DOG_CMD_PACK_PLAY_START => {
                let partner_valid = ctx.pack_partner_available
                    && ctx.pack_partner_id.is_finite()
                    && ctx.pack_partner_id > 0.0;
                let distance = distance_between(
                    slot_value(buf, DOG_BUF_DOG_X),
                    slot_value(buf, DOG_BUF_DOG_Y),
                    ctx.pack_partner_x,
                    ctx.pack_partner_y,
                );
                let sunny_rolling =
                    slot_state(buf, DOG_BUF_SUNNY_ROLL_STATE) == SunnyRollStateId::Rolling as u32;
                let fetch_active =
                    slot_state(buf, DOG_BUF_TRANSITION_STATE) == TransitionStateId::ToBall as u32;
                if !partner_valid
                    || distance > PACK_PLAY_START_DISTANCE_PX
                    || sunny_rolling
                    || fetch_active
                {
                    increment_reject_count(buf);
                    events |= DOG_EVENT_COMMAND_REJECTED;
                } else {
                    increment_accept_count(buf);
                    buf.slots[DOG_BUF_PACK_PLAY_STATE] = PackPlayStateId::Active as u32 as f32;
                    buf.slots[DOG_BUF_PACK_PLAY_TIMER] = PACK_PLAY_DURATION_S;
                    buf.slots[DOG_BUF_PACK_PLAY_PARTNER_ID] = ctx.pack_partner_id;
                    buf.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Social as u32 as f32;
                    events |= DOG_EVENT_PACK_PLAY_STARTED;
                }
            }
            DOG_CMD_PACK_PLAY_BREAK => {
                // Breaking is only meaningful while pack play is active. When it
                // is not active this is a silent no-op: no counters, no events,
                // no state mutation.
                if slot_state(buf, DOG_BUF_PACK_PLAY_STATE) == PackPlayStateId::Active as u32 {
                    increment_accept_count(buf);
                    buf.slots[DOG_BUF_PACK_PLAY_STATE] = PackPlayStateId::Breaking as u32 as f32;
                    buf.slots[DOG_BUF_PACK_PLAY_TIMER] = PACK_PLAY_BREAK_TIME_S;
                }
            }
            _ => {}
        }
    }

    advance_recall(buf, ctx, dt_s, &mut events);
    advance_fetch(buf, ctx, &mut events);
    advance_sunny_roll(buf, ctx, &mut events, &mut events_hi);
    advance_pack_play(buf, ctx, &mut events);
    advance_needs(buf, ctx, &mut events);

    write_event_mask64(buf, events as u64 | events_hi);
    events
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
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_BALL_ACTIVE] = 1.0;

        {
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
        }

        // combo.has_ball alone is insufficient when BALL_ACTIVE is low.
        buffer.slots[DOG_BUF_BALL_ACTIVE] = 0.0;
        {
            let mut combo = blank_combo();
            combo.has_ball = true;
            let input = UtilityInput {
                buffer: &buffer,
                combo,
                traits: base_traits(),
                obstacles: &obstacles,
            };
            assert_eq!(score_fetch_ball(&input), 0.0);        }

        buffer.slots[DOG_BUF_BALL_ACTIVE] = 1.0;
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
        buffer.slots[DOG_BUF_DOG_VX] = 200.0;
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
        assert_eq!(read_event_bitmask(&buffer), events);
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
        assert_eq!(output.events, read_event_bitmask(&buffer));
        assert!(output.steer_x.is_finite() && output.steer_y.is_finite());
        assert!(magnitude(output.steer_x, output.steer_y) <= 1.0 + 1e-5);
    }

    #[test]
    fn scores_react_to_modulation() {
        let obstacles: [WorldObstacle; 0] = [];
        let buffer = blank_buffer();

        let low = PersonalityTraits {
            loyalty: 0.1,
            stubbornness: 0.9,
            ..base_traits()
        };
        let high = PersonalityTraits {
            loyalty: 0.9,
            stubbornness: 0.1,
            ..base_traits()
        };
        let combo = blank_combo();

        let low_input = UtilityInput {
            buffer: &buffer,
            combo,
            traits: low,
            obstacles: &obstacles,
        };
        let high_input = UtilityInput {
            buffer: &buffer,
            combo,
            traits: high,
            obstacles: &obstacles,
        };

        assert!(score_heel_follow(&high_input) > score_heel_follow(&low_input));
        assert!(score_check_in(&high_input) > score_check_in(&low_input));
    }

    #[test]
    fn camera_open_space_modulates_roam_and_zoomies() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut big = blank_buffer();
        big.slots[DOG_BUF_CAM_ACTIVE] = 1.0;
        big.slots[DOG_BUF_CAM_LEFT] = 0.0;
        big.slots[DOG_BUF_CAM_TOP] = 0.0;
        big.slots[DOG_BUF_CAM_RIGHT] = 1920.0;
        big.slots[DOG_BUF_CAM_BOTTOM] = 1080.0;

        let mut tiny = blank_buffer();
        tiny.slots[DOG_BUF_CAM_ACTIVE] = 1.0;
        tiny.slots[DOG_BUF_CAM_RIGHT] = 10.0;
        tiny.slots[DOG_BUF_CAM_BOTTOM] = 10.0;

        let traits = base_traits();
        let combo = blank_combo();
        let big_input = UtilityInput {
            buffer: &big,
            combo,
            traits,
            obstacles: &obstacles,
        };
        let tiny_input = UtilityInput {
            buffer: &tiny,
            combo,
            traits,
            obstacles: &obstacles,
        };

        assert!(score_roam_explore(&big_input) > score_roam_explore(&tiny_input));
        assert!(score_zoomies(&big_input) > score_zoomies(&tiny_input));
    }

    #[test]
    fn scores_read_multiple_peers_npcs_and_scents() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_PEER_COUNT] = 2.0;
        buffer.slots[DOG_BUF_PEER0_X] = 100.0;
        buffer.slots[DOG_BUF_PEER0_Y] = 100.0;
        buffer.slots[DOG_BUF_PEER1_X] = 20.0;
        buffer.slots[DOG_BUF_PEER1_Y] = 20.0;

        buffer.slots[DOG_BUF_NPC_COUNT] = 1.0;
        buffer.slots[DOG_BUF_NPC0_X] = 30.0;
        buffer.slots[DOG_BUF_NPC0_Y] = 30.0;

        buffer.slots[DOG_BUF_SCENT_COUNT] = 2.0;
        buffer.slots[DOG_BUF_SCENT0_X] = 10.0;
        buffer.slots[DOG_BUF_SCENT0_Y] = 0.0;
        buffer.slots[DOG_BUF_SCENT1_X] = 5.0;
        buffer.slots[DOG_BUF_SCENT1_Y] = 0.0;

        let traits = base_traits();
        let combo = blank_combo();
        let input = UtilityInput {
            buffer: &buffer,
            combo,
            traits,
            obstacles: &obstacles,
        };

        assert!(score_social_greet(&input) > 0.1);
        assert!(score_pack_play(&input) > 0.2);
        assert!(score_lag_and_sniff(&input) > 0.2);
    }

    #[test]
    fn pick_best_returns_raw_pre_hysteresis_score() {
        let mut scores = [0.0f32; UTIL_COUNT];
        scores[UTIL_HEEL_FOLLOW as usize] = 0.95;
        scores[UTIL_FETCH_BALL as usize] = 1.0;

        let (best, raw) = pick_best(&scores, Some(UTIL_HEEL_FOLLOW));
        assert_eq!(best, UTIL_HEEL_FOLLOW);
        assert!((raw - 0.95).abs() < 1e-6);
    }

    #[test]
    fn active_utility_id_validation_rejects_fractional_and_out_of_range() {
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = -0.5;
        assert_eq!(active_utility_from_buffer(&buffer), None);
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = 11.9;
        assert_eq!(active_utility_from_buffer(&buffer), None);
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = 5.0;
        assert_eq!(active_utility_from_buffer(&buffer), Some(5));
    }

    #[test]
    fn arrive_force_scales_with_distance() {
        let obstacles: [WorldObstacle; 0] = [];
        let traits = base_traits();
        let combo = blank_combo();

        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 100.0;
        buffer.slots[DOG_BUF_DOG_Y] = 100.0;
        buffer.slots[DOG_BUF_OWNER_X] = 112.0;
        buffer.slots[DOG_BUF_OWNER_Y] = 100.0;

        let (ax, ay) = {
            let input = UtilityInput {
                buffer: &buffer,
                combo,
                traits,
                obstacles: &obstacles,
            };
            arrive_force(&input, UTIL_HEEL_FOLLOW, 100.0, 100.0)
        };
        assert!(ax > 0.0);
        assert!(ay.abs() < 1e-4);
        assert!(magnitude(ax, ay) <= 1.0);

        buffer.slots[DOG_BUF_OWNER_X] = 300.0;
        let (ax2, ay2) = {
            let input = UtilityInput {
                buffer: &buffer,
                combo,
                traits,
                obstacles: &obstacles,
            };
            arrive_force(&input, UTIL_HEEL_FOLLOW, 100.0, 100.0)
        };
        assert!(magnitude(ax2, ay2) >= magnitude(ax, ay) - 1e-4);
    }

    #[test]
    fn soft_tether_pulls_only_when_leashed_and_far() {
        let obstacles: [WorldObstacle; 0] = [];
        let traits = base_traits();

        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_OWNER_X] = 100.0;
        buffer.slots[DOG_BUF_OWNER_Y] = 0.0;

        {
            let combo = blank_combo();
            let input = UtilityInput {
                buffer: &buffer,
                combo,
                traits,
                obstacles: &obstacles,
            };
            assert_eq!(soft_tether_force(&input, 0.0, 0.0), (0.0, 0.0));
        }

        let mut combo = blank_combo();
        combo.is_on_leash = true;
        let input = UtilityInput {
            buffer: &buffer,
            combo,
            traits,
            obstacles: &obstacles,
        };
        let (tx, _ty) = soft_tether_force(&input, 0.0, 0.0);
        assert!(tx > 0.0);
    }

    #[test]
    fn social_force_only_for_social_utilities() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_PEER_COUNT] = 1.0;
        buffer.slots[DOG_BUF_PEER0_X] = 40.0;
        buffer.slots[DOG_BUF_PEER0_Y] = 0.0;

        let traits = base_traits();
        let combo = blank_combo();
        let input = UtilityInput {
            buffer: &buffer,
            combo,
            traits,
            obstacles: &obstacles,
        };

        assert_eq!(
            social_circle_force(&input, UTIL_HEEL_FOLLOW, 0.0, 0.0),
            (0.0, 0.0)
        );
        let (cx, cy) = social_circle_force(&input, UTIL_SOCIAL_GREET, 0.0, 0.0);
        assert!(magnitude(cx, cy) > 0.0);
    }

    #[test]
    fn zoomie_path_selection_respects_active_and_traits() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = UTIL_HEEL_FOLLOW as f32;

        let traits = base_traits();
        let combo = blank_combo();

        {
            let input = UtilityInput {
                buffer: &buffer,
                combo,
                traits,
                obstacles: &obstacles,
            };
            assert_eq!(select_zoomie_path(&input), ZoomiePathId::None);
        }

        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = UTIL_ZOOMIES as f32;
        buffer.slots[DOG_BUF_CAM_ACTIVE] = 1.0;
        buffer.slots[DOG_BUF_CAM_LEFT] = 0.0;
        buffer.slots[DOG_BUF_CAM_TOP] = 0.0;
        buffer.slots[DOG_BUF_CAM_RIGHT] = 1920.0;
        buffer.slots[DOG_BUF_CAM_BOTTOM] = 1080.0;

        {
            let high = PersonalityTraits {
                energy: 1.0,
                ..base_traits()
            };
            let input = UtilityInput {
                buffer: &buffer,
                combo,
                traits: high,
                obstacles: &obstacles,
            };
            assert_eq!(select_zoomie_path(&input), ZoomiePathId::FigureEight);
        }

        {
            let low = PersonalityTraits {
                energy: 0.1,
                ..base_traits()
            };
            let input = UtilityInput {
                buffer: &buffer,
                combo,
                traits: low,
                obstacles: &obstacles,
            };
            assert_eq!(select_zoomie_path(&input), ZoomiePathId::OrbitOwner);
        }
    }

    #[test]
    fn base_desired_speed_mapping() {
        assert_eq!(base_desired_speed(UTIL_ZOOMIES), 290.0);
        assert_eq!(base_desired_speed(UTIL_FETCH_BALL), 290.0);
        assert_eq!(base_desired_speed(UTIL_HEEL_FOLLOW), 220.0);
        assert_eq!(base_desired_speed(UTIL_RECALL), 220.0);
        assert_eq!(base_desired_speed(UTIL_ROAM_EXPLORE), 155.0);
        assert_eq!(base_desired_speed(UTIL_SCOUT_AHEAD), 155.0);
        assert_eq!(base_desired_speed(UTIL_PACK_PLAY), 155.0);
        assert_eq!(base_desired_speed(UTIL_SOCIAL_GREET), 155.0);
        assert_eq!(base_desired_speed(UTIL_CHECK_IN), 120.0);
        assert_eq!(base_desired_speed(UTIL_LAG_AND_SNIFF), 120.0);
        assert_eq!(base_desired_speed(UTIL_AMBIENT_REST), 0.0);
        assert_eq!(base_desired_speed(UTIL_BARK_IMPULSE), 0.0);
    }

    #[test]
    fn step_derives_desired_gait_from_desired_speed() {
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_TRAIT_CURIOSITY] = 1.0;
        buffer.slots[DOG_BUF_TRAIT_ENERGY] = 1.0;
        buffer.slots[DOG_BUF_TRAIT_LOYALTY] = 0.0;
        buffer.slots[DOG_BUF_TRAIT_STUBBORNNESS] = 0.0;

        let obstacles: [WorldObstacle; 0] = [];
        let output = step_utility_ai(&mut buffer, &obstacles, blank_combo(), 0.016);

        assert_eq!(output.desired_gait, gait_from_speed(output.desired_speed));
        assert!(output.desired_speed >= 0.0 && output.desired_speed <= 340.0 + 1e-4);
    }

    #[test]
    fn bark_event_fires_when_impulse_is_high() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_TRAIT_STUBBORNNESS] = 1.0;
        buffer.slots[DOG_BUF_BALL_ACTIVE] = 1.0;
        buffer.slots[DOG_BUF_BALL_X] = 0.0;
        buffer.slots[DOG_BUF_BALL_Y] = 0.0;
        buffer.slots[DOG_BUF_CMD_BARK] = 1.0;
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = UTIL_BARK_IMPULSE as f32;

        let snap = snapshot(&buffer);
        let traits = PersonalityTraits {
            stubbornness: 1.0,
            ..base_traits()
        };
        let input = UtilityInput {
            buffer: &snap,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };
        let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
        assert_ne!(events & DOG_EVENT_BARK_TRIGGERED, 0);
    }

    #[test]
    fn bark_event_blocked_by_cooldown_even_with_command() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_TRAIT_STUBBORNNESS] = 1.0;
        buffer.slots[DOG_BUF_BALL_ACTIVE] = 1.0;
        buffer.slots[DOG_BUF_BALL_X] = 0.0;
        buffer.slots[DOG_BUF_BALL_Y] = 0.0;
        buffer.slots[DOG_BUF_CMD_BARK] = 1.0;
        buffer.slots[DOG_BUF_SOCIAL_COOLDOWN] = 1.0;
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = UTIL_BARK_IMPULSE as f32;

        let snap = snapshot(&buffer);
        let traits = PersonalityTraits {
            stubbornness: 1.0,
            ..base_traits()
        };
        let input = UtilityInput {
            buffer: &snap,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };

        assert_eq!(score_bark_impulse(&input), 0.0);
        let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
        assert_eq!(events & DOG_EVENT_BARK_TRIGGERED, 0);
    }

    #[test]
    fn select_zoomie_path_ignores_best_utility_fallback() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        // Stored id is non-zoomie even though traits would make zoomies win.
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = UTIL_HEEL_FOLLOW as f32;
        buffer.slots[DOG_BUF_TRAIT_ENERGY] = 1.0;
        buffer.slots[DOG_BUF_CAM_ACTIVE] = 1.0;
        buffer.slots[DOG_BUF_CAM_LEFT] = 0.0;
        buffer.slots[DOG_BUF_CAM_TOP] = 0.0;
        buffer.slots[DOG_BUF_CAM_RIGHT] = 1920.0;
        buffer.slots[DOG_BUF_CAM_BOTTOM] = 1080.0;

        let traits = PersonalityTraits {
            energy: 1.0,
            ..base_traits()
        };
        let input = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };

        let (best, _) = select_best_utility(&input);
        assert_eq!(best, UTIL_ZOOMIES);
        assert_eq!(select_zoomie_path(&input), ZoomiePathId::None);

        // Invalid stored id also yields None.
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = -1.0;
        let input = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };
        assert_eq!(select_zoomie_path(&input), ZoomiePathId::None);
    }

    #[test]
    fn scent_deposited_fires_at_max_nose_twitch() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_SCENT_COUNT] = 1.0;
        buffer.slots[DOG_BUF_SCENT0_X] = 10.0;
        buffer.slots[DOG_BUF_SCENT0_Y] = 0.0;
        buffer.slots[DOG_BUF_TRAIT_CURIOSITY] = 1.0;
        buffer.slots[DOG_BUF_TRAIT_ENERGY] = 1.0;
        // Pick a `now` where the nose oscillator is at its peak (sin == 1).
        buffer.slots[DOG_BUF_NOW_SEC] = core::f32::consts::FRAC_PI_2 / 4.0;

        let snap = snapshot(&buffer);
        let traits = PersonalityTraits {
            curiosity: 1.0,
            energy: 1.0,
            ..base_traits()
        };
        let input = UtilityInput {
            buffer: &snap,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };
        let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
        assert!(buffer.slots[DOG_BUF_NOSE_TWITCH] >= 0.8);
        assert_ne!(events & DOG_EVENT_SCENT_DEPOSITED, 0);
    }

    #[test]
    fn scent_events_require_proximity() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_SCENT_COUNT] = 1.0;
        buffer.slots[DOG_BUF_SCENT0_X] = 4.0;
        buffer.slots[DOG_BUF_SCENT0_Y] = 0.0;
        buffer.slots[DOG_BUF_TRAIT_CURIOSITY] = 1.0;

        let snap = snapshot(&buffer);
        let traits = PersonalityTraits {
            curiosity: 1.0,
            ..base_traits()
        };
        let input = UtilityInput {
            buffer: &snap,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };
        let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
        assert_ne!(events & DOG_EVENT_STICK_PICKED_UP, 0);
    }

    #[test]
    fn pant_event_requires_low_energy_and_fast_gait() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_DOG_VX] = 200.0;

        let snap = snapshot(&buffer);
        let traits = PersonalityTraits {
            energy: 0.1,
            ..base_traits()
        };
        let input = UtilityInput {
            buffer: &snap,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };
        let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
        assert_ne!(events & DOG_EVENT_PANT_AUDIO, 0);
    }

    #[test]
    fn ball_events_require_proximity_and_fetch_state() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_BALL_ACTIVE] = 1.0;
        buffer.slots[DOG_BUF_BALL_X] = 2.0;
        buffer.slots[DOG_BUF_BALL_Y] = 0.0;
        buffer.slots[DOG_BUF_OWNER_X] = 0.0;
        buffer.slots[DOG_BUF_OWNER_Y] = 0.0;
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = UTIL_FETCH_BALL as f32;

        let snap = snapshot(&buffer);
        let traits = base_traits();
        let input = UtilityInput {
            buffer: &snap,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };
        let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
        assert_ne!(events & DOG_EVENT_BALL_GRABBED, 0);
        assert_ne!(events & DOG_EVENT_BALL_HANDOFF, 0);
    }

    #[test]
    fn stray_events_follow_owner_distance_and_state() {
        let obstacles: [WorldObstacle; 0] = [];
        let traits = PersonalityTraits {
            curiosity: 1.0,
            ..base_traits()
        };

        {
            let mut buffer = blank_buffer();
            buffer.slots[DOG_BUF_OWNER_X] = 200.0;
            buffer.slots[DOG_BUF_OWNER_Y] = 0.0;
            let snap = snapshot(&buffer);
            let input = UtilityInput {
                buffer: &snap,
                combo: blank_combo(),
                traits,
                obstacles: &obstacles,
            };
            let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
            assert_ne!(events & DOG_EVENT_STRAY_TRIGGERED, 0);
        }

        {
            let mut buffer = blank_buffer();
            buffer.slots[DOG_BUF_OWNER_X] = 10.0;
            buffer.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Stray as u32 as f32;
            let snap = snapshot(&buffer);
            let input = UtilityInput {
                buffer: &snap,
                combo: blank_combo(),
                traits,
                obstacles: &obstacles,
            };
            let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
            assert_ne!(events & DOG_EVENT_STRAY_RESOLVED, 0);
        }
    }

    #[test]
    fn whine_and_hearts_events_follow_scores() {
        let obstacles: [WorldObstacle; 0] = [];

        {
            let mut buffer = blank_buffer();
            buffer.slots[DOG_BUF_CMD_WHISTLE_RECALL] = 1.0;
            buffer.slots[DOG_BUF_IDLE_REST_TIMER] = 4.0;
            let snap = snapshot(&buffer);
            let traits = PersonalityTraits {
                loyalty: 1.0,
                stubbornness: 0.0,
                energy: 0.0,
                ..base_traits()
            };
            let input = UtilityInput {
                buffer: &snap,
                combo: blank_combo(),
                traits,
                obstacles: &obstacles,
            };
            let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
            assert_ne!(events & DOG_EVENT_WHINE_AUDIO, 0);
        }

        {
            let mut buffer = blank_buffer();
            buffer.slots[DOG_BUF_PEER_COUNT] = 1.0;
            buffer.slots[DOG_BUF_PEER0_X] = 0.0;
            buffer.slots[DOG_BUF_PEER0_Y] = 0.0;
            let snap = snapshot(&buffer);
            let traits = PersonalityTraits {
                loyalty: 1.0,
                stubbornness: 0.0,
                ..base_traits()
            };
            let input = UtilityInput {
                buffer: &snap,
                combo: blank_combo(),
                traits,
                obstacles: &obstacles,
            };
            let events = integrate_micro_expressions(&mut buffer, &input, 0.016);
            assert_ne!(events & DOG_EVENT_HEARTS_SPAWNED, 0);
        }
    }

    #[test]
    fn rng_seed_written_back_when_roam_uses_jitter() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_TRAIT_CURIOSITY] = 0.3;
        buffer.slots[DOG_BUF_TRAIT_ENERGY] = 0.3;
        buffer.slots[DOG_BUF_TRAIT_STUBBORNNESS] = 0.5;
        buffer.slots[DOG_BUF_TRAIT_LOYALTY] = 0.0;
        buffer.slots[DOG_BUF_TARGET_SLOT_X] = 10000.0;
        buffer.slots[DOG_BUF_TARGET_SLOT_Y] = 10000.0;
        buffer.slots[DOG_BUF_CAM_ACTIVE] = 1.0;
        buffer.slots[DOG_BUF_CAM_LEFT] = 0.0;
        buffer.slots[DOG_BUF_CAM_TOP] = 0.0;
        buffer.slots[DOG_BUF_CAM_RIGHT] = 1920.0;
        buffer.slots[DOG_BUF_CAM_BOTTOM] = 1080.0;
        buffer.slots[DOG_BUF_RNG_SEED] = 12345.0;

        let before = buffer.slots[DOG_BUF_RNG_SEED];
        let output = step_utility_ai(&mut buffer, &obstacles, blank_combo(), 0.016);

        assert_eq!(output.active_utility_id, UTIL_ROAM_EXPLORE);
        assert_ne!(buffer.slots[DOG_BUF_RNG_SEED], before);
    }

    #[test]
    fn off_leash_heel_score_yields_to_roam_explore() {
        let obstacles: [WorldObstacle; 0] = [];
        let buffer = blank_buffer();
        let traits = PersonalityTraits {
            curiosity: 0.5,
            energy: 0.5,
            stubbornness: 0.25,
            loyalty: 0.75,
        };
        let input = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };

        let heel = score_heel_follow(&input);
        let roam = score_roam_explore(&input);

        assert!(
            heel < roam,
            "off-leash heel ({}) must yield to roam ({})",
            heel,
            roam
        );
        let expected = unit(0.10 + 0.20 * 0.75 - 0.10 * 0.25);
        assert!((heel - expected).abs() < 1e-6, "heel = {}, expected {}", heel, expected);
        assert!((heel - 0.225).abs() < 1e-6);
    }

    #[test]
    fn non_finite_inputs_are_sanitized() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buffer = blank_buffer();
        buffer.slots[DOG_BUF_DOG_X] = f32::NAN;
        buffer.slots[DOG_BUF_DOG_Y] = f32::INFINITY;
        buffer.slots[DOG_BUF_OWNER_X] = f32::NEG_INFINITY;
        buffer.slots[DOG_BUF_ACTIVE_UTILITY_ID] = f32::NAN;
        buffer.slots[DOG_BUF_TRAIT_CURIOSITY] = f32::NAN;

        let traits = PersonalityTraits {
            curiosity: f32::NAN,
            ..base_traits()
        };
        let input = UtilityInput {
            buffer: &buffer,
            combo: blank_combo(),
            traits,
            obstacles: &obstacles,
        };

        let (best, score) = select_best_utility(&input);
        assert!(best < UTIL_COUNT as u32);
        assert!(score.is_finite());

        let (sx, sy) = compute_steering(&input, best);
        assert!(sx.is_finite() && sy.is_finite());

        let mut buffer2 = blank_buffer();
        let _ = step_utility_ai(&mut buffer2, &obstacles, blank_combo(), f32::NAN);
    }

    fn ai_context<'a>(obstacles: &'a [WorldObstacle]) -> DogAiContext<'a> {
        DogAiContext {
            owner_x: 0.0,
            owner_y: 0.0,
            ball_available: false,
            ball_held_by_dog: false,
            sunny_zone_contains_dog: false,
            pack_partner_available: false,
            pack_partner_id: 0.0,
            pack_partner_x: 0.0,
            pack_partner_y: 0.0,
            care_is_hungry: false,
            care_needs_grooming: false,
            care_is_tired: false,
            obstacles,
        }
    }

    fn ai_buffer() -> DogSimBuffer {
        blank_buffer()
    }

    fn set_flag(buf: &mut DogSimBuffer, index: usize) {
        buf.slots[index] = 1.0;
    }

    fn set_command(buf: &mut DogSimBuffer, bit: u32) {
        let current = buf.slots[DOG_BUF_COMMAND_FLAGS] as u32;
        buf.slots[DOG_BUF_COMMAND_FLAGS] = (current | bit) as f32;
    }

    #[test]
    fn command_constants_match_locked_values() {
        assert_eq!(WHISTLE_COOLDOWN_S, 8.0);
        assert_eq!(SOCIAL_COOLDOWN_S, 3.0);
        assert_eq!(PRAISE_COOLDOWN_S, 2.0);
        assert_eq!(PET_TIMER_S, 1.0);
        assert_eq!(PRAISE_TIMER_S, 1.0);
        assert_eq!(BARK_TIMER_S, 0.6);
        assert_eq!(ZOOMIES_TIMER_S, 3.0);
        assert_eq!(SUNNY_ROLL_DURATION_S, 2.0);
        assert_eq!(SUNNY_ROLL_COOLDOWN_S, 5.0);
        assert_eq!(PACK_PLAY_START_DISTANCE_PX, 40.0);
        assert_eq!(PACK_PLAY_BREAK_DISTANCE_PX, 48.0);
        assert_eq!(PACK_PLAY_DURATION_S, 8.0);
        assert_eq!(PACK_PLAY_BREAK_TIME_S, 0.5);
        assert_eq!(RECALL_ARRIVE_DISTANCE_PX, 24.0);
        assert_eq!(FETCH_TIMER_S, 10.0);
    }

    #[test]
    fn event_constants_are_distinct_powers_of_two() {
        let events = [
            DOG_EVENT_WHISTLE_RECALL_STARTED,
            DOG_EVENT_TRANSITION_STATE_CHANGED,
            DOG_EVENT_PET_ACCEPTED,
            DOG_EVENT_PRAISE_ACCEPTED,
            DOG_EVENT_BARK,
            DOG_EVENT_ZOOMIES_STARTED,
            DOG_EVENT_FETCH_STARTED,
            DOG_EVENT_RECALL_ARRIVED,
            DOG_EVENT_FETCH_COMPLETED,
            DOG_EVENT_SUNNY_ROLL_STARTED,
            DOG_EVENT_SUNNY_ROLL_FINISHED,
            DOG_EVENT_PACK_PLAY_STARTED,
            DOG_EVENT_PACK_PLAY_BROKEN,
            DOG_EVENT_NEED_HUNGRY,
            DOG_EVENT_NEED_GROOMING,
            DOG_EVENT_COMMAND_REJECTED,
            DOG_EVENT_NEED_TIRED,
        ];
        for (index, event) in events.iter().enumerate() {
            assert_eq!(event.count_ones(), 1);
            for other in events.iter().skip(index + 1) {
                assert_ne!(event, other);
            }
        }
    }

    #[test]
    fn state_machine_events_distinct_from_legacy_and_leash() {
        let state_events = [
            DOG_EVENT_WHISTLE_RECALL_STARTED,
            DOG_EVENT_TRANSITION_STATE_CHANGED,
            DOG_EVENT_PET_ACCEPTED,
            DOG_EVENT_PRAISE_ACCEPTED,
            DOG_EVENT_BARK,
            DOG_EVENT_ZOOMIES_STARTED,
            DOG_EVENT_FETCH_STARTED,
            DOG_EVENT_RECALL_ARRIVED,
            DOG_EVENT_FETCH_COMPLETED,
            DOG_EVENT_SUNNY_ROLL_STARTED,
            DOG_EVENT_SUNNY_ROLL_FINISHED,
            DOG_EVENT_PACK_PLAY_STARTED,
            DOG_EVENT_PACK_PLAY_BROKEN,
            DOG_EVENT_NEED_HUNGRY,
            DOG_EVENT_NEED_GROOMING,
            DOG_EVENT_COMMAND_REJECTED,
            DOG_EVENT_NEED_TIRED,
        ];
        let legacy = [
            DOG_EVENT_HEARTS_SPAWNED,
            DOG_EVENT_LEASH_TAUT,
            DOG_EVENT_LEASH_SLACK,
        ];
        for event in state_events.iter() {
            for other in legacy.iter() {
                assert_ne!(event, other);
            }
        }
    }

    #[test]
    fn invalid_dt_rejects_without_advancing_timers() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        let mut buf = ai_buffer();
        buf.slots[DOG_BUF_SOCIAL_COOLDOWN] = 1.0;
        buf.slots[DOG_BUF_PET_TIMER] = 0.5;

        for bad_dt in [f32::NAN, 0.0, -1.0] {
            let events = step_dog_utility_ai(&mut buf, &ctx, bad_dt);
            assert_ne!(events & DOG_EVENT_COMMAND_REJECTED, 0);
            assert_eq!(buf.slots[DOG_BUF_SOCIAL_COOLDOWN], 1.0);
            assert_eq!(buf.slots[DOG_BUF_PET_TIMER], 0.5);
        }
    }

    #[test]
    fn clear_pending_only_clears_flags() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        let mut buf = ai_buffer();
        set_command(&mut buf, DOG_CMD_CLEAR_PENDING);
        set_command(&mut buf, DOG_CMD_WHISTLE_RECALL);

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);

        assert_eq!(events & DOG_EVENT_WHISTLE_RECALL_STARTED, 0);
        assert_eq!(buf.slots[DOG_BUF_TRANSITION_STATE], 0.0);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_FLAGS], 0.0);
    }

    #[test]
    fn whistle_beats_pet_and_sets_cooldowns() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        let mut buf = ai_buffer();
        buf.slots[DOG_BUF_DOG_X] = 100.0;
        buf.slots[DOG_BUF_DOG_Y] = 100.0;
        set_flag(&mut buf, DOG_BUF_CMD_WHISTLE_RECALL);
        set_flag(&mut buf, DOG_BUF_CMD_PET);

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);

        assert_ne!(events & DOG_EVENT_WHISTLE_RECALL_STARTED, 0);
        assert_ne!(events & DOG_EVENT_TRANSITION_STATE_CHANGED, 0);
        assert_eq!(
            buf.slots[DOG_BUF_TRANSITION_STATE],
            TransitionStateId::ToOwner as u32 as f32
        );
        assert_eq!(buf.slots[DOG_BUF_SOCIAL_COOLDOWN], SOCIAL_COOLDOWN_S);
        assert_eq!(buf.slots[DOG_BUF_WHISTLE_COOLDOWN], WHISTLE_COOLDOWN_S);
        assert_eq!(buf.slots[DOG_BUF_PET_TIMER], 0.0);
    }

    #[test]
    fn social_cooldown_rejects_whistle_pet_and_praise() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        for command in [
            DOG_BUF_CMD_WHISTLE_RECALL,
            DOG_BUF_CMD_PET,
            DOG_BUF_CMD_PRAISE,
        ] {
            let mut buf = ai_buffer();
            buf.slots[DOG_BUF_SOCIAL_COOLDOWN] = 1.0;
            set_flag(&mut buf, command);
            let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
            assert_ne!(events & DOG_EVENT_COMMAND_REJECTED, 0);
        }
    }

    #[test]
    fn pet_praise_bark_and_zoomies_events() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);

        let mut buf = ai_buffer();
        set_flag(&mut buf, DOG_BUF_CMD_PET);
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_PET_ACCEPTED, 0);
        assert_eq!(buf.slots[DOG_BUF_PET_TIMER], PET_TIMER_S);

        let mut buf = ai_buffer();
        set_flag(&mut buf, DOG_BUF_CMD_PRAISE);
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_PRAISE_ACCEPTED, 0);
        assert_eq!(buf.slots[DOG_BUF_PRAISE_TIMER], PRAISE_TIMER_S);
        assert_eq!(buf.slots[DOG_BUF_SOCIAL_COOLDOWN], PRAISE_COOLDOWN_S);

        let mut buf = ai_buffer();
        set_flag(&mut buf, DOG_BUF_CMD_BARK);
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_BARK, 0);
        assert_eq!(buf.slots[DOG_BUF_BARK_TIMER], BARK_TIMER_S);

        let mut buf = ai_buffer();
        set_flag(&mut buf, DOG_BUF_CMD_TRIGGER_ZOOMIES);
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_ZOOMIES_STARTED, 0);
        assert_eq!(buf.slots[DOG_BUF_ZOOMIES_TIMER], ZOOMIES_TIMER_S);
    }

    #[test]
    fn fetch_sets_timer_and_completes_when_held() {
        let obstacles: [WorldObstacle; 0] = [];

        let mut buf = ai_buffer();
        let ctx = ai_context(&obstacles);
        set_flag(&mut buf, DOG_BUF_CMD_FETCH_BALL);
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_COMMAND_REJECTED, 0);

        let mut buf = ai_buffer();
        let mut ctx = ai_context(&obstacles);
        ctx.ball_available = true;
        set_flag(&mut buf, DOG_BUF_CMD_FETCH_BALL);
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_FETCH_STARTED, 0);
        assert_eq!(
            buf.slots[DOG_BUF_TRANSITION_STATE],
            TransitionStateId::ToBall as u32 as f32
        );
        assert_eq!(buf.slots[DOG_BUF_FETCH_TIMER], FETCH_TIMER_S);

        ctx.ball_held_by_dog = true;
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_FETCH_COMPLETED, 0);
        assert_eq!(buf.slots[DOG_BUF_IS_BALL_HELD], 1.0);
        assert_eq!(
            buf.slots[DOG_BUF_TRANSITION_STATE],
            TransitionStateId::Idle as u32 as f32
        );
    }

    #[test]
    fn recall_arrives_within_threshold() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buf = ai_buffer();
        let mut ctx = ai_context(&obstacles);
        ctx.owner_x = 20.0;
        ctx.owner_y = 0.0;
        set_flag(&mut buf, DOG_BUF_CMD_WHISTLE_RECALL);

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);

        assert_ne!(events & DOG_EVENT_WHISTLE_RECALL_STARTED, 0);
        assert_ne!(events & DOG_EVENT_RECALL_ARRIVED, 0);
        assert_eq!(
            buf.slots[DOG_BUF_TRANSITION_STATE],
            TransitionStateId::Idle as u32 as f32
        );
        assert_eq!(
            buf.slots[DOG_BUF_DOG_STATE_ID],
            DogStateId::Idle as u32 as f32
        );
    }

    #[test]
    fn recall_suppressed_while_sunny_rolling() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buf = ai_buffer();
        buf.slots[DOG_BUF_DOG_X] = 100.0;
        buf.slots[DOG_BUF_DOG_Y] = 0.0;
        buf.slots[DOG_BUF_SUNNY_ROLL_STATE] = SunnyRollStateId::Rolling as u32 as f32;
        buf.slots[DOG_BUF_SUNNY_ROLL_TIMER] = 1.0;
        buf.slots[DOG_BUF_TRANSITION_STATE] = TransitionStateId::ToOwner as u32 as f32;
        let ctx = ai_context(&obstacles);

        let _ = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_eq!(buf.slots[DOG_BUF_DOG_X], 100.0);
    }

    #[test]
    fn sunny_roll_progression_and_reentry() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buf = ai_buffer();
        let mut ctx = ai_context(&obstacles);
        ctx.sunny_zone_contains_dog = true;

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.1);
        assert_ne!(events & DOG_EVENT_SUNNY_ROLL_STARTED, 0);
        assert_eq!(
            buf.slots[DOG_BUF_SUNNY_ROLL_STATE],
            SunnyRollStateId::Rolling as u32 as f32
        );

        let events = step_dog_utility_ai(&mut buf, &ctx, SUNNY_ROLL_DURATION_S);
        assert_ne!(events & DOG_EVENT_SUNNY_ROLL_FINISHED, 0);
        assert_eq!(
            buf.slots[DOG_BUF_SUNNY_ROLL_STATE],
            SunnyRollStateId::Finished as u32 as f32
        );

        let _ = step_dog_utility_ai(&mut buf, &ctx, SUNNY_ROLL_COOLDOWN_S);
        assert_eq!(
            buf.slots[DOG_BUF_SUNNY_ROLL_STATE],
            SunnyRollStateId::None as u32 as f32
        );

        ctx.sunny_zone_contains_dog = false;
        let _ = step_dog_utility_ai(&mut buf, &ctx, 0.1);
        ctx.sunny_zone_contains_dog = true;
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.1);
        assert_ne!(events & DOG_EVENT_SUNNY_ROLL_STARTED, 0);
    }

    #[test]
    fn pack_play_start_and_break_distances() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buf = ai_buffer();
        let mut ctx = ai_context(&obstacles);
        ctx.pack_partner_available = true;
        ctx.pack_partner_id = 7.0;
        ctx.pack_partner_x = 30.0;
        ctx.pack_partner_y = 0.0;
        set_command(&mut buf, DOG_CMD_PACK_PLAY_START);

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_PACK_PLAY_STARTED, 0);
        assert_eq!(
            buf.slots[DOG_BUF_PACK_PLAY_STATE],
            PackPlayStateId::Active as u32 as f32
        );
        assert_eq!(buf.slots[DOG_BUF_PACK_PLAY_PARTNER_ID], 7.0);

        ctx.pack_partner_x = 100.0;
        let _ = step_dog_utility_ai(&mut buf, &ctx, 0.1);
        assert_eq!(
            buf.slots[DOG_BUF_PACK_PLAY_STATE],
            PackPlayStateId::Breaking as u32 as f32
        );

        let events = step_dog_utility_ai(&mut buf, &ctx, PACK_PLAY_BREAK_TIME_S);
        assert_ne!(events & DOG_EVENT_PACK_PLAY_BROKEN, 0);
        assert_eq!(
            buf.slots[DOG_BUF_PACK_PLAY_STATE],
            PackPlayStateId::Broken as u32 as f32
        );
    }

    #[test]
    fn pack_play_start_rejects_invalid_conditions() {
        let obstacles: [WorldObstacle; 0] = [];

        let mut buf = ai_buffer();
        let ctx = ai_context(&obstacles);
        set_command(&mut buf, DOG_CMD_PACK_PLAY_START);
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_COMMAND_REJECTED, 0);
        assert_eq!(
            buf.slots[DOG_BUF_PACK_PLAY_STATE],
            PackPlayStateId::None as u32 as f32
        );

        let mut buf = ai_buffer();
        let mut ctx = ai_context(&obstacles);
        ctx.pack_partner_available = true;
        ctx.pack_partner_id = 3.0;
        ctx.pack_partner_x = 100.0;
        ctx.pack_partner_y = 0.0;
        set_command(&mut buf, DOG_CMD_PACK_PLAY_START);
        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_ne!(events & DOG_EVENT_COMMAND_REJECTED, 0);
    }

    #[test]
    fn pack_play_break_when_inactive_does_nothing() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        let mut buf = ai_buffer();
        set_command(&mut buf, DOG_CMD_PACK_PLAY_BREAK);

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);

        assert_eq!(events & DOG_EVENT_PACK_PLAY_STARTED, 0);
        assert_eq!(
            buf.slots[DOG_BUF_PACK_PLAY_STATE],
            PackPlayStateId::None as u32 as f32
        );
    }

    #[test]
    fn need_flags_are_hydrated_from_context() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buf = ai_buffer();
        let mut ctx = ai_context(&obstacles);
        ctx.care_is_hungry = true;
        ctx.care_needs_grooming = true;
        ctx.care_is_tired = true;

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);

        assert_eq!(buf.slots[DOG_BUF_IS_HUNGRY], 1.0);
        assert_eq!(buf.slots[DOG_BUF_NEEDS_GROOMING], 1.0);
        assert_eq!(buf.slots[DOG_BUF_IS_TIRED], 1.0);
        assert_ne!(events & DOG_EVENT_NEED_HUNGRY, 0);
        assert_ne!(events & DOG_EVENT_NEED_GROOMING, 0);
        assert_ne!(events & DOG_EVENT_NEED_TIRED, 0);
    }

    #[test]
    fn command_flags_are_cleared_after_processing() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        let mut buf = ai_buffer();
        let flags = [
            DOG_BUF_CMD_WHISTLE_RECALL,
            DOG_BUF_CMD_PET,
            DOG_BUF_CMD_PRAISE,
            DOG_BUF_CMD_BARK,
            DOG_BUF_CMD_TRIGGER_ZOOMIES,
            DOG_BUF_CMD_FETCH_BALL,
        ];
        for index in flags {
            buf.slots[index] = 1.0;
        }
        set_command(&mut buf, DOG_CMD_CLEAR_PENDING);

        let _ = step_dog_utility_ai(&mut buf, &ctx, 0.016);

        for index in flags {
            assert_eq!(buf.slots[index], 0.0);
        }
        assert_eq!(buf.slots[DOG_BUF_COMMAND_FLAGS], 0.0);
    }

    #[test]
    fn command_counters_track_accept_and_reject() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);

        let mut buf = ai_buffer();
        set_flag(&mut buf, DOG_BUF_CMD_BARK);
        let _ = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_ACCEPT_COUNT], 1.0);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_REJECT_COUNT], 0.0);

        let mut buf = ai_buffer();
        buf.slots[DOG_BUF_SOCIAL_COOLDOWN] = 1.0;
        set_flag(&mut buf, DOG_BUF_CMD_PET);
        let _ = step_dog_utility_ai(&mut buf, &ctx, 0.016);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_ACCEPT_COUNT], 0.0);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_REJECT_COUNT], 1.0);
    }

    #[test]
    fn additional_lower_priority_commands_are_rejected() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        let mut buf = ai_buffer();
        // BARK (bit 4) outranks ZOOMIES (bit 5); the zoomies bit is rejected.
        set_flag(&mut buf, DOG_BUF_CMD_BARK);
        set_flag(&mut buf, DOG_BUF_CMD_TRIGGER_ZOOMIES);

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);

        assert_ne!(events & DOG_EVENT_BARK, 0);
        assert_ne!(events & DOG_EVENT_COMMAND_REJECTED, 0);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_ACCEPT_COUNT], 1.0);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_REJECT_COUNT], 1.0);
    }

    #[test]
    fn social_cooldown_reject_event_emitted() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        for command in [
            DOG_BUF_CMD_WHISTLE_RECALL,
            DOG_BUF_CMD_PET,
            DOG_BUF_CMD_PRAISE,
        ] {
            let mut buf = ai_buffer();
            buf.slots[DOG_BUF_SOCIAL_COOLDOWN] = 1.0;
            set_flag(&mut buf, command);
            let _ = step_dog_utility_ai(&mut buf, &ctx, 0.016);
            assert_ne!(
                read_event_mask64(&buf) & DOG_EVENT_SOCIAL_COOLDOWN_REJECT,
                0,
                "social cooldown reject event missing for command slot {}",
                command
            );
        }
    }

    #[test]
    fn sunny_zone_entered_event_emitted() {
        let obstacles: [WorldObstacle; 0] = [];
        let mut buf = ai_buffer();
        let mut ctx = ai_context(&obstacles);
        ctx.sunny_zone_contains_dog = true;

        let _ = step_dog_utility_ai(&mut buf, &ctx, 0.1);

        assert_ne!(read_event_mask64(&buf) & DOG_EVENT_SUNNY_ZONE_ENTERED, 0);
    }

    #[test]
    fn pack_play_break_inactive_is_silent() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        let mut buf = ai_buffer();
        set_command(&mut buf, DOG_CMD_PACK_PLAY_BREAK);

        let events = step_dog_utility_ai(&mut buf, &ctx, 0.016);

        assert_eq!(events & DOG_EVENT_COMMAND_REJECTED, 0);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_ACCEPT_COUNT], 0.0);
        assert_eq!(buf.slots[DOG_BUF_COMMAND_REJECT_COUNT], 0.0);
        assert_eq!(
            buf.slots[DOG_BUF_PACK_PLAY_STATE],
            PackPlayStateId::None as u32 as f32
        );
    }

    #[test]
    fn invalid_dt_returns_exact_command_rejected() {
        let obstacles: [WorldObstacle; 0] = [];
        let ctx = ai_context(&obstacles);
        let mut buf = ai_buffer();
        buf.slots[DOG_BUF_EVENT_BITMASK] = 7.0;

        let events = step_dog_utility_ai(&mut buf, &ctx, f32::NAN);

        assert_eq!(events, DOG_EVENT_COMMAND_REJECTED);
        assert_eq!(read_event_bitmask(&buf), DOG_EVENT_COMMAND_REJECTED);
    }
}
