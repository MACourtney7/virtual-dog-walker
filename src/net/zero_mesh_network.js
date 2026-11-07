// src/net/zero_mesh_network.js
// P2P State Replication, Random-Peer Matchmaking & Dual-Mesh Proximity Chat
// Built on zero_protocol and zero_mesh WebAssembly primitives.

import { PacketType, Protocol } from './protocol.js';
import { EntityInterpolator, NetStatus } from './network.js';
import { NPC_PATHS } from '../world/npc_paths.js';

const FALLBACK_MANIFEST = [
  { id: 'ladies-mile-loop', type: 'both', lengthPx: 3637.4 },
  { id: 'sea-walls-promenade', type: 'both', lengthPx: 1478.2 },
  { id: 'durdham-down-circuit', type: 'jogger', lengthPx: 1684.0 },
  { id: 'woodland-trail-loop', type: 'walker', lengthPx: 1747.6 },
  { id: 'central-meadow-ramble', type: 'walker', lengthPx: 3054.1 },
  { id: 'trans-downs-express', type: 'jogger', lengthPx: 3770.3 },
  { id: 'sea-walls-to-water-tower', type: 'walker', lengthPx: 2966.6 },
  { id: 'clifton-woodland-traverse', type: 'walker', lengthPx: 2289.4 },
  { id: 'north-meadow-diagonal', type: 'both', lengthPx: 2656.5 },
  { id: 'perimeter-grand-loop', type: 'jogger', lengthPx: 7886.1 }
];

function computePathLength(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const x1 = Array.isArray(p1) ? p1[0] : p1.x;
    const y1 = Array.isArray(p1) ? p1[1] : p1.y;
    const x2 = Array.isArray(p2) ? p2[0] : p2.x;
    const y2 = Array.isArray(p2) ? p2[1] : p2.y;
    len += Math.hypot(x2 - x1, y2 - y1);
  }
  return Math.round(len * 10) / 10;
}

const MANIFEST = (Array.isArray(NPC_PATHS) && NPC_PATHS.length > 0)
  ? NPC_PATHS.map(p => ({
      id: p.id,
      type: p.type,
      lengthPx: computePathLength(p.waypoints || [])
    }))
  : FALLBACK_MANIFEST;

const WALKER_SPEED = 22; // px/s
const JOGGER_SPEED = 48; // px/s
const TARGET_NPC_COUNT = 5;

let wasmModulePromise = null;

async function loadWasmModule() {
  if (wasmModulePromise) return wasmModulePromise;
  wasmModulePromise = (async () => {
    try {
      if (typeof window !== 'undefined' && typeof window.RTCPeerConnection !== 'undefined') {
        const mod = await import('../wasm/zero_mesh.js');
        if (typeof mod.default === 'function') {
          await mod.default();
        }
        return mod;
      }
    } catch (e) {
      console.warn('[ZeroMesh] Live Wasm/WebRTC module unavailable; using simulation mode.', e);
    }
    return null;
  })();
  return wasmModulePromise;
}

export class ZeroMeshNetworkManager {
  constructor(options = {}) {
    this.status = NetStatus.OFFLINE;
    this.peerId = null;
    this.roomId = options.roomId || 'clifton-commons';
    this.isHost = false;
    this.isDedicatedServer = false;
    this.isZeroMesh = true;

    this.localMeta = {
      name: 'Park Walker',
      jacketColor: '#1e3a8a',
      coatName: 'Chocolate & Tan (Ziggy)',
      hairStyle: 'short',
      hairColor: '#4a3728',
      pantsColor: '#1e293b',
      skinTone: '#f3cbb1',
      collarColor: '#dc2626',
      personality: null
    };

    this.workerOrigin = (typeof window !== 'undefined' && window.WORKER_HTTP_ORIGIN)
      ? window.WORKER_HTTP_ORIGIN
      : 'https://network.zero-network.workers.dev';

    // Remote entity interpolators (peerId -> { ownerInterpolator, dogInterpolator, meta })
    this.remotePeers = new Map();
    this.meshPeerIds = new Set();
    this.iceServers = null;
    this.iceCachedAt = 0;

    // Topology and Crypto handles
    this.wasmMod = null;
    this.cryptoSession = null;
    this.gameMesh = null;
    this.proximityMesh = null;
    this.pendingProximityEngines = new Map();
    this.proximityCrypto = null;
    this.hostWs = null;
    this.hostSecret = null;
    this.pendingEngine = null;
    this.pendingBridge = null;
    this.activeBridges = new Map();

    // Event hooks
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onBallThrown = null;
    this.onBallSync = null;
    this.onBark = null;
    this.onPet = null;
    this.onWhistle = null;
    this.onChatMessage = null;
    this.onEmote = null;
    this.onStatusChange = null;
    this.onNpcSpawn = null;
    this.onNpcDespawn = null;
    this.onNpcSnapshot = null;
    this.onProximityChat = null;
    this.onProximityBurnMessage = null;
    this.onProximityBurnSession = null;

    this.serverClockOffset = 0;

    // Periodic state synchronization loop
    this.syncInterval = null;
    this.syncHz = 16; // 16 updates per second

    // NPC Coordination
    this.activeNpcs = new Map();
    this.npcDespawnTimers = new Map();
    this.npcReplacementTimers = new Set();
    this.targetNpcCount = TARGET_NPC_COUNT;
    this.npcPaths = MANIFEST;

    // Proximity Cluster
    this.activeClusterPeerIds = new Set();

    // In-memory simulation fallback channels (for testing)
    this._simulationHub = options.simulationHub || null;

    // Two-phase lifecycle state (negotiate -> construct)
    this._phase = 'idle';
    this._matchRetries = 0;
    this._role = null;
    this._roomSecret = null;
    this._debug = Boolean(options.debug || (typeof window !== 'undefined' && window.__ZERO_MESH_DEBUG));
    this._lifecycleTimers = new Set();
    this._isAborted = false;
    this._demoting = false;

    // Cancellation + host lease heartbeat
    this._lifecycleAbortController = null;
    this._hostHeartbeatInterval = null;
    this._hostHeartbeatMs = 3000;
  }

  _logPhase(phase, extra) {
    this._phase = phase;
    if (this._debug) {
      try {
        console.debug(`[ZeroMesh] phase=${phase}`, extra || '');
      } catch (_) {}
    }
    if (typeof window !== 'undefined') {
      window.__zeroMeshDebug = {
        phase,
        retries: this._matchRetries,
        role: this._role,
        roomSecret: this._roomSecret ? '<set>' : null,
        peerId: this.peerId
      };
    }
  }

  _doId() {
    return this.roomId;
  }

  _sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const entry = { timer: null, resolve, reject, cancelled: false };
      const cleanup = () => {
        this._lifecycleTimers.delete(entry);
        if (signal && typeof signal.removeEventListener === 'function') {
          try { signal.removeEventListener('abort', onAbort); } catch (_) {}
        }
      };
      const onAbort = () => {
        if (entry.cancelled) return;
        entry.cancelled = true;
        if (entry.timer !== null && entry.timer !== undefined) {
          clearTimeout(entry.timer);
        }
        cleanup();
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal && signal.aborted) {
        onAbort();
        return;
      }
      if (signal && typeof signal.addEventListener === 'function') {
        try { signal.addEventListener('abort', onAbort); } catch (_) {}
      }
      entry.timer = setTimeout(() => {
        if (entry.cancelled) return;
        entry.cancelled = true;
        cleanup();
        resolve();
      }, ms);
      this._lifecycleTimers.add(entry);
    });
  }

  _clearLifecycleTimers() {
    for (const entry of this._lifecycleTimers) {
      try {
        if (entry && entry.timer !== null && entry.timer !== undefined) {
          clearTimeout(entry.timer);
        }
        if (entry && typeof entry.resolve === 'function') {
          entry.cancelled = true;
          entry.resolve();
        }
      } catch (_) {}
    }
    this._lifecycleTimers.clear();
  }

  _abortLifecycle() {
    this._isAborted = true;
    if (this._lifecycleAbortController) {
      try { this._lifecycleAbortController.abort(); } catch (_) {}
      this._lifecycleAbortController = null;
    }
    this._clearLifecycleTimers();
  }

  _startHostHeartbeat() {
    this._stopHostHeartbeat();
    if (typeof setInterval !== 'function') return;
    this._hostHeartbeatInterval = setInterval(() => {
      this._sendHostHeartbeat();
    }, this._hostHeartbeatMs);
  }

  _stopHostHeartbeat() {
    if (this._hostHeartbeatInterval !== null && this._hostHeartbeatInterval !== undefined) {
      try { clearInterval(this._hostHeartbeatInterval); } catch (_) {}
      this._hostHeartbeatInterval = null;
    }
  }

  async _sendHostHeartbeat() {
    if (!this.isHost || !this.peerId) return;
    const doId = this._doId();
    const signal = this._lifecycleAbortController ? this._lifecycleAbortController.signal : null;
    try {
      const fetchOpts = { headers: { 'X-Peer-Id': this.peerId } };
      if (signal) fetchOpts.signal = signal;
      const resp = await fetch(`${this.workerOrigin}/match/${encodeURIComponent(doId)}`, fetchOpts);
      if (resp && resp.ok) {
        try {
          const body = await resp.json();
          if (body && body.room_secret && !this.hostSecret) {
            this.hostSecret = this._normalizeSecretHex(body.room_secret) || this.hostSecret;
          }
          // Host lease lost or superseded: demote immediately.
          if (body && body.status && body.status !== 'host') {
            console.warn('[ZeroMesh] Host lease lost or superseded. Demoting to joiner.');
            this.isHost = false;
            this._stopHostHeartbeat();
            if (this.hostWs) {
              try { this.hostWs.close(); } catch (_) {}
              this.hostWs = null;
            }
            this._demoteToJoiner();
          }
        } catch (_) {}
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (this._debug) console.warn('[ZeroMesh] Host heartbeat error:', err);
    }
  }

  async _demoteToJoiner() {
    if (this._demoting) return;
    this._demoting = true;
    try {
      // Cancel any in-flight sleeps / fetches from the previous lifecycle,
      // then reset the abort flag so the new lifecycle can proceed cleanly.
      this._abortLifecycle();
      this._isAborted = false;
      this._lifecycleAbortController = (typeof AbortController !== 'undefined')
        ? new AbortController()
        : null;
      const negotiation = await this._negotiateIdentity();
      const hostSecretHex = this.hostSecret;
      if (negotiation.role === 'joiner' || negotiation.role === 'waiting') {
        let invite = negotiation.invite;
        if (!invite) {
          invite = await this._fetchInviteForJoiner();
        }
        if (invite) {
          await this._joinWithInvite(invite, hostSecretHex);
        } else {
          this._pollForInvite(hostSecretHex);
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // Expected when a newer lifecycle superseded this demotion attempt.
        return;
      }
      console.warn('[ZeroMesh] Demotion re-negotiation failed:', err);
    } finally {
      this._demoting = false;
      // Ensure any lingering timers from this attempt are cleared so they
      // cannot fire against a subsequent lifecycle.
      this._clearLifecycleTimers();
    }
  }

  setLocalMeta(meta) {
    this.localMeta = { ...this.localMeta, ...meta };
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(status);
    }
  }

  ensureRemotePeer(peerId, meta = {}) {
    let peerData = this.remotePeers.get(peerId);
    if (!peerData) {
      peerData = {
        ownerInterpolator: new EntityInterpolator(),
        dogInterpolator: new EntityInterpolator(),
        meta: {
          name: meta.name || 'Walker',
          jacketColor: meta.jacketColor || '#1e3a8a',
          coatName: meta.coatName || 'Chocolate & Tan (Ziggy)',
          hairStyle: meta.hairStyle,
          hairColor: meta.hairColor,
          pantsColor: meta.pantsColor,
          accessory: meta.accessory || 'NONE',
          skinTone: meta.skinTone,
          collarColor: meta.collarColor,
          personality: meta.personality || null
        }
      };
      this.remotePeers.set(peerId, peerData);
    } else if (meta && (meta.name || meta.jacketColor || meta.coatName || meta.personality)) {
      if (meta.name) peerData.meta.name = meta.name;
      if (meta.jacketColor) peerData.meta.jacketColor = meta.jacketColor;
      if (meta.coatName) peerData.meta.coatName = meta.coatName;
      if (meta.hairStyle) peerData.meta.hairStyle = meta.hairStyle;
      if (meta.hairColor) peerData.meta.hairColor = meta.hairColor;
      if (meta.pantsColor) peerData.meta.pantsColor = meta.pantsColor;
      if (meta.accessory !== undefined) peerData.meta.accessory = meta.accessory || 'NONE';
      if (meta.skinTone) peerData.meta.skinTone = meta.skinTone;
      if (meta.collarColor) peerData.meta.collarColor = meta.collarColor;
      if (meta.personality) peerData.meta.personality = meta.personality;
    }
    return peerData;
  }

  async fetchIceServers() {
    const now = Date.now();
    if (this.iceServers && (now - this.iceCachedAt < 15 * 60 * 1000)) {
      return this.iceServers;
    }
    try {
      if (typeof fetch === 'function') {
        const resp = await fetch(`${this.workerOrigin}/ice`);
        if (resp.ok) {
          const data = await resp.json();
          this.iceServers = data.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }];
          this.iceCachedAt = now;
          return this.iceServers;
        }
      }
    } catch (e) {
      console.warn('[ZeroMesh] Failed to fetch /ice config, using fallback STUN:', e);
    }
    this.iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    this.iceCachedAt = now;
    return this.iceServers;
  }

  generatePeerId() {
    return `walker-${Math.random().toString(36).substring(2, 9)}`;
  }

  generateSecret() {
    const arr = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < 32; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }

  bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Normalize a secret (hex string or byte array) to a lowercase hex string.
   * Returns null when the input is empty/invalid.
   */
  _normalizeSecretHex(secret) {
    if (secret === null || secret === undefined) return null;
    if (typeof secret === 'string') {
      const trimmed = secret.trim();
      if (!trimmed) return null;
      // Already hex? Validate and normalize casing.
      if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
        return trimmed.toLowerCase();
      }
      // Non-hex string: encode its UTF-8 bytes as hex.
      try {
        const enc = new TextEncoder().encode(trimmed);
        return this.bytesToHex(enc);
      } catch (_) {
        return null;
      }
    }
    if (secret instanceof Uint8Array) {
      return this.bytesToHex(secret);
    }
    if (Array.isArray(secret)) {
      return this.bytesToHex(Uint8Array.from(secret));
    }
    if (typeof secret === 'object' && typeof secret.length === 'number') {
      try {
        return this.bytesToHex(Uint8Array.from(secret));
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  async connect(roomId) {
    if (roomId) this.roomId = roomId;
    this._isAborted = false;
    this.setStatus(NetStatus.CONNECTING);
    if (!this.peerId) {
      this.peerId = this.generatePeerId();
    }

    this.wasmMod = await loadWasmModule();
    await this.fetchIceServers();

    if (this.wasmMod && typeof window !== 'undefined' && window.RTCPeerConnection) {
      await this._connectLiveMesh();
    } else {
      await this._connectSimulatedMesh();
    }
  }

  async _negotiateIdentity() {
    const doId = this._doId();
    const backoff = [100, 200, 400, 800, 1600, 2500];
    const outerDeadline = Date.now() + 10000;
    this._matchRetries = 0;
    this._logPhase('negotiate', { doId });

    if (!this._lifecycleAbortController) {
      this._lifecycleAbortController = (typeof AbortController !== 'undefined')
        ? new AbortController()
        : null;
    }
    const signal = this._lifecycleAbortController ? this._lifecycleAbortController.signal : null;

    let sawWaiting = false;
    let lastWaitingSecret = null;

    for (let i = 0; i <= backoff.length; i++) {
      if (signal && signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }

      let body = null;
      try {
        const fetchOpts = { headers: { 'X-Peer-Id': this.peerId } };
        if (signal) fetchOpts.signal = signal;
        const matchUrl = new URL(`${this.workerOrigin}/match/${encodeURIComponent(doId)}`);
        matchUrl.searchParams.set('peer_id', this.peerId);
        const resp = await fetch(matchUrl.toString(), fetchOpts);
        if (resp.status === 404 || resp.status === 401) {
          // Terminal: the room/endpoint does not exist or we are unauthorized.
          // Do not retry; surface a terminal failure state.
          const terminalErr = new Error(`[ZeroMesh] /match terminal status ${resp.status}`);
          terminalErr.name = 'TerminalMatchError';
          terminalErr.status = resp.status;
          this._state = 'error';
          this._logPhase('error', { status: resp.status });
          if (typeof NetStatus !== 'undefined' && NetStatus && NetStatus.ERROR !== undefined && typeof this.setStatus === 'function') {
            this.setStatus(NetStatus.ERROR);
          }
          throw terminalErr;
        }
        if (!resp.ok) throw new Error(`match ${resp.status}`);
        body = await resp.json();
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        if (err && err.name === 'TerminalMatchError') throw err;
        if (this._debug) console.warn('[ZeroMesh] /match error:', err);
        body = null;
      }

      if (body) {
        // Retain room_secret from ANY response status.
        if (body.room_secret) {
          const normalized = this._normalizeSecretHex(body.room_secret);
          if (normalized) {
            this.hostSecret = normalized;
            this._roomSecret = normalized;
          }
        }

        if (body.status === 'joiner' || body.status === 'host') {
          this._role = body.status;
          this._logPhase('negotiate', { role: body.status, retries: this._matchRetries });
          return {
            role: body.status,
            assignedPeerId: body.assigned_peer_id ?? this.peerId,
            roomSecret: body.room_secret ?? this._roomSecret ?? null,
            invite: body.invite || null
          };
        }
        if (body.status === 'waiting') {
          sawWaiting = true;
          if (body.room_secret) lastWaitingSecret = body.room_secret;
          this._logPhase('waiting', { retries: this._matchRetries });
        }
      }

      if (Date.now() >= outerDeadline) break;
      if (i < backoff.length) {
        this._matchRetries++;
        try {
          await this._sleep(backoff[i], signal);
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          throw err;
        }
      }
    }

    // If the DO ever reported an active host (waiting), do NOT self-promote.
    if (sawWaiting) {
      this._role = 'waiting';
      this._logPhase('negotiate', { role: 'waiting', retries: this._matchRetries });
      return {
        role: 'waiting',
        assignedPeerId: this.peerId,
        roomSecret: lastWaitingSecret ?? this._roomSecret ?? null,
        invite: null
      };
    }

    this._role = 'empty';
    this._logPhase('negotiate', { role: 'empty', retries: this._matchRetries });
    return { role: 'empty', assignedPeerId: this.peerId, roomSecret: this._roomSecret ?? null, invite: null };
  }

  _constructMesh(assignedPeerId, roomSecret) {
    this.peerId = assignedPeerId;
    // Normalize hostSecret to a lowercase hex string so downstream consumers
    // (WebSocket query params, HMAC, Authorization headers) never double-encode.
    const normalizedRoomSecret = this._normalizeSecretHex(roomSecret);
    if (normalizedRoomSecret) {
      this.hostSecret = normalizedRoomSecret;
    } else if (!this.hostSecret) {
      this.hostSecret = this.bytesToHex(this.generateSecret());
    } else {
      // Ensure any pre-existing hostSecret is also normalized.
      const existing = this._normalizeSecretHex(this.hostSecret);
      if (existing) this.hostSecret = existing;
    }

    const privKey = this.generateSecret();
    // Fail-fast: never silently fall back to a fresh session, which would
    // produce a scalar mismatch between the crypto session and the mesh.
    if (typeof this.wasmMod.WasmCryptoSession.from_private_key !== 'function') {
      throw new Error('[ZeroMesh] WasmCryptoSession.from_private_key is unavailable; cannot construct crypto session.');
    }
    try {
      this.cryptoSession = this.wasmMod.WasmCryptoSession.from_private_key(privKey);
    } catch (err) {
      throw new Error(`[ZeroMesh] Failed to construct crypto session from private key: ${err && err.message ? err.message : err}`);
    }
    if (!this.cryptoSession) {
      throw new Error('[ZeroMesh] Crypto session construction returned null/undefined.');
    }
    this.gameMesh = new this.wasmMod.WasmMeshTopology(assignedPeerId, privKey);
    this.proximityMesh = new this.wasmMod.WasmMeshTopology(`prox-${assignedPeerId}`, this.generateSecret());

    // Pre-handshake invariant: mesh identity must agree with this.peerId.
    if (typeof this.gameMesh.local_peer_id === 'function') {
      const meshId = this.gameMesh.local_peer_id();
      if (meshId !== this.peerId) {
        throw new Error(`[ZeroMesh] Identity invariant violated: gameMesh.local_peer_id()=${meshId} !== peerId=${this.peerId}`);
      }
    }

    this._logPhase('construct', { peerId: this.peerId, hasRoomSecret: Boolean(roomSecret) });
  }

  async _connectLiveMesh() {
    try {
      // Phase 1: negotiate identity via /match with retry/backoff.
      const negotiation = await this._negotiateIdentity();
      const role = negotiation.role;
      const roomSecret = negotiation.roomSecret;

      // Phase 2: construct mesh with final peerId + room_secret.
      // Fatal crypto/topology errors must fail fast and loud — never fall back
      // to the simulated mesh, which would silently mask key/scalar mismatches.
      try {
        this._constructMesh(negotiation.assignedPeerId, roomSecret);
      } catch (cryptoErr) {
        console.error('[ZeroMesh] Fatal cryptographic initialization error:', cryptoErr);
        this._state = 'error';
        this._logPhase('error', { error: String(cryptoErr && cryptoErr.message || cryptoErr) });
        this.setStatus(NetStatus.OFFLINE);
        throw cryptoErr;
      }
      // hostSecret is normalized to a hex string inside _constructMesh.
      const hostSecretHex = this.hostSecret;

      this.proximityMesh.set_on_message((senderPeerId, plaintext) => {
        const cleanSenderId = String(senderPeerId).replace(/^prox-/, '');
        try {
          const packet = typeof plaintext === 'string' && plaintext.trim().startsWith('{') ? JSON.parse(plaintext) : null;
          if (packet && packet.type === 'PROXIMITY_BURN_MSG') {
            if (typeof this.onProximityBurnMessage === 'function') {
              this.onProximityBurnMessage(packet.messageUuid);
            }
            return;
          } else if (packet && packet.type === 'PROXIMITY_BURN_ALL') {
            if (typeof this.onProximityBurnSession === 'function') {
              this.onProximityBurnSession();
            }
            return;
          }
        } catch (e) {
          // Plaintext chat
        }
        const peerObj = this.remotePeers.get(cleanSenderId);
        const senderName = (peerObj && peerObj.meta && peerObj.meta.name) ? peerObj.meta.name : 'Walker';
        if (typeof this.onProximityChat === 'function') {
          this.onProximityChat({
            senderId: cleanSenderId,
            name: senderName,
            text: plaintext
          });
        }
      });
      this.pendingProximityEngines = new Map();
      this.proximityCrypto = new this.wasmMod.WasmCryptoSession();

      this._wireMeshCallbacks(this.gameMesh);

      if (role === 'joiner') {
        // Joiner flow: Accept offer, generate SDP answer, seal drop payload, and POST /drop.
        // If /match did not return an inline invite, fetch one from the invite endpoint.
        let invite = negotiation.invite;
        if (!invite) {
          invite = await this._fetchInviteForJoiner();
        }
        if (!invite) {
          throw new Error('[ZeroMesh] Joiner role but no invite available');
        }
        await this._joinWithInvite(invite, hostSecretHex);
      } else if (role === 'host' || role === 'empty') {
        // Seed host flow (role === 'host' or 'empty' after retry budget exhausted)
        this._logPhase('host', { peerId: this.peerId });
        this.setStatus(NetStatus.HOSTING);
        this.isHost = true;
        this._setupHostSocket(hostSecretHex);
        this._startHostHeartbeat();
        this.initNpcSpawner();
      } else if (role === 'waiting') {
        // A valid host exists in the DO; remain a joiner and poll for an invite.
        this._logPhase('waiting', { peerId: this.peerId });
        this.setStatus(NetStatus.CONNECTING);
        this.isHost = false;
        const invite = await this._fetchInviteForJoiner();
        if (invite && invite.__takeover) {
          await this._takeOverAsHost(invite.roomSecret, hostSecretHex);
        } else if (invite) {
          // Re-enter joiner flow with the fetched invite.
          await this._joinWithInvite(invite, hostSecretHex);
        } else {
          // No invite yet; keep polling in the background without self-promoting.
          this._pollForInvite(hostSecretHex);
        }
      } else {
        throw new Error(`[ZeroMesh] Unhandled negotiation role: ${role}`);
      }
    } catch (err) {
      const aborted = err && (
        err.name === 'AbortError' ||
        this._isAborted ||
        (this._lifecycleAbortController && this._lifecycleAbortController.signal && this._lifecycleAbortController.signal.aborted)
      );
      if (aborted) {
        console.log('[ZeroMesh] Lifecycle aborted. Skipping simulation fallback.');
        this._logPhase('aborted', { error: String(err && err.message || err) });
        return;
      }
      // Fatal crypto/topology errors must never be masked by simulation fallback.
      if (this._state === 'error') {
        console.error('[ZeroMesh] Fatal initialization error; refusing simulation fallback:', err);
        this._logPhase('error', { error: String(err && err.message || err) });
        throw err;
      }
      console.error('[ZeroMesh] Live connection failed, falling back to simulated mesh:', err);
      this._logPhase('fallback', { error: String(err && err.message || err) });
      await this._connectSimulatedMesh();
    }
  }

  async _fetchInviteForJoiner() {
    const doId = this._doId();
    const backoff = [100, 200, 400, 800, 1600];
    const deadline = Date.now() + 8000;
    const signal = this._lifecycleAbortController ? this._lifecycleAbortController.signal : null;
    for (let i = 0; i <= backoff.length; i++) {
      if (signal && signal.aborted) return null;
      try {
        const headers = { 'X-Peer-Id': this.peerId };
        if (this.hostSecret) {
          headers['X-Host-Secret'] = this.hostSecret;
        }
        const fetchOpts = { headers };
        if (signal) fetchOpts.signal = signal;
        const resp = await fetch(`${this.workerOrigin}/invite/${encodeURIComponent(doId)}`, fetchOpts);
        if (resp.ok) {
          const body = await resp.json();
          if (body && body.status === 'host') {
            // Previous host lease expired and this client was elected as host.
            // Signal takeover to the caller via a sentinel object.
            return { __takeover: true, roomSecret: body.room_secret || null };
          }
          if (body && body.invite) return body.invite;
          if (body && body.invite_uuid) return body;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return null;
        if (this._debug) console.warn('[ZeroMesh] /invite error:', err);
      }
      if (Date.now() >= deadline) break;
      if (i < backoff.length) {
        this._matchRetries++;
        try {
          await this._sleep(backoff[i], signal);
        } catch (err) {
          if (err && err.name === 'AbortError') return null;
          throw err;
        }
      }
    }
    return null;
  }

  async _pollForInvite(hostSecretHex) {
    const signal = this._lifecycleAbortController ? this._lifecycleAbortController.signal : null;
    while (!(signal && signal.aborted) && !this.isHost) {
      try {
        await this._sleep(2000, signal);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        return;
      }
      if (signal && signal.aborted) return;
      const invite = await this._fetchInviteForJoiner();
      if (invite && invite.__takeover) {
        await this._takeOverAsHost(invite.roomSecret, hostSecretHex);
        return;
      }
      if (invite) {
        try {
          await this._joinWithInvite(invite, hostSecretHex);
        } catch (e) {
          console.warn('[ZeroMesh] Join with polled invite failed:', e);
        }
        return;
      }
    }
  }

  async _takeOverAsHost(roomSecret, hostSecretHex) {
    console.log('[ZeroMesh] Previous host expired. Taking over as Host.');
    const normalized = this._normalizeSecretHex(roomSecret) || this._normalizeSecretHex(hostSecretHex);
    if (normalized) {
      this.hostSecret = normalized;
      this._roomSecret = normalized;
    }
    this.isHost = true;
    this._role = 'host';
    this._logPhase('host', { peerId: this.peerId, takeover: true });
    this.setStatus(NetStatus.HOSTING);
    this._setupHostSocket(this.hostSecret);
    this._startHostHeartbeat();
    this.initNpcSpawner();
  }

  async _joinWithInvite(invite, hostSecretHex) {
    if (!invite) throw new Error('[ZeroMesh] Missing invite');
    if (invite.assigned_peer_id && invite.assigned_peer_id !== this.peerId) {
      if (typeof this.gameMesh.set_local_peer_id === 'function') {
        this.gameMesh.set_local_peer_id(invite.assigned_peer_id);
      }
      if (this.proximityMesh && typeof this.proximityMesh.set_local_peer_id === 'function') {
        try { this.proximityMesh.set_local_peer_id(`prox-${invite.assigned_peer_id}`); } catch (_) {}
      }
      this.peerId = invite.assigned_peer_id;
    }
    this._logPhase('joiner', { peerId: this.peerId });

    const offerSdpStr = typeof invite.sdp_offer === 'object' && invite.sdp_offer !== null
      ? invite.sdp_offer.sdp
      : invite.sdp_offer;

    const engine = new this.wasmMod.WasmWebRtcEngine();
    const bridge = this._attachBrowserWebRtc(engine, false, this.iceServers);
    const answerSdp = await bridge.acceptOfferAndCreateAnswerSdp(offerSdpStr);

    const hostPubX = new Uint8Array(invite.host_public_key);
    const hostPubEd = invite.host_signing_key ? new Uint8Array(invite.host_signing_key) : null;
    const sealedSdpJson = this.cryptoSession.seal_drop_sdp(
      invite.host_peer_id || 'host',
      hostPubX,
      hostPubEd,
      answerSdp
    );

    const dropPayload = {
      invite_uuid: invite.invite_uuid,
      token: invite.token,
      sdp_answer: { sdp: 'SEALED' },
      joiner_public_key: Array.from(this.cryptoSession.x25519_public_key_bytes()),
      joiner_peer_id: this.peerId,
      joiner_signing_key: Array.from(this.cryptoSession.ed25519_public_key_bytes()),
      sealed_sdp_answer: JSON.parse(sealedSdpJson),
      signature: null
    };

    const dropUrl = `${this.workerOrigin}/drop/${encodeURIComponent(this.roomId)}/${encodeURIComponent(invite.invite_uuid)}`;
    await fetch(dropUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (invite.token || invite.hmac_token)
      },
      body: JSON.stringify(dropPayload)
    });

    this.gameMesh.register_peer(invite.host_peer_id || 'host', hostPubX, engine);
    if (this.activeBridges) {
      this.activeBridges.set(invite.host_peer_id || 'host', bridge);
    }
    this.setStatus(NetStatus.CONNECTED_PEER);
    // Joiners must NOT open a host socket; doing so collides with the real
    // host's WebSocket lease and can trigger spurious demotions.
    this.isHost = false;
  }

  _attachBrowserWebRtc(wasmEngine, isOfferer, iceServers) {
    const hasBrowserRtc = typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function';

    if (!hasBrowserRtc) {
      // Headless / test fallback: delegate directly to the Wasm engine.
      return {
        async createOfferSdp() {
          return wasmEngine.create_offer();
        },
        async acceptOfferAndCreateAnswerSdp(offerSdp) {
          return wasmEngine.accept_offer_and_create_answer(offerSdp);
        },
        async applyAnswerSdp(answerSdp) {
          return wasmEngine.apply_answer(answerSdp);
        },
        close() {
          try { wasmEngine.close(); } catch (_) {}
        }
      };
    }

    const pc = new window.RTCPeerConnection({
      iceServers: iceServers || this.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }]
    });

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'failed' || state === 'closed') {
        try { wasmEngine.mark_closed(); } catch (_) {}
      }
    };

    let dc = null;
    // Per-DataChannel outbound FIFO queue. Messages produced while the channel
    // is still 'connecting' are buffered here and flushed on 'open' so that
    // initial mesh frames (HELLO, NPC snapshot, etc.) are never dropped.
    const pending = [];
    const cloneMessage = (msg) => {
      if (typeof msg === 'string') return msg;
      if (msg instanceof Uint8Array) return msg.slice();
      if (msg instanceof ArrayBuffer) return msg.slice(0);
      if (ArrayBuffer.isView(msg)) return new Uint8Array(msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength));
      return msg;
    };
    const sendOrQueue = (data) => {
      if (!dc) {
        pending.push(cloneMessage(data));
        return;
      }
      if (dc.readyState === 'open') {
        try {
          dc.send(data);
        } catch (err) {
          // No future flush trigger exists for an open channel, so do not
          // enqueue; surface the failure instead.
          console.error('[MeshRTC] Outbound send error on open DataChannel:', err);
        }
      } else {
        pending.push(cloneMessage(data));
      }
    };

    const wireDataChannel = (channel) => {
      dc = channel;
      try { dc.binaryType = 'arraybuffer'; } catch (_) {}
      dc.onopen = () => {
        try { wasmEngine.mark_open(); } catch (_) {}
        // Flush buffered outbound messages in FIFO order.
        while (pending.length > 0) {
          const msg = pending.shift();
          try {
            dc.send(msg);
          } catch (e) {
            const kind = typeof msg === 'string' ? 'text' : 'binary';
            const size = typeof msg === 'string'
              ? msg.length
              : (msg && typeof msg.byteLength === 'number' ? msg.byteLength : 'unknown');
            console.warn(
              `[ZeroMesh] Failed flushing queued DataChannel message (kind=${kind}, size=${size}):`,
              e
            );
          }
        }
      };
      dc.onclose = () => {
        pending.length = 0;
        try { wasmEngine.mark_closed(); } catch (_) {}
      };
      dc.onerror = () => {
        pending.length = 0;
      };
      dc.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try { wasmEngine.inject_incoming_text(ev.data); } catch (_) {}
        } else if (ev.data instanceof ArrayBuffer) {
          try { wasmEngine.inject_incoming_binary(new Uint8Array(ev.data)); } catch (_) {}
        }
      };
      try {
        wasmEngine.set_outbound_tx((text) => {
          sendOrQueue(text);
        });
      } catch (_) {}
      try {
        if (typeof wasmEngine.set_outbound_binary_tx === 'function') {
          wasmEngine.set_outbound_binary_tx((bytes) => {
            sendOrQueue(bytes);
          });
        }
      } catch (_) {}
    };

    if (isOfferer === true) {
      const channel = pc.createDataChannel('zero-mesh', { ordered: true });
      wireDataChannel(channel);
    } else {
      pc.ondatachannel = (ev) => {
        wireDataChannel(ev.channel);
      };
    }

    const waitForIceGathering = () => new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { pc.removeEventListener('icegatheringstatechange', onChange); } catch (_) {}
        resolve();
      };
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') finish();
      };
      try { pc.addEventListener('icegatheringstatechange', onChange); } catch (_) {}
      const timeoutMs = (this.iceGatheringTimeoutMs && this.iceGatheringTimeoutMs > 0) ? this.iceGatheringTimeoutMs : 2500;
      setTimeout(finish, timeoutMs);
    });

    return {
      pc,
      dc,
      async createOfferSdp() {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering();
        return pc.localDescription ? pc.localDescription.sdp : offer.sdp;
      },
      async acceptOfferAndCreateAnswerSdp(offerSdp) {
        await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering();
        return pc.localDescription ? pc.localDescription.sdp : answer.sdp;
      },
      async applyAnswerSdp(answerSdp) {
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        try {
          await wasmEngine.apply_answer(answerSdp);
        } catch (e) {
          console.warn('[ZeroMesh] apply_answer error:', e);
        }
      },
      close() {
        try { if (dc) dc.close(); } catch (_) {}
        try { pc.close(); } catch (_) {}
        try { wasmEngine.mark_closed(); } catch (_) {}
      }
    };
  }

  async _stageNewInvite(secretHex) {
    if (!this.wasmMod || !this.hostSecret) return;
    try {
      this.pendingEngine = new this.wasmMod.WasmWebRtcEngine();
      const bridge = this._attachBrowserWebRtc(this.pendingEngine, true, this.iceServers);
      this.pendingBridge = bridge;
      const sdpOffer = await bridge.createOfferSdp();
      const inviteUuid = `inv-${this.peerId}-${Date.now().toString(36)}`;

      const token = this.wasmMod.WasmCryptoSession.compute_hmac_hex(this.hostSecret, inviteUuid);
      const invite = {
        do_id: this.roomId,
        invite_uuid: inviteUuid,
        token: token,
        sdp_offer: { sdp: sdpOffer },
        host_public_key: Array.from(this.cryptoSession.x25519_public_key_bytes()),
        guest_private_key: null,
        host_peer_id: this.peerId,
        assigned_peer_id: 'peer-' + Math.random().toString(36).substring(2, 8),
        host_signing_key: Array.from(this.cryptoSession.ed25519_public_key_bytes())
      };

      if (this.hostWs && this.hostWs.readyState === WebSocket.OPEN) {
        this.hostWs.send(JSON.stringify({ invite }));
      } else {
        // Fallback POST staging
        await fetch(`${this.workerOrigin}/stage/${encodeURIComponent(this.roomId)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${secretHex}`
          },
          body: JSON.stringify({ invite })
        });
      }
    } catch (e) {
      console.warn('[ZeroMesh] Failed staging new invite:', e);
    }
  }

  _setupHostSocket(secretHex) {
    if (typeof WebSocket === 'undefined') return;
    try {
      // Browser WebSockets cannot send custom HTTP headers (e.g. X-Peer-Id),
      // so pass peer_id via the query string for host authentication.
      const wsUrl = this.workerOrigin.replace(/^http/, 'ws')
        + `/host/${encodeURIComponent(this.roomId)}`
        + `?secret=${encodeURIComponent(secretHex)}`
        + `&peer_id=${encodeURIComponent(this.peerId)}`;
      this.hostWs = new WebSocket(wsUrl);

      this.hostWs.onopen = async () => {
        await this._stageNewInvite(secretHex);
      };

      this.hostWs.onmessage = async (event) => {
        try {
          const drop = JSON.parse(event.data);
          if (drop && drop.sealed_sdp_answer && this.pendingEngine) {
            const joinerPubX = new Uint8Array(drop.joiner_public_key);
            const joinerPubEd = drop.joiner_signing_key ? new Uint8Array(drop.joiner_signing_key) : null;
            const answerSdp = this.cryptoSession.open_drop_sdp(
              drop.joiner_peer_id,
              joinerPubX,
              joinerPubEd,
              JSON.stringify(drop.sealed_sdp_answer)
            );
            if (this.pendingBridge) {
              await this.pendingBridge.applyAnswerSdp(answerSdp);
              if (this.activeBridges) {
                this.activeBridges.set(drop.joiner_peer_id, this.pendingBridge);
              }
            } else {
              await this.pendingEngine.apply_answer(answerSdp);
            }
            this.gameMesh.register_peer(drop.joiner_peer_id, joinerPubX, this.pendingEngine);
            this.pendingEngine = null;
            this.pendingBridge = null;

            // Replenish slot in dead drop pool for the next joiner
            await this._stageNewInvite(secretHex);

            // Greet newly connected joiner
            this.sendTo(drop.joiner_peer_id, Protocol.createHello(
              this.peerId,
              this.localMeta.name,
              this.localMeta.jacketColor,
              this.localMeta.coatName,
              this.localMeta
            ));
          }
        } catch (err) {
          console.warn('[ZeroMesh] Error processing incoming drop on host WS:', err);
        }
      };
    } catch (e) {
      console.warn('[ZeroMesh] Host socket connection warning:', e);
    }
  }

  _wireMeshCallbacks(mesh) {
    if (!mesh) return;

    mesh.set_on_state((originPeerId, topic, payloadBytes) => {
      if (topic === 'game_packet') {
        try {
          const str = new TextDecoder().decode(payloadBytes);
          const packet = JSON.parse(str);
          this.handlePacket(originPeerId, packet);
        } catch (e) {
          console.warn('[ZeroMesh] Error parsing state packet:', e);
        }
      } else if (topic === 'proximity_invite') {
        this._handleProximityInvite(originPeerId, payloadBytes);
      } else if (topic === 'proximity_drop') {
        this._handleProximityDrop(originPeerId, payloadBytes);
      }
    });

    mesh.set_on_peer_joined((peerId) => {
      this.meshPeerIds.add(peerId);
      this.broadcast(Protocol.createHello(
        this.peerId,
        this.localMeta.name,
        this.localMeta.jacketColor,
        this.localMeta.coatName,
        this.localMeta
      ));
    });

    mesh.set_on_peer_left((peerId) => {
      this.meshPeerIds.delete(peerId);
      this.remotePeers.delete(peerId);
      if (typeof this.onPeerLeave === 'function') {
        this.onPeerLeave(peerId);
      }
    });
  }

  async _connectSimulatedMesh() {
    this.setStatus(NetStatus.CONNECTING);
    if (this._simulationHub) {
      const roomPeers = this._simulationHub.getPeers(this.roomId);
      if (roomPeers.length === 0) {
        this.isHost = true;
        this.setStatus(NetStatus.HOSTING);
        this.initNpcSpawner();
      } else {
        this.isHost = false;
        this.setStatus(NetStatus.CONNECTED_PEER);
      }
      this._simulationHub.register(this.roomId, this.peerId, this);
    } else {
      this.isHost = true;
      this.setStatus(NetStatus.HOSTING);
      this.initNpcSpawner();
    }
  }

  isNpcCoordinator() {
    if (!this.meshPeerIds.size) return this.isHost;
    const all = Array.from(this.meshPeerIds);
    all.push(this.peerId);
    all.sort();
    return all[0] === this.peerId;
  }

  initNpcSpawner() {
    if (!this.isNpcCoordinator()) return;
    this.activeNpcs.clear();
    const usedPathIds = new Set();
    const manifest = this.npcPaths;

    for (let i = 0; i < this.targetNpcCount; i++) {
      const avail = manifest.filter(p => !usedPathIds.has(p.id));
      if (avail.length === 0) break;
      const chosen = avail[i % avail.length];
      usedPathIds.add(chosen.id);

      const npcId = `npc-p2p-${Math.floor(1000 + Math.random() * 9000)}`;
      let type = chosen.type;
      if (type === 'both') type = (i % 2 === 0) ? 'walker' : 'jogger';
      const speed = type === 'walker' ? WALKER_SPEED : JOGGER_SPEED;
      const duration = (chosen.lengthPx / speed);
      const prewarmFraction = 0.15 + (i / this.targetNpcCount) * 0.70;
      const spawnTime = (Date.now() / 1000) - (prewarmFraction * duration);

      const npcData = {
        id: npcId,
        pathId: chosen.id,
        type,
        npcType: type,
        speed,
        duration,
        spawnTime,
        seed: Math.floor(Math.random() * 100000)
      };

      this.activeNpcs.set(npcId, npcData);
      const remainingLifetimeMs = Math.max(1000, ((1 - prewarmFraction) * duration) * 1000);
      const timer = setTimeout(() => {
        this.despawnNpc(npcId);
      }, remainingLifetimeMs);
      this.npcDespawnTimers.set(npcId, timer);
    }

    if (typeof this.onNpcSnapshot === 'function') {
      const snapshot = Array.from(this.activeNpcs.values()).map(n => ({
        id: n.id,
        pathId: n.pathId,
        type: n.type,
        npcType: n.type,
        seed: n.seed,
        spawnTime: n.spawnTime
      }));
      this.onNpcSnapshot(snapshot, Date.now());
    }
  }

  spawnNpc() {
    const usedPathIds = new Set(Array.from(this.activeNpcs.values()).map(n => n.pathId));
    const avail = this.npcPaths.filter(p => !usedPathIds.has(p.id));
    if (avail.length === 0) return null;

    const chosen = avail[Math.floor(Math.random() * avail.length)];
    const npcId = `npc-p2p-${Math.floor(1000 + Math.random() * 9000)}`;
    let type = chosen.type;
    if (type === 'both') type = (Math.random() < 0.5) ? 'walker' : 'jogger';
    const speed = type === 'walker' ? WALKER_SPEED : JOGGER_SPEED;
    const duration = chosen.lengthPx / speed;

    const npcData = {
      id: npcId,
      pathId: chosen.id,
      type,
      npcType: type,
      speed,
      duration,
      spawnTime: Date.now() / 1000,
      seed: Math.floor(Math.random() * 100000)
    };

    this.activeNpcs.set(npcId, npcData);
    const timer = setTimeout(() => {
      this.despawnNpc(npcId);
    }, duration * 1000);
    this.npcDespawnTimers.set(npcId, timer);

    return npcData;
  }

  despawnNpc(id) {
    const npc = this.activeNpcs.get(id);
    if (!npc) return;

    if (this.npcDespawnTimers.has(id)) {
      clearTimeout(this.npcDespawnTimers.get(id));
      this.npcDespawnTimers.delete(id);
    }
    this.activeNpcs.delete(id);

    const despawnPacket = {
      type: 'NPC_DESPAWN',
      id: npc.id,
      timestamp: Date.now()
    };
    this.broadcast(despawnPacket);
    if (typeof this.onNpcDespawn === 'function') {
      this.onNpcDespawn(npc.id);
    }

    if (this.isNpcCoordinator()) {
      const delay = 1000 + Math.random() * 3000;
      const replacementTimer = setTimeout(() => {
        this.npcReplacementTimers.delete(replacementTimer);
        if (this.isNpcCoordinator() && this.activeNpcs.size < this.targetNpcCount) {
          const newNpc = this.spawnNpc();
          if (newNpc) {
            const spawnPacket = {
              type: 'NPC_SPAWN',
              id: newNpc.id,
              pathId: newNpc.pathId,
              npcType: newNpc.type,
              seed: newNpc.seed,
              spawnTime: newNpc.spawnTime,
              npc: {
                id: newNpc.id,
                pathId: newNpc.pathId,
                type: newNpc.type,
                npcType: newNpc.type,
                seed: newNpc.seed,
                spawnTime: newNpc.spawnTime
              },
              timestamp: Date.now()
            };
            this.broadcast(spawnPacket);
            if (typeof this.onNpcSpawn === 'function') {
              this.onNpcSpawn(spawnPacket.npc || spawnPacket);
            }
          }
        }
      }, delay);
      this.npcReplacementTimers.add(replacementTimer);
    }
  }

  stopNpcSpawner() {
    for (const timer of this.npcDespawnTimers.values()) clearTimeout(timer);
    this.npcDespawnTimers.clear();
    for (const timer of this.npcReplacementTimers) clearTimeout(timer);
    this.npcReplacementTimers.clear();
    this.activeNpcs.clear();
  }

  broadcast(packet) {
    if (!packet) return;
    if (!packet.senderId) packet.senderId = this.peerId;
    if (this.gameMesh && typeof this.gameMesh.broadcast_state === 'function') {
      try {
        const json = typeof packet === 'string' ? packet : JSON.stringify(packet);
        const bytes = new TextEncoder().encode(json);
        this.gameMesh.broadcast_state('game_packet', bytes, 3);
      } catch (e) {
        console.warn('[ZeroMesh] Failed broadcast_state:', e);
      }
    }
    if (this._simulationHub) {
      this._simulationHub.broadcast(this.roomId, this.peerId, packet);
    }
  }

  sendTo(targetPeerId, packet) {
    if (!packet) return;
    if (!packet.senderId) packet.senderId = this.peerId;
    if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
      try {
        const json = typeof packet === 'string' ? packet : JSON.stringify(packet);
        const bytes = new TextEncoder().encode(json);
        this.gameMesh.send_direct_state(targetPeerId, 'game_packet', bytes);
      } catch (e) {
        console.warn('[ZeroMesh] Failed send_direct_state:', e);
      }
    }
    if (this._simulationHub) {
      this._simulationHub.sendTo(this.roomId, targetPeerId, this.peerId, packet);
    }
  }

  startSyncLoop(getLocalStateFn) {
    if (this.syncInterval) clearInterval(this.syncInterval);

    this.syncInterval = setInterval(() => {
      if (this.status !== NetStatus.HOSTING && this.status !== NetStatus.CONNECTED_PEER) return;

      const state = getLocalStateFn();
      if (!state || !state.owner || !state.dog) return;

      const packet = Protocol.createSyncState(this.peerId, state.owner, state.dog);
      this.broadcast(packet);
    }, 1000 / this.syncHz);
  }

  stop() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.isHost = false;
    this._abortLifecycle();
    this._stopHostHeartbeat();
    this.stopNpcSpawner();
    if (this.hostWs) {
      try { this.hostWs.close(); } catch (e) {}
      this.hostWs = null;
    }
    if (this.activeBridges) {
      for (const [id, bridge] of this.activeBridges.entries()) {
        try { if (bridge && typeof bridge.close === 'function') bridge.close(); } catch (_) {}
      }
      this.activeBridges.clear();
    }
    if (this.pendingBridge && typeof this.pendingBridge.close === 'function') {
      try { this.pendingBridge.close(); } catch (_) {}
      this.pendingBridge = null;
    }
    if (this.pendingProximityEngines) {
      for (const [id, pending] of this.pendingProximityEngines.entries()) {
        if (pending && pending.bridge && typeof pending.bridge.close === 'function') {
          try { pending.bridge.close(); } catch (_) {}
        }
      }
      this.pendingProximityEngines.clear();
    }
    this.remotePeers.clear();
    this.meshPeerIds.clear();
    this.cryptoSession = null;
    this.gameMesh = null;
    this.proximityMesh = null;
    this.hostSecret = null;
    this._role = null;
    this._roomSecret = null;
    this._matchRetries = 0;
    this._logPhase('idle');
    this.setStatus(NetStatus.OFFLINE);
  }

  handlePacket(senderId, packet) {
    if (!packet || typeof packet !== 'object') {
      try { packet = JSON.parse(packet); } catch (e) { return; }
    }
    if (senderId === this.peerId) return;

    switch (packet.type) {
      case PacketType.HELLO: {
        this.meshPeerIds.add(senderId);
        const meta = {
          name: packet.name || 'Walker',
          jacketColor: packet.jacketColor || '#1e3a8a',
          coatName: packet.dogCoatName || packet.coatName || 'Chocolate & Tan (Ziggy)',
          hairStyle: packet.hairStyle,
          hairColor: packet.hairColor,
          pantsColor: packet.pantsColor,
          skinTone: packet.skinTone,
          collarColor: packet.collarColor,
          personality: packet.personality || null
        };
        const peerData = this.ensureRemotePeer(senderId, meta);

        if (typeof this.onPeerJoin === 'function') {
          this.onPeerJoin(senderId, peerData.meta);
        }

        // Welcome back with localMeta and existing peer list
        const peersList = Array.from(this.remotePeers.entries())
          .filter(([id]) => id !== senderId)
          .map(([id, p]) => ({
            id,
            name: p.meta.name,
            jacketColor: p.meta.jacketColor,
            coatName: p.meta.coatName
          }));

        this.sendTo(senderId, Protocol.createWelcome(
          this.peerId,
          this.localMeta,
          peersList
        ));

        // If coordinator, send NPC snapshot
        if (this.isNpcCoordinator() && this.activeNpcs.size > 0) {
          const snapshot = Array.from(this.activeNpcs.values()).map(n => ({
            id: n.id,
            pathId: n.pathId,
            type: n.type,
            npcType: n.type,
            seed: n.seed,
            spawnTime: n.spawnTime
          }));
          this.sendTo(senderId, {
            type: 'NPC_SNAPSHOT',
            npcs: snapshot,
            serverTime: Date.now()
          });
        }
        break;
      }

      case PacketType.WELCOME: {
        this.meshPeerIds.add(senderId);
        if (packet.hostMeta) {
          this.ensureRemotePeer(senderId, packet.hostMeta);
          if (typeof this.onPeerJoin === 'function') {
            this.onPeerJoin(senderId, packet.hostMeta);
          }
        }
        if (Array.isArray(packet.peers)) {
          for (const p of packet.peers) {
            const peerId = typeof p === 'string' ? p : p?.id;
            const meta = typeof p === 'object' && p !== null ? {
              name: p.name,
              jacketColor: p.jacketColor,
              coatName: p.coatName || p.dogCoatName,
              hairStyle: p.hairStyle,
              hairColor: p.hairColor,
              pantsColor: p.pantsColor,
              skinTone: p.skinTone,
              collarColor: p.collarColor,
              personality: p.personality || null
            } : {};
            if (peerId && peerId !== this.peerId) {
              this.meshPeerIds.add(peerId);
              const peerData = this.ensureRemotePeer(peerId, meta);
              if (typeof this.onPeerJoin === 'function') {
                this.onPeerJoin(peerId, peerData.meta);
              }
            }
          }
        }
        break;
      }

      case PacketType.SYNC_STATE: {
        let peerData = this.remotePeers.get(senderId);
        if (!peerData) {
          peerData = this.ensureRemotePeer(senderId, { name: 'Player' });
          if (typeof this.onPeerJoin === 'function') {
            this.onPeerJoin(senderId, peerData.meta);
          }
        }

        const ownerSnap = packet.owner || {
          x: packet.ownerX,
          y: packet.ownerY,
          vx: packet.ownerVx || 0,
          vy: packet.ownerVy || 0,
          angle: packet.ownerAngle || 0,
          isMoving: Boolean(packet.isMoving),
          isLeashed: Boolean(packet.isLeashed)
        };

        const dogSnap = packet.dog || {
          x: packet.dogX,
          y: packet.dogY,
          vx: packet.dogVx || 0,
          vy: packet.dogVy || 0,
          angle: packet.dogAngle || 0,
          state: packet.dogState || 'FOLLOWING'
        };

        if (peerData.ownerInterpolator) {
          peerData.ownerInterpolator.setTarget(ownerSnap);
        }
        if (peerData.dogInterpolator) {
          peerData.dogInterpolator.setTarget(dogSnap);
        }
        break;
      }

      case PacketType.BALL_THROWN: {
        if (typeof this.onBallThrown === 'function') {
          this.onBallThrown(packet);
        }
        break;
      }

      case PacketType.BALL_SYNC: {
        if (typeof this.onBallSync === 'function') {
          this.onBallSync(packet);
        }
        break;
      }

      case PacketType.BARK: {
        if (typeof this.onBark === 'function') {
          this.onBark(packet.dogId || senderId);
        }
        break;
      }

      case PacketType.PET: {
        if (typeof this.onPet === 'function') {
          this.onPet(packet.dogId || senderId);
        }
        break;
      }

      case PacketType.WHISTLE: {
        if (typeof this.onWhistle === 'function') {
          this.onWhistle(senderId);
        }
        break;
      }

      case PacketType.EMOTE: {
        if (typeof this.onEmote === 'function') {
          this.onEmote(senderId, packet.emote);
        }
        break;
      }

      case PacketType.CHAT_MESSAGE: {
        if (typeof this.onChatMessage === 'function') {
          this.onChatMessage(senderId, packet.text);
        }
        break;
      }

      case PacketType.PROXIMITY_CHAT:
      case 'PROXIMITY_CHAT': {
        if (typeof this.onProximityChat === 'function') {
          this.onProximityChat({
            senderId: packet.senderId || senderId,
            name: packet.name || 'Walker',
            text: packet.text,
            x: packet.x,
            y: packet.y,
            clusterPeers: packet.clusterPeers
          });
        }
        break;
      }

      case 'PROXIMITY_BURN_MSG':
      case PacketType.PROXIMITY_BURN_MSG: {
        if (typeof this.onProximityBurnMessage === 'function') {
          this.onProximityBurnMessage(packet.messageUuid);
        }
        break;
      }

      case 'PROXIMITY_BURN_ALL':
      case PacketType.PROXIMITY_BURN_ALL: {
        if (typeof this.onProximityBurnSession === 'function') {
          this.onProximityBurnSession();
        }
        break;
      }

      case 'NPC_SNAPSHOT': {
        if (typeof this.onNpcSnapshot === 'function') {
          this.onNpcSnapshot(packet.npcs || [], packet.serverTime || Date.now());
        }
        break;
      }

      case 'NPC_SPAWN': {
        if (typeof this.onNpcSpawn === 'function') {
          this.onNpcSpawn(packet.npc || packet);
        }
        break;
      }

      case 'NPC_DESPAWN': {
        if (typeof this.onNpcDespawn === 'function') {
          this.onNpcDespawn(packet.id);
        }
        break;
      }

      default:
        break;
    }
  }

  // Dual-Mesh Proximity Chat
  async syncProximityCluster(clusterPeerIds) {
    const nextSet = new Set(clusterPeerIds || []);
    const joined = [...nextSet].filter(id => !this.activeClusterPeerIds.has(id));
    const left = [...this.activeClusterPeerIds].filter(id => !nextSet.has(id));
    this.activeClusterPeerIds = nextSet;

    // For joining peers: send proximity offer if deterministic initiator (localId < remoteId)
    for (const remoteId of joined) {
      if (this.peerId < remoteId) {
        if (this.wasmMod && this.proximityMesh && typeof window !== 'undefined' && window.RTCPeerConnection) {
          try {
            const engine = new this.wasmMod.WasmWebRtcEngine();
            const bridge = this._attachBrowserWebRtc(engine, true, this.iceServers);
            if (this.pendingProximityEngines) {
              this.pendingProximityEngines.set(remoteId, { engine, bridge });
            }
            const sdpOffer = await bridge.createOfferSdp();
            const inviteBytes = new TextEncoder().encode(JSON.stringify({
              initiator: this.peerId,
              sdpOffer,
              pubKey: Array.from(this.proximityMesh.local_public_key()),
              timestamp: Date.now()
            }));
            if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
              this.gameMesh.send_direct_state(remoteId, 'proximity_invite', inviteBytes);
            }
          } catch (e) {
            console.warn('[ZeroMesh] Live proximity offer error:', e);
          }
        } else {
          const inviteBytes = new TextEncoder().encode(JSON.stringify({
            initiator: this.peerId,
            timestamp: Date.now()
          }));
          if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
            this.gameMesh.send_direct_state(remoteId, 'proximity_invite', inviteBytes);
          }
        }
      }
    }

    // For departing peers: tear down proximity link
    for (const remoteId of left) {
      if (this.pendingProximityEngines && this.pendingProximityEngines.has(remoteId)) {
        const pending = this.pendingProximityEngines.get(remoteId);
        if (pending && pending.bridge && typeof pending.bridge.close === 'function') {
          try { pending.bridge.close(); } catch (_) {}
        }
        this.pendingProximityEngines.delete(remoteId);
      }
      if (this.activeBridges && this.activeBridges.has(remoteId)) {
        try { this.activeBridges.get(remoteId).close(); } catch (_) {}
        this.activeBridges.delete(remoteId);
      }
      if (this.proximityMesh && typeof this.proximityMesh.remove_peer === 'function') {
        try { this.proximityMesh.remove_peer(remoteId); } catch (e) {}
      }
    }
  }

  async _handleProximityInvite(originPeerId, payloadBytes) {
    let payload = {};
    try {
      const decoded = typeof payloadBytes === 'string' ? payloadBytes : new TextDecoder().decode(payloadBytes);
      payload = JSON.parse(decoded);
    } catch (e) {
      console.warn('[ZeroMesh] Failed decoding proximity invite:', e);
    }

    if (payload.sdpOffer && this.wasmMod && this.proximityMesh) {
      try {
        const engine = new this.wasmMod.WasmWebRtcEngine();
        const bridge = this._attachBrowserWebRtc(engine, false, this.iceServers);
        const answerSdp = await bridge.acceptOfferAndCreateAnswerSdp(payload.sdpOffer);
        const pubKeyBytes = payload.pubKey ? new Uint8Array(payload.pubKey) : new Uint8Array(32);
        this.proximityMesh.register_peer(originPeerId, pubKeyBytes, engine);
        if (this.activeBridges) {
          this.activeBridges.set(originPeerId, bridge);
        }
        const dropBytes = new TextEncoder().encode(JSON.stringify({
          responder: this.peerId,
          sdpAnswer: answerSdp,
          pubKey: Array.from(this.proximityMesh.local_public_key()),
          timestamp: Date.now()
        }));
        if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
          this.gameMesh.send_direct_state(originPeerId, 'proximity_drop', dropBytes);
        }
        return;
      } catch (e) {
        console.warn('[ZeroMesh] Error answering proximity invite:', e);
      }
    }

    const dropBytes = new TextEncoder().encode(JSON.stringify({
      responder: this.peerId,
      timestamp: Date.now()
    }));
    if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
      this.gameMesh.send_direct_state(originPeerId, 'proximity_drop', dropBytes);
    }
  }

  async _handleProximityDrop(originPeerId, payloadBytes) {
    let payload = {};
    try {
      const decoded = typeof payloadBytes === 'string' ? payloadBytes : new TextDecoder().decode(payloadBytes);
      payload = JSON.parse(decoded);
    } catch (e) {
      console.warn('[ZeroMesh] Failed decoding proximity drop:', e);
    }

    if (payload.sdpAnswer && this.pendingProximityEngines && this.pendingProximityEngines.has(originPeerId)) {
      try {
        const pending = this.pendingProximityEngines.get(originPeerId);
        const engine = pending && pending.engine ? pending.engine : pending;
        const bridge = pending && pending.bridge ? pending.bridge : null;
        if (bridge) {
          await bridge.applyAnswerSdp(payload.sdpAnswer);
          if (this.activeBridges) {
            this.activeBridges.set(originPeerId, bridge);
          }
        } else {
          await engine.apply_answer(payload.sdpAnswer);
        }
        if (this.proximityMesh) {
          const pubKeyBytes = payload.pubKey ? new Uint8Array(payload.pubKey) : new Uint8Array(32);
          this.proximityMesh.register_peer(originPeerId, pubKeyBytes, engine);
        }
      } catch (e) {
        console.warn('[ZeroMesh] Failed applying proximity answer:', e);
      } finally {
        this.pendingProximityEngines.delete(originPeerId);
      }
    }
  }

  sendProximityChat(text, peers) {
    if (!text) return;
    let sentLive = false;
    if (this.proximityMesh && typeof this.proximityMesh.peer_count === 'function' && this.proximityMesh.peer_count() > 0) {
      try {
        this.proximityMesh.broadcast_chat(text);
        sentLive = true;
      } catch (e) {
        console.warn('[ZeroMesh] Proximity broadcast_chat failed:', e);
      }
    }

    if (!sentLive) {
      if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function' && Array.isArray(peers) && peers.length > 0) {
        const chatPacket = Protocol.createProximityChat(this.peerId, this.localMeta.name, text, 0, 0, peers);
        const bytes = new TextEncoder().encode(JSON.stringify(chatPacket));
        for (const peerId of peers) {
          try {
            this.gameMesh.send_direct_state(peerId, 'game_packet', bytes);
          } catch (e) {
            console.warn(`[ZeroMesh] Failed sending direct proximity chat packet to ${peerId}:`, e);
          }
        }
      }
    }

    // Simulation / local fallback
    if (this._simulationHub) {
      this._simulationHub.broadcastProximityChat(this.roomId, this.peerId, this.localMeta.name, text, peers);
    }
  }

  burnProximityMessage(messageUuid) {
    if (!messageUuid) return;
    const packet = {
      type: 'PROXIMITY_BURN_MSG',
      messageUuid,
      senderId: this.peerId
    };
    const jsonStr = JSON.stringify(packet);
    const bytes = new TextEncoder().encode(jsonStr);

    let sentLive = false;
    if (this.proximityMesh && typeof this.proximityMesh.peer_count === 'function' && this.proximityMesh.peer_count() > 0) {
      try {
        if (typeof this.proximityMesh.broadcast_chat === 'function') {
          this.proximityMesh.broadcast_chat(jsonStr);
          sentLive = true;
        }
      } catch (e) {
        console.warn('[ZeroMesh] Proximity burn message broadcast failed:', e);
      }
    }

    if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
      const targets = this.meshPeerIds && this.meshPeerIds.size > 0
        ? Array.from(this.meshPeerIds)
        : Array.from(this.remotePeers.keys());
      for (const peerId of targets) {
        try {
          this.gameMesh.send_direct_state(peerId, 'game_packet', bytes);
        } catch (e) {
          console.warn(`[ZeroMesh] Failed sending direct burn packet to ${peerId}:`, e);
        }
      }
    }
  }

  burnProximitySession() {
    const packet = {
      type: 'PROXIMITY_BURN_ALL',
      senderId: this.peerId
    };
    const jsonStr = JSON.stringify(packet);
    const bytes = new TextEncoder().encode(jsonStr);

    let sentLive = false;
    if (this.proximityMesh && typeof this.proximityMesh.peer_count === 'function' && this.proximityMesh.peer_count() > 0) {
      try {
        if (typeof this.proximityMesh.broadcast_chat === 'function') {
          this.proximityMesh.broadcast_chat(jsonStr);
          sentLive = true;
        }
      } catch (e) {
        console.warn('[ZeroMesh] Proximity burn session broadcast failed:', e);
      }
    }

    if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
      const targets = this.meshPeerIds && this.meshPeerIds.size > 0
        ? Array.from(this.meshPeerIds)
        : Array.from(this.remotePeers.keys());
      for (const peerId of targets) {
        try {
          this.gameMesh.send_direct_state(peerId, 'game_packet', bytes);
        } catch (e) {
          console.warn(`[ZeroMesh] Failed sending direct burn session packet to ${peerId}:`, e);
        }
      }
    }
  }

  broadcastLeave() {
    const packet = {
      type: PacketType.PEER_LEFT,
      peerId: this.peerId,
      senderId: this.peerId
    };
    this.broadcast(packet);
  }

  async switchRoom(newRoomId) {
    if (!newRoomId || newRoomId === this.roomId) return;

    // 1. Broadcast peer departure to current room peers
    try {
      this.broadcastLeave();
    } catch (_) {}

    // 2. Tear down current room network channels & bridges
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this._abortLifecycle();
    this._stopHostHeartbeat();
    this.stopNpcSpawner();

    if (this.hostWs) {
      try { this.hostWs.close(); } catch (_) {}
      this.hostWs = null;
    }
    if (this.activeBridges) {
      for (const [id, bridge] of this.activeBridges.entries()) {
        try { if (bridge && typeof bridge.close === 'function') bridge.close(); } catch (_) {}
      }
      this.activeBridges.clear();
    }
    if (this.pendingBridge && typeof this.pendingBridge.close === 'function') {
      try { this.pendingBridge.close(); } catch (_) {}
      this.pendingBridge = null;
    }
    if (this.pendingProximityEngines) {
      for (const [id, pending] of this.pendingProximityEngines.entries()) {
        if (pending && pending.bridge && typeof pending.bridge.close === 'function') {
          try { pending.bridge.close(); } catch (_) {}
        }
      }
      this.pendingProximityEngines.clear();
    }

    // 3. Reset peer tracking collections
    this.remotePeers.clear();
    this.meshPeerIds.clear();
    this.activeNpcs.clear();
    this.activeClusterPeerIds.clear();
    this.isHost = false;
    this.cryptoSession = null;
    this.gameMesh = null;
    this.proximityMesh = null;
    this.hostSecret = null;
    this._role = null;
    this._roomSecret = null;
    this._matchRetries = 0;

    // 4. Update roomId and connect to new room
    this.roomId = newRoomId;
    return await this.connect(newRoomId);
  }

  updateServerClock(serverTime) {
    if (typeof serverTime === 'number' && !isNaN(serverTime)) {
      this.serverClockOffset = serverTime - Date.now();
    }
  }

  getServerTime() {
    return Date.now() + (this.serverClockOffset || 0);
  }
}
