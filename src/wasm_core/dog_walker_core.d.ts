/* tslint:disable */
/* eslint-disable */

export class WasmWorldSim {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Length of the ball simulation buffer in f32 slots.
     */
    ball_buffer_len(): number;
    /**
     * Pointer to the persistent zeroed ball simulation buffer.
     */
    ball_buffer_ptr(): number;
    /**
     * Ball event bitmask from the last ball step.
     */
    ball_event_bitmask(): number;
    /**
     * Length of the care simulation buffer in f32 slots.
     */
    care_buffer_len(): number;
    /**
     * Pointer to the persistent zeroed care simulation buffer.
     */
    care_buffer_ptr(): number;
    /**
     * Care event bitmask from the last care step.
     */
    care_event_bitmask(): number;
    /**
     * Length of the dog simulation buffer in f32 slots.
     */
    dog_buffer_len(): number;
    /**
     * Pointer to the persistent zeroed dog simulation buffer (128 f32 slots).
     */
    dog_buffer_ptr(): number;
    /**
     * Dog event bitmask from the last dog step (combined utility-AI and
     * leash-needs events).
     */
    dog_event_bitmask(): number;
    constructor(world_width: number, world_height: number);
    /**
     * Length of each NPC simulation buffer in f32 slots.
     */
    npc_buffer_len(): number;
    /**
     * Pointer to the persistent zeroed NPC simulation buffer for `slot`.
     * Returns null when `slot` is out of range.
     */
    npc_buffer_ptr(slot: number): number;
    /**
     * NPC event bitmask for `slot`, or `0` when `slot` is out of range.
     */
    npc_event_bitmask(slot: number): number;
    /**
     * Length of the owner simulation buffer in f32 slots.
     */
    owner_buffer_len(): number;
    /**
     * Pointer to the persistent zeroed owner simulation buffer.
     */
    owner_buffer_ptr(): number;
    /**
     * Owner event bitmask from the last owner step.
     */
    owner_event_bitmask(): number;
    resolve_collision(x: number, y: number, radius: number): Float64Array;
    /**
     * Exact port of `Field.resolveCircleCollision` (56px perimeter, trees/benches/bins/tower/rocks).
     */
    resolve_field_collision(x: number, y: number, radius: number): Float64Array;
    sample_npc(waypoints_flat: Float64Array | number[], speed: number, spawn_time: number, now: number): Float64Array;
    /**
     * Exact in-progress NPC path sample (see `npc_sim::sample_path_exact`).
     * Returns [x, y, vx, vy, angle, hasAngle(0/1)].
     */
    sample_npc_path(waypoints_flat: Float64Array | number[], speed: number, distance: number): Float64Array;
    set_colliders(colliders_json: string): void;
    /**
     * Register an NPC path for `slot`. Copies up to 32 `(x, y)` pairs from
     * `flat_xy` (interleaved x, y) and stores the phrase count. Out-of-range
     * slots are ignored without mutating state.
     */
    set_npc_path(slot: number, flat_xy: Float32Array | number[], phrase_count: number): void;
    /**
     * Replace the exact field obstacle set (JSON array of
     * `{"kind":"circle","x","y","r"}` / `{"kind":"rect","x","y","hw","hh"}`), in the same order as
     * `Field.resolveCircleCollision` applies them.
     */
    set_world_obstacles(obstacles_json: string): boolean;
    /**
     * Advance every domain buffer in the locked order: care, owner, ball,
     * NPC slots `0..MAX_PARK_NPCS`, dog utility AI, dog leash needs.
     *
     * Returns a summary bitset:
     * - bit 0: owner event
     * - bit 1: care event
     * - bit 2: ball event
     * - bit 3: any NPC event
     * - bit 4: dog event (utility AI or leash needs)
     * - bits 5..63: zero
     */
    step_all_buffers(dt_s: number): bigint;
    step_ball(dt: number): Float64Array;
    /**
     * Advance the ball buffer by one tick. Returns the ball event bitmask.
     */
    step_ball_buffer(dt_s: number): number;
    /**
     * Advance the care buffer by one tick. Returns the care event bitmask.
     */
    step_care_buffer(dt_ms: number): number;
    /**
     * Advance the persistent dog simulation buffer by one tick.
     *
     * Orchestrates need resolution, leash slot, utility AI, movement
     * integration, and leash/owner constraints. The buffer is mutated in
     * place; this path never returns a `Vec<f64>`.
     */
    step_dog_buffer(): void;
    /**
     * Advance the dog leash/needs pipeline by one tick. Returns the leash
     * event bitmask.
     */
    step_dog_leash_needs(dt_s: number): number;
    /**
     * Advance the dog utility AI by one tick. Returns the dog event bitmask.
     */
    step_dog_utility_ai(dt_s: number): number;
    /**
     * Ear spring integration towards JS-computed targets. Returns [lAngle, lVel, rAngle, rVel].
     */
    step_ear_targets(left_angle: number, left_v: number, right_angle: number, right_v: number, target_left: number, target_right: number, spring_k: number, spring_damp: number, dt: number): Float64Array;
    step_ears(left_angle: number, left_v: number, right_angle: number, right_v: number, dog_vx: number, dog_vy: number, dog_angle: number, dt: number): Float64Array;
    step_leash(dog_x: number, dog_y: number, dog_vx: number, dog_vy: number, owner_x: number, owner_y: number, max_length: number, stiffness: number, damping: number, dt: number): Float64Array;
    /**
     * Advance the NPC buffer for `slot` by one tick. Returns the NPC event
     * bitmask, or `0` when `slot` is out of range.
     */
    step_npc_buffer(slot: number, dt_s: number): number;
    /**
     * Advance the owner buffer by one tick. Returns the owner event bitmask.
     */
    step_owner_buffer(dt_s: number): number;
    /**
     * Stateless TennisBall step (matches `toy.js`). `state` = [x, y, z, vx, vy, vz].
     * Returns [x, y, z, vx, vy, vz]. Independent of the single internal `ball`.
     */
    step_toy_ball(x: number, y: number, z: number, vx: number, vy: number, vz: number, dt: number, world_w: number, world_h: number): Float64Array;
    throw_ball(start_x: number, start_y: number, target_x: number, target_y: number, power: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmworldsim_free: (a: number, b: number) => void;
    readonly wasmworldsim_ball_buffer_len: (a: number) => number;
    readonly wasmworldsim_ball_buffer_ptr: (a: number) => number;
    readonly wasmworldsim_ball_event_bitmask: (a: number) => number;
    readonly wasmworldsim_care_buffer_len: (a: number) => number;
    readonly wasmworldsim_care_buffer_ptr: (a: number) => number;
    readonly wasmworldsim_care_event_bitmask: (a: number) => number;
    readonly wasmworldsim_dog_buffer_len: (a: number) => number;
    readonly wasmworldsim_dog_buffer_ptr: (a: number) => number;
    readonly wasmworldsim_dog_event_bitmask: (a: number) => number;
    readonly wasmworldsim_new: (a: number, b: number) => number;
    readonly wasmworldsim_npc_buffer_len: (a: number) => number;
    readonly wasmworldsim_npc_buffer_ptr: (a: number, b: number) => number;
    readonly wasmworldsim_npc_event_bitmask: (a: number, b: number) => number;
    readonly wasmworldsim_owner_buffer_len: (a: number) => number;
    readonly wasmworldsim_owner_buffer_ptr: (a: number) => number;
    readonly wasmworldsim_owner_event_bitmask: (a: number) => number;
    readonly wasmworldsim_resolve_collision: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmworldsim_resolve_field_collision: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmworldsim_sample_npc: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmworldsim_sample_npc_path: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmworldsim_set_colliders: (a: number, b: number, c: number) => void;
    readonly wasmworldsim_set_npc_path: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmworldsim_set_world_obstacles: (a: number, b: number, c: number) => number;
    readonly wasmworldsim_step_all_buffers: (a: number, b: number) => bigint;
    readonly wasmworldsim_step_ball: (a: number, b: number, c: number) => void;
    readonly wasmworldsim_step_ball_buffer: (a: number, b: number) => number;
    readonly wasmworldsim_step_care_buffer: (a: number, b: number) => number;
    readonly wasmworldsim_step_dog_buffer: (a: number) => void;
    readonly wasmworldsim_step_dog_leash_needs: (a: number, b: number) => number;
    readonly wasmworldsim_step_dog_utility_ai: (a: number, b: number) => number;
    readonly wasmworldsim_step_ear_targets: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly wasmworldsim_step_ears: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly wasmworldsim_step_leash: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly wasmworldsim_step_npc_buffer: (a: number, b: number, c: number) => number;
    readonly wasmworldsim_step_owner_buffer: (a: number, b: number) => number;
    readonly wasmworldsim_step_toy_ball: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly wasmworldsim_throw_ball: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
