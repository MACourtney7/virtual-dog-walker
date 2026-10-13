# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-020"
roadmap_id: "chat-visual-overhaul"
title: "Top-Right Downward Chat Sidebar, Toggle Button & Auto-Unhide"
state: "PLANNING"
created_at: "2026-10-12T20:10:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-020/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

The current `#proximity-chat-panel` sits in the bottom-right corner of the screen, floating over game action and dog navigation, and cannot be collapsed by the player.

The user requirements mandate:
1. **Top-Right Locked Placement**: The chat sidebar must be locked to the top-right side of the screen and grow downward.
2. **Toggle Button**: A chat icon button (💬) must be positioned in the top-right corner to allow players to show/hide the chat sidebar.
3. **Auto-Unhide**: When players are in each other's proximity and ANY message is sent or received, if the chat sidebar was hidden, it must be automatically unhidden!
4. **Non-Intrusive Aesthetics**: Sleek glassmorphic container that preserves visibility of the game while keeping active conversation clear.

---

## 2. System Architecture & Technical Specifications

### 2.1 Top-Right Toggle Button (`src/ui/proximity_chat.js`, `src/style.css`)
- Introduce `#chat-toggle-btn`:
  - Fixed position: `top: 16px; right: 16px; z-index: 60;`.
  - Glassmorphic circular or rounded-pill button with chat icon `💬`.
  - Clicking toggles the sidebar between hidden and active states.
  - Active/collapsed indicator state.

### 2.2 Downward Sidebar Positioning (`src/ui/proximity_chat.js`, `src/style.css`)
- Update `#proximity-chat-panel`:
  - Position: `position: fixed; top: 64px; right: 16px; width: 340px; max-width: calc(100vw - 32px);`.
  - Height & Growth: `max-height: calc(100vh - 120px); display: flex; flex-direction: column;`.
  - Messages thread: `flex: 1; overflow-y: auto;` growing downwards.
  - Retain header (participant pills), messages list, quick emoji buttons, and text input bar.

### 2.3 Auto-Unhide Logic (`src/ui/proximity_chat.js`)
- Maintain internal boolean: `this.isManuallyHidden = false`.
- On toggle button click: flip state between visible and hidden.
- When `addMessage` is invoked while players are in proximity:
  - If the sidebar is currently hidden/collapsed, invoke `showHUD()` / clear hidden state so the message is immediately visible to the player.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-020.1** | Chat sidebar is fixed to the top-right side of the screen and grows vertically downward. | CSS layout assertions |
| **AC-020.2** | Top-right chat icon button toggles the chat sidebar visibility between shown and hidden. | DOM click event unit test |
| **AC-020.3** | When players are in proximity and a message is added, the chat sidebar automatically unhides if it was hidden. | Auto-unhide state test |
| **AC-020.4** | Message input bar and quick emoji buttons allow sending messages in the downward thread. | Send submission unit test |
| **AC-020.5** | Zero regressions in test runner (`python3 test/run_tests.py`). | Automated test suite execution |

---

## 4. Testing & Verification Strategy
- Add DOM structure tests verifying top-right placement, toggle button existence, show/hide class toggling, and auto-unhide event dispatch.
