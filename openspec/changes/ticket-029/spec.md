# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-029"
title: "NPC Regression Suite & Spec Reconciliation"
state: "DRAFT"
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
Final integration. Scope: `test/test_npcs.py`, `test/run_tests.py`, `openspec/specs/overview.md`.

## 2. Technical Specification
- Update legacy `test_npcs.py` (assumes old speeds/local NPCs) to the new model; register all new tests in `run_tests.py`.
- End-to-end test: spawn schedule -> two simulated clients -> identical NPC state -> despawn/replacement.
- Reconcile `openspec/specs/overview.md` with new NPC behavior.

## 3. Acceptance Criteria
- AC-029.1 Full suite passes via `python3 test/run_tests.py`.
- AC-029.2 Canonical spec documents global lifecycle, naming, speeds, speech.

