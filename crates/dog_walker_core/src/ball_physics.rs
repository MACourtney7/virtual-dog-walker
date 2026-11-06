use crate::collision::Collider;
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

/// Stateless 2.5D tennis-ball integration step (one ball per call; safe for any number of
/// local/remote balls). Returns `[x, y, z, vx, vy, vz]`.
pub fn step_toy_ball(
    state: [f64; 6],
    dt: f64,
    world_w: f64,
    world_h: f64,
) -> [f64; 6] {
    let [mut x, mut y, mut z, mut vx, mut vy, mut vz] = state;

    x += vx * dt;
    y += vy * dt;
    vz -= TOY_GRAVITY * dt;
    z += vz * dt;

    if z <= 0.0 {
        z = 0.0;
        if vz.abs() > TOY_BOUNCE_THRESHOLD {
            vz = -vz * TOY_RESTITUTION;
            vx *= TOY_BOUNCE_TANGENT_DAMPING;
            vy *= TOY_BOUNCE_TANGENT_DAMPING;
        } else {
            vz = 0.0;
            let f = TOY_FRICTION.powf(dt * 60.0);
            vx *= f;
            vy *= f;
        }
    }

    let min_x = TOY_BOUNDARY_MARGIN;
    let max_x = world_w - TOY_BOUNDARY_MARGIN;
    let min_y = TOY_BOUNDARY_MARGIN;
    let max_y = world_h - TOY_BOUNDARY_MARGIN;
    if x < min_x {
        x = min_x;
        vx = -vx * TOY_BOUNDARY_DAMPING;
    }
    if x > max_x {
        x = max_x;
        vx = -vx * TOY_BOUNDARY_DAMPING;
    }
    if y < min_y {
        y = min_y;
        vy = -vy * TOY_BOUNDARY_DAMPING;
    }
    if y > max_y {
        y = max_y;
        vy = -vy * TOY_BOUNDARY_DAMPING;
    }

    [x, y, z, vx, vy, vz]
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
        let mut st = [500.0, 500.0, 0.0, 100.0, 0.0, 0.0];
        let v0 = st[3];
        st = step_toy_ball(st, 1.0 / 60.0, 3200.0, 2400.0);
        assert!(st[3] < v0 && st[3] > 0.0);
        assert!((st[3] - v0 * TOY_FRICTION).abs() < 1e-9);
    }

    #[test]
    fn test_toy_ball_world_boundary_bounce() {
        let st = step_toy_ball([71.0, 500.0, 0.0, -300.0, 0.0, 0.0], 1.0 / 60.0, 3200.0, 2400.0);
        assert_eq!(st[0], 70.0);
        assert!(st[3] > 0.0);
        let st = step_toy_ball([500.0, 2400.0 - 71.0, 0.0, 0.0, 300.0, 0.0], 1.0 / 60.0, 3200.0, 2400.0);
        assert_eq!(st[1], 2400.0 - 70.0);
        assert!(st[4] < 0.0);
    }

    #[test]
    fn test_toy_ball_is_stateless_and_independent() {
        let a = step_toy_ball([100.0, 100.0, 50.0, 10.0, 20.0, 0.0], 0.016, 3200.0, 2400.0);
        let _ = step_toy_ball([900.0, 900.0, 5.0, -80.0, 40.0, 100.0], 0.016, 3200.0, 2400.0);
        let a2 = step_toy_ball([100.0, 100.0, 50.0, 10.0, 20.0, 0.0], 0.016, 3200.0, 2400.0);
        assert_eq!(a, a2);
    }
}
