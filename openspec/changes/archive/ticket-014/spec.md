# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-014"
title: "Canine Stray Run-Off, Directional Navigation Arrow & Dog Waste/Bin Mechanics"
state: "PLANNING"
created_at: "2026-10-11T20:33:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-014/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Currently in *Virtual Dog Walker*:
1. **No Consequence for Idle Neglect**:
   - The dog always waits patiently even if the human stands completely still for long periods without engaging or whistling.
   - The user requested: *"if player stands around still without wistleing for too long the dog may run off (probablity effected vt obidience), teleport dog to somewhere random on the map (dog stays still) and show arrow onscreen so owner must go get dog"*.
2. **Missing Dog Waste & Bin Mechanics**:
   - Public dog parks require responsible ownership. The user requested:
     - *"dog poop probability, player has to pick it up and then arrow appears on screen to nearest bin for player to go to next"*.
   - Dog-waste bins were placed in `ticket-011` (`field.bins`) but have not yet been wired into gameplay interactions.
3. **Reusable Directional HUD Navigation Arrow**:
   - The game needs an intuitive, non-intrusive directional navigation arrow on the screen margin to guide the owner to their stray dog and to the nearest waste bin.

---

## 2. System Architecture & Technical Specifications

### 2.1 Directional Navigation Compass Arrow (`src/ui/navigation_arrow.js`)
- **Visual Presentation**:
  - Anchored on the screen viewport perimeter pointing toward the off-screen target world coordinate `(targetX, targetY)`.
  - Calculates bearing angle: `Math.atan2(targetY - playerY, targetX - playerX)`.
  - Clamps arrow position along an inner screen ellipse/box with padding (~40px from viewport edge).
  - Renders a clean glassmorphic chevron/arrow with soft pulsing animation, target icon (`🐕` or `🗑️`), and distance badge in meters/yards (`${Math.round(dist / 20)}m`).
- **API**:
  - `setTarget(x, y, type, label, color)`
  - `clearTarget()`
  - `draw(ctx, camera, playerX, playerY)`

### 2.2 Canine Idle Stray / Run-Off Engine (`src/entities/companion_dog.js`)
- **Idle Tracking & Whistle Reset**:
  - Tracks `this.ownerStillTimer`: accumulates elapsed time when local owner velocity `Math.hypot(vx, vy) < 2` and dog is off-leash.
  - Calling `whistleRecall()` or walking resets `this.ownerStillTimer = 0`.
- **Obedience-Scaled Run-Off Trigger**:
  - When `this.ownerStillTimer > 35` seconds:
    - Probability roll evaluated every 5s:
      - Obedience 1: 50% probability
      - Obedience 2: 30% probability
      - Obedience 3: 15% probability
      - Obedience 4: 5% probability
      - Obedience 5: 1% probability
    - If triggered: Dog transitions to `DogState.LOST`.
    - Teleports or sprints to a random secluded turf location on The Downs (`x: 200..3000, y: 200..2200`).
    - Dog stays still in `LOST` state, sniffing or looking around.
    - Activates `NavigationArrow` pointing toward dog: `setTarget(dog.x, dog.y, 'DOG', 'Find your dog!', '#f59e0b')`.
- **Retrieval & Rejoin**:
  - When owner approaches within 50px or triggers whistle recall (<kbd>H</kbd> / touch button):
    - Dog perks up happily, emits `❤️` or `🐾` emote bubble, rejoins close heel, and clears the navigation arrow.

### 2.3 Dog Poop & Bin Disposal Loop (`src/entities/waste.js`, `src/world/field.js`, `src/main.js`)
- **Poop Trigger & Entity**:
  - Periodic event while walking in the park (~every 150–240 seconds of active walking).
  - Dog pauses for 2 seconds in squat posture, then spawns a `PoopPile` entity on `field` at `(dog.x, dog.y)` with depth sorting (`depthY = y + 4`).
- **Pickup Interaction**:
  - Player walking near poop pile (<36px) receives prompt: *"Press [E] or tap to pick up waste"*.
  - On interaction: Poop pile is removed, player receives bag toast: *"Collected in poop bag 🟤"*, and player enters `hasPoopBag = true`.
- **Bin Navigation & Disposal**:
  - Queries `field.getNearestBin(player.x, player.y)`.
  - Activates `NavigationArrow` pointing toward nearest bin: `setTarget(bin.x, bin.y, 'BIN', 'Nearest Bin', '#10b981')`.
  - Walking to bin (<42px) and pressing <kbd>E</kbd> or tapping bin disposes bag:
    - Clears `hasPoopBag`, clears arrow, plays positive chime, and displays toast: *"Disposed cleanly! The Downs thanks you 🌳"*.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-014.1** | Reusable `NavigationArrow` HUD component projects screen-clamped directional chevron and distance badge. | Unit test coordinate projection & math |
| **AC-014.2** | Owner standing still >35s without whistling triggers stray run-off roll, inversely scaled by dog obedience. | Unit test idle timer and probability function |
| **AC-014.3** | Run-off places dog in stationary `LOST` state and displays directional arrow pointing to dog. | Simulation test of run-off event |
| **AC-014.4** | Approaching dog or whistling recalls dog and clears the lost dog arrow. | Unit test retrieval and arrow dismissal |
| **AC-014.5** | Periodic dog poop spawns `PoopPile` entity; picking it up displays arrow pointing to nearest dog bin. | Unit test poop event, pickup, and nearest bin query |
| **AC-014.6** | Reaching bin disposes of waste bag cleanly and dismisses navigation arrow. | Integration test of disposal interaction |
| **AC-014.7** | Zero regressions across test runner (`python3 test/run_tests.py`). | Automated test runner execution |

---

## 4. Testing & Verification Strategy
- Implement automated test suite `test/test_stray_and_poop.py` and integrate into `test/run_tests.py`.
