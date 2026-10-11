# Canonical System Specification: The Downs Social Sandbox

## 1. System Overview
**Virtual Dog Walker (The Downs)** is a relaxing, charming multiplayer sandbox built entirely in the browser using HTML5 Canvas 2D, Vanilla ES6 JavaScript, the Web Audio API, Cloudflare PartyServer with Durable Objects, and dedicated local microserver fallback.

Players inhabit the meadow as an **Owner** and **Dog companion** walking together across an expansive, sunlit open park space inspired by **The Downs** (Clifton & Durdham Downs) in Bristol, UK. Anyone can open the park in their browser and immediately walk alongside other online players in **The Commons** with zero room codes or server setup required.

---

## 2. World & Rendering Architecture
- **The Downs Parkland (`src/world/field.js`)**:
  - Expansive 3200 × 2400 px coordinate space featuring authentic Bristol Downs geography:
    - **Ladies Mile Avenue**: Diagonal Cotswold gravel boulevard with sweet chestnut and lime tree borders.
    - **Sea Walls & Avon Gorge Viewpoints**: Western cliff rim with limestone outcrops, stone parapet wall with wrought iron railings, and panoramic teak benches.
    - **Durdham Down Grasslands & Water Tower**: Wide open northern greens with subtle mown lawn striping and Victorian stone Water Tower landmark pavilion (`x: 2400, y: 450`).
    - **Clifton Down Woodland Copse**: Southern sweet chestnut and oak groves with curving woodland dirt footpaths.
  - Multi-tone procedural turf palette (`#3e6b2c`, `#335824`, `#4c8237`), grass blade flecks, and wildflower meadows (buttercups, white clover, bluebells).
  - 8 public park dog-waste bins strategically placed at path intersections and overlooks with collision resolution and depth-sorted rendering.
  - Ambient particle system: floating dandelion seeds/pollen and wind streaks.
- **Camera Viewport**:
  - Smooth exponential damping tracking (`Camera.follow`) centered on the player and clamped to 3200 × 2400 boundaries.
- **Y-Sorted Depth Renderer**:
  - Collects all scenery objects (trees, benches, bins, rocks, water tower) and dynamic entities (owners, dogs, tennis balls).
  - Sorts by base Y coordinate (`depthY`) so entities and scenery overlap with natural 2D depth.

---

## 3. Entities & Canine Companion Mechanics
- **Owner Avatar (`src/entities/owner.js`)**:
  - 8-directional movement (<kbd>WASD</kbd> / touch joystick) with acceleration and deceleration.
  - Expressive 2D top-down / soft isometric vector rendering with directional facial cues, natural walking leg oscillation, dual-tone shoes, torso jacket with collar lapels, and arm swing.
  - Customizable hairstyles (`SHORT`, `WAVY`, `PONYTAIL`, `BEANIE`) with layered rear plumes and forehead bangs.
  - Diverse palette tokens for skin tones, hair colors, jacket colors, pants colors, and player names.
  - Clean baseline player naming: default name is `"Walker"` with local avatar nametag dynamically displaying `"${this.name} (You)"` in yellow (`#fde047`), while remote avatars display `"${this.name}"` in white (`#f8fafc`).
  - Glassmorphic tabbed customizer modal with `localStorage` profile persistence and full multiplayer handshake synchronization.
  - Speech bubble and emote rendering above avatar heads.
- **Companion Dog (`src/entities/companion_dog.js`)**:
  - 5 distinct canine breed coat presets:
    - Cocker Spaniel (Ziggy - Chocolate & Tan `#2E1A14`, `#D89B54` with honey eyebrow pips and white bib)
    - Golden Retriever (`#D4A373` honey gold with warm buff shading)
    - Black Lab (`#1E2022` sleek charcoal black with pale bib)
    - Jack Russell Terrier (`#F8FAFC` crisp white base with chestnut eye patches and ear markings)
    - Irish Red Setter (`#7C2D12` deep mahogany red with silky ear feathering)
  - Customizable collar colors (`teal`, `red`, `blue`, `gold`, `purple`) with a reflective metallic gold charm tag.
  - Expressive canine snout catchlights, whisker dots, and catchlight iris rings.
  - Floppy ear spring damper physics responding to trot speed inertia and lateral lag.
  - Multi-state steering AI (`FOLLOWING`, `ROAMING`, `SOCIAL_GREET`, `PLAY_BOW`, `IDLE_SNIFF`, `SITTING`, `FETCHING`, `BARKING`, `RECALLED`):
    - *On-Leash Close Heel*: Trots closely at the owner's side/heel (~38–48px) with natural slack, matching owner speed and decelerating smoothly.
    - *Bounded Off-Leash Roaming*: When off-leash, explores and sniffs turf autonomously while remaining organically bounded to the human (150px return bias, 200px return trot, 230px outer perimeter clamp).
    - *Canine Social Greetings*: Detects other dogs within 110px, initiating mutual snout/butt sniffing greetings, circular orbits, rapid tail wagging, emote bubbles (`🐾`, `🐶`, `❤️`), and playful play-bows (`PLAY_BOW`).
    - *Whistle Recall & Timed Heel*: Whistle command triggers immediate sprint recall back to the owner (`290 px/s`), locking into close heel following for 10 seconds before returning to roaming.
    - *Leash Dynamics*: Loose red nylon catenary lead; clamps distance to max 105px when leashed.
    - *Floppy Ear Springs*: Secondary spring-damper inertia rotation responding to trot speed.
    - *Tail Wagging*: Speed-dependent oscillation increasing during joy, fetching, or greetings.
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
  - **Packet Protocol Parity, Stateful Peer Registry & Bidirectional Handshake**:
    - Uniform packet schemas: `HELLO`, `WELCOME`, `SYNC_STATE`, `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, `EMOTE`, `PEER_LEFT`, `WHISTLE`.
    - Edge relay server enforces authoritative `conn.id` stamping on all broadcasts (`data.senderId = conn.id`).
    - Server maintains active peer registry (`this.peers`) and transmits rich peer styling records (`{ id, name, jacketColor, coatName }`) in `WELCOME.peers`.
    - Existing peers reply with bidirectional `HELLO` greetings when a new player arrives, ensuring zero placeholder fallbacks.
    - Render loop dynamically synchronizes remote avatar styling from incoming peer metadata in real time.
    - State broadcasts at 16Hz; `EntityInterpolator` provides smooth exponential damping (lerp) for remote positions at 60fps, while immediately propagating discrete non-spatial properties (`isLeashed`, `isMoving`, and dog behavior `state`).
    - Leash toggle (<kbd>L</kbd> or touch button) broadcasts `SYNC_STATE` instantaneously for zero-latency removal or re-drawing of the red catenary lead across all connected peers.
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
  - Dual-filter low-pass pink noise with 0.1 Hz LFO sweeping cutoff between 260 Hz and 440 Hz for organic breathing canopy wind.
  - Multi-species authentic British birdsong synthesizer:
    - Melodic flute-like Blackbird piping (`playBlackbird()`, 1800–2600 Hz motifs).
    - Crystalline European Robin trills (`playRobin()`, 3200–4200 Hz with vibrato).
    - Warm rhythmic Woodpigeon cooing (`playWoodpigeon()`, 380–420 Hz pulses).
  - Soft procedural grass footstep rustles during movement.
  - Formant-filtered canine barks and ball bounce pops.
  - Dual-oscillator acoustic dog training whistle chirp (`playWhistle`) with 17Hz vibrato warble.
- **Social HUD Overlay (`src/ui/social_hud.js`)**:
  - Live status-driven diagnostic badge: green `🌳 The Downs` (or purple `🔒 Meadow`) when connected, amber `⏳ Connecting...` / `🔄 Reconnecting...`, and slate gray `Solo (Offline)` on disconnect.
  - Player count badge and "Share Park" button with toast confirmation.
  - Style customizer modal and quick chat bar (<kbd>Enter</kbd>) with emote buttons (👋, 🐾, ❤️, 🎾).
  - Controls legend including <kbd>WASD</kbd> walk, <kbd>Space</kbd> throw, <kbd>L</kbd> leash, <kbd>B</kbd> bark, <kbd>E</kbd> pet, <kbd>H</kbd> whistle.

---

## 7. Mobile Ergonomics & Responsive Touch Architecture
- **Virtual Touch Controller (`src/ui/touch_controls.js`)**:
  - Virtual analog joystick with dynamic thumb tracking, 10% deadzone threshold, 50px maximum deflection clamp, and normalized `(vx, vy)` vector output for fluid 360° locomotion.
  - Multi-touch isolation using explicit touch identifiers (`joystickTouchId`) ensuring left-thumb steering does not conflict with right-hand button taps or meadow interactions.
  - Glassmorphic touch action pad (Throw 🎾, Pet ❤️, Bark 🐕, Leash 🦮/🐕, Whistle 📯, Chat 💬) with haptic feedback support (`navigator.vibrate`) and dynamic visual state toggling for active vs off-lead status.
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
- `python3 test/run_tests.py`: Comprehensive test runner covering physics ballistics, arrival steering, leash clamping and off-lead rendering, real-time leash state synchronization, entity interpolator discrete property propagation, network packet schemas, microserver room routing, PartyServer contracts, viewport meta attributes, safe-area CSS rules, bounded camera projection math, and joystick analog vector normalization.
- `.github/workflows/ci.yml`: Automated GitHub Actions pipeline running test suites on every push/PR with a 3-minute safety timeout, followed by auto-deploy to Cloudflare Workers on `main`.
