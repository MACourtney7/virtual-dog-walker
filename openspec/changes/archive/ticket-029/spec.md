# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-029"
title: "NPC Regression Suite & Spec Reconciliation"
state: "IN_PROGRESS"
roadmap: "improved-npcs"
depends_on: ["ticket-028"]
created_at: "2026-10-15T19:45:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-029/main"
max_review_cycles: 3
---
```

Roadmap: `openspec/roadmaps/improved-npcs.md`

## 1. Problem Statement
As the final integration step of the `improved-npcs` roadmap, legacy tests in `test/test_npcs.py` (which assume deprecated speeds of 85/260 px/s, local uncoordinated spawning, bench pausing, and old constructor patterns) must be overhauled and updated to validate the unified global NPC model. All newly created test suites must be registered in `test/run_tests.py`. Furthermore, an end-to-end integration test must verify the full multi-client synchronization lifecycle (server spawn schedule -> multiple simulated clients -> identical deterministic NPC position & state -> despawn/replacement). Finally, the canonical specification at `openspec/specs/overview.md` must be updated to reconcile system documentation with the new obstacle-free, global, deterministic NPC architecture.

## 2. Technical Specification
- **Update Legacy NPC Tests (`test/test_npcs.py`)**:
  - Overhaul `test/test_npcs.py` to assert against the new architecture:
    - Walker speed: `NPC_SPEED.walker` = 35 px/s (down from 85).
    - Jogger speed: `NPC_SPEED.jogger` = 80 px/s (down from 260).
    - Polyline path traversal without runtime obstacle collision or bench pausing.
    - Global lifecycle: spawn, active traversal, despawn upon reaching end of path (`isFinished` / `isDone`), and replacement.
    - Name tags: styled via `NPC_TAG_STYLE` (italic font, golden borders/text, dark pill background) and formatted as `<Name> the <Walker|Jogger>`.
    - Seeded deterministic speech timeline and phrase selection (common phrases vs 15% odd phrases).
    - Canine companion reactions to new NPCs (barkyness, shyness berth avoidance, play-bow/wag).
    - Depth sorting (`depthY = y + 12`).
    - Verify `CliftonDownGame` in `src/main.js` correctly stores NPCs in a `Map` (`this.npcs`), sets up network callbacks (`onNpcSpawn`, `onNpcDespawn`, `onNpcSnapshot`), and runs solo spawner in offline mode.
- **End-to-End Multi-Client Synchronization Test**:
  - Implement full end-to-end integration test simulating:
    1. Server spawner initializes and generates NPC spawn schedule with deterministic seed, pathId, type, spawnTime.
    2. Two independent simulated clients receive identical spawn packets and clock timestamps.
    3. Both clients simulate NPC position across multiple time deltas, yielding identical coordinates and identical speech states.
    4. Upon NPC path completion, despawn packet is broadcast and both clients remove the finished NPC; replacement NPC is spawned and tracked by both clients seamlessly.
- **Test Runner Registration (`test/run_tests.py`)**:
  - Verify that `test/run_tests.py` runs all test suites without errors, including all new NPC suites:
    - `test/test_npcs.py`
    - `test/test_npc_content.py`
    - `test/test_npc_paths.py`
    - `test/test_npc_entity.py`
    - `test/test_npc_server.py`
    - `test/test_npc_client.py`
- **Canonical Specification Reconciliation (`openspec/specs/overview.md`)**:
  - Update Section 3 (Entities, Canine Companion & Ambient Life) to document:
    - Global server-authoritative NPC lifecycle (PartyServer & dedicated microserver fallback).
    - Deterministic client simulation driven by shared clock (`spawnTime`) and PRNG (`mulberry32`), eliminating per-frame traffic.
    - Precomputed obstacle-free paths (`src/world/npc_paths.js`, `src/world/npc_path_manifest.json`) clear of trees, benches, and bins.
    - Distinctive NPC naming (`<First> the <Walker|Jogger>`) and visual styling (`NPC_TAG_STYLE` with italic font and golden hue).
    - Significantly reduced authentic walking/jogging speeds (Walker ~35 px/s, Jogger ~80 px/s).
    - Seeded ambient chat speech bubbles (common park/weather observations with ~15% quirky remarks).
  - Update Section 7 (Test Suite & CI/CD) to describe the full regression and integration test coverage.

## 3. Acceptance Criteria
- **AC-029.1**: Full suite passes via `python3 test/run_tests.py` including updated `test/test_npcs.py` and end-to-end multi-client synchronization.
- **AC-029.2**: Canonical specification `openspec/specs/overview.md` documents global lifecycle, naming, speeds, speech, and deterministic obstacle-free paths.
