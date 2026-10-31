# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-031"
title: "Static Ground & Path Offscreen Baking (Render Optimization)"
state: "PLANNING"
roadmap: "npc-polish-and-cleanup"
depends_on: ["ticket-030"]
created_at: "2026-10-31T14:37:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-031/main"
max_review_cycles: 3
---
```

Roadmap: `openspec/roadmaps/npc-polish-and-cleanup.md`

## 1. Problem Statement
Currently, `renderGround()` in `src/world/field.js` computes pseudo-random grass hashes with `Math.sin()`, strokes multi-layered Bezier gravel paths, and renders mowing stripes on every frame at 60fps. This static park geometry consumes unnecessary CPU and GPU time in the render loop.

## 2. Technical Specification
1. **Offscreen Canvas Initialization**:
   - In `src/world/field.js` (or via helper), initialize an `OffscreenCanvas` (with fallback to standard `<canvas>` if `OffscreenCanvas` is not supported) sized to world dimensions (3200 x 2400).
2. **One-Time Bake**:
   - Render the complete static turf background (base green fill, mowing stripes, textured grass blades/wildflowers, and gravel paths) onto this canvas once at initialization.
3. **Optimized Render Viewport**:
   - Update `renderGround(ctx, camera)` to execute a single `ctx.drawImage()` call, blitting the visible camera viewport window from the baked canvas onto the screen.
4. **Verification & Tests**:
   - Ensure dynamic entities (dog, owner, balls, waste bins, waste piles, NPCs) continue rendering on top of the baked ground with correct layering.
   - Add/update tests in `test/test_field.py` or new test verifying offscreen caching and fallback behavior.

## 3. Acceptance Criteria
- **AC-031.1**: Static ground and gravel paths are baked once into an offscreen canvas.
- **AC-031.2**: `renderGround()` blits the camera viewport from the baked canvas without per-frame path recalculation.
- **AC-031.3**: Visual appearance matches the unbaked ground (paths, stripes, grass blades).
- **AC-031.4**: All tests pass via `python3 test/run_tests.py`.

