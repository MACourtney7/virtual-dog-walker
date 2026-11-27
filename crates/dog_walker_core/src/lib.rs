pub mod ball_physics;
pub mod care_sim;
pub mod collision;
pub mod dog_contract;
pub mod dog_leash_needs;
pub mod dog_physics;
pub mod dog_utility_ai;
pub mod math;
pub mod npc_sim;
pub mod owner_sim;
pub mod world_contract;

use ball_physics::{step_ball_buffer, step_toy_ball, BallSim, BallStepContext};
use care_sim::step_care_buffer as care_step;
use dog_utility_ai::{step_dog_utility_ai as dog_ai_step, DogAiContext};
use owner_sim::{step_owner_buffer as owner_step, OwnerStepInput};

use collision::{resolve_entity_collisions, resolve_field_collisions, Collider, WorldObstacle};
use dog_contract::*;
use dog_leash_needs::{step_dog_leash_needs as dog_leash_step, DogLeashNeedsContext};
use dog_physics::{step_ear_springs, step_ear_springs_to_targets, step_leash_constraint};
use npc_sim::{sample_npc_state, sample_path_exact, step_npc_buffer as npc_step, NpcPathPoint, NpcStepContext};
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
    // Per-domain event bitmasks from the most recent step of each domain.
    last_owner_events: u32,
    last_care_events: u32,
    last_ball_events: u32,
    last_npc_events: [u32; MAX_PARK_NPCS],
    last_dog_events: u32,
    // Per-slot NPC path storage (no per-frame heap allocation).
    npc_paths: [[(f32, f32); 32]; MAX_PARK_NPCS],
    npc_path_lens: [usize; MAX_PARK_NPCS],
    npc_phrase_counts: [u32; MAX_PARK_NPCS],
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
            last_owner_events: 0,
            last_care_events: 0,
            last_ball_events: 0,
            last_npc_events: [0; MAX_PARK_NPCS],
            last_dog_events: 0,
            npc_paths: [[(0.0, 0.0); 32]; MAX_PARK_NPCS],
            npc_path_lens: [0; MAX_PARK_NPCS],
            npc_phrase_counts: [0; MAX_PARK_NPCS],
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
            None => {
                if util.active_utility_id == dog_utility_ai::UTIL_ROAM_EXPLORE
                    && util.desired_speed <= 0.01
                {
                    DogStateId::Sniff
                } else {
                    dog_state_for_utility(util.active_utility_id)
                }
            }
        };
        self.dog_buffer.slots[DOG_BUF_DOG_STATE_ID] = next_state as u32 as f32;

        // 7. Integrate movement from desired speed, multiplier, and steer.
        // Freeze the dog in place while pooping.
        let (vx, vy) = if next_state == DogStateId::Poop || combo.is_pooping {
            (0.0_f32, 0.0_f32)
        } else {
            let speed = sanitize_f32((util.desired_speed * decision.speed_multiplier).max(0.0));
            (
                sanitize_f32(util.steer_x * speed),
                sanitize_f32(util.steer_y * speed),
            )
        };

        let mut next_x = sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_DOG_X) + vx * dt);
        let mut next_y = sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_DOG_Y) + vy * dt);

        // Keep the dog inside the world bounds. When real field obstacles are
        // loaded, resolve field collisions first (matching the JS field), then
        // clamp to the world rectangle. With no obstacles (unit tests) just
        // clamp so a dog starting at (0, 0) is unaffected.
        if self.world_width > 0.0 && self.world_height > 0.0 {
            if !self.obstacles.is_empty() {
                let (rx, ry) = resolve_field_collisions(
                    next_x as f64,
                    next_y as f64,
                    12.0,
                    self.world_width,
                    self.world_height,
                    &self.obstacles,
                );
                next_x = sanitize_f32(rx as f32);
                next_y = sanitize_f32(ry as f32);
            }
            next_x = next_x.clamp(0.0, self.world_width as f32);
            next_y = next_y.clamp(0.0, self.world_height as f32);
        }

        self.dog_buffer.slots[DOG_BUF_DOG_X] = next_x;
        self.dog_buffer.slots[DOG_BUF_DOG_Y] = next_y;
        self.dog_buffer.slots[DOG_BUF_DOG_VX] = vx;
        self.dog_buffer.slots[DOG_BUF_DOG_VY] = vy;

        // When settled at heel on the leash, align to the owner's heading so
        // the dog never pivots 90 degrees sideways as the owner stops.
        let vel_mag = (vx * vx + vy * vy).sqrt();
        let owner_heading = sanitize_f32(slot_f32(&self.dog_buffer, DOG_BUF_OWNER_HEADING));
        if combo.is_on_leash && !combo.is_pooping && vel_mag < 25.0 {
            self.dog_buffer.slots[DOG_BUF_DOG_ANGLE] = owner_heading;
        } else if vel_mag > 1.0 {
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

    /// Advance the owner buffer by one tick. Returns the owner event bitmask.
    pub fn step_owner_buffer(&mut self, dt_s: f32) -> u32 {
        let dog_x = slot_f32(&self.dog_buffer, DOG_BUF_DOG_X);
        let dog_y = slot_f32(&self.dog_buffer, DOG_BUF_DOG_Y);
        let dog_heading = slot_f32(&self.dog_buffer, DOG_BUF_DOG_ANGLE);
        let dog_is_pooping =
            current_state_id(&self.dog_buffer) == DogStateId::Poop as u32;

        // Standalone `step_owner_buffer` tests never run `step_dog_buffer`, so
        // the dog buffer is uninitialized (DT and NOW_SEC both zero). Default
        // to on-leash in that case to preserve existing behavior; otherwise
        // honor the dog's actual leash state.
        let dog_stepped = self.dog_buffer.slots[DOG_BUF_DT] > 0.0
            || self.dog_buffer.slots[DOG_BUF_NOW_SEC] > 0.0;
        // On frame 1 the dog buffer has not been seeded yet (dog.update() has
        // not run), so the dog sits at (0, 0). Treating that as on-leash would
        // clamp the owner toward the origin and cause an initial spawn slide.
        let dog_seeded = dog_stepped || dog_x != 0.0 || dog_y != 0.0;
        let is_on_leash = if dog_stepped {
            slot_bool(&self.dog_buffer, DOG_BUF_IS_ON_LEASH)
        } else {
            dog_seeded
        };

        let input = OwnerStepInput {
            dt_s,
            dog_pos_x: dog_x,
            dog_pos_y: dog_y,
            dog_heading_rad: dog_heading,
            field_min_x: 0.0,
            field_min_y: 0.0,
            field_max_x: self.world_width as f32,
            field_max_y: self.world_height as f32,
            dog_is_pooping,
            is_on_leash,
            warp_gates: &[],
            obstacles: &self.obstacles,
        };
        let events = owner_step(&mut self.owner_buffer, &input);
        self.last_owner_events = events;
        events
    }

    /// Advance the care buffer by one tick. Returns the care event bitmask.
    pub fn step_care_buffer(&mut self, dt_ms: f32) -> u32 {
        let events = care_step(&mut self.care_buffer, dt_ms);
        self.last_care_events = events;
        events
    }

    /// Advance the ball buffer by one tick. Returns the ball event bitmask.
    pub fn step_ball_buffer(&mut self, dt_s: f32) -> u32 {
        // Owner position/heading come from the authoritative owner buffer.
        let ctx = BallStepContext {
            dog_pos_x: slot_f32(&self.dog_buffer, DOG_BUF_DOG_X),
            dog_pos_y: slot_f32(&self.dog_buffer, DOG_BUF_DOG_Y),
            dog_heading_rad: slot_f32(&self.dog_buffer, DOG_BUF_DOG_ANGLE),
            owner_pos_x: self.owner_buffer.data[owner_sim::OWNER_SLOT_X],
            owner_pos_y: self.owner_buffer.data[owner_sim::OWNER_SLOT_Y],
            owner_heading_rad: self.owner_buffer.data[owner_sim::OWNER_SLOT_ANGLE],
        };
        let events = step_ball_buffer(&mut self.ball_buffer, &ctx, dt_s);
        self.last_ball_events = events;
        events
    }

    /// Register an NPC path for `slot`. Copies up to 32 `(x, y)` pairs from
    /// `flat_xy` (interleaved x, y) and stores the phrase count. Out-of-range
    /// slots are ignored without mutating state.
    pub fn set_npc_path(&mut self, slot: usize, flat_xy: &[f32], phrase_count: u32) {
        if slot >= MAX_PARK_NPCS {
            return;
        }
        let pair_count = (flat_xy.len() / 2).min(32);
        for i in 0..pair_count {
            self.npc_paths[slot][i] = (flat_xy[i * 2], flat_xy[i * 2 + 1]);
        }
        self.npc_path_lens[slot] = pair_count;
        self.npc_phrase_counts[slot] = phrase_count;
    }

    /// Length of the owner simulation buffer in f32 slots.
    pub fn owner_buffer_len(&self) -> usize {
        OWNER_SIM_BUFFER_LEN
    }

    /// Length of the care simulation buffer in f32 slots.
    pub fn care_buffer_len(&self) -> usize {
        CARE_SIM_BUFFER_LEN
    }

    /// Length of the ball simulation buffer in f32 slots.
    pub fn ball_buffer_len(&self) -> usize {
        BALL_SIM_BUFFER_LEN
    }

    /// Length of each NPC simulation buffer in f32 slots.
    pub fn npc_buffer_len(&self) -> usize {
        NPC_SIM_BUFFER_LEN
    }

    /// Length of the dog simulation buffer in f32 slots.
    pub fn dog_buffer_len(&self) -> usize {
        DOG_SIM_BUFFER_LEN
    }

    /// Advance the NPC buffer for `slot` by one tick. Returns the NPC event
    /// bitmask, or `0` when `slot` is out of range.
    pub fn step_npc_buffer(&mut self, slot: u32, dt_s: f32) -> u32 {
        let index = slot as usize;
        if index >= MAX_PARK_NPCS {
            return 0;
        }
        // Owner position comes from the authoritative owner buffer.
        let ctx = NpcStepContext {
            owner_x: self.owner_buffer.data[owner_sim::OWNER_SLOT_X],
            owner_y: self.owner_buffer.data[owner_sim::OWNER_SLOT_Y],
            phrase_count: self.npc_phrase_counts[index].min(u16::MAX as u32) as u16,
        };
        // Build the path view from the fixed-size per-slot storage (no heap).
        let len = self.npc_path_lens[index].min(32);
        let mut path = [NpcPathPoint { x: 0.0, y: 0.0 }; 32];
        for i in 0..len {
            let (x, y) = self.npc_paths[index][i];
            path[i] = NpcPathPoint { x, y };
        }
        let events = npc_step(
            &mut self.npc_buffers[index],
            &path[..len],
            &ctx,
            dt_s,
        );
        self.last_npc_events[index] = events;
        events
    }

    /// Advance the dog utility AI by one tick. Returns the dog event bitmask.
    pub fn step_dog_utility_ai(&mut self, dt_s: f32) -> u32 {
        // Reset the combined dog event accumulator so utility-AI events are
        // never overwritten by leash-needs events.
        self.last_dog_events = 0;

        // Ball state comes from the authoritative ball buffer.
        let ball_state = self.ball_buffer.data[ball_physics::BALL_SLOT_STATE_ID];
        let ball_thrown = self.ball_buffer.data[ball_physics::BALL_SLOT_IS_THROWN] > 0.5;
        let ball_carried = self.ball_buffer.data[ball_physics::BALL_SLOT_IS_CARRIED] > 0.5;
        let ball_attached = self.ball_buffer.data[ball_physics::BALL_SLOT_ATTACHED_TO_DOG] > 0.5;
        let ball_available = ball_thrown
            || ball_state == ball_physics::BALL_STATE_THROWN
            || ball_state == ball_physics::BALL_STATE_IDLE;
        let ball_held_by_dog = ball_carried || ball_attached;

        let ctx = DogAiContext {
            owner_x: self.owner_buffer.data[owner_sim::OWNER_SLOT_X],
            owner_y: self.owner_buffer.data[owner_sim::OWNER_SLOT_Y],
            ball_available,
            ball_held_by_dog,
            sunny_zone_contains_dog: false,
            pack_partner_available: false,
            pack_partner_id: 0.0,
            pack_partner_x: 0.0,
            pack_partner_y: 0.0,
            care_is_hungry: self.care_buffer.data[care_sim::CARE_SLOT_IS_HUNGRY] > 0.5,
            care_needs_grooming: self.care_buffer.data[care_sim::CARE_SLOT_NEEDS_GROOMING] > 0.5,
            care_is_tired: self.care_buffer.data[care_sim::CARE_SLOT_IS_TIRED] > 0.5,
            obstacles: &self.obstacles,
        };
        let events = dog_ai_step(&mut self.dog_buffer, &ctx, dt_s);
        self.last_dog_events |= events;
        events
    }

    /// Advance the dog leash/needs pipeline by one tick. Returns the leash
    /// event bitmask.
    pub fn step_dog_leash_needs(&mut self, dt_s: f32) -> u32 {
        // Owner position comes from the authoritative owner buffer.
        let ctx = DogLeashNeedsContext {
            owner_x: self.owner_buffer.data[owner_sim::OWNER_SLOT_X],
            owner_y: self.owner_buffer.data[owner_sim::OWNER_SLOT_Y],
            leash_max_length: dog_leash_needs::MAX_LEASH_LENGTH,
            field_min_x: 0.0,
            field_min_y: 0.0,
            field_max_x: self.world_width as f32,
            field_max_y: self.world_height as f32,
        };
        let events = dog_leash_step(&mut self.dog_buffer, &ctx, dt_s);
        self.last_dog_events |= events;
        events
    }

    /// Advance every domain buffer in the locked order: care, owner, ball,
    /// NPC slots `0..MAX_PARK_NPCS`, dog utility AI, dog leash needs.
    ///
    /// Returns a summary bitset:
    /// - bit 0: owner event
    /// - bit 1: care event
    /// - bit 2: ball event
    /// - bit 3: any NPC event
    /// - bit 4: dog event (utility AI or leash needs)
    /// - bits 5..63: zero
    pub fn step_all_buffers(&mut self, dt_s: f32) -> u64 {
        let mut summary: u64 = 0;

        // Reset the combined dog event accumulator before the dog steps so
        // utility-AI events are never overwritten by leash-needs events.
        self.last_dog_events = 0;

        let care_events = self.step_care_buffer(dt_s * 1000.0);
        if care_events != 0 {
            summary |= 1 << 1;
        }

        let owner_events = self.step_owner_buffer(dt_s);
        if owner_events != 0 {
            summary |= 1 << 0;
        }

        let ball_events = self.step_ball_buffer(dt_s);
        if ball_events != 0 {
            summary |= 1 << 2;
        }

        let mut any_npc = false;
        for slot in 0..MAX_PARK_NPCS {
            // Skip uninitialized/empty NPC slots so a fresh sim does not emit
            // PATH_FINISHED for slots that were never given a path.
            if self.npc_path_lens[slot] < 2 {
                continue;
            }
            if self.step_npc_buffer(slot as u32, dt_s) != 0 {
                any_npc = true;
            }
        }
        if any_npc {
            summary |= 1 << 3;
        }

        let mut dog_events = self.step_dog_utility_ai(dt_s);
        dog_events |= self.step_dog_leash_needs(dt_s);
        if dog_events != 0 {
            summary |= 1 << 4;
        }

        summary
    }

    /// Owner event bitmask from the last owner step.
    pub fn owner_event_bitmask(&self) -> u32 {
        self.last_owner_events
    }

    /// Care event bitmask from the last care step.
    pub fn care_event_bitmask(&self) -> u32 {
        self.last_care_events
    }

    /// Ball event bitmask from the last ball step.
    pub fn ball_event_bitmask(&self) -> u32 {
        self.last_ball_events
    }

    /// NPC event bitmask for `slot`, or `0` when `slot` is out of range.
    pub fn npc_event_bitmask(&self, slot: u32) -> u32 {
        let index = slot as usize;
        if index >= MAX_PARK_NPCS {
            return 0;
        }
        self.last_npc_events[index]
    }

    /// Dog event bitmask from the last dog step (combined utility-AI and
    /// leash-needs events).
    pub fn dog_event_bitmask(&self) -> u32 {
        self.last_dog_events
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

        // Out-of-range NPC slots must not panic and must report no events.
        assert_eq!(sim.step_npc_buffer(MAX_PARK_NPCS as u32, 0.016), 0);
        assert_eq!(sim.npc_event_bitmask(MAX_PARK_NPCS as u32), 0);

        // Real steps run without panicking and keep buffers finite.
        let _ = sim.step_owner_buffer(0.016);
        let _ = sim.step_care_buffer(16.0);
        let _ = sim.step_ball_buffer(0.016);
        let _ = sim.step_npc_buffer(0, 0.016);
        let _ = sim.step_dog_utility_ai(0.016);
        let _ = sim.step_dog_leash_needs(0.016);
        let _ = sim.step_all_buffers(0.016);

        for slot in sim.owner_buffer.data.iter() {
            assert!(slot.is_finite(), "owner buffer must stay finite");
        }
        for slot in sim.care_buffer.data.iter() {
            assert!(slot.is_finite(), "care buffer must stay finite");
        }
        for slot in sim.ball_buffer.data.iter() {
            assert!(slot.is_finite(), "ball buffer must stay finite");
        }
        for slot in sim.npc_buffers[0].data.iter() {
            assert!(slot.is_finite(), "npc buffer must stay finite");
        }
    }

    #[test]
    fn step_all_buffers_summary_bit_positions() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        // A fresh sim with no commands should produce no summary bits.
        let summary = sim.step_all_buffers(0.016);
        assert_eq!(summary & !0x1F, 0, "only bits 0..4 may be set");
        // Bits 5..63 must always be zero.
        assert_eq!(summary >> 5, 0);
        // No NPC paths registered: the NPC summary bit (bit 3) must be clear.
        assert_eq!(summary & (1 << 3), 0, "empty NPC slots must not set bit 3");
    }

    #[test]
    fn set_npc_path_advances_npc_along_two_point_path() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        sim.set_npc_path(0, &[100.0, 100.0, 200.0, 100.0], 3);
        assert_eq!(sim.npc_path_lens[0], 2);
        assert_eq!(sim.npc_phrase_counts[0], 3);

        let events = sim.step_npc_buffer(0, 0.016);
        // A real 2-point path should not immediately finish.
        assert_eq!(events & npc_sim::NPC_EVENT_PATH_FINISHED, 0);
        assert_eq!(sim.npc_event_bitmask(0), events);

        // Out-of-range slot must be a no-op.
        let before = sim.npc_path_lens[0];
        sim.set_npc_path(MAX_PARK_NPCS, &[0.0, 0.0, 1.0, 1.0], 1);
        assert_eq!(sim.npc_path_lens[0], before);
    }

    #[test]
    fn buffer_length_accessors_match_constants() {
        let sim = WasmWorldSim::new(2000.0, 2000.0);
        assert_eq!(sim.owner_buffer_len(), OWNER_SIM_BUFFER_LEN);
        assert_eq!(sim.care_buffer_len(), CARE_SIM_BUFFER_LEN);
        assert_eq!(sim.ball_buffer_len(), BALL_SIM_BUFFER_LEN);
        assert_eq!(sim.npc_buffer_len(), NPC_SIM_BUFFER_LEN);
        assert_eq!(sim.dog_buffer_len(), DOG_SIM_BUFFER_LEN);
    }

    #[test]
    fn step_all_buffers_ordering_and_dog_events_combined() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        // Force a dog utility-AI event (bark). The dog summary bit must be set
        // even though the leash-needs step may emit nothing.
        sim.dog_buffer.slots[DOG_BUF_CMD_BARK] = 1.0;

        let summary = sim.step_all_buffers(0.016);

        // Dog events (bit 4) must be set because the utility-AI bark fired.
        assert_ne!(summary & (1 << 4), 0, "dog summary bit must be set");
        let dog_events = sim.dog_event_bitmask();
        assert_ne!(dog_events & DOG_EVENT_BARK, 0, "bark event must be preserved");
    }

    #[test]
    fn dog_event_bitmask_combines_utility_and_leash_events() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        // Utility-AI bark event.
        sim.dog_buffer.slots[DOG_BUF_CMD_BARK] = 1.0;
        let util_events = sim.step_dog_utility_ai(0.016);
        assert_ne!(util_events & DOG_EVENT_BARK, 0);

        // Place the dog well beyond the leash length so the leash-needs step
        // emits LEASH_TAUT, and verify the utility event is not overwritten.
        sim.dog_buffer.slots[DOG_BUF_DOG_X] = 500.0;
        sim.dog_buffer.slots[DOG_BUF_DOG_Y] = 0.0;
        sim.owner_buffer.data[owner_sim::OWNER_SLOT_X] = 0.0;
        sim.owner_buffer.data[owner_sim::OWNER_SLOT_Y] = 0.0;
        let leash_events = sim.step_dog_leash_needs(0.016);
        assert_ne!(leash_events & DOG_EVENT_LEASH_TAUT, 0);

        let combined = sim.dog_event_bitmask();
        assert_ne!(combined & DOG_EVENT_BARK, 0, "utility event must survive");
        assert_ne!(combined & DOG_EVENT_LEASH_TAUT, 0, "leash event must be added");
    }

    #[test]
    fn invalid_npc_slot_is_noop_and_returns_zero() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        let before = sim.npc_buffers[0].data;
        let events = sim.step_npc_buffer(MAX_PARK_NPCS as u32, 0.016);
        assert_eq!(events, 0);
        assert_eq!(sim.npc_event_bitmask(MAX_PARK_NPCS as u32), 0);
        // No mutation of any valid NPC buffer.
        assert_eq!(sim.npc_buffers[0].data, before);
    }

    #[test]
    fn npc_event_bitmask_returns_stored_events_not_cmd_flags() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        // A short path (single point) finishes immediately, emitting
        // PATH_FINISHED. CMD_FLAGS is cleared by the step, so the getter must
        // read the stored event bitmask, not CMD_FLAGS.
        sim.npc_path_lens[0] = 1;
        sim.npc_paths[0][0] = (10.0, 10.0);
        let events = sim.step_npc_buffer(0, 0.016);
        assert_ne!(events & npc_sim::NPC_EVENT_PATH_FINISHED, 0);
        assert_eq!(sim.npc_event_bitmask(0), events);
        // CMD_FLAGS is cleared after the step; the getter must not read it.
        assert_eq!(
            sim.npc_buffers[0].data[npc_sim::NPC_SLOT_CMD_FLAGS],
            0.0
        );
    }

    #[test]
    fn dog_event_bitmask_preserves_combined_events() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        // Utility-AI bark event.
        sim.dog_buffer.slots[DOG_BUF_CMD_BARK] = 1.0;
        let util_events = sim.step_dog_utility_ai(0.016);
        assert_ne!(util_events & DOG_EVENT_BARK, 0);
        assert_eq!(sim.dog_event_bitmask(), util_events);

        // Leash-needs event must be OR-ed into the combined mask, not replace it.
        sim.dog_buffer.slots[DOG_BUF_DOG_X] = 500.0;
        sim.dog_buffer.slots[DOG_BUF_DOG_Y] = 0.0;
        sim.owner_buffer.data[owner_sim::OWNER_SLOT_X] = 0.0;
        sim.owner_buffer.data[owner_sim::OWNER_SLOT_Y] = 0.0;
        let leash_events = sim.step_dog_leash_needs(0.016);
        assert_ne!(leash_events & DOG_EVENT_LEASH_TAUT, 0);
        let combined = sim.dog_event_bitmask();
        assert_ne!(combined & DOG_EVENT_BARK, 0, "utility event must survive");
        assert_ne!(combined & DOG_EVENT_LEASH_TAUT, 0, "leash event must be added");
    }

    #[test]
    fn dog_contract_step_buffer_clamps_off_leash_dog_to_world_bounds() {
        let mut sim = WasmWorldSim::new(2000.0, 2000.0);
        sim.dog_buffer.slots[DOG_BUF_DT] = 0.1;
        // Off-leash dog placed outside the right edge, moving right fast enough
        // to overshoot the world width in a single step.
        sim.dog_buffer.slots[DOG_BUF_IS_ON_LEASH] = 0.0;
        sim.dog_buffer.slots[DOG_BUF_DOG_X] = 2050.0;
        sim.dog_buffer.slots[DOG_BUF_DOG_Y] = 1000.0;
        sim.dog_buffer.slots[DOG_BUF_DOG_VX] = 5000.0;
        sim.dog_buffer.slots[DOG_BUF_DOG_VY] = 0.0;

        sim.step_dog_buffer();

        let x = sim.dog_buffer.slots[DOG_BUF_DOG_X];
        let y = sim.dog_buffer.slots[DOG_BUF_DOG_Y];
        assert!(x.is_finite() && y.is_finite());
        assert_eq!(
            x, 2000.0,
            "dog x must be clamped exactly to world_width, got {}",
            x
        );
        assert!(
            (0.0..=2000.0).contains(&y),
            "dog y must be clamped within [0, world_height], got {}",
            y
        );
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
