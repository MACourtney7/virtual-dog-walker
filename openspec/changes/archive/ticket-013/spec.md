# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-013"
title: "Canine Personality System & Leash Dynamics Overhaul"
state: "PLANNING"
created_at: "2026-10-11T20:13:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-013/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Currently in *Virtual Dog Walker*:
1. **Uniform Dog Behaviors**:
   - Every dog behaves with identical steering parameters, greeting probabilities, and vocalization triggers regardless of character or breed.
   - The user requested: *"dog personality menu part of customisation: (playfulness, shyness, barkyness, obidiance) out of 5 scale"*.
2. **Unrealistic Ball Chasing on Leash**:
   - Currently, if a ball is thrown while the dog is leashed, the dog can enter `FETCHING` state, violating physical reality and owner control.
   - The user requested: *"dogs do not chase ball when on leash, dogs respect lead length but can pull on lead"*.
3. **Leash Pulling Physics**:
   - When on-leash, a dog should strictly respect the lead length clamp, but should be capable of pulling against the lead (stretching the lead taut, exerting slight tension, leaning forward) when excited by moving objects or stimuli.

---

## 2. System Architecture & Technical Specifications

### 2.1 Dog Personality Engine (`src/entities/companion_dog.js`)
- **Personality Attributes (1 to 5 scale)**:
  - `playfulness` (1–5, default 3):
    - Influences frequency and speed of play-bow transitions, tail wag intensity, and enthusiasm during ball fetch.
  - `shyness` (1–5, default 2):
    - Influences social interaction radius and hesitancy when greeting unknown canine peers (high shyness = wider greeting berth, lower greeting approach probability; low shyness = eager approach).
  - `barkyness` (1–5, default 2):
    - Influences spontaneous barking probability when idle or excited, and reaction sensitivity to remote dog barks.
  - `obedience` (1–5, default 4):
    - Influences heel alignment precision, promptness of sprint recall during whistle, leash pulling resistance, and resistance to idle run-off (in `ticket-014`).
- **Personality Data Model**:
  ```javascript
  this.personality = {
    playfulness: 3,
    shyness: 2,
    barkyness: 2,
    obedience: 4
  };
  ```

### 2.2 Leash Dynamics Overhaul (`src/entities/companion_dog.js`)
- **No Ball Chasing On-Leash**:
  - In `update()` / `fetchBall()`: if `this.owner && this.owner.isLeashed`, the dog **NEVER** enters `DogState.FETCHING` and does not chase thrown balls.
  - Instead, the dog turns its head eagerly toward the ball, wags its tail if playful, and pulls against the leash toward the ball direction.
- **Leash Pulling Physics & Taut Lead Rendering**:
  - Max leash length: `105px`.
  - When the dog desires to move away from the owner (e.g. towards an active ball or distant peer):
    - Dog enters a pulling posture (`isPullingLeash = true`).
    - Distance is strictly clamped to max leash length.
    - Leash render switches from a slack catenary curve to a taut, tensioned straight line with subtle vibrational jitter.

### 2.3 Customizer UI Personality Editor (`src/ui/social_hud.js`, `src/style.css`)
- In `#customizer-modal` under the **🐕 Dog Companion** tab:
  - Add 4 personality sliders or 1–5 pip rating bars for:
    - 🎾 Playfulness (1–5)
    - 🙈 Shyness (1–5)
    - 🗣️ Barkyness (1–5)
    - 🎓 Obedience (1–5)
- Persist personality in `clifton_walker_profile` in `localStorage`.

### 2.4 Multiplayer Protocol & Net Sync (`src/net/protocol.js`, `src/main.js`)
- Include `personality` in peer metadata packet handshakes.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-013.1** | Dog companion model incorporates 4 personality traits (Playfulness, Shyness, Barkyness, Obedience on a 1–5 scale). | Unit test inspecting dog personality object |
| **AC-013.2** | Dog personality attributes modify AI steering, greeting approach frequency, and spontaneous barking. | Unit test behavioral steering simulation |
| **AC-013.3** | Leashed dog strictly NEVER breaks into `FETCHING` state or chases balls when on lead. | Unit test ball throw with leashed dog |
| **AC-013.4** | Leashed dog respects maximum lead length clamp, but pulls against lead with taut leash rendering. | Unit test distance clamp and pulling flag |
| **AC-013.5** | Personality editor integrated into Dog Companion tab of `SocialHUD` with `localStorage` persistence. | DOM and profile schema unit test |
| **AC-013.6** | Zero regressions across test suite (`python3 test/run_tests.py`). | Automated test runner execution |

---

## 4. Testing & Verification Strategy
- Implement automated test suite `test/test_dog_personality_leash.py` and integrate into `test/run_tests.py`.
