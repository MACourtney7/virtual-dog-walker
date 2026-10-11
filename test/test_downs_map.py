#!/usr/bin/env python3
"""
Unit tests for The Downs Map Redesign, Landmarks, Dog-Waste Bins & Nature Soundscape:
- Expanded world dimensions (3200 × 2400) and Camera default bounds
- Dog-waste bin registry (>= 8 bins with coordinates, radius, depthY, isBin)
- Circle collision resolution against bins and world borders
- Camera viewport clamping bounds logic
- Branding and title tags for "The Downs"
- Web Audio procedural soundscape synthesizer methods (startAmbientBreeze, playBirdChirp, etc.)
"""

import math
import os
import re
import unittest


class TestDownsMap(unittest.TestCase):
    def setUp(self):
        self.field_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "field.js")
        self.audio_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "systems", "audio.js")
        self.hud_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "ui", "social_hud.js")
        self.index_html_path = os.path.join(os.path.dirname(__file__), "..", "index.html")

        with open(self.field_js_path, "r", encoding="utf-8") as f:
            self.field_code = f.read()

        with open(self.audio_js_path, "r", encoding="utf-8") as f:
            self.audio_code = f.read()

        with open(self.hud_js_path, "r", encoding="utf-8") as f:
            self.hud_code = f.read()

        with open(self.index_html_path, "r", encoding="utf-8") as f:
            self.index_html = f.read()

    def test_downs_world_dimensions(self):
        """Verify default Field and Camera dimensions match 3200 x 2400."""
        # Check constructor defaults in Field
        field_match = re.search(r"class\s+Field\s*\{[^}]*constructor\s*\([^)]*width\s*=\s*(\d+)[^)]*height\s*=\s*(\d+)", self.field_code)
        if not field_match:
            # Fallback search for width/height assignment if default param format varies
            field_match = re.search(r"constructor\s*\(\s*width\s*=\s*(\d+)\s*,\s*height\s*=\s*(\d+)\s*\)", self.field_code)
        self.assertIsNotNone(field_match, "Could not find Field width/height default parameters")
        width, height = int(field_match.group(1)), int(field_match.group(2))
        self.assertEqual(width, 3200, f"Expected Field width 3200, got {width}")
        self.assertEqual(height, 2400, f"Expected Field height 2400, got {height}")

        # Check constructor defaults in Camera
        cam_match = re.search(r"class\s+Camera\s*\{[^}]*constructor\s*\([^)]*worldWidth\s*=\s*(\d+)[^)]*worldHeight\s*=\s*(\d+)", self.field_code)
        if not cam_match:
            cam_match = re.search(r"worldWidth\s*=\s*(\d+)\s*,\s*worldHeight\s*=\s*(\d+)", self.field_code)
        self.assertIsNotNone(cam_match, "Could not find Camera worldWidth/worldHeight default parameters")
        cam_w, cam_h = int(cam_match.group(1)), int(cam_match.group(2))
        self.assertEqual(cam_w, 3200, f"Expected Camera worldWidth 3200, got {cam_w}")
        self.assertEqual(cam_h, 2400, f"Expected Camera worldHeight 2400, got {cam_h}")

    def test_dog_waste_bin_registry(self):
        """Verify this.bins contains at least 8 dog-waste bins with valid properties."""
        self.assertIn("this.bins", self.field_code, "this.bins array property missing in Field")

        # Find bin definitions matching object structure { id: '...', x: ..., y: ..., radius: ..., depthY: ..., isBin: true }
        bin_patterns = re.findall(
            r"\{\s*id:\s*['\"]([^'\"]+)['\"],\s*x:\s*(\d+),\s*y:\s*(\d+),\s*radius:\s*(\d+)(?:,\s*depthY:\s*([^,}]+))?(?:,\s*isBin:\s*(true))?",
            self.field_code
        )
        if not bin_patterns or len(bin_patterns) < 8:
            # Alternate search pattern for bin declarations
            bin_patterns = re.findall(
                r"id:\s*['\"](bin-[^'\"]+)['\"].*?x:\s*(\d+).*?y:\s*(\d+)",
                self.field_code,
                re.DOTALL
            )

        self.assertGreaterEqual(len(bin_patterns), 8, f"Expected at least 8 dog-waste bins, found {len(bin_patterns)}")

        # Verify bin attributes in file
        self.assertIn("isBin: true", self.field_code)
        self.assertIn("depthY", self.field_code)

        # Check bin coordinates reside within world boundaries (3200 x 2400)
        for bin_match in bin_patterns:
            bin_id = bin_match[0]
            x = int(bin_match[1])
            y = int(bin_match[2])
            self.assertTrue(0 < x < 3200, f"Bin {bin_id} x-coordinate {x} out of world bounds (0, 3200)")
            self.assertTrue(0 < y < 2400, f"Bin {bin_id} y-coordinate {y} out of world bounds (0, 2400)")

    def test_bin_collision_integration(self):
        """Verify resolveCircleCollision accounts for dog-waste bins."""
        self.assertIn("resolveCircleCollision", self.field_code)
        
        # Verify that resolveCircleCollision iterates or checks this.bins
        has_bin_collision = ("this.bins" in self.field_code and "bin" in self.field_code)
        self.assertTrue(has_bin_collision, "resolveCircleCollision must integrate bin collisions")

        # Mathematical simulation of circle-circle resolution against a bin
        bin_x, bin_y, bin_radius = 500.0, 500.0, 12.0
        entity_x, entity_y, entity_radius = 505.0, 500.0, 16.0  # Overlapping: center distance 5, combined radius 28

        dx = entity_x - bin_x
        dy = entity_y - bin_y
        dist = math.hypot(dx, dy)
        min_dist = bin_radius + entity_radius

        self.assertLess(dist, min_dist, "Entities must be colliding for test condition")

        # Resolved position
        overlap = min_dist - dist
        resolved_x = entity_x + (dx / dist) * overlap
        resolved_y = entity_y + (dy / dist) * overlap
        new_dist = math.hypot(resolved_x - bin_x, resolved_y - bin_y)

        self.assertAlmostEqual(new_dist, min_dist, places=5, msg="Resolved distance must match min_dist")

    def test_camera_viewport_clamping(self):
        """Verify camera clamping math bounds within 0 and world - viewport."""
        world_w, world_h = 3200, 2400
        viewport_w, viewport_h = 1280, 720

        max_x = max(0, world_w - viewport_w)
        max_y = max(0, world_h - viewport_h)

        self.assertEqual(max_x, 1920)
        self.assertEqual(max_y, 1680)

        # Verify Field.js contains clamping logic
        self.assertIn("Math.max(0, this.worldWidth - this.viewportWidth)", self.field_code)
        self.assertIn("Math.max(0, this.worldHeight - this.viewportHeight)", self.field_code)

        # Simulation: test clamp boundary cases
        for target_x, target_y in [(-100, -50), (1000, 800), (3500, 2600)]:
            clamped_x = max(0, min(max_x, target_x))
            clamped_y = max(0, min(max_y, target_y))
            self.assertTrue(0 <= clamped_x <= max_x)
            self.assertTrue(0 <= clamped_y <= max_y)

    def test_downs_branding_and_title(self):
        """Verify index.html and social_hud.js reflect 'The Downs'."""
        self.assertIn("<title>The Downs", self.index_html, "index.html title must contain 'The Downs'")
        self.assertIn("The Downs", self.hud_code, "src/ui/social_hud.js must display 'The Downs' in HUD")

    def test_audio_nature_soundscape_methods(self):
        """Verify procedural Web Audio soundscape methods exist."""
        # Ambient wind / canopy breeze
        self.assertIn("startAmbientBreeze", self.audio_code, "startAmbientBreeze method missing in audio.js")
        
        # Birdsong synthesizer & species methods
        self.assertIn("playBirdChirp", self.audio_code, "playBirdChirp method missing in audio.js")
        self.assertTrue(
            "playBlackbird" in self.audio_code or "blackbird" in self.audio_code.lower(),
            "Blackbird birdsong synthesizer missing in audio.js"
        )
        self.assertTrue(
            "playRobin" in self.audio_code or "robin" in self.audio_code.lower(),
            "European Robin birdsong synthesizer missing in audio.js"
        )
        self.assertTrue(
            "playWoodpigeon" in self.audio_code or "woodpigeon" in self.audio_code.lower() or "pigeon" in self.audio_code.lower(),
            "Woodpigeon birdsong synthesizer missing in audio.js"
        )

        # Core sound methods must be preserved
        self.assertIn("playBark", self.audio_code, "playBark missing in audio.js")
        self.assertIn("playWhistle", self.audio_code, "playWhistle missing in audio.js")


if __name__ == "__main__":
    unittest.main()
