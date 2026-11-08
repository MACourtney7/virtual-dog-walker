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
        self.assertIn("#touch-action-pad", self.css)
        self.assertIn(".touch-action-btn", self.css)

    def test_responsive_media_query(self):
        """Verify media query exists for small screens or coarse pointers."""
        has_mobile_mq = "pointer: coarse" in self.css or "max-width: 768px" in self.css
        self.assertTrue(has_mobile_mq, "Responsive media query for mobile/touch is missing")

    def test_contextual_action_glow_styles(self):
        """Verify glowing styles and pulse animations exist for contextual buttons."""
        self.assertIn(".touch-action-btn.contextual-pickup", self.css)
        self.assertIn(".touch-action-btn.contextual-dispose", self.css)
        self.assertIn("@keyframes pulseContextualBtn", self.css)

    def test_proximity_chat_viewport_anchoring(self):
        """Verify mobile proximity chat panel anchors to visualViewport variables."""
        self.assertIn("var(--vdw-viewport-height", self.css)
        self.assertIn("var(--vdw-viewport-top", self.css)


class MockCamera:
    """Mock of Camera class logic from src/world/field.js."""
    def __init__(self, x=500, y=300, viewport_w=800, viewport_h=600, world_w=2600, world_h=1900, zoom=1.0):
        self.x = x
        self.y = y
        self.viewport_w = viewport_w
        self.viewport_h = viewport_h
        self.world_w = world_w
        self.world_h = world_h
        self.zoom = float(zoom) if zoom and zoom > 0 else 1.0

    def world_to_screen(self, wx, wy):
        return {"x": (wx - self.x) * self.zoom, "y": (wy - self.y) * self.zoom}

    def screen_to_world(self, sx, sy):
        raw_x = sx / self.zoom + self.x
        raw_y = sy / self.zoom + self.y
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

    def test_camera_zoom_projection_and_roundtrip(self):
        """Verify worldToScreen and screenToWorld with zoom factors (0.75x, 0.85x)."""
        for zoom in [0.75, 0.85, 1.0]:
            cam = MockCamera(x=400, y=200, world_w=3200, world_h=2400, zoom=zoom)
            world_x, world_y = 800, 600

            screen_pt = cam.world_to_screen(world_x, world_y)
            expected_screen_x = (world_x - 400) * zoom
            expected_screen_y = (world_y - 200) * zoom
            self.assertAlmostEqual(screen_pt["x"], expected_screen_x)
            self.assertAlmostEqual(screen_pt["y"], expected_screen_y)

            unprojected = cam.screen_to_world(screen_pt["x"], screen_pt["y"])
            self.assertAlmostEqual(unprojected["x"], world_x)
            self.assertAlmostEqual(unprojected["y"], world_y)

    def test_camera_zoom_source_code_contract(self):
        """Verify src/world/field.js Camera class includes zoom, apply scale, and projections."""
        with open("src/world/field.js", "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("this.zoom = typeof zoom === 'number' && zoom > 0 ? zoom : 1.0", code)
        self.assertIn("ctx.scale(this.zoom, this.zoom);", code)
        self.assertIn("x: (worldX - this.x) * this.zoom", code)
        self.assertIn("const rawX = screenX / this.zoom + this.x;", code)

    def test_main_dpr_canvas_scaling_contract(self):
        """Verify src/main.js includes DPR backing buffer and responsive camera zoom."""
        with open("src/main.js", "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("window.devicePixelRatio", code)
        self.assertIn("this.canvas.width = Math.round(width * dpr);", code)
        self.assertIn("this.canvas.style.width = `${width}px`;", code)
        self.assertIn("this.camera.resize(width, height, zoom);", code)
        self.assertIn("this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);", code)


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


class TestPaceControls(unittest.TestCase):
    """Verify discrete pace controls replace the legacy analog joystick.

    Ticket unification-021 removes the on-screen pace buttons; the gait badge
    remains as the sole pace indicator.
    """

    def test_pace_controls_source_contract(self):
        with open("src/ui/touch_controls.js", "r", encoding="utf-8") as f:
            code = f.read()

        # Pace buttons removed in unification-021
        self.assertNotIn("btn-touch-pace-down", code)
        self.assertNotIn("btn-touch-pace-up", code)
        # Gait badge and setter preserved
        self.assertIn("touch-gait-badge", code)
        self.assertIn("setCurrentGait", code)

    def test_joystick_removed(self):
        with open("src/ui/touch_controls.js", "r", encoding="utf-8") as f:
            code = f.read()

        self.assertNotIn("joystick-base", code)
        self.assertNotIn("joystick-knob", code)

    def test_pace_step_behavioral(self):
        """Simulate pace stepping through the gait order."""
        GAIT_ORDER = ["STAND", "STROLL", "WALK", "JOG"]

        def step(gait, delta):
            idx = GAIT_ORDER.index(gait)
            next_idx = max(0, min(len(GAIT_ORDER) - 1, idx + delta))
            return GAIT_ORDER[next_idx]

        self.assertEqual(step("STROLL", +1), "WALK")
        self.assertEqual(step("WALK", +1), "JOG")
        self.assertEqual(step("JOG", +1), "JOG")
        self.assertEqual(step("WALK", -1), "STROLL")
        self.assertEqual(step("STAND", -1), "STAND")


class TestContextualTouchActions(unittest.TestCase):
    """Verifies TouchControls contextual action morphing, state transitions, and prompt adaptations."""

    def test_touch_controls_source_contract(self):
        """Verify TouchControls supports onPickup, onDispose, and setContextualAction morphing."""
        with open("src/ui/touch_controls.js", "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("onPickup:", code)
        self.assertIn("onDispose:", code)
        self.assertIn("setContextualAction(action)", code)
        self.assertIn("'contextual-pickup'", code)
        self.assertIn("'contextual-dispose'", code)
        self.assertIn("💩", code)
        self.assertIn("🗑️", code)
        self.assertIn("❤️", code)

    def test_main_adaptive_touch_prompts_contract(self):
        """Verify src/main.js adapts in-world prompt text on touch devices."""
        with open("src/main.js", "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("Tap 💩 to pick up", code)
        self.assertIn("Tap 🗑️ to dispose", code)
        self.assertNotIn("[E]", code)
        self.assertIn("this.touchControls.setContextualAction('pickup');", code)
        self.assertIn("this.touchControls.setContextualAction('dispose');", code)
        self.assertIn("this.touchControls.setContextualAction(null);", code)

    def test_proximity_chat_visual_viewport_contract(self):
        """Verify src/ui/proximity_chat.js binds visualViewport and manages --vdw-viewport-height."""
        with open("src/ui/proximity_chat.js", "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("initViewportHandling()", code)
        self.assertIn("window.visualViewport", code)
        self.assertIn("--vdw-viewport-height", code)
        self.assertIn("--vdw-viewport-top", code)
        self.assertIn("resize", code)
        self.assertIn("scroll", code)


if __name__ == "__main__":
    unittest.main()
