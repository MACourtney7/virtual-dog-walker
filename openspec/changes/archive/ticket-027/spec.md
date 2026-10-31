# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-027"
title: "Global NPC Protocol & Server Spawners (PartyServer + Python)"
state: "DRAFT"
roadmap: "improved-npcs"
depends_on: ["ticket-025"]
created_at: "2026-10-15T19:45:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-027/main"
max_review_cycles: 3
---
```

Roadmap: `openspec/roadmaps/improved-npcs.md`

## 1. Problem Statement
Make NPC spawning global and server-authoritative. Scope: `src/net/protocol.js`, `party/server.js`, `server/server.py`, `test/test_npc_server.py` (new).

## 2. Technical Specification
- New messages: `NPC_SPAWN { id, pathId, type, seed, spawnTime }`, `NPC_DESPAWN { id }`, `NPC_SNAPSHOT { npcs: [...], serverTime }` sent on connect/HELLO. Include `serverTime` for clock offset.
- Each room keeps a pool of N active slots (target 4-6 of a larger path set); picks random unused-ish path, type compatible with path, random 32-bit seed.
- Lifetime = `lengthPx / speed` from `npc_path_manifest.json` (speeds 35 / 80). On expiry: broadcast `NPC_DESPAWN`, then spawn a replacement after a 1-5 s random gap.
- Spawner runs only while >= 1 client is connected and stops when the room empties; new connections receive a snapshot immediately.
- Implemented in both PartyServer (Durable Object alarms/timers) and Python server (asyncio).
- Protocol validators/builders in `protocol.js` for the new messages.

## 3. Acceptance Criteria
- AC-027.1 Two clients connected receive identical `NPC_SPAWN` data.
- AC-027.2 Late joiner receives snapshot containing all active NPCs with original spawnTime.
- AC-027.3 Every NPC is despawned after its lifetime and replaced; active count stays within 4-6.
- AC-027.4 Not all path options are active simultaneously.
- AC-027.5 Spawner idles when room is empty.
- AC-027.6 Tests added and `python3 test/run_tests.py` passes.

