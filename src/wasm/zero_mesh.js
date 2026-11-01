/* @ts-self-types="./zero_mesh.d.ts" */

/**
 * WASM cryptographic session manager exposing BurnerKeybundle, pairwise peer sessions,
 * authenticated frame sealing/opening, and blind dead-drop SDP encryption to JavaScript.
 */
export class WasmCryptoSession {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCryptoSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcryptosession_free(ptr, 0);
    }
    /**
     * Clears all peer sessions and zeroizes key material in memory.
     */
    burn_all() {
        wasm.wasmcryptosession_burn_all(this.__wbg_ptr);
    }
    /**
     * Computes HMAC-SHA256 hex string token for invite authentication.
     * @param {Uint8Array | number[]} secret
     * @param {string} invite_uuid
     * @returns {string}
     */
    static compute_hmac_hex(secret, invite_uuid) {
        let deferred4_0;
        let deferred4_1;
        try {
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passArray8ToWasm0(secret, wasm.__wbindgen_malloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(invite_uuid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
            const ret = wasm.wasmcryptosession_compute_hmac_hex(ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Returns the 32-byte Ed25519 public verifying key bytes.
     * @returns {Uint8Array}
     */
    ed25519_public_key_bytes() {
        const ret = wasm.wasmcryptosession_ed25519_public_key_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Checks if a session crypto entry exists for `peer_id`.
     * @param {string} peer_id
     * @returns {boolean}
     */
    has_peer_session(peer_id) {
        const ptr0 = passStringToWasm0(peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcryptosession_has_peer_session(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Generates a fresh ephemeral BurnerKeybundle (X25519 + Ed25519) and empty peer sessions.
     */
    constructor() {
        const ret = wasm.wasmcryptosession_new();
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmCryptoSessionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Registers the joiner peer session on the host, decrypts the sealed SDP JSON frame,
     * verifies signature, and returns the plaintext SDP string.
     * @param {string} joiner_peer_id
     * @param {Uint8Array | number[]} joiner_x25519_pub
     * @param {Uint8Array | number[] | null | undefined} joiner_ed25519_pub
     * @param {string} sealed_frame_json
     * @returns {string}
     */
    open_drop_sdp(joiner_peer_id, joiner_x25519_pub, joiner_ed25519_pub, sealed_frame_json) {
        let deferred6_0;
        let deferred6_1;
        try {
            let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3;
            try {
                ptr0 = passStringToWasm0(joiner_peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(joiner_x25519_pub, wasm.__wbindgen_malloc);
                len1 = WASM_VECTOR_LEN;
                ptr2 = isLikeNone(joiner_ed25519_pub) ? 0 : passArray8ToWasm0(joiner_ed25519_pub, wasm.__wbindgen_malloc);
                len2 = WASM_VECTOR_LEN;
                ptr3 = passStringToWasm0(sealed_frame_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len3 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
                if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
            const ret = wasm.wasmcryptosession_open_drop_sdp(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var ptr5 = ret[0];
            var len5 = ret[1];
            if (ret[3]) {
                ptr5 = 0; len5 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * Deserializes SealedFrame from JSON, verifies the Ed25519 signature if peer has
     * ed25519_public and frame has signature, decrypts ciphertext, and returns plaintext bytes.
     * @param {string} peer_id
     * @param {string} sealed_frame_json
     * @returns {Uint8Array}
     */
    open_from_peer(peer_id, sealed_frame_json) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(sealed_frame_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.wasmcryptosession_open_from_peer(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * Registers a peer session by deriving the pairwise X25519 shared secret
     * and storing the optional Ed25519 public key for signature verification.
     * @param {string} peer_id
     * @param {Uint8Array | number[]} peer_x25519_pub
     * @param {Uint8Array | number[] | null} [peer_ed25519_pub]
     */
    register_peer(peer_id, peer_x25519_pub, peer_ed25519_pub) {
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passStringToWasm0(peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(peer_x25519_pub, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = isLikeNone(peer_ed25519_pub) ? 0 : passArray8ToWasm0(peer_ed25519_pub, wasm.__wbindgen_malloc);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.wasmcryptosession_register_peer(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Removes and drops the session crypto entry for `peer_id`, zeroizing its shared secret.
     * @param {string} peer_id
     */
    remove_peer(peer_id) {
        const ptr0 = passStringToWasm0(peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmcryptosession_remove_peer(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Registers the host peer session, seals the SDP plaintext into a signed SealedFrame,
     * and returns the JSON string representation for `DropPayload.sealed_sdp_answer`.
     * @param {string} host_peer_id
     * @param {Uint8Array | number[]} host_x25519_pub
     * @param {Uint8Array | number[] | null | undefined} host_ed25519_pub
     * @param {string} sdp_plaintext
     * @returns {string}
     */
    seal_drop_sdp(host_peer_id, host_x25519_pub, host_ed25519_pub, sdp_plaintext) {
        let deferred6_0;
        let deferred6_1;
        try {
            let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3;
            try {
                ptr0 = passStringToWasm0(host_peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(host_x25519_pub, wasm.__wbindgen_malloc);
                len1 = WASM_VECTOR_LEN;
                ptr2 = isLikeNone(host_ed25519_pub) ? 0 : passArray8ToWasm0(host_ed25519_pub, wasm.__wbindgen_malloc);
                len2 = WASM_VECTOR_LEN;
                ptr3 = passStringToWasm0(sdp_plaintext, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len3 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
                if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
            const ret = wasm.wasmcryptosession_seal_drop_sdp(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var ptr5 = ret[0];
            var len5 = ret[1];
            if (ret[3]) {
                ptr5 = 0; len5 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * Seals `plaintext` for `peer_id` using ChaCha20-Poly1305, signs (nonce || ciphertext)
     * with self Ed25519 signing key, and returns the JSON-serialized SealedFrame.
     * @param {string} peer_id
     * @param {Uint8Array | number[]} plaintext
     * @returns {string}
     */
    seal_for_peer(peer_id, plaintext) {
        let deferred4_0;
        let deferred4_1;
        try {
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
            const ret = wasm.wasmcryptosession_seal_for_peer(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Signs arbitrary bytes with self Ed25519 signing key.
     * @param {Uint8Array | number[]} data
     * @returns {Uint8Array}
     */
    sign_bytes(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcryptosession_sign_bytes(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Verifies signature over `data` using `peer_id`'s registered Ed25519 public key.
     * @param {string} peer_id
     * @param {Uint8Array | number[]} data
     * @param {Uint8Array | number[]} sig
     * @returns {boolean}
     */
    verify_peer_signature(peer_id, data, sig) {
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passStringToWasm0(peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passArray8ToWasm0(sig, wasm.__wbindgen_malloc);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.wasmcryptosession_verify_peer_signature(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Returns the 32-byte X25519 public key bytes.
     * @returns {Uint8Array}
     */
    x25519_public_key_bytes() {
        const ret = wasm.wasmcryptosession_x25519_public_key_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) WasmCryptoSession.prototype[Symbol.dispose] = WasmCryptoSession.prototype.free;

/**
 * JS-exported WASM wrapper for `MeshTopology`.
 */
export class WasmMeshTopology {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMeshTopologyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmeshtopology_free(ptr, 0);
    }
    /**
     * Broadcasts a chat message across all connected peers.
     * @param {string} plaintext
     * @returns {string}
     */
    broadcast_chat(plaintext) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(plaintext, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmmeshtopology_broadcast_chat(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Broadcasts global burn session across all peers.
     */
    broadcast_global_burn() {
        const ret = wasm.wasmmeshtopology_broadcast_global_burn(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Broadcasts leave and burn signal across all peers.
     */
    broadcast_leave_and_burn() {
        const ret = wasm.wasmmeshtopology_broadcast_leave_and_burn(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Broadcasts application state or binary event payload across all connected peers.
     * @param {string} topic
     * @param {Uint8Array | number[]} payload
     * @param {number} ttl
     * @returns {string}
     */
    broadcast_state(topic, payload, ttl) {
        let deferred5_0;
        let deferred5_1;
        try {
            const val3 = +ttl;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(topic, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(payload, wasm.__wbindgen_malloc);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
            const ret = wasm.wasmmeshtopology_broadcast_state(this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var ptr4 = ret[0];
            var len4 = ret[1];
            if (ret[3]) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Returns whether a peer exists in the mesh.
     * @param {string} peer_id
     * @returns {boolean}
     */
    has_peer(peer_id) {
        const ptr0 = passStringToWasm0(peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmeshtopology_has_peer(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Returns the local peer identifier.
     * @returns {string}
     */
    local_peer_id() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmmeshtopology_local_peer_id(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Returns the 32-byte local public key.
     * @returns {Uint8Array}
     */
    local_public_key() {
        const ret = wasm.wasmmeshtopology_local_public_key(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Creates a new `WasmMeshTopology` instance with local peer ID and 32-byte X25519 private key.
     * @param {string} local_peer_id
     * @param {Uint8Array | number[]} local_private_key
     */
    constructor(local_peer_id, local_private_key) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(local_peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(local_private_key, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.wasmmeshtopology_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmMeshTopologyFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Returns the count of connected peers.
     * @returns {number}
     */
    peer_count() {
        const ret = wasm.wasmmeshtopology_peer_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Registers a peer with its public key and `WasmWebRtcEngine` instance.
     * @param {string} peer_id
     * @param {Uint8Array | number[]} public_key
     * @param {WasmWebRtcEngine} engine
     */
    register_peer(peer_id, public_key, engine) {
        _assertClass(engine, WasmWebRtcEngine);
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(public_key, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.wasmmeshtopology_register_peer(this.__wbg_ptr, ptr0, len0, ptr1, len1, engine.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Transmits application state or binary event payload directly to a target peer.
     * @param {string} target_peer_id
     * @param {string} topic
     * @param {Uint8Array | number[]} payload
     * @returns {string}
     */
    send_direct_state(target_peer_id, topic, payload) {
        let deferred5_0;
        let deferred5_1;
        try {
            let ptr0, len0, ptr1, len1, ptr2, len2;
            try {
                ptr0 = passStringToWasm0(target_peer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(topic, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passArray8ToWasm0(payload, wasm.__wbindgen_malloc);
                len2 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
            const ret = wasm.wasmmeshtopology_send_direct_state(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var ptr4 = ret[0];
            var len4 = ret[1];
            if (ret[3]) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Registers a callback `(sender_id: string, text: string) => void` for incoming chat messages.
     * @param {Function} callback
     */
    set_on_message(callback) {
        wasm.wasmmeshtopology_set_on_message(this.__wbg_ptr, callback);
    }
    /**
     * Registers a callback `(peer_id: string) => void` for peer join events.
     * @param {Function} callback
     */
    set_on_peer_joined(callback) {
        wasm.wasmmeshtopology_set_on_peer_joined(this.__wbg_ptr, callback);
    }
    /**
     * Registers a callback `(peer_id: string) => void` for peer departure events.
     * @param {Function} callback
     */
    set_on_peer_left(callback) {
        wasm.wasmmeshtopology_set_on_peer_left(this.__wbg_ptr, callback);
    }
    /**
     * Registers a callback `(origin_peer_id: string, topic: string, payload: Uint8Array) => void`
     * for incoming application state or binary payloads.
     * @param {Function} callback
     */
    set_on_state(callback) {
        wasm.wasmmeshtopology_set_on_state(this.__wbg_ptr, callback);
    }
}
if (Symbol.dispose) WasmMeshTopology.prototype[Symbol.dispose] = WasmMeshTopology.prototype.free;

/**
 * JS-exported WASM wrapper for `WebRtcPeer`.
 */
export class WasmWebRtcEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmWebRtcEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmwebrtcengine_free(ptr, 0);
    }
    /**
     * Accepts a remote SDP offer string and resolves with a self-contained SDP answer string.
     * @param {string} offer_sdp
     * @returns {Promise<string>}
     */
    accept_offer_and_create_answer(offer_sdp) {
        const ptr0 = passStringToWasm0(offer_sdp, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwebrtcengine_accept_offer_and_create_answer(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Applies the remote SDP answer string to complete the handshake.
     * @param {string} answer_sdp
     * @returns {Promise<void>}
     */
    apply_answer(answer_sdp) {
        const ptr0 = passStringToWasm0(answer_sdp, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwebrtcengine_apply_answer(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Closes the data channel and peer connection.
     */
    close() {
        const ret = wasm.wasmwebrtcengine_close(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Creates an `RTCPeerConnection` and `"zero-chat"` data channel and resolves with a self-contained SDP offer string.
     * @returns {Promise<string>}
     */
    create_offer() {
        const ret = wasm.wasmwebrtcengine_create_offer(this.__wbg_ptr);
        return ret;
    }
    /**
     * Creates a new `WasmWebRtcEngine` instance.
     */
    constructor() {
        const ret = wasm.wasmwebrtcengine_new();
        this.__wbg_ptr = ret;
        WasmWebRtcEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Sends a binary byte slice over the `"zero-chat"` data channel.
     * @param {Uint8Array | number[]} bytes
     */
    send_binary(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwebrtcengine_send_binary(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Sends a UTF-8 text message over the `"zero-chat"` data channel.
     * @param {string} message
     */
    send_text(message) {
        const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwebrtcengine_send_text(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Registers a JS callback `(bytes: Uint8Array) => void` for incoming binary packets.
     * @param {Function} callback
     */
    set_on_binary_message(callback) {
        wasm.wasmwebrtcengine_set_on_binary_message(this.__wbg_ptr, callback);
    }
    /**
     * Registers a JS callback `(message: string) => void` for incoming UTF-8 text messages.
     * @param {Function} callback
     */
    set_on_message(callback) {
        wasm.wasmwebrtcengine_set_on_message(this.__wbg_ptr, callback);
    }
    /**
     * Registers a JS callback `(state: string) => void` for lifecycle state transitions.
     * @param {Function} callback
     */
    set_on_state_change(callback) {
        wasm.wasmwebrtcengine_set_on_state_change(this.__wbg_ptr, callback);
    }
    /**
     * Returns the current lifecycle state string (`"connecting"`, `"open"`, `"closing"`, `"closed"`).
     * @returns {string}
     */
    state() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmwebrtcengine_state(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmWebRtcEngine.prototype[Symbol.dispose] = WasmWebRtcEngine.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_8b968c3ab8e96595: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_fc456fee5d3317de: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_09736879a3f67559: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_call_275b78b3b6520b92: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.call(arg1, arg2, arg3, arg4);
            return ret;
        }, arguments); },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_fc92fee6137d452d: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_crypto_23f565a907d30078: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_d2908e0b99612b91: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_d5f06fad6bf1409b: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_from_slice_b8daf545a41c6aa0: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_e09da9dae6ee5935: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_70557cdeb3a4b157___convert__closures_____invoke___js_sys_15096c727a086988___Function_fn_wasm_bindgen_70557cdeb3a4b157___JsValue_____wasm_bindgen_70557cdeb3a4b157___sys__Undefined___js_sys_15096c727a086988___Function_fn_wasm_bindgen_70557cdeb3a4b157___JsValue_____wasm_bindgen_70557cdeb3a4b157___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_length_01b143a7e5dd5a3e: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_86166ff8ce1f2002: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_process_91f425a63f58e399: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_queueMicrotask_1e8503a8a690f0a3: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_4a1a4d8dd332373b: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_randomFillSync_34b023059e3363de: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_9a7d8cc2e1d275c0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_resolve_dbf78ab4942478b0: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_58f388a9247ac0bb: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_then_e3f7f2d365708be8: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_versions_6e128a981b0df859: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 163, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_70557cdeb3a4b157___convert__closures_____invoke___wasm_bindgen_70557cdeb3a4b157___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_70557cdeb3a4b157___JsError___true_);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./zero_mesh_bg.js": import0,
    };
}

function wasm_bindgen_70557cdeb3a4b157___convert__closures_____invoke___wasm_bindgen_70557cdeb3a4b157___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_70557cdeb3a4b157___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_70557cdeb3a4b157___convert__closures_____invoke___wasm_bindgen_70557cdeb3a4b157___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_70557cdeb3a4b157___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_70557cdeb3a4b157___convert__closures_____invoke___js_sys_15096c727a086988___Function_fn_wasm_bindgen_70557cdeb3a4b157___JsValue_____wasm_bindgen_70557cdeb3a4b157___sys__Undefined___js_sys_15096c727a086988___Function_fn_wasm_bindgen_70557cdeb3a4b157___JsValue_____wasm_bindgen_70557cdeb3a4b157___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_70557cdeb3a4b157___convert__closures_____invoke___js_sys_15096c727a086988___Function_fn_wasm_bindgen_70557cdeb3a4b157___JsValue_____wasm_bindgen_70557cdeb3a4b157___sys__Undefined___js_sys_15096c727a086988___Function_fn_wasm_bindgen_70557cdeb3a4b157___JsValue_____wasm_bindgen_70557cdeb3a4b157___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
}

const WasmCryptoSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcryptosession_free(ptr, 1));
const WasmMeshTopologyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmeshtopology_free(ptr, 1));
const WasmWebRtcEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmwebrtcengine_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('zero_mesh_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
