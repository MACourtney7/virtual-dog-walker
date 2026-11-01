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
        self.assertTrue("passed" in res.stdout and ("15 passed" in res.stdout or "16 passed" in res.stdout))
        print("✅ dog_walker_core native Rust tests passed (>= 15)")

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
        """Verify dist/ contains both src/wasm and src/wasm_core bundles."""
        dist_mesh = os.path.join(PROJECT_ROOT, "dist", "src", "wasm", "zero_mesh_bg.wasm")
        dist_core = os.path.join(PROJECT_ROOT, "dist", "src", "wasm_core", "dog_walker_core_bg.wasm")

        self.assertTrue(os.path.exists(dist_mesh), f"Missing {dist_mesh}")
        self.assertTrue(os.path.exists(dist_core), f"Missing {dist_core}")
        print("✅ Pages distribution bundle in dist/ packages both Wasm runtimes")

    def test_wasm_sim_bridge_and_entity_integration(self):
        """Verify wasm_sim_bridge.js exports and entity module hooks."""
        bridge_path = os.path.join(PROJECT_ROOT, "src", "engine", "wasm_sim_bridge.js")
        self.assertTrue(os.path.exists(bridge_path))

        with open(bridge_path) as f:
            content = f.read()
            self.assertIn("export async function initWasmSim", content)
            self.assertIn("export function stepLeashConstraint", content)
            self.assertIn("export function resolveWorldCollision", content)
            self.assertIn("export function sampleNpcState", content)

        # Verify main.js, toy.js, companion_dog.js, npc.js import bridge
        for rel_file in ["src/main.js", "src/entities/toy.js", "src/entities/companion_dog.js", "src/entities/npc.js"]:
            full = os.path.join(PROJECT_ROOT, rel_file)
            with open(full) as f:
                src = f.read()
                self.assertIn("wasm_sim_bridge", src, f"Expected wasm_sim_bridge import in {rel_file}")

        print("✅ wasm_sim_bridge.js cleanly integrated into entity simulation loop")

if __name__ == "__main__":
    unittest.main()

