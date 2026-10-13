# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-019"
roadmap_id: "chat-visual-overhaul"
title: "HUD Top-Bar Reorganization & Button Relocation"
state: "PLANNING"
created_at: "2026-10-12T20:10:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-019/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Currently, `SocialHUD` positions two floating panels at the top edge of the screen:
- Top-Left: "The Downs" title badge, room mode badge, and player count pill.
- Top-Right: "Share Park" button (`#btn-room-action`) and "Style" button (`#btn-customize`).

Placing the buttons in the top-right corner conflicts directly with the new chat sidebar and collapsible chat toggle icon.

The goal of this ticket is to:
1. Relocate the "Share Park" and "Style" buttons away from the top-right corner, grouping them neatly into the top-left HUD panel.
2. Ensure the top-right corner of the viewport is completely vacant for the new chat sidebar and toggle button.
3. Preserve all button IDs, styling, responsive behaviors, and event listeners.

---

## 2. System Architecture & Technical Specifications

### 2.1 DOM Restructuring (`src/ui/social_hud.js`)
- Consolidate the HUD structure inside `#hud-overlay`:
  - Group "The Downs" title, player count pill, "Share Park" button (`#btn-room-action`), and "Style" button (`#btn-customize`) within the top-left container.
  - Remove the dedicated top-right `.hud-panel` block from `#hud-overlay`.

### 2.2 CSS Layout & Responsive Styling (`src/style.css`)
- Update `#hud-overlay`:
  - Align items cleanly along the top-left edge.
  - Ensure `.hud-panel` wraps or shrinks gracefully on smaller screen viewports (mobile/tablet 360px–768px).
- Maintain distinct pill and button aesthetics:
  - "The Downs" pill retains forest green / slate styling.
  - "Share Park" button retains blue gradient styling (`.btn-share`).
  - "Style" button retains subtle translucent glass style with 🎨 icon.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-019.1** | "Share Park" (`#btn-room-action`) and "Style" (`#btn-customize`) buttons are located in the top-left area alongside park badges. | DOM node structure inspection test |
| **AC-019.2** | The top-right corner of the screen contains zero conflicting HUD buttons across desktop and mobile viewports. | CSS selector & bounding layout test |
| **AC-019.3** | Clicking "Share Park" continues to copy the URL or trigger prompt, and clicking "Style" opens the customizer modal. | Event listener verification |
| **AC-019.4** | Zero regressions in automated test runner (`python3 test/run_tests.py`). | Automated test suite execution |

---

## 4. Testing & Verification Strategy
- Add DOM structure assertions in test suite to verify top-right clearance and top-left grouping.
- Ensure no button listeners are broken by DOM repositioning.
