# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-034"
title: "Fix Cloudflare PartyServer NPC Spawner Initialization Guard Condition"
state: "COMPLETED"
roadmap: null
depends_on: []
created_at: "2026-10-31T16:45:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-034/main"
max_review_cycles: 3
target_files:
  - "party/server.js"
  - "test/test_partyserver.py"
---
```

## 1. Problem Statement & Root Cause
In `party/server.js`, `ParkServer.onConnect(conn, ctx)` gates NPC spawner initialization behind:
```javascript
const isFirstPeer = !this.hasActiveClients();
this.connections.add(conn.id);

if (this.activeNpcs.size === 0 && isFirstPeer) {
  this.initSpawner();
}
```

### Root Cause
1. `ParkServer` extends `Server` from Cloudflare `"partyserver"`.
2. In the `partyserver` framework, the WebSocket connection `conn` is accepted and registered into the base class's `this.getConnections()` iterator **before** `onConnect(conn, ctx)` is invoked.
3. Consequently, in `hasActiveClients()`:
   ```javascript
   if (typeof this.getConnections === "function") {
     try {
       const conns = [...this.getConnections()];
       if (conns.length > 0) return true;
     } catch (e) {}
   }
   ```
   `this.getConnections()` already contains `conn` (`conns.length === 1`).
4. Therefore, `this.hasActiveClients()` returns `true`, causing `isFirstPeer` to evaluate to `false`.
5. As a result, `if (this.activeNpcs.size === 0 && isFirstPeer)` evaluates to `false`, and `this.initSpawner()` is **never called**.
6. The server subsequently transmits `NPC_SNAPSHOT` with an empty `npcs: []` array to all connecting clients, causing the park to have 0 server NPCs indefinitely.

---

## 2. Technical Specification

1. In `party/server.js` (`onConnect(conn, ctx)`):
   - Replace the flawed check:
     ```javascript
     // BEFORE:
     if (this.activeNpcs.size === 0 && isFirstPeer) {
       this.initSpawner();
     }
     ```
     with:
     ```javascript
     // AFTER:
     if (this.activeNpcs.size === 0) {
       this.initSpawner();
     }
     ```
   - This ensures that whenever a client connects and the room's active NPC pool is empty (whether initial connection, late joiner after inactivity, or surviving Durable Object instance), `initSpawner()` immediately initializes and pre-warms the active NPC pool.
2. In `test/test_partyserver.py`:
   - Add a unit test explicitly asserting that `party/server.js` initializes the spawner on connect whenever `this.activeNpcs.size === 0`, without requiring `isFirstPeer`.

---

## 3. Acceptance Criteria
- **AC-034.1**: When a client connects to `ParkServer` and `activeNpcs.size === 0`, `initSpawner()` executes unconditionally regardless of whether `getConnections()` already holds the connection.
- **AC-034.2**: The connecting client receives an `NPC_SNAPSHOT` packet populated with active, pre-warmed NPCs (length matches `targetNpcCount`).
- **AC-034.3**: `python3 test/run_tests.py` passes 100% across all suites.

