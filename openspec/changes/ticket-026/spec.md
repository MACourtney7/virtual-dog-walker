# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-026"
title: "NPC Entity Rewrite: Deterministic Sim, Lifecycle, Name Tag & Speech"
state: "DRAFT"
roadmap: "improved-npcs"
depends_on: ["ticket-024","ticket-025"]
created_at: "2026-10-15T19:45:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-026/main"
max_review_cycles: 3
---
```

Roadmap: `openspec/roadmaps/improved-npcs.md`

## 1. Problem Statement
Rework `ParkNPC` so it is a pure function of (path, spawnTime, shared clock), has a finite lifecycle, a clearly NPC-styled tag, and speech. Scope: `src/entities/npc.js`, `test/test_npc_entity.py` (new).

## 2. Technical Specification
- Constructor takes `{ id, pathId, type, seed, spawnTime }`; identity from ticket-024, path from ticket-025.
- `update(dt, now)` (or `setClock(now)`) places the NPC at distance `speed * (now - spawnTime)` along the polyline; no pauses/stuck states; no runtime obstacle steering needed.
- `isFinished(now)` true once distance >= path length; entity then fades (0.5 s) and reports `done` so the game removes it.
- Late joiners: an NPC whose spawnTime is in the past is placed mid-path immediately.
- Name tag drawn above head with `NPC_TAG_STYLE` (italic, unique colour/background pill), visually distinct from player tags.
- Speech: timer driven by seeded RNG; uses `pickPhrase`; shows in existing bubble style for ~4 s. Same seed => same speech timeline on all clients.
- Keep `WalkerNPC`/`JoggerNPC` exports for compatibility.

## 3. Acceptance Criteria
- AC-026.1 Position is deterministic for given (path, spawnTime, now).
- AC-026.2 NPC finishes at final waypoint and `isFinished` flips true; no NPC ever pauses or stalls.
- AC-026.3 Speeds match ticket-024 constants.
- AC-026.4 Tag uses italic font and NPC palette; name format "Mary the Walker".
- AC-026.5 Speech phrases come from content pools and are deterministic per seed.
- AC-026.6 Tests added and `python3 test/run_tests.py` passes.

