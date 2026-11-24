pub mod ball_physics;
pub mod care_sim;
pub mod collision;
pub mod dog_contract;
pub mod dog_leash_needs;
pub mod dog_physics;
pub mod dog_utility_ai;
pub mod math;
pub mod npc_sim;
pub mod world_contract;

use ball_physics::{step_toy_ball, BallSim};

use collision::{resolve_entity_collisions, resolve_field_collisions, Collider, WorldObstacle};
use dog_contract::*;
use dog_physics::{step_ear_springs, step_ear_springs_to_targets, step_leash_constraint};
use npc_sim::{sample_npc_state, sample_path_exact};
use wasm_bindgen::prelude::*;
use world_contract::*;

/// Clamp an incoming dt to `[0.0, 0.1]`, mapping NaN/inf to `0.0`.
fn sanitize_dt(raw: f32) -> f32 {
    if raw.is_finite() {
        raw.clamp(0.0, 0.1)
    } else {
        0.0
    }
}

/// Map NaN/inf to `0.0`, otherwise pass the value through unchanged.
fn sanitize_f32(v: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        0.0
    }
}

fn slot_f32(buf: &DogSimBuffer, index: usize) -> f32 {
    buf.slots[index]
}

fn slot_bool(buf: &DogSimBuffer, index: usize) -> bool {
    slot_f32(buf, index) > 0.5
}

fn current_state_id(buf: &DogSimBuffer) -> u32 {
    slot_f32(buf, DOG_BUF_DOG_STATE_ID).round() as u32
}

/// Locked mapping from active utility id to the dog's discrete state id.
fn dog_state_for_utility(utility_id: u32) -> DogStateId {
    match utility_id {
        dog_utility_ai::UTIL_HEEL_FOLLOW => DogStateId::Heel,
        dog_utility_ai::UTIL_FETCH_BALL => DogStateId::Fetch,
        dog_utility_ai::UTIL_RECALL => DogStateId::Recall,
        dog_utility_ai::UTIL_ROAM_EXPLORE
        | dog_utility_ai::UTIL_SCOUT_AHEAD
        | dog_utility_ai::UTIL_LAG_AND_SNIFF
        | dog_utility_ai::UTIL_CHECK_IN => DogStateId::Roam,
        dog_utility_ai::UTIL_SOCIAL_GREET | dog_utility_ai::UTIL_PACK_PLAY => DogStateId::Social,
        dog_utility_ai::UTIL_ZOOMIES => DogStateId::Zoomies,
        dog_utility_ai::UTIL_AMBIENT_REST => DogStateId::Rest,
        dog_utility_ai::UTIL_BARK_IMPULSE => DogStateId::Bark,
        _ => DogStateId::Idle,
    }
}

#[wasm_bindgen]
pub struct WasmWorldSim {
    ball: BallSim,
    colliders: Vec<Collider>,
    obstacles: Vec<WorldObstacle>,
    world_width: f64,
    world_height: f64,
    dog_buffer: DogSimBuffer,
    owner_buffer: OwnerSimBuffer,
    care_buffer: CareSimBuffer,
    ball_buffer: BallSimBuffer,
    npc_buffers: [NpcSimBuffer; MAX_PARK_NPCS],
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
            dog_buffer: DogSimBuffer { slots: [0.0; DOG_SIM_BUFFER_LEN] },
            owner_buffer: OwnerSimBuffer::default(),
            care_buffer: CareSimBuffer::default(),
            ball_buffer: BallSimBuffer::default(),
            npc_buffers: std::array::from_fn(|_| NpcSimBuffer::default()),
        }
    }

    /// Pointer to the persistent zeroed dog simulation buffer (128 f32 slots).
    pub fn dog_buffer_ptr(&mut self) -> *mut f32 {
        self.dog_buffer.slots.as_mut_ptr()
    }

    /// Advance the persistent dog simulation buffer by one tick.
    ///
    /// Orchestrates need resolution, leash slot, utility AI, movement
    /// integration, and leash/owner constraints. The buffer is mutated in
    /// place; this path never returns a `Vec<f64>`.
    pub fn step_dog_buffer(&mut self) {
        // 1. Read and sanitize dt to [0.0, 0.1].
        let dt = sanitize_dt(slot_f32(&self.dog_buffer, DOG_BUF_DT));

        // 1b. Sanitize persisted dog state so NaN/inf never propagates.
        for index in [
            DOG_BUF_DOG_X,
            DOG_BUF_DOG_Y,
            DOG_BUF_DOG_VX,
            DOG_BUF_DOG_VY,
            DOG_BUF_DOG_ANGLE,
        ] {
            self.dog_buffer.slots[index] = sanitize_f32(self.dog_buffer.slots[index]);
        }

        // 2. Build the discrete combo from buffer inputs.
        let combo = DiscreteCombo {
            is_on_leash: slot_bool(&self.dog_buffer, DOG_BUF_IS_ON_LEASH),
            is_pooping: current_state_id(&self.dog_buffer) == DogStateId::Poop as u32,
            has_need: slot_bool(&self.dog_buffer, DOG_BUF_IS_HUNGRY)
                || slot_bool(&self.dog_buffer, DOG_BUF_NEEDS_GROOMING)
                || slot_bool(&self.dog_buffer, DOG_BUF_IS_TIRED),
            has_ball: slot_bool(&self.dog_buffer, DOG_BUF_BALL_ACTIVE),
        };

        // 3. Resolve discrete leash/need transitions.
        let decision = dog_leash_needs::resolve_discrete_combo(combo);

        // 4. Compute and write the leash slot from owner inputs.
        let leash_slot = dog_leash_needs::compute_leash_slot(
            sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_OWNER_X)),
            sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_OWNER_Y)),
            sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_OWNER_VX)),
            sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_OWNER_VY)),
            sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_OWNER_HEADING)),
            sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_OWNER_HALF_WIDTH)),
            sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_PREFERRED_SIDE_SIGN)),
        );
        dog_leash_needs::write_leash_slot(&mut self.dog_buffer, &leash_slot);

        // 5. Run the utility AI. It persists its own outputs (active utility,
        // submodes, gait, micro-expressions, events) and advances
        // DOG_BUF_RNG_SEED internally only when it consumes randomness.
        let util = dog_utility_ai::step_utility_ai(&mut self.dog_buffer, &self.obstacles, combo, dt);

        // 6. Resolve target state: forced states win, otherwise map utility -> state.
        let next_state = match decision.force_state {
            Some(state) => state,
            None => dog_state_for_utility(util.active_utility_id),
        };
        self.dog_buffer.slots[DOG_BUF_DOG_STATE_ID] = next_state as u32 as f32;

        // 7. Integrate movement from desired speed, multiplier, and steer.
        let speed = sanitize_f32((util.desired_speed * decision.speed_multiplier).max(0.0));
        let vx = sanitize_f32(util.steer_x * speed);
        let vy = sanitize_f32(util.steer_y * speed);

        let next_x = sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_DOG_X) + vx * dt);
        let next_y = sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_DOG_Y) + vy * dt);

        self.dog_buffer.slots[DOG_BUF_DOG_X] = next_x;
        self.dog_buffer.slots[DOG_BUF_DOG_Y] = next_y;
        self.dog_buffer.slots[DOG_BUF_DOG_VX] = vx;
        self.dog_buffer.slots[DOG_BUF_DOG_VY] = vy;

        if speed > 0.001 {
            self.dog_buffer.slots[DOG_BUF_DOG_ANGLE] = sanitize_f32(vy.atan2(vx));
        }

        // 8. Clamp final dog/owner positions against the leash constraint.
        self.dog_buffer.slots[DOG_BUF_OWNER_X] =
            sanitize_f32(self.dog_buffer.slots[DOG_BUF_OWNER_X]);
        self.dog_buffer.slots[DOG_BUF_OWNER_Y] =
            sanitize_f32(self.dog_buffer.slots[DOG_BUF_OWNER_Y]);
        dog_leash_needs::constrain_leash_and_owner(&mut self.dog_buffer, &decision);

        // 9. Persist the event bitmask from utility events only.
        self.dog_buffer.slots[DOG_BUF_EVENT_BITMASK] = util.events as f32;

        // 10. RNG policy: `step_utility_ai` already advances DOG_BUF_RNG_SEED
        // only when it requests randomness, so the orchestrator must not
        // advance it here.
    }

    /// Pointer to the persistent zeroed owner simulation buffer.
    pub fn owner_buffer_ptr(&mut self) -> *mut f32 {
        self.owner_buffer.data.as_mut_ptr()
    }

    /// Pointer to the persistent zeroed care simulation buffer.
    pub fn care_buffer_ptr(&mut self) -> *mut f32 {
        self.care_buffer.data.as_mut_ptr()
    }

    /// Pointer to the persistent zeroed ball simulation buffer.
    pub fn ball_buffer_ptr(&mut self) -> *mut f32 {
        self.ball_buffer.data.as_mut_ptr()
    }

    /// Pointer to the persistent zeroed NPC simulation buffer for `slot`.
    /// Returns null when `slot` is out of range.
    pub fn npc_buffer_ptr(&mut self, slot: u32) -> *mut f32 {
        if slot as usize >= MAX_PARK_NPCS {
            std::ptr::null_mut()
        } else {
            self.npc_buffers[slot as usize].data.as_mut_ptr()
        }
    }

    /// Contract stub: advance the owner buffer by one tick. Returns 0.
    pub fn step_owner_buffer(&mut self, _dt_s: f32) -> u32 {
        0
    }

    /// Contract stub: advance the care buffer by one tick. Returns 0.
    pub fn step_care_buffer(&mut self, _dt_ms: f32) -> u32 {
        0
    }

    /// Contract stub: advance the ball buffer by one tick. Returns 0.
    pub fn step_ball_buffer(&mut self, _dt_s: f32) -> u32 {
        0
    }

    /// Contract stub: advance the NPC buffer for `slot` by one tick. Returns 0.
    pub fn step_npc_buffer(&mut self, _slot: u32, _dt_s: f32) -> u32 {
        0
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

    #[test]
    fn world_core_contract_world_sim_pointers_and_stubs() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);

        assert!(!sim.owner_buffer_ptr().is_null(), "owner buffer ptr must be non-null");
        assert!(!sim.care_buffer_ptr().is_null(), "care buffer ptr must be non-null");
        assert!(!sim.ball_buffer_ptr().is_null(), "ball buffer ptr must be non-null");
        assert!(!sim.npc_buffer_ptr(0).is_null(), "npc 0 buffer ptr must be non-null");
        assert!(!sim.npc_buffer_ptr(7).is_null(), "npc 7 buffer ptr must be non-null");
        assert!(
            sim.npc_buffer_ptr(MAX_PARK_NPCS as u32).is_null(),
            "npc buffer ptr must be null when slot is out of range"
        );

        // Snapshot bytes before invoking stubs.
        let owner_before = sim.owner_buffer.data;
        let care_before = sim.care_buffer.data;
        let ball_before = sim.ball_buffer.data;
        let npc_before = sim.npc_buffers[0].data;

        assert_eq!(sim.step_owner_buffer(0.016), 0);
        assert_eq!(sim.step_care_buffer(16.0), 0);
        assert_eq!(sim.step_ball_buffer(0.016), 0);
        assert_eq!(sim.step_npc_buffer(0, 0.016), 0);

        assert_eq!(sim.owner_buffer.data, owner_before, "owner buffer must not mutate");
        assert_eq!(sim.care_buffer.data, care_before, "care buffer must not mutate");
        assert_eq!(sim.ball_buffer.data, ball_before, "ball buffer must not mutate");
        assert_eq!(sim.npc_buffers[0].data, npc_before, "npc buffer must not mutate");
    }

    #[test]
    fn dog_contract_buffer_ptr_is_non_null() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        assert!(!sim.dog_buffer_ptr().is_null());
    }

    #[test]
    fn dog_contract_new_zero_initializes_all_slots() {
        let sim = WasmWorldSim::new(2000.0, 2000.0);
        assert_eq!(sim.dog_buffer.slots.len(), DOG_SIM_BUFFER_LEN);
        for (index, slot) in sim.dog_buffer.slots.iter().enumerate() {
            assert_eq!(slot.to_bits(), 0, "slot {} must start zeroed", index);
        }
    }

    #[test]
    fn dog_contract_buffer_ptr_is_stable_across_calls() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        let first = sim.dog_buffer_ptr();
        let second = sim.dog_buffer_ptr();
        assert_eq!(first, second);

        sim.step_dog_buffer();
        let after_step = sim.dog_buffer_ptr();
        assert_eq!(first, after_step);

        let _ = sim.resolve_collision(10.0, 10.0, 16.0);
        let after_collision = sim.dog_buffer_ptr();
        assert_eq!(first, after_collision);
    }

    #[test]
    fn dog_contract_step_buffer_sanitizes_nan_and_inf_inputs() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        sim.dog_buffer.slots[DOG_BUF_DT] = 0.016;
        sim.dog_buffer.slots[DOG_BUF_DOG_X] = f32::NAN;
        sim.dog_buffer.slots[DOG_BUF_DOG_Y] = f32::INFINITY;
        sim.dog_buffer.slots[DOG_BUF_OWNER_X] = f32::NEG_INFINITY;

        sim.step_dog_buffer();

        for index in [
            DOG_BUF_DOG_X,
            DOG_BUF_DOG_Y,
            DOG_BUF_DOG_VX,
            DOG_BUF_DOG_VY,
            DOG_BUF_DOG_ANGLE,
            DOG_BUF_OWNER_X,
            DOG_BUF_OWNER_Y,
        ] {
            assert!(
                sim.dog_buffer.slots[index].is_finite(),
                "slot {} must be finite after sanitized step",
                index
            );
        }
    }

    #[test]
    fn dog_contract_step_buffer_preserves_angle_when_speed_is_zero() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        sim.dog_buffer.slots[DOG_BUF_DT] = 0.016;
        // Force the Poop state so the discrete combo yields zero speed.
        sim.dog_buffer.slots[DOG_BUF_DOG_STATE_ID] = DogStateId::Poop as u32 as f32;
        sim.dog_buffer.slots[DOG_BUF_IS_ON_LEASH] = 1.0;
        let sentinel_angle = 1.2345_f32;
        sim.dog_buffer.slots[DOG_BUF_DOG_ANGLE] = sentinel_angle;

        sim.step_dog_buffer();

        let vx = sim.dog_buffer.slots[DOG_BUF_DOG_VX];
        let vy = sim.dog_buffer.slots[DOG_BUF_DOG_VY];
        assert!(
            (vx * vx + vy * vy).sqrt() <= 0.001,
            "speed must be zero in the Poop state, got vx={}, vy={}",
            vx,
            vy
        );
        assert_eq!(
            sim.dog_buffer.slots[DOG_BUF_DOG_ANGLE].to_bits(),
            sentinel_angle.to_bits(),
            "angle must be preserved when speed <= 0.001"
        );
    }

    #[test]
    fn dog_contract_step_buffer_runs_and_keeps_outputs_finite() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        for (index, slot) in sim.dog_buffer.slots.iter_mut().enumerate() {
            *slot = if index % 2 == 0 {
                f32::from_bits(0x7fc0_0001 + index as u32)
            } else {
                -1.0 * (index as f32 + 1.0)
            };
        }

        let ptr_before = sim.dog_buffer_ptr();
        sim.step_dog_buffer();
        let ptr_after = sim.dog_buffer_ptr();
        assert_eq!(ptr_before, ptr_after);
        assert_eq!(sim.dog_buffer.slots.len(), DOG_SIM_BUFFER_LEN);

        for index in [
            DOG_BUF_DOG_X,
            DOG_BUF_DOG_Y,
            DOG_BUF_DOG_VX,
            DOG_BUF_DOG_VY,
            DOG_BUF_DOG_STATE_ID,
            DOG_BUF_ACTIVE_UTILITY_ID,
            DOG_BUF_ACTIVE_UTILITY_SCORE,
            DOG_BUF_EVENT_BITMASK,
        ] {
            assert!(
                sim.dog_buffer.slots[index].is_finite(),
                "output slot {} must remain finite",
                index
            );
        }
    }
}
