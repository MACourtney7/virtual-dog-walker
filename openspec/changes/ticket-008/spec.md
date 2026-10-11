# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-008"
title: "Virtual Dog Walker: Player Identity, Peer Metadata Handshake & Style Synchronization"
state: "PLANNING"
created_at: "2026-10-11T14:35:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-008/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Root Cause Analysis

When multiple players connect to the park (e.g., standard browser tab, incognito tab, and mobile browser), visual identity and character styling desynchronize:
1. **Existing Browser Tab sees all characters as "You (Walker)"**:
   - The initial local avatar name was initialized to `"You (Walker)"` in `src/main.js`. Because clients broadcast their raw `this.owner.name` in `HELLO`, remote clients adopt `"You (Walker)"` as their display name, resulting in every player appearing identical to the local player.
2. **Late-Joining Tabs (Incognito & Mobile) see existing players as "Friend" in green jacket**:
   - In `party/server.js`, `onConnect` only transmitted string connection IDs in `WELCOME.peers` (`[ otherConn.id ]`) with no associated player metadata (`name`, `jacketColor`, `dogCoatName`).
   - Existing players never re-dispatched `HELLO` upon receiving notice of a new joiner.
   - Consequently, newly connected clients fall back to the placeholder fallback: `name: "Friend"` and `jacketColor: "#14532d"` (dark green).
3. **Static Instantiation Barrier (`src/main.js`)**:
   - Once a remote player was instantiated in `this.remotePlayers`, `main.js`'s `update(dt)` loop only synchronized physics coordinates (`x`, `y`, `vx`, `vy`, `angle`, `isMoving`, `isLeashed`), never updating `remote.owner.name`, `remote.owner.jacketColor`, or `remote.dog.coat` if metadata arrived or changed after instantiation.
4. **Lack of Local Style Persistence**:
   - Changes configured in the Style modal (`SocialHUD`) were not stored in `localStorage`, meaning every reload reverted back to default uncustomized profiles.

---

## 2. System Architecture & Technical Specifications

### 2.1 Server Peer Metadata Registry (`party/server.js`)
- **Stateful Room Peer Registry**:
  - `ParkServer` maintains `this.peers = new Map()` mapping `conn.id` to `{ id, name, jacketColor, dogCoatName }`.
  - When `HELLO` arrives from a client in `onMessage`, update the registry:
    ```javascript
    if (data.type === "HELLO") {
      this.peers.set(conn.id, {
        id: conn.id,
        name: data.name || "Walker",
        jacketColor: data.jacketColor || "#1e3a8a",
        dogCoatName: data.dogCoatName || "Chocolate & Tan (Ziggy)"
      });
    }
    ```
  - In `onConnect(conn, ctx)`: send `WELCOME` containing full peer objects:
    ```javascript
    peers: Array.from(this.peers.values()).filter(p => p.id !== conn.id)
    ```
  - In `onClose(conn)`: remove `conn.id` from `this.peers`.

### 2.2 Client Metadata Handling & Bidirectional Handshake (`src/net/ws_network.js`, `src/main.js`)
- **Rich `WELCOME.peers` Ingestion (`src/net/ws_network.js`)**:
  - In `handlePacket(WELCOME)`: iterate over `packet.peers`. If peer item is an object with `{ id, name, jacketColor, coatName }`, pass full metadata to `ensureRemotePeer` and `onPeerJoin`.
- **Bidirectional Handshake**:
  - When an existing client receives `HELLO` from a new peer, it replies by sending `HELLO` so the new peer is guaranteed to possess its profile even if network packets arrive out of order.
- **Dynamic Entity Reflection (`src/main.js`)**:
  - In `update(dt)`, continuously synchronize metadata from `interpolatorData.meta`:
    - If `interpolatorData.meta.name` differs from `remote.owner.name`, update it.
    - If `interpolatorData.meta.jacketColor` differs from `remote.owner.jacketColor`, update it.
    - If `interpolatorData.meta.coatName` differs from `remote.dog.coat.name`, update dog coat preset.

### 2.3 Distinct Nametags & Style Persistence (`src/entities/owner.js`, `src/ui/social_hud.js`)
- **Nametag Distinction (`src/entities/owner.js`, `src/main.js`)**:
  - Default player name initialized to `"Walker"` (or `"Park Walker"`).
  - In `Owner.render(ctx)`:
    - If `this.isLocal` is true: render yellow nametag (`#fde047`) displaying `"${this.name} (You)"` or `"You"`.
    - If `this.isLocal` is false: render white nametag (`#f8fafc`) displaying `"${this.name}"`.
- **LocalStorage Profile Persistence (`src/ui/social_hud.js`, `src/main.js`)**:
  - Save profile to `localStorage.getItem("clifton_walker_profile")` on modal save.
  - Load saved profile on game initialization so a player's customized name, jacket color, and dog coat persist across tab reloads.

### 2.4 Automated Testing & Verification (`test/test_player_identity.py`, `test/run_tests.py`)
- Unit tests verifying:
  - `ParkServer` stores and transmits rich peer metadata in `WELCOME`.
  - Client properly applies remote peer jacket colors and names.
  - Nametag rendering distinguishes local `"You"` from remote player names.
  - Full suite integration in `test/run_tests.py`.

---

## 3. Scope Boundaries

### In-Scope
1. `party/server.js`: Peer metadata registry and rich `WELCOME.peers` payload.
2. `src/net/ws_network.js`: Rich peer ingestion and bidirectional `HELLO` response.
3. `src/main.js`: Dynamic remote entity meta synchronization and local nametag separation.
4. `src/entities/owner.js`: Local vs remote nametag rendering (`"${name} (You)"` vs `"${name}"`).
5. `src/ui/social_hud.js`: `localStorage` profile saving and loading.
6. `test/test_player_identity.py`: Comprehensive automated tests.

### Out-of-Scope
- Modifying physics collision mechanics, ball trajectory, or leash dynamics.
- Changing Cloudflare Worker routing or Durable Object infrastructure.

---

## 4. Worker Decomposition Plan

- **Worker 1 (`impl-server-peer-state`) [LOW/MEDIUM]**:
  - Focus: `party/server.js`
  - Responsibilities: Stateful peer registry in `ParkServer`, populating rich peer metadata in `WELCOME`.
- **Worker 2 (`impl-client-meta-sync`) [MEDIUM]**:
  - Focus: `src/net/ws_network.js`, `src/main.js`, `src/entities/owner.js`
  - Responsibilities: Ingesting rich peers, dynamic metadata reflection in render loop, distinct local vs remote nametag text.
- **Worker 3 (`impl-style-storage-tests`) [LOW]**:
  - Focus: `src/ui/social_hud.js`, `test/test_player_identity.py`
  - Responsibilities: `localStorage` profile persistence, comprehensive automated test suite.

---

## 5. Acceptance Criteria

- [ ] `AC-1`: When a new player joins an existing room, the `WELCOME` packet includes the true `name`, `jacketColor`, and `dogCoatName` of all already-connected peers.
- [ ] `AC-2`: Existing players no longer display as placeholder `"Friend"` in green jacket (`#14532d`) to late-joining tabs or mobile browsers.
- [ ] `AC-3`: The local player sees their own nametag as `"${this.name} (You)"` (in yellow), while all remote players see the player's true name without `"(You)"` (in white).
- [ ] `AC-4`: Customizing name, jacket color, or dog coat in the Style modal updates the avatar immediately, updates all connected peers in real time, and persists to `localStorage`.
- [ ] `AC-5`: All automated tests in `test/run_tests.py` pass cleanly with 100% success rate.
