# Canonical System Specification: Ziggy's Great Park Adventure

## 1. System Overview
**Ziggy: The Great Park Adventure** is a high-performance 2D platformer built entirely with HTML5 Canvas, Vanilla ES6, and the Web Audio API. The game stars **Ziggy**, an authentic chocolate & tan Cocker Spaniel featuring secondary ear spring physics, variable jumping, mid-air ear-flutter gliding, sonic bark shockwaves, and rich park scenery.

## 2. Character Architecture
- **Hero Entity (`src/entities/ziggy.js`)**:
  - **Color Palette & Visuals**:
    - Coat: Deep chocolate brown (`#321d16`) with white chest bib (`#f4efe6`).
    - Markings: Honey-tan eyebrow pips (`#e2aa68`) above amber eyes (`#c6933a`), tan muzzle (`#d49a58`), and four feathered tan boots.
    - Accessories: Dark harness with teal collar (`#1b6b65`) and gold bone charm (`#f3c948`).
  - **Spring-Damper Ear Physics**: Wavy floppy ears with golden-chestnut highlights (`#9e5528`) responding to velocity inertia.
  - **Canine Mechanics**:
    - *Ear-Flap Flutter*: Mid-air double jump activating reduced-gravity glide.
    - *Bark Pulse*: Expanding sonic ring wave that startles squirrels and triggers real-time procedural bark audio.
    - *Tail Wag*: Velocity-dependent wagging animation.

## 3. Engine & Environment Architecture
- **Kinematic Physics (`src/engine/physics.js`)**:
  - Independent X/Y AABB collision resolution.
  - Solid tiles and one-way pass-through bridges/benches (drop down with <kbd>S</kbd> + <kbd>Space</kbd>).
  - Coyote time (120ms) and Jump buffering (120ms).
- **Parallax Park Level (`src/level/park_level.js`)**:
  - 3600px wide multi-tier level with drifting clouds, distant hills, midground park trees, wooden footbridges, and stone pergolas.
  - Golden Dog Park Gate victory exit.
- **Collectibles & Hazards (`src/entities/collectibles.js`, `src/entities/hazards.js`)**:
  - Golden Bones (+100 pts), Neon Tennis Balls (5s speed boost +50 pts), Sausages (+1 life).
  - Scurrying squirrels, mud puddles (traction reduction), and celebratory confetti.
- **Audio Synthesizer (`src/systems/audio.js`)**:
  - Zero-asset Web Audio API: Formant-filtered canine barks, spring leaps, flutter whooshes, bone pickup chimes, and victory fanfare.
- **Particle Engine (`src/systems/particles.js`)**:
  - Dust/grass running trails, golden collectible sparkles, and victory gate confetti.

## 4. Test Harness
- `python3 test/run_tests.py`: Executes test suites for physics kinematics, Ziggy state machine & ear flutter, and gameplay scoring.
