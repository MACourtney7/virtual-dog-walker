# Project Overview: some_kind_of_game

## 1. Description
`some_kind_of_game` is an upcoming game project developed using the **Agentic Software Factory** workflow with OpenSpec Spec-Driven Development (SDD).

## 2. Status & Architecture
- **Stage**: Project Kickoff & Initialization
- **Architecture**: SDD with isolated Git worktrees for subagents (`implementer`, `validator`, `reviewer`) orchestrated by the `architect`.
- **Target Tech Stack**: Configurable in `factory.yaml`.

## 3. Workflow Commands
- `start-task`: Kick off specification authoring in `openspec/changes/<ticket-id>/spec.md` with the Architect.
- `implement-task`: Autonomous decomposition into briefs and worker dispatch across isolated worktrees.
- `complete-task`: Reconcile canonical specs into `openspec/specs/` and archive completed changes.
