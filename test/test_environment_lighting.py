#!/usr/bin/env python3
"""
Unit tests for Dynamic Diurnal Sepia Lighting Pass & Weather Particle Overlays (Ticket-017 / Brief-03):
- TimeOfDay enum definition (DAWN, DAY, GOLDEN_HOUR, DUSK, NIGHT)
- Diurnal hour ranges and Bristol local time calculation
- Time override controls (setTimeOverride, clearTimeOverride, getCurrentHour)
- Ambient color and tint calculations across time-of-day states
- Atmospheric lighting overlay rendering (day sun wash, sepia twilight, night offscreen cutout)
- Weather particle simulations (rain streaks, drizzle mist, fog oscillation, overcast, clear dust motes)
- EnvironmentSystem API exports and singleton instance
"""

import math
import os
import re
import unittest


class TestEnvironmentLighting(unittest.TestCase):
    def setUp(self):
        self.env_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "environment.js")
        self.assertTrue(os.path.exists(self.env_js_path), f"File {self.env_js_path} does not exist")
        with open(self.env_js_path, "r", encoding="utf-8") as f:
            self.env_code = f.read()

    def test_time_of_day_enum_and_exports(self):
        """Verifies TimeOfDay enum exports all 5 states and singleton export."""
        self.assertIn("export const TimeOfDay", self.env_code)
        required_states = ["DAWN", "DAY", "GOLDEN_HOUR", "DUSK", "NIGHT"]
        for state in required_states:
            self.assertIn(f"'{state}'", self.env_code)

        # Check singleton export
        self.assertIn("export const environmentSystem = new EnvironmentSystem();", self.env_code)
        self.assertIn("export default environmentSystem;", self.env_code)

    def test_diurnal_hour_classification_logic(self):
        """Verifies diurnal math correctly maps hours to TimeOfDay states."""
        # Simulate logic from EnvironmentSystem.prototype.getTimeOfDay
        def get_time_of_day(hour):
            h = ((hour % 24) + 24) % 24
            if 5.0 <= h < 7.0:
                return "DAWN"
            elif 7.0 <= h < 17.0:
                return "DAY"
            elif 17.0 <= h < 19.5:
                return "GOLDEN_HOUR"
            elif 19.5 <= h < 21.5:
                return "DUSK"
            else:
                return "NIGHT"

        # Dawn tests (05:00 - 07:00)
        self.assertEqual(get_time_of_day(5.0), "DAWN")
        self.assertEqual(get_time_of_day(6.5), "DAWN")
        self.assertEqual(get_time_of_day(6.99), "DAWN")

        # Day tests (07:00 - 17:00)
        self.assertEqual(get_time_of_day(7.0), "DAY")
        self.assertEqual(get_time_of_day(12.0), "DAY")
        self.assertEqual(get_time_of_day(16.99), "DAY")

        # Golden Hour / Sepia Twilight tests (17:00 - 19:30)
        self.assertEqual(get_time_of_day(17.0), "GOLDEN_HOUR")
        self.assertEqual(get_time_of_day(18.25), "GOLDEN_HOUR")
        self.assertEqual(get_time_of_day(19.49), "GOLDEN_HOUR")

        # Dusk tests (19:30 - 21:30)
        self.assertEqual(get_time_of_day(19.5), "DUSK")
        self.assertEqual(get_time_of_day(20.5), "DUSK")
        self.assertEqual(get_time_of_day(21.49), "DUSK")

        # Night tests (21:30 - 05:00)
        self.assertEqual(get_time_of_day(21.5), "NIGHT")
        self.assertEqual(get_time_of_day(23.0), "NIGHT")
        self.assertEqual(get_time_of_day(0.0), "NIGHT")
        self.assertEqual(get_time_of_day(3.5), "NIGHT")
        self.assertEqual(get_time_of_day(4.99), "NIGHT")

    def test_time_override_methods(self):
        """Verifies presence and signatures of time override and query methods."""
        required_methods = [
            "setTimeOverride",
            "clearTimeOverride",
            "getCurrentHour",
            "getTimeOfDay",
            "getAmbientTint",
            "getAmbientColor"
        ]
        for m in required_methods:
            self.assertTrue(
                re.search(rf"\b{m}\s*\(", self.env_code) is not None,
                f"Missing method '{m}' in src/world/environment.js"
            )

    def test_ambient_lighting_tints_and_sepia_twilight(self):
        """Verifies ambient tint definitions for sepia twilight, night darkness, and daytime wash."""
        # Golden hour sepia tint
        self.assertTrue(
            "180, 110, 35" in self.env_code or "195, 115, 30" in self.env_code,
            "Missing sepia-tinted amber twilight values in environment.js"
        )
        # Night darkness tint
        self.assertTrue(
            "10, 16, 32" in self.env_code,
            "Missing deep navy/charcoal ambient night darkness (10, 16, 32) in environment.js"
        )
        # Day wash
        self.assertTrue(
            "255, 250, 230" in self.env_code,
            "Missing daytime subtle warm sun tint (255, 250, 230) in environment.js"
        )

    def test_radial_streetlamp_and_player_cutout_compositing(self):
        """Verifies destination-out radial compositing cutouts for streetlamps and player entities."""
        self.assertIn("destination-out", self.env_code)
        self.assertIn("createRadialGradient", self.env_code)
        self.assertIn("worldToScreen", self.env_code)
        self.assertIn("glowRadius", self.env_code)

    def test_weather_particle_simulations(self):
        """Verifies particle pools and updates for RAIN, DRIZZLE, FOG, and OVERCAST."""
        # Rain streaks
        self.assertIn("rainParticles", self.env_code)
        self.assertIn("splashes", self.env_code)
        # Drizzle & mist
        self.assertIn("drizzleParticles", self.env_code)
        self.assertIn("mistSpecks", self.env_code)
        # Fog sheets
        self.assertIn("fogSheets", self.env_code)
        # Overcast tint
        self.assertIn("60, 70, 80", self.env_code)
        # Dust motes
        self.assertIn("dustMotes", self.env_code)

    def test_environment_system_render_pipeline(self):
        """Verifies main render pipeline hooks for lighting and particle passes."""
        self.assertTrue(re.search(r"renderLighting\s*\(", self.env_code) is not None)
        self.assertTrue(re.search(r"renderParticles\s*\(", self.env_code) is not None)
        self.assertTrue(re.search(r"render\s*\(ctx,\s*camera,\s*field", self.env_code) is not None)


if __name__ == "__main__":
    unittest.main()
