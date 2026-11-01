use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Collider {
    pub x: f64,
    pub y: f64,
    pub r: f64,
}

pub fn clamp_world_bounds(x: &mut f64, y: &mut f64, radius: f64, world_w: f64, world_h: f64, margin: f64) {
    let min_x = margin + radius;
    let max_x = world_w - margin - radius;
    let min_y = margin + radius;
    let max_y = world_h - margin - radius;

    if *x < min_x {
        *x = min_x;
    } else if *x > max_x {
        *x = max_x;
    }

    if *y < min_y {
        *y = min_y;
    } else if *y > max_y {
        *y = max_y;
    }
}

pub fn resolve_entity_collisions(
    x: &mut f64,
    y: &mut f64,
    radius: f64,
    world_w: f64,
    world_h: f64,
    colliders: &[Collider],
) {
    clamp_world_bounds(x, y, radius, world_w, world_h, 36.0);

    for c in colliders {
        let dx = *x - c.x;
        let dy = *y - c.y;
        let dist = dx.hypot(dy);
        let min_dist = radius + c.r;

        if dist < min_dist && dist > 1e-6 {
            let overlap = min_dist - dist;
            let nx = dx / dist;
            let ny = dy / dist;
            *x += nx * overlap;
            *y += ny * overlap;
        } else if dist <= 1e-6 {
            *x += min_dist;
        }
    }

    clamp_world_bounds(x, y, radius, world_w, world_h, 36.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_world_boundary_clamping() {
        let mut x = 10.0;
        let mut y = 2000.0;
        clamp_world_bounds(&mut x, &mut y, 16.0, 1000.0, 1000.0, 36.0);
        assert_eq!(x, 52.0); // 36 + 16
        assert_eq!(y, 948.0); // 1000 - 36 - 16
    }

    #[test]
    fn test_circle_obstacle_pushout() {
        let mut x = 100.0;
        let mut y = 100.0;
        let colliders = vec![Collider { x: 110.0, y: 100.0, r: 20.0 }];
        // radius = 10.0. Min dist = 30.0. Current dist = 10.0 along -X. Overlap = 20.0
        resolve_entity_collisions(&mut x, &mut y, 10.0, 1000.0, 1000.0, &colliders);
        assert!((x - 80.0).abs() < 1e-4);
        assert!((y - 100.0).abs() < 1e-4);
    }

    #[test]
    fn test_multiple_colliders_resolution() {
        let mut x = 100.0;
        let mut y = 100.0;
        let colliders = vec![
            Collider { x: 95.0, y: 100.0, r: 10.0 },
            Collider { x: 100.0, y: 95.0, r: 10.0 },
        ];
        resolve_entity_collisions(&mut x, &mut y, 8.0, 1000.0, 1000.0, &colliders);
        // Entity should be pushed away from both colliders
        assert!(x > 100.0);
        assert!(y > 100.0);
    }
}
