//! Leash slot geometry, discrete combo resolution, and leash/owner constraint solving
//! for the virtual dog walker simulation core.

use crate::dog_contract::*;

/// Multiplier applied to owner speed while the dog is attending to a need.
pub const NEED_SPEED_MULTIPLIER: f32 = 0.15;
/// Hard maximum separation (px) between dog and owner while leashed.
pub const MAX_LEASH_LENGTH: f32 = 52.5;
/// Distance (px) at which the leash starts to resist.
pub const LEASH_SOFT_SPRING_LENGTH: f32 = 39.0;
/// Minimum forward lead of the target leash slot.
pub const LEASH_FORWARD_MIN: f32 = 38.0;
/// Maximum forward lead of the target leash slot.
pub const LEASH_FORWARD_MAX: f32 = 50.0;
/// Preferred forward lead of the target leash slot.
pub const LEASH_FORWARD_TARGET: f32 = 48.0;
/// Minimum lateral clearance of the target leash slot.
pub const LEASH_LATERAL_MIN: f32 = 0.0;
/// Maximum lateral clearance of the target leash slot.
pub const LEASH_LATERAL_MAX: f32 = 4.0;
/// Preferred lateral clearance of the target leash slot.
pub const LEASH_LATERAL_TARGET: f32 = 2.0;
/// Minimum shoulder margin kept between the owner body and the dog slot.
pub const LEASH_SHOULDER_MARGIN_MIN: f32 = 2.0;
/// Feed-forward horizon (seconds) used to project owner velocity into the slot.
pub const LEASH_VELOCITY_FEED_FORWARD_SEC: f32 = 0.12;
/// Slack tolerance (px) below the max leash length before the leash is
/// considered slack and tension starts decaying.
pub const LEASH_TAUT_SLACK_EPS_PX: f32 = 2.0;
/// Per-second rate at which leash tension decays while slack.
pub const LEASH_TENSION_DECAY_PER_SEC: f32 = 0.25;

/// External context for [`step_dog_leash_needs`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DogLeashNeedsContext {
    pub owner_x: f32,
    pub owner_y: f32,
    pub leash_max_length: f32,
    pub field_min_x: f32,
    pub field_min_y: f32,
    pub field_max_x: f32,
    pub field_max_y: f32,
}

/// Target slot the dog should steer toward relative to the owner's body.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LeashSlot {
    pub target_x: f32,
    pub target_y: f32,
    pub forward_lead: f32,
    pub lateral_clearance: f32,
    pub shoulder_margin: f32,
}

/// Resolved discrete behaviour for a single simulation tick.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DiscreteDecision {
    pub anchor_leash: bool,
    pub owner_frozen: bool,
    pub speed_multiplier: f32,
    pub allow_ball_fetch: bool,
    pub force_state: Option<DogStateId>,
}

/// Result of applying leash + owner constraints to the simulation buffer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LeashConstraintOutputs {
    pub dog_clamped_x: f32,
    pub dog_clamped_y: f32,
    pub dog_was_clamped: bool,
    pub owner_clamped_x: f32,
    pub owner_clamped_y: f32,
    pub owner_was_clamped: bool,
    pub owner_frozen: bool,
    pub is_pulling_leash: bool,
    pub leash_taut: bool,
    pub leash_tension: f32,
    pub leash_sag_px: f32,
    pub leash_vibration_px: f32,
}

#[inline]
fn sanitize(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

/// Resolve a discrete combo into a [`DiscreteDecision`].
///
/// The match is intentionally exhaustive (16 arms) so that adding a new combo
/// flag becomes a compile error rather than an accidental silent default.
pub fn resolve_discrete_combo(combo: DiscreteCombo) -> DiscreteDecision {
    match (
        combo.is_on_leash,
        combo.is_pooping,
        combo.has_need,
        combo.has_ball,
    ) {
        // Off leash, no poop, no need.
        (false, false, false, false) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: 1.0,
            allow_ball_fetch: false,
            force_state: None,
        },
        (false, false, false, true) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: 1.0,
            allow_ball_fetch: true,
            force_state: None,
        },
        // Off leash, no poop, has need (ball fetch disallowed either way).
        (false, false, true, false) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: None,
        },
        (false, false, true, true) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: None,
        },
        // Off leash, pooping.
        (false, true, false, false) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Poop),
        },
        (false, true, false, true) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Poop),
        },
        (false, true, true, false) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Poop),
        },
        (false, true, true, true) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Poop),
        },
        // On leash, no poop, no need: heel but do not anchor the owner.
        (true, false, false, false) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: 1.0,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Heel),
        },
        (true, false, false, true) => DiscreteDecision {
            anchor_leash: false,
            owner_frozen: false,
            speed_multiplier: 1.0,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Heel),
        },
        // On leash, no poop, has need: heel and anchor the owner.
        (true, false, true, false) => DiscreteDecision {
            anchor_leash: true,
            owner_frozen: false,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Heel),
        },
        (true, false, true, true) => DiscreteDecision {
            anchor_leash: true,
            owner_frozen: false,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Heel),
        },
        // On leash and pooping: anchor and freeze the owner.
        (true, true, false, false) => DiscreteDecision {
            anchor_leash: true,
            owner_frozen: true,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Poop),
        },
        (true, true, false, true) => DiscreteDecision {
            anchor_leash: true,
            owner_frozen: true,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Poop),
        },
        (true, true, true, false) => DiscreteDecision {
            anchor_leash: true,
            owner_frozen: true,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Poop),
        },
        (true, true, true, true) => DiscreteDecision {
            anchor_leash: true,
            owner_frozen: true,
            speed_multiplier: NEED_SPEED_MULTIPLIER,
            allow_ball_fetch: false,
            force_state: Some(DogStateId::Poop),
        },
    }
}

/// Compute the desired leash slot beside the owner.
#[allow(clippy::too_many_arguments)]
pub fn compute_leash_slot(
    owner_x: f32,
    owner_y: f32,
    owner_vx: f32,
    owner_vy: f32,
    owner_heading: f32,
    owner_half_width: f32,
    preferred_side_sign: f32,
) -> LeashSlot {
    let owner_x = sanitize(owner_x);
    let owner_y = sanitize(owner_y);
    let owner_vx = sanitize(owner_vx);
    let owner_vy = sanitize(owner_vy);
    let owner_heading = sanitize(owner_heading);
    let owner_half_width = sanitize(owner_half_width);
    let preferred_side_sign = sanitize(preferred_side_sign);

    let forward = (owner_heading.cos(), owner_heading.sin());
    let right = (-owner_heading.sin(), owner_heading.cos());

    let side = if preferred_side_sign < 0.0 {
        -1.0
    } else if preferred_side_sign > 0.0 {
        1.0
    } else {
        -1.0
    };

    let feed_forward =
        (owner_vx * forward.0 + owner_vy * forward.1) * LEASH_VELOCITY_FEED_FORWARD_SEC;
    let forward_lead =
        (LEASH_FORWARD_TARGET + feed_forward).clamp(LEASH_FORWARD_MIN, LEASH_FORWARD_MAX);

    let raw_clearance = LEASH_LATERAL_TARGET.clamp(LEASH_LATERAL_MIN, LEASH_LATERAL_MAX);
    let shoulder_margin = raw_clearance.max(LEASH_SHOULDER_MARGIN_MIN);

    let lateral = side * (owner_half_width + shoulder_margin);

    LeashSlot {
        target_x: owner_x + forward.0 * forward_lead + right.0 * lateral,
        target_y: owner_y + forward.1 * forward_lead + right.1 * lateral,
        forward_lead,
        lateral_clearance: raw_clearance,
        shoulder_margin,
    }
}

/// Persist the target leash slot into the simulation buffer.
pub fn write_leash_slot(buffer: &mut DogSimBuffer, slot: &LeashSlot) {
    buffer.slots[DOG_BUF_TARGET_SLOT_X] = slot.target_x;
    buffer.slots[DOG_BUF_TARGET_SLOT_Y] = slot.target_y;
}

/// Resolve leash limits between dog and owner, writing clamped positions plus
/// packed leash/owner flags back into `buffer`.
pub fn constrain_leash_and_owner(
    buffer: &mut DogSimBuffer,
    decision: &DiscreteDecision,
) -> LeashConstraintOutputs {
    let dog_x = sanitize(buffer.slots[DOG_BUF_DOG_X]);
    let dog_y = sanitize(buffer.slots[DOG_BUF_DOG_Y]);
    let owner_x = sanitize(buffer.slots[DOG_BUF_OWNER_X]);
    let owner_y = sanitize(buffer.slots[DOG_BUF_OWNER_Y]);
    let owner_heading = sanitize(buffer.slots[DOG_BUF_OWNER_HEADING]);
    let is_on_leash = buffer.slots[DOG_BUF_IS_ON_LEASH] > 0.5;

    if !is_on_leash {
        buffer.slots[DOG_BUF_DOG_X] = dog_x;
        buffer.slots[DOG_BUF_DOG_Y] = dog_y;
        buffer.slots[DOG_BUF_LEASH_TENSION] = 0.0;
        buffer.slots[DOG_BUF_LEASH_SAG_PX] = 0.0;
        buffer.slots[DOG_BUF_LEASH_VIBRATION_PX] = 0.0;
        buffer.slots[DOG_BUF_LEASH_FLAGS] = 0.0;
        buffer.slots[DOG_BUF_OWNER_FLAGS] = 0.0;
        buffer.slots[DOG_BUF_OWNER_CLAMPED_X] = owner_x;
        buffer.slots[DOG_BUF_OWNER_CLAMPED_Y] = owner_y;

        return LeashConstraintOutputs {
            dog_clamped_x: dog_x,
            dog_clamped_y: dog_y,
            dog_was_clamped: false,
            owner_clamped_x: owner_x,
            owner_clamped_y: owner_y,
            owner_was_clamped: false,
            owner_frozen: false,
            is_pulling_leash: false,
            leash_taut: false,
            leash_tension: 0.0,
            leash_sag_px: 0.0,
            leash_vibration_px: 0.0,
        };
    }

    let dx = dog_x - owner_x;
    let dy = dog_y - owner_y;
    let dist = dx.hypot(dy);

    let (dir_x, dir_y) = if dist < 1e-6 {
        (owner_heading.cos(), owner_heading.sin())
    } else {
        (dx / dist, dy / dist)
    };

    let mut dog_clamped_x = dog_x;
    let mut dog_clamped_y = dog_y;
    let mut owner_clamped_x = owner_x;
    let mut owner_clamped_y = owner_y;
    let mut dog_was_clamped = false;
    let mut owner_was_clamped = false;

    if dist > MAX_LEASH_LENGTH {
        if decision.anchor_leash {
            owner_clamped_x = dog_x - dir_x * MAX_LEASH_LENGTH;
            owner_clamped_y = dog_y - dir_y * MAX_LEASH_LENGTH;
            owner_was_clamped = true;
        } else {
            dog_clamped_x = owner_x + dir_x * MAX_LEASH_LENGTH;
            dog_clamped_y = owner_y + dir_y * MAX_LEASH_LENGTH;
            dog_was_clamped = true;
        }
    }

    let is_pulling_leash = dist > LEASH_SOFT_SPRING_LENGTH;
    let leash_taut = dist >= MAX_LEASH_LENGTH - 0.01;
    let leash_tension = ((dist - LEASH_SOFT_SPRING_LENGTH)
        / (MAX_LEASH_LENGTH - LEASH_SOFT_SPRING_LENGTH))
        .clamp(0.0, 1.0);
    let leash_sag_px = (LEASH_SOFT_SPRING_LENGTH - dist).max(0.0);
    let leash_vibration_px = if is_pulling_leash {
        0.5 + 0.5 * leash_tension
    } else {
        0.0
    };

    let mut leash_flags: u32 = 0;
    if is_pulling_leash {
        leash_flags |= DOG_LEASH_FLAG_PULLING as u32;
    }
    if leash_taut {
        leash_flags |= DOG_LEASH_FLAG_TAUT as u32;
    }

    let mut owner_flags: u32 = 0;
    if owner_was_clamped {
        owner_flags |= DOG_OWNER_FLAG_WAS_CLAMPED as u32;
    }
    if decision.owner_frozen {
        owner_flags |= DOG_OWNER_FLAG_FROZEN as u32;
    }

    buffer.slots[DOG_BUF_DOG_X] = dog_clamped_x;
    buffer.slots[DOG_BUF_DOG_Y] = dog_clamped_y;
    buffer.slots[DOG_BUF_OWNER_CLAMPED_X] = owner_clamped_x;
    buffer.slots[DOG_BUF_OWNER_CLAMPED_Y] = owner_clamped_y;
    buffer.slots[DOG_BUF_LEASH_TENSION] = leash_tension;
    buffer.slots[DOG_BUF_LEASH_SAG_PX] = leash_sag_px;
    buffer.slots[DOG_BUF_LEASH_VIBRATION_PX] = leash_vibration_px;
    buffer.slots[DOG_BUF_LEASH_FLAGS] = leash_flags as f32;
    buffer.slots[DOG_BUF_OWNER_FLAGS] = owner_flags as f32;

    LeashConstraintOutputs {
        dog_clamped_x,
        dog_clamped_y,
        dog_was_clamped,
        owner_clamped_x,
        owner_clamped_y,
        owner_was_clamped,
        owner_frozen: decision.owner_frozen,
        is_pulling_leash,
        leash_taut,
        leash_tension,
        leash_sag_px,
        leash_vibration_px,
    }
}

/// Advance leash tension and field clamping for one tick.
///
/// Returns the step-local leash event bitmask (`DOG_EVENT_LEASH_TAUT` /
/// `DOG_EVENT_LEASH_SLACK`). Does not overwrite `buf.event_bitmask`.
pub fn step_dog_leash_needs(
    buf: &mut DogSimBuffer,
    ctx: &DogLeashNeedsContext,
    dt_s: f32,
) -> u32 {
    // Invalid dt: do not mutate state, return the current event bitmask
    // unchanged.
    if !dt_s.is_finite() || dt_s <= 0.0 {
        return read_event_bitmask(buf);
    }

    let owner_x = sanitize(ctx.owner_x);
    let owner_y = sanitize(ctx.owner_y);
    let leash_max_length = sanitize(ctx.leash_max_length);

    let mut dog_x = sanitize(buf.slots[DOG_BUF_DOG_X]);
    let mut dog_y = sanitize(buf.slots[DOG_BUF_DOG_Y]);
    let mut leash_tension = sanitize(buf.slots[DOG_BUF_LEASH_TENSION]).clamp(0.0, 1.0);

    let mut events: u32 = 0;

    let dx = dog_x - owner_x;
    let dy = dog_y - owner_y;
    let distance = dx.hypot(dy);

    if leash_max_length <= 0.0 {
        // Snap dog to owner; avoid division by zero.
        dog_x = owner_x;
        dog_y = owner_y;
        leash_tension = 1.0;
        events |= DOG_EVENT_LEASH_TAUT;
    } else if distance > leash_max_length {
        // Project dog onto the leash circle around the owner.
        let (dir_x, dir_y) = if distance < 1e-6 {
            (1.0, 0.0)
        } else {
            (dx / distance, dy / distance)
        };
        dog_x = owner_x + dir_x * leash_max_length;
        dog_y = owner_y + dir_y * leash_max_length;
        leash_tension = 1.0;
        events |= DOG_EVENT_LEASH_TAUT;
    } else if distance <= leash_max_length - LEASH_TAUT_SLACK_EPS_PX {
        let previous = leash_tension;
        leash_tension = (leash_tension - LEASH_TENSION_DECAY_PER_SEC * dt_s).max(0.0);
        if previous > 0.0 && leash_tension == 0.0 {
            events |= DOG_EVENT_LEASH_SLACK;
        }
    }

    // Clamp final dog position to field bounds. Guard against inverted bounds
    // (field_min > field_max) so `f32::clamp` never panics.
    let field_min_x = sanitize(ctx.field_min_x);
    let field_min_y = sanitize(ctx.field_min_y);
    let field_max_x = sanitize(ctx.field_max_x);
    let field_max_y = sanitize(ctx.field_max_y);
    let min_x = field_min_x.min(field_max_x);
    let max_x = field_min_x.max(field_max_x);
    let min_y = field_min_y.min(field_max_y);
    let max_y = field_min_y.max(field_max_y);
    dog_x = dog_x.clamp(min_x, max_x);
    dog_y = dog_y.clamp(min_y, max_y);

    buf.slots[DOG_BUF_DOG_X] = dog_x;
    buf.slots[DOG_BUF_DOG_Y] = dog_y;
    buf.slots[DOG_BUF_LEASH_TENSION] = leash_tension;
    // Heading is preserved: the context provides no target heading.

    events
}

/// Full leash/need pipeline for one tick: resolve the discrete decision, write
/// the target slot, then constrain dog and owner against the leash length.
pub fn apply_leash_and_needs(buffer: &mut DogSimBuffer, combo: DiscreteCombo) -> DiscreteDecision {
    let decision = resolve_discrete_combo(combo);

    let slot = compute_leash_slot(
        buffer.slots[DOG_BUF_OWNER_X],
        buffer.slots[DOG_BUF_OWNER_Y],
        buffer.slots[DOG_BUF_OWNER_VX],
        buffer.slots[DOG_BUF_OWNER_VY],
        buffer.slots[DOG_BUF_OWNER_HEADING],
        buffer.slots[DOG_BUF_OWNER_HALF_WIDTH],
        buffer.slots[DOG_BUF_PREFERRED_SIDE_SIGN],
    );
    write_leash_slot(buffer, &slot);
    constrain_leash_and_owner(buffer, &decision);

    decision
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPS: f32 = 1e-4;

    fn approx(a: f32, b: f32) -> bool {
        (a - b).abs() <= EPS
    }

    /// Mirrors how `lib.rs` builds the buffer: relies only on the public
    /// `slots` field, never on a `Default`/`new` helper existing.
    fn make_buffer() -> DogSimBuffer {
        DogSimBuffer {
            slots: [0.0; DOG_SIM_BUFFER_LEN],
        }
    }

    fn combo(on_leash: bool, pooping: bool, need: bool, ball: bool) -> DiscreteCombo {
        DiscreteCombo {
            is_on_leash: on_leash,
            is_pooping: pooping,
            has_need: need,
            has_ball: ball,
        }
    }

    fn decision(anchor_leash: bool, owner_frozen: bool) -> DiscreteDecision {
        DiscreteDecision {
            anchor_leash,
            owner_frozen,
            speed_multiplier: 1.0,
            allow_ball_fetch: false,
            force_state: None,
        }
    }

    fn place(buffer: &mut DogSimBuffer, dog: (f32, f32), owner: (f32, f32), on_leash: bool) {
        buffer.slots[DOG_BUF_DOG_X] = dog.0;
        buffer.slots[DOG_BUF_DOG_Y] = dog.1;
        buffer.slots[DOG_BUF_OWNER_X] = owner.0;
        buffer.slots[DOG_BUF_OWNER_Y] = owner.1;
        buffer.slots[DOG_BUF_IS_ON_LEASH] = if on_leash { 1.0 } else { 0.0 };
    }

    #[test]
    fn resolve_discrete_combo_covers_all_sixteen_rows() {
        // (on_leash, pooping, need, ball, anchor, frozen, speed, allow_ball, force_state)
        let rows: [(bool, bool, bool, bool, bool, bool, f32, bool, Option<DogStateId>); 16] = [
            (false, false, false, false, false, false, 1.0, false, None),
            (false, false, false, true, false, false, 1.0, true, None),
            (
                false,
                false,
                true,
                false,
                false,
                false,
                NEED_SPEED_MULTIPLIER,
                false,
                None,
            ),
            (
                false,
                false,
                true,
                true,
                false,
                false,
                NEED_SPEED_MULTIPLIER,
                false,
                None,
            ),
            (
                false,
                true,
                false,
                false,
                false,
                false,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Poop),
            ),
            (
                false,
                true,
                false,
                true,
                false,
                false,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Poop),
            ),
            (
                false,
                true,
                true,
                false,
                false,
                false,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Poop),
            ),
            (
                false,
                true,
                true,
                true,
                false,
                false,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Poop),
            ),
            (
                true,
                false,
                false,
                false,
                false,
                false,
                1.0,
                false,
                Some(DogStateId::Heel),
            ),
            (
                true,
                false,
                false,
                true,
                false,
                false,
                1.0,
                false,
                Some(DogStateId::Heel),
            ),
            (
                true,
                false,
                true,
                false,
                true,
                false,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Heel),
            ),
            (
                true,
                false,
                true,
                true,
                true,
                false,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Heel),
            ),
            (
                true,
                true,
                false,
                false,
                true,
                true,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Poop),
            ),
            (
                true,
                true,
                false,
                true,
                true,
                true,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Poop),
            ),
            (
                true,
                true,
                true,
                false,
                true,
                true,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Poop),
            ),
            (
                true,
                true,
                true,
                true,
                true,
                true,
                NEED_SPEED_MULTIPLIER,
                false,
                Some(DogStateId::Poop),
            ),
        ];

        for (on_leash, pooping, need, ball, anchor, frozen, speed, allow_ball, force_state) in rows {
            let case = (on_leash, pooping, need, ball);
            let d = resolve_discrete_combo(combo(on_leash, pooping, need, ball));
            assert_eq!(d.anchor_leash, anchor, "anchor for {:?}", case);
            assert_eq!(d.owner_frozen, frozen, "frozen for {:?}", case);
            assert_eq!(d.speed_multiplier, speed, "speed for {:?}", case);
            assert_eq!(d.allow_ball_fetch, allow_ball, "ball for {:?}", case);
            assert_eq!(d.force_state, force_state, "state for {:?}", case);
        }
    }

    #[test]
    fn leash_speed_multiplier_does_not_stack() {
        assert_eq!(
            resolve_discrete_combo(combo(false, false, true, false)).speed_multiplier,
            NEED_SPEED_MULTIPLIER
        );
        assert_eq!(
            resolve_discrete_combo(combo(false, true, true, false)).speed_multiplier,
            NEED_SPEED_MULTIPLIER
        );
        assert_eq!(
            resolve_discrete_combo(combo(true, false, true, false)).speed_multiplier,
            NEED_SPEED_MULTIPLIER
        );
        assert_eq!(
            resolve_discrete_combo(combo(true, true, true, true)).speed_multiplier,
            NEED_SPEED_MULTIPLIER
        );
    }

    #[test]
    fn compute_leash_slot_defaults_to_left_slot() {
        let slot = compute_leash_slot(0.0, 0.0, 0.0, 0.0, 0.0, 10.5, 0.0);
        assert!(approx(slot.forward_lead, 48.0));
        assert!(approx(slot.target_x, 48.0));
        assert!(approx(slot.target_y, -12.5));
        assert!(approx(slot.lateral_clearance, 2.0));
        assert!(approx(slot.shoulder_margin, 2.0));
    }

    #[test]
    fn compute_leash_slot_respects_preferred_side_sign() {
        let left = compute_leash_slot(10.0, 20.0, 0.0, 0.0, 0.0, 10.5, -1.0);
        assert!(approx(left.target_x, 58.0));
        assert!(approx(left.target_y, 7.5));

        let right = compute_leash_slot(10.0, 20.0, 0.0, 0.0, 0.0, 10.5, 1.0);
        assert!(approx(right.target_x, 58.0));
        assert!(approx(right.target_y, 32.5));
    }

    #[test]
    fn compute_leash_slot_applies_velocity_feed_forward() {
        let slot = compute_leash_slot(0.0, 0.0, 10.0, 0.0, 0.0, 10.5, 0.0);
        assert!(approx(slot.forward_lead, 49.2));
        assert!(approx(slot.target_x, 49.2));
    }

    #[test]
    fn compute_leash_slot_clamps_forward_lead() {
        let fast = compute_leash_slot(0.0, 0.0, 1000.0, 0.0, 0.0, 10.5, 0.0);
        assert!(approx(fast.forward_lead, LEASH_FORWARD_MAX));

        let slow = compute_leash_slot(0.0, 0.0, -1000.0, 0.0, 0.0, 10.5, 0.0);
        assert!(approx(slow.forward_lead, LEASH_FORWARD_MIN));
    }

    #[test]
    fn compute_leash_slot_sanitises_non_finite_inputs() {
        let slot = compute_leash_slot(
            f32::NAN,
            f32::INFINITY,
            f32::NAN,
            0.0,
            f32::NAN,
            10.5,
            f32::NAN,
        );
        assert!(slot.target_x.is_finite());
        assert!(slot.target_y.is_finite());
        assert!(approx(slot.forward_lead, 48.0));
    }

    #[test]
    fn write_leash_slot_writes_target_slots() {
        let mut buffer = make_buffer();
        let slot = LeashSlot {
            target_x: 12.0,
            target_y: -9.0,
            forward_lead: 48.0,
            lateral_clearance: 2.0,
            shoulder_margin: 2.0,
        };
        write_leash_slot(&mut buffer, &slot);
        assert!(approx(buffer.slots[DOG_BUF_TARGET_SLOT_X], 12.0));
        assert!(approx(buffer.slots[DOG_BUF_TARGET_SLOT_Y], -9.0));
    }

    #[test]
    fn dog_is_clamped_at_max_leash_length() {
        let mut buffer = make_buffer();
        place(&mut buffer, (100.0, 0.0), (0.0, 0.0), true);

        let out = constrain_leash_and_owner(&mut buffer, &decision(false, false));

        assert!(out.dog_was_clamped);
        assert!(!out.owner_was_clamped);
        assert!(approx(out.dog_clamped_x, MAX_LEASH_LENGTH));
        assert!(approx(out.dog_clamped_y, 0.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_X], MAX_LEASH_LENGTH));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_X], 0.0));
        assert!(out.is_pulling_leash);
        assert!(out.leash_taut);
        assert!(approx(out.leash_tension, 1.0));
    }

    #[test]
    fn owner_is_clamped_at_max_leash_length_when_anchored() {
        let mut buffer = make_buffer();
        place(&mut buffer, (100.0, 0.0), (0.0, 0.0), true);

        let out = constrain_leash_and_owner(&mut buffer, &decision(true, false));

        assert!(!out.dog_was_clamped);
        assert!(out.owner_was_clamped);
        assert!(approx(out.owner_clamped_x, 100.0 - MAX_LEASH_LENGTH));
        assert!(approx(out.owner_clamped_y, 0.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_X], 100.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_X], 47.5));
    }

    #[test]
    fn off_leash_produces_zero_leash_outputs() {
        let mut buffer = make_buffer();
        place(&mut buffer, (200.0, 30.0), (5.0, -7.0), false);
        buffer.slots[DOG_BUF_LEASH_TENSION] = 0.9;
        buffer.slots[DOG_BUF_LEASH_FLAGS] = 3.0;
        buffer.slots[DOG_BUF_OWNER_FLAGS] = 3.0;

        let out = constrain_leash_and_owner(&mut buffer, &decision(false, false));

        assert!(!out.dog_was_clamped);
        assert!(!out.owner_was_clamped);
        assert!(!out.is_pulling_leash);
        assert!(!out.leash_taut);
        assert!(approx(out.leash_tension, 0.0));
        assert!(approx(out.leash_sag_px, 0.0));
        assert!(approx(out.leash_vibration_px, 0.0));
        assert!(approx(out.owner_clamped_x, 5.0));
        assert!(approx(out.owner_clamped_y, -7.0));
        assert!(approx(buffer.slots[DOG_BUF_LEASH_TENSION], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_LEASH_SAG_PX], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_LEASH_VIBRATION_PX], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_LEASH_FLAGS], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_FLAGS], 0.0));
    }

    #[test]
    fn leash_tension_sag_and_vibration_track_distance() {
        let mut taut_buffer = make_buffer();
        place(&mut taut_buffer, (45.0, 0.0), (0.0, 0.0), true);
        let taut = constrain_leash_and_owner(&mut taut_buffer, &decision(false, false));
        let expected_tension = (45.0 - LEASH_SOFT_SPRING_LENGTH)
            / (MAX_LEASH_LENGTH - LEASH_SOFT_SPRING_LENGTH);
        assert!(taut.is_pulling_leash);
        assert!(!taut.leash_taut);
        assert!(approx(taut.leash_tension, expected_tension));
        assert!(approx(taut.leash_sag_px, 0.0));
        assert!(approx(taut.leash_vibration_px, 0.5 + 0.5 * expected_tension));

        let mut slack_buffer = make_buffer();
        place(&mut slack_buffer, (30.0, 0.0), (0.0, 0.0), true);
        let slack = constrain_leash_and_owner(&mut slack_buffer, &decision(false, false));
        assert!(!slack.is_pulling_leash);
        assert!(!slack.leash_taut);
        assert!(approx(slack.leash_tension, 0.0));
        assert!(approx(slack.leash_sag_px, LEASH_SOFT_SPRING_LENGTH - 30.0));
        assert!(approx(slack.leash_vibration_px, 0.0));
        assert!(approx(slack_buffer.slots[DOG_BUF_LEASH_SAG_PX], 9.0));
    }

    #[test]
    fn leash_flags_pack_pulling_and_taut() {
        let mut taut = make_buffer();
        place(&mut taut, (60.0, 0.0), (0.0, 0.0), true);
        let out = constrain_leash_and_owner(&mut taut, &decision(false, false));
        assert!(out.is_pulling_leash);
        assert!(out.leash_taut);
        let expected = (DOG_LEASH_FLAG_PULLING | DOG_LEASH_FLAG_TAUT) as f32;
        assert!(approx(taut.slots[DOG_BUF_LEASH_FLAGS], expected));

        let mut loose = make_buffer();
        place(&mut loose, (10.0, 0.0), (0.0, 0.0), true);
        constrain_leash_and_owner(&mut loose, &decision(false, false));
        assert!(approx(loose.slots[DOG_BUF_LEASH_FLAGS], 0.0));

        let mut pulling_only = make_buffer();
        place(&mut pulling_only, (45.0, 0.0), (0.0, 0.0), true);
        constrain_leash_and_owner(&mut pulling_only, &decision(false, false));
        assert!(approx(
            pulling_only.slots[DOG_BUF_LEASH_FLAGS],
            DOG_LEASH_FLAG_PULLING as f32
        ));
    }

    #[test]
    fn owner_freeze_and_clamp_set_owner_flags() {
        let mut buffer = make_buffer();
        place(&mut buffer, (100.0, 0.0), (0.0, 0.0), true);

        let out = constrain_leash_and_owner(&mut buffer, &decision(true, true));

        assert!(out.owner_was_clamped);
        assert!(out.owner_frozen);
        let expected = (DOG_OWNER_FLAG_WAS_CLAMPED | DOG_OWNER_FLAG_FROZEN) as f32;
        assert!(approx(buffer.slots[DOG_BUF_OWNER_FLAGS], expected));

        // Freeze alone (no clamp) still reports the frozen flag.
        let mut frozen_only = make_buffer();
        place(&mut frozen_only, (10.0, 0.0), (0.0, 0.0), true);
        constrain_leash_and_owner(&mut frozen_only, &decision(true, true));
        assert!(approx(
            frozen_only.slots[DOG_BUF_OWNER_FLAGS],
            DOG_OWNER_FLAG_FROZEN as f32
        ));
    }

    #[test]
    fn off_leash_sanitizes_non_finite_positions() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = f32::NAN;
        buffer.slots[DOG_BUF_DOG_Y] = f32::INFINITY;
        buffer.slots[DOG_BUF_OWNER_X] = f32::NEG_INFINITY;
        buffer.slots[DOG_BUF_OWNER_Y] = f32::NAN;
        buffer.slots[DOG_BUF_IS_ON_LEASH] = 0.0;

        // Deliberately pass a frozen decision to prove off-leash always reports false.
        let out = constrain_leash_and_owner(&mut buffer, &decision(false, true));

        assert!(!out.owner_frozen);
        assert!(approx(out.dog_clamped_x, 0.0));
        assert!(approx(out.dog_clamped_y, 0.0));
        assert!(buffer.slots[DOG_BUF_DOG_X].is_finite());
        assert!(buffer.slots[DOG_BUF_DOG_Y].is_finite());
        assert!(buffer.slots[DOG_BUF_OWNER_CLAMPED_X].is_finite());
        assert!(buffer.slots[DOG_BUF_OWNER_CLAMPED_Y].is_finite());
        assert!(approx(buffer.slots[DOG_BUF_DOG_X], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_X], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_Y], 0.0));
    }

    #[test]
    fn on_leash_sanitizes_non_finite_positions() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = f32::INFINITY;
        buffer.slots[DOG_BUF_DOG_Y] = f32::NAN;
        buffer.slots[DOG_BUF_OWNER_X] = f32::NAN;
        buffer.slots[DOG_BUF_OWNER_Y] = f32::INFINITY;
        buffer.slots[DOG_BUF_OWNER_HEADING] = f32::NAN;
        buffer.slots[DOG_BUF_IS_ON_LEASH] = 1.0;

        let out = constrain_leash_and_owner(&mut buffer, &decision(false, false));

        assert!(out.dog_clamped_x.is_finite());
        assert!(out.dog_clamped_y.is_finite());
        assert!(out.owner_clamped_x.is_finite());
        assert!(out.owner_clamped_y.is_finite());
        assert!(buffer.slots[DOG_BUF_DOG_X].is_finite());
        assert!(buffer.slots[DOG_BUF_DOG_Y].is_finite());
        assert!(buffer.slots[DOG_BUF_OWNER_CLAMPED_X].is_finite());
        assert!(buffer.slots[DOG_BUF_OWNER_CLAMPED_Y].is_finite());
        assert!(approx(buffer.slots[DOG_BUF_DOG_X], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_X], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_Y], 0.0));
    }

    #[test]
    fn apply_leash_and_needs_off_leash_sanitizes_non_finite_positions() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = f32::NAN;
        buffer.slots[DOG_BUF_DOG_Y] = f32::INFINITY;
        buffer.slots[DOG_BUF_OWNER_X] = f32::NEG_INFINITY;
        buffer.slots[DOG_BUF_OWNER_Y] = f32::NAN;
        buffer.slots[DOG_BUF_OWNER_HEADING] = f32::NAN;
        buffer.slots[DOG_BUF_OWNER_HALF_WIDTH] = f32::NAN;
        buffer.slots[DOG_BUF_PREFERRED_SIDE_SIGN] = f32::NAN;
        buffer.slots[DOG_BUF_IS_ON_LEASH] = 0.0;

        apply_leash_and_needs(&mut buffer, combo(false, false, false, false));

        assert!(buffer.slots[DOG_BUF_TARGET_SLOT_X].is_finite());
        assert!(buffer.slots[DOG_BUF_TARGET_SLOT_Y].is_finite());
        assert!(approx(buffer.slots[DOG_BUF_DOG_X], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_X], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_Y], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_FLAGS], 0.0));
    }

    #[test]
    fn apply_leash_and_needs_on_leash_sanitizes_non_finite_positions() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = f32::INFINITY;
        buffer.slots[DOG_BUF_DOG_Y] = f32::NAN;
        buffer.slots[DOG_BUF_OWNER_X] = f32::NAN;
        buffer.slots[DOG_BUF_OWNER_Y] = f32::NEG_INFINITY;
        buffer.slots[DOG_BUF_OWNER_HEADING] = f32::NAN;
        buffer.slots[DOG_BUF_OWNER_HALF_WIDTH] = f32::NAN;
        buffer.slots[DOG_BUF_PREFERRED_SIDE_SIGN] = f32::NAN;
        buffer.slots[DOG_BUF_IS_ON_LEASH] = 1.0;

        apply_leash_and_needs(&mut buffer, combo(true, false, false, false));

        assert!(buffer.slots[DOG_BUF_TARGET_SLOT_X].is_finite());
        assert!(buffer.slots[DOG_BUF_TARGET_SLOT_Y].is_finite());
        assert!(approx(buffer.slots[DOG_BUF_DOG_X], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_X], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_OWNER_CLAMPED_Y], 0.0));
    }

    #[test]
    fn apply_leash_and_needs_wires_pipeline_together() {
        let mut buffer = make_buffer();
        place(&mut buffer, (0.0, 0.0), (0.0, 0.0), true);
        buffer.slots[DOG_BUF_OWNER_HEADING] = 0.0;
        buffer.slots[DOG_BUF_OWNER_HALF_WIDTH] = 10.5;
        buffer.slots[DOG_BUF_PREFERRED_SIDE_SIGN] = 0.0;

        let d = apply_leash_and_needs(&mut buffer, combo(true, false, false, false));

        assert_eq!(d.force_state, Some(DogStateId::Heel));
        assert!(!d.anchor_leash);
        assert!(approx(buffer.slots[DOG_BUF_TARGET_SLOT_X], 48.0));
        assert!(approx(buffer.slots[DOG_BUF_TARGET_SLOT_Y], -12.5));
    }

    fn leash_ctx(owner: (f32, f32), max_len: f32) -> DogLeashNeedsContext {
        DogLeashNeedsContext {
            owner_x: owner.0,
            owner_y: owner.1,
            leash_max_length: max_len,
            field_min_x: -1000.0,
            field_min_y: -1000.0,
            field_max_x: 1000.0,
            field_max_y: 1000.0,
        }
    }

    #[test]
    fn step_dog_leash_needs_projects_dog_when_taut() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 100.0;
        buffer.slots[DOG_BUF_DOG_Y] = 0.0;
        buffer.slots[DOG_BUF_DOG_ANGLE] = 0.75;

        let ctx = leash_ctx((0.0, 0.0), 50.0);
        let events = step_dog_leash_needs(&mut buffer, &ctx, 0.016);

        assert_eq!(events & DOG_EVENT_LEASH_TAUT, DOG_EVENT_LEASH_TAUT);
        assert!(approx(buffer.slots[DOG_BUF_DOG_X], 50.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_LEASH_TENSION], 1.0));
        // Heading preserved.
        assert!(approx(buffer.slots[DOG_BUF_DOG_ANGLE], 0.75));
    }

    #[test]
    fn step_dog_leash_needs_slack_decays_and_emits_only_on_transition() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 10.0;
        buffer.slots[DOG_BUF_DOG_Y] = 0.0;
        buffer.slots[DOG_BUF_LEASH_TENSION] = 0.1;

        let ctx = leash_ctx((0.0, 0.0), 50.0);

        // First step: tension decays but stays positive -> no slack event.
        let events = step_dog_leash_needs(&mut buffer, &ctx, 0.1);
        assert_eq!(events & DOG_EVENT_LEASH_SLACK, 0);
        assert!(approx(buffer.slots[DOG_BUF_LEASH_TENSION], 0.075));

        // Second step: tension reaches 0.0 -> slack event emitted.
        let events = step_dog_leash_needs(&mut buffer, &ctx, 1.0);
        assert_eq!(events & DOG_EVENT_LEASH_SLACK, DOG_EVENT_LEASH_SLACK);
        assert!(approx(buffer.slots[DOG_BUF_LEASH_TENSION], 0.0));

        // Third step: already zero -> no further slack event.
        let events = step_dog_leash_needs(&mut buffer, &ctx, 1.0);
        assert_eq!(events & DOG_EVENT_LEASH_SLACK, 0);
    }

    #[test]
    fn step_dog_leash_needs_zero_leash_snaps_to_owner() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 30.0;
        buffer.slots[DOG_BUF_DOG_Y] = -20.0;

        let ctx = leash_ctx((5.0, 7.0), 0.0);
        let events = step_dog_leash_needs(&mut buffer, &ctx, 0.016);

        assert_eq!(events & DOG_EVENT_LEASH_TAUT, DOG_EVENT_LEASH_TAUT);
        assert!(approx(buffer.slots[DOG_BUF_DOG_X], 5.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 7.0));
        assert!(approx(buffer.slots[DOG_BUF_LEASH_TENSION], 1.0));
    }

    #[test]
    fn step_dog_leash_needs_clamps_to_field_bounds() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 500.0;
        buffer.slots[DOG_BUF_DOG_Y] = -500.0;

        let ctx = DogLeashNeedsContext {
            owner_x: 0.0,
            owner_y: 0.0,
            leash_max_length: 1000.0,
            field_min_x: -100.0,
            field_min_y: -100.0,
            field_max_x: 100.0,
            field_max_y: 100.0,
        };
        step_dog_leash_needs(&mut buffer, &ctx, 0.016);

        assert!(approx(buffer.slots[DOG_BUF_DOG_X], 100.0));
        assert!(approx(buffer.slots[DOG_BUF_DOG_Y], -100.0));
    }

    #[test]
    fn step_dog_leash_needs_invalid_dt_does_not_mutate() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 100.0;
        buffer.slots[DOG_BUF_DOG_Y] = 0.0;
        buffer.slots[DOG_BUF_LEASH_TENSION] = 0.5;
        buffer.slots[DOG_BUF_EVENT_BITMASK] = 7.0;

        let ctx = leash_ctx((0.0, 0.0), 50.0);

        for bad_dt in [0.0_f32, -1.0, f32::NAN, f32::INFINITY] {
            let events = step_dog_leash_needs(&mut buffer, &ctx, bad_dt);
            assert_eq!(events, 7);
            assert!(approx(buffer.slots[DOG_BUF_DOG_X], 100.0));
            assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 0.0));
            assert!(approx(buffer.slots[DOG_BUF_LEASH_TENSION], 0.5));
        }
    }

    #[test]
    fn step_dog_leash_needs_handles_inverted_field_bounds() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 500.0;
        buffer.slots[DOG_BUF_DOG_Y] = -500.0;

        // field_min > field_max on both axes: must not panic.
        let ctx = DogLeashNeedsContext {
            owner_x: 0.0,
            owner_y: 0.0,
            leash_max_length: 1000.0,
            field_min_x: 100.0,
            field_min_y: 100.0,
            field_max_x: -100.0,
            field_max_y: -100.0,
        };
        step_dog_leash_needs(&mut buffer, &ctx, 0.016);

        // Bounds are normalised, so the dog lands inside [-100, 100].
        assert!(buffer.slots[DOG_BUF_DOG_X].is_finite());
        assert!(buffer.slots[DOG_BUF_DOG_Y].is_finite());
        assert!(buffer.slots[DOG_BUF_DOG_X] >= -100.0 && buffer.slots[DOG_BUF_DOG_X] <= 100.0);
        assert!(buffer.slots[DOG_BUF_DOG_Y] >= -100.0 && buffer.slots[DOG_BUF_DOG_Y] <= 100.0);
    }

    #[test]
    fn step_dog_leash_needs_invalid_dt_returns_current_bitmask() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 100.0;
        buffer.slots[DOG_BUF_DOG_Y] = 0.0;
        buffer.slots[DOG_BUF_LEASH_TENSION] = 0.5;
        buffer.slots[DOG_BUF_EVENT_BITMASK] = 123.0;

        let ctx = leash_ctx((0.0, 0.0), 50.0);

        for bad_dt in [0.0_f32, -1.0, f32::NAN, f32::INFINITY] {
            let events = step_dog_leash_needs(&mut buffer, &ctx, bad_dt);
            assert_eq!(events, 123);
            assert!(approx(buffer.slots[DOG_BUF_DOG_X], 100.0));
            assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 0.0));
            assert!(approx(buffer.slots[DOG_BUF_LEASH_TENSION], 0.5));
            assert!(approx(buffer.slots[DOG_BUF_EVENT_BITMASK], 123.0));
        }
    }

    #[test]
    fn step_dog_leash_needs_does_not_overwrite_event_bitmask() {
        let mut buffer = make_buffer();
        buffer.slots[DOG_BUF_DOG_X] = 100.0;
        buffer.slots[DOG_BUF_EVENT_BITMASK] = 42.0;

        let ctx = leash_ctx((0.0, 0.0), 50.0);
        let events = step_dog_leash_needs(&mut buffer, &ctx, 0.016);

        assert_eq!(events & DOG_EVENT_LEASH_TAUT, DOG_EVENT_LEASH_TAUT);
        assert!(approx(buffer.slots[DOG_BUF_EVENT_BITMASK], 42.0));
    }

    #[test]
    fn leash_events_distinct_from_state_machine_events() {
        let leash = [DOG_EVENT_LEASH_TAUT, DOG_EVENT_LEASH_SLACK];
        let state = [
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
        for l in leash.iter() {
            for s in state.iter() {
                assert_ne!(l, s);
            }
        }
    }

    #[test]
    fn apply_leash_and_needs_clamps_dog_when_unanchored() {
        let mut buffer = make_buffer();
        place(&mut buffer, (120.0, 0.0), (0.0, 0.0), true);
        buffer.slots[DOG_BUF_OWNER_HEADING] = 0.0;
        buffer.slots[DOG_BUF_OWNER_HALF_WIDTH] = 10.5;

        apply_leash_and_needs(&mut buffer, combo(true, false, false, false));

        assert!(approx(buffer.slots[DOG_BUF_DOG_X], MAX_LEASH_LENGTH));
        assert!(approx(buffer.slots[DOG_BUF_DOG_Y], 0.0));
        assert!(approx(buffer.slots[DOG_BUF_LEASH_TENSION], 1.0));
    }
}
