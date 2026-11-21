"""Tests for dog need signals and need-based speed reduction.

These tests exercise the JS modules `src/entities/companion_dog.js` and
`src/state/dog_state_store.js` via Node, verifying that:

  * `getEffectiveSpeed()` returns the base speed when no needs are active.
  * Any single active need (hunger / grooming / tiredness) reduces speed by
    the flat `NEED_SPEED_MULTIPLIER` (0.4x).
  * Multiple simultaneous needs do NOT stack multiplicatively.
  * Speed is restored once needs clear.
  * The need getters are read-only (no setter / assignment is a no-op or throws).
  * Actual `dog.update(dt)` displacement is reduced while needs are active and
    restored once they clear (including the ZOOMIES parametric path).
"""

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO_ROOT, "src")


def _node_available():
    return shutil.which("node") is not None


def _run_node(script_body):
    """Run a Node ESM script that imports the project modules.

    The script is written to a unique temp file inside the repo so relative
    imports resolve correctly, then executed with `node`.
    """
    script = textwrap.dedent(
        """
        import { CompanionDog, NEED_SPEED_MULTIPLIER } from './src/entities/companion_dog.js';
        import { DogStateStore } from './src/state/dog_state_store.js';

        const results = {};
        const assert = (cond, msg) => {
          if (!cond) { throw new Error('ASSERTION FAILED: ' + msg); }
        };
        const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

        try {
        """
    ) + textwrap.indent(textwrap.dedent(script_body), "  ") + textwrap.dedent(
        """
        } catch (err) {
          console.error(err && err.stack ? err.stack : String(err));
          process.exit(1);
        }
        console.log(JSON.stringify(results));
        """
    )

    tmp_file = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".mjs",
        prefix="_tmp_test_dog_needs_",
        dir=REPO_ROOT,
        delete=False,
        encoding="utf-8",
    )
    tmp_path = tmp_file.name
    try:
        with tmp_file as fh:
            fh.write(script)
        proc = subprocess.run(
            ["node", tmp_path],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    if proc.returncode != 0:
        raise AssertionError(
            "Node script failed:\nSTDOUT:\n%s\nSTDERR:\n%s"
            % (proc.stdout, proc.stderr)
        )
    return json.loads(proc.stdout.strip().splitlines()[-1])


@unittest.skipUnless(_node_available(), "node is required to run JS module tests")
class DogNeedsTest(unittest.TestCase):
    def test_effective_speed_default_is_base(self):
        out = _run_node(
            """
            const dog = new CompanionDog(0, 0, null);
            dog.speed = 200;
            results.base = dog.speed;
            results.effective = dog.getEffectiveSpeed();
            results.multiplier = NEED_SPEED_MULTIPLIER;
            """
        )
        self.assertEqual(out["base"], 200)
        self.assertEqual(out["effective"], 200)
        self.assertEqual(out["multiplier"], 0.4)

    def test_speed_reduced_when_hungry(self):
        out = _run_node(
            """
            const dog = new CompanionDog(0, 0, null);
            dog.speed = 200;
            dog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            results.isHungry = dog.isHungry;
            results.effective = dog.getEffectiveSpeed();
            results.base = dog.speed;
            """
        )
        self.assertTrue(out["isHungry"])
        self.assertEqual(out["base"], 200)
        self.assertAlmostEqual(out["effective"], 200 * 0.4, places=9)

    def test_speed_reduced_when_needs_grooming(self):
        out = _run_node(
            """
            const dog = new CompanionDog(0, 0, null);
            dog.speed = 200;
            dog.setGroomingState(true);
            results.needsGrooming = dog.needsGrooming;
            results.effective = dog.getEffectiveSpeed();
            results.base = dog.speed;
            """
        )
        self.assertTrue(out["needsGrooming"])
        self.assertEqual(out["base"], 200)
        self.assertAlmostEqual(out["effective"], 200 * 0.4, places=9)

    def test_speed_reduced_when_tired(self):
        out = _run_node(
            """
            const dog = new CompanionDog(0, 0, null);
            dog.speed = 200;
            dog.setTirednessState(true);
            results.isTired = dog.isTired;
            results.effective = dog.getEffectiveSpeed();
            results.base = dog.speed;
            """
        )
        self.assertTrue(out["isTired"])
        self.assertEqual(out["base"], 200)
        self.assertAlmostEqual(out["effective"], 200 * 0.4, places=9)

    def test_speed_not_multiplicative_for_multiple_needs(self):
        out = _run_node(
            """
            const dog = new CompanionDog(0, 0, null);
            dog.speed = 200;
            dog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            dog.setGroomingState(true);
            dog.setTirednessState(true);
            results.effective = dog.getEffectiveSpeed();
            results.base = dog.speed;
            results.multiplier = NEED_SPEED_MULTIPLIER;
            """
        )
        self.assertEqual(out["base"], 200)
        # Single flat multiplier, NOT 0.4^3.
        self.assertAlmostEqual(out["effective"], 200 * 0.4, places=9)
        self.assertGreater(abs(out["effective"] - 200 * (0.4 ** 3)), 1e-6)

    def test_speed_restored_when_needs_clear(self):
        out = _run_node(
            """
            const dog = new CompanionDog(0, 0, null);
            dog.speed = 200;
            dog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            dog.setGroomingState(true);
            dog.setTirednessState(true);
            results.reduced = dog.getEffectiveSpeed();

            dog.setHunger({ isHungry: false, lastFedAt: Date.now(), durationMs: 120000 });
            dog.setGroomingState(false);
            dog.setTirednessState(false);
            results.restored = dog.getEffectiveSpeed();
            results.base = dog.speed;
            """
        )
        self.assertAlmostEqual(out["reduced"], 200 * 0.4, places=9)
        self.assertEqual(out["restored"], 200)
        self.assertEqual(out["base"], 200)

    def test_store_is_authoritative_over_backing_field(self):
        """When the store exposes isHungry(), it wins over the backing field."""
        out = _run_node(
            """
            const dog = new CompanionDog(0, 0, null);
            dog.speed = 200;

            // Backing field says hungry, store says not hungry.
            dog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            results.backingHungry = dog._isHungry;

            let storeHungry = false;
            const store = {
              isHungry: () => storeHungry,
              needsGrooming: () => false,
              isTired: () => false,
              subscribe: () => () => {},
              getSnapshot: () => ({ needs: { hunger: { lastFedAt: 0, durationMs: 1 } } })
            };
            dog.setDogStateStore(store);
            results.hungryWhileStoreFalse = dog.isHungry;

            // Store transitions true -> false while the backing field stays true.
            storeHungry = true;
            results.hungryWhileStoreTrue = dog.isHungry;
            storeHungry = false;
            results.hungryAfterStoreClears = dog.isHungry;
            results.backingStillHungry = dog._isHungry;
            """
        )
        self.assertTrue(out["backingHungry"])
        self.assertFalse(out["hungryWhileStoreFalse"])
        self.assertTrue(out["hungryWhileStoreTrue"])
        self.assertFalse(out["hungryAfterStoreClears"])
        self.assertTrue(out["backingStillHungry"])

    def test_need_getters_are_read_only(self):
        out = _run_node(
            """
            const dog = new CompanionDog(0, 0, null);
            dog.speed = 200;

            // Getters must not expose a setter: assignment is a silent no-op in
            // non-strict mode, or throws in strict mode. Either way the backing
            // value must remain unchanged.
            let threw = false;
            try {
              dog.isHungry = true;
            } catch (e) {
              threw = true;
            }
            results.isHungryAfterAssign = dog.isHungry;
            results.isHungryAssignThrew = threw;

            threw = false;
            try {
              dog.needsGrooming = true;
            } catch (e) {
              threw = true;
            }
            results.needsGroomingAfterAssign = dog.needsGrooming;
            results.needsGroomingAssignThrew = threw;

            threw = false;
            try {
              dog.isTired = true;
            } catch (e) {
              threw = true;
            }
            results.isTiredAfterAssign = dog.isTired;
            results.isTiredAssignThrew = threw;

            // The getters must reflect the backing state set via setters.
            dog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            results.isHungryAfterSetter = dog.isHungry;
            """
        )
        # Assignment must not flip the getter value.
        self.assertFalse(out["isHungryAfterAssign"])
        self.assertFalse(out["needsGroomingAfterAssign"])
        self.assertFalse(out["isTiredAfterAssign"])
        # Setter still works.
        self.assertTrue(out["isHungryAfterSetter"])

    def test_update_displacement_reduced_and_restored(self):
        out = _run_node(
            """
            // Drive the dog with a fixed velocity and measure actual update()
            // displacement with and without active needs.
            const makeDog = () => {
              const dog = new CompanionDog(0, 0, null);
              dog.speed = 200;
              dog.state = 'ROAMING';
              dog.vx = 200;
              dog.vy = 0;
              return dog;
            };

            const dt = 0.1;

            // Baseline (no needs).
            const baseDog = makeDog();
            const baseX0 = baseDog.x;
            baseDog.update(dt, null, [], null, []);
            results.baseDx = baseDog.x - baseX0;

            // Hungry.
            const hungryDog = makeDog();
            hungryDog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            const hungryX0 = hungryDog.x;
            hungryDog.update(dt, null, [], null, []);
            results.hungryDx = hungryDog.x - hungryX0;

            // Dirty (grooming).
            const dirtyDog = makeDog();
            dirtyDog.setGroomingState(true);
            const dirtyX0 = dirtyDog.x;
            dirtyDog.update(dt, null, [], null, []);
            results.dirtyDx = dirtyDog.x - dirtyX0;

            // Tired.
            const tiredDog = makeDog();
            tiredDog.setTirednessState(true);
            const tiredX0 = tiredDog.x;
            tiredDog.update(dt, null, [], null, []);
            results.tiredDx = tiredDog.x - tiredX0;

            // Restored after clearing needs.
            const restoredDog = makeDog();
            restoredDog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            restoredDog.setGroomingState(true);
            restoredDog.setTirednessState(true);
            restoredDog.setHunger({ isHungry: false, lastFedAt: Date.now(), durationMs: 120000 });
            restoredDog.setGroomingState(false);
            restoredDog.setTirednessState(false);
            const restoredX0 = restoredDog.x;
            restoredDog.update(dt, null, [], null, []);
            results.restoredDx = restoredDog.x - restoredX0;

            results.multiplier = NEED_SPEED_MULTIPLIER;
            """
        )
        base_dx = out["baseDx"]
        self.assertGreater(base_dx, 0)
        # Each single need reduces displacement by the flat multiplier.
        self.assertAlmostEqual(out["hungryDx"], base_dx * 0.4, places=6)
        self.assertAlmostEqual(out["dirtyDx"], base_dx * 0.4, places=6)
        self.assertAlmostEqual(out["tiredDx"], base_dx * 0.4, places=6)
        # Restored once needs clear.
        self.assertAlmostEqual(out["restoredDx"], base_dx, places=6)

    def test_update_following_displacement_reduced_with_need(self):
        """Drive updateFollowing() + update() with a need active and assert the
        dog moves visibly slower (~0.15x base displacement)."""
        out = _run_node(
            """
            const makeOwner = () => ({
              x: 0, y: 0, vx: 0, vy: 0, angle: 0, heading: 0,
              isLeashed: true, isMoving: false, gait: 'STAND',
              leashHandSide: 'left', radius: 16, halfWidth: 10.5
            });

            const makeDog = () => {
              const owner = makeOwner();
              const dog = new CompanionDog(0, 0, owner);
              dog.speed = 200;
              dog.state = 'FOLLOWING';
              // Start within MAX_LEASH_LENGTH (52.5px) of the owner so the
              // leash clamp does not dominate the measured displacement.
              dog.x = 40;
              dog.y = 0;
              return dog;
            };

            const dt = 0.1;

            // Baseline (no needs).
            const baseDog = makeDog();
            baseDog.updateFollowing(dt, [], null);
            const baseX0 = baseDog.x;
            const baseY0 = baseDog.y;
            baseDog.update(dt, null, [], null, []);
            results.baseDx = Math.hypot(baseDog.x - baseX0, baseDog.y - baseY0);

            // Hungry.
            const hungryDog = makeDog();
            hungryDog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            hungryDog.updateFollowing(dt, [], null);
            const hungryX0 = hungryDog.x;
            const hungryY0 = hungryDog.y;
            hungryDog.update(dt, null, [], null, []);
            results.hungryDx = Math.hypot(hungryDog.x - hungryX0, hungryDog.y - hungryY0);

            results.multiplier = NEED_SPEED_MULTIPLIER;
            """
        )
        base_dx = out["baseDx"]
        self.assertGreater(base_dx, 0)
        # The needy dog must move visibly slower (~0.15x base displacement).
        self.assertAlmostEqual(out["hungryDx"], base_dx * 0.15, places=6)
        self.assertLess(out["hungryDx"], base_dx * 0.5)

    def test_zoomies_progression_scaled_by_needs(self):
        out = _run_node(
            """
            // ZOOMIES sets x/y directly from a parametric curve; needs must
            // scale the progression (not double-integrate velocity).
            const makeZoomDog = () => {
              const dog = new CompanionDog(0, 0, null);
              dog.speed = 200;
              dog.state = 'ZOOMIES';
              dog.zoomiesTimer = 10;
              dog.zoomiesPhase = 0;
              dog.zoomiesPath = 'FIGURE_EIGHT';
              dog.zoomiesCenter = { x: 0, y: 0 };
              return dog;
            };

            const dt = 0.1;

            const baseDog = makeZoomDog();
            baseDog.updateZoomies(dt, null);
            results.basePhase = baseDog.zoomiesPhase;

            const hungryDog = makeZoomDog();
            hungryDog.setHunger({ isHungry: true, lastFedAt: 0, durationMs: 1 });
            hungryDog.updateZoomies(dt, null);
            results.hungryPhase = hungryDog.zoomiesPhase;

            results.multiplier = NEED_SPEED_MULTIPLIER;
            """
        )
        base_phase = out["basePhase"]
        self.assertGreater(base_phase, 0)
        self.assertAlmostEqual(out["hungryPhase"], base_phase * 0.4, places=6)


if __name__ == '__main__':
    unittest.main()
