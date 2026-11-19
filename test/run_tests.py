#!/usr/bin/env python3
import sys
import os
import shutil
import subprocess

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

def run_all():
    ensure_node_available()
    test_scaffold()
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

if __name__ == "__main__":
    run_all()
