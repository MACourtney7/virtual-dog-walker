//! Care simulation: timers, need progression, and action processing.
//!
//! The backing storage, [`CareSimBuffer`], is defined in
//! [`crate::world_contract`] as a fixed-size `[f32; 32]` slot array
//! (`CareSimBuffer::data`). This module defines the slot layout
//! (`CARE_SLOT_*`), command bitmask (`CARE_CMD_*`), event bitmask
//! (`CARE_EVENT_*`), and the allocation-free per-tick step that advances
//! timers and recomputes need flags on top of `CareSimBuffer::data`.

use crate::world_contract::CareSimBuffer;

// ---------------------------------------------------------------------------
// Slot layout (indices into `CareSimBuffer::data`).
// ---------------------------------------------------------------------------

/// Milliseconds elapsed in the current step (clamped to `0.0..=1000.0`).
pub const CARE_SLOT_LAST_STEP_DT_MS: usize = 0;
/// Monotonic simulation clock in milliseconds.
pub const CARE_SLOT_NOW_MS: usize = 1;
/// Elapsed hunger timer in milliseconds.
pub const CARE_SLOT_HUNGER_ELAPSED_MS: usize = 2;
/// Remaining hunger timer in milliseconds (floored at zero).
pub const CARE_SLOT_HUNGER_REMAINING_MS: usize = 3;
/// Elapsed grooming timer in milliseconds.
pub const CARE_SLOT_GROOMING_ELAPSED_MS: usize = 4;
/// Remaining grooming timer in milliseconds (floored at zero).
pub const CARE_SLOT_GROOMING_REMAINING_MS: usize = 5;
/// Elapsed tiredness timer in milliseconds.
pub const CARE_SLOT_TIREDNESS_ELAPSED_MS: usize = 6;
/// Remaining tiredness timer in milliseconds (floored at zero).
pub const CARE_SLOT_TIREDNESS_REMAINING_MS: usize = 7;
/// `1.0` when the dog is hungry, else `0.0`.
pub const CARE_SLOT_IS_HUNGRY: usize = 8;
/// `1.0` when the dog needs grooming, else `0.0`.
pub const CARE_SLOT_NEEDS_GROOMING: usize = 9;
/// `1.0` when the dog is tired, else `0.0`.
pub const CARE_SLOT_IS_TIRED: usize = 10;
/// Command bitmask written by the host (see `CARE_CMD_*`).
pub const CARE_SLOT_ACTION_FLAGS: usize = 11;
/// Event bitmask produced by the last step (see `CARE_EVENT_*`).
pub const CARE_SLOT_EVENT_BITMASK: usize = 12;
/// Remaining rejection animation timer in milliseconds.
pub const CARE_SLOT_REJECTION_ANIM_TIMER_MS: usize = 13;
/// Remaining feed flash timer in milliseconds.
pub const CARE_SLOT_FEED_FLASH_TIMER_MS: usize = 14;
/// Remaining groom flash timer in milliseconds.
pub const CARE_SLOT_GROOM_FLASH_TIMER_MS: usize = 15;
/// Remaining rest flash timer in milliseconds.
pub const CARE_SLOT_REST_FLASH_TIMER_MS: usize = 16;
/// Timestamp (ms) of the last feed action, or `-1.0` if never fed.
pub const CARE_SLOT_HUNGER_LAST_FED_MS: usize = 17;
/// Timestamp (ms) of the last groom action, or `-1.0` if never groomed.
pub const CARE_SLOT_GROOMING_LAST_GROOMED_MS: usize = 18;
/// Timestamp (ms) of the last rest action, or `-1.0` if never rested.
pub const CARE_SLOT_TIREDNESS_LAST_RESTED_MS: usize = 19;
/// Timestamp (ms) of the last accepted action, or `-1.0` if none.
pub const CARE_SLOT_LAST_ACTION_ELAPSED_MS: usize = 20;
/// Number of accepted feed actions.
pub const CARE_SLOT_FEED_COUNT: usize = 21;
/// Number of accepted groom actions.
pub const CARE_SLOT_GROOM_COUNT: usize = 22;
/// Number of accepted rest actions.
pub const CARE_SLOT_REST_COUNT: usize = 23;
/// Last processed action kind (see `CARE_ACTION_*`).
pub const CARE_SLOT_LAST_ACTION: usize = 24;
/// Current UI toast kind (see `CARE_TOAST_*`).
pub const CARE_SLOT_UI_TOAST_KIND: usize = 25;
/// Current rejection kind (see `CARE_REJECTION_*`).
pub const CARE_SLOT_REJECTION_KIND: usize = 26;
/// Hunger need duration in milliseconds (host-overridable).
pub const CARE_SLOT_HUNGER_DURATION_MS: usize = 27;
/// Grooming need duration in milliseconds (host-overridable).
pub const CARE_SLOT_GROOMING_DURATION_MS: usize = 28;
/// Tiredness need duration in milliseconds (host-overridable).
pub const CARE_SLOT_TIREDNESS_DURATION_MS: usize = 29;

// ---------------------------------------------------------------------------
// Command bitmask.
// ---------------------------------------------------------------------------

/// Host command: feed the dog.
pub const CARE_CMD_FEED: u32 = 1 << 0;
/// Host command: groom the dog.
pub const CARE_CMD_GROOM: u32 = 1 << 1;
/// Host command: rest the dog.
pub const CARE_CMD_REST: u32 = 1 << 2;
/// Host command: reset the care simulation.
pub const CARE_CMD_RESET: u32 = 1 << 3;

// ---------------------------------------------------------------------------
// Event bitmask.
// ---------------------------------------------------------------------------

/// Emitted when the dog transitions from not-hungry to hungry.
pub const CARE_EVENT_HUNGER_STARTED: u32 = 1 << 0;
/// Emitted when the dog transitions from not-needing-grooming to needing it.
pub const CARE_EVENT_GROOMING_NEEDED: u32 = 1 << 1;
/// Emitted when the dog transitions from not-tired to tired.
pub const CARE_EVENT_TIREDNESS_STARTED: u32 = 1 << 2;
/// Emitted when the rejection animation timer crosses from positive to zero.
pub const CARE_EVENT_REJECTION_ANIM_FINISHED: u32 = 1 << 3;
/// Emitted when a feed action is accepted.
pub const CARE_EVENT_FEED_ACCEPTED: u32 = 1 << 4;
/// Emitted when a groom action is accepted.
pub const CARE_EVENT_GROOM_ACCEPTED: u32 = 1 << 5;
/// Emitted when a rest action is accepted.
pub const CARE_EVENT_REST_ACCEPTED: u32 = 1 << 6;
/// Emitted when the hunger need is resolved by a feed.
pub const CARE_EVENT_HUNGER_RESOLVED: u32 = 1 << 7;
/// Emitted when the grooming need is resolved by a groom.
pub const CARE_EVENT_GROOMING_RESOLVED: u32 = 1 << 8;
/// Emitted when the tiredness need is resolved by a rest.
pub const CARE_EVENT_TIREDNESS_RESOLVED: u32 = 1 << 9;
/// Emitted when an action is rejected.
pub const CARE_EVENT_ACTION_REJECTED: u32 = 1 << 10;
/// Emitted when a UI flash effect is triggered.
pub const CARE_EVENT_UI_FLASH: u32 = 1 << 11;
/// Emitted when a UI toast should be shown.
pub const CARE_EVENT_TOAST: u32 = 1 << 12;
/// Emitted when the care simulation is reset.
pub const CARE_EVENT_RESET: u32 = 1 << 13;

// ---------------------------------------------------------------------------
// Action kinds (stored in `CARE_SLOT_LAST_ACTION`).
// ---------------------------------------------------------------------------

/// No action has been processed.
pub const CARE_ACTION_NONE: f32 = 0.0;
/// The feed action.
pub const CARE_ACTION_FEED: f32 = 1.0;
/// The groom action.
pub const CARE_ACTION_GROOM: f32 = 2.0;
/// The rest action.
pub const CARE_ACTION_REST: f32 = 3.0;
/// The reset action.
pub const CARE_ACTION_RESET: f32 = 4.0;

// ---------------------------------------------------------------------------
// Toast kinds (stored in `CARE_SLOT_UI_TOAST_KIND`).
// ---------------------------------------------------------------------------

/// No toast.
pub const CARE_TOAST_NONE: f32 = 0.0;
/// Toast shown after a successful feed.
pub const CARE_TOAST_FED: f32 = 1.0;
/// Toast shown after a successful groom.
pub const CARE_TOAST_GROOMED: f32 = 2.0;
/// Toast shown after a successful rest.
pub const CARE_TOAST_RESTED: f32 = 3.0;
/// Toast shown when a feed is rejected because the dog is not hungry.
pub const CARE_TOAST_REJECTED_HUNGRY: f32 = 4.0;
/// Toast shown when a groom is rejected because the dog is not dirty.
pub const CARE_TOAST_REJECTED_GROOM: f32 = 5.0;
/// Toast shown when a rest is rejected because the dog is not tired.
pub const CARE_TOAST_REJECTED_REST: f32 = 6.0;
/// Toast shown after a reset.
pub const CARE_TOAST_RESET: f32 = 7.0;

// ---------------------------------------------------------------------------
// Rejection kinds (stored in `CARE_SLOT_REJECTION_KIND`).
// ---------------------------------------------------------------------------

/// No rejection.
pub const CARE_REJECTION_NONE: f32 = 0.0;
/// Feed rejected because the dog is not hungry.
pub const CARE_REJECTION_NOT_HUNGRY: f32 = 1.0;
/// Groom rejected because the dog is not dirty.
pub const CARE_REJECTION_NOT_DIRTY: f32 = 2.0;
/// Rest rejected because the dog is not tired.
pub const CARE_REJECTION_NOT_TIRED: f32 = 3.0;

// ---------------------------------------------------------------------------
// Default durations and flash timers (milliseconds).
// ---------------------------------------------------------------------------

/// Default time for the hunger need to fully develop.
pub const DEFAULT_HUNGER_DURATION_MS: f32 = 120_000.0;
/// Default time for the grooming need to fully develop.
pub const DEFAULT_GROOMING_DURATION_MS: f32 = 180_000.0;
/// Default time for the tiredness need to fully develop.
pub const DEFAULT_TIREDNESS_DURATION_MS: f32 = 180_000.0;
/// Duration of the rejection animation.
pub const REJECTION_ANIM_MS: f32 = 500.0;
/// Duration of the feed flash effect.
pub const FEED_FLASH_MS: f32 = 500.0;
/// Duration of the groom flash effect.
pub const GROOM_FLASH_MS: f32 = 500.0;
/// Duration of the rest flash effect.
pub const REST_FLASH_MS: f32 = 500.0;

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/// Clamp an incoming `dt_ms` to `[0.0, 1000.0]`, mapping NaN/inf to `0.0`.
fn sanitize_dt_ms(raw: f32) -> f32 {
    if raw.is_finite() {
        raw.clamp(0.0, 1000.0)
    } else {
        0.0
    }
}

/// Saturating `f32` addition that never produces a non-finite result.
fn saturating_add(a: f32, b: f32) -> f32 {
    let sum = a + b;
    if sum.is_finite() {
        sum
    } else {
        f32::MAX
    }
}

/// Read a slot as a boolean (`> 0.5`).
fn slot_bool(buf: &CareSimBuffer, index: usize) -> bool {
    buf.data[index] > 0.5
}

/// Write a boolean into a slot as `1.0`/`0.0`.
fn write_bool(buf: &mut CareSimBuffer, index: usize, value: bool) {
    buf.data[index] = if value { 1.0 } else { 0.0 };
}

/// Read a duration slot.
///
/// The buffer value is used directly when it is finite and strictly positive
/// (`> 0.0`); otherwise `default` is returned. Callers compute remaining
/// values as `(duration - elapsed).max(0.0)`, so remaining is always clamped
/// at `0.0`.
fn duration_slot(buf: &CareSimBuffer, index: usize, default: f32) -> f32 {
    let value = buf.data[index];
    if value.is_finite() && value > 0.0 {
        value
    } else {
        default
    }
}

/// Process host action commands.
///
/// Reads the command bitmask once, applies reset priority, then processes
/// feed -> groom -> rest in order. Returns the OR of action-related events.
fn process_actions(buf: &mut CareSimBuffer) -> u32 {
    let flags = buf.data[CARE_SLOT_ACTION_FLAGS] as u32;
    if flags == 0 {
        return 0;
    }

    let mut events: u32 = 0;

    // Reset wins and suppresses all other action bits in the same step.
    if flags & CARE_CMD_RESET != 0 {
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0.0;

        // Remaining values are recomputed by the next step from the zeroed
        // elapsed counters; do not write them here.

        buf.data[CARE_SLOT_IS_HUNGRY] = 0.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 1.0;
        buf.data[CARE_SLOT_IS_TIRED] = 1.0;

        buf.data[CARE_SLOT_HUNGER_LAST_FED_MS] = -1.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = -1.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = -1.0;
        buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = -1.0;

        buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = 0.0;
        buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS] = 0.0;
        buf.data[CARE_SLOT_GROOM_FLASH_TIMER_MS] = 0.0;
        buf.data[CARE_SLOT_REST_FLASH_TIMER_MS] = 0.0;

        buf.data[CARE_SLOT_FEED_COUNT] = 0.0;
        buf.data[CARE_SLOT_GROOM_COUNT] = 0.0;
        buf.data[CARE_SLOT_REST_COUNT] = 0.0;

        buf.data[CARE_SLOT_LAST_ACTION] = CARE_ACTION_RESET;
        buf.data[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_RESET;

        events |= CARE_EVENT_RESET | CARE_EVENT_TOAST;
        return events;
    }

    let now = buf.data[CARE_SLOT_NOW_MS];

    if flags & CARE_CMD_FEED != 0 {
        if slot_bool(buf, CARE_SLOT_IS_HUNGRY) {
            let hunger_duration =
                duration_slot(buf, CARE_SLOT_HUNGER_DURATION_MS, DEFAULT_HUNGER_DURATION_MS);
            buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 0.0;
            buf.data[CARE_SLOT_HUNGER_REMAINING_MS] = hunger_duration;
            buf.data[CARE_SLOT_HUNGER_LAST_FED_MS] = now;
            buf.data[CARE_SLOT_IS_HUNGRY] = 0.0;
            buf.data[CARE_SLOT_FEED_COUNT] = buf.data[CARE_SLOT_FEED_COUNT] + 1.0;
            buf.data[CARE_SLOT_LAST_ACTION] = CARE_ACTION_FEED;
            buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = now;
            buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS] = FEED_FLASH_MS;
            buf.data[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_FED;
            events |= CARE_EVENT_FEED_ACCEPTED
                | CARE_EVENT_HUNGER_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST;
        } else {
            buf.data[CARE_SLOT_REJECTION_KIND] = CARE_REJECTION_NOT_HUNGRY;
            buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = REJECTION_ANIM_MS;
            buf.data[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_REJECTED_HUNGRY;
            events |= CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST;
        }
    }

    if flags & CARE_CMD_GROOM != 0 {
        if slot_bool(buf, CARE_SLOT_NEEDS_GROOMING) {
            let grooming_duration = duration_slot(
                buf,
                CARE_SLOT_GROOMING_DURATION_MS,
                DEFAULT_GROOMING_DURATION_MS,
            );
            buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 0.0;
            buf.data[CARE_SLOT_GROOMING_REMAINING_MS] = grooming_duration;
            buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = now;
            buf.data[CARE_SLOT_NEEDS_GROOMING] = 0.0;
            buf.data[CARE_SLOT_GROOM_COUNT] = buf.data[CARE_SLOT_GROOM_COUNT] + 1.0;
            buf.data[CARE_SLOT_LAST_ACTION] = CARE_ACTION_GROOM;
            buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = now;
            buf.data[CARE_SLOT_GROOM_FLASH_TIMER_MS] = GROOM_FLASH_MS;
            buf.data[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_GROOMED;
            events |= CARE_EVENT_GROOM_ACCEPTED
                | CARE_EVENT_GROOMING_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST;
        } else {
            buf.data[CARE_SLOT_REJECTION_KIND] = CARE_REJECTION_NOT_DIRTY;
            buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = REJECTION_ANIM_MS;
            buf.data[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_REJECTED_GROOM;
            events |= CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST;
        }
    }

    if flags & CARE_CMD_REST != 0 {
        if slot_bool(buf, CARE_SLOT_IS_TIRED) {
            let tiredness_duration = duration_slot(
                buf,
                CARE_SLOT_TIREDNESS_DURATION_MS,
                DEFAULT_TIREDNESS_DURATION_MS,
            );
            buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0.0;
            buf.data[CARE_SLOT_TIREDNESS_REMAINING_MS] = tiredness_duration;
            buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = now;
            buf.data[CARE_SLOT_IS_TIRED] = 0.0;
            buf.data[CARE_SLOT_REST_COUNT] = buf.data[CARE_SLOT_REST_COUNT] + 1.0;
            buf.data[CARE_SLOT_LAST_ACTION] = CARE_ACTION_REST;
            buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = now;
            buf.data[CARE_SLOT_REST_FLASH_TIMER_MS] = REST_FLASH_MS;
            buf.data[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_RESTED;
            events |= CARE_EVENT_REST_ACCEPTED
                | CARE_EVENT_TIREDNESS_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST;
        } else {
            buf.data[CARE_SLOT_REJECTION_KIND] = CARE_REJECTION_NOT_TIRED;
            buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = REJECTION_ANIM_MS;
            buf.data[CARE_SLOT_UI_TOAST_KIND] = CARE_TOAST_REJECTED_REST;
            events |= CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST;
        }
    }

    events
}

// ---------------------------------------------------------------------------
// Public step API.
// ---------------------------------------------------------------------------

/// Advance the care simulation buffer by one tick.
///
/// Returns the bitmask of events emitted during this step. The function is
/// allocation-free and never produces non-finite slot values.
pub fn step_care_buffer(buf: &mut CareSimBuffer, dt_ms: f32) -> u32 {
    let dt = sanitize_dt_ms(dt_ms);
    buf.data[CARE_SLOT_LAST_STEP_DT_MS] = dt;

    // Advance the monotonic clock with saturation.
    buf.data[CARE_SLOT_NOW_MS] = saturating_add(buf.data[CARE_SLOT_NOW_MS], dt);

    // Advance need timers.
    buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] =
        saturating_add(buf.data[CARE_SLOT_HUNGER_ELAPSED_MS], dt);
    buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] =
        saturating_add(buf.data[CARE_SLOT_GROOMING_ELAPSED_MS], dt);
    buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] =
        saturating_add(buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS], dt);

    // Resolve durations from the buffer (falling back to defaults).
    let hunger_duration =
        duration_slot(buf, CARE_SLOT_HUNGER_DURATION_MS, DEFAULT_HUNGER_DURATION_MS);
    let grooming_duration =
        duration_slot(buf, CARE_SLOT_GROOMING_DURATION_MS, DEFAULT_GROOMING_DURATION_MS);
    let tiredness_duration =
        duration_slot(buf, CARE_SLOT_TIREDNESS_DURATION_MS, DEFAULT_TIREDNESS_DURATION_MS);

    // Recompute remaining values with floor-at-zero.
    buf.data[CARE_SLOT_HUNGER_REMAINING_MS] =
        (hunger_duration - buf.data[CARE_SLOT_HUNGER_ELAPSED_MS]).max(0.0);
    buf.data[CARE_SLOT_GROOMING_REMAINING_MS] =
        (grooming_duration - buf.data[CARE_SLOT_GROOMING_ELAPSED_MS]).max(0.0);
    buf.data[CARE_SLOT_TIREDNESS_REMAINING_MS] =
        (tiredness_duration - buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS]).max(0.0);

    // Recompute need flags and emit false-to-true start events.
    let mut events: u32 = 0;

    let was_hungry = slot_bool(buf, CARE_SLOT_IS_HUNGRY);
    let is_hungry = buf.data[CARE_SLOT_HUNGER_REMAINING_MS] <= 0.0;
    write_bool(buf, CARE_SLOT_IS_HUNGRY, is_hungry);
    if !was_hungry && is_hungry {
        events |= CARE_EVENT_HUNGER_STARTED;
    }

    // Grooming/tiredness needs are "never satisfied" until the first action
    // (last_* < 0.0) or once the elapsed timer reaches the duration.
    let was_grooming = slot_bool(buf, CARE_SLOT_NEEDS_GROOMING);
    let needs_grooming = buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] < 0.0
        || buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] >= grooming_duration;
    write_bool(buf, CARE_SLOT_NEEDS_GROOMING, needs_grooming);
    if !was_grooming && needs_grooming {
        events |= CARE_EVENT_GROOMING_NEEDED;
    }

    let was_tired = slot_bool(buf, CARE_SLOT_IS_TIRED);
    let is_tired = buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] < 0.0
        || buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] >= tiredness_duration;
    write_bool(buf, CARE_SLOT_IS_TIRED, is_tired);
    if !was_tired && is_tired {
        events |= CARE_EVENT_TIREDNESS_STARTED;
    }

    // Process host actions, then clear the command flags.
    events |= process_actions(buf);
    buf.data[CARE_SLOT_ACTION_FLAGS] = 0.0;

    // Decrement care timers, flooring at zero.
    let rejection_before = buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS];
    let rejection_after = (rejection_before - dt).max(0.0);
    buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = rejection_after;
    if rejection_before > 0.0 && rejection_after <= 0.0 {
        events |= CARE_EVENT_REJECTION_ANIM_FINISHED;
    }

    buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS] =
        (buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS] - dt).max(0.0);
    buf.data[CARE_SLOT_GROOM_FLASH_TIMER_MS] =
        (buf.data[CARE_SLOT_GROOM_FLASH_TIMER_MS] - dt).max(0.0);
    buf.data[CARE_SLOT_REST_FLASH_TIMER_MS] =
        (buf.data[CARE_SLOT_REST_FLASH_TIMER_MS] - dt).max(0.0);

    // Persist the accumulated event bitmask.
    buf.data[CARE_SLOT_EVENT_BITMASK] = events as f32;

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a buffer initialized to the locked care-sim defaults.
    ///
    /// `CareSimBuffer::default()` is all-zero; the locked defaults
    /// (needs_grooming=1, is_tired=1, last_*=-1) are applied by the reset
    /// path. We mirror that here so tests exercise the same starting state
    /// the host sees after construction + reset.
    fn fresh() -> CareSimBuffer {
        let mut buf = CareSimBuffer::default();
        // Elapsed counters start at zero; the `last_* = -1.0` sentinels keep
        // grooming/tiredness needs on until the first accepted action.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_HUNGER_REMAINING_MS] = DEFAULT_HUNGER_DURATION_MS;
        buf.data[CARE_SLOT_GROOMING_REMAINING_MS] = DEFAULT_GROOMING_DURATION_MS;
        buf.data[CARE_SLOT_TIREDNESS_REMAINING_MS] = DEFAULT_TIREDNESS_DURATION_MS;
        buf.data[CARE_SLOT_IS_HUNGRY] = 0.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 1.0;
        buf.data[CARE_SLOT_IS_TIRED] = 1.0;
        buf.data[CARE_SLOT_HUNGER_LAST_FED_MS] = -1.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = -1.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = -1.0;
        buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = -1.0;
        buf
    }

    #[test]
    fn care_sim_constants_are_locked() {
        assert_eq!(DEFAULT_HUNGER_DURATION_MS, 120_000.0);
        assert_eq!(DEFAULT_GROOMING_DURATION_MS, 180_000.0);
        assert_eq!(DEFAULT_TIREDNESS_DURATION_MS, 180_000.0);
        assert_eq!(REJECTION_ANIM_MS, 500.0);
        assert_eq!(FEED_FLASH_MS, 500.0);
        assert_eq!(GROOM_FLASH_MS, 500.0);
        assert_eq!(REST_FLASH_MS, 500.0);
    }

    #[test]
    fn care_sim_step_advances_timers_and_remaining() {
        let mut buf = fresh();
        let events = step_care_buffer(&mut buf, 100.0);
        assert_eq!(events, 0);
        assert_eq!(buf.data[CARE_SLOT_LAST_STEP_DT_MS], 100.0);
        assert_eq!(buf.data[CARE_SLOT_NOW_MS], 100.0);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_ELAPSED_MS], 100.0);
        assert_eq!(
            buf.data[CARE_SLOT_HUNGER_REMAINING_MS],
            DEFAULT_HUNGER_DURATION_MS - 100.0
        );
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
    }

    #[test]
    fn care_sim_non_finite_dt_is_zeroed() {
        let mut buf = fresh();
        let events = step_care_buffer(&mut buf, f32::NAN);
        assert_eq!(events, 0);
        assert_eq!(buf.data[CARE_SLOT_LAST_STEP_DT_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_NOW_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_ELAPSED_MS], 0.0);
    }

    #[test]
    fn care_sim_emits_need_start_events_once() {
        let mut buf = fresh();
        // Start with all needs off (just below the threshold) so the step
        // crosses each threshold and emits the start events. `last_*` must be
        // set so grooming/tiredness needs are governed by elapsed only.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS - 10.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = DEFAULT_GROOMING_DURATION_MS - 10.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = DEFAULT_TIREDNESS_DURATION_MS - 10.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = 0.0;
        buf.data[CARE_SLOT_IS_HUNGRY] = 0.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 0.0;
        buf.data[CARE_SLOT_IS_TIRED] = 0.0;

        let events = step_care_buffer(&mut buf, 100.0);
        assert_eq!(
            events,
            CARE_EVENT_HUNGER_STARTED
                | CARE_EVENT_GROOMING_NEEDED
                | CARE_EVENT_TIREDNESS_STARTED
        );
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 1.0);
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 1.0);
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 1.0);

        // Second step must not re-emit the start events.
        let events2 = step_care_buffer(&mut buf, 100.0);
        assert_eq!(events2, 0);
    }

    #[test]
    fn care_sim_rejection_timer_emits_finished_on_crossing() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = 50.0;
        let events = step_care_buffer(&mut buf, 100.0);
        assert_eq!(events & CARE_EVENT_REJECTION_ANIM_FINISHED, CARE_EVENT_REJECTION_ANIM_FINISHED);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], 0.0);

        // Already zero: no further event.
        let events2 = step_care_buffer(&mut buf, 100.0);
        assert_eq!(events2 & CARE_EVENT_REJECTION_ANIM_FINISHED, 0);
    }

    #[test]
    fn care_sim_clears_action_flags() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_ACTION_FLAGS] = (CARE_CMD_FEED | CARE_CMD_GROOM) as f32;
        step_care_buffer(&mut buf, 16.0);
        assert_eq!(buf.data[CARE_SLOT_ACTION_FLAGS], 0.0);
    }

    #[test]
    fn care_sim_feed_accepts_when_hungry() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_IS_HUNGRY] = 1.0;
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS;
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_FEED as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(
            events,
            CARE_EVENT_FEED_ACCEPTED
                | CARE_EVENT_HUNGER_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_ELAPSED_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_REMAINING_MS], DEFAULT_HUNGER_DURATION_MS);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_LAST_FED_MS], 16.0);
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION], CARE_ACTION_FEED);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS], 16.0);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_FED);
        // Flash timer set then decremented by dt in the same step.
        assert_eq!(buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS], FEED_FLASH_MS - 16.0);
    }

    #[test]
    fn care_sim_feed_rejects_when_not_hungry() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_FEED as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_HUNGRY);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_REJECTED_HUNGRY);
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 0.0);
        // Rejection timer set then decremented by dt in the same step.
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], REJECTION_ANIM_MS - 16.0);
    }

    #[test]
    fn care_sim_groom_accepts_when_dirty() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = DEFAULT_GROOMING_DURATION_MS;
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_GROOM as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(
            events,
            CARE_EVENT_GROOM_ACCEPTED
                | CARE_EVENT_GROOMING_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 0.0);
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION], CARE_ACTION_GROOM);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_GROOMED);
        assert_eq!(buf.data[CARE_SLOT_GROOM_FLASH_TIMER_MS], GROOM_FLASH_MS - 16.0);
    }

    #[test]
    fn care_sim_groom_rejects_when_clean() {
        let mut buf = fresh();
        // Clean dog: grooming need off (already groomed, elapsed below duration).
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = 0.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 0.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_GROOM as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_DIRTY);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_REJECTED_GROOM);
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 0.0);
    }

    #[test]
    fn care_sim_rest_accepts_when_tired() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = DEFAULT_TIREDNESS_DURATION_MS;
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_REST as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(
            events,
            CARE_EVENT_REST_ACCEPTED
                | CARE_EVENT_TIREDNESS_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 0.0);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION], CARE_ACTION_REST);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_RESTED);
        assert_eq!(buf.data[CARE_SLOT_REST_FLASH_TIMER_MS], REST_FLASH_MS - 16.0);
    }

    #[test]
    fn care_sim_rest_rejects_when_awake() {
        let mut buf = fresh();
        // Rested dog: tiredness need off (already rested, elapsed below duration).
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = 0.0;
        buf.data[CARE_SLOT_IS_TIRED] = 0.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_REST as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_TIRED);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_REJECTED_REST);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 0.0);
    }

    #[test]
    fn care_sim_reset_clears_state_and_suppresses_actions() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 1000.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 1000.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 1000.0;
        buf.data[CARE_SLOT_IS_HUNGRY] = 1.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 0.0;
        buf.data[CARE_SLOT_IS_TIRED] = 0.0;
        buf.data[CARE_SLOT_FEED_COUNT] = 5.0;
        buf.data[CARE_SLOT_GROOM_COUNT] = 5.0;
        buf.data[CARE_SLOT_REST_COUNT] = 5.0;
        buf.data[CARE_SLOT_HUNGER_LAST_FED_MS] = 123.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = 123.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = 123.0;
        buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = 123.0;
        buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS] = 100.0;
        buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = 100.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] =
            (CARE_CMD_RESET | CARE_CMD_FEED | CARE_CMD_GROOM | CARE_CMD_REST) as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, CARE_EVENT_RESET | CARE_EVENT_TOAST);

        assert_eq!(buf.data[CARE_SLOT_HUNGER_ELAPSED_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_GROOMING_ELAPSED_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 1.0);
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 1.0);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_LAST_FED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_GROOM_FLASH_TIMER_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_REST_FLASH_TIMER_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 0.0);
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 0.0);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 0.0);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION], CARE_ACTION_RESET);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_RESET);
        // last_step_dt_ms is not cleared by reset.
        assert_eq!(buf.data[CARE_SLOT_LAST_STEP_DT_MS], 16.0);
        assert_eq!(buf.data[CARE_SLOT_ACTION_FLAGS], 0.0);
    }

    #[test]
    fn care_sim_multiple_actions_process_in_order() {
        let mut buf = fresh();
        // Set need flags directly so no start-transition events fire this step.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = DEFAULT_GROOMING_DURATION_MS;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = DEFAULT_TIREDNESS_DURATION_MS;
        buf.data[CARE_SLOT_IS_HUNGRY] = 1.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 1.0;
        buf.data[CARE_SLOT_IS_TIRED] = 1.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] =
            (CARE_CMD_FEED | CARE_CMD_GROOM | CARE_CMD_REST) as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(
            events,
            CARE_EVENT_FEED_ACCEPTED
                | CARE_EVENT_HUNGER_RESOLVED
                | CARE_EVENT_GROOM_ACCEPTED
                | CARE_EVENT_GROOMING_RESOLVED
                | CARE_EVENT_REST_ACCEPTED
                | CARE_EVENT_TIREDNESS_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        // Last processed action wins.
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION], CARE_ACTION_REST);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_RESTED);
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 1.0);
    }

    #[test]
    fn care_sim_last_rejection_wins() {
        let mut buf = fresh();
        // Put the dog in a state where all three actions reject: not hungry,
        // not dirty, not tired.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = 0.0;
        buf.data[CARE_SLOT_IS_HUNGRY] = 0.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 0.0;
        buf.data[CARE_SLOT_IS_TIRED] = 0.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] =
            (CARE_CMD_FEED | CARE_CMD_GROOM | CARE_CMD_REST) as f32;

        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_TIRED);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_REJECTED_REST);
    }

    // -----------------------------------------------------------------------
    // Initial defaults (unification-045 constructor contract).
    // -----------------------------------------------------------------------

    #[test]
    fn care_sim_initial_defaults_are_locked() {
        let buf = fresh();
        assert_eq!(buf.data[CARE_SLOT_HUNGER_ELAPSED_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 1.0);
        assert_eq!(buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 1.0);
        assert_eq!(buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS], -1.0);
        assert_eq!(DEFAULT_HUNGER_DURATION_MS, 120_000.0);
        assert_eq!(DEFAULT_GROOMING_DURATION_MS, 180_000.0);
        assert_eq!(DEFAULT_TIREDNESS_DURATION_MS, 180_000.0);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], 0.0);
    }

    #[test]
    fn care_sim_fresh_defaults_survive_first_step() {
        let mut buf = fresh();
        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, 0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 1.0);
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 1.0);
    }

    #[test]
    fn care_sim_groom_and_rest_accepted_immediately_after_reset() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_RESET as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(events, CARE_EVENT_RESET | CARE_EVENT_TOAST);

        // Immediately after reset, groom and rest must be accepted.
        buf.data[CARE_SLOT_ACTION_FLAGS] = (CARE_CMD_GROOM | CARE_CMD_REST) as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(
            events,
            CARE_EVENT_GROOM_ACCEPTED
                | CARE_EVENT_GROOMING_RESOLVED
                | CARE_EVENT_REST_ACCEPTED
                | CARE_EVENT_TIREDNESS_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 1.0);
    }

    // -----------------------------------------------------------------------
    // Threshold tests.
    // -----------------------------------------------------------------------

    #[test]
    fn care_sim_hunger_threshold_at_duration() {
        let mut buf = fresh();
        // Just before the threshold: not hungry, no start event.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS - 1.0;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(events, 0);

        // Cross the threshold: hungry and start event emitted.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS - 1.0;
        let events = step_care_buffer(&mut buf, 1.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 1.0);
        assert_eq!(events, CARE_EVENT_HUNGER_STARTED);
    }

    #[test]
    fn care_sim_hunger_threshold_is_120_seconds() {
        let mut buf = fresh();
        // 119_999 ms elapsed: not hungry.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 119_999.0;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(events, 0);

        // 120_000 ms elapsed: hungry.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 120_000.0;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 1.0);
        assert_eq!(events, CARE_EVENT_HUNGER_STARTED);
    }

    #[test]
    fn care_sim_grooming_need_cycles_after_groom() {
        let mut buf = fresh();
        // Initially needs grooming.
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 1.0);

        // Accept a groom.
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_GROOM as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(
            events,
            CARE_EVENT_GROOM_ACCEPTED
                | CARE_EVENT_GROOMING_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 0.0);

        // Just before the threshold: still clean.
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = DEFAULT_GROOMING_DURATION_MS - 1.0;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 0.0);
        assert_eq!(events, 0);

        // Cross the threshold: needs grooming again with start event.
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = DEFAULT_GROOMING_DURATION_MS - 1.0;
        let events = step_care_buffer(&mut buf, 1.0);
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 1.0);
        assert_eq!(events, CARE_EVENT_GROOMING_NEEDED);
    }

    #[test]
    fn care_sim_tiredness_need_cycles_after_rest() {
        let mut buf = fresh();
        // Initially tired.
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 1.0);

        // Accept a rest.
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_REST as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(
            events,
            CARE_EVENT_REST_ACCEPTED
                | CARE_EVENT_TIREDNESS_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 0.0);

        // Just before the threshold: still rested.
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = DEFAULT_TIREDNESS_DURATION_MS - 1.0;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 0.0);
        assert_eq!(events, 0);

        // Cross the threshold: tired again with start event.
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = DEFAULT_TIREDNESS_DURATION_MS - 1.0;
        let events = step_care_buffer(&mut buf, 1.0);
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 1.0);
        assert_eq!(events, CARE_EVENT_TIREDNESS_STARTED);
    }

    // -----------------------------------------------------------------------
    // Action acceptance / rejection gating.
    // -----------------------------------------------------------------------

    #[test]
    fn care_sim_feed_rejects_then_accepts_after_hunger() {
        let mut buf = fresh();
        // Not hungry: reject.
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_FEED as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_HUNGRY);
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 0.0);

        // Make hungry (set the flag directly so no HUNGER_STARTED transition
        // fires this step), then feed accepts.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS;
        buf.data[CARE_SLOT_IS_HUNGRY] = 1.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_FEED as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(
            events,
            CARE_EVENT_FEED_ACCEPTED
                | CARE_EVENT_HUNGER_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
    }

    #[test]
    fn care_sim_groom_second_rejects_not_dirty() {
        let mut buf = fresh();
        // First groom accepts (initially needs grooming).
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_GROOM as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(
            events,
            CARE_EVENT_GROOM_ACCEPTED
                | CARE_EVENT_GROOMING_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 1.0);

        // Second groom rejects because the dog is clean.
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_GROOM as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_DIRTY);
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 1.0);
    }

    #[test]
    fn care_sim_rest_second_rejects_not_tired() {
        let mut buf = fresh();
        // First rest accepts (initially tired).
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_REST as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(
            events,
            CARE_EVENT_REST_ACCEPTED
                | CARE_EVENT_TIREDNESS_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 1.0);

        // Second rest rejects because the dog is rested.
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_REST as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_TIRED);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 1.0);
    }

    // -----------------------------------------------------------------------
    // Rejection animation timing.
    // -----------------------------------------------------------------------

    #[test]
    fn care_sim_rejection_timer_set_exactly_with_zero_dt() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_FEED as f32;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], REJECTION_ANIM_MS);
    }

    #[test]
    fn care_sim_rejection_timer_reaches_zero_and_emits_finished() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_FEED as f32;
        step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], REJECTION_ANIM_MS);

        // Step by the full remaining amount: reaches zero and emits finished.
        let events = step_care_buffer(&mut buf, REJECTION_ANIM_MS);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], 0.0);
        assert_eq!(events, CARE_EVENT_REJECTION_ANIM_FINISHED);
    }

    #[test]
    fn care_sim_rejection_timer_zero_emits_no_finished() {
        let mut buf = fresh();
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], 0.0);
        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, 0);
    }

    // -----------------------------------------------------------------------
    // Reset behavior.
    // -----------------------------------------------------------------------

    #[test]
    fn care_sim_reset_priority_and_exact_events() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 1000.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 1000.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 1000.0;
        buf.data[CARE_SLOT_IS_HUNGRY] = 1.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 0.0;
        buf.data[CARE_SLOT_IS_TIRED] = 0.0;
        buf.data[CARE_SLOT_FEED_COUNT] = 3.0;
        buf.data[CARE_SLOT_GROOM_COUNT] = 3.0;
        buf.data[CARE_SLOT_REST_COUNT] = 3.0;
        buf.data[CARE_SLOT_HUNGER_LAST_FED_MS] = 42.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = 42.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = 42.0;
        buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS] = 42.0;
        buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS] = 100.0;
        buf.data[CARE_SLOT_GROOM_FLASH_TIMER_MS] = 100.0;
        buf.data[CARE_SLOT_REST_FLASH_TIMER_MS] = 100.0;
        buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = 100.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] =
            (CARE_CMD_RESET | CARE_CMD_FEED | CARE_CMD_GROOM | CARE_CMD_REST) as f32;

        let events = step_care_buffer(&mut buf, 0.0);
        // Exact event set: reset + toast only.
        assert_eq!(events, CARE_EVENT_RESET | CARE_EVENT_TOAST);

        assert_eq!(buf.data[CARE_SLOT_HUNGER_ELAPSED_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_GROOMING_ELAPSED_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 1.0);
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 1.0);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_LAST_FED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION_ELAPSED_MS], -1.0);
        assert_eq!(buf.data[CARE_SLOT_FEED_FLASH_TIMER_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_GROOM_FLASH_TIMER_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_REST_FLASH_TIMER_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 0.0);
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 0.0);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 0.0);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION], CARE_ACTION_RESET);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_RESET);
    }

    // -----------------------------------------------------------------------
    // Edge cases.
    // -----------------------------------------------------------------------

    #[test]
    fn care_sim_non_finite_dt_does_not_progress_or_finish_timer() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 100.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 100.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 100.0;
        buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS] = 50.0;

        let events = step_care_buffer(&mut buf, f32::INFINITY);
        assert_eq!(buf.data[CARE_SLOT_LAST_STEP_DT_MS], 0.0);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_ELAPSED_MS], 100.0);
        assert_eq!(buf.data[CARE_SLOT_GROOMING_ELAPSED_MS], 100.0);
        assert_eq!(buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS], 100.0);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS], 50.0);
        assert_eq!(events, 0);
    }

    #[test]
    fn care_sim_multiple_actions_process_feed_groom_rest_order() {
        let mut buf = fresh();
        // Set need flags directly so no start-transition events fire this step.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = DEFAULT_GROOMING_DURATION_MS;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = DEFAULT_TIREDNESS_DURATION_MS;
        buf.data[CARE_SLOT_IS_HUNGRY] = 1.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 1.0;
        buf.data[CARE_SLOT_IS_TIRED] = 1.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] =
            (CARE_CMD_FEED | CARE_CMD_GROOM | CARE_CMD_REST) as f32;

        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(
            events,
            CARE_EVENT_FEED_ACCEPTED
                | CARE_EVENT_HUNGER_RESOLVED
                | CARE_EVENT_GROOM_ACCEPTED
                | CARE_EVENT_GROOMING_RESOLVED
                | CARE_EVENT_REST_ACCEPTED
                | CARE_EVENT_TIREDNESS_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        // Last processed action wins.
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION], CARE_ACTION_REST);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_RESTED);
    }

    #[test]
    fn care_sim_repeated_rejections_refresh_timer_before_decrement() {
        let mut buf = fresh();
        // Put the dog in a state where all three actions reject.
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = 0.0;
        buf.data[CARE_SLOT_IS_HUNGRY] = 0.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 0.0;
        buf.data[CARE_SLOT_IS_TIRED] = 0.0;
        // All three reject; last rejection (rest) wins.
        buf.data[CARE_SLOT_ACTION_FLAGS] =
            (CARE_CMD_FEED | CARE_CMD_GROOM | CARE_CMD_REST) as f32;
        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_TIRED);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_REJECTED_REST);
        // Timer refreshed to REJECTION_ANIM_MS then decremented by dt.
        assert_eq!(
            buf.data[CARE_SLOT_REJECTION_ANIM_TIMER_MS],
            REJECTION_ANIM_MS - 16.0
        );
    }

    #[test]
    fn care_sim_counters_increment_only_on_accept() {
        let mut buf = fresh();
        // Reject feed (dog is not hungry, but is dirty and tired).
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_FEED as f32;
        step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 0.0);

        // Accept groom and rest.
        buf.data[CARE_SLOT_ACTION_FLAGS] = (CARE_CMD_GROOM | CARE_CMD_REST) as f32;
        step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 0.0);
    }

    #[test]
    fn care_sim_uses_buffer_duration_slots() {
        let mut buf = fresh();
        // Override the hunger duration via the buffer slot.
        buf.data[CARE_SLOT_HUNGER_DURATION_MS] = 1_000.0;
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 999.0;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(events, 0);

        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = 1_000.0;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 1.0);
        assert_eq!(events, CARE_EVENT_HUNGER_STARTED);

        // Feeding resets remaining to the buffer duration, not the default.
        buf.data[CARE_SLOT_ACTION_FLAGS] = CARE_CMD_FEED as f32;
        step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_HUNGER_REMAINING_MS], 1_000.0);
    }

    #[test]
    fn care_sim_mixed_actions_feed_accepts_groom_rest_reject() {
        let mut buf = fresh();
        // Hungry only: feed accepts, groom/rest reject (clean + rested).
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS;
        buf.data[CARE_SLOT_IS_HUNGRY] = 1.0;
        buf.data[CARE_SLOT_GROOMING_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_GROOMING_LAST_GROOMED_MS] = 0.0;
        buf.data[CARE_SLOT_NEEDS_GROOMING] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_ELAPSED_MS] = 0.0;
        buf.data[CARE_SLOT_TIREDNESS_LAST_RESTED_MS] = 0.0;
        buf.data[CARE_SLOT_IS_TIRED] = 0.0;
        buf.data[CARE_SLOT_ACTION_FLAGS] =
            (CARE_CMD_FEED | CARE_CMD_GROOM | CARE_CMD_REST) as f32;

        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(
            events,
            CARE_EVENT_FEED_ACCEPTED
                | CARE_EVENT_HUNGER_RESOLVED
                | CARE_EVENT_ACTION_REJECTED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        // Feed accepted; last processed action is rest (rejected), so the
        // rejection kind/toast reflect the final rejection.
        assert_eq!(buf.data[CARE_SLOT_FEED_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 0.0);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 0.0);
        assert_eq!(buf.data[CARE_SLOT_LAST_ACTION], CARE_ACTION_FEED);
        assert_eq!(buf.data[CARE_SLOT_REJECTION_KIND], CARE_REJECTION_NOT_TIRED);
        assert_eq!(buf.data[CARE_SLOT_UI_TOAST_KIND], CARE_TOAST_REJECTED_REST);
    }

    #[test]
    fn care_sim_non_finite_dt_with_actions_still_processes() {
        let mut buf = fresh();
        // Initially needs grooming and is tired, so groom/rest accept.
        buf.data[CARE_SLOT_ACTION_FLAGS] = (CARE_CMD_GROOM | CARE_CMD_REST) as f32;

        let events = step_care_buffer(&mut buf, f32::NAN);
        assert_eq!(buf.data[CARE_SLOT_LAST_STEP_DT_MS], 0.0);
        assert_eq!(
            events,
            CARE_EVENT_GROOM_ACCEPTED
                | CARE_EVENT_GROOMING_RESOLVED
                | CARE_EVENT_REST_ACCEPTED
                | CARE_EVENT_TIREDNESS_RESOLVED
                | CARE_EVENT_UI_FLASH
                | CARE_EVENT_TOAST
        );
        assert_eq!(buf.data[CARE_SLOT_GROOM_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_REST_COUNT], 1.0);
        assert_eq!(buf.data[CARE_SLOT_ACTION_FLAGS], 0.0);
    }

    #[test]
    fn care_sim_default_buffer_starts_zeroed_and_steps() {
        // Exercise the raw `CareSimBuffer::default()` from `world_contract`
        // without the `fresh()` helper's locked defaults.
        let mut buf = CareSimBuffer::default();
        for (index, slot) in buf.data.iter().enumerate() {
            assert_eq!(slot.to_bits(), 0, "slot {} must start zeroed", index);
        }

        // With all-zero state, `last_*` are 0.0 (not -1.0), so grooming and
        // tiredness needs are governed by elapsed only and start off.
        let events = step_care_buffer(&mut buf, 16.0);
        assert_eq!(events, 0);
        assert_eq!(buf.data[CARE_SLOT_LAST_STEP_DT_MS], 16.0);
        assert_eq!(buf.data[CARE_SLOT_NOW_MS], 16.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(buf.data[CARE_SLOT_NEEDS_GROOMING], 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_TIRED], 0.0);
    }

    #[test]
    fn care_sim_invalid_duration_slot_falls_back_to_default() {
        let mut buf = fresh();
        buf.data[CARE_SLOT_HUNGER_DURATION_MS] = f32::NAN;
        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS - 1.0;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 0.0);
        assert_eq!(events, 0);

        buf.data[CARE_SLOT_HUNGER_ELAPSED_MS] = DEFAULT_HUNGER_DURATION_MS;
        let events = step_care_buffer(&mut buf, 0.0);
        assert_eq!(buf.data[CARE_SLOT_IS_HUNGRY], 1.0);
        assert_eq!(events, CARE_EVENT_HUNGER_STARTED);
    }
}
