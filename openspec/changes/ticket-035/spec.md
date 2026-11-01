# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-035"
title: "Canine Fetching Perimeter Exemption, Ball Disappearance on Return & Single Ball Throw Restriction"
state: "IN_PROGRESS"
roadmap: null
depends_on: []
created_at: "2026-11-01T09:50:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-035/main"
max_review_cycles: 3
target_files:
  - "src/entities/toy.js"
  - "src/entities/companion_dog.js"
  - "src/main.js"
  - "src/ui/touch_controls.js"
  - "test/test_fetching_mechanics.py"
  - "test/test_dog_physics.py"
---
```

## 1. Problem Statement & User Requirements
Players engaging in ball-fetching gameplay encounter three significant friction points:
1. **Dog Fails to Reach Thrown Ball Due to Perimeter Clamping**:
   - In `src/entities/companion_dog.js` (lines 498–508), an off-leash perimeter boundary hard-clamps the dog's distance to within `maxRoam = 230` px of the owner whenever `this.owner && !this.owner.isLeashed && this.state !== DogState.LOST`.
   - Because standard ball throws travel 320 px (or up to 500 px with touch/mouse flick), the dog sprints towards the ball, hits the 230 px invisible perimeter boundary wall, and gets permanently clamped there running in place unable to reach the ball.
2. **Ball Drops on Ground Instead of Returning to Owner's Possession**:
   - In `src/entities/companion_dog.js` (lines 1005–1014), when the dog returns to the owner (`dist <= 36`), it calls `this.targetBall.drop(...)` onto the turf. The ball remains rendered on the grass indefinitely at the owner's feet rather than disappearing as if picked up and stowed into the owner's possession.
3. **Repeated Ball Throws & Multi-Ball Clutter**:
   - In `src/main.js`, `throwBall()` and `throwBallAt()` can be spammed repeatedly without restriction. Every press of `Space`, `KeyT`, or tap of `btn-touch-throw` launches a throw, even while a previous ball is mid-air or being fetched. The owner should hold exactly one ball; once thrown, another cannot be thrown until the dog retrieves it, brings it back to the owner, and the ball disappears into the owner's possession.

---

## 2. Technical Specification & Implementation Plan

### 2.1 Ball Possession State in `src/entities/toy.js` (`TennisBall`)
1. **Possession State Flag**:
   - Add property `this.inOwnerPossession = true;` to `TennisBall` constructor.
   - When instantiated in `src/main.js`, the ball starts in the owner's possession (`inOwnerPossession = true`, not lying on the ground).
2. **Throw Transition**:
   - In `throw(fromX, fromY, dirX, dirY, speed, launchZ)`:
     - Set `this.inOwnerPossession = false;`.
     - Set `this.isThrown = true;`.
3. **Owner Pickup / Retrieval**:
   - Add method `retrieveByOwner()` (or `pickupByOwner()`):
     - Sets `this.inOwnerPossession = true;`.
     - Sets `this.isThrown = false;`.
     - Sets `this.isCarried = false;`.
     - Sets `this.carrier = null;`.
     - Resets velocity and elevation: `this.vx = 0; this.vy = 0; this.vz = 0; this.z = 0;`.
4. **Render & Physics Suppression**:
   - In `draw(ctx)`: If `this.inOwnerPossession` is `true`, return early without drawing ball or shadow.
   - In `update(dt, field)`: If `this.inOwnerPossession` is `true`, return early without simulating ballistic trajectory or boundary checks.

---

### 2.2 Perimeter Clamping Exemption & Return Hand-off in `src/entities/companion_dog.js`
1. **Perimeter Distance Clamping Exemption (AC-035.1)**:
   - In `src/entities/companion_dog.js` (line 498):
     Update the off-leash perimeter check to exempt `DogState.FETCHING`:
     ```javascript
     } else if (this.owner && !this.owner.isLeashed && this.state !== DogState.LOST && this.state !== DogState.FETCHING) {
     ```
   - Ensure the dog is completely free to break the 230 px `maxRoam` limit when fetching a thrown ball or returning with it.
   - Ensure obstacle and map boundary collision checks continue to protect the dog from navigating out of bounds.
2. **Owner Contact Retrieval Hand-off (AC-035.2)**:
   - In `updateFetching(dt)` (lines 1005–1014):
     When the dog carrying the ball (`this.hasBall === true`) arrives back within contact distance of the owner (`dist <= 36` or `dist <= 42`):
     - Call `this.targetBall.retrieveByOwner();` so the ball immediately disappears into the owner's possession.
     - Reset dog state: `this.hasBall = false; this.targetBall = null; this.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;`.
     - Reward dog: `this.pet();` and show positive emote (`this.emoteBubble = '❤️'; this.emoteTimer = 2.0;`).
     - Play sound chime / pop if audio is active.
3. **Direct Owner Pickup Safeguard**:
   - If the ball is resting on the ground uncarried (`!this.isThrown && !this.isCarried && !this.inOwnerPossession`) and the owner walks over it (`Math.hypot(this.owner.x - this.ball.x, this.owner.y - this.ball.y) < 32`), the owner picks up the ball automatically (`this.ball.retrieveByOwner()`). This prevents edge-case soft-locks if the dog is recalled or distracted.

---

### 2.3 Single Active Ball Enforcement & UI HUD in `src/main.js` & `src/ui/touch_controls.js`
1. **Can-Throw Validation (`src/main.js`) (AC-035.3)**:
   - Add helper method `canThrowBall()`:
     ```javascript
     canThrowBall() {
       return Boolean(
         this.ball &&
         this.ball.inOwnerPossession &&
         !this.ball.isThrown &&
         !this.ball.isCarried &&
         this.dog.state !== DogState.FETCHING &&
         !this.dog.hasBall
       );
     }
     ```
   - In `throwBall()` and `throwBallAt(...)`:
     - If `!this.canThrowBall()`, abort execution immediately.
     - If the user presses Space/KeyT while unable to throw, display a subtle feedback toast: `"🎾 Wait for your dog to return the ball!"`.
2. **Touch & HUD Throw Button Feedback (`src/ui/touch_controls.js`)**:
   - Add method `setThrowEnabled(enabled)` on `TouchControls`:
     - Toggles an `.is-disabled` CSS class / disabled attribute on `#btn-touch-throw`.
     - Visually dims the throw button (`opacity: 0.45; filter: grayscale(80%);`) when the ball is already in play.
   - In `src/main.js` `update()` loop: update touch throw button state based on `this.canThrowBall()`.

---

## 3. Acceptance Criteria & Verification Matrix

- [ ] **AC-035.1 (Perimeter Exemption)**: When a ball is thrown > 230 px away (e.g., 350–500 px), the dog in `FETCHING` state breaks the 230 px owner perimeter clamp without restriction, reaches the ball, and picks it up (`hasBall = true`).
- [ ] **AC-035.2 (Ball Pickup on Owner Contact)**: When the dog returns to the owner with the ball, upon reaching owner contact distance (`dist <= 36–42 px`), the ball transitions to `inOwnerPossession = true`, ceases rendering, and disappears as if picked up by the owner.
- [ ] **AC-035.3 (Single Active Ball Constraint)**: The owner can only throw when `canThrowBall()` is true. Subsequent throw attempts while the ball is thrown, rolling, carried, or being fetched are strictly blocked.
- [ ] **AC-035.4 (Touch HUD Feedback)**: The on-screen throw button reflects throw readiness, disabling/dimming when a ball is currently in flight or being fetched.
- [ ] **AC-035.5 (Harness Validation)**: All unit and integration test suites in `python3 test/run_tests.py` pass 100%, including new fetching mechanics tests in `test/test_fetching_mechanics.py`.

---

## 4. Work Breakdown & Granular Briefs

### Brief 1: Ball Possession & Physics Entity (`src/entities/toy.js`) [L]
- Add `inOwnerPossession` property, `retrieveByOwner()` method, and render/update bypass logic.

### Brief 2: Companion Dog Fetching & Perimeter Logic (`src/entities/companion_dog.js`) [M]
- Exempt `DogState.FETCHING` from off-leash 230 px perimeter clamping.
- Update `updateFetching()` to hand off the ball to the owner (`retrieveByOwner()`) upon contact instead of dropping it on the ground.

### Brief 3: Throw Restriction, Owner Direct Pickup & HUD Sync (`src/main.js`, `src/ui/touch_controls.js`) [M]
- Implement `canThrowBall()`, block multiple throws, add owner direct pickup safeguard, and bind throw button enabled state.

### Brief 4: Comprehensive Test Suite (`test/test_fetching_mechanics.py`) [L]
- Author pytest/unittest suite asserting perimeter exemption, owner hand-off disappearance, and single ball throw restriction.

