/**
 * Shared networking type contracts for the Virtual Dog Walker P2P transport.
 *
 * Declaration-only module: no runtime code lives here.
 */

import type { EntityId, Vec2, Vec3 } from "./domain";

/** Stable identifier for a remote peer on the mesh. */
export type PeerId = string;

/** Realtime chat message payload. */
export interface ChatPayload {
  readonly id: string;
  readonly authorId: PeerId;
  readonly text: string;
  /** Millisecond epoch timestamp supplied by the sender. */
  readonly sentAt: number;
  readonly channel: "local" | "global" | "system";
}

/** Coarse activity bucket advertised in presence beacons. */
export type PresenceActivity = "idle" | "walking" | "playing" | "offline";

/** Presence beacon describing a peer's current state. */
export interface PresenceState {
  readonly peerId: PeerId;
  readonly displayName: string;
  readonly activity: PresenceActivity;
  /** Millisecond epoch timestamp of the last beacon. */
  readonly lastSeen: number;
  readonly position: Vec3 | null;
  readonly dogId: EntityId | null;
  readonly online: boolean;
}

/** Frame exchanged over the zero-mesh transport. */
export interface ZeroMeshFrame {
  readonly nodeId: PeerId;
  readonly roomId: string;
  readonly sequence: number;
  /** Millisecond epoch timestamp of frame creation. */
  readonly timestamp: number;
  readonly payloadKind: "input" | "snapshot" | "event";
  /** Opaque encoded payload; decoded by the mesh adapter. */
  readonly payload: string;
  readonly origin: Vec2 | null;
}

/** A chat message travelling over the network. */
export interface ChatNetworkMessage {
  readonly kind: "chat";
  readonly chat: ChatPayload;
}

/** A presence update travelling over the network. */
export interface PresenceNetworkMessage {
  readonly kind: "presence";
  readonly presence: PresenceState;
}

/** A raw zero-mesh frame travelling over the network. */
export interface MeshFrameNetworkMessage {
  readonly kind: "mesh-frame";
  readonly frame: ZeroMeshFrame;
}

/** Discriminated union of every message kind carried by the protocol. */
export type NetworkMessage =
  | ChatNetworkMessage
  | PresenceNetworkMessage
  | MeshFrameNetworkMessage;

/** Versioned wire envelope wrapping any `NetworkMessage`. */
export interface ProtocolEnvelope {
  readonly version: number;
  readonly sender: PeerId;
  readonly message: NetworkMessage;
  /** Millisecond epoch timestamp of envelope creation. */
  readonly sentAt: number;
  readonly signature?: string;
}
