# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-028"
title: "Client Integration: Network NPC Sync & Game Wiring"
state: "DRAFT"
roadmap: "improved-npcs"
depends_on: ["ticket-026","ticket-027"]
created_at: "2026-10-15T19:45:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-028/main"
max_review_cycles: 3
---
```

Roadmap: `openspec/roadmaps/improved-npcs.md`

## 1. Problem Statement
Replace the five hard-coded local NPCs with networked, global NPCs. Scope: `src/main.js`, `src/net/network.js`, `src/net/ws_network.js`.

## 2. Technical Specification
- Remove local NPC construction (main.js lines ~41-82).
- `NetworkManager` forwards `NPC_SPAWN`/`NPC_DESPAWN`/`NPC_SNAPSHOT` through callbacks; estimates server clock offset from `serverTime`.
- Game keeps `Map<id, ParkNPC>`; spawns on message, removes on despawn or when `isFinished`.
- Offline/solo mode: fall back to a local spawner using the same lifecycle (shares logic via ticket-026 entities and ticket-025 paths).
- NPCs still feed into dog reactions (`dog.update(..., npcs)`), depth sorting and avoidance lists.

## 3. Acceptance Criteria
- AC-028.1 Two clients show the same NPCs at same positions (+/- clock error).
- AC-028.2 Despawned NPCs vanish and replacements appear without client reload.
- AC-028.3 Solo mode still shows NPCs.
- AC-028.4 `python3 test/run_tests.py` passes.

