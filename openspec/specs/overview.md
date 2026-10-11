# Canonical System Specification: Clifton Down Social Sandbox

## 1. System Overview
**Virtual Dog Walker (Clifton Down)** is a relaxing, charming multiplayer sandbox built entirely in the browser using HTML5 Canvas 2D, Vanilla ES6 JavaScript, the Web Audio API, Cloudflare PartyServer with Durable Objects, and dedicated local microserver fallback.

Players inhabit the meadow as an **Owner** and **Dog companion** walking together across an expansive, sunlit open park space inspired by **Clifton Down** in Bristol, UK. Anyone can open the park in their browser and immediately walk alongside other online players in **The Commons** with zero room codes or server setup required.

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
  - Transparent multi-mode polymorphic architecture:
    1. **Cloudflare PartyServer Edge Mode**: Native Cloudflare Workers + Durable Objects (`party/server.js`), defaulting universally to **The Commons** (`the-commons`). Scale-to-zero at $0 idle cost.
    2. **Dedicated WebSocket Microserver Mode**: Connects via native WebSockets (`ws://` or `wss://`) when launched via local server or when `?server=...` parameter is present.
    3. **WebRTC P2P Fallback Mode**: Gracefully falls back to browser-to-browser PeerJS DataChannels if run without a server.
  - **The Always-Open Public Commons**:
    - Default room is `the-commons`. Anyone loading the site enters the same active park instance.
    - `getShareUrl()` returns the clean base domain (`https://<domain>/`).
    - Optional private rooms supported via `?room=<custom-code>`.
  - **Packet Protocol Parity**:
    - Uniform packet schemas: `HELLO`, `WELCOME`, `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, `EMOTE`, `PEER_LEFT`.
  - **Host Relaying & Synchronization**:
    - Synchronizes authoritative ball physics.
    - State broadcasts at 16Hz; `EntityInterpolator` provides smooth exponential damping (lerp) for remote positions at 60fps.
  - **Offline / Solo Mode**: Operates seamlessly in singleplayer sandbox mode when disconnected.

---

## 5. Edge Server & Local Microserver
- **Cloudflare PartyServer Room Relay (`party/server.js`, `wrangler.jsonc`)**:
  - Implements `ParkServer` inheriting from `Server` in `partyserver`.
  - Ephemeral serverless Durable Object actors managing player handshakes (`WELCOME`), high-throughput state broadcasts, barking, tennis ball fetch, and disconnect cleanup.
  - Serves static HTML/JS frontend assets and WSS endpoints under a single unified Cloudflare Worker URL.
  - Automatic deployment via GitHub Actions CI/CD to Cloudflare Workers at $0 cost.
- **Dedicated Local Python Microserver (`server/server.py`, `server/host.py`)**:
  - Alternative local async WebSocket and HTTP static file server.
  - Automatically provisions Cloudflare Quick Tunnels (`https://<subdomain>.trycloudflare.com`) for private self-hosted multiplayer.

---

## 6. Sensory & Audio Polish
- **Procedural Nature Soundscape (`src/systems/audio.js`)**:
  - Pink-noise filtered low-pass breeze for tree canopy wind.
  - Intermittent procedural birdsong chirps.
  - Soft procedural grass footstep rustles during movement.
  - Formant-filtered canine barks and ball bounce pops.
- **Social HUD Overlay (`src/ui/social_hud.js`)**:
  - Glassmorphic top bar displaying `🌳 Clifton Commons` badge (or `🔒 Meadow` for private rooms), player count, and "Share Park" button with toast confirmation.
  - Style customizer modal and quick chat bar (<kbd>Enter</kbd>) with emote buttons (👋, 🐾, ❤️, 🎾).

---

## 7. Test Suite & CI/CD
- `python3 test/run_tests.py`: Comprehensive test runner covering physics ballistics, arrival steering, leash clamping, network packet schemas, microserver room routing, and PartyServer contracts.
- `.github/workflows/ci.yml`: Automated GitHub Actions pipeline running test suites on every push/PR with a 3-minute safety timeout, followed by auto-deploy to Cloudflare Workers on `main`.
