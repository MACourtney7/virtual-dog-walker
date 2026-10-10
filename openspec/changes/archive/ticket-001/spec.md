# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-001"
title: "Ziggy the Cocker Spaniel: 2D Platformer Adventure"
state: "PLANNING"
created_at: "2026-10-10T18:01:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-001/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Objective
Build the foundational release of **"Ziggy: The Great Park Adventure"**, a charming, highly responsive 2D platformer starring **Ziggy the Cocker Spaniel**. Ziggy is modeled faithfully after real-world reference photos (`docs/reference/ziggy_face.png`, `docs/reference/ziggy_standing.jpg`) featuring his signature **chocolate & tan** working cocker spaniel coat, honey-tan eyebrow pips, long silky crimped ears with spring physics, white chest patch, wagging feathered tail, and canine platforming mechanics (variable jumping, mid-air ear-flutter glide, and sonic bark ability).

## 2. Character Design & Visual Palette (Faithful to Reference)
- **Visual Design Spec (from Reference Photos)**:
  - **Coat & Body**: Rich deep chocolate brown (`#2E1A14`, `#3B231A`).
  - **Signature Eyebrows**: Warm honey-tan circular eyebrow pips (`#D89B54`, `#E2AA68`) positioned directly above the eyes for maximum expressiveness.
  - **Muzzle & Cheeks**: Tan muzzle fading to a liver/truffle brown nose (`#5E372E`).
  - **Eyes**: Soulful amber/hazel eyes (`#C6933A`) with responsive pupil scaling based on state (wide during jumps/barks, alert when running).
  - **Ears**: Long, crimped/wavy cocker spaniel ears with chocolate roots and golden-chestnut highlights (`#9E5528`, `#B66E3A`) featuring real-time spring damper physics.
  - **Chest**: Distinctive creamy white chest bib (`#F4EFE6`) visible beneath collar/harness.
  - **Legs & Feathering**: Honey-tan feathered boots on all four paws.
  - **Tail**: High-set feathered tail with golden-tan underside that wags enthusiastically when moving.
  - **Gear**: Dark harness with teal collar accent (`#1B6B65`) and gold bone charm (`#F3C948`).

## 3. Scope Boundaries
- **In-Scope**:
  - **Hero Character (Ziggy)**:
    - Procedurally rendered 2D canvas sprite faithfully adhering to the color palette and markings above.
    - Kinematic movement: horizontal acceleration, deceleration/skid, coyote time (5-frame window), jump input buffering, and variable jump height.
    - **Ear-Flap Flutter**: Mid-air secondary jump/glide where Ziggy's fluffy ears flap for extra hangtime and distance.
    - **Bark Action**: Emits an expanding sonic ring wave that startles park critters (squirrels, pigeons) and triggers a real-time procedural bark audio effect.
  - **Platforming & Environment**:
    - Parallax scrolling multi-layered park world (sunlit sky, rolling green hills, park benches, garden fences, wooden bridges).
    - Solid ground collision, sloped edges, and one-way pass-through platforms (jump up through, drop down with S/Down + Jump).
  - **Collectibles & Hazards**:
    - Golden Bones (points & completion tally), Tennis Balls (super speed boost), Sausages (health recovery).
    - Hazards: Mud puddles (traction reduction/slowdown), oscillating garden sprinklers, mischievous squirrels.
    - Level Goal: The Golden Dog Park Gate (triggers victory dance and level clear screen).
  - **Audio & Visual Polish**:
    - Web Audio API procedural sound engine: authentic resonant canine barks, boing leaps, bone pickup chimes, and playful background chiptune music.
    - Particle FX: Dirt kick-up when sprinting/landing, sparkles on bone pickup, water droplets near sprinklers.
    - Paw-print lives counter (🐾), bone score, bark energy meter, and game over / level complete screens.
  - **Test Suite**:
    - Vitest unit tests covering vector physics, gravity/jump equations, collision resolution, and collectible scoring.
- **Out-of-Scope**:
  - Level editor (reserved for subsequent tickets).
  - Multiplayer / co-op (future roadmap).

## 4. Requirements & Acceptance Criteria
- [ ] **REQ-1: Vite & TypeScript Platformer Foundation**
  - Project scaffolding with TypeScript, Vite, and Vitest.
  - Zero external raster asset dependency (procedural canvas rendering + Web Audio).
  - *Verification*: `npm run build` passes with zero errors; `npm test` runs with passing tests.
- [ ] **REQ-2: Kinematic Platforming Physics & Collisions**
  - Axis-Aligned Bounding Box (AABB) collision detection with solid tiles and one-way platforms.
  - Coyote time and jump input buffering for crisp, responsive platforming.
  - *Verification*: Vitest unit tests for gravity, jump curves, platform resting, and collision clipping prevention.
- [ ] **REQ-3: Ziggy Hero Entity & Canine Mechanics**
  - Fully animated Chocolate & Tan Cocker Spaniel matching the reference design tokens (tan eyebrows, chest bib, ear highlights, tail wag).
  - Floppy ear spring physics responding to velocity and air resistance.
  - "Bark" ability emitting a circular expansion wave with cooldown and procedural sound effect.
  - *Verification*: State machine unit tests and interactive browser testing.
- [ ] **REQ-4: Park Level, Collectibles, & Enemies**
  - Multi-tier park level layout with hills, benches, platforms, bone trails, and park gate goal.
  - Interactive squirrels that scurry away when barked at.
  - Collectible pickup registration and score tracking.
  - *Verification*: Unit tests verifying bone collection and win condition triggers.
- [ ] **REQ-5: Procedural Canine Audio & UI Polish**
  - Web Audio API synthesis generating sound effects without external MP3/WAV files.
  - HUD overlay featuring Paw-Print lives, Bone Counter, Bark energy meter, and Victory screen.
  - *Verification*: Audio synthesis plays cleanly on user interaction; 60fps canvas performance.

## 5. Architectural Design & Impacted Modules
- **New Modules / Files**:
  - `docs/reference/ziggy_face.png`, `docs/reference/ziggy_standing.jpg`: Canonical character reference.
  - `package.json`, `tsconfig.json`, `vite.config.ts`: Modern dev toolchain.
  - `index.html`: Canvas container and retro-modern HUD styling.
  - `src/main.ts`: Game loop orchestrator (`requestAnimationFrame` + delta time clamp).
  - `src/engine/physics.ts`: AABB collision resolver, gravity, and raycast floor checks.
  - `src/entities/ziggy.ts`: Ziggy player controller, floppy ear physics, and chocolate & tan sprite renderer.
  - `src/entities/collectibles.ts`: Bones, tennis balls, and treats.
  - `src/entities/hazards.ts`: Squirrels, sprinklers, and mud patches.
  - `src/level/park_level.ts`: Tilemap generator and parallax background layers.
  - `src/systems/audio.ts`: Procedural Web Audio canine bark & synth effects.
  - `src/systems/particles.ts`: Grass/dust kick-up and sparkle bursts.
  - `src/ui/hud.ts`: Canvas HUD overlays (paws, bones, score, win/lose states).
  - `test/physics.test.ts`: Automated physics and collision tests.
  - `test/gameplay.test.ts`: Collectible scoring and state progression tests.
- **Modified Modules**:
  - `factory.yaml`: Tech stack and validation commands.
  - `openspec/specs/overview.md`: Repository overview updated for Ziggy platformer.

## 6. Decomposition Plan (Architect Briefs)
| Brief ID | Role | Target Thinking Level | Description | Dependencies |
| :--- | :--- | :---: | :--- | :--- |
| `brief-01-scaffold` | Implementer | `LOW` | Vite + TypeScript + Vitest repo scaffolding and package configuration | None |
| `brief-02-physics-engine` | Implementer | `MEDIUM` | Kinematic 2D platforming physics, AABB collisions, one-way ledges, and unit tests | `brief-01-scaffold` |
| `brief-03-ziggy-hero` | Implementer | `MEDIUM` | Chocolate & tan Ziggy sprite rendering (tan eyebrows, chest bib, ear springs, bark shockwave, ear-flap glide) | `brief-02-physics-engine` |
| `brief-04-park-world-audio` | Implementer | `MEDIUM` | Parallax park scenery, collectibles (bones), hazards, Web Audio procedural barks & HUD | `brief-03-ziggy-hero` |
| `brief-val-01` | Validator | `LOW` | Run Vitest unit tests, type-check, and verify production build | `brief-04-park-world-audio` |
| `brief-rev-01` | Reviewer | `HIGH` | Deep architectural review: 60fps frame budgeting, memory leak audit, and control fluidity | `brief-val-01` |
