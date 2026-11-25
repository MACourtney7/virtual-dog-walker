#!/usr/bin/env python3
import sys
import os
import shutil
import subprocess
import argparse
import glob
import tempfile

def ensure_node_available():
    extra_paths = [
        os.path.expanduser("~/.local/bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    current_path = os.environ.get("PATH", "")
    for p in extra_paths:
        if p not in current_path.split(os.pathsep) and os.path.isdir(p):
            current_path = f"{p}{os.pathsep}{current_path}"
    os.environ["PATH"] = current_path

    if shutil.which("node") is None:
        if os.environ.get("ALLOW_SKIP_NODE_TESTS") == "1":
            print("⚠️  WARNING: 'node' not found in PATH, but ALLOW_SKIP_NODE_TESTS=1 is set.")
            return
        print("❌ ERROR: 'node' executable not found in PATH. Node.js is required so JS/UI unit tests are not silently skipped.", file=sys.stderr)
        sys.exit(1)

WASM_ARTIFACT_DIR = os.path.join("src", "wasm_core")
WASM_ARTIFACT = os.path.join(WASM_ARTIFACT_DIR, "dog_walker_core_bg.wasm")
WASM_CRATE_SRC_DIR = os.path.join("crates", "dog_walker_core", "src")
WASM_BRIDGE_MODULE = os.path.join("src", "engine", "wasm_sim_bridge.js")


def _newest_mtime(paths):
    newest = 0.0
    for p in paths:
        try:
            m = os.path.getmtime(p)
        except OSError:
            continue
        if m > newest:
            newest = m
    return newest


def verify_wasm_artifact():
    """Ensure the Wasm artifact exists and is not stale relative to the Rust crate sources."""
    if not os.path.isfile(WASM_ARTIFACT):
        raise RuntimeError("Wasm sim artifact missing or stale")

    crate_sources = []
    if os.path.isdir(WASM_CRATE_SRC_DIR):
        crate_sources.extend(glob.glob(os.path.join(WASM_CRATE_SRC_DIR, "**", "*.rs"), recursive=True))
    crate_manifest = os.path.join("crates", "dog_walker_core", "Cargo.toml")
    if os.path.isfile(crate_manifest):
        crate_sources.append(crate_manifest)

    if crate_sources:
        newest_src = _newest_mtime(crate_sources)
        artifact_mtime = os.path.getmtime(WASM_ARTIFACT)
        if newest_src > artifact_mtime:
            raise RuntimeError("Wasm sim artifact missing or stale")


def run_wasm_preflight():
    """Synchronously initialize the Wasm sim via Node and fail if it is not ready."""
    if not os.path.isfile(WASM_BRIDGE_MODULE):
        raise RuntimeError("Wasm sim not initialized")

    bridge_url = "file://" + os.path.abspath(WASM_BRIDGE_MODULE)
    script = (
        "import { initWasmSimSync, isWasmSimReady } from " + repr(bridge_url) + ";\n"
        "try {\n"
        "  const ok = initWasmSimSync();\n"
        "  if (ok === false || !isWasmSimReady()) {\n"
        "    console.error('Wasm sim not initialized');\n"
        "    process.exit(2);\n"
        "  }\n"
        "} catch (e) {\n"
        "  console.error('Wasm sim not initialized: ' + (e && e.message ? e.message : e));\n"
        "  process.exit(2);\n"
        "}\n"
    )

    fd, tmp_path = tempfile.mkstemp(suffix=".mjs", prefix="wasm_preflight_")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(script)
        res = subprocess.run(["node", tmp_path], capture_output=True, text=True)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    if res.returncode != 0:
        detail = (res.stderr or res.stdout or "").strip()
        raise RuntimeError("Wasm sim not initialized" + (f": {detail}" if detail else ""))


def test_wasm_preflight():
    verify_wasm_artifact()
    run_wasm_preflight()
    print("✅ test_wasm_preflight passed: Wasm artifact present, fresh, and initialized.")


def test_scaffold():
    assert os.path.exists("index.html"), "index.html missing"
    assert os.path.exists("src/main.js"), "src/main.js missing"
    assert os.path.exists("src/style.css"), "src/style.css missing"
    assert os.path.exists("src/world/field.js"), "src/world/field.js missing"
    assert os.path.exists("src/entities/owner.js"), "src/entities/owner.js missing"
    assert os.path.exists("src/entities/companion_dog.js"), "src/entities/companion_dog.js missing"
    assert os.path.exists("src/entities/toy.js"), "src/entities/toy.js missing"
    assert os.path.exists("src/entities/npc.js"), "src/entities/npc.js missing"
    assert os.path.exists("src/entities/npc_content.js"), "src/entities/npc_content.js missing"
    assert os.path.exists("src/world/npc_paths.js"), "src/world/npc_paths.js missing"
    assert os.path.exists("src/world/npc_path_manifest.json"), "src/world/npc_path_manifest.json missing"
    assert os.path.exists("src/net/network.js"), "src/net/network.js missing"
    assert os.path.exists("src/ui/social_hud.js"), "src/ui/social_hud.js missing"
    assert os.path.exists("src/ui/touch_controls.js"), "src/ui/touch_controls.js missing"
    assert os.path.exists("src/systems/audio.js"), "src/systems/audio.js missing"
    assert os.path.exists("src/systems/weather.js"), "src/systems/weather.js missing"
    assert os.path.exists("src/world/environment.js"), "src/world/environment.js missing"
    assert os.path.exists("src/world/zones.js"), "src/world/zones.js missing"
    assert os.path.exists("src/world/zone_biomes.js"), "src/world/zone_biomes.js missing"
    
    with open("index.html") as f:
        html = f.read()
        assert "game-canvas" in html, "Canvas id missing in index.html"
        assert "src/main.js" in html, "Script module tag missing in index.html"
        assert ("The Downs" in html or "Clifton Down" in html), "Park title missing in index.html"
        
    print("✅ test_scaffold passed: All Clifton Down social sandbox modules present.")

def run_all(use_wasm=True):
    ensure_node_available()
    test_scaffold()
    if use_wasm:
        test_wasm_preflight()
    test_suites = [
        "test/test_steering.py",
        "test/test_ball_physics.py",
        "test/test_protocol.py",
        "test/test_mobile_controls.py",
        "test/test_player_identity.py",
        "test/test_leash_sync.py",
        "test/test_dog_behavior.py",
        "test/test_downs_map.py",
        "test/test_character_customization.py",
        "test/test_dog_personality_leash.py",
        "test/test_proximity_chat.py",
        "test/test_npcs.py",
        "test/test_navigation_arrow.py",
        "test/test_stray_and_poop.py",
        "test/test_weather_client.py",
        "test/test_environment_weather.py",
        "test/test_tombstone_cleanup.py",
        "test/test_social_hud_layout.py",
        "test/test_ticket_023_refinements.py",
        "test/test_field.py",
        "test/test_npc_content.py",
        "test/test_npc_paths.py",
        "test/test_npc_entity.py",
        "test/test_npc_client.py",
        "test/test_fetching_mechanics.py",
        "test/test_zero_mesh_integration.py",
        "test/test_wasm_core_sim.py",
        "test/test_phase3_visuals_and_mechanics.py",
        "test/test_zone_warps.py",
        "test/test_coastal_water.py",
        "test/test_canine_behavior_overhaul.py",
        "test/test_movement_redesign.py",
        "test/test_dog_state_store.py",
        "test/test_dog_hunger_behavior.py",
        "test/test_home_hunger_integration.py",
        "test/test_grooming_tiredness_state.py",
        "test/test_care_loop_ui.py",
        "test/test_unification_035.py"
    ]
    for t in test_suites:
        res = subprocess.run([sys.executable, t])
        if res.returncode != 0:
            print(f"❌ Test failed in {t}")
            sys.exit(res.returncode)
    print("🎉 All test suites passed successfully!")

def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Run the virtual_dog_walker test suites.")
    parser.add_argument(
        "--wasm",
        dest="wasm",
        action="store_true",
        default=True,
        help="Verify and initialize the Wasm sim before running tests (default: on).",
    )
    parser.add_argument(
        "--no-wasm",
        dest="wasm",
        action="store_false",
        help="Skip the Wasm artifact/preflight checks.",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    try:
        run_all(use_wasm=args.wasm)
    except RuntimeError as e:
        print(f"❌ Error(\"{e}\")", file=sys.stderr)
        sys.exit(1)
