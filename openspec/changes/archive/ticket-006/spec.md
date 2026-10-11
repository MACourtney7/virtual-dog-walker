# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-006"
title: "Virtual Dog Walker: Mobile Browser Support with Responsive Touch Controls and Dynamic Viewport"
state: "COMPLETED"
created_at: "2026-10-11T12:24:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-006/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Objective
*Virtual Dog Walker (Clifton Down)* is currently built around desktop keyboard and mouse input (<kbd>WASD</kbd>, <kbd>Space</kbd>, <kbd>L</kbd>, <kbd>B</kbd>, <kbd>E</kbd>, <kbd>Enter</kbd>). When players open the game on mobile browsers (iOS Safari, Android Chrome, iPadOS, tablets), they cannot steer their owner avatar, throw tennis balls, bark, pet their dog, toggle the leash, or comfortably chat. Furthermore, mobile browsers suffer from pinch-to-zoom collisions, double-tap zoom delays, browser rubber-banding/scrolling, and strict audio auto-play locks on touch devices.

**Ticket-006 achieves first-class mobile browser compatibility**:
1. **Responsive Virtual Touch Joystick & Action Buttons**:
   - A smooth, floating or fixed virtual analog joystick on the bottom-left for 360° fluid owner movement.
   - A glassmorphic virtual action bar on the bottom-right for essential canine interactions: Throw Ball (🎾), Leash Toggle (🦮), Bark (🐕), Pet (❤️), and Chat (💬).
   - In-world tap/touch interactions: tap the dog to pet, tap the open field to throw the tennis ball directly toward the touched point.
2. **Mobile Viewport & Canvas Ergonomics**:
   - Prevention of accidental pinch-zoom, double-tap zooming, and pull-to-refresh via optimized `<meta name="viewport">` and CSS `touch-action: none`.
   - Notch and home-bar support using CSS `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
   - Seamless dynamic resizing across portrait, landscape, and orientation switches.
3. **Touch Audio Auto-Unlock**:
   - Reliable Web Audio context activation on first touch (`touchstart`/`pointerdown`) for iOS Safari and mobile Chrome.
4. **Mobile Responsive UI / HUD**:
   - Dynamic scaling of the top bar, player count badge, style modal, and chat input.
   - Automatic hiding of desktop keyboard hints (`#controls-hint`) on touch-enabled devices.

---

## 2. System Architecture & Mobile Design

### 2.1 Virtual Touch Controller (`src/ui/touch_controls.js`)
- **Virtual Analog Joystick**:
  - Anchored on the bottom-left of the screen (`touch-joystick-zone`).
  - Implements a subtle base ring (radius ~50-60px) and a movable thumb knob.
  - Multi-touch safe: tracks unique `touch.identifier` so thumb dragging doesn't interfere with right-hand button taps.
  - Computes normalized displacement vector `(dx, dy)` with deadzone threshold (10%) and clamped max radius.
  - Maps vector to owner input velocity and angle:
    - Sets `owner.keys.up`, `down`, `left`, `right` proportionally or feeds direct joystick vector `(vx, vy)` to the owner entity for smooth 360° analog locomotion.
  - Auto-centers knob on `touchend` / `touchcancel`.
- **Touch Action Buttons (Bottom-Right)**:
  - Ergonomic radial or staggered grid cluster:
    - **🎾 Throw**: Launches ball in avatar facing direction, or towards last touched direction. Triggers subtle haptic feedback (`navigator.vibrate?.(25)`).
    - **🦮 Leash**: Toggles leash on/off with visual icon toggle.
    - **🐕 Bark**: Triggers dog bark with sonic pulse.
    - **❤️ Pet**: Triggers petting interaction and heart emitter.
    - **💬 Chat**: Opens mobile-optimized quick chat and emote bar.
- **In-World Touch & Tap Gestures (`src/main.js`)**:
  - `touchstart`/`pointerdown` on canvas (outside joystick and HUD):
    - Tapping within proximity of companion dog triggers pet action.
    - Tapping on the open field translates screen coordinates to world coordinates through `camera.screenToWorld()` and throws the tennis ball towards that position.
- **Device Capability Detection**:
  - Detected via `'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches`.
  - Gracefully active on mobile/tablets while completely non-intrusive on desktop mice/keyboards.

### 2.2 Viewport, Canvas & Safe-Area Constraints (`index.html`, `src/style.css`)
- **Viewport Meta Configuration**:
  - `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />`
  - Mobile web app meta tags (`mobile-web-app-capable`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`).
- **CSS Touch Lock & Safe Area**:
  - `touch-action: none` and `user-select: none` applied across `#game-container`, `#game-canvas`, and touch controls.
  - Top HUD padded with `max(16px, env(safe-area-inset-top))` and bottom controls padded with `max(16px, env(safe-area-inset-bottom))`.
  - Dynamic viewport height handling (`height: 100vh; height: 100dvh;`).

### 2.3 Mobile Audio Unlock (`src/main.js`, `src/systems/audio.js`)
- Audio context initialization attached to `'touchstart'`, `'touchend'`, and `'pointerdown'` on `window` and canvas.
- Calls `sound.unlockAudio()` and `sound.startAmbientBreeze()` immediately upon first touch interaction.

### 2.4 Mobile Responsive HUD & Modals (`src/ui/social_hud.js`, `src/style.css`)
- On screens ≤ 768px or `@media (pointer: coarse)`:
  - Hides desktop `<kbd>` controls hint (`#controls-hint`).
  - Compresses top bar spacing so Clifton Commons badge, player counter, and share button fit neatly on narrow portrait screens (360px–430px wide).
  - Positions chat bar with virtual keyboard awareness (`window.visualViewport` listener adjusting bottom offset when software keyboard opens).
  - Limits customizer modal width and ensures touch-friendly 44px+ hit targets on buttons and swatches.

### 2.5 Automated Testing (`test/test_mobile_controls.py`, `test/run_tests.py`)
- Unit tests verifying:
  - Joystick vector calculations, angle determination, deadzone clamping, and normalization.
  - Touch-to-world coordinate projection math.
  - Viewport metadata and CSS touch-action rules verification.
  - Registration in `test/run_tests.py`.

---

## 3. Scope Boundaries

### In-Scope
1. **Virtual Touch Controller Component (`src/ui/touch_controls.js`)**:
   - Analog joystick on left with thumb tracking and deadzone.
   - Action buttons on right (Throw, Leash, Bark, Pet, Chat).
   - In-world canvas tap-to-throw and tap-to-pet.
2. **Mobile Viewport & CSS System (`index.html`, `src/style.css`)**:
   - `viewport-fit=cover`, `user-scalable=no`, `touch-action: none`.
   - Safe-area insets (`env(safe-area-inset-*)`).
   - `dvh` dynamic viewport height and responsive layouts for small screens.
3. **Mobile Audio Initialization (`src/main.js`, `src/systems/audio.js`)**:
   - Mobile Safari/Chrome touch gesture audio unlocking.
4. **HUD & Modal Mobile Adaptation (`src/ui/social_hud.js`, `src/style.css`)**:
   - Hide desktop kbd hints on touch devices.
   - Responsive top bar and touch-friendly buttons.
5. **Screen to World Raycasting (`src/world/field.js`)**:
   - Adding `screenToWorld(screenX, screenY)` helper to `Camera` for tap-to-throw accuracy.
6. **Automated Unit Tests (`test/test_mobile_controls.py`, `test/run_tests.py`)**:
   - Testing mobile joystick vector math, clamp logic, and viewport configurations.

### Out-of-Scope
- Native App Store packaging (Capacitor/Cordova IPA/APK generation).
- Bluetooth gamepad controller mapping (handled in future gamepad ticket).

---

## 4. Requirements & Acceptance Criteria

- [x] **REQ-1: Viewport & Safe-Area Mobile Configuration (`index.html`, `src/style.css`)**
  - Viewport meta tag configures `viewport-fit=cover, maximum-scale=1.0, user-scalable=no`.
  - Mobile web app capable meta tags configured for iOS/Android full-screen experience.
  - `#game-container` and `#game-canvas` enforce `touch-action: none` and `user-select: none`.
  - UI overlays respect `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
  - *Verification*: Automated unit test validates `index.html` meta tags and CSS attributes.

- [x] **REQ-2: Camera Screen-to-World Coordinate Conversion (`src/world/field.js`)**
  - `Camera` provides `screenToWorld(screenX, screenY)` mapping client touch/mouse coordinates to world coordinates, accounting for viewport offset and world bounds.
  - *Verification*: Unit test validates coordinate conversion with various camera offsets and clamp limits.

- [x] **REQ-3: Virtual Touch Controller Engine (`src/ui/touch_controls.js`)**
  - Implements floating/fixed analog joystick with thumb tracking, deadzone (10%), and normalized directional vector output.
  - Provides touch action buttons for Throw (🎾), Leash (🦮), Bark (🐕), Pet (❤️), Chat (💬).
  - Only active or displayed when touch capabilities are present (`navigator.maxTouchPoints > 0` or coarse pointer).
  - *Verification*: Unit tests verify joystick vector calculation, deadzone clamping, and button callback dispatching.

- [x] **REQ-4: In-Game Tap Interactions & Mobile Audio Unlock (`src/main.js`, `src/systems/audio.js`)**
  - Touch/tap on field throws ball towards tapped world point.
  - Tapping near companion dog triggers pet action with heart emitter and sound.
  - Audio unlocks on first `touchstart`/`pointerdown` user gesture.
  - *Verification*: Verification of audio unlock handlers and tap dispatch logic in game loop.

- [x] **REQ-5: Mobile Responsive HUD & Test Suite CI (`src/ui/social_hud.js`, `src/style.css`, `test/test_mobile_controls.py`, `test/run_tests.py`)**
  - Hides desktop `<kbd>` hint on touch/mobile devices; compacts top bar for 360px+ screens.
  - Test suite `test/test_mobile_controls.py` covers touch math, vector normalization, and viewport integrity.
  - `python3 test/run_tests.py` passes 100% green.
  - *Verification*: Master test runner executes all tests with zero errors.

---

## 5. Architectural Design & Impacted Files
- **New Files**:
  - `src/ui/touch_controls.js`: Virtual analog joystick and touch action buttons component.
  - `test/test_mobile_controls.py`: Unit tests for touch math, camera projection, and mobile configuration.
- **Modified Files**:
  - `index.html`: Mobile meta tags (`viewport-fit=cover`, `user-scalable=no`, web-app-capable).
  - `src/style.css`: Mobile touch-action rules, safe-area insets, mobile joystick/button styling, responsive breakpoints.
  - `src/world/field.js`: Added `screenToWorld` coordinate conversion method on `Camera`.
  - `src/main.js`: Integration of `TouchControls`, tap-to-throw, tap-to-pet, and touch audio unlock.
  - `src/ui/social_hud.js`: Touch-friendly HUD responsive tweaks.
  - `src/systems/audio.js`: Explicit `unlockAudio` method.
  - `test/run_tests.py`: Integration of `test_mobile_controls.py` into test runner.
