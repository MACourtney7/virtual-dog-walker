use crate::math::{lerp_angle, Mulberry32};
use crate::world_contract::NpcSimBuffer;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NpcFrameState {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub angle: f64,
    pub walk_phase: f64,
    pub opacity: f64,
    pub finished: bool,
}

pub fn to_seconds(t: f64) -> f64 {
    if t > 1.0e10 {
        t / 1000.0
    } else {
        t
    }
}

/// Result of walking a polyline to a given arc-length distance.
///
/// Shared, non-allocating core used by both `sample_npc_state` and
/// `sample_path_exact`. Uses strict `>` at segment boundaries so that at an
/// exact waypoint distance the sample stays on the incoming segment (preserving
/// boundary heading behavior).
#[derive(Debug, Clone, Copy)]
struct SegmentSample {
    x: f64,
    y: f64,
    seg_index: usize,
    seg_t: f64,
    seg_len: f64,
    dx: f64,
    dy: f64,
    accumulated: f64,
    total_len: f64,
}

/// Walk `n` points (accessed via `get`) to `distance` along the polyline.
fn sample_segments_generic<F: Fn(usize) -> (f64, f64)>(
    n: usize,
    get: F,
    distance: f64,
) -> SegmentSample {
    if n < 2 {
        let (x, y) = if n == 1 { get(0) } else { (0.0, 0.0) };
        return SegmentSample {
            x,
            y,
            seg_index: 0,
            seg_t: 0.0,
            seg_len: 0.0,
            dx: 0.0,
            dy: 0.0,
            accumulated: 0.0,
            total_len: 0.0,
        };
    }

    let seg_count = n - 1;
    let mut total_len = 0.0;
    for i in 0..seg_count {
        let (ax, ay) = get(i);
        let (bx, by) = get(i + 1);
        total_len += (bx - ax).hypot(by - ay);
    }

    let mut accumulated = 0.0;
    let mut interpolated = false;
    let (mut x, mut y) = get(0);
    let (mut dx, mut dy) = (0.0, 0.0);
    let mut seg_len = 0.0;
    let mut seg_index = 0usize;
    let mut seg_t = 0.0;

    for i in 0..seg_count {
        let (p1x, p1y) = get(i);
        let (p2x, p2y) = get(i + 1);
        let d = (p2x - p1x).hypot(p2y - p1y);
        // Strict `>`: at an exact waypoint distance we stay on the current
        // segment, preserving the incoming heading at the boundary.
        if accumulated + d > distance {
            let remaining = distance - accumulated;
            seg_t = if d > 0.000001 { remaining / d } else { 0.0 };
            dx = p2x - p1x;
            dy = p2y - p1y;
            x = p1x + dx * seg_t;
            y = p1y + dy * seg_t;
            seg_len = d;
            seg_index = i;
            interpolated = true;
            break;
        }
        accumulated += d;
    }

    if !interpolated {
        let last_idx = n - 2;
        let (p1x, p1y) = get(last_idx);
        let (p2x, p2y) = get(last_idx + 1);
        dx = p2x - p1x;
        dy = p2y - p1y;
        seg_len = (p2x - p1x).hypot(p2y - p1y);
        x = p2x;
        y = p2y;
        seg_index = last_idx;
        seg_t = 1.0;
        accumulated = total_len - seg_len;
    }

    SegmentSample {
        x,
        y,
        seg_index,
        seg_t,
        seg_len,
        dx,
        dy,
        accumulated,
        total_len,
    }
}

pub fn sample_npc_state(
    waypoints: &[(f64, f64)],
    speed: f64,
    spawn_time: f64,
    now: f64,
) -> NpcFrameState {
    if waypoints.len() < 2 {
        let (x, y) = waypoints.first().copied().unwrap_or((0.0, 0.0));
        return NpcFrameState {
            x,
            y,
            vx: 0.0,
            vy: 0.0,
            angle: 0.0,
            walk_phase: 0.0,
            opacity: 1.0,
            finished: true,
        };
    }

    let t_now = to_seconds(now);
    let t_spawn = to_seconds(spawn_time);
    let elapsed = (t_now - t_spawn).max(0.0);
    let distance = elapsed * speed;

    // Delegate the segment walk to the shared non-allocating sampler.
    let s = sample_segments_generic(waypoints.len(), |i| waypoints[i], distance);
    let total_len = s.total_len;
    let total_duration = total_len / speed.max(1.0);

    if distance >= total_len {
        let (last_x, last_y) = *waypoints.last().unwrap();
        return NpcFrameState {
            x: last_x,
            y: last_y,
            vx: 0.0,
            vy: 0.0,
            angle: 0.0,
            walk_phase: total_len * 0.1,
            opacity: 0.0,
            finished: true,
        };
    }

    let seg_idx = s.seg_index;
    let seg_len = s.seg_len.max(1e-6);
    let seg_dist = distance - s.accumulated;
    let seg_angle = s.dy.atan2(s.dx);

    // Smooth turning within 28px of waypoint junction
    let turn_window = 28.0;
    let dist_to_next = seg_len - seg_dist;
    let angle = if dist_to_next < turn_window && seg_idx + 2 < waypoints.len() {
        let p1 = waypoints[seg_idx + 1];
        let p2 = waypoints[seg_idx + 2];
        let next_angle = (p2.1 - p1.1).atan2(p2.0 - p1.0);
        let turn_frac = 1.0 - (dist_to_next / turn_window);
        lerp_angle(seg_angle, next_angle, turn_frac * 0.5)
    } else {
        seg_angle
    };

    let vx = angle.cos() * speed;
    let vy = angle.sin() * speed;
    let walk_phase = distance * 0.08;

    // Opacity fade: 0.5s fade-in, 0.5s fade-out at end of path
    let fade_time = 0.5;
    let remaining_time = total_duration - elapsed;
    let mut opacity = 1.0;
    if elapsed < fade_time {
        opacity = (elapsed / fade_time).clamp(0.0, 1.0);
    } else if remaining_time < fade_time {
        opacity = (remaining_time / fade_time).clamp(0.0, 1.0);
    }

    NpcFrameState {
        x: s.x,
        y: s.y,
        vx,
        vy,
        angle,
        walk_phase,
        opacity,
        finished: false,
    }
}

/// Result of sampling the interpolated part of an NPC path.
/// `has_angle` is false when the active segment is degenerate (JS keeps the previous angle).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathSample {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub angle: f64,
    pub has_angle: bool,
}

/// Exact port of the in-progress (distance < total length) branch of `ParkNPC.setClock` in
/// `src/entities/npc.js` (25px corner blend, 0.5 max blend, segment-direction velocity).
/// `waypoints_flat` is `[x0, y0, x1, y1, ...]`. Finish/fade/speech remain in JS.
pub fn sample_path_exact(waypoints_flat: &[f64], speed: f64, distance: f64) -> PathSample {
    let n = waypoints_flat.len() / 2;
    let s = sample_segments_generic(
        n,
        |i| (waypoints_flat[2 * i], waypoints_flat[2 * i + 1]),
        distance,
    );
    if n < 2 {
        return PathSample { x: s.x, y: s.y, vx: 0.0, vy: 0.0, angle: 0.0, has_angle: false };
    }
    let seg_count = n - 1;

    let mut angle = 0.0;
    let mut has_angle = false;
    if s.dx.hypot(s.dy) > 0.000001 {
        let seg_angle = s.dy.atan2(s.dx);
        let dist_to_next = s.seg_len * (1.0 - s.seg_t);
        if s.seg_index + 1 < seg_count && dist_to_next < 25.0 {
            let ai = s.seg_index;
            let (n1x, n1y) = (waypoints_flat[2 * (ai + 1)], waypoints_flat[2 * (ai + 1) + 1]);
            let (n2x, n2y) = (waypoints_flat[2 * (ai + 2)], waypoints_flat[2 * (ai + 2) + 1]);
            let next_angle = (n2y - n1y).atan2(n2x - n1x);
            let mut angle_diff = next_angle - seg_angle;
            while angle_diff < -std::f64::consts::PI {
                angle_diff += std::f64::consts::PI * 2.0;
            }
            while angle_diff > std::f64::consts::PI {
                angle_diff -= std::f64::consts::PI * 2.0;
            }
            let blend = ((1.0 - dist_to_next / 25.0) * 0.5).max(0.0).min(0.5);
            angle = seg_angle + angle_diff * blend;
        } else {
            angle = seg_angle;
        }
        has_angle = true;
    }

    let (vx, vy) = if s.seg_len > 0.000001 {
        ((s.dx / s.seg_len) * speed, (s.dy / s.seg_len) * speed)
    } else {
        (0.0, 0.0)
    };
    PathSample { x: s.x, y: s.y, vx, vy, angle, has_angle }
}

// ---------------------------------------------------------------------------
// ParkNPC runtime stepping (unification-048)
// ---------------------------------------------------------------------------

/// Fade duration in seconds once the NPC reaches the end of its path.
pub const NPC_FADE_DURATION_S: f32 = 0.5;
/// How long a speech phrase stays visible.
pub const NPC_SPEECH_WINDOW_S: f32 = 4.0;
/// Base delay between speech phrases.
pub const NPC_SPEECH_BASE_DELAY_S: f32 = 4.0;
/// Additional random jitter added to the speech delay.
pub const NPC_SPEECH_DELAY_JITTER_S: f32 = 4.0;
/// Walking speed in pixels per second.
pub const NPC_WALK_SPEED_PX_S: f32 = 40.0;
/// Running speed in pixels per second.
pub const NPC_RUN_SPEED_PX_S: f32 = 95.0;
/// Arrival epsilon in pixels: distances within this of a waypoint count as arrived.
pub const NPC_ARRIVE_EPS_PX: f32 = 0.5;
// State discriminants (stored in NPC_SLOT_STATE).
pub const NPC_STATE_WALKING: f32 = 0.0;
pub const NPC_STATE_RUNNING: f32 = 1.0;
pub const NPC_STATE_PAUSED: f32 = 2.0;

// Command flags (stored in NPC_SLOT_CMD_FLAGS).
pub const NPC_CMD_RESET: u32 = 1 << 0;
pub const NPC_CMD_PAUSE: u32 = 1 << 1;
pub const NPC_CMD_RESUME: u32 = 1 << 2;
pub const NPC_CMD_SET_WALKING: u32 = 1 << 3;
pub const NPC_CMD_SET_RUNNING: u32 = 1 << 4;
pub const NPC_CMD_FORCE_SPEECH: u32 = 1 << 5;

// Event bitmask constants returned from `step_npc_buffer`.
pub const NPC_EVENT_RESET: u32 = 1 << 0;
pub const NPC_EVENT_PAUSED: u32 = 1 << 1;
pub const NPC_EVENT_RESUMED: u32 = 1 << 2;
pub const NPC_EVENT_STATE_CHANGED: u32 = 1 << 3;
pub const NPC_EVENT_SPEECH_TRIGGERED: u32 = 1 << 4;
pub const NPC_EVENT_SPEECH_HIDDEN: u32 = 1 << 5;
pub const NPC_EVENT_PATH_FINISHED: u32 = 1 << 6;
pub const NPC_EVENT_FADE_STARTED: u32 = 1 << 7;
pub const NPC_EVENT_FADE_COMPLETED: u32 = 1 << 8;
pub const NPC_EVENT_CMD_REJECTED: u32 = 1 << 9;

// NpcSimBuffer slot indices (0..63).
pub const NPC_SLOT_STATE: usize = 0;
pub const NPC_SLOT_X: usize = 1;
pub const NPC_SLOT_Y: usize = 2;
pub const NPC_SLOT_HEADING_RAD: usize = 3;
pub const NPC_SLOT_SPEED_SCALE: usize = 4;
pub const NPC_SLOT_SEGMENT_INDEX: usize = 5;
pub const NPC_SLOT_SEGMENT_T: usize = 6;
pub const NPC_SLOT_ELAPSED_S: usize = 7;
pub const NPC_SLOT_OPACITY: usize = 8;
pub const NPC_SLOT_OPACITY_TARGET: usize = 9;
pub const NPC_SLOT_DONE: usize = 10;
pub const NPC_SLOT_IS_FINISHED_STATE: usize = 11;
pub const NPC_SLOT_FINISH_TIME_S: usize = 12;
pub const NPC_SLOT_FADE_START_S: usize = 13;
pub const NPC_SLOT_FADE_ELAPSED_S: usize = 14;
pub const NPC_SLOT_PAUSE_REMAINING_S: usize = 15;
pub const NPC_SLOT_SPEECH_VISIBLE: usize = 16;
pub const NPC_SLOT_SPEECH_PHRASE_ID: usize = 17;
pub const NPC_SLOT_SPEECH_TIMER_S: usize = 18;
pub const NPC_SLOT_SPEECH_WINDOW_S: usize = 19;
pub const NPC_SLOT_PHRASE_TIMER_S: usize = 20;
pub const NPC_SLOT_NEXT_SPEECH_DELAY_S: usize = 21;
pub const NPC_SLOT_RNG_STATE: usize = 22;
pub const NPC_SLOT_SEED: usize = 23;
pub const NPC_SLOT_PATH_POINT_COUNT: usize = 24;
pub const NPC_SLOT_PATH_TOTAL_LENGTH_PX: usize = 25;
pub const NPC_SLOT_PATH_HASH: usize = 26;
pub const NPC_SLOT_CMD_FLAGS: usize = 27;
pub const NPC_SLOT_FADE_COMPLETED: usize = 28;

/// A single waypoint on an NPC path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NpcPathPoint {
    pub x: f32,
    pub y: f32,
}

/// Per-step context passed to `step_npc_buffer`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NpcStepContext {
    pub owner_x: f32,
    pub owner_y: f32,
    pub phrase_count: u16,
}

/// Advance the mulberry32 state and return the next u32 draw.
///
/// The value is produced by `crate::math::Mulberry32` (the single source of
/// truth for the PRNG); we only mirror its fixed per-draw state increment so
/// the caller's stored state stays in sync.
#[inline]
fn mulberry32_next(state: &mut u32) -> u32 {
    let mut rng = Mulberry32::new(*state);
    let value = rng.next_f64();
    *state = state.wrapping_add(0x6D2B79F5);
    // `value` is `val / 2^32`; multiplying back by 2^32 is exact in f64.
    (value * 4294967296.0) as u32
}

/// Draw a float in `[0.0, 1.0)` from the mulberry32 state.
#[inline]
fn mulberry32_f32(state: &mut u32) -> f32 {
    (mulberry32_next(state) as f64 / 4294967296.0) as f32
}

#[inline]
fn slot_get(buf: &NpcSimBuffer, index: usize) -> f32 {
    buf.data[index]
}

#[inline]
fn slot_set(buf: &mut NpcSimBuffer, index: usize, value: f32) {
    buf.data[index] = value;
}

#[inline]
fn slot_get_u32(buf: &NpcSimBuffer, index: usize) -> u32 {
    let value = buf.data[index];
    if value.is_finite() && value > 0.0 {
        value.round() as u32
    } else {
        0
    }
}

#[inline]
fn slot_set_u32(buf: &mut NpcSimBuffer, index: usize, value: u32) {
    buf.data[index] = value as f32;
}

/// Read a slot as a bit-preserving `u32` (full 32-bit fidelity, no rounding).
#[inline]
fn slot_get_bits(buf: &NpcSimBuffer, index: usize) -> u32 {
    buf.data[index].to_bits()
}

/// Write a `u32` into a slot bit-preservingly (full 32-bit fidelity).
#[inline]
fn slot_set_bits(buf: &mut NpcSimBuffer, index: usize, value: u32) {
    buf.data[index] = f32::from_bits(value);
}

#[inline]
fn lerp_f32(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// FNV-1a hash over the path's point coordinates.
fn compute_path_hash(path: &[NpcPathPoint]) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for p in path {
        for byte in p.x.to_bits().to_le_bytes() {
            hash ^= byte as u32;
            hash = hash.wrapping_mul(0x0100_0193);
        }
        for byte in p.y.to_bits().to_le_bytes() {
            hash ^= byte as u32;
            hash = hash.wrapping_mul(0x0100_0193);
        }
    }
    hash
}

/// Sum of segment lengths, each clamped to a minimum of 0.001.
fn compute_path_total_length(path: &[NpcPathPoint]) -> f32 {
    let mut total = 0.0_f32;
    for i in 0..path.len().saturating_sub(1) {
        let dx = path[i + 1].x - path[i].x;
        let dy = path[i + 1].y - path[i].y;
        let d = dx.hypot(dy).max(0.001);
        total += d;
    }
    total
}

/// Advance a ParkNPC simulation buffer by one tick.
///
/// Returns an event bitmask (`NPC_EVENT_*`). No heap allocation occurs on
/// this path.
pub fn step_npc_buffer(
    buf: &mut NpcSimBuffer,
    path: &[NpcPathPoint],
    ctx: &NpcStepContext,
    dt_s: f32,
) -> u32 {
    // Step 3: dt validation.
    if !(dt_s > 0.0) || !dt_s.is_finite() {
        return NPC_EVENT_CMD_REJECTED;
    }

    let mut events: u32 = 0;

    // Step 4: path preparation (non-allocating).
    let path_point_count = path.len() as u32;
    let path_total_length_px = compute_path_total_length(path);
    let path_hash = compute_path_hash(path);
    slot_set_u32(buf, NPC_SLOT_PATH_POINT_COUNT, path_point_count);
    slot_set(buf, NPC_SLOT_PATH_TOTAL_LENGTH_PX, path_total_length_px);
    slot_set_bits(buf, NPC_SLOT_PATH_HASH, path_hash);

    let path_too_short = path.len() < 2;

    // Step 5: command processing (strict priority + clear).
    let cmd_flags = slot_get_u32(buf, NPC_SLOT_CMD_FLAGS);
    let mut did_reset = false;
    if cmd_flags & NPC_CMD_RESET != 0 {
        let (x0, y0) = if let Some(p) = path.first() {
            (p.x, p.y)
        } else {
            (0.0, 0.0)
        };
        slot_set(buf, NPC_SLOT_X, x0);
        slot_set(buf, NPC_SLOT_Y, y0);
        slot_set(buf, NPC_SLOT_STATE, NPC_STATE_WALKING);
        slot_set(buf, NPC_SLOT_OPACITY, 1.0);
        slot_set(buf, NPC_SLOT_OPACITY_TARGET, 1.0);
        slot_set(buf, NPC_SLOT_DONE, 0.0);
        slot_set(buf, NPC_SLOT_IS_FINISHED_STATE, 0.0);
        slot_set(buf, NPC_SLOT_ELAPSED_S, 0.0);
        slot_set(buf, NPC_SLOT_SEGMENT_INDEX, 0.0);
        slot_set(buf, NPC_SLOT_SEGMENT_T, 0.0);
        slot_set(buf, NPC_SLOT_FADE_ELAPSED_S, 0.0);
        slot_set(buf, NPC_SLOT_FINISH_TIME_S, 0.0);
        slot_set(buf, NPC_SLOT_FADE_START_S, 0.0);
        slot_set(buf, NPC_SLOT_FADE_COMPLETED, 0.0);
        slot_set(buf, NPC_SLOT_PAUSE_REMAINING_S, 0.0);
        slot_set(buf, NPC_SLOT_SPEECH_VISIBLE, 0.0);
        slot_set(buf, NPC_SLOT_SPEECH_PHRASE_ID, 0.0);
        slot_set(buf, NPC_SLOT_SPEECH_TIMER_S, 0.0);
        slot_set(buf, NPC_SLOT_SPEECH_WINDOW_S, 0.0);
        slot_set(buf, NPC_SLOT_PHRASE_TIMER_S, 0.0);
        slot_set(buf, NPC_SLOT_NEXT_SPEECH_DELAY_S, NPC_SPEECH_BASE_DELAY_S);
        slot_set(buf, NPC_SLOT_SPEED_SCALE, 1.0);
        let seed = slot_get_bits(buf, NPC_SLOT_SEED);
        slot_set_bits(buf, NPC_SLOT_RNG_STATE, seed);
        did_reset = true;
        events |= NPC_EVENT_RESET;
    } else if cmd_flags & NPC_CMD_PAUSE != 0 {
        slot_set(buf, NPC_SLOT_STATE, NPC_STATE_PAUSED);
        slot_set(buf, NPC_SLOT_PAUSE_REMAINING_S, f32::INFINITY);
        events |= NPC_EVENT_PAUSED;
    } else if cmd_flags & NPC_CMD_RESUME != 0 {
        slot_set(buf, NPC_SLOT_STATE, NPC_STATE_WALKING);
        slot_set(buf, NPC_SLOT_PAUSE_REMAINING_S, 0.0);
        events |= NPC_EVENT_RESUMED;
    } else if cmd_flags & NPC_CMD_SET_WALKING != 0 {
        slot_set(buf, NPC_SLOT_STATE, NPC_STATE_WALKING);
        events |= NPC_EVENT_STATE_CHANGED;
    } else if cmd_flags & NPC_CMD_SET_RUNNING != 0 {
        slot_set(buf, NPC_SLOT_STATE, NPC_STATE_RUNNING);
        events |= NPC_EVENT_STATE_CHANGED;
    } else if cmd_flags & NPC_CMD_FORCE_SPEECH != 0 {
        if ctx.phrase_count == 0 {
            events |= NPC_EVENT_CMD_REJECTED;
        } else {
            let mut rng = slot_get_bits(buf, NPC_SLOT_RNG_STATE);
            let draw = mulberry32_next(&mut rng);
            slot_set_bits(buf, NPC_SLOT_RNG_STATE, rng);
            let phrase_id = draw % (ctx.phrase_count as u32);
            slot_set(buf, NPC_SLOT_SPEECH_VISIBLE, 1.0);
            slot_set_u32(buf, NPC_SLOT_SPEECH_PHRASE_ID, phrase_id);
            slot_set(buf, NPC_SLOT_SPEECH_TIMER_S, 0.0);
            slot_set(buf, NPC_SLOT_SPEECH_WINDOW_S, NPC_SPEECH_WINDOW_S);
            slot_set(buf, NPC_SLOT_PHRASE_TIMER_S, 0.0);
            events |= NPC_EVENT_SPEECH_TRIGGERED;
        }
    }
    // Clear all command flags regardless of outcome.
    slot_set_u32(buf, NPC_SLOT_CMD_FLAGS, 0);

    // Short path: after commands, mark done and return before movement,
    // fade, or speech so a RESET this tick is observable.
    if path_too_short {
        slot_set(buf, NPC_SLOT_DONE, 1.0);
        slot_set(buf, NPC_SLOT_OPACITY_TARGET, 0.0);
        events |= NPC_EVENT_PATH_FINISHED;
        return events;
    }

    // Step 6: pause countdown before movement.
    let mut state = slot_get(buf, NPC_SLOT_STATE);
    if state == NPC_STATE_PAUSED {
        let remaining = slot_get(buf, NPC_SLOT_PAUSE_REMAINING_S);
        if remaining.is_finite() {
            let next = remaining - dt_s;
            if next <= 0.0 {
                slot_set(buf, NPC_SLOT_PAUSE_REMAINING_S, 0.0);
                slot_set(buf, NPC_SLOT_STATE, NPC_STATE_WALKING);
                state = NPC_STATE_WALKING;
                events |= NPC_EVENT_RESUMED;
            } else {
                slot_set(buf, NPC_SLOT_PAUSE_REMAINING_S, next);
            }
        }
    }

    // Step 6: movement. A RESET this tick leaves the NPC at path[0] without
    // advancing, so the caller observes a clean slate.
    let done = slot_get(buf, NPC_SLOT_DONE) > 0.5;
    let mut finished_this_tick = false;
    if !done && !did_reset && state != NPC_STATE_PAUSED && !path_too_short {
        let speed_scale = slot_get(buf, NPC_SLOT_SPEED_SCALE);
        let base_speed = if state == NPC_STATE_RUNNING {
            NPC_RUN_SPEED_PX_S
        } else {
            NPC_WALK_SPEED_PX_S
        };
        let speed = base_speed * speed_scale;
        let distance = speed * dt_s;

        let mut seg_index = slot_get(buf, NPC_SLOT_SEGMENT_INDEX) as usize;
        let mut seg_t = slot_get(buf, NPC_SLOT_SEGMENT_T);
        let last_seg_index = path.len() - 2;

        if seg_index > last_seg_index {
            seg_index = last_seg_index;
        }

        let mut seg_len = {
            let dx = path[seg_index + 1].x - path[seg_index].x;
            let dy = path[seg_index + 1].y - path[seg_index].y;
            dx.hypot(dy).max(0.001)
        };
        seg_t += distance / seg_len;

        // Cascade across segments, converting overshoot into the next
        // segment's parameter space using the ratio of segment lengths.
        while seg_t >= 1.0 && seg_index < last_seg_index {
            let old_len = seg_len;
            seg_index += 1;
            seg_len = {
                let dx = path[seg_index + 1].x - path[seg_index].x;
                let dy = path[seg_index + 1].y - path[seg_index].y;
                dx.hypot(dy).max(0.001)
            };
            seg_t = (seg_t - 1.0) * old_len / seg_len;
        }

        let (prev_x, prev_y) = (path[seg_index].x, path[seg_index].y);
        let (next_x, next_y) = (path[seg_index + 1].x, path[seg_index + 1].y);

        if seg_index == last_seg_index && seg_t >= 1.0 {
            // Path finished.
            slot_set(buf, NPC_SLOT_X, next_x);
            slot_set(buf, NPC_SLOT_Y, next_y);
            slot_set(buf, NPC_SLOT_SEGMENT_INDEX, seg_index as f32);
            slot_set(buf, NPC_SLOT_SEGMENT_T, 1.0);
            let heading = (next_y - prev_y).atan2(next_x - prev_x);
            slot_set(buf, NPC_SLOT_HEADING_RAD, heading);
            let elapsed = slot_get(buf, NPC_SLOT_ELAPSED_S) + dt_s;
            slot_set(buf, NPC_SLOT_ELAPSED_S, elapsed);
            slot_set(buf, NPC_SLOT_DONE, 1.0);
            slot_set(buf, NPC_SLOT_IS_FINISHED_STATE, 1.0);
            slot_set(buf, NPC_SLOT_FINISH_TIME_S, elapsed);
            slot_set(buf, NPC_SLOT_FADE_START_S, elapsed);
            slot_set(buf, NPC_SLOT_FADE_ELAPSED_S, 0.0);
            slot_set(buf, NPC_SLOT_FADE_COMPLETED, 0.0);
            slot_set(buf, NPC_SLOT_OPACITY_TARGET, 0.0);
            finished_this_tick = true;
            events |= NPC_EVENT_PATH_FINISHED | NPC_EVENT_FADE_STARTED;
        } else {
            let t = seg_t.clamp(0.0, 1.0);
            let x = lerp_f32(prev_x, next_x, t);
            let y = lerp_f32(prev_y, next_y, t);
            slot_set(buf, NPC_SLOT_X, x);
            slot_set(buf, NPC_SLOT_Y, y);
            slot_set(buf, NPC_SLOT_SEGMENT_INDEX, seg_index as f32);
            slot_set(buf, NPC_SLOT_SEGMENT_T, seg_t);
            let heading = (next_y - prev_y).atan2(next_x - prev_x);
            slot_set(buf, NPC_SLOT_HEADING_RAD, heading);
            let elapsed = slot_get(buf, NPC_SLOT_ELAPSED_S) + dt_s;
            slot_set(buf, NPC_SLOT_ELAPSED_S, elapsed);
        }
    }

    // Step 6: fade. The fade clock starts on the tick *after* the path
    // finishes, so a large finishing dt does not complete the fade instantly.
    if slot_get(buf, NPC_SLOT_IS_FINISHED_STATE) > 0.5 && !finished_this_tick {
        let fade_elapsed = slot_get(buf, NPC_SLOT_FADE_ELAPSED_S) + dt_s;
        slot_set(buf, NPC_SLOT_FADE_ELAPSED_S, fade_elapsed);
        let opacity = (1.0 - fade_elapsed / NPC_FADE_DURATION_S).clamp(0.0, 1.0);
        slot_set(buf, NPC_SLOT_OPACITY, opacity);
        if opacity <= 0.0 && slot_get(buf, NPC_SLOT_FADE_COMPLETED) <= 0.5 {
            slot_set(buf, NPC_SLOT_FADE_COMPLETED, 1.0);
            slot_set(buf, NPC_SLOT_DONE, 1.0);
            events |= NPC_EVENT_FADE_COMPLETED;
        }
    }

    // Step 6: speech.
    let phrase_count = ctx.phrase_count;
    let speech_visible = slot_get(buf, NPC_SLOT_SPEECH_VISIBLE) > 0.5;
    if speech_visible {
        let phrase_timer = slot_get(buf, NPC_SLOT_PHRASE_TIMER_S) + dt_s;
        slot_set(buf, NPC_SLOT_PHRASE_TIMER_S, phrase_timer);
        if phrase_timer >= NPC_SPEECH_WINDOW_S {
            slot_set(buf, NPC_SLOT_SPEECH_VISIBLE, 0.0);
            slot_set(buf, NPC_SLOT_PHRASE_TIMER_S, 0.0);
            slot_set(buf, NPC_SLOT_SPEECH_TIMER_S, 0.0);
            let mut rng = slot_get_bits(buf, NPC_SLOT_RNG_STATE);
            let jitter = mulberry32_f32(&mut rng);
            slot_set_bits(buf, NPC_SLOT_RNG_STATE, rng);
            let next_delay = NPC_SPEECH_BASE_DELAY_S + jitter * NPC_SPEECH_DELAY_JITTER_S;
            slot_set(buf, NPC_SLOT_NEXT_SPEECH_DELAY_S, next_delay);
            events |= NPC_EVENT_SPEECH_HIDDEN;
        }
    } else {
        let speech_timer = slot_get(buf, NPC_SLOT_SPEECH_TIMER_S) + dt_s;
        slot_set(buf, NPC_SLOT_SPEECH_TIMER_S, speech_timer);
        let next_delay = slot_get(buf, NPC_SLOT_NEXT_SPEECH_DELAY_S);
        if speech_timer >= next_delay {
            if phrase_count == 0 {
                // Back off so we do not spam CMD_REJECTED every frame.
                slot_set(buf, NPC_SLOT_SPEECH_TIMER_S, 0.0);
                slot_set(buf, NPC_SLOT_NEXT_SPEECH_DELAY_S, NPC_SPEECH_BASE_DELAY_S);
                events |= NPC_EVENT_CMD_REJECTED;
            } else {
                let mut rng = slot_get_bits(buf, NPC_SLOT_RNG_STATE);
                let draw = mulberry32_next(&mut rng);
                slot_set_bits(buf, NPC_SLOT_RNG_STATE, rng);
                let phrase_id = draw % (phrase_count as u32);
                slot_set(buf, NPC_SLOT_SPEECH_VISIBLE, 1.0);
                slot_set_u32(buf, NPC_SLOT_SPEECH_PHRASE_ID, phrase_id);
                slot_set(buf, NPC_SLOT_SPEECH_TIMER_S, 0.0);
                slot_set(buf, NPC_SLOT_SPEECH_WINDOW_S, NPC_SPEECH_WINDOW_S);
                slot_set(buf, NPC_SLOT_PHRASE_TIMER_S, 0.0);
                events |= NPC_EVENT_SPEECH_TRIGGERED;
            }
        }
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_seconds_normalization() {
        assert_eq!(to_seconds(120.5), 120.5);
        assert_eq!(to_seconds(1700000000000.0), 1700000000.0);
    }

    #[test]
    fn test_sample_npc_state_progression() {
        let waypoints = vec![(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)];
        let speed = 20.0;
        let spawn = 100.0;

        // At spawn: x = 0, opacity fades in
        let s0 = sample_npc_state(&waypoints, speed, spawn, 100.0);
        assert_eq!(s0.x, 0.0);
        assert_eq!(s0.y, 0.0);
        assert!(!s0.finished);

        // At 2.5s: traveled 50px along segment 1
        let s1 = sample_npc_state(&waypoints, speed, spawn, 102.5);
        assert_eq!(s1.x, 50.0);
        assert_eq!(s1.y, 0.0);
        assert_eq!(s1.opacity, 1.0);

        // Past total distance (200px / 20 = 10s): finished
        let s2 = sample_npc_state(&waypoints, speed, spawn, 115.0);
        assert!(s2.finished);
        assert_eq!(s2.x, 100.0);
        assert_eq!(s2.y, 100.0);
    }

    #[test]
    fn test_sample_npc_corner_turn_smoothing() {
        let waypoints = vec![(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)];
        let speed = 20.0;
        let spawn = 0.0;
        // At 4.5s: traveled 90px. Segment length 100px. Distance to next is 10px (< 28px)
        let s = sample_npc_state(&waypoints, speed, spawn, 4.5);
        // Angle should be interpolated between 0.0 and PI/2
        assert!(s.angle > 0.0);
        assert!(s.angle < std::f64::consts::PI / 2.0);
    }

    #[test]
    fn test_sample_path_exact_straight_and_corner_blend() {
        // L-shaped path: east 100px then south 100px.
        let wp = [0.0, 0.0, 100.0, 0.0, 100.0, 100.0];
        let s = sample_path_exact(&wp, 20.0, 50.0);
        assert!((s.x - 50.0).abs() < 1e-9 && s.y.abs() < 1e-9);
        assert!(s.has_angle && s.angle.abs() < 1e-9);
        assert!((s.vx - 20.0).abs() < 1e-9 && s.vy.abs() < 1e-9);
        // 10px before the corner => blended angle between 0 and pi/2 (bounded by half).
        let s = sample_path_exact(&wp, 20.0, 90.0);
        assert!(s.angle > 0.0 && s.angle <= std::f64::consts::FRAC_PI_4 + 1e-9);
        // Velocity follows the *segment* direction (JS semantics), not the blended angle.
        assert!((s.vx - 20.0).abs() < 1e-9 && s.vy.abs() < 1e-9);
        // Second segment heads south.
        let s = sample_path_exact(&wp, 20.0, 150.0);
        assert!((s.x - 100.0).abs() < 1e-9 && (s.y - 50.0).abs() < 1e-9);
        assert!((s.angle - std::f64::consts::FRAC_PI_2).abs() < 1e-9);
    }

    #[test]
    fn test_sample_path_exact_degenerate_segment_keeps_angle_unset() {
        let wp = [10.0, 10.0, 10.0, 10.0];
        let s = sample_path_exact(&wp, 20.0, 0.0);
        assert!(!s.has_angle);
        assert_eq!((s.vx, s.vy), (0.0, 0.0));
    }

    // -----------------------------------------------------------------------
    // step_npc_buffer tests (unification-048)
    // -----------------------------------------------------------------------

    fn make_buf(seed: u32) -> NpcSimBuffer {
        let mut buf = NpcSimBuffer::default();
        slot_set_bits(&mut buf, NPC_SLOT_SEED, seed);
        slot_set_bits(&mut buf, NPC_SLOT_RNG_STATE, seed);
        slot_set(&mut buf, NPC_SLOT_SPEED_SCALE, 1.0);
        slot_set(&mut buf, NPC_SLOT_OPACITY, 1.0);
        slot_set(&mut buf, NPC_SLOT_OPACITY_TARGET, 1.0);
        slot_set(&mut buf, NPC_SLOT_NEXT_SPEECH_DELAY_S, NPC_SPEECH_BASE_DELAY_S);
        buf
    }

    fn ctx(phrase_count: u16) -> NpcStepContext {
        NpcStepContext { owner_x: 0.0, owner_y: 0.0, phrase_count }
    }

    fn straight_path() -> [NpcPathPoint; 2] {
        [NpcPathPoint { x: 0.0, y: 0.0 }, NpcPathPoint { x: 100.0, y: 0.0 }]
    }

    #[test]
    fn test_step_npc_buffer_rejects_invalid_dt() {
        let mut buf = make_buf(1);
        let path = straight_path();
        let before = buf.data;
        assert_eq!(step_npc_buffer(&mut buf, &path, &ctx(1), 0.0), NPC_EVENT_CMD_REJECTED);
        assert_eq!(buf.data, before);
        assert_eq!(step_npc_buffer(&mut buf, &path, &ctx(1), f32::NAN), NPC_EVENT_CMD_REJECTED);
        assert_eq!(buf.data, before);
    }

    #[test]
    fn test_step_npc_buffer_short_path_finishes() {
        let mut buf = make_buf(1);
        let path = [NpcPathPoint { x: 5.0, y: 5.0 }];
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 0.016);
        assert!(events & NPC_EVENT_PATH_FINISHED != 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_DONE), 1.0);
        assert_eq!(slot_get(&buf, NPC_SLOT_OPACITY_TARGET), 0.0);
    }

    #[test]
    fn test_step_npc_buffer_reset() {
        let mut buf = make_buf(42);
        let path = straight_path();
        // Dirty the state.
        slot_set(&mut buf, NPC_SLOT_X, 99.0);
        slot_set(&mut buf, NPC_SLOT_STATE, NPC_STATE_RUNNING);
        slot_set(&mut buf, NPC_SLOT_OPACITY, 0.3);
        slot_set_bits(&mut buf, NPC_SLOT_RNG_STATE, 999);
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_RESET);

        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 0.016);
        assert!(events & NPC_EVENT_RESET != 0);
        assert_eq!(slot_get(&mut buf, NPC_SLOT_X), 0.0);
        assert_eq!(slot_get(&mut buf, NPC_SLOT_STATE), NPC_STATE_WALKING);
        assert_eq!(slot_get(&mut buf, NPC_SLOT_OPACITY), 1.0);
        assert_eq!(slot_get_bits(&mut buf, NPC_SLOT_RNG_STATE), 42);
        assert_eq!(slot_get_u32(&mut buf, NPC_SLOT_CMD_FLAGS), 0);
    }

    #[test]
    fn test_step_npc_buffer_walking_moves_and_turns() {
        let mut buf = make_buf(1);
        let path = [
            NpcPathPoint { x: 0.0, y: 0.0 },
            NpcPathPoint { x: 100.0, y: 0.0 },
            NpcPathPoint { x: 100.0, y: 100.0 },
        ];
        // Walk 1s at 40px/s => x = 40.
        step_npc_buffer(&mut buf, &path, &ctx(1), 1.0);
        assert!((slot_get(&buf, NPC_SLOT_X) - 40.0).abs() < 1e-3);
        assert!(slot_get(&buf, NPC_SLOT_Y).abs() < 1e-3);
        // Continue past the corner.
        step_npc_buffer(&mut buf, &path, &ctx(1), 2.0);
        // 3s total => 120px => 20px into second segment.
        assert!((slot_get(&buf, NPC_SLOT_X) - 100.0).abs() < 1e-3);
        assert!((slot_get(&buf, NPC_SLOT_Y) - 20.0).abs() < 1e-3);
        let heading = slot_get(&buf, NPC_SLOT_HEADING_RAD);
        assert!((heading - std::f32::consts::FRAC_PI_2).abs() < 1e-3);
    }

    #[test]
    fn test_step_npc_buffer_running_faster_than_walking() {
        let path = straight_path();
        let mut walk = make_buf(1);
        let mut run = make_buf(1);
        slot_set_u32(&mut run, NPC_SLOT_CMD_FLAGS, NPC_CMD_SET_RUNNING);
        step_npc_buffer(&mut walk, &path, &ctx(1), 0.5);
        step_npc_buffer(&mut run, &path, &ctx(1), 0.5);
        assert!(slot_get(&run, NPC_SLOT_X) > slot_get(&walk, NPC_SLOT_X));
    }

    #[test]
    fn test_step_npc_buffer_pause_and_resume() {
        let mut buf = make_buf(1);
        let path = straight_path();
        step_npc_buffer(&mut buf, &path, &ctx(1), 0.5);
        let x_before = slot_get(&buf, NPC_SLOT_X);
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_PAUSE);
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 0.5);
        assert!(events & NPC_EVENT_PAUSED != 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_X), x_before);
        // Still paused.
        step_npc_buffer(&mut buf, &path, &ctx(1), 0.5);
        assert_eq!(slot_get(&buf, NPC_SLOT_X), x_before);
        // Resume.
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_RESUME);
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 0.5);
        assert!(events & NPC_EVENT_RESUMED != 0);
        assert!(slot_get(&buf, NPC_SLOT_X) > x_before);
    }

    #[test]
    fn test_step_npc_buffer_path_finish_and_fade() {
        let mut buf = make_buf(1);
        let path = straight_path();
        // 100px at 40px/s => 2.5s. Step exactly to the end so the fade
        // starts but does not complete in the same tick.
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 2.5);
        assert!(events & NPC_EVENT_PATH_FINISHED != 0);
        assert!(events & NPC_EVENT_FADE_STARTED != 0);
        assert!(events & NPC_EVENT_FADE_COMPLETED == 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_X), 100.0);
        assert_eq!(slot_get(&buf, NPC_SLOT_IS_FINISHED_STATE), 1.0);

        // Step 0.5s to complete fade.
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 0.5);
        assert!(events & NPC_EVENT_FADE_COMPLETED != 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_OPACITY), 0.0);

        // Further steps must not re-emit FADE_COMPLETED.
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 0.5);
        assert!(events & NPC_EVENT_FADE_COMPLETED == 0);
    }

    #[test]
    fn test_step_npc_buffer_force_speech() {
        let mut buf = make_buf(7);
        let path = straight_path();
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_FORCE_SPEECH);
        let events = step_npc_buffer(&mut buf, &path, &ctx(5), 0.016);
        assert!(events & NPC_EVENT_SPEECH_TRIGGERED != 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_SPEECH_VISIBLE), 1.0);
        assert!(slot_get_u32(&buf, NPC_SLOT_SPEECH_PHRASE_ID) < 5);
    }

    #[test]
    fn test_step_npc_buffer_force_speech_no_phrases() {
        let mut buf = make_buf(7);
        let path = straight_path();
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_FORCE_SPEECH);
        let events = step_npc_buffer(&mut buf, &path, &ctx(0), 0.016);
        assert!(events & NPC_EVENT_CMD_REJECTED != 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_SPEECH_VISIBLE), 0.0);
    }

    #[test]
    fn test_step_npc_buffer_speech_determinism() {
        let path = straight_path();
        let mut a = make_buf(123);
        let mut b = make_buf(123);
        let mut seq_a = [0u32; 3];
        let mut seq_b = [0u32; 3];
        for i in 0..3 {
            slot_set_u32(&mut a, NPC_SLOT_CMD_FLAGS, NPC_CMD_FORCE_SPEECH);
            slot_set_u32(&mut b, NPC_SLOT_CMD_FLAGS, NPC_CMD_FORCE_SPEECH);
            step_npc_buffer(&mut a, &path, &ctx(10), 0.016);
            step_npc_buffer(&mut b, &path, &ctx(10), 0.016);
            seq_a[i] = slot_get_u32(&a, NPC_SLOT_SPEECH_PHRASE_ID);
            seq_b[i] = slot_get_u32(&b, NPC_SLOT_SPEECH_PHRASE_ID);
        }
        assert_eq!(seq_a, seq_b);
    }

    #[test]
    fn test_step_npc_buffer_speech_hide() {
        let mut buf = make_buf(7);
        let path = straight_path();
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_FORCE_SPEECH);
        step_npc_buffer(&mut buf, &path, &ctx(5), 0.016);
        assert_eq!(slot_get(&buf, NPC_SLOT_SPEECH_VISIBLE), 1.0);
        // Advance past the 4s window.
        let events = step_npc_buffer(&mut buf, &path, &ctx(5), 4.1);
        assert!(events & NPC_EVENT_SPEECH_HIDDEN != 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_SPEECH_VISIBLE), 0.0);
        let delay = slot_get(&buf, NPC_SLOT_NEXT_SPEECH_DELAY_S);
        assert!(delay >= 4.0 && delay <= 8.0);
    }

    #[test]
    fn test_step_npc_buffer_command_priority() {
        let mut buf = make_buf(1);
        let path = straight_path();
        slot_set(&mut buf, NPC_SLOT_X, 50.0);
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_RESET | NPC_CMD_FORCE_SPEECH);
        let events = step_npc_buffer(&mut buf, &path, &ctx(5), 0.016);
        assert!(events & NPC_EVENT_RESET != 0);
        assert!(events & NPC_EVENT_SPEECH_TRIGGERED == 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_X), 0.0);
        assert_eq!(slot_get_u32(&mut buf, NPC_SLOT_CMD_FLAGS), 0);
    }

    #[test]
    fn test_step_npc_buffer_numeric_cmd_flags_trigger_reset() {
        // A host writing 1.0 into CMD_FLAGS must trigger RESET (numeric encoding).
        let mut buf = make_buf(1);
        let path = straight_path();
        slot_set(&mut buf, NPC_SLOT_X, 77.0);
        buf.data[NPC_SLOT_CMD_FLAGS] = 1.0;
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 0.016);
        assert!(events & NPC_EVENT_RESET != 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_X), 0.0);
    }

    #[test]
    fn test_step_npc_buffer_unequal_segment_traversal() {
        // First segment 10px, second 100px. Walking 40px/s for 0.5s = 20px
        // should land 10px into the second segment (x=10, y=10).
        let mut buf = make_buf(1);
        let path = [
            NpcPathPoint { x: 0.0, y: 0.0 },
            NpcPathPoint { x: 10.0, y: 0.0 },
            NpcPathPoint { x: 10.0, y: 100.0 },
        ];
        step_npc_buffer(&mut buf, &path, &ctx(1), 0.5);
        assert!((slot_get(&buf, NPC_SLOT_X) - 10.0).abs() < 1e-3);
        assert!((slot_get(&buf, NPC_SLOT_Y) - 10.0).abs() < 1e-3);
    }

    #[test]
    fn test_step_npc_buffer_final_heading_on_vertical_path() {
        // Single vertical segment: heading must be +PI/2 on completion.
        let mut buf = make_buf(1);
        let path = [
            NpcPathPoint { x: 0.0, y: 0.0 },
            NpcPathPoint { x: 0.0, y: 100.0 },
        ];
        // 100px at 40px/s => 2.5s.
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 2.5);
        assert!(events & NPC_EVENT_PATH_FINISHED != 0);
        let heading = slot_get(&buf, NPC_SLOT_HEADING_RAD);
        assert!((heading - std::f32::consts::FRAC_PI_2).abs() < 1e-3);
    }

    #[test]
    fn test_step_npc_buffer_short_path_with_reset() {
        let mut buf = make_buf(1);
        let path = [NpcPathPoint { x: 5.0, y: 5.0 }];
        slot_set(&mut buf, NPC_SLOT_X, 99.0);
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_RESET);
        let events = step_npc_buffer(&mut buf, &path, &ctx(1), 0.016);
        assert!(events & NPC_EVENT_RESET != 0);
        assert!(events & NPC_EVENT_PATH_FINISHED != 0);
        assert_eq!(slot_get(&buf, NPC_SLOT_X), 5.0);
        assert_eq!(slot_get(&buf, NPC_SLOT_DONE), 1.0);
        assert_eq!(slot_get(&buf, NPC_SLOT_OPACITY_TARGET), 0.0);
    }

    #[test]
    fn test_step_npc_buffer_reset_restores_speed_scale() {
        let mut buf = make_buf(1);
        let path = straight_path();
        slot_set(&mut buf, NPC_SLOT_SPEED_SCALE, 0.25);
        slot_set_u32(&mut buf, NPC_SLOT_CMD_FLAGS, NPC_CMD_RESET);
        step_npc_buffer(&mut buf, &path, &ctx(1), 0.016);
        assert_eq!(slot_get(&buf, NPC_SLOT_SPEED_SCALE), 1.0);
    }

    #[test]
    fn test_step_npc_buffer_speech_backoff_when_no_phrases() {
        let mut buf = make_buf(1);
        let path = straight_path();
        // Force the auto-speech timer past its delay with zero phrases.
        slot_set(&mut buf, NPC_SLOT_SPEECH_TIMER_S, 100.0);
        slot_set(&mut buf, NPC_SLOT_NEXT_SPEECH_DELAY_S, 4.0);
        let events = step_npc_buffer(&mut buf, &path, &ctx(0), 0.016);
        assert!(events & NPC_EVENT_CMD_REJECTED != 0);
        // Timer must be reset so it does not spam every frame.
        assert_eq!(slot_get(&buf, NPC_SLOT_SPEECH_TIMER_S), 0.0);
        assert_eq!(slot_get(&buf, NPC_SLOT_NEXT_SPEECH_DELAY_S), NPC_SPEECH_BASE_DELAY_S);
    }

    #[test]
    fn test_mulberry32_next_matches_math_module() {
        // The buffer RNG must produce the exact same sequence as crate::math::Mulberry32.
        let mut state = 12345u32;
        let mut rng = Mulberry32::new(12345);
        for _ in 0..16 {
            let expected = (rng.next_f64() * 4294967296.0) as u32;
            let got = mulberry32_next(&mut state);
            assert_eq!(got, expected);
        }
    }

    #[test]
    fn test_slot_bits_roundtrip_preserves_full_32_bits() {
        let mut buf = NpcSimBuffer::default();
        for value in [0u32, 1, 0x00FF_FFFF, 0x0100_0000, 0xDEAD_BEEF, u32::MAX] {
            slot_set_bits(&mut buf, NPC_SLOT_PATH_HASH, value);
            assert_eq!(slot_get_bits(&buf, NPC_SLOT_PATH_HASH), value);
        }
    }

    #[test]
    fn test_step_npc_buffer_path_hash_exact() {
        let mut buf = make_buf(1);
        let path = straight_path();
        step_npc_buffer(&mut buf, &path, &ctx(1), 0.016);
        let expected = compute_path_hash(&path);
        assert_eq!(slot_get_bits(&buf, NPC_SLOT_PATH_HASH), expected);
    }

    #[test]
    fn test_sample_path_exact_exact_waypoint_boundary() {
        // L-shaped path: east 100px then south 100px.
        let wp = [0.0, 0.0, 100.0, 0.0, 100.0, 100.0];
        // Mid first segment: heading east.
        let s = sample_path_exact(&wp, 20.0, 50.0);
        assert!(s.angle.abs() < 1e-9);
        // Exactly at the corner: strict `>` advances to the outgoing segment.
        let s = sample_path_exact(&wp, 20.0, 100.0);
        assert!((s.x - 100.0).abs() < 1e-9 && s.y.abs() < 1e-9);
        assert!((s.angle - std::f64::consts::FRAC_PI_2).abs() < 1e-9);
    }
}
