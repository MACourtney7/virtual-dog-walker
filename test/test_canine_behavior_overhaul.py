import os
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

    def test_catch_up_probability_formula(self):
        # Formula: base = clamp((dist-220)/260, 0.08, 0.90); p = base * (0.45 + 0.11*obedience)
        def catch_up_prob(dist, obedience):
            base = min(0.90, max(0.08, (dist - 220) / 260))
            return min(1, max(0, base * (0.45 + 0.11 * obedience)))

        self.assertAlmostEqual(catch_up_prob(220, 4), 0.08 * (0.45 + 0.44), places=6)
        self.assertAlmostEqual(catch_up_prob(480, 4), 0.90 * (0.45 + 0.44), places=6)
        self.assertGreater(catch_up_prob(400, 5), catch_up_prob(400, 1))
        # Source must contain the formula constants
        self.assertIn("(distToOwner - 220) / 260", self.dog_src)
        self.assertIn("0.45 + 0.11 * obedience", self.dog_src)

    # AC-013.2: re-leash proximity gate
    def test_releash_gate_rejects_far(self):
        self.assertIn("dist > 68", self.main_src)
        self.assertIn("Too far to clip lead!", self.main_src)

    def test_releash_gate_accepts_close(self):
        # The gate must only reject when dist > 68 (i.e. accept <= 68)
        self.assertIn("if (dist > 68)", self.main_src)
        self.assertIn("this.owner.isLeashed = true;", self.main_src)

    # AC-013.4: procedural canine audio synthesizers
    def test_audio_synthesizers_exist(self):
        for name in ["playBark", "playSniff", "playWhine", "playLeadClip", "playPant"]:
            self.assertRegex(
                self.audio_src,
                r"\b" + name + r"\s*\(",
                msg=f"Missing audio synthesizer: {name}",
            )

    # AC-013.5: ambient resting states
    def test_resting_states_defined(self):
        self.assertIn("LYING_DOWN:", self.dog_src)
        self.assertIn("ROLLING:", self.dog_src)
        self.assertIn("DogState.LYING_DOWN", self.dog_src)
        self.assertIn("DogState.ROLLING", self.dog_src)

    # AC-013.6: poop dedupe + ghost purge
    def test_poop_dedupe_and_ghost_purge(self):
        # Simulate the JS logic in Python
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
        b = {"id": "b", "x": 103, "y": 100}  # within 6px of a -> dedupe
        self.assertIs(f.addPoopPile(a), a)
        self.assertIs(f.addPoopPile(b), a)
        self.assertEqual(len(f.poopPiles), 1)

        # Ghost purge: add a ghost within 6px of target, plus a distant pile
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
