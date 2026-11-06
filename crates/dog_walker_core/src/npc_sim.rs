use crate::math::lerp_angle;
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

    // Compute segment cumulative distances
    let mut cum_dist = Vec::with_capacity(waypoints.len());
    cum_dist.push(0.0);
    for i in 0..waypoints.len() - 1 {
        let dx = waypoints[i + 1].0 - waypoints[i].0;
        let dy = waypoints[i + 1].1 - waypoints[i].1;
        let d = dx.hypot(dy);
        cum_dist.push(cum_dist.last().unwrap() + d);
    }
    let total_len = *cum_dist.last().unwrap();
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

    // Find active segment
    let mut seg_idx = 0;
    while seg_idx < cum_dist.len() - 2 && cum_dist[seg_idx + 1] <= distance {
        seg_idx += 1;
    }

    let p0 = waypoints[seg_idx];
    let p1 = waypoints[seg_idx + 1];
    let seg_len = (cum_dist[seg_idx + 1] - cum_dist[seg_idx]).max(1e-6);
    let seg_dist = distance - cum_dist[seg_idx];
    let frac = (seg_dist / seg_len).clamp(0.0, 1.0);

    let x = p0.0 + (p1.0 - p0.0) * frac;
    let y = p0.1 + (p1.1 - p0.1) * frac;
    let seg_angle = (p1.1 - p0.1).atan2(p1.0 - p0.0);

    // Smooth turning within 28px of waypoint junction
    let turn_window = 28.0;
    let dist_to_next = seg_len - seg_dist;
    let angle = if dist_to_next < turn_window && seg_idx + 2 < waypoints.len() {
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
        x,
        y,
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
    let wp = |i: usize| (waypoints_flat[2 * i], waypoints_flat[2 * i + 1]);
    if n < 2 {
        let (x, y) = if n == 1 { wp(0) } else { (0.0, 0.0) };
        return PathSample { x, y, vx: 0.0, vy: 0.0, angle: 0.0, has_angle: false };
    }
    let seg_count = n - 1;
    let mut seg_len_v = Vec::with_capacity(seg_count);
    for i in 0..seg_count {
        let (ax, ay) = wp(i);
        let (bx, by) = wp(i + 1);
        seg_len_v.push((bx - ax).hypot(by - ay));
    }

    let mut accumulated = 0.0;
    let mut interpolated = false;
    let (mut x, mut y) = wp(0);
    let (mut dx, mut dy) = (0.0, 0.0);
    let mut seg_len = 0.0;
    let mut active_index: isize = -1;
    let mut active_remaining = 0.0;

    for i in 0..seg_count {
        seg_len = seg_len_v[i];
        if accumulated + seg_len >= distance {
            let remaining = distance - accumulated;
            let seg_t = if seg_len > 0.000001 { remaining / seg_len } else { 0.0 };
            let (p1x, p1y) = wp(i);
            let (p2x, p2y) = wp(i + 1);
            dx = p2x - p1x;
            dy = p2y - p1y;
            x = p1x + dx * seg_t;
            y = p1y + dy * seg_t;
            interpolated = true;
            active_index = i as isize;
            active_remaining = remaining;
            break;
        }
        accumulated += seg_len;
    }

    if !interpolated {
        let last_idx = n - 2;
        let (p1x, p1y) = wp(last_idx);
        let (p2x, p2y) = wp(last_idx + 1);
        dx = p2x - p1x;
        dy = p2y - p1y;
        seg_len = seg_len_v[last_idx];
        x = p2x;
        y = p2y;
        active_index = last_idx as isize;
        active_remaining = seg_len;
    }

    let mut angle = 0.0;
    let mut has_angle = false;
    if dx.hypot(dy) > 0.000001 {
        let seg_angle = dy.atan2(dx);
        let dist_to_next = seg_len - active_remaining;
        if active_index >= 0 && (active_index as usize) + 1 < seg_count && dist_to_next < 25.0 {
            let ai = active_index as usize;
            let (n1x, n1y) = wp(ai + 1);
            let (n2x, n2y) = wp(ai + 2);
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

    let (vx, vy) = if seg_len > 0.000001 {
        ((dx / seg_len) * speed, (dy / seg_len) * speed)
    } else {
        (0.0, 0.0)
    };
    PathSample { x, y, vx, vy, angle, has_angle }
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
}
