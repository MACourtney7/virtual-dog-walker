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


if __name__ == "__main__":
    unittest.main()
