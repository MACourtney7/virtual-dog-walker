"""Tests for leash length constraints and owner hold-up logic.

These tests exercise the JS module `src/world/leash.js` and the owner
integration in `src/entities/owner.js` via Node subprocesses.
"""
import json
import os
import shutil
import subprocess
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LEASH_MODULE = os.path.join(REPO_ROOT, "src", "world", "leash.js")
OWNER_MODULE = os.path.join(REPO_ROOT, "src", "entities", "owner.js")
DOG_MODULE = os.path.join(REPO_ROOT, "src", "entities", "companion_dog.js")


def _node_available():
    return shutil.which("node") is not None


def _run_node(script):
    """Run a Node ESM script and return parsed JSON output."""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"node failed (rc={result.returncode})\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return json.loads(result.stdout.strip())


@unittest.skipUnless(_node_available(), "node is required to run leash JS tests")
class LeashTests(unittest.TestCase):
    def test_max_leash_length_exported(self):
        script = f"""
        import {{ MAX_LEASH_LENGTH }} from {json.dumps(LEASH_MODULE)};
        console.log(JSON.stringify({{ value: MAX_LEASH_LENGTH }}));
        """
        out = _run_node(script)
        self.assertEqual(out["value"], 52.5)

    def test_owner_clamped_to_leash_radius(self):
        script = f"""
        import {{ clampOwnerToLeash, MAX_LEASH_LENGTH }} from {json.dumps(LEASH_MODULE)};
        const dog = {{ x: 0, y: 0 }};
        const owner = {{ x: 1000, y: 0 }};
        const clamped = clampOwnerToLeash(owner, dog, MAX_LEASH_LENGTH);
        const dist = Math.hypot(clamped.x - dog.x, clamped.y - dog.y);
        console.log(JSON.stringify({{ clamped, dist }}));
        """
        out = _run_node(script)
        self.assertAlmostEqual(out["dist"], 52.5, places=9)
        self.assertAlmostEqual(out["clamped"]["x"], 52.5, places=9)
        self.assertAlmostEqual(out["clamped"]["y"], 0.0, places=9)

    def test_owner_frozen_while_pooping_on_leash(self):
        script = f"""
        import {{ isOwnerFrozen }} from {json.dumps(LEASH_MODULE)};
        const dog = {{ isOnLeash: true, isPooping: true }};
        console.log(JSON.stringify({{ frozen: isOwnerFrozen(dog) }}));
        """
        out = _run_node(script)
        self.assertIs(out["frozen"], True)

    def test_owner_free_off_leash(self):
        """Off-leash: Owner.update() must not clamp or freeze the owner."""
        script = f"""
        import {{ Owner }} from {json.dumps(OWNER_MODULE)};
        const owner = new Owner(1000, 0, 'Walker', true);
        owner.setGait('STAND');
        owner.dog = {{ x: 0, y: 0, isOnLeash: false, isPooping: true }};
        owner.update(1 / 60, null);
        console.log(JSON.stringify({{
          x: owner.x,
          y: owner.y,
          vx: owner.vx,
          vy: owner.vy,
          isMoving: owner.isMoving,
        }}));
        """
        out = _run_node(script)
        # Off-leash: not frozen, not clamped, position unchanged.
        self.assertAlmostEqual(out["x"], 1000.0, places=9)
        self.assertAlmostEqual(out["y"], 0.0, places=9)
        self.assertEqual(out["vx"], 0)
        self.assertEqual(out["vy"], 0)
        self.assertIs(out["isMoving"], False)

    def test_owner_update_clamps_to_leash_radius(self):
        """AC-3.2: Owner.update() clamps the owner within MAX_LEASH_LENGTH."""
        script = f"""
        import {{ Owner }} from {json.dumps(OWNER_MODULE)};
        import {{ MAX_LEASH_LENGTH }} from {json.dumps(LEASH_MODULE)};
        const owner = new Owner(1000, 0, 'Walker', true);
        owner.setGait('STAND');
        owner.dog = {{ x: 0, y: 0, isOnLeash: true, isPooping: false }};
        owner.update(1 / 60, null);
        const dist = Math.hypot(owner.x - 0, owner.y - 0);
        console.log(JSON.stringify({{ x: owner.x, y: owner.y, dist, max: MAX_LEASH_LENGTH }}));
        """
        out = _run_node(script)
        self.assertAlmostEqual(out["dist"], 52.5, places=9)
        self.assertAlmostEqual(out["x"], 52.5, places=9)
        self.assertAlmostEqual(out["y"], 0.0, places=9)

    def test_owner_update_force_stop_while_pooping(self):
        """AC-3.3: Owner.update() freezes the owner while the dog poops on-leash."""
        script = f"""
        import {{ Owner }} from {json.dumps(OWNER_MODULE)};
        const owner = new Owner(0, 0, 'Walker', true);
        owner.setGait('WALK');
        owner.targetHeading = 0;
        owner.angle = 0;
        owner.dog = {{ x: 0, y: 0, isOnLeash: true, isPooping: true }};
        owner.update(1 / 60, null);
        console.log(JSON.stringify({{
          x: owner.x,
          y: owner.y,
          vx: owner.vx,
          vy: owner.vy,
          isMoving: owner.isMoving,
        }}));
        """
        out = _run_node(script)
        # Frozen: no movement integration, zero velocity.
        self.assertAlmostEqual(out["x"], 0.0, places=9)
        self.assertAlmostEqual(out["y"], 0.0, places=9)
        self.assertEqual(out["vx"], 0)
        self.assertEqual(out["vy"], 0)
        self.assertIs(out["isMoving"], False)

    def test_owner_update_frozen_still_clamped(self):
        """Frozen owner is still clamped within leash range of a moved dog."""
        script = f"""
        import {{ Owner }} from {json.dumps(OWNER_MODULE)};
        const owner = new Owner(1000, 0, 'Walker', true);
        owner.setGait('STAND');
        owner.dog = {{ x: 0, y: 0, isOnLeash: true, isPooping: true }};
        owner.update(1 / 60, null);
        const dist = Math.hypot(owner.x - 0, owner.y - 0);
        console.log(JSON.stringify({{ x: owner.x, y: owner.y, dist }}));
        """
        out = _run_node(script)
        self.assertAlmostEqual(out["dist"], 52.5, places=9)
        self.assertAlmostEqual(out["x"], 52.5, places=9)
        self.assertAlmostEqual(out["y"], 0.0, places=9)

    def test_owner_update_slowed_dog_holds_owner_back(self):
        """AC-4.5: A dog that has moved away drags the owner back within range."""
        script = f"""
        import {{ Owner }} from {json.dumps(OWNER_MODULE)};
        const owner = new Owner(0, 0, 'Walker', true);
        owner.setGait('STAND');
        owner.dog = {{ x: 500, y: 0, isOnLeash: true, isPooping: false }};
        owner.update(1 / 60, null);
        const dist = Math.hypot(owner.x - 500, owner.y - 0);
        console.log(JSON.stringify({{ x: owner.x, y: owner.y, dist }}));
        """
        out = _run_node(script)
        self.assertAlmostEqual(out["dist"], 52.5, places=9)
        # Owner is pulled toward the dog along the leash axis.
        self.assertAlmostEqual(out["x"], 447.5, places=9)
        self.assertAlmostEqual(out["y"], 0.0, places=9)

    def test_real_dog_pooping_freezes_and_clamps_owner(self):
        """Drive a real CompanionDog into POOPING and verify Owner.update() freezes/clamps."""
        script = f"""
        import {{ CompanionDog, DogState }} from {json.dumps(DOG_MODULE)};
        import {{ Owner }} from {json.dumps(OWNER_MODULE)};
        import {{ MAX_LEASH_LENGTH }} from {json.dumps(LEASH_MODULE)};
        const owner = new Owner(1000, 0, 'Walker', true);
        owner.setGait('WALK');
        owner.targetHeading = 0;
        owner.angle = 0;
        const dog = new CompanionDog(0, 0, owner);
        dog.state = DogState.POOPING;
        dog.poopSquatDuration = 2.0;
        dog.vx = 0;
        dog.vy = 0;
        const isPooping = dog.isPooping;
        const isOnLeash = dog.isOnLeash;
        owner.dog = dog;
        owner.update(1 / 60, null);
        const dist = Math.hypot(owner.x - dog.x, owner.y - dog.y);
        console.log(JSON.stringify({{
          isPooping,
          isOnLeash,
          x: owner.x,
          y: owner.y,
          vx: owner.vx,
          vy: owner.vy,
          isMoving: owner.isMoving,
          dist,
          max: MAX_LEASH_LENGTH,
        }}));
        """
        out = _run_node(script)
        self.assertIs(out["isPooping"], True)
        self.assertIs(out["isOnLeash"], True)
        # Frozen: zero velocity, not moving.
        self.assertEqual(out["vx"], 0)
        self.assertEqual(out["vy"], 0)
        self.assertIs(out["isMoving"], False)
        # Clamped within MAX_LEASH_LENGTH of the dog.
        self.assertAlmostEqual(out["dist"], 52.5, places=9)
        self.assertAlmostEqual(out["x"], 52.5, places=9)
        self.assertAlmostEqual(out["y"], 0.0, places=9)

    def test_force_stop_releases_after_poop(self):
        script = f"""
        import {{ isOwnerFrozen }} from {json.dumps(LEASH_MODULE)};
        const dog = {{ isOnLeash: true, isPooping: true }};
        const before = isOwnerFrozen(dog);
        dog.isPooping = false;
        const after = isOwnerFrozen(dog);
        console.log(JSON.stringify({{ before, after }}));
        """
        out = _run_node(script)
        self.assertIs(out["before"], True)
        self.assertIs(out["after"], False)

    def test_slowed_dog_holds_owner_back(self):
        """A dog that has moved away drags the owner back within leash range."""
        script = f"""
        import {{ clampOwnerToLeash, MAX_LEASH_LENGTH }} from {json.dumps(LEASH_MODULE)};
        const dog = {{ x: 0, y: 0 }};
        const owner = {{ x: 0, y: 0 }};
        // Simulate the dog walking away while the owner stays put.
        dog.x = 500;
        dog.y = 0;
        const clamped = clampOwnerToLeash(owner, dog, MAX_LEASH_LENGTH);
        const dist = Math.hypot(clamped.x - dog.x, clamped.y - dog.y);
        console.log(JSON.stringify({{ clamped, dist }}));
        """
        out = _run_node(script)
        self.assertAlmostEqual(out["dist"], 52.5, places=9)
        # Owner is pulled toward the dog along the leash axis.
        self.assertAlmostEqual(out["clamped"]["x"], 447.5, places=9)
        self.assertAlmostEqual(out["clamped"]["y"], 0.0, places=9)


if __name__ == '__main__':
    unittest.main()
