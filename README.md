# Virtual Dog Walker (Clifton Down)

A multiplayer social dog-walking sandbox game built with HTML5 Canvas, Web Audio API, and Cloudflare PartyServer edge multiplayer, developed using the **Agentic Software Factory**.

---

## Getting Started

This repository is configured with the **Agentic Software Factory** multi-agent development engine and **OpenSpec Spec-Driven Development (SDD)**.

### Development Workflow

1. **Start Task**: Invoke `/start-task` with the Architect to specify the game concept, mechanics, and technical architecture in `openspec/changes/<ticket-id>/spec.md`.
2. **Implement Task**: Trigger `/implement-task` to decompose the approved spec into cognitive-sized worker briefs, dispatching Implementer, Validator, and Reviewer subagents in isolated Git worktrees.
3. **Complete Task**: Run `/complete-task` to merge and archive completed changes into `openspec/specs/`.

### Live Factory Board

To monitor active subagents and tasks in real time, launch the TUI board in a terminal:

```bash
"/Users/mattcourtney/Library/CloudStorage/GoogleDrive-mattadam.courtney@gmail.com/My Drive/software_factory/target/release/factory-board"
```

---

## Multiplayer Hosting & Deployment

Clifton Down supports global edge multiplayer, automated GitHub CI/CD, and dedicated local hosting with **zero port forwarding**:

### 1. Always-Open Public Commons (Cloudflare PartyServer & Durable Objects)
- **Single Shared Park**: By default, all players join **The Commons** (`the-commons`) together. No rooms to create, no codes needed.
- **Local Edge Dev**:
  ```bash
  npm run dev
  ```
  Runs local Cloudflare emulation with Wrangler (`http://localhost:8787`).
- **Manual CLI Deploy**:
  ```bash
  npm run deploy
  ```
  Deploys directly to `https://virtual-dog-walker.<your-subdomain>.workers.dev`.

### 2. Automated Free CI/CD (GitHub Actions $\rightarrow$ Cloudflare Workers)
On every push to `main`, GitHub Actions automatically:
1. Runs the complete test suite (`test/run_tests.py`) with a 3-minute safety timeout.
2. If tests pass, deploys the game and PartyServer relay to Cloudflare Workers automatically.

**Zero-Cost Safety Safeguards**:
- **GitHub**: Actions spending limit defaults to **$0.00**. Test suite completes in ~12 seconds.
- **Cloudflare**: Workers Free Tier provides **100,000 requests/day** with hard cut-off (no automatic overage billing).

**Connecting Your Cloudflare Account**:
Add these two free secrets to GitHub (**Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions**):
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with the template *Edit Cloudflare Workers*.
- `CLOUDFLARE_ACCOUNT_ID`: Your 32-character Account ID from the Cloudflare Dashboard sidebar.

*(If secrets are not yet configured, the deployment job cleanly skips and issues a warning without failing).*

### 3. Dedicated Local Microserver (Python + Zero-Port Tunnel)
```bash
python3 server/host.py
```
Starts a local background microserver and generates a secure Cloudflare Quick Tunnel link:
```text
🌐 Public Link: https://<subdomain>.trycloudflare.com/?server=...&room=clifton-field
```

### 4. Offline / Solo Mode
Open `index.html` directly in your browser or run any static HTTP server.

---

## Automated Test Suite

Run the master test suite:

```bash
python3 test/run_tests.py
```
