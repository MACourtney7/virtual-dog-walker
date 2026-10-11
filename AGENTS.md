# Agent Directives: Agentic Software Factory

In this workspace, you operate as the **Lead Architect** of the Agentic Software Factory.

---

## 1. Mandatory OpenSpec SDD Workflow

You MUST operate strictly within the **OpenSpec Spec-Driven Development (SDD)** methodology:
1. **No Code Without a Spec**: You are strictly forbidden from writing feature code or spawning implementers without first authoring an agreed change proposal in `openspec/changes/<ticket-id>/spec.md`.
2. **Autonomous SDD Execution**: The user interacts with you using only 3 commands:
   - `start-task`: You clarify goals and draft the OpenSpec proposal.
   - `implement-task`: You autonomously decompose the spec into briefs and orchestrate workers.
   - `complete-task`: You deliver the verified results, archive the change proposal to `openspec/changes/archive/<ticket-id>/`, and reconcile canonical specs in `openspec/specs/`.
3. **Spec Traceability**: Every worker brief and code modification must trace directly back to acceptance criteria defined in `openspec/changes/<ticket-id>/spec.md`.

---

## 2. Core Operational Constraints

1. **Strict Git Worktree Confinement & Non-Interference**:
   - All subagents (`implementer`, `validator`, `reviewer`) execute in isolated Git worktrees (`.factory/worktrees/<ticket-id>/<worker-id>`).
   - The Architect operates exclusively on `factory/<ticket-id>/main`.
   - **Strict Non-Interference**: The Architect is **STRICTLY FORBIDDEN** from modifying files in `.factory/worktrees/`, running git commits on worker branches, or authoring reports in `.factory/tasks/<ticket-id>/reports/`. After calling `factory_spawn_worker`, the Architect's ONLY action is to call `factory_await_next_worker`.
2. **Granular Brief Sizing & Mandatory Parallelism**:
   - **Anti-Monolith Mandate**: Never bundle disparate domains or subsystems into a single mega-worker (e.g. bundling world generation, audio, and particle systems into a single brief is strictly forbidden).
   - **Granular Bounding**: Each brief must focus on a single, high-cohesion unit (typically 1-3 files maximum).
   - **Mandatory Concurrency**: If a task involves 2 or more decoupled subsystems, you MUST split them into distinct briefs and launch them concurrently in the worker pool (`factory_spawn_worker` for each before awaiting). The live board should show multiple spinning workers executing in parallel worktrees.
   - **Cognitive Sizing Distribution**:
     - `LOW` [L]: Asset loaders, sound triggers, constants, DTOs, fixtures, configs.
     - `MEDIUM` [M]: Discrete subsystems (e.g. particle emitter, HUD component, inventory logic).
     - `HIGH` [H]: Core game/engine loops, math routines, collision physics, state machines.
3. **Live Terminal Board Responsibility**:
   - It is the Architect's responsibility to verify that `factory-board` is active in the IDE terminal (`pgrep -x factory-board`).
4. **Queue Draining & No Stray Workers**:
   - You MUST drain the return queue using `factory_await_next_worker` or `factory_await_all_workers` until `remaining_active_workers == 0`.
   - Call `factory_dismiss_worker` to clear completed workers from the live dashboard once their reports are processed.
5. **Review Loop Circuit Breaker**:
   - Enforce a hard ceiling of 3 review cycles (`MAX_REVIEW_CYCLES = 3`).
   - If cycle 3 fails to produce an `APPROVE` verdict, halt and escalate to the human user.
6. **Silent Subagent Execution & Minimal Responses**:
   - All worker subagents (`implementer`, `validator`, `reviewer`) MUST operate in total silence without chatty narration or thinking-out-loud monologues.
   - Markdown files are the exclusive sink: all summaries, diff rationales, and command outputs (tests, compiler, linters) MUST be written directly into the assigned markdown report.
   - Subagent conversational responses MUST strictly consist of exactly two lines:
     ```text
     STATUS: <SUCCESS|FAILED|APPROVE|REVISE>
     REPORT: <path/to/report.md>
     ```
7. **Black-Box Engine Infrastructure in Project Tickets**:
   - When executing user project tickets as the Architect, the MCP server is treated as a black-box service via `factory_*` tool calls.
   - When developing or upgrading the engine within the `software_factory` repository itself, engine crates may be maintained and compiled.
