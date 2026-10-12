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
  - 12 authentic Victorian cast-iron streetlamps with warm incandescent lighting cores (`#fef08a`, `glowRadius: 120px`).
  - Active canine waste pile registry (`this.poopPiles`) and nearest-bin spatial queries (`getNearestBin(x, y)`).
  - Ambient particle system: floating dandelion seeds/pollen and wind streaks.
- **Camera Viewport**:
  - Smooth exponential damping tracking (`Camera.follow`) centered on the player and clamped to 3200 × 2400 boundaries.
- **Y-Sorted Depth Renderer**:
  - Collects all scenery objects (trees, benches, bins, streetlamps, rocks, water tower), ambient NPCs, dynamic entities (owners, dogs, tennis balls), and terrain waste piles.
  - Sorts by base Y coordinate (`depthY`) so entities and scenery overlap with natural 2D depth.
- **Atmospheric Environment & Diurnal Lighting Pass (`src/world/environment.js`)**:
  - Full-screen real-time lighting pass based on local Bristol / Europe/London time:
    - *Dawn* (`05:00–07:00`): Soft lavender-rose ambient wash.
    - *Day* (`07:00–17:00`): Crisp, bright daylight sunlight wash.
    - *Golden Hour* (`17:00–19:30`): Rich sepia-tinted amber twilight gradient.
    - *Dusk* (`19:30–21:30`): Atmospheric indigo shadow.
    - *Night* (`21:30–05:00`): Deep charcoal/navy shadow mask (`destination-out`) punctured by radial illumination halos around streetlamps, the Water Tower beacon, and walking players.
  - Weather particle overlay system (angled rain streaks, ground splash ripples, mist specks, undulating horizontal fog sheets, and sun-glint dust motes).

---

## 3. Entities, Canine Companion & Ambient Life
- **Owner Avatar (`src/entities/owner.js`)**:
  - 8-directional movement (<kbd>WASD</kbd> / touch joystick) with acceleration and deceleration.
  - Expressive 2D top-down / soft isometric vector rendering with directional facial cues, natural walking leg oscillation, dual-tone shoes, torso jacket with collar lapels, and arm swing.
  - Customizable hairstyles (`SHORT`, `WAVY`, `PONYTAIL`, `BEANIE`) with layered rear plumes and forehead bangs.
  - Diverse palette tokens for skin tones, hair colors, jacket colors, pants colors, and player names.
  - Clean baseline player naming: default name is `"Walker"` with local avatar nametag dynamically displaying `"${this.name} (You)"` in yellow (`#fde047`), while remote avatars display `"${this.name}"` in white (`#f8fafc`).
  - Glassmorphic tabbed customizer modal (👤 Walker, 🐕 Dog Companion) with `localStorage` profile persistence and full multiplayer handshake synchronization.
  - Waste collection state (`hasPoopBag`): displays bag icon and routes player to nearest dog-waste bin.
  - Speech bubble and emote rendering above avatar heads.
- **Companion Dog (`src/entities/companion_dog.js`)**:
  - 5 distinct canine breed coat presets:
    - Cocker Spaniel (Ziggy - Chocolate & Tan `#2E1A14`, `#D89B54` with honey eyebrow pips and white bib)
    - Golden Retriever (`#D4A373` honey gold with warm buff shading)
    - Black Lab (`#1E2022` sleek charcoal black with pale bib)
    - Jack Russell Terrier (`#F8FAFC` crisp white base with chestnut eye patches and ear markings)
    - Irish Red Setter (`#7C2D12` deep mahogany red with silky ear feathering)
  - Customizable collar colors (`teal`, `red`, `blue`, `gold`, `purple`) with a reflective metallic gold charm tag.
  - Canine Personality Engine (attributes 1–5):
    - *Playfulness*: Scales trot/sprint speeds, tail wag frequencies, and play-bow inclinations.
    - *Shyness*: Governs approach berthes and avoidance distances when passing other dogs or park pedestrians.
    - *Barkyness*: Controls vocalization frequencies, greeting barks, and reactions to joggers.
    - *Obedience*: Scales leash responsiveness, heel arrival deadband, and idle stray run-off probability.
  - Overhauled Leash Dynamics:
    - When leashed, dog strictly respects max 105px lead length and never breaks into ball fetching; looks towards thrown balls with eager pull and renders lead taut under tension.
  - Multi-state steering AI (`FOLLOWING`, `ROAMING`, `SOCIAL_GREET`, `PLAY_BOW`, `IDLE_SNIFF`, `SITTING`, `FETCHING`, `BARKING`, `RECALLED`, `LOST`, `POOPING`):
    - *Idle Stray Run-Off Engine*: Standing still without whistling for >35s triggers a stray roll inversely weighted by obedience (50% down to 1%). When triggered, dog sprints to a secluded park spot, enters `DogState.LOST`, and activates the HUD compass arrow. Approaching within 55px or whistling recalls the dog.
    - *Poop Lifecycle*: Periodic event while walking (~150–240s); dog pauses in squatted posture (`DogState.POOPING`) and spawns a depth-sorted `PoopPile` entity on the turf.
    - *Canine Social Greetings*: Detects other dogs within 110px, initiating mutual sniffing greetings, circular orbits, rapid tail wagging, and play-bows.
    - *Whistle Recall & Timed Heel*: Whistle command triggers immediate sprint recall back to the owner (`290 px/s`), locking into close heel following for 10 seconds.
- **Park Dog Waste & Bins (`src/entities/waste.js`, `src/world/field.js`)**:
  - `PoopPile` entities render with organic layered coils and a proximity interaction pulse.
  - Contextual interaction (<kbd>E</kbd> / touch tap): walking near waste (<38px) collects it in a poop bag and points the compass arrow to the nearest park bin.
  - Walking to a dog bin (<42px) with a waste bag prompts disposal, clears the bag, plays a chime, and removes the navigation arrow.
- **Directional Navigation Compass Arrow (`src/ui/navigation_arrow.js`)**:
  - Reusable glassmorphic HUD indicator clamped to viewport margin perimeter.
  - Smooth outward chevron rotation along bearing angle, pulse animation, dynamic emojis (`🐕` for lost dog, `🗑️` for nearest bin), and distance badge in meters (`dist / 20`).
- **Park NPCs: Autonomous Walkers & Joggers (`src/entities/npc.js`)**:
  - `WalkerNPC`: Strolls at leisure pace (~75–100 px/s) along park trail loops, pausing at teak benches and scenic overlooks.
  - `JoggerNPC`: Runs athletic laps (~240–280 px/s) continuously along Ladies Mile avenue and the park perimeter with rhythmic stride bobbing.
  - Mutual soft avoidance steering around players, dogs, and obstacles.
- **Tennis Ball Toy (`src/entities/toy.js`)**:
  - 2.5D ballistic trajectory with gravity (720 px/s²), ground shadow scaling, bounce restitution (0.62), and rolling friction.
  - Off-leash dogs detect thrown balls, sprint at 290 px/s, attach ball to mouth, and return it to the owner's feet.

---

## 4. Universal Networking & Social Architecture
- **Ad-Hoc Proximity Group Chat (`src/ui/proximity_chat.js`)**:
  - Clusters form dynamically when 2+ players walk within 200px of each other.
  - Prominent conversation interface displays active participants and chat thread.
  - Walking alongside keeps players continuously in the conversation thread.
  - Parting "Tombstone" Chat Markers (`src/entities/tombstone.js`): when players exit proximity and disband, the conversation drops as a fading tombstone marker on the turf that dissolves over 10 seconds.
- **Multi-Transport Network Engine (`src/net/network.js`, `src/net/protocol.js`, `src/net/ws_network.js`)**:
  - Transparent multi-mode polymorphic architecture:
    1. **Cloudflare PartyServer Edge Mode**: Native Cloudflare Workers + Durable Objects (`party/server.js`), connecting canonically via `/parties/parkserver/${roomId}`.
    2. **Dedicated WebSocket Microserver Mode**: Connects via native WebSockets (`ws://` or `wss://`) when launched via local server or `?server=...`.
    3. **WebRTC P2P Fallback Mode**: Gracefully falls back to browser-to-browser PeerJS DataChannels if run without a server.
  - Packet protocol: `HELLO`, `WELCOME`, `SYNC_STATE` (synchronizing position, leash state, and canine personality), `BALL_THROWN`, `BALL_SYNC`, `BARK`, `PET`, `CHAT_MESSAGE`, `EMOTE`, `PEER_LEFT`, `WHISTLE`.
  - Edge relay server enforces authoritative `conn.id` stamping on all broadcasts.
  - State broadcasts at 16Hz; `EntityInterpolator` provides smooth exponential damping (lerp) at 60fps while propagating discrete states instantly.

---

## 5. Live Clifton Weather & Sensory Soundscape
- **Live Clifton Downs Weather Client (`src/systems/weather.js`)**:
  - Queries Open-Meteo API for real-time Clifton coordinates (`51.464, -2.628`).
  - Translates WMO weather codes into domain states (`CLEAR`, `OVERCAST`, `DRIZZLE`, `RAIN`, `FOG`).
  - Resilient offline fallback using pseudo-seeded diurnal heuristics when network is unavailable.
- **Procedural Nature Soundscape (`src/systems/audio.js`)**:
  - Dual-filter low-pass pink noise with 0.1 Hz LFO for canopy wind.
  - Multi-species authentic British birdsong synthesizer (Blackbird piping, European Robin trills, Woodpigeon cooing), diurnally modulated and suppressed during heavy rain or night.
  - Procedural rain synthesis: dual-filter pink noise graph modulated dynamically by precipitation type (`DRIZZLE`, `RAIN`).
  - Squall effects: low-frequency procedural thunder rumbles and modulated wind gusts.
  - Formant-filtered canine barks, footsteps, and acoustic training whistle chirp.

---

## 6. Mobile Ergonomics & Responsive Touch Architecture
- **Virtual Touch Controller (`src/ui/touch_controls.js`)**:
  - Virtual analog joystick with dynamic thumb tracking, 10% deadzone threshold, 50px maximum deflection clamp, and normalized `(vx, vy)` vector output.
  - Multi-touch isolation using explicit touch identifiers (`joystickTouchId`).
  - Glassmorphic touch action pad (Throw 🎾, Pet ❤️, Bark 🐕, Leash 🦮/🐕, Whistle 📯, Chat 💬, Pick up waste 🟤).
  - Direct canvas tap interactions: tap-to-throw tennis ball, tap-to-pet dog, tap-to-pickup poop pile, tap-to-dispose bin.
- **Mobile Viewport Constraints (`index.html`, `src/style.css`)**:
  - Viewport configured with `viewport-fit=cover, maximum-scale=1.0, user-scalable=no`, `touch-action: none`, and dynamic safe-area insets (`env(safe-area-inset-top)` / `bottom`).

---

## 7. Test Suite & CI/CD
- `python3 test/run_tests.py`: Comprehensive test runner executing 17 test suites covering:
  - Physics ballistics, arrival steering, leash clamping and off-lead rendering.
  - Real-time leash synchronization, entity interpolator discrete propagation, network packet schemas.
  - Dog personality scaling, obedience-weighted stray probability, leash pulling physics.
  - Directional navigation arrow bearing math, viewport ray-box clamping, target lifecycle.
  - Waste pile lifecycle, spatial bin querying, pickup/disposal interactions.
  - Ambient NPC waypoint traversal, athletic jogger pacing, soft steering avoidance.
  - Diurnal lighting calculation, Open-Meteo weather response decoding, particle overlays.
  - Microserver room routing, PartyServer contracts, viewport meta attributes, safe-area CSS rules.
- `.github/workflows/ci.yml`: Automated GitHub Actions pipeline running test suites on every push/PR with a 3-minute safety timeout, followed by auto-deploy to Cloudflare Workers on `main`.
