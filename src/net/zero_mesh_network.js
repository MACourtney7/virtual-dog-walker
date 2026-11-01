// src/net/zero_mesh_network.js
// P2P State Replication, Random-Peer Matchmaking & Dual-Mesh Proximity Chat
// Built on zero_protocol and zero_mesh WebAssembly primitives.

import { PacketType, Protocol } from './protocol.js';
import { EntityInterpolator, NetStatus } from './network.js';
import npcManifest from '../world/npc_path_manifest.json';

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

const MANIFEST = (Array.isArray(npcManifest) && npcManifest.length > 0)
  ? npcManifest
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
    this.hostWs = null;
    this.hostSecret = null;
    this.pendingEngine = null;

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

  async connect(roomId) {
    if (roomId) this.roomId = roomId;
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

  async _connectLiveMesh() {
    try {
      this.hostSecret = this.generateSecret();
      const hostSecretHex = this.bytesToHex(this.hostSecret);

      const matchUrl = `${this.workerOrigin}/match/${encodeURIComponent(this.roomId)}`;
      const matchResp = await fetch(matchUrl);
      const matchData = matchResp.ok ? await matchResp.json() : { status: 'empty' };

      const privKey = this.generateSecret();
      this.cryptoSession = new this.wasmMod.WasmCryptoSession();
      this.gameMesh = new this.wasmMod.WasmMeshTopology(this.peerId, privKey);
      this.proximityMesh = new this.wasmMod.WasmMeshTopology(`prox-${this.peerId}`, this.generateSecret());

      this._wireMeshCallbacks(this.gameMesh);

      if (matchData.status === 'matched' && matchData.invite) {
        // Joiner flow: Accept offer, generate SDP answer, seal drop payload, and POST /drop
        const invite = matchData.invite;
        if (invite.assigned_peer_id) {
          this.peerId = invite.assigned_peer_id;
        }

        const engine = new this.wasmMod.WasmWebRtcEngine();
        const answerSdp = await engine.accept_offer_and_create_answer(invite.sdp_offer);

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
          joiner_peer_id: this.peerId,
          joiner_public_key: Array.from(this.cryptoSession.x25519_public_key_bytes()),
          joiner_signing_key: Array.from(this.cryptoSession.ed25519_public_key_bytes()),
          sealed_sdp_answer: JSON.parse(sealedSdpJson)
        };

        const dropUrl = `${this.workerOrigin}/drop/${encodeURIComponent(this.roomId)}/${encodeURIComponent(invite.invite_uuid)}`;
        await fetch(dropUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${invite.hmac_token || invite.token}`
          },
          body: JSON.stringify(dropPayload)
        });

        this.gameMesh.register_peer(invite.host_peer_id || 'host', hostPubX, engine);
        this.setStatus(NetStatus.CONNECTED_PEER);
        this.isHost = false;
        this._setupHostSocket(hostSecretHex);
      } else {
        // Seed host flow
        this.setStatus(NetStatus.HOSTING);
        this.isHost = true;
        this._setupHostSocket(hostSecretHex);
        this.initNpcSpawner();
      }
    } catch (err) {
      console.error('[ZeroMesh] Live connection failed, falling back to simulated mesh:', err);
      await this._connectSimulatedMesh();
    }
  }

  async _stageNewInvite(secretHex) {
    if (!this.wasmMod || !this.hostSecret) return;
    try {
      this.pendingEngine = new this.wasmMod.WasmWebRtcEngine();
      const sdpOffer = await this.pendingEngine.create_offer();
      const inviteUuid = `inv-${this.peerId}-${Date.now().toString(36)}`;
      const assignedPeerId = `walker-${Math.random().toString(36).substring(2, 8)}`;

      const token = this.wasmMod.WasmCryptoSession.compute_hmac_hex(this.hostSecret, inviteUuid);
      const invite = {
        invite_uuid: inviteUuid,
        assigned_peer_id: assignedPeerId,
        host_peer_id: this.peerId,
        host_public_key: Array.from(this.cryptoSession.x25519_public_key_bytes()),
        host_signing_key: Array.from(this.cryptoSession.ed25519_public_key_bytes()),
        sdp_offer: sdpOffer,
        hmac_token: token
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
      const wsUrl = this.workerOrigin.replace(/^http/, 'ws') + `/host/${encodeURIComponent(this.roomId)}?secret=${encodeURIComponent(secretHex)}`;
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
            await this.pendingEngine.apply_answer(answerSdp);
            this.gameMesh.register_peer(drop.joiner_peer_id, joinerPubX, this.pendingEngine);
            this.pendingEngine = null;

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
    this.stopNpcSpawner();
    if (this.hostWs) {
      try { this.hostWs.close(); } catch (e) {}
      this.hostWs = null;
    }
    this.remotePeers.clear();
    this.meshPeerIds.clear();
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
  syncProximityCluster(clusterPeerIds) {
    const nextSet = new Set(clusterPeerIds || []);
    const joined = [...nextSet].filter(id => !this.activeClusterPeerIds.has(id));
    const left = [...this.activeClusterPeerIds].filter(id => !nextSet.has(id));
    this.activeClusterPeerIds = nextSet;

    // For joining peers: send proximity offer if deterministic initiator (localId < remoteId)
    for (const remoteId of joined) {
      if (this.peerId < remoteId) {
        const inviteBytes = new TextEncoder().encode(JSON.stringify({
          initiator: this.peerId,
          timestamp: Date.now()
        }));
        if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
          this.gameMesh.send_direct_state(remoteId, 'proximity_invite', inviteBytes);
        }
      }
    }

    // For departing peers: tear down proximity link
    for (const remoteId of left) {
      if (this.proximityMesh && typeof this.proximityMesh.remove_peer === 'function') {
        try { this.proximityMesh.remove_peer(remoteId); } catch (e) {}
      }
    }
  }

  _handleProximityInvite(originPeerId, payloadBytes) {
    const dropBytes = new TextEncoder().encode(JSON.stringify({
      responder: this.peerId,
      timestamp: Date.now()
    }));
    if (this.gameMesh && typeof this.gameMesh.send_direct_state === 'function') {
      this.gameMesh.send_direct_state(originPeerId, 'proximity_drop', dropBytes);
    }
  }

  _handleProximityDrop(originPeerId, payloadBytes) {
    // Proximity channel confirmed
  }

  sendProximityChat(text, peers) {
    if (!text) return;
    if (this.proximityMesh && typeof this.proximityMesh.broadcast_chat === 'function') {
      try {
        this.proximityMesh.broadcast_chat(text);
      } catch (e) {
        console.warn('[ZeroMesh] Proximity broadcast_chat failed:', e);
      }
    }
    // Simulation / local fallback
    if (this._simulationHub) {
      this._simulationHub.broadcastProximityChat(this.roomId, this.peerId, this.localMeta.name, text, peers);
    }
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
