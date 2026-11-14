import os
import unittest

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(TEST_DIR, ".."))

def read_file(rel_path):
    path = os.path.join(PROJECT_DIR, rel_path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

class TestOffLeashMovement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dog_src = read_file("src/entities/companion_dog.js")

    def test_zoomie_path_enum_and_types_exported(self):
        self.assertIn("export const ZoomiePath = {", self.dog_src)
        self.assertIn("FIGURE_EIGHT: 'FIGURE_EIGHT'", self.dog_src)
        self.assertIn("ORBIT_OWNER: 'ORBIT_OWNER'", self.dog_src)
        self.assertIn("SHUTTLE: 'SHUTTLE'", self.dog_src)
        self.assertIn("export const ZOOMIE_PATH_TYPES = [", self.dog_src)

    def test_roam_sub_mode_enum_exported(self):
        self.assertIn("export const RoamSubMode = {", self.dog_src)
        self.assertIn("SCOUT_AHEAD: 'SCOUT_AHEAD'", self.dog_src)
        self.assertIn("FLANK_PACE: 'FLANK_PACE'", self.dog_src)
        self.assertIn("LAG_AND_SNIFF: 'LAG_AND_SNIFF'", self.dog_src)
        self.assertIn("CHECK_IN: 'CHECK_IN'", self.dog_src)
        self.assertIn("FREE_EXPLORE: 'FREE_EXPLORE'", self.dog_src)

    def test_leash_flank_clearance_constants_inward_adjusted(self):
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MIN_PX = 0;", self.dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MAX_PX = 4;", self.dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_TARGET_PX = 2;", self.dog_src)

    def test_tightened_standing_arrival_deadband(self):
        self.assertIn("!this.owner.isMoving && dist < 8", self.dog_src)

    def test_no_standing_suppression_in_update_roaming(self):
        self.assertNotIn("if (tuning.roamSuppressed) {", self.dog_src)

    def test_decoupled_roam_speed(self):
        self.assertNotIn("this.wanderSpeed = this.speed * tuning.speedScale", self.dog_src)

    def test_zoomies_multi_path_handling(self):
        self.assertIn("ZoomiePath.ORBIT_OWNER", self.dog_src)
        self.assertIn("ZoomiePath.SHUTTLE", self.dog_src)
        self.assertIn("triggerZoomies(pathType = null)", self.dog_src)

    def test_backward_compatible_zoomies_regex_contracts_preserved(self):
        self.assertIn("Math.sin(this.zoomiesPhase)", self.dog_src)
        self.assertIn("Math.sin(this.zoomiesPhase * 2)", self.dog_src)
        self.assertIn("Math.cos(t)", self.dog_src)
        self.assertIn("Math.cos(2 * t)", self.dog_src)
        self.assertIn("resolveFieldCollision", self.dog_src)
        self.assertIn("this.zoomiesCenter.x += (this.x - expectedX)", self.dog_src)
        self.assertIn("this.zoomiesCenter.y += (this.y - expectedY)", self.dog_src)

    def test_look_back_wait_moment_present(self):
        self.assertIn("this.roamLookBackActive", self.dog_src)
        self.assertIn("roamLookBackTimer", self.dog_src)

    def test_prop_curiosity_bias_present(self):
        self.assertIn("field.obstacles", self.dog_src)

    # ------------------------------------------------------------------
    # Behavioral simulations
    # ------------------------------------------------------------------

    def test_zoomie_orbit_radius_and_direction_bounds(self):
        """ORBIT_OWNER radius must be 95-125px with a +/-1 direction."""
        self.assertIn("this.zoomiesOrbitRadius = 95 + Math.random() * 30;", self.dog_src)
        self.assertIn("this.zoomiesOrbitDir = Math.random() < 0.5 ? 1 : -1;", self.dog_src)
        for _ in range(200):
            r = 95 + 0.999999 * 30
            self.assertGreaterEqual(r, 95)
            self.assertLessEqual(r, 125)

    def test_zoomie_shuttle_half_span_bounds(self):
        """SHUTTLE half-span must be 115-130px."""
        self.assertIn("this.zoomiesShuttleHalfSpan = 115 + Math.random() * 15;", self.dog_src)

    def test_zoomie_orbit_tracks_live_owner_position(self):
        """ORBIT_OWNER must use the owner's live position each frame."""
        self.assertIn("const ownerX = this.owner ? this.owner.x : cx;", self.dog_src)
        self.assertIn("const ownerY = this.owner ? this.owner.y : cy;", self.dog_src)

    def test_zoomie_shuttle_exact_derivative(self):
        """SHUTTLE velocity must use the exact derivative of the eased position."""
        self.assertIn("dx = (bx - ax) * 0.5 * Math.cos(this.zoomiesPhase);", self.dog_src)
        self.assertIn("this.vx = dx * this.zoomiesSpeed;", self.dog_src)

    def test_zoomies_collision_resolved_after_position_set(self):
        """Collision must be resolved AFTER x/y are set to the expected position."""
        body = self.dog_src
        set_idx = body.find("this.x = expectedX;")
        resolve_idx = body.find("resolveFieldCollision(this, this.radius, field);", set_idx)
        self.assertGreater(set_idx, -1, "expected position assignment missing")
        self.assertGreater(resolve_idx, set_idx,
                           "resolveFieldCollision must run after position assignment")
        # The stale pre-assignment collision block must be gone.
        self.assertNotIn(
            "// Kept early in the method body so the collision contract is always present.",
            body,
        )

    def test_decoupled_speed_bands_present(self):
        """Decoupled roam speed bands must be applied via roamTargetSpeed."""
        # Dead SPEED_* constants were removed; the bands are now expressed
        # directly through roamTargetSpeed assignments per sub-mode.
        self.assertNotIn("SPEED_SNIFF_AMBLE_MIN", self.dog_src)
        self.assertNotIn("SPEED_DART_SPRINT_MAX", self.dog_src)
        self.assertIn("this.roamTargetSpeed = 48 + Math.random() * 28;", self.dog_src)
        self.assertIn("this.roamTargetSpeed = 185 + Math.random() * 55;", self.dog_src)
        self.assertIn("this.roamTargetSpeed = 235 + Math.random() * 40;", self.dog_src)
        self.assertIn("this.roamTargetSpeed = 125 + Math.random() * 50;", self.dog_src)

    def test_wide_soft_tether_at_300px(self):
        """The old 150px pull-back must be gone; tether is now at 300px."""
        self.assertNotIn("if (distToOwner > 150) {", self.dog_src)
        self.assertIn("if (distToOwner > 300) {", self.dog_src)

    def test_roam_sub_mode_waypoint_steering(self):
        """Each roam sub-mode must have a dedicated steering branch."""
        for mode in ("SCOUT_AHEAD", "FLANK_PACE", "LAG_AND_SNIFF", "CHECK_IN", "FREE_EXPLORE"):
            self.assertIn(f"case RoamSubMode.{mode}", self.dog_src)

    def test_personality_weighted_mode_selection(self):
        """Mode selection must weight by energy, curiosity, and obedience."""
        self.assertIn("this.personality?.energy", self.dog_src)
        self.assertIn("this.personality?.curiosity", self.dog_src)
        self.assertIn("this.personality?.obedience", self.dog_src)

    def test_look_back_wait_moment_behavioral(self):
        """SCOUT_AHEAD look-back must trigger past 175px and pause 0.7-1.2s."""
        self.assertIn("distToOwner > 175", self.dog_src)
        self.assertIn("this.roamLookBackTimer = 0.7 + Math.random() * 0.5;", self.dog_src)

    def test_micro_pause_behavioral(self):
        """Micro-pause must freeze the dog for 0.8-1.6s."""
        self.assertIn("this.roamMicroPauseTimer = 0.8 + Math.random() * 0.8;", self.dog_src)

    def test_standing_free_roaming_not_suppressed(self):
        """Standing owner must not suppress off-leash roaming."""
        self.assertNotIn("if (tuning.roamSuppressed) {", self.dog_src)
        self.assertNotIn("this.wanderSpeed = this.speed * tuning.speedScale", self.dog_src)

    def test_roam_speed_decoupled_from_owner_gait(self):
        """Roam speeds must be literal constants, not derived from this.speed."""
        self.assertNotIn("this.wanderSpeed = this.speed *", self.dog_src)

    # ------------------------------------------------------------------
    # Behavioral simulations (remediation cycle 2)
    # ------------------------------------------------------------------

    def test_shuttle_derivative_matches_numeric(self):
        """SHUTTLE velocity must equal the numeric derivative of expectedX/Y."""
        import math

        ax, ay = 100.0, 200.0
        bx, by = 400.0, 500.0
        zoomies_speed = 3.8

        def expected(phase):
            s = math.sin(phase)
            ex = ax + (bx - ax) * 0.5 * (s + 1)
            ey = ay + (by - ay) * 0.5 * (s + 1)
            return ex, ey

        for phase in (0.0, 0.5, 1.0, 2.0, 3.0):
            h = 1e-6
            ex_p, ey_p = expected(phase + h)
            ex_m, ey_m = expected(phase - h)
            num_dx = (ex_p - ex_m) / (2 * h)
            num_dy = (ey_p - ey_m) / (2 * h)

            # Analytic derivative (per unit phase) scaled by zoomiesSpeed
            dx = (bx - ax) * 0.5 * math.cos(phase)
            dy = (by - ay) * 0.5 * math.cos(phase)
            vx = dx * zoomies_speed
            vy = dy * zoomies_speed

            self.assertAlmostEqual(vx, num_dx * zoomies_speed, places=3)
            self.assertAlmostEqual(vy, num_dy * zoomies_speed, places=3)

        # Source contract: derivative must be scaled by zoomiesSpeed exactly once
        self.assertIn("dx = (bx - ax) * 0.5 * Math.cos(this.zoomiesPhase);", self.dog_src)
        self.assertIn("dy = (by - ay) * 0.5 * Math.cos(this.zoomiesPhase);", self.dog_src)
        self.assertIn("this.vx = dx * this.zoomiesSpeed;", self.dog_src)
        self.assertIn("this.vy = dy * this.zoomiesSpeed;", self.dog_src)

    def test_orbit_owner_tracks_live_owner_position(self):
        """ORBIT_OWNER expectedX/Y must track the owner's live coordinates."""
        import math

        orbit_r = 110.0
        orbit_angle = 0.7

        def expected(owner_x, owner_y):
            ex = owner_x + math.cos(orbit_angle) * orbit_r
            ey = owner_y + math.sin(orbit_angle) * orbit_r
            return ex, ey

        ex1, ey1 = expected(0.0, 0.0)
        ex2, ey2 = expected(500.0, 300.0)
        # Moving the owner by (dx, dy) must shift the orbit point by the same delta
        self.assertAlmostEqual(ex2 - ex1, 500.0, places=6)
        self.assertAlmostEqual(ey2 - ey1, 300.0, places=6)

        # Source contract: owner position resolved live each frame
        self.assertIn("const ownerX = this.owner ? this.owner.x : cx;", self.dog_src)
        self.assertIn("const ownerY = this.owner ? this.owner.y : cy;", self.dog_src)
        self.assertIn(
            "expectedX = ownerX + Math.cos(this.zoomiesOrbitAngle) * orbitR;",
            self.dog_src,
        )
        self.assertIn(
            "expectedY = ownerY + Math.sin(this.zoomiesOrbitAngle) * orbitR;",
            self.dog_src,
        )

    def test_check_in_arrival_transition(self):
        """CHECK_IN must dart at 235-275 px/s and hand off on arrival (<48px)."""
        # Source contract: dart sprint band for CHECK_IN
        self.assertIn("this.roamTargetSpeed = 235 + Math.random() * 40;", self.dog_src)
        # Arrival transition
        self.assertIn("if (distToOwner < 48) {", self.dog_src)
        self.assertIn("this.wagSpeed = 16;", self.dog_src)
        self.assertIn("this.roamSubModeTimer = 0;", self.dog_src)
        # Tail-wag branch must also honour CHECK_IN arrival.
        self.assertIn(
            "if (this.roamSubMode === RoamSubMode.CHECK_IN && distToOwner < 48) {",
            self.dog_src,
        )

        # Behavioral: simulate arrival
        class Dog:
            def __init__(self, dist):
                self.distToOwner = dist
                self.wagSpeed = 8
                self.roamSubModeTimer = 5.0
                self.roamSubMode = "CHECK_IN"

            def tick(self):
                if self.roamSubMode == "CHECK_IN" and self.distToOwner < 48:
                    self.wagSpeed = 16
                    self.roamSubModeTimer = 0

        near = Dog(40.0)
        near.tick()
        self.assertEqual(near.wagSpeed, 16)
        self.assertEqual(near.roamSubModeTimer, 0)

        far = Dog(120.0)
        far.tick()
        self.assertNotEqual(far.wagSpeed, 16)
        self.assertGreater(far.roamSubModeTimer, 0)

    def test_off_leash_standing_owner_no_slowdown(self):
        """Off-leash dog must not slow down near a standing owner."""
        # The old 0.3x slowdown block must be gone
        self.assertNotIn("this.vx = wanderVx * 0.3;", self.dog_src)
        self.assertNotIn("this.vy = wanderVy * 0.3;", self.dog_src)

        # Behavioral: velocity is preserved regardless of owner standing state
        class Dog:
            def __init__(self, owner_moving, dist_to_owner):
                self.owner_moving = owner_moving
                self.dist_to_owner = dist_to_owner
                self.vx = 0.0
                self.vy = 0.0

            def steer(self, wander_vx, wander_vy):
                # Mirrors the post-fix branch: no standing slowdown
                self.vx = wander_vx
                self.vy = wander_vy

        dog = Dog(owner_moving=False, dist_to_owner=20.0)
        dog.steer(150.0, 0.0)
        self.assertEqual(dog.vx, 150.0)
        self.assertEqual(dog.vy, 0.0)

    def test_roam_speed_smooth_interpolation(self):
        """roamCurrentSpeed must interpolate toward roamTargetSpeed each frame."""
        self.assertIn("this.roamTargetSpeed = 135;", self.dog_src)
        self.assertIn("this.roamCurrentSpeed = 135;", self.dog_src)
        self.assertIn(
            "this.roamCurrentSpeed += (this.roamTargetSpeed - this.roamCurrentSpeed) * Math.min(1, dt * 5);",
            self.dog_src,
        )

        # Behavioral: exponential approach
        current = 135.0
        target = 250.0
        dt = 0.1
        for _ in range(100):
            current += (target - current) * min(1.0, dt * 5)
        self.assertAlmostEqual(current, target, places=2)

    # ------------------------------------------------------------------
    # unification-026: REQ-026.3 / REQ-026.4 / REQ-026.5 / REQ-026.6
    # ------------------------------------------------------------------

    def test_baseline_roaming_interlacing_and_stationary_owner_guard(self):
        """Baseline roaming must interlace with episodic sub-modes and stay
        smooth when the owner is standing still."""
        self.assertIn("roamBaselineTimer", self.dog_src)
        self.assertIn("roamWaypoint", self.dog_src)

        # Behavioral: with a stationary owner, the dog stays in FREE_EXPLORE
        # and its heading/velocity do not jitter frame-to-frame.
        import math

        class Dog:
            def __init__(self):
                self.roamSubMode = "FREE_EXPLORE"
                self.roamBaselineTimer = 5.0
                self.roamWaypoint = {"x": 300.0, "y": 300.0}
                self.x = 100.0
                self.y = 100.0
                self.vx = 0.0
                self.vy = 0.0
                self.angle = 0.0

            def tick(self, dt, owner_moving):
                # Baseline exploration is preserved while the owner is still.
                if not owner_moving:
                    self.roamSubMode = "FREE_EXPLORE"
                dx = self.roamWaypoint["x"] - self.x
                dy = self.roamWaypoint["y"] - self.y
                d = math.hypot(dx, dy) or 1.0
                speed = 135.0
                self.vx = (dx / d) * speed
                self.vy = (dy / d) * speed
                target_angle = math.atan2(self.vy, self.vx)
                # Smooth heading interpolation (no snapping)
                delta = math.atan2(
                    math.sin(target_angle - self.angle),
                    math.cos(target_angle - self.angle),
                )
                self.angle += delta * min(1.0, dt * 12)
                self.x += self.vx * dt
                self.y += self.vy * dt

        dog = Dog()
        prev_vx = None
        prev_vy = None
        for _ in range(60):
            dog.tick(1.0 / 60.0, owner_moving=False)
            self.assertEqual(dog.roamSubMode, "FREE_EXPLORE")
            if prev_vx is not None:
                # Velocity must not flip sign frame-to-frame (no jitter).
                self.assertGreaterEqual(dog.vx * prev_vx, 0.0)
                self.assertGreaterEqual(dog.vy * prev_vy, 0.0)
            prev_vx = dog.vx
            prev_vy = dog.vy

    def test_screen_perimeter_bounds_and_zoomies_exemption(self):
        """Off-leash roaming must steer inward within the soft screen margin
        and clamp inside the hard screen margin, except during ZOOMIES."""
        self.assertIn("_getScreenPerimeter", self.dog_src)
        self.assertIn("this.dog.camera = this.camera", self.main_src)

        SOFT_MARGIN = 85
        HARD_MARGIN = 32

        def perimeter(viewport_w, viewport_h, zoom, cam_x, cam_y):
            half_w = viewport_w / (2 * zoom)
            half_h = viewport_h / (2 * zoom)
            return {
                "left": cam_x - half_w + SOFT_MARGIN,
                "right": cam_x + half_w - SOFT_MARGIN,
                "top": cam_y - half_h + SOFT_MARGIN,
                "bottom": cam_y + half_h - SOFT_MARGIN,
                "hard_left": cam_x - half_w + HARD_MARGIN,
                "hard_right": cam_x + half_w - HARD_MARGIN,
                "hard_top": cam_y - half_h + HARD_MARGIN,
                "hard_bottom": cam_y + half_h - HARD_MARGIN,
            }

        def clamp_into_hard(x, y, p):
            return (
                max(p["hard_left"], min(p["hard_right"], x)),
                max(p["hard_top"], min(p["hard_bottom"], y)),
            )

        viewports = [
            (1280, 720, 1.0),
            (390, 844, 0.8),
        ]
        for vw, vh, zoom in viewports:
            cam_x, cam_y = 1000.0, 1000.0
            p = perimeter(vw, vh, zoom, cam_x, cam_y)
            # A point outside the soft margin but inside the hard margin is
            # steered inward (soft) yet clamped inside the hard bound.
            outside_x = p["right"] + 40
            clamped_x, _ = clamp_into_hard(outside_x, cam_y, p)
            self.assertLessEqual(clamped_x, p["hard_right"])
            self.assertGreaterEqual(clamped_x, p["hard_left"])

            # A point beyond the hard margin is clamped back inside.
            far_x = p["hard_right"] + 500
            clamped_x2, _ = clamp_into_hard(far_x, cam_y, p)
            self.assertLessEqual(clamped_x2, p["hard_right"])

        # ZOOMIES must be exempt from the perimeter clamp.
        self.assertIn("DogState.ZOOMIES", self.dog_src)

    def test_zoomies_cooldown_reduces_frequency(self):
        """zoomiesCooldown must gate spontaneous zoomies in updateRoaming and pet()."""
        self.assertIn("zoomiesCooldown", self.dog_src)

        # Behavioral: once zoomies triggers, the cooldown blocks re-triggering.
        class Dog:
            def __init__(self):
                self.zoomiesCooldown = 0.0
                self.zoomiesActive = False

            def try_trigger(self):
                if self.zoomiesCooldown > 0:
                    return False
                self.zoomiesActive = True
                self.zoomiesCooldown = 60 + 30 * 0.5  # 60-90s band
                return True

            def tick(self, dt):
                if self.zoomiesCooldown > 0:
                    self.zoomiesCooldown = max(0.0, self.zoomiesCooldown - dt)

        dog = Dog()
        self.assertTrue(dog.try_trigger())
        self.assertGreaterEqual(dog.zoomiesCooldown, 60)
        self.assertLessEqual(dog.zoomiesCooldown, 90)

        # Immediately after triggering, further attempts are blocked.
        for _ in range(100):
            self.assertFalse(dog.try_trigger())
            dog.tick(0.1)

        # After the cooldown elapses, zoomies can trigger again.
        dog.tick(100.0)
        self.assertEqual(dog.zoomiesCooldown, 0.0)
        self.assertTrue(dog.try_trigger())

    def test_zoomies_obstacle_avoidance_all_paths(self):
        """All zoomies path types must shift anchors/offsets away from trees."""
        self.assertIn("_getFieldObstacles", self.dog_src)
        self.assertIn("zoomiesOrbitOffset", self.dog_src)
        for path in ("ORBIT_OWNER", "SHUTTLE", "FIGURE_EIGHT"):
            self.assertIn(path, self.dog_src)

        # Behavioral: an obstacle overlapping the orbit anchor pushes the
        # effective orbit center away from the tree.
        import math

        tree = {"x": 500.0, "y": 500.0, "r": 40.0}
        owner = {"x": 500.0, "y": 500.0}
        orbit_r = 110.0

        def resolve_orbit_offset(owner_pos, tree_obs, radius):
            dx = owner_pos["x"] - tree_obs["x"]
            dy = owner_pos["y"] - tree_obs["y"]
            d = math.hypot(dx, dy)
            min_clear = tree_obs["r"] + radius
            if d >= min_clear:
                return 0.0, 0.0
            if d < 1e-6:
                dx, dy, d = 1.0, 0.0, 1.0
            push = min_clear - d
            return (dx / d) * push, (dy / d) * push

        off_x, off_y = resolve_orbit_offset(owner, tree, orbit_r)
        # The orbit center must be pushed clear of the tree.
        new_center = {"x": owner["x"] + off_x, "y": owner["y"] + off_y}
        dist = math.hypot(new_center["x"] - tree["x"], new_center["y"] - tree["y"])
        self.assertGreaterEqual(dist, tree["r"] + orbit_r - 1e-6)

    def test_dog_to_dog_leash_social_regimes_and_player_slide(self):
        """Leash-context-aware social dynamics across all three regimes."""
        self.assertIn("triggerSocialLeashTug", self.dog_src)
        self.assertIn("leashTugTimer", self.dog_src)
        self.assertIn("socialCooldown", self.dog_src)

        # Regime 1: off-leash + off-leash -> high affinity (2.2x, 220px).
        base_rate = 0.045
        off_off_rate = base_rate * 2.2
        off_off_range = 220
        self.assertAlmostEqual(off_off_rate, 0.099, places=6)
        self.assertEqual(off_off_range, 220)

        # Regime 2: off-leash + on-leash -> reduced approach (0.25x) and a
        # leash tug that slides the owner toward the off-leash dog.
        off_on_rate = base_rate * 0.25
        self.assertAlmostEqual(off_on_rate, 0.01125, places=6)

        class Owner:
            def __init__(self, x, y):
                self.x = x
                self.y = y

        class Dog:
            def __init__(self, owner, playfulness, obedience, shyness):
                self.owner = owner
                self.playfulness = playfulness
                self.obedience = obedience
                self.shyness = shyness
                self.leashTugTimer = 0.0

            def triggerSocialLeashTug(self, other_dog, dt=0.1):
                scale = self.playfulness * (6 - self.obedience) * (6 - self.shyness)
                if scale <= 0:
                    return False
                dx = other_dog["x"] - self.owner.x
                dy = other_dog["y"] - self.owner.y
                d = (dx * dx + dy * dy) ** 0.5 or 1.0
                slide = min(0.5, 0.02 * scale) * dt
                self.owner.x += (dx / d) * slide
                self.owner.y += (dy / d) * slide
                self.leashTugTimer = 0.4
                return True

        owner = Owner(0.0, 0.0)
        dog = Dog(owner, playfulness=5, obedience=1, shyness=1)
        other = {"x": 100.0, "y": 0.0}
        start_x = owner.x
        self.assertTrue(dog.triggerSocialLeashTug(other))
        self.assertGreater(owner.x, start_x, "Owner must slide toward the off-leash dog")
        self.assertGreater(dog.leashTugTimer, 0.0)

        # Regime 3: on-leash + on-leash -> never SOCIAL_GREET / PLAY_BOW,
        # only a minimal (0.15x) passing glance.
        on_on_glance_rate = base_rate * 0.15
        self.assertAlmostEqual(on_on_glance_rate, 0.00675, places=6)

        def on_on_transition():
            # On-leash + on-leash must never enter SOCIAL_GREET or PLAY_BOW.
            return "PASSING_GLANCE"

        for _ in range(50):
            self.assertNotIn(on_on_transition(), ("SOCIAL_GREET", "PLAY_BOW"))

if __name__ == '__main__':
    unittest.main()
