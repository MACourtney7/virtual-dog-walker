# Virtual Dog Walker (Clifton Commons)

An open-world, 2D decentralized peer-to-peer (P2P) social dog-walking simulation set in Clifton Down (Bristol, UK). Powered by pure WebAssembly physics, real-time spatial simulation, and the serverless `zero_network` protocol stack.

**Live Client:** [https://virtual-dog-walker.pages.dev](https://virtual-dog-walker.pages.dev)

---

## 1. Architecture & The `zero_network` Polyrepo Stack

Virtual Dog Walker operates as a member of the unified 4-repository `zero_network` ecosystem:

1. **`zero_protocol`**: Shared core Rust workspace containing cryptographic and network protocols:
   - Synchronous cryptographic primitives (X25519, Ed25519, ChaCha20-Poly1305, HMAC-SHA256).
   - Envelope serialization and blind dead-drop signaling protocols.
   - `zero_mesh`: Pure Rust WebRTC DataChannel full-mesh coordinator compiled to WebAssembly (`wasm32-unknown-unknown`).
2. **`zero_network`**: Cloudflare Worker edge signaling infrastructure using WebSocket Hibernation:
   - `DeadDropRoom` Durable Object providing blind, zero-trust rendezvous matchmaking (`GET /match/:room`, `POST /stage/:room`, `POST /drop/:room/:uuid`).
   - Dynamic ephemeral STUN/TURN credential provisioning (`GET /ice`).
3. **`zero_chat`**: Serverless, zero-footprint ephemeral encrypted messaging client:
   - Provider of the canonical, reusable `ZeroChatWidget` (`zero_chat_widget.js` & `zero_chat_widget.css`).
4. **`virtual_dog_walker`**: The frontend game application:
   - **Physics & Simulation Engine**: Native Rust core compiled to Wasm (`crates/dog_walker_core`).
   - **P2P Multiplayer Mesh**: `ZeroMeshNetworkManager` backed by `zero_mesh` Wasm.
   - **Deterministic NPC Simulation**: P2P coordinator election with pre-warmed ambient path traversal and nocturnal streetlight visibility cutouts.
   - **Proximity Chat**: Embedded `ZeroChatWidget` with spatial hysteresis (160px join / 200px leave), 5-minute retention, and distributed per-message flame burn (`PROXIMITY_BURN_MSG`) & session wipe (`PROXIMITY_BURN_ALL`).

---

## 2. Directory Structure

```text
virtual_dog_walker/
├── crates/
│   └── dog_walker_core/      # Pure Rust physics engine (leash constraint, ball flight, collisions)
├── src/
│   ├── engine/               # Simulation bridge to dog_walker_core Wasm
│   ├── entities/             # Owner, Companion Dog, Tennis Ball, NPC entities
│   ├── net/                  # ZeroMeshNetworkManager P2P WebRTC networking
│   ├── systems/              # Spatial audio, weather simulation
│   ├── ui/                   # Social HUD, Touch Controls, embedded ZeroChatWidget
│   ├── wasm/                 # zero_mesh compiled Wasm bundle
│   ├── wasm_core/            # dog_walker_core compiled Wasm bundle
│   └── world/                # Clifton Down field map, paths, and nocturnal lighting
├── scripts/
│   ├── build_wasm.sh         # Compiles Wasm bundles & syncs ZeroChatWidget from zero_chat
│   └── build_pages.sh        # Assembles static Cloudflare Pages distribution bundle in dist/
├── test/                     # Python integration, simulation, and contract test suite
├── index.html                # Main game canvas & UI mount points
└── wrangler.jsonc            # Cloudflare Pages configuration
```

---

## 3. Development & Build Commands

### Prerequisites
- [Rust](https://rustup.rs/) (with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`)
- [Node.js & npm](https://nodejs.org/)
- [Python 3](https://python.org/)

### Building WebAssembly Bundles
Compiles `dog_walker_core` and `zero_mesh` into `src/wasm_core/` and `src/wasm/`, and synchronizes `ZeroChatWidget` from `../zero_chat`:
```bash
npm run build:wasm
```

### Static Pages Distribution Bundle
Assembles production distribution files in `dist/`:
```bash
npm run build
```

### Local Development Server
Builds assets and starts the Cloudflare Pages local development server:
```bash
npm run dev
```

### Manual Deploy
Builds distribution bundle and deploys to Cloudflare Pages:
```bash
npm run deploy
```

---

## 4. Testing

### Run Native Rust Unit Tests
Verifies physics routines, leash clamping, and bounce restitution in `crates/dog_walker_core`:
```bash
cargo test
```

### Run Full Integration & Simulation Suite
Executes end-to-end integration tests covering entity interpolation, network protocol schemas, proximity chat hysteresis, and NPC lifecycle:
```bash
python3 test/run_tests.py
```

---

## 5. Deployment & CI/CD

The production game client is hosted on **Cloudflare Pages** at [https://virtual-dog-walker.pages.dev](https://virtual-dog-walker.pages.dev).

### CI/CD Pipeline
Continuous integration and deployment are automated via GitHub Actions in `.github/workflows/ci.yml`:
1. **Test Job**: Runs on all pushes and pull requests. Installs the Rust toolchain with target `wasm32-unknown-unknown`, checks out sibling repositories (`zero_protocol`, `zero_chat`), and executes `cargo test` and `python3 test/run_tests.py`.
2. **Deploy Job**: Runs on push to `main` (and `workflow_dispatch`). Assembles production assets via `npm run build` and deploys `dist/` directly to Cloudflare Pages project `virtual-dog-walker`.

### Required GitHub Secrets
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Cloudflare Pages: Edit` permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier.
