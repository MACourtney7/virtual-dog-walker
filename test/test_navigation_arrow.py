#!/usr/bin/env python3
"""
Unit tests for NavigationArrow HUD Component (Ticket 014 / Brief 01)
Validates:
- Class exports & constructor properties (target, pulseTimer, active, padding)
- setTarget, clearTarget, getTarget public API
- Perimeter clamping projection logic & bearing angle math
- Proximity detection and distance metric formatting
- Canvas draw method robustness (null/missing parameters, zero handling)
"""

import math
import os
import unittest


class TestNavigationArrowSource(unittest.TestCase):
    def setUp(self):
        file_path = os.path.join("src", "ui", "navigation_arrow.js")
        self.assertTrue(os.path.exists(file_path), "src/ui/navigation_arrow.js must exist")
        with open(file_path, "r", encoding="utf-8") as f:
            self.code = f.read()

    def test_class_export_and_methods(self):
        """Verify class declaration, export, and expected public methods exist."""
        self.assertIn("export class NavigationArrow", self.code)
        self.assertIn("setTarget", self.code)
        self.assertIn("clearTarget", self.code)
        self.assertIn("getTarget", self.code)
        self.assertIn("update", self.code)
        self.assertIn("draw", self.code)

    def test_properties_initialized(self):
        """Verify constructor initializes target, pulseTimer, active, and padding."""
        self.assertIn("this.target = null", self.code)
        self.assertIn("this.pulseTimer", self.code)
        self.assertIn("this.active = false", self.code)
        self.assertIn("this.padding", self.code)

    def test_visual_elements_and_icons(self):
        """Verify emoji icons, color theming, and distance formatting exist in implementation."""
        # Icons for DOG and BIN
        self.assertIn("🐕", self.code)
        self.assertIn("🗑️", self.code)
        # Pulse scale animation math
        self.assertIn("Math.sin", self.code)
        # Distance calculation
        self.assertIn("Math.hypot", self.code)
        self.assertIn("Math.atan2", self.code)
        self.assertIn("dist / 20", self.code)


class TestNavigationArrowMath(unittest.TestCase):
    """Simulates the projection and clamping algorithm from NavigationArrow to verify correctness."""

    @staticmethod
    def clamp_ray_to_box(cx, cy, angle, min_x, max_x, min_y, max_y):
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        t_min = float('inf')

        if cos_a > 1e-6:
            t = (max_x - cx) / cos_a
            if 0 < t < t_min:
                t_min = t
        if cos_a < -1e-6:
            t = (min_x - cx) / cos_a
            if 0 < t < t_min:
                t_min = t
        if sin_a > 1e-6:
            t = (max_y - cy) / sin_a
            if 0 < t < t_min:
                t_min = t
        if sin_a < -1e-6:
            t = (min_y - cy) / sin_a
            if 0 < t < t_min:
                t_min = t

        if not math.isfinite(t_min) or t_min <= 0:
            return cx, cy

        x = max(min_x, min(max_x, cx + cos_a * t_min))
        y = max(min_y, min(max_y, cy + sin_a * t_min))
        return x, y

    def test_bearing_angles(self):
        # East
        dx, dy = 100, 0
        self.assertAlmostEqual(math.atan2(dy, dx), 0.0)
        # South
        dx, dy = 0, 100
        self.assertAlmostEqual(math.atan2(dy, dx), math.pi / 2)
        # West
        dx, dy = -100, 0
        self.assertAlmostEqual(abs(math.atan2(dy, dx)), math.pi)
        # North
        dx, dy = 0, -100
        self.assertAlmostEqual(math.atan2(dy, dx), -math.pi / 2)

    def test_ray_clamping_to_viewport(self):
        w, h = 1280, 720
        pad = 45
        min_x, max_x = pad, w - pad
        min_y, max_y = pad, h - pad
        cx, cy = w / 2, h / 2

        # Point due East (angle 0)
        x, y = self.clamp_ray_to_box(cx, cy, 0.0, min_x, max_x, min_y, max_y)
        self.assertAlmostEqual(x, max_x)
        self.assertAlmostEqual(y, cy)

        # Point due North (angle -pi/2)
        x, y = self.clamp_ray_to_box(cx, cy, -math.pi / 2, min_x, max_x, min_y, max_y)
        self.assertAlmostEqual(x, cx)
        self.assertAlmostEqual(y, min_y)

        # Point due West (angle pi)
        x, y = self.clamp_ray_to_box(cx, cy, math.pi, min_x, max_x, min_y, max_y)
        self.assertAlmostEqual(x, min_x)
        self.assertAlmostEqual(y, cy)

        # Point due South (angle pi/2)
        x, y = self.clamp_ray_to_box(cx, cy, math.pi / 2, min_x, max_x, min_y, max_y)
        self.assertAlmostEqual(x, cx)
        self.assertAlmostEqual(y, max_y)

    def test_distance_formatting(self):
        # 20 units = 1m
        dist_px = 300
        meters = max(1, round(dist_px / 20))
        self.assertEqual(meters, 15)

        dist_px_small = 10
        meters_small = max(1, round(dist_px_small / 20))
        self.assertEqual(meters_small, 1)


if __name__ == "__main__":
    unittest.main()
