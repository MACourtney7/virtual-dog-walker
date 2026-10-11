# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-012"
title: "Enhanced Character & Canine Customization & 2D Aesthetics"
state: "PLANNING"
created_at: "2026-10-11T19:54:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-012/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Currently in *Virtual Dog Walker*:
1. **Limited Avatar Customization**:
   - The human Owner avatar only allows configuring a name and jacket color from 5 swatches. Hairstyle, hair color, skin tone, pants, and footwear cannot be chosen in the UI.
   - The companion dog only supports 3 coat presets, with a fixed teal collar and no collar color choice.
2. **Visual Polish (2D Aesthetics)**:
   - The user requested: *"upgrade customation of human and dog characters, improve appearance of the characters and maps, it should remain 2d, it should be more visually appealing"*.
   - Both characters should have expressive, charming 2D vector detailing (facial features, ear spring physics, tailored hair silhouettes, body shading, and animated walk cycles) while staying strictly 2D top-down / soft isometric tilt.
3. **Modal UI Ergonomics**:
   - The customizer modal is a single cramped column. It needs a clean, modern glassmorphic tabbed layout ("👤 Walker" and "🐕 Dog Companion") that works comfortably on both desktop and mobile touch screens.
4. **Multiplayer Metadata Synchronization**:
   - Expanded customization attributes (hair style, hair color, collar color, expanded coat breeds) must persist in `localStorage` and synchronize across multiplayer peers via `HELLO` and `WELCOME` packets so all visitors see each other's custom characters.

---

## 2. System Architecture & Technical Specifications

### 2.1 Owner Avatar Model & 2D Vector Rendering (`src/entities/owner.js`)
- **Customization Attributes**:
  - `hairStyle`: `'SHORT'`, `'WAVY'`, `'PONYTAIL'`, `'BEANIE'`
  - `hairColor`: Palette (Brown `#451a03`, Blonde `#eab308`, Black `#171717`, Auburn `#9a3412`, Silver `#94a3b8`)
  - `jacketColor`: Rich palette (Navy `#1e3a8a`, Forest `#14532d`, Crimson `#831843`, Amber `#b45309`, Slate `#334155`, Ochre `#d97706`)
  - `pantsColor`: Palette (Denim `#1e293b`, Tan `#78350f`, Olive `#365314`, Dark Gray `#1f2937`)
  - `skinTone`: Diverse palette (`#fed7aa`, `#fcd34d`, `#d97706`, `#92400e`, `#5b21b6`, `#7c2d12`)
  - `shoeColor`: Dark slate `#0f172a` or white trainer `#f8fafc`
- **Enhanced 2D Draw Pipeline**:
  - Head with soft drop shadow, ears, subtle nose tilt indicator based on `angle`.
  - Distinct hair rendering per `hairStyle` (e.g. swept bangs for Short, flowing tufts for Wavy, bun/tail for Ponytail, snug ribbed cap with pom-pom for Beanie).
  - Jacket torso with collar lapels, arm sway during walk cycle.
  - Foot swing animation with dual-tone shoes.

### 2.2 Companion Dog Model & 2D Vector Rendering (`src/entities/companion_dog.js`)
- **Expanded `CoatPreset`**:
  - `CHOCOLATE_TAN`: Cocker Spaniel (Ziggy) - Rich chocolate with tan brow pips and muzzle.
  - `GOLDEN`: Golden Retriever - Warm honey-gold with lighter chest bib.
  - `BLACK_LAB`: Black Labrador - Sleek charcoal black with hazel highlights.
  - `JACK_RUSSELL`: Jack Russell Terrier - Crisp white coat with chestnut eye patch and ear markings.
  - `RED_SETTER`: Irish Red Setter - Deep mahogany chestnut with silky ear fringe.
- **Collar Customization (`collarColor`)**:
  - Palette (Teal `#0d9488`, Crimson `#dc2626`, Royal Blue `#2563eb`, Gold `#eab308`, Amethyst `#7c3aed`).
  - Rendered with metallic gold charm tag reflecting light.
- **Enhanced 2D Draw Pipeline**:
  - Snout highlighting, whisker dots, expressive dark canine eyes with catchlights.
  - Floppy ear physics damper responding to trot inertia.
  - Animated wagging tail with coat-matching brush/feathering.

### 2.3 Tabbed Customizer UI (`src/ui/social_hud.js`, `src/style.css`)
- **Glassmorphic Tabbed Modal**:
  - Tab 1: **👤 Walker** (Name, Skin tone swatches, Hair style buttons, Hair color swatches, Jacket swatches, Pants swatches).
  - Tab 2: **🐕 Dog Companion** (Coat / Breed selector, Collar color swatches).
- **Profile Storage**:
  - Serialized to `localStorage.getItem('clifton_walker_profile')` with backward-compatible defaults.

### 2.4 Multiplayer Protocol Synchronization (`src/net/protocol.js`, `src/main.js`)
- `Protocol.createHello(peerId, name, jacketColor, dogCoatName, extraMeta)`:
  - Carries `hairStyle`, `hairColor`, `collarColor`, `pantsColor`, `skinTone`.
- `remotePlayers` update loop in `src/main.js`:
  - Dynamically updates remote avatar styling when metadata is received.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-012.1** | Owner avatar renders with selectable `hairStyle`, `hairColor`, `jacketColor`, `pantsColor`, and `skinTone`. | Automated unit test & canvas render test |
| **AC-012.2** | Dog companion supports 5 coat presets and customizable `collarColor`. | Automated unit test verifying CoatPreset & draw |
| **AC-012.3** | Customizer in `SocialHUD` features a tabbed interface ("Walker" and "Dog Companion") with intuitive swatches. | DOM verification & interaction tests |
| **AC-012.4** | Customizer profile serializes and persists across reloads via `localStorage`. | Unit test verifying profile load/save schema |
| **AC-012.5** | Multiplayer `HELLO` / `WELCOME` protocols propagate expanded styling to remote avatars. | Packet schema & peer metadata test |
| **AC-012.6** | Zero regressions in existing test suite (`python3 test/run_tests.py`). | Automated test runner execution |

---

## 4. Testing & Verification Strategy

- **Automated Tests (`test/test_character_customization.py`)**:
  - Verify `Owner` attributes and `draw()` without exceptions for all hairstyles and color tokens.
  - Verify `CompanionDog` coat presets and collar color rendering.
  - Verify `localStorage` profile serialization and deserialization backward compatibility.
  - Verify `Protocol.createHello()` includes expanded styling fields.
- **Regression Suite (`test/run_tests.py`)**:
  - Execute full suite across all 11 test modules.
