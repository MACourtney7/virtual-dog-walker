#!/usr/bin/env python3
"""Unit tests for the movement redesign (Ticket unification-019).

Verifies:
- Owner gait states and speeds.
- JOG 2.0s duration and 2.0s cooldown lockout.
- Ground halo rear brake arc hit testing.
- Field collision boundary stop and obstacle deflection result contracts.
"""
import os
import unittest


def read(rel_path):
    base = os.path.dirname(__file__)
    full = os.path.join(base, "..", rel_path)
    with open(full, "r", encoding="utf-8") as f:
        return f.read()


class TestOwnerGait(unittest.TestCase):
    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_gait_speeds_defined(self):
        self.assertIn("GAIT_SPEEDS", self.src)
        self.assertIn("[Gait.STAND]: 0", self.src)
        self.assertIn("[Gait.STROLL]: 100", self.src)
        self.assertIn("[Gait.WALK]: 185", self.src)
        self.assertIn("[Gait.JOG]: 265", self.src)

    def test_gait_turn_rates(self):
        self.assertIn("GAIT_TURN_RATES", self.src)
        self.assertIn("(180 * Math.PI) / 180", self.src)
        self.assertIn("(115 * Math.PI) / 180", self.src)
        self.assertIn("(65 * Math.PI) / 180", self.src)

    def test_jog_duration_and_cooldown_constants(self):
        self.assertIn("JOG_DURATION = 2.0", self.src)
        self.assertIn("JOG_COOLDOWN = 2.0", self.src)

    def test_is_moving_is_boolean_property(self):
        # Must not define a method named isMoving()
        self.assertNotRegex(self.src, r"\bisMoving\s*\(\s*\)\s*\{")
        # Must assign boolean property
        self.assertIn("this.isMoving = this.gait !== Gait.STAND", self.src)

    def test_no_legacy_key_reset(self):
        # Legacy directional key reset branch must be removed
        self.assertNotIn("No input: drop to STAND", self.src)

    def test_step_off_restricted_to_stroll(self):
        self.assertIn("this.stepOffActive && this.gait === Gait.STROLL", self.src)

    def test_rear_brake_arc_uses_ellipse(self):
        self.assertIn("isPointOnRearBrakeArc", self.src)
        self.assertIn("const cy = this.y + 12", self.src)
        self.assertIn("const rx = 22", self.src)
        self.assertIn("d < 0.7 || d > 1.35", self.src)


class TestFieldCollisionResult(unittest.TestCase):
    def setUp(self):
        self.src = read("src/world/field.js")

    def test_resolve_collision_with_result_exists(self):
        self.assertIn("resolveCollisionWithResult", self.src)

    def test_result_kinds(self):
        self.assertIn("kind: 'warp'", self.src)
        self.assertIn("kind = 'boundary'", self.src)
        self.assertIn("kind = 'obstacle'", self.src)
        self.assertIn("kind = 'none'", self.src)

    def test_deflected_heading(self):
        self.assertIn("deflectedHeading", self.src)


class TestMainIntegration(unittest.TestCase):
    def setUp(self):
        self.src = read("src/main.js")

    def test_keyboard_bindings(self):
        self.assertIn("case 'KeyQ':", self.src)
        self.assertIn("case 'KeyR':", self.src)
        self.assertIn("case 'KeyC':", self.src)
        self.assertIn("case 'Enter':", self.src)
        # Legacy keys removed
        self.assertNotIn("case 'KeyW':", self.src)
        self.assertNotIn("case 'KeyA':", self.src)
        self.assertNotIn("case 'KeyS':", self.src)
        self.assertNotIn("case 'KeyD':", self.src)
        self.assertNotIn("case 'KeyL':", self.src)
        self.assertNotIn("case 'KeyH':", self.src)

    def test_contextmenu_suppressed(self):
        self.assertIn("contextmenu", self.src)
        self.assertIn("e.preventDefault()", self.src)

    def test_collision_result_integration(self):
        self.assertIn("resolveCollisionWithResult", self.src)
        self.assertIn("res.kind === 'boundary'", self.src)
        self.assertIn("res.kind === 'obstacle'", self.src)

    def test_prompt_text_updated(self):
        self.assertIn("Click to pick up waste", self.src)
        self.assertIn("Click to dispose in bin", self.src)


class TestTouchControls(unittest.TestCase):
    def setUp(self):
        self.src = read("src/ui/touch_controls.js")

    def test_pace_controls(self):
        self.assertIn("onPaceDown", self.src)
        self.assertIn("onPaceUp", self.src)
        self.assertIn("btn-touch-pace-down", self.src)
        self.assertIn("btn-touch-pace-up", self.src)

    def test_gait_badge(self):
        self.assertIn("setCurrentGait", self.src)
        self.assertIn("touch-gait-badge", self.src)

    def test_joystick_removed(self):
        self.assertNotIn("joystick-base", self.src)
        self.assertNotIn("joystick-knob", self.src)

    def test_action_buttons_preserved(self):
        self.assertIn("btn-touch-throw", self.src)
        self.assertIn("btn-touch-whistle", self.src)
        self.assertIn("btn-touch-pet", self.src)
        self.assertIn("btn-touch-leash", self.src)
        self.assertIn("btn-touch-chat", self.src)


class TestCompanionDogGait(unittest.TestCase):
    def setUp(self):
        self.src = read("src/entities/companion_dog.js")

    def test_gait_tuning_helper(self):
        self.assertIn("_getGaitTuning", self.src)
        self.assertIn("case 'STAND':", self.src)
        self.assertIn("case 'STROLL':", self.src)
        self.assertIn("case 'JOG':", self.src)


if __name__ == "__main__":
    unittest.main()
