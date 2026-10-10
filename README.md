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

Clifton Down supports dedicated multiplayer with **zero port forwarding**:

1. **Host a Dedicated Park (Public Tunnel)**:
   ```bash
   python3 server/host.py
   ```
   This automatically starts the local asynchronous microserver and generates a secure, zero-config public invite link (via Cloudflare Quick Tunnel) that you can send to friends anywhere:
   ```text
   🌐 Public Link: https://<subdomain>.trycloudflare.com/?server=...&room=clifton-field
   ```
   Guests simply open the link in any web browser to join your park.

2. **Offline / Solo Mode**:
   Open `index.html` directly in your browser or run a standard static file server.

### Configuration

Automation commands for tests, builds, and linters can be customized in [`factory.yaml`](file:///Users/mattcourtney/Library/CloudStorage/GoogleDrive-mattadam.courtney@gmail.com/My%20Drive/some_kind_of_game/factory.yaml).
