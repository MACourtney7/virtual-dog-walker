# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-003"
title: "Clifton Down: Dedicated Multiplayer Microserver with Zero-Port Tunneling"
state: "PLANNING"
created_at: "2026-10-10T21:52:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-003/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Objective
The pure in-browser WebRTC peer-to-peer networking (PeerJS with default STUN) implemented in Ticket-002 struggles across external networks and firewalls:
1. **NAT Traversal Restrictions**: Residential routers, symmetric NATs, mobile cellular hotspots, and academic/corporate networks block direct peer connections without a dedicated relay.
2. **Host Tab Throttling**: When an in-browser host minimizes their browser tab or navigates away, Chrome/Safari throttle timers and frame rates, inducing severe lag or disconnection for remote visitors.
3. **Complex Port Forwarding**: Players do not want to configure home router port forwarding or reveal personal home IP addresses.

To achieve a seamless, robust **"Minecraft-style but browser-based"** hosting experience with minimal host infrastructure and zero port forwarding, Ticket-003 introduces a **lightweight dedicated microserver** (`server/server.py` and optional runner) paired with an automated **zero-port public tunnel** (e.g. Cloudflare Quick Tunnel) and a unified client networking adapter (`src/net/ws_network.js` & `src/net/network.js`).

A player runs a single command:
```bash
python3 server/host.py
```
This starts the microserver, serves the game static assets, handles WebSocket multiplayer rooms, automatically spins up a secure public HTTPS/WSS URL (`https://<subdomain>.trycloudflare.com`), and outputs a one-click invite link. Guests outside the network simply click the link in their web browser—no installation, no port forwarding, no accounts.

---

## 2. System Architecture & Tunneling Design

### 2.1 Microserver Architecture (`server/server.py`)
- Built on Python 3 using asynchronous I/O (`aiohttp` / native asynchronous WebSockets).
- **Dual Responsibility**:
  1. **Static HTTP File Server**: Serves `index.html`, `src/`, styles, and assets on `http://127.0.0.1:8080`.
  2. **WebSocket Game Room Relay**: Listens on `/ws` (or root WebSocket handler) to manage room channels (`room_id`), player handshakes (`HELLO`, `WELCOME`), high-frequency state broadcasts (`SYNC_STATE` at 16Hz), ball physics sync (`BALL_THROWN`, `BALL_SYNC`), dog barks (`BARK`), pets (`PET`), and chat/emotes.
- **Heartbeat & Disconnection Hygiene**:
  - Pings clients every 15s; gracefully removes abandoned peers, broadcasts `PEER_LEFT` notifications, and frees idle rooms after all players leave.
- **Non-Throttled Dedicated Loop**:
  - Runs in a persistent background terminal process unaffected by browser tab minimization, sleep states, or client focus loss.

### 2.2 Zero-Config Public Tunneling (`server/host.py`)
- Launches the local microserver on an available port.
- Automatically provisions a public tunnel without requiring router port-forwarding, accounts, or API keys:
  - Supports **Cloudflare Quick Tunnels** via standalone `cloudflared` binary downloader or system runner (`cloudflared tunnel --url http://127.0.0.1:8080`).
  - Fallback to local LAN IP display and standard port mode if offline or no tunnel available.
- Prints a clear, attractive CLI banner with:
  - Local URL: `http://localhost:8080`
  - Local Network URL: `http://192.168.x.x:8080`
  - **Public Invite Link**: `https://<random-id>.trycloudflare.com/?server=wss://<random-id>.trycloudflare.com/ws&room=<room-id>`
- Displays active connected player counts in real time on the console.

### 2.3 Universal Client Networking Engine (`src/net/network.js` & `src/net/ws_network.js`)
- **Transport Abstraction**:
  - The game client dynamically detects its connection mode:
    - **WebSocket Microserver Mode**: If loaded via the host server or if `?server=...` is present in the URL, connects via native `WebSocket` directly to the microserver.
    - **WebRTC P2P Fallback Mode**: If running purely as a static standalone file without a server, falls back gracefully to the existing PeerJS P2P engine.
- **Protocol Parity**:
  - Retains 100% compatibility with existing `Protocol` packet schemas (`HELLO`, `WELCOME`, `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, `EMOTE`, `PEER_LEFT`).
- **Smooth Interpolation**:
  - Employs `EntityInterpolator` for smooth remote entity positions (owner and dog) with zero stutter.
- **HUD Integration (`src/ui/social_hud.js`)**:
  - Status indicator displays "Connected via Dedicated Microserver (WSS)" with low ping badge.
  - "Copy Invite Link" copies the complete public tunnel URL with room code preloaded.

---

## 3. Scope Boundaries

### In-Scope
1. **Dedicated Python Asynchronous Microserver (`server/server.py`)**:
   - Single-process, high-throughput WebSocket & static file server.
   - Authoritative room management and packet multiplexing.
   - Automated cleanup of disconnected peers and empty rooms.
2. **Zero-Port Tunnel Automation (`server/host.py`)**:
   - Interactive CLI runner with colorful terminal output.
   - Automatic tunnel initialization (Cloudflare Quick Tunnel / local fallback).
   - Instant invite link generation.
3. **Client WebSocket Network Adapter (`src/net/ws_network.js`)**:
   - Resilient WebSocket connection with exponential backoff auto-reconnect.
   - Synchronized player state, canine companion positions, ball physics, barking, and chat.
   - Unified interface matching `NetworkManager` so `main.js` transitions seamlessly.
4. **Enhanced In-Game HUD & Connection Experience (`src/ui/social_hud.js`)**:
   - Shows active connection mode (`Dedicated Microserver` vs `Peer P2P`).
   - One-click "Copy Server Link" toast.
   - Visual ping/latency and connected player list.
5. **Test Suite & Verification (`test/test_server.py`, `test/run_tests.py`)**:
   - Unit and integration tests for microserver handshake, packet routing, room isolation, and disconnection handling.
   - CLI runner sanity checks.

### Out-of-Scope
- Complex database persistence or user accounts (rooms remain lightweight, privacy-preserving, and ephemeral).
- Paid cloud infrastructure requirements (zero cost, zero port forwarding, runs on local machine or free tiers).

---

## 4. Requirements & Acceptance Criteria

- [ ] **REQ-1: Asynchronous Microserver Room Engine (`server/server.py`)**
  - Starts an HTTP and WebSocket server on `127.0.0.1:8080` (or configurable port).
  - Handles concurrent rooms isolated by `room_id`.
  - Routes `HELLO`, `WELCOME`, `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, and `EMOTE` between room members.
  - Broadcasts `PEER_LEFT` when a connection closes and cleanly recycles memory.
  - *Verification*: Automated test suite connects two simulated WebSocket clients, verifies handshakes, bidirectional state relaying, and disconnect cleanup.

- [ ] **REQ-2: Zero-Port Tunnel & Host CLI Runner (`server/host.py`)**
  - Single executable command `python3 server/host.py`.
  - Spawns the microserver and initiates a zero-port public tunnel.
  - Prints clear, formatted invite links for local, LAN, and public players.
  - Graceful shutdown on <kbd>Ctrl+C</kbd> cleanly terminating tunnel and server child processes.
  - *Verification*: CLI smoke test verifies startup, link generation, and clean shutdown.

- [ ] **REQ-3: Client-Side Universal Network Adapter (`src/net/ws_network.js` & `src/net/network.js`)**
  - Connects to microserver WebSocket when server parameter is present or host matches server origin.
  - Exchanges player profile metadata on join.
  - Feeds remote entity updates into `EntityInterpolator` at 60 FPS.
  - Broadcasts local owner and dog snapshots at 16 Hz.
  - Falls back to offline solo mode or PeerJS P2P if microserver is unreachable.
  - *Verification*: In-browser testing with multiple tabs and automated schema verification.

- [ ] **REQ-4: Social HUD & Share Link UX Polish (`src/ui/social_hud.js`)**
  - HUD displays server connection badge, room ID, and player count.
  - "Share Park" button copies the public tunnel URL.
  - In-game toast notifications when peers join, leave, bark, or pet.
  - *Verification*: UI correctly formats share URLs and displays peer connection status changes.

- [ ] **REQ-5: End-to-End Test Suite Update (`test/run_tests.py`)**
  - Extends existing test suite to validate WebSocket microserver protocols, room routing, payload integrity, and tunnel helpers alongside existing physics tests.
  - *Verification*: `python3 test/run_tests.py` passes with 100% green status.

---

## 5. Architectural Design & Impacted Files
- **New Files**:
  - `server/server.py`: Asynchronous WebSocket and HTTP static file server.
  - `server/host.py`: CLI host launcher with auto-tunneling and invite URL generator.
  - `src/net/ws_network.js`: Client WebSocket transport adapter.
  - `test/test_server.py`: Microserver integration test suite.
- **Modified Files**:
  - `src/net/network.js`: Unified network manager supporting both WebSocket microserver and fallback P2P modes.
  - `src/main.js`: Auto-detection of server query parameter and integration with WS adapter.
  - `src/ui/social_hud.js`: HUD connection indicator and invite URL handling.
  - `test/run_tests.py`: Registration of microserver test cases.
  - `README.md`: Clear instructions for hosting a park via `python3 server/host.py`.
