# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-002"
title: "Clifton Down Social Sandbox: Multiplayer Dog Walking Field"
state: "PLANNING"
created_at: "2026-10-10T21:10:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-002/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Objective
Pivot the game from a 2D side-scrolling platformer into a relaxing, charming **social multiplayer sandbox** set in an expansive, sun-dappled open field inspired by **Clifton Down** (Bristol, UK). 

Players inhabit the park as an **Owner and Dog companion** walking together across rolling green turf, sweet chestnut/oak trees, wildflower patches, and park benches. Players can self-host or create rooms entirely within the browser via WebRTC (or via a lightweight standalone Node.js WebSocket server) allowing others to join with their dogs. Features include companion following physics, ball/stick fetching, dog-to-dog greeting/sniffing interactions, barking, leash toggling, and in-game speech/emote bubbles.

---

## 2. Character Design & Visual Setting (Clifton Down)
- **Environment Aesthetic**:
  - **The Meadow**: Rolling lush green grass (`#4A7C38`, `#5E9E47`, `#3B632D`) with subtle wind-sway grass blade particles, dirt footpaths, and wildflower clusters (buttercups `#F3C948`, clover `#FFFFFF`, bluebells `#6B8BE8`).
  - **Landmarks & Features**: Mature sweet chestnut and English oak trees casting soft canopy shadows, wooden park benches, and a distant panoramic vista inspired by the Avon Gorge & Clifton Observatory.
  - **Atmosphere & Day/Dusk Lighting**: Warm golden hour sunlight, soft dynamic shadows, floating pollen/dandelion seeds, and procedurally synthesized ambient nature audio (wind through leaves, birdsong, grass footsteps).
- **Owner & Dog Entities**:
  - **Owner**: Stylized top-down human avatar with customizable jacket/sweater color, walking animation cycles, and directional facing (8-way).
  - **Dog Companion (Ziggy & Friends)**:
    - Retains Ziggy's signature **chocolate & tan** cocker spaniel coat (`#2E1A14`, `#D89B54`), honey eyebrow pips, white chest bib, and springy floppy ear physics from Ticket-001.
    - Customizable coat options for visitors (Golden, Black, Tri-Color, Liver).
    - Canine steering behaviors: trot beside owner, wander to sniff interesting trees/grass patches, wagging tail physics, play-bow animation when greeting other dogs, and sitting when owner rests.

---

## 3. Scope Boundaries
- **In-Scope**:
  - **Sandbox World & Top-Down Engine**:
    - Expansive 2D top-down continuous canvas meadow (e.g. 2400x1800 px coordinate space) with camera tracking the local player.
    - Y-sorted depth rendering (players, dogs, trees, and benches correctly layer as entities walk in front of or behind objects).
    - Boundary collision (park perimeter stonewalls/railings and solid tree trunks).
  - **Companion Dog & Player Mechanics**:
    - Dual entity control: Keyboard-focused navigation via WASD or Arrow keys.
    - Dog autonomous companion steering: follows owner naturally, stays within comfortable leash distance, stops to sniff, or explores off-leash.
    - Leash Toggle (`L` key): switch between loose lead (stays within 80px) and off-lead roaming (runs freely, plays with others).
    - Ball Fetching (`Space` or `T` key): throw a tennis ball ahead in facing direction; dogs track the ball, sprint to catch it, and happily bring it back.
    - Bark Ability (`B` key): emit procedural canine bark sound with expanding sound-ring and "Woof!" emote bubble.
    - Petting Interaction (`E` key): bend down to pet the dog with heart particle FX and happy tail-wag burst.
  - **Multiplayer Networking (Pure In-Browser WebRTC P2P)**:
    - **Zero-Server Browser-to-Browser P2P (WebRTC via PeerJS DataChannels)**: Host clicks "Host Field" to generate a shareable room link or short code (e.g. `?room=clifton-xyz`); visitors paste or open the link to join the host's field instantly with zero backend or server installation.
    - State synchronization: player position, facing, dog position, animation state, ball physics, bark events, and chat bubbles.
    - Local fallback: works 100% offline in Solo Mode if no network is active.
  - **Social Interactions**:
    - Proximity dog-to-dog greeting: when two dogs meet within 60px, they trigger a friendly sniff and excited tail-wag interaction.
    - Speech & Emote bubbles (`Enter` to type chat or click emote buttons like 👋, 🐾, ❤️, 🎾).
    - Player name tags and custom coat/outfit picker.
  - **Audio & Sensory Polish**:
    - Web Audio API procedural soundscape: birds, rustling breeze, grass footstep sounds, authentic cocker spaniel barks, ball bounce pops.
- **Out-of-Scope**:
  - Complex combat, health bars, or fail states (pure peaceful social sandbox).
  - External server hosting or persistent account databases (pure ephemeral peer-to-peer browser rooms).
  - 3D rendering engine (maintains lightweight, instant-loading 2D HTML5 canvas).

---

## 4. Requirements & Acceptance Criteria
- [x] **REQ-1: Top-Down Open Field Engine & Clifton Down Meadow**
  - Smooth 2D canvas viewport with camera tracking local player across an expansive park.
  - Y-sorted entity rendering for trees, benches, owners, dogs, and tennis balls.
  - Ambient grass blade particles and wind breeze effects.
  - *Verification*: 60 FPS rendering, correct depth sorting when walking above/below trees and benches.
- [x] **REQ-2: Owner & Companion Dog Physics (Keyboard Focused)**
  - 8-directional movement for Owner avatar with walk animations via WASD / Arrow keys.
  - Natural steering behavior for Dog companion (following, loose leash constraint, wandering, sitting, play-bowing).
  - Keyboard actions: Leash toggle (`L`), Ball throw (`Space`/`T`), Petting (`E`), and Barking (`B`).
  - Tennis ball trajectory with bounce physics and canine retrieval behavior.
  - *Verification*: Unit tests for companion steering vectors, leash constraints, and ball trajectory.
- [x] **REQ-3: Pure In-Browser WebRTC Peer-to-Peer Multiplayer**
  - Host generates room; shareable URL / room code.
  - Remote peers connect over WebRTC DataChannel (PeerJS).
  - Low-latency position interpolation (lerp) for remote owners and dogs.
  - Host authoritative ball physics and player join/leave sync.
  - *Verification*: Two browser tabs connect via room link, walk together in the field, see each other's dogs, and throw/fetch balls simultaneously.
- [x] **REQ-4: Social Sandbox Interactions & Chat/Emotes**
  - In-game chat and emote bubbles floating above avatars (`Enter` to trigger).
  - Dog-to-dog proximity greeting reaction (sniff, tail wag, friendly bounce).
  - Dog & Owner customization modal (name, jacket color, dog coat color: chocolate & tan, golden, black).
  - *Verification*: Chat messages appear correctly over avatar heads in both host and client views.
- [x] **REQ-5: Procedural Soundscape & Polished HUD**
  - Ambient park audio (breeze, birdsong, grass footsteps, barks) via Web Audio API.
  - Minimalist glassmorphic park HUD showing room code, copy link button, player count, and controls guide.
  - *Verification*: Audio activates cleanly upon interaction; HUD buttons respond with smooth feedback.

---

## 5. Architectural Design & Impacted Modules
- **New Modules / Files**:
  - `src/world/field.js`: Clifton Down continuous terrain, rolling turf, trees, benches, perimeter boundaries, and grass particle systems.
  - `src/entities/owner.js`: Human player avatar, 8-way movement, walk cycle rendering, outfit customization.
  - `src/entities/companion_dog.js`: Top-down canine companion entity, steering physics, leash dynamics, ear & tail wag animations.
  - `src/entities/toy.js`: Tennis ball physics, bouncing, and fetch target tracking.
  - `src/net/network.js`: WebRTC peer-to-peer room manager (PeerJS DataChannel protocol, room code generation, message serialization).
  - `src/ui/social_hud.js`: Room code display, invite link copier, chat/emote bubbles, and character customizer.
  - `test/steering.test.js`: Companion dog steering behavior and leash distance tests.
  - `test/network.test.js`: Serialization and packet schema verification.
- **Modified Modules**:
  - `index.html`: Update title, viewport, HUD overlays, and social sandbox styling.
  - `src/main.js`: Main loop orchestrating sandbox field, player, companion dog, network, and audio.
  - `src/systems/audio.js`: Expand Web Audio engine with nature ambiance (breeze, birdsong, footsteps).
  - `factory.yaml`: Update project metadata and validation commands.
  - `README.md`: Document social sandbox gameplay and WebRTC room sharing.

---

## 6. Decomposition Plan (Architect Briefs)

| Batch | Brief ID | Role | Target Thinking Level | Description | Files Scope | Dependencies |
| :---: | :--- | :--- | :---: | :--- | :--- | :--- |
| **1** | `brief-01-field-engine` | Implementer | `MEDIUM` | Clifton Down top-down world, camera viewport, Y-sorted rendering, tree/bench obstacles, and ambient grass/wind particles | `src/world/field.js`, `src/style.css` | None (Parallel) |
| **1** | `brief-02-owner-dog` | Implementer | `HIGH` | Owner avatar, companion dog steering AI, leash mechanics, tail/ear physics, ball throw & fetch | `src/entities/owner.js`, `src/entities/companion_dog.js`, `src/entities/toy.js` | None (Parallel) |
| **1** | `brief-03-networking` | Implementer | `HIGH` | WebRTC in-browser P2P transport (PeerJS), message protocols, state synchronization, and optional Node server | `src/net/*`, `server/server.js` | None (Parallel) |
| **2** | `brief-04-social-audio-main` | Implementer | `MEDIUM` | Wire social HUD (room sharing, chat/emotes, customizer), Web Audio ambient soundscape, and main game loop | `src/main.js`, `src/ui/social_hud.js`, `src/systems/audio.js`, `index.html` | Batch 1 |
| **2** | `brief-val-tests` | Validator | `LOW` | Automated tests for steering math, ball physics, and network packet serialization | `test/*` | Batch 1 |
| **3** | `brief-rev-audit` | Reviewer | `HIGH` | Comprehensive architectural audit, multiplayer latency verification, and code quality review | Full diff | Batch 2 |
