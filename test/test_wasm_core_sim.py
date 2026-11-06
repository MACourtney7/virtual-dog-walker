#!/usr/bin/env python3
"""
Unit and integration tests for crates/dog_walker_core Rust/Wasm simulation engine,
dual-target build artifacts, and wasm_sim_bridge.js integration.
"""

import os
import subprocess
import unittest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

class TestWasmCoreSim(unittest.TestCase):
    def test_rust_crate_compiles_and_passes_native_unit_tests(self):
        """Verify crates/dog_walker_core compiles and passes at least 15 tests."""
        manifest_path = os.path.join(PROJECT_ROOT, "crates", "dog_walker_core", "Cargo.toml")
        self.assertTrue(os.path.exists(manifest_path), f"Missing {manifest_path}")

        res = subprocess.run(
            ["cargo", "test", "--manifest-path", manifest_path],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0, f"cargo test failed:\n{res.stdout}\n{res.stderr}")
        self.assertIn("test result: ok.", res.stdout)
        import re
        match = re.search(r"(\d+) passed", res.stdout)
        self.assertIsNotNone(match)
        self.assertGreaterEqual(int(match.group(1)), 15)
        print(f"✅ dog_walker_core native Rust tests passed ({match.group(1)} >= 15)")

    def test_dual_wasm_build_artifacts_exist(self):
        """Verify scripts/build_wasm.sh generated wasm and js files for both zero_mesh and dog_walker_core."""
        mesh_wasm = os.path.join(PROJECT_ROOT, "src", "wasm", "zero_mesh_bg.wasm")
        mesh_js = os.path.join(PROJECT_ROOT, "src", "wasm", "zero_mesh.js")
        core_wasm = os.path.join(PROJECT_ROOT, "src", "wasm_core", "dog_walker_core_bg.wasm")
        core_js = os.path.join(PROJECT_ROOT, "src", "wasm_core", "dog_walker_core.js")

        self.assertTrue(os.path.exists(mesh_wasm), f"Missing {mesh_wasm}")
        self.assertTrue(os.path.exists(mesh_js), f"Missing {mesh_js}")
        self.assertTrue(os.path.exists(core_wasm), f"Missing {core_wasm}")
        self.assertTrue(os.path.exists(core_js), f"Missing {core_js}")
        print("✅ Dual Wasm build artifacts verified in src/wasm/ and src/wasm_core/")

    def test_pages_distribution_packages_both_wasm_bundles(self):
        """Verify dist/ contains both src/wasm and src/wasm_core bundles and strictly runtime assets if dist/ has been built (AC-011.2)."""
        dist_dir = os.path.join(PROJECT_ROOT, "dist")
        if not os.path.exists(dist_dir):
            # In fresh CI checkouts, dist/ is not tracked in git; verify scripts/build_pages.sh existence
            build_script = os.path.join(PROJECT_ROOT, "scripts", "build_pages.sh")
            self.assertTrue(os.path.exists(build_script), "build_pages.sh missing")
            print("ℹ️ dist/ not built in this environment; verified build_pages.sh script")
            return

        dist_mesh = os.path.join(PROJECT_ROOT, "dist", "src", "wasm", "zero_mesh_bg.wasm")
        dist_core = os.path.join(PROJECT_ROOT, "dist", "src", "wasm_core", "dog_walker_core_bg.wasm")

        self.assertTrue(os.path.exists(dist_mesh), f"Missing {dist_mesh}")
        self.assertTrue(os.path.exists(dist_core), f"Missing {dist_core}")

        # AC-011.2 assertions: dist/ contains only runtime assets (index.html, src/)
        # Must not contain package.json, wrangler.jsonc, *.py, *.md, test/, openspec/, .factory/
        self.assertTrue(os.path.exists(os.path.join(dist_dir, "index.html")), "Missing dist/index.html")
        self.assertFalse(os.path.exists(os.path.join(dist_dir, "package.json")), "dist/ must not contain package.json")
        self.assertFalse(os.path.exists(os.path.join(dist_dir, "wrangler.jsonc")), "dist/ must not contain wrangler.jsonc")
        self.assertFalse(os.path.exists(os.path.join(dist_dir, "test")), "dist/ must not contain test/")
        self.assertFalse(os.path.exists(os.path.join(dist_dir, "openspec")), "dist/ must not contain openspec/")
        self.assertFalse(os.path.exists(os.path.join(dist_dir, ".factory")), "dist/ must not contain .factory/")

        for root, dirs, files in os.walk(dist_dir):
            for file_name in files:
                self.assertFalse(file_name.endswith(".py"), f"Found python file {file_name} in dist/")
                self.assertFalse(file_name.endswith(".md"), f"Found markdown file {file_name} in dist/")

        print("✅ Pages distribution bundle in dist/ satisfies AC-011.2 (runtime assets only, dual Wasm)")

    def test_wasm_sim_bridge_and_entity_integration(self):
        """Verify wasm_sim_bridge.js exports and entity module hooks."""
        bridge_path = os.path.join(PROJECT_ROOT, "src", "engine", "wasm_sim_bridge.js")
        self.assertTrue(os.path.exists(bridge_path))

        with open(bridge_path) as f:
            content = f.read()
            self.assertIn("export async function initWasmSim(worldWidth = 3200.0, worldHeight = 2400.0)", content)
            self.assertIn("new mod.WasmWorldSim(worldWidth, worldHeight)", content)
            self.assertIn("export function stepEarSprings", content)
            self.assertIn("wasmSimInstance.step_ears", content)
            self.assertIn("export function stepLeashConstraint", content)
            self.assertIn("export function resolveWorldCollision", content)
            self.assertIn("export function sampleNpcState", content)

        # Verify main.js, toy.js, companion_dog.js, npc.js import bridge
        for rel_file in ["src/main.js", "src/entities/toy.js", "src/entities/companion_dog.js", "src/entities/npc.js"]:
            full = os.path.join(PROJECT_ROOT, rel_file)
            with open(full) as f:
                src = f.read()
                self.assertIn("wasm_sim_bridge", src, f"Expected wasm_sim_bridge import in {rel_file}")

        # Verify CompanionDog invokes stepLeashConstraint, resolveFieldCollision and stepEarSpringsToTargets
        dog_path = os.path.join(PROJECT_ROOT, "src", "entities", "companion_dog.js")
        with open(dog_path) as f:
            dog_src = f.read()
            self.assertIn("stepLeashConstraint(this, this.owner, 65, 4.0, 5.0, dt)", dog_src)
            self.assertIn("resolveFieldCollision", dog_src)
            self.assertIn("stepEarSpringsToTargets", dog_src)

        # Verify Owner invokes resolveFieldCollision
        owner_path = os.path.join(PROJECT_ROOT, "src", "entities", "owner.js")
        with open(owner_path) as f:
            owner_src = f.read()
            self.assertIn("resolveFieldCollision", owner_src)

        # Verify TennisBall invokes stepToyBall
        toy_path = os.path.join(PROJECT_ROOT, "src", "entities", "toy.js")
        with open(toy_path) as f:
            toy_src = f.read()
            self.assertIn("stepToyBall", toy_src)

        # Verify ParkNPC invokes sampleNpcPath
        npc_path = os.path.join(PROJECT_ROOT, "src", "entities", "npc.js")
        with open(npc_path) as f:
            npc_src = f.read()
            self.assertIn("sampleNpcPath", npc_src)

        print("✅ wasm_sim_bridge.js cleanly integrated into entity simulation loop (5/5 call sites verified)")

if __name__ == "__main__":
    unittest.main()

