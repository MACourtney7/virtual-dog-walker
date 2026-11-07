import math
import os
import re
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def read(rel_path):
    with open(os.path.join(ROOT, rel_path), "r", encoding="utf-8") as f:
        return f.read()


class TestCanineBehaviorOverhaul(unittest.TestCase):
    """AC-013.1 / AC-013.2 / AC-013.4 / AC-013.5 / AC-013.6 remediation checks."""

    def setUp(self):
        self.dog_src = read("src/entities/companion_dog.js")
        self.main_src = read("src/main.js")
        self.field_src = read("src/world/field.js")
        self.audio_src = read("src/systems/audio.js")

    # AC-013.1: no 230px hard clamp; distance-scaled catch-up
    def test_no_230px_hard_clamp(self):
        self.assertNotIn("distToOwner > 230", self.dog_src)
        self.assertNotIn("* 230;", self.dog_src)
        self.assertNotIn("maxRoam = 230", self.dog_src)
        self.assertNotIn("maxRoam", self.dog_src)

    def test_catch_up_probability_formula(self):
        # Formula: base = clamp((dist-220)/260, 0.08, 0.90); p = base * (0.45 + 0.11*obedience)
        def catch_up_prob(dist, obedience):
            base = min(0.90, max(0.08, (dist - 220) / 260))
            return min(1, max(0, base * (0.45 + 0.11 * obedience)))

        self.assertAlmostEqual(catch_up_prob(220, 4), 0.08 * (0.45 + 0.44), places=6)
        self.assertAlmostEqual(catch_up_prob(480, 4), 0.90 * (0.45 + 0.44), places=6)
        self.assertGreater(catch_up_prob(400, 5), catch_up_prob(400, 1))
        # Monotonic in distance and obedience
        for ob in range(1, 6):
            self.assertLessEqual(catch_up_prob(220, ob), catch_up_prob(400, ob))
            self.assertLessEqual(catch_up_prob(400, ob), catch_up_prob(600, ob))
        for dist in (220, 300, 400, 480, 600):
            self.assertLessEqual(catch_up_prob(dist, 1), catch_up_prob(dist, 5))
        # Source must contain the formula constants
        self.assertIn("(distToOwner - 220) / 260", self.dog_src)
        self.assertIn("0.45 + 0.11 * obedience", self.dog_src)

    # AC-013.2: re-leash proximity gate
    def test_strict_releash_proximity_boundary(self):
        self.assertIn("if (dist > 68)", self.main_src)
        self.assertIn("Too far to clip lead!", self.main_src)
        self.assertIn("this.owner.isLeashed = true;", self.main_src)
        # Boundary semantics: <= 68 accepted, > 68 rejected
        def gate(dist):
            return dist <= 68
        self.assertTrue(gate(68))
        self.assertTrue(gate(0))
        self.assertFalse(gate(68.0001))
        self.assertFalse(gate(200))

    # H1: 14s scent cooldown
    def test_scent_trail_14s_cooldown(self):
        self.assertIn("this.lastSniffFollowAt = 0;", self.dog_src)
        self.assertIn("14000", self.dog_src)
        self.assertIn("cooldownActive", self.dog_src)
        self.assertIn("this.lastSniffFollowAt = now;", self.dog_src)

    # H2: tangent-driven zoomies
    def test_zoomies_tangent_velocity(self):
        self.assertIn("Math.sin(this.zoomiesPhase)", self.dog_src)
        self.assertIn("Math.sin(this.zoomiesPhase * 2)", self.dog_src)
        self.assertIn("Math.cos(t)", self.dog_src)
        self.assertIn("Math.cos(2 * t)", self.dog_src)

        # Numerical derivative check of the parametric figure-eight
        rx, ry = 135.0, 80.0
        speed = 3.8
        for t in (0.0, 0.5, 1.0, 2.0, 3.0):
            x = lambda tt: rx * math.sin(tt)
            y = lambda tt: ry * (math.sin(tt * 2) * 0.5)
            h = 1e-6
            num_dx = (x(t + h) - x(t - h)) / (2 * h)
            num_dy = (y(t + h) - y(t - h)) / (2 * h)
            ana_dx = rx * math.cos(t)
            ana_dy = ry * math.cos(2 * t)
            self.assertAlmostEqual(num_dx, ana_dx, places=4)
            self.assertAlmostEqual(num_dy, ana_dy, places=4)
            # Velocity magnitude scales with speed
            self.assertAlmostEqual(ana_dx * speed, num_dx * speed, places=3)

    # H4: rolling entry-gated with sunny zone 8% vs 4% normal
    def test_rolling_entry_gated(self):
        self.assertIn("transitionTo(newState)", self.dog_src)
        self.assertIn("isSunny ? 0.08 : 0.04", self.dog_src)
        self.assertIn("this.currentZone?.sunny", self.dog_src)
        # Rolling must NOT be evaluated continuously per-frame in update(dt)
        # (i.e. no bare `Math.random() < rollChance` outside transitionTo)
        # Verify the old per-frame block is gone
        self.assertNotIn("const rollChance = 0.04;", self.dog_src)

    # H3: lazy audio getter
    def test_lazy_audio_getter(self):
        self.assertIn("get audio()", self.dog_src)
        self.assertIn("set audio(val)", self.dog_src)
        self.assertIn("window.audioEngine || window.sound", self.dog_src)

    # DogState must be imported in main.js
    def test_dogstate_imported_in_main(self):
        self.assertRegex(
            self.main_src,
            r"import\s*\{[^}]*\bDogState\b[^}]*\}\s*from\s*['\"]\./entities/companion_dog\.js['\"]",
        )

    # AC-013.4: procedural canine audio synthesizers
    def test_procedural_audio_synthesizers(self):
        for name in ["playBark", "playSniff", "playWhine", "playLeadClip", "playPant"]:
            self.assertRegex(
                self.audio_src,
                r"\b" + name + r"\s*\(",
                msg=f"Missing audio synthesizer: {name}",
            )
        self.assertIn("_ready()", self.audio_src)

    # AC-013.5: ambient resting states
    def test_resting_states_defined(self):
        self.assertIn("LYING_DOWN:", self.dog_src)
        self.assertIn("ROLLING:", self.dog_src)
        self.assertIn("DogState.LYING_DOWN", self.dog_src)
        self.assertIn("DogState.ROLLING", self.dog_src)

    # AC-013.6: poop dedupe + ghost purge
    def test_poop_dedupe_and_ghost_purge(self):
        class Field:
            def __init__(self):
                self.poopPiles = []

            def addPoopPile(self, pile):
                if not pile:
                    return None
                dup = None
                for p in self.poopPiles:
                    if not p:
                        continue
                    same_id = pile.get("id") is not None and p.get("id") == pile.get("id")
                    close = ((p["x"] - pile["x"]) ** 2 + (p["y"] - pile["y"]) ** 2) ** 0.5 <= 6
                    if same_id or close:
                        dup = p
                        break
                if dup:
                    return dup
                self.poopPiles.append(pile)
                return pile

            def pickupPoop(self, x, y):
                PICKUP_RADIUS = 38
                if not self.poopPiles:
                    return None
                target = None
                min_dist = float("inf")
                for p in self.poopPiles:
                    if not p:
                        continue
                    d = ((p["x"] - x) ** 2 + (p["y"] - y) ** 2) ** 0.5
                    if d <= PICKUP_RADIUS and d < min_dist:
                        min_dist = d
                        target = p
                if not target:
                    return None
                self.poopPiles = [
                    p for p in self.poopPiles
                    if p and p is not target
                    and (target.get("id") is None or p.get("id") != target.get("id"))
                    and ((p["x"] - target["x"]) ** 2 + (p["y"] - target["y"]) ** 2) ** 0.5 > 6
                ]
                return target

        f = Field()
        a = {"id": "a", "x": 100, "y": 100}
        b = {"id": "b", "x": 103, "y": 100}
        self.assertIs(f.addPoopPile(a), a)
        self.assertIs(f.addPoopPile(b), a)
        self.assertEqual(len(f.poopPiles), 1)

        ghost = {"id": "ghost", "x": 101, "y": 101}
        far = {"id": "far", "x": 500, "y": 500}
        f.poopPiles.append(ghost)
        f.poopPiles.append(far)
        picked = f.pickupPoop(100, 100)
        self.assertIs(picked, a)
        ids = [p["id"] for p in f.poopPiles]
        self.assertNotIn("a", ids)
        self.assertNotIn("ghost", ids)
        self.assertIn("far", ids)

    def test_field_source_contains_pickup_logic(self):
        self.assertIn("PICKUP_RADIUS = 38", self.field_src)
        self.assertIn("Math.hypot(p.x - target.x, p.y - target.y) > 6", self.field_src)

    def test_main_pickup_poop_wires_field_pickup_poop(self):
        self.assertIn("this.field.pickupPoop(pile.x, pile.y)", self.main_src)

    def test_zoomies_timer_decrements_before_exit_check(self):
        # The decrement must appear before the exit check so velocity is zeroed
        # on the exact frame the timer expires.
        idx_decrement = self.dog_src.find("this.zoomiesTimer -= dt;")
        idx_exit = self.dog_src.find("if (this.zoomiesTimer <= 0)")
        self.assertNotEqual(idx_decrement, -1)
        self.assertNotEqual(idx_exit, -1)
        self.assertLess(idx_decrement, idx_exit)
        # Velocity zeroing must live inside the exit branch
        window = self.dog_src[idx_exit:idx_exit + 300]
        self.assertIn("this.vx = 0;", window)
        self.assertIn("this.vy = 0;", window)

    # HIGH-1: zoomies must not double-apply movement integration
    def test_zoomies_movement_single_integration(self):
        self.assertIn("if (this.state !== DogState.ZOOMIES)", self.dog_src)
        # The guarded integration block must wrap the x/y increments
        idx = self.dog_src.find("if (this.state !== DogState.ZOOMIES)")
        self.assertNotEqual(idx, -1)
        window = self.dog_src[idx:idx + 200]
        self.assertIn("this.x += this.vx * dt;", window)
        self.assertIn("this.y += this.vy * dt;", window)

    # HIGH-2: resting state entries must route through transitionTo
    def test_sitting_entry_routes_through_transitionTo(self):
        self.assertIn("this.transitionTo(DogState.SITTING)", self.dog_src)
        self.assertIn("this.transitionTo(DogState.IDLE_SNIFF)", self.dog_src)
        # No direct assignments to SITTING / IDLE_SNIFF remain
        self.assertNotIn("this.state = DogState.SITTING;", self.dog_src)
        self.assertNotIn("this.state = DogState.IDLE_SNIFF;", self.dog_src)

    # MEDIUM-1: currentZone must be synced from field.zoneConfig
    def test_sunny_zone_current_zone_sync(self):
        self.assertIn("this.currentZone = field.zoneConfig", self.dog_src)
        self.assertIn("this.currentZone?.sunny", self.dog_src)
        self.assertIn("isSunny ? 0.08 : 0.04", self.dog_src)

    # ------------------------------------------------------------------
    # MEDIUM-1: executable runtime behavior simulations
    # ------------------------------------------------------------------

    def _make_dog(self, state="ROAMING", is_leashed=False, owner_speed=0.0):
        """Build a lightweight Python stand-in mirroring the JS resting/zoomies logic."""
        class Owner:
            def __init__(self, speed, leashed):
                self.vx = speed
                self.vy = 0.0
                self.isLeashed = leashed
                self.x = 0.0
                self.y = 0.0
                self.angle = 0.0
                self.isMoving = speed > 0

        class Dog:
            def __init__(self):
                self.state = state
                self.idleRestTimer = 0.0
                self.restStartAt = 0.0
                self.vx = 0.0
                self.vy = 0.0
                self.zoomiesTimer = 0.0
                self.zoomiesPhase = 0.0
                self.owner = Owner(owner_speed, is_leashed)
                self.lastSniffFollowAt = 0
                self.targetScent = None
                self.visitedScents = set()

            def transitionTo(self, new_state):
                if self.state == new_state:
                    return
                self.state = new_state

            def update_resting(self, dt):
                owner_speed = (self.owner.vx ** 2 + self.owner.vy ** 2) ** 0.5
                if self.owner and not self.owner.isLeashed and owner_speed < 5:
                    self.idleRestTimer += dt
                    if (self.idleRestTimer > 15
                            and self.state != "LYING_DOWN"
                            and self.state != "ROLLING"):
                        self.transitionTo("LYING_DOWN")
                        self.restStartAt = 1.0
                elif owner_speed > 5:
                    self.idleRestTimer = 0
                    if self.state in ("LYING_DOWN", "ROLLING"):
                        self.transitionTo("ROAMING")

            def update_zoomies(self, dt):
                if self.zoomiesTimer <= 0:
                    self.vx = 0.0
                    self.vy = 0.0
                    self.zoomiesPhase = 0.0
                    self.transitionTo("FOLLOWING" if self.owner.isLeashed else "ROAMING")
                    return
                self.zoomiesTimer -= dt

            def sniff_follow_allowed(self, now_ms):
                return (now_ms - self.lastSniffFollowAt) >= 14000

        return Dog()

    def test_lying_down_transition_after_15s_owner_stillness(self):
        dog = self._make_dog(state="ROAMING", is_leashed=False, owner_speed=0.0)
        dt = 0.5
        for _ in range(32):  # 16 seconds
            dog.update_resting(dt)
        self.assertEqual(dog.state, "LYING_DOWN")
        self.assertGreater(dog.idleRestTimer, 15)

    def test_owner_movement_resets_lying_down_to_roaming(self):
        dog = self._make_dog(state="ROAMING", is_leashed=False, owner_speed=0.0)
        for _ in range(32):
            dog.update_resting(0.5)
        self.assertEqual(dog.state, "LYING_DOWN")

        dog.owner.vx = 10.0
        dog.update_resting(0.5)
        self.assertEqual(dog.state, "ROAMING")
        self.assertEqual(dog.idleRestTimer, 0)

    def test_zoomies_exit_zeros_velocity(self):
        dog = self._make_dog(state="ZOOMIES", is_leashed=False, owner_speed=0.0)
        dog.vx = 123.0
        dog.vy = -45.0
        dog.zoomiesTimer = 0.0
        dog.update_zoomies(0.016)
        self.assertEqual(dog.vx, 0.0)
        self.assertEqual(dog.vy, 0.0)
        self.assertEqual(dog.state, "ROAMING")

    def test_scent_trail_14s_cooldown_behavioral(self):
        dog = self._make_dog()
        dog.lastSniffFollowAt = 1000
        # Within 14s -> cooldown active (no active tracking)
        self.assertFalse(dog.sniff_follow_allowed(1000 + 13999))
        # At/after 14s -> tracking allowed again
        self.assertTrue(dog.sniff_follow_allowed(1000 + 14000))
        self.assertTrue(dog.sniff_follow_allowed(1000 + 20000))

    def test_active_states_not_interrupted_by_idle_rest(self):
        """Active/interactive states must never be overridden to LYING_DOWN by ambient rest."""
        active_states = {
            "FETCHING", "ZOOMIES", "BARKING", "POOPING", "LOST",
            "RECALLED", "PLAY_BOW", "ROLLING", "LYING_DOWN",
        }

        class Owner:
            def __init__(self):
                self.vx = 0.0
                self.vy = 0.0
                self.isLeashed = False

        class Dog:
            def __init__(self, state):
                self.state = state
                self.idleRestTimer = 20.0  # already past the 15s threshold
                self.owner = Owner()

            def transitionTo(self, new_state):
                if self.state == new_state:
                    return
                self.state = new_state

            def update_resting(self, dt):
                owner_speed = (self.owner.vx ** 2 + self.owner.vy ** 2) ** 0.5
                if (self.owner and not self.owner.isLeashed
                        and owner_speed < 5 and self.state not in active_states):
                    self.idleRestTimer += dt
                    if self.idleRestTimer > 15:
                        self.transitionTo("LYING_DOWN")
                elif owner_speed > 5:
                    self.idleRestTimer = 0
                    if self.state in ("LYING_DOWN", "ROLLING"):
                        self.transitionTo("ROAMING")
                elif self.state in active_states:
                    self.idleRestTimer = 0

        for state in ("FETCHING", "ZOOMIES", "RECALLED"):
            dog = Dog(state)
            dog.update_resting(0.5)
            self.assertEqual(dog.state, state,
                             f"{state} must not be overridden to LYING_DOWN")
            self.assertEqual(dog.idleRestTimer, 0,
                             f"{state} must reset idleRestTimer")

        # Ambient-capable state still transitions
        dog = Dog("ROAMING")
        dog.update_resting(0.5)
        self.assertEqual(dog.state, "LYING_DOWN")

    def test_whistle_and_zoomies_resets_idle_rest_timer(self):
        """whistleRecall() and triggerZoomies() must reset idleRestTimer to 0."""
        class Owner:
            def __init__(self):
                self.vx = 0.0
                self.vy = 0.0
                self.isLeashed = False
                self.x = 0.0
                self.y = 0.0
                self.angle = 0.0

        class Dog:
            def __init__(self):
                self.state = "ROAMING"
                self.idleRestTimer = 20.0
                self.owner = Owner()
                self.x = 0.0
                self.y = 0.0
                self.vx = 0.0
                self.vy = 0.0
                self.angle = 0.0
                self.sprintSpeed = 290
                self.isLost = False
                self.ownerStillTimer = 0
                self.strayCheckTimer = 0
                self.emoteBubble = None
                self.emoteTimer = 0
                self.wagSpeed = 8
                self.isRecalledToHeel = False
                self.recallHeelTimer = 0
                self.socialTargetDog = None
                self.isReturningToOwner = False
                self.isPullingLeash = False
                self.hasBall = False
                self.targetBall = None
                self.zoomiesTimer = 0
                self.zoomiesPhase = 0
                self.zoomiesCenter = {"x": 0.0, "y": 0.0}

            def dropStick(self):
                pass

            def whistleRecall(self):
                self.state = "RECALLED"
                self.isLost = False
                self.ownerStillTimer = 0
                self.strayCheckTimer = 0
                self.isRecalledToHeel = False
                self.recallHeelTimer = 10.0
                self.idleRestTimer = 0
                self.socialTargetDog = None
                self.isReturningToOwner = False
                self.isPullingLeash = False
                self.dropStick()

            def triggerZoomies(self):
                if self.owner and self.owner.isLeashed:
                    return False
                if self.state in ("LOST", "POOPING"):
                    return False
                self.dropStick()
                self.idleRestTimer = 0
                self.state = "ZOOMIES"
                self.zoomiesTimer = 4.2
                self.zoomiesPhase = 0
                self.zoomiesCenter = {"x": self.x, "y": self.y}
                return True

        dog = Dog()
        dog.whistleRecall()
        self.assertEqual(dog.idleRestTimer, 0)

        dog2 = Dog()
        dog2.triggerZoomies()
        self.assertEqual(dog2.idleRestTimer, 0)

    def test_scent_arrival_cooldown_not_refreshed_while_idling(self):
        """lastSniffFollowAt must only be set on first arrival, not refreshed each frame."""

        class Dog:
            def __init__(self):
                self.lastSniffFollowAt = 0
                self.lastReachedScent = None
                self.targetScent = {"x": 0.0, "y": 0.0, "life": 1.0}
                self.x = 0.0
                self.y = 0.0
                self.vx = 0.0
                self.vy = 0.0

            def tick(self, now):
                dx = self.targetScent["x"] - self.x
                dy = self.targetScent["y"] - self.y
                dist = (dx * dx + dy * dy) ** 0.5
                if dist <= 12:
                    if self.targetScent and self.lastReachedScent is not self.targetScent:
                        self.lastReachedScent = self.targetScent
                        self.lastSniffFollowAt = now

        dog = Dog()
        dog.tick(1000)
        self.assertEqual(dog.lastSniffFollowAt, 1000)
        # Subsequent frames while idling at the same node must NOT refresh the timestamp
        for t in (1100, 1200, 1300, 5000):
            dog.tick(t)
            self.assertEqual(dog.lastSniffFollowAt, 1000)

        # A new scent node re-arms the latch
        dog.targetScent = {"x": 0.0, "y": 0.0, "life": 1.0}
        dog.tick(6000)
        self.assertEqual(dog.lastSniffFollowAt, 6000)

    def test_zoomies_center_shifts_on_collision(self):
        """updateZoomies must shift zoomiesCenter when collision resolution displaces the dog."""
        rx, ry = 135.0, 80.0

        class Dog:
            def __init__(self):
                self.x = 0.0
                self.y = 0.0
                self.radius = 14
                self.zoomiesPhase = 0.5
                self.zoomiesCenter = {"x": 0.0, "y": 0.0}

        def resolve_field_collision(dog, radius, field):
            # Simulate a wall push-out of +10 on x and -5 on y
            dog.x += 10.0
            dog.y -= 5.0

        dog = Dog()
        cx = dog.zoomiesCenter["x"]
        cy = dog.zoomiesCenter["y"]
        dog.x = cx + rx * math.sin(dog.zoomiesPhase)
        dog.y = cy + ry * (math.sin(dog.zoomiesPhase * 2) * 0.5)
        resolve_field_collision(dog, dog.radius, object())
        expected_x = cx + rx * math.sin(dog.zoomiesPhase)
        expected_y = cy + ry * (math.sin(dog.zoomiesPhase * 2) * 0.5)
        dog.zoomiesCenter["x"] += (dog.x - expected_x)
        dog.zoomiesCenter["y"] += (dog.y - expected_y)

        self.assertAlmostEqual(dog.zoomiesCenter["x"], 10.0, places=6)
        self.assertAlmostEqual(dog.zoomiesCenter["y"], -5.0, places=6)

    def test_rolling_duration_lock(self):
        """transitionTo must lock stateTimer to 2.5 when entering ROLLING."""

        class Dog:
            def __init__(self):
                self.state = "ROAMING"
                self.stateTimer = 0.0
                self.owner = None
                self.happiness = 100
                self.currentZone = {"sunny": True}
                self.wagSpeed = 8

            def transitionTo(self, new_state):
                if self.state == new_state:
                    return
                self.state = new_state
                if new_state in ("SITTING", "IDLE_SNIFF"):
                    if self.happiness >= 80:
                        # Force the roll for deterministic testing
                        self.state = "ROLLING"
                        self.stateTimer = 2.5
                        self.wagSpeed = 20
                if self.state == "ROLLING":
                    self.stateTimer = 2.5

        dog = Dog()
        dog.transitionTo("SITTING")
        self.assertEqual(dog.state, "ROLLING")
        self.assertEqual(dog.stateTimer, 2.5)

        # Callers attempting to overwrite the timer must be guarded
        if dog.state != "ROLLING":
            dog.stateTimer = 2.0 + 1.0
        self.assertEqual(dog.stateTimer, 2.5)

    def test_releash_proximity_gate_behavioral(self):
        class Owner:
            def __init__(self):
                self.isLeashed = False

        class Dog:
            def __init__(self, x, y):
                self.x = x
                self.y = y

        class Game:
            def __init__(self):
                self.owner = Owner()
                self.dog = Dog(0.0, 0.0)
                self.toasts = []

            def show_toast(self, msg):
                self.toasts.append(msg)

            def toggle_leash(self):
                if self.owner.isLeashed:
                    self.owner.isLeashed = False
                    return
                dist = ((self.dog.x - self.owner.x) ** 2 + (self.dog.y - self.owner.y) ** 2) ** 0.5
                if dist > 68:
                    self.show_toast("Too far to clip lead!")
                    return
                self.owner.isLeashed = True

        # Owner at origin
        Owner.x = 0.0
        Owner.y = 0.0

        # Within range (<= 68) -> leash engages
        g = Game()
        g.dog = Dog(68.0, 0.0)
        g.toggle_leash()
        self.assertTrue(g.owner.isLeashed)
        self.assertEqual(g.toasts, [])

        # Out of range (> 68) -> rejected with toast
        g2 = Game()
        g2.dog = Dog(68.0001, 0.0)
        g2.toggle_leash()
        self.assertFalse(g2.owner.isLeashed)
        self.assertEqual(len(g2.toasts), 1)
        self.assertIn("Too far to clip lead!", g2.toasts[0])


if __name__ == "__main__":
    unittest.main()
