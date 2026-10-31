# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-032"
title: "Dead Platformer Code Pruning"
state: "PLANNING"
roadmap: "npc-polish-and-cleanup"
depends_on: []
created_at: "2026-10-31T14:37:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-032/main"
max_review_cycles: 3
---
```

Roadmap: `openspec/roadmaps/npc-polish-and-cleanup.md`

## 1. Problem Statement
The repository contains 6 unused legacy files left over from an early 2D side-scrolling platformer prototype ("Ziggy's Park Adventure"):
- `src/engine/physics.js`
- `src/entities/ziggy.js`
- `src/entities/collectibles.js`
- `src/entities/hazards.js`
- `src/level/park_level.js`
- `test/test_physics.py`

These files are disconnected from the top-down social sandbox, inflate context windows, and cause confusion during maintenance.

## 2. Technical Specification
1. **File Deletion**:
   - Delete `src/engine/physics.js`. Remove empty directory `src/engine` if no other files remain.
   - Delete `src/entities/ziggy.js`.
   - Delete `src/entities/collectibles.js`.
   - Delete `src/entities/hazards.js`.
   - Delete `src/level/park_level.js`. Remove empty directory `src/level` if no other files remain.
   - Delete `test/test_physics.py`.
2. **Prune Imports & Build References**:
   - Audit `src/main.js`, `index.html`, and all other source modules to ensure no dangling `import` or `<script>` tags reference the deleted files.
3. **Scaffold & Test Runner Cleanup**:
   - Update `test/run_tests.py` if `test_physics.py` or platformer assertions exist in the runner or scaffold checks.
   - Keep `src/entities/tombstone.js` deprecation tests in `test/test_tombstone_cleanup.py` and `test/test_proximity_chat.py` intact as they guard regression on the tombstone removal feature.

## 3. Acceptance Criteria
- **AC-032.1**: The 6 legacy platformer files are completely deleted.
- **AC-032.2**: No runtime errors or missing import errors occur when loading the top-down game.
- **AC-032.3**: `python3 test/run_tests.py` passes 100% cleanly without broken imports.

