# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-021"
roadmap_id: "chat-visual-overhaul"
title: "Proximity Chat Retention Expiry & Player Color Palette"
state: "PLANNING"
created_at: "2026-10-12T20:10:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-021/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Under the current system:
1. When players leave proximity, the conversation immediately dissolves and disappears. The user specified that:
   - *"the chat history should remain in the chat sidebar for 5mins after players leave eachother's chat proximity. when a player leaves another's proximity is when the 5mins timer starts to clear their chat messages from the other player's chat side-bar history."*
2. Different players have uniform sender colors in the message list, making multi-person conversations hard to follow at a glance:
   - *"when a player is in proximity and sends a message for the first time their chat name and text should be assigned a colour so that a reader can see different players."*

---

## 2. System Architecture & Technical Specifications

### 2.1 5-Minute (300s) Message Retention Engine (`src/ui/proximity_chat.js`)
- **Retention Duration**: `RETENTION_DURATION_MS = 5 * 60 * 1000` (300,000 ms).
- **Departure Tracking**:
  - Maintain `this.departureTimers = new Map()` mapping `peerId -> departureTimestamp`.
  - When peer `P` leaves the local player's proximity cluster:
    - Record `departureTimers.set(P.id, Date.now())`.
    - Do NOT immediately delete `P`'s messages from `this.messages`.
    - If `P` returns to proximity before 5 minutes elapse, remove `P.id` from `departureTimers` (canceling message expiration).
  - In `update(dt)`:
    - Check active entries in `departureTimers`.
    - If `now - departureTimestamp >= RETENTION_DURATION_MS`:
      - Remove all messages sent by `P` from `this.messages`.
      - Prune DOM elements corresponding to `P`'s messages in `#proximity-chat-messages`.
      - Delete `P.id` from `departureTimers`.

### 2.2 Dynamic Player Color Palette (`src/ui/proximity_chat.js`, `src/style.css`)
- **Curated High-Contrast Palette**:
  - Array of accessible, vibrant colors designed for dark glassmorphism:
    - Cyan: `#38bdf8`
    - Emerald: `#4ade80`
    - Amber: `#fbbf24`
    - Coral: `#fb7185`
    - Violet: `#c084fc`
    - Mint: `#2dd4bf`
    - Peach: `#f97316`
    - Azure: `#60a5fa`
- **Color Assignment on First Message**:
  - Maintain `this.playerColors = new Map()` mapping `senderId -> colorHex`.
  - When any player (local or remote) in proximity sends their first message:
    - If not already assigned, assign the next available color from the palette (or deterministic hash of `senderId`).
    - Store mapping in `playerColors`.
- **Message Rendering**:
  - In message DOM element:
    - Apply assigned color to `.proximity-message-sender` (`color: ${assignedColor}`).
    - Apply assigned color or color accent to `.proximity-message-text` (`color: ${assignedColor}`).

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-021.1** | When a player exits proximity, their chat history remains in the sidebar for 5 minutes. | Time-stepped simulator test |
| **AC-021.2** | When the 5-minute timer expires without reconnection, that departed player's messages are purged from the sidebar. | Pruning verification test |
| **AC-021.3** | If a parted player re-enters proximity within 5 minutes, their expiration timer is cancelled and history remains. | Re-entry retention test |
| **AC-021.4** | First-time message sender in proximity is assigned a unique color from the curated palette. | Palette assignment test |
| **AC-021.5** | Message sender name and text render in the assigned player color. | DOM styling inspection |
| **AC-021.6** | Zero regressions in test runner (`python3 test/run_tests.py`). | Automated test suite execution |

---

## 4. Testing & Verification Strategy
- Python simulator tests for 5-minute retention countdown, expiration purge, and re-entry cancellation.
- DOM tests for unique color assignment and CSS styling application.
