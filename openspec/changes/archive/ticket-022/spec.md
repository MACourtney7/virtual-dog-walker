# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-022"
roadmap_id: "chat-visual-overhaul"
title: "Speech Bubble Duality Routing & Comprehensive Test Suite"
state: "PLANNING"
created_at: "2026-10-12T20:10:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-022/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Under the current implementation, speech bubbles and chat sidebar messages trigger simultaneously or unpredictably.

The user specified strict rules for speech bubble vs sidebar duality:
1. **Out of Proximity**:
   - *"when a player is not in another player's proximity their text should be visible above their head as a speachbubble and their text should not be added into their chat side-bar."*
2. **In Proximity**:
   - *"when players' are in eachother's proximity their chat should only appear in their chat side-bar they should not show a speachbubble above their head."*
3. **Comprehensive Verification**:
   - Fully integrate all 5 tickets of the roadmap and guarantee 100% test coverage across the chat visual overhaul.

---

## 2. System Architecture & Technical Specifications

### 2.1 Speech Bubble vs Sidebar Routing (`src/main.js`, `src/entities/owner.js`)
- **Proximity Chat Dispatch**:
  - When local player sends message via `#proximity-chat-input`:
    - Since local player is in proximity: add to local sidebar via `proximityChat.submitMessage(text)`.
    - Do NOT call `this.owner.setChat(text)` (suppressing overhead speech bubble).
  - When remote peer sends `PROXIMITY_CHAT`:
    - Add to sidebar via `this.proximityChat.addMessage(...)`.
    - Do NOT call `p.owner.setChat(text)` (suppressing remote overhead speech bubble).
- **Out-of-Proximity / Solo Chat Dispatch**:
  - When player sends message via `#chat-input` (or Enter key when no cluster is active):
    - Call `this.owner.setChat(text)` (displaying overhead speech bubble).
    - Do NOT add to `proximityChat.messages` (keeping sidebar clear of out-of-range broadcast chatter).
    - If remote peer receives `CHAT_MESSAGE` while not in proximity: display `p.owner.setChat(text)` (overhead speech bubble only) and do NOT add to `proximityChat`.

### 2.2 Comprehensive Test Suite (`test/test_proximity_chat.py`, `test/run_tests.py`)
- Overhaul `test/test_proximity_chat.py` to test:
  - Removal of tombstone dropping behavior and clean parting turf.
  - Top-bar button relocation away from the top-right corner.
  - Top-right chat sidebar positioning, toggle button, and auto-unhide behavior.
  - 5-minute chat retention countdown on departure and expiration purge.
  - Retention recovery when re-entering proximity within 5 minutes.
  - Dynamic player color assignment from curated palette on first message.
  - Exclusivity: In-proximity chat produces sidebar messages and suppresses speech bubbles; out-of-proximity chat produces speech bubbles and bypasses sidebar.
- Run `python3 test/run_tests.py` to verify full green suite.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-022.1** | In-proximity chat messages appear in the chat sidebar with overhead speech bubbles suppressed. | Avatar drawing test & chat message assertions |
| **AC-022.2** | Out-of-proximity messages appear as overhead speech bubbles with zero entries in the chat sidebar. | Message router isolation unit test |
| **AC-022.3** | Automated test suite in `test/test_proximity_chat.py` passes all ACs across tickets 018 through 022. | Automated test suite execution |
| **AC-022.4** | All existing test suites pass cleanly via `python3 test/run_tests.py`. | Regression run verification |

---

## 4. Testing & Verification Strategy
- Update `test/test_proximity_chat.py` with full simulator and DOM assertion coverage.
- Execute full runner `python3 test/run_tests.py`.
