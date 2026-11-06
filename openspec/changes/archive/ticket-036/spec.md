# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-036"
title: "Phase 3: Dog Mechanics, Player Models & Visual Appearance"
state: "COMPLETED"
roadmap: null
depends_on: ["ticket-035"]
created_at: "2026-11-06T23:00:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-036/main"
max_review_cycles: 3
target_files:
  - "src/entities/owner.js"
  - "src/entities/companion_dog.js"
  - "src/entities/npc.js"
  - "src/entities/npc_content.js"
  - "src/world/field.js"
  - "src/world/environment.js"
  - "src/systems/particles.js"
  - "src/main.js"
  - "test/test_phase3_visuals_and_mechanics.py"
  - "test/run_tests.py"
---
```

## 1. Problem Statement & User Requirements
Upgrading canine mechanics, human walker rendering, and park appearance entirely procedurally on HTML5 Canvas 2D with zero external sprite sheets:

1. **Player & NPC Directional Models (`src/entities/owner.js` & `src/entities/npc.js`)**:
   - Replace legacy front-facing static torso and shoulders with an 8-way directional model rotating shoulder/hip axes by `this.angle`.
   - Implement proper limb depth layering (far limb in background behind torso, near limb in foreground).
   - Add accessories (backpacks, scarves, hoodies) and an animated kneeling/bending pose when petting or picking up waste.

2. **Richer Canine Mechanics (`src/entities/companion_dog.js`)**:
   - Scent Trails & Sniffing: Detect and follow short-lived scent trails left by other dogs or squirrels, with animated nose-twitching and sniffing vapor particles.
   - Zoomies & Stick Carrying: Burst of figure-eight "zoomies" when happiness hits 100%; fallen woodland sticks around oak groves that dogs pick up and proudly trot with clamped across jaws.
   - Dynamic Gait Transitions: Visually distinguish slow walk, rhythmic Spaniel trot (with characteristic diagonal bounce), and full-extension gallop (volume-preserving torso stretch, ear sweep back, and dust puffs during `FETCHING`, `RECALLED`, `ZOOMIES`).

3. **Park Appearance (`src/world/field.js`, `src/world/environment.js`, `src/systems/particles.js`)**:
   - Wind-rippled tree canopy sway offsetting foliage puffs by `Math.sin(this.windTime + tree.x)`.
   - Directional sun/moon ground shadows that skew and lengthen up to 3.2x during `GOLDEN_HOUR`.
   - Autumn leaf clusters around chestnut and oak groves that scatter into fluttering, spinning `LeafParticle`s when a dog sprints through them.

---

## 2. Technical Specification & Implementation Plan

### 2.1 Player & NPC Directional 3D Silhouettes
1. **Directional Shoulder and Hip Projection**:
   - Calculate normal perpendicular vector: `perpX = -sinA`, `perpY = cosA`.
   - Project left shoulder/hip and right shoulder/hip outward along perpendicular normal by `shoulderSpan` (12px) and `hipSpan` (7px).
   - Six-stage depth layering:
     - Depth Layer 1: Far Arm & Far Leg (behind torso)
     - Depth Layer 2: Torso-back accessories (Backpack when facing South)
     - Depth Layer 3: 3D Directional Torso / Jacket with thickness shading and directional lapels/zipper
     - Depth Layer 4: Torso-front accessories (Backpack when facing North/Side, Scarf, or Hoodie)
     - Depth Layer 5: Near Leg & Near Arm (in front of torso)
     - Depth Layer 6: Head, Face, Ears & Hairstyle
2. **Accessories**:
   - Customizable accessories: `BACKPACK`, `SCARF`, `HOODIE`, `NONE`.
   - Integrated into `Owner` customization and `ParkNPC` seeded identities (`npcIdentityFromSeed`).
3. **Animated Kneeling / Bending Pose**:
   - `triggerPet(duration = 0.8)` and `triggerPickup(duration = 0.8)`:
     - Sets `petTimer` and `bendTimer`.
     - Lowers torso (`kneelDrop = 4.5px`) and leans forward (`kneelLeanX = cosA * 3.5px`).
     - Reaches near arm downward toward target on ground.

### 2.2 Richer Canine Mechanics
1. **Scent Trails & Sniffing (`DogState.SNIFFING_TRAIL`)**:
   - Dogs deposit short-lived scent trail nodes (`this.scentDropTimer >= 2.2s`, life = 22s) in `field.addScent(x, y, 'dog', this)`.
   - Roaming dogs detect nearby scents (`field.getNearbyScents`), transition to `SNIFFING_TRAIL`, trot at investigative pace (`0.38x speed`), animate nose twitching (`noseTwitch`), and emit sniff particles (`emitSniffParticles`).
2. **Figure-Eight Zoomies (`DogState.ZOOMIES`)**:
   - Reaching 100% happiness in `pet()` or roaming triggers `triggerZoomies()`.
   - Sprints at `1.15x sprintSpeed` along parametric Lissajous figure-eight (`sin(phase)` and `sin(2 * phase)`), with rapid tail wagging (`wagSpeed = 24`) and gallop dust puffs.
3. **Woodland Stick Pickup & Carrying**:
   - Uncarried woodland sticks under oak/chestnut groves (`field.sticks`) are picked up when trotting nearby (`pickupStick(stick)`).
   - Rendered clamped horizontally across jaws (`this.hasStick`).
   - Automatically dropped (`dropStick()`) on whistle recall or ball throw.
4. **Dynamic Gait Transitions**:
   - `this.gaitMode`: `IDLE` (<10 px/s), `WALK` (10–65 px/s, 4-beat cadence 6.5), `TROT` (65–220 px/s, diagonal pairs with `trotBob = 1.5px`), `GALLOP` (>=220 px/s or during `FETCHING`/`RECALLED`/`ZOOMIES`).
   - Gallop features: volume-preserving torso ellipse stretch (`stretchX` up to 1.32, `stretchY` compressed), streamlined ear sweep (`gallopSweep = -0.52`), front paws reaching forward +14px, rear paws kicking -15px, and dust puff emission (`emitGallopPuff`).

### 2.3 Park Visual Appearance
1. **Canopy Wind Sway**:
   - Offsets foliage puffs by `Math.sin(this.windTime + tree.x) * (2.8 * gustFactor)`.
2. **Directional Ground Shadows & Golden Hour**:
   - `Environment.prototype.getShadowParameters()` computes sun/moon ground shadow properties (`lengthFactor`, `offsetX`, `offsetY`, `skewX`, `color`).
   - Elongates shadows up to 3.2x during `GOLDEN_HOUR` (17.0–19.5) with warm sepia glow (`rgba(42, 26, 14, 0.45)`).
3. **Autumn Leaf Clusters & Particle Scattering**:
   - Oak and chestnut groves spawn multi-leaf clusters (`this.leafClusters`).
   - High-speed movement (>125 px/s) through clusters triggers explosive scattering into spinning, air-resistant `LeafParticle`s that flutter and settle.
   - Scent trails and woodland sticks populated under groves.

---

## 3. Verification & Acceptance Criteria
- AC-036.1: Owner and NPC directional models render 8-way directional silhouettes with depth layering and accessories.
- AC-036.2: Petting and poop pickup trigger animated kneeling/bending poses.
- AC-036.3: Canine companion supports scent trails, sniffing, figure-eight zoomies, and stick carrying.
- AC-036.4: Visual gait transitions cleanly distinguish slow walk, rhythmic Spaniel trot bounce, and full-extension gallop with torso stretch and ear sweep.
- AC-036.5: Tree canopies sway in the wind, ground shadows lengthen during Golden Hour, and leaf clusters scatter when sprinted through.
- AC-036.6: 100% test pass rate across all 28 test suites in `python3 test/run_tests.py`.

