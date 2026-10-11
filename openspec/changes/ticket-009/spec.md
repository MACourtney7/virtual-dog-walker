# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-009"
title: "Virtual Dog Walker: Real-Time Leash State Synchronization & Entity Interpolator Discrete Property Propagation"
state: "PROPOSED"
created_at: "2026-10-11T15:00:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-009/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Root Cause Analysis

When a player toggles their dog off-leash (via the <kbd>L</kbd> key or the touch action button 🦮), the leash is removed in their own window, but in other connected client windows (browser tab, incognito window, mobile browser) the dog continues to appear on-leash with the red nylon lead rendered.

### Root Causes
1. **`EntityInterpolator` Omits Non-Spatial Discrete Properties (`src/net/network.js`)**:
   - `EntityInterpolator` maintains `this.current` and `this.target`.
   - On the first snapshot, `this.current = { ...snapshot }`, initializing `this.current.isLeashed = true`.
   - On subsequent snapshots received via `SYNC_STATE`, `setTarget(snapshot)` updates `this.target`, setting `this.target.isLeashed = false`.
   - However, in `update(dt)`, `EntityInterpolator` only updates spatial continuous values (`x`, `y`, `vx`, `vy`, `angle`). It **never copies or propagates discrete properties** (such as `isLeashed`, `isMoving`, or `state`) from `this.target` to `this.current`.
   - As a result, `this.current.isLeashed` remains permanently `true` for all remote peers.
2. **Remote Entity Reflection Stuck on Leashed (`src/main.js`, `src/entities/companion_dog.js`)**:
   - In `src/main.js`, `update(dt)` sets `remote.owner.isLeashed = ownerState.isLeashed;`.
   - Because `ownerState.isLeashed` from `ownerInterpolator` is stuck at `true`, `remote.owner.isLeashed` never becomes `false`.
   - In `CompanionDog.prototype.draw(ctx)`, the condition `if (this.owner && this.owner.isLeashed && this.state !== DogState.FETCHING)` evaluates to `true` continuously, drawing `this.drawLeash(ctx)` in all other windows.
3. **Lack of Instantaneous Packet Dispatch on Leash Toggle (`src/main.js`)**:
   - `toggleLeash()` in `src/main.js` toggles `this.owner.isLeashed` locally and displays a toast message, but does not immediately broadcast a `SYNC_STATE` packet. It waits for the 16Hz interval timer (up to ~62.5ms delay). Immediately broadcasting on toggle provides zero-latency visual responsiveness across the network.
4. **Dog Behavioral State Desynchronization (`state`)**:
   - Dog behavioral states (`DogState.FOLLOWING`, `SNIFFING`, `SITTING`, `PLAY_BOW`, `FETCHING`) sent in `dog.state` also suffered from the discrete property omission in `dogInterpolator`, preventing remote dogs from smoothly reflecting sitting or sniffing states.
5. **Mobile Touch Control Visual Feedback (`src/ui/touch_controls.js`)**:
   - The touch leash button (`btn-touch-leash`) lacked active/inactive visual toggling to indicate whether the player is currently on-lead or off-lead.

---

## 2. System Architecture & Technical Specifications

### 2.1 Discrete Property Propagation in `EntityInterpolator` (`src/net/network.js`)
- Update `EntityInterpolator.setTarget(snapshot)`:
  - Immediately copy all non-continuous discrete properties (`isLeashed`, `isMoving`, `state`, etc.) from `snapshot` to `this.current` so discrete state changes take effect with zero interpolation delay:
    ```javascript
    for (const key of Object.keys(snapshot)) {
      if (key !== 'x' && key !== 'y' && key !== 'angle') {
        this.current[key] = snapshot[key];
      }
    }
    ```
- Update `EntityInterpolator.update(dt)`:
  - Continuously synchronize non-continuous discrete properties from `this.target` to `this.current`:
    ```javascript
    for (const key of Object.keys(this.target)) {
      if (key !== 'x' && key !== 'y' && key !== 'angle') {
        this.current[key] = this.target[key];
      }
    }
    ```

### 2.2 Instantaneous Leash Broadcast & Remote Entity Sync (`src/main.js`)
- In `toggleLeash()`:
  - In addition to toggling `this.owner.isLeashed` and showing toast notifications, immediately broadcast a `SYNC_STATE` packet via `this.net.broadcast(Protocol.createSyncState(this.net.peerId, this.owner, this.dog))` if connected.
  - Update mobile touch leash button visual state via `this.touchControls.setLeashed(this.owner.isLeashed)`.
- In `update(dt)`:
  - Ensure `remote.owner.isLeashed = !!ownerState.isLeashed;`.
  - Ensure `remote.dog.state = dogState.state;` updates the dog entity posture.

### 2.3 Mobile Leash Button State Indication (`src/ui/touch_controls.js`)
- Add `setLeashed(isLeashed)` method to `TouchControls`:
  - When `isLeashed` is `true`: button display `🦮` with normal glassmorphic styling.
  - When `isLeashed` is `false`: button display `🐕` with active/highlighted off-lead indicator styling (`aria-pressed="false"`, class `.off-leash`).

### 2.4 Automated Testing & Verification (`test/test_leash_sync.py`, `test/run_tests.py`)
- Author Python unit tests verifying:
  - `EntityInterpolator` accurately propagates `isLeashed: false` and `isLeashed: true` upon snapshot arrival.
  - `EntityInterpolator` preserves continuous `x`/`y`/`angle` interpolation while instantaneously updating discrete flags (`isLeashed`, `isMoving`, `state`).
  - `Protocol.createSyncState` correctly serializes `isLeashed`.
  - Integration with `test/run_tests.py` ensuring full regression coverage.

---

## 3. Scope Boundaries

### In-Scope
1. `src/net/network.js`: `EntityInterpolator` discrete property synchronization in `setTarget` and `update`.
2. `src/main.js`: Instantaneous broadcast on leash toggle, syncing `remote.owner.isLeashed` and `remote.dog.state`.
3. `src/ui/touch_controls.js`: Leash button state indicator (`setLeashed(isLeashed)`).
4. `test/test_leash_sync.py`: Unit and regression test suite.
5. `test/run_tests.py`: Integration into the main test runner.

### Out-of-Scope
- Modifying canvas drawing geometry for leash catenary curve in `CompanionDog.prototype.drawLeash`.
- Changing server-side `party/server.js` message routing (PartyServer already transparently relays `SYNC_STATE`).

---

## 4. Worker Decomposition Plan

- **Worker 1 (`impl-interpolator-discrete-sync`) [MEDIUM]**:
  - Focus: `src/net/network.js`, `src/main.js`
  - Responsibilities: Implement discrete property propagation in `EntityInterpolator` (`isLeashed`, `isMoving`, `state`), update `toggleLeash()` in `src/main.js` to immediately broadcast `SYNC_STATE`, and verify remote entity state reflection.
- **Worker 2 (`impl-ui-feedback-tests`) [LOW/MEDIUM]**:
  - Focus: `src/ui/touch_controls.js`, `test/test_leash_sync.py`, `test/run_tests.py`
  - Responsibilities: Implement `setLeashed(isLeashed)` in `TouchControls` with visual toggle indication, author automated unit test suite in `test/test_leash_sync.py`, and register in `test/run_tests.py`.

---

## 5. Acceptance Criteria

- [x] `AC-1`: When a player takes their dog off-leash (pressing <kbd>L</kbd> or tapping the touch leash button), all other connected client windows (desktop, incognito, mobile) immediately remove the red leash graphic connecting the owner to the dog.
- [x] `AC-2`: When a player re-leashes their dog, all other connected client windows immediately re-draw the red catenary leash between the owner and the dog.
- [x] `AC-3`: `EntityInterpolator` properly propagates all discrete properties (`isLeashed`, `isMoving`, and dog `state`) from incoming `SYNC_STATE` packets while smoothly interpolating `x`, `y`, and `angle`.
- [x] `AC-4`: The mobile touch action button (`btn-touch-leash`) visually reflects the active leash status (e.g. toggling between `🦮` on-lead and `🐕` off-lead).
- [x] `AC-5`: All automated tests in `test/run_tests.py` (including the new leash synchronization tests) pass with 100% green status.
