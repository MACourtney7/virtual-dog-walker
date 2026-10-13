# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-018"
roadmap_id: "chat-visual-overhaul"
title: "Tombstone Subsystem Removal & Turf Cleanup"
state: "PLANNING"
created_at: "2026-10-12T20:10:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-018/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

In ticket-015, parting tombstones were introduced to drop stone markers on the turf when players leave proximity. In practice, these tombstones clutter the field, distract from park gameplay, and add unneeded network/rendering overhead.

The goal of this ticket is to completely eliminate the tombstone dropping mechanism:
1. Deprecate/remove `ChatTombstone` in `src/entities/tombstone.js`.
2. Remove tombstone arrays, updates, and y-sorted rendering passes from `src/world/field.js`.
3. Remove `PacketType.TOMBSTONE_DROP` and helper methods from `src/net/protocol.js`.
4. Remove tombstone instantiations and network handlers from `src/main.js`.
5. Ensure the turf remains clean and natural when players leave each other's proximity.

---

## 2. System Architecture & Technical Specifications

### 2.1 Turf & Entity Cleanup (`src/world/field.js`)
- Remove `this.tombstones = []` registry from `Field` constructor.
- Remove `addTombstone(tombstone)` method.
- Remove tombstone update ticks and lifespan culling from `Field.update(dt)`.
- Remove tombstone entries from the `Field.draw(...)` y-sorted depth render queue.

### 2.2 Network Protocol Streamlining (`src/net/protocol.js`)
- Deprecate or remove `PacketType.TOMBSTONE_DROP`.
- Remove `Protocol.createTombstoneDrop(...)` packet constructor.

### 2.3 Parting Event Lifecycle (`src/main.js`)
- In `onClusterDissolved`, remove `ChatTombstone` creation and `field.addTombstone`.
- Remove `this.net.onTombstoneDrop` handler.
- Remove `TOMBSTONE_DROP` packet filtering in message dispatch.
- Remove `ChatTombstone` import from `src/entities/tombstone.js`.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-018.1** | When players leave conversation proximity, zero tombstone markers or ground entities are spawned on the turf. | Unit test verifying empty tombstone collection on parting |
| **AC-018.2** | `Field.draw()` renders without references to tombstone entities. | Inspection of field render loop & test runner |
| **AC-018.3** | `TOMBSTONE_DROP` packets are no longer emitted or processed by the networking protocol. | Protocol schema test verification |
| **AC-018.4** | Zero regressions in existing test suite (`python3 test/run_tests.py`). | Automated test suite execution |

---

## 4. Testing & Verification Strategy
- Verify that `Field` updates and renders cleanly without errors when players walk apart.
- Ensure no lingering references break existing unit tests.
