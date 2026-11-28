//! Canonical, deterministic export of WASM-facing Rust constants.
//!
//! This module is the single source of truth for the generated JS/JSON
//! constants consumed by the web client. Every registry entry references an
//! existing `pub const` directly, so numeric literals are never duplicated.
//!
//! Namespace order is fixed and each namespace's keys are sorted
//! lexicographically by constant name, making output deterministic across
//! runs and platforms.

/// Fixed namespace order for all generated output.
pub const NAMESPACE_ORDER: [&str; 7] = [
    "world",
    "dog",
    "owner",
    "care",
    "ball",
    "npc",
    "collision",
];

/// A single exported constant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WasmConstantEntry {
    /// Namespace grouping for the constant.
    pub namespace: &'static str,
    /// Constant name as written in Rust.
    pub name: &'static str,
    /// Integer representation used at the export boundary.
    pub value: u64,
}

macro_rules! module_entries {
    ($namespace:expr, $module:ident, [$($name:ident),* $(,)?]) => {
        vec![
            $(WasmConstantEntry {
                namespace: $namespace,
                name: stringify!($name),
                value: (crate::$module::$name) as u64,
            }),*
        ]
    };
}

fn world_entries() -> Vec<WasmConstantEntry> {
    module_entries!("world", world_contract, [
        BALL_SIM_BUFFER_LEN,
        CARE_SIM_BUFFER_LEN,
        NPC_SIM_BUFFER_LEN,
        OWNER_SIM_BUFFER_LEN,
    ])
}

fn dog_entries() -> Vec<WasmConstantEntry> {
    module_entries!("dog", dog_contract, [
        DOG_BUF_ACTIVE_UTILITY_ID,
        DOG_BUF_ACTIVE_UTILITY_SCORE,
        DOG_BUF_BALL_ACTIVE,
        DOG_BUF_BALL_IS_THROWN,
        DOG_BUF_BALL_X,
        DOG_BUF_BALL_Y,
        DOG_BUF_BARK_TIMER,
        DOG_BUF_CAM_ACTIVE,
        DOG_BUF_CAM_BOTTOM,
        DOG_BUF_CAM_LEFT,
        DOG_BUF_CAM_RIGHT,
        DOG_BUF_CAM_TOP,
        DOG_BUF_CATCH_UP_TIMER,
        DOG_BUF_CMD_BARK,
        DOG_BUF_CMD_FETCH_BALL,
        DOG_BUF_CMD_PET,
        DOG_BUF_CMD_PRAISE,
        DOG_BUF_CMD_TRIGGER_ZOOMIES,
        DOG_BUF_CMD_WHISTLE_RECALL,
        DOG_BUF_COMMAND_ACCEPT_COUNT,
        DOG_BUF_COMMAND_FLAGS,
        DOG_BUF_COMMAND_REJECT_COUNT,
        DOG_BUF_CURIOSITY,
        DOG_BUF_DOG_ANGLE,
        DOG_BUF_DOG_STATE_ID,
        DOG_BUF_DOG_VX,
        DOG_BUF_DOG_VY,
        DOG_BUF_DOG_X,
        DOG_BUF_DOG_Y,
        DOG_BUF_DT,
        DOG_BUF_ENERGY,
        DOG_BUF_EVENT_BITMASK,
        DOG_BUF_EVENT_BITMASK_HI,
        DOG_BUF_EVENT_BITMASK_HI2,
        DOG_BUF_FETCH_TIMER,
        DOG_BUF_GAIT_MODE_ID,
        DOG_BUF_GAIT_PHASE,
        DOG_BUF_IDLE_REST_TIMER,
        DOG_BUF_IS_BALL_HELD,
        DOG_BUF_IS_HUNGRY,
        DOG_BUF_IS_ON_LEASH,
        DOG_BUF_IS_TIRED,
        DOG_BUF_LEASH_FLAGS,
        DOG_BUF_LEASH_PULL_COOLDOWN,
        DOG_BUF_LEASH_SAG_PX,
        DOG_BUF_LEASH_TENSION,
        DOG_BUF_LEASH_TUG_TIMER,
        DOG_BUF_LEASH_VIBRATION_PX,
        DOG_BUF_LEFT_EAR_ANGLE,
        DOG_BUF_LEFT_EAR_VEL,
        DOG_BUF_LOYALTY,
        DOG_BUF_NEEDS_GROOMING,
        DOG_BUF_NEXT_POOP_TIME,
        DOG_BUF_NOSE_TWITCH,
        DOG_BUF_NOW_SEC,
        DOG_BUF_NPC0_X,
        DOG_BUF_NPC0_Y,
        DOG_BUF_NPC1_X,
        DOG_BUF_NPC1_Y,
        DOG_BUF_NPC2_X,
        DOG_BUF_NPC2_Y,
        DOG_BUF_NPC3_X,
        DOG_BUF_NPC3_Y,
        DOG_BUF_NPC_COUNT,
        DOG_BUF_OWNER_CLAMPED_X,
        DOG_BUF_OWNER_CLAMPED_Y,
        DOG_BUF_OWNER_FLAGS,
        DOG_BUF_OWNER_GAIT_ID,
        DOG_BUF_OWNER_HALF_WIDTH,
        DOG_BUF_OWNER_HEADING,
        DOG_BUF_OWNER_IS_MOVING,
        DOG_BUF_OWNER_STILL_TIMER,
        DOG_BUF_OWNER_VX,
        DOG_BUF_OWNER_VY,
        DOG_BUF_OWNER_X,
        DOG_BUF_OWNER_Y,
        DOG_BUF_PACK_PLAY_PARTNER_ID,
        DOG_BUF_PACK_PLAY_STATE,
        DOG_BUF_PACK_PLAY_TIMER,
        DOG_BUF_PEER0_X,
        DOG_BUF_PEER0_Y,
        DOG_BUF_PEER1_X,
        DOG_BUF_PEER1_Y,
        DOG_BUF_PEER2_X,
        DOG_BUF_PEER2_Y,
        DOG_BUF_PEER3_X,
        DOG_BUF_PEER3_Y,
        DOG_BUF_PEER_COUNT,
        DOG_BUF_PET_TIMER,
        DOG_BUF_POOP_SQUAT_DURATION,
        DOG_BUF_POOP_TIMER,
        DOG_BUF_PRAISE_TIMER,
        DOG_BUF_PREFERRED_SIDE_SIGN,
        DOG_BUF_RECALL_HEEL_TIMER,
        DOG_BUF_RESERVED_INPUT_0,
        DOG_BUF_RESERVED_INPUT_1,
        DOG_BUF_RIGHT_EAR_ANGLE,
        DOG_BUF_RIGHT_EAR_VEL,
        DOG_BUF_RNG_SEED,
        DOG_BUF_ROAM_BASELINE_TIMER,
        DOG_BUF_ROAM_CURRENT_SPEED,
        DOG_BUF_ROAM_LOOKBACK_TIMER,
        DOG_BUF_ROAM_MICROPAUSE_TIMER,
        DOG_BUF_ROAM_SUBMODE_ID,
        DOG_BUF_ROAM_SUBMODE_TIMER,
        DOG_BUF_ROAM_TARGET_SPEED,
        DOG_BUF_ROAM_WAYPOINT_X,
        DOG_BUF_ROAM_WAYPOINT_Y,
        DOG_BUF_SCENT0_X,
        DOG_BUF_SCENT0_Y,
        DOG_BUF_SCENT1_X,
        DOG_BUF_SCENT1_Y,
        DOG_BUF_SCENT2_X,
        DOG_BUF_SCENT2_Y,
        DOG_BUF_SCENT3_X,
        DOG_BUF_SCENT3_Y,
        DOG_BUF_SCENT_COUNT,
        DOG_BUF_SOCIAL_COOLDOWN,
        DOG_BUF_STATE_FLAGS,
        DOG_BUF_STATE_TIMER,
        DOG_BUF_STRAY_CHECK_TIMER,
        DOG_BUF_STUBBORNNESS,
        DOG_BUF_SUNNY_ROLL_STATE,
        DOG_BUF_SUNNY_ROLL_TIMER,
        DOG_BUF_TAIL_ANGLE,
        DOG_BUF_TARGET_SLOT_X,
        DOG_BUF_TARGET_SLOT_Y,
        DOG_BUF_TRANSITION_STATE,
        DOG_BUF_WAG_SPEED,
        DOG_BUF_WANDER_ANGLE,
        DOG_BUF_WANDER_TIMER,
        DOG_BUF_WHISTLE_COOLDOWN,
        DOG_BUF_ZONE_IS_SUNNY,
        DOG_BUF_ZOOMIES_CENTER_X,
        DOG_BUF_ZOOMIES_CENTER_Y,
        DOG_BUF_ZOOMIES_COOLDOWN,
        DOG_BUF_ZOOMIES_ORBIT_ANGLE,
        DOG_BUF_ZOOMIES_ORBIT_DIR,
        DOG_BUF_ZOOMIES_ORBIT_RADIUS,
        DOG_BUF_ZOOMIES_PHASE,
        DOG_BUF_ZOOMIES_SHUTTLE_AX,
        DOG_BUF_ZOOMIES_SHUTTLE_AY,
        DOG_BUF_ZOOMIES_SHUTTLE_BX,
        DOG_BUF_ZOOMIES_SHUTTLE_BY,
        DOG_BUF_ZOOMIES_TIMER,
        DOG_BUF_ZOOMIE_PATH_ID,
        DOG_EVENT_BALL_GRABBED,
        DOG_EVENT_BALL_HANDOFF,
        DOG_EVENT_BARK,
        DOG_EVENT_BARK_TRIGGERED,
        DOG_EVENT_COMMAND_REJECTED,
        DOG_EVENT_FETCH_COMPLETED,
        DOG_EVENT_FETCH_STARTED,
        DOG_EVENT_GALLOP_PUFF,
        DOG_EVENT_HEARTS_SPAWNED,
        DOG_EVENT_LEASH_SLACK,
        DOG_EVENT_LEASH_TAUT,
        DOG_EVENT_NEED_GROOMING,
        DOG_EVENT_NEED_HUNGRY,
        DOG_EVENT_NEED_TIRED,
        DOG_EVENT_NONE,
        DOG_EVENT_PACK_PLAY_BROKEN,
        DOG_EVENT_PACK_PLAY_STARTED,
        DOG_EVENT_PANT_AUDIO,
        DOG_EVENT_PET_ACCEPTED,
        DOG_EVENT_POOP_DROPPED,
        DOG_EVENT_PRAISE_ACCEPTED,
        DOG_EVENT_RECALL_ARRIVED,
        DOG_EVENT_SCENT_DEPOSITED,
        DOG_EVENT_SNIFF_AUDIO,
        DOG_EVENT_SOCIAL_COOLDOWN_REJECT,
        DOG_EVENT_STICK_PICKED_UP,
        DOG_EVENT_STRAY_RESOLVED,
        DOG_EVENT_STRAY_TRIGGERED,
        DOG_EVENT_SUNNY_ROLL_FINISHED,
        DOG_EVENT_SUNNY_ROLL_STARTED,
        DOG_EVENT_SUNNY_ZONE_ENTERED,
        DOG_EVENT_TRANSITION_STATE_CHANGED,
        DOG_EVENT_WHINE_AUDIO,
        DOG_EVENT_WHISTLE_RECALL_STARTED,
        DOG_EVENT_ZOOMIES_STARTED,
        DOG_SIM_BUFFER_LEN,
    ])
}

fn owner_entries() -> Vec<WasmConstantEntry> {
    module_entries!("owner", owner_sim, [
        MAX_LEASH_LENGTH,
        OWNER_CMD_CLEAR_FACE_DOG,
        OWNER_CMD_CLEAR_WANDER,
        OWNER_CMD_FACE_DOG,
        OWNER_CMD_JOG,
        OWNER_CMD_NONE,
        OWNER_CMD_RESET,
        OWNER_CMD_STOP,
        OWNER_CMD_STROLL,
        OWNER_CMD_WALK,
        OWNER_CMD_WANDER,
        OWNER_EVENT_BOUNDARY_BLOCKED,
        OWNER_EVENT_COMMAND_REJECTED,
        OWNER_EVENT_GAIT_CHANGED,
        OWNER_EVENT_JOG_COOLDOWN_READY,
        OWNER_EVENT_JOG_STARTED,
        OWNER_EVENT_LEASH_FORCED_STAND,
        OWNER_EVENT_LEASH_SLACK,
        OWNER_EVENT_LEASH_TAUT,
        OWNER_EVENT_OBSTACLE_DEFLECTED,
        OWNER_EVENT_POOP_HOLD,
        OWNER_EVENT_RESET,
        OWNER_EVENT_STEP_OFF_FINISHED,
        OWNER_EVENT_STEP_OFF_STARTED,
        OWNER_EVENT_WALK_CYCLE,
        OWNER_EVENT_WANDER_BLOCKED,
        OWNER_EVENT_WANDER_STARTED,
        OWNER_EVENT_WARP_GATE_ENTERED,
        OWNER_EVENT_WARP_GATE_EXITED,
        OWNER_SLOT_ANGLE,
        OWNER_SLOT_CMD_FLAGS,
        OWNER_SLOT_DESIRED_GAIT,
        OWNER_SLOT_DIST_TRAVELED,
        OWNER_SLOT_DOG_REL_X,
        OWNER_SLOT_DOG_REL_Y,
        OWNER_SLOT_DT,
        OWNER_SLOT_EVENT_BITMASK,
        OWNER_SLOT_FACE_DOG_LATCH,
        OWNER_SLOT_GAIT,
        OWNER_SLOT_HAND_LOCAL_X,
        OWNER_SLOT_HAND_LOCAL_Y,
        OWNER_SLOT_INPUT_X,
        OWNER_SLOT_INPUT_Y,
        OWNER_SLOT_JOG_COOLDOWN,
        OWNER_SLOT_JOG_TIMER,
        OWNER_SLOT_LAST_SAFE_X,
        OWNER_SLOT_LAST_SAFE_Y,
        OWNER_SLOT_LAST_STEP_DT,
        OWNER_SLOT_LEASH_TAUT,
        OWNER_SLOT_LEASH_TENSION,
        OWNER_SLOT_POOP_HOLD_TIMER,
        OWNER_SLOT_PREV_GAIT,
        OWNER_SLOT_RNG_HI,
        OWNER_SLOT_RNG_LO,
        OWNER_SLOT_SPEED,
        OWNER_SLOT_SPEED_MULTIPLIER,
        OWNER_SLOT_STEP_COUNT,
        OWNER_SLOT_STEP_OFF_TIMER,
        OWNER_SLOT_VX,
        OWNER_SLOT_VY,
        OWNER_SLOT_WALK_CYCLE,
        OWNER_SLOT_WALK_PHASE,
        OWNER_SLOT_WANDER_BLOCKED,
        OWNER_SLOT_WANDER_HEADING,
        OWNER_SLOT_WANDER_TIMER,
        OWNER_SLOT_WARP_COOLDOWN,
        OWNER_SLOT_WARP_GATE_ID,
        OWNER_SLOT_X,
        OWNER_SLOT_Y,
    ])
}

fn care_entries() -> Vec<WasmConstantEntry> {
    module_entries!("care", care_sim, [
        CARE_CMD_FEED,
        CARE_CMD_GROOM,
        CARE_CMD_RESET,
        CARE_CMD_REST,
        CARE_EVENT_ACTION_REJECTED,
        CARE_EVENT_FEED_ACCEPTED,
        CARE_EVENT_GROOMING_NEEDED,
        CARE_EVENT_GROOMING_RESOLVED,
        CARE_EVENT_GROOM_ACCEPTED,
        CARE_EVENT_HUNGER_RESOLVED,
        CARE_EVENT_HUNGER_STARTED,
        CARE_EVENT_REJECTION_ANIM_FINISHED,
        CARE_EVENT_RESET,
        CARE_EVENT_REST_ACCEPTED,
        CARE_EVENT_TIREDNESS_RESOLVED,
        CARE_EVENT_TIREDNESS_STARTED,
        CARE_EVENT_TOAST,
        CARE_EVENT_UI_FLASH,
        CARE_SLOT_ACTION_FLAGS,
        CARE_SLOT_EVENT_BITMASK,
        CARE_SLOT_FEED_COUNT,
        CARE_SLOT_FEED_FLASH_TIMER_MS,
        CARE_SLOT_GROOMING_DURATION_MS,
        CARE_SLOT_GROOMING_ELAPSED_MS,
        CARE_SLOT_GROOMING_LAST_GROOMED_MS,
        CARE_SLOT_GROOMING_REMAINING_MS,
        CARE_SLOT_GROOM_COUNT,
        CARE_SLOT_GROOM_FLASH_TIMER_MS,
        CARE_SLOT_HUNGER_DURATION_MS,
        CARE_SLOT_HUNGER_ELAPSED_MS,
        CARE_SLOT_HUNGER_LAST_FED_MS,
        CARE_SLOT_HUNGER_REMAINING_MS,
        CARE_SLOT_IS_HUNGRY,
        CARE_SLOT_IS_TIRED,
        CARE_SLOT_LAST_ACTION,
        CARE_SLOT_LAST_ACTION_ELAPSED_MS,
        CARE_SLOT_LAST_STEP_DT_MS,
        CARE_SLOT_NEEDS_GROOMING,
        CARE_SLOT_NOW_MS,
        CARE_SLOT_REJECTION_ANIM_TIMER_MS,
        CARE_SLOT_REJECTION_KIND,
        CARE_SLOT_REST_COUNT,
        CARE_SLOT_REST_FLASH_TIMER_MS,
        CARE_SLOT_TIREDNESS_DURATION_MS,
        CARE_SLOT_TIREDNESS_ELAPSED_MS,
        CARE_SLOT_TIREDNESS_LAST_RESTED_MS,
        CARE_SLOT_TIREDNESS_REMAINING_MS,
        CARE_SLOT_UI_TOAST_KIND,
    ])
}

fn ball_entries() -> Vec<WasmConstantEntry> {
    module_entries!("ball", ball_physics, [
        BALL_CMD_ATTACH_TO_DOG,
        BALL_CMD_DROP,
        BALL_CMD_RESET,
        BALL_CMD_RETRIEVE_BY_OWNER,
        BALL_CMD_SET_POSITION,
        BALL_CMD_THROW,
        BALL_EVENT_AIRBORNE,
        BALL_EVENT_ATTACHED,
        BALL_EVENT_ATTACHED_TO_DOG,
        BALL_EVENT_BOUNCED,
        BALL_EVENT_CEILING,
        BALL_EVENT_CMD_REJECTED,
        BALL_EVENT_DROPPED,
        BALL_EVENT_LANDED,
        BALL_EVENT_NONE,
        BALL_EVENT_OUT_OF_BOUNDS,
        BALL_EVENT_OWNER_RETRIEVED,
        BALL_EVENT_RESET,
        BALL_EVENT_RETRIEVED,
        BALL_EVENT_RETRIEVED_BY_OWNER,
        BALL_EVENT_SETTLED,
        BALL_EVENT_THROWN,
        BALL_SLOT_AGE_S,
        BALL_SLOT_ATTACHED_TO_DOG,
        BALL_SLOT_BOUNCE_COUNT,
        BALL_SLOT_CEILING_Z,
        BALL_SLOT_CMD_FLAGS,
        BALL_SLOT_COMMANDS,
        BALL_SLOT_COMMAND_FLAGS,
        BALL_SLOT_CONFIG_FLAGS,
        BALL_SLOT_DRAG_PER_S,
        BALL_SLOT_FIELD_MAX_X,
        BALL_SLOT_FIELD_MAX_Y,
        BALL_SLOT_FIELD_MIN_X,
        BALL_SLOT_FIELD_MIN_Y,
        BALL_SLOT_GRAVITY,
        BALL_SLOT_GROUND_Z,
        BALL_SLOT_IN_OWNER_POSSESSION,
        BALL_SLOT_IS_AIRBORNE,
        BALL_SLOT_IS_CARRIED,
        BALL_SLOT_IS_THROWN,
        BALL_SLOT_LAST_EVENT_MASK,
        BALL_SLOT_MAX_BOUNCES,
        BALL_SLOT_POS_X,
        BALL_SLOT_POS_Y,
        BALL_SLOT_POS_Z,
        BALL_SLOT_RADIUS,
        BALL_SLOT_RESERVED_30,
        BALL_SLOT_RESERVED_31,
        BALL_SLOT_RESTITUTION,
        BALL_SLOT_SETTLE_EPS,
        BALL_SLOT_SPIN,
        BALL_SLOT_STATE,
        BALL_SLOT_STATE_ID,
        BALL_SLOT_VEL_X,
        BALL_SLOT_VEL_Y,
        BALL_SLOT_VEL_Z,
        BALL_SLOT_VX,
        BALL_SLOT_VY,
        BALL_SLOT_VZ,
        BALL_SLOT_X,
        BALL_SLOT_Y,
        BALL_SLOT_Z,
    ])
}

fn npc_entries() -> Vec<WasmConstantEntry> {
    module_entries!("npc", npc_sim, [
        NPC_CMD_FORCE_SPEECH,
        NPC_CMD_PAUSE,
        NPC_CMD_RESET,
        NPC_CMD_RESUME,
        NPC_CMD_SET_RUNNING,
        NPC_CMD_SET_WALKING,
        NPC_EVENT_CMD_REJECTED,
        NPC_EVENT_FADE_COMPLETED,
        NPC_EVENT_FADE_STARTED,
        NPC_EVENT_PATH_FINISHED,
        NPC_EVENT_PAUSED,
        NPC_EVENT_RESET,
        NPC_EVENT_RESUMED,
        NPC_EVENT_SPEECH_HIDDEN,
        NPC_EVENT_SPEECH_TRIGGERED,
        NPC_EVENT_STATE_CHANGED,
        NPC_SLOT_CMD_FLAGS,
        NPC_SLOT_DONE,
        NPC_SLOT_ELAPSED_S,
        NPC_SLOT_FADE_COMPLETED,
        NPC_SLOT_FADE_ELAPSED_S,
        NPC_SLOT_FADE_START_S,
        NPC_SLOT_FINISH_TIME_S,
        NPC_SLOT_HEADING_RAD,
        NPC_SLOT_IS_FINISHED_STATE,
        NPC_SLOT_NEXT_SPEECH_DELAY_S,
        NPC_SLOT_OPACITY,
        NPC_SLOT_OPACITY_TARGET,
        NPC_SLOT_PATH_HASH,
        NPC_SLOT_PATH_POINT_COUNT,
        NPC_SLOT_PATH_TOTAL_LENGTH_PX,
        NPC_SLOT_PAUSE_REMAINING_S,
        NPC_SLOT_PHRASE_TIMER_S,
        NPC_SLOT_RNG_STATE,
        NPC_SLOT_SEED,
        NPC_SLOT_SEGMENT_INDEX,
        NPC_SLOT_SEGMENT_T,
        NPC_SLOT_SPEECH_PHRASE_ID,
        NPC_SLOT_SPEECH_TIMER_S,
        NPC_SLOT_SPEECH_VISIBLE,
        NPC_SLOT_SPEECH_WINDOW_S,
        NPC_SLOT_SPEED_SCALE,
        NPC_SLOT_STATE,
        NPC_SLOT_X,
        NPC_SLOT_Y,
    ])
}

fn collision_entries() -> Vec<WasmConstantEntry> {
    // The collision module currently exposes no matching `pub const` symbols.
    Vec::new()
}

fn entries_for(namespace: &str) -> Vec<WasmConstantEntry> {
    let mut entries = match namespace {
        "world" => world_entries(),
        "dog" => dog_entries(),
        "owner" => owner_entries(),
        "care" => care_entries(),
        "ball" => ball_entries(),
        "npc" => npc_entries(),
        "collision" => collision_entries(),
        _ => Vec::new(),
    };
    entries.sort_by(|a, b| a.name.cmp(b.name));
    entries
}

/// Flattened registry in canonical namespace and name order.
pub fn registry() -> Vec<WasmConstantEntry> {
    let mut entries = Vec::new();
    for namespace in NAMESPACE_ORDER.iter().copied() {
        entries.extend(entries_for(namespace));
    }
    entries
}

fn json_key(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for ch in value.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            other => escaped.push(other),
        }
    }
    escaped.push('"');
    escaped
}

/// Render the registry as deterministic, parseable JSON.
pub fn render_json() -> String {
    let mut out = String::new();
    out.push_str("{\n");

    let namespaces = NAMESPACE_ORDER;
    for (namespace_index, namespace) in namespaces.iter().copied().enumerate() {
        let entries = entries_for(namespace);
        out.push_str("  ");
        out.push_str(&json_key(namespace));
        out.push_str(": {");

        if entries.is_empty() {
            out.push('}');
        } else {
            out.push('\n');
            for (entry_index, entry) in entries.iter().enumerate() {
                out.push_str("    ");
                out.push_str(&json_key(entry.name));
                out.push_str(": ");
                out.push_str(&entry.value.to_string());
                if entry_index + 1 < entries.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str("  }");
        }

        if namespace_index + 1 < namespaces.len() {
            out.push(',');
        }
        out.push('\n');
    }

    out.push('}');
    out
}

/// Render the registry as deterministic JS with JSDoc typing.
pub fn render_js() -> String {
    let mut out = String::new();
    out.push_str(
        "// GENERATED FILE - DO NOT EDIT. Source: dog_walker_core::wasm_contract_export.\n",
    );
    out.push_str("// @ts-check\n");
    out.push_str("/**\n");
    out.push_str(" * @typedef {import('../types/wasm_contracts').GeneratedWasmConstants} GeneratedWasmConstants\n");
    out.push_str(" */\n\n");
    out.push_str("/** @type {GeneratedWasmConstants} */\n");
    out.push_str("export const WASM_CONSTANTS = Object.freeze({\n");

    for namespace in NAMESPACE_ORDER.iter().copied() {
        let entries = entries_for(namespace);
        out.push_str("  ");
        out.push_str(namespace);
        out.push_str(": Object.freeze({");

        if entries.is_empty() {
            out.push('}');
        } else {
            out.push('\n');
            for entry in &entries {
                out.push_str("    ");
                out.push_str(entry.name);
                out.push_str(": ");
                out.push_str(&entry.value.to_string());
                out.push_str(",\n");
            }
            out.push_str("  }");
        }

        out.push_str("),\n");
    }

    out.push_str("});\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_js_starts_with_generated_header() {
        let js = render_js();
        assert!(
            js.starts_with(
                "// GENERATED FILE - DO NOT EDIT. Source: dog_walker_core::wasm_contract_export.\n// @ts-check\n"
            ),
            "rendered JS must start with the canonical generated header"
        );
    }

    #[test]
    fn render_js_has_no_double_closing_braces() {
        let js = render_js();
        assert!(
            !js.contains("}}"),
            "rendered JS must not contain double closing braces"
        );
    }

    #[test]
    fn render_js_closes_each_namespace_with_single_brace() {
        let js = render_js();
        assert!(
            js.contains("  }),\n"),
            "rendered JS must close each namespace with `  }},\\n`"
        );
    }

    #[test]
    fn render_js_ends_with_outer_object_close() {
        let js = render_js();
        assert!(
            js.ends_with("});\n"),
            "rendered JS must end with `}});\\n`"
        );
    }
}
