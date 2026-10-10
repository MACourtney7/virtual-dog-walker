# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-004"
title: "Clifton Down: PartyKit Global Edge Multiplayer Rooms & Single-URL Web Hosting"
state: "PLANNING"
created_at: "2026-10-10T22:33:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-004/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Objective
While Ticket-003 successfully established a dedicated Python microserver with zero-port Cloudflare tunneling for local desktop hosts, running a game still requires the host player to clone the repository, install Python/dependencies, and execute terminal commands (`python3 server/host.py`).

To achieve the ultimate **zero-install, 100% in-browser multiplayer sandbox** that scales infinitely at $0 idle cost and seamlessly paves the way for a future mobile app wrapper, Ticket-004 integrates **PartyKit** (by Cloudflare). 

With PartyKit:
1. **On-Demand Edge Rooms**: Each park meadow (room) is an ephemeral actor spun up at the global edge in milliseconds when the first player arrives, running at single-digit latency across 300+ edge data centers.
2. **Single-URL Deployment**: PartyKit serves both the static game frontend (`index.html`, `src/`) and the real-time WebSocket room relay under a single URL (`https://clifton-down.<subdomain>.partykit.dev`).
3. **Zero Host Setup**: A host player simply opens their browser tab, clicks "Create Park", and shares the invite link. Guests click the link on their laptops, tablets, or phones and join instantly.
4. **Mobile Ready**: The exact same PartyKit endpoint and client codebase are ready to be wrapped in Capacitor (iOS/Android) with zero backend changes.

---

## 2. System Architecture & Edge Design

### 2.1 PartyKit Room Relay (`party/main.js`)
- Runs as an edge serverless actor adhering to the PartyKit standard lifecycle:
  - `onConnect(conn, room)`: Assigns a unique `peerId`, registers player connection metadata, and sends an initial `WELCOME` packet containing room peer list.
  - `onMessage(message, sender, room)`: High-throughput, non-blocking packet multiplexing:
    - Deserializes and validates protocol packets (`HELLO`, `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, `EMOTE`).
    - Broadcasts state updates efficiently to all other peers in the room (`room.broadcast(message, [sender.id])`).
  - `onClose(conn, room)`: Cleans up peer state and broadcasts `PEER_LEFT` to remaining players.
  - Scale-to-zero: Once all players disconnect, the room actor terminates cleanly with zero persistent resource consumption.

### 2.2 Project Configuration & Static Serving (`partykit.json`)
- Configures the PartyKit application:
  ```json
  {
    "$schema": "https://www.partykit.io/schema.json",
    "name": "clifton-down",
    "main": "party/main.js",
    "serve": "./",
    "compatibilityDate": "2026-10-10"
  }
  ```
- Serves static assets (`index.html`, `src/`, `style.css`) at the root path, providing a unified origin for HTTP and WSS.

### 2.3 Client PartyKit Adapter & Auto-Detection (`src/net/ws_network.js`, `src/net/network.js`)
- **Transport Routing**:
  - Automatically identifies PartyKit runtime environments:
    - If running on `*.partykit.dev` or `localhost:1999`, connects directly to `wss://<host>/parties/park/<roomId>`.
    - Supports query parameters `?party=...` and `?room=...` for custom edge domains.
    - Gracefully retains fallback to local Python microserver or solo sandbox mode.
- **Protocol Parity**:
  - Maintains 100% compatibility with existing `Protocol` packet schemas and `EntityInterpolator` 60 FPS remote entity rendering.

### 2.4 Social HUD & One-Click Share UX (`src/ui/social_hud.js`)
- Status badge indicates "Connected via Global Edge (PartyKit WSS)".
- "Share Park" button generates a clean URL: `https://<host>/?room=<roomId>`.
- Displays active player count and room badge with toast feedback.

---

## 3. Scope Boundaries

### In-Scope
1. **PartyKit Edge Room Server (`party/main.js`)**:
   - Stateful edge room actor managing connections, handshakes, broadcasts, and cleanup.
2. **PartyKit Configuration & NPM Setup (`partykit.json`, `package.json`)**:
   - NPM scripts for local development (`npm run party:dev`) and deployment (`npm run party:deploy`).
   - Static asset serving configuration.
3. **Client PartyKit Integration (`src/net/ws_network.js`, `src/net/network.js`)**:
   - Universal URL builder supporting PartyKit route paths (`/parties/park/:room`).
   - Connection recovery with exponential backoff.
4. **HUD & Sharing Polish (`src/ui/social_hud.js`)**:
   - Connection status badges and 1-click shareable URLs.
5. **Validation Test Suite (`test/test_partykit.py`, `test/run_tests.py`)**:
   - Tests validating message routing, handshake schemas, and client URL generation.

### Out-of-Scope
- Cloudflare paid add-ons or custom databases (ephemeral memory rooms are zero-cost and privacy-preserving).
- Native iOS/Android store compilation (reserved for follow-up Capacitor ticket).

---

## 4. Requirements & Acceptance Criteria

- [ ] **REQ-1: PartyKit Edge Server Room Relay (`party/main.js`)**
  - Exports a standard PartyKit server object with `onConnect`, `onMessage`, and `onClose`.
  - Sends `WELCOME` with unique `peerId` to joining players.
  - Broadcasts `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, and `EMOTE` between room members.
  - Broadcasts `PEER_LEFT` when a player disconnects.
  - *Verification*: Unit tests simulating room connections, handshakes, and packet relays pass with 100% green status.

- [ ] **REQ-2: PartyKit Configuration & Static Serving (`partykit.json`, `package.json`)**
  - Defines `partykit.json` mapping `party/main.js` and static assets.
  - Provides `package.json` scripts (`party:dev` -> `partykit dev`, `party:deploy` -> `partykit deploy`).
  - *Verification*: Verification script confirms valid JSON configuration and entry point resolution.

- [ ] **REQ-3: Client-Side PartyKit Auto-Detection & Adapter (`src/net/ws_network.js`, `src/net/network.js`)**
  - Connects to `/parties/park/<roomId>` when loaded on PartyKit host or when `?party=` parameter is present.
  - Maintains existing 16 Hz sync rate and smooth 60 FPS entity interpolation.
  - Falls back smoothly to offline solo mode if connection fails.
  - *Verification*: Protocol tests confirm valid schema encoding and connection URL generation.

- [ ] **REQ-4: Social HUD Edge Badge & Share Experience (`src/ui/social_hud.js`)**
  - Displays "Global Edge (WSS)" connection badge.
  - One-click "Share Park" button copies `https://<host>/?room=<roomId>`.
  - *Verification*: HUD tests verify correct badge rendering and share link construction.

- [ ] **REQ-5: Full Test Suite Integration (`test/run_tests.py`)**
  - Extends test suite with PartyKit protocol and room schema validation.
  - *Verification*: `python3 test/run_tests.py` passes 100% green.

---

## 5. Architectural Design & Impacted Files
- **New Files**:
  - `party/main.js`: PartyKit edge room server.
  - `partykit.json`: PartyKit configuration and static asset mapping.
  - `package.json`: NPM package manifest with PartyKit dev dependencies and runner scripts.
  - `test/test_partykit.py`: PartyKit schema and protocol integration tests.
- **Modified Files**:
  - `src/net/ws_network.js`: Dynamic PartyKit endpoint formatting (`/parties/park/:room`).
  - `src/net/network.js`: PartyKit runtime auto-detection.
  - `src/ui/social_hud.js`: HUD edge status badges.
  - `test/run_tests.py`: Registration of PartyKit test suite.
  - `README.md`: PartyKit local development and deployment instructions.
