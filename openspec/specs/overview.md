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
    1. **Cloudflare PartyServer Edge Mode**: Native Cloudflare Workers + Durable Objects (`party/server.js`), connecting canonically via `/parties/parkserver/${roomId}` with automatic aliasing for `/parties/park/` legacy paths. Scale-to-zero at $0 idle cost.
    2. **Dedicated WebSocket Microserver Mode**: Connects via native WebSockets (`ws://` or `wss://`) when launched via local server or when `?server=...` parameter is present.
    3. **WebRTC P2P Fallback Mode**: Gracefully falls back to browser-to-browser PeerJS DataChannels if run without a server.
  - **The Always-Open Public Commons**:
    - Default room is `the-commons`. Anyone loading the site enters the same active park instance.
    - `getShareUrl()` returns the clean base domain (`https://<domain>/`).
    - Optional private rooms supported via `?room=<custom-code>`.
  - **Packet Protocol Parity & Authoritative Stamping**:
    - Uniform packet schemas: `HELLO`, `WELCOME`, `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, `EMOTE`, `PEER_LEFT`.
    - Edge relay server enforces authoritative `conn.id` stamping on all broadcasts (`data.senderId = conn.id`).
    - Client automatically re-dispatches `HELLO` profile handshake upon receiving `WELCOME` with assigned `peerId`, ensuring remote peers register player appearance matching 16Hz `SYNC_STATE` updates.
  - **Host Relaying & Synchronization**:
    - Synchronizes authoritative ball physics.
    - State broadcasts at 16Hz; `EntityInterpolator` provides smooth exponential damping (lerp) for remote positions at 60fps.
  - **Offline / Solo Mode**: Operates seamlessly in singleplayer sandbox mode when disconnected.

---

## 5. Edge Server & Local Microserver
- **Cloudflare PartyServer Room Relay (`party/server.js`, `wrangler.jsonc`)**:
  - Implements `ParkServer` inheriting from `Server` in `partyserver`.
  - In Worker `fetch`, aliases `env.park = env.ParkServer` and `env.parkserver = env.ParkServer` with defensive `try...catch` crash guard, eliminating Cloudflare Error 1101 exceptions.
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
  - Live status-driven diagnostic badge: green `🌳 Clifton Commons` (or purple `🔒 Meadow`) when connected, amber `⏳ Connecting...` / `🔄 Reconnecting...`, and slate gray `Solo (Offline)` on disconnect.
  - Player count badge and "Share Park" button with toast confirmation.
  - Style customizer modal and quick chat bar (<kbd>Enter</kbd>) with emote buttons (👋, 🐾, ❤️, 🎾).

---

## 7. Mobile Ergonomics & Responsive Touch Architecture
- **Virtual Touch Controller (`src/ui/touch_controls.js`)**:
  - Virtual analog joystick with dynamic thumb tracking, 10% deadzone threshold, 50px maximum deflection clamp, and normalized `(vx, vy)` vector output for fluid 360° locomotion.
  - Multi-touch isolation using explicit touch identifiers (`joystickTouchId`) ensuring left-thumb steering does not conflict with right-hand button taps or meadow interactions.
  - Glassmorphic touch action pad (Throw 🎾, Leash 🦮, Bark 🐕, Pet ❤️, Chat 💬) with haptic feedback support (`navigator.vibrate`).
  - Direct canvas tap-to-throw: tapping any point on the open field translates screen coordinates to world coordinates via `Camera.screenToWorld` and throws the tennis ball with distance-proportional speed.
  - Direct canvas tap-to-pet: tapping near the companion dog triggers affectionate petting.
- **Mobile Viewport & Safe-Area Constraints (`index.html`, `src/style.css`)**:
  - Viewport configured with `viewport-fit=cover, maximum-scale=1.0, user-scalable=no` and full-screen mobile web app capability tags.
  - Canvas and container lock `touch-action: none` to eliminate accidental browser pinch-zoom, double-tap zoom delay, and rubber-band pull-to-refresh.
  - Notched phone and dynamic island safe areas respected via `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
  - Dynamic viewport height handled with `height: 100dvh` and visual viewport resize events.
- **Touch Audio Auto-Unlock (`src/systems/audio.js`, `src/main.js`)**:
  - Complies with iOS Safari and Android Chrome autoplay restrictions by unlocking and resuming Web Audio `AudioContext` on initial `touchstart` or `pointerdown`.
- **Responsive UI Adaptation (`src/ui/social_hud.js`)**:
  - Automatically hides desktop `<kbd>` controls guidance on touch/mobile devices while keeping desktop experience untouched.

---

## 8. Test Suite & CI/CD
- `python3 test/run_tests.py`: Comprehensive test runner covering physics ballistics, arrival steering, leash clamping, network packet schemas, microserver room routing, PartyServer contracts, viewport meta attributes, safe-area CSS rules, bounded camera projection math, and joystick analog vector normalization.
- `.github/workflows/ci.yml`: Automated GitHub Actions pipeline running test suites on every push/PR with a 3-minute safety timeout, followed by auto-deploy to Cloudflare Workers on `main`.
