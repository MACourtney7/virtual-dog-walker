# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-007"
title: "Fix Cloudflare PartyServer Multiplayer Routing, Handshake Synchronization, and HUD Status Diagnostics"
state: "PLANNING"
created_at: "2026-10-11T13:58:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-007/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Root Cause Analysis

When players visit the deployed game at `https://play.virtual-dog-walker.workers.dev` across multiple browser windows, incognito sessions, and mobile devices, they cannot see or interact with each other in the park. Each client remains isolated in solo mode despite the top HUD displaying a green badge indicating they are connected to `🌳 Clifton Commons`.

### 1.1 Root Cause Breakdown

1. **PartyServer Route & Durable Object Binding Mismatch (Cloudflare Error 1101)**:
   - In `wrangler.jsonc`, the Durable Object binding is defined as `ParkServer`:
     ```jsonc
     "durable_objects": { "bindings": [{ "name": "ParkServer", "class_name": "ParkServer" }] }
     ```
   - In `src/net/ws_network.js`, `buildWebSocketUrl` constructs the WebSocket endpoint using path segment `/parties/park/${roomId}`:
     ```javascript
     return new URL(`${clean}/parties/park/${roomId}`);
     ```
   - In `partyserver` (`routePartykitRequest`), route matching parses `/parties/:server/:name` and looks up `map[server.toLowerCase()]` where `map` keys are derived from the lowercase binding names in `env` (i.e. `map["parkserver"] = env.ParkServer`).
   - Because `:server` in the client URL is `"park"`, `map["park"]` evaluates to `undefined`. `partyserver` subsequently invokes `undefined.idFromName(roomId)`, triggering an unhandled `TypeError` inside the Cloudflare Worker, resulting in HTTP 500 (Cloudflare Error 1101).
   - In contrast, requests sent to `/parties/parkserver/the-commons` successfully upgrade to WebSocket and transmit the `WELCOME` packet.

2. **Misleading HUD Connection State**:
   - In `src/ui/social_hud.js`, `updateNetworkState(status, message)` checks `if (this.net.isPartyKit || this.net.isDedicatedServer)`. Because this flag is statically set on initialization, the HUD renders the green `🌳 Clifton Commons` badge unconditionally—even when the WebSocket connection has errored, closed, or dropped to solo mode.

3. **Handshake & SenderId De-Synchronization**:
   - On `ws.onopen`, the client sends `HELLO` with a temporary randomized ID (`walker-XXXX`).
   - When the server's `WELCOME` packet subsequently arrives assigning the authoritative `conn.id` (`peerId`), the client updates `this.peerId` but never re-broadcasts `HELLO` with the new ID.
   - Consequently, remote peers record metadata for `walker-XXXX`, while high-frequency `SYNC_STATE` packets arrive stamped with `conn.id`, leading to orphaned entity entries or desynchronization.

---

## 2. System Architecture & Technical Specifications

### 2.1 PartyServer Namespace Aliasing & Robust Error Handling (`party/server.js`)
- **Dual Namespace Aliasing**:
  - In `party/server.js`'s `fetch` export, explicitly alias `env.park = env.ParkServer` and `env.parkserver = env.ParkServer` before invoking `routePartykitRequest(request, env)`.
  - Ensures both `/parties/park/:room` and `/parties/parkserver/:room` match the `ParkServer` Durable Object namespace.
- **Worker Crash Guard (`try...catch`)**:
  - Enclose `routePartykitRequest` in a defensive `try...catch` block. If routing encounters an unexpected error, log the exception and return a structured JSON response instead of crashing with Cloudflare 1101.
- **Authoritative Sender Stamping & Lifecycle Relay**:
  - In `ParkServer.onMessage(conn, message)`, enforce `data.senderId = conn.id` on all relayed payloads so message senders can never desynchronize from their connection ID.
  - In `ParkServer.onConnect(conn, ctx)`, send `WELCOME` with assigned `peerId: conn.id` and the list of active peer IDs.

### 2.2 Client URL Path Resolution & Handshake Alignment (`src/net/ws_network.js`, `src/net/network.js`)
- **Canonical WebSocket URL**:
  - In `buildWebSocketUrl`, standardize `:server` segment to `parkserver` (while retaining server-side aliasing for backwards compatibility with any cached clients).
- **Post-Welcome Handshake Broadcast**:
  - In `handlePacket(WELCOME)`: when `packet.peerId` updates `this.peerId`, immediately broadcast `Protocol.createHello(this.peerId, this.localMeta.name, this.localMeta.jacketColor, this.localMeta.coatName)`.
  - This ensures all peers in the room possess complete player metadata mapped to the exact authoritative connection ID used in `SYNC_STATE`.

### 2.3 Accurate Real-Time Network HUD & Diagnostics (`src/ui/social_hud.js`)
- **Status-Driven Diagnostics**:
  - Base the badge appearance strictly on live `status`:
    - `WSStatus.CONNECTED` / `NetStatus.CONNECTED_PEER`: Green badge (`🌳 Clifton Commons` or `🔒 Meadow (<id>)`).
    - `WSStatus.CONNECTING`: Yellow badge (`⏳ Connecting...`).
    - `WSStatus.RECONNECTING`: Amber badge (`🔄 Reconnecting...`).
    - `WSStatus.OFFLINE` / `WSStatus.ERROR`: Gray badge (`Offline (Solo)`).
  - Surface actionable toast notifications when connection drops or is restored.

### 2.4 Automated Testing & Verification (`test/test_partyserver.py`, `test/run_tests.py`)
- Unit tests verifying:
  - Both `/parties/park/...` and `/parties/parkserver/...` route matching patterns.
  - `WELCOME` packet handling and post-welcome `HELLO` re-dispatch.
  - Authoritative `senderId` stamping in `ParkServer.onMessage`.
  - HUD status badge rendering across `CONNECTED`, `CONNECTING`, `RECONNECTING`, and `OFFLINE` states.
  - Integration verification in `test/run_tests.py`.

---

## 3. Scope Boundaries

### In-Scope
1. `party/server.js`: Namespace aliasing (`env.park = env.ParkServer`), `try...catch` routing guard, authoritative `conn.id` stamping.
2. `src/net/ws_network.js`: WebSocket route alignment, post-`WELCOME` metadata handshake dispatch.
3. `src/ui/social_hud.js`: State-driven badge coloring and diagnostics.
4. `test/test_partyserver.py` & `test/run_tests.py`: Comprehensive test coverage for routing, handshakes, and status badges.

### Out-of-Scope
- Modifying game canvas rendering or entity physics loops.
- Altering mobile touch controls or audio unlock mechanisms.
- Changing Cloudflare billing or subscription tiers.

---

## 4. Worker Decomposition Plan

Following the **Anti-Monolith Mandate** and **Mandatory Concurrency** rules:

- **Worker 1 (`impl-server-routing`) [LOW/MEDIUM]**:
  - Focus: `party/server.js`
  - Responsibilities: Namespace aliasing in worker `fetch`, error guard, authoritative `conn.id` stamping in `onMessage`.
- **Worker 2 (`impl-client-handshake-hud`) [MEDIUM]**:
  - Focus: `src/net/ws_network.js`, `src/ui/social_hud.js`
  - Responsibilities: WebSocket URL path alignment, post-welcome handshake dispatch, live status-driven HUD badge states.
- **Worker 3 (`impl-test-verification`) [LOW]**:
  - Focus: `test/test_partyserver.py`
  - Responsibilities: Automated unit tests validating routing aliasing, handshake flow, and status badge diagnostics.

---

## 5. Acceptance Criteria

- [ ] `AC-1`: Requests to `https://play.virtual-dog-walker.workers.dev` via WebSocket upgrade on `/parties/park/:room` or `/parties/parkserver/:room` succeed with HTTP 101 Switching Protocols and receive a valid `WELCOME` packet without Cloudflare Error 1101.
- [ ] `AC-2`: Multiple clients (desktop browser, incognito window, mobile device) joining `the-commons` receive each other's `HELLO` metadata and bidirectional `SYNC_STATE` updates, rendering remote walkers and companion dogs in real time.
- [ ] `AC-3`: HUD mode badge accurately displays `⏳ Connecting...`, `🌳 Clifton Commons` (green when connected), `🔄 Reconnecting...`, or `Offline (Solo)` (gray on disconnection) based on actual live socket state.
- [ ] `AC-4`: Disconnecting a client broadcasts `PEER_LEFT` and removes the remote avatar from all remaining clients' viewports.
- [ ] `AC-5`: All automated tests in `test/run_tests.py` pass cleanly with 100% success rate.
