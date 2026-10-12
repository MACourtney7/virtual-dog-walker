# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-016"
title: "Park NPCs: Autonomous Walkers & Joggers along The Downs Trails"
state: "PLANNING"
created_at: "2026-10-12T17:54:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-016/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

While *Virtual Dog Walker* features online multiplayer peers, single players or players visiting during quiet periods experience an empty park. To bring authentic life and atmosphere to **The Downs**:
1. **Autonomous Pedestrians & Athletic Joggers**:
   - The park needs ambient NPC walkers leisurely strolling along walking trails and stopping at benches or viewpoints.
   - Athletic joggers running brisk loops along Ladies Mile and the park perimeter.
2. **Canine & Player Interaction**:
   - Dogs should react to nearby passersby according to their personality traits (barkyness, shyness, playfulness).
   - NPCs should exhibit gentle steering avoidance so they don't awkwardly walk through players or dogs.
3. **Seamless Integration**:
   - Must render seamlessly in the existing y-sorted depth pipeline with zero performance degradation.

---

## 2. System Architecture & Technical Specifications

### 2.1 NPC Entity Classes (`src/entities/npc.js`)
- **Base Class `ParkNPC`**:
  - Properties: `x, y, vx, vy, speed, radius, depthY, waypointIndex, waypoints, state, pauseTimer`.
  - Methods: `update(dt, obstacles, avoidanceEntities)`, `draw(ctx)`.
- **Subclass `WalkerNPC`**:
  - Strolls at leisure pace (~75–100 px/s).
  - Navigates footpath waypoint loops connecting trails, viewpoints (Sea Walls), and benches.
  - Occasionally pauses for 4–10 seconds at benches or scenic overlooks (`pauseTimer`).
  - Distinct casual attire and randomized appearance.
- **Subclass `JoggerNPC`**:
  - Athletic running pace (~240–280 px/s).
  - Continuous running loops along Ladies Mile avenue and perimeter trails.
  - Dynamic running animation with rhythmic bobbing and athletic sportswear colors.

### 2.2 Waypoint Navigation & Path Graph (`src/world/field.js`)
- Register predefined waypoints based on authentic Downs geography:
  - Ladies Mile Avenue loop
  - Sea Walls overlook path
  - Durdham Down meadow trail
- Method `getParkWaypoints(loopType)` returning coordinate arrays.

### 2.3 Canine Interaction & Steering Avoidance
- In `CompanionDog.update()`:
  - If a jogger or walker passes close (<80px):
    - Barkyness roll: bark at joggers if barkyness >= 3.
    - Shyness roll: give wide berth if shyness >= 3.
    - Playfulness roll: tail wag or play bow if playfulness >= 4.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-016.1** | `WalkerNPC` traverses designated park path loops at walking speed and pauses at benches/overlooks. | Unit & simulation test of waypoint traversal |
| **AC-016.2** | `JoggerNPC` executes continuous athletic running loops along Ladies Mile and perimeter. | Unit test of jogger speed and loop cycle |
| **AC-016.3** | NPCs execute mutual soft avoidance steering around players and dogs. | Unit test avoidance displacement |
| **AC-016.4** | Dogs react to passing NPCs based on personality traits (bark, shy berth, or play wag). | Unit test dog personality reaction to NPC |
| **AC-016.5** | NPCs render in the y-sorted depth list with natural shadows and clothing variety. | Rendering pipeline test |
| **AC-016.6** | Zero regressions across automated test suites (`python3 test/run_tests.py`). | Test runner verification |

---

## 4. Testing & Verification Strategy
- Author `test/test_npcs.py` covering waypoint advancement, speed bounds, avoidance steering, and dog interaction.
