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

/// Obstacle kinds mirroring `Field.resolveCircleCollision` in `src/world/field.js` exactly
/// (trees, oriented-AABB benches, bins, water tower, rock outcrops, in that order).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WorldObstacle {
    Circle { x: f64, y: f64, r: f64 },
    Rect { x: f64, y: f64, hw: f64, hh: f64 },
}

pub const FIELD_WORLD_MARGIN: f64 = 56.0;

fn push_out_circle(nx: &mut f64, ny: &mut f64, cx: f64, cy: f64, min_dist: f64) {
    let dx = *nx - cx;
    let dy = *ny - cy;
    let dist = dx.hypot(dy);
    if dist < min_dist {
        if dist > 0.001 {
            let overlap = min_dist - dist;
            *nx += (dx / dist) * overlap;
            *ny += (dy / dist) * overlap;
        } else {
            *ny += min_dist;
        }
    }
}

/// Exact port of `Field.resolveCircleCollision`: a single perimeter clamp (56px) followed by
/// sequential obstacle push-outs. No post-clamp (matches JS behaviour).
pub fn resolve_field_collisions(
    x: f64,
    y: f64,
    radius: f64,
    world_w: f64,
    world_h: f64,
    obstacles: &[WorldObstacle],
) -> (f64, f64) {
    let min_x = FIELD_WORLD_MARGIN + radius;
    let max_x = world_w - FIELD_WORLD_MARGIN - radius;
    let min_y = FIELD_WORLD_MARGIN + radius;
    let max_y = world_h - FIELD_WORLD_MARGIN - radius;
    let mut nx = x.max(min_x).min(max_x);
    let mut ny = y.max(min_y).min(max_y);

    for ob in obstacles {
        match *ob {
            WorldObstacle::Circle { x: cx, y: cy, r } => {
                push_out_circle(&mut nx, &mut ny, cx, cy, radius + r);
            }
            WorldObstacle::Rect { x: bx, y: by, hw, hh } => {
                let closest_x = (bx - hw).max(nx.min(bx + hw));
                let closest_y = (by - hh).max(ny.min(by + hh));
                let dx = nx - closest_x;
                let dy = ny - closest_y;
                let dist = dx.hypot(dy);
                if dist < radius {
                    if dist > 0.001 {
                        let overlap = radius - dist;
                        nx += (dx / dist) * overlap;
                        ny += (dy / dist) * overlap;
                    } else {
                        ny += radius;
                    }
                }
            }
        }
    }
    (nx, ny)
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

    #[test]
    fn test_field_collision_matches_js_margin_and_circle() {
        // 56px perimeter margin (not 36), single clamp.
        let (x, y) = resolve_field_collisions(10.0, 10.0, 16.0, 3200.0, 2400.0, &[]);
        assert_eq!((x, y), (72.0, 72.0));
        let obs = [WorldObstacle::Circle { x: 500.0, y: 500.0, r: 20.0 }];
        let (x, y) = resolve_field_collisions(510.0, 500.0, 10.0, 3200.0, 2400.0, &obs);
        assert!((x - 530.0).abs() < 1e-9 && (y - 500.0).abs() < 1e-9);
        // Exactly-overlapping centre pushes along +y by minDist (JS else-branch).
        let (_, y) = resolve_field_collisions(500.0, 500.0, 10.0, 3200.0, 2400.0, &obs);
        assert!((y - 530.0).abs() < 1e-9);
    }

    #[test]
    fn test_field_collision_rect_bench_closest_point() {
        let obs = [WorldObstacle::Rect { x: 1000.0, y: 1000.0, hw: 30.0, hh: 10.0 }];
        // Circle (r=8) touching top edge from above-center: pushed up out of the rect.
        let (x, y) = resolve_field_collisions(1000.0, 1000.0 - 10.0 - 3.0, 8.0, 3200.0, 2400.0, &obs);
        assert!((x - 1000.0).abs() < 1e-9);
        assert!((y - (1000.0 - 10.0 - 8.0)).abs() < 1e-9);
        // Centre inside rect (dist == 0) pushes +y by radius.
        let (_, y2) = resolve_field_collisions(1000.0, 1000.0, 8.0, 3200.0, 2400.0, &obs);
        assert!((y2 - 1008.0).abs() < 1e-9);
    }

    #[test]
    fn test_world_obstacle_json_roundtrip() {
        let json = r#"[{"kind":"circle","x":1.0,"y":2.0,"r":3.0},{"kind":"rect","x":4.0,"y":5.0,"hw":6.0,"hh":7.0}]"#;
        let v: Vec<WorldObstacle> = serde_json::from_str(json).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[1], WorldObstacle::Rect { x: 4.0, y: 5.0, hw: 6.0, hh: 7.0 });
    }
}
