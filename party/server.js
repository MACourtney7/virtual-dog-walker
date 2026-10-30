// party/server.js - Cloudflare PartyServer Room Relay & Asset Server
import { Server, routePartykitRequest } from "partyserver";
import npcManifest from "../src/world/npc_path_manifest.json" with { type: "json" };

const FALLBACK_MANIFEST = [
  { id: "ladies-mile-loop", type: "both", lengthPx: 5726.1 },
  { id: "sea-walls-promenade", type: "both", lengthPx: 1789.1 },
  { id: "durdham-down-circuit", type: "jogger", lengthPx: 3103.1 },
  { id: "woodland-trail-loop", type: "walker", lengthPx: 2091.7 },
  { id: "central-meadow-ramble", type: "walker", lengthPx: 2104.2 },
  { id: "trans-downs-express", type: "jogger", lengthPx: 3462.8 },
  { id: "sea-walls-to-water-tower", type: "walker", lengthPx: 2920.2 },
  { id: "clifton-woodland-traverse", type: "walker", lengthPx: 2137.7 },
  { id: "north-meadow-diagonal", type: "both", lengthPx: 2646.5 },
  { id: "perimeter-grand-loop", type: "jogger", lengthPx: 9527.3 }
];

const MANIFEST = (Array.isArray(npcManifest) && npcManifest.length > 0)
  ? npcManifest
  : FALLBACK_MANIFEST;

const WALKER_SPEED = 35; // px/s
const JOGGER_SPEED = 80; // px/s
const TARGET_NPC_COUNT = 5;

export class ParkServer extends Server {
  constructor(...args) {
    super(...args);
    this.peers = new Map();
    this.connections = new Set();
    this.activeNpcs = new Map();
    this.npcDespawnTimers = new Map();
    this.npcReplacementTimers = new Set();
    this.paths = MANIFEST;
    this.targetNpcCount = TARGET_NPC_COUNT;
  }

  hasActiveClients() {
    if (this.connections && this.connections.size > 0) return true;
    if (this.peers && this.peers.size > 0) return true;
    if (typeof this.getConnections === "function") {
      try {
        const conns = [...this.getConnections()];
        if (conns.length > 0) return true;
      } catch (e) {
        // ignore
      }
    }
    return false;
  }

  initSpawner() {
    while (this.activeNpcs.size < this.targetNpcCount) {
      this.spawnNpc();
    }
  }

  spawnNpc() {
    if (!this.paths || this.paths.length === 0) return null;

    // Pick an unused path from manifest
    const usedPathIds = new Set();
    for (const npc of this.activeNpcs.values()) {
      usedPathIds.add(npc.pathId);
    }
    const availablePaths = this.paths.filter(p => !usedPathIds.has(p.id));
    const pathPool = availablePaths.length > 0 ? availablePaths : this.paths;
    const path = pathPool[Math.floor(Math.random() * pathPool.length)];

    let type;
    if (path.type === "walker") {
      type = "walker";
    } else if (path.type === "jogger") {
      type = "jogger";
    } else {
      type = Math.random() < 0.5 ? "walker" : "jogger";
    }

    const speed = type === "jogger" ? JOGGER_SPEED : WALKER_SPEED;
    const lifetimeMs = Math.round((path.lengthPx / speed) * 1000);
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    const spawnTime = Date.now();
    const id = `npc-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

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
    }, lifetimeMs);
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
      type: "NPC_DESPAWN",
      id: npc.id,
      timestamp: Date.now()
    };
    this.broadcast(JSON.stringify(despawnPacket));

    if (this.hasActiveClients()) {
      const delay = 1000 + Math.random() * 4000;
      const replacementTimer = setTimeout(() => {
        this.npcReplacementTimers.delete(replacementTimer);
        if (this.hasActiveClients() && this.activeNpcs.size < this.targetNpcCount) {
          const newNpc = this.spawnNpc();
          if (newNpc) {
            const spawnPacket = {
              type: "NPC_SPAWN",
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
            this.broadcast(JSON.stringify(spawnPacket));
          }
        }
      }, delay);
      this.npcReplacementTimers.add(replacementTimer);
    }
  }

  stopSpawner() {
    if (this.npcDespawnTimers) {
      for (const timer of this.npcDespawnTimers.values()) {
        clearTimeout(timer);
      }
      this.npcDespawnTimers.clear();
    }
    if (this.npcReplacementTimers) {
      for (const timer of this.npcReplacementTimers) {
        clearTimeout(timer);
      }
      this.npcReplacementTimers.clear();
    }
    if (this.activeNpcs) {
      this.activeNpcs.clear();
    }
  }

  onConnect(conn, ctx) {
    const roomId = this.name || (this.room && this.room.id) || "the-commons";

    if (!this.connections) this.connections = new Set();
    const isFirstPeer = !this.hasActiveClients();
    this.connections.add(conn.id);

    if (this.activeNpcs.size === 0 && isFirstPeer) {
      this.initSpawner();
    }

    // Collect existing connected peers with full metadata
    const existingPeers = [];
    if (this.peers) {
      for (const [pid, peerData] of this.peers.entries()) {
        if (pid !== conn.id) {
          existingPeers.push({
            id: peerData.id || pid,
            name: peerData.name || 'Walker',
            jacketColor: peerData.jacketColor || '#1e3a8a',
            coatName: peerData.coatName || peerData.dogCoatName || 'Chocolate & Tan (Ziggy)'
          });
        }
      }
    }

    // Transmit WELCOME packet with assigned peerId, room info, and active peers
    const welcomePacket = {
      type: "WELCOME",
      peerId: conn.id,
      roomId: roomId,
      peers: existingPeers,
      serverTime: Date.now()
    };

    conn.send(JSON.stringify(welcomePacket));

    // Send NPC_SNAPSHOT immediately to connecting client
    const snapshotPacket = {
      type: "NPC_SNAPSHOT",
      npcs: Array.from(this.activeNpcs.values()).map(npc => ({
        id: npc.id,
        pathId: npc.pathId,
        type: npc.type,
        npcType: npc.type,
        seed: npc.seed,
        spawnTime: npc.spawnTime
      })),
      serverTime: Date.now(),
      timestamp: Date.now()
    };

    conn.send(JSON.stringify(snapshotPacket));
  }

  onMessage(conn, message) {
    try {
      const data = typeof message === "string" ? JSON.parse(message) : message;

      if (data && data.type === 'HELLO') {
        if (!this.peers) this.peers = new Map();
        this.peers.set(conn.id, {
          id: conn.id,
          name: data.name || 'Walker',
          jacketColor: data.jacketColor || '#1e3a8a',
          coatName: data.dogCoatName || data.coatName || 'Chocolate & Tan (Ziggy)'
        });
      }

      data.senderId = conn.id;
      data.peerId = conn.id;

      const payload = JSON.stringify(data);
      // Broadcast to other peers in this room
      this.broadcast(payload, [conn.id]);
    } catch (err) {
      console.error("[ParkServer] Message parse/relay error:", err);
    }
  }

  onClose(conn) {
    if (this.connections) {
      this.connections.delete(conn.id);
    }
    if (this.peers) {
      this.peers.delete(conn.id);
    }

    if (!this.hasActiveClients()) {
      this.stopSpawner();
    }

    const leftPacket = {
      type: "PEER_LEFT",
      peerId: conn.id,
      timestamp: Date.now()
    };

    this.broadcast(JSON.stringify(leftPacket));
  }

  onError(conn, err) {
    console.error(`[ParkServer] Error on peer ${conn.id}:`, err);
  }
}

export default {
  async fetch(request, env, ctx) {
    // Durable Object Namespace Aliasing
    if (env && env.ParkServer) {
      if (!env.park) env.park = env.ParkServer;
      if (!env.parkserver) env.parkserver = env.ParkServer;
    }

    // 1. Route PartyServer WebSocket / partykit requests with crash guard
    if (typeof routePartykitRequest === "function") {
      try {
        const partyResponse = await routePartykitRequest(request, env);
        if (partyResponse) {
          return partyResponse;
        }
      } catch (err) {
        console.error("[ParkServer] routePartykitRequest error:", err);
      }
    }

    // 2. Fallback to Cloudflare Static Assets binding if present
    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
