# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-010"
title: "Virtual Dog Walker: Realistic On-Leash Heel, Bounded Off-Leash Roaming, Dog-to-Dog Social Interactions & Whistle Recall Command"
state: "PROPOSED"
created_at: "2026-10-11T17:20:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-010/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Currently in *Virtual Dog Walker (Clifton Down)*:
1. **Unrealistic Relative Positioning**:
   - The companion dog follows at a static offset (62px behind the owner at a 135° angle).
   - When on-leash, the dog should walk closely at the owner's side/heel (~38–48px) with natural slack in the lead and natural turning deceleration.
2. **Missing Off-Leash Roaming Mode**:
   - When taken off-leash, the dog still executes the same static follow routine behind the human unless fetching a tennis ball.
   - When off-leash, dogs should exhibit genuine exploratory roaming behavior (trotting ahead, sniffing grass/flower patches, circling back), while remaining **organically bounded within a comfortable distance (~160–220px)** from the human so they never get lost or wander across the map.
3. **Limited Dog-to-Dog Social Dynamics**:
   - Currently, dogs only trigger a brief play-bow if within 58px of another dog with a 2% chance per frame.
   - Dogs in a public park should be naturally social: noticing other dogs within proximity (~90–120px), approaching for friendly snout/butt sniff greetings, wagging their tails, exchanging happy emotes (`🐾`, `🐶`, `❤️`), and engaging in playful circles or play-bows.
4. **Missing Whistle / Recall Command**:
   - Players have no way to call their dog back when off-lead.
   - A whistle command should immediately recall the dog to sprint/trot back to the human, follow closely at heel for a short while (~10 seconds), and then seamlessly resume autonomous roaming if off-lead.
   - The whistle command should feature a high-pitched procedural training whistle sound effect, keyboard (<kbd>H</kbd> / <kbd>R</kbd>) and mobile touch action button support, and multiplayer network synchronization so other park visitors hear and observe the recall.

---

## 2. System Architecture & Technical Specifications

### 2.1 Canine Steering AI & State Machine (`src/entities/companion_dog.js`)
- **Expanded `DogState` Enum**:
  ```javascript
  export const DogState = {
    FOLLOWING: 'FOLLOWING',       // On-leash close heel follow (~38–48px)
    ROAMING: 'ROAMING',           // Off-leash autonomous exploration within bounded radius
    SOCIAL_GREET: 'SOCIAL_GREET', // Approaching & sniffing nearby canine peer
    PLAY_BOW: 'PLAY_BOW',         // Playful social crouch & tail wag
    IDLE_SNIFF: 'IDLE_SNIFF',     // Sniffing turf/flowers
    SITTING: 'SITTING',           // Sitting at rest
    FETCHING: 'FETCHING',         // Ball retrieval
    BARKING: 'BARKING',           // Vocal bark
    RECALLED: 'RECALLED'          // Rapid sprint back to human upon whistle, followed by timed heel
  };
  ```
- **On-Leash Close Heel (`DogState.FOLLOWING`)**:
  - Target follow distance reduced to ~38–48px at the owner's side.
  - Matches owner velocity smoothly; when owner stops, transitions gracefully to idle sniff or sit.
- **Bounded Off-Leash Roaming (`DogState.ROAMING`)**:
  - When off-leash (`!this.owner.isLeashed`), dog enters `ROAMING` mode.
  - Generates organic wander targets in front of or around the owner.
  - **Bounded Perimeter**: Max roam radius = 200px from owner.
    - If distance exceeds 150px, steering steering vector biases back toward owner.
    - If distance exceeds 210px (e.g. human walks away), dog automatically trots back to close the distance.
  - Randomly pauses for 2–4 seconds to sniff interesting grass spots (`IDLE_SNIFF`).
- **Dog-to-Dog Social Greetings (`DogState.SOCIAL_GREET` & `PLAY_BOW`)**:
  - Scans `otherDogs` list: if an unfamiliar dog is within 120px and both are not fetching:
    - Approaching dog steers toward the peer dog to initiate a friendly sniff greeting.
    - When within 35px: enters mutual sniffing circle, wags tail rapidly (`wagSpeed = 16`), displays friendly emote (`🐾`, `🐶`, `❤️`).
    - After 2.5–3 seconds, transitions to playful play-bow (`PLAY_BOW`) or resumes roaming.
- **Whistle Recall & Timed Heel (`DogState.RECALLED`)**:
  - Triggered via `dog.whistleRecall()`:
    - Dog perks up, shows `!` or `🎵` emote bubble.
    - Sprints back toward owner (`sprintSpeed = 290 px/s`).
    - When distance to owner < 36px, transitions to close heel following with `this.recallHeelTimer = 10.0` seconds.
    - Once the 10-second timer elapses, dog smoothly resumes `ROAMING` (if off-leash) or `FOLLOWING` (if on-leash).

### 2.2 Procedural Whistle Audio Engine (`src/systems/audio.js`)
- **Web Audio Whistle Synthesizer (`playWhistle()`)**:
  - Dual-oscillator high-frequency training whistle sound:
    - Main oscillator: sine wave with rapid upward chirp from 2400 Hz to 2850 Hz.
    - Overtone oscillator: subtle harmonic at ~3600 Hz.
    - Vibrato modulation: LFO at 18 Hz creating authentic acoustic whistle warble.
    - Envelope: sharp attack (15ms), steady sustain (180ms), quick decay (60ms).

### 2.3 Network Protocol & Multiplayer Handshake (`src/net/protocol.js`, `src/net/ws_network.js`, `src/net/network.js`)
- **New Packet Type**: `PacketType.WHISTLE = 'WHISTLE'`.
- `Protocol.createWhistle(peerId, x, y)`:
  - Transmits whistle trigger across WebSocket / PartyServer.
- On receipt of `WHISTLE`:
  - Remote client plays sound effect `audioEngine.playWhistle()`.
  - Remote owner avatar displays whistle toast/emote, and their companion dog enters `RECALLED` sprint.

### 2.4 User Interface & Controls (`src/main.js`, `src/ui/touch_controls.js`, `src/ui/social_hud.js`)
- **Desktop Input**:
  - Bound to <kbd>H</kbd> (Heel) and <kbd>R</kbd> (Recall/Whistle).
  - Toast message: `📯 Whistle! Ziggy recalled to heel`.
- **Mobile Touch Controller**:
  - Added action button `#btn-touch-whistle` with icon `📯` on `#touch-action-pad`.
  - Haptic feedback pulse on tap.
- **HUD Guidance**:
  - Updated `<kbd>` controls legend in `SocialHUD`: `<kbd>H</kbd> Whistle/Heel`.

### 2.5 Automated Testing Suite (`test/test_dog_behavior.py`, `test/run_tests.py`)
- Unit tests verifying:
  - Close follow distance clamping when on-leash.
  - Off-leash bounded roaming perimeter constraint (dog distance never exceeds max roam radius).
  - Social proximity detection and greeting state transitions.
  - Whistle recall sprint and 10-second heel timer countdown.
  - `WHISTLE` packet serialization and protocol integration.

---

## 3. Scope Boundaries

### In-Scope
1. `src/entities/companion_dog.js`: On-leash heel follow, bounded off-leash roaming, social canine greetings, whistle recall state.
2. `src/systems/audio.js`: High-frequency procedural training whistle synthesizer (`playWhistle`).
3. `src/net/protocol.js`: `WHISTLE` packet schema definition.
4. `src/net/ws_network.js` & `src/net/network.js`: Whistle packet broadcasting and dispatching.
5. `src/main.js`: Whistle command execution, keyboard bindings (<kbd>H</kbd>/<kbd>R</kbd>), and remote peer whistle handling.
6. `src/ui/touch_controls.js` & `src/ui/social_hud.js`: Touch action button `📯`, HUD controls guide.
7. `test/test_dog_behavior.py` & `test/run_tests.py`: Comprehensive automated test suite.

### Out-of-Scope
- Changing canine sprite art or adding 3D skeletal animations.
- Modifying Cloudflare Worker routing or PartyServer durable object infrastructure.

---

## 4. Worker Decomposition Plan

- **Worker 1 (`impl-dog-roam-social`) [HIGH]**:
  - Focus: `src/entities/companion_dog.js`
  - Responsibilities: Realistic on-leash close heel follow, bounded off-leash roaming AI with return bias, social dog-to-dog greeting interactions (mutual sniff, circling, emote bubbles, play-bow), and whistle recall state machine with timed heel.
- **Worker 2 (`impl-whistle-audio-net`) [MEDIUM]**:
  - Focus: `src/systems/audio.js`, `src/net/protocol.js`, `src/net/ws_network.js`, `src/net/network.js`, `src/main.js`
  - Responsibilities: Implement Web Audio procedural training whistle (`playWhistle()`), define `WHISTLE` packet schema, wire network broadcast and remote peer reception, and bind desktop keyboard triggers (<kbd>H</kbd>/<kbd>R</kbd>).
- **Worker 3 (`impl-touch-hud-tests`) [LOW/MEDIUM]**:
  - Focus: `src/ui/touch_controls.js`, `src/ui/social_hud.js`, `src/style.css`, `test/test_dog_behavior.py`, `test/run_tests.py`
  - Responsibilities: Add mobile touch action button `📯` (`btn-touch-whistle`), update HUD controls guidance, implement comprehensive unit test suite in `test/test_dog_behavior.py`, and register with `run_tests.py`.

---

## 5. Acceptance Criteria

- [x] `AC-1`: When on-leash, the dog walks closely beside the human (~38–48px) at heel, matching speed with natural lead tension.
- [x] `AC-2`: When off-leash, the dog enters autonomous roaming mode, exploring and sniffing naturally while staying within a bounded radius (~160–220px) of the human.
- [x] `AC-3`: When two dogs come within proximity (~90–120px), they approach and engage in social canine interactions (friendly sniffing, circling, tail wagging, emote bubbles, and play-bows).
- [x] `AC-4`: Triggering the whistle command (<kbd>H</kbd>, <kbd>R</kbd>, or touch button `📯`) plays a training whistle sound, causes the dog to perk up, sprint back to the human, and follow closely at heel for ~10 seconds before resuming roaming.
- [x] `AC-5`: The whistle event is synchronized over the network so other connected players hear the whistle and see the owner's dog recall to heel.
- [x] `AC-6`: All automated unit tests in `test/run_tests.py` pass with 100% green status.
