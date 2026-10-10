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

### Configuration

Automation commands for tests, builds, and linters can be customized in [`factory.yaml`](file:///Users/mattcourtney/Library/CloudStorage/GoogleDrive-mattadam.courtney@gmail.com/My%20Drive/some_kind_of_game/factory.yaml).
