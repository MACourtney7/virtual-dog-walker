/**
 * Shared domain type contracts for the Virtual Dog Walker simulation.
 *
 * Declaration-only module: these types describe the structural shape of
 * runtime objects exchanged between the JS engine, renderer, and UI layers.
 * No runtime code lives here.
 */

/** Stable identifier for any simulated entity. */
export type EntityId = string;

/** Packed per-tick command bits emitted by input systems. */
export type CommandFlags = number;

/** Packed per-tick event bits emitted by the simulation. */
export type EventBitmask = number;

/** Two dimensional position/vector in world units. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Three dimensional vector; `Vec2` extended with an elevation component. */
export interface Vec3 extends Vec2 {
  readonly z: number;
}

/** Monotonic fixed-step simulation clock. */
export interface GameClock {
  /** Fixed-step tick counter. */
  readonly tick: number;
  /** Seconds elapsed since simulation start. */
  readonly elapsedSeconds: number;
  /** Length of a single simulation step in seconds. */
  readonly fixedStepSeconds: number;
}

/** Fields shared by every simulated actor that occupies the world. */
export interface EntityTransform {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** High-level emotional state of the player's dog. */
export type DogMood = "calm" | "excited" | "anxious" | "tired";

/** Current behaviour mode of the player's dog. */
export type DogBehavior = "idle" | "walk" | "sniff" | "fetch" | "rest";

/** State of the player's dog. */
export interface DogState extends EntityTransform {
  readonly name: string;
  readonly ownerId: EntityId;
  readonly mood: DogMood;
  readonly behavior: DogBehavior;
  /** Normalised [0, 1] hunger level. */
  readonly hunger: number;
  /** Normalised [0, 1] stamina level. */
  readonly stamina: number;
  readonly carryingToyId: EntityId | null;
  readonly leashed: boolean;
  readonly targetEntityId: EntityId | null;
}

/** State of the local player character walking the dog. */
export interface OwnerState extends EntityTransform {
  readonly name: string;
  readonly dogId: EntityId;
  readonly leashLength: number;
  readonly facing: Vec2;
  readonly isLocal: boolean;
  /** Peer identifier when this owner is remote, `null` when local. */
  readonly peerId: string | null;
}

/** Kind of ambient non-player character present in the world. */
export type NpcKind = "walker" | "jogger" | "child" | "cyclist" | "vendor";

/** State of an ambient non-player character. */
export interface NpcState extends EntityTransform {
  readonly kind: NpcKind;
  /** Heading angle in radians. */
  readonly heading: number;
  readonly patrolWaypoint: Vec2 | null;
  readonly speed: number;
}

/** Kind of throwable/fetchable toy. */
export type ToyKind = "ball" | "frisbee" | "rope" | "bone";

/** State of a toy in the world. */
export interface ToyState extends EntityTransform {
  readonly kind: ToyKind;
  readonly ownerId: EntityId;
  readonly inFlight: boolean;
  /** Normalised [0, 1] durability remaining. */
  readonly durability: number;
}

/** How fresh a piece of waste is. */
export type WasteSeverity = "fresh" | "stale" | "decomposed";

/** State of a waste entity left in the world. */
export interface WasteState extends EntityTransform {
  readonly severity: WasteSeverity;
  readonly createdAtTick: number;
  readonly cleaned: boolean;
}

/** Why an entity was despawned and recorded as a tombstone. */
export type TombstoneReason = "despawned" | "error" | "expired" | "collected";

/** Non-renderable record of a despawned entity. */
export interface TombstoneState extends EntityTransform {
  readonly entityId: EntityId;
  readonly reason: TombstoneReason;
  /** Tick at which the tombstone was created. */
  readonly tick: number;
}

/** Complete immutable view of the simulation for a single tick. */
export interface SimulationSnapshot {
  readonly clock: GameClock;
  readonly dog: DogState;
  readonly owner: OwnerState;
  readonly npcs: readonly NpcState[];
  readonly toys: readonly ToyState[];
  readonly waste: readonly WasteState[];
  readonly tombstones: readonly TombstoneState[];
  readonly commandFlags: CommandFlags;
  readonly eventBits: EventBitmask;
}
