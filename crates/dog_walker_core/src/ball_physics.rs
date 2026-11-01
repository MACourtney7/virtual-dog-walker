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
}
