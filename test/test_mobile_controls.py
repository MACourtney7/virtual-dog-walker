#!/usr/bin/env python3
"""
Unit tests for Mobile Browser Support:
- Viewport and Web App metadata
- Safe-Area and touch-action CSS rules
- Camera screen-to-world projection math
- Joystick analog vector normalization, deadzone, and clamping
"""

import math
import os
import unittest


class TestMobileViewportAndHtml(unittest.TestCase):
    def setUp(self):
        with open("index.html", "r", encoding="utf-8") as f:
            self.html = f.read()

    def test_viewport_meta_attributes(self):
        """Verify viewport meta tag contains strict mobile game attributes."""
        self.assertIn("viewport-fit=cover", self.html)
        self.assertIn("maximum-scale=1.0", self.html)
        self.assertIn("user-scalable=no", self.html)
        self.assertIn("width=device-width", self.html)

    def test_web_app_meta_tags(self):
        """Verify standalone mobile web app capability tags."""
        self.assertIn('apple-mobile-web-app-capable', self.html)
        self.assertIn('mobile-web-app-capable', self.html)
        self.assertIn('theme-color', self.html)


class TestMobileStyles(unittest.TestCase):
    def setUp(self):
        with open("src/style.css", "r", encoding="utf-8") as f:
            self.css = f.read()

    def test_touch_action_none(self):
        """Verify touch-action: none is specified for gestures prevention."""
        self.assertIn("touch-action: none", self.css)

    def test_safe_area_insets(self):
        """Verify CSS env() safe-area-inset variables are utilized."""
        self.assertIn("safe-area-inset-bottom", self.css)
        self.assertIn("safe-area-inset-top", self.css)

    def test_touch_controls_selectors(self):
        """Verify essential mobile control selectors exist in CSS."""
        self.assertIn("#touch-controls-overlay", self.css)
        self.assertIn("#touch-joystick-zone", self.css)
        self.assertIn("#touch-action-pad", self.css)
        self.assertIn(".touch-action-btn", self.css)

    def test_responsive_media_query(self):
        """Verify media query exists for small screens or coarse pointers."""
        has_mobile_mq = "pointer: coarse" in self.css or "max-width: 768px" in self.css
        self.assertTrue(has_mobile_mq, "Responsive media query for mobile/touch is missing")


class MockCamera:
    """Mock of Camera class logic from src/world/field.js."""
    def __init__(self, x=500, y=300, viewport_w=800, viewport_h=600, world_w=2600, world_h=1900):
        self.x = x
        self.y = y
        self.viewport_w = viewport_w
        self.viewport_h = viewport_h
        self.world_w = world_w
        self.world_h = world_h

    def world_to_screen(self, wx, wy):
        return {"x": wx - self.x, "y": wy - self.y}

    def screen_to_world(self, sx, sy):
        raw_x = sx + self.x
        raw_y = sy + self.y
        return {
            "x": max(0.0, min(float(self.world_w), float(raw_x))),
            "y": max(0.0, min(float(self.world_h), float(raw_y)))
        }


class TestCameraProjection(unittest.TestCase):
    def setUp(self):
        self.camera = MockCamera(x=400, y=200, world_w=2600, world_h=1900)

    def test_screen_to_world_offset(self):
        """Verify screen coordinate offset matches camera position."""
        world_pt = self.camera.screen_to_world(100, 150)
        self.assertEqual(world_pt["x"], 500)
        self.assertEqual(world_pt["y"], 350)

    def test_screen_to_world_clamping(self):
        """Verify screen-to-world clamps strictly within world bounds."""
        negative_pt = self.camera.screen_to_world(-600, -300)
        self.assertEqual(negative_pt["x"], 0.0)
        self.assertEqual(negative_pt["y"], 0.0)

        far_pt = self.camera.screen_to_world(5000, 5000)
        self.assertEqual(far_pt["x"], 2600.0)
        self.assertEqual(far_pt["y"], 1900.0)

    def test_round_trip_mapping(self):
        """Verify world-to-screen and screen-to-world are bi-directional within bounds."""
        orig_world_x, orig_world_y = 1200, 900
        screen_pt = self.camera.world_to_screen(orig_world_x, orig_world_y)
        res_world = self.camera.screen_to_world(screen_pt["x"], screen_pt["y"])
        self.assertEqual(res_world["x"], orig_world_x)
        self.assertEqual(res_world["y"], orig_world_y)


class MockJoystick:
    """Mock of joystick mathematical processing from src/ui/touch_controls.js."""
    def __init__(self, center_x=100.0, center_y=100.0, max_radius=50.0, deadzone=0.10):
        self.center_x = center_x
        self.center_y = center_y
        self.max_radius = max_radius
        self.deadzone = deadzone

    def process_touch(self, client_x, client_y):
        dx = client_x - self.center_x
        dy = client_y - self.center_y
        raw_dist = math.hypot(dx, dy)
        angle = math.atan2(dy, dx)

        clamped_dist = min(raw_dist, self.max_radius)
        ratio = clamped_dist / self.max_radius

        if ratio < self.deadzone:
            return {"vx": 0.0, "vy": 0.0, "angle": 0.0, "active": False, "distance": 0.0}

        norm = (ratio - self.deadzone) / (1.0 - self.deadzone)
        return {
            "vx": math.cos(angle) * norm,
            "vy": math.sin(angle) * norm,
            "angle": angle,
            "active": True,
            "distance": clamped_dist
        }


class TestJoystickVectorMath(unittest.TestCase):
    def setUp(self):
        self.joystick = MockJoystick(center_x=100.0, center_y=100.0, max_radius=50.0, deadzone=0.10)

    def test_deadzone_rejection(self):
        """Touches within deadzone threshold (< 10% radius = 5px) return zero vector."""
        res = self.joystick.process_touch(102.0, 102.0)
        self.assertFalse(res["active"])
        self.assertEqual(res["vx"], 0.0)
        self.assertEqual(res["vy"], 0.0)

    def test_full_deflection_clamping(self):
        """Touches far beyond max radius clamp magnitude to 1.0."""
        res = self.joystick.process_touch(300.0, 100.0) # Deflection strictly rightward
        self.assertTrue(res["active"])
        self.assertAlmostEqual(res["vx"], 1.0, places=4)
        self.assertAlmostEqual(res["vy"], 0.0, places=4)
        self.assertEqual(res["distance"], 50.0)

    def test_diagonal_deflection_magnitude(self):
        """45-degree deflection normalizes with proportional intensity."""
        # 45 degrees: dx = 35.35, dy = 35.35 -> dist ~50
        res = self.joystick.process_touch(135.355, 135.355)
        self.assertTrue(res["active"])
        self.assertAlmostEqual(res["angle"], math.pi / 4, places=3)
        mag = math.hypot(res["vx"], res["vy"])
        self.assertAlmostEqual(mag, 1.0, places=3)


if __name__ == "__main__":
    unittest.main()
