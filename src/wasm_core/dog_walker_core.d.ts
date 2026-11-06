/* tslint:disable */
/* eslint-disable */

export class WasmWorldSim {
    free(): void;
    [Symbol.dispose](): void;
    constructor(world_width: number, world_height: number);
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
     * Replace the exact field obstacle set (JSON array of
     * `{"kind":"circle","x","y","r"}` / `{"kind":"rect","x","y","hw","hh"}`), in the same order as
     * `Field.resolveCircleCollision` applies them.
     */
    set_world_obstacles(obstacles_json: string): boolean;
    step_ball(dt: number): Float64Array;
    /**
     * Ear spring integration towards JS-computed targets. Returns [lAngle, lVel, rAngle, rVel].
     */
    step_ear_targets(left_angle: number, left_v: number, right_angle: number, right_v: number, target_left: number, target_right: number, spring_k: number, spring_damp: number, dt: number): Float64Array;
    step_ears(left_angle: number, left_v: number, right_angle: number, right_v: number, dog_vx: number, dog_vy: number, dog_angle: number, dt: number): Float64Array;
    step_leash(dog_x: number, dog_y: number, dog_vx: number, dog_vy: number, owner_x: number, owner_y: number, max_length: number, stiffness: number, damping: number, dt: number): Float64Array;
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
    readonly wasmworldsim_new: (a: number, b: number) => number;
    readonly wasmworldsim_resolve_collision: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmworldsim_resolve_field_collision: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmworldsim_sample_npc: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmworldsim_sample_npc_path: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmworldsim_set_colliders: (a: number, b: number, c: number) => void;
    readonly wasmworldsim_set_world_obstacles: (a: number, b: number, c: number) => number;
    readonly wasmworldsim_step_ball: (a: number, b: number, c: number) => void;
    readonly wasmworldsim_step_ear_targets: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly wasmworldsim_step_ears: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly wasmworldsim_step_leash: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
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
