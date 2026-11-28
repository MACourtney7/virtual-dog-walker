/**
 * Structural contracts for the generated WebAssembly simulation bridge.
 *
 * Declaration-only module: describes the shape of the JS wrapper around the
 * wasm module without redeclaring anything under `src/wasm/` or
 * `src/wasm_core/`. No runtime code lives here.
 */

/** Immutable configuration passed to the wasm simulation on init/reset. */
export interface WasmSimConfig {
  readonly seed: number;
  readonly maxEntities: number;
  readonly fixedStepSeconds: number;
  readonly tickRate: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly debug: boolean;
}

/** Layout of the shared input buffer filled by JS before a step. */
export interface WasmInputBuffer {
  /** Byte offset of the buffer inside wasm linear memory. */
  readonly pointer: number;
  /** Total buffer length in bytes. */
  readonly length: number;
  /** Bytes per entity record. */
  readonly stride: number;
  readonly commandFlags: number;
  readonly entityCount: number;
}

/** Layout of the shared output buffer produced by a simulation step. */
export interface WasmOutputBuffer {
  /** Byte offset of the buffer inside wasm linear memory. */
  readonly pointer: number;
  /** Total buffer length in bytes. */
  readonly length: number;
  /** Bytes per entity record. */
  readonly stride: number;
  readonly entityCount: number;
  readonly tick: number;
  readonly eventBits: number;
}

/** Bridge contract implemented by the JS wrapper around the wasm module. */
export interface WasmSimBridgeContract {
  readonly isReady: boolean;
  init(config: WasmSimConfig): void;
  /** Advance the simulation by one fixed step and return the new output. */
  step(input: WasmInputBuffer): WasmOutputBuffer;
  /** Read the most recent output buffer without advancing the simulation. */
  output(): WasmOutputBuffer;
  reset(config?: WasmSimConfig): void;
  dispose(): void;
}

/** Constants exported by the generated wasm bindings. */
export interface GeneratedWasmConstants {
  readonly WASM_VERSION: string;
  readonly PROTOCOL_VERSION: number;
  readonly MAX_ENTITIES: number;
  readonly ENTITY_STRIDE: number;
  readonly TICK_RATE: number;
  readonly FIXED_STEP_SECONDS: number;
}
