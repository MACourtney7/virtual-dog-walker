pub mod ball_physics;
pub mod collision;
pub mod dog_physics;
pub mod math;
pub mod npc_sim;

use ball_physics::{step_toy_ball, BallSim};
use collision::{resolve_entity_collisions, resolve_field_collisions, Collider, WorldObstacle};
use dog_physics::{step_ear_springs, step_ear_springs_to_targets, step_leash_constraint};
use npc_sim::{sample_npc_state, sample_path_exact};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmWorldSim {
    ball: BallSim,
    colliders: Vec<Collider>,
    obstacles: Vec<WorldObstacle>,
    world_width: f64,
    world_height: f64,
}

#[wasm_bindgen]
impl WasmWorldSim {
    #[wasm_bindgen(constructor)]
    pub fn new(world_width: f64, world_height: f64) -> Self {
        Self {
            ball: BallSim::new(),
            colliders: Vec::new(),
            obstacles: Vec::new(),
            world_width,
            world_height,
        }
    }

    pub fn set_colliders(&mut self, colliders_json: &str) {
        if let Ok(c) = serde_json::from_str::<Vec<Collider>>(colliders_json) {
            self.colliders = c;
        }
    }

    pub fn resolve_collision(&self, x: f64, y: f64, radius: f64) -> Vec<f64> {
        let mut curr_x = x;
        let mut curr_y = y;
        resolve_entity_collisions(
            &mut curr_x,
            &mut curr_y,
            radius,
            self.world_width,
            self.world_height,
            &self.colliders,
        );
        vec![curr_x, curr_y]
    }

    pub fn step_leash(
        &self,
        dog_x: f64,
        dog_y: f64,
        dog_vx: f64,
        dog_vy: f64,
        owner_x: f64,
        owner_y: f64,
        max_length: f64,
        stiffness: f64,
        damping: f64,
        dt: f64,
    ) -> Vec<f64> {
        let mut d_x = dog_x;
        let mut d_y = dog_y;
        let mut d_vx = dog_vx;
        let mut d_vy = dog_vy;
        let constrained = step_leash_constraint(
            &mut d_x,
            &mut d_y,
            &mut d_vx,
            &mut d_vy,
            owner_x,
            owner_y,
            max_length,
            stiffness,
            damping,
            dt,
        );
        vec![d_x, d_y, d_vx, d_vy, if constrained { 1.0 } else { 0.0 }]
    }

    pub fn step_ears(
        &self,
        left_angle: f64,
        left_v: f64,
        right_angle: f64,
        right_v: f64,
        dog_vx: f64,
        dog_vy: f64,
        dog_angle: f64,
        dt: f64,
    ) -> Vec<f64> {
        let mut l_ang = left_angle;
        let mut l_vel = left_v;
        let mut r_ang = right_angle;
        let mut r_vel = right_v;
        step_ear_springs(&mut l_ang, &mut l_vel, &mut r_ang, &mut r_vel, dog_vx, dog_vy, dog_angle, dt);
        vec![l_ang, l_vel, r_ang, r_vel]
    }

    pub fn throw_ball(&mut self, start_x: f64, start_y: f64, target_x: f64, target_y: f64, power: f64) {
        self.ball.throw_toward(start_x, start_y, target_x, target_y, power);
    }

    pub fn step_ball(&mut self, dt: f64) -> Vec<f64> {
        let bounced = self.ball.step(dt, self.world_width, self.world_height, &self.colliders);
        let s = &self.ball.state;
        vec![
            s.x,
            s.y,
            s.z,
            s.vx,
            s.vy,
            s.vz,
            if s.is_moving { 1.0 } else { 0.0 },
            if bounced { 1.0 } else { 0.0 },
            s.bounce_count as f64,
        ]
    }

    /// Stateless TennisBall step (matches `toy.js`). `state` = [x, y, z, vx, vy, vz].
    /// Returns [x, y, z, vx, vy, vz]. Independent of the single internal `ball`.
    pub fn step_toy_ball(
        &self,
        x: f64,
        y: f64,
        z: f64,
        vx: f64,
        vy: f64,
        vz: f64,
        dt: f64,
        world_w: f64,
        world_h: f64,
    ) -> Vec<f64> {
        step_toy_ball([x, y, z, vx, vy, vz], dt, world_w, world_h).to_vec()
    }

    /// Replace the exact field obstacle set (JSON array of
    /// `{"kind":"circle","x","y","r"}` / `{"kind":"rect","x","y","hw","hh"}`), in the same order as
    /// `Field.resolveCircleCollision` applies them.
    pub fn set_world_obstacles(&mut self, obstacles_json: &str) -> bool {
        match serde_json::from_str::<Vec<WorldObstacle>>(obstacles_json) {
            Ok(o) => {
                self.obstacles = o;
                true
            }
            Err(_) => false,
        }
    }

    /// Exact port of `Field.resolveCircleCollision` (56px perimeter, trees/benches/bins/tower/rocks).
    pub fn resolve_field_collision(&self, x: f64, y: f64, radius: f64) -> Vec<f64> {
        let (nx, ny) = resolve_field_collisions(x, y, radius, self.world_width, self.world_height, &self.obstacles);
        vec![nx, ny]
    }

    /// Ear spring integration towards JS-computed targets. Returns [lAngle, lVel, rAngle, rVel].
    pub fn step_ear_targets(
        &self,
        left_angle: f64,
        left_v: f64,
        right_angle: f64,
        right_v: f64,
        target_left: f64,
        target_right: f64,
        spring_k: f64,
        spring_damp: f64,
        dt: f64,
    ) -> Vec<f64> {
        let (mut la, mut lv, mut ra, mut rv) = (left_angle, left_v, right_angle, right_v);
        step_ear_springs_to_targets(&mut la, &mut lv, &mut ra, &mut rv, target_left, target_right, spring_k, spring_damp, dt);
        vec![la, lv, ra, rv]
    }

    /// Exact in-progress NPC path sample (see `npc_sim::sample_path_exact`).
    /// Returns [x, y, vx, vy, angle, hasAngle(0/1)].
    pub fn sample_npc_path(&self, waypoints_flat: &[f64], speed: f64, distance: f64) -> Vec<f64> {
        let s = sample_path_exact(waypoints_flat, speed, distance);
        vec![s.x, s.y, s.vx, s.vy, s.angle, if s.has_angle { 1.0 } else { 0.0 }]
    }

    pub fn sample_npc(
        &self,
        waypoints_flat: &[f64],
        speed: f64,
        spawn_time: f64,
        now: f64,
    ) -> Vec<f64> {
        let mut waypoints = Vec::with_capacity(waypoints_flat.len() / 2);
        for chunk in waypoints_flat.chunks_exact(2) {
            waypoints.push((chunk[0], chunk[1]));
        }

        let s = sample_npc_state(&waypoints, speed, spawn_time, now);
        vec![
            s.x,
            s.y,
            s.vx,
            s.vy,
            s.angle,
            s.walk_phase,
            s.opacity,
            if s.finished { 1.0 } else { 0.0 },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wasm_world_sim_lifecycle() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        let res = sim.resolve_collision(10.0, 10.0, 16.0);
        assert_eq!(res[0], 52.0);
        assert_eq!(res[1], 52.0);

        sim.throw_ball(100.0, 100.0, 300.0, 100.0, 0.7);
        let ball_out = sim.step_ball(0.016);
        assert_eq!(ball_out.len(), 9);
        assert_eq!(ball_out[6], 1.0); // is_moving == true
    }
}
