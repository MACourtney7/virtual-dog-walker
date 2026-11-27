//! Shared dog simulation ABI contract.
//!
//! The JS/Wasm bridge owns a persistent 128-slot `f32` buffer. Inputs live in
//! slots `0..=63`, outputs in slots `64..=127`. Every offset is stable and
//! unique so both sides can rely on the same layout.

/// Number of f32 slots in the shared dog simulation buffer.
pub const DOG_SIM_BUFFER_LEN: usize = 128;

/// Number of bytes in the shared dog simulation buffer.
pub const DOG_SIM_BUFFER_BYTES: usize = 512;

/// Persistent zeroed buffer shared with the JS/Wasm bridge.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DogSimBuffer {
    pub slots: [f32; DOG_SIM_BUFFER_LEN],
}

// Compile-time guarantee that the buffer layout matches the JS view.
const _: [(); DOG_SIM_BUFFER_BYTES] = [(); core::mem::size_of::<DogSimBuffer>()];

impl Default for DogSimBuffer {
    fn default() -> Self {
        Self {
            slots: [0.0; DOG_SIM_BUFFER_LEN],
        }
    }
}

// ---------------------------------------------------------------------------
// Input slots (0..=63)
// ---------------------------------------------------------------------------

pub const DOG_BUF_DT: usize = 0;
pub const DOG_BUF_NOW_SEC: usize = 1;
pub const DOG_BUF_OWNER_X: usize = 2;
pub const DOG_BUF_OWNER_Y: usize = 3;
pub const DOG_BUF_OWNER_VX: usize = 4;
pub const DOG_BUF_OWNER_VY: usize = 5;
pub const DOG_BUF_OWNER_HEADING: usize = 6;
pub const DOG_BUF_OWNER_HALF_WIDTH: usize = 7;
pub const DOG_BUF_OWNER_GAIT_ID: usize = 8;
pub const DOG_BUF_OWNER_IS_MOVING: usize = 9;
pub const DOG_BUF_IS_ON_LEASH: usize = 10;
pub const DOG_BUF_PREFERRED_SIDE_SIGN: usize = 11;
pub const DOG_BUF_IS_HUNGRY: usize = 12;
pub const DOG_BUF_NEEDS_GROOMING: usize = 13;
pub const DOG_BUF_IS_TIRED: usize = 14;
pub const DOG_BUF_BALL_ACTIVE: usize = 15;
pub const DOG_BUF_BALL_IS_THROWN: usize = 16;
pub const DOG_BUF_BALL_X: usize = 17;
pub const DOG_BUF_BALL_Y: usize = 18;
pub const DOG_BUF_CAM_ACTIVE: usize = 19;
pub const DOG_BUF_CAM_LEFT: usize = 20;
pub const DOG_BUF_CAM_TOP: usize = 21;
pub const DOG_BUF_CAM_RIGHT: usize = 22;
pub const DOG_BUF_CAM_BOTTOM: usize = 23;
pub const DOG_BUF_ZONE_IS_SUNNY: usize = 24;
pub const DOG_BUF_CURIOSITY: usize = 25;
pub const DOG_BUF_ENERGY: usize = 26;
pub const DOG_BUF_STUBBORNNESS: usize = 27;
pub const DOG_BUF_LOYALTY: usize = 28;
pub const DOG_BUF_CMD_WHISTLE_RECALL: usize = 29;
pub const DOG_BUF_CMD_PET: usize = 30;
pub const DOG_BUF_CMD_PRAISE: usize = 31;
pub const DOG_BUF_CMD_BARK: usize = 32;
pub const DOG_BUF_CMD_TRIGGER_ZOOMIES: usize = 33;
pub const DOG_BUF_CMD_FETCH_BALL: usize = 34;
pub const DOG_BUF_PEER_COUNT: usize = 35;
pub const DOG_BUF_NPC_COUNT: usize = 36;
pub const DOG_BUF_SCENT_COUNT: usize = 37;
pub const DOG_BUF_PEER0_X: usize = 38;
pub const DOG_BUF_PEER0_Y: usize = 39;
pub const DOG_BUF_PEER1_X: usize = 40;
pub const DOG_BUF_PEER1_Y: usize = 41;
pub const DOG_BUF_PEER2_X: usize = 42;
pub const DOG_BUF_PEER2_Y: usize = 43;
pub const DOG_BUF_PEER3_X: usize = 44;
pub const DOG_BUF_PEER3_Y: usize = 45;
pub const DOG_BUF_NPC0_X: usize = 46;
pub const DOG_BUF_NPC0_Y: usize = 47;
pub const DOG_BUF_NPC1_X: usize = 48;
pub const DOG_BUF_NPC1_Y: usize = 49;
pub const DOG_BUF_NPC2_X: usize = 50;
pub const DOG_BUF_NPC2_Y: usize = 51;
pub const DOG_BUF_NPC3_X: usize = 52;
pub const DOG_BUF_NPC3_Y: usize = 53;
pub const DOG_BUF_SCENT0_X: usize = 54;
pub const DOG_BUF_SCENT0_Y: usize = 55;
pub const DOG_BUF_SCENT1_X: usize = 56;
pub const DOG_BUF_SCENT1_Y: usize = 57;
pub const DOG_BUF_SCENT2_X: usize = 58;
pub const DOG_BUF_SCENT2_Y: usize = 59;
pub const DOG_BUF_SCENT3_X: usize = 60;
pub const DOG_BUF_SCENT3_Y: usize = 61;
pub const DOG_BUF_RESERVED_INPUT_0: usize = 62;
pub const DOG_BUF_RESERVED_INPUT_1: usize = 63;

// State-machine extension slots (unification-049). These reuse the reserved
// input slots; the command-authority state machine owns them.
pub const DOG_BUF_COMMAND_FLAGS: usize = DOG_BUF_RESERVED_INPUT_0;
pub const DOG_BUF_STATE_FLAGS: usize = DOG_BUF_RESERVED_INPUT_1;

// ---------------------------------------------------------------------------
// Output slots (64..=127)
// ---------------------------------------------------------------------------

pub const DOG_BUF_DOG_X: usize = 64;
pub const DOG_BUF_DOG_Y: usize = 65;
pub const DOG_BUF_DOG_VX: usize = 66;
pub const DOG_BUF_DOG_VY: usize = 67;
pub const DOG_BUF_DOG_ANGLE: usize = 68;
pub const DOG_BUF_DOG_STATE_ID: usize = 69;
pub const DOG_BUF_ROAM_SUBMODE_ID: usize = 70;
pub const DOG_BUF_ZOOMIE_PATH_ID: usize = 71;
pub const DOG_BUF_GAIT_MODE_ID: usize = 72;
pub const DOG_BUF_GAIT_PHASE: usize = 73;
pub const DOG_BUF_STATE_TIMER: usize = 74;
pub const DOG_BUF_POOP_TIMER: usize = 75;
pub const DOG_BUF_NEXT_POOP_TIME: usize = 76;
pub const DOG_BUF_POOP_SQUAT_DURATION: usize = 77;
pub const DOG_BUF_ZOOMIES_TIMER: usize = 78;
pub const DOG_BUF_ZOOMIES_PHASE: usize = 79;
pub const DOG_BUF_ZOOMIES_COOLDOWN: usize = 80;
pub const DOG_BUF_SOCIAL_COOLDOWN: usize = 81;
pub const DOG_BUF_LEASH_PULL_COOLDOWN: usize = 82;
pub const DOG_BUF_LEASH_TUG_TIMER: usize = 83;
pub const DOG_BUF_RECALL_HEEL_TIMER: usize = 84;
pub const DOG_BUF_IDLE_REST_TIMER: usize = 85;
pub const DOG_BUF_OWNER_STILL_TIMER: usize = 86;
pub const DOG_BUF_STRAY_CHECK_TIMER: usize = 87;
pub const DOG_BUF_ROAM_BASELINE_TIMER: usize = 88;
pub const DOG_BUF_ROAM_SUBMODE_TIMER: usize = 89;
pub const DOG_BUF_ROAM_LOOKBACK_TIMER: usize = 90;
pub const DOG_BUF_ROAM_MICROPAUSE_TIMER: usize = 91;
pub const DOG_BUF_CATCH_UP_TIMER: usize = 92;
pub const DOG_BUF_ROAM_TARGET_SPEED: usize = 93;
pub const DOG_BUF_ROAM_CURRENT_SPEED: usize = 94;
pub const DOG_BUF_ROAM_WAYPOINT_X: usize = 95;
pub const DOG_BUF_ROAM_WAYPOINT_Y: usize = 96;
pub const DOG_BUF_WANDER_ANGLE: usize = 97;
pub const DOG_BUF_WANDER_TIMER: usize = 98;
pub const DOG_BUF_ZOOMIES_CENTER_X: usize = 99;
pub const DOG_BUF_ZOOMIES_CENTER_Y: usize = 100;
pub const DOG_BUF_ZOOMIES_ORBIT_ANGLE: usize = 101;
pub const DOG_BUF_ZOOMIES_ORBIT_RADIUS: usize = 102;
pub const DOG_BUF_ZOOMIES_ORBIT_DIR: usize = 103;
pub const DOG_BUF_ZOOMIES_SHUTTLE_AX: usize = 104;
pub const DOG_BUF_ZOOMIES_SHUTTLE_AY: usize = 105;
pub const DOG_BUF_ZOOMIES_SHUTTLE_BX: usize = 106;
pub const DOG_BUF_ZOOMIES_SHUTTLE_BY: usize = 107;
pub const DOG_BUF_LEFT_EAR_ANGLE: usize = 108;
pub const DOG_BUF_LEFT_EAR_VEL: usize = 109;
pub const DOG_BUF_RIGHT_EAR_ANGLE: usize = 110;
pub const DOG_BUF_RIGHT_EAR_VEL: usize = 111;
pub const DOG_BUF_WAG_SPEED: usize = 112;
pub const DOG_BUF_TAIL_ANGLE: usize = 113;
pub const DOG_BUF_NOSE_TWITCH: usize = 114;
pub const DOG_BUF_TARGET_SLOT_X: usize = 115;
pub const DOG_BUF_TARGET_SLOT_Y: usize = 116;
pub const DOG_BUF_LEASH_FLAGS: usize = 117;
pub const DOG_BUF_LEASH_TENSION: usize = 118;
pub const DOG_BUF_LEASH_SAG_PX: usize = 119;
pub const DOG_BUF_LEASH_VIBRATION_PX: usize = 120;
pub const DOG_BUF_OWNER_CLAMPED_X: usize = 121;
pub const DOG_BUF_OWNER_CLAMPED_Y: usize = 122;
pub const DOG_BUF_OWNER_FLAGS: usize = 123;
pub const DOG_BUF_RNG_SEED: usize = 124;
pub const DOG_BUF_ACTIVE_UTILITY_ID: usize = 125;
pub const DOG_BUF_ACTIVE_UTILITY_SCORE: usize = 126;
pub const DOG_BUF_EVENT_BITMASK: usize = 127;

// State-machine extension slots (unification-049). These reuse the roam/zoomies
// internal timer slots; the command-authority state machine owns them.
pub const DOG_BUF_TRANSITION_STATE: usize = 84;
pub const DOG_BUF_FETCH_TIMER: usize = 85;
pub const DOG_BUF_WHISTLE_COOLDOWN: usize = 86;
pub const DOG_BUF_PET_TIMER: usize = 87;
pub const DOG_BUF_PRAISE_TIMER: usize = 88;
pub const DOG_BUF_BARK_TIMER: usize = 89;
pub const DOG_BUF_SUNNY_ROLL_STATE: usize = 90;
pub const DOG_BUF_SUNNY_ROLL_TIMER: usize = 91;
pub const DOG_BUF_PACK_PLAY_STATE: usize = 92;
pub const DOG_BUF_PACK_PLAY_TIMER: usize = 93;
pub const DOG_BUF_PACK_PLAY_PARTNER_ID: usize = 94;
pub const DOG_BUF_IS_BALL_HELD: usize = 95;

// Event bitmask high half + command counters (unification-049 remediation).
// These repurpose the zoomies shuttle slots (104-106) so the full 32-bit event
// mask can be stored bit-preservingly across two f32 slots (a single f32 only
// has 24 bits of mantissa and would otherwise drop low bits of combined masks).
pub const DOG_BUF_EVENT_BITMASK_HI: usize = 104;
pub const DOG_BUF_COMMAND_ACCEPT_COUNT: usize = 105;
pub const DOG_BUF_COMMAND_REJECT_COUNT: usize = 106;
pub const DOG_BUF_EVENT_BITMASK_HI2: usize = 107;

// ---------------------------------------------------------------------------
// Discrete enums (numeric ids written into the buffer)
// ---------------------------------------------------------------------------

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DogStateId {
    Idle = 0,
    Heel = 1,
    Roam = 2,
    Poop = 3,
    Fetch = 4,
    Social = 5,
    Zoomies = 6,
    Rest = 7,
    Stray = 8,
    Recall = 9,
    Bark = 10,
    Sniff = 11,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoamSubModeId {
    Baseline = 0,
    Explore = 1,
    ScoutAhead = 2,
    LagAndSniff = 3,
    CheckIn = 4,
    LookBack = 5,
    MicroPause = 6,
    CatchUp = 7,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZoomiePathId {
    None = 0,
    FigureEight = 1,
    OrbitOwner = 2,
    Shuttle = 3,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GaitModeId {
    Idle = 0,
    Walk = 1,
    Trot = 2,
    Gallop = 3,
}

// ---------------------------------------------------------------------------
// Grouped inputs
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DiscreteCombo {
    pub is_on_leash: bool,
    pub is_pooping: bool,
    pub has_need: bool,
    pub has_ball: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PersonalityTraits {
    pub curiosity: f32,
    pub energy: f32,
    pub stubbornness: f32,
    pub loyalty: f32,
}

// ---------------------------------------------------------------------------
// Event bitmask (written into DOG_BUF_EVENT_BITMASK)
// ---------------------------------------------------------------------------

pub const DOG_EVENT_NONE: u32 = 0;
pub const DOG_EVENT_POOP_DROPPED: u32 = 1 << 0;
pub const DOG_EVENT_BARK_TRIGGERED: u32 = 1 << 1;
pub const DOG_EVENT_GALLOP_PUFF: u32 = 1 << 2;
pub const DOG_EVENT_SCENT_DEPOSITED: u32 = 1 << 3;
pub const DOG_EVENT_WHINE_AUDIO: u32 = 1 << 4;
pub const DOG_EVENT_PANT_AUDIO: u32 = 1 << 5;
pub const DOG_EVENT_SNIFF_AUDIO: u32 = 1 << 6;
pub const DOG_EVENT_BALL_GRABBED: u32 = 1 << 7;
pub const DOG_EVENT_BALL_HANDOFF: u32 = 1 << 8;
pub const DOG_EVENT_STICK_PICKED_UP: u32 = 1 << 9;
pub const DOG_EVENT_STRAY_TRIGGERED: u32 = 1 << 10;
pub const DOG_EVENT_STRAY_RESOLVED: u32 = 1 << 11;
pub const DOG_EVENT_HEARTS_SPAWNED: u32 = 1 << 12;
pub const DOG_EVENT_LEASH_TAUT: u32 = 1 << 13;
pub const DOG_EVENT_LEASH_SLACK: u32 = 1 << 14;

// Command-authority / state-machine events (unification-049). These occupy
// bits 15..=31 so they never collide with the legacy event bits above.
pub const DOG_EVENT_WHISTLE_RECALL_STARTED: u32 = 1 << 15;
pub const DOG_EVENT_TRANSITION_STATE_CHANGED: u32 = 1 << 16;
pub const DOG_EVENT_PET_ACCEPTED: u32 = 1 << 17;
pub const DOG_EVENT_PRAISE_ACCEPTED: u32 = 1 << 18;
pub const DOG_EVENT_BARK: u32 = 1 << 19;
pub const DOG_EVENT_ZOOMIES_STARTED: u32 = 1 << 20;
pub const DOG_EVENT_FETCH_STARTED: u32 = 1 << 21;
pub const DOG_EVENT_RECALL_ARRIVED: u32 = 1 << 22;
pub const DOG_EVENT_FETCH_COMPLETED: u32 = 1 << 23;
pub const DOG_EVENT_SUNNY_ROLL_STARTED: u32 = 1 << 24;
pub const DOG_EVENT_SUNNY_ROLL_FINISHED: u32 = 1 << 25;
pub const DOG_EVENT_PACK_PLAY_STARTED: u32 = 1 << 26;
pub const DOG_EVENT_PACK_PLAY_BROKEN: u32 = 1 << 27;
pub const DOG_EVENT_NEED_HUNGRY: u32 = 1 << 28;
pub const DOG_EVENT_NEED_GROOMING: u32 = 1 << 29;
pub const DOG_EVENT_COMMAND_REJECTED: u32 = 1 << 30;
pub const DOG_EVENT_NEED_TIRED: u32 = 1 << 31;

// Extended events (bits 32..=33). These do not fit in the 32-bit legacy mask
// and are tracked as `u64` bits in the third bitmask slot.
pub const DOG_EVENT_SOCIAL_COOLDOWN_REJECT: u64 = 1 << 32;
pub const DOG_EVENT_SUNNY_ZONE_ENTERED: u64 = 1 << 33;

// ---------------------------------------------------------------------------
// Leash / owner status flags
// ---------------------------------------------------------------------------

pub const DOG_LEASH_FLAG_PULLING: u32 = 1 << 0;
pub const DOG_LEASH_FLAG_TAUT: u32 = 1 << 1;

pub const DOG_OWNER_FLAG_WAS_CLAMPED: u32 = 1 << 0;
pub const DOG_OWNER_FLAG_FROZEN: u32 = 1 << 1;

// ---------------------------------------------------------------------------
// Event bitmask helpers (bit-preserving across two f32 slots)
// ---------------------------------------------------------------------------

/// Write a full 32-bit event mask bit-preservingly across two f32 slots.
///
/// A single `f32` cannot represent every 32-bit integer exactly (it has only
/// 24 bits of mantissa), so the mask is split into low and high 16-bit halves.
pub fn write_event_bitmask(buffer: &mut DogSimBuffer, events: u32) {
    buffer.slots[DOG_BUF_EVENT_BITMASK] = (events & 0xFFFF) as f32;
    buffer.slots[DOG_BUF_EVENT_BITMASK_HI] = (events >> 16) as f32;
}

/// Read the full 32-bit event mask from the two f32 slots.
pub fn read_event_bitmask(buffer: &DogSimBuffer) -> u32 {
    let lo = buffer.slots[DOG_BUF_EVENT_BITMASK];
    let hi = buffer.slots[DOG_BUF_EVENT_BITMASK_HI];
    let lo = if lo.is_finite() { lo as u32 & 0xFFFF } else { 0 };
    let hi = if hi.is_finite() { hi as u32 & 0xFFFF } else { 0 };
    (hi << 16) | lo
}

/// Write a full 64-bit event mask bit-preservingly across three f32 slots.
///
/// Bits `0..=15` live in `DOG_BUF_EVENT_BITMASK`, bits `16..=31` in
/// `DOG_BUF_EVENT_BITMASK_HI`, and bits `32..=47` in
/// `DOG_BUF_EVENT_BITMASK_HI2`. Each 16-bit chunk is exactly representable in
/// an `f32` mantissa.
pub fn write_event_mask64(buffer: &mut DogSimBuffer, events: u64) {
    buffer.slots[DOG_BUF_EVENT_BITMASK] = (events & 0xFFFF) as f32;
    buffer.slots[DOG_BUF_EVENT_BITMASK_HI] = ((events >> 16) & 0xFFFF) as f32;
    buffer.slots[DOG_BUF_EVENT_BITMASK_HI2] = ((events >> 32) & 0xFFFF) as f32;
}

/// Read the full 64-bit event mask from the three f32 slots.
pub fn read_event_mask64(buffer: &DogSimBuffer) -> u64 {
    let lo = buffer.slots[DOG_BUF_EVENT_BITMASK];
    let mid = buffer.slots[DOG_BUF_EVENT_BITMASK_HI];
    let hi = buffer.slots[DOG_BUF_EVENT_BITMASK_HI2];
    let lo = if lo.is_finite() { lo as u64 & 0xFFFF } else { 0 };
    let mid = if mid.is_finite() { mid as u64 & 0xFFFF } else { 0 };
    let hi = if hi.is_finite() { hi as u64 & 0xFFFF } else { 0 };
    (hi << 32) | (mid << 16) | lo
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUFFER_OFFSETS: [usize; DOG_SIM_BUFFER_LEN] = [
        DOG_BUF_DT,
        DOG_BUF_NOW_SEC,
        DOG_BUF_OWNER_X,
        DOG_BUF_OWNER_Y,
        DOG_BUF_OWNER_VX,
        DOG_BUF_OWNER_VY,
        DOG_BUF_OWNER_HEADING,
        DOG_BUF_OWNER_HALF_WIDTH,
        DOG_BUF_OWNER_GAIT_ID,
        DOG_BUF_OWNER_IS_MOVING,
        DOG_BUF_IS_ON_LEASH,
        DOG_BUF_PREFERRED_SIDE_SIGN,
        DOG_BUF_IS_HUNGRY,
        DOG_BUF_NEEDS_GROOMING,
        DOG_BUF_IS_TIRED,
        DOG_BUF_BALL_ACTIVE,
        DOG_BUF_BALL_IS_THROWN,
        DOG_BUF_BALL_X,
        DOG_BUF_BALL_Y,
        DOG_BUF_CAM_ACTIVE,
        DOG_BUF_CAM_LEFT,
        DOG_BUF_CAM_TOP,
        DOG_BUF_CAM_RIGHT,
        DOG_BUF_CAM_BOTTOM,
        DOG_BUF_ZONE_IS_SUNNY,
        DOG_BUF_CURIOSITY,
        DOG_BUF_ENERGY,
        DOG_BUF_STUBBORNNESS,
        DOG_BUF_LOYALTY,
        DOG_BUF_CMD_WHISTLE_RECALL,
        DOG_BUF_CMD_PET,
        DOG_BUF_CMD_PRAISE,
        DOG_BUF_CMD_BARK,
        DOG_BUF_CMD_TRIGGER_ZOOMIES,
        DOG_BUF_CMD_FETCH_BALL,
        DOG_BUF_PEER_COUNT,
        DOG_BUF_NPC_COUNT,
        DOG_BUF_SCENT_COUNT,
        DOG_BUF_PEER0_X,
        DOG_BUF_PEER0_Y,
        DOG_BUF_PEER1_X,
        DOG_BUF_PEER1_Y,
        DOG_BUF_PEER2_X,
        DOG_BUF_PEER2_Y,
        DOG_BUF_PEER3_X,
        DOG_BUF_PEER3_Y,
        DOG_BUF_NPC0_X,
        DOG_BUF_NPC0_Y,
        DOG_BUF_NPC1_X,
        DOG_BUF_NPC1_Y,
        DOG_BUF_NPC2_X,
        DOG_BUF_NPC2_Y,
        DOG_BUF_NPC3_X,
        DOG_BUF_NPC3_Y,
        DOG_BUF_SCENT0_X,
        DOG_BUF_SCENT0_Y,
        DOG_BUF_SCENT1_X,
        DOG_BUF_SCENT1_Y,
        DOG_BUF_SCENT2_X,
        DOG_BUF_SCENT2_Y,
        DOG_BUF_SCENT3_X,
        DOG_BUF_SCENT3_Y,
        DOG_BUF_RESERVED_INPUT_0,
        DOG_BUF_RESERVED_INPUT_1,
        DOG_BUF_DOG_X,
        DOG_BUF_DOG_Y,
        DOG_BUF_DOG_VX,
        DOG_BUF_DOG_VY,
        DOG_BUF_DOG_ANGLE,
        DOG_BUF_DOG_STATE_ID,
        DOG_BUF_ROAM_SUBMODE_ID,
        DOG_BUF_ZOOMIE_PATH_ID,
        DOG_BUF_GAIT_MODE_ID,
        DOG_BUF_GAIT_PHASE,
        DOG_BUF_STATE_TIMER,
        DOG_BUF_POOP_TIMER,
        DOG_BUF_NEXT_POOP_TIME,
        DOG_BUF_POOP_SQUAT_DURATION,
        DOG_BUF_ZOOMIES_TIMER,
        DOG_BUF_ZOOMIES_PHASE,
        DOG_BUF_ZOOMIES_COOLDOWN,        DOG_BUF_SOCIAL_COOLDOWN,
        DOG_BUF_LEASH_PULL_COOLDOWN,
        DOG_BUF_LEASH_TUG_TIMER,
        DOG_BUF_RECALL_HEEL_TIMER,
        DOG_BUF_IDLE_REST_TIMER,
        DOG_BUF_OWNER_STILL_TIMER,
        DOG_BUF_STRAY_CHECK_TIMER,
        DOG_BUF_ROAM_BASELINE_TIMER,
        DOG_BUF_ROAM_SUBMODE_TIMER,
        DOG_BUF_ROAM_LOOKBACK_TIMER,
        DOG_BUF_ROAM_MICROPAUSE_TIMER,
        DOG_BUF_CATCH_UP_TIMER,
        DOG_BUF_ROAM_TARGET_SPEED,
        DOG_BUF_ROAM_CURRENT_SPEED,
        DOG_BUF_ROAM_WAYPOINT_X,
        DOG_BUF_ROAM_WAYPOINT_Y,
        DOG_BUF_WANDER_ANGLE,
        DOG_BUF_WANDER_TIMER,
        DOG_BUF_ZOOMIES_CENTER_X,
        DOG_BUF_ZOOMIES_CENTER_Y,
        DOG_BUF_ZOOMIES_ORBIT_ANGLE,
        DOG_BUF_ZOOMIES_ORBIT_RADIUS,
        DOG_BUF_ZOOMIES_ORBIT_DIR,
        DOG_BUF_EVENT_BITMASK_HI,
        DOG_BUF_COMMAND_ACCEPT_COUNT,
        DOG_BUF_COMMAND_REJECT_COUNT,
        DOG_BUF_ZOOMIES_SHUTTLE_BY,
        DOG_BUF_LEFT_EAR_ANGLE,
        DOG_BUF_LEFT_EAR_VEL,
        DOG_BUF_RIGHT_EAR_ANGLE,
        DOG_BUF_RIGHT_EAR_VEL,
        DOG_BUF_WAG_SPEED,
        DOG_BUF_TAIL_ANGLE,
        DOG_BUF_NOSE_TWITCH,
        DOG_BUF_TARGET_SLOT_X,
        DOG_BUF_TARGET_SLOT_Y,
        DOG_BUF_LEASH_FLAGS,
        DOG_BUF_LEASH_TENSION,
        DOG_BUF_LEASH_SAG_PX,
        DOG_BUF_LEASH_VIBRATION_PX,
        DOG_BUF_OWNER_CLAMPED_X,
        DOG_BUF_OWNER_CLAMPED_Y,
        DOG_BUF_OWNER_FLAGS,
        DOG_BUF_RNG_SEED,
        DOG_BUF_ACTIVE_UTILITY_ID,
        DOG_BUF_ACTIVE_UTILITY_SCORE,
        DOG_BUF_EVENT_BITMASK,
    ];

    #[test]
    fn buffer_len_and_bytes_match_contract() {
        assert_eq!(DOG_SIM_BUFFER_LEN, 128);
        assert_eq!(DOG_SIM_BUFFER_BYTES, 512);
        assert_eq!(core::mem::size_of::<DogSimBuffer>(), DOG_SIM_BUFFER_BYTES);
        assert_eq!(
            core::mem::size_of::<DogSimBuffer>(),
            DOG_SIM_BUFFER_LEN * core::mem::size_of::<f32>()
        );
    }

    #[test]
    fn world_core_contract_dog_buffer_size() {
        assert_eq!(core::mem::size_of::<DogSimBuffer>(), 512);
        assert_eq!(DOG_SIM_BUFFER_LEN, 128);
    }

    #[test]
    fn default_buffer_is_zeroed() {
        let buffer = DogSimBuffer::default();
        assert!(buffer.slots.iter().all(|slot| *slot == 0.0));
    }

    #[test]
    fn offsets_are_contiguous_and_unique() {
        let mut offsets = BUFFER_OFFSETS;
        offsets.sort_unstable();

        for (expected, actual) in offsets.iter().enumerate() {
            assert_eq!(
                *actual, expected,
                "dog simulation buffer offsets must cover 0..=127 exactly once"
            );
        }
    }

    #[test]
    fn enum_discriminants_match_contract() {
        assert_eq!(DogStateId::Idle as u32, 0);
        assert_eq!(DogStateId::Heel as u32, 1);
        assert_eq!(DogStateId::Roam as u32, 2);
        assert_eq!(DogStateId::Poop as u32, 3);
        assert_eq!(DogStateId::Fetch as u32, 4);
        assert_eq!(DogStateId::Social as u32, 5);
        assert_eq!(DogStateId::Zoomies as u32, 6);
        assert_eq!(DogStateId::Rest as u32, 7);
        assert_eq!(DogStateId::Stray as u32, 8);
        assert_eq!(DogStateId::Recall as u32, 9);
        assert_eq!(DogStateId::Bark as u32, 10);
        assert_eq!(DogStateId::Sniff as u32, 11);

        assert_eq!(RoamSubModeId::Baseline as u32, 0);
        assert_eq!(RoamSubModeId::Explore as u32, 1);
        assert_eq!(RoamSubModeId::ScoutAhead as u32, 2);
        assert_eq!(RoamSubModeId::LagAndSniff as u32, 3);
        assert_eq!(RoamSubModeId::CheckIn as u32, 4);
        assert_eq!(RoamSubModeId::LookBack as u32, 5);
        assert_eq!(RoamSubModeId::MicroPause as u32, 6);
        assert_eq!(RoamSubModeId::CatchUp as u32, 7);

        assert_eq!(ZoomiePathId::None as u32, 0);
        assert_eq!(ZoomiePathId::FigureEight as u32, 1);
        assert_eq!(ZoomiePathId::OrbitOwner as u32, 2);
        assert_eq!(ZoomiePathId::Shuttle as u32, 3);

        assert_eq!(GaitModeId::Idle as u32, 0);
        assert_eq!(GaitModeId::Walk as u32, 1);
        assert_eq!(GaitModeId::Trot as u32, 2);
        assert_eq!(GaitModeId::Gallop as u32, 3);
    }

    fn assert_bool(_: bool) {}

    fn assert_f32(_: f32) {}

    #[test]
    fn grouped_struct_fields_have_expected_types() {
        let combo = DiscreteCombo {
            is_on_leash: false,
            is_pooping: true,
            has_need: false,
            has_ball: true,
        };
        assert_bool(combo.is_on_leash);
        assert_bool(combo.is_pooping);
        assert_bool(combo.has_need);
        assert_bool(combo.has_ball);

        let traits = PersonalityTraits {
            curiosity: 0.5,
            energy: 0.25,
            stubbornness: 0.0,
            loyalty: 1.0,
        };
        assert_f32(traits.curiosity);
        assert_f32(traits.energy);
        assert_f32(traits.stubbornness);
        assert_f32(traits.loyalty);
    }

    #[test]
    fn event_bits_match_contract() {
        assert_eq!(DOG_EVENT_NONE, 0);
        assert_eq!(DOG_EVENT_POOP_DROPPED, 1 << 0);
        assert_eq!(DOG_EVENT_BARK_TRIGGERED, 1 << 1);
        assert_eq!(DOG_EVENT_GALLOP_PUFF, 1 << 2);
        assert_eq!(DOG_EVENT_SCENT_DEPOSITED, 1 << 3);
        assert_eq!(DOG_EVENT_WHINE_AUDIO, 1 << 4);
        assert_eq!(DOG_EVENT_PANT_AUDIO, 1 << 5);
        assert_eq!(DOG_EVENT_SNIFF_AUDIO, 1 << 6);
        assert_eq!(DOG_EVENT_BALL_GRABBED, 1 << 7);
        assert_eq!(DOG_EVENT_BALL_HANDOFF, 1 << 8);
        assert_eq!(DOG_EVENT_STICK_PICKED_UP, 1 << 9);
        assert_eq!(DOG_EVENT_STRAY_TRIGGERED, 1 << 10);
        assert_eq!(DOG_EVENT_STRAY_RESOLVED, 1 << 11);
        assert_eq!(DOG_EVENT_HEARTS_SPAWNED, 1 << 12);
    }

    #[test]
    fn flag_masks_match_contract() {
        assert_eq!(DOG_LEASH_FLAG_PULLING, 1 << 0);
        assert_eq!(DOG_LEASH_FLAG_TAUT, 1 << 1);

        assert_eq!(DOG_OWNER_FLAG_WAS_CLAMPED, 1 << 0);
        assert_eq!(DOG_OWNER_FLAG_FROZEN, 1 << 1);
    }
}
