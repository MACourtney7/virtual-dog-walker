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
      coatName: 'Chocolate & Tan (Ziggy)'
    };

    this.workerOrigin = (typeof window !== 'undefined' && window.WORKER_HTTP_ORIGIN)
      ? window.WORKER_HTTP_ORIGIN
      : 'https://network.zero-network.workers.dev';

    this.remotePeers = new Map(); // peerId -> { id, name, owner, dog, interpolator, ... }
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
        // Joiner flow
        const invite = matchData.invite;
        if (invite.assigned_peer_id) {
          this.peerId = invite.assigned_peer_id;
        }

        const dropPayload = this.cryptoSession.create_drop_payload_json(
          invite.do_id,
          invite.invite_uuid,
          invite.token,
          invite.host_public_key,
          "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n", // SDP answer placeholder or RTCPeerConnection answer
          this.peerId
        );

        const dropUrl = `${this.workerOrigin}/drop/${encodeURIComponent(this.roomId)}/${encodeURIComponent(invite.invite_uuid)}`;
        await fetch(dropUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${invite.token}`
          },
          body: dropPayload
        });

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

  _setupHostSocket(secretHex) {
    if (typeof WebSocket === 'undefined') return;
    try {
      const wsUrl = this.workerOrigin.replace(/^http/, 'ws') + `/host/${encodeURIComponent(this.roomId)}`;
      this.hostWs = new WebSocket(wsUrl);
      this.hostWs.onopen = () => {
        // Stage invite if needed
      };
      this.hostWs.onmessage = (event) => {
        // Incoming joiner drop payload delivered down host WebSocket
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
          console.warn('[ZeroMesh] Failed to parse incoming game packet:', e);
        }
      } else if (topic === 'proximity_invite') {
        this._handleProximityInvite(originPeerId, payloadBytes);
      } else if (topic === 'proximity_drop') {
        this._handleProximityDrop(originPeerId, payloadBytes);
      }
    });

    mesh.set_on_message((senderId, text) => {
      if (this.onProximityChat) {
        this.onProximityChat({ senderId, text });
      }
    });
  }

  async _connectSimulatedMesh() {
    this.isHost = !this._simulationHub || this._simulationHub.getPeerCount(this.roomId) === 0;
    this.setStatus(this.isHost ? NetStatus.HOSTING : NetStatus.CONNECTED_PEER);

    if (this._simulationHub) {
      this._simulationHub.registerPeer(this.roomId, this);
    }

    if (this.isHost) {
      this.initNpcSpawner();
    } else {
      this.broadcast(Protocol.createHello(
        this.peerId,
        this.localMeta.name,
        this.localMeta.jacketColor,
        this.localMeta.coatName
      ));
    }
  }

  disconnect() {
    this.stopNpcSpawner();
    if (this.hostWs) {
      try { this.hostWs.close(); } catch (e) {}
      this.hostWs = null;
    }
    if (this._simulationHub) {
      this._simulationHub.unregisterPeer(this.roomId, this);
    }
    this.remotePeers.clear();
    this.meshPeerIds.clear();
    this.setStatus(NetStatus.OFFLINE);
  }

  isNpcCoordinator() {
    if (this.meshPeerIds.size === 0) return true;
    for (const remoteId of this.meshPeerIds) {
      if (remoteId < this.peerId) {
        return false;
      }
    }
    return true;
  }

  initNpcSpawner() {
    this.stopNpcSpawner();
    const count = this.targetNpcCount;
    for (let i = 0; i < count; i++) {
      const prewarmFraction = 0.15 + (i / count) * 0.70;
      this.spawnNpc(prewarmFraction);
    }
  }

  spawnNpc(prewarmFraction = 0.0) {
    if (!this.npcPaths || this.npcPaths.length === 0) return null;

    const usedPathIds = new Set();
    for (const npc of this.activeNpcs.values()) {
      usedPathIds.add(npc.pathId);
    }
    const availablePaths = this.npcPaths.filter(p => !usedPathIds.has(p.id));
    const pathPool = availablePaths.length > 0 ? availablePaths : this.npcPaths;
    const path = pathPool[Math.floor(Math.random() * pathPool.length)];

    let type;
    if (path.type === 'walker') type = 'walker';
    else if (path.type === 'jogger') type = 'jogger';
    else type = Math.random() < 0.5 ? 'walker' : 'jogger';

    const speed = type === 'jogger' ? JOGGER_SPEED : WALKER_SPEED;
    const lifetimeMs = Math.round((path.lengthPx / speed) * 1000);
    const offsetMs = Math.round(lifetimeMs * Math.max(0, Math.min(0.9, prewarmFraction)));
    const now = Date.now();
    const spawnTime = now - offsetMs;
    const remainingLifetimeMs = Math.max(500, lifetimeMs - offsetMs);
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    const id = `npc-${Math.random().toString(36).slice(2, 9)}-${now.toString(36)}`;

    const npcData = {
      id,
      pathId: path.id,
      type,
      npcType: type,
      seed,
      spawnTime,
      lifetimeMs
    };

    this.activeNpcs.set(id, npcData);

    const despawnTimer = setTimeout(() => {
      this.despawnNpc(id);
    }, remainingLifetimeMs);
    this.npcDespawnTimers.set(id, despawnTimer);

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

  handlePacket(senderId, packet) {
    if (!packet || typeof packet !== 'object') {
      try { packet = JSON.parse(packet); } catch (e) { return; }
    }
    if (senderId === this.peerId) return;

    switch (packet.type) {
      case PacketType.HELLO: {
        this.meshPeerIds.add(senderId);
        if (!this.remotePeers.has(senderId)) {
          this.remotePeers.set(senderId, {
            id: senderId,
            name: packet.name || 'Walker',
            jacketColor: packet.jacketColor || '#1e3a8a',
            coatName: packet.coatName || 'Chocolate & Tan (Ziggy)',
            interpolator: new EntityInterpolator()
          });
        }
        if (typeof this.onPeerJoin === 'function') {
          this.onPeerJoin(senderId, packet.name, this.remotePeers.get(senderId));
        }

        // Welcome back with state
        this.sendTo(senderId, Protocol.createWelcome(
          this.peerId,
          Array.from(this.remotePeers.values()).map(p => ({
            id: p.id,
            name: p.name,
            jacketColor: p.jacketColor,
            coatName: p.coatName
          }))
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
        if (Array.isArray(packet.peers)) {
          for (const peer of packet.peers) {
            if (peer.id && peer.id !== this.peerId && !this.remotePeers.has(peer.id)) {
              this.meshPeerIds.add(peer.id);
              this.remotePeers.set(peer.id, {
                id: peer.id,
                name: peer.name || 'Walker',
                jacketColor: peer.jacketColor || '#1e3a8a',
                coatName: peer.coatName || 'Chocolate & Tan (Ziggy)',
                interpolator: new EntityInterpolator()
              });
              if (typeof this.onPeerJoin === 'function') {
                this.onPeerJoin(peer.id, peer.name, this.remotePeers.get(peer.id));
              }
            }
          }
        }
        break;
      }

      case PacketType.SYNC_STATE: {
        const peer = this.remotePeers.get(senderId);
        if (peer && peer.interpolator) {
          peer.interpolator.setTarget({
            x: packet.ownerX,
            y: packet.ownerY,
            angle: packet.ownerAngle || 0,
            vx: packet.ownerVx || 0,
            vy: packet.ownerVy || 0,
            dogX: packet.dogX,
            dogY: packet.dogY,
            dogAngle: packet.dogAngle || 0,
            dogState: packet.dogState || 'FOLLOW'
          });
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
    // Recipient receives proximity_invite over gameMesh and returns proximity_drop
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

