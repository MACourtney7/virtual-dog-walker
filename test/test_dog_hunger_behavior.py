"""Behavioural tests for CompanionDog hunger normalization and HomeHungerAnimator.

These tests shell out to `node` so they exercise the real ES modules rather
than re-implementing their logic in Python.
"""

import json
import os
import shutil
import subprocess
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def node_available():
    return shutil.which("node") is not None


def run_node(script):
    """Run a Node ESM script from the project root and return parsed JSON."""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"node exited with {result.returncode}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    out = result.stdout.strip()
    # Take the last non-empty line so stray console output doesn't break parsing.
    lines = [ln for ln in out.splitlines() if ln.strip()]
    if not lines:
        raise AssertionError(f"node produced no output\nSTDERR:\n{result.stderr}")
    return json.loads(lines[-1])


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestCompanionDogHungerNormalization(unittest.TestCase):
    def _run_dog_case(self, snapshot_js, now_ms):
        script = f"""
import {{ CompanionDog }} from './src/entities/companion_dog.js';

const dog = new CompanionDog();
const snapshot = {snapshot_js};
dog._applyHungerSnapshot(snapshot, {now_ms});
console.log(JSON.stringify({{
  isHungry: dog.isHungry,
  hunger: dog.hunger,
}}));
"""
        return run_node(script)

    def test_full_state_shape_not_hungry_before_duration(self):
        snapshot = "{ version: 1, needs: { hunger: { lastFedAt: 1000, durationMs: 120000 } } }"
        result = self._run_dog_case(snapshot, 1000 + 60000)
        self.assertFalse(result["isHungry"])
        self.assertIsNotNone(result["hunger"])
        self.assertEqual(result["hunger"]["durationMs"], 120000)
        self.assertEqual(result["hunger"]["lastFedAt"], 1000)

    def test_full_state_shape_hungry_after_duration(self):
        snapshot = "{ version: 1, needs: { hunger: { lastFedAt: 1000, durationMs: 120000 } } }"
        result = self._run_dog_case(snapshot, 1000 + 120000)
        self.assertTrue(result["isHungry"])

    def test_full_state_shape_hungry_well_after_duration(self):
        snapshot = "{ version: 1, needs: { hunger: { lastFedAt: 1000, durationMs: 120000 } } }"
        result = self._run_dog_case(snapshot, 1000 + 200000)
        self.assertTrue(result["isHungry"])

    def test_wrapper_shape(self):
        snapshot = "{ hunger: { lastFedAt: 0, durationMs: 1000 } }"
        result = self._run_dog_case(snapshot, 500)
        self.assertFalse(result["isHungry"])
        result = self._run_dog_case(snapshot, 1500)
        self.assertTrue(result["isHungry"])

    def test_bare_shape(self):
        snapshot = "{ lastFedAt: 0, durationMs: 1000 }"
        result = self._run_dog_case(snapshot, 500)
        self.assertFalse(result["isHungry"])
        result = self._run_dog_case(snapshot, 1500)
        self.assertTrue(result["isHungry"])

    def test_explicit_is_hungry_is_respected(self):
        snapshot = "{ lastFedAt: 0, durationMs: 1000, isHungry: false }"
        result = self._run_dog_case(snapshot, 5000)
        self.assertFalse(result["isHungry"])

    def test_null_snapshot_clears_hunger(self):
        result = self._run_dog_case("null", 0)
        self.assertFalse(result["isHungry"])
        self.assertIsNone(result["hunger"])


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestHomeHungerAnimator(unittest.TestCase):
    def test_default_interval_is_5000(self):
        script = """
import { DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS } from './src/ui/home_hunger_animator.js';
console.log(JSON.stringify({ value: DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS }));
"""
        result = run_node(script)
        self.assertEqual(result["value"], 5000)

    def test_triggers_periodically_when_hungry(self):
        script = """
import { HomeHungerAnimator, DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS } from './src/ui/home_hunger_animator.js';

let calls = 0;
const dog = {
  setHunger() {},
  playHungryAnimation() { calls += 1; }
};
const store = {
  getHunger: () => ({ isHungry: true })
};
const animator = new HomeHungerAnimator({
  dogStateStore: store,
  dog,
  animationIntervalMs: DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS,
  now: () => 0,
  setIntervalFn: () => 1,
  clearIntervalFn: () => {}
});

animator.tick(0);
const afterFirst = calls;
animator.tick(1000);
const afterEarly = calls;
animator.tick(5000);
const afterInterval = calls;
animator.tick(6000);
const afterSecondEarly = calls;
animator.tick(10000);
const afterSecondInterval = calls;

console.log(JSON.stringify({
  afterFirst, afterEarly, afterInterval, afterSecondEarly, afterSecondInterval
}));
"""
        result = run_node(script)
        self.assertEqual(result["afterFirst"], 1)
        self.assertEqual(result["afterEarly"], 1)
        self.assertEqual(result["afterInterval"], 2)
        self.assertEqual(result["afterSecondEarly"], 2)
        self.assertEqual(result["afterSecondInterval"], 3)

    def test_stops_triggering_when_fed(self):
        script = """
import { HomeHungerAnimator } from './src/ui/home_hunger_animator.js';

let calls = 0;
let hungry = true;
const dog = {
  setHunger() {},
  playHungryAnimation() { calls += 1; }
};
const store = {
  getHunger: () => ({ isHungry: hungry })
};
const animator = new HomeHungerAnimator({
  dogStateStore: store,
  dog,
  animationIntervalMs: 5000,
  now: () => 0,
  setIntervalFn: () => 1,
  clearIntervalFn: () => {}
});

animator.tick(0);
const afterFirst = calls;
hungry = false;
animator.tick(5000);
const afterFed = calls;
hungry = true;
animator.tick(10000);
const afterHungryAgain = calls;

console.log(JSON.stringify({ afterFirst, afterFed, afterHungryAgain }));
"""
        result = run_node(script)
        self.assertEqual(result["afterFirst"], 1)
        self.assertEqual(result["afterFed"], 1)
        # After being fed, the next hungry tick should trigger immediately
        # (lastAnimationAt was reset).
        self.assertEqual(result["afterHungryAgain"], 2)

    def test_swallows_throwing_dog_hooks(self):
        script = """
import { HomeHungerAnimator } from './src/ui/home_hunger_animator.js';

const dog = {
  setHunger() { throw new Error('setHunger boom'); },
  playHungryAnimation() { throw new Error('playHungryAnimation boom'); }
};
const store = {
  getHunger: () => ({ isHungry: true })
};
const animator = new HomeHungerAnimator({
  dogStateStore: store,
  dog,
  animationIntervalMs: 5000,
  now: () => 0,
  setIntervalFn: () => 1,
  clearIntervalFn: () => {}
});

let threw = false;
try {
  animator.tick(0);
  animator.tick(5000);
  animator.tick(10000);
} catch (e) {
  threw = true;
}

console.log(JSON.stringify({ threw }));
"""
        result = run_node(script)
        self.assertFalse(result["threw"])

    def test_swallows_store_errors(self):
        script = """
import { HomeHungerAnimator } from './src/ui/home_hunger_animator.js';

let calls = 0;
const dog = {
  setHunger() {},
  playHungryAnimation() { calls += 1; }
};
const store = {
  getHunger: () => { throw new Error('boom'); }
};
const animator = new HomeHungerAnimator({
  dogStateStore: store,
  dog,
  animationIntervalMs: 5000,
  now: () => 0,
  setIntervalFn: () => 1,
  clearIntervalFn: () => {}
});

let threw = false;
try {
  animator.tick(0);
  animator.tick(5000);
} catch (e) {
  threw = true;
}

console.log(JSON.stringify({ threw, calls }));
"""
        result = run_node(script)
        self.assertFalse(result["threw"])
        self.assertEqual(result["calls"], 0)


if __name__ == "__main__":
    unittest.main()
