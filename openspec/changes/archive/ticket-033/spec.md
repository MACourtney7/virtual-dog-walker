# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-033"
title: "Fix Server NPC spawnTime Unit Mismatch (ms vs s), Central Path Coverage, and Ground Shadow Artifacts"
state: "COMPLETED"
roadmap: null
depends_on: []
created_at: "2026-10-31T15:45:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-033/main"
max_review_cycles: 3
target_files:
  - "src/main.js"
  - "src/entities/npc.js"
  - "src/world/npc_paths.js"
  - "src/world/npc_path_manifest.json"
  - "party/server.js"
  - "src/world/field.js"
  - "test/test_npc_client.py"
  - "test/test_npc_entity.py"
  - "test/test_npc_paths.py"
  - "test/test_npc_server.py"
---
```

## 1. Problem Statement
1. **Server NPCs Are 100% Invisible & Frozen (ms vs s Timestamp Unit Mismatch)**:
   - `party/server.js` generates and broadcasts `spawnTime` and `serverTime` in milliseconds (`Date.now()`, e.g. `1793461296000`).
   - `src/main.js` (`getAuthoritativeTime()`) computes authoritative time in seconds (`Date.now() / 1000 + this.serverClockOffset`, e.g. `1793461296.0`), while passing the raw millisecond `npcData.spawnTime` from `NPC_SNAPSHOT` and `NPC_SPAWN` directly into `new ParkNPC(npcData)`.
   - In `ParkNPC.setClock(now)` (`src/entities/npc.js`), `now - this.spawnTime` subtracts milliseconds (~1.79e12) from seconds (~1.79e9), resulting in `-1.79e12`. `Math.max(0, now - this.spawnTime)` clamps `elapsed` to `0` permanently.
   - Because `elapsed === 0`, the entry fade check `if (elapsed < 0.5) { this.opacity = elapsed / 0.5; }` permanently sets `this.opacity = 0.0` (100% invisible) and distance = 0 for all server-synced NPCs.
2. **Sparse Perimeter-Only Path Routing (`src/world/npc_paths.js`)**:
   - Currently, 7 of the 10 paths hug the extreme outer borders of the 3200x2400 map (`y < 650`, `y > 1680`, `x < 368`), starting/ending outside the boundary stone wall (`x = 10` or `y = 10`).
   - Players near the Central Meadow (`1350, 1000`) or Water Tower clearing (`2250, 580`) rarely see NPCs traversing the park interior.
3. **High-Contrast Grid Ovals on Baked Ground (`src/world/field.js`)**:
   - In `src/world/field.js` (`bakeGround()`), a repeating 160px grid loop draws dark green ellipses (`rgba(36, 74, 30, 0.25)`, `rx = 28`, `ry = 16`). Because their size and color match tree shadows, they appear as dozens of orphaned shadows from missing trees across the terrain.

---

## 2. Technical Specification & Implementation Plan

### 2.1 Timestamp Normalization & Visibility (`src/entities/npc.js` & `src/main.js`)
1. In `src/entities/npc.js`:
   - Add a robust timestamp normalizer helper:
     ```javascript
     function toSeconds(t) {
       const n = Number(t) || 0;
       return n > 1e10 ? n / 1000 : n;
     }
     ```
   - In `ParkNPC.constructor`: normalize `this.spawnTime = toSeconds(spawnTime);` (preserving small test seconds like 0 or 100 while converting millisecond timestamps from server packets).
   - In `ParkNPC.setClock(now)` and `ParkNPC.isFinished(now)`: normalize incoming clock `const nowSec = toSeconds(now);` prior to subtracting `this.spawnTime`.
   - In `ParkNPC.setClock(now)`: replace entry fade logic so newly spawned NPCs at `elapsed === 0` are immediately visible:
     ```javascript
     if (elapsed > 0 && elapsed < 0.5) {
       this.opacity = 0.25 + 0.75 * (elapsed / 0.5);
     } else {
       this.opacity = 1.0;
     }
     ```
2. In `src/main.js`:
   - Ensure `handleNpcSnapshot` and `handleNpcSpawn` handle timestamps cleanly.
   - In `updateLocalSpawner()`: pre-warm initial solo NPCs with staggered fractions (`prewarmFraction = (i + 0.2) / 8`) when `this.npcs.size < 8` on initial fill so solo offline mode also begins with NPCs active mid-route.

### 2.2 Central Edge-to-Edge Paths & Pool Density (`src/world/npc_paths.js`, `src/world/npc_path_manifest.json`, `party/server.js`)
1. In `src/world/npc_paths.js`:
   - Keep all 10 paths point-to-point edge-to-edge (`loop: false`).
   - Start and end inside the stone perimeter wall boundaries (`75 <= x <= 140` or `3060 <= x <= 3125`, `75 <= y <= 140` or `2260 <= y <= 2325`, with `hypot(start - end) >= 1200`).
   - At least 6 of the 10 paths must traverse through the central park interior (`900 <= x <= 2500`, `450 <= y <= 1450`), routing along the gravel paths, past Central Meadow (`1350, 1000`), and past Water Tower (`2250, 580`).
   - Zero obstacle collisions: Maintain strict obstacle clearance (`distance >= 14 + obstacleRadius + 6 px`) from all solids (trees, benches, bins, rocks, water tower).
2. Recompute Euclidean `lengthPx` for all 10 paths:
   - Update `src/world/npc_path_manifest.json`.
   - Update `FALLBACK_MANIFEST` in `party/server.js`.
3. NPC Density:
   - Synchronize `TARGET_NPC_COUNT` in `party/server.js` and local spawner target in `src/main.js` to 8 (or 5 if tests require, maintaining test synchronization).

### 2.3 Turf Patch Rendering Fix (`src/world/field.js`)
- In `src/world/field.js` (`bakeGround()`):
  - Replace the repeating 160px dark grid ellipses (`rgba(36, 74, 30, 0.25)`, `rx = 28`, `ry = 16`) with wide, soft, low-contrast turf texture patches (`rgba(52, 98, 42, 0.06)`, `rx = 70`, `ry = 38`), eliminating orphaned dark shadow artifacts while preserving rich grass texturing.

---

## 3. Acceptance Criteria & Verification Plan

- **AC-033.1 (Server Millisecond Sync)**:
  - When passing a millisecond `spawnTime` (e.g. `1793461296000`) and calling `npc.setClock(1793461306.0)` (10 seconds later in seconds), the NPC advances to `distance = 10 * speed` and has `opacity === 1.0`.
  - At `elapsed === 0`, `opacity` is at least `0.25` (never `0.0`).
- **AC-033.2 (Central Path Coverage & Obstacle Clearance)**:
  - At least 6 of the 10 paths in `src/world/npc_paths.js` have intermediate waypoints traversing the central play area (`900 <= x <= 2500` and `450 <= y <= 1450`).
  - All 10 paths are obstacle-free with `>= 20 px` clearance from all solid entities.
- **AC-033.3 (Ground Turf Visual Cleanup)**:
  - `src/world/field.js` does not draw dark high-contrast 28x16 shadow ellipses on the ground grid.
- **AC-033.4 (Test Suite Regression Green)**:
  - `python3 test/run_tests.py` passes 100% across all test suites, including updated tests in `test/test_npc_client.py`, `test/test_npc_entity.py`, `test/test_npc_paths.py`, and `test/test_npc_server.py`.

