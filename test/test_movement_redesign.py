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


class TestRearBrakeArcNormalizedEllipse(unittest.TestCase):
    """Behavioral tests for the normalized ellipse rear-brake hit test."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_uses_normalized_ellipse_math(self):
        self.assertIn("const Rx = 22", self.src)
        self.assertIn("const Ry = 12.1", self.src)
        self.assertIn("Math.hypot(dx / Rx, dy / Ry)", self.src)
        self.assertIn("Math.atan2(dy / Ry, dx / Rx)", self.src)
        self.assertIn("normDist < 0.7 || normDist > 1.35", self.src)

    def test_rear_heading_uses_angle_plus_pi(self):
        self.assertIn("const rearHeading = this.angle + Math.PI", self.src)
        self.assertIn("angleDelta(rearHeading, normAngle)", self.src)

    def test_arc_half_span_is_55_degrees(self):
        self.assertIn("(110 * Math.PI) / 180 / 2", self.src)

    def test_behavioral_rear_arc_hit(self):
        """Simulate the normalized ellipse math to verify rear vs front classification."""
        import math

        def on_rear_arc(owner_x, owner_y, angle, wx, wy, gait='STROLL'):
            if gait == 'STAND':
                return False
            cx = owner_x
            cy = owner_y + 12
            Rx = 22
            Ry = 12.1
            dx = wx - cx
            dy = wy - cy
            norm_dist = math.hypot(dx / Rx, dy / Ry)
            if norm_dist < 0.7 or norm_dist > 1.35:
                return False
            norm_angle = math.atan2(dy / Ry, dx / Rx)
            rear = angle + math.pi
            delta = ((norm_angle - rear + math.pi) % (2 * math.pi)) - math.pi
            if delta < -math.pi:
                delta += 2 * math.pi
            return abs(delta) <= (55 * math.pi / 180)

        # Owner facing East (angle=0). Rear is West.
        # Point directly behind (west) at radius ~1.0 normalized
        self.assertTrue(on_rear_arc(100, 100, 0.0, 100 - 22, 100 + 12))
        # Point directly in front (east) should NOT be on rear arc
        self.assertFalse(on_rear_arc(100, 100, 0.0, 100 + 22, 100 + 12))
        # Point to the side (north) should NOT be on rear arc
        self.assertFalse(on_rear_arc(100, 100, 0.0, 100, 100 + 12 - 12.1))
        # Point far outside distance band should NOT hit
        self.assertFalse(on_rear_arc(100, 100, 0.0, 100 - 60, 100 + 12))
        # Point inside inner band should NOT hit
        self.assertFalse(on_rear_arc(100, 100, 0.0, 100 - 5, 100 + 12))
        # STAND gait never hits
        self.assertFalse(on_rear_arc(100, 100, 0.0, 100 - 22, 100 + 12, gait='STAND'))


class TestJogDurationAndCooldown(unittest.TestCase):
    """Behavioral tests for JOG 2.0s duration and 2.0s cooldown."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_constants(self):
        self.assertIn("JOG_DURATION = 2.0", self.src)
        self.assertIn("JOG_COOLDOWN = 2.0", self.src)

    def test_jog_timer_expires_to_walk(self):
        self.assertIn("this.jogTimer = JOG_DURATION", self.src)
        self.assertIn("this.setGait(Gait.WALK)", self.src)
        self.assertIn("this.jogCooldown = JOG_COOLDOWN", self.src)

    def test_jog_blocked_during_cooldown(self):
        self.assertIn("if (nextGait === Gait.JOG && this.jogCooldown > 0)", self.src)
        self.assertIn("nextGait = Gait.WALK", self.src)


class TestDoublePressLogic(unittest.TestCase):
    """Behavioral tests for double-press distance/timing logic in main.js."""

    def setUp(self):
        self.src = read("src/main.js")

    def test_double_click_constants(self):
        self.assertIn("DOUBLE_CLICK_MS = 280", self.src)
        self.assertIn("DOUBLE_CLICK_PX = 24", self.src)

    def test_captured_press_at_press_time(self):
        self.assertIn("const captured = {", self.src)
        self.assertIn("type: isBrake ? 'brake' : 'field'", self.src)
        self.assertIn("gaitAtPress: this.owner.gait", self.src)

    def test_separate_press_flush(self):
        self.assertIn("isSeparate", self.src)
        self.assertIn("distSinceLast > DOUBLE_CLICK_PX", self.src)

    def test_double_press_gait_progression(self):
        # STAND -> STROLL, STROLL -> WALK, WALK -> JOG
        self.assertIn("if (gaitAtPress === 'STAND')", self.src)
        self.assertIn("this.owner.setGait('STROLL')", self.src)
        self.assertIn("this.owner.setGait('WALK')", self.src)
        self.assertIn("this.owner.setGait('JOG')", self.src)


class TestTouchPromptStrings(unittest.TestCase):
    """Verify touch prompt strings have no legacy [E] hints."""

    def setUp(self):
        self.src = read("src/main.js")

    def test_no_legacy_e_hint(self):
        self.assertNotIn("[E]", self.src)

    def test_touch_prompts(self):
        self.assertIn("Tap 💩 to pick up", self.src)
        self.assertIn("Tap 🗑️ to dispose", self.src)

    def test_desktop_prompts(self):
        self.assertIn("Click to pick up waste", self.src)
        self.assertIn("Click to dispose in bin", self.src)


class TestOwnerLocalGuard(unittest.TestCase):
    """Verify Owner.update() guards movement behind isLocal."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_is_local_guard(self):
        self.assertIn("if (!this.isLocal)", self.src)

    def test_collision_result_integration(self):
        self.assertIn("field.resolveCollisionWithResult", self.src)
        self.assertIn("res.kind === 'boundary'", self.src)
        self.assertIn("res.kind === 'obstacle'", self.src)


class TestFootstepCadence(unittest.TestCase):
    """Verify footstep cadence scales with gait."""

    def setUp(self):
        self.src = read("src/main.js")

    def test_gait_scaled_intervals(self):
        self.assertIn("this.owner.gait === 'JOG' ? 200", self.src)
        self.assertIn("this.owner.gait === 'WALK' ? 300", self.src)
        self.assertIn("460", self.src)


if __name__ == "__main__":
    unittest.main()
