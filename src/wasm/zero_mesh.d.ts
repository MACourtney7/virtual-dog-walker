/* tslint:disable */
/* eslint-disable */

/**
 * WASM cryptographic session manager exposing BurnerKeybundle, pairwise peer sessions,
 * authenticated frame sealing/opening, and blind dead-drop SDP encryption to JavaScript.
 */
export class WasmCryptoSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Clears all peer sessions and zeroizes key material in memory.
     */
    burn_all(): void;
    /**
     * Computes HMAC-SHA256 hex string token for invite authentication.
     */
    static compute_hmac_hex(secret: Uint8Array | number[], invite_uuid: string): string;
    /**
     * Returns the 32-byte Ed25519 public verifying key bytes.
     */
    ed25519_public_key_bytes(): Uint8Array;
    /**
     * Checks if a session crypto entry exists for `peer_id`.
     */
    has_peer_session(peer_id: string): boolean;
    /**
     * Generates a fresh ephemeral BurnerKeybundle (X25519 + Ed25519) and empty peer sessions.
     */
    constructor();
    /**
     * Registers the joiner peer session on the host, decrypts the sealed SDP JSON frame,
     * verifies signature, and returns the plaintext SDP string.
     */
    open_drop_sdp(joiner_peer_id: string, joiner_x25519_pub: Uint8Array | number[], joiner_ed25519_pub: Uint8Array | number[] | null | undefined, sealed_frame_json: string): string;
    /**
     * Deserializes SealedFrame from JSON, verifies the Ed25519 signature if peer has
     * ed25519_public and frame has signature, decrypts ciphertext, and returns plaintext bytes.
     */
    open_from_peer(peer_id: string, sealed_frame_json: string): Uint8Array;
    /**
     * Registers a peer session by deriving the pairwise X25519 shared secret
     * and storing the optional Ed25519 public key for signature verification.
     */
    register_peer(peer_id: string, peer_x25519_pub: Uint8Array | number[], peer_ed25519_pub?: Uint8Array | number[] | null): void;
    /**
     * Removes and drops the session crypto entry for `peer_id`, zeroizing its shared secret.
     */
    remove_peer(peer_id: string): void;
    /**
     * Registers the host peer session, seals the SDP plaintext into a signed SealedFrame,
     * and returns the JSON string representation for `DropPayload.sealed_sdp_answer`.
     */
    seal_drop_sdp(host_peer_id: string, host_x25519_pub: Uint8Array | number[], host_ed25519_pub: Uint8Array | number[] | null | undefined, sdp_plaintext: string): string;
    /**
     * Seals `plaintext` for `peer_id` using ChaCha20-Poly1305, signs (nonce || ciphertext)
     * with self Ed25519 signing key, and returns the JSON-serialized SealedFrame.
     */
    seal_for_peer(peer_id: string, plaintext: Uint8Array | number[]): string;
    /**
     * Signs arbitrary bytes with self Ed25519 signing key.
     */
    sign_bytes(data: Uint8Array | number[]): Uint8Array;
    /**
     * Verifies signature over `data` using `peer_id`'s registered Ed25519 public key.
     */
    verify_peer_signature(peer_id: string, data: Uint8Array | number[], sig: Uint8Array | number[]): boolean;
    /**
     * Returns the 32-byte X25519 public key bytes.
     */
    x25519_public_key_bytes(): Uint8Array;
}

/**
 * JS-exported WASM wrapper for `MeshTopology`.
 */
export class WasmMeshTopology {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Broadcasts a chat message across all connected peers.
     */
    broadcast_chat(plaintext: string): string;
    /**
     * Broadcasts global burn session across all peers.
     */
    broadcast_global_burn(): void;
    /**
     * Broadcasts leave and burn signal across all peers.
     */
    broadcast_leave_and_burn(): void;
    /**
     * Broadcasts application state or binary event payload across all connected peers.
     */
    broadcast_state(topic: string, payload: Uint8Array | number[], ttl: number): string;
    /**
     * Returns whether a peer exists in the mesh.
     */
    has_peer(peer_id: string): boolean;
    /**
     * Returns the local peer identifier.
     */
    local_peer_id(): string;
    /**
     * Returns the 32-byte local public key.
     */
    local_public_key(): Uint8Array;
    /**
     * Creates a new `WasmMeshTopology` instance with local peer ID and 32-byte X25519 private key.
     */
    constructor(local_peer_id: string, local_private_key: Uint8Array | number[]);
    /**
     * Returns the count of connected peers.
     */
    peer_count(): number;
    /**
     * Registers a peer with its public key and `WasmWebRtcEngine` instance.
     */
    register_peer(peer_id: string, public_key: Uint8Array | number[], engine: WasmWebRtcEngine): void;
    /**
     * Transmits application state or binary event payload directly to a target peer.
     */
    send_direct_state(target_peer_id: string, topic: string, payload: Uint8Array | number[]): string;
    /**
     * Registers a callback `(sender_id: string, text: string) => void` for incoming chat messages.
     */
    set_on_message(callback: Function): void;
    /**
     * Registers a callback `(peer_id: string) => void` for peer join events.
     */
    set_on_peer_joined(callback: Function): void;
    /**
     * Registers a callback `(peer_id: string) => void` for peer departure events.
     */
    set_on_peer_left(callback: Function): void;
    /**
     * Registers a callback `(origin_peer_id: string, topic: string, payload: Uint8Array) => void`
     * for incoming application state or binary payloads.
     */
    set_on_state(callback: Function): void;
}

/**
 * JS-exported WASM wrapper for `WebRtcPeer`.
 */
export class WasmWebRtcEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Accepts a remote SDP offer string and resolves with a self-contained SDP answer string.
     */
    accept_offer_and_create_answer(offer_sdp: string): Promise<string>;
    /**
     * Applies the remote SDP answer string to complete the handshake.
     */
    apply_answer(answer_sdp: string): Promise<void>;
    /**
     * Closes the data channel and peer connection.
     */
    close(): void;
    /**
     * Creates an `RTCPeerConnection` and `"zero-chat"` data channel and resolves with a self-contained SDP offer string.
     */
    create_offer(): Promise<string>;
    /**
     * Creates a new `WasmWebRtcEngine` instance.
     */
    constructor();
    /**
     * Sends a binary byte slice over the `"zero-chat"` data channel.
     */
    send_binary(bytes: Uint8Array | number[]): void;
    /**
     * Sends a UTF-8 text message over the `"zero-chat"` data channel.
     */
    send_text(message: string): void;
    /**
     * Registers a JS callback `(bytes: Uint8Array) => void` for incoming binary packets.
     */
    set_on_binary_message(callback: Function): void;
    /**
     * Registers a JS callback `(message: string) => void` for incoming UTF-8 text messages.
     */
    set_on_message(callback: Function): void;
    /**
     * Registers a JS callback `(state: string) => void` for lifecycle state transitions.
     */
    set_on_state_change(callback: Function): void;
    /**
     * Returns the current lifecycle state string (`"connecting"`, `"open"`, `"closing"`, `"closed"`).
     */
    state(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmcryptosession_free: (a: number, b: number) => void;
    readonly __wbg_wasmmeshtopology_free: (a: number, b: number) => void;
    readonly __wbg_wasmwebrtcengine_free: (a: number, b: number) => void;
    readonly wasmcryptosession_burn_all: (a: number) => void;
    readonly wasmcryptosession_compute_hmac_hex: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasmcryptosession_ed25519_public_key_bytes: (a: number) => [number, number];
    readonly wasmcryptosession_has_peer_session: (a: number, b: number, c: number) => number;
    readonly wasmcryptosession_new: () => [number, number, number];
    readonly wasmcryptosession_open_drop_sdp: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly wasmcryptosession_open_from_peer: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly wasmcryptosession_register_peer: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly wasmcryptosession_remove_peer: (a: number, b: number, c: number) => void;
    readonly wasmcryptosession_seal_drop_sdp: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly wasmcryptosession_seal_for_peer: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly wasmcryptosession_sign_bytes: (a: number, b: number, c: number) => [number, number];
    readonly wasmcryptosession_verify_peer_signature: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly wasmcryptosession_x25519_public_key_bytes: (a: number) => [number, number];
    readonly wasmmeshtopology_broadcast_chat: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmmeshtopology_broadcast_global_burn: (a: number) => [number, number];
    readonly wasmmeshtopology_broadcast_leave_and_burn: (a: number) => [number, number];
    readonly wasmmeshtopology_broadcast_state: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly wasmmeshtopology_has_peer: (a: number, b: number, c: number) => number;
    readonly wasmmeshtopology_local_peer_id: (a: number) => [number, number];
    readonly wasmmeshtopology_local_public_key: (a: number) => [number, number];
    readonly wasmmeshtopology_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmmeshtopology_peer_count: (a: number) => number;
    readonly wasmmeshtopology_register_peer: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasmmeshtopology_send_direct_state: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly wasmmeshtopology_set_on_message: (a: number, b: any) => void;
    readonly wasmmeshtopology_set_on_peer_joined: (a: number, b: any) => void;
    readonly wasmmeshtopology_set_on_peer_left: (a: number, b: any) => void;
    readonly wasmmeshtopology_set_on_state: (a: number, b: any) => void;
    readonly wasmwebrtcengine_accept_offer_and_create_answer: (a: number, b: number, c: number) => any;
    readonly wasmwebrtcengine_apply_answer: (a: number, b: number, c: number) => any;
    readonly wasmwebrtcengine_close: (a: number) => [number, number];
    readonly wasmwebrtcengine_create_offer: (a: number) => any;
    readonly wasmwebrtcengine_new: () => number;
    readonly wasmwebrtcengine_send_binary: (a: number, b: number, c: number) => [number, number];
    readonly wasmwebrtcengine_send_text: (a: number, b: number, c: number) => [number, number];
    readonly wasmwebrtcengine_set_on_binary_message: (a: number, b: any) => void;
    readonly wasmwebrtcengine_set_on_message: (a: number, b: any) => void;
    readonly wasmwebrtcengine_set_on_state_change: (a: number, b: any) => void;
    readonly wasmwebrtcengine_state: (a: number) => [number, number];
    readonly wasm_bindgen_70557cdeb3a4b157___convert__closures_____invoke___js_sys_15096c727a086988___Function_fn_wasm_bindgen_70557cdeb3a4b157___JsValue_____wasm_bindgen_70557cdeb3a4b157___sys__Undefined___js_sys_15096c727a086988___Function_fn_wasm_bindgen_70557cdeb3a4b157___JsValue_____wasm_bindgen_70557cdeb3a4b157___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_70557cdeb3a4b157___convert__closures_____invoke___wasm_bindgen_70557cdeb3a4b157___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_70557cdeb3a4b157___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
