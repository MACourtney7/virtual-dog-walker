#!/usr/bin/env python3
import sys
import os
import subprocess

def test_scaffold():
    assert os.path.exists("index.html"), "index.html missing"
    assert os.path.exists("src/main.js"), "src/main.js missing"
    assert os.path.exists("src/style.css"), "src/style.css missing"
    assert os.path.exists("src/engine/physics.js"), "src/engine/physics.js missing"
    
    with open("index.html") as f:
        html = f.read()
        assert "game-canvas" in html, "Canvas id missing in index.html"
        assert "src/main.js" in html, "Script module tag missing in index.html"
        
    print("✅ test_scaffold passed")

def run_all():
    test_scaffold()
    res = subprocess.run([sys.executable, "test/test_physics.py"])
    if res.returncode != 0:
        sys.exit(res.returncode)
    print("🎉 All test suites passed successfully!")

if __name__ == "__main__":
    run_all()
