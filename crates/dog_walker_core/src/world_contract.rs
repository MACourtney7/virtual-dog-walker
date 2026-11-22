//! Per-entity simulation buffer contracts for the unified world sim.
//!
//! These buffers are zeroed on construction and exposed to JS via raw
//! pointers so the host can read/write f32 slots without copying.

/// Maximum number of NPCs that can be simulated in the park at once.
pub const MAX_PARK_NPCS: usize = 8;

/// Number of f32 slots in the owner simulation buffer (256 bytes).
pub const OWNER_SIM_BUFFER_LEN: usize = 64;

/// Number of f32 slots in the care simulation buffer (128 bytes).
pub const CARE_SIM_BUFFER_LEN: usize = 32;

/// Number of f32 slots in the ball simulation buffer (128 bytes).
pub const BALL_SIM_BUFFER_LEN: usize = 32;

/// Number of f32 slots in each NPC simulation buffer (256 bytes).
pub const NPC_SIM_BUFFER_LEN: usize = 64;

/// Persistent owner simulation buffer.
#[derive(Clone, Copy)]
pub struct OwnerSimBuffer {
    pub data: [f32; OWNER_SIM_BUFFER_LEN],
}

impl Default for OwnerSimBuffer {
    fn default() -> Self {
        Self { data: [0.0; OWNER_SIM_BUFFER_LEN] }
    }
}

/// Persistent care simulation buffer.
#[derive(Clone, Copy)]
pub struct CareSimBuffer {
    pub data: [f32; CARE_SIM_BUFFER_LEN],
}

impl Default for CareSimBuffer {
    fn default() -> Self {
        Self { data: [0.0; CARE_SIM_BUFFER_LEN] }
    }
}

/// Persistent ball simulation buffer.
#[derive(Clone, Copy)]
pub struct BallSimBuffer {
    pub data: [f32; BALL_SIM_BUFFER_LEN],
}

impl Default for BallSimBuffer {
    fn default() -> Self {
        Self { data: [0.0; BALL_SIM_BUFFER_LEN] }
    }
}

/// Persistent per-NPC simulation buffer.
#[derive(Clone, Copy)]
pub struct NpcSimBuffer {
    pub data: [f32; NPC_SIM_BUFFER_LEN],
}

impl Default for NpcSimBuffer {
    fn default() -> Self {
        Self { data: [0.0; NPC_SIM_BUFFER_LEN] }
    }
}

// Compile-time ABI size assertions (locked by unification-045/spec.md).
const _: () = assert!(core::mem::size_of::<OwnerSimBuffer>() == 256);
const _: () = assert!(core::mem::size_of::<CareSimBuffer>() == 128);
const _: () = assert!(core::mem::size_of::<BallSimBuffer>() == 128);
const _: () = assert!(core::mem::size_of::<NpcSimBuffer>() == 256);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_core_contract_buffer_sizes() {
        assert_eq!(core::mem::size_of::<OwnerSimBuffer>(), 256);
        assert_eq!(core::mem::size_of::<CareSimBuffer>(), 128);
        assert_eq!(core::mem::size_of::<BallSimBuffer>(), 128);
        assert_eq!(core::mem::size_of::<NpcSimBuffer>(), 256);
        assert_eq!(MAX_PARK_NPCS, 8);
    }
}
