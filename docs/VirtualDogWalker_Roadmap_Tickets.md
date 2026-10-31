VirtualDogWalker Roadmap Tickets
Below are the 3 sequential tickets for your implementation agent to execute, formatted as OpenSpec Task Briefs.



ticket_id: "ticket-029"

title: "Edge-to-Edge Global NPC Paths, Relaxed Pacing, and Authoritative Sync Hardening"

role: "IMPLEMENTER"

thinking_level: "MEDIUM"

target_files:

  - "src/entities/npc_content.js"

  - "src/entities/npc.js"

  - "src/world/npc_paths.js"

  - "src/world/npc_path_manifest.json"

  - "party/server.js"

  - "src/main.js"

  - "src/net/network.js"

  - "test/test_npc_content.py"

  - "test/test_npc_paths.py"

  - "test/test_npc_entity.py"

  - "test/test_npc_server.py"

  - "test/test_npc_client.py"
1. Problem Statement & Objectives
The current NPC implementation suffers from four user-visible issues:

Interior Spawning/Despawning: 6 of the 10 paths in src/world/npc_paths.js are closed loops whose start and end waypoints lie inside the central park (e.g., central-meadow-ramble starts and ends at (1200, 950) near the player spawn). NPCs materialize and vanish in the middle of the meadow rather than entering and exiting at the map boundaries.
Excessive Movement Speed: Walkers (35 px/s) and joggers (80 px/s) traverse the map too rapidly and animate frantically.
Startup Solo-Spawn Race Condition: CliftonDownGame calls updateLocalSpawner(0) in the constructor before the asynchronous WebSocket connection completes (CONNECTING state), spawning 5 unsynced local NPCs at t=0 in the middle of the map before NPC_SNAPSHOT arrives.
Synchronized Wave Spawning: ParkServer.initSpawner() spawns all initial NPCs with spawnTime = Date.now(), causing all NPCs to start at distance = 0 simultaneously rather than being naturally distributed across the park.
Core Deliverables
Slow Down NPCs: Reduce NPC_SPEED in npc_content.js and party/server.js to walker: 22 (px/s) and jogger: 48 (px/s), and reduce walkPhase animation multipliers in npc.js (walker: 6.2, jogger: 9.8).
Strictly Edge-to-Edge Paths: Replace all closed interior loops in src/world/npc_paths.js and src/world/npc_path_manifest.json with 10 point-to-point edge-to-edge paths. Every path MUST start at a map boundary edge and terminate at a different map boundary edge while maintaining full obstacle clearance.
Deterministic Bidirectional Traversal: Support path direction reversal derived deterministically from seed (or path definition) or ensure all 10 routes traverse varied boundary-to-boundary corridors.
Smooth Entry Fade-In & Angular Turning: Add a 0.5s fade-in at spawn (elapsed < 0.5) to match the 0.5s fade-out at completion, and smooth this.angle transitions across waypoint corners.
Global Sync & Pre-Warmed Server Spawner: Fix the client startup race condition in src/main.js, default WebSocket routing cleanly to PartyServer in src/net/network.js, and pre-warm spawnTime offsets in party/server.js so initial NPCs are distributed mid-path and despawn at staggered intervals.



ticket_id: "ticket-030"

title: "Static Ground & Path Offscreen Baking (Render Optimization)"

role: "IMPLEMENTER"

thinking_level: "LOW"

target_files:

  - "src/world/field.js"

  - "src/main.js"
1. Problem Statement & Objectives
Currently, the game calculates Math.sin hashes for grass patches, clips and draws Durdham Down mowing stripes, and strokes multi-layered Bezier gravel paths on every single frame (60fps) in renderGround(). This causes unnecessary CPU/GPU overhead for static geometry.
Core Deliverables
Offscreen Canvas Initialization: Create an OffscreenCanvas sized to the full world dimensions (3200x2400) during field.js initialization.
One-Time Bake: Execute the existing renderGround() drawing logic exactly once onto this offscreen canvas (baking the grass, stripes, wildflowers, and paths).
Optimized Render Loop: Update the main game loop's renderGround() to simply ctx.drawImage() the relevant viewport rect from the OffscreenCanvas instead of recalculating shapes every frame.



ticket_id: "ticket-031"

title: "Dead Platformer Code Pruning"

role: "IMPLEMENTER"

thinking_level: "LOW"

target_files:

  - "src/engine/physics.js"

  - "src/entities/ziggy.js"

  - "src/entities/collectibles.js"

  - "src/entities/hazards.js"

  - "src/level/park_level.js"

  - "src/entities/tombstone.js"

  - "test/test_physics.py" (if exists)

  - "test/test_platformer.py" (if exists)
1. Problem Statement & Objectives
The repository contains 6 unused files left over from an earlier side-scrolling platformer iteration ("Ziggy's Park Adventure"). These files clutter the codebase and create confusion for future LLM context windows.
Core Deliverables
Delete Files: Completely remove the 6 target files listed above.
Prune Imports: Search the remaining codebase (src/main.js, etc.) for any lingering import statements referencing these deleted files and remove them.
Clean Tests: Delete any associated Python unit tests targeting these specific platformer files to ensure python3 test/run_tests.py continues to pass cleanly.
