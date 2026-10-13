#!/usr/bin/env python3
import sys
import os
import subprocess

def test_scaffold():
    assert os.path.exists("index.html"), "index.html missing"
    assert os.path.exists("src/main.js"), "src/main.js missing"
    assert os.path.exists("src/style.css"), "src/style.css missing"
    assert os.path.exists("src/world/field.js"), "src/world/field.js missing"
    assert os.path.exists("src/entities/owner.js"), "src/entities/owner.js missing"
    assert os.path.exists("src/entities/companion_dog.js"), "src/entities/companion_dog.js missing"
    assert os.path.exists("src/entities/toy.js"), "src/entities/toy.js missing"
    assert os.path.exists("src/entities/npc.js"), "src/entities/npc.js missing"
    assert os.path.exists("src/net/network.js"), "src/net/network.js missing"
    assert os.path.exists("src/net/ws_network.js"), "src/net/ws_network.js missing"
    assert os.path.exists("src/ui/social_hud.js"), "src/ui/social_hud.js missing"
    assert os.path.exists("src/ui/touch_controls.js"), "src/ui/touch_controls.js missing"
    assert os.path.exists("src/systems/audio.js"), "src/systems/audio.js missing"
    assert os.path.exists("src/systems/weather.js"), "src/systems/weather.js missing"
    assert os.path.exists("src/world/environment.js"), "src/world/environment.js missing"
    assert os.path.exists("server/server.py"), "server/server.py missing"
    assert os.path.exists("server/host.py"), "server/host.py missing"
    assert os.path.exists("server/tunnel.py"), "server/tunnel.py missing"
    
    with open("index.html") as f:
        html = f.read()
        assert "game-canvas" in html, "Canvas id missing in index.html"
        assert "src/main.js" in html, "Script module tag missing in index.html"
        assert ("The Downs" in html or "Clifton Down" in html), "Park title missing in index.html"
        
    print("✅ test_scaffold passed: All Clifton Down social sandbox modules present.")

def run_all():
    test_scaffold()
    test_suites = [
        "test/test_steering.py",
        "test/test_ball_physics.py",
        "test/test_protocol.py",
        "test/test_server.py",
        "test/test_partyserver.py",
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
        "test/test_tombstone_cleanup.py"
    ]
    for t in test_suites:
        res = subprocess.run([sys.executable, t])
        if res.returncode != 0:
            print(f"❌ Test failed in {t}")
            sys.exit(res.returncode)
    print("🎉 All test suites passed successfully!")

if __name__ == "__main__":
    run_all()
