# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-011"
title: "The Downs: Map Redesign Inspired by Clifton & Durdham Downs, Waste Bins & Nature Soundscape"
state: "COMPLETED"
created_at: "2026-10-11T19:22:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-011/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Currently in *Virtual Dog Walker*:
1. **Generic Meadow Layout**:
   - The current map is a generic rectangular field (2600 × 1900 px) with scattered trees and benches, lacking the iconic character and authentic geography of **The Downs** (Clifton & Durdham Downs in Bristol, UK).
   - The user has requested to redesign the map layout to be inspired by Clifton and Durdham Downs and rename the park to **"The Downs"**.
2. **Missing Iconic Landmarks & Pathways**:
   - The Downs is characterized by distinct geographical features:
     - **Ladies Mile**: wide, prominent central tree-lined avenue cutting across the plateau.
     - **Sea Walls / Avon Gorge Rim**: western cliff edge with stone boundary walls, viewing promontories, and dramatic crags.
     - **The Water Tower & Cafe Clearing**: northern/northeastern landmark zone.
     - **Clifton Observatory & Rock Slide**: southern elevated promontory.
     - Natural gravel cross-tracks and wildflower meadows.
3. **Missing Public Dog-Waste Bins**:
   - Essential for realistic park dog walking and as prerequisite infrastructure for upcoming gameplay loops (dog poop cleanup in `ticket-014`).
   - Distinctive public park dog-waste bins must be placed at strategic junctions, path entries, and near teak benches.
4. **Enhanced 2D Visual Aesthetics**:
   - The visual style must remain 2D top-down / soft isometric tilt, but significantly more appealing:
     - Multi-toned turf with textured grass flecks, mown path edges, and varied flora.
     - Mature English oak, sweet chestnut, and lime tree avenues with layered foliage and soft drop shadows.
     - Weathered stone perimeter walls and railings.
5. **Enhanced Nature Soundscape**:
   - Expand the Web Audio procedural nature synthesizer to deliver a rich, peaceful ambient soundscape:
     - Gentle canopy wind with natural organic swelling.
     - Rich authentic British birdsong variety (blackbird, European robin, chaffinch, woodpigeon).
     - Rustling meadow grasses.

---

## 2. System Architecture & Technical Specifications

### 2.1 The Downs Map Geometry & Landmarks (`src/world/field.js`)
- **Expanded Coordinates & Zones**:
  - Coordinate space: `3200 × 2400 px` providing expansive walking space for multiple players and dogs.
  - Defined zones:
    1. **North Zone (Durdham Down Grasslands)**: Expansive open turf, Water Tower monument (`x: 2400, y: 450`), cafe pavilion benches.
    2. **Central Boulevard (Ladies Mile Avenue)**: Wide dual-bordered gravel avenue crossing diagonally (`x: 400, y: 1900` to `x: 2700, y: 500`) with avenues of sweet chestnuts and lime trees.
    3. **West Edge (Sea Walls / Avon Gorge Overlook)**: Stone perimeter walls, iron railing viewpoints, rocky limestone crags, and panoramic vista benches overlooking the Avon Gorge.
    4. **South Zone (Clifton Down Woodland & Observatory)**: Denser tree copses, winding woodland trails, teak benches, and limestone boulder features.
- **Dog-Waste Bins (`this.bins`)**:
  - Array of 8 dog-waste bin entities (`{ id, x, y, radius: 12, depthY: y + 8, isBin: true }`).
  - Placed alongside main path intersections, Sea Walls lookout, Water Tower clearing, and near benches.
  - Collision resolution integrated into `resolveCircleCollision`.
  - Distinctive 2D rendering: dark green cylinder (`#1b4332`) with red canister band (`#b91c1c`), dark top slot, white paw/dog decal, and soft drop shadow.

### 2.2 Visual Rendering Pipeline (`src/world/field.js`)
- **Enhanced 2D Procedural Turf & Foliage**:
  - Multi-shade grass rendering using perlin/noise variation with soft lawn mower striping on open greens.
  - Distinct path rendering: broad gravel avenues with rough edges, sandy dirt trails, and cobblestone/flagstone landmark plazas.
  - Shaded tree canopies with depth-sorted trunks and transparent overpass foliage highlights.
- **Y-Sorted Depth Sorting**:
  - Scenery objects (trees, benches, bins, monuments) collected into `renderList` along with dynamic entities (owners, dogs, tennis balls).
  - Sorted ascending by base coordinate (`depthY`).

### 2.3 Web Audio Procedural Nature Soundscape (`src/systems/audio.js`)
- **Continuous Layered Ambient Audio**:
  - **Wind in Canopy**: Dual-filtered pink noise with slow sinusoidal LFO (0.1 Hz) modulating low-pass cutoff between 260 Hz and 440 Hz for breathing canopy breeze.
  - **British Birdsong Synth**:
    - Blackbird melodic piping (`playBlackbird()`, whistle motifs 1800–2600 Hz).
    - Robin warbles (`playRobin()`, high-frequency chirps 3200–4200 Hz with vibrato).
    - Woodpigeon rhythmic coos (`playWoodpigeon()`, low soft pulses at 380–420 Hz).
  - Background audio auto-unlocks on first user interaction (<kbd>touchstart</kbd> / <kbd>click</kbd>) and supports mute toggling.

### 2.4 User Interface & Branding (`index.html`, `src/ui/social_hud.js`)
- Title tag and header updated: `"The Downs - Virtual Dog Walker"`.
- HUD status pill updated from `"Clifton Down"` to `"The Downs"`.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Status | Verification Method |
|---|---|:---:|---|
| **AC-011.1** | Map renamed to "The Downs" in `index.html`, `src/world/field.js`, and `src/ui/social_hud.js`. | **VERIFIED** | Code inspection & DOM verification (`test/test_downs_map.py`) |
| **AC-011.2** | Map layout implements The Downs geography (Ladies Mile avenue, Sea Walls overlook, Water Tower clearing). | **VERIFIED** | Geometric coordinate & visual inspection (`Field.render`) |
| **AC-011.3** | At least 8 dog-waste bins placed along paths and benches with collision and depth sorting. | **VERIFIED** | Automated unit test verifying bin registry & collisions (`test_dog_waste_bin_registry`) |
| **AC-011.4** | Enhanced 2D rendering with multi-tone turf, distinctive gravel/dirt paths, and layered foliage. | **VERIFIED** | Canvas rendering inspection in worktree and test suite |
| **AC-011.5** | Web Audio nature soundscape plays procedural wind and authentic birdsong varieties. | **VERIFIED** | Automated audio synthesizer test (`test_audio_nature_soundscape_methods`) |
| **AC-011.6** | Camera follow smoothly clamps within expanded world bounds without jitter. | **VERIFIED** | Unit test camera math & boundaries (`test_camera_viewport_clamping`) |
| **AC-011.7** | Zero regressions in existing test suite (`python3 test/run_tests.py`). | **VERIFIED** | Automated test runner passed 10/10 test suites |

---

## 4. Testing & Verification Strategy

- **Automated Tests (`test/test_downs_map.py`)**:
  - Verified map dimensions (3200 × 2400) and landmark coordinate definitions.
  - Verified bin registry contains 8 bins with valid positions and collision radii.
  - Verified camera viewport clamping across expanded 3200×2400 space.
  - Verified audio nature soundscape synthesis methods exist and execute cleanly.
- **Regression Suite (`test/run_tests.py`)**:
  - Full suite execution covering all 10 modules: physics, steering, leash sync, mobile controls, and map geometry.
