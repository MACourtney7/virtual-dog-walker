# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-005"
title: "Virtual Dog Walker: Migrate to PartyServer on Cloudflare Workers with Shared Public Commons"
state: "COMPLETED"
created_at: "2026-10-11T11:21:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-005/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Objective
With the upcoming deprecation of the third-party hosted PartyKit platform (`*.partykit.dev`) in October 2026, real-time edge workloads are transitioning to **PartyServer** (`partyserver`), Cloudflare's official open-source library that runs directly inside the developer's own Cloudflare account as a native Worker using Durable Objects and `wrangler`.

Simultaneously, the game's current private room model introduces unnecessary friction for a social sandbox: players must create rooms, copy room codes, or share special query parameters just to see each other. 

**Ticket-005 accomplishes two foundational goals**:
1. **Migration to PartyServer (`partyserver`) on Cloudflare Workers**:
   - Replaces the deprecated `partykit` CLI with standard Cloudflare `wrangler` and the `partyserver` package.
   - Deploys the room relay and static game frontend directly to the user's permanent Cloudflare account (`https://virtual-dog-walker.<subdomain>.workers.dev`) at $0 cost.
2. **The Always-Open Shared Public Commons**:
   - Replaces the private room lobby model with a single shared public meadow (`the-commons`) by default.
   - Anyone visiting the site or opening the app immediately walks into the shared park alongside all other online dog-walkers.
   - Private rooms remain available as an optional opt-in feature via `?room=<custom-id>`.

---

## 2. System Architecture & Edge Design

### 2.1 PartyServer Room Engine (`party/server.js`)
- Inherits from `Server` in `partyserver`:
  - `onConnect(conn, ctx)`: Generates `peerId = conn.id` and transmits `WELCOME` packet with current room peer list and server timestamp.
  - `onMessage(conn, message)`: Multiplexes `HELLO`, `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, `EMOTE` across room peers using `this.broadcast(message, [conn.id])`.
  - `onClose(conn)`: Emits `PEER_LEFT` to remaining players.
- Exports Cloudflare Worker `fetch` handler using `routePartykitRequest` from `partyserver` with automatic fallback to static asset bindings.

### 2.2 Always-Open Public Commons (`the-commons`)
- **Default Room Assignment**:
  - The default room identifier is universally set to `the-commons`.
  - Visiting the root domain without parameters connects directly to `the-commons`.
- **Optional Private Meadows**:
  - If a player specifically desires a private session, appending `?room=<custom-code>` routes to an isolated Durable Object instance.

### 2.3 Cloudflare Worker Manifest (`wrangler.jsonc`)
- Replaces `partykit.json` with native Cloudflare configuration:
  - Worker name: `virtual-dog-walker`
  - Main entry point: `party/server.js`
  - Durable Object bindings for `ParkServer`
  - Static asset serving: `assets: { directory: "./", binding: "ASSETS" }`
  - Compatibility flags: `nodejs_compat`

### 2.4 Client Transport & HUD Polish (`src/net/`, `src/ui/social_hud.js`)
- `ws_network.js` & `network.js`:
  - Default connection room: `the-commons`.
  - Auto-detects Cloudflare Worker domains (`*.workers.dev`, `localhost:8787`).
- `social_hud.js`:
  - Displays **`🌳 Clifton Commons`** badge when connected to the public meadow.
  - "Share Park" button copies the clean base URL (`https://<domain>/`) without cluttering query params.
  - Includes a discreet "Private Meadow" action for optional private rooms.

---

## 3. Scope Boundaries

### In-Scope
1. **PartyServer Room Engine (`party/server.js`)**:
   - Replaces `party/main.js` with `partyserver` `Server` class.
2. **Cloudflare Worker Configuration (`wrangler.jsonc`, `package.json`)**:
   - Replaces `partykit.json` with `wrangler.jsonc`.
   - Updates `package.json` with `partyserver` dependency and scripts (`dev` -> `wrangler dev`, `deploy` -> `wrangler deploy`).
3. **Always-Open Commons Default**:
   - Updates `src/net/network.js` and `src/net/ws_network.js` to default room `the-commons`.
4. **Social HUD Commons Polish (`src/ui/social_hud.js`)**:
   - Displays "Clifton Commons" status and clean URL sharing.
5. **Automated Test Suite & CI (`test/test_partyserver.py`, `test/run_tests.py`)**:
   - Unit tests validating PartyServer lifecycle, room multiplexing, and commons routing.
   - Master test runner verification.

### Out-of-Scope
- Complex database persistence / external relational databases (ephemeral in-memory Durable Objects provide $0 cost).
- Native iOS/Android store compilation (reserved for follow-up Capacitor ticket).

---

## 4. Requirements & Acceptance Criteria

- [ ] **REQ-1: PartyServer Edge Room Relay (`party/server.js`)**
  - Inherits from `partyserver` `Server` class.
  - Handles `onConnect`, `onMessage`, and `onClose` with zero packet reflection.
  - Exports a standard Cloudflare Worker `fetch` handler routing WebSocket and HTTP requests.
  - *Verification*: Automated unit tests verify lifecycle handshakes, packet propagation, and disconnection broadcasts.

- [ ] **REQ-2: Cloudflare Worker Manifest (`wrangler.jsonc`, `package.json`)**
  - Defines `wrangler.jsonc` configuring Durable Object bindings for `ParkServer` and static asset mapping (`assets: "./"`).
  - Configures `package.json` with `"dev": "wrangler dev"` and `"deploy": "wrangler deploy"`.
  - Removes deprecated `partykit.json` and `partykit` CLI dependencies.
  - *Verification*: Verification script confirms valid JSONC schema and entry point resolution.

- [ ] **REQ-3: Always-Open Public Commons Engine (`src/net/ws_network.js`, `src/net/network.js`)**
  - Default room is set to `the-commons`.
  - Auto-detects Cloudflare Worker origins (`*.workers.dev`, `localhost:8787`).
  - Preserves optional private room query parameters (`?room=...`).
  - *Verification*: Schema and URL tests confirm correct connection endpoints and fallback behavior.

- [ ] **REQ-4: Social HUD Commons Polish (`src/ui/social_hud.js`)**
  - Status pill displays "🌳 Clifton Commons" when in the public meadow.
  - "Share Park" button copies clean public URL with toast confirmation.
  - *Verification*: UI tests verify badge text and clean share link generation.

- [ ] **REQ-5: Test Suite & CI Integration (`test/test_partyserver.py`, `test/run_tests.py`)**
  - Tests PartyServer room lifecycle, commons routing, and schema integrity.
  - `python3 test/run_tests.py` passes 100% green.

---

## 5. Architectural Design & Impacted Files
- **New Files**:
  - `party/server.js`: PartyServer implementation using Cloudflare Durable Objects.
  - `wrangler.jsonc`: Native Cloudflare Worker and Durable Object configuration.
  - `test/test_partyserver.py`: Automated PartyServer test suite.
- **Removed Files**:
  - `partykit.json` (deprecated)
  - `party/main.js` (superseded by `party/server.js`)
- **Modified Files**:
  - `package.json`: Updated dependencies (`partyserver`, `wrangler`) and scripts.
  - `src/net/ws_network.js`: Default room `the-commons` and PartyServer endpoint routing.
  - `src/net/network.js`: Cloudflare Worker auto-detection.
  - `src/ui/social_hud.js`: Commons badge and 1-click clean share URL.
  - `test/run_tests.py`: Registration of PartyServer test suite.
  - `README.md`: Updated development and deployment instructions using `wrangler`.
