# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-030"
title: "Edge-to-Edge Global NPC Paths, Relaxed Pacing, and Authoritative Sync Hardening"
state: "PLANNING"
roadmap: "npc-polish-and-cleanup"
depends_on: []
created_at: "2026-10-31T14:37:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-030/main"
max_review_cycles: 3
---
```

Roadmap: `openspec/roadmaps/npc-polish-and-cleanup.md`

## 1. Problem Statement
The current NPC implementation in production exhibits four player-visible issues:
1. **Interior Spawning/Despawning**: 6 of the 10 paths in `src/world/npc_paths.js` start and end inside the central meadow (e.g. `(1200, 950)`), popping NPCs into view out of thin air.
2. **Excessive Movement Speed & Rapid Leg Churn**: Walkers (35 px/s) and joggers (80 px/s) move too fast and leg animation multiplier is frantic.
3. **Startup Solo-Spawn Race Condition**: `CliftonDownGame` invokes `updateLocalSpawner(0)` before asynchronous WebSocket connection completes, creating 5 local unsynced NPCs before `NPC_SNAPSHOT` arrives.
4. **Synchronized Wave Spawning**: `ParkServer.initSpawner()` initializes all initial NPCs with `spawnTime = Date.now()`, causing all 5 initial NPCs to begin at distance 0 simultaneously.

## 2. Technical Specification
1. **Slow Down NPCs**:
   - Update `NPC_SPEED` in `src/entities/npc_content.js`, `party/server.js`, and `server/server.py` to:
     - `walker`: 22 px/s
     - `jogger`: 48 px/s
   - Update leg swing `walkPhase` in `src/entities/npc.js`:
     - `walker`: multiplier 6.2
     - `jogger`: multiplier 9.8
2. **Strictly Edge-to-Edge Paths**:
   - Replace closed interior loops in `src/world/npc_paths.js` and `src/world/npc_path_manifest.json` with 10 point-to-point edge-to-edge paths spanning map boundaries (`x <= 20` or `x >= 3180` or `y <= 20` or `y >= 2380`).
   - Validate obstacle clearances against all trees, benches, and bins in `src/world/field.js`.
3. **Entry Fade-in & Angular Turning Smoothing**:
   - Add a 0.5s fade-in at spawn (`elapsed < 0.5`) in `src/entities/npc.js` matching the 0.5s fade-out at route completion.
   - Smooth `this.angle` transitions across polyline waypoint turns.
4. **Global Sync Hardening & Pre-Warmed Server Spawner**:
   - Guard local solo spawner in `src/main.js` so it does not spawn local NPCs while connection is pending/connecting.
   - Pre-warm `spawnTime` in `party/server.js` and `server/server.py` during `initSpawner()` using negative time offsets based on path length so initial NPCs start distributed mid-path with staggered despawn times.
5. **Update Test Suites**:
   - Update `test/test_npc_content.py`, `test/test_npc_paths.py`, `test/test_npc_entity.py`, `test/test_npc_server.py`, `test/test_npc_client.py`, and `test/test_npcs.py` to assert the 22/48 px/s speeds and edge-to-edge path constraints.

## 3. Acceptance Criteria
- **AC-030.1**: All 10 paths in `src/world/npc_paths.js` and manifest start and end at distinct map perimeter boundaries with zero obstacle intersections.
- **AC-030.2**: NPC speeds are 22 px/s (walker) and 48 px/s (jogger) across content tables, entities, and server spawners.
- **AC-030.3**: Initial server spawners pre-warm spawn times so NPCs are distributed across routes with staggered lifetimes.
- **AC-030.4**: Local fallback spawner does not spawn duplicate NPCs while connecting to network.
- **AC-030.5**: All tests pass via `python3 test/run_tests.py`.

