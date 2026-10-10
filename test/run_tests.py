#!/usr/bin/env python3
import sys
import os

def test_scaffold():
    assert os.path.exists("index.html"), "index.html missing"
    assert os.path.exists("src/main.js"), "src/main.js missing"
    assert os.path.exists("src/style.css"), "src/style.css missing"
    
    with open("index.html") as f:
        html = f.read()
        assert "game-canvas" in html, "Canvas id missing in index.html"
        assert "src/main.js" in html, "Script module tag missing in index.html"
        
    print("✅ test_scaffold passed")

if __name__ == "__main__":
    try:
        test_scaffold()
        print("🎉 All scaffold tests passed successfully!")
    except AssertionError as e:
        print(f"❌ Test failed: {e}")
        sys.exit(1)
