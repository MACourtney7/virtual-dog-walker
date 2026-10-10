# Canonical System Specification: Clifton Down Social Sandbox

## 1. System Overview
**Clifton Down: Social Dog Walking Sandbox** is a relaxing, charming multiplayer sandbox built entirely in the browser using HTML5 Canvas 2D, Vanilla ES6 JavaScript, the Web Audio API, and pure in-browser WebRTC Peer-to-Peer networking (PeerJS). 

Players inhabit the meadow as an **Owner** and **Dog companion** walking together across an expansive, sunlit open park space inspired by **Clifton Down** in Bristol, UK. Anyone can host a field in their browser, copy a shareable room link, and have other players join with zero server installation or external dependencies.

---

## 2. World & Rendering Architecture
- **Continuous Meadow (`src/world/field.js`)**:
  - 2600 × 1900 px coordinate space featuring lush layered grass tones (`#437332`, `#375e28`, `#538c3e`), curved gravel walking trails, and clustered wildflower beds (buttercups, white clover, bluebells).
  - 17 mature English oak and sweet chestnut trees with soft drop shadows, circular trunk collision bounds, and layered foliage canopies.
  - 8 wooden teak park benches with collision boundaries.
  - Stone perimeter boundary walls and iron corner pillars.
  - Ambient particle system: floating dandelion seeds/pollen and wind streaks.
- **Camera Viewport**:
  - Smooth exponential damping tracking (`Camera.follow`) centered on the player and clamped to world boundaries.
- **Y-Sorted Depth Renderer**:
  - Collects all scenery objects (trees, benches) and dynamic entities (owners, dogs, tennis balls).
  - Sorts by base Y coordinate (`depthY`) so entities and scenery overlap with natural 2D depth.

---

## 3. Entities & Canine Companion Mechanics
- **Owner Avatar (`src/entities/owner.js`)**:
  - 8-directional keyboard movement (<kbd>WASD</kbd> / <kbd>Arrow keys</kbd>) with acceleration and deceleration.
  - Animated walk cycles (foot swing and arm sway).
  - Real-time customizer: customizable jacket colors, pants, hair colors, skin tones, and player names.
  - Speech bubble and emote rendering above avatar heads.
- **Companion Dog (`src/entities/companion_dog.js`)**:
  - Authentic Cocker Spaniel model featuring chocolate & tan coat (`#2E1A14`, `#D89B54`), honey-tan eyebrow pips, white chest bib, and teal collar with gold charm.
  - Presets for Golden Retriever and Black Lab coats.
  - Multi-state steering AI (`FOLLOWING`, `IDLE_SNIFF`, `SITTING`, `FETCHING`, `PLAY_BOW`, `BARKING`):
    - *Arrival Steering*: Smoothly decelerates as it approaches the owner.
    - *Leash Dynamics*: Loose red nylon catenary lead; clamps distance to max 105px when leashed.
    - *Floppy Ear Springs*: Secondary spring-damper inertia rotation responding to trot speed.
    - *Tail Wagging*: Speed-dependent oscillation increasing during joy, fetching, or greetings.
    - *Social Play-Bow*: Lowers chest and raises tail in a play-bow when within 60px of another dog.
    - *Bark Pulse*: Expanding sonic rings with procedural audio and "Woof!" bubble.
    - *Petting*: Heart particles emitter upon interaction.
- **Tennis Ball Toy (`src/entities/toy.js`)**:
  - 2.5D ballistic trajectory with gravity (720 px/s²), ground shadow scaling, bounce restitution (0.62), and rolling friction.
  - Dogs detect thrown balls, sprint at 290 px/s, attach ball to mouth, and return it to the owner's feet.

---

## 4. Universal Networking Architecture
- **Multi-Transport Network Engine (`src/net/network.js`, `src/net/protocol.js`, `src/net/ws_network.js`)**:
  - Transparent dual-mode architecture:
    1. **Dedicated WebSocket Microserver Mode**: Automatically connects via native WebSockets (`ws://` or `wss://`) when launched via server or when `?server=...` parameter is present.
    2. **WebRTC P2P Fallback Mode**: Gracefully falls back to browser-to-browser PeerJS DataChannels if run without a server.
  - **Packet Protocol Parity**:
    - Uniform packet schemas: `HELLO`, `WELCOME`, `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, `EMOTE`, `PEER_LEFT`.
  - **Host Relaying & Synchronization**:
    - Host synchronizes authoritative ball physics.
    - State broadcasts at 16Hz; `EntityInterpolator` provides smooth exponential damping (lerp) for remote positions at 60fps.
  - **Offline / Solo Mode**: Operates seamlessly in singleplayer sandbox mode when disconnected.

---

## 5. Dedicated Microserver & Zero-Port Tunneling (`server/`)
- **Asynchronous Python Microserver (`server/server.py`)**:
  - Handles concurrent isolated rooms (`room_id`), serves static HTML/JS assets on `http://127.0.0.1:8080`, and multiplexes WebSocket game events between peers.
  - Active heartbeat pinging (15s) and automatic cleanup of disconnected players and empty rooms.
- **Zero-Port Public Tunnel Manager (`server/host.py`, `server/tunnel.py`)**:
  - Automatically provisions Cloudflare Quick Tunnels (`https://<subdomain>.trycloudflare.com`) without router port-forwarding.
  - Generates instant 1-click shareable URLs for remote players.

---

## 6. Sensory & Audio Polish
- **Procedural Nature Soundscape (`src/systems/audio.js`)**:
  - Pink-noise filtered low-pass breeze for tree canopy wind.
  - Intermittent procedural birdsong chirps.
  - Soft procedural grass footstep rustles during movement.
  - Formant-filtered canine barks and ball bounce pops.
- **Social HUD Overlay (`src/ui/social_hud.js`)**:
  - Glassmorphic top bar displaying connection badge, room ID, player count, and "Share Park" button with toast confirmation.
  - Style customizer modal and quick chat bar (<kbd>Enter</kbd>) with emote buttons (👋, 🐾, ❤️, 🎾).

---

## 7. Test Suite
- `python3 test/run_tests.py`: Comprehensive test runner covering physics ballistics, arrival steering, leash clamping, network packet schemas, microserver room routing, and tunnel configuration.

