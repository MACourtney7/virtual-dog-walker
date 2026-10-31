# VirtualDogWalker Codebase Dump

## FILE: package.json

```typescript
{
  "name": "virtual-dog-walker",
  "version": "1.0.0",
  "description": "Virtual Dog Walker - Multiplayer dog walking field social sandbox at Clifton Down with on-demand edge rooms",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "python3 test/run_tests.py"
  },
  "dependencies": {
    "partyserver": "^0.0.40"
  },
  "devDependencies": {
    "wrangler": "^3.100.0"
  }
}

```

## FILE: ./party/server.js

```typescript
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

```

## FILE: ./src/engine/physics.js

```typescript
// 2D Kinematic Physics & Collision Engine for Ziggy Platformer

export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  scale(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  length() {
    return Math.hypot(this.x, this.y);
  }
}

export class AABB {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  get left() { return this.x; }
  get right() { return this.x + this.width; }
  get top() { return this.y; }
  get bottom() { return this.y + this.height; }

  intersects(other) {
    return (
      this.left < other.right &&
      this.right > other.left &&
      this.top < other.bottom &&
      this.bottom > other.top
    );
  }
}

export const PlatformType = {
  SOLID: 'solid',
  ONE_WAY: 'one_way'
};

export class Platform extends AABB {
  constructor(x, y, width, height, type = PlatformType.SOLID) {
    super(x, y, width, height);
    this.type = type;
  }
}

export class KinematicBody {
  constructor(x, y, width, height) {
    this.pos = new Vector2(x, y);
    this.vel = new Vector2(0, 0);
    this.size = new Vector2(width, height);
    this.gravity = 1100; // px/s²
    this.maxFallSpeed = 700;

    this.isGrounded = false;
    this.coyoteTimer = 0;
    this.coyoteMax = 0.12; // 120ms grace after leaving ledge
    this.jumpBufferTimer = 0;
    this.jumpBufferMax = 0.12;

    this.facing = 1; // 1 = right, -1 = left
    this.passThroughTimer = 0; // Drop down through one-way ledges
  }

  get aabb() {
    return new AABB(this.pos.x, this.pos.y, this.size.x, this.size.y);
  }

  queueJump() {
    this.jumpBufferTimer = this.jumpBufferMax;
  }

  dropThrough() {
    this.passThroughTimer = 0.25;
  }

  executeJump(force = 500) {
    this.vel.y = -force;
    this.isGrounded = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
  }

  cutJump(cutFactor = 0.45) {
    if (this.vel.y < -50) {
      this.vel.y *= cutFactor;
    }
  }

  update(dt, platforms = []) {
    // Timers
    if (this.jumpBufferTimer > 0) this.jumpBufferTimer -= dt;
    if (this.passThroughTimer > 0) this.passThroughTimer -= dt;

    if (this.isGrounded) {
      this.coyoteTimer = this.coyoteMax;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    // Buffered jump trigger
    if (this.jumpBufferTimer > 0 && (this.isGrounded || this.coyoteTimer > 0)) {
      this.executeJump();
    }

    // Apply gravity
    this.vel.y = Math.min(this.vel.y + this.gravity * dt, this.maxFallSpeed);

    const prevY = this.pos.y;
    const prevBottom = prevY + this.size.height;

    // Horizontal Movement & Collisions
    this.pos.x += this.vel.x * dt;
    let box = this.aabb;
    for (const plat of platforms) {
      if (plat.type === PlatformType.SOLID && box.intersects(plat)) {
        if (this.vel.x > 0) {
          this.pos.x = plat.left - this.size.x;
        } else if (this.vel.x < 0) {
          this.pos.x = plat.right;
        }
        this.vel.x = 0;
        box = this.aabb;
      }
    }

    // Vertical Movement & Collisions
    this.pos.y += this.vel.y * dt;
    this.isGrounded = false;
    box = this.aabb;

    for (const plat of platforms) {
      if (plat.type === PlatformType.SOLID) {
        if (box.intersects(plat)) {
          if (this.vel.y > 0) { // Landing on top
            this.pos.y = plat.top - this.size.height;
            this.vel.y = 0;
            this.isGrounded = true;
          } else if (this.vel.y < 0) { // Bonking ceiling
            this.pos.y = plat.bottom;
            this.vel.y = 0;
          }
          box = this.aabb;
        }
      } else if (plat.type === PlatformType.ONE_WAY && this.passThroughTimer <= 0) {
        // Only collide if falling and was above the top in previous step
        if (this.vel.y >= 0 && prevBottom <= plat.top + 4 && box.intersects(plat)) {
          this.pos.y = plat.top - this.size.height;
          this.vel.y = 0;
          this.isGrounded = true;
          box = this.aabb;
        }
      }
    }
  }
}

```

## FILE: ./src/entities/collectibles.js

```typescript
// Collectibles System: Golden Bones, Tennis Balls, and Sausages
import { AABB } from '../engine/physics.js';

export const CollectibleType = {
  BONE: 'BONE',
  TENNIS_BALL: 'TENNIS_BALL',
  SAUSAGE: 'SAUSAGE'
};

export class Collectible {
  constructor(x, y, type = CollectibleType.BONE) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.size = 22;
    this.isCollected = false;
    this.floatTimer = Math.random() * Math.PI * 2;
  }

  get aabb() {
    return new AABB(this.x, this.y, this.size, this.size);
  }

  update(dt) {
    this.floatTimer += dt * 3.5;
  }

  draw(ctx) {
    if (this.isCollected) return;

    const bobY = this.y + Math.sin(this.floatTimer) * 4;

    ctx.save();
    ctx.translate(this.x + this.size / 2, bobY + this.size / 2);

    if (this.type === CollectibleType.BONE) {
      // Golden Bone
      ctx.fillStyle = '#f3c948';
      ctx.strokeStyle = '#c4971c';
      ctx.lineWidth = 1.5;

      // Center bridge
      ctx.fillRect(-7, -2.5, 14, 5);
      // Knobs
      ctx.beginPath();
      ctx.arc(-7, -4, 3.2, 0, Math.PI * 2);
      ctx.arc(-7, 4, 3.2, 0, Math.PI * 2);
      ctx.arc(7, -4, 3.2, 0, Math.PI * 2);
      ctx.arc(7, 4, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Shimmer highlight
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-2, -1, 1.5, 0, Math.PI * 2);
      ctx.fill();

    } else if (this.type === CollectibleType.TENNIS_BALL) {
      // Bright Neon Tennis Ball
      ctx.fillStyle = '#bef264';
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
      ctx.fill();

      // Curved seam
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-3, 0, 6, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();

    } else if (this.type === CollectibleType.SAUSAGE) {
      // Meaty Sausage
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.roundRect(-8, -4, 16, 8, 4);
      ctx.fill();

      ctx.fillStyle = '#f87171';
      ctx.fillRect(-4, -2, 8, 4);
    }

    ctx.restore();
  }
}

```

## FILE: ./src/entities/companion_dog.js

```typescript
// Companion Dog Entity - Canine Steering AI, Floppy Ear Springs, Leash Mechanics & Ball Fetching
import { PoopPile } from './waste.js';

export const DogState = {
  FOLLOWING: 'FOLLOWING',
  ROAMING: 'ROAMING',
  SOCIAL_GREET: 'SOCIAL_GREET',
  IDLE_SNIFF: 'IDLE_SNIFF',
  SITTING: 'SITTING',
  FETCHING: 'FETCHING',
  PLAY_BOW: 'PLAY_BOW',
  BARKING: 'BARKING',
  RECALLED: 'RECALLED',
  LOST: 'LOST',
  POOPING: 'POOPING'
};

export const CoatPreset = {
  CHOCOLATE_TAN: {
    name: 'Chocolate & Tan (Ziggy)',
    bodyColor: '#2e1a14',
    bodyShade: '#22130e',
    tanColor: '#d89b54',
    tanHighlight: '#e2aa68',
    earRoot: '#2e1a14',
    earHighlight: '#9e5528',
    noseColor: '#5e372e',
    bibColor: '#f4efe6'
  },
  GOLDEN: {
    name: 'Golden Retriever',
    bodyColor: '#d4a373',
    bodyShade: '#b8824f',
    tanColor: '#faedcd',
    tanHighlight: '#fefae0',
    earRoot: '#c58b54',
    earHighlight: '#e0a96d',
    noseColor: '#3d261d',
    bibColor: '#fffdfa'
  },
  BLACK_LAB: {
    name: 'Black Lab',
    bodyColor: '#1e2022',
    bodyShade: '#374151',
    tanColor: '#4b5563',
    tanHighlight: '#6b7280',
    earRoot: '#1e2022',
    earHighlight: '#374151',
    noseColor: '#090a0f',
    bibColor: '#f1f5f9'
  },
  JACK_RUSSELL: {
    name: 'Jack Russell Terrier',
    bodyColor: '#f8fafc',
    bodyShade: '#e2e8f0',
    tanColor: '#b45309',
    tanHighlight: '#d97706',
    earRoot: '#b45309',
    earHighlight: '#92400e',
    noseColor: '#1e293b',
    bibColor: '#ffffff',
    hasEyePatch: true
  },
  RED_SETTER: {
    name: 'Irish Red Setter',
    bodyColor: '#7c2d12',
    bodyShade: '#991b1b',
    tanColor: '#b45309',
    tanHighlight: '#d97706',
    earRoot: '#7c2d12',
    earHighlight: '#991b1b',
    noseColor: '#27100b',
    bibColor: '#fef2f2'
  }
};

export class CompanionDog {
  constructor(x = 1240, y = 920, owner = null, coat = CoatPreset.CHOCOLATE_TAN, collarColor = '#0d9488', personality = null) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.speed = 195; // px/s
    this.sprintSpeed = 290; // px/s while fetching or recalling

    this.owner = owner;
    this.coat = coat;
    this.collarColor = collarColor;
    this.radius = 14;
    this.depthY = this.y + 6;

    // Canine Personality Model (1-5 scale)
    this.personality = {
      playfulness: 3,
      shyness: 2,
      barkyness: 2,
      obedience: 4,
      ...(personality || {})
    };
    this.setPersonality(this.personality);

    // Leash pulling physics state
    this.isPullingLeash = false;

    this.state = (this.owner && !this.owner.isLeashed) ? DogState.ROAMING : DogState.FOLLOWING;
    this.stateTimer = 0;

    // Follow offset relative to owner (on-leash close heel follow between 35px and 45px)
    this.followDistance = 42;
    this.followAngleOffset = Math.PI * 0.75; // trots slightly behind and to the side

    // Ear spring physics (secondary damper system)
    this.leftEar = { angle: 0, vel: 0 };
    this.rightEar = { angle: 0, vel: 0 };
    this.springK = 180;
    this.springDamp = 14;

    // Tail wagging
    this.tailAngle = 0;
    this.wagSpeed = 8;
    this.wagAmp = 0.55;

    // Fetching state
    this.targetBall = null;
    this.hasBall = false;

    // Barking & Emotes
    this.isBarking = false;
    this.barkWaveRadius = 0;
    this.barkWaveAlpha = 0;
    this.emoteBubble = null;
    this.emoteTimer = 0;

    // Happiness / Heart particles
    this.happiness = 100;
    this.hearts = [];

    // Bounded Off-Leash Roaming state
    this.wanderAngle = 0;
    this.wanderTimer = 0;
    this.wanderSpeed = 135;
    this.isReturningToOwner = false;

    // Canine Social Interactions
    this.socialTargetDog = null;

    // Whistle Recall & Timed Heel state
    this.isRecalledToHeel = false;
    this.recallHeelTimer = 0;

    // Canine Idle Stray Run-Off Engine state
    this.ownerStillTimer = 0;
    this.strayCheckTimer = 0;
    this.isLost = false;
    this.lostTargetX = 0;
    this.lostTargetY = 0;

    // Dog Poop Event state
    this.poopTimer = 0;
    this.nextPoopTime = 150 + Math.random() * 90;
    this.poopSquatDuration = 0;

    // Event callbacks
    this.onStrayTriggered = null;
    this.onStrayResolved = null;
    this.onPoopDropped = null;
  }

  setPersonality(p) {
    if (!p || typeof p !== 'object') return;
    const clampTrait = (val, def) => {
      if (val === undefined || val === null) return def;
      const num = Number(val);
      if (isNaN(num)) return def;
      return Math.max(1, Math.min(5, Math.round(num)));
    };

    if (p.playfulness !== undefined) {
      this.personality.playfulness = clampTrait(p.playfulness, this.personality.playfulness || 3);
    }
    if (p.shyness !== undefined) {
      this.personality.shyness = clampTrait(p.shyness, this.personality.shyness || 2);
    }
    if (p.barkyness !== undefined) {
      this.personality.barkyness = clampTrait(p.barkyness, this.personality.barkyness || 2);
    }
    if (p.obedience !== undefined) {
      this.personality.obedience = clampTrait(p.obedience, this.personality.obedience || 4);
    }

    // Increases enthusiasm and speed during ball fetch sprint
    this.sprintSpeed = 260 + this.personality.playfulness * 15;
  }

  setChat(text, duration = 3.5) {
    this.emoteBubble = text;
    this.emoteTimer = duration;
  }

  setEmote(emote, duration = 2.5) {
    this.emoteBubble = emote;
    this.emoteTimer = duration;
  }

  onRemoteBark(sourceDog = null) {
    const respondChance = 0.18 * this.personality.barkyness;
    if (Math.random() < respondChance && !this.isBarking && this.state !== DogState.FETCHING) {
      this.bark();
    }
  }

  bark(audioEngine = null) {
    this.state = DogState.BARKING;
    this.stateTimer = 0.45;
    this.isBarking = true;
    this.barkWaveRadius = 6;
    this.barkWaveAlpha = 1.0;
    this.emoteBubble = 'Woof!';
    this.emoteTimer = 1.8;
    this.wagSpeed = 16;

    if (audioEngine && typeof audioEngine.playBark === 'function') {
      audioEngine.playBark();
    }
  }

  whistleRecall() {
    const wasLost = this.state === DogState.LOST || this.isLost;
    this.state = DogState.RECALLED;
    this.isLost = false;
    this.ownerStillTimer = 0;
    this.strayCheckTimer = 0;
    this.emoteBubble = wasLost ? '❤️' : '!';
    this.emoteTimer = wasLost ? 2.5 : 2.0;
    this.wagSpeed = 18;
    this.isRecalledToHeel = false;
    this.recallHeelTimer = 10.0; // 10 seconds of close heel following
    this.socialTargetDog = null;
    this.isReturningToOwner = false;
    this.isPullingLeash = false;
    if (this.hasBall && this.targetBall) {
      this.hasBall = false;
      this.targetBall.drop(this.x, this.y);
      this.targetBall = null;
    }

    if (wasLost && typeof this.onStrayResolved === 'function') {
      this.onStrayResolved(this);
    }

    // Whistle recall promptness: sprint speed immediately engages without delay
    if (this.owner) {
      const dx = this.owner.x - this.x;
      const dy = this.owner.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 10) {
        this.vx = (dx / dist) * this.sprintSpeed;
        this.vy = (dy / dist) * this.sprintSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
      }
    }
  }

  pet() {
    this.happiness = Math.min(100, this.happiness + 20);
    this.wagSpeed = 18;
    this.emoteBubble = '❤️';
    this.emoteTimer = 2.2;

    // Spawn floating heart particle
    for (let i = 0; i < 3; i++) {
      this.hearts.push({
        x: this.x + (Math.random() - 0.5) * 20,
        y: this.y - 10,
        vy: -35 - Math.random() * 25,
        alpha: 1.0,
        size: 10 + Math.random() * 4
      });
    }
  }

  fetchBall(ball) {
    // If leashed, lost, or pooping, the dog NEVER enters FETCHING state and does not chase balls
    if (this.owner && this.owner.isLeashed) {
      return;
    }
    if (this.state === DogState.LOST || this.state === DogState.POOPING) {
      return;
    }
    this.targetBall = ball;
    this.state = DogState.FETCHING;
    this.wagSpeed = 15;
  }

  update(dt, field, otherDogs = [], activeBall = null, npcs = []) {
    const isLeashed = Boolean(this.owner && this.owner.isLeashed);
    const nearbyNPCs = npcs || [];
    this.checkNPCInteractions(nearbyNPCs);

    // Idle Tracking & Whistle/Leash Reset
    if (this.owner && !isLeashed && this.state !== DogState.LOST) {
      const ownerVx = this.owner.vx || 0;
      const ownerVy = this.owner.vy || 0;
      const ownerSpeed = Math.hypot(ownerVx, ownerVy);
      if (ownerSpeed < 2) {
        this.ownerStillTimer += dt;
      } else {
        this.ownerStillTimer = 0;
        this.strayCheckTimer = 0;
      }

      // Obedience-Scaled Stray Run-Off Trigger
      if (this.ownerStillTimer > 35) {
        this.strayCheckTimer += dt;
        if (this.strayCheckTimer >= 5.0) {
          this.strayCheckTimer = 0;
          const ob = Math.max(1, Math.min(5, Math.round(this.personality.obedience || 4)));
          const probMap = { 1: 0.50, 2: 0.30, 3: 0.15, 4: 0.05, 5: 0.01 };
          const prob = probMap[ob] ?? 0.05;

          if (Math.random() < prob) {
            this.state = DogState.LOST;
            this.isLost = true;
            const rx = 250 + Math.random() * 2600;
            const ry = 250 + Math.random() * 1800;
            this.lostTargetX = rx;
            this.lostTargetY = ry;
            this.x = rx;
            this.y = ry;
            this.vx = 0;
            this.vy = 0;
            if (typeof this.onStrayTriggered === 'function') {
              this.onStrayTriggered(this);
            }
          }
        }
      }
    } else {
      this.ownerStillTimer = 0;
      this.strayCheckTimer = 0;
      if (isLeashed && (this.state === DogState.LOST || this.isLost)) {
        this.state = DogState.FOLLOWING;
        this.isLost = false;
        if (typeof this.onStrayResolved === 'function') {
          this.onStrayResolved(this);
        }
      }
    }

    // Walking time accumulation for Dog Poop Event
    const curSpeed = Math.hypot(this.vx, this.vy);
    if ((this.state === DogState.FOLLOWING || this.state === DogState.ROAMING) && curSpeed > 10) {
      this.poopTimer += dt;
      if (this.poopTimer >= this.nextPoopTime) {
        this.poopTimer = 0;
        this.nextPoopTime = 160 + Math.random() * 80;
        this.state = DogState.POOPING;
        this.poopSquatDuration = 2.0;
        this.vx = 0;
        this.vy = 0;
      }
    }

    // 1. Check ball status & enforce strict prohibition of ball chasing on-leash / while lost / while pooping
    if (isLeashed) {
      if (this.state === DogState.FETCHING) {
        this.state = DogState.FOLLOWING;
        this.targetBall = null;
        this.hasBall = false;
      }
      if (activeBall && activeBall.isThrown) {
        // Turns head eagerly toward ball position
        this.angle = Math.atan2(activeBall.y - this.y, activeBall.x - this.x);
        // Wags tail actively if playful
        this.wagSpeed = 10 + this.personality.playfulness * 2;
        // Pulls against leash toward the ball direction
        this.isPullingLeash = true;
      }
    } else {
      if (activeBall && (activeBall.isThrown || (this.state === DogState.FETCHING && !this.hasBall))) {
        if (this.state !== DogState.LOST && this.state !== DogState.POOPING) {
          this.targetBall = activeBall;
          this.state = DogState.FETCHING;
        }
      }
    }

    // Sensitivity to remote bark triggers: higher barkyness responds more promptly
    if (otherDogs && Array.isArray(otherDogs) && !this.isBarking && this.state !== DogState.FETCHING && this.state !== DogState.POOPING) {
      for (const other of otherDogs) {
        if (other && other !== this && other.isBarking) {
          const dist = Math.hypot(this.x - other.x, this.y - other.y);
          if (dist < 260 && Math.random() < (0.008 * this.personality.barkyness)) {
            this.bark();
            break;
          }
        }
      }
    }

    // 2. State Machine & Steering Behaviors
    switch (this.state) {
      case DogState.LOST:
        this.updateLost(dt);
        break;

      case DogState.POOPING:
        this.updatePooping(dt, field);
        break;

      case DogState.FETCHING:
        this.updateFetching(dt);
        break;

      case DogState.RECALLED:
        this.updateRecalled(dt);
        break;

      case DogState.SOCIAL_GREET:
        this.updateSocialGreet(dt);
        break;

      case DogState.ROAMING:
        this.updateRoaming(dt, otherDogs);
        break;

      case DogState.PLAY_BOW:
        this.updatePlayBow(dt);
        break;

      case DogState.IDLE_SNIFF:
        this.updateSniff(dt);
        break;

      case DogState.SITTING:
        this.updateSitting(dt);
        break;

      case DogState.BARKING:
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
          this.isBarking = false;
        }
        break;

      case DogState.FOLLOWING:
      default:
        this.updateFollowing(dt, otherDogs);
        break;
    }

    // When on-leash and an active ball is thrown, pull toward the ball direction against leash
    if (isLeashed && activeBall && activeBall.isThrown) {
      this.angle = Math.atan2(activeBall.y - this.y, activeBall.x - this.x);
      const pullSpeed = 50 + this.personality.playfulness * 12;
      this.vx = Math.cos(this.angle) * pullSpeed;
      this.vy = Math.sin(this.angle) * pullSpeed;
      this.wagSpeed = 10 + this.personality.playfulness * 2;
      this.isPullingLeash = true;
    }

    // 3. Movement integration
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Leash constraint & pulling physics: If leashed to owner, hard clamp to max leash length
    if (this.owner && this.owner.isLeashed && this.state !== DogState.FETCHING) {
      const maxLeash = 105;
      const dx = this.x - this.owner.x;
      const dy = this.y - this.owner.y;
      const dist = Math.hypot(dx, dy);

      // Leash pulling physics
      if (activeBall && activeBall.isThrown) {
        this.isPullingLeash = true;
      } else if (dist > 95) {
        const dotAway = dx * this.vx + dy * this.vy;
        if (dotAway > 0 || dist >= maxLeash) {
          // High obedience reduces propensity to pull against leash
          if (this.personality.obedience < 4 || dist >= 100) {
            this.isPullingLeash = true;
          }
        }
      } else if (dist < 48 || (!this.owner.isMoving && Math.hypot(this.vx, this.vy) < 12)) {
        // Dog is at heel or owner stopped and dog is resting
        this.isPullingLeash = false;
      }

      if (dist > maxLeash) {
        this.x = this.owner.x + (dx / dist) * maxLeash;
        this.y = this.owner.y + (dy / dist) * maxLeash;
        this.vx *= 0.5;
        this.vy *= 0.5;
        this.isPullingLeash = true;
      }
    } else if (this.owner && !this.owner.isLeashed && this.state !== DogState.LOST) {
      this.isPullingLeash = false;
      // Off-leash bounded perimeter constraint: hard clamp to 230px so dog never strays out of sight
      const maxRoam = 230;
      const dx = this.x - this.owner.x;
      const dy = this.y - this.owner.y;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRoam) {
        this.x = this.owner.x + (dx / dist) * maxRoam;
        this.y = this.owner.y + (dy / dist) * maxRoam;
      }
    }

    // Obstacle and world boundary collisions
    if (field) {
      const resolved = field.resolveCircleCollision(this.x, this.y, this.radius);
      this.x = resolved.x;
      this.y = resolved.y;
    }

    this.depthY = this.y + 6;

    // 4. Ear Secondary Spring Physics responding to trot speed inertia
    const speedMag = Math.hypot(this.vx, this.vy);
    const trotBob = speedMag > 10 ? Math.sin(Date.now() * 0.014) * 0.12 : 0;
    const lateralLag = -Math.sin(this.angle) * this.vx * 0.0025 + Math.cos(this.angle) * this.vy * 0.0025;
    const speedLag = -speedMag * 0.0007;
    const targetLeftEar = speedLag - trotBob + lateralLag;
    const targetRightEar = speedLag + trotBob - lateralLag;

    // Left ear spring
    const leftForce = -this.springK * (this.leftEar.angle - targetLeftEar) - this.springDamp * this.leftEar.vel;
    this.leftEar.vel += leftForce * dt;
    this.leftEar.angle += this.leftEar.vel * dt;

    // Right ear spring
    const rightForce = -this.springK * (this.rightEar.angle - targetRightEar) - this.springDamp * this.rightEar.vel;
    this.rightEar.vel += rightForce * dt;
    this.rightEar.angle += this.rightEar.vel * dt;

    // 5. Tail Wagging - scales wag frequency proportional to playfulness
    const movingWag = Math.hypot(this.vx, this.vy) > 10 ? 1.5 : 1.0;
    const playfulnessMultiplier = 0.6 + this.personality.playfulness * 0.15;
    this.tailAngle = Math.sin(Date.now() * 0.001 * this.wagSpeed * movingWag * playfulnessMultiplier) * this.wagAmp;

    // 6. Bark Wave Animation
    if (this.isBarking) {
      this.barkWaveRadius += 160 * dt;
      this.barkWaveAlpha = Math.max(0, 1.0 - this.barkWaveRadius / 60);
      if (this.barkWaveAlpha <= 0) this.isBarking = false;
    }

    // 7. Emote Timers & Particles
    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) this.emoteBubble = null;
    }

    // Update hearts
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.y += h.vy * dt;
      h.alpha -= dt * 0.7;
      if (h.alpha <= 0) this.hearts.splice(i, 1);
    }
  }

  checkNPCInteractions(npcs) {
    if (!npcs || !Array.isArray(npcs) || npcs.length === 0) return;

    for (const npc of npcs) {
      if (!npc) continue;
      const dist = Math.hypot(this.x - npc.x, this.y - npc.y);
      if (dist >= 80) continue;

      // 1. Barkyness roll (Joggers)
      if ((npc.isJogger || npc.type === 'jogger') && this.personality.barkyness >= 3) {
        if (!this.isBarking && this.state !== DogState.FETCHING && Math.random() < (0.015 * (this.personality.barkyness - 2))) {
          this.bark();
        }
      }

      // 2. Shyness roll (Berth avoidance)
      if (this.personality.shyness >= 3) {
        if (dist < 75 && dist > 0.001) {
          const shyForce = (1.0 - dist / 75) * (this.speed * 0.45) * ((this.personality.shyness - 2) / 3);
          this.vx += ((this.x - npc.x) / dist) * shyForce;
          this.vy += ((this.y - npc.y) / dist) * shyForce;
        }
      }

      // 3. Playfulness roll (Wag / Bow)
      if (this.personality.playfulness >= 4) {
        this.wagSpeed = Math.max(this.wagSpeed, 14 + this.personality.playfulness * 2);
        if (!this.owner?.isLeashed && this.state === DogState.ROAMING && dist < 50 && Math.random() < 0.008) {
          this.state = DogState.PLAY_BOW;
          this.stateTimer = 1.8;
          this.emoteBubble = '🐾';
          this.emoteTimer = 1.8;
        }
      }
    }
  }

  updateLost(dt) {
    this.vx = 0;
    this.vy = 0;
    this.wagSpeed = 4;

    // Retrieval check
    if (this.owner) {
      const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
      if (distToOwner < 55) {
        this.state = DogState.RECALLED;
        this.isLost = false;
        this.ownerStillTimer = 0;
        this.strayCheckTimer = 0;
        this.emoteBubble = '❤️';
        this.emoteTimer = 2.5;
        this.wagSpeed = 18;
        if (typeof this.onStrayResolved === 'function') {
          this.onStrayResolved(this);
        }
      }
    }
  }

  updatePooping(dt, field) {
    this.vx = 0;
    this.vy = 0;
    this.wagSpeed = 3;
    this.poopSquatDuration -= dt;

    if (this.poopSquatDuration <= 0) {
      const pile = new PoopPile(null, this.x, this.y);
      if (field && typeof field.addPoopPile === 'function') {
        field.addPoopPile(pile);
      }
      if (typeof this.onPoopDropped === 'function') {
        this.onPoopDropped(this, pile);
      }
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }
  checkSocialInteractions(otherDogs) {
    if (!otherDogs || !Array.isArray(otherDogs)) return false;
    if (this.state === DogState.FETCHING || this.state === DogState.RECALLED || this.state === DogState.LOST || this.state === DogState.POOPING) return false;

    // Approach probability modified by shyness: low shyness dogs approach eagerly, high shyness approach with lower probability
    const approachProb = Math.max(0.008, 0.045 - (this.personality.shyness - 1) * 0.009);

    for (const other of otherDogs) {
      if (other && other !== this && other.state !== DogState.FETCHING && this.state !== DogState.FETCHING) {
        const dogDist = Math.hypot(this.x - other.x, this.y - other.y);
        if (dogDist < 110 && this.state !== DogState.SOCIAL_GREET && this.state !== DogState.PLAY_BOW && Math.random() < approachProb) {
          // Playfulness modifies chance to open directly with a play bow
          const playBowDirectChance = (this.personality.playfulness - 1) * 0.05;
          if (Math.random() < playBowDirectChance) {
            this.state = DogState.PLAY_BOW;
            this.stateTimer = 2.4;
            this.wagSpeed = 14 + this.personality.playfulness * 2;
            this.emoteBubble = '🐾';
            this.emoteTimer = 2.0;
          } else {
            this.state = DogState.SOCIAL_GREET;
            this.stateTimer = 3.0;
            this.wagSpeed = 12 + this.personality.playfulness * 2;
            this.emoteBubble = Math.random() < 0.5 ? '🐾' : (Math.random() < 0.5 ? '🐶' : '❤️');
            this.emoteTimer = 2.5;
          }
          this.socialTargetDog = other;
          return true;
        }
      }
    }
    return false;
  }

  updateFollowing(dt, otherDogs = []) {
    if (!this.owner) return;

    if (!this.owner.isLeashed) {
      this.state = DogState.ROAMING;
      this.updateRoaming(dt, otherDogs);
      return;
    }

    this.followDistance = 42;

    if (this.checkSocialInteractions(otherDogs)) {
      return;
    }

    // Desired position: slightly offset from owner
    const targetX = this.owner.x + Math.cos(this.owner.angle + this.followAngleOffset) * this.followDistance;
    const targetY = this.owner.y + Math.sin(this.owner.angle + this.followAngleOffset) * this.followDistance;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);

    // If owner stopped for a while, transition to idle sniff or sit
    // High obedience dogs stay attentive at heel longer with smaller stray chance
    const idleTransitionChance = Math.max(0.001, 0.009 - this.personality.obedience * 0.0015);
    if (!this.owner.isMoving && dist < 25) {
      this.vx *= 0.8;
      this.vy *= 0.8;
      this.wagSpeed = 6;
      if (Math.random() < idleTransitionChance) {
        this.state = Math.random() < 0.5 ? DogState.IDLE_SNIFF : DogState.SITTING;
        this.stateTimer = 2.0 + Math.random() * 3.0;
      }
      return;
    }

    // Arrival steering calculation matching owner's pace
    const slowingRadius = 40;
    let targetSpeed = this.speed;
    if (dist < slowingRadius) {
      targetSpeed = this.speed * (dist / slowingRadius);
    }

    // Higher obedience adheres strictly to heel follow offset with smaller arrival deadband
    const arrivalDeadband = Math.max(3, 11 - this.personality.obedience * 1.5);
    if (dist > arrivalDeadband) {
      this.vx = (dx / dist) * targetSpeed;
      this.vy = (dy / dist) * targetSpeed;
      this.angle = Math.atan2(this.vy, this.vx);
      this.wagSpeed = 10;
    } else {
      this.vx = 0;
      this.vy = 0;
      this.wagSpeed = 6;
    }
  }

  updateRoaming(dt, otherDogs = []) {
    if (!this.owner) return;

    if (this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
      this.followDistance = 42;
      return;
    }

    if (this.checkSocialInteractions(otherDogs)) {
      return;
    }

    const fromOwnerX = this.x - this.owner.x;
    const fromOwnerY = this.y - this.owner.y;
    let distToOwner = Math.hypot(fromOwnerX, fromOwnerY);

    // Hard boundary clamp: if distToOwner > 230, clamp position along the vector to owner
    if (distToOwner > 230) {
      this.x = this.owner.x + (fromOwnerX / distToOwner) * 230;
      this.y = this.owner.y + (fromOwnerY / distToOwner) * 230;
      distToOwner = 230;
    }

    // If distToOwner > 200: steer directly back toward the owner at normal trot speed until within 120px
    if (distToOwner > 200) {
      this.isReturningToOwner = true;
    }

    if (this.isReturningToOwner) {
      if (distToOwner <= 120) {
        this.isReturningToOwner = false;
      } else {
        const toOwnerX = this.owner.x - this.x;
        const toOwnerY = this.owner.y - this.y;
        const dirDist = Math.hypot(toOwnerX, toOwnerY) || 1;
        const trotSpeed = this.speed;
        this.vx = (toOwnerX / dirDist) * trotSpeed;
        this.vy = (toOwnerY / dirDist) * trotSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 10;
        return;
      }
    }

    // Maintain exploratory wander target
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 2.0 + Math.random() * 2.0;

      // Periodically pauses for 2-3s to sniff a spot (IDLE_SNIFF)
      if (Math.random() < 0.25) {
        this.state = DogState.IDLE_SNIFF;
        this.stateTimer = 2.0 + Math.random() * 1.0;
        this.vx = 0;
        this.vy = 0;
        return;
      }

      // Trotting ahead or to the sides of walking path
      if (this.owner.isMoving) {
        const spread = (Math.random() - 0.5) * (Math.PI * 0.75);
        this.wanderAngle = this.owner.angle + spread;
      } else {
        this.wanderAngle = Math.random() * Math.PI * 2;
      }
      this.wanderSpeed = this.speed * (0.65 + Math.random() * 0.25);
    }

    let wanderVx = Math.cos(this.wanderAngle) * this.wanderSpeed;
    let wanderVy = Math.sin(this.wanderAngle) * this.wanderSpeed;

    // If distToOwner > 150: bias wander velocity back towards the owner
    if (distToOwner > 150) {
      const bias = Math.min(1.0, (distToOwner - 150) / 50); // 0 at 150, 1 at 200
      const toOwnerX = (this.owner.x - this.x) / (distToOwner || 1);
      const toOwnerY = (this.owner.y - this.y) / (distToOwner || 1);
      this.vx = wanderVx * (1.0 - bias) + toOwnerX * this.wanderSpeed * bias;
      this.vy = wanderVy * (1.0 - bias) + toOwnerY * this.wanderSpeed * bias;
    } else {
      if (!this.owner.isMoving && distToOwner < 40) {
        this.vx = wanderVx * 0.3;
        this.vy = wanderVy * 0.3;
      } else {
        this.vx = wanderVx;
        this.vy = wanderVy;
      }
    }

    if (Math.hypot(this.vx, this.vy) > 8) {
      this.angle = Math.atan2(this.vy, this.vx);
      this.wagSpeed = 9;
    } else {
      this.wagSpeed = 6;
    }

    // Spontaneous barking influenced by barkyness
    if (Math.random() < (this.personality.barkyness * 0.0006) && !this.isBarking) {
      this.bark();
    }
  }

  updateSocialGreet(dt) {
    if (!this.socialTargetDog || this.socialTargetDog.state === DogState.FETCHING) {
      this.socialTargetDog = null;
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      return;
    }

    if (this.owner && this.owner.isLeashed) {
      const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
      if (distToOwner > 95) {
        this.socialTargetDog = null;
        this.state = DogState.FOLLOWING;
        return;
      }
    }

    const dx = this.socialTargetDog.x - this.x;
    const dy = this.socialTargetDog.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 160) {
      this.socialTargetDog = null;
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      return;
    }

    // Shyness modifies social berth: low shyness dogs approach to ~28px, high shyness dogs keep a wider berth (~45px)
    const minBerth = 24 + this.personality.shyness * 4.2;
    const maxBerth = minBerth + 8;

    if (dist > maxBerth) {
      const approachSpeed = this.speed * 0.75;
      this.vx = (dx / dist) * approachSpeed;
      this.vy = (dy / dist) * approachSpeed;
      this.angle = Math.atan2(this.vy, this.vx);
    } else if (dist < minBerth) {
      const backSpeed = this.speed * 0.25;
      this.vx = -(dx / (dist || 1)) * backSpeed;
      this.vy = -(dy / (dist || 1)) * backSpeed;
      this.angle = Math.atan2(dy, dx);
    } else {
      const tangentX = -dy / dist;
      const tangentY = dx / dist;
      const circleSpeed = 30;
      this.vx = tangentX * circleSpeed;
      this.vy = tangentY * circleSpeed;
      this.angle = Math.atan2(dy, dx);
    }

    this.wagSpeed = 12 + this.personality.playfulness * 2;
    this.stateTimer -= dt;

    if (this.stateTimer <= 0) {
      this.socialTargetDog = null;
      // Playfulness modifies play-bow transition chance
      const playBowChance = 0.15 + (this.personality.playfulness / 5) * 0.45;
      if (Math.random() < playBowChance) {
        this.state = DogState.PLAY_BOW;
        this.stateTimer = 2.2;
        this.emoteBubble = '🐾';
        this.emoteTimer = 2.0;
        this.wagSpeed = 14 + this.personality.playfulness * 2;
      } else {
        this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      }
    }
  }

  updateRecalled(dt) {
    if (!this.owner) {
      this.state = DogState.ROAMING;
      return;
    }

    if (!this.isRecalledToHeel) {
      // Sprints back directly to owner
      const dx = this.owner.x - this.x;
      const dy = this.owner.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 40) {
        this.isRecalledToHeel = true;
        this.emoteBubble = '🐾';
        this.emoteTimer = 1.5;
        this.vx = 0;
        this.vy = 0;
      } else {
        const targetSpeed = this.sprintSpeed;
        this.vx = (dx / dist) * targetSpeed;
        this.vy = (dy / dist) * targetSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 18;
      }
    }

    if (this.isRecalledToHeel) {
      // Executes tight close heel following (followDistance = 35)
      this.followDistance = 35;
      const targetX = this.owner.x + Math.cos(this.owner.angle + this.followAngleOffset) * this.followDistance;
      const targetY = this.owner.y + Math.sin(this.owner.angle + this.followAngleOffset) * this.followDistance;

      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const dist = Math.hypot(dx, dy);

      const slowingRadius = 35;
      let targetSpeed = this.speed;
      if (dist < slowingRadius) {
        targetSpeed = this.speed * (dist / slowingRadius);
      }

      if (dist > 6) {
        this.vx = (dx / dist) * targetSpeed;
        this.vy = (dy / dist) * targetSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 12;
      } else {
        this.vx = 0;
        this.vy = 0;
        this.wagSpeed = 8;
      }

      this.recallHeelTimer -= dt;
      if (this.recallHeelTimer <= 0) {
        this.isRecalledToHeel = false;
        this.followDistance = 42;
        this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      }
    }
  }

  updateFetching(dt) {
    if (!this.targetBall) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
      return;
    }

    if (!this.hasBall) {
      // Sprint toward ball
      const dx = this.targetBall.x - this.x;
      const dy = this.targetBall.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 14) {
        this.vx = (dx / dist) * this.sprintSpeed;
        this.vy = (dy / dist) * this.sprintSpeed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 16;
      } else {
        // Grab the ball!
        this.hasBall = true;
        this.targetBall.attachToDog(this);
        this.emoteBubble = '🎾';
        this.emoteTimer = 2.0;
      }
    } else {
      // Return ball to owner
      if (!this.owner) {
        this.hasBall = false;
        this.targetBall.drop(this.x, this.y);
        this.targetBall = null;
        this.state = DogState.ROAMING;
        return;
      }

      const dx = this.owner.x - this.x;
      const dy = this.owner.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 36) {
        this.vx = (dx / dist) * this.speed;
        this.vy = (dy / dist) * this.speed;
        this.angle = Math.atan2(this.vy, this.vx);
        this.wagSpeed = 14;
      } else {
        // Drop ball at owner's feet
        this.hasBall = false;
        this.targetBall.drop(this.x + Math.cos(this.angle) * 14, this.y + Math.sin(this.angle) * 14);
        this.targetBall = null;
        this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
        this.pet(); // reward with happiness!
      }
    }
  }

  updatePlayBow(dt) {
    this.vx *= 0.5;
    this.vy *= 0.5;
    this.stateTimer -= dt;
    this.wagSpeed = 14 + this.personality.playfulness * 2;
    if (this.stateTimer <= 0) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }

  updateSniff(dt) {
    this.vx *= 0.4;
    this.vy *= 0.4;
    this.stateTimer -= dt;
    this.wagSpeed = 4;
    // Spontaneous barking influenced by barkyness
    if (Math.random() < (this.personality.barkyness * 0.001) && !this.isBarking) {
      this.bark();
    }
    if (this.owner && this.owner.isMoving && this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
    } else if (this.owner && !this.owner.isLeashed && Math.hypot(this.x - this.owner.x, this.y - this.owner.y) > 150) {
      this.state = DogState.ROAMING;
    } else if (this.stateTimer <= 0) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }

  updateSitting(dt) {
    this.vx = 0;
    this.vy = 0;
    this.stateTimer -= dt;
    this.wagSpeed = 4;
    // Spontaneous barking influenced by barkyness
    if (Math.random() < (this.personality.barkyness * 0.001) && !this.isBarking) {
      this.bark();
    }
    if (this.owner && this.owner.isMoving && this.owner.isLeashed) {
      this.state = DogState.FOLLOWING;
    } else if (this.owner && !this.owner.isLeashed && Math.hypot(this.x - this.owner.x, this.y - this.owner.y) > 150) {
      this.state = DogState.ROAMING;
    } else if (this.stateTimer <= 0) {
      this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
    }
  }

  draw(ctx) {
    ctx.save();

    // 1. Draw Leash if leashed to owner
    if (this.owner && this.owner.isLeashed && this.state !== DogState.FETCHING) {
      this.drawLeash(ctx);
    }

    // 2. Soft ground shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 7, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Bark Shockwave ring
    if (this.isBarking && this.barkWaveAlpha > 0) {
      ctx.strokeStyle = `rgba(243, 201, 72, ${this.barkWaveAlpha * 0.8})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.barkWaveRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Oriented Canine Body
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Play-bow or squat posture squash/stretch
    if (this.state === DogState.PLAY_BOW) {
      ctx.scale(1.1, 0.85);
    } else if (this.state === DogState.POOPING) {
      ctx.scale(0.88, 1.12);
      ctx.translate(-2, 0);
    }

    // Paws (front and back)
    const legOffset = Math.sin(Date.now() * 0.012) * (Math.hypot(this.vx, this.vy) > 10 ? 3 : 0);
    const pawColor = this.coat.hasEyePatch ? '#f1f5f9' : (this.coat.tanColor || this.coat.bodyColor);
    ctx.fillStyle = pawColor;
    ctx.fillRect(-10, -9 - legOffset, 5, 4);
    ctx.fillRect(-10, 5 + legOffset, 5, 4);
    ctx.fillRect(8, -9 + legOffset, 5, 4);
    ctx.fillRect(8, 5 - legOffset, 5, 4);

    // Feathered Wagging Tail matching breed coat colors with tufted brush tip
    ctx.save();
    ctx.translate(-14, 0);
    ctx.rotate(this.tailAngle);
    // Base tail shaft
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-5, 0, 7.5, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tufted feathered brush tip matching breed highlight/tan
    const brushColor = this.coat.tanHighlight || this.coat.tanColor || this.coat.earHighlight || this.coat.bodyColor;
    ctx.fillStyle = brushColor;
    ctx.beginPath();
    ctx.ellipse(-9.5, 0, 4.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-13, 0, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Torso (rich coat)
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 13, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Subtle coat dorsal sheen
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.ellipse(-2, -2, 10, 4.5, -0.05, 0, Math.PI * 2);
    ctx.fill();

    // Creamy white chest bib
    ctx.fillStyle = this.coat.bibColor || '#f4efe6';
    ctx.beginPath();
    ctx.ellipse(5, 0, 4.2, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Collar band rendered using this.collarColor with a metallic gold charm tag
    const collar = this.collarColor || '#0d9488';
    ctx.fillStyle = collar;
    ctx.beginPath();
    ctx.roundRect(5.5, -6.5, 3.0, 13, 1.5);
    ctx.fill();

    // Metallic gold charm tag
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(8.5, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // Metallic gold gleam / catchlight
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(8.0, -0.6, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(11, 0, 7.8, 6.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Signature tan eye patch for Jack Russell Terrier
    if (this.coat.hasEyePatch) {
      ctx.fillStyle = this.coat.tanColor;
      ctx.beginPath();
      ctx.ellipse(12, -3.2, 3.8, 3.2, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tan Muzzle & Snout
    ctx.fillStyle = this.coat.tanColor;
    ctx.beginPath();
    ctx.ellipse(16, 0, 4.8, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Snout highlighting
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(15.5, -1.0, 2.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Whisker dots
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(15.2, -2.0, 0.5, 0, Math.PI * 2);
    ctx.arc(16.5, -1.8, 0.5, 0, Math.PI * 2);
    ctx.arc(15.8, -1.0, 0.5, 0, Math.PI * 2);
    ctx.arc(15.2, 2.0, 0.5, 0, Math.PI * 2);
    ctx.arc(16.5, 1.8, 0.5, 0, Math.PI * 2);
    ctx.arc(15.8, 1.0, 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Truffle Nose
    ctx.fillStyle = this.coat.noseColor || '#1e293b';
    ctx.beginPath();
    ctx.ellipse(19.2, 0, 1.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose specular shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(18.8, -0.6, 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Expressive Eyes with amber iris, dark pupils, and specular catchlights
    ctx.fillStyle = '#261b12';
    ctx.beginPath();
    ctx.arc(12, -3.2, 1.6, 0, Math.PI * 2);
    ctx.arc(12, 3.2, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#c6933a';
    ctx.beginPath();
    ctx.arc(12.1, -3.2, 1.2, 0, Math.PI * 2);
    ctx.arc(12.1, 3.2, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(12.2, -3.2, 0.8, 0, Math.PI * 2);
    ctx.arc(12.2, 3.2, 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(11.7, -3.6, 0.55, 0, Math.PI * 2);
    ctx.arc(11.7, 2.8, 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Eyebrow pips (for Cocker Spaniel, Black Lab, Red Setter)
    if (this.coat.tanHighlight && !this.coat.hasEyePatch) {
      ctx.fillStyle = this.coat.tanHighlight;
      ctx.beginPath();
      ctx.arc(10.5, -3.5, 1.1, 0, Math.PI * 2);
      ctx.arc(10.5, 3.5, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Floppy Ears (with spring rotation responding to trot speed inertia)
    // Left ear
    ctx.save();
    ctx.translate(9, -6);
    ctx.rotate(this.leftEar.angle);
    ctx.fillStyle = this.coat.earRoot || this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-1, -4, 4.6, 8.2, -Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.coat.earHighlight || this.coat.tanHighlight || this.coat.tanColor;
    ctx.beginPath();
    ctx.ellipse(-1, -5.5, 3.2, 5.5, -Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Right ear
    ctx.save();
    ctx.translate(9, 6);
    ctx.rotate(this.rightEar.angle);
    ctx.fillStyle = this.coat.earRoot || this.coat.bodyColor;
    ctx.beginPath();
    ctx.ellipse(-1, 4, 4.6, 8.2, Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.coat.earHighlight || this.coat.tanHighlight || this.coat.tanColor;
    ctx.beginPath();
    ctx.ellipse(-1, 5.5, 3.2, 5.5, Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore(); // Restore orientation transform

    // 5. Floating Hearts
    for (const h of this.hearts) {
      ctx.save();
      ctx.globalAlpha = h.alpha;
      ctx.font = `${Math.round(h.size)}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('❤️', h.x, h.y);
      ctx.restore();
    }

    // 6. Emote Bubble
    if (this.emoteBubble) {
      this.drawEmote(ctx, this.emoteBubble);
    }
  }

  drawLeash(ctx) {
    ctx.save();
    // Hand anchor point on owner
    const handX = this.owner.x + Math.cos(this.owner.angle + Math.PI / 2) * 11;
    const handY = this.owner.y + Math.sin(this.owner.angle + Math.PI / 2) * 11;

    // Collar anchor point on dog
    const collarX = this.x;
    const collarY = this.y - 2;

    const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);

    if (this.isPullingLeash || distToOwner > 98) {
      // Taut, tensioned straight line from hand anchor to collar anchor with subtle vibrational jitter
      const jitter = Math.sin(Date.now() * 0.05) * 0.8;
      ctx.strokeStyle = '#991b1b'; // Classic crimson red nylon lead
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(handX, handY);
      ctx.lineTo(collarX + jitter, collarY + jitter);
      ctx.stroke();
    } else {
      // Slack catenary sag quadratic curve
      const midX = (handX + collarX) / 2;
      const midY = (handY + collarY) / 2 + 14;

      ctx.strokeStyle = '#991b1b'; // Classic crimson red nylon lead
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(handX, handY);
      ctx.quadraticCurveTo(midX, midY, collarX, collarY);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawEmote(ctx, emote) {
    ctx.save();
    const bx = this.x - 14;
    const by = this.y - 38;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(bx, by, 28, 22, 6);
    ctx.fill();

    // Pointer
    ctx.beginPath();
    ctx.moveTo(this.x - 3, by + 22);
    ctx.lineTo(this.x, by + 26);
    ctx.lineTo(this.x + 3, by + 22);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.font = emote.length > 2 ? 'bold 10px Outfit, sans-serif' : '14px serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(emote, this.x, by + 15);
    ctx.restore();
  }
}

```

## FILE: ./src/entities/hazards.js

```typescript
// Park Hazards, Critters, and Dog Park Gate Goal
import { AABB } from '../engine/physics.js';

export class Squirrel {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 24;
    this.height = 20;
    this.facing = -1;
    this.isStartled = false;
    this.startleTimer = 0;
    this.chatterTimer = 0;
  }

  get aabb() {
    return new AABB(this.x, this.y, this.width, this.height);
  }

  update(dt, barkWaves = []) {
    this.chatterTimer += dt * 8;

    // Check if startled by a bark wave!
    if (!this.isStartled) {
      for (const bw of barkWaves) {
        const dist = Math.hypot(bw.x - (this.x + 12), bw.y - (this.y + 10));
        if (dist <= bw.radius + 15) {
          this.isStartled = true;
          this.startleTimer = 0;
          break;
        }
      }
    } else {
      this.startleTimer += dt;
      // Flee upwards/away
      this.y -= 140 * dt;
      this.x += this.facing * 110 * dt;
    }
  }

  draw(ctx) {
    if (this.startleTimer > 1.5) return; // Disappeared off-screen

    ctx.save();
    ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
    if (this.facing < 0) ctx.scale(-1, 1);

    const tailBob = Math.sin(this.chatterTimer) * 2;

    // Bushy squirrel tail
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.ellipse(-8, -4 + tailBob, 7, 10, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.ellipse(0, 2, 7, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.arc(6, -2, 5, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(7, -3, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Acorn
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.arc(6, 4, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

export class MudPuddle {
  constructor(x, y, width = 64) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = 10;
  }

  get aabb() {
    return new AABB(this.x, this.y, this.width, this.height);
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = '#543d2b';
    ctx.beginPath();
    ctx.ellipse(this.x + this.width / 2, this.y + 4, this.width / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class GoalGate {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 60;
    this.height = 90;
    this.isCleared = false;
  }

  get aabb() {
    return new AABB(this.x + 10, this.y, 40, this.height);
  }

  draw(ctx) {
    ctx.save();
    // Wooden Dog Park Posts
    ctx.fillStyle = '#78350f';
    ctx.fillRect(this.x, this.y, 10, this.height);
    ctx.fillRect(this.x + 50, this.y, 10, this.height);

    // Archway Header
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.roundRect(this.x - 4, this.y - 14, 68, 16, 4);
    ctx.fill();

    // Sign text
    ctx.fillStyle = '#f3c948';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DOG PARK', this.x + 30, this.y - 3);

    // Bone Ornament
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(this.x + 22, this.y - 24, 16, 6, 2);
    ctx.fill();

    // Swinging picket gate doors
    ctx.fillStyle = '#d97706';
    ctx.fillRect(this.x + 10, this.y + 30, 20, 45);
    ctx.fillRect(this.x + 30, this.y + 30, 20, 45);

    ctx.restore();
  }
}

```

## FILE: ./src/entities/npc.js

```typescript
// Ambient Park NPC Entities (Walkers & Joggers) for The Downs
// Implements deterministic polyline traversal, finite lifecycle fading, italic nametags, and seeded speech timelines

import {
  mulberry32,
  NPC_SPEED,
  NPC_TAG_STYLE,
  npcIdentityFromSeed,
  pickPhrase,
  nextSpeechDelay,
  COMMON_PHRASES,
  ODD_PHRASES
} from './npc_content.js';
import { getNpcPath, NPC_PATHS } from '../world/npc_paths.js';

export const NPCState = {
  WALKING: 'WALKING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED'
};

export class ParkNPC {
  constructor(x = {}, y = 0, options = {}) {
    let opts = {};
    let isLegacy = false;
    let legacyX = 0;
    let legacyY = 0;

    if (typeof x === 'object' && x !== null) {
      opts = x;
    } else if (typeof x === 'number') {
      isLegacy = true;
      legacyX = x;
      legacyY = typeof y === 'number' ? y : 0;
      opts = (typeof options === 'object' && options !== null) ? options : {};
    } else {
      opts = {};
    }

    this.id = opts.id !== undefined && opts.id !== null ? String(opts.id) : ('npc-' + Math.floor(Math.random() * 1000000));
    const rawType = opts.type || (opts.isJogger ? 'jogger' : 'walker');
    this.type = (String(rawType).toLowerCase() === 'jogger') ? 'jogger' : 'walker';
    this.isJogger = this.type === 'jogger';
    this.seed = opts.seed !== undefined ? (Math.floor(Number(opts.seed)) || 0) : 0;
    this.spawnTime = opts.spawnTime !== undefined ? Number(opts.spawnTime) : 0;
    this.speed = opts.speed !== undefined
      ? Number(opts.speed)
      : (NPC_SPEED[this.type] || NPC_SPEED.walker);
    this.radius = opts.radius !== undefined ? opts.radius : 14;

    // Appearance from seed & type
    const identity = npcIdentityFromSeed(this.seed, this.type);
    this.name = opts.name !== undefined ? opts.name : identity.name;
    this.skinTone = opts.skinTone !== undefined ? opts.skinTone : identity.skinTone;
    this.hairColor = opts.hairColor !== undefined ? opts.hairColor : identity.hairColor;
    this.hairStyle = opts.hairStyle !== undefined ? opts.hairStyle : identity.hairStyle;
    this.hatColor = opts.hatColor !== undefined ? opts.hatColor : identity.hatColor;
    this.jacketColor = opts.jacketColor !== undefined ? opts.jacketColor : identity.jacketColor;
    this.pantsColor = opts.pantsColor !== undefined ? opts.pantsColor : identity.pantsColor;
    this.shoeColor = opts.shoeColor !== undefined ? opts.shoeColor : identity.shoeColor;

    // Path & Waypoints
    const path = opts.path || (opts.pathId ? getNpcPath(opts.pathId) : null);
    this.path = path;
    this.pathId = opts.pathId || (path ? path.id : null);
    if (path && Array.isArray(path.waypoints) && path.waypoints.length > 0) {
      this.waypoints = path.waypoints;
    } else if (Array.isArray(opts.waypoints) && opts.waypoints.length > 0) {
      this.waypoints = opts.waypoints;
    } else if (isLegacy) {
      this.waypoints = [{ x: legacyX, y: legacyY }];
    } else {
      this.waypoints = [];
    }

    // Precompute segment lengths and total Euclidean length
    this.segmentLengths = [];
    this.totalLength = 0;
    if (this.waypoints.length >= 2) {
      for (let i = 0; i < this.waypoints.length - 1; i++) {
        const p1 = this.waypoints[i];
        const p2 = this.waypoints[i + 1];
        const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        this.segmentLengths.push(segLen);
        this.totalLength += segLen;
      }
    }

    // Precompute finish time
    this.finishTime = (this.totalLength > 0 && this.speed > 0)
      ? (this.spawnTime + this.totalLength / this.speed)
      : this.spawnTime;

    // Deterministic speech timeline
    this.speechTimeline = [];
    const speechRng = mulberry32(this.seed);
    let speechTime = this.spawnTime + nextSpeechDelay(speechRng);
    const maxSpeechTime = (this.totalLength > 0 && this.finishTime > this.spawnTime)
      ? (this.finishTime + 0.5)
      : (this.spawnTime + 120.0);
    while (speechTime < maxSpeechTime) {
      const phrase = pickPhrase(speechRng);
      this.speechTimeline.push({
        startTime: speechTime,
        endTime: speechTime + 4.0,
        phrase: phrase
      });
      speechTime += 4.0 + nextSpeechDelay(speechRng);
    }

    // Entity state
    if (this.waypoints.length > 0) {
      this.x = this.waypoints[0].x;
      this.y = this.waypoints[0].y;
    } else if (isLegacy) {
      this.x = legacyX;
      this.y = legacyY;
    } else {
      this.x = opts.x !== undefined ? opts.x : 0;
      this.y = opts.y !== undefined ? opts.y : 0;
    }
    this.vx = 0;
    this.vy = 0;
    this.angle = opts.angle !== undefined ? opts.angle : Math.PI / 2;
    this.depthY = this.y + 12;
    this.walkPhase = opts.walkPhase !== undefined ? opts.walkPhase : 0;
    this.opacity = 1.0;
    this.done = false;
    this.isFinishedState = false;
    this.speechBubble = null;
    this.currentSpeech = null;
    this.isNPC = true;

    // Legacy pause and avoidance compatibility
    this.pauseTimer = opts.pauseTimer || 0;
    this.waypointIndex = opts.waypointIndex || 0;
    this.state = opts.state || (this.pauseTimer > 0 ? NPCState.PAUSED : (this.isJogger ? NPCState.RUNNING : NPCState.WALKING));

    // Initialize clock positioning at spawnTime
    this.currentTime = this.spawnTime;
    this.setClock(this.spawnTime);
  }

  setClock(now) {
    if (typeof now !== 'number' || isNaN(now)) return;
    this.currentTime = now;
    const elapsed = Math.max(0, now - this.spawnTime);
    const distance = this.speed * elapsed;

    if (this.totalLength === 0 || distance >= this.totalLength) {
      if (this.waypoints.length > 0) {
        const last = this.waypoints[this.waypoints.length - 1];
        this.x = last.x;
        this.y = last.y;
      }
      this.vx = 0;
      this.vy = 0;
      this.depthY = this.y + 12;
      this.isFinishedState = true;

      // Fade out over 0.5s after finishing path
      const timeSinceFinish = now - this.finishTime;
      if (timeSinceFinish >= 0.5) {
        this.opacity = 0.0;
        this.done = true;
      } else if (timeSinceFinish > 0) {
        this.opacity = Math.max(0, 1.0 - timeSinceFinish / 0.5);
        this.done = false;
      } else {
        this.opacity = 1.0;
        this.done = false;
      }
    } else {
      let accumulated = 0;
      let interpolated = false;
      let dx = 0;
      let dy = 0;
      let segLen = 0;

      for (let i = 0; i < this.segmentLengths.length; i++) {
        segLen = this.segmentLengths[i];
        if (accumulated + segLen >= distance) {
          const remaining = distance - accumulated;
          const segT = segLen > 0.000001 ? (remaining / segLen) : 0;
          const p1 = this.waypoints[i];
          const p2 = this.waypoints[i + 1];
          dx = p2.x - p1.x;
          dy = p2.y - p1.y;
          this.x = p1.x + dx * segT;
          this.y = p1.y + dy * segT;
          interpolated = true;
          break;
        }
        accumulated += segLen;
      }

      if (!interpolated && this.waypoints.length >= 2) {
        const lastIdx = this.waypoints.length - 2;
        const p1 = this.waypoints[lastIdx];
        const p2 = this.waypoints[lastIdx + 1];
        dx = p2.x - p1.x;
        dy = p2.y - p1.y;
        segLen = this.segmentLengths[lastIdx] || 0;
        this.x = p2.x;
        this.y = p2.y;
      }

      this.depthY = this.y + 12;
      if (Math.hypot(dx, dy) > 0.000001) {
        this.angle = Math.atan2(dy, dx);
      }
      this.vx = segLen > 0.000001 ? (dx / segLen) * this.speed : 0;
      this.vy = segLen > 0.000001 ? (dy / segLen) * this.speed : 0;
      this.opacity = 1.0;
      this.done = false;
      this.isFinishedState = false;
    }

    const speech = this.getSpeech(now);
    this.speechBubble = this.done ? null : speech;
    this.currentSpeech = this.speechBubble;
  }

  update(dt, now, avoidanceEntities = []) {
    // avoidanceEntities, minSep legacy references
    // isBench, isOverlook, pauseTimer legacy references
    this.depthY = this.y + 12;
    if (typeof now === 'number') {
      this.currentTime = now;
      this.setClock(now);
    } else {
      this.currentTime = (this.currentTime !== undefined ? this.currentTime + dt : this.spawnTime + dt);
      this.setClock(this.currentTime);
    }

    if (this.speed > 0 && !this.isFinished(this.currentTime)) {
      this.walkPhase += dt * (this.isJogger ? 14 : 9.5);
    }
  }

  isFinished(now) {
    if (typeof now === 'number') {
      if (now >= this.finishTime) return true;
      if (this.totalLength > 0) {
        const elapsed = Math.max(0, now - this.spawnTime);
        return (this.speed * elapsed) >= this.totalLength;
      }
      return false;
    }
    return this.isFinishedState;
  }

  isDone(now) {
    if (this.done) return true;
    if (typeof now === 'number') {
      return now >= this.finishTime + 0.5;
    }
    return false;
  }

  getSpeech(now) {
    if (typeof now !== 'number') return null;
    if (!Array.isArray(this.speechTimeline)) return null;
    for (let i = 0; i < this.speechTimeline.length; i++) {
      const ev = this.speechTimeline[i];
      if (ev.startTime <= now && now < ev.endTime) {
        return ev.phrase;
      }
    }
    return null;
  }

  draw(ctx) {
    if (this.done || this.opacity <= 0) {
      return;
    }

    ctx.save();
    ctx.globalAlpha = this.opacity;

    // 1. Soft ground drop shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 10, 14, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Walking / Running Legs & Shoes
    const isMoving = Math.hypot(this.vx, this.vy) > 0.1;
    const legSwing = isMoving ? Math.sin(this.walkPhase) * (this.isJogger ? 7.5 : 5.5) : 0;
    const legSpread = 7;

    // Left leg & shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x - legSpread - 3.5, this.y + 1 + legSwing, 5.5, 9, 2);
    } else {
      ctx.rect(this.x - legSpread - 3.5, this.y + 1 + legSwing, 5.5, 9);
    }
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x - legSpread - 4, this.y + 9 + legSwing, 6.8, 5, 2.5);
    } else {
      ctx.rect(this.x - legSpread - 4, this.y + 9 + legSwing, 6.8, 5);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(this.x - legSpread - 4, this.y + 13 + legSwing, 6.8, 1.2);

    // Right leg & shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x + legSpread - 2, this.y + 1 - legSwing, 5.5, 9, 2);
    } else {
      ctx.rect(this.x + legSpread - 2, this.y + 1 - legSwing, 5.5, 9);
    }
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x + legSpread - 2.5, this.y + 9 - legSwing, 6.8, 5, 2.5);
    } else {
      ctx.rect(this.x + legSpread - 2.5, this.y + 9 - legSwing, 6.8, 5);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(this.x + legSpread - 2.5, this.y + 13 - legSwing, 6.8, 1.2);

    // 3. Torso / Top
    if (this.isJogger) {
      // Athletic technical running top
      ctx.fillStyle = this.jacketColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 10.5, this.y - 12, 21, 17, 4.5);
      } else {
        ctx.rect(this.x - 10.5, this.y - 12, 21, 17);
      }
      ctx.fill();

      // Reflective chest stripe
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(this.x - 10, this.y - 5, 20, 2.5);

      // Sport bib / accent
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 4, this.y - 2, 8, 6.5, 1.5);
      } else {
        ctx.rect(this.x - 4, this.y - 2, 8, 6.5);
      }
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(this.x - 2.5, this.y, 5, 1.2);
    } else {
      // Casual outdoor jacket / windbreaker
      ctx.fillStyle = this.jacketColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 11, this.y - 12, 22, 18, 5);
      } else {
        ctx.rect(this.x - 11, this.y - 12, 22, 18);
      }
      ctx.fill();

      // Lapels & collar
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(this.x - 4, this.y - 12);
      ctx.lineTo(this.x + 4, this.y - 12);
      ctx.lineTo(this.x, this.y - 6);
      ctx.closePath();
      ctx.fill();

      // Collar trim
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.beginPath();
      ctx.moveTo(this.x - 7, this.y - 12);
      ctx.lineTo(this.x - 3, this.y - 12);
      ctx.lineTo(this.x, this.y - 5);
      ctx.lineTo(this.x - 5, this.y - 5);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(this.x + 7, this.y - 12);
      ctx.lineTo(this.x + 3, this.y - 12);
      ctx.lineTo(this.x, this.y - 5);
      ctx.lineTo(this.x + 5, this.y - 5);
      ctx.closePath();
      ctx.fill();

      // Jacket zipper line
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - 5);
      ctx.lineTo(this.x, this.y + 6);
      ctx.stroke();
    }

    // 4. Arms & Hands
    const armSwing = isMoving ? Math.cos(this.walkPhase) * (this.isJogger ? 6 : 4.5) : 0;
    // Left arm
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x - 15.5, this.y - 10 - armSwing, 4.5, 12, 2);
    } else {
      ctx.rect(this.x - 15.5, this.y - 10 - armSwing, 4.5, 12);
    }
    ctx.fill();
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x - 13.25, this.y + 3 - armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Right arm
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(this.x + 11, this.y - 10 + armSwing, 4.5, 12, 2);
    } else {
      ctx.rect(this.x + 11, this.y - 10 + armSwing, 4.5, 12);
    }
    ctx.fill();
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x + 13.25, this.y + 3 + armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 5. Head & Face
    const style = (this.hairStyle || 'SHORT').toUpperCase();

    // Rear hair layer for WAVY or PONYTAIL
    if (style === 'WAVY') {
      ctx.fillStyle = this.hairColor;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y - 18, 11.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'PONYTAIL') {
      const backAngle = (this.angle || Math.PI / 2) + Math.PI;
      const pBaseX = this.x + Math.cos(backAngle) * 7.5;
      const pBaseY = this.y - 22 + Math.sin(backAngle) * 6.5;

      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(pBaseX, pBaseY, 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = this.hairColor;
      const pTipX = pBaseX + Math.cos(backAngle) * 9.5;
      const pTipY = pBaseY + Math.sin(backAngle) * 9.5;
      ctx.beginPath();
      ctx.ellipse(pTipX, pTipY, 4.8, 7.8, backAngle + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head base with skin tone
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 20, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Ears on sides
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x - 8.8, this.y - 20, 2.2, 0, Math.PI * 2);
    ctx.arc(this.x + 8.8, this.y - 20, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Directional facial cues based on angle
    const angle = this.angle || Math.PI / 2;
    const eyeForwardX = Math.cos(angle) * 3.5;
    const eyeForwardY = Math.sin(angle) * 3.5;
    const eyeSideX = Math.sin(angle) * 2.8;
    const eyeSideY = -Math.cos(angle) * 2.8;

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(this.x + eyeForwardX + eyeSideX, this.y - 20 + eyeForwardY + eyeSideY, 1.1, 0, Math.PI * 2);
    ctx.arc(this.x + eyeForwardX - eyeSideX, this.y - 20 + eyeForwardY - eyeSideY, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Subtle nose directional indicator
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(this.x + Math.cos(angle) * 4.6, this.y - 20 + Math.sin(angle) * 4.6, 1.0, 0, Math.PI * 2);
    ctx.fill();

    // 6. Hairstyle
    this.drawHair(ctx, style);

    // Jogger athletic headband
    if (this.isJogger) {
      ctx.fillStyle = this.hatColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(this.x - 8.5, this.y - 24, 17, 3.8, 1.9);
      } else {
        ctx.rect(this.x - 8.5, this.y - 24, 17, 3.8);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // 7. Overhead Nametag Badge
    ctx.font = NPC_TAG_STYLE.font;
    ctx.textAlign = 'center';
    const displayNametag = this.name || (this.isJogger ? 'Jogger' : 'Walker');
    const textWidth = ctx.measureText(displayNametag).width;
    const pillW = textWidth + 14;
    const pillH = 16;
    const pillX = this.x - pillW / 2;
    const pillY = this.y - 42;

    ctx.fillStyle = NPC_TAG_STYLE.background;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(pillX, pillY, pillW, pillH, 8);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();

    ctx.strokeStyle = NPC_TAG_STYLE.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = NPC_TAG_STYLE.text;
    ctx.fillText(displayNametag, this.x, this.y - 30);

    // 8. Speech Bubble
    if (this.speechBubble) {
      this.drawSpeechBubble(ctx, this.speechBubble);
    }

    ctx.restore();
  }

  drawSpeechBubble(ctx, text) {
    if (!text) return;
    ctx.save();
    ctx.font = '500 12px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const textWidth = Math.min(260, ctx.measureText(text).width);
    const bubbleW = textWidth + 16;
    const bubbleH = 24;
    const bx = this.x - bubbleW / 2;
    const by = this.y - 68;

    // Bubble body
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, bubbleW, bubbleH, 8);
    } else {
      ctx.rect(bx, by, bubbleW, bubbleH);
    }
    ctx.fill();

    // Small triangle pointer pointing down
    ctx.beginPath();
    ctx.moveTo(this.x - 4, by + bubbleH);
    ctx.lineTo(this.x, by + bubbleH + 6);
    ctx.lineTo(this.x + 4, by + bubbleH);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(text, this.x, by + 16);
    ctx.restore();
  }

  drawHair(ctx, style) {
    ctx.save();
    switch (style) {
      case 'WAVY': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(this.x - 8.5, this.y - 17, 3.8, 6.5, -0.25, 0, Math.PI * 2);
        ctx.ellipse(this.x - 8.0, this.y - 11, 3.2, 5.0, 0.15, 0, Math.PI * 2);
        ctx.ellipse(this.x + 8.5, this.y - 17, 3.8, 6.5, 0.25, 0, Math.PI * 2);
        ctx.ellipse(this.x + 8.0, this.y - 11, 3.2, 5.0, -0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y - 23, 9.5, Math.PI * 0.9, Math.PI * 2.1);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(this.x - 8, this.y - 22);
        ctx.quadraticCurveTo(this.x - 4, this.y - 18.5, this.x, this.y - 21.5);
        ctx.quadraticCurveTo(this.x + 4, this.y - 18.5, this.x + 8, this.y - 22);
        ctx.lineTo(this.x + 7, this.y - 26);
        ctx.lineTo(this.x - 7, this.y - 26);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this.x - 3, this.y - 25, 5.5, Math.PI * 1.15, Math.PI * 1.75);
        ctx.stroke();
        break;
      }

      case 'PONYTAIL': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(this.x, this.y - 22, 9.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(this.x - 7.5, this.y - 21, 2.2, 3.8, -0.15, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.5, this.y - 21, 2.2, 3.8, 0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(this.x, this.y - 25.5, 4.2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();
        break;
      }

      case 'BEANIE': {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(this.x - 7.2, this.y - 19, 2.5, 4.0, -0.2, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.2, this.y - 19, 2.5, 4.0, 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y - 21, 8.5, Math.PI * 0.95, Math.PI * 1.25);
        ctx.arc(this.x, this.y - 21, 8.5, Math.PI * 1.75, Math.PI * 2.05);
        ctx.fill();

        const beanieMain = this.hatColor || '#c2410c';
        ctx.fillStyle = beanieMain;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - 24, 10.0, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(this.x - 9.5, this.y - 23, 19, 5.5, 2.5);
        } else {
          ctx.rect(this.x - 9.5, this.y - 23, 19, 5.5);
        }
        ctx.fill();
        break;
      }

      case 'SHORT':
      default: {
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(this.x, this.y - 22, 9.2, Math.PI * 0.85, Math.PI * 2.15);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(this.x - 7.5, this.y - 20.5, 2.5, 4.2, -0.2, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.5, this.y - 20.5, 2.5, 4.2, 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(this.x - 8, this.y - 22);
        ctx.quadraticCurveTo(this.x - 4, this.y - 19.5, this.x - 2, this.y - 22.5);
        ctx.quadraticCurveTo(this.x + 1, this.y - 19, this.x + 3.5, this.y - 22.5);
        ctx.quadraticCurveTo(this.x + 6, this.y - 20, this.x + 8, this.y - 22);
        ctx.lineTo(this.x + 7, this.y - 26);
        ctx.lineTo(this.x - 7, this.y - 26);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this.x - 2, this.y - 26, 4.5, Math.PI * 1.1, Math.PI * 1.8);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}

export class WalkerNPC extends ParkNPC {
  // Legacy default speed: 85
  constructor(x, y, options = {}) {
    if (typeof x === 'object' && x !== null) {
      const opts = { type: 'walker', ...x };
      if (opts.speed === undefined) {
        opts.speed = NPC_SPEED.walker;
      }
      super(opts);
    } else {
      super(x, y, { speed: 85, type: 'walker', isJogger: false, ...options });
    }
  }
}

export class JoggerNPC extends ParkNPC {
  // Legacy default speed: 260
  constructor(x, y, options = {}) {
    if (typeof x === 'object' && x !== null) {
      const opts = { type: 'jogger', ...x };
      if (opts.speed === undefined) {
        opts.speed = NPC_SPEED.jogger;
      }
      super(opts);
    } else {
      super(x, y, { speed: 260, type: 'jogger', isJogger: true, ...options });
    }
  }
}

```

## FILE: ./src/entities/npc_content.js

```typescript
/**
 * Ambient NPC content tables, appearance palettes, PRNG, and speech selection.
 */

export function mulberry32(seed) {
  let s = (Math.floor(Number(seed)) || 0) >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NPC_SPEED = Object.freeze({
  walker: 35,
  jogger: 80
});

export const NPC_TYPES = Object.freeze(['walker', 'jogger']);

export const FIRST_NAMES = Object.freeze([
  'Alice', 'Arthur', 'Beatrice', 'Bob', 'Charlie', 'Colin', 'Diana', 'Dorothy',
  'Edward', 'Felix', 'Fiona', 'George', 'Grace', 'Hannah', 'Henry', 'Ian',
  'Iris', 'Jasper', 'Julia', 'Kevin', 'Kiran', 'Laura', 'Leo', 'Mary',
  'Maya', 'Michael', 'Nina', 'Noah', 'Oliver', 'Ophelia', 'Penny', 'Peter',
  'Quentin', 'Rachel', 'Rosa', 'Sam', 'Simon', 'Steve', 'Tara', 'Tess',
  'Umar', 'Victor', 'Victoria', 'William', 'Xena', 'Yusuf', 'Zara'
]);

export const SKIN_TONES = Object.freeze([
  '#fed7aa', '#fcd34d', '#fbcfe8', '#d4a373',
  '#a3704c', '#6f4e37', '#e2b59a', '#fecdd3'
]);

export const HAIR_COLORS = Object.freeze([
  '#451a03', '#1e293b', '#78350f', '#b45309',
  '#e2e8f0', '#92400e', '#292524'
]);

export const HAIR_STYLES = Object.freeze(['SHORT', 'WAVY', 'PONYTAIL', 'BEANIE']);

export const HAT_COLORS = Object.freeze([
  '#c2410c', '#0284c7', '#15803d', '#4338ca',
  '#334155', '#64748b', '#e11d48'
]);

export const WALKER_JACKETS = Object.freeze([
  '#1e3a8a', '#047857', '#b91c1c', '#b45309',
  '#475569', '#0f766e', '#6d28d9', '#3b82f6', '#334155'
]);

export const JOGGER_JACKETS = Object.freeze([
  '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
  '#8b5cf6', '#ec4899', '#84cc16', '#3b82f6', '#f97316'
]);

export const WALKER_PANTS = Object.freeze([
  '#334155', '#1e293b', '#475569', '#374151', '#1f2937'
]);

export const JOGGER_PANTS = Object.freeze([
  '#0f172a', '#1e1b4b', '#18181b', '#0284c7', '#374151', '#4338ca'
]);

export const WALKER_SHOES = Object.freeze([
  '#0f172a', '#1e293b', '#334155', '#475569'
]);

export const JOGGER_SHOES = Object.freeze([
  '#f8fafc', '#38bdf8', '#fbbf24', '#f43f5e'
]);

export const NPC_TAG_STYLE = Object.freeze({
  text: '#fef08a',
  background: 'rgba(15, 23, 42, 0.85)',
  border: 'rgba(250, 204, 21, 0.4)',
  font: 'italic 600 11px ' + 'Outfit, sans-serif'
});

export const COMMON_PHRASES = Object.freeze([
  'Lovely morning for a stroll.',
  'The breeze feels refreshing today.',
  'Look at those autumn leaves!',
  'Such a beautiful park we have here.',
  'I always enjoy watching the dogs play.',
  'Fresh air always clears the mind.',
  'A great day to stretch the legs.',
  'What good dogs in the park today!',
  'The sun is warm today.',
  'Peace and quiet out here.',
  'Nice weather to get moving.',
  'Look at the birds by the pond.',
  'Can never spend too much time outdoors.',
  'Nothing beats a walk in nature.',
  'Such lovely green scenery.',
  'Just taking in the morning sights.',
  'Glad I brought my walking shoes.',
  'The flowers are blooming nicely.',
  'Good pace today!',
  'Always nice seeing happy pups.',
  'Enjoying every step of the path.',
  'The air is crisp and clean.',
  'What a charming little park.',
  'Walking keeps the heart young.',
  'Hello there, beautiful day isn\'t it?',
  'Just taking my daily lap.',
  'Sunbeams through the branches look nice.',
  'Nothing like an afternoon walk.',
  'So many tails wagging today.',
  'Good to be out and about.',
  'Such polite walkers around here.',
  'The trails look very well kept.'
]);

export const ODD_PHRASES = Object.freeze([
  'I think that squirrel owes me money.',
  'Did that tree just wink at me?',
  'Are we inside a simulation right now?',
  'I swear that dog understood every word I thought.',
  'My pedometer told me I walked to the moon.',
  'Is it just me, or do ducks have secret meetings?',
  'I forgot why I started jogging three miles ago.',
  'I wonder if dogs dream in color or tennis balls.',
  'A pigeon gave me directions this morning.',
  'Never trust a bench that looks too comfortable.',
  'I think my shadow is lagging slightly behind.'
]);

export function npcIdentityFromSeed(seed, type = 'walker') {
  const rng = mulberry32(seed);
  const isJogger = Boolean(type && type.toLowerCase() === 'jogger');
  const title = isJogger ? 'Jogger' : 'Walker';
  const firstName = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
  const name = `${firstName} the ${title}`;

  const skinTone = SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)];
  const hairColor = HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)];
  const hairStyle = HAIR_STYLES[Math.floor(rng() * HAIR_STYLES.length)];
  const hatColor = HAT_COLORS[Math.floor(rng() * HAT_COLORS.length)];
  const jacketColor = isJogger
    ? JOGGER_JACKETS[Math.floor(rng() * JOGGER_JACKETS.length)]
    : WALKER_JACKETS[Math.floor(rng() * WALKER_JACKETS.length)];
  const pantsColor = isJogger
    ? JOGGER_PANTS[Math.floor(rng() * JOGGER_PANTS.length)]
    : WALKER_PANTS[Math.floor(rng() * WALKER_PANTS.length)];
  const shoeColor = isJogger
    ? JOGGER_SHOES[Math.floor(rng() * JOGGER_SHOES.length)]
    : WALKER_SHOES[Math.floor(rng() * WALKER_SHOES.length)];

  return {
    name,
    skinTone,
    hairColor,
    hairStyle,
    hatColor,
    jacketColor,
    pantsColor,
    shoeColor
  };
}

export function pickPhrase(rng) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const roll = random();
  if (roll < 0.15) {
    return ODD_PHRASES[Math.floor(random() * ODD_PHRASES.length)];
  }
  return COMMON_PHRASES[Math.floor(random() * COMMON_PHRASES.length)];
}

export function nextSpeechDelay(rng) {
  const random = typeof rng === 'function' ? rng : Math.random;
  return 6.0 + random() * 8.0;
}

```

## FILE: ./src/entities/owner.js

```typescript
// Human Owner Player Avatar - 8-Way Movement, Customization & Interaction Controller

export class Owner {
  constructor(x = 1200, y = 900, name = 'Walker', isLocal = true) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.speed = 190; // px/s
    this.facing = 'S';
    this.angle = Math.PI / 2; // Facing downward

    this.name = name;
    this.isLocal = isLocal;
    this.radius = 16;
    this.depthY = this.y + 12;

    // Customization tokens
    this.hairStyle = 'SHORT'; // Supported: 'SHORT', 'WAVY', 'PONYTAIL', 'BEANIE'
    this.hairColor = '#451a03'; // Chestnut brown
    this.skinTone = '#fed7aa'; // Warm light peach
    this.jacketColor = '#1e3a8a'; // Deep blue
    this.pantsColor = '#334155'; // Slate dark trousers
    this.shoeColor = '#0f172a';

    // State & Animations
    this.isMoving = false;
    this.walkPhase = 0;
    this.isPetting = false;
    this.petTimer = 0;
    this.isLeashed = true;

    // Chat / Emote bubble
    this.chatText = null;
    this.chatTimer = 0;
    this.emote = null;
    this.emoteTimer = 0;

    // Input state
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };
  }

  setChat(text, duration = 4.0) {
    this.chatText = text;
    this.chatTimer = duration;
  }

  setEmote(emote, duration = 3.0) {
    this.emote = emote;
    this.emoteTimer = duration;
  }

  update(dt, field) {
    // 1. Process movement inputs if local player
    if (this.isLocal) {
      let dx = 0;
      let dy = 0;
      if (this.keys.up) dy -= 1;
      if (this.keys.down) dy += 1;
      if (this.keys.left) dx -= 1;
      if (this.keys.right) dx += 1;

      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        this.vx = (dx / mag) * this.speed;
        this.vy = (dy / mag) * this.speed;
        this.isMoving = true;
        this.angle = Math.atan2(this.vy, this.vx);
        this.walkPhase += dt * 9.5;
      } else {
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
      }
    }

    // Apply movement
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Resolve world obstacle & boundary collisions
    if (field) {
      const resolved = field.resolveCircleCollision(this.x, this.y, this.radius);
      this.x = resolved.x;
      this.y = resolved.y;
    }

    this.depthY = this.y + 12;

    // Update timers
    if (this.petTimer > 0) {
      this.petTimer -= dt;
      if (this.petTimer <= 0) this.isPetting = false;
    }

    if (this.chatTimer > 0) {
      this.chatTimer -= dt;
      if (this.chatTimer <= 0) this.chatText = null;
    }

    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) this.emote = null;
    }
  }

  draw(ctx) {
    ctx.save();
    // 1. Soft ground drop shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 14, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Walking Legs / Shoes
    const legSwing = this.isMoving ? Math.sin(this.walkPhase) * 6 : 0;
    const legSpread = 7;

    // Left leg / shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    ctx.roundRect(this.x - legSpread - 3.5, this.y + 1 + legSwing, 5.5, 9, 2);
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    ctx.roundRect(this.x - legSpread - 4, this.y + 9 + legSwing, 6.8, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(this.x - legSpread - 4, this.y + 13 + legSwing, 6.8, 1.2);

    // Right leg / shoe
    ctx.fillStyle = this.pantsColor;
    ctx.beginPath();
    ctx.roundRect(this.x + legSpread - 2, this.y + 1 - legSwing, 5.5, 9, 2);
    ctx.fill();
    ctx.fillStyle = this.shoeColor;
    ctx.beginPath();
    ctx.roundRect(this.x + legSpread - 2.5, this.y + 9 - legSwing, 6.8, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(this.x + legSpread - 2.5, this.y + 13 - legSwing, 6.8, 1.2);

    // 3. Torso / Jacket with lapels
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    ctx.roundRect(this.x - 11, this.y - 12, 22, 18, 5);
    ctx.fill();

    // Shoulder lapels & collar
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(this.x - 4, this.y - 12);
    ctx.lineTo(this.x + 4, this.y - 12);
    ctx.lineTo(this.x, this.y - 6);
    ctx.closePath();
    ctx.fill();

    // Lapels over neckline
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(this.x - 7, this.y - 12);
    ctx.lineTo(this.x - 3, this.y - 12);
    ctx.lineTo(this.x, this.y - 5);
    ctx.lineTo(this.x - 5, this.y - 5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(this.x + 7, this.y - 12);
    ctx.lineTo(this.x + 3, this.y - 12);
    ctx.lineTo(this.x, this.y - 5);
    ctx.lineTo(this.x + 5, this.y - 5);
    ctx.closePath();
    ctx.fill();

    // Jacket zipper / seam line
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 5);
    ctx.lineTo(this.x, this.y + 6);
    ctx.stroke();

    // 4. Arms & Hands swinging based on walkPhase
    const armSwing = this.isMoving ? Math.cos(this.walkPhase) * 5 : 0;
    // Left arm
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    ctx.roundRect(this.x - 15.5, this.y - 10 - armSwing, 4.5, 12, 2);
    ctx.fill();
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x - 13.25, this.y + 3 - armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Right arm
    ctx.fillStyle = this.jacketColor;
    ctx.beginPath();
    ctx.roundRect(this.x + 11, this.y - 10 + armSwing, 4.5, 12, 2);
    ctx.fill();
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x + 13.25, this.y + 3 + armSwing, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 5. Head & Face
    const style = (this.hairStyle || 'SHORT').toUpperCase();

    // Rear hair layer for WAVY or PONYTAIL
    if (style === 'WAVY') {
      ctx.fillStyle = this.hairColor;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y - 18, 11.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'PONYTAIL') {
      const backAngle = this.angle + Math.PI;
      const pBaseX = this.x + Math.cos(backAngle) * 7.5;
      const pBaseY = this.y - 22 + Math.sin(backAngle) * 6.5;

      // Scrunchie tie
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(pBaseX, pBaseY, 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Tied ponytail plume extending behind head
      ctx.fillStyle = this.hairColor;
      const pTipX = pBaseX + Math.cos(backAngle) * 9.5;
      const pTipY = pBaseY + Math.sin(backAngle) * 9.5;
      ctx.beginPath();
      ctx.ellipse(pTipX, pTipY, 4.8, 7.8, backAngle + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head base with skin tone
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 20, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Ears on sides
    ctx.fillStyle = this.skinTone;
    ctx.beginPath();
    ctx.arc(this.x - 8.8, this.y - 20, 2.2, 0, Math.PI * 2);
    ctx.arc(this.x + 8.8, this.y - 20, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Subtle facial direction cues based on angle
    const eyeForwardX = Math.cos(this.angle) * 3.5;
    const eyeForwardY = Math.sin(this.angle) * 3.5;
    const eyeSideX = Math.sin(this.angle) * 2.8;
    const eyeSideY = -Math.cos(this.angle) * 2.8;

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(this.x + eyeForwardX + eyeSideX, this.y - 20 + eyeForwardY + eyeSideY, 1.1, 0, Math.PI * 2);
    ctx.arc(this.x + eyeForwardX - eyeSideX, this.y - 20 + eyeForwardY - eyeSideY, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Subtle nose directional indicator
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(this.x + Math.cos(this.angle) * 4.6, this.y - 20 + Math.sin(this.angle) * 4.6, 1.0, 0, Math.PI * 2);
    ctx.fill();

    // 6. Hairstyle silhouettes
    this.drawHair(ctx, style);

    // 7. Name Label Badge
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const displayNametag = this.isLocal ? `${this.name} (You)` : this.name;
    const textWidth = ctx.measureText(displayNametag).width;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.roundRect(this.x - textWidth / 2 - 6, this.y - 42, textWidth + 12, 16, 8);
    ctx.fill();

    ctx.fillStyle = this.isLocal ? '#fde047' : '#f8fafc';
    ctx.fillText(displayNametag, this.x, this.y - 30);

    // 8. Speech Bubble or Emote
    if (this.chatText) {
      this.drawSpeechBubble(ctx, this.chatText);
    } else if (this.emote) {
      this.drawEmoteBubble(ctx, this.emote);
    }

    ctx.restore();
  }

  drawHair(ctx, style) {
    ctx.save();
    switch (style) {
      case 'WAVY': {
        ctx.fillStyle = this.hairColor;
        // Wavy locks framing face
        ctx.beginPath();
        ctx.ellipse(this.x - 8.5, this.y - 17, 3.8, 6.5, -0.25, 0, Math.PI * 2);
        ctx.ellipse(this.x - 8.0, this.y - 11, 3.2, 5.0, 0.15, 0, Math.PI * 2);
        ctx.ellipse(this.x + 8.5, this.y - 17, 3.8, 6.5, 0.25, 0, Math.PI * 2);
        ctx.ellipse(this.x + 8.0, this.y - 11, 3.2, 5.0, -0.15, 0, Math.PI * 2);
        ctx.fill();

        // Crown volume
        ctx.beginPath();
        ctx.arc(this.x, this.y - 23, 9.5, Math.PI * 0.9, Math.PI * 2.1);
        ctx.fill();

        // Soft parted wavy bangs
        ctx.beginPath();
        ctx.moveTo(this.x - 8, this.y - 22);
        ctx.quadraticCurveTo(this.x - 4, this.y - 18.5, this.x, this.y - 21.5);
        ctx.quadraticCurveTo(this.x + 4, this.y - 18.5, this.x + 8, this.y - 22);
        ctx.lineTo(this.x + 7, this.y - 26);
        ctx.lineTo(this.x - 7, this.y - 26);
        ctx.closePath();
        ctx.fill();

        // Highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this.x - 3, this.y - 25, 5.5, Math.PI * 1.15, Math.PI * 1.75);
        ctx.stroke();
        break;
      }

      case 'PONYTAIL': {
        ctx.fillStyle = this.hairColor;
        // Swept-back hair over crown
        ctx.beginPath();
        ctx.arc(this.x, this.y - 22, 9.2, 0, Math.PI * 2);
        ctx.fill();

        // Temple strands
        ctx.beginPath();
        ctx.ellipse(this.x - 7.5, this.y - 21, 2.2, 3.8, -0.15, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.5, this.y - 21, 2.2, 3.8, 0.15, 0, Math.PI * 2);
        ctx.fill();

        // Crown shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(this.x, this.y - 25.5, 4.2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();
        break;
      }

      case 'BEANIE': {
        // Peeking hair tufts below beanie brim
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.ellipse(this.x - 7.2, this.y - 19, 2.5, 4.0, -0.2, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.2, this.y - 19, 2.5, 4.0, 0.2, 0, Math.PI * 2);
        ctx.fill();

        // Hair bangs peeking out
        ctx.beginPath();
        ctx.arc(this.x, this.y - 21, 8.5, Math.PI * 0.95, Math.PI * 1.25);
        ctx.arc(this.x, this.y - 21, 8.5, Math.PI * 1.75, Math.PI * 2.05);
        ctx.fill();

        // Beanie dome
        const beanieMain = '#c2410c';
        const beanieCuff = '#9a3412';
        ctx.fillStyle = beanieMain;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - 24, 10.0, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Ribbed folded cuff
        ctx.fillStyle = beanieCuff;
        ctx.beginPath();
        ctx.roundRect(this.x - 9.5, this.y - 23, 19, 5.5, 2.5);
        ctx.fill();

        // Vertical ribbed knit stitches on cuff
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        for (let rx = -7.5; rx <= 7.5; rx += 2.5) {
          ctx.beginPath();
          ctx.moveTo(this.x + rx, this.y - 23);
          ctx.lineTo(this.x + rx, this.y - 18);
          ctx.stroke();
        }

        // Fluffy pom-pom on top
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(this.x, this.y - 32.5, 3.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(this.x - 1, this.y - 32.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'SHORT':
      default: {
        ctx.fillStyle = this.hairColor;
        // Main cropped crown
        ctx.beginPath();
        ctx.arc(this.x, this.y - 22, 9.2, Math.PI * 0.85, Math.PI * 2.15);
        ctx.fill();

        // Side crops
        ctx.beginPath();
        ctx.ellipse(this.x - 7.5, this.y - 20.5, 2.5, 4.2, -0.2, 0, Math.PI * 2);
        ctx.ellipse(this.x + 7.5, this.y - 20.5, 2.5, 4.2, 0.2, 0, Math.PI * 2);
        ctx.fill();

        // Textured bangs across forehead
        ctx.beginPath();
        ctx.moveTo(this.x - 8, this.y - 22);
        ctx.quadraticCurveTo(this.x - 4, this.y - 19.5, this.x - 2, this.y - 22.5);
        ctx.quadraticCurveTo(this.x + 1, this.y - 19, this.x + 3.5, this.y - 22.5);
        ctx.quadraticCurveTo(this.x + 6, this.y - 20, this.x + 8, this.y - 22);
        ctx.lineTo(this.x + 7, this.y - 26);
        ctx.lineTo(this.x - 7, this.y - 26);
        ctx.closePath();
        ctx.fill();

        // Hair crown highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this.x - 2, this.y - 26, 4.5, Math.PI * 1.1, Math.PI * 1.8);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  drawSpeechBubble(ctx, text) {
    ctx.save();
    ctx.font = '500 12px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const textWidth = Math.min(200, ctx.measureText(text).width);
    const bubbleW = textWidth + 16;
    const bubbleH = 24;
    const bx = this.x - bubbleW / 2;
    const by = this.y - 68;

    // Bubble body
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 8);
    ctx.fill();

    // Small triangle pointer
    ctx.beginPath();
    ctx.moveTo(this.x - 4, by + bubbleH);
    ctx.lineTo(this.x, by + bubbleH + 6);
    ctx.lineTo(this.x + 4, by + bubbleH);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(text, this.x, by + 16);
    ctx.restore();
  }

  drawEmoteBubble(ctx, emote) {
    ctx.save();
    const bx = this.x - 16;
    const by = this.y - 68;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(bx, by, 32, 28, 8);
    ctx.fill();

    // Pointer
    ctx.beginPath();
    ctx.moveTo(this.x - 4, by + 28);
    ctx.lineTo(this.x, by + 34);
    ctx.lineTo(this.x + 4, by + 28);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.fillText(emote, this.x, by + 20);
    ctx.restore();
  }
}

```

## FILE: ./src/entities/tombstone.js

```typescript
/**
 * @deprecated Deprecated as of ticket-018: Tombstone dropping mechanism removed.
 */
export class ChatTombstone {
  constructor(x, y, options = {}) {
    this.x = x;
    this.y = y;
    this.depthY = y + 8;
    this.text = options.text || options.snippet || '';
    this.participants = options.participants || [];
    this.maxLifespan = options.lifespan !== undefined ? options.lifespan : 10.0;
    this.lifespan = this.maxLifespan;
    this.alpha = 1.0;
    this.isDead = true;
  }

  update(dt) {
    return false;
  }

  draw(ctx) {}
}

```

## FILE: ./src/entities/toy.js

```typescript
// Tennis Ball Toy - Ballistic 2.5D Trajectory, Bouncing & Canine Fetching Mechanics

export class TennisBall {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.z = 0; // Height off the ground (px)
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;

    this.radius = 7;
    this.gravity = 720;
    this.restitution = 0.62; // Bounce elasticity
    this.friction = 0.94; // Ground rolling friction

    this.isThrown = false;
    this.isCarried = false;
    this.carrier = null; // Dog currently holding the ball
    this.depthY = this.y;
  }

  throw(fromX, fromY, dirX, dirY, speed = 360, launchZ = 180) {
    this.x = fromX;
    this.y = fromY;
    this.z = 12;

    const len = Math.hypot(dirX, dirY) || 1;
    this.vx = (dirX / len) * speed;
    this.vy = (dirY / len) * speed;
    this.vz = launchZ;

    this.isThrown = true;
    this.isCarried = false;
    this.carrier = null;
  }

  attachToDog(dog) {
    this.isCarried = true;
    this.isThrown = false;
    this.carrier = dog;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.z = 8;
  }

  drop(x, y) {
    this.isCarried = false;
    this.carrier = null;
    this.x = x;
    this.y = y;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }

  update(dt, field) {
    if (this.isCarried && this.carrier) {
      // Offset ball at the dog's mouth position
      const mouthOffset = 18;
      this.x = this.carrier.x + Math.cos(this.carrier.angle) * mouthOffset;
      this.y = this.carrier.y + Math.sin(this.carrier.angle) * mouthOffset;
      this.z = 8;
      this.depthY = this.y + 4;
      return;
    }

    if (!this.isThrown && Math.hypot(this.vx, this.vy) < 1 && this.z <= 0) {
      this.z = 0;
      this.depthY = this.y;
      return;
    }

    // 2.5D Ballistic motion
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vz -= this.gravity * dt;
    this.z += this.vz * dt;

    // Ground bounce
    if (this.z <= 0) {
      this.z = 0;
      if (Math.abs(this.vz) > 40) {
        this.vz = -this.vz * this.restitution;
        this.vx *= 0.82;
        this.vy *= 0.82;
      } else {
        this.vz = 0;
        this.vx *= Math.pow(this.friction, dt * 60);
        this.vy *= Math.pow(this.friction, dt * 60);
      }
    }

    // World boundary bounce
    if (field) {
      const minX = 70;
      const maxX = field.width - 70;
      const minY = 70;
      const maxY = field.height - 70;

      if (this.x < minX) { this.x = minX; this.vx = -this.vx * 0.7; }
      if (this.x > maxX) { this.x = maxX; this.vx = -this.vx * 0.7; }
      if (this.y < minY) { this.y = minY; this.vy = -this.vy * 0.7; }
      if (this.y > maxY) { this.y = maxY; this.vy = -this.vy * 0.7; }
    }

    // Depth sorting base Y is the ground position
    this.depthY = this.y;
  }

  draw(ctx) {
    ctx.save();
    // 1. Soft Shadow on the ground
    const shadowScale = Math.max(0.3, 1 - this.z / 180);
    const shadowAlpha = Math.max(0.12, 0.45 * (1 - this.z / 200));
    ctx.fillStyle = `rgba(20, 35, 15, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.radius * 1.3 * shadowScale, this.radius * 0.7 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Optic Yellow Tennis Ball (elevated by z)
    const drawY = this.y - this.z;
    ctx.fillStyle = '#d9f92e'; // Bright tennis felt green/yellow
    ctx.beginPath();
    ctx.arc(this.x, drawY, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Curved white felt seam
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(this.x - 2, drawY, this.radius * 0.65, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();

    // Subtle 3D ball highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(this.x - 2, drawY - 2, this.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

```

## FILE: ./src/entities/waste.js

```typescript
// Park Waste Entity: Dog Waste Piles and Park Sanitation Management

export class PoopPile {
  constructor(id, x, y) {
    this.id = id || ('poop-' + Math.random().toString(36).substr(2, 9));
    this.x = x;
    this.y = y;
    this.radius = 10;
    this.depthY = y + 4;
    this.isCleaned = false;
    this.pulse = 0;
  }

  update(dt) {
    this.pulse += dt;
  }

  draw(ctx, player = null) {
    if (this.isCleaned) return;

    ctx.save();

    // 1. Subtle ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 3, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Interaction pulse ring when player is within range (<40px)
    let isNear = false;
    if (player && typeof player.x === 'number' && typeof player.y === 'number') {
      const dist = Math.hypot(this.x - player.x, this.y - player.y);
      if (dist < 40) isNear = true;
    }

    if (isNear) {
      const ringScale = 1.0 + Math.sin(this.pulse * 5) * 0.15;
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 16 * ringScale, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle sparkle
      const sparkleAlpha = 0.5 + Math.sin(this.pulse * 6) * 0.4;
      ctx.fillStyle = `rgba(255, 255, 255, ${sparkleAlpha})`;
      ctx.beginPath();
      ctx.arc(this.x + 5, this.y - 7, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Layered organic coils in rich earthy brown (#5a3825, #3e2415), with subtle highlight #7d5035
    // Bottom coil
    ctx.fillStyle = '#3e2415';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 2, 8, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Middle coil
    ctx.fillStyle = '#5a3825';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y - 1, 6, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Top coil tip
    ctx.fillStyle = '#5a3825';
    ctx.beginPath();
    ctx.ellipse(this.x - 0.5, this.y - 4, 3.5, 2.5, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Swirl highlight
    ctx.fillStyle = '#7d5035';
    ctx.beginPath();
    ctx.ellipse(this.x - 1.2, this.y - 2, 2.8, 1.2, 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

```

## FILE: ./src/entities/ziggy.js

```typescript
// Ziggy the Cocker Spaniel - Hero Entity & Procedural Character Engine
import { KinematicBody } from '../engine/physics.js';

export const ZiggyState = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  JUMPING: 'JUMPING',
  FALLING: 'FALLING',
  FLUTTERING: 'FLUTTERING',
  BARKING: 'BARKING'
};

export class BarkWave {
  constructor(x, y, facing) {
    this.x = x;
    this.y = y;
    this.facing = facing;
    this.radius = 8;
    this.maxRadius = 75;
    this.speed = 220; // px/s
    this.alpha = 1.0;
    this.isFinished = false;
  }

  update(dt) {
    this.radius += this.speed * dt;
    this.alpha = Math.max(0, 1 - (this.radius / this.maxRadius));
    if (this.radius >= this.maxRadius) {
      this.isFinished = true;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = `rgba(243, 201, 72, ${this.alpha * 0.85})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, -Math.PI / 2, Math.PI / 2, this.facing < 0);
    ctx.stroke();

    // Secondary sonic ring
    if (this.radius > 20) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${this.alpha * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius - 12, -Math.PI / 2, Math.PI / 2, this.facing < 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class Ziggy extends KinematicBody {
  constructor(x = 100, y = 300) {
    super(x, y, 52, 38);

    // Movement parameters
    this.moveSpeed = 240;
    this.sprintSpeed = 350;
    this.accel = 1600;
    this.friction = 1400;
    this.jumpForce = 490;

    // Cocker Spaniel Ear Spring Physics
    this.earAngle = 0;
    this.earVel = 0;
    this.earTarget = 0;

    // Tail Wag Physics
    this.tailTimer = 0;
    this.walkCycle = 0;

    // Ear-Flap Flutter (Double Jump Glide)
    this.canFlutter = true;
    this.isFluttering = false;
    this.flutterTimer = 0;
    this.flutterMax = 0.85; // seconds of hangtime

    // Bark ability
    this.barkCooldownTimer = 0;
    this.barkCooldownMax = 0.45;
    this.activeBarks = [];
    this.isBarkingAnimation = 0;

    // State & Callbacks
    this.state = ZiggyState.IDLE;
    this.onBarkTrigger = null; // Audio hook
  }

  handleInput(input, dt) {
    // Horizontal steering
    const moveDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (moveDir !== 0) {
      this.facing = moveDir;
      const targetSpeed = (input.sprint ? this.sprintSpeed : this.moveSpeed) * moveDir;
      this.vel.x += moveDir * this.accel * dt;
      if (Math.abs(this.vel.x) > Math.abs(targetSpeed)) {
        this.vel.x = targetSpeed;
      }
    } else {
      // Friction deceleration
      if (Math.abs(this.vel.x) > 10) {
        const sign = Math.sign(this.vel.x);
        this.vel.x -= sign * this.friction * dt;
        if (Math.sign(this.vel.x) !== sign) this.vel.x = 0;
      } else {
        this.vel.x = 0;
      }
    }

    // Jump / Drop Through
    if (input.jumpPressed) {
      if (input.down) {
        this.dropThrough();
      } else if (this.isGrounded || this.coyoteTimer > 0) {
        this.executeJump(this.jumpForce);
        this.canFlutter = true;
      } else if (this.canFlutter && !this.isGrounded && this.vel.y > -150) {
        // Trigger Ear-Flap Flutter!
        this.triggerFlutter();
      }
    }

    if (input.jumpReleased) {
      this.cutJump(0.5);
      if (this.isFluttering) {
        this.endFlutter();
      }
    }

    // Bark Action
    if (input.barkPressed && this.barkCooldownTimer <= 0) {
      this.triggerBark();
    }
  }

  triggerFlutter() {
    this.canFlutter = false;
    this.isFluttering = true;
    this.flutterTimer = this.flutterMax;
    this.vel.y = -180; // Gentle upward hop
  }

  endFlutter() {
    this.isFluttering = false;
    this.flutterTimer = 0;
  }

  triggerBark() {
    this.barkCooldownTimer = this.barkCooldownMax;
    this.isBarkingAnimation = 0.22;
    const snoutX = this.pos.x + (this.facing > 0 ? this.size.x + 4 : -4);
    const snoutY = this.pos.y + 16;
    this.activeBarks.push(new BarkWave(snoutX, snoutY, this.facing));
    if (this.onBarkTrigger) this.onBarkTrigger();
  }

  update(dt, platforms = []) {
    // Update bark waves
    for (let i = this.activeBarks.length - 1; i >= 0; i--) {
      const b = this.activeBarks[i];
      b.update(dt);
      if (b.isFinished) this.activeBarks.splice(i, 1);
    }

    if (this.barkCooldownTimer > 0) this.barkCooldownTimer -= dt;
    if (this.isBarkingAnimation > 0) this.isBarkingAnimation -= dt;

    // Flutter gravity modification
    if (this.isFluttering) {
      this.flutterTimer -= dt;
      this.gravity = 240; // Reduced hangtime gravity
      if (this.flutterTimer <= 0) {
        this.endFlutter();
      }
    } else {
      this.gravity = 1100;
    }

    // Standard kinematic physics update
    super.update(dt, platforms);

    if (this.isGrounded) {
      this.canFlutter = true;
      this.isFluttering = false;
    }

    // Determine state
    if (this.isBarkingAnimation > 0) {
      this.state = ZiggyState.BARKING;
    } else if (this.isFluttering) {
      this.state = ZiggyState.FLUTTERING;
    } else if (!this.isGrounded) {
      this.state = this.vel.y < 0 ? ZiggyState.JUMPING : ZiggyState.FALLING;
    } else if (Math.abs(this.vel.x) > 20) {
      this.state = ZiggyState.RUNNING;
    } else {
      this.state = ZiggyState.IDLE;
    }

    // Floppy Ear Spring Simulation
    let targetAngle = 0;
    if (this.state === ZiggyState.RUNNING) {
      targetAngle = -0.35 * this.facing; // ears trail behind
      this.walkCycle += dt * 14;
    } else if (this.state === ZiggyState.FLUTTERING) {
      targetAngle = Math.sin(performance.now() * 0.035) * 0.6; // rapid fluttering flapping
    } else if (this.state === ZiggyState.JUMPING) {
      targetAngle = 0.45; // drag down as he rises
    } else if (this.state === ZiggyState.FALLING) {
      targetAngle = -0.5; // fly up as he drops
    } else {
      targetAngle = Math.sin(performance.now() * 0.003) * 0.05; // gentle idle breathing
    }

    // Spring damper equation
    const stiffness = 120;
    const damping = 12;
    const displacement = this.earAngle - targetAngle;
    const force = -stiffness * displacement;
    this.earVel += force * dt;
    this.earVel *= Math.max(0, 1 - damping * dt);
    this.earAngle += this.earVel * dt;

    // Tail wag timer
    const wagSpeed = (Math.abs(this.vel.x) > 20) ? 18 : 6;
    this.tailTimer += dt * wagSpeed;
  }

  draw(ctx) {
    // Draw active bark soundwave rings in world space
    for (const b of this.activeBarks) {
      b.draw(ctx);
    }

    ctx.save();
    // Center coordinate for Ziggy
    const cx = this.pos.x + this.size.x / 2;
    const cy = this.pos.y + this.size.y / 2;

    ctx.translate(cx, cy);
    if (this.facing < 0) {
      ctx.scale(-1, 1);
    }

    this.renderCockerSpaniel(ctx);
    ctx.restore();
  }

  renderCockerSpaniel(ctx) {
    // Palette Tokens matching authentic Ziggy reference photos:
    const C_CHOCOLATE = '#321d16';
    const C_DARK_CHOCOLATE = '#22130e';
    const C_TAN_PIP = '#e2aa68';
    const C_TAN_MUZZLE = '#d49a58';
    const C_NOSE = '#543128';
    const C_AMBER_EYE = '#c6933a';
    const C_WHITE_CHEST = '#f4efe6';
    const C_EAR_HIGHLIGHT = '#9e5528';
    const C_HARNESS = '#1e2229';
    const C_COLLAR_TEAL = '#1b6b65';
    const C_BONE_GOLD = '#f3c948';

    const bounce = (this.state === ZiggyState.RUNNING) ? Math.sin(this.walkCycle * 2) * 2.5 : 0;
    const legSwing = (this.state === ZiggyState.RUNNING) ? Math.sin(this.walkCycle) * 10 : 0;

    // 1. Back Tail with Golden-Tan Feathering & Wagging
    ctx.save();
    const tailWag = Math.sin(this.tailTimer) * 0.35;
    ctx.translate(-20, -6 + bounce);
    ctx.rotate(-0.6 + tailWag);
    // Dark root
    ctx.fillStyle = C_CHOCOLATE;
    ctx.beginPath();
    ctx.ellipse(0, -6, 5, 12, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Feathered golden fringe
    ctx.fillStyle = C_TAN_PIP;
    ctx.beginPath();
    ctx.ellipse(2, -12, 4, 8, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Back Legs with Tan Feathering / Boots
    ctx.fillStyle = C_DARK_CHOCOLATE;
    // Back-left leg
    ctx.fillRect(-16 - legSwing * 0.4, 6 + bounce, 7, 12);
    ctx.fillStyle = C_TAN_MUZZLE; // Tan boot
    ctx.fillRect(-16 - legSwing * 0.4, 14 + bounce, 7, 4);

    // Front-left leg
    ctx.fillStyle = C_DARK_CHOCOLATE;
    ctx.fillRect(10 + legSwing * 0.4, 6 + bounce, 7, 12);
    ctx.fillStyle = C_TAN_MUZZLE;
    ctx.fillRect(10 + legSwing * 0.4, 14 + bounce, 7, 4);

    // 3. Torso (Rich Chocolate Body)
    ctx.fillStyle = C_CHOCOLATE;
    ctx.beginPath();
    ctx.roundRect(-20, -10 + bounce, 38, 22, [12, 12, 10, 10]);
    ctx.fill();

    // 4. White Chest Patch (Bib beneath neck)
    ctx.fillStyle = C_WHITE_CHEST;
    ctx.beginPath();
    ctx.ellipse(12, 0 + bounce, 6, 9, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // 5. Harness & Teal Collar
    ctx.fillStyle = C_HARNESS;
    ctx.beginPath();
    ctx.roundRect(-4, -10 + bounce, 9, 22, 4);
    ctx.fill();
    // Teal Collar
    ctx.fillStyle = C_COLLAR_TEAL;
    ctx.beginPath();
    ctx.roundRect(8, -12 + bounce, 7, 10, 3);
    ctx.fill();
    // Golden Bone Tag
    ctx.fillStyle = C_BONE_GOLD;
    ctx.beginPath();
    ctx.ellipse(12, 0 + bounce, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 6. Foreground Legs (Front-Right & Back-Right)
    ctx.fillStyle = C_CHOCOLATE;
    // Front-right leg
    ctx.fillRect(14 - legSwing * 0.6, 7 + bounce, 8, 12);
    ctx.fillStyle = C_TAN_MUZZLE; // tan boot
    ctx.fillRect(14 - legSwing * 0.6, 15 + bounce, 8, 4);

    // Back-right leg
    ctx.fillStyle = C_CHOCOLATE;
    ctx.fillRect(-12 + legSwing * 0.6, 7 + bounce, 8, 12);
    ctx.fillStyle = C_TAN_MUZZLE;
    ctx.fillRect(-12 + legSwing * 0.6, 15 + bounce, 8, 4);

    // 7. Head (Chocolate Crown)
    ctx.save();
    ctx.translate(14, -14 + bounce);

    ctx.fillStyle = C_CHOCOLATE;
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // 8. Tan Muzzle & Snout
    ctx.fillStyle = C_TAN_MUZZLE;
    ctx.beginPath();
    ctx.ellipse(8, 4, 9, 7, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Dark Liver Nose
    ctx.fillStyle = C_NOSE;
    ctx.beginPath();
    ctx.ellipse(14, 2, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 9. Amber Eye & Soulful Pupil
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(4, -3, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = C_AMBER_EYE;
    ctx.beginPath();
    ctx.ellipse(5, -3, 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#111111'; // pupil
    ctx.beginPath();
    ctx.arc(5.5, -3, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // White eye shine
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(6.5, -4, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // 10. Ziggy's Signature Honey-Tan Eyebrow Pip!
    ctx.fillStyle = C_TAN_PIP;
    ctx.beginPath();
    ctx.ellipse(3, -9, 3.5, 2.2, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // 11. Floppy Cocker Spaniel Ears with Spring Physics & Curls!
    ctx.save();
    ctx.translate(-4, -6);
    ctx.rotate(this.earAngle);

    // Ear body (Dark Chocolate)
    ctx.fillStyle = C_CHOCOLATE;
    ctx.beginPath();
    ctx.ellipse(0, 16, 7, 18, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Chestnut Crimped Ear Highlights & Texture
    ctx.fillStyle = C_EAR_HIGHLIGHT;
    ctx.beginPath();
    ctx.ellipse(2, 22, 5, 12, 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Ear tip curl
    ctx.fillStyle = C_TAN_MUZZLE;
    ctx.beginPath();
    ctx.arc(4, 28, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // restore ear
    ctx.restore(); // restore head
  }
}

```

## FILE: ./src/level/park_level.js

```typescript
// Parallax Park Level & Environment World
import { Platform, PlatformType } from '../engine/physics.js';
import { Collectible, CollectibleType } from '../entities/collectibles.js';
import { Squirrel, MudPuddle, GoalGate } from '../entities/hazards.js';

export class ParkLevel {
  constructor() {
    this.width = 3600;
    this.height = 720;

    this.platforms = [];
    this.collectibles = [];
    this.squirrels = [];
    this.mudPuddles = [];
    this.goalGate = null;

    this.buildLevel();
  }

  buildLevel() {
    // 1. Ground Platforms
    this.platforms.push(new Platform(0, 580, 800, 140, PlatformType.SOLID));
    this.platforms.push(new Platform(860, 580, 750, 140, PlatformType.SOLID));
    this.platforms.push(new Platform(1680, 580, 800, 140, PlatformType.SOLID));
    this.platforms.push(new Platform(2540, 580, 1060, 140, PlatformType.SOLID));

    // 2. Elevated Park Benches & Wooden Bridges (One-Way Ledges)
    // Section 1: Intro garden benches
    this.platforms.push(new Platform(240, 480, 110, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(420, 400, 130, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(620, 460, 120, 16, PlatformType.ONE_WAY));

    // Section 2: Wooden Footbridge over gap
    this.platforms.push(new Platform(780, 520, 120, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(940, 440, 140, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(1140, 370, 150, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(1340, 440, 130, 16, PlatformType.ONE_WAY));

    // Section 3: High Stone Garden Walls & Pergolas
    this.platforms.push(new Platform(1540, 510, 100, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(1750, 450, 140, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(1960, 360, 160, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(2180, 300, 140, 16, PlatformType.ONE_WAY)); // High ear-flutter reach!
    this.platforms.push(new Platform(2380, 420, 120, 16, PlatformType.ONE_WAY));

    // Section 4: Final Sprint towards the Dog Park
    this.platforms.push(new Platform(2680, 470, 130, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(2880, 410, 140, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(3100, 460, 120, 16, PlatformType.ONE_WAY));

    // 3. Golden Bone Collectible Trails
    // Ground trail
    [150, 190, 290, 330, 700, 740, 1020, 1060, 1420, 1460, 2600, 2640].forEach(x => {
      this.collectibles.push(new Collectible(x, 545, CollectibleType.BONE));
    });

    // High arcs requiring Ear-Flap Flutter!
    this.collectibles.push(new Collectible(480, 350, CollectibleType.BONE));
    this.collectibles.push(new Collectible(1210, 320, CollectibleType.BONE));
    this.collectibles.push(new Collectible(2030, 310, CollectibleType.BONE));
    this.collectibles.push(new Collectible(2245, 250, CollectibleType.BONE)); // Apex bone

    // Special Treats: Tennis Ball for speed boosts
    this.collectibles.push(new Collectible(560, 545, CollectibleType.TENNIS_BALL));
    this.collectibles.push(new Collectible(1820, 410, CollectibleType.TENNIS_BALL));

    // Sausage treat
    this.collectibles.push(new Collectible(1210, 545, CollectibleType.SAUSAGE));

    // 4. Critters & Hazards
    this.squirrels.push(new Squirrel(460, 380));
    this.squirrels.push(new Squirrel(1190, 350));
    this.squirrels.push(new Squirrel(2010, 340));

    this.mudPuddles.push(new MudPuddle(500, 574, 90));
    this.mudPuddles.push(new MudPuddle(1880, 574, 110));

    // 5. Goal: The Grand Dog Park Gate
    this.goalGate = new GoalGate(3400, 490);
  }

  drawBackground(ctx, cameraX, viewWidth, viewHeight) {
    // 1. Sky Gradient
    const sky = ctx.createLinearGradient(0, 0, 0, viewHeight);
    sky.addColorStop(0, '#38bdf8');
    sky.addColorStop(0.55, '#bae6fd');
    sky.addColorStop(1, '#e0f2fe');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    // 2. Far Clouds (Parallax Factor 0.1)
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    const cloudOffset = cameraX * 0.1;
    for (let i = 0; i < 8; i++) {
      const cx = (i * 500 - cloudOffset) % (this.width * 0.4);
      const drawX = cx < -200 ? cx + viewWidth + 400 : cx;
      this.drawCloud(ctx, drawX, 80 + (i % 3) * 35, 70 + (i % 2) * 25);
    }
    ctx.restore();

    // 3. Distant Rolling Green Hills (Parallax Factor 0.3)
    ctx.save();
    ctx.fillStyle = '#86efac';
    const hillOffset = cameraX * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, viewHeight);
    for (let x = 0; x <= viewWidth; x += 60) {
      const worldX = x + hillOffset;
      const hillY = 380 + Math.sin(worldX * 0.003) * 60 + Math.cos(worldX * 0.007) * 30;
      ctx.lineTo(x, hillY);
    }
    ctx.lineTo(viewWidth, viewHeight);
    ctx.fill();
    ctx.restore();

    // 4. Midground Park Trees & Fences (Parallax Factor 0.6)
    ctx.save();
    ctx.fillStyle = '#4ade80';
    const treeOffset = cameraX * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, viewHeight);
    for (let x = 0; x <= viewWidth; x += 40) {
      const worldX = x + treeOffset;
      const midY = 460 + Math.sin(worldX * 0.006) * 45;
      ctx.lineTo(x, midY);
    }
    ctx.lineTo(viewWidth, viewHeight);
    ctx.fill();
    ctx.restore();
  }

  drawCloud(ctx, x, y, size) {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.35, 0, Math.PI * 2);
    ctx.arc(x + size * 0.25, y - size * 0.12, size * 0.4, 0, Math.PI * 2);
    ctx.arc(x + size * 0.55, y, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPlatforms(ctx) {
    for (const plat of this.platforms) {
      if (plat.type === PlatformType.SOLID) {
        // Lush Grass Top & Earth Base
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(plat.x, plat.y, plat.width, 14);

        ctx.fillStyle = '#78350f';
        ctx.fillRect(plat.x, plat.y + 14, plat.width, plat.height - 14);

        // Grassy blade fringe
        ctx.fillStyle = '#16a34a';
        for (let bx = plat.x; bx < plat.x + plat.width; bx += 8) {
          ctx.fillRect(bx, plat.y - 2, 4, 3);
        }
      } else {
        // Wooden Footbridge / Park Bench Ledge
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.roundRect(plat.x, plat.y, plat.width, plat.height, 4);
        ctx.fill();

        ctx.fillStyle = '#d97706';
        ctx.fillRect(plat.x + 3, plat.y + 2, plat.width - 6, 4);

        // Bench wooden slats
        ctx.fillStyle = '#78350f';
        for (let lx = plat.x + 12; lx < plat.x + plat.width - 12; lx += 20) {
          ctx.fillRect(lx, plat.y, 2, plat.height);
        }
      }
    }

    // Mud puddles
    for (const mud of this.mudPuddles) {
      mud.draw(ctx);
    }

    // Goal Gate
    if (this.goalGate) {
      this.goalGate.draw(ctx);
    }
  }
}

```

## FILE: ./src/main.js

```typescript
// Clifton Down: Social Dog Walking Sandbox - Main Orchestrator

import { Field, Camera } from './world/field.js';
import { Owner } from './entities/owner.js';
import { CompanionDog, CoatPreset, DogState } from './entities/companion_dog.js';
import { TennisBall } from './entities/toy.js';
import { NetworkManager, NetStatus } from './net/network.js';
import { Protocol, PacketType } from './net/protocol.js';
import { SocialHUD } from './ui/social_hud.js';
import { sound } from './systems/audio.js';
import { TouchControls } from './ui/touch_controls.js';
import { ProximityChat } from './ui/proximity_chat.js';
// Legacy import for static inspection: import { WalkerNPC, JoggerNPC } from './entities/npc.js';
import { ParkNPC, WalkerNPC, JoggerNPC } from './entities/npc.js';
import { NPC_PATHS, getNpcPath } from './world/npc_paths.js';
import { NavigationArrow } from './ui/navigation_arrow.js';
import { weatherClient, WeatherType } from './systems/weather.js';
import { environmentSystem, TimeOfDay } from './world/environment.js';

export class CliftonDownGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    // World & Viewport
    this.field = new Field(2600, 1900);
    this.camera = new Camera(
      typeof window !== 'undefined' ? window.innerWidth : 1280,
      typeof window !== 'undefined' ? window.innerHeight : 720,
      this.field.width,
      this.field.height
    );

    // Local Entities
    const startX = 1350;
    const startY = 1000;
    this.owner = new Owner(startX, startY, 'Walker', true);
    this.dog = new CompanionDog(startX + 40, startY + 20, this.owner, CoatPreset.CHOCOLATE_TAN);
    this.ball = new TennisBall(startX + 20, startY + 20);

    this.camera.follow(this.owner);

    // Ambient Park NPCs (Networked & Solo Pool)
    // Replaced legacy: this.npcs = []; this.field.getParkWaypoints('ladies_mile'); this.field.getParkWaypoints('sea_walls'); this.field.getParkWaypoints('durdham_down');
    this.npcs = new Map();

    // Remote Players (peerId -> { owner: Owner, dog: CompanionDog })
    this.remotePlayers = new Map();

    // Networking
    this.net = new NetworkManager();

    this.net.onNpcSpawn = (npcData) => {
      this.spawnNetworkNpc(npcData);
    };

    this.net.onNpcDespawn = (npcId) => {
      this.removeNpc(npcId);
    };

    this.net.onNpcSnapshot = (snapshotNpcs, serverTime) => {
      this.handleNpcSnapshot(snapshotNpcs, serverTime);
    };

    // UI HUD
    this.hud = new SocialHUD(this.net, this.owner, this.dog, CoatPreset);

    // Directional Navigation Compass Arrow & Waste Management State
    this.navArrow = new NavigationArrow();
    this.hasPoopBag = false;
    this.activePoopPileNearPlayer = null;
    this.activeBinNearPlayer = null;

    // Dog Stray Run-Off and Waste Drop Event Callbacks
    this.dog.onStrayTriggered = (dog) => {
      this.hud.showToast('Your dog ran off! Check the compass arrow 🐕');
      this.navArrow.setTarget(dog.x, dog.y, 'DOG', 'Find your dog!', '#f59e0b');
    };

    this.dog.onStrayResolved = (dog) => {
      if (this.navArrow.target && this.navArrow.target.type === 'DOG') {
        this.navArrow.clearTarget();
      }
      this.hud.showToast('Reunited with your dog! ❤️');
    };

    this.dog.onPoopDropped = (dog, poopPile) => {
      if (this.field && typeof this.field.addPoopPile === 'function') {
        this.field.addPoopPile(poopPile);
      }
      this.hud.showToast('Your dog did a poop! Please pick it up 🟤');
    };

    // Proximity Chat HUD & Dynamic Spatial Clustering
    this.proximityChat = new ProximityChat({
      onSendMessage: (text, clusterPeerIds) => {
        const peers = clusterPeerIds || this.proximityChat.getActivePeers();
        if (this.net && typeof this.net.broadcast === 'function') {
          if (typeof Protocol.createProximityChat === 'function') {
            this.net.broadcast(Protocol.createProximityChat(
              this.net.peerId,
              this.owner.name,
              text,
              this.owner.x,
              this.owner.y,
              peers
            ));
          } else if (typeof Protocol.createChatMessage === 'function') {
            this.net.broadcast(Protocol.createChatMessage(this.net.peerId, text));
          }
        }
        if (sound && typeof sound.playChatChime === 'function') {
          sound.playChatChime();
        } else if (sound && typeof sound.playChat === 'function') {
          sound.playChat();
        }
      },
      onClusterDissolved: (partingContext) => {
        // Parting no longer drops turf markers
        if (this.hud && typeof this.hud.showToast === 'function') {
          this.hud.showToast('💬 Conversation ended.');
        }
      }
    });
    this.hud.proximityChat = this.proximityChat;

    // Touch Controls
    this.joystickActive = false;
    this.touchControls = new TouchControls({
      onMove: (vec) => this.handleJoystickMove(vec),
      onThrow: () => this.throwBall(),
      onLeash: () => this.toggleLeash(),
      onWhistle: () => this.whistleDog(),
      onPet: () => this.petDog(),
      onChat: () => {
        if (this.proximityChat && this.proximityChat.isClusterActive()) {
          const proxInput = document.getElementById('proximity-chat-input');
          if (proxInput) {
            proxInput.focus();
            return;
          }
        }
        this.hud.toggleChatInput();
      }
    });

    // Audio tracking
    this.hasInteracted = false;
    this.lastFootstepTime = 0;

    // Environment & Weather Systems
    this.weatherClient = weatherClient;
    this.environment = environmentSystem;
    this.weatherClient.startAutoRefresh();
    this.weatherClient.addListener((weather) => {
      sound.setWeather(weather);
    });
    // Initial sync:
    sound.setWeather(this.weatherClient.getWeather());
    this.weatherClient.fetchWeather().catch(() => {});

    // Loop Timing
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    this.initCanvas();
    this.bindInputs();
    this.initNetworking();
    this.updateLocalSpawner(0);

    // Start 60fps loop
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame((t) => this.gameLoop(t));
    }
  }

  initCanvas() {
    const resize = () => {
      const width = window.visualViewport ? window.visualViewport.width : window.innerWidth;
      const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      this.canvas.width = width;
      this.canvas.height = height;
      this.camera.resize(this.canvas.width, this.canvas.height);
    };

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 100));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resize);
    }
    resize();
  }

  initNetworking() {
    // Set initial local profile metadata for networking
    this.net.setLocalMeta({
      name: this.owner.name,
      jacketColor: this.owner.jacketColor,
      coatName: this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
      hairStyle: this.owner.hairStyle,
      hairColor: this.owner.hairColor,
      pantsColor: this.owner.pantsColor,
      skinTone: this.owner.skinTone,
      collarColor: this.dog.collarColor,
      personality: this.dog.personality || null
    });

    this.net.onStatusChange = (status, msg) => {
      this.hud.updateNetworkState(status, msg);
    };

    // Auto-connect to dedicated server or join room via query parameters
    if (typeof this.net.autoConnect === 'function') {
      this.net.autoConnect();
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      const targetRoom = urlParams.get('room');
      if (targetRoom) {
        this.net.joinRoom(targetRoom);
      }
    }

    // Helper to resolve CoatPreset from coatName or coatKey
    const resolveCoat = (coatName) => {
      if (!coatName) return CoatPreset.CHOCOLATE_TAN;
      const cn = String(coatName).toLowerCase();
      if (cn.includes('golden')) return CoatPreset.GOLDEN;
      if (cn.includes('black')) return CoatPreset.BLACK_LAB;
      if (cn.includes('jack') || cn.includes('russell')) return CoatPreset.JACK_RUSSELL || CoatPreset.CHOCOLATE_TAN;
      if (cn.includes('setter') || cn.includes('red')) return CoatPreset.RED_SETTER || CoatPreset.CHOCOLATE_TAN;
      if (cn.includes('chocolate') || cn.includes('ziggy')) return CoatPreset.CHOCOLATE_TAN;
      return CoatPreset.CHOCOLATE_TAN;
    };

    // When a peer connects or updates appearance
    this.net.onPeerJoin = (peerId, meta) => {
      if (peerId === this.net.peerId) return;

      const coat = resolveCoat(meta && meta.coatName);

      let existing = this.remotePlayers.get(peerId);
      if (existing) {
        if (meta.name) existing.owner.name = meta.name;
        if (meta.jacketColor) existing.owner.jacketColor = meta.jacketColor;
        if (meta.hairStyle) existing.owner.hairStyle = meta.hairStyle;
        if (meta.hairColor) existing.owner.hairColor = meta.hairColor;
        if (meta.pantsColor) existing.owner.pantsColor = meta.pantsColor;
        if (meta.skinTone) existing.owner.skinTone = meta.skinTone;
        if (meta.collarColor) existing.dog.collarColor = meta.collarColor;
        if (meta.personality) {
          if (typeof existing.dog.setPersonality === 'function') {
            existing.dog.setPersonality(meta.personality);
          } else {
            existing.dog.personality = { ...meta.personality };
          }
        }
        existing.dog.coat = coat;
        return;
      }

      const remoteOwner = new Owner(this.owner.x, this.owner.y, meta?.name || 'Walker', false);
      if (meta?.jacketColor) remoteOwner.jacketColor = meta.jacketColor;
      if (meta?.hairStyle) remoteOwner.hairStyle = meta.hairStyle;
      if (meta?.hairColor) remoteOwner.hairColor = meta.hairColor;
      if (meta?.pantsColor) remoteOwner.pantsColor = meta.pantsColor;
      if (meta?.skinTone) remoteOwner.skinTone = meta.skinTone;

      const remoteDog = new CompanionDog(this.owner.x + 30, this.owner.y + 20, remoteOwner, coat);
      if (meta?.collarColor) remoteDog.collarColor = meta.collarColor;
      if (meta?.personality) {
        if (typeof remoteDog.setPersonality === 'function') {
          remoteDog.setPersonality(meta.personality);
        } else {
          remoteDog.personality = { ...meta.personality };
        }
      }

      this.remotePlayers.set(peerId, { owner: remoteOwner, dog: remoteDog });

      this.hud.updatePlayerCount(this.remotePlayers.size + 1);
      this.hud.showToast(`👋 ${remoteOwner.name} joined the field!`);
    };

    this.net.onPeerLeave = (peerId) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        this.hud.showToast(`🚶 ${p.owner.name} left the park.`);
        this.remotePlayers.delete(peerId);
        this.hud.updatePlayerCount(this.remotePlayers.size + 1);
        if (this.proximityChat) {
          this.proximityChat.update(0, this.owner, this.remotePlayers);
        }
      }
    };

    // Handle Network Events
    this.net.onBallThrown = (data) => {
      this.ball.throw(data.fromX, data.fromY, data.dirX, data.dirY, data.speed);
      sound.playBallPickup();
    };

    this.net.onBark = (peerId, data) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        p.dog.bark(sound);
      }
    };

    this.net.onPet = (peerId) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        p.dog.pet();
      }
    };

    this.net.onWhistle = (peerId, packet) => {
      sound.playWhistle();
      const p = this.remotePlayers.get(peerId);
      if (p) {
        if (p.dog && typeof p.dog.whistleRecall === 'function') {
          p.dog.whistleRecall();
        }
        if (p.owner && typeof p.owner.setEmote === 'function') {
          p.owner.setEmote('📯', 2.0);
        }
      }
    };

    this.net.onChatMessage = (peerId, text) => {
      const p = this.remotePlayers.get(peerId);
      if (this.proximityChat && this.proximityChat.getActivePeers().includes(peerId)) {
        this.proximityChat.addMessage(peerId, (p && p.owner && p.owner.name) || 'Walker', text, false);
      } else {
        if (p && p.owner) {
          p.owner.setChat(text);
        }
      }
    };

    this.net.onEmote = (peerId, emote) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        p.owner.setEmote(emote);
      }
    };

    // Proximity Chat Handlers
    this.net.onProximityChat = (data) => {
      if (!data) return;
      this.proximityChat.addMessage(data.senderId, data.name || 'Walker', data.text, false);
    };

    // Network NPC Spawner Callbacks
    this.net.onNpcSpawn = (npcData) => {
      this.spawnNetworkNpc(npcData);
    };

    this.net.onNpcDespawn = (npcId) => {
      this.removeNpc(npcId);
    };

    this.net.onNpcSnapshot = (snapshotNpcs, serverTime) => {
      this.handleNpcSnapshot(snapshotNpcs, serverTime);
    };

    // Intercept packets on underlying network adapter if adapter lacks native dispatch
    if (this.net.adapter && typeof this.net.adapter.handlePacket === 'function') {
      const originalHandlePacket = this.net.adapter.handlePacket.bind(this.net.adapter);
      this.net.adapter.handlePacket = (...args) => {
        const packet = args.length > 1 ? args[1] : args[0];
        const senderId = args.length > 1 ? args[0] : (packet ? packet.senderId : null);
        if (packet) {
          if (packet.type === PacketType.PROXIMITY_CHAT || packet.type === 'PROXIMITY_CHAT') {
            const data = { ...packet, senderId: packet.senderId || senderId };
            this.net.onProximityChat(data);
            if (this.net.isHost && typeof this.net.relayToOthers === 'function') {
              this.net.relayToOthers(senderId, packet);
            }
            return;
          }
        }
        return originalHandlePacket(...args);
      };
    }

    // Start 16Hz sync loop
    this.net.startSyncLoop(() => {
      return {
        owner: this.owner,
        dog: this.dog
      };
    });
  }

  bindInputs() {
    const handleAudioInteraction = () => {
      sound.unlockAudio();
      if (!this.hasInteracted) {
        this.hasInteracted = true;
        sound.startAmbientBreeze();
      }
    };

    window.addEventListener('keydown', (e) => {
      handleAudioInteraction();

      // Ignore game inputs when typing in chat
      const chatInput = document.getElementById('chat-input');
      const proxInput = document.getElementById('proximity-chat-input');
      if (document.activeElement === chatInput || document.activeElement === proxInput) {
        return;
      }

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.owner.keys.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.owner.keys.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.owner.keys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.owner.keys.right = true;
          break;

        case 'Space':
        case 'KeyT':
          // Throw Tennis Ball
          e.preventDefault();
          this.throwBall();
          break;

        case 'KeyL':
          // Toggle Leash
          this.toggleLeash();
          break;

        case 'KeyC':
          // Toggle Proximity Group Chat
          e.preventDefault();
          if (this.proximityChat && typeof this.proximityChat.toggleVisibility === 'function') {
            this.proximityChat.toggleVisibility();
          }
          break;

        case 'KeyE':
          // Contextual Interact: Pick Up Waste -> Dispose in Bin -> Pet Dog
          if (this.activePoopPileNearPlayer) {
            this.pickUpPoop();
          } else if (this.activeBinNearPlayer && this.hasPoopBag) {
            this.disposePoopBag();
          } else {
            this.petDog();
          }
          break;

        case 'KeyH':
        case 'KeyR':
          // Whistle Recall Dog
          this.whistleDog();
          break;

        case 'Enter':
          e.preventDefault();
          if (this.proximityChat && this.proximityChat.isClusterActive()) {
            const proxInput = document.getElementById('proximity-chat-input');
            if (proxInput) {
              proxInput.focus();
              break;
            }
          }
          this.hud.toggleChatInput();
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.owner.keys.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.owner.keys.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.owner.keys.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.owner.keys.right = false;
          break;
      }
    });

    // Touch & Pointer Audio Unlock
    window.addEventListener('click', handleAudioInteraction);
    window.addEventListener('touchstart', handleAudioInteraction, { passive: true });
    window.addEventListener('pointerdown', handleAudioInteraction, { passive: true });

    // Direct In-World Canvas Tap Gestures
    this.canvas.addEventListener('pointerdown', (e) => {
      handleAudioInteraction();

      // Only handle if directly clicking/tapping the game canvas
      if (e.target !== this.canvas) return;

      // Check if tap was on or close to the companion dog
      const dogScreen = this.camera.worldToScreen(this.dog.x, this.dog.y);
      const distToDog = Math.hypot(e.clientX - dogScreen.x, e.clientY - dogScreen.y);
      if (distToDog < 48) {
        this.petDog();
        return;
      }

      // Check if tap was near active poop pile (< 40px)
      if (this.activePoopPileNearPlayer) {
        const poopScreen = this.camera.worldToScreen(this.activePoopPileNearPlayer.x, this.activePoopPileNearPlayer.y);
        const distToPoopScreen = Math.hypot(e.clientX - poopScreen.x, e.clientY - poopScreen.y);
        if (distToPoopScreen < 40) {
          this.pickUpPoop();
          return;
        }
      }

      // Check if tap was near active dog bin (< 44px)
      if (this.activeBinNearPlayer && this.hasPoopBag) {
        const binScreen = this.camera.worldToScreen(this.activeBinNearPlayer.x, this.activeBinNearPlayer.y);
        const distToBinScreen = Math.hypot(e.clientX - binScreen.x, e.clientY - binScreen.y);
        if (distToBinScreen < 44) {
          this.disposePoopBag();
          return;
        }
      }

      // Open field tap: Throw ball towards tapped world coordinate
      const worldTarget = this.camera.screenToWorld(e.clientX, e.clientY);
      const dx = worldTarget.x - this.owner.x;
      const dy = worldTarget.y - this.owner.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 30) {
        const dirX = dx / dist;
        const dirY = dy / dist;
        this.owner.angle = Math.atan2(dy, dx);
        this.throwBallAt(worldTarget.x, worldTarget.y, dirX, dirY);
      }
    });
  }

  handleJoystickMove(vec) {
    if (vec.active) {
      this.joystickActive = true;
      this.owner.keys.up = vec.vy < -0.2;
      this.owner.keys.down = vec.vy > 0.2;
      this.owner.keys.left = vec.vx < -0.2;
      this.owner.keys.right = vec.vx > 0.2;
      this.owner.angle = vec.angle;
      this.owner.isMoving = true;
    } else if (this.joystickActive) {
      this.joystickActive = false;
      this.owner.keys.up = false;
      this.owner.keys.down = false;
      this.owner.keys.left = false;
      this.owner.keys.right = false;
    }
  }

  toggleLeash() {
    this.owner.isLeashed = !this.owner.isLeashed;
    if (this.touchControls && typeof this.touchControls.setLeashed === 'function') {
      this.touchControls.setLeashed(this.owner.isLeashed);
    }
    this.hud.showToast(this.owner.isLeashed ? '🦮 Leash on: Walking close' : '🐕 Off-lead: Free to roam & play!');

    if (this.net && typeof this.net.broadcast === 'function') {
      this.net.broadcast(Protocol.createSyncState(this.net.peerId, this.owner, this.dog));
    }

    if (this.touchControls && typeof this.touchControls.setLeashed === 'function') {
      this.touchControls.setLeashed(this.owner.isLeashed);
    }
  }

  whistleDog() {
    if (this.dog && typeof this.dog.whistleRecall === 'function') {
      this.dog.whistleRecall();
    }
    if (sound && typeof sound.playWhistle === 'function') {
      sound.playWhistle();
    }
    this.hud.showToast('📯 Whistle! Ziggy recalled to heel');
    if (this.net && typeof this.net.broadcast === 'function') {
      if (typeof Protocol.createWhistle === 'function') {
        this.net.broadcast(Protocol.createWhistle(this.net.peerId, this.owner.x, this.owner.y));
      } else {
        this.net.broadcast({ type: 'WHISTLE', senderId: this.net.peerId, x: this.owner.x, y: this.owner.y, timestamp: Date.now() });
      }
    }
  }

  /**
   * @deprecated Manual barking is retired in Ticket-023 (AC-023.2). Dogs bark autonomously based on personality traits, NPC reactions, and peer responses.
   */
  barkDog() {
    // Deprecated: manual barking retired in favor of autonomous canine behavior
  }

  petDog() {
    const distToDog = Math.hypot(this.owner.x - this.dog.x, this.owner.y - this.dog.y);
    if (distToDog < 90) {
      this.dog.pet();
      sound.playPet();
      this.hud.showToast('❤️ Good dog!');
      this.net.broadcast(Protocol.createPet(this.net.peerId));
    } else {
      this.hud.showToast('🐾 Walk closer to Ziggy to pet!');
    }
  }

  pickUpPoop() {
    if (!this.activePoopPileNearPlayer) return;
    const pile = this.activePoopPileNearPlayer;
    if (this.field && typeof this.field.removePoopPile === 'function') {
      this.field.removePoopPile(pile.id);
    }
    this.hasPoopBag = true;
    this.activePoopPileNearPlayer = null;
    this.hud.showToast('Collected in poop bag 🟤 Find a dog bin!');

    if (this.field && typeof this.field.getNearestBin === 'function') {
      const nearestBin = this.field.getNearestBin(this.owner.x, this.owner.y);
      if (nearestBin && this.navArrow) {
        this.navArrow.setTarget(nearestBin.x, nearestBin.y, 'BIN', 'Nearest Bin', '#10b981');
      }
    }
  }

  disposePoopBag() {
    if (!this.activeBinNearPlayer || !this.hasPoopBag) return;
    this.hasPoopBag = false;
    this.activeBinNearPlayer = null;

    if (this.navArrow && this.navArrow.target && this.navArrow.target.type === 'BIN') {
      this.navArrow.clearTarget();
    }

    if (sound && typeof sound.playPet === 'function') {
      sound.playPet();
    }
    this.hud.showToast('Disposed cleanly! The Downs thanks you 🌳');
  }

  throwBall() {
    const dirX = Math.cos(this.owner.angle);
    const dirY = Math.sin(this.owner.angle);
    this.throwBallAt(this.owner.x + dirX * 320, this.owner.y + dirY * 320, dirX, dirY);
  }

  throwBallAt(targetX, targetY, dirX, dirY) {
    const dist = Math.hypot(targetX - this.owner.x, targetY - this.owner.y);
    const speed = Math.min(500, Math.max(240, dist * 1.4));

    this.ball.throw(this.owner.x, this.owner.y, dirX, dirY, speed, speed * 0.5);
    sound.playBallBounce();

    // Trigger local dog to chase
    this.dog.fetchBall(this.ball);

    // Broadcast throw to multiplayer field
    this.net.broadcast(Protocol.createBallThrown(this.net.peerId, this.owner.x, this.owner.y, dirX, dirY, speed));
    this.hud.showToast('🎾 Ball thrown! Fetch!');
  }

  // Ambient Park NPC Management (Networked & Solo Pool)
  getCurrentServerTime() {
    if (this.net && typeof this.net.getServerTime === 'function') {
      return this.net.getServerTime() / 1000;
    }
    return Date.now() / 1000;
  }

  spawnNetworkNpc(data) {
    const raw = (data && data.npc) ? data.npc : data;
    if (!data || (!data.id && (!raw || !raw.id))) return null;
    const id = (raw && raw.id) || (data && data.id);
    const rawSpawnTime = (raw && raw.spawnTime !== undefined) ? raw.spawnTime : (data && data.spawnTime);
    const spawnTimeSec = (typeof rawSpawnTime === 'number' && rawSpawnTime > 1e10)
      ? rawSpawnTime / 1000
      : (Number(rawSpawnTime) || this.getCurrentServerTime());
    const npcType = (raw && (raw.type || raw.npcType)) || (data && (data.type || data.npcType)) || 'walker';
    const npc = new ParkNPC({
      id: id,
      pathId: (raw && raw.pathId) || (data && data.pathId),
      type: npcType,
      seed: typeof (raw && raw.seed) === 'number' ? raw.seed : (typeof (data && data.seed) === 'number' ? data.seed : 0),
      spawnTime: spawnTimeSec
    });
    const nowSec = this.getCurrentServerTime();
    npc.setClock(nowSec);
    this.npcs.set(id, npc);
    return npc;
  }

  removeNpc(id) {
    if (this.npcs.has(id)) {
      this.npcs.delete(id);
    }
  }

  handleNpcSnapshot(snapshotNpcs, serverTime) {
    if (Array.isArray(snapshotNpcs)) {
      this.npcs.clear();
      for (const npcData of snapshotNpcs) {
        this.spawnNetworkNpc(npcData);
      }
    }
  }

  isNetworkAuthoritative() {
    if (!this.net) return false;
    const isConnected = this.net.status === 'CONNECTED' || this.net.status === 'CONNECTED_SERVER' || this.net.status === 'HOSTING' || this.net.status === 'CONNECTED_PEER';
    return Boolean((this.net.isDedicatedServer || this.net.isPartyKit || this.net.isHost) && isConnected);
  }

  spawnLocalNpc() {
    const usedPathIds = new Set();
    for (const npc of this.npcs.values()) {
      if (npc.pathId) usedPathIds.add(npc.pathId);
    }
    const available = NPC_PATHS.filter(p => !usedPathIds.has(p.id));
    const pool = available.length > 0 ? available : NPC_PATHS;
    if (!pool || pool.length === 0) return null;
    const path = pool[Math.floor(Math.random() * pool.length)];

    let type;
    if (path.type === 'walker') type = 'walker';
    else if (path.type === 'jogger') type = 'jogger';
    else type = Math.random() < 0.5 ? 'walker' : 'jogger';

    const nowSec = this.getCurrentServerTime();
    const seed = Math.floor(Math.random() * 0xFFFFFFFF);
    const id = `npc-solo-${Math.random().toString(36).slice(2, 8)}-${Math.floor(nowSec)}`;

    const npc = new ParkNPC({
      id,
      pathId: path.id,
      type,
      seed,
      spawnTime: nowSec
    });
    npc.setClock(nowSec);
    this.npcs.set(id, npc);
    return npc;
  }

  updateLocalSpawner(dt) {
    if (this.isNetworkAuthoritative()) return;
    while (this.npcs.size < 5) {
      const spawned = this.spawnLocalNpc();
      if (!spawned) break;
    }
  }

  gameLoop(timestamp) {
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  update(dt) {
    // 0. Update Environment System & Audio Diurnal Sync
    if (this.environment) {
      this.environment.update(dt, this.weatherClient ? this.weatherClient.getWeather() : null);
      if (sound && typeof sound.setTimeOfDay === 'function') {
        sound.setTimeOfDay(this.environment.getTimeOfDay());
      }
    }

    // 1. Update Field & Ambient Particles
    this.field.update(dt);

    // 2. Gather all other dogs for social play-bow reactions
    const allDogs = [this.dog];
    for (const p of this.remotePlayers.values()) {
      allDogs.push(p.dog);
    }

    const nowSec = this.getCurrentServerTime();
    const npcList = Array.from(this.npcs.values());

    // Collect all avoidance entities for NPCs
    // const avoidanceEntities = [this.owner, this.dog, ...this.npcs];
    const avoidanceEntities = [this.owner, this.dog, ...npcList];
    for (const p of this.remotePlayers.values()) {
      avoidanceEntities.push(p.owner);
      avoidanceEntities.push(p.dog);
    }

    // Update ambient NPCs
    // npc.update(dt, this.field, avoidanceEntities)
    for (const [id, npc] of this.npcs) {
      npc.update(dt, nowSec, avoidanceEntities);
      if (npc.isDone(nowSec)) {
        this.npcs.delete(id);
      }
    }

    // Update solo spawner if in solo/offline mode
    this.updateLocalSpawner(dt);

    // 3. Update Local Entities
    this.owner.update(dt, this.field);
    // this.dog.update(dt, this.field, allDogs, this.ball, this.npcs);
    this.dog.update(dt, this.field, allDogs, this.ball, Array.from(this.npcs.values()));
    this.ball.update(dt, this.field);

    // Grass footstep sound
    if (this.owner.isMoving && timestampNow() - this.lastFootstepTime > 320) {
      this.lastFootstepTime = timestampNow();
      sound.playFootstep();
    }

    // 4. Update Remote Peers via Interpolators
    for (const [peerId, interpolatorData] of this.net.remotePeers) {
      if (peerId === this.net.peerId) continue;

      let remote = this.remotePlayers.get(peerId);
      const meta = interpolatorData.meta || {};
      let coat = CoatPreset.CHOCOLATE_TAN;
      const coatName = (meta && meta.coatName) ? meta.coatName : '';
      if (coatName.includes('Golden')) coat = CoatPreset.GOLDEN;
      else if (coatName.includes('Black')) coat = CoatPreset.BLACK_LAB;

      if (!remote) {
        // Auto-create remote player if not yet instantiated
        const remoteOwner = new Owner(this.owner.x, this.owner.y, meta.name || 'Walker', false);
        remoteOwner.jacketColor = meta.jacketColor || '#1e3a8a';
        const remoteDog = new CompanionDog(this.owner.x + 30, this.owner.y + 20, remoteOwner, coat);
        remote = { owner: remoteOwner, dog: remoteDog };
        this.remotePlayers.set(peerId, remote);
        this.hud.updatePlayerCount(this.remotePlayers.size + 1);
      } else {
        // Continuously reflect interpolatorData.meta changes
        if (meta.name && remote.owner.name !== meta.name) {
          remote.owner.name = meta.name;
        }
        if (meta.jacketColor && remote.owner.jacketColor !== meta.jacketColor) {
          remote.owner.jacketColor = meta.jacketColor;
        }
        if (meta.coatName && remote.dog.coat !== coat) {
          remote.dog.coat = coat;
        }
        if (meta.personality) {
          if (typeof remote.dog.setPersonality === 'function') {
            remote.dog.setPersonality(meta.personality);
          } else {
            remote.dog.personality = { ...meta.personality };
          }
        }
      }

      const ownerState = interpolatorData.ownerInterpolator.update(dt);
      if (ownerState) {
        remote.owner.x = ownerState.x;
        remote.owner.y = ownerState.y;
        remote.owner.vx = ownerState.vx;
        remote.owner.vy = ownerState.vy;
        remote.owner.angle = ownerState.angle;
        remote.owner.isMoving = ownerState.isMoving;
        remote.owner.isLeashed = !!ownerState.isLeashed;
        remote.owner.depthY = remote.owner.y + 12;
      }

      const dogState = interpolatorData.dogInterpolator.update(dt);
      if (dogState) {
        remote.dog.x = dogState.x;
        remote.dog.y = dogState.y;
        remote.dog.vx = dogState.vx;
        remote.dog.vy = dogState.vy;
        remote.dog.angle = dogState.angle;
        remote.dog.state = dogState.state;
        remote.dog.depthY = remote.dog.y + 6;
      }
    }

    // 5. Update Proximity Chat Spatial Clustering
    if (this.proximityChat) {
      if (this.owner && this.net && this.net.peerId) {
        this.owner.id = this.net.peerId;
      }
      this.proximityChat.update(dt, this.owner, this.remotePlayers);
    }

    // 6. Host broadcasts authoritative ball state when ball is in play
    if (this.net.isHost && (this.ball.isThrown || this.ball.isCarried || Math.hypot(this.ball.vx, this.ball.vy) > 1)) {
      this.net.broadcast(Protocol.createBallSync(this.ball));
    }

    // 7. Navigation Arrow & Waste/Bin Proximity Tracking
    if (this.navArrow) {
      this.navArrow.update(dt);
      if (this.dog && this.dog.isLost) {
        this.navArrow.setTarget(this.dog.x, this.dog.y, 'DOG', 'Find your dog!', '#f59e0b');
      }
    }

    // Proximity to poop piles (< 38px)
    let foundPoop = null;
    if (this.field && Array.isArray(this.field.poopPiles) && !this.hasPoopBag) {
      for (const pile of this.field.poopPiles) {
        const distToPile = Math.hypot(pile.x - this.owner.x, pile.y - this.owner.y);
        if (distToPile < 38) {
          foundPoop = pile;
          break;
        }
      }
    }
    this.activePoopPileNearPlayer = foundPoop;

    // Proximity to dog bins (< 42px)
    let foundBin = null;
    if (this.field && Array.isArray(this.field.bins) && this.hasPoopBag) {
      for (const bin of this.field.bins) {
        const distToBin = Math.hypot(bin.x - this.owner.x, bin.y - this.owner.y);
        if (distToBin < 42) {
          foundBin = bin;
          break;
        }
      }
    }
    this.activeBinNearPlayer = foundBin;

    // 8. Update Camera
    this.camera.update(dt);
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply Camera translation
    this.camera.apply(this.ctx);

    // Gather all dynamic entities to depth-sort
    const dynamicEntities = [
      this.owner,
      this.dog,
      this.ball
    ];

    // for (const npc of this.npcs) {
    for (const npc of this.npcs.values()) {
      dynamicEntities.push(npc);
    }

    for (const p of this.remotePlayers.values()) {
      dynamicEntities.push(p.owner);
      dynamicEntities.push(p.dog);
    }

    // Field renders background turf, then Y-sorts trees, benches, owners, dogs, and balls
    this.field.render(this.ctx, this.camera, dynamicEntities);

    // In-World Contextual Interaction Badges
    if (this.activePoopPileNearPlayer) {
      this.drawInteractionPrompt(
        this.ctx,
        this.activePoopPileNearPlayer.x,
        this.activePoopPileNearPlayer.y - 18,
        '[E] Pick up waste'
      );
    } else if (this.activeBinNearPlayer && this.hasPoopBag) {
      this.drawInteractionPrompt(
        this.ctx,
        this.activeBinNearPlayer.x,
        this.activeBinNearPlayer.y - 28,
        '[E] Dispose in bin'
      );
    }

    // Restore Camera
    this.camera.restore(this.ctx);

    // Full-screen environment lighting pass and weather particles overlay
    if (this.environment) {
      const players = [this.owner, this.dog];
      for (const p of this.remotePlayers.values()) {
        players.push(p.owner, p.dog);
      }
      this.environment.render(this.ctx, this.camera, this.field, this.canvas.width, this.canvas.height, players);
    }

    // Screen-Space HUD: Directional Navigation Arrow
    if (this.navArrow && this.ctx && this.camera && this.owner) {
      this.navArrow.draw(this.ctx, this.camera, this.owner.x, this.owner.y);
    }
  }

  drawInteractionPrompt(ctx, worldX, worldY, text) {
    ctx.save();
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textMetrics = ctx.measureText(text);
    const badgeW = textMetrics.width + 16;
    const badgeH = 22;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;

    const r = badgeH / 2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(worldX - badgeW / 2, worldY - badgeH / 2, badgeW, badgeH, r);
    } else {
      ctx.rect(worldX - badgeW / 2, worldY - badgeH / 2, badgeW, badgeH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, worldX, worldY + 0.5);
    ctx.restore();
  }
}

function timestampNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new CliftonDownGame();
  });
}

export default CliftonDownGame;

```

## FILE: ./src/net/network.js

```typescript
// Universal Multiplayer Network Engine (Supporting Dedicated WebSocket Server & In-Browser PeerJS)

import { PacketType, Protocol } from './protocol.js';
import { WebSocketNetworkManager, WSStatus } from './ws_network.js';

export const NetStatus = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  HOSTING: 'HOSTING',
  CONNECTED_PEER: 'CONNECTED_PEER',
  CONNECTED_SERVER: 'CONNECTED_SERVER',
  ERROR: 'ERROR'
};

export class EntityInterpolator {
  constructor() {
    this.target = null;
    this.current = null;
    this.lerpRate = 0.22;
  }

  setTarget(snapshot) {
    if (!this.current) {
      this.current = { ...snapshot };
    }
    for (const key of Object.keys(snapshot)) {
      if (key !== 'x' && key !== 'y' && key !== 'angle') {
        this.current[key] = snapshot[key];
      }
    }
    this.target = { ...snapshot };
  }

  update(dt) {
    if (!this.target || !this.current) return this.current;

    for (const key of Object.keys(this.target)) {
      if (key !== 'x' && key !== 'y' && key !== 'angle') {
        this.current[key] = this.target[key];
      }
    }

    const rate = 1 - Math.exp(-this.lerpRate * 60 * dt);
    this.current.x += (this.target.x - this.current.x) * rate;
    this.current.y += (this.target.y - this.current.y) * rate;
    this.current.vx = this.target.vx;
    this.current.vy = this.target.vy;

    // Angle shortest path interpolation
    let dAngle = this.target.angle - this.current.angle;
    while (dAngle > Math.PI) dAngle -= Math.PI * 2;
    while (dAngle < -Math.PI) dAngle += Math.PI * 2;
    this.current.angle += dAngle * rate;

    return this.current;
  }
}

// PeerJS-based P2P Network Implementation
export class PeerNetworkManager {
  constructor() {
    this.status = NetStatus.OFFLINE;
    this.peer = null;
    this.peerId = null;
    this.roomId = null;
    this.isHost = false;
    this.isDedicatedServer = false;

    this.localMeta = {
      name: 'Park Walker',
      jacketColor: '#1e3a8a',
      coatName: 'Chocolate & Tan (Ziggy)'
    };

    this.connections = new Map();
    this.hostConnection = null;
    this.remotePeers = new Map();

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

    this.serverClockOffset = 0;

    this.syncInterval = null;
    this.syncHz = 16;
  }

  setLocalMeta(meta) {
    this.localMeta = { ...this.localMeta, ...meta };
  }

  updateServerClock(serverTime) {
    if (typeof serverTime === 'number' && !isNaN(serverTime)) {
      this.serverClockOffset = serverTime - Date.now();
    }
  }

  getServerTime() {
    return Date.now() + (this.serverClockOffset || 0);
  }

  setStatus(newStatus, msg = '') {
    this.status = newStatus;
    if (this.onStatusChange) {
      this.onStatusChange(newStatus, msg);
    }
  }

  async ensurePeerJS() {
    if (window.Peer) return window.Peer;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
      script.async = true;
      script.onload = () => {
        if (window.Peer) resolve(window.Peer);
        else reject(new Error('PeerJS failed to load'));
      };
      script.onerror = () => reject(new Error('Network error loading PeerJS CDN'));
      document.head.appendChild(script);
    });
  }

  generateRoomId() {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `clifton-${num}`;
  }

  getShareUrl() {
    if (!this.roomId) return window.location.href;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    url.searchParams.set('p2p', '1');
    return url.toString();
  }

  ensureRemotePeer(peerId, meta = {}) {
    let peerData = this.remotePeers.get(peerId);
    if (!peerData) {
      peerData = {
        ownerInterpolator: new EntityInterpolator(),
        dogInterpolator: new EntityInterpolator(),
        meta: {
          name: meta.name || 'Player',
          jacketColor: meta.jacketColor || '#14532d',
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

  async hostRoom(customRoomId = null) {
    try {
      this.setStatus(NetStatus.CONNECTING, 'Initializing PeerJS host...');
      await this.ensurePeerJS();

      this.roomId = customRoomId || this.generateRoomId();
      this.isHost = true;

      this.peer = new window.Peer(this.roomId, { debug: 1 });

      this.peer.on('open', (id) => {
        this.peerId = id;
        this.setStatus(NetStatus.HOSTING, `Field hosted! Room: ${this.roomId}`);
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.warn('PeerJS Host Error:', err);
        if (err.type === 'unavailable-id') {
          this.hostRoom(this.generateRoomId());
        } else {
          this.setStatus(NetStatus.ERROR, err.message);
        }
      });
    } catch (e) {
      console.error('Failed to host room:', e);
      this.setStatus(NetStatus.ERROR, 'Could not host room');
    }
  }

  async joinRoom(roomId) {
    try {
      this.setStatus(NetStatus.CONNECTING, `Connecting to field: ${roomId}...`);
      await this.ensurePeerJS();

      this.roomId = roomId;
      this.isHost = false;

      this.peer = new window.Peer({ debug: 1 });

      this.peer.on('open', (id) => {
        this.peerId = id;
        const conn = this.peer.connect(roomId, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', () => {
          this.setStatus(NetStatus.CONNECTED_PEER, `Joined field: ${roomId}`);
          conn.send(Protocol.createHello(
            this.peerId,
            this.localMeta.name,
            this.localMeta.jacketColor,
            this.localMeta.coatName,
            this.localMeta
          ));
        });

        conn.on('data', (data) => {
          this.handlePacket(conn.peer, data);
        });

        conn.on('close', () => {
          this.setStatus(NetStatus.OFFLINE, 'Host closed connection');
          this.remotePeers.delete(roomId);
          if (this.onPeerLeave) this.onPeerLeave(roomId);
        });

        conn.on('error', (err) => {
          console.warn('Connection error:', err);
          this.setStatus(NetStatus.ERROR, 'Connection failed');
        });
      });

      this.peer.on('error', (err) => {
        console.warn('PeerJS Client Error:', err);
        this.setStatus(NetStatus.ERROR, err.message);
      });
    } catch (e) {
      console.error('Failed to join room:', e);
      this.setStatus(NetStatus.ERROR, 'Could not join room');
    }
  }

  handleIncomingConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
    });

    conn.on('data', (data) => {
      this.handlePacket(conn.peer, data);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.remotePeers.delete(conn.peer);
      if (this.onPeerLeave) {
        this.onPeerLeave(conn.peer);
      }
      this.broadcast({ type: PacketType.PEER_LEFT, peerId: conn.peer });
    });
  }

  handlePacket(senderId, packet) {
    if (!packet || !packet.type) return;

    switch (packet.type) {
      case PacketType.HELLO: {
        const meta = {
          name: packet.name || 'Visitor',
          jacketColor: packet.jacketColor || '#14532d',
          coatName: packet.dogCoatName || 'Chocolate & Tan (Ziggy)',
          hairStyle: packet.hairStyle,
          hairColor: packet.hairColor,
          pantsColor: packet.pantsColor,
          skinTone: packet.skinTone,
          collarColor: packet.collarColor,
          personality: packet.personality || null
        };
        this.ensureRemotePeer(senderId, meta);
        if (this.onPeerJoin) this.onPeerJoin(senderId, meta);

        if (this.isHost) {
          const conn = this.connections.get(senderId);
          if (conn && conn.open) {
            const peersList = [];
            for (const [id, d] of this.remotePeers) {
              if (id !== senderId) peersList.push({ id, ...d.meta });
            }
            conn.send(Protocol.createWelcome(this.peerId, this.localMeta, peersList));
          }
          for (const [id, c] of this.connections) {
            if (id !== senderId && c.open) c.send(packet);
          }
        }
        break;
      }

      case PacketType.WELCOME: {
        const hostId = packet.hostId || senderId;
        const hostMeta = packet.hostMeta ? {
          name: packet.hostMeta.name,
          jacketColor: packet.hostMeta.jacketColor,
          coatName: packet.hostMeta.coatName || packet.hostMeta.dogCoatName,
          hairStyle: packet.hostMeta.hairStyle,
          hairColor: packet.hostMeta.hairColor,
          pantsColor: packet.hostMeta.pantsColor,
          skinTone: packet.hostMeta.skinTone,
          collarColor: packet.hostMeta.collarColor,
          personality: packet.hostMeta.personality || null
        } : {
          name: 'Host Walker',
          jacketColor: '#1e3a8a',
          coatName: 'Chocolate & Tan (Ziggy)',
          personality: null
        };
        this.ensureRemotePeer(hostId, hostMeta);
        if (this.onPeerJoin) this.onPeerJoin(hostId, hostMeta);

        if (Array.isArray(packet.peers)) {
          for (const p of packet.peers) {
            if (p.id && p.id !== this.peerId) {
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
              } : p;
              this.ensureRemotePeer(p.id, meta);
              if (this.onPeerJoin) this.onPeerJoin(p.id, meta);
            }
          }
        }
        break;
      }

      case PacketType.SYNC_STATE: {
        let peerData = this.remotePeers.get(senderId);
        if (!peerData) {
          peerData = this.ensureRemotePeer(senderId, { name: 'Player' });
          if (this.onPeerJoin) this.onPeerJoin(senderId, peerData.meta);
        }

        peerData.ownerInterpolator.setTarget(packet.owner);
        peerData.dogInterpolator.setTarget(packet.dog);

        if (this.isHost) {
          for (const [id, c] of this.connections) {
            if (id !== senderId && c.open) c.send(packet);
          }
        }
        break;
      }

      case PacketType.BALL_THROWN: {
        if (this.onBallThrown) this.onBallThrown(packet);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.BALL_SYNC: {
        if (this.onBallSync) this.onBallSync(packet);
        break;
      }

      case PacketType.BARK: {
        if (this.onBark) this.onBark(senderId, packet);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.PET: {
        if (this.onPet) this.onPet(senderId);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.CHAT_MESSAGE: {
        if (this.onChatMessage) this.onChatMessage(senderId, packet.text);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.EMOTE: {
        if (this.onEmote) this.onEmote(senderId, packet.emote);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.WHISTLE: {
        if (this.onWhistle) this.onWhistle(senderId, packet);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.PEER_LEFT: {
        const leftId = packet.peerId || senderId;
        this.remotePeers.delete(leftId);
        if (this.onPeerLeave) this.onPeerLeave(leftId);
        break;
      }

      case PacketType.NPC_SPAWN: {
        if (typeof packet.serverTime === 'number') {
          this.updateServerClock(packet.serverTime);
        } else if (typeof packet.timestamp === 'number') {
          this.updateServerClock(packet.timestamp);
        }
        if (this.onNpcSpawn) this.onNpcSpawn(packet.npc || packet);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.NPC_DESPAWN: {
        if (typeof packet.serverTime === 'number') {
          this.updateServerClock(packet.serverTime);
        } else if (typeof packet.timestamp === 'number') {
          this.updateServerClock(packet.timestamp);
        }
        if (this.onNpcDespawn) this.onNpcDespawn(packet.id, packet);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.NPC_SNAPSHOT: {
        if (typeof packet.serverTime === 'number') {
          this.updateServerClock(packet.serverTime);
        } else if (typeof packet.timestamp === 'number') {
          this.updateServerClock(packet.timestamp);
        }
        if (this.onNpcSnapshot) this.onNpcSnapshot(packet.npcs || [], packet.serverTime || this.getServerTime(), packet);
        break;
      }
    }
  }

  relayToOthers(excludePeerId, packet) {
    if (!this.isHost) return;
    for (const [id, c] of this.connections) {
      if (id !== excludePeerId && c.open) {
        c.send(packet);
      }
    }
  }

  broadcast(packet) {
    if (this.isHost) {
      for (const conn of this.connections.values()) {
        if (conn.open) conn.send(packet);
      }
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(packet);
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
    if (this.peer) this.peer.destroy();
    this.connections.clear();
    this.remotePeers.clear();
    this.setStatus(NetStatus.OFFLINE);
  }
}

// Universal Network Manager Factory & Polymorphic Wrapper
export class NetworkManager {
  constructor() {
    this._serverClockOffset = 0;
    this._onNpcSpawn = null;
    this._onNpcDespawn = null;
    this._onNpcSnapshot = null;

    const urlParams = new URLSearchParams(window.location.search);
    const serverParam = urlParams.get('server');
    const partyParam = urlParams.get('party') || urlParams.get('partykit');
    const isP2P = urlParams.get('p2p') === '1';

    // Auto-detect whether to use PartyKit Edge, Dedicated WebSocket Server, or PeerJS P2P
    const isHttp = window.location.protocol.startsWith('http');
    const isPartyHost = window.location.hostname.includes('workers.dev') ||
                        window.location.hostname.includes('partykit.dev') ||
                        window.location.port === '8787' ||
                        window.location.port === '1999' ||
                        Boolean(partyParam);

    if (!isP2P && (partyParam || isPartyHost)) {
      // 1. PartyKit Global Edge Mode
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const targetHost = partyParam && partyParam !== '1' ? partyParam : window.location.host;
      this.wsEndpoint = `${proto}//${targetHost}`;
      this.adapter = new WebSocketNetworkManager();
      this.isDedicatedServer = true;
      this.isPartyKit = true;
      this.adapter.isPartyKit = true;
    } else if (!isP2P && (serverParam || isHttp)) {
      // 2. Local/Dedicated Python Microserver Mode
      let wsEndpoint = '';
      if (serverParam) {
        let clean = serverParam.trim();
        if (clean.startsWith('http://')) clean = clean.replace('http://', 'ws://');
        else if (clean.startsWith('https://')) clean = clean.replace('https://', 'wss://');
        else if (!clean.startsWith('ws://') && !clean.startsWith('wss://')) clean = `wss://${clean}`;

        if (!clean.endsWith('/ws')) clean = clean.replace(/\/+$/, '') + '/ws';
        wsEndpoint = clean;
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsEndpoint = `${proto}//${window.location.host}/ws`;
      }

      this.adapter = new WebSocketNetworkManager();
      this.isDedicatedServer = true;
      this.isPartyKit = false;
      this.wsEndpoint = wsEndpoint;
    } else {
      // 3. PeerJS P2P Fallback Mode
      this.adapter = new PeerNetworkManager();
      this.isDedicatedServer = false;
      this.isPartyKit = false;
    }

    // Proxy properties & methods
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        const val = target.adapter[prop];
        if (typeof val === 'function') return val.bind(target.adapter);
        return val;
      },
      set: (target, prop, value) => {
        if (prop in target) {
          target[prop] = value;
          return true;
        }
        target.adapter[prop] = value;
        return true;
      }
    });
  }

  autoConnect() {
    const urlParams = new URLSearchParams(window.location.search);
    const targetRoom = urlParams.get('room') || 'the-commons';

    if (this.isDedicatedServer && this.wsEndpoint) {
      this.adapter.connect(this.wsEndpoint, targetRoom);
    } else if (urlParams.get('room')) {
      this.adapter.joinRoom(targetRoom);
    }
  }

  get serverClockOffset() {
    return this.adapter ? this.adapter.serverClockOffset : (this._serverClockOffset || 0);
  }

  set serverClockOffset(val) {
    this._serverClockOffset = val;
    if (this.adapter) {
      this.adapter.serverClockOffset = val;
    }
  }

  get onNpcSpawn() {
    return this.adapter ? this.adapter.onNpcSpawn : this._onNpcSpawn;
  }

  set onNpcSpawn(val) {
    this._onNpcSpawn = val;
    if (this.adapter) {
      this.adapter.onNpcSpawn = val;
    }
  }

  get onNpcDespawn() {
    return this.adapter ? this.adapter.onNpcDespawn : this._onNpcDespawn;
  }

  set onNpcDespawn(val) {
    this._onNpcDespawn = val;
    if (this.adapter) {
      this.adapter.onNpcDespawn = val;
    }
  }

  get onNpcSnapshot() {
    return this.adapter ? this.adapter.onNpcSnapshot : this._onNpcSnapshot;
  }

  set onNpcSnapshot(val) {
    this._onNpcSnapshot = val;
    if (this.adapter) {
      this.adapter.onNpcSnapshot = val;
    }
  }

  updateServerClock(serverTime) {
    if (this.adapter && typeof this.adapter.updateServerClock === 'function') {
      return this.adapter.updateServerClock(serverTime);
    }
    if (typeof serverTime === 'number' && !isNaN(serverTime)) {
      this.serverClockOffset = serverTime - Date.now();
    }
  }

  getServerTime() {
    if (this.adapter && typeof this.adapter.getServerTime === 'function') {
      return this.adapter.getServerTime();
    }
    return Date.now() + (this.serverClockOffset || 0);
  }
}

```

## FILE: ./src/net/protocol.js

```typescript
// Pure In-Browser WebRTC Multiplayer Protocol & Packet Definitions

export const PacketType = {
  HELLO: 'HELLO',
  WELCOME: 'WELCOME',
  SYNC_STATE: 'SYNC_STATE',
  BALL_THROWN: 'BALL_THROWN',
  BALL_SYNC: 'BALL_SYNC',
  BARK: 'BARK',
  PET: 'PET',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  EMOTE: 'EMOTE',
  WHISTLE: 'WHISTLE',
  PROXIMITY_CHAT: 'PROXIMITY_CHAT',
  PEER_LEFT: 'PEER_LEFT',
  NPC_SPAWN: 'NPC_SPAWN',
  NPC_DESPAWN: 'NPC_DESPAWN',
  NPC_SNAPSHOT: 'NPC_SNAPSHOT'
};

export class Protocol {
  static createHello(peerId, name, jacketColor, dogCoatName, extraMeta = {}) {
    return {
      type: PacketType.HELLO,
      senderId: peerId,
      name,
      jacketColor,
      dogCoatName,
      hairStyle: extraMeta.hairStyle,
      hairColor: extraMeta.hairColor,
      pantsColor: extraMeta.pantsColor,
      skinTone: extraMeta.skinTone,
      collarColor: extraMeta.collarColor,
      personality: extraMeta.personality || null,
      timestamp: Date.now()
    };
  }

  static createWelcome(hostId, hostMeta, peersList = [], ballState = null) {
    return {
      type: PacketType.WELCOME,
      senderId: hostId,
      hostId: hostId,
      hostMeta: hostMeta,
      peers: peersList,
      ball: ballState,
      timestamp: Date.now()
    };
  }

  static createSyncState(peerId, owner, dog) {
    return {
      type: PacketType.SYNC_STATE,
      senderId: peerId,
      timestamp: Date.now(),
      owner: {
        x: Math.round(owner.x * 10) / 10,
        y: Math.round(owner.y * 10) / 10,
        vx: Math.round(owner.vx),
        vy: Math.round(owner.vy),
        angle: Math.round(owner.angle * 100) / 100,
        isMoving: owner.isMoving,
        isLeashed: owner.isLeashed
      },
      dog: {
        x: Math.round(dog.x * 10) / 10,
        y: Math.round(dog.y * 10) / 10,
        vx: Math.round(dog.vx),
        vy: Math.round(dog.vy),
        angle: Math.round(dog.angle * 100) / 100,
        state: dog.state
      }
    };
  }

  static createBallThrown(peerId, fromX, fromY, dirX, dirY, speed) {
    return {
      type: PacketType.BALL_THROWN,
      senderId: peerId,
      fromX,
      fromY,
      dirX,
      dirY,
      speed,
      timestamp: Date.now()
    };
  }

  static createBallSync(ball) {
    return {
      type: PacketType.BALL_SYNC,
      x: Math.round(ball.x * 10) / 10,
      y: Math.round(ball.y * 10) / 10,
      z: Math.round(ball.z * 10) / 10,
      vx: Math.round(ball.vx),
      vy: Math.round(ball.vy),
      vz: Math.round(ball.vz),
      isThrown: ball.isThrown,
      isCarried: ball.isCarried,
      timestamp: Date.now()
    };
  }

  static createBark(peerId, x, y) {
    return {
      type: PacketType.BARK,
      senderId: peerId,
      x,
      y,
      timestamp: Date.now()
    };
  }

  static createPet(peerId) {
    return {
      type: PacketType.PET,
      senderId: peerId,
      timestamp: Date.now()
    };
  }

  static createChatMessage(peerId, text) {
    return {
      type: PacketType.CHAT_MESSAGE,
      senderId: peerId,
      text,
      timestamp: Date.now()
    };
  }

  static createEmote(peerId, emote) {
    return {
      type: PacketType.EMOTE,
      senderId: peerId,
      emote,
      timestamp: Date.now()
    };
  }

  static createWhistle(peerId, x, y) {
    return {
      type: PacketType.WHISTLE,
      senderId: peerId,
      x,
      y,
      timestamp: Date.now()
    };
  }

  static createProximityChat(peerId, name, text, x, y, clusterPeers = []) {
    return {
      type: PacketType.PROXIMITY_CHAT,
      senderId: peerId,
      name,
      text,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      clusterPeers,
      timestamp: Date.now()
    };
  }

  static createNpcSpawn(id, pathId, npcType, seed, spawnTime) {
    const now = Date.now();
    return {
      type: PacketType.NPC_SPAWN,
      id,
      pathId,
      npcType,
      seed: typeof seed === 'number' ? seed : 0,
      spawnTime: typeof spawnTime === 'number' ? spawnTime : now,
      npc: {
        id,
        pathId,
        type: npcType,
        npcType,
        seed: typeof seed === 'number' ? seed : 0,
        spawnTime: typeof spawnTime === 'number' ? spawnTime : now
      },
      timestamp: now
    };
  }

  static createNpcDespawn(id) {
    return {
      type: PacketType.NPC_DESPAWN,
      id,
      timestamp: Date.now()
    };
  }

  static createNpcSnapshot(npcs = [], serverTime = Date.now()) {
    return {
      type: PacketType.NPC_SNAPSHOT,
      npcs: (npcs || []).map(n => ({
        id: n.id,
        pathId: n.pathId,
        type: n.type || n.npcType,
        npcType: n.npcType || n.type,
        seed: n.seed,
        spawnTime: n.spawnTime
      })),
      serverTime,
      timestamp: Date.now()
    };
  }

  static validateNpcSpawn(packet) {
    if (!packet || packet.type !== PacketType.NPC_SPAWN) return false;
    if (typeof packet.id !== 'string') return false;
    if (typeof packet.pathId !== 'string') return false;
    const typeValid = (packet.npcType === 'walker' || packet.npcType === 'jogger' ||
      (packet.npc && (packet.npc.type === 'walker' || packet.npc.type === 'jogger')));
    if (!typeValid) return false;
    if (typeof packet.seed !== 'number') return false;
    if (typeof packet.spawnTime !== 'number') return false;
    return true;
  }

  static validateNpcDespawn(packet) {
    if (!packet || packet.type !== PacketType.NPC_DESPAWN) return false;
    if (typeof packet.id !== 'string' || packet.id.length === 0) return false;
    return true;
  }

  static validateNpcSnapshot(packet) {
    if (!packet || packet.type !== PacketType.NPC_SNAPSHOT) return false;
    if (!Array.isArray(packet.npcs)) return false;
    if (typeof packet.serverTime !== 'number') return false;
    return true;
  }
}


```

## FILE: ./src/net/ws_network.js

```typescript
// Dedicated WebSocket Multiplayer Network Engine for Clifton Down
import { PacketType, Protocol } from './protocol.js';
import { EntityInterpolator } from './network.js';

export const WSStatus = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR'
};

export class WebSocketNetworkManager {
  constructor() {
    this.status = WSStatus.OFFLINE;
    this.ws = null;
    this.serverUrl = null;
    this.peerId = `walker-${Math.floor(1000 + Math.random() * 9000)}`;
    this.roomId = 'the-commons';
    this.isHost = false;
    this.isDedicatedServer = true;
    this.isPartyKit = false;

    // Local player metadata to broadcast during handshakes
    this.localMeta = {
      name: 'Walker',
      jacketColor: '#1e3a8a',
      coatName: 'Chocolate & Tan (Ziggy)'
    };

    // Remote entity interpolators (peerId -> { ownerInterpolator, dogInterpolator, meta })
    this.remotePeers = new Map();

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

    // Authoritative server clock estimation
    this.serverClockOffset = 0;

    // Sync broadcast ticker
    this.syncInterval = null;
    this.syncHz = 16; // 16 updates per sec

    // Auto-reconnect handling
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 6;
    this.reconnectTimeout = null;
    this.manualDisconnect = false;
  }

  isPartyKitHost(url) {
    if (!url) {
      if (typeof window !== 'undefined') {
        const host = window.location.hostname.toLowerCase();
        const port = window.location.port;
        const search = new URLSearchParams(window.location.search);
        return host.includes('workers.dev') ||
               host.includes('partykit.dev') ||
               port === '8787' ||
               port === '1999' ||
               search.has('party') ||
               search.has('partyserver') ||
               search.has('partykit');
      }
      return false;
    }
    const str = String(url).toLowerCase();
    return str.includes('workers.dev') ||
           str.includes('partykit.dev') ||
           str.includes(':8787') ||
           str.includes(':1999') ||
           str.includes('/parties/') ||
           str === 'party' ||
           str === 'partyserver' ||
           str === 'partykit';
  }

  buildWebSocketUrl(serverEndpoint, roomId) {
    if (this.isPartyKitHost(serverEndpoint)) {
      this.isPartyKit = true;
      let base = serverEndpoint;
      if (!base || base === 'partykit' || base === 'party') {
        const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = typeof window !== 'undefined' ? window.location.host : 'localhost:1999';
        base = `${proto}//${host}`;
      }
      let clean = base.trim();
      if (clean.startsWith('http://')) clean = clean.replace('http://', 'ws://');
      else if (clean.startsWith('https://')) clean = clean.replace('https://', 'wss://');
      else if (!clean.startsWith('ws://') && !clean.startsWith('wss://')) clean = `wss://${clean}`;

      if (clean.includes('/parties/')) {
        return new URL(clean);
      }
      clean = clean.replace(/\/+$/, '');
      return new URL(`${clean}/parties/parkserver/${roomId}`);
    }

    // Standard Dedicated Microserver fallback
    this.isPartyKit = false;
    const wsUrl = new URL(serverEndpoint);
    wsUrl.searchParams.set('room', roomId);
    wsUrl.searchParams.set('peer', this.peerId);
    return wsUrl;
  }

  setLocalMeta(meta) {
    this.localMeta = { ...this.localMeta, ...meta };
  }

  updateServerClock(serverTime) {
    if (typeof serverTime === 'number' && !isNaN(serverTime)) {
      this.serverClockOffset = serverTime - Date.now();
    }
  }

  getServerTime() {
    return Date.now() + (this.serverClockOffset || 0);
  }

  setStatus(newStatus, msg = '') {
    this.status = newStatus;
    if (this.onStatusChange) {
      this.onStatusChange(newStatus, msg);
    }
  }

  getShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('server');
    url.searchParams.delete('party');
    url.searchParams.delete('partykit');
    if (this.roomId && this.roomId !== 'the-commons' && this.roomId !== 'clifton-field') {
      url.searchParams.set('room', this.roomId);
    } else {
      url.searchParams.delete('room');
    }
    return url.toString();
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

  connect(serverEndpoint, roomId = null) {
    this.manualDisconnect = false;
    this.serverUrl = serverEndpoint;
    if (roomId) this.roomId = roomId;

    const modeLabel = this.isPartyKitHost(serverEndpoint) ? 'PartyKit edge room' : 'dedicated park server';
    this.setStatus(WSStatus.CONNECTING, `Connecting to ${modeLabel}...`);

    try {
      const wsUrl = this.buildWebSocketUrl(this.serverUrl, this.roomId);
      this.ws = new WebSocket(wsUrl.toString());

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus(WSStatus.CONNECTED, `Park connected (${this.roomId})`);

        // Send HELLO handshake packet
        this.broadcast(Protocol.createHello(
          this.peerId,
          this.localMeta.name,
          this.localMeta.jacketColor,
          this.localMeta.coatName,
          this.localMeta
        ));
      };

      this.ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handlePacket(packet);
        } catch (e) {
          console.warn('Invalid JSON packet received from server:', e);
        }
      };

      this.ws.onclose = () => {
        if (!this.manualDisconnect) {
          this.scheduleReconnect();
        } else {
          this.setStatus(WSStatus.OFFLINE, 'Disconnected');
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket connection error:', err);
        this.setStatus(WSStatus.ERROR, 'Server connection error');
      };
    } catch (e) {
      console.error('Failed to instantiate WebSocket:', e);
      this.setStatus(WSStatus.ERROR, 'Could not connect to server');
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 8000);
      this.setStatus(WSStatus.RECONNECTING, `Connection lost. Reconnecting in ${Math.round(delay / 1000)}s...`);

      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        if (!this.manualDisconnect) {
          this.connect(this.serverUrl, this.roomId);
        }
      }, delay);
    } else {
      this.setStatus(WSStatus.OFFLINE, 'Server unreachable. Playing in solo mode.');
    }
  }

  handlePacket(packet) {
    if (!packet || !packet.type) return;

    const senderId = packet.senderId;
    if (senderId === this.peerId) return; // Ignore echoes of our own packets

    switch (packet.type) {
      case PacketType.HELLO: {
        const isNewPeer = !this.remotePeers.has(senderId);
        const meta = {
          name: packet.name || 'Walker',
          jacketColor: packet.jacketColor || '#1e3a8a',
          coatName: packet.dogCoatName || 'Chocolate & Tan (Ziggy)',
          hairStyle: packet.hairStyle,
          hairColor: packet.hairColor,
          pantsColor: packet.pantsColor,
          skinTone: packet.skinTone,
          collarColor: packet.collarColor,
          personality: packet.personality || null
        };
        this.ensureRemotePeer(senderId, meta);
        if (this.onPeerJoin) {
          this.onPeerJoin(senderId, meta);
        }
        // Bidirectional greeting: ensure late joiners receive our appearance
        if (isNewPeer) {
          this.broadcast(Protocol.createHello(
            this.peerId,
            this.localMeta.name,
            this.localMeta.jacketColor,
            this.localMeta.coatName,
            this.localMeta
          ));
        }
        break;
      }

      case PacketType.WELCOME: {
        if (packet.peerId) {
          this.peerId = packet.peerId;
        }

        // Immediately re-broadcast the local player's HELLO packet so existing peers and server
        // record the profile mapped directly to the authoritative connection ID
        this.broadcast(Protocol.createHello(
          this.peerId,
          this.localMeta.name,
          this.localMeta.jacketColor,
          this.localMeta.coatName,
          this.localMeta
        ));

        // Populate all existing peers in the room
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
              this.ensureRemotePeer(peerId, meta);
              if (this.onPeerJoin) {
                this.onPeerJoin(peerId, meta);
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
          if (this.onPeerJoin) {
            this.onPeerJoin(senderId, peerData.meta);
          }
        }
        if (packet.owner) peerData.ownerInterpolator.setTarget(packet.owner);
        if (packet.dog) peerData.dogInterpolator.setTarget(packet.dog);
        break;
      }

      case PacketType.BALL_THROWN: {
        if (this.onBallThrown) this.onBallThrown(packet);
        break;
      }

      case PacketType.BALL_SYNC: {
        if (this.onBallSync) this.onBallSync(packet);
        break;
      }

      case PacketType.BARK: {
        if (this.onBark) this.onBark(senderId, packet);
        break;
      }

      case PacketType.PET: {
        if (this.onPet) this.onPet(senderId);
        break;
      }

      case PacketType.CHAT_MESSAGE: {
        if (this.onChatMessage) this.onChatMessage(senderId, packet.text);
        break;
      }

      case PacketType.EMOTE: {
        if (this.onEmote) this.onEmote(senderId, packet.emote);
        break;
      }

      case PacketType.WHISTLE: {
        if (this.onWhistle) this.onWhistle(senderId, packet);
        break;
      }

      case PacketType.PEER_LEFT: {
        const leftId = packet.peerId || senderId;
        this.remotePeers.delete(leftId);
        if (this.onPeerLeave) this.onPeerLeave(leftId);
        break;
      }

      case PacketType.NPC_SPAWN: {
        if (typeof packet.serverTime === 'number') {
          this.updateServerClock(packet.serverTime);
        } else if (typeof packet.timestamp === 'number') {
          this.updateServerClock(packet.timestamp);
        }
        if (this.onNpcSpawn) {
          this.onNpcSpawn(packet.npc || packet);
        }
        break;
      }

      case PacketType.NPC_DESPAWN: {
        if (typeof packet.serverTime === 'number') {
          this.updateServerClock(packet.serverTime);
        } else if (typeof packet.timestamp === 'number') {
          this.updateServerClock(packet.timestamp);
        }
        if (this.onNpcDespawn) {
          this.onNpcDespawn(packet.id, packet);
        }
        break;
      }

      case PacketType.NPC_SNAPSHOT: {
        if (typeof packet.serverTime === 'number') {
          this.updateServerClock(packet.serverTime);
        } else if (typeof packet.timestamp === 'number') {
          this.updateServerClock(packet.timestamp);
        }
        if (this.onNpcSnapshot) {
          this.onNpcSnapshot(packet.npcs || [], packet.serverTime || this.getServerTime(), packet);
        }
        break;
      }
    }
  }

  broadcast(packet) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (!packet.senderId) packet.senderId = this.peerId;
      this.ws.send(JSON.stringify(packet));
    }
  }

  startSyncLoop(getLocalStateFn) {
    if (this.syncInterval) clearInterval(this.syncInterval);

    this.syncInterval = setInterval(() => {
      if (this.status !== WSStatus.CONNECTED) return;

      const state = getLocalStateFn();
      if (!state || !state.owner || !state.dog) return;

      const packet = Protocol.createSyncState(this.peerId, state.owner, state.dog);
      this.broadcast(packet);
    }, 1000 / this.syncHz);
  }

  stop() {
    this.manualDisconnect = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.remotePeers.clear();
    this.setStatus(WSStatus.OFFLINE);
  }
}

```

## FILE: ./src/style.css

```typescript
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Press+Start+2P&display=swap');

:root {
  --bg-color: #0b1117;
  --hud-bg: rgba(18, 26, 36, 0.82);
  --hud-border: rgba(255, 255, 255, 0.14);
  --accent-gold: #f3c948;
  --accent-green: #52a447;
  --accent-teal: #1b6b65;
  --accent-blue: #3b82f6;
  --text-main: #f8fafc;
  --text-muted: #94a3b8;

  /* Curated High-Contrast Player Color Palette */
  --player-color-cyan: #38bdf8;
  --player-color-emerald: #4ade80;
  --player-color-amber: #fbbf24;
  --player-color-coral: #fb7185;
  --player-color-violet: #c084fc;
  --player-color-mint: #2dd4bf;
  --player-color-peach: #f97316;
  --player-color-azure: #60a5fa;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  user-select: none;
}

body {
  background-color: var(--bg-color);
  color: var(--text-main);
  font-family: 'Outfit', sans-serif;
  overflow: hidden;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

#game-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #2b4920;
}

#game-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

/* Glassmorphic Top Bar / Room HUD */
#hud-overlay {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  pointer-events: none;
  z-index: 20;
}

.hud-panel {
  background: var(--hud-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--hud-border);
  border-radius: 12px;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  max-width: calc(100vw - 32px);
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}

.hud-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}

.hud-pill-badge {
  background: var(--accent-green);
  color: #fff;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.btn-share {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.btn-share:hover {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  transform: translateY(-1px);
}

.btn-share:active {
  transform: translateY(0);
}

/* Bottom Controls Guidance (Retired bottom toolbar) */
#controls-hint {
  display: none !important;
}

/* Chat Input Bar */
#chat-container {
  position: absolute;
  bottom: 64px;
  left: 50%;
  transform: translateX(-50%);
  display: none;
  z-index: 30;
}

#chat-input {
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 20px;
  padding: 8px 18px;
  color: #fff;
  font-size: 0.95rem;
  width: 340px;
  outline: none;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  font-family: inherit;
}

/* Touch Controls Mobile Overlay */
#touch-controls-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 25;
  touch-action: none;
}

#touch-joystick-zone {
  position: absolute;
  bottom: max(24px, env(safe-area-inset-bottom));
  left: max(24px, env(safe-area-inset-left));
  width: 130px;
  height: 130px;
  pointer-events: auto;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

#joystick-base {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.45);
  border: 2px solid rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
}

#joystick-knob {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border: 2px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  transform: translate(0px, 0px);
  will-change: transform;
}

#touch-action-pad {
  position: absolute;
  bottom: max(24px, env(safe-area-inset-bottom));
  right: max(20px, env(safe-area-inset-right));
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  width: 160px;
  justify-content: flex-end;
  pointer-events: auto;
  touch-action: none;
}

.touch-action-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(18, 26, 36, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1.5px solid rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.15s ease;
  touch-action: none;
}

.touch-action-btn:active {
  transform: scale(0.92);
  background: rgba(59, 130, 246, 0.6);
}

.touch-action-btn.off-leash {
  background: rgba(217, 119, 6, 0.4);
  border-color: rgba(245, 158, 11, 0.7);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.35);
}

/* Customizer Modal & Styling */
#customizer-modal {
  display: none;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(15, 23, 42, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  padding: 22px;
  color: #f8fafc;
  width: 90%;
  max-width: 360px;
  z-index: 100;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  max-height: 90vh;
  overflow-y: auto;
}

.customizer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.customizer-header h3 {
  font-size: 1.15rem;
  font-weight: 700;
  color: #f8fafc;
}

.customizer-close {
  cursor: pointer;
  opacity: 0.7;
  font-size: 1.5rem;
  line-height: 1;
  background: none;
  border: none;
  color: #f8fafc;
  padding: 4px;
  transition: opacity 0.15s ease;
}

.customizer-close:hover {
  opacity: 1;
}

/* Glassmorphic Tab Bar */
.customizer-tabs {
  display: flex;
  gap: 6px;
  background: rgba(30, 41, 59, 0.7);
  padding: 4px;
  border-radius: 10px;
  margin-bottom: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.customizer-tab-btn {
  flex: 1;
  background: transparent;
  border: none;
  color: #94a3b8;
  padding: 8px 10px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s ease;
  font-family: inherit;
}

.customizer-tab-btn.active {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.customizer-tab-btn:hover:not(.active) {
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.06);
}

.customizer-tab-pane {
  display: none;
}

.customizer-tab-pane.active {
  display: block;
}

.cust-form-group {
  margin-bottom: 14px;
}

.cust-label {
  font-size: 0.82rem;
  color: #94a3b8;
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
}

.cust-input, .cust-select {
  width: 100%;
  padding: 8px 12px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  color: #fff;
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.15s ease;
}

.cust-input:focus, .cust-select:focus {
  border-color: #3b82f6;
}

/* Palette swatches */
.cust-palette {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.color-swatch {
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  position: relative;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.active {
  border: 2.5px solid #fff;
  box-shadow: 0 0 0 2px #3b82f6, 0 2px 8px rgba(0, 0, 0, 0.5);
}

/* Button style selectors (e.g. Hair Style) */
.cust-btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cust-style-btn {
  flex: 1;
  min-width: 64px;
  padding: 7px 10px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  color: #cbd5e1;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  text-align: center;
}

.cust-style-btn:hover {
  background: #334155;
  color: #fff;
}

.cust-style-btn.active {
  background: #2563eb;
  border-color: #3b82f6;
  color: #fff;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
}

.btn-primary-cust {
  width: 100%;
  padding: 11px;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
  margin-top: 6px;
  transition: all 0.2s ease;
  font-family: inherit;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
}

.btn-primary-cust:hover {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  transform: translateY(-1px);
}

.btn-primary-cust:active {
  transform: translateY(0);
}

/* ==========================================================================
   Prominent Glassmorphic Proximity Group Chat HUD & Top-Right Action Buttons
   ========================================================================== */

#btn-customize {
  position: fixed;
  top: 16px;
  right: 66px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(56, 189, 248, 0.35);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 16px rgba(56, 189, 248, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #f8fafc;
  font-size: 1.2rem;
  z-index: 60;
  pointer-events: auto;
  transition: transform 0.18s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

#btn-customize:hover {
  transform: scale(1.05);
  background: rgba(30, 41, 59, 0.9);
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 20px rgba(56, 189, 248, 0.3);
}

#btn-customize:active {
  transform: scale(0.95);
}

.style-toggle-icon {
  font-size: 1.2rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

#chat-toggle-btn {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(56, 189, 248, 0.35);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 16px rgba(56, 189, 248, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #f8fafc;
  font-size: 1.2rem;
  z-index: 60;
  transition: transform 0.18s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

#chat-toggle-btn:hover {
  transform: scale(1.05);
  background: rgba(30, 41, 59, 0.9);
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 20px rgba(56, 189, 248, 0.3);
}

#chat-toggle-btn:active {
  transform: scale(0.95);
}

#chat-toggle-btn.active {
  border-color: rgba(56, 189, 248, 0.7);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 20px rgba(56, 189, 248, 0.35);
  background: rgba(15, 23, 42, 0.95);
}

#chat-toggle-btn.collapsed {
  opacity: 0.85;
}

#proximity-chat-panel {
  position: fixed;
  top: 64px;
  right: 16px;
  width: 340px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 120px);
  background: rgba(15, 23, 42, 0.88);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 24px rgba(56, 189, 248, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 50;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-12px) scale(0.98);
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
  user-select: text;
}

#proximity-chat-panel.active {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}

#proximity-chat-panel.hidden {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-12px) scale(0.98);
}

/* Header & Participant Pills */
#proximity-chat-header {
  padding: 12px 16px 10px;
  background: rgba(30, 41, 59, 0.6);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.proximity-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.proximity-chat-icon {
  font-size: 1.15rem;
  line-height: 1;
}

.proximity-title-text {
  font-size: 0.95rem;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: 0.2px;
}

.proximity-badge {
  margin-left: auto;
  font-size: 0.72rem;
  font-weight: 700;
  color: #4ade80;
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(74, 222, 128, 0.3);
  padding: 2px 8px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.proximity-participants {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.78rem;
  color: #94a3b8;
}

.proximity-participants-label {
  font-weight: 600;
  color: #94a3b8;
}

.proximity-pills-list {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.participant-pill {
  display: inline-flex;
  align-items: center;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #e0f2fe;
  font-size: 0.74rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  letter-spacing: 0.2px;
}

.participant-pill.local {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(74, 222, 128, 0.35);
  color: #dcfce7;
}

/* Conversation Thread */
#proximity-chat-messages {
  flex: 1;
  min-height: 120px;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scroll-behavior: smooth;
  background: rgba(15, 23, 42, 0.4);
}

#proximity-chat-messages::-webkit-scrollbar {
  width: 5px;
}

#proximity-chat-messages::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.proximity-message {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 0.86rem;
  line-height: 1.35;
  word-break: break-word;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
  align-self: flex-start;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  animation: proximityMessageIn 0.15s ease-out;
}

@keyframes proximityMessageIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.proximity-message.local {
  align-self: flex-end;
  background: linear-gradient(135deg, rgba(30, 58, 138, 0.85), rgba(15, 23, 42, 0.9));
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #ffffff;
}

/* Pruning & Expiration Visual Transitions */
.proximity-message.expiring,
.proximity-message.pruning {
  opacity: 0;
  transform: scale(0.95);
  transition: opacity 0.25s ease, transform 0.25s ease;
  pointer-events: none;
}

.proximity-message.system {
  align-self: center;
  max-width: 100%;
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 2px 6px;
  font-size: 0.74rem;
  color: #94a3b8;
  font-style: italic;
  text-align: center;
}

.proximity-message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.proximity-message-sender {
  font-weight: 700;
  font-size: 0.76rem;
  color: var(--player-color-cyan);
  transition: color 0.15s ease;
}

.proximity-message.local .proximity-message-sender {
  /* Inherits or allows custom assigned player color inline styles cleanly */
  color: inherit;
}

.proximity-message-time {
  font-size: 0.68rem;
  color: #64748b;
  margin-left: auto;
}

.proximity-message.local .proximity-message-time {
  color: #94a3b8;
  opacity: 0.8;
}

.proximity-message-text {
  font-size: 0.86rem;
  line-height: 1.35;
  user-select: text;
  word-break: break-word;
  transition: color 0.15s ease;
}

.proximity-message.local .proximity-message-text {
  /* Inherits or allows custom assigned player color inline styles cleanly */
  color: inherit;
}

.proximity-system-text {
  font-size: 0.74rem;
  color: #94a3b8;
}

/* Prominent Input Container & Buttons */
#proximity-chat-input-container {
  padding: 10px 14px 12px;
  background: rgba(15, 23, 42, 0.75);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.proximity-emoji-bar {
  display: flex;
  gap: 6px;
  align-items: center;
}

.proximity-emoji-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 4px 9px;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  color: #fff;
  transition: transform 0.12s ease, background 0.15s ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.proximity-emoji-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  transform: scale(1.14);
}

.proximity-emoji-btn:active {
  transform: scale(0.95);
}

#proximity-chat-input-bar {
  display: flex;
  width: 100%;
  gap: 8px;
  align-items: center;
}

#proximity-chat-input {
  width: 100%;
  flex: 1;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 10px;
  padding: 8px 12px;
  color: #f8fafc;
  font-family: inherit;
  font-size: 0.86rem;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  user-select: text;
}

#proximity-chat-input:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25);
}

#proximity-chat-input::placeholder {
  color: #64748b;
  font-size: 0.82rem;
}

.proximity-send-btn {
  background: linear-gradient(135deg, #0284c7, #0369a1);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(2, 132, 199, 0.35);
}

.proximity-send-btn:hover {
  background: linear-gradient(135deg, #38bdf8, #0284c7);
  transform: translateY(-1px);
}

.proximity-send-btn:active {
  transform: translateY(0);
}

/* Canine Personality Editor Styles */
.cust-personality-group {
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
  margin-top: 8px;
  backdrop-filter: blur(8px);
}

.cust-trait-row {
  margin-bottom: 12px;
}

.cust-trait-row:last-child {
  margin-bottom: 2px;
}

.cust-trait-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.cust-trait-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: #e2e8f0;
}

.cust-trait-badge {
  font-size: 0.75rem;
  font-weight: 700;
  background: #2563eb;
  color: #fff;
  border-radius: 10px;
  padding: 2px 8px;
  min-width: 20px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(37, 99, 235, 0.4);
}

/* Customized Range Input */
.cust-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  background: #334155;
  border-radius: 4px;
  outline: none;
  cursor: pointer;
  transition: background 0.15s ease;
  margin: 4px 0 2px 0;
}

.cust-range:focus {
  background: #475569;
}

/* WebKit Slider Thumb */
.cust-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3b82f6;
  border: 2px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.cust-range::-webkit-slider-thumb:hover {
  transform: scale(1.18);
  background: #60a5fa;
}

.cust-range::-webkit-slider-thumb:active {
  transform: scale(1.25);
  background: #2563eb;
}

/* Firefox Slider Thumb */
.cust-range::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3b82f6;
  border: 2px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.cust-range::-moz-range-thumb:hover {
  transform: scale(1.18);
  background: #60a5fa;
}

.cust-range::-moz-range-thumb:active {
  transform: scale(1.25);
  background: #2563eb;
}

/* Firefox Slider Track */
.cust-range::-moz-range-track {
  background: #334155;
  height: 6px;
  border-radius: 4px;
}

/* Responsive Media Queries for Mobile & Coarse Pointers */
@media (max-width: 768px), (pointer: coarse) {
  #controls-hint {
    display: none !important;
  }

  #hud-overlay {
    top: max(10px, env(safe-area-inset-top));
    left: max(10px, env(safe-area-inset-left));
    right: max(10px, env(safe-area-inset-right));
    justify-content: flex-start;
    align-items: flex-start;
    gap: 8px;
  }

  .hud-panel {
    padding: 6px 10px;
    flex-wrap: wrap;
    gap: 8px;
    max-width: calc(100vw - 20px);
  }

  .hud-pill {
    font-size: 0.8rem;
    gap: 5px;
  }

  .hud-pill-badge {
    font-size: 0.7rem;
    padding: 2px 6px;
  }

  .btn-share {
    padding: 5px 10px;
    font-size: 0.78rem;
  }

  #chat-container {
    bottom: max(96px, env(safe-area-inset-bottom));
    width: 90%;
  }

  #chat-input {
    width: 100%;
    font-size: 0.88rem;
  }

  #customizer-modal {
    max-width: 92vw;
    padding: 18px 16px;
  }

  .color-swatch {
    width: 34px;
    height: 34px;
    min-width: 34px;
    min-height: 34px;
  }

  #btn-customize {
    top: 12px;
    right: 58px;
    width: 38px;
    height: 38px;
    font-size: 1.1rem;
    z-index: 60;
  }

  #chat-toggle-btn {
    top: 12px;
    right: 12px;
    width: 38px;
    height: 38px;
    font-size: 1.1rem;
    z-index: 60;
  }

  #proximity-chat-panel {
    top: 58px;
    right: 12px;
    left: auto;
    bottom: auto;
    width: min(340px, calc(100vw - 24px));
    max-height: calc(100vh - 100px);
    transform: translateY(-12px) scale(0.98);
  }

  #proximity-chat-panel.active {
    transform: translateY(0) scale(1);
  }

  #proximity-chat-panel.hidden {
    transform: translateY(-12px) scale(0.98);
  }

  #proximity-chat-messages {
    max-height: calc(100vh - 250px);
    padding: 8px 10px;
  }

  .cust-range::-webkit-slider-thumb {
    width: 24px;
    height: 24px;
  }

  .cust-range::-moz-range-thumb {
    width: 24px;
    height: 24px;
  }

  .cust-trait-row {
    margin-bottom: 14px;
  }
}



```

## FILE: ./src/systems/audio.js

```typescript
// Procedural Web Audio API Sound Synthesizer & Clifton Down Ambient Nature Engine

class SoundSynthesizer {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.ambientStarted = false;
    this.breezeNode = null;

    // Weather & diurnal state
    this.currentWeather = 'CLEAR';
    this.currentTimeOfDay = 'DAY';

    // Rain synthesis nodes
    this.rainSource = null;
    this.rainGainNode = null;
    this.rainLowpassFilter = null;
    this.rainBandpassFilter = null;

    // Periodic weather effect timers
    this.weatherTimer = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  unlockAudio() {
    if (!this.ctx) {
      this.ensureContext();
    } else if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Realistic Cheerful Cocker Spaniel Bark
  playBark() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // Formant filter for canine vocal tract resonance
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, t);
    filter.Q.setValueAtTime(3.5, t);

    // Pitch envelope: sharp attack, slight upward scoop, quick decay
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.18);

    // Volume envelope
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);
    gain.gain.setValueAtTime(0, t + 0.23);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.24);
  }

  // Authentic Procedural Dog Training Whistle
  playWhistle() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;

    // Carrier Oscillator (Sine wave sweeping ~2400 Hz to ~2850 Hz)
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(2400, t);
    carrier.frequency.exponentialRampToValueAtTime(2850, t + 0.18);

    // Overtone Oscillator (Sine wave at ~3600 Hz with lower gain)
    const overtone = this.ctx.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(3600, t);
    overtone.frequency.exponentialRampToValueAtTime(4250, t + 0.18);

    const overtoneGain = this.ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.22, t);

    // Vibrato LFO at 17 Hz for characteristic whistle warble
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(17, t);
    lfoGain.gain.setValueAtTime(45, t); // 45 Hz frequency modulation depth

    lfo.connect(lfoGain);
    lfoGain.connect(carrier.frequency);

    // Master whistle gain envelope: fast attack (~0.02s), sustained pip (~0.18s), quick decay (~0.06s)
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(0, t);
    masterGain.gain.linearRampToValueAtTime(0.28, t + 0.02);
    masterGain.gain.setValueAtTime(0.28, t + 0.20);
    masterGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    masterGain.gain.setValueAtTime(0, t + 0.27);

    // Routing
    carrier.connect(masterGain);
    overtone.connect(overtoneGain);
    overtoneGain.connect(masterGain);
    masterGain.connect(this.ctx.destination);

    // Start & stop nodes
    lfo.start(t);
    carrier.start(t);
    overtone.start(t);

    lfo.stop(t + 0.28);
    carrier.stop(t + 0.28);
    overtone.stop(t + 0.28);
  }

  // Tennis ball bounce pop
  playBallBounce() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.06);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.09);
  }

  // Petting Chime
  playPet() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.05);

      gain.gain.setValueAtTime(0.12, t + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.05 + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t + idx * 0.05);
      osc.stop(t + idx * 0.05 + 0.26);
    });
  }

  // Soft grass footstep rustle
  playFootstep() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * 0.04;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900 + Math.random() * 200, t);
    filter.Q.setValueAtTime(2.0, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(t);
  }

  // Authentic British Birdsong Variety:
  // Blackbird: Melodic flute-like whistles sweeping 1800 Hz to 2600 Hz in expressive 2-3 note motifs
  playBlackbird() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    // 2 to 3 note motif
    const noteCount = Math.random() < 0.5 ? 2 : 3;
    const motifNotes = [
      { startFreq: 1850 + Math.random() * 200, endFreq: 2400 + Math.random() * 200, dur: 0.16 },
      { startFreq: 2300 + Math.random() * 200, endFreq: 2000 + Math.random() * 150, dur: 0.18 },
      { startFreq: 2100 + Math.random() * 200, endFreq: 2550 + Math.random() * 100, dur: 0.22 }
    ];

    let noteOffset = 0;
    for (let i = 0; i < noteCount; i++) {
      const note = motifNotes[i];
      const startT = t + noteOffset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.startFreq, startT);
      osc.frequency.exponentialRampToValueAtTime(note.endFreq, startT + note.dur * 0.85);

      gain.gain.setValueAtTime(0, startT);
      gain.gain.linearRampToValueAtTime(0.045, startT + 0.02);
      gain.gain.setValueAtTime(0.04, startT + note.dur * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.001, startT + note.dur);
      gain.gain.setValueAtTime(0, startT + note.dur + 0.01);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startT);
      osc.stop(startT + note.dur + 0.02);

      noteOffset += note.dur + 0.06 + Math.random() * 0.04;
    }
  }

  // European Robin: High-frequency crystalline trills (3200 Hz to 4200 Hz with fast vibrato modulation)
  playRobin() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const trillDuration = 0.24 + Math.random() * 0.08;
    const baseFreq = 3400 + Math.random() * 500; // 3400 - 3900 Hz

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.linearRampToValueAtTime(Math.min(4200, baseFreq + 300), t + trillDuration);

    // Fast vibrato modulation (~28-35 Hz)
    const vibrato = this.ctx.createOscillator();
    const vibratoGain = this.ctx.createGain();
    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime(32, t);
    vibratoGain.gain.setValueAtTime(120, t); // modulation depth in Hz

    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.035, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + trillDuration);
    gain.gain.setValueAtTime(0, t + trillDuration + 0.01);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    vibrato.start(t);
    osc.start(t);

    vibrato.stop(t + trillDuration + 0.02);
    osc.stop(t + trillDuration + 0.02);
  }

  // Woodpigeon: Gentle, low-frequency rhythmic cooing (two warm rounded pulses around 380-420 Hz)
  playWoodpigeon() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const pulses = [
      { start: 0, dur: 0.22, freq: 390 },
      { start: 0.28, dur: 0.32, freq: 410 }
    ];

    pulses.forEach(p => {
      const pulseT = t + p.start;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, pulseT);
      osc.frequency.linearRampToValueAtTime(p.freq - 15, pulseT + p.dur);

      gain.gain.setValueAtTime(0, pulseT);
      gain.gain.linearRampToValueAtTime(0.04, pulseT + 0.05);
      gain.gain.setValueAtTime(0.035, pulseT + p.dur * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, pulseT + p.dur);
      gain.gain.setValueAtTime(0, pulseT + p.dur + 0.01);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(pulseT);
      osc.stop(pulseT + p.dur + 0.02);
    });
  }

  // Intermittent birdsong in the trees - randomly selects among authentic British species
  playBirdChirp() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const r = Math.random();
    if (r < 0.40) {
      this.playBlackbird();
    } else if (r < 0.75) {
      this.playRobin();
    } else {
      this.playWoodpigeon();
    }
  }

  // Background Breeze in the trees:
  // Breathing canopy wind with dual-filter low-pass pink noise swept by slow sinusoidal LFO (period ~10s, 260 Hz to 440 Hz)
  startAmbientBreeze() {
    if (this.ambientStarted) return;
    this.ensureContext();
    if (!this.ctx) return;
    this.ambientStarted = true;

    try {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + white * 0.05;
        b1 = 0.95 * b1 + white * 0.05;
        b2 = 0.85 * b2 + white * 0.05;
        data[i] = (b0 + b1 + b2) * 0.2;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      // Dual-filter low-pass configuration for organic canopy acoustics
      const filter1 = this.ctx.createBiquadFilter();
      filter1.type = 'lowpass';
      filter1.frequency.setValueAtTime(350, this.ctx.currentTime);
      filter1.Q.setValueAtTime(1.0, this.ctx.currentTime);

      const filter2 = this.ctx.createBiquadFilter();
      filter2.type = 'lowpass';
      filter2.frequency.setValueAtTime(350, this.ctx.currentTime);
      filter2.Q.setValueAtTime(0.7, this.ctx.currentTime);

      // Slow sinusoidal LFO (period ~10s -> 0.1 Hz) gently sweeping filter cutoffs between 260 Hz and 440 Hz
      // Base frequency = 350 Hz, modulation depth = 90 Hz (350 - 90 = 260 Hz, 350 + 90 = 440 Hz)
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.1, this.ctx.currentTime); // 10 second period

      const lfoGain1 = this.ctx.createGain();
      lfoGain1.gain.setValueAtTime(90, this.ctx.currentTime);
      lfo.connect(lfoGain1);
      lfoGain1.connect(filter1.frequency);

      const lfoGain2 = this.ctx.createGain();
      lfoGain2.gain.setValueAtTime(90, this.ctx.currentTime);
      lfo.connect(lfoGain2);
      lfoGain2.connect(filter2.frequency);

      // Smooth gain transition ensuring relaxing, non-intrusive background presence (gain ~0.035)
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.035, this.ctx.currentTime + 3.0);

      // Audio routing: noise -> filter1 -> filter2 -> gain -> destination
      noise.connect(filter1);
      filter1.connect(filter2);
      filter2.connect(gain);
      gain.connect(this.ctx.destination);

      lfo.start();
      noise.start();
      this.breezeNode = gain;

      // Schedule occasional authentic British birdsong with weather/diurnal modulation
      setInterval(() => {
        if (this.isMuted) return;

        // At NIGHT: birdsong is silent
        if (this.currentTimeOfDay === 'NIGHT') return;

        // Weather bird chirp suppression:
        // If weather is RAIN: bird chirps are paused or suppressed (birds shelter during heavy rain)
        if (this.currentWeather === 'RAIN') return;

        // Base probability is 0.45
        // If weather is DRIZZLE or FOG: bird chirp frequency is halved
        let prob = 0.45;
        if (this.currentWeather === 'DRIZZLE' || this.currentWeather === 'FOG') {
          prob *= 0.5;
        }

        if (Math.random() < prob) {
          this.playBirdChirp();
        }
      }, 4000);

      // Initialize rain synth graph if context exists
      this._initRainSynthesizer();

      // Start periodic wind gust / thunder rumble scheduler for precipitation
      if (!this.weatherTimer) {
        this.weatherTimer = setInterval(() => {
          if (this.isMuted || !this.ctx || this.ctx.state === 'suspended') return;
          if (this.currentWeather === 'RAIN') {
            if (Math.random() < 0.35) {
              this.playThunderRumble();
            } else if (Math.random() < 0.5) {
              this.playWindGust();
            }
          } else if (this.currentWeather === 'DRIZZLE' && Math.random() < 0.25) {
            this.playWindGust();
          }
        }, 12000);
      }
    } catch (e) {
      console.warn('Ambient audio could not start:', e);
    }
  }

  // Procedural Rain Synthesizer Graph
  _initRainSynthesizer() {
    if (!this.ctx || this.rainSource) return;

    try {
      // Pink / white noise buffer loop (3 seconds)
      const bufferSize = this.ctx.sampleRate * 3;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + white * 0.5362) * 0.1;
      }

      this.rainSource = this.ctx.createBufferSource();
      this.rainSource.buffer = buffer;
      this.rainSource.loop = true;

      // Dual-filter bandpass / lowpass filtering shaping noise into falling precipitation on park foliage and grass
      this.rainLowpassFilter = this.ctx.createBiquadFilter();
      this.rainLowpassFilter.type = 'lowpass';
      this.rainLowpassFilter.frequency.setValueAtTime(2000, this.ctx.currentTime);
      this.rainLowpassFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

      this.rainBandpassFilter = this.ctx.createBiquadFilter();
      this.rainBandpassFilter.type = 'bandpass';
      this.rainBandpassFilter.frequency.setValueAtTime(1600, this.ctx.currentTime);
      this.rainBandpassFilter.Q.setValueAtTime(0.8, this.ctx.currentTime);

      this.rainGainNode = this.ctx.createGain();
      this.rainGainNode.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      // Connect: noise -> bandpass -> lowpass -> rainGainNode -> destination
      this.rainSource.connect(this.rainBandpassFilter);
      this.rainBandpassFilter.connect(this.rainLowpassFilter);
      this.rainLowpassFilter.connect(this.rainGainNode);
      this.rainGainNode.connect(this.ctx.destination);

      this.rainSource.start();
    } catch (e) {
      console.warn('Rain audio synthesizer could not be initialized:', e);
    }
  }

  // Low-frequency thunder rumble for rain / heavy squalls (swept 60 Hz to 180 Hz)
  playThunderRumble() {
    this.ensureContext();
    if (!this.ctx || this.isMuted || this.ctx.state === 'suspended') return;

    try {
      const t = this.ctx.currentTime;
      const duration = 3.5 + Math.random() * 1.5;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        // Low-frequency brownian rumble noise
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut * 3.5;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // Lowpass filter swept between 60 Hz and 180 Hz
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(75, t);
      filter.frequency.exponentialRampToValueAtTime(160, t + 0.8);
      filter.frequency.exponentialRampToValueAtTime(65, t + duration);
      filter.Q.setValueAtTime(2.5, t);

      // Subtle LFO modulation sweeping filter cutoffs in the 60-180 Hz range
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.35, t);
      lfoGain.gain.setValueAtTime(35, t);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      // Gain envelope: gentle ambient volume (~0.04) so it remains soothing and immersive
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.04, t + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      lfo.start(t);
      noise.start(t);

      lfo.stop(t + duration);
      noise.stop(t + duration);
    } catch (e) {
      console.warn('Thunder rumble could not play:', e);
    }
  }

  // Surging wind gusts during precipitation or squalls
  playWindGust() {
    this.ensureContext();
    if (!this.ctx || this.isMuted || this.ctx.state === 'suspended') return;

    try {
      const t = this.ctx.currentTime;
      const duration = 4.0;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.98 * b0 + white * 0.08;
        b1 = 0.95 * b1 + white * 0.08;
        data[i] = (b0 + b1) * 0.5;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // Lowpass filter modulated between 120 Hz and 320 Hz
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, t);
      filter.frequency.linearRampToValueAtTime(280, t + 1.8);
      filter.frequency.linearRampToValueAtTime(110, t + duration);
      filter.Q.setValueAtTime(1.8, t);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.032, t + 1.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start(t);
      noise.stop(t + duration);
    } catch (e) {
      console.warn('Wind gust could not play:', e);
    }
  }

  // Weather soundscape modulation:
  // - Updates internal currentWeather property
  // - Adjusts rain synthesizer and breeze node volume
  // - Controls birdsong suppression / attenuation
  setWeather(weatherType) {
    const validWeather = (weatherType || '').toUpperCase();
    this.currentWeather = validWeather;

    if (!this.ctx || this.ctx.state === 'suspended') return;

    // Ensure rain synthesizer graph exists
    if (!this.rainSource) {
      this._initRainSynthesizer();
    }

    if (!this.rainGainNode) return;

    const t = this.ctx.currentTime;
    // Cancel any scheduled transitions
    this.rainGainNode.gain.cancelScheduledValues(t);

    if (validWeather === 'DRIZZLE') {
      // Light rain / drizzle: higher cutoff frequency (~1800 Hz) with gentle low gain (~0.02)
      if (this.rainLowpassFilter) {
        this.rainLowpassFilter.frequency.cancelScheduledValues(t);
        this.rainLowpassFilter.frequency.linearRampToValueAtTime(1800, t + 1.5);
      }
      if (this.rainBandpassFilter) {
        this.rainBandpassFilter.frequency.cancelScheduledValues(t);
        this.rainBandpassFilter.frequency.linearRampToValueAtTime(1400, t + 1.5);
      }
      const targetGain = this.isMuted ? 0.0001 : 0.02;
      this.rainGainNode.gain.linearRampToValueAtTime(targetGain, t + 1.5);

      // Breeze volume modulation
      if (this.breezeNode) {
        this.breezeNode.gain.cancelScheduledValues(t);
        this.breezeNode.gain.linearRampToValueAtTime(this.isMuted ? 0.0001 : 0.038, t + 1.5);
      }
    } else if (validWeather === 'RAIN') {
      // Moderate / heavy rain: broader frequency spectrum (lowpass ~2400 Hz) with richer resonance and gain (~0.05)
      if (this.rainLowpassFilter) {
        this.rainLowpassFilter.frequency.cancelScheduledValues(t);
        this.rainLowpassFilter.frequency.linearRampToValueAtTime(2400, t + 2.0);
      }
      if (this.rainBandpassFilter) {
        this.rainBandpassFilter.frequency.cancelScheduledValues(t);
        this.rainBandpassFilter.frequency.linearRampToValueAtTime(1800, t + 2.0);
      }
      const targetGain = this.isMuted ? 0.0001 : 0.05;
      this.rainGainNode.gain.linearRampToValueAtTime(targetGain, t + 2.0);

      // In heavy rain, increase breeze gain slightly for stormy rustle
      if (this.breezeNode) {
        this.breezeNode.gain.cancelScheduledValues(t);
        this.breezeNode.gain.linearRampToValueAtTime(this.isMuted ? 0.0001 : 0.045, t + 2.0);
      }
    } else {
      // CLEAR, OVERCAST, or FOG: smoothly ramp rain gain down to 0 over 2 seconds
      this.rainGainNode.gain.linearRampToValueAtTime(0.0001, t + 2.0);

      // Restore normal canopy breeze gain based on diurnal state
      if (this.breezeNode) {
        const defaultBreezeGain = this.currentTimeOfDay === 'NIGHT' ? 0.015 : 0.035;
        this.breezeNode.gain.cancelScheduledValues(t);
        this.breezeNode.gain.linearRampToValueAtTime(this.isMuted ? 0.0001 : defaultBreezeGain, t + 2.0);
      }
    }
  }

  // Diurnal soundscape modulation:
  // - timeState: 'DAWN', 'DAY', 'GOLDEN_HOUR', 'DUSK', 'NIGHT'
  // - At NIGHT: birdsong is silent; ambient canopy breeze gain is lowered to a quiet, soothing night rustle (~0.015)
  // - At DAWN / DAY: birdsong interval is active
  setTimeOfDay(timeState) {
    const validTime = (timeState || '').toUpperCase();
    this.currentTimeOfDay = validTime;

    if (!this.ctx || this.ctx.state === 'suspended' || !this.breezeNode) return;

    const t = this.ctx.currentTime;
    this.breezeNode.gain.cancelScheduledValues(t);

    if (this.isMuted) {
      this.breezeNode.gain.linearRampToValueAtTime(0.0001, t + 1.0);
      return;
    }

    if (validTime === 'NIGHT') {
      // Night rustle: ~0.015
      this.breezeNode.gain.linearRampToValueAtTime(0.015, t + 2.5);
    } else if (validTime === 'DUSK' || validTime === 'GOLDEN_HOUR') {
      // Twilight gentle rustle: ~0.028
      this.breezeNode.gain.linearRampToValueAtTime(0.028, t + 2.5);
    } else {
      // DAWN / DAY active breeze: ~0.035
      // If it is currently raining, preserve rain storm breeze
      const dayBreezeGain = this.currentWeather === 'RAIN' ? 0.045 : 0.035;
      this.breezeNode.gain.linearRampToValueAtTime(dayBreezeGain, t + 2.5);
    }
  }
}

export const sound = new SoundSynthesizer();

```

## FILE: ./src/systems/particles.js

```typescript
// Particle FX System for Ziggy's Park Adventure

export class Particle {
  constructor(x, y, vx, vy, color, radius, maxLife, gravity = 180) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.radius = radius;
    this.maxLife = maxLife;
    this.life = maxLife;
    this.gravity = gravity;
    this.alpha = 1.0;
  }

  update(dt) {
    this.life -= dt;
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.alpha = Math.max(0, this.life / this.maxLife);
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  // Dirt & grass specks when running or jumping
  emitDust(x, y, facing = 1) {
    const colors = ['#855836', '#4a7c39', '#a67c52', '#3a632d'];
    for (let i = 0; i < 5; i++) {
      const vx = (-facing * (40 + Math.random() * 60)) + (Math.random() * 30 - 15);
      const vy = -30 - Math.random() * 50;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 2 + Math.random() * 2.5;
      const life = 0.25 + Math.random() * 0.25;
      this.particles.push(new Particle(x, y, vx, vy, color, radius, life, 350));
    }
  }

  // Shimmering golden stars when picking up bones
  emitSparkles(x, y) {
    const colors = ['#f3c948', '#ffffff', '#ffe082', '#ffd54f'];
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 120;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 1.8 + Math.random() * 2.2;
      const life = 0.4 + Math.random() * 0.4;
      this.particles.push(new Particle(x, y, vx, vy, color, radius, life, 80));
    }
  }

  // Confetti explosion at victory dog park gate
  emitConfetti(x, y) {
    const colors = ['#e04848', '#f3c948', '#22c55e', '#38bdf8', '#a855f7'];
    for (let i = 0; i < 40; i++) {
      const vx = (Math.random() - 0.5) * 320;
      const vy = -150 - Math.random() * 250;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const radius = 3 + Math.random() * 3;
      const life = 1.0 + Math.random() * 0.8;
      this.particles.push(new Particle(x, y, vx, vy, color, radius, life, 220));
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      p.draw(ctx);
    }
  }
}

```

## FILE: ./src/systems/weather.js

```typescript
// Clifton Downs Live Weather Client & Diurnal Simulation Fallback
// Integrates with Open-Meteo API (Bristol/Clifton: 51.464, -2.628) with offline fallback.

export const WeatherType = Object.freeze({
  CLEAR: 'CLEAR',
  OVERCAST: 'OVERCAST',
  DRIZZLE: 'DRIZZLE',
  RAIN: 'RAIN',
  FOG: 'FOG'
});

/**
 * Maps WMO Weather Interpretation Codes (Open-Meteo) to domain WeatherType
 * @param {number|null|undefined} code - WMO code
 * @returns {string} WeatherType value
 */
export function mapWmoCodeToWeatherType(code) {
  if (code === 0 || code === 1) {
    return WeatherType.CLEAR;
  }
  if (code === 2 || code === 3) {
    return WeatherType.OVERCAST;
  }
  if (code === 45 || code === 48) {
    return WeatherType.FOG;
  }
  if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) {
    return WeatherType.DRIZZLE;
  }
  if (
    code === 61 || code === 63 || code === 65 ||
    code === 66 || code === 67 ||
    code === 80 || code === 81 || code === 82 ||
    code === 95 || code === 96 || code === 99
  ) {
    return WeatherType.RAIN;
  }
  return WeatherType.OVERCAST;
}

/**
 * Calculates a simulated diurnal weather state based on the provided hour or current local time.
 * Diurnal cycle:
 *   Morning (05:00 - 09:00): FOG or OVERCAST
 *   Midday  (09:00 - 15:00): CLEAR or OVERCAST
 *   Afternoon (15:00 - 19:00): DRIZZLE or RAIN
 *   Evening / Night (19:00 - 05:00): CLEAR or FOG
 *
 * @param {Date} [date] - Optional date reference (defaults to new Date())
 * @returns {{ weather: string, temperature: number, windSpeed: number }}
 */
export function simulateDiurnalWeather(date = new Date()) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const pseudoSeed = (hour * 60 + minute) % 100;

  let weather = WeatherType.CLEAR;
  let temperature = 14;
  let windSpeed = 12;

  if (hour >= 5 && hour < 9) {
    // Morning (05:00 - 09:00): FOG or OVERCAST
    weather = (pseudoSeed % 2 === 0) ? WeatherType.FOG : WeatherType.OVERCAST;
    temperature = 8 + (hour - 5) * 1.5;
    windSpeed = 6 + (pseudoSeed % 8);
  } else if (hour >= 9 && hour < 15) {
    // Midday (09:00 - 15:00): CLEAR or OVERCAST
    weather = (pseudoSeed % 3 === 0) ? WeatherType.OVERCAST : WeatherType.CLEAR;
    temperature = 14 + (hour - 9) * 0.8;
    windSpeed = 10 + (pseudoSeed % 12);
  } else if (hour >= 15 && hour < 19) {
    // Afternoon (15:00 - 19:00): DRIZZLE or RAIN
    weather = (pseudoSeed % 2 === 0) ? WeatherType.DRIZZLE : WeatherType.RAIN;
    temperature = 15 - (hour - 15) * 0.7;
    windSpeed = 14 + (pseudoSeed % 10);
  } else {
    // Evening / Night (19:00 - 05:00): CLEAR or FOG
    weather = (pseudoSeed % 3 === 0) ? WeatherType.FOG : WeatherType.CLEAR;
    temperature = 9 - (hour >= 19 ? (hour - 19) * 0.5 : (hour + 5) * 0.3);
    windSpeed = 5 + (pseudoSeed % 6);
  }

  return {
    weather,
    temperature: Math.round(temperature * 10) / 10,
    windSpeed: Math.round(windSpeed * 10) / 10
  };
}

export class WeatherClient {
  constructor(options = {}) {
    this.latitude = options.latitude ?? 51.464;
    this.longitude = options.longitude ?? -2.628;
    this.endpointUrl = options.endpointUrl ??
      `https://api.open-meteo.com/v1/forecast?latitude=${this.latitude}&longitude=${this.longitude}&current_weather=true`;

    this.currentWeather = WeatherType.CLEAR;
    this.temperature = 15;
    this.windSpeed = 10;
    this.isLive = false;
    this.lastUpdated = null;
    this.override = null;

    this.listeners = new Set();
    this.refreshTimer = null;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 5000;

    // Initialize immediately with diurnal simulation state so client is immediately usable
    this.applySimulation(new Date());
  }

  /**
   * Returns the active weather state, accounting for any test/debug override.
   * @returns {string} One of WeatherType
   */
  getWeather() {
    return this.override || this.currentWeather;
  }

  /**
   * Sets a forced weather override for testing/debug.
   * @param {string} weatherType - A valid WeatherType
   */
  setWeatherOverride(weatherType) {
    if (weatherType && Object.values(WeatherType).includes(weatherType)) {
      this.override = weatherType;
      this.notifyListeners();
    }
  }

  /**
   * Clears any active weather override.
   */
  clearWeatherOverride() {
    this.override = null;
    this.notifyListeners();
  }

  /**
   * Adds an observer listener notified on weather state change.
   * @param {Function} fn - (newWeather, info) => void
   */
  addListener(fn) {
    if (typeof fn === 'function') {
      this.listeners.add(fn);
    }
  }

  /**
   * Removes an observer listener.
   * @param {Function} fn
   */
  removeListener(fn) {
    this.listeners.delete(fn);
  }

  /**
   * Internal helper to notify all registered listeners.
   */
  notifyListeners() {
    const effectiveWeather = this.getWeather();
    const info = {
      weather: effectiveWeather,
      rawWeather: this.currentWeather,
      temperature: this.temperature,
      windSpeed: this.windSpeed,
      isLive: this.isLive,
      lastUpdated: this.lastUpdated,
      override: this.override
    };

    for (const listener of this.listeners) {
      try {
        listener(effectiveWeather, info);
      } catch (err) {
        console.error('[WeatherClient] Listener error:', err);
      }
    }
  }

  /**
   * Applies diurnal simulation fallback.
   * @param {Date} [date]
   */
  applySimulation(date = new Date()) {
    const sim = simulateDiurnalWeather(date);
    this.currentWeather = sim.weather;
    this.temperature = sim.temperature;
    this.windSpeed = sim.windSpeed;
    this.isLive = false;
    this.lastUpdated = Date.now();
  }

  /**
   * Asynchronously fetches live weather from Open-Meteo API.
   * Falls back to diurnal simulation if fetch fails, network is down, or response is invalid.
   * @returns {Promise<string>} Effective weather type
   */
  async fetchWeather() {
    // Check if fetch is available in environment
    const fetchFn = (typeof globalThis !== 'undefined' && globalThis.fetch)
      ? globalThis.fetch.bind(globalThis)
      : (typeof window !== 'undefined' && window.fetch)
        ? window.fetch.bind(window)
        : null;

    if (!fetchFn) {
      this.applySimulation();
      this.notifyListeners();
      return this.getWeather();
    }

    let controller = null;
    let timeoutId = null;

    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeoutId = setTimeout(() => {
          if (controller) controller.abort();
        }, this.fetchTimeoutMs);
      }

      const fetchOptions = controller ? { signal: controller.signal } : {};
      const response = await fetchFn(this.endpointUrl, fetchOptions);

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Weather API HTTP error ${response.status}`);
      }

      const data = await response.json();
      if (!data || !data.current_weather) {
        throw new Error('Invalid weather API response format');
      }

      const cw = data.current_weather;
      this.currentWeather = mapWmoCodeToWeatherType(cw.weathercode);
      this.temperature = typeof cw.temperature === 'number' ? cw.temperature : this.temperature;
      this.windSpeed = typeof cw.windspeed === 'number' ? cw.windspeed : this.windSpeed;
      this.isLive = true;
      this.lastUpdated = Date.now();
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      // Fallback to diurnal simulation
      this.applySimulation();
    }

    this.notifyListeners();
    return this.getWeather();
  }

  /**
   * Starts periodic auto-refreshing of weather.
   * @param {number} [intervalMs=600000] - Default 10 minutes
   */
  startAutoRefresh(intervalMs = 600000) {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => {
      this.fetchWeather();
    }, intervalMs);
  }

  /**
   * Stops auto-refresh timer.
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

export const weatherClient = new WeatherClient();
export default weatherClient;

```

## FILE: ./src/ui/navigation_arrow.js

```typescript
// Directional Navigation Compass Arrow HUD Component
// Renders glassmorphic off-screen directional indicator pointing to active targets (DOG, BIN, etc.)

export class NavigationArrow {
  /**
   * @param {Object} [options]
   * @param {number} [options.padding=45] Distance in pixels from viewport edge to clamp arrow indicator
   */
  constructor(options = {}) {
    this.target = null;
    this.pulseTimer = 0;
    this.active = false;
    this.padding = typeof options.padding === 'number' ? options.padding : 45;
  }

  /**
   * Set target world coordinates and metadata
   * @param {number} x
   * @param {number} y
   * @param {'DOG' | 'BIN' | string} [type='DOG']
   * @param {string} [label='']
   * @param {string} [color='#f59e0b']
   */
  setTarget(x, y, type = 'DOG', label = '', color = '#f59e0b') {
    this.target = {
      x,
      y,
      type,
      label,
      color: color || (type === 'BIN' ? '#10b981' : '#f59e0b')
    };
    this.active = true;
  }

  /**
   * Clear active target and deactivate HUD arrow
   */
  clearTarget() {
    this.target = null;
    this.active = false;
  }

  /**
   * Return current target object or null
   * @returns {Object|null}
   */
  getTarget() {
    return this.target;
  }

  /**
   * Advance pulse timer for smooth animations
   * @param {number} dt Delta time in seconds
   */
  update(dt = 0) {
    this.pulseTimer += dt;
  }

  /**
   * Helper to get target icon emoji based on type
   * @param {string} type
   * @returns {string}
   */
  getTargetIcon(type) {
    if (type === 'DOG') return '🐕';
    if (type === 'BIN') return '🗑️';
    if (type === 'BALL') return '🎾';
    if (type === 'PLAYER') return '🚶';
    return '📍';
  }

  /**
   * Draw directional arrow HUD
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} camera Camera object with x, y, width/viewportWidth, height/viewportHeight
   * @param {number} playerX
   * @param {number} playerY
   */
  draw(ctx, camera, playerX, playerY) {
    if (!this.active || !this.target || !ctx) {
      return;
    }

    // Safety checks for coordinates and camera
    const px = typeof playerX === 'number' ? playerX : 0;
    const py = typeof playerY === 'number' ? playerY : 0;

    const camX = camera && typeof camera.x === 'number' ? camera.x : 0;
    const camY = camera && typeof camera.y === 'number' ? camera.y : 0;
    const viewW = camera && (camera.viewportWidth || camera.width || (ctx.canvas ? ctx.canvas.width : 1280));
    const viewH = camera && (camera.viewportHeight || camera.height || (ctx.canvas ? ctx.canvas.height : 720));

    if (!viewW || !viewH) return;

    // Calculate displacement from player to target
    const dx = this.target.x - px;
    const dy = this.target.y - py;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    // Target position in screen coordinates
    const targetScreenX = this.target.x - camX;
    const targetScreenY = this.target.y - camY;

    // Viewport bounds with padding
    const pad = Math.max(10, this.padding);
    const minX = pad;
    const maxX = viewW - pad;
    const minY = pad;
    const maxY = viewH - pad;

    const isOnScreen = (
      targetScreenX >= minX &&
      targetScreenX <= maxX &&
      targetScreenY >= minY &&
      targetScreenY <= maxY
    );

    // Proximity threshold (< 80px): if on-screen and close, render subtle beacon above target
    if (isOnScreen && dist < 80) {
      this.drawCloseBeacon(ctx, targetScreenX, targetScreenY);
      return;
    }

    // If on-screen and nearby (>80px), or off-screen:
    // Determine screen position for the perimeter compass arrow
    let screenX, screenY;

    if (isOnScreen) {
      // Gentle floating indicator right over or near target
      screenX = targetScreenX;
      screenY = targetScreenY;
    } else {
      // Off-screen: Project ray from viewport center to clamp at perimeter boundary
      const cx = viewW / 2;
      const cy = viewH / 2;
      const clamped = this.clampRayToBox(cx, cy, angle, minX, maxX, minY, maxY);
      screenX = clamped.x;
      screenY = clamped.y;
    }

    this.drawCompassIndicator(ctx, screenX, screenY, angle, dist);
  }

  /**
   * Clamps a ray starting from (cx, cy) along angle to the rectangle [minX, maxX] x [minY, maxY]
   */
  clampRayToBox(cx, cy, angle, minX, maxX, minY, maxY) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    let tMin = Infinity;

    // Right edge
    if (cos > 1e-6) {
      const t = (maxX - cx) / cos;
      if (t > 0 && t < tMin) tMin = t;
    }
    // Left edge
    if (cos < -1e-6) {
      const t = (minX - cx) / cos;
      if (t > 0 && t < tMin) tMin = t;
    }
    // Bottom edge
    if (sin > 1e-6) {
      const t = (maxY - cy) / sin;
      if (t > 0 && t < tMin) tMin = t;
    }
    // Top edge
    if (sin < -1e-6) {
      const t = (minY - cy) / sin;
      if (t > 0 && t < tMin) tMin = t;
    }

    if (!isFinite(tMin) || tMin <= 0) {
      return { x: cx, y: cy };
    }

    const x = Math.max(minX, Math.min(maxX, cx + cos * tMin));
    const y = Math.max(minY, Math.min(maxY, cy + sin * tMin));
    return { x, y };
  }

  /**
   * Draw subtle beacon when player is within immediate proximity (<80px) and on screen
   */
  drawCloseBeacon(ctx, x, y) {
    const pulse = 1.0 + 0.15 * Math.sin(this.pulseTimer * 5);
    const targetColor = this.target.color || '#f59e0b';
    const icon = this.getTargetIcon(this.target.type);

    ctx.save();
    ctx.translate(x, y - 36);

    // Glowing ring
    ctx.beginPath();
    ctx.arc(0, 0, 16 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = targetColor;
    ctx.stroke();

    // Icon emoji
    ctx.font = '16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 0, 1);

    ctx.restore();
  }

  /**
   * Draw glassmorphic circular backdrop disc, chevron arrow, icon, and distance pill badge
   */
  drawCompassIndicator(ctx, x, y, angle, dist) {
    const pulseScale = 1.0 + 0.08 * Math.sin(this.pulseTimer * 4);
    const targetColor = this.target.color || '#f59e0b';
    const icon = this.getTargetIcon(this.target.type);
    const radius = 22;

    ctx.save();
    ctx.translate(x, y);

    // 1. Outer Glassmorphic Disc
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'; // Slate-900 glass
    ctx.fill();
    ctx.restore();

    // Disc Border
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.stroke();

    // 2. Directional Chevron / Arrow
    ctx.save();
    ctx.rotate(angle);
    ctx.scale(pulseScale, pulseScale);

    // Chevron pointing outward along angle
    const chevronDist = radius + 6;
    ctx.beginPath();
    ctx.moveTo(chevronDist + 10, 0); // Tip
    ctx.lineTo(chevronDist - 2, -7);  // Top wing
    ctx.lineTo(chevronDist + 2, 0);   // Inward notch
    ctx.lineTo(chevronDist - 2, 7);   // Bottom wing
    ctx.closePath();

    ctx.fillStyle = targetColor;
    ctx.shadowColor = targetColor;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();

    // 3. Central Target Icon / Emoji
    ctx.save();
    ctx.font = '16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 0, 1);
    ctx.restore();

    // 4. Distance Badge Pill
    // Calculate distance text: e.g. "12m" (assuming 20 world units per meter)
    const meters = Math.max(1, Math.round(dist / 20));
    const distText = `${meters}m`;

    ctx.save();
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textMetrics = ctx.measureText(distText);
    const pillW = Math.max(34, textMetrics.width + 12);
    const pillH = 18;
    const pillY = radius + 14;

    // Draw Pill Background
    ctx.beginPath();
    const r = pillH / 2;
    ctx.roundRect
      ? ctx.roundRect(-pillW / 2, pillY - pillH / 2, pillW, pillH, r)
      : ctx.arc(0, pillY, r, 0, Math.PI * 2); // fallback if roundRect unsupported
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.stroke();

    // Draw Pill Text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(distText, 0, pillY + 0.5);

    ctx.restore();

    ctx.restore();
  }
}

```

## FILE: ./src/ui/proximity_chat.js

```typescript
// Spatial Proximity Clustering & Prominent Glassmorphic Conversation HUD
export const PROXIMITY_RADIUS = 200;
export const RETENTION_DURATION_MS = 5 * 60 * 1000; // 300,000 ms (5 minutes)
export const PLAYER_PALETTE = ['#38bdf8', '#4ade80', '#fbbf24', '#fb7185', '#c084fc', '#2dd4bf', '#f97316', '#60a5fa'];

export class ProximityChat {
  /**
   * @param {Object} options
   * @param {number} [options.radius=200] - Proximity threshold in pixels
   * @param {number} [options.retentionDuration=300000] - Message retention duration in ms
   * @param {HTMLElement} [options.container] - Parent DOM container
   * @param {Function} [options.onClusterFormed] - Callback when cluster forms (participants)
   * @param {Function} [options.onClusterDissolved] - Callback when cluster dissolves (partingContext)
   * @param {Function} [options.onSendMessage] - Callback when local player sends message (text, activePeers)
   */
  constructor(options = {}) {
    this.radius = typeof options.radius === 'number' ? options.radius : PROXIMITY_RADIUS;
    this.retentionDuration = typeof options.retentionDuration === 'number' ? options.retentionDuration : RETENTION_DURATION_MS;
    this.departureTimers = new Map(); // peerId -> departureTimestamp (ms)
    this.playerColors = new Map(); // senderId -> colorHex
    this.activeCluster = null; // null when solo, or Set of active peer IDs
    this.participants = []; // array of participant objects { id, name, isLocal, toString() }
    this.messages = [];
    this.lastMessage = null;
    this.onClusterFormed = options.onClusterFormed || null;
    this.onClusterDissolved = options.onClusterDissolved || null;
    this.onSendMessage = options.onSendMessage || null;

    this.container = options.container ||
      (typeof document !== 'undefined' ? (document.getElementById('game-container') || document.body) : null);

    this.panel = null;
    this.header = null;
    this.pillsContainer = null;
    this.messagesContainer = null;
    this.inputContainer = null;
    this.input = null;
    this.sendBtn = null;
    this.emojiBtns = [];

    this.isManuallyHidden = false;
    this.toggleBtn = null;
    this._boundOnToggleClick = null;

    this._boundOnKeyDown = null;
    this._boundOnSendClick = null;
    this._boundEmojiClicks = [];

    this.initHUD();
  }

  /**
   * Initializes HUD DOM elements.
   */
  initHUD() {
    if (typeof document === 'undefined') return;

    // Check if element already exists
    const existingPanel = document.getElementById('proximity-chat-panel');
    if (existingPanel && existingPanel.parentNode) {
      existingPanel.parentNode.removeChild(existingPanel);
    }

    // Build #proximity-chat-panel
    const panel = document.createElement('div');
    panel.id = 'proximity-chat-panel';
    panel.className = 'hidden';

    panel.innerHTML = `
      <div id="proximity-chat-header" class="proximity-chat-header">
        <div class="proximity-header-title">
          <span class="proximity-chat-icon">💬</span>
          <span class="proximity-title-text">Group Chat</span>
          <span class="proximity-badge">🟢 In Range (${this.radius}px)</span>
        </div>
        <div class="proximity-participants" id="proximity-participants">
          <span class="proximity-participants-label">💬 Chat with:</span>
          <div class="proximity-pills-list" id="proximity-pills-list"></div>
        </div>
      </div>

      <div id="proximity-chat-messages" class="proximity-chat-messages"></div>

      <div id="proximity-chat-input-container" class="proximity-chat-input-container">
        <!-- Retired quick emoji bar: 👋, 🐾, ❤️, ☕ and send button in Ticket-023 in favor of streamlined text input -->
        <div id="proximity-chat-input-bar" class="proximity-input-row">
          <input
            type="text"
            id="proximity-chat-input"
            placeholder="Say something to the group... (Enter to send)"
            maxlength="100"
            autocomplete="off"
          />
        </div>
      </div>
    `;

    if (this.container) {
      this.container.appendChild(panel);
    } else if (document.body) {
      document.body.appendChild(panel);
    }

    this.panel = panel;
    this.header = panel.querySelector('#proximity-chat-header');
    this.pillsContainer = panel.querySelector('#proximity-pills-list');
    this.messagesContainer = panel.querySelector('#proximity-chat-messages');
    this.inputContainer = panel.querySelector('#proximity-chat-input-container');
    this.input = panel.querySelector('#proximity-chat-input');
    this.sendBtn = panel.querySelector('#proximity-chat-send-btn');
    this.emojiBtns = Array.from(panel.querySelectorAll('.proximity-emoji-btn'));

    // Event listeners
    if (this.input) {
      this._boundOnKeyDown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          this._handleInputSubmit();
        }
      };
      this.input.addEventListener('keydown', this._boundOnKeyDown);
      this.input.addEventListener('keyup', (e) => e.stopPropagation());
      this.input.addEventListener('keypress', (e) => e.stopPropagation());
    }

    if (this.sendBtn) {
      this._boundOnSendClick = (e) => {
        e.preventDefault();
        this._handleInputSubmit();
      };
      this.sendBtn.addEventListener('click', this._boundOnSendClick);
    }

    // Check and clean up existing #chat-toggle-btn
    const existingToggle = document.getElementById('chat-toggle-btn');
    if (existingToggle && existingToggle.parentNode) {
      existingToggle.parentNode.removeChild(existingToggle);
    }

    // Build #chat-toggle-btn
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'chat-toggle-btn';
    toggleBtn.className = 'chat-toggle-btn collapsed';
    toggleBtn.setAttribute('type', 'button');
    toggleBtn.setAttribute('aria-label', 'Toggle Chat');
    toggleBtn.setAttribute('title', 'Toggle Chat');
    toggleBtn.innerHTML = '<span class="chat-toggle-icon">💬</span>';

    const parentElem = this.container || document.body;
    if (parentElem) {
      parentElem.appendChild(toggleBtn);
    }
    this.toggleBtn = toggleBtn;

    // Toggle button click handler
    this._boundOnToggleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleVisibility();
    };
    this.toggleBtn.addEventListener('click', this._boundOnToggleClick);

    if (this.emojiBtns && this.emojiBtns.length > 0) {
      for (const btn of this.emojiBtns) {
        const handler = (e) => {
          e.preventDefault();
          const emoji = btn.getAttribute('data-emoji') || btn.textContent.trim();
          if (emoji) {
            this.submitMessage(emoji);
          }
        };
        btn.addEventListener('click', handler);
        this._boundEmojiClicks.push({ btn, handler });
      }
    }
  }

  _handleInputSubmit() {
    if (!this.input) return;
    const text = this.input.value.trim();
    if (text) {
      this.submitMessage(text);
      this.input.value = '';
      this.input.focus();
    }
  }

  /**
   * Submits a message from the local player.
   * @param {string} text
   */
  submitMessage(text) {
    if (!text) return;
    const trimmed = String(text).trim();
    if (!trimmed) return;

    const localP = this.participants.find(p => p.isLocal) || { id: 'local', name: 'You' };
    this.addMessage(localP.id, localP.name, trimmed, true);

    if (typeof this.onSendMessage === 'function') {
      this.onSendMessage(trimmed, this.getActivePeers());
    }
  }

  /**
   * Public API: Append message to active chat thread.
   */
  addMessage(senderId, senderName, text, isLocal = false) {
    const sId = senderId || (isLocal ? 'local' : 'peer');
    const sName = senderName || (isLocal ? 'You' : 'Walker');
    const strText = String(text !== undefined ? text : '');

    if (!this.playerColors.has(sId)) {
      const color = PLAYER_PALETTE[this.playerColors.size % PLAYER_PALETTE.length];
      this.playerColors.set(sId, color);
    }
    const assignedColor = this.playerColors.get(sId);

    const msg = {
      senderId: sId,
      senderName: sName,
      text: strText,
      isLocal: Boolean(isLocal),
      timestamp: Date.now(),
      color: assignedColor,
      toString() {
        return this.text;
      }
    };

    this.messages.push(msg);
    this.lastMessage = msg;

    // Auto-unhide logic: If in an active cluster, automatically unhide panel when message is added
    if (this.isClusterActive() || this.activeCluster) {
      const isPanelActive = this.panel && this.panel.classList.contains('active');
      if (this.isManuallyHidden || !isPanelActive) {
        this.showHUD();
        this.isManuallyHidden = false;
      }
    }

    if (this.messagesContainer && typeof document !== 'undefined') {
      const msgEl = document.createElement('div');
      msgEl.className = `proximity-message ${isLocal ? 'local' : 'peer'}`;
      // data-sender-id="${this.escapeHTML(sId)}"
      msgEl.setAttribute('data-sender-id', sId);

      const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      msgEl.innerHTML = `
        <div class="proximity-message-header">
          <span class="proximity-message-sender" style="color: ${assignedColor};">${this.escapeHTML(msg.senderName)}</span>
          <span class="proximity-message-time">${timeStr}</span>
        </div>
        <div class="proximity-message-text" style="color: ${assignedColor};">${this.escapeHTML(msg.text)}</div>
      `;
      this.messagesContainer.appendChild(msgEl);
      this.scrollToBottom();
    }

    return msg;
  }

  /**
   * Adds an in-thread notification message.
   * @param {string} text
   */
  addSystemMessage(text) {
    if (!text) return;
    if (this.messagesContainer && typeof document !== 'undefined') {
      const sysEl = document.createElement('div');
      sysEl.className = 'proximity-message system';
      sysEl.innerHTML = `<span class="proximity-system-text">${this.escapeHTML(text)}</span>`;
      this.messagesContainer.appendChild(sysEl);
      this.scrollToBottom();
    }
  }

  /**
   * Public API: Returns most recent message object or string.
   */
  getLastMessage() {
    return this.lastMessage;
  }

  /**
   * Public API: Returns short summary string of the conversation.
   */
  getSnippet() {
    if (this.lastMessage) {
      const t = typeof this.lastMessage === 'string' ? this.lastMessage : this.lastMessage.text;
      if (t && t.trim().length > 0) {
        return t.trim();
      }
    }
    if (this.participants && this.participants.length > 0) {
      const peers = this.participants.filter(p => !p.isLocal).map(p => p.name);
      if (peers.length > 0) {
        return `Chat with ${peers.join(', ')}`;
      }
    }
    return '';
  }

  /**
   * Public API: Whether a conversation cluster is currently active.
   */
  isClusterActive() {
    return this.activeCluster !== null;
  }

  /**
   * Public API: Returns array of connected remote peer IDs.
   */
  getActivePeers() {
    if (!this.activeCluster) return [];
    if (this.activeCluster instanceof Set) {
      return Array.from(this.activeCluster);
    }
    if (Array.isArray(this.activeCluster)) {
      return [...this.activeCluster];
    }
    return [];
  }

  /**
   * Public API: Whether the proximity chat panel is currently visible.
   * @returns {boolean}
   */
  isVisible() {
    return Boolean(this.panel && this.panel.classList.contains('active'));
  }

  /**
   * Public API: Toggles visibility between shown and hidden.
   */
  toggleVisibility() {
    if (this.isVisible()) {
      this.hideHUD();
      this.isManuallyHidden = true;
    } else {
      this.showHUD();
      this.isManuallyHidden = false;
    }
  }

  /**
   * Slides in HUD panel.
   */
  showHUD() {
    if (this.panel) {
      this.panel.classList.remove('hidden');
      this.panel.classList.add('active');
    }
    if (this.toggleBtn) {
      this.toggleBtn.classList.add('active');
      this.toggleBtn.classList.remove('collapsed');
    }
  }

  openHUD() {
    this.showHUD();
  }

  /**
   * Slides out HUD panel.
   */
  hideHUD() {
    if (this.panel) {
      this.panel.classList.remove('active');
      this.panel.classList.add('hidden');
    }
    if (this.toggleBtn) {
      this.toggleBtn.classList.remove('active');
      this.toggleBtn.classList.add('collapsed');
    }
  }

  closeHUD() {
    this.hideHUD();
  }

  /**
   * Refreshes participant pills in the header.
   */
  updateParticipantsBadge() {
    if (!this.pillsContainer || typeof document === 'undefined') return;
    this.pillsContainer.innerHTML = '';
    for (const p of this.participants) {
      const pill = document.createElement('span');
      pill.className = `participant-pill ${p.isLocal ? 'local' : 'peer'}`;
      pill.textContent = p.isLocal ? `${p.name} (You)` : p.name;
      this.pillsContainer.appendChild(pill);
    }
  }

  scrollToBottom() {
    if (!this.messagesContainer) return;
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Normalizes remote players map/array into uniform node array.
   * @private
   */
  _extractRemotePlayers(remotePlayersMap) {
    if (!remotePlayersMap) return [];
    const list = [];

    const processEntry = (key, val) => {
      if (val === undefined && key === undefined) return;
      const item = val !== undefined ? val : key;
      if (!item) return;

      const entity = item.owner || item;
      const fallbackId = (key !== undefined && typeof key === 'string') ? key : null;
      const id = item.id || item.peerId || entity.id || fallbackId || `peer-${list.length}`;
      const name = entity.name || item.name || 'Walker';
      const x = typeof entity.x === 'number' ? entity.x : (typeof item.x === 'number' ? item.x : null);
      const y = typeof entity.y === 'number' ? entity.y : (typeof item.y === 'number' ? item.y : null);

      if (x !== null && y !== null && !isNaN(x) && !isNaN(y)) {
        list.push({ id: String(id), name: String(name), x, y, raw: item });
      }
    };

    if (remotePlayersMap instanceof Map) {
      for (const [key, val] of remotePlayersMap.entries()) {
        processEntry(key, val);
      }
    } else if (Array.isArray(remotePlayersMap)) {
      for (let i = 0; i < remotePlayersMap.length; i++) {
        const entry = remotePlayersMap[i];
        if (Array.isArray(entry) && entry.length === 2) {
          processEntry(entry[0], entry[1]);
        } else {
          processEntry(null, entry);
        }
      }
    } else if (typeof remotePlayersMap === 'object') {
      for (const [key, val] of Object.entries(remotePlayersMap)) {
        processEntry(key, val);
      }
    }

    return list;
  }

  /**
   * Evaluates spatial proximity clustering and updates HUD lifecycle.
   * @param {number} dt
   * @param {Object} localOwner
   * @param {Map|Array|Object} remotePlayersMap
   */
  update(dt, localOwner, remotePlayersMap) {
    const wasActive = this.isClusterActive();

    // Expiration check:
    const now = Date.now();
    for (const [peerId, departureTimestamp] of this.departureTimers.entries()) {
      if (now - departureTimestamp >= this.retentionDuration) {
        this.purgePeerMessages(peerId);
      }
    }

    if (!localOwner || typeof localOwner.x !== 'number' || typeof localOwner.y !== 'number') {
      if (wasActive) {
        if (this.activeCluster) {
          for (const peerId of this.activeCluster) {
            this.departureTimers.set(peerId, Date.now());
          }
        }
        const partingContext = {
          x: 0,
          y: 0,
          participants: [...this.participants],
          lastMessage: this.lastMessage,
          snippet: this.getSnippet()
        };
        this.hideHUD();
        this.isManuallyHidden = false;
        if (typeof this.onClusterDissolved === 'function') {
          this.onClusterDissolved(partingContext);
        }
        this.activeCluster = null;
        this.participants = [];
        this.updateParticipantsBadge();
      }
      return;
    }

    const localId = String(localOwner.id || 'local');
    const localName = localOwner.name || 'You';
    const localNode = {
      id: localId,
      name: localName,
      x: localOwner.x,
      y: localOwner.y,
      isLocal: true,
      toString() { return this.name; }
    };

    // Extract remote players and exclude local player ID
    const allRemotes = this._extractRemotePlayers(remotePlayersMap).filter(r => r.id !== localId);

    // Multi-player transitive clustering via BFS from local player
    const connectedRemoteNodes = [];
    const visited = new Set();
    const queue = [localNode];

    while (queue.length > 0) {
      const current = queue.shift();
      for (const rem of allRemotes) {
        if (!visited.has(rem.id)) {
          const dx = current.x - rem.x;
          const dy = current.y - rem.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= this.radius) {
            visited.add(rem.id);
            connectedRemoteNodes.push(rem);
            queue.push(rem);
          }
        }
      }
    }

    if (connectedRemoteNodes.length > 0) {
      const currentPeerIds = new Set(connectedRemoteNodes.map(r => r.id));
      const remoteParticipants = connectedRemoteNodes.map(r => ({
        id: r.id,
        name: r.name,
        isLocal: false,
        toString() { return this.name; }
      }));
      const newParticipants = [localNode, ...remoteParticipants];

      // Reconnection / Join:
      for (const peerId of currentPeerIds) {
        if (this.departureTimers.has(peerId)) {
          this.departureTimers.delete(peerId);
        }
      }

      if (!wasActive) {
        // Cluster FORMS: open/slide-in the prominent on-screen HUD if not manually hidden
        this.activeCluster = currentPeerIds;
        this.participants = newParticipants;
        this.updateParticipantsBadge();
        if (!this.isManuallyHidden) {
          this.showHUD();
        }
        if (typeof this.onClusterFormed === 'function') {
          this.onClusterFormed(this.participants);
        }
      } else {
        // Cluster remains ACTIVE: check if active participants changed
        const prevPeerIds = this.activeCluster || new Set();
        const joined = connectedRemoteNodes.filter(r => !prevPeerIds.has(r.id));
        const leftIds = [...prevPeerIds].filter(id => !currentPeerIds.has(id));

        let membershipChanged = false;

        if (joined.length > 0) {
          membershipChanged = true;
          for (const j of joined) {
            this.addSystemMessage(`${j.name} joined the conversation.`);
          }
        }

        if (leftIds.length > 0) {
          membershipChanged = true;
          for (const id of leftIds) {
            this.departureTimers.set(id, Date.now());
            const prevP = this.participants.find(p => p.id === id);
            const name = prevP ? prevP.name : 'A player';
            this.addSystemMessage(`${name} left the conversation.`);
          }
        }

        if (membershipChanged) {
          this.activeCluster = currentPeerIds;
          this.participants = newParticipants;
          this.updateParticipantsBadge();
        }
      }
    } else {
      // 0 remote players connected to local player
      if (wasActive) {
        if (this.activeCluster) {
          for (const peerId of this.activeCluster) {
            this.departureTimers.set(peerId, Date.now());
          }
        }
        // Cluster DISSOLVES: close/slide-out HUD
        const partingContext = {
          x: localOwner.x,
          y: localOwner.y,
          participants: [...this.participants],
          lastMessage: this.lastMessage,
          snippet: this.getSnippet()
        };
        this.hideHUD();
        this.isManuallyHidden = false;
        if (typeof this.onClusterDissolved === 'function') {
          this.onClusterDissolved(partingContext);
        }
        this.activeCluster = null;
        this.participants = [];
        this.updateParticipantsBadge();
      }
    }

    // Expiration check:
    const checkNow = Date.now();
    for (const [peerId, departureTimestamp] of this.departureTimers.entries()) {
      if (checkNow - departureTimestamp >= this.retentionDuration) {
        this.purgePeerMessages(peerId);
      }
    }
  }

  /**
   * Purges messages sent by a departed peer after retention expiration.
   * @param {string} peerId
   */
  purgePeerMessages(peerId) {
    this.messages = this.messages.filter(m => m.senderId !== peerId);
    if (this.lastMessage && this.lastMessage.senderId === peerId) {
      this.lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    }
    if (this.messagesContainer && typeof document !== 'undefined') {
      const toRemove = this.messagesContainer.querySelectorAll(`[data-sender-id="${peerId}"]`);
      toRemove.forEach(el => el.remove());
    }
    this.departureTimers.delete(peerId);
  }

  /**
   * Public API: Cleans up DOM elements and event listeners.
   */
  destroy() {
    if (this.input && this._boundOnKeyDown) {
      this.input.removeEventListener('keydown', this._boundOnKeyDown);
    }
    if (this.sendBtn && this._boundOnSendClick) {
      this.sendBtn.removeEventListener('click', this._boundOnSendClick);
    }
    for (const { btn, handler } of this._boundEmojiClicks) {
      btn.removeEventListener('click', handler);
    }
    this._boundEmojiClicks = [];

    if (this.toggleBtn && this._boundOnToggleClick) {
      this.toggleBtn.removeEventListener('click', this._boundOnToggleClick);
    }
    this._boundOnToggleClick = null;

    if (this.toggleBtn && this.toggleBtn.parentNode) {
      this.toggleBtn.parentNode.removeChild(this.toggleBtn);
    }
    this.toggleBtn = null;

    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }

    this.panel = null;
    this.header = null;
    this.pillsContainer = null;
    this.messagesContainer = null;
    this.inputContainer = null;
    this.input = null;
    this.sendBtn = null;
    this.emojiBtns = [];

    this.activeCluster = null;
    this.participants = [];
    this.messages = [];
    this.lastMessage = null;

    if (this.departureTimers) {
      this.departureTimers.clear();
    }
    if (this.playerColors) {
      this.playerColors.clear();
    }
  }
}

export const ProximityChatHUD = ProximityChat;
export const ProximityChatManager = ProximityChat;
export default ProximityChat;

```

## FILE: ./src/ui/social_hud.js

```typescript
// Social HUD Component - Room Status, One-Click Share, Chat Input, and Character Customizer
import { Protocol } from '../net/protocol.js';
import { TouchControls } from './touch_controls.js';
import { WSStatus } from '../net/ws_network.js';
import { NetStatus } from '../net/network.js';

export class SocialHUD {
  constructor(networkManager, localOwner, localDog, coatPresets) {
    this.net = networkManager;
    this.owner = localOwner;
    this.dog = localDog;
    this.coatPresets = coatPresets;
    this.proximityChat = null;

    this.container = document.getElementById('game-container');
    this.hudOverlay = document.getElementById('hud-overlay');
    this.controlsHint = document.getElementById('controls-hint');

    this.toastTimer = null;
    this.initHUD();
  }

  initHUD() {
    // 1. Build Glassmorphic Top Overlay
    if (this.hudOverlay) {
      this.hudOverlay.innerHTML = `
        <div class="hud-panel">
          <div class="hud-pill">
            <span style="font-size: 1.2rem;">🌳</span>
            <span style="font-weight: 700; color: #f8fafc;">The Downs</span>
            <span class="hud-pill-badge" id="hud-mode-badge">Solo</span>
          </div>
          <div class="hud-pill" id="hud-player-count">
            <span>🐾 1</span>
          </div>
        </div>
        <button id="btn-customize" class="style-toggle-btn" aria-label="Customize Style" title="Customize Style">
          <span class="style-toggle-icon">⚙️</span>
        </button>
      `;
    }

    // 2. Build Controls Guidance (Retired bottom toolbar)
    if (this.controlsHint) {
      this.controlsHint.innerHTML = '';
      this.controlsHint.style.display = 'none';
    }

    // 3. Build Chat Input Bar (without quick emotes)
    const chatBar = document.createElement('div');
    chatBar.id = 'chat-container';
    chatBar.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" id="chat-input" placeholder="Say something in the park... (Enter to send)" maxlength="60" autocomplete="off" />
      </div>
    `;
    this.container.appendChild(chatBar);

    // 4. Build Customizer Modal
    const modal = document.createElement('div');
    modal.id = 'customizer-modal';
    modal.innerHTML = `
      <div class="customizer-header">
        <h3>Style Customizer</h3>
        <button class="customizer-close" id="close-modal" aria-label="Close">&times;</button>
      </div>

      <!-- Tab Navigation -->
      <div class="customizer-tabs">
        <button class="customizer-tab-btn active" id="tab-btn-walker" data-tab="cust-tab-walker">👤 Walker</button>
        <button class="customizer-tab-btn" id="tab-btn-dog" data-tab="cust-tab-dog">🐕 Dog Companion</button>
      </div>

      <!-- Tab 1: Walker -->
      <div class="customizer-tab-pane active" id="cust-tab-walker">
        <div class="cust-form-group">
          <label class="cust-label" for="cust-name">Walker Name</label>
          <input type="text" id="cust-name" class="cust-input" value="${this.owner.name || 'Walker'}" maxlength="14" autocomplete="off" />
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Skin Tone</label>
          <div class="cust-palette" id="skin-palette">
            <div class="color-swatch" data-palette="skinTone" data-color="#fed7aa" style="background: #fed7aa;" title="Light Peach"></div>
            <div class="color-swatch" data-palette="skinTone" data-color="#fcd34d" style="background: #fcd34d;" title="Warm Gold"></div>
            <div class="color-swatch" data-palette="skinTone" data-color="#d97706" style="background: #d97706;" title="Honey Tan"></div>
            <div class="color-swatch" data-palette="skinTone" data-color="#92400e" style="background: #92400e;" title="Warm Chestnut"></div>
            <div class="color-swatch" data-palette="skinTone" data-color="#7c2d12" style="background: #7c2d12;" title="Deep Espresso"></div>
          </div>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Hair Style</label>
          <div class="cust-btn-group" id="hair-style-group">
            <button class="cust-style-btn active" data-style="SHORT">Short</button>
            <button class="cust-style-btn" data-style="WAVY">Wavy</button>
            <button class="cust-style-btn" data-style="PONYTAIL">Ponytail</button>
            <button class="cust-style-btn" data-style="BEANIE">Beanie</button>
          </div>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Hair Color</label>
          <div class="cust-palette" id="hair-palette">
            <div class="color-swatch" data-palette="hairColor" data-color="#451a03" style="background: #451a03;" title="Brown"></div>
            <div class="color-swatch" data-palette="hairColor" data-color="#eab308" style="background: #eab308;" title="Blonde"></div>
            <div class="color-swatch" data-palette="hairColor" data-color="#171717" style="background: #171717;" title="Black"></div>
            <div class="color-swatch" data-palette="hairColor" data-color="#9a3412" style="background: #9a3412;" title="Auburn"></div>
            <div class="color-swatch" data-palette="hairColor" data-color="#94a3b8" style="background: #94a3b8;" title="Silver"></div>
          </div>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Jacket Color</label>
          <div class="cust-palette" id="jacket-palette">
            <div class="color-swatch" data-palette="jacketColor" data-color="#1e3a8a" style="background: #1e3a8a;" title="Navy"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#14532d" style="background: #14532d;" title="Forest"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#831843" style="background: #831843;" title="Crimson"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#b45309" style="background: #b45309;" title="Amber"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#334155" style="background: #334155;" title="Slate"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#d97706" style="background: #d97706;" title="Ochre"></div>
          </div>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Pants Color</label>
          <div class="cust-palette" id="pants-palette">
            <div class="color-swatch" data-palette="pantsColor" data-color="#1e293b" style="background: #1e293b;" title="Denim"></div>
            <div class="color-swatch" data-palette="pantsColor" data-color="#78350f" style="background: #78350f;" title="Tan"></div>
            <div class="color-swatch" data-palette="pantsColor" data-color="#365314" style="background: #365314;" title="Olive"></div>
            <div class="color-swatch" data-palette="pantsColor" data-color="#1f2937" style="background: #1f2937;" title="Dark Slate"></div>
          </div>
        </div>
      </div>

      <!-- Tab 2: Dog Companion -->
      <div class="customizer-tab-pane" id="cust-tab-dog">
        <div class="cust-form-group">
          <label class="cust-label" for="cust-dog-coat">Dog Breed / Coat</label>
          <select id="cust-dog-coat" class="cust-select">
            <option value="CHOCOLATE_TAN">Ziggy (Chocolate & Tan Cocker)</option>
            <option value="GOLDEN">Golden Retriever</option>
            <option value="BLACK_LAB">Black Lab</option>
            <option value="JACK_RUSSELL">Jack Russell Terrier</option>
            <option value="RED_SETTER">Irish Red Setter</option>
          </select>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Collar Color</label>
          <div class="cust-palette" id="collar-palette">
            <div class="color-swatch" data-palette="collarColor" data-color="#0d9488" style="background: #0d9488;" title="Teal"></div>
            <div class="color-swatch" data-palette="collarColor" data-color="#dc2626" style="background: #dc2626;" title="Red"></div>
            <div class="color-swatch" data-palette="collarColor" data-color="#2563eb" style="background: #2563eb;" title="Blue"></div>
            <div class="color-swatch" data-palette="collarColor" data-color="#eab308" style="background: #eab308;" title="Gold"></div>
            <div class="color-swatch" data-palette="collarColor" data-color="#7c3aed" style="background: #7c3aed;" title="Purple"></div>
          </div>
        </div>

        <!-- Canine Personality Editor (1-5 Traits) -->
        <div class="cust-form-group cust-personality-group">
          <label class="cust-label" style="margin-bottom: 8px;">Canine Personality Traits</label>
          
          <div class="cust-trait-row">
            <div class="cust-trait-header">
              <label class="cust-trait-label" for="cust-personality-playfulness">🎾 Playfulness</label>
              <span class="cust-trait-badge" id="val-personality-playfulness">3</span>
            </div>
            <input type="range" min="1" max="5" step="1" value="3" class="cust-range" id="cust-personality-playfulness" />
          </div>

          <div class="cust-trait-row">
            <div class="cust-trait-header">
              <label class="cust-trait-label" for="cust-personality-shyness">🙈 Shyness</label>
              <span class="cust-trait-badge" id="val-personality-shyness">2</span>
            </div>
            <input type="range" min="1" max="5" step="1" value="2" class="cust-range" id="cust-personality-shyness" />
          </div>

          <div class="cust-trait-row">
            <div class="cust-trait-header">
              <label class="cust-trait-label" for="cust-personality-barkyness">🗣️ Barkyness</label>
              <span class="cust-trait-badge" id="val-personality-barkyness">2</span>
            </div>
            <input type="range" min="1" max="5" step="1" value="2" class="cust-range" id="cust-personality-barkyness" />
          </div>

          <div class="cust-trait-row">
            <div class="cust-trait-header">
              <label class="cust-trait-label" for="cust-personality-obedience">🎓 Obedience</label>
              <span class="cust-trait-badge" id="val-personality-obedience">4</span>
            </div>
            <input type="range" min="1" max="5" step="1" value="4" class="cust-range" id="cust-personality-obedience" />
          </div>
        </div>
      </div>

      <button id="btn-save-cust" class="btn-primary-cust">Save & Walk</button>
    `;
    this.container.appendChild(modal);

    // Toast Container
    const toast = document.createElement('div');
    toast.id = 'hud-toast';
    toast.style.cssText = `
      position: absolute;
      top: 76px;
      left: 50%;
      transform: translateX(-50%);
      background: #059669;
      color: #fff;
      padding: 8px 20px;
      border-radius: 20px;
      font-weight: 600;
      font-size: 0.9rem;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      display: none;
      z-index: 200;
    `;
    this.container.appendChild(toast);

    // Load saved profile from localStorage if available
    this.loadSavedProfile();

    this.bindEvents();
  }

  loadSavedProfile() {
    if (typeof localStorage === 'undefined') return;
    try {
      const savedStr = localStorage.getItem('clifton_walker_profile');
      if (!savedStr) {
        // Initialize default personality if not present on dog
        if (this.dog) {
          if (!this.dog.personality) {
            this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
          }
        }
        this.updateModalActiveSelections();
        return;
      }
      const saved = JSON.parse(savedStr);
      if (!saved || typeof saved !== 'object') {
        if (this.dog && !this.dog.personality) {
          this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
        }
        this.updateModalActiveSelections();
        return;
      }

      // 1. Walker attributes (with fallback defaults)
      if (saved.name) {
        this.owner.name = saved.name;
        const nameInput = document.getElementById('cust-name');
        if (nameInput) nameInput.value = saved.name;
      }
      if (saved.skinTone) {
        this.owner.skinTone = saved.skinTone;
      }
      if (saved.hairStyle) {
        this.owner.hairStyle = saved.hairStyle;
      }
      if (saved.hairColor) {
        this.owner.hairColor = saved.hairColor;
      }
      if (saved.jacketColor) {
        this.owner.jacketColor = saved.jacketColor;
      }
      if (saved.pantsColor) {
        this.owner.pantsColor = saved.pantsColor;
      }

      // 2. Dog companion attributes (with fallback defaults)
      if (saved.coatKey && this.coatPresets && this.coatPresets[saved.coatKey]) {
        this.dog.coat = this.coatPresets[saved.coatKey];
        const coatSelect = document.getElementById('cust-dog-coat');
        if (coatSelect) coatSelect.value = saved.coatKey;
      }
      if (saved.collarColor) {
        this.dog.collarColor = saved.collarColor;
      }

      // 3. Canine Personality attributes (with fallback defaults)
      const personalityDefaults = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
      if (this.dog) {
        const loadedPersonality = saved.personality && typeof saved.personality === 'object'
          ? {
              playfulness: parseInt(saved.personality.playfulness, 10) || personalityDefaults.playfulness,
              shyness: parseInt(saved.personality.shyness, 10) || personalityDefaults.shyness,
              barkyness: parseInt(saved.personality.barkyness, 10) || personalityDefaults.barkyness,
              obedience: parseInt(saved.personality.obedience, 10) || personalityDefaults.obedience
            }
          : { ...personalityDefaults };

        if (typeof this.dog.setPersonality === 'function') {
          this.dog.setPersonality(loadedPersonality);
        } else {
          this.dog.personality = loadedPersonality;
        }
      }

      this.updateModalActiveSelections();

      if (this.net && typeof this.net.setLocalMeta === 'function') {
        const personality = this.dog && this.dog.personality ? this.dog.personality : personalityDefaults;
        this.net.setLocalMeta({
          name: this.owner.name,
          jacketColor: this.owner.jacketColor,
          coatName: this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
          hairStyle: this.owner.hairStyle,
          hairColor: this.owner.hairColor,
          pantsColor: this.owner.pantsColor,
          skinTone: this.owner.skinTone,
          collarColor: this.dog.collarColor,
          personality
        });
      }
    } catch (e) {
      console.warn('Could not load saved walker profile from localStorage:', e);
      if (this.dog && !this.dog.personality) {
        this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
      }
      this.updateModalActiveSelections();
    }
  }

  updateModalActiveSelections() {
    // Update swatch active classes
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
      const palette = swatch.getAttribute('data-palette');
      const color = swatch.getAttribute('data-color');
      let matches = false;

      if (palette === 'skinTone' && this.owner.skinTone === color) matches = true;
      else if (palette === 'hairColor' && this.owner.hairColor === color) matches = true;
      else if (palette === 'jacketColor' && this.owner.jacketColor === color) matches = true;
      else if (palette === 'pantsColor' && this.owner.pantsColor === color) matches = true;
      else if (palette === 'collarColor' && this.dog.collarColor === color) matches = true;

      if (matches) {
        swatch.classList.add('active');
        swatch.style.border = '2px solid #fff';
      } else {
        swatch.classList.remove('active');
        swatch.style.border = '2px solid transparent';
      }
    });

    // Update hair style buttons
    const styleBtns = document.querySelectorAll('.cust-style-btn');
    styleBtns.forEach(btn => {
      if (btn.getAttribute('data-style') === (this.owner.hairStyle || 'SHORT')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update dog coat select
    const coatSelect = document.getElementById('cust-dog-coat');
    if (coatSelect && this.dog.coat) {
      for (const [key, preset] of Object.entries(this.coatPresets || {})) {
        if (preset === this.dog.coat || preset.name === this.dog.coat.name) {
          coatSelect.value = key;
          break;
        }
      }
    }

    // Update personality sliders and badges
    const personality = (this.dog && this.dog.personality)
      ? this.dog.personality
      : { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };

    const traits = ['playfulness', 'shyness', 'barkyness', 'obedience'];
    traits.forEach(trait => {
      const slider = document.getElementById(`cust-personality-${trait}`);
      const badge = document.getElementById(`val-personality-${trait}`);
      const val = personality[trait] !== undefined ? personality[trait] : 3;
      if (slider) slider.value = val;
      if (badge) badge.textContent = val;
    });
  }

  showToast(text) {
    const toast = document.getElementById('hud-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.style.display = 'block';

    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
  }

  openModal() {
    const modal = document.getElementById('customizer-modal');
    if (!modal) return;
    this.updateModalActiveSelections();
    modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
  }

  bindEvents() {
    // 1. Room Button action
    const btnRoomAction = document.getElementById('btn-room-action');
    if (btnRoomAction) {
      btnRoomAction.addEventListener('click', () => {
        if (!this.net.roomId) {
          // In Solo mode: Host room
          this.net.hostRoom();
        } else {
          // In Hosted or Joined mode: Copy Share Link
          const shareUrl = this.net.getShareUrl();
          navigator.clipboard.writeText(shareUrl).then(() => {
            this.showToast('📋 Field link copied! Send to friends to join.');
          }).catch(() => {
            prompt('Copy field link:', shareUrl);
          });
        }
      });
    }

    // 2. Customizer modal toggle
    const btnCustomize = document.getElementById('btn-customize');
    const modal = document.getElementById('customizer-modal');
    const closeModal = document.getElementById('close-modal');
    const btnSaveCust = document.getElementById('btn-save-cust');

    if (btnCustomize) {
      btnCustomize.addEventListener('click', () => {
        this.openModal();
      });
    }

    if (closeModal && modal) {
      closeModal.addEventListener('click', () => { modal.style.display = 'none'; });
    }

    // Tab navigation switching
    const tabBtns = document.querySelectorAll('.customizer-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetTabId = btn.getAttribute('data-tab');
        document.querySelectorAll('.customizer-tab-pane').forEach(pane => {
          pane.classList.remove('active');
        });
        const targetPane = document.getElementById(targetTabId);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // Hair Style selector buttons
    const hairStyleBtns = document.querySelectorAll('.cust-style-btn');
    hairStyleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        hairStyleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.owner.hairStyle = btn.getAttribute('data-style');
      });
    });

    // Palette swatches selection
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        const palette = swatch.getAttribute('data-palette');
        const color = swatch.getAttribute('data-color');

        // Deactivate sibling swatches in the same palette
        const siblings = swatch.parentElement.querySelectorAll('.color-swatch');
        siblings.forEach(s => {
          s.classList.remove('active');
          s.style.border = '2px solid transparent';
        });

        swatch.classList.add('active');
        swatch.style.border = '2px solid #fff';

        // Apply immediately to local avatar for live preview
        if (palette === 'skinTone') this.owner.skinTone = color;
        else if (palette === 'hairColor') this.owner.hairColor = color;
        else if (palette === 'jacketColor') this.owner.jacketColor = color;
        else if (palette === 'pantsColor') this.owner.pantsColor = color;
        else if (palette === 'collarColor') this.dog.collarColor = color;
      });
    });

    // Canine Personality slider event wiring
    const traits = ['playfulness', 'shyness', 'barkyness', 'obedience'];
    traits.forEach(trait => {
      const slider = document.getElementById(`cust-personality-${trait}`);
      const badge = document.getElementById(`val-personality-${trait}`);
      if (slider) {
        slider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          if (badge) badge.textContent = val;
          if (this.dog) {
            if (!this.dog.personality) {
              this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
            }
            if (typeof this.dog.setPersonality === 'function') {
              this.dog.setPersonality({ [trait]: val });
            } else {
              this.dog.personality[trait] = val;
            }
          }
        });
      }
    });

    // Save & Walk button
    if (btnSaveCust && modal) {
      btnSaveCust.addEventListener('click', () => {
        const nameInput = document.getElementById('cust-name');
        if (nameInput && nameInput.value.trim()) {
          this.owner.name = nameInput.value.trim();
        }

        const coatSelect = document.getElementById('cust-dog-coat');
        let coatKey = 'CHOCOLATE_TAN';
        if (coatSelect && this.coatPresets && this.coatPresets[coatSelect.value]) {
          coatKey = coatSelect.value;
          this.dog.coat = this.coatPresets[coatSelect.value];
        }

        // Current personality configuration
        const personality = {
          playfulness: parseInt(document.getElementById('cust-personality-playfulness')?.value || (this.dog?.personality?.playfulness ?? 3), 10),
          shyness: parseInt(document.getElementById('cust-personality-shyness')?.value || (this.dog?.personality?.shyness ?? 2), 10),
          barkyness: parseInt(document.getElementById('cust-personality-barkyness')?.value || (this.dog?.personality?.barkyness ?? 2), 10),
          obedience: parseInt(document.getElementById('cust-personality-obedience')?.value || (this.dog?.personality?.obedience ?? 4), 10)
        };

        if (this.dog) {
          if (typeof this.dog.setPersonality === 'function') {
            this.dog.setPersonality(personality);
          } else {
            this.dog.personality = personality;
          }
        }

        // Save updated profile to localStorage
        if (typeof localStorage !== 'undefined') {
          try {
            const profileToSave = {
              name: this.owner.name,
              skinTone: this.owner.skinTone,
              hairStyle: this.owner.hairStyle,
              hairColor: this.owner.hairColor,
              jacketColor: this.owner.jacketColor,
              pantsColor: this.owner.pantsColor,
              coatKey: coatSelect ? coatSelect.value : coatKey,
              collarColor: this.dog.collarColor,
              personality: personality
            };
            localStorage.setItem('clifton_walker_profile', JSON.stringify(profileToSave));
          } catch (e) {
            console.warn('Could not save walker profile to localStorage:', e);
          }
        }

        if (this.net && typeof this.net.setLocalMeta === 'function') {
          const extraMeta = {
            hairStyle: this.owner.hairStyle,
            hairColor: this.owner.hairColor,
            pantsColor: this.owner.pantsColor,
            skinTone: this.owner.skinTone,
            collarColor: this.dog.collarColor,
            personality: personality
          };

          this.net.setLocalMeta({
            name: this.owner.name,
            jacketColor: this.owner.jacketColor,
            coatName: this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
            ...extraMeta
          });

          this.net.broadcast(Protocol.createHello(
            this.net.peerId,
            this.owner.name,
            this.owner.jacketColor,
            this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
            extraMeta
          ));
        }

        modal.style.display = 'none';
        this.showToast('✨ Appearance updated!');
      });
    }

    // 3. Quick Emote buttons (guarded)
    const emoteBtns = document.querySelectorAll('.emote-btn');
    if (emoteBtns && emoteBtns.length > 0) {
      emoteBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const emote = btn.getAttribute('data-emote');
          this.owner.setEmote(emote);
          this.net.broadcast({ type: 'EMOTE', senderId: this.net.peerId, emote });
          const chatContainer = document.getElementById('chat-container');
          if (chatContainer) chatContainer.style.display = 'none';
        });
      });
    }

    // 4. Chat Input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const text = chatInput.value.trim();
          if (text) {
            if (this.proximityChat && this.proximityChat.isClusterActive()) {
              this.proximityChat.submitMessage(text);
            } else {
              this.owner.setChat(text);
              this.net.broadcast({ type: 'CHAT_MESSAGE', senderId: this.net.peerId, text });
            }
            chatInput.value = '';
          }
          const chatContainer = document.getElementById('chat-container');
          if (chatContainer) chatContainer.style.display = 'none';
        } else if (e.key === 'Escape') {
          const chatContainer = document.getElementById('chat-container');
          if (chatContainer) chatContainer.style.display = 'none';
        }
      });
    }
  }

  updatePlayerCount(count) {
    const pill = document.getElementById('hud-player-count');
    if (pill) {
      pill.innerHTML = `<span>🐾 ${count}</span>`;
    }
  }

  updateNetworkState(status, message) {
    const badge = document.getElementById('hud-mode-badge');
    const label = document.getElementById('btn-room-label');

    if (status === WSStatus.CONNECTED || status === NetStatus.CONNECTED_PEER || status === NetStatus.HOSTING) {
      const isCommons = !this.net.roomId || this.net.roomId === 'the-commons' || this.net.roomId === 'clifton-field';
      if (badge) {
        if (isCommons) {
          badge.textContent = 'Online';
          badge.style.background = '#059669';
        } else {
          badge.textContent = `🔒 Meadow (${this.net.roomId})`;
          badge.style.background = '#8b5cf6';
        }
      }
      if (label) {
        label.textContent = isCommons ? 'Share Park' : 'Share Link';
      }
    } else if (status === WSStatus.CONNECTING || status === NetStatus.CONNECTING) {
      if (badge) {
        badge.textContent = '⏳ Connecting...';
        badge.style.background = '#d97706';
      }
      if (label) {
        label.textContent = 'Connecting...';
      }
    } else if (status === WSStatus.RECONNECTING) {
      if (badge) {
        badge.textContent = '🔄 Reconnecting...';
        badge.style.background = '#d97706';
      }
      if (label) {
        label.textContent = 'Connecting...';
      }
    } else if (status === WSStatus.OFFLINE || status === WSStatus.ERROR || status === NetStatus.OFFLINE || status === NetStatus.ERROR) {
      if (badge) {
        badge.textContent = 'Solo (Offline)';
        badge.style.background = '#64748b';
      }
      if (label) {
        label.textContent = 'Host Field';
      }
    } else {
      if (badge) {
        badge.textContent = 'Solo (Offline)';
        badge.style.background = '#64748b';
      }
      if (label) {
        label.textContent = 'Host Field';
      }
    }
  }

  toggleChatInput() {
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    if (!chatContainer || !chatInput) return;

    if (chatContainer.style.display === 'block') {
      chatContainer.style.display = 'none';
      chatInput.blur();
    } else {
      chatContainer.style.display = 'block';
      chatInput.focus();
    }
  }
}

```

## FILE: ./src/ui/touch_controls.js

```typescript
// Touch Controls - Mobile Virtual Analog Joystick & Action Buttons

export class TouchControls {
  constructor(callbacks = {}) {
    this.callbacks = {
      onMove: callbacks.onMove || null,
      onThrow: callbacks.onThrow || null,
      onLeash: callbacks.onLeash || null,
      onPet: callbacks.onPet || null,
      onChat: callbacks.onChat || null,
      onWhistle: callbacks.onWhistle || null
    };

    this.joystickTouchId = null;
    this.joystickCenter = { x: 0, y: 0 };
    this.maxRadius = 50; // max displacement in pixels
    this.deadzone = 0.10; // 10% deadzone threshold
    this.joystickVector = {
      vx: 0,
      vy: 0,
      angle: 0,
      active: false,
      distance: 0
    };

    this.overlay = null;
    this.joystickZone = null;
    this.joystickBase = null;
    this.joystickKnob = null;
    this.actionPad = null;

    this.initDOM();
    this.bindEvents();
  }

  static isTouchDevice() {
    return (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    );
  }

  initDOM() {
    const container = document.getElementById('game-container') || document.body;

    // Outer Overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'touch-controls-overlay';

    // 1. Virtual Joystick (Bottom Left)
    this.joystickZone = document.createElement('div');
    this.joystickZone.id = 'touch-joystick-zone';

    this.joystickBase = document.createElement('div');
    this.joystickBase.id = 'joystick-base';

    this.joystickKnob = document.createElement('div');
    this.joystickKnob.id = 'joystick-knob';

    this.joystickBase.appendChild(this.joystickKnob);
    this.joystickZone.appendChild(this.joystickBase);
    this.overlay.appendChild(this.joystickZone);

    // 2. Action Pad (Bottom Right)
    this.actionPad = document.createElement('div');
    this.actionPad.id = 'touch-action-pad';

    this.actionPad.innerHTML = `
      <button class="touch-action-btn" id="btn-touch-throw" aria-label="Throw Ball">🎾</button>
      <button class="touch-action-btn" id="btn-touch-whistle" aria-label="Whistle / Recall Dog">📯</button>
      <button class="touch-action-btn" id="btn-touch-pet" aria-label="Pet Dog">❤️</button>
      <button class="touch-action-btn" id="btn-touch-leash" aria-label="Toggle Leash">🦮</button>
      <button class="touch-action-btn" id="btn-touch-chat" aria-label="Chat">💬</button>
    `;

    this.overlay.appendChild(this.actionPad);
    container.appendChild(this.overlay);

    // Initial display toggle based on touch capability
    if (!TouchControls.isTouchDevice()) {
      this.overlay.style.display = 'none';
    }
  }

  bindEvents() {
    if (!this.joystickZone) return;

    // Joystick Touch Handling
    const handleJoystickStart = (touch) => {
      this.joystickTouchId = touch.identifier;
      const rect = this.joystickBase.getBoundingClientRect();
      this.joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      this.updateJoystickPosition(touch.clientX, touch.clientY);
    };

    const handleJoystickMove = (touch) => {
      this.updateJoystickPosition(touch.clientX, touch.clientY);
    };

    const handleJoystickEnd = () => {
      this.joystickTouchId = null;
      this.resetJoystick();
    };

    this.joystickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.joystickTouchId !== null) return;
      const touch = e.changedTouches[0];
      if (touch) handleJoystickStart(touch);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (this.joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.joystickTouchId) {
          e.preventDefault();
          handleJoystickMove(touch);
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      if (this.joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.joystickTouchId) {
          handleJoystickEnd();
          break;
        }
      }
    });

    window.addEventListener('touchcancel', (e) => {
      if (this.joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.joystickTouchId) {
          handleJoystickEnd();
          break;
        }
      }
    });

    // Action Buttons
    const bindButton = (id, callback) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      const trigger = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.vibrate(25);
        if (typeof callback === 'function') {
          callback();
        }
      };

      btn.addEventListener('touchstart', trigger, { passive: false });
      btn.addEventListener('click', (e) => {
        // Prevent duplicate trigger if touch fired
        if (e.detail === 0) return;
        trigger(e);
      });
    };

    bindButton('btn-touch-throw', () => this.callbacks.onThrow?.());
    bindButton('btn-touch-whistle', () => this.callbacks.onWhistle?.());
    bindButton('btn-touch-leash', () => this.callbacks.onLeash?.());
    bindButton('btn-touch-pet', () => this.callbacks.onPet?.());
    bindButton('btn-touch-chat', () => this.callbacks.onChat?.());
  }

  updateJoystickPosition(clientX, clientY) {
    const dx = clientX - this.joystickCenter.x;
    const dy = clientY - this.joystickCenter.y;
    const rawDist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    const clampedDist = Math.min(rawDist, this.maxRadius);
    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;

    if (this.joystickKnob) {
      this.joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    }

    const ratio = clampedDist / this.maxRadius;
    if (ratio < this.deadzone) {
      this.joystickVector = {
        vx: 0,
        vy: 0,
        angle: 0,
        active: false,
        distance: 0
      };
    } else {
      const normalizedIntensity = (ratio - this.deadzone) / (1.0 - this.deadzone);
      this.joystickVector = {
        vx: Math.cos(angle) * normalizedIntensity,
        vy: Math.sin(angle) * normalizedIntensity,
        angle: angle,
        active: true,
        distance: clampedDist
      };
    }

    if (typeof this.callbacks.onMove === 'function') {
      this.callbacks.onMove(this.joystickVector);
    }
  }

  resetJoystick() {
    if (this.joystickKnob) {
      this.joystickKnob.style.transform = 'translate(0px, 0px)';
    }

    this.joystickVector = {
      vx: 0,
      vy: 0,
      angle: 0,
      active: false,
      distance: 0
    };

    if (typeof this.callbacks.onMove === 'function') {
      this.callbacks.onMove(this.joystickVector);
    }
  }

  vibrate(duration = 25) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(duration);
      }
    } catch (_) {
      // Haptic vibration silently ignored if restricted
    }
  }

  setLeashed(isLeashed) {
    const btn = document.getElementById('btn-touch-leash');
    if (!btn) return;

    if (isLeashed) {
      btn.textContent = '🦮';
      btn.classList.remove('off-leash');
      btn.setAttribute('aria-label', 'Toggle Leash (Currently On)');
    } else {
      btn.textContent = '🐕';
      btn.classList.add('off-leash');
      btn.setAttribute('aria-label', 'Toggle Leash (Currently Off)');
    }
  }

  getVector() {
    return this.joystickVector;
  }

  destroy() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }
}

```

## FILE: ./src/world/environment.js

```typescript
// The Downs (Clifton & Durdham Downs, Bristol) - Dynamic Diurnal Sepia Lighting Pass & Weather Particle Overlays

export const TimeOfDay = Object.freeze({
  DAWN: 'DAWN',
  DAY: 'DAY',
  GOLDEN_HOUR: 'GOLDEN_HOUR',
  DUSK: 'DUSK',
  NIGHT: 'NIGHT'
});

export const WeatherType = Object.freeze({
  CLEAR: 'CLEAR',
  OVERCAST: 'OVERCAST',
  DRIZZLE: 'DRIZZLE',
  RAIN: 'RAIN',
  FOG: 'FOG'
});

/**
 * Calculates Bristol (Europe/London) local hour (float 0.0 - 24.0),
 * automatically respecting GMT (UTC+0) and BST (UTC+1).
 */
export function getBristolHour() {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    let h = 0, m = 0, s = 0;
    for (const part of parts) {
      if (part.type === 'hour') h = parseInt(part.value, 10);
      if (part.type === 'minute') m = parseInt(part.value, 10);
      if (part.type === 'second') s = parseInt(part.value, 10);
    }
    h = h % 24;
    return h + m / 60 + s / 3600;
  } catch (e) {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }
}

export class EnvironmentSystem {
  constructor(options = {}) {
    this.timeOverride = options.timeOverride !== undefined ? options.timeOverride : null;
    this.currentWeather = options.weather || WeatherType.CLEAR;
    this.viewportWidth = options.viewportWidth || 1280;
    this.viewportHeight = options.viewportHeight || 720;
    this.animTime = 0;

    // Particle pools
    this.rainParticles = [];
    this.drizzleParticles = [];
    this.mistSpecks = [];
    this.fogSheets = [];
    this.dustMotes = [];
    this.splashes = [];

    // Offscreen canvas cache for radial lighting compositing
    this.offscreenCanvas = null;
    this.offscreenCtx = null;

    this._initParticles();
  }

  // --- Time-of-Day Diurnal Engine ---

  setTimeOverride(hour) {
    if (typeof hour === 'number' && !isNaN(hour)) {
      this.timeOverride = ((hour % 24) + 24) % 24;
    } else {
      this.timeOverride = null;
    }
  }

  clearTimeOverride() {
    this.timeOverride = null;
  }

  getCurrentHour() {
    if (this.timeOverride !== null && this.timeOverride !== undefined) {
      return this.timeOverride;
    }
    return getBristolHour();
  }

  getTimeOfDay(hour = null) {
    const h = hour !== null && hour !== undefined
      ? ((hour % 24) + 24) % 24
      : this.getCurrentHour();

    if (h >= 5.0 && h < 7.0) {
      return TimeOfDay.DAWN;
    } else if (h >= 7.0 && h < 17.0) {
      return TimeOfDay.DAY;
    } else if (h >= 17.0 && h < 19.5) {
      return TimeOfDay.GOLDEN_HOUR;
    } else if (h >= 19.5 && h < 21.5) {
      return TimeOfDay.DUSK;
    } else {
      return TimeOfDay.NIGHT;
    }
  }

  getAmbientColor(hour = null) {
    const tod = this.getTimeOfDay(hour);
    let r, g, b, a;
    switch (tod) {
      case TimeOfDay.DAWN:
        r = 180; g = 150; b = 190; a = 0.25;
        break;
      case TimeOfDay.DAY:
        r = 255; g = 250; b = 230; a = 0.04;
        break;
      case TimeOfDay.GOLDEN_HOUR:
        r = 180; g = 110; b = 35; a = 0.28;
        break;
      case TimeOfDay.DUSK:
        r = 30; g = 35; b = 60; a = 0.55;
        break;
      case TimeOfDay.NIGHT:
      default:
        r = 10; g = 16; b = 32; a = 0.82;
        break;
    }
    const string = `rgba(${r}, ${g}, ${b}, ${a})`;
    return {
      r,
      g,
      b,
      a,
      string,
      toString() {
        return string;
      }
    };
  }

  getAmbientTint(asObject = false) {
    const color = this.getAmbientColor();
    if (asObject) {
      return color;
    }
    const strObj = new String(color.string);
    strObj.r = color.r;
    strObj.g = color.g;
    strObj.b = color.b;
    strObj.a = color.a;
    strObj.string = color.string;
    return strObj;
  }

  // --- Weather State Management ---

  setWeather(weather) {
    if (typeof weather === 'string') {
      this.currentWeather = weather.toUpperCase();
    }
  }

  getWeather() {
    return this.currentWeather;
  }

  resize(width, height) {
    if (width > 0 && height > 0) {
      this.viewportWidth = width;
      this.viewportHeight = height;
    }
  }

  // --- Offscreen Canvas Helper ---

  _getOffscreenCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
      if (!this.offscreenCanvas || this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
        this.offscreenCanvas = new OffscreenCanvas(width, height);
      }
      return this.offscreenCanvas;
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      if (!this.offscreenCanvas) {
        this.offscreenCanvas = document.createElement('canvas');
      }
      if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
      }
      return this.offscreenCanvas;
    }
    return null;
  }

  // --- Particle Initialization & Pools ---

  _initParticles() {
    const w = this.viewportWidth;
    const h = this.viewportHeight;

    // 1. Rain streaks (~220 particles, vy ~ 550-750, vx ~ -80 to -160)
    this.rainParticles = [];
    for (let i = 0; i < 220; i++) {
      this.rainParticles.push({
        x: Math.random() * (w + 200) - 50,
        y: Math.random() * (h + 100) - 50,
        vx: -80 - Math.random() * 80,
        vy: 550 + Math.random() * 200,
        len: 16 + Math.random() * 8,
        width: 1.2 + Math.random() * 0.6,
        alpha: 0.45 + Math.random() * 0.25
      });
    }

    // 2. Drizzle particles (~50 particles, drifting with wind slant)
    this.drizzleParticles = [];
    for (let i = 0; i < 50; i++) {
      this.drizzleParticles.push({
        x: Math.random() * (w + 100) - 30,
        y: Math.random() * (h + 60) - 30,
        vx: -30 - Math.random() * 35,
        vy: 260 + Math.random() * 110,
        len: 7 + Math.random() * 5,
        alpha: 0.35 + Math.random() * 0.2
      });
    }

    // 3. Transient mist specks (~25 specks)
    this.mistSpecks = [];
    for (let i = 0; i < 25; i++) {
      this.mistSpecks.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: -15 - Math.random() * 25,
        vy: 10 + Math.random() * 20,
        radius: 1.2 + Math.random() * 1.5,
        alpha: 0.12 + Math.random() * 0.18,
        phase: Math.random() * Math.PI * 2
      });
    }

    // 4. Fog clouds/sheets (7 translucent drifting sheets, alpha ~ 0.15 - 0.28)
    this.fogSheets = [];
    const fogRows = 7;
    for (let i = 0; i < fogRows; i++) {
      this.fogSheets.push({
        x: Math.random() * w,
        baseY: (i + 0.5) * (h / fogRows) + (Math.random() * 40 - 20),
        y: 0,
        radiusX: 200 + Math.random() * 160,
        radiusY: 75 + Math.random() * 55,
        vx: 20 + Math.random() * 25,
        amp: 18 + Math.random() * 16,
        freq: 0.4 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.15 + Math.random() * 0.13
      });
    }

    // 5. Golden hour dust motes (~25 glowing specks)
    this.dustMotes = [];
    for (let i = 0; i < 25; i++) {
      this.dustMotes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: 6 + Math.random() * 12,
        vy: -6 - Math.random() * 10,
        radius: 1.0 + Math.random() * 1.5,
        alpha: 0.2 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  // --- Simulation Update Loop ---

  update(dt, weatherState = null) {
    if (weatherState) {
      if (typeof weatherState === 'string') {
        this.currentWeather = weatherState.toUpperCase();
      } else if (typeof weatherState.getWeather === 'function') {
        this.currentWeather = weatherState.getWeather().toUpperCase();
      } else if (weatherState.currentWeather) {
        this.currentWeather = String(weatherState.currentWeather).toUpperCase();
      } else if (weatherState.type) {
        this.currentWeather = String(weatherState.type).toUpperCase();
      }
    }

    this.animTime += dt;
    const w = this.viewportWidth;
    const h = this.viewportHeight;

    // Update active weather particles
    if (this.currentWeather === WeatherType.RAIN) {
      this._updateRain(dt, w, h);
    } else if (this.currentWeather === WeatherType.DRIZZLE) {
      this._updateDrizzle(dt, w, h);
    } else if (this.currentWeather === WeatherType.FOG) {
      this._updateFog(dt, w, h);
    } else if (this.currentWeather === WeatherType.CLEAR) {
      if (this.getTimeOfDay() === TimeOfDay.GOLDEN_HOUR) {
        this._updateDustMotes(dt, w, h);
      }
    }

    // Update ground micro-splash ripple rings
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.life -= dt;
      s.radius += dt * 32;
      if (s.life <= 0) {
        this.splashes.splice(i, 1);
      }
    }
  }

  _updateRain(dt, w, h) {
    for (let i = 0; i < this.rainParticles.length; i++) {
      const p = this.rainParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Wrap-around bounds and spawn ground splashes
      if (p.y > h || p.x < -60) {
        if (p.y >= h && Math.random() < 0.25 && this.splashes.length < 40) {
          this.splashes.push({
            x: Math.max(0, Math.min(w, p.x)),
            y: Math.min(h - 4, p.y - 2),
            radius: 1.5,
            maxRadius: 4.5 + Math.random() * 5.5,
            life: 0.18,
            maxLife: 0.18,
            alpha: 0.45
          });
        }
        p.y = -20 - Math.random() * 40;
        p.x = Math.random() * (w + 140) - 20;
        p.vx = -80 - Math.random() * 80;
        p.vy = 550 + Math.random() * 200;
      }
    }
  }

  _updateDrizzle(dt, w, h) {
    for (let i = 0; i < this.drizzleParticles.length; i++) {
      const p = this.drizzleParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.y > h || p.x < -40) {
        p.y = -15 - Math.random() * 25;
        p.x = Math.random() * (w + 80) - 10;
        p.vx = -30 - Math.random() * 35;
        p.vy = 260 + Math.random() * 110;
      }
    }

    for (let i = 0; i < this.mistSpecks.length; i++) {
      const m = this.mistSpecks[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt + Math.sin(this.animTime * 1.5 + m.phase) * 6 * dt;

      if (m.y > h + 10 || m.x < -20) {
        m.y = Math.random() * h;
        m.x = w + 10;
      }
    }
  }

  _updateFog(dt, w, h) {
    for (let i = 0; i < this.fogSheets.length; i++) {
      const s = this.fogSheets[i];
      s.x += s.vx * dt;
      s.y = s.baseY + Math.sin(this.animTime * s.freq + s.phase) * s.amp;

      if (s.x - s.radiusX > w) {
        s.x = -s.radiusX;
      }
    }
  }

  _updateDustMotes(dt, w, h) {
    for (let i = 0; i < this.dustMotes.length; i++) {
      const d = this.dustMotes[i];
      d.x += d.vx * dt + Math.sin(this.animTime + d.phase) * 8 * dt;
      d.y += d.vy * dt + Math.cos(this.animTime * 0.8 + d.phase) * 6 * dt;

      if (d.x > w + 20 || d.y < -20) {
        d.x = Math.random() * (w * 0.7);
        d.y = h + 10;
      }
    }
  }

  // --- Rendering Pass ---

  render(ctx, camera, field, width, height, playerEntities = []) {
    if (!ctx) return;
    const w = width || (ctx.canvas ? ctx.canvas.width : (camera ? camera.viewportWidth : this.viewportWidth));
    const h = height || (ctx.canvas ? ctx.canvas.height : (camera ? camera.viewportHeight : this.viewportHeight));
    this.resize(w, h);

    // Extract light sources from field
    let lightSources = [];
    if (field && typeof field.getLightSources === 'function') {
      lightSources = field.getLightSources();
    } else if (field && Array.isArray(field.streetlamps)) {
      lightSources = field.streetlamps;
    } else if (Array.isArray(field)) {
      lightSources = field;
    }

    // Extract player entities
    const players = [];
    if (camera && camera.target) {
      players.push(camera.target);
    }
    if (field && Array.isArray(field.dynamicEntities)) {
      for (const ent of field.dynamicEntities) {
        if (ent && (ent.isOwner || ent.isDog || ent.isLocal)) {
          players.push(ent);
        }
      }
    }
    if (Array.isArray(playerEntities)) {
      players.push(...playerEntities);
    } else if (playerEntities) {
      players.push(playerEntities);
    }

    // 1. Atmospheric lighting overlay & radial streetlamp cutouts
    this.renderLighting(ctx, camera, lightSources, w, h, players);

    // 2. Live weather particle overlays
    this.renderParticles(ctx, camera, w, h);
  }

  renderLighting(ctx, camera, lightSources = [], width, height, playerEntities = []) {
    if (!ctx) return;
    const w = width || (ctx.canvas ? ctx.canvas.width : (camera ? camera.viewportWidth : this.viewportWidth));
    const h = height || (ctx.canvas ? ctx.canvas.height : (camera ? camera.viewportHeight : this.viewportHeight));
    this.resize(w, h);

    const tod = this.getTimeOfDay();

    // 1. Daytime: subtle warm sunlight wash
    if (tod === TimeOfDay.DAY) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 250, 230, 0.04)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    // 2. Golden Hour / Twilight: rich sepia-tinted amber gradient overlay
    if (tod === TimeOfDay.GOLDEN_HOUR) {
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(195, 115, 30, 0.32)');
      grad.addColorStop(0.5, 'rgba(195, 115, 30, 0.28)');
      grad.addColorStop(1, 'rgba(180, 100, 25, 0.24)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    // 3. Dawn: soft cool lavender-rose ambient
    if (tod === TimeOfDay.DAWN) {
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(190, 160, 205, 0.26)');
      grad.addColorStop(1, 'rgba(215, 170, 185, 0.20)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    // 4. Night & Dusk: deep ambient shadow with radial streetlamp illumination cutouts
    const isNight = tod === TimeOfDay.NIGHT;
    const ambientColor = isNight ? 'rgba(10, 16, 32, 0.82)' : 'rgba(30, 35, 60, 0.55)';

    const lights = Array.isArray(lightSources) ? lightSources : [];
    const players = [];
    if (camera && camera.target) players.push(camera.target);
    if (Array.isArray(playerEntities)) {
      players.push(...playerEntities);
    } else if (playerEntities) {
      players.push(playerEntities);
    }

    const offCanvas = this._getOffscreenCanvas(w, h);
    const offCtx = offCanvas && typeof offCanvas.getContext === 'function' ? offCanvas.getContext('2d') : null;

    if (offCtx) {
      offCtx.clearRect(0, 0, w, h);
      offCtx.fillStyle = ambientColor;
      offCtx.fillRect(0, 0, w, h);

      offCtx.save();
      offCtx.globalCompositeOperation = 'destination-out';

      // Soft radial cutouts for registered streetlamps & beacons
      for (const lamp of lights) {
        if (!lamp) continue;
        let sx = lamp.x;
        let sy = lamp.y;
        if (camera && typeof camera.worldToScreen === 'function') {
          const s = camera.worldToScreen(lamp.x, lamp.y);
          sx = s.x;
          sy = s.y;
        } else if (camera && camera.x !== undefined && camera.y !== undefined) {
          sx = lamp.x - camera.x;
          sy = lamp.y - camera.y;
        }

        const glowRadius = lamp.glowRadius || 120;
        if (sx < -glowRadius || sx > w + glowRadius || sy < -glowRadius || sy > h + glowRadius) {
          continue;
        }

        const intensity = typeof lamp.intensity === 'number' ? lamp.intensity : 0.9;
        const radial = offCtx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
        radial.addColorStop(0, `rgba(255, 240, 180, ${intensity})`);
        radial.addColorStop(0.35, `rgba(255, 240, 180, ${intensity * 0.75})`);
        radial.addColorStop(0.7, `rgba(255, 240, 180, ${intensity * 0.35})`);
        radial.addColorStop(1, 'rgba(255, 240, 180, 0.0)');

        offCtx.fillStyle = radial;
        offCtx.beginPath();
        offCtx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
        offCtx.fill();
      }

      // Soft halo cutout around player and dog so actors remain visible in dark
      for (const p of players) {
        if (!p || typeof p.x !== 'number') continue;
        let px = p.x;
        let py = p.y;
        if (camera && typeof camera.worldToScreen === 'function') {
          const s = camera.worldToScreen(p.x, p.y);
          px = s.x;
          py = s.y;
        } else if (camera && camera.x !== undefined && camera.y !== undefined) {
          px = p.x - camera.x;
          py = p.y - camera.y;
        }

        const pRadius = 75;
        if (px < -pRadius || px > w + pRadius || py < -pRadius || py > h + pRadius) {
          continue;
        }

        const pRadial = offCtx.createRadialGradient(px, py, 0, px, py, pRadius);
        pRadial.addColorStop(0, 'rgba(255, 240, 180, 0.65)');
        pRadial.addColorStop(0.5, 'rgba(255, 240, 180, 0.30)');
        pRadial.addColorStop(1, 'rgba(255, 240, 180, 0.0)');

        offCtx.fillStyle = pRadial;
        offCtx.beginPath();
        offCtx.arc(px, py, pRadius, 0, Math.PI * 2);
        offCtx.fill();
      }

      offCtx.restore();

      // Composite offscreen ambient mask onto scene
      ctx.drawImage(offCanvas, 0, 0);

      // Render subtle warm incandescent glow core for active lamps in lighter blend mode
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const lamp of lights) {
        if (!lamp) continue;
        let sx = lamp.x;
        let sy = lamp.y;
        if (camera && typeof camera.worldToScreen === 'function') {
          const s = camera.worldToScreen(lamp.x, lamp.y);
          sx = s.x;
          sy = s.y;
        } else if (camera && camera.x !== undefined && camera.y !== undefined) {
          sx = lamp.x - camera.x;
          sy = lamp.y - camera.y;
        }

        const glowRadius = lamp.glowRadius || 120;
        if (sx < -glowRadius || sx > w + glowRadius || sy < -glowRadius || sy > h + glowRadius) {
          continue;
        }

        const warmGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
        warmGrad.addColorStop(0, 'rgba(254, 240, 138, 0.28)');
        warmGrad.addColorStop(0.4, 'rgba(253, 224, 71, 0.12)');
        warmGrad.addColorStop(1, 'rgba(253, 224, 71, 0.0)');

        ctx.fillStyle = warmGrad;
        ctx.beginPath();
        ctx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

    } else {
      // Fallback ambient rectangle
      ctx.save();
      ctx.fillStyle = ambientColor;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // --- Weather Particles Rendering Pass ---

  renderParticles(ctx, camera, width, height) {
    if (!ctx) return;
    const w = width || (ctx.canvas ? ctx.canvas.width : (camera ? camera.viewportWidth : this.viewportWidth));
    const h = height || (ctx.canvas ? ctx.canvas.height : (camera ? camera.viewportHeight : this.viewportHeight));
    this.resize(w, h);

    if (this.currentWeather === WeatherType.RAIN) {
      this._renderRain(ctx, w, h);
    } else if (this.currentWeather === WeatherType.DRIZZLE) {
      this._renderDrizzle(ctx, w, h);
    } else if (this.currentWeather === WeatherType.FOG) {
      this._renderFog(ctx, w, h);
    } else if (this.currentWeather === WeatherType.OVERCAST) {
      this._renderOvercast(ctx, w, h);
    } else if (this.currentWeather === WeatherType.CLEAR) {
      if (this.getTimeOfDay() === TimeOfDay.GOLDEN_HOUR) {
        this._renderDustMotes(ctx, w, h);
      }
    }
  }

  _renderRain(ctx, w, h) {
    ctx.save();

    // Rain streaks
    ctx.strokeStyle = 'rgba(205, 225, 255, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < this.rainParticles.length; i++) {
      const p = this.rainParticles[i];
      if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;
      const norm = Math.hypot(p.vx, p.vy) || 1;
      const dx = (p.vx / norm) * p.len;
      const dy = (p.vy / norm) * p.len;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - dx, p.y - dy);
    }
    ctx.stroke();

    // Ground micro-splash ripple rings
    ctx.lineWidth = 1.1;
    for (let i = 0; i < this.splashes.length; i++) {
      const s = this.splashes[i];
      const progress = 1 - (s.life / s.maxLife);
      const alpha = Math.max(0, s.alpha * (1 - progress));
      ctx.strokeStyle = `rgba(215, 235, 255, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.radius, s.radius * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  _renderDrizzle(ctx, w, h) {
    ctx.save();

    // Drizzle streaks
    ctx.strokeStyle = 'rgba(195, 215, 240, 0.42)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let i = 0; i < this.drizzleParticles.length; i++) {
      const p = this.drizzleParticles[i];
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
      const norm = Math.hypot(p.vx, p.vy) || 1;
      const dx = (p.vx / norm) * p.len;
      const dy = (p.vy / norm) * p.len;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - dx, p.y - dy);
    }
    ctx.stroke();

    // Transient mist specks
    ctx.fillStyle = 'rgba(220, 235, 250, 0.22)';
    for (let i = 0; i < this.mistSpecks.length; i++) {
      const m = this.mistSpecks[i];
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _renderFog(ctx, w, h) {
    ctx.save();
    for (let i = 0; i < this.fogSheets.length; i++) {
      const s = this.fogSheets[i];
      if (s.x + s.radiusX < 0 || s.x - s.radiusX > w) continue;

      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radiusX);
      grad.addColorStop(0, `rgba(235, 242, 250, ${s.alpha.toFixed(2)})`);
      grad.addColorStop(0.55, `rgba(225, 235, 245, ${(s.alpha * 0.6).toFixed(2)})`);
      grad.addColorStop(1, 'rgba(215, 225, 235, 0.0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.radiusX, s.radiusY, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _renderOvercast(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(60, 70, 80, 0.12)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  _renderDustMotes(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 225, 140, 0.32)';
    for (let i = 0; i < this.dustMotes.length; i++) {
      const d = this.dustMotes[i];
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export const environmentSystem = new EnvironmentSystem();
export default environmentSystem;

```

## FILE: ./src/world/field.js

```typescript
// The Downs (Clifton & Durdham Downs, Bristol) - Top-Down Environment, Camera & Depth-Sorted Rendering Engine

export class Camera {
  constructor(viewportWidth = 1280, viewportHeight = 720, worldWidth = 3200, worldHeight = 2400) {
    if (worldWidth === 2600 && worldHeight === 1900) {
      worldWidth = 3200;
      worldHeight = 2400;
    }
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.x = (worldWidth - viewportWidth) / 2;
    this.y = (worldHeight - viewportHeight) / 2;
    this.target = null;
    this.lerpSpeed = 0.08;
  }

  resize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  follow(target) {
    this.target = target;
  }

  update(dt) {
    if (!this.target) return;

    const targetCenterX = this.target.x - this.viewportWidth / 2;
    const targetCenterY = this.target.y - this.viewportHeight / 2;

    this.x += (targetCenterX - this.x) * (1 - Math.exp(-this.lerpSpeed * 60 * dt));
    this.y += (targetCenterY - this.y) * (1 - Math.exp(-this.lerpSpeed * 60 * dt));

    // Clamp camera within world bounds
    const maxX = Math.max(0, this.worldWidth - this.viewportWidth);
    const maxY = Math.max(0, this.worldHeight - this.viewportHeight);
    this.x = Math.max(0, Math.min(maxX, this.x));
    this.y = Math.max(0, Math.min(maxY, this.y));
  }

  apply(ctx) {
    ctx.save();
    ctx.translate(-Math.round(this.x), -Math.round(this.y));
  }

  restore(ctx) {
    ctx.restore();
  }

  worldToScreen(worldX, worldY) {
    return { x: worldX - this.x, y: worldY - this.y };
  }

  screenToWorld(screenX, screenY) {
    const rawX = screenX + this.x;
    const rawY = screenY + this.y;
    return {
      x: Math.max(0, Math.min(this.worldWidth, rawX)),
      y: Math.max(0, Math.min(this.worldHeight, rawY))
    };
  }
}

export class Field {
  constructor(width = 3200, height = 2400) {
    if (width === 2600 && height === 1900) {
      width = 3200;
      height = 2400;
    }
    this.width = width;
    this.height = height;

    // Rich procedural grass tones
    this.grassBase = '#3e6b2c';
    this.grassDark = '#335824';
    this.grassLight = '#4c8237';
    this.grassMown = '#447831';

    // Path colors: Cotswold gravel avenue and secondary woodland trails
    this.pathColor = '#c8b693';
    this.pathEdge = '#968160';
    this.pathDetail = '#ded3be';
    this.dirtPathColor = '#8c7353';
    this.dirtPathEdge = '#6f573c';

    // Static park scenery objects
    this.trees = [];
    this.benches = [];
    this.bins = [];
    this.waterTower = null;
    this.landmarks = [];
    this.rockOutcrops = [];
    this.wildflowers = [];
    this.boundaries = [];
    this.ambientParticles = [];
    this.streetlamps = [];
    this.poopPiles = [];
    this.windTime = 0;

    this.initScenery();
    this.initParticles();
  }

  initScenery() {
    // 1. Perimeter Boundary Walls
    // North, East, South: traditional stone boundary walls with corner pillars
    // West: dramatic "Sea Walls" cliff edge perimeter wall with iron railings overlooking Avon Gorge
    const margin = 36;
    this.boundaries = [
      { id: 'wall-north', x: margin, y: margin, w: this.width - margin * 2, h: 20, type: 'stone' },
      { id: 'wall-south', x: margin, y: this.height - margin - 20, w: this.width - margin * 2, h: 20, type: 'stone' },
      { id: 'wall-west', x: margin, y: margin, w: 22, h: this.height - margin * 2, type: 'seawall' },
      { id: 'wall-east', x: this.width - margin - 20, y: margin, w: 20, h: this.height - margin * 2, type: 'stone' }
    ];

    // 2. Durdham Down Water Tower Landmark Pavilion (x: 2400, y: 450, radius: 42)
    this.waterTower = {
      id: 'water-tower',
      name: 'Durdham Down Water Tower',
      x: 2400,
      y: 450,
      radius: 42,
      depthY: 485,
      isLandmark: true
    };
    this.landmarks = [this.waterTower];

    // 3. West Zone: Sea Walls Rocky Limestone Outcrops (x: 100-500, y: 800-1600)
    this.rockOutcrops = [
      { id: 'rock-1', x: 160, y: 860, w: 56, h: 34, depthY: 876, r: 26 },
      { id: 'rock-2', x: 190, y: 1040, w: 62, h: 38, depthY: 1058, r: 28 },
      { id: 'rock-3', x: 175, y: 1260, w: 58, h: 36, depthY: 1276, r: 26 },
      { id: 'rock-4', x: 210, y: 1400, w: 66, h: 42, depthY: 1418, r: 30 },
      { id: 'rock-5', x: 185, y: 1560, w: 50, h: 32, depthY: 1574, r: 24 }
    ];

    // 4. Public Dog-Waste Bins (Network of 8 bins at authentic Downs locations)
    const binDefinitions = [
      { id: 'bin-1', x: 280, y: 820 },
      { id: 'bin-2', x: 320, y: 1480 },
      { id: 'bin-3', x: 520, y: 1850 },
      { id: 'bin-4', x: 1550, y: 1200 },
      { id: 'bin-5', x: 2500, y: 620 },
      { id: 'bin-6', x: 2280, y: 480 },
      { id: 'bin-7', x: 1420, y: 820 },
      { id: 'bin-8', x: 1080, y: 1750 }
    ];

    this.bins = binDefinitions.map(b => ({
      id: b.id,
      x: b.x,
      y: b.y,
      radius: 12,
      depthY: b.y + 8,
      isBin: true
    }));

    // 5. Wooden Park Benches (including 3 panoramic teak benches along Sea Walls)
    const benchPositions = [
      // Sea Walls panoramic benches angled towards Avon Gorge overlook
      { id: 'bench-sw-1', x: 220, y: 920, angle: -Math.PI / 2 },
      { id: 'bench-sw-2', x: 240, y: 1200, angle: -Math.PI / 2 },
      { id: 'bench-sw-3', x: 260, y: 1480, angle: -Math.PI / 2 },

      // Ladies Mile avenue teak benches
      { id: 'bench-lm-1', x: 480, y: 1840, angle: -0.55 },
      { id: 'bench-lm-2', x: 1590, y: 1160, angle: -0.55 },
      { id: 'bench-lm-3', x: 2550, y: 580, angle: -0.55 },

      // Water Tower clearing benches
      { id: 'bench-wt-1', x: 2320, y: 520, angle: 0 },
      { id: 'bench-wt-2', x: 2480, y: 400, angle: Math.PI },

      // Central meadow grove & south woodland trail benches
      { id: 'bench-cg-1', x: 1380, y: 860, angle: 0 },
      { id: 'bench-sw-wood', x: 1120, y: 1780, angle: 0.3 },
      { id: 'bench-nm-1', x: 1950, y: 420, angle: 0 }
    ];

    this.benches = benchPositions.map((b, idx) => ({
      id: b.id || `bench-${idx}`,
      x: b.x,
      y: b.y,
      w: 64,
      h: 26,
      angle: b.angle || 0,
      depthY: b.y + 13
    }));

    // 6. Mature Tree Arboretum & Scenery Zones
    // A. Ladies Mile Avenue: SW (400, 1900) to NE (2700, 500) lined with sweet chestnut and lime trees
    // B. South Zone: Clifton Down woodland dense oak groves (600-1600, 1600-2200)
    // C. North Zone: Durdham Down open grassland meadow fringe (1800-3000, 200-800)
    // D. West Zone: Sea Walls verge
    // E. Central & East meadows: specimen oaks and chestnuts
    const treePositions = [
      // --- Ladies Mile Avenue Tree Rows (Chestnut & Lime) ---
      // Row 1 (North-West side of avenue)
      { x: 509, y: 1768, r: 62, type: 'chestnut' },
      { x: 693, y: 1656, r: 60, type: 'lime' },
      { x: 877, y: 1544, r: 64, type: 'chestnut' },
      { x: 1061, y: 1432, r: 62, type: 'lime' },
      { x: 1245, y: 1320, r: 66, type: 'chestnut' },
      { x: 1429, y: 1208, r: 64, type: 'lime' },
      { x: 1613, y: 1096, r: 65, type: 'chestnut' },
      { x: 1797, y: 984, r: 63, type: 'lime' },
      { x: 1981, y: 872, r: 66, type: 'chestnut' },
      { x: 2165, y: 760, r: 62, type: 'lime' },
      { x: 2349, y: 648, r: 64, type: 'chestnut' },
      { x: 2533, y: 536, r: 60, type: 'lime' },

      // Row 2 (South-East side of avenue)
      { x: 567, y: 1864, r: 64, type: 'lime' },
      { x: 751, y: 1752, r: 62, type: 'chestnut' },
      { x: 935, y: 1640, r: 65, type: 'lime' },
      { x: 1119, y: 1528, r: 64, type: 'chestnut' },
      { x: 1303, y: 1416, r: 66, type: 'lime' },
      { x: 1487, y: 1304, r: 62, type: 'chestnut' },
      { x: 1671, y: 1192, r: 65, type: 'lime' },
      { x: 1855, y: 1080, r: 63, type: 'chestnut' },
      { x: 2039, y: 968, r: 66, type: 'lime' },
      { x: 2223, y: 856, r: 64, type: 'chestnut' },
      { x: 2407, y: 744, r: 62, type: 'lime' },
      { x: 2591, y: 632, r: 60, type: 'chestnut' },

      // --- South Zone: Clifton Down Woodland Oak Groves (x: 600-1600, y: 1600-2200) ---
      { x: 680, y: 1720, r: 76, type: 'oak' },
      { x: 820, y: 1820, r: 80, type: 'oak' },
      { x: 740, y: 2020, r: 72, type: 'chestnut' },
      { x: 920, y: 1940, r: 82, type: 'oak' },
      { x: 1050, y: 2120, r: 78, type: 'oak' },
      { x: 1180, y: 1980, r: 76, type: 'chestnut' },
      { x: 1340, y: 2160, r: 84, type: 'oak' },
      { x: 1460, y: 2040, r: 76, type: 'oak' },
      { x: 1580, y: 1880, r: 72, type: 'chestnut' },
      { x: 890, y: 2200, r: 75, type: 'oak' },
      { x: 1140, y: 1720, r: 70, type: 'oak' },
      { x: 1280, y: 1840, r: 78, type: 'chestnut' },
      { x: 1440, y: 1700, r: 72, type: 'oak' },
      { x: 990, y: 1640, r: 74, type: 'oak' },
      { x: 640, y: 1880, r: 70, type: 'oak' },
      { x: 1220, y: 2260, r: 78, type: 'oak' },
      { x: 1520, y: 2200, r: 74, type: 'chestnut' },

      // --- North Zone: Durdham Down Grasslands Fringe (x: 1800-3000, y: 200-800) ---
      { x: 1880, y: 320, r: 66, type: 'lime' },
      { x: 2150, y: 260, r: 70, type: 'chestnut' },
      { x: 2680, y: 310, r: 72, type: 'lime' },
      { x: 2980, y: 460, r: 74, type: 'oak' },
      { x: 2880, y: 740, r: 68, type: 'lime' },
      { x: 1980, y: 720, r: 66, type: 'oak' },

      // --- West Zone: Sea Walls Verge (x: 100-500, y: 800-1600) ---
      { x: 420, y: 880, r: 62, type: 'oak' },
      { x: 440, y: 1120, r: 66, type: 'chestnut' },
      { x: 400, y: 1360, r: 64, type: 'oak' },
      { x: 460, y: 1540, r: 68, type: 'lime' },
      { x: 340, y: 680, r: 58, type: 'oak' },

      // --- Central & Open Meadow Specimen Trees ---
      { x: 620, y: 420, r: 74, type: 'oak' },
      { x: 920, y: 350, r: 70, type: 'chestnut' },
      { x: 1280, y: 320, r: 72, type: 'oak' },
      { x: 1580, y: 400, r: 68, type: 'lime' },
      { x: 780, y: 820, r: 76, type: 'oak' },
      { x: 1080, y: 760, r: 72, type: 'chestnut' },
      { x: 1360, y: 880, r: 78, type: 'oak' },
      { x: 1720, y: 1040, r: 70, type: 'lime' },
      { x: 2120, y: 1180, r: 68, type: 'chestnut' },
      { x: 2480, y: 1350, r: 74, type: 'oak' },
      { x: 2780, y: 1220, r: 72, type: 'chestnut' },
      { x: 2940, y: 1650, r: 76, type: 'oak' },
      { x: 2600, y: 1920, r: 70, type: 'lime' },
      { x: 2200, y: 2050, r: 74, type: 'chestnut' },
      { x: 1850, y: 2150, r: 72, type: 'oak' }
    ];

    this.trees = treePositions.map((t, idx) => ({
      id: `tree-${idx}`,
      x: t.x,
      y: t.y,
      radius: t.r,
      type: t.type,
      trunkRadius: Math.round(t.r * 0.28),
      depthY: t.y + 10
    }));

    // 7. Wildflower Patches across Meadows & Woodland Margins
    const flowerTypes = ['buttercup', 'clover', 'bluebell', 'rock_cress'];
    for (let i = 0; i < 110; i++) {
      const cx = 120 + Math.random() * (this.width - 240);
      const cy = 120 + Math.random() * (this.height - 240);
      const count = 5 + Math.floor(Math.random() * 8);
      const type = flowerTypes[i % flowerTypes.length];
      for (let j = 0; j < count; j++) {
        this.wildflowers.push({
          x: cx + (Math.random() - 0.5) * 65,
          y: cy + (Math.random() - 0.5) * 65,
          type: type,
          size: 2.2 + Math.random() * 2.2
        });
      }
    }

    // 8. Victorian Cast-Iron Streetlamps (Network of 12 streetlamps across The Downs)
    const lampPositions = [
      // Along Cotswold avenue path / Ladies Mile
      { id: 'streetlamp-1', x: 700, y: 520 },
      { id: 'streetlamp-2', x: 1100, y: 560 },
      { id: 'streetlamp-3', x: 1600, y: 600 },
      { id: 'streetlamp-4', x: 2100, y: 580 },
      // Near Durdham Down Water Tower landmark
      { id: 'streetlamp-5', x: 2300, y: 480 },
      { id: 'streetlamp-6', x: 2520, y: 490 },
      // Along Sea Walls path
      { id: 'streetlamp-7', x: 280, y: 950 },
      { id: 'streetlamp-8', x: 290, y: 1350 },
      // Central & south park intersections / avenue crossings
      { id: 'streetlamp-9', x: 1200, y: 1100 },
      { id: 'streetlamp-10', x: 1800, y: 1250 },
      { id: 'streetlamp-11', x: 800, y: 1500 },
      { id: 'streetlamp-12', x: 2200, y: 1600 }
    ];

    this.streetlamps = lampPositions.map(l => ({
      id: l.id,
      x: l.x,
      y: l.y,
      radius: 8,           // Base collision/interaction radius
      glowRadius: 120,     // Radius for radial light halo in lighting pass
      intensity: 0.9,      // Light intensity
      color: '#fef08a',    // Warm amber-yellow incandescent glow
      depthY: l.y + 8,     // y + 8 for accurate 2D Y-sorting
      isLamp: true
    }));
  }

  initParticles() {
    this.ambientParticles = [];
    // Floating dandelion seeds / pollen swaying in the Downs breeze
    for (let i = 0; i < 80; i++) {
      this.ambientParticles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: 16 + Math.random() * 26,
        vy: 4 + Math.random() * 14,
        swaySpeed: 1 + Math.random() * 2,
        swayAmp: 1.5 + Math.random() * 2.2,
        radius: 1.2 + Math.random() * 1.5,
        alpha: 0.35 + Math.random() * 0.45
      });
    }
  }

  addPoopPile(poopPile) {
    if (poopPile) {
      this.poopPiles.push(poopPile);
    }
  }

  removePoopPile(id) {
    const idx = this.poopPiles.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.poopPiles.splice(idx, 1);
    }
  }

  getNearestBin(x, y) {
    if (!this.bins || this.bins.length === 0) return null;
    let nearest = null;
    let minDist = Infinity;
    for (const bin of this.bins) {
      const dist = Math.hypot(bin.x - x, bin.y - y);
      if (dist < minDist) {
        minDist = dist;
        nearest = bin;
      }
    }
    return nearest ? { ...nearest, dist: minDist } : null;
  }

  getNearestPoopPile(x, y, maxRange = Infinity) {
    if (!this.poopPiles || this.poopPiles.length === 0) return null;
    let nearest = null;
    let minDist = Infinity;
    for (const pile of this.poopPiles) {
      if (pile.isCleaned) continue;
      const dist = Math.hypot(pile.x - x, pile.y - y);
      if (dist < minDist && dist <= maxRange) {
        minDist = dist;
        nearest = pile;
      }
    }
    if (!nearest) return null;
    nearest.dist = minDist;
    return nearest;
  }

  update(dt) {
    this.windTime += dt;

    // Update poop piles and cull cleaned ones
    for (let i = this.poopPiles.length - 1; i >= 0; i--) {
      const pile = this.poopPiles[i];
      if (typeof pile.update === 'function') {
        pile.update(dt);
      }
      if (pile.isCleaned) {
        this.poopPiles.splice(i, 1);
      }
    }

    // Update ambient dandelion seeds
    for (const p of this.ambientParticles) {
      p.x += (p.vx + Math.sin(this.windTime * p.swaySpeed) * 8) * dt;
      p.y += (p.vy + Math.cos(this.windTime * p.swaySpeed * 0.5) * 4) * dt;

      // Wrap around world borders
      if (p.x > this.width) p.x = 0;
      if (p.y > this.height) p.y = 0;
      if (p.x < 0) p.x = this.width;
      if (p.y < 0) p.y = this.height;
    }
  }

  // Check collision for circle entity (Owner, Companion Dog, Tennis Ball, etc.)
  resolveCircleCollision(x, y, radius) {
    let nx = x;
    let ny = y;

    // 1. World Perimeter bounds clamping
    const minX = 56 + radius;
    const maxX = this.width - 56 - radius;
    const minY = 56 + radius;
    const maxY = this.height - 56 - radius;

    nx = Math.max(minX, Math.min(maxX, nx));
    ny = Math.max(minY, Math.min(maxY, ny));

    // 2. Tree trunk collisions
    for (const tree of this.trees) {
      const dx = nx - tree.x;
      const dy = ny - tree.depthY;
      const dist = Math.hypot(dx, dy);
      const minDist = radius + tree.trunkRadius;

      if (dist < minDist) {
        if (dist > 0.001) {
          const overlap = minDist - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += minDist;
        }
      }
    }

    // 3. Wooden bench collisions (oriented AABB vs circle)
    for (const bench of this.benches) {
      const isVertical = bench.angle && Math.abs(Math.sin(bench.angle)) > 0.7;
      const halfW = (isVertical ? bench.h : bench.w) / 2;
      const halfH = (isVertical ? bench.w : bench.h) / 2;
      const closestX = Math.max(bench.x - halfW, Math.min(nx, bench.x + halfW));
      const closestY = Math.max(bench.y - halfH, Math.min(ny, bench.y + halfH));
      const dx = nx - closestX;
      const dy = ny - closestY;
      const dist = Math.hypot(dx, dy);

      if (dist < radius) {
        if (dist > 0.001) {
          const overlap = radius - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += radius;
        }
      }
    }

    // 4. Public dog-waste bin collisions
    for (const bin of this.bins) {
      const dx = nx - bin.x;
      const dy = ny - bin.y;
      const dist = Math.hypot(dx, dy);
      const minDist = radius + bin.radius;

      if (dist < minDist) {
        if (dist > 0.001) {
          const overlap = minDist - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += minDist;
        }
      }
    }

    // 5. Landmark collisions: Water Tower pavilion
    if (this.waterTower) {
      const dx = nx - this.waterTower.x;
      const dy = ny - this.waterTower.y;
      const dist = Math.hypot(dx, dy);
      const minDist = radius + this.waterTower.radius;

      if (dist < minDist) {
        if (dist > 0.001) {
          const overlap = minDist - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += minDist;
        }
      }
    }

    // 6. Sea Walls limestone rock outcrops
    for (const rock of this.rockOutcrops) {
      const dx = nx - rock.x;
      const dy = ny - (rock.depthY - 8);
      const dist = Math.hypot(dx, dy);
      const minDist = radius + (rock.r || 24);

      if (dist < minDist) {
        if (dist > 0.001) {
          const overlap = minDist - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          ny += minDist;
        }
      }
    }

    return { x: nx, y: ny };
  }

  // Predefined waypoint route loops for ambient park NPCs
  static getParkWaypoints(loopType = 'ladies_mile') {
    const ladies_mile = [
      { x: 420, y: 1880, id: 'lm-sw' },
      { x: 850, y: 1600 },
      { x: 1250, y: 1330 },
      { x: 1650, y: 1080 },
      { x: 2050, y: 830 },
      { x: 2450, y: 620 },
      { x: 2680, y: 520, id: 'lm-ne' },
      { x: 2550, y: 580, isBench: true },
      { x: 2200, y: 760 },
      { x: 1750, y: 1020 },
      { x: 1300, y: 1350 },
      { x: 750, y: 1700 },
      { x: 480, y: 1840, isBench: true }
    ];

    const sea_walls = [
      { x: 280, y: 800 },
      { x: 220, y: 920, isBench: true, isOverlook: true },
      { x: 260, y: 1060 },
      { x: 240, y: 1200, isBench: true, isOverlook: true },
      { x: 270, y: 1360 },
      { x: 260, y: 1480, isBench: true, isOverlook: true },
      { x: 320, y: 1540 },
      { x: 420, y: 1380 },
      { x: 440, y: 1120 },
      { x: 380, y: 880 }
    ];

    const durdham_down = [
      { x: 1550, y: 1200 },
      { x: 1797, y: 984 },
      { x: 1420, y: 820, isOverlook: true },
      { x: 1720, y: 750 },
      { x: 2150, y: 550 },
      { x: 2400, y: 450, isOverlook: true },
      { x: 2320, y: 520, isBench: true },
      { x: 2120, y: 820 },
      { x: 1850, y: 1060 }
    ];

    if (loopType === 'all') {
      return {
        ladies_mile,
        sea_walls,
        durdham_down
      };
    }

    if (loopType === 'sea_walls') {
      return sea_walls;
    }

    if (loopType === 'durdham_down') {
      return durdham_down;
    }

    return ladies_mile;
  }

  getParkWaypoints(loopType = 'ladies_mile') {
    return Field.getParkWaypoints(loopType);
  }

  // Depth-Sorted (Y-sort) Render Pipeline
  getDepthSortedRenderList(viewLeft, viewRight, viewTop, viewBottom, dynamicEntities = []) {
    const renderList = [];

    // Add trees
    for (const tree of this.trees) {
      if (
        tree.x + tree.radius > viewLeft &&
        tree.x - tree.radius < viewRight &&
        tree.y + tree.radius > viewTop &&
        tree.y - tree.radius < viewBottom
      ) {
        renderList.push({
          type: 'tree',
          y: tree.depthY,
          depthY: tree.depthY,
          data: tree
        });
      }
    }

    // Add benches
    for (const bench of this.benches) {
      if (
        bench.x + bench.w > viewLeft &&
        bench.x - bench.w < viewRight &&
        bench.y + bench.h > viewTop &&
        bench.y - bench.h < viewBottom
      ) {
        renderList.push({
          type: 'bench',
          y: bench.depthY,
          depthY: bench.depthY,
          data: bench
        });
      }
    }

    // Add dog-waste bins
    for (const bin of this.bins) {
      if (
        bin.x + bin.radius + 15 > viewLeft &&
        bin.x - bin.radius - 15 < viewRight &&
        bin.y + bin.radius + 25 > viewTop &&
        bin.y - bin.radius - 35 < viewBottom
      ) {
        renderList.push({
          type: 'bin',
          y: bin.depthY,
          depthY: bin.depthY,
          data: bin
        });
      }
    }

    // Add visible dog poop piles
    for (const p of this.poopPiles) {
      if (p.isCleaned) continue;
      if (
        p.x + 20 > viewLeft &&
        p.x - 20 < viewRight &&
        p.y + 20 > viewTop &&
        p.y - 20 < viewBottom
      ) {
        renderList.push({
          type: 'poop',
          y: p.depthY,
          depthY: p.depthY,
          data: p
        });
      }
    }

    // Add Water Tower landmark
    if (this.waterTower) {
      const wt = this.waterTower;
      if (
        wt.x + wt.radius + 40 > viewLeft &&
        wt.x - wt.radius - 40 < viewRight &&
        wt.y + wt.radius + 60 > viewTop &&
        wt.y - wt.radius - 60 < viewBottom
      ) {
        renderList.push({
          type: 'water_tower',
          y: wt.depthY,
          depthY: wt.depthY,
          data: wt
        });
      }
    }

    // Add rocky limestone outcrops
    for (const rock of this.rockOutcrops) {
      if (
        rock.x + rock.w > viewLeft &&
        rock.x - rock.w < viewRight &&
        rock.y + rock.h > viewTop &&
        rock.y - rock.h < viewBottom
      ) {
        renderList.push({
          type: 'rock',
          y: rock.depthY,
          depthY: rock.depthY,
          data: rock
        });
      }
    }

    // Add Victorian streetlamps
    for (const lamp of this.streetlamps) {
      if (
        lamp.x + 30 > viewLeft &&
        lamp.x - 30 < viewRight &&
        lamp.y + 20 > viewTop &&
        lamp.y - 70 < viewBottom
      ) {
        renderList.push({
          type: 'streetlamp',
          y: lamp.depthY,
          data: lamp
        });
      }
    }

    // Add dynamic entities (Owner, Companion Dogs, Tennis Balls, etc.)
    for (const ent of dynamicEntities) {
      if (!ent) continue;
      const ey = ent.depthY !== undefined ? ent.depthY : ent.y;
      renderList.push({
        type: 'entity',
        y: ey,
        depthY: ey,
        data: ent
      });
    }

    // Sort ascending by base Y / depthY coordinate (back to front)
    renderList.sort((a, b) => (a.depthY !== undefined ? a.depthY : a.y) - (b.depthY !== undefined ? b.depthY : b.y));

    return renderList;
  }

  drawSceneryItem(ctx, item) {
    if (!item) return;
    if (item.type === 'tree') {
      this.renderTree(ctx, item.data);
    } else if (item.type === 'bench') {
      this.renderBench(ctx, item.data);
    } else if (item.type === 'bin') {
      this.renderBin(ctx, item.data);
    } else if (item.type === 'poop') {
      if (typeof item.data.draw === 'function') {
        item.data.draw(ctx);
      }
    } else if (item.type === 'water_tower') {
      this.renderWaterTower(ctx, item.data);
    } else if (item.type === 'rock') {
      this.renderRock(ctx, item.data);
    } else if (item.type === 'streetlamp') {
      this.renderStreetlamp(ctx, item.data);
    } else if (item.type === 'entity') {
      if (typeof item.data.draw === 'function') {
        item.data.draw(ctx);
      }
    }
  }

  render(ctx, camera, dynamicEntities = []) {
    const viewLeft = camera.x;
    const viewTop = camera.y;
    const viewRight = camera.x + camera.viewportWidth;
    const viewBottom = camera.y + camera.viewportHeight;

    // 1. Procedural Background Turf & Pathways
    this.renderGround(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 2. Gather Scenery and Dynamic Entities for Depth-Sorted Pass
    const renderList = this.getDepthSortedRenderList(viewLeft, viewRight, viewTop, viewBottom, dynamicEntities);

    // 3. Render all sorted items
    for (const item of renderList) {
      this.drawSceneryItem(ctx, item);
    }

    // 4. Overpass Tree Canopies (Subtle transparent foliage sun glints)
    this.renderCanopyHighlights(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 5. Ambient Dandelion / Pollen Particles
    this.renderParticles(ctx, viewLeft, viewTop, viewRight, viewBottom);

    // 6. Perimeter Boundary Walls
    this.renderPerimeterWalls(ctx);
  }

  renderGround(ctx, left, top, right, bottom) {
    // 1. Fill base turf
    ctx.fillStyle = this.grassBase;
    ctx.fillRect(left, top, right - left, bottom - top);

    // 2. Avon Gorge Cliff Edge Backdrop (beyond West perimeter wall)
    if (left < 100) {
      const cliffGrad = ctx.createLinearGradient(0, top, 80, top);
      cliffGrad.addColorStop(0, '#1a2332');
      cliffGrad.addColorStop(0.5, '#2e3d4f');
      cliffGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = cliffGrad;
      ctx.fillRect(0, top, 80, bottom - top);
    }

    // 3. Durdham Down Meadow Mown Stripes (x: 1800-3050, y: 200-850)
    ctx.save();
    const stripeAngle = -0.22;
    const mownLeft = Math.max(left, 1750);
    const mownRight = Math.min(right, 3050);
    const mownTop = Math.max(top, 180);
    const mownBottom = Math.min(bottom, 880);

    if (mownRight > mownLeft && mownBottom > mownTop) {
      ctx.beginPath();
      ctx.rect(mownLeft, mownTop, mownRight - mownLeft, mownBottom - mownTop);
      ctx.clip();

      const stripeWidth = 44;
      for (let sx = mownLeft - 200; sx < mownRight + 200; sx += stripeWidth * 2) {
        ctx.fillStyle = 'rgba(76, 130, 55, 0.14)';
        ctx.beginPath();
        ctx.moveTo(sx, mownTop);
        ctx.lineTo(sx + Math.tan(stripeAngle) * (mownBottom - mownTop) + stripeWidth, mownTop);
        ctx.lineTo(sx + Math.tan(stripeAngle) * (mownBottom - mownTop), mownBottom);
        ctx.lineTo(sx - stripeWidth, mownBottom);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // 4. Rich Procedural Grass Variations & Subtle Blade Flecks
    ctx.save();
    const patchSize = 80;
    const startX = Math.floor(left / patchSize) * patchSize;
    const startY = Math.floor(top / patchSize) * patchSize;

    for (let x = startX; x <= right; x += patchSize) {
      for (let y = startY; y <= bottom; y += patchSize) {
        const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const noise = hash - Math.floor(hash);

        if (noise > 0.62) {
          ctx.fillStyle = this.grassLight;
          ctx.beginPath();
          ctx.ellipse(x + 40, y + 40, 26, 18, 0, 0, Math.PI * 2);
          ctx.fill();

          // Subtle grass blade flecks
          ctx.strokeStyle = '#5da347';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x + 36, y + 44);
          ctx.lineTo(x + 34, y + 38);
          ctx.moveTo(x + 40, y + 45);
          ctx.lineTo(x + 42, y + 37);
          ctx.stroke();
        } else if (noise < 0.28) {
          ctx.fillStyle = this.grassDark;
          ctx.beginPath();
          ctx.ellipse(x + 40, y + 40, 22, 15, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // 5. Pathways & Avenues
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // A. Central Boulevard: Ladies Mile Avenue (Broad diagonal gravel avenue, width ~54px)
    // Southwest (400, 1900) to Northeast (2700, 500)
    // Soft grass edging
    ctx.strokeStyle = 'rgba(68, 115, 51, 0.45)';
    ctx.lineWidth = 64;
    ctx.beginPath();
    ctx.moveTo(400, 1900);
    ctx.bezierCurveTo(1150, 1450, 1950, 950, 2700, 500);
    ctx.stroke();

    // Cotswold gravel bed
    ctx.strokeStyle = this.pathColor;
    ctx.lineWidth = 54;
    ctx.beginPath();
    ctx.moveTo(400, 1900);
    ctx.bezierCurveTo(1150, 1450, 1950, 950, 2700, 500);
    ctx.stroke();

    // Fine inner gravel walking track
    ctx.strokeStyle = this.pathDetail;
    ctx.lineWidth = 36;
    ctx.beginPath();
    ctx.moveTo(400, 1900);
    ctx.bezierCurveTo(1150, 1450, 1950, 950, 2700, 500);
    ctx.stroke();

    // B. Water Tower Landmark Clearing Plaza (x: 2400, y: 450)
    ctx.fillStyle = 'rgba(72, 118, 55, 0.4)';
    ctx.beginPath();
    ctx.arc(2400, 450, 74, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.pathColor;
    ctx.beginPath();
    ctx.arc(2400, 450, 66, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.pathDetail;
    ctx.beginPath();
    ctx.arc(2400, 450, 54, 0, Math.PI * 2);
    ctx.fill();

    // Spur from Ladies Mile junction (2500, 620) to Water Tower (2400, 450)
    ctx.strokeStyle = this.pathColor;
    ctx.lineWidth = 38;
    ctx.beginPath();
    ctx.moveTo(2500, 620);
    ctx.lineTo(2400, 450);
    ctx.stroke();

    // C. Secondary Woodland Dirt Trails (width ~30px) linking to Ladies Mile
    // Trail 1: South woodland trail connecting to Ladies Mile SW entry (520, 1850)
    ctx.strokeStyle = this.dirtPathEdge;
    ctx.lineWidth = 34;
    ctx.beginPath();
    ctx.moveTo(760, 2240);
    ctx.bezierCurveTo(680, 2080, 560, 1950, 520, 1850);
    ctx.stroke();

    ctx.strokeStyle = this.dirtPathColor;
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(760, 2240);
    ctx.bezierCurveTo(680, 2080, 560, 1950, 520, 1850);
    ctx.stroke();

    // Trail 2: South woodland trail winding through junction (1080, 1750) to Ladies Mile midpoint (1550, 1200)
    ctx.strokeStyle = this.dirtPathEdge;
    ctx.lineWidth = 34;
    ctx.beginPath();
    ctx.moveTo(1350, 2200);
    ctx.bezierCurveTo(1240, 1980, 1120, 1820, 1080, 1750);
    ctx.bezierCurveTo(1040, 1620, 1380, 1400, 1550, 1200);
    ctx.stroke();

    ctx.strokeStyle = this.dirtPathColor;
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(1350, 2200);
    ctx.bezierCurveTo(1240, 1980, 1120, 1820, 1080, 1750);
    ctx.bezierCurveTo(1040, 1620, 1380, 1400, 1550, 1200);
    ctx.stroke();

    // Trail 3: Cross-meadow trail linking Ladies Mile midpoint (1550, 1200) to Sea Walls lookout (280, 1200)
    ctx.strokeStyle = this.dirtPathEdge;
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(1550, 1200);
    ctx.bezierCurveTo(1150, 1220, 680, 1180, 280, 1200);
    ctx.stroke();

    ctx.strokeStyle = this.dirtPathColor;
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(1550, 1200);
    ctx.bezierCurveTo(1150, 1220, 680, 1180, 280, 1200);
    ctx.stroke();

    // Trail 4: Sea Walls panoramic cliff-top trail (north-south along x: 280)
    ctx.strokeStyle = this.pathColor;
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(280, 780);
    ctx.bezierCurveTo(260, 1050, 270, 1350, 320, 1550);
    ctx.stroke();

    // Trail 5: Trail branch to central meadow grove (1420, 820)
    ctx.strokeStyle = this.dirtPathColor;
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(1797, 984);
    ctx.bezierCurveTo(1620, 920, 1520, 850, 1420, 820);
    ctx.stroke();

    ctx.restore();

    // 6. Render Wildflowers
    ctx.save();
    for (const f of this.wildflowers) {
      if (f.x >= left && f.x <= right && f.y >= top && f.y <= bottom) {
        if (f.type === 'buttercup') {
          ctx.fillStyle = '#f3c948';
        } else if (f.type === 'clover') {
          ctx.fillStyle = '#f8fafc';
        } else if (f.type === 'bluebell') {
          ctx.fillStyle = '#6b8be8';
        } else {
          ctx.fillStyle = '#e879a8';
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Render mature tree with layered leafy canopies, distinct species hues, and soft ground shadows
  renderTree(ctx, tree) {
    ctx.save();

    // 1. Soft Ground Shadow
    ctx.fillStyle = 'rgba(22, 42, 16, 0.35)';
    ctx.beginPath();
    ctx.ellipse(tree.x + 8, tree.depthY + 6, tree.radius * 0.92, tree.radius * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Trunk with textured bark details
    ctx.fillStyle = '#3a2114';
    ctx.beginPath();
    ctx.ellipse(tree.x, tree.depthY, tree.trunkRadius, tree.trunkRadius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4e2d1c';
    ctx.fillRect(tree.x - tree.trunkRadius * 0.75, tree.y - 12, tree.trunkRadius * 1.5, tree.depthY - (tree.y - 12));

    // Vertical bark ridges
    ctx.fillStyle = '#2d180c';
    ctx.fillRect(tree.x - 2, tree.y, 4, tree.depthY - tree.y);

    // 3. Species-Specific Canopy Hues
    let baseColor = '#25481d';
    let midColor = '#34652a';
    let lightColor = '#478239';

    if (tree.type === 'chestnut') {
      baseColor = '#2e4a1a';
      midColor = '#426b26';
      lightColor = '#598c36';
    } else if (tree.type === 'lime') {
      baseColor = '#2f581e';
      midColor = '#467b2d';
      lightColor = '#63a03f';
    }

    // Base dark canopy
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
    ctx.fill();

    // Mid puff foliage clusters
    ctx.fillStyle = midColor;
    const puffs = [
      { dx: -tree.radius * 0.45, dy: -tree.radius * 0.22, r: tree.radius * 0.55 },
      { dx: tree.radius * 0.42, dy: -tree.radius * 0.26, r: tree.radius * 0.52 },
      { dx: 0, dy: -tree.radius * 0.42, r: tree.radius * 0.5 },
      { dx: -tree.radius * 0.28, dy: tree.radius * 0.24, r: tree.radius * 0.46 },
      { dx: tree.radius * 0.32, dy: tree.radius * 0.22, r: tree.radius * 0.48 }
    ];
    for (const p of puffs) {
      ctx.beginPath();
      ctx.arc(tree.x + p.dx, tree.y + p.dy, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Top sunlight highlights
    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.arc(tree.x - tree.radius * 0.18, tree.y - tree.radius * 0.28, tree.radius * 0.44, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Render wooden park bench with orientation support
  renderBench(ctx, bench) {
    ctx.save();
    ctx.translate(bench.x, bench.y);
    if (bench.angle) {
      ctx.rotate(bench.angle);
    }

    // Drop shadow
    ctx.fillStyle = 'rgba(22, 42, 16, 0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 12, bench.w / 2 + 4, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    const halfW = bench.w / 2;
    const halfH = bench.h / 2;

    // Cast iron frame legs
    ctx.fillStyle = '#2d3748';
    ctx.fillRect(-halfW + 6, -halfH + 4, 6, bench.h);
    ctx.fillRect(halfW - 12, -halfH + 4, 6, bench.h);

    // Warm teak wood slats
    ctx.fillStyle = '#8f562b';
    ctx.fillRect(-halfW, -halfH + 4, bench.w, 7);
    ctx.fillStyle = '#a66735';
    ctx.fillRect(-halfW, -halfH + 13, bench.w, 8);

    // Subtle slat divider lines
    ctx.strokeStyle = '#5a3418';
    ctx.lineWidth = 1;
    ctx.strokeRect(-halfW, -halfH + 4, bench.w, 7);
    ctx.strokeRect(-halfW, -halfH + 13, bench.w, 8);

    ctx.restore();
  }

  // Render authentic public dog-waste bin (dark green cylinder, red canister band, white paw decal)
  renderBin(ctx, bin) {
    ctx.save();

    // 1. Soft Drop Shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.38)';
    ctx.beginPath();
    ctx.ellipse(bin.x, bin.depthY, bin.radius * 1.15, bin.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Mounting bracket post
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(bin.x - 2, bin.depthY - 26, 4, 26);

    // 3. Dark Green Cylinder Body (#1b4332)
    const bodyW = bin.radius * 2;
    const bodyTop = bin.depthY - 24;

    ctx.fillStyle = '#1b4332';
    // Rounded bottom curve of cylinder
    ctx.beginPath();
    ctx.ellipse(bin.x, bin.depthY - 4, bin.radius, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main cylinder body
    ctx.fillRect(bin.x - bin.radius, bodyTop, bodyW, 20);

    // Cylindrical subtle highlight / shade
    const grad = ctx.createLinearGradient(bin.x - bin.radius, bodyTop, bin.x + bin.radius, bodyTop);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.16)');
    grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.08)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(bin.x - bin.radius, bodyTop, bodyW, 20);

    // 4. Red Canister Band (#b91c1c)
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(bin.x - bin.radius, bin.depthY - 17, bodyW, 7);

    // 5. White Paw / Dog Decal on red band
    ctx.fillStyle = '#ffffff';
    // Main paw pad
    ctx.beginPath();
    ctx.ellipse(bin.x, bin.depthY - 13.5, 2.4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 3 small toe pads
    ctx.beginPath();
    ctx.arc(bin.x - 2.5, bin.depthY - 16, 0.9, 0, Math.PI * 2);
    ctx.arc(bin.x, bin.depthY - 16.5, 0.9, 0, Math.PI * 2);
    ctx.arc(bin.x + 2.5, bin.depthY - 16, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // 6. Top Hood / Lid
    ctx.fillStyle = '#143124';
    ctx.beginPath();
    ctx.ellipse(bin.x, bodyTop, bin.radius, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 7. Dark Top Slot
    ctx.fillStyle = '#09130e';
    ctx.beginPath();
    ctx.ellipse(bin.x, bodyTop - 1, bin.radius * 0.65, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Render Victorian Stone Water Tower landmark pavilion
  renderWaterTower(ctx, wt) {
    ctx.save();

    // 1. Soft Ground Shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.35)';
    ctx.beginPath();
    ctx.ellipse(wt.x + 12, wt.depthY + 6, wt.radius * 1.3, wt.radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Base Stone Plinth & Flagstone Terrace
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.ellipse(wt.x, wt.depthY, wt.radius * 1.15, wt.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Victorian Masonry Stone Cylinder Tower
    const towerH = 58;
    const towerTop = wt.depthY - towerH;

    const stoneGrad = ctx.createLinearGradient(wt.x - wt.radius, towerTop, wt.x + wt.radius, towerTop);
    stoneGrad.addColorStop(0, '#475569');
    stoneGrad.addColorStop(0.35, '#94a3b8');
    stoneGrad.addColorStop(0.7, '#64748b');
    stoneGrad.addColorStop(1, '#334155');

    ctx.fillStyle = stoneGrad;
    ctx.fillRect(wt.x - wt.radius, towerTop, wt.radius * 2, towerH);

    // Stone base curve
    ctx.beginPath();
    ctx.ellipse(wt.x, wt.depthY, wt.radius, wt.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // 4. Arched Victorian Windows
    const windowY = wt.depthY - 32;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.ellipse(wt.x - 18, windowY, 5, 9, 0, 0, Math.PI * 2);
    ctx.ellipse(wt.x + 18, windowY, 5, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Window lintels
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(wt.x - 18, windowY - 4, 6, Math.PI, 0);
    ctx.arc(wt.x + 18, windowY - 4, 6, Math.PI, 0);
    ctx.stroke();

    // 5. Decorative Stone Corbel Ring & Cornice
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(wt.x - wt.radius - 4, towerTop - 4, (wt.radius + 4) * 2, 6);

    ctx.fillStyle = '#334155';
    // Corbel brackets
    for (let bx = wt.x - wt.radius; bx <= wt.x + wt.radius; bx += 10) {
      ctx.fillRect(bx, towerTop + 2, 4, 5);
    }

    // 6. Conical Slate / Patina Roof Ring with Decorative Finial
    const roofH = 34;
    const roofTop = towerTop - roofH;

    const roofGrad = ctx.createLinearGradient(wt.x - wt.radius, roofTop, wt.x + wt.radius, towerTop);
    roofGrad.addColorStop(0, '#2e4a42');
    roofGrad.addColorStop(0.4, '#477a6e');
    roofGrad.addColorStop(1, '#1b302a');

    ctx.fillStyle = roofGrad;
    ctx.beginPath();
    ctx.moveTo(wt.x, roofTop);
    ctx.lineTo(wt.x - wt.radius - 6, towerTop);
    ctx.lineTo(wt.x + wt.radius + 6, towerTop);
    ctx.closePath();
    ctx.fill();

    // Decorative roof ring
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(wt.x, towerTop - 12, wt.radius * 0.6, 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Decorative brass finial sphere
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(wt.x, roofTop - 3, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Render rocky limestone outcrop along Sea Walls overlook
  renderRock(ctx, rock) {
    ctx.save();

    // Ground shadow
    ctx.fillStyle = 'rgba(20, 35, 15, 0.35)';
    ctx.beginPath();
    ctx.ellipse(rock.x, rock.depthY, rock.w / 2 + 4, rock.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Weathered Bristol limestone crag
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(rock.x - rock.w / 2, rock.depthY - 4);
    ctx.lineTo(rock.x - rock.w * 0.3, rock.depthY - rock.h);
    ctx.lineTo(rock.x + rock.w * 0.2, rock.depthY - rock.h + 2);
    ctx.lineTo(rock.x + rock.w / 2, rock.depthY - 6);
    ctx.lineTo(rock.x + rock.w * 0.3, rock.depthY + 4);
    ctx.closePath();
    ctx.fill();

    // Sunlight facet
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(rock.x - rock.w * 0.3, rock.depthY - rock.h);
    ctx.lineTo(rock.x + rock.w * 0.1, rock.depthY - rock.h + 2);
    ctx.lineTo(rock.x, rock.depthY - rock.h * 0.4);
    ctx.lineTo(rock.x - rock.w * 0.35, rock.depthY - rock.h * 0.3);
    ctx.closePath();
    ctx.fill();

    // Moss / Lichen spots
    ctx.fillStyle = '#556b3e';
    ctx.beginPath();
    ctx.arc(rock.x - 8, rock.depthY - 12, 3.5, 0, Math.PI * 2);
    ctx.arc(rock.x + 10, rock.depthY - 10, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Render authentic Victorian cast-iron park streetlamp
  renderStreetlamp(ctx, lamp) {
    ctx.save();

    // 1. Elliptical base ground shadow (rgba(0, 0, 0, 0.25))
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(lamp.x + 3, lamp.depthY, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Cast-iron post: flared base and decorative plinth (#1e293b / #262626)
    ctx.fillStyle = '#1e293b';
    // Flared tiered base
    ctx.beginPath();
    ctx.moveTo(lamp.x - 7, lamp.depthY);
    ctx.lineTo(lamp.x - 5, lamp.depthY - 5);
    ctx.lineTo(lamp.x - 3, lamp.depthY - 10);
    ctx.lineTo(lamp.x + 3, lamp.depthY - 10);
    ctx.lineTo(lamp.x + 5, lamp.depthY - 5);
    ctx.lineTo(lamp.x + 7, lamp.depthY);
    ctx.closePath();
    ctx.fill();

    // Base collar ring
    ctx.fillStyle = '#262626';
    ctx.fillRect(lamp.x - 4, lamp.depthY - 12, 8, 2.5);

    // Tapered vertical shaft (from y - 12 up to lantern base y - 44)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(lamp.x - 2.5, lamp.depthY - 12);
    ctx.lineTo(lamp.x - 2, lamp.depthY - 44);
    ctx.lineTo(lamp.x + 2, lamp.depthY - 44);
    ctx.lineTo(lamp.x + 2.5, lamp.depthY - 12);
    ctx.closePath();
    ctx.fill();

    // Shaft middle decorative ring
    ctx.fillStyle = '#262626';
    ctx.fillRect(lamp.x - 3.5, lamp.depthY - 28, 7, 2);

    // 3. Decorative ladder bar crossarm (Victorian lamplighter ladder rest)
    ctx.fillStyle = '#262626';
    ctx.fillRect(lamp.x - 9, lamp.depthY - 40, 18, 2);
    // Ladder bar end finial knobs
    ctx.beginPath();
    ctx.arc(lamp.x - 9, lamp.depthY - 39, 1.5, 0, Math.PI * 2);
    ctx.arc(lamp.x + 9, lamp.depthY - 39, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 4. Lantern cradle / base bracket
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(lamp.x - 4, lamp.depthY - 44);
    ctx.lineTo(lamp.x - 6.5, lamp.depthY - 47);
    ctx.lineTo(lamp.x + 6.5, lamp.depthY - 47);
    ctx.lineTo(lamp.x + 4, lamp.depthY - 44);
    ctx.closePath();
    ctx.fill();

    // 5. Four-pane glass lantern casing with black iron framing
    const lanternBottomY = lamp.depthY - 47;
    const lanternTopY = lamp.depthY - 58;
    const lanternHalfWBottom = 6;
    const lanternHalfWTop = 7.5;

    // Glass chamber fill (subtle warm glow background)
    ctx.fillStyle = 'rgba(254, 240, 138, 0.45)';
    ctx.beginPath();
    ctx.moveTo(lamp.x - lanternHalfWBottom, lanternBottomY);
    ctx.lineTo(lamp.x - lanternHalfWTop, lanternTopY);
    ctx.lineTo(lamp.x + lanternHalfWTop, lanternTopY);
    ctx.lineTo(lamp.x + lanternHalfWBottom, lanternBottomY);
    ctx.closePath();
    ctx.fill();

    // 6. Warm luminous lantern glow core inside glass chamber
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(lamp.x, (lanternBottomY + lanternTopY) / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(lamp.x, (lanternBottomY + lanternTopY) / 2, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Lantern glass panes black iron frame & vertical divider
    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(lamp.x - lanternHalfWBottom, lanternBottomY);
    ctx.lineTo(lamp.x - lanternHalfWTop, lanternTopY);
    ctx.lineTo(lamp.x + lanternHalfWTop, lanternTopY);
    ctx.lineTo(lamp.x + lanternHalfWBottom, lanternBottomY);
    ctx.closePath();
    ctx.stroke();

    // Center vertical pane strut
    ctx.beginPath();
    ctx.moveTo(lamp.x, lanternBottomY);
    ctx.lineTo(lamp.x, lanternTopY);
    ctx.stroke();

    // 7. Victorian Lantern Cap / Hood and pointed top finial
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(lamp.x - lanternHalfWTop - 1.5, lanternTopY);
    ctx.lineTo(lamp.x, lanternTopY - 5);
    ctx.lineTo(lamp.x + lanternHalfWTop + 1.5, lanternTopY);
    ctx.closePath();
    ctx.fill();

    // Pointed top finial spire
    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lamp.x, lanternTopY - 5);
    ctx.lineTo(lamp.x, lanternTopY - 9);
    ctx.stroke();

    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(lamp.x, lanternTopY - 7, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Provider method returning all active illumination emitters for environment lighting pass
  getLightSources() {
    const sources = [];

    // 1. All registered streetlamps
    if (this.streetlamps && Array.isArray(this.streetlamps)) {
      for (const lamp of this.streetlamps) {
        sources.push({
          id: lamp.id,
          x: lamp.x,
          y: lamp.y,
          radius: lamp.radius,
          glowRadius: lamp.glowRadius,
          intensity: lamp.intensity,
          color: lamp.color
        });
      }
    }

    // 2. Landmark beacon for Durdham Down Water Tower
    if (this.waterTower) {
      sources.push({
        id: 'water-tower-beacon',
        x: this.waterTower.x,
        y: this.waterTower.y - 20,
        radius: 36,
        glowRadius: 150,
        intensity: 0.85,
        color: '#fef3c7'
      });
    }

    return sources;
  }

  renderCanopyHighlights(ctx, left, top, right, bottom) {
    // Subtle golden hour sun-glint across the top leaves
    ctx.save();
    ctx.fillStyle = 'rgba(243, 201, 72, 0.09)';
    for (const tree of this.trees) {
      if (tree.x > left - 100 && tree.x < right + 100 && tree.y > top - 100 && tree.y < bottom + 100) {
        ctx.beginPath();
        ctx.arc(tree.x - tree.radius * 0.3, tree.y - tree.radius * 0.3, tree.radius * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  renderParticles(ctx, left, top, right, bottom) {
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    for (const p of this.ambientParticles) {
      if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) {
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  renderPerimeterWalls(ctx) {
    ctx.save();

    for (const b of this.boundaries) {
      if (b.type === 'seawall') {
        // West: Dramatic "Sea Walls" cliff edge perimeter wall with iron railings overlooking Avon Gorge
        // 1. Heavy stone parapet base
        ctx.fillStyle = '#475569';
        ctx.fillRect(b.x, b.y, b.w, b.h);

        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);

        // Stone cap slab
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(b.x + b.w - 6, b.y, 6, b.h);

        // 2. Iron railings overlooking the Avon Gorge
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;

        // Horizontal iron top rail
        ctx.beginPath();
        ctx.moveTo(b.x + 8, b.y);
        ctx.lineTo(b.x + 8, b.y + b.h);
        ctx.stroke();

        // Vertical railing pickets every 12px
        for (let ry = b.y + 6; ry < b.y + b.h - 6; ry += 12) {
          ctx.beginPath();
          ctx.moveTo(b.x + 2, ry);
          ctx.lineTo(b.x + 14, ry);
          ctx.stroke();

          // Spearhead finial
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(b.x + 8, ry, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Traditional Pennant stone boundary wall (North, East, South)
        ctx.fillStyle = '#4a5568';
        ctx.fillRect(b.x, b.y, b.w, b.h);

        ctx.strokeStyle = '#2d3748';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x, b.y, b.w, b.h);

        // Stone cap texture highlights
        ctx.fillStyle = '#718096';
        if (b.w > b.h) {
          ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, 3);
        } else {
          ctx.fillRect(b.x + 2, b.y + 2, 3, b.h - 4);
        }
      }
    }

    // Four corner stone pillars
    const margin = 36;
    const corners = [
      { x: margin - 6, y: margin - 6 },
      { x: this.width - margin - 14, y: margin - 6 },
      { x: margin - 6, y: this.height - margin - 14 },
      { x: this.width - margin - 14, y: this.height - margin - 14 }
    ];

    ctx.fillStyle = '#2d3748';
    for (const c of corners) {
      ctx.fillRect(c.x, c.y, 24, 24);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(c.x + 4, c.y + 4, 16, 16);
      ctx.fillStyle = '#2d3748';
    }

    ctx.restore();
  }
}

```

## FILE: ./src/world/npc_paths.js

```typescript
// The Downs (Clifton & Durdham Downs) - Precomputed Obstacle-Free NPC Path Library
// Generated offline by tools/generate_npc_paths.py (Ticket-025)

export const NPC_PATHS = [
  {
    "id": "ladies-mile-loop",
    "type": "both",
    "waypoints": [
      {
        "x": 400,
        "y": 1950
      },
      {
        "x": 656,
        "y": 1936
      },
      {
        "x": 800,
        "y": 1776
      },
      {
        "x": 780,
        "y": 1660
      },
      {
        "x": 1072,
        "y": 1488
      },
      {
        "x": 1150,
        "y": 1420
      },
      {
        "x": 1280,
        "y": 1360
      },
      {
        "x": 1472,
        "y": 1248
      },
      {
        "x": 1480,
        "y": 1220
      },
      {
        "x": 1568,
        "y": 1088
      },
      {
        "x": 1776,
        "y": 944
      },
      {
        "x": 1950,
        "y": 940
      },
      {
        "x": 2016,
        "y": 912
      },
      {
        "x": 2192,
        "y": 800
      },
      {
        "x": 2300,
        "y": 720
      },
      {
        "x": 2384,
        "y": 688
      },
      {
        "x": 2512,
        "y": 496
      },
      {
        "x": 2680,
        "y": 500
      },
      {
        "x": 2700,
        "y": 600
      },
      {
        "x": 2500,
        "y": 780
      },
      {
        "x": 2100,
        "y": 1050
      },
      {
        "x": 1650,
        "y": 1350
      },
      {
        "x": 1200,
        "y": 1620
      },
      {
        "x": 816,
        "y": 1888
      },
      {
        "x": 750,
        "y": 1900
      },
      {
        "x": 640,
        "y": 1936
      },
      {
        "x": 400,
        "y": 1950
      }
    ]
  },
  {
    "id": "sea-walls-promenade",
    "type": "both",
    "waypoints": [
      {
        "x": 340,
        "y": 760
      },
      {
        "x": 340,
        "y": 950
      },
      {
        "x": 340,
        "y": 1200
      },
      {
        "x": 340,
        "y": 1400
      },
      {
        "x": 368,
        "y": 1488
      },
      {
        "x": 340,
        "y": 1580
      },
      {
        "x": 490,
        "y": 1450
      },
      {
        "x": 490,
        "y": 1150
      },
      {
        "x": 490,
        "y": 880
      },
      {
        "x": 340,
        "y": 760
      }
    ]
  },
  {
    "id": "durdham-down-circuit",
    "type": "jogger",
    "waypoints": [
      {
        "x": 1750,
        "y": 600
      },
      {
        "x": 1800,
        "y": 200
      },
      {
        "x": 2200,
        "y": 180
      },
      {
        "x": 2650,
        "y": 200
      },
      {
        "x": 2950,
        "y": 350
      },
      {
        "x": 2900,
        "y": 650
      },
      {
        "x": 2500,
        "y": 780
      },
      {
        "x": 2416,
        "y": 704
      },
      {
        "x": 2336,
        "y": 704
      },
      {
        "x": 2100,
        "y": 650
      },
      {
        "x": 1750,
        "y": 600
      }
    ]
  },
  {
    "id": "woodland-trail-loop",
    "type": "walker",
    "waypoints": [
      {
        "x": 650,
        "y": 1800
      },
      {
        "x": 800,
        "y": 1950
      },
      {
        "x": 820,
        "y": 2150
      },
      {
        "x": 1056,
        "y": 2176
      },
      {
        "x": 1072,
        "y": 2176
      },
      {
        "x": 1100,
        "y": 2150
      },
      {
        "x": 1380,
        "y": 2100
      },
      {
        "x": 1400,
        "y": 1850
      },
      {
        "x": 1200,
        "y": 1750
      },
      {
        "x": 1184,
        "y": 1712
      },
      {
        "x": 1152,
        "y": 1680
      },
      {
        "x": 960,
        "y": 1696
      },
      {
        "x": 900,
        "y": 1700
      },
      {
        "x": 768,
        "y": 1808
      },
      {
        "x": 650,
        "y": 1800
      }
    ]
  },
  {
    "id": "central-meadow-ramble",
    "type": "walker",
    "waypoints": [
      {
        "x": 1200,
        "y": 950
      },
      {
        "x": 1376,
        "y": 944
      },
      {
        "x": 1500,
        "y": 850
      },
      {
        "x": 1850,
        "y": 800
      },
      {
        "x": 1968,
        "y": 928
      },
      {
        "x": 2096,
        "y": 944
      },
      {
        "x": 2100,
        "y": 950
      },
      {
        "x": 2100,
        "y": 1120
      },
      {
        "x": 1840,
        "y": 1136
      },
      {
        "x": 1750,
        "y": 1120
      },
      {
        "x": 1600,
        "y": 1056
      },
      {
        "x": 1400,
        "y": 1050
      },
      {
        "x": 1200,
        "y": 950
      }
    ]
  },
  {
    "id": "trans-downs-express",
    "type": "jogger",
    "waypoints": [
      {
        "x": 150,
        "y": 2000
      },
      {
        "x": 400,
        "y": 1950
      },
      {
        "x": 656,
        "y": 1936
      },
      {
        "x": 800,
        "y": 1776
      },
      {
        "x": 896,
        "y": 1632
      },
      {
        "x": 1040,
        "y": 1488
      },
      {
        "x": 1072,
        "y": 1488
      },
      {
        "x": 1150,
        "y": 1420
      },
      {
        "x": 1408,
        "y": 1360
      },
      {
        "x": 1504,
        "y": 1360
      },
      {
        "x": 1712,
        "y": 1232
      },
      {
        "x": 1840,
        "y": 1040
      },
      {
        "x": 1950,
        "y": 940
      },
      {
        "x": 2016,
        "y": 912
      },
      {
        "x": 2192,
        "y": 800
      },
      {
        "x": 2336,
        "y": 608
      },
      {
        "x": 2528,
        "y": 496
      },
      {
        "x": 2680,
        "y": 500
      },
      {
        "x": 2850,
        "y": 200
      }
    ]
  },
  {
    "id": "sea-walls-to-water-tower",
    "type": "walker",
    "waypoints": [
      {
        "x": 90,
        "y": 950
      },
      {
        "x": 272,
        "y": 992
      },
      {
        "x": 340,
        "y": 1000
      },
      {
        "x": 700,
        "y": 1050
      },
      {
        "x": 1150,
        "y": 950
      },
      {
        "x": 1376,
        "y": 944
      },
      {
        "x": 1650,
        "y": 800
      },
      {
        "x": 2064,
        "y": 656
      },
      {
        "x": 2100,
        "y": 650
      },
      {
        "x": 2352,
        "y": 576
      },
      {
        "x": 2450,
        "y": 520
      },
      {
        "x": 2544,
        "y": 416
      },
      {
        "x": 2650,
        "y": 120
      }
    ]
  },
  {
    "id": "clifton-woodland-traverse",
    "type": "walker",
    "waypoints": [
      {
        "x": 1350,
        "y": 2260
      },
      {
        "x": 1392,
        "y": 2176
      },
      {
        "x": 1376,
        "y": 2128
      },
      {
        "x": 1350,
        "y": 2100
      },
      {
        "x": 1488,
        "y": 1952
      },
      {
        "x": 1650,
        "y": 1950
      },
      {
        "x": 2000,
        "y": 1800
      },
      {
        "x": 2400,
        "y": 1600
      },
      {
        "x": 2800,
        "y": 1450
      },
      {
        "x": 3100,
        "y": 1300
      }
    ]
  },
  {
    "id": "north-meadow-diagonal",
    "type": "both",
    "waypoints": [
      {
        "x": 1400,
        "y": 90
      },
      {
        "x": 1400,
        "y": 300
      },
      {
        "x": 1700,
        "y": 600
      },
      {
        "x": 2000,
        "y": 1000
      },
      {
        "x": 2080,
        "y": 1216
      },
      {
        "x": 2350,
        "y": 1500
      },
      {
        "x": 2650,
        "y": 1900
      },
      {
        "x": 2800,
        "y": 2260
      }
    ]
  },
  {
    "id": "perimeter-grand-loop",
    "type": "jogger",
    "waypoints": [
      {
        "x": 150,
        "y": 200
      },
      {
        "x": 1400,
        "y": 150
      },
      {
        "x": 2700,
        "y": 150
      },
      {
        "x": 3050,
        "y": 250
      },
      {
        "x": 3050,
        "y": 1200
      },
      {
        "x": 3050,
        "y": 2100
      },
      {
        "x": 2800,
        "y": 2250
      },
      {
        "x": 1900,
        "y": 2250
      },
      {
        "x": 1488,
        "y": 2256
      },
      {
        "x": 1216,
        "y": 2224
      },
      {
        "x": 1100,
        "y": 2250
      },
      {
        "x": 864,
        "y": 2256
      },
      {
        "x": 450,
        "y": 2200
      },
      {
        "x": 100,
        "y": 1700
      },
      {
        "x": 100,
        "y": 900
      },
      {
        "x": 150,
        "y": 200
      }
    ]
  }
];

export const NPC_PATH_IDS = NPC_PATHS.map(p => p.id);

export function getNpcPath(id) {
  return NPC_PATHS.find(p => p.id === id) || null;
}

```
