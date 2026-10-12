# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-015"
title: "Ad-Hoc Proximity Group Chat & Tombstone Lifecycle"
state: "PLANNING"
created_at: "2026-10-11T20:13:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-015/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

Currently in *Virtual Dog Walker*:
1. **Chat is Global & Fleeting**:
   - Chat messages are broadcast globally across the entire room with brief floating overhead speech bubbles that disappear after a few seconds.
   - The user specified that **chat is a key feature of the game** and requires an intimate, spatial, and ad-hoc social experience:
     - *"chats should form ad-hoc based on proximity, chats are formed with other players when they are close enough to eachother, this can include multiple players, as players move in/out of proximity to 'join/leave' the chat, if players walk alongside they stay in the chat with one and other, when players walk away and are in no proximity with players the chat falls to the ground as a 'tombstone' that fades away"*
     - *"chats should be a key feature on screen when they form"*

---

## 2. System Architecture & Technical Specifications

### 2.1 Spatial Proximity Clustering (`src/ui/proximity_chat.js`)
- **Proximity Detection Radius**:
  - Distance threshold: `200 px` between owner avatars.
- **Dynamic Cluster Formation**:
  - Spatial clustering evaluates distances between local player and remote players.
  - When 2 or more players are within 200px, a conversation cluster is formed.
  - Multi-player support: Any player walking within 200px of any participant in the cluster dynamically joins the conversation.
  - Walking Alongside: As players walk together, their inter-player distance remains under 200px, keeping the conversation seamlessly active.

### 2.2 Prominent On-Screen Conversation HUD (`src/ui/proximity_chat.js`, `src/style.css`)
- **Active Cluster UI**:
  - When a cluster forms, a prominent, glassmorphic conversation panel smoothly slides in on-screen.
  - Displays:
    - Active participants badge (e.g. `💬 Chat with: Walker, Sarah`).
    - Scrolling conversation message thread.
    - Prominent input bar with quick emoji triggers (👋, 🐾, ❤️, ☕).
  - High visibility ensures players immediately recognize they are in an active conversation.

### 2.3 Parting "Tombstone" Lifecycle (`src/entities/tombstone.js`, `src/world/field.js`)
- **Tombstone Dropping Event**:
  - When a player walks away and is no longer in proximity with any conversation partner:
    - The active conversation panel closes.
    - A `ChatTombstone` entity is spawned at the parting world coordinate `(x, y)`.
- **Tombstone Visuals & Lifecycle**:
  - Rendered on turf with 2D depth sorting (`depthY = y + 8`).
  - Styled as an elegant, weathered stone park marker / memorial plaque displaying:
    - Carved stone silhouette with soft ground drop shadow.
    - Snippet of the final chat message or participant names.
  - Fading Dissolve: Lifespan of 10 seconds; alpha smoothly decays from 1.0 to 0.0 before the entity is culled from `Field`.

### 2.4 Multiplayer Packet Protocol (`src/net/protocol.js`, `party/server.js`)
- Proximity chat messages relayed with sender coordinates and cluster context.
- Tombstone drop event packet or local instantiation based on parting peer distance.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-015.1** | Dynamic proximity clustering detects players within 200px and establishes ad-hoc group conversation. | Unit test spatial clustering math |
| **AC-015.2** | Prominent on-screen conversation HUD activates when 2+ players enter proximity. | DOM & UI visibility unit test |
| **AC-015.3** | Walking alongside maintains active conversation without disconnection. | Locomotion simulation unit test |
| **AC-015.4** | Players dynamically join/leave cluster as they move into or out of proximity range. | Multi-agent proximity state test |
| **AC-015.5** | Exiting proximity with all peers drops a world-space `ChatTombstone` that fades away over 10 seconds. | Tombstone entity lifecycle unit test |
| **AC-015.6** | Zero regressions in test runner (`python3 test/run_tests.py`). | Automated test runner execution |

---

## 4. Testing & Verification Strategy
- Implement automated test suite `test/test_proximity_chat.py` and integrate into `test/run_tests.py`.
