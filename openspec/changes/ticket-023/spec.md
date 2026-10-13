# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-023"
title: "UI Refinements: Toolbar & Button Streamlining, Cog Icon & Chat Hotkey"
state: "PLANNING"
created_at: "2026-10-13T21:35:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-023/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

The user requested a set of UI streamline and declutter refinements to simplify the game interface, eliminate redundant buttons, retire manual barking in favor of autonomous canine behavior, improve desktop key navigation, and align the visual aesthetic:
1. **Remove "Share Park" button**: Eliminate the `#btn-room-action` button from the top-left HUD panel.
2. **Retire Manual Bark Feature & Remove Bark Buttons**:
   - Retire the manual bark trigger entirely: pressing the `B` key on the keyboard should no longer trigger a bark.
   - Remove the touch bark button (`#btn-touch-bark`) from the mobile touch action pad.
   - Dogs should only bark of their own accord (autonomous canine behavior based on personality barkyness rolls, NPC reactions, and peer responses).
3. **Remove bottom toolbar**: Remove `#controls-hint` so no keybindings bar is displayed across the bottom of the game view.
4. **Clean speech bubble chat input**: After pressing Enter to chat via speech bubble, remove the emoji button group (`#quick-emotes`) so only the `#chat-input` text field remains.
5. **Relocate Style button as Cog icon**: Move `#btn-customize` to the top-right corner docked adjacent to the group chat icon (`#chat-toggle-btn`), remove the "Style" text, and render exclusively with a cog icon (`⚙️`).
6. **Top-left Title Purity**: Remove "Clifton Commons" text from the top-left bar badge so the header strictly presents "The Downs".
7. **Chat Window Hotkey**: Add `C` / `c` keybinding to toggle (hide/show) the proximity group chat window when the player is not actively typing in an input field.
8. **Group Chat Window Input Streamlining**: Remove the emoji button bar and the send button from the bottom of the proximity group chat window so only the text input box (`#proximity-chat-input`) remains.

---

## 2. System Architecture & Technical Specifications

### 2.1 HUD Overlay & Button Streamlining (`src/ui/social_hud.js`, `src/style.css`)
- **Top-Left Panel**:
  - Remove `<button class="btn-share" id="btn-room-action">` from `.hud-panel`.
  - Guard all references to `btn-room-action` and `btn-room-label` in `social_hud.js` with optional chaining / null checks.
  - Update `updateNetworkState(status, message)`: replace `badge.textContent = '🌳 Clifton Commons'` with `badge.textContent = 'Online'` (with `#059669` green background) so "Clifton Commons" is never displayed in the top-left header.
- **Top-Right Cog Button**:
  - Relocate `#btn-customize` out of `.hud-panel` and style it fixed in the top-right dock:
    - Desktop: `position: fixed; top: 16px; right: 66px; width: 42px; height: 42px; border-radius: 50%;`
    - Mobile (`max-width: 768px`): `top: 12px; right: 58px; width: 38px; height: 38px;`
  - Style `#btn-customize` with circular glassmorphic aesthetics matching `#chat-toggle-btn`.
  - Replace button content with `<span class="style-toggle-icon">⚙️</span>` without any "Style" text label.
  - Preserve click listener wiring to launch `#customizer-modal`.
- **Bottom Toolbar Removal**:
  - In `src/ui/social_hud.js`, remove keybinding text injection into `#controls-hint`.
  - In `src/style.css`, enforce `#controls-hint { display: none !important; }`.
- **Speech Bubble Input Bar**:
  - Remove `#quick-emotes` element and `.emote-btn` buttons from `#chat-container`.
  - Keep `#chat-container` displaying only `#chat-input` with clean glassmorphic styling.

### 2.2 Removal of Manual Barking & Touch Action Pad Streamlining (`src/main.js`, `src/ui/touch_controls.js`)
- **Retire Manual Bark Keyboard Handler**:
  - In `src/main.js`, remove `case 'KeyB':` from `bindInputs()`. Pressing the `B` key does not trigger barking.
  - Remove `this.barkDog()` method or mark it deprecated, ensuring dogs only bark autonomously via `CompanionDog.update()`.
  - Autonomous bark rolls (personality `barkyness`, responses to joggers, and responses to other dogs) remain fully functional.
- **Touch Action Pad Streamlining**:
  - In `TouchControls.init()`, remove `<button class="touch-action-btn" id="btn-touch-bark" aria-label="Bark">🐕</button>` from `#touch-action-pad`.
  - Remove `onBark` callback invocation and binding from `TouchControls`.

### 2.3 Proximity Group Chat Hotkey & Visibility (`src/ui/proximity_chat.js`, `src/main.js`)
- **Proximity Chat Controller**:
  - Implement public method `toggleVisibility()` on `ProximityChatHUD`:
    ```javascript
    toggleVisibility() {
      if (this.isVisible()) {
        this.hideHUD();
        this.isManuallyHidden = true;
      } else {
        this.showHUD();
        this.isManuallyHidden = false;
      }
    }
    ```
  - Update toggle button click handler to delegate to `toggleVisibility()`.
- **Keyboard Listener**:
  - In `CliftonDownGame.bindInputs()` in `src/main.js`:
    ```javascript
    case 'KeyC':
      e.preventDefault();
      if (this.proximityChat) {
        this.proximityChat.toggleVisibility();
      }
      break;
    ```
  - Ensure the existing input guard (`document.activeElement === chatInput || document.activeElement === proxInput`) prevents `KeyC` from triggering while typing chat messages.

### 2.4 Proximity Group Chat Input Area Streamlining (`src/ui/proximity_chat.js`, `src/style.css`)
- **DOM Restructuring in `ProximityChatHUD.initHUD()`**:
  - Remove `.proximity-emoji-bar` and all child `.proximity-emoji-btn` buttons from `#proximity-chat-input-container`.
  - Remove `#proximity-chat-send-btn` from `#proximity-chat-input-bar`.
  - `#proximity-chat-input-container` contains solely `#proximity-chat-input-bar` wrapping `#proximity-chat-input`.
- **Controller Updates**:
  - Remove `this.emojiBtns` and `this.sendBtn` binding and listeners (or guard them as null-safe).
  - Pressing Enter inside `#proximity-chat-input` remains the primary method for submitting messages to the proximity group chat.
- **Styling**:
  - In `src/style.css`, `#proximity-chat-input` spans 100% of the input row cleanly.
  - Remove unnecessary margins or padding previously allocated for the emoji bar and send button.

### 2.5 Automated Testing & Regression Suite (`test/test_social_hud_layout.py`, `test/test_proximity_chat.py`)
- Update `test/test_social_hud_layout.py` to assert:
  - Absence of `#btn-room-action` in DOM.
  - Relocation and styling of `#btn-customize` as a top-right cog icon button without "Style" text.
  - Absence of keybinding controls in `#controls-hint`.
  - Absence of `#quick-emotes` in `#chat-container`.
  - Badge text does not contain "Clifton Commons".
- Update `test/test_proximity_chat.py` to assert:
  - `KeyB` does not exist in `main.js` input switch (pressing B does not bark).
  - `#btn-touch-bark` is absent from touch controls DOM.
  - Autonomous dog barking logic remains intact in companion dog simulation.
  - `C` keydown event triggers `toggleVisibility()`, and is ignored when typing in chat.
  - Absence of `.proximity-emoji-bar` and `#proximity-chat-send-btn` in `#proximity-chat-panel`.
  - `#proximity-chat-input` remains present and functional upon pressing Enter.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-023.1** | "Share Park" button (`#btn-room-action`) is completely removed from the UI. | DOM inspection & `test_social_hud_layout.py` |
| **AC-023.2** | Manual Bark feature is retired: pressing `B` does not make the dog bark, and `#btn-touch-bark` is removed from touch controls. Dogs only bark autonomously of their own accord. | Keyboard switch inspection, DOM assertion & autonomous simulation test |
| **AC-023.3** | Bottom toolbar (`#controls-hint`) is removed so no keybindings are displayed at the bottom of the game view. | DOM inspection & CSS assertion |
| **AC-023.4** | Speech bubble chat bar (`#chat-container`) contains only the text input box without quick emoji buttons. | DOM inspection & chat bar assertions |
| **AC-023.5** | Style button (`#btn-customize`) is relocated to the top-right adjacent to the group chat icon, displays only a cog icon (`⚙️`) with no "Style" text, and opens the modal. | CSS layout & DOM assertion |
| **AC-023.6** | "Clifton Commons" is removed from the top-left bar badge so only "The Downs" is shown as the park title. | DOM text assertion on network connect |
| **AC-023.7** | Pressing `C` / `c` toggles the proximity group chat panel visibility, but is ignored when typing in chat input fields. | Keyboard event unit test & simulation |
| **AC-023.8** | Proximity group chat panel (`#proximity-chat-panel`) bottom area contains solely the text input box (`#proximity-chat-input`), with emoji buttons and the send button removed. | DOM inspection & `test_proximity_chat.py` |
| **AC-023.9** | Full test suite passes cleanly via `python3 test/run_tests.py`. | Regression run verification |

---

## 4. Testing & Verification Strategy
- Execute `python3 test/test_social_hud_layout.py`.
- Execute `python3 test/test_proximity_chat.py`.
- Execute full test runner `python3 test/run_tests.py`.
