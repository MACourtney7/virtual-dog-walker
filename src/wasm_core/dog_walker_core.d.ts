/* tslint:disable */
/* eslint-disable */

export class WasmWorldSim {
    free(): void;
    [Symbol.dispose](): void;
    constructor(world_width: number, world_height: number);
    resolve_collision(x: number, y: number, radius: number): Float64Array;
    sample_npc(waypoints_flat: Float64Array | number[], speed: number, spawn_time: number, now: number): Float64Array;
    set_colliders(colliders_json: string): void;
    step_ball(dt: number): Float64Array;
    step_leash(dog_x: number, dog_y: number, dog_vx: number, dog_vy: number, owner_x: number, owner_y: number, max_length: number, stiffness: number, damping: number, dt: number): Float64Array;
    throw_ball(start_x: number, start_y: number, target_x: number, target_y: number, power: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmworldsim_free: (a: number, b: number) => void;
    readonly wasmworldsim_new: (a: number, b: number) => number;
    readonly wasmworldsim_resolve_collision: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmworldsim_sample_npc: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmworldsim_set_colliders: (a: number, b: number, c: number) => void;
    readonly wasmworldsim_step_ball: (a: number, b: number, c: number) => void;
    readonly wasmworldsim_step_leash: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
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
