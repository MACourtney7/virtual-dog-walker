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
    assert os.path.exists("src/net/network.js"), "src/net/network.js missing"
    assert os.path.exists("src/net/protocol.js"), "src/net/protocol.js missing"
    assert os.path.exists("src/ui/social_hud.js"), "src/ui/social_hud.js missing"
    assert os.path.exists("src/systems/audio.js"), "src/systems/audio.js missing"
    
    with open("index.html") as f:
        html = f.read()
        assert "game-canvas" in html, "Canvas id missing in index.html"
        assert "src/main.js" in html, "Script module tag missing in index.html"
        assert "Clifton Down" in html, "Clifton Down title missing in index.html"
        
    print("✅ test_scaffold passed: All Clifton Down social sandbox modules present.")

def run_all():
    test_scaffold()
    test_suites = [
        "test/test_steering.py",
        "test/test_ball_physics.py",
        "test/test_protocol.py"
    ]
    for t in test_suites:
        res = subprocess.run([sys.executable, t])
        if res.returncode != 0:
            print(f"❌ Test failed in {t}")
            sys.exit(res.returncode)
    print("🎉 All test suites passed successfully!")

if __name__ == "__main__":
    run_all()
