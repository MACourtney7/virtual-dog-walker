# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-024"
title: "NPC Content Tables (names, phrases, appearance, speeds, PRNG)"
state: "DRAFT"
roadmap: "improved-npcs"
depends_on: []
created_at: "2026-10-15T19:45:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-024/main"
max_review_cycles: 3
---
```

Roadmap: `openspec/roadmaps/improved-npcs.md`

## 1. Problem Statement
Centralise NPC data so that name, look and speech are derived deterministically from a server-provided integer seed. Scope: `src/entities/npc_content.js` (new), `test/test_npc_content.py` (new).

## 2. Technical Specification
- `mulberry32(seed)` PRNG export.
- `NPC_SPEED = { walker: 35, jogger: 80 }` (px/s; previously 85/260).
- `FIRST_NAMES` (>= 40 human names), `NPC_TYPES = ['walker','jogger']`.
- `npcIdentityFromSeed(seed, type)` -> `{ name: "Mary the Walker", skinTone, hairColor, hairStyle, hatColor, jacketColor, pantsColor, shoeColor }`; same seed => identical output on every client.
- `COMMON_PHRASES` (>= 30: weather, trees, birds, dogs, park, views, fresh air) and `ODD_PHRASES` (>= 10 odd/funny, e.g. "I think that squirrel owes me money.").
- `pickPhrase(rng)` returns an odd phrase with probability 0.15, else a common one. `nextSpeechDelay(rng)` -> 6-14 s.
- NPC tag palette constants: `NPC_TAG_STYLE = { text, background, border, font: 'italic 600 11px ...' }` (unique colour not used by player names).

## 3. Acceptance Criteria
- AC-024.1 Names follow `"<First> the <Walker|Jogger>"`.
- AC-024.2 Determinism: identical seed/type yields identical identity and phrase sequence.
- AC-024.3 Phrase pool is majority common; odd frequency ~15% (+/-5%) over 2000 samples.
- AC-024.4 Speeds are walker 35 / jogger 80.
- AC-024.5 Tests added and `python3 test/run_tests.py` passes.

