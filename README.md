# some_kind_of_game

A game project developed using the **Agentic Software Factory**.

---

## Getting Started

This repository is configured with the **Agentic Software Factory** multi-agent development engine and **OpenSpec Spec-Driven Development (SDD)**.

### Development Workflow

1. **Start Task**: Invoke `start-task` with the Architect to specify the game concept, mechanics, and technical architecture in `openspec/changes/<ticket-id>/spec.md`.
2. **Implement Task**: Trigger `implement-task` to decompose the approved spec into cognitive-sized worker briefs, dispatching Implementer, Validator, and Reviewer subagents in isolated Git worktrees.
3. **Complete Task**: Run `complete-task` to merge and archive completed changes into `openspec/specs/`.

### Live Factory Board

To monitor active subagents and tasks in real time, launch the TUI board in a terminal:

```bash
"/Users/mattcourtney/Library/CloudStorage/GoogleDrive-mattadam.courtney@gmail.com/My Drive/software_factory/target/release/factory-board"
```

### Multiplayer Hosting & Playing

Clifton Down supports global edge multiplayer and dedicated local hosting with **zero port forwarding**:

1. **Global Edge Rooms (PartyKit - Zero Install / 100% In-Browser)**:
   - **Local Edge Dev**:
     ```bash
     npm run party:dev
     ```
     Runs local edge emulation at `http://localhost:1999`. Open in multiple browser tabs to test multiplayer locally.
   - **Deploy to Global Edge ($0 Cost)**:
     ```bash
     npm run party:deploy
     ```
     Deploys the room relay and static game frontend to `https://clifton-down.<subdomain>.partykit.dev`. Anyone can open the link in any web browser and play immediately with zero server installs!

2. **Dedicated Local Microserver (Python + Zero-Port Tunnel)**:
   ```bash
   python3 server/host.py
   ```
   Starts a local background microserver and generates a secure Cloudflare Quick Tunnel link:
   ```text
   🌐 Public Link: https://<subdomain>.trycloudflare.com/?server=...&room=clifton-field
   ```

3. **Offline / Solo Mode**:
   Open `index.html` directly in your browser or run any static HTTP server.

### Configuration

Automation commands for tests, builds, and linters can be customized in [`factory.yaml`](file:///Users/mattcourtney/Library/CloudStorage/GoogleDrive-mattadam.courtney@gmail.com/My%20Drive/some_kind_of_game/factory.yaml).
