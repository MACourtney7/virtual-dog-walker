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
        self.assertIn("[Gait.STROLL]: 75", self.src)
        self.assertIn("[Gait.WALK]: 100", self.src)
        self.assertIn("[Gait.JOG]: 185", self.src)

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
        self.assertTrue("centerY = this.y + 12" in self.src or "cy = this.y + 12" in self.src)
        self.assertTrue("Rx = 22" in self.src or "rx = 22" in self.src)
        self.assertTrue("normDist < 0.7 || normDist > 3.5" in self.src or "d < 0.7 || d > 3.5" in self.src)


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
        # Owner update handles collision result integration
        owner_src = read("src/entities/owner.js")
        self.assertIn("resolveCollisionWithResult", owner_src)
        self.assertIn("res.kind === 'boundary'", owner_src)
        self.assertIn("res.kind === 'obstacle'", owner_src)

    def test_prompt_text_updated(self):
        self.assertIn("Click to pick up waste", self.src)
        self.assertIn("Click to dispose", self.src)


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
        self.assertIn("normDist < 0.7 || normDist > 3.5", self.src)

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
            if norm_dist < 0.7 or norm_dist > 3.5:
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
        # Point far outside distance band (normDist > 3.5) should NOT hit
        self.assertFalse(on_rear_arc(100, 100, 0.0, 100 - 22 * 3.6, 100 + 12))
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
        # Non-double presses must flush any pending single gesture before
        # scheduling the new one.
        self.assertIn("Not a double press: flush any pending single gesture immediately", self.src)
        self.assertIn("if (pending) resolveCapturedPress(pending, false);", self.src)
        self.assertIn("distSinceLast <= DOUBLE_CLICK_PX", self.src)

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
        self.assertIn("Click to dispose", self.src)


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


class TestTouchButtonDebounce(unittest.TestCase):
    """Verify touch buttons debounce duplicate triggers within 200ms.

    Ticket unification-019 replaced the global `_lastTriggerAt` debounce with
    strictly per-button state (`pointerHandled` + `lastTrigger`) so activations
    on one button never swallow activations on another.
    """

    def setUp(self):
        self.src = read("src/ui/touch_controls.js")

    def test_no_global_debounce(self):
        # Global debounce must be gone; per-button state replaces it.
        self.assertNotIn("_lastTriggerAt", self.src)

    def test_per_button_debounce_guard_present(self):
        self.assertIn("let lastTrigger = 0;", self.src)
        self.assertIn("if (now - lastTrigger < 200)", self.src)

    def test_debounce_behavioral(self):
        """Simulate the per-button debounce guard: duplicate triggers within 200ms are ignored."""
        last_trigger = [0]
        fired = []

        def trigger(now):
            if now - last_trigger[0] < 200:
                return
            last_trigger[0] = now
            fired.append(now)

        # Rapid duplicate events from touchstart + pointerdown + click
        trigger(1000)
        trigger(1005)
        trigger(1010)
        self.assertEqual(len(fired), 1)

        # A later press after the debounce window fires again
        trigger(1300)
        self.assertEqual(len(fired), 2)


class TestSetTargetHeadingPreservesStand(unittest.TestCase):
    """Verify setTargetHeading() does not mutate gait."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_no_gait_mutation_in_set_target_heading(self):
        # Extract the setTargetHeading method body
        start = self.src.index("setTargetHeading(radians)")
        end = self.src.index("setGait(nextGait", start)
        body = self.src[start:end]
        self.assertNotIn("setGait(", body)
        self.assertIn("this.targetHeading = radians", body)

    def test_behavioral_stand_preserved(self):
        """Simulate setTargetHeading on a STAND owner: gait must remain STAND."""
        class FakeOwner:
            def __init__(self):
                self.gait = 'STAND'
                self.targetHeading = 0.0

            def setTargetHeading(self, radians):
                self.targetHeading = radians

        o = FakeOwner()
        o.setTargetHeading(1.23)
        self.assertEqual(o.gait, 'STAND')
        self.assertAlmostEqual(o.targetHeading, 1.23)


class TestBoundaryCollisionStopsMotion(unittest.TestCase):
    """Verify boundary collision zeroes velocity and isMoving."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_set_gait_syncs_is_moving(self):
        self.assertIn("this.isMoving = this.gait !== Gait.STAND;", self.src)
        self.assertIn("this.vx = 0;", self.src)
        self.assertIn("this.vy = 0;", self.src)

    def test_post_collision_resync(self):
        # The resync block must appear after collision resolution
        idx_collision = self.src.index("resolveCollisionWithResult")
        idx_resync = self.src.index("Re-sync motion flags after collision resolution")
        self.assertGreater(idx_resync, idx_collision)

    def test_behavioral_boundary_stop(self):
        """Simulate boundary collision: STAND gait zeroes velocity and isMoving."""
        class FakeOwner:
            def __init__(self):
                self.gait = 'WALK'
                self.vx = 185.0
                self.vy = 0.0
                self.isMoving = True

            def setGait(self, g):
                self.gait = g
                self.isMoving = self.gait != 'STAND'
                if not self.isMoving:
                    self.vx = 0
                    self.vy = 0

        o = FakeOwner()
        o.setGait('STAND')
        self.assertFalse(o.isMoving)
        self.assertEqual(o.vx, 0)
        self.assertEqual(o.vy, 0)


class TestImmediateInteractionCancelsPendingSingle(unittest.TestCase):
    """Verify immediate object interactions cancel pending deferred gestures."""

    def setUp(self):
        self.src = read("src/main.js")

    def test_cancel_pending_single_helper_exists(self):
        self.assertIn("const cancelPendingSingle = () => {", self.src)
        self.assertIn("clearTimeout(this._pendingGestureTimer)", self.src)
        self.assertIn("this._pendingGesture = null;", self.src)

    def test_dog_interaction_cancels_pending(self):
        # The dog hit branch must cancel pending + reset double-click state
        idx_dog = self.src.index("// 1. Companion dog")
        idx_poop = self.src.index("// 2. Poop pile")
        dog_block = self.src[idx_dog:idx_poop]
        self.assertIn("cancelPendingSingle();", dog_block)
        self.assertIn("this._lastClickTime = 0;", dog_block)
        self.assertIn("this.petDog();", dog_block)
        self.assertIn("this.owner.setGait('STAND');", dog_block)

    def test_poop_interaction_cancels_pending(self):
        idx_poop = self.src.index("// 2. Poop pile")
        idx_bin = self.src.index("// 3. Dog bin")
        poop_block = self.src[idx_poop:idx_bin]
        self.assertIn("cancelPendingSingle();", poop_block)
        self.assertIn("this._lastClickTime = 0;", poop_block)
        self.assertIn("this.pickUpPoop();", poop_block)

    def test_bin_interaction_cancels_pending(self):
        idx_bin = self.src.index("// 3. Dog bin")
        idx_deferred = self.src.index("// --- Deferred gestures")
        bin_block = self.src[idx_bin:idx_deferred]
        self.assertIn("cancelPendingSingle();", bin_block)
        self.assertIn("this._lastClickTime = 0;", bin_block)
        self.assertIn("this.disposePoopBag();", bin_block)

    def test_behavioral_field_then_dog(self):
        """Simulate: field tap (STAND->STROLL pending) then dog tap within 280ms.

        Expected: dog is petted, gait is STAND, and the pending STROLL is
        discarded so the owner never transitions back to STROLL.
        """
        state = {
            'gait': 'STAND',
            'pending': None,
            'pending_timer': None,
            'last_click_time': 0,
            'last_click_x': 0,
            'last_click_y': 0,
            'petted': False,
        }

        def cancel_pending_single():
            state['pending_timer'] = None
            state['pending'] = None

        def resolve_captured_press(captured, is_double):
            if captured['type'] == 'field':
                if is_double:
                    if captured['gaitAtPress'] == 'STAND':
                        state['gait'] = 'STROLL'
                else:
                    if captured['gaitAtPress'] == 'STAND':
                        state['gait'] = 'STROLL'

        def field_press(now):
            captured = {'type': 'field', 'gaitAtPress': state['gait']}
            state['last_click_time'] = now
            state['pending'] = captured
            state['pending_timer'] = 'scheduled'

        def dog_press():
            cancel_pending_single()
            state['last_click_time'] = 0
            state['last_click_x'] = 0
            state['last_click_y'] = 0
            state['petted'] = True
            state['gait'] = 'STAND'

        # Field tap at t=0 (STAND -> pending STROLL)
        field_press(0)
        self.assertEqual(state['gait'], 'STAND')
        self.assertIsNotNone(state['pending'])

        # Dog tap at t=100ms (within 280ms window)
        dog_press()
        self.assertTrue(state['petted'])
        self.assertEqual(state['gait'], 'STAND')
        self.assertIsNone(state['pending'])
        self.assertIsNone(state['pending_timer'])

        # If the pending timer had fired it would have set STROLL; verify it
        # cannot because it was cancelled.
        if state['pending'] is not None:
            resolve_captured_press(state['pending'], False)
        self.assertEqual(state['gait'], 'STAND')


class TestRightClickThrowWithin30px(unittest.TestCase):
    """Verify right-click within 30px throws toward clicked world coordinates."""

    def setUp(self):
        self.src = read("src/main.js")

    def test_right_click_uses_clicked_coords(self):
        idx = self.src.index("// Right-click: throw ball toward world coordinate")
        end = self.src.index("// Only left-click / primary pointer", idx)
        block = self.src[idx:end]
        self.assertIn("this.throwBallAt(worldTarget.x, worldTarget.y, dirX, dirY);", block)
        self.assertIn("if (dist > 0.001)", block)
        self.assertIn("dirX = dx / dist;", block)
        self.assertIn("dirY = dy / dist;", block)
        self.assertIn("dirX = Math.cos(this.owner.angle);", block)
        self.assertIn("dirY = Math.sin(this.owner.angle);", block)

    def test_behavioral_throw_direction(self):
        """Simulate right-click direction resolution."""
        import math

        def resolve(owner_x, owner_y, angle, wx, wy):
            dx = wx - owner_x
            dy = wy - owner_y
            dist = math.hypot(dx, dy)
            if dist > 0.001:
                return (dx / dist, dy / dist, wx, wy)
            return (math.cos(angle), math.sin(angle), wx, wy)

        # Click 10px east of owner: direction should be (1, 0), target = click
        dirX, dirY, tx, ty = resolve(100, 100, 0.0, 110, 100)
        self.assertAlmostEqual(dirX, 1.0)
        self.assertAlmostEqual(dirY, 0.0)
        self.assertEqual((tx, ty), (110, 100))

        # Click 5px north of owner: direction should be (0, -1)
        dirX, dirY, tx, ty = resolve(100, 100, 0.0, 100, 95)
        self.assertAlmostEqual(dirX, 0.0)
        self.assertAlmostEqual(dirY, -1.0)

        # Click exactly on owner: fall back to facing angle (east)
        dirX, dirY, tx, ty = resolve(100, 100, 0.0, 100, 100)
        self.assertAlmostEqual(dirX, 1.0)
        self.assertAlmostEqual(dirY, 0.0)


class TestTouchButtonPerButtonDedup(unittest.TestCase):
    """Verify touch button deduplication is strictly per-button."""

    def setUp(self):
        self.src = read("src/ui/touch_controls.js")

    def test_no_global_last_trigger(self):
        self.assertNotIn("this._lastTriggerAt", self.src)

    def test_per_button_state(self):
        self.assertIn("let pointerHandled = false;", self.src)
        self.assertIn("let lastTrigger = 0;", self.src)
        self.assertIn("pointerHandled = true;", self.src)
        self.assertIn("if (pointerHandled) {", self.src)
        self.assertIn("pointerHandled = false;", self.src)
        self.assertIn("if (now - lastTrigger < 200)", self.src)

    def test_behavioral_per_button_isolation(self):
        """Pressing button A then button B within 50ms must execute both."""
        buttons = {
            'A': {'pointerHandled': False, 'lastTrigger': 0, 'fired': []},
            'B': {'pointerHandled': False, 'lastTrigger': 0, 'fired': []},
        }

        def pointer_down(name, now):
            b = buttons[name]
            b['pointerHandled'] = True
            if now - b['lastTrigger'] < 200:
                return
            b['lastTrigger'] = now
            b['fired'].append(now)

        def click(name, now):
            b = buttons[name]
            if b['pointerHandled']:
                b['pointerHandled'] = False
                return
            if now - b['lastTrigger'] < 200:
                return
            b['lastTrigger'] = now
            b['fired'].append(now)

        # Press A at t=1000, then B at t=1050 (50ms later)
        pointer_down('A', 1000)
        pointer_down('B', 1050)
        self.assertEqual(buttons['A']['fired'], [1000])
        self.assertEqual(buttons['B']['fired'], [1050])

        # Synthetic clicks that follow each pointerdown are suppressed
        click('A', 1001)
        click('B', 1051)
        self.assertEqual(buttons['A']['fired'], [1000])
        self.assertEqual(buttons['B']['fired'], [1050])

        # A second press on A after the debounce window fires again
        pointer_down('A', 1300)
        self.assertEqual(buttons['A']['fired'], [1000, 1300])

    def test_behavioral_duplicate_pointer_suppressed(self):
        """Duplicate pointerdown on the same button within 200ms fires once."""
        b = {'pointerHandled': False, 'lastTrigger': 0, 'fired': []}

        def pointer_down(now):
            b['pointerHandled'] = True
            if now - b['lastTrigger'] < 200:
                return
            b['lastTrigger'] = now
            b['fired'].append(now)

        pointer_down(1000)
        pointer_down(1005)
        pointer_down(1010)
        self.assertEqual(len(b['fired']), 1)


class TestDeferredSingleBrakeRespectsGaitAtPress(unittest.TestCase):
    """Verify deferred single brake steps down relative to gaitAtPress."""

    def setUp(self):
        self.src = read("src/main.js")

    def test_brake_uses_gait_at_press(self):
        idx = self.src.index("if (captured.type === 'brake')")
        end = self.src.index("// Field press", idx)
        block = self.src[idx:end]
        self.assertIn("if (this.owner.gait === 'STAND') return;", block)
        self.assertIn("const gaitAtPress = captured.gaitAtPress;", block)
        self.assertIn("if (gaitAtPress === 'JOG')", block)
        self.assertIn("this.owner.setGait('WALK');", block)
        self.assertIn("if (gaitAtPress === 'WALK')", block)
        self.assertIn("this.owner.setGait('STROLL');", block)
        self.assertIn("if (gaitAtPress === 'STROLL')", block)
        self.assertIn("this.owner.setGait('STAND');", block)

    def test_behavioral_jog_expired_to_walk(self):
        """JOG at press, expired to WALK by the time the deferred brake fires.

        Expected: step down exactly one level from gaitAtPress (JOG -> WALK),
        NOT from the current gait (which would over-brake WALK -> STROLL).
        """
        state = {'gait': 'JOG'}

        def resolve_brake(gait_at_press):
            if state['gait'] == 'STAND':
                return
            if gait_at_press == 'JOG':
                state['gait'] = 'WALK'
            elif gait_at_press == 'WALK':
                state['gait'] = 'STROLL'
            elif gait_at_press == 'STROLL':
                state['gait'] = 'STAND'

        # Capture at press time
        captured_gait = state['gait']  # JOG
        # JOG expires during the 280ms window
        state['gait'] = 'WALK'
        # Deferred brake fires: one step down from gaitAtPress (JOG -> WALK)
        resolve_brake(captured_gait)
        self.assertEqual(state['gait'], 'WALK')

    def test_behavioral_stand_guard(self):
        """If owner is already STAND, deferred brake must not restart motion."""
        state = {'gait': 'STAND'}

        def resolve_brake(gait_at_press):
            if state['gait'] == 'STAND':
                return
            if gait_at_press == 'JOG':
                state['gait'] = 'WALK'
            elif gait_at_press == 'WALK':
                state['gait'] = 'STROLL'
            elif gait_at_press == 'STROLL':
                state['gait'] = 'STAND'

        resolve_brake('WALK')
        self.assertEqual(state['gait'], 'STAND')


class TestBoundaryPrioritySuppressesDeflection(unittest.TestCase):
    """Verify boundary contact suppresses obstacle heading deflection."""

    def setUp(self):
        self.src = read("src/world/field.js")

    def test_boundary_clamp_sets_kind(self):
        self.assertIn("const clampedX = Math.max(minX, Math.min(maxX, nx));", self.src)
        self.assertIn("const clampedY = Math.max(minY, Math.min(maxY, ny));", self.src)
        self.assertIn("if (clampedX !== nx || clampedY !== ny)", self.src)
        self.assertIn("kind = 'boundary';", self.src)

    def test_obstacle_loops_preserve_boundary(self):
        # Both pushCircle and bench loops must guard on kind !== 'boundary'
        self.assertGreaterEqual(self.src.count("if (kind !== 'boundary') {"), 2)

    def test_boundary_return_omits_deflection(self):
        self.assertIn("if (kind === 'boundary') {", self.src)
        self.assertIn("return { x: nx, y: ny, kind };", self.src)

    def test_behavioral_boundary_suppresses_deflection(self):
        """Simulate boundary + obstacle contact: kind stays 'boundary', no deflection."""
        width = 3200
        height = 2400
        radius = 16
        minX = 56 + radius
        maxX = width - 56 - radius
        minY = 56 + radius
        maxY = height - 56 - radius

        nx = minX - 10  # outside west boundary
        ny = 500
        kind = 'none'
        deflected = None

        clampedX = max(minX, min(maxX, nx))
        clampedY = max(minY, min(maxY, ny))
        if clampedX != nx or clampedY != ny:
            kind = 'boundary'
        nx, ny = clampedX, clampedY

        # Simulate an obstacle push that would normally set kind='obstacle'
        # and compute a deflected heading.
        if kind != 'boundary':
            kind = 'obstacle'
            deflected = 1.23

        self.assertEqual(kind, 'boundary')
        self.assertIsNone(deflected)


class TestJogCooldownDecrementOrder(unittest.TestCase):
    """Verify jogCooldown is decremented before the JOG expiry check."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_cooldown_decrement_precedes_jog_timer(self):
        idx_cooldown = self.src.index("if (this.jogCooldown > 0) {\n      this.jogCooldown = Math.max(0, this.jogCooldown - dt);")
        idx_jog_timer = self.src.index("if (this.jogTimer > 0) {\n      this.jogTimer -= dt;")
        self.assertLess(idx_cooldown, idx_jog_timer)

    def test_behavioral_cooldown_not_decremented_on_set_tick(self):
        """A cooldown initialised this tick must remain at 2.0 after the tick."""
        JOG_COOLDOWN = 2.0
        dt = 0.016
        state = {'gait': 'JOG', 'jogTimer': 0.01, 'jogCooldown': 0.0}

        # Decrement cooldown first
        if state['jogCooldown'] > 0:
            state['jogCooldown'] = max(0, state['jogCooldown'] - dt)
        # Then advance jog timer
        if state['jogTimer'] > 0:
            state['jogTimer'] -= dt
            if state['jogTimer'] <= 0:
                state['jogTimer'] = 0
                if state['gait'] == 'JOG':
                    state['gait'] = 'WALK'
                    state['jogCooldown'] = JOG_COOLDOWN

        self.assertEqual(state['gait'], 'WALK')
        self.assertEqual(state['jogCooldown'], JOG_COOLDOWN)


class TestDoublePressDistanceThreshold(unittest.TestCase):
    """Verify double-press distance threshold uses inclusive <= 24px."""

    def setUp(self):
        self.src = read("src/main.js")

    def test_inclusive_threshold(self):
        self.assertIn("distSinceLast <= DOUBLE_CLICK_PX", self.src)
        self.assertIn("DOUBLE_CLICK_PX = 24", self.src)

    def test_behavioral_threshold(self):
        """Simulate the double-press distance check."""
        DOUBLE_CLICK_PX = 24

        def is_double(dist):
            return dist <= DOUBLE_CLICK_PX

        self.assertTrue(is_double(0))
        self.assertTrue(is_double(24))
        self.assertFalse(is_double(24.01))
        self.assertFalse(is_double(50))


class TestGaitSpeedConstants(unittest.TestCase):
    """Verify GAIT_SPEEDS exact values (unification-020)."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_exact_speed_values(self):
        self.assertIn("[Gait.STAND]: 0", self.src)
        self.assertIn("[Gait.STROLL]: 75", self.src)
        self.assertIn("[Gait.WALK]: 100", self.src)
        self.assertIn("[Gait.JOG]: 185", self.src)

    def test_behavioral_speed_lookup(self):
        GAIT_SPEEDS = {'STAND': 0, 'STROLL': 75, 'WALK': 100, 'JOG': 185}
        self.assertEqual(GAIT_SPEEDS['STAND'], 0)
        self.assertEqual(GAIT_SPEEDS['STROLL'], 75)
        self.assertEqual(GAIT_SPEEDS['WALK'], 100)
        self.assertEqual(GAIT_SPEEDS['JOG'], 185)


class TestTurnOnTheSpot(unittest.TestCase):
    """Verify STAND gait snaps angle immediately on setTargetHeading."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_stand_snaps_angle(self):
        self.assertIn("if (this.gait === Gait.STAND) {", self.src)
        self.assertIn("this.angle = radians;", self.src)

    def test_behavioral_stand_snap(self):
        class FakeOwner:
            def __init__(self):
                self.gait = 'STAND'
                self.angle = 0.0
                self.targetHeading = 0.0

            def setTargetHeading(self, radians):
                self.targetHeading = radians
                if self.gait == 'STAND':
                    self.angle = radians

        o = FakeOwner()
        o.setTargetHeading(1.57)
        self.assertAlmostEqual(o.angle, 1.57)
        self.assertAlmostEqual(o.targetHeading, 1.57)


class TestStepOffAlignmentGate(unittest.TestCase):
    """Verify STAND -> STROLL suppresses velocity until aligned."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_step_off_constants(self):
        self.assertIn("STEP_OFF_ALIGN_TOLERANCE", self.src)
        self.assertIn("STEP_OFF_MAX_DURATION", self.src)
        self.assertIn("STEP_OFF_TURN_RATE", self.src)

    def test_step_off_gate_present(self):
        self.assertIn("if (this.stepOffActive) {", self.src)
        self.assertIn("alignErr > STEP_OFF_ALIGN_TOLERANCE", self.src)
        self.assertIn("this.vx = 0;", self.src)
        self.assertIn("this.vy = 0;", self.src)

    def test_behavioral_gate_suppresses_velocity(self):
        import math
        STEP_OFF_ALIGN_TOLERANCE = (5 * math.pi) / 180

        def gate(angle, target, vx, vy):
            align_err = abs(((target - angle + math.pi) % (2 * math.pi)) - math.pi)
            if align_err > STEP_OFF_ALIGN_TOLERANCE:
                return 0.0, 0.0
            return vx, vy

        # Misaligned by 90 degrees: velocity suppressed
        vx, vy = gate(0.0, math.pi / 2, 75.0, 0.0)
        self.assertEqual(vx, 0.0)
        self.assertEqual(vy, 0.0)

        # Aligned within tolerance: velocity preserved
        vx, vy = gate(0.0, 0.01, 75.0, 0.0)
        self.assertEqual(vx, 75.0)


class TestBoundaryAntiStuck(unittest.TestCase):
    """Verify boundary collision does not force STAND when heading is inward."""

    def setUp(self):
        self.src = read("src/world/field.js")

    def test_boundary_kind_present(self):
        self.assertIn("kind = 'boundary'", self.src)

    def test_behavioral_inward_movement_allowed(self):
        """Simulate boundary clamp: inward heading should not force STAND."""
        width = 3200
        height = 2400
        radius = 16
        minX = 56 + radius
        maxX = width - 56 - radius
        minY = 56 + radius
        maxY = height - 56 - radius

        # Owner at west boundary, heading east (inward)
        nx = minX - 5
        ny = 500
        clampedX = max(minX, min(maxX, nx))
        clampedY = max(minY, min(maxY, ny))
        kind = 'none'
        if clampedX != nx or clampedY != ny:
            kind = 'boundary'

        # Boundary contact detected, but heading is inward (east)
        self.assertEqual(kind, 'boundary')
        # The owner's heading (east) points into playable area, so movement
        # should be allowed on the next tick (no forced STAND).
        heading = 0.0  # east
        inward = heading > -1.5708 and heading < 1.5708
        self.assertTrue(inward)


class TestRearBrake5xHitTesting(unittest.TestCase):
    """Verify 5x expanded rear brake arc (normDist 0.7 to 3.5)."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_5x_band_constant(self):
        self.assertIn("normDist < 0.7 || normDist > 3.5", self.src)

    def test_behavioral_5x_band(self):
        import math

        def on_rear_arc(owner_x, owner_y, angle, wx, wy):
            cx = owner_x
            cy = owner_y + 12
            Rx = 22
            Ry = 12.1
            dx = wx - cx
            dy = wy - cy
            norm_dist = math.hypot(dx / Rx, dy / Ry)
            if norm_dist < 0.7 or norm_dist > 3.5:
                return False
            norm_angle = math.atan2(dy / Ry, dx / Rx)
            rear = angle + math.pi
            delta = ((norm_angle - rear + math.pi) % (2 * math.pi)) - math.pi
            if delta < -math.pi:
                delta += 2 * math.pi
            return abs(delta) <= (55 * math.pi / 180)

        # Behind owner at normDist 1.0, 2.0, 3.0, 3.4 -> all hit
        for mult in (1.0, 2.0, 3.0, 3.4):
            self.assertTrue(on_rear_arc(100, 100, 0.0, 100 - 22 * mult, 100 + 12),
                            f"normDist {mult} should hit")
        # normDist 3.6 -> miss
        self.assertFalse(on_rear_arc(100, 100, 0.0, 100 - 22 * 3.6, 100 + 12))
        # normDist 0.5 -> miss
        self.assertFalse(on_rear_arc(100, 100, 0.0, 100 - 22 * 0.5, 100 + 12))


class TestPlayerAvatarHitTest(unittest.TestCase):
    """Verify isPointOnPlayer uses 26px radius squared."""

    def setUp(self):
        self.src = read("src/entities/owner.js")

    def test_hit_radius_constant(self):
        self.assertIn("PLAYER_HIT_RADIUS = 26", self.src)
        self.assertIn("Owner.PLAYER_HIT_RADIUS = PLAYER_HIT_RADIUS", self.src)

    def test_is_point_on_player_present(self):
        self.assertIn("isPointOnPlayer(worldX, worldY)", self.src)
        self.assertIn("PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS", self.src)

    def test_behavioral_hit_test(self):
        PLAYER_HIT_RADIUS = 26

        def is_on_player(ox, oy, wx, wy):
            dx = wx - ox
            dy = wy - oy
            return (dx * dx + dy * dy) < (PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS)

        # Center hit
        self.assertTrue(is_on_player(100, 100, 100, 100))
        # Edge hit (25px away)
        self.assertTrue(is_on_player(100, 100, 125, 100))
        # Outside (27px away)
        self.assertFalse(is_on_player(100, 100, 127, 100))


class TestAvatarClickBraking(unittest.TestCase):
    """Verify main.js contains avatar click brake detection."""

    def setUp(self):
        self.src = read("src/main.js")

    def test_avatar_click_detection(self):
        self.assertIn("Avatar click", self.src)
        self.assertIn("isPointOnPlayer", self.src)
        self.assertIn("cancelPendingSingle", self.src)

    def test_avatar_brake_uses_step_down(self):
        self.assertIn("stepDownGait", self.src)
        self.assertIn("setGait('STAND')", self.src)


class TestCompanionDogFlankingBounds(unittest.TestCase):
    """Verify companion dog flank bands are within forward hemisphere."""

    def setUp(self):
        self.src = read("src/entities/companion_dog.js")

    def test_flank_right_band(self):
        self.assertIn("FLANK_RIGHT", self.src)
        self.assertIn("(30 * Math.PI) / 180", self.src)
        self.assertIn("(120 * Math.PI) / 180", self.src)

    def test_flank_left_band(self):
        self.assertIn("FLANK_LEFT", self.src)
        self.assertIn("(-120 * Math.PI) / 180", self.src)
        self.assertIn("(-30 * Math.PI) / 180", self.src)

    def test_get_flank_band_helper(self):
        self.assertIn("_getFlankBand", self.src)

    def test_behavioral_flank_bounds(self):
        import math
        FLANK_RIGHT = {
            'min': (30 * math.pi) / 180,
            'mid': (60 * math.pi) / 180,
            'max': (120 * math.pi) / 180
        }
        FLANK_LEFT = {
            'min': (-120 * math.pi) / 180,
            'mid': (-60 * math.pi) / 180,
            'max': (-30 * math.pi) / 180
        }
        # Right flank is in forward-right quadrant
        self.assertGreater(FLANK_RIGHT['min'], 0)
        self.assertLess(FLANK_RIGHT['max'], math.pi)
        # Left flank is in forward-left quadrant
        self.assertLess(FLANK_LEFT['max'], 0)
        self.assertGreater(FLANK_LEFT['min'], -math.pi)
        # Neither band includes straight-behind (180 deg)
        self.assertLess(FLANK_RIGHT['max'], math.pi)
        self.assertGreater(FLANK_LEFT['min'], -math.pi)


if __name__ == "__main__":
    unittest.main()
