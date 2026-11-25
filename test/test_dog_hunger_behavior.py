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


#!/usr/bin/env python3
"""Behavioural tests for the Wasm care buffer (hunger) and HomeHungerAnimator.

Every scenario launches a fresh `node --input-type=module -e "..."` subprocess,
calls `initWasmSimSync()` synchronously, and drives the Rust-owned care buffer
via `step_care_buffer(dt_ms)`. Assertions are made against exact Wasm event
bitmasks (see crates/dog_walker_core/src/care_sim.rs).
"""
import json
import os
import shutil
import subprocess
import textwrap
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# CareSimBuffer slot offsets (mirror crates/dog_walker_core/src/care_sim.rs).
CARE_SLOT_NOW_MS = 1
CARE_SLOT_HUNGER_ELAPSED_MS = 2
CARE_SLOT_HUNGER_REMAINING_MS = 3
CARE_SLOT_IS_HUNGRY = 8
CARE_SLOT_ACTION_FLAGS = 11
CARE_SLOT_EVENT_BITMASK = 12
CARE_SLOT_HUNGER_LAST_FED_MS = 17
CARE_SLOT_HUNGER_DURATION_MS = 27

# Care command bits.
CARE_CMD_FEED = 1 << 0
CARE_CMD_RESET = 1 << 3

# Care event bits.
CARE_EVENT_HUNGER_STARTED = 1 << 0
CARE_EVENT_FEED_ACCEPTED = 1 << 4
CARE_EVENT_HUNGER_RESOLVED = 1 << 7
CARE_EVENT_ACTION_REJECTED = 1 << 10
CARE_EVENT_UI_FLASH = 1 << 11
CARE_EVENT_TOAST = 1 << 12
CARE_EVENT_RESET = 1 << 13

DEFAULT_HUNGER_DURATION_MS = 120000.0


def node_available():
    return shutil.which("node") is not None


def run_node(script_body: str) -> dict:
    """Run a fresh node ESM process and parse its JSON stdout."""
    body = textwrap.dedent(script_body)
    result = subprocess.run(
        ["node", "--input-type=module", "-e", body],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise AssertionError(
            "node script failed:\nSTDOUT:\n%s\nSTDERR:\n%s"
            % (result.stdout, result.stderr)
        )
    out = result.stdout.strip()
    lines = [ln for ln in out.splitlines() if ln.strip()]
    if not lines:
        raise AssertionError("node produced no output; stderr:\n%s" % result.stderr)
    return json.loads(lines[-1])


def file_url(rel_path: str) -> str:
    return json.dumps("file://" + os.path.join(REPO_ROOT, rel_path))


# Shared Wasm bootstrap + care-buffer helpers, injected at the top of each
# script. Uses a unique prefix so it never collides with scenario identifiers.
WASM_SHIM = """
const hungerBridge = await import(%s);
hungerBridge.initWasmSimSync();
const hungerSim = hungerBridge.getWasmSim();
const hungerBuf = hungerBridge.getBufferView(hungerSim.care_buffer_ptr(), hungerSim.care_buffer_len());

function hungerStep(dtMs) {
  return hungerSim.step_care_buffer(dtMs) >>> 0;
}
// step_care_buffer clamps dt_ms to [0, 1000], so advance in <=1000ms chunks.
function hungerAdvance(totalMs) {
  let rem = totalMs;
  let events = 0;
  while (rem > 0) {
    const chunk = Math.min(1000, rem);
    events = (events | hungerStep(chunk)) >>> 0;
    rem -= chunk;
  }
  return events >>> 0;
}
function hungerReset() {
  // Seed the default hunger duration/last-fed so the buffer starts from a
  // known baseline regardless of how the Wasm module was constructed.
  hungerBuf[%d] = %s;
  hungerBuf[%d] = 0;
  hungerBuf[%d] = %d;
  hungerStep(0);
}
function hungerHex(mask) {
  return '0x' + (mask >>> 0).toString(16).padStart(8, '0');
}
""" % (
    file_url("src/engine/wasm_sim_bridge.js"),
    CARE_SLOT_HUNGER_DURATION_MS,
    DEFAULT_HUNGER_DURATION_MS,
    CARE_SLOT_HUNGER_LAST_FED_MS,
    CARE_SLOT_ACTION_FLAGS,
    CARE_CMD_RESET,
)


def assert_mask(testcase, actual, expected, label):
    testcase.assertEqual(
        actual,
        expected,
        "%s: expected %s, actual %s"
        % (label, "0x%08x" % (expected & 0xFFFFFFFF), "0x%08x" % (actual & 0xFFFFFFFF)),
    )


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestWasmCareHunger(unittest.TestCase):
    def test_initial_hunger_state_not_hungry(self):
        script = WASM_SHIM + """
        hungerReset();
        const events = hungerStep(0);
        console.log(JSON.stringify({
          events,
          isHungry: hungerBuf[%d],
          remaining: hungerBuf[%d],
          duration: hungerBuf[%d]
        }));
        """ % (
            CARE_SLOT_IS_HUNGRY,
            CARE_SLOT_HUNGER_REMAINING_MS,
            CARE_SLOT_HUNGER_DURATION_MS,
        )
        payload = run_node(script)
        assert_mask(self, payload["events"], 0, "reset step events")
        self.assertEqual(payload["isHungry"], 0.0)
        self.assertEqual(payload["duration"], DEFAULT_HUNGER_DURATION_MS)
        self.assertEqual(payload["remaining"], DEFAULT_HUNGER_DURATION_MS)

    def test_hunger_started_event_at_threshold(self):
        script = WASM_SHIM + """
        hungerReset();
        // Advance to just below the threshold, then cross it.
        hungerAdvance(%d - 1);
        const before = hungerStep(0);
        const beforeHungry = hungerBuf[%d];
        const cross = hungerStep(1);
        const afterHungry = hungerBuf[%d];
        console.log(JSON.stringify({
          before, beforeHungry, cross, afterHungry
        }));
        """ % (
            int(DEFAULT_HUNGER_DURATION_MS),
            CARE_SLOT_IS_HUNGRY,
            CARE_SLOT_IS_HUNGRY,
        )
        payload = run_node(script)
        assert_mask(self, payload["before"], 0, "below-threshold events")
        self.assertEqual(payload["beforeHungry"], 0.0)
        assert_mask(self, payload["cross"], CARE_EVENT_HUNGER_STARTED, "hunger-started events")
        self.assertEqual(payload["afterHungry"], 1.0)

    def test_feed_rejected_when_not_hungry(self):
        script = WASM_SHIM + """
        hungerReset();
        hungerBuf[%d] = %d;
        const events = hungerStep(0);
        console.log(JSON.stringify({ events }));
        """ % (CARE_SLOT_ACTION_FLAGS, CARE_CMD_FEED)
        payload = run_node(script)
        assert_mask(
            self,
            payload["events"],
            CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST,
            "feed-rejected events",
        )

    def test_feed_accepted_when_hungry(self):
        script = WASM_SHIM + """
        hungerReset();
        // Drive the dog hungry via the elapsed timer. The HUNGER_STARTED
        // event fires on the step that crosses the threshold, so capture the
        // events returned by hungerAdvance itself.
        const hungryEvents = hungerAdvance(%d);
        const wasHungry = hungerBuf[%d];
        hungerBuf[%d] = %d;
        const events = hungerStep(0);
        console.log(JSON.stringify({
          hungryEvents, wasHungry, events,
          isHungry: hungerBuf[%d],
          lastFed: hungerBuf[%d],
          remaining: hungerBuf[%d]
        }));
        """ % (
            int(DEFAULT_HUNGER_DURATION_MS),
            CARE_SLOT_IS_HUNGRY,
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_FEED,
            CARE_SLOT_IS_HUNGRY,
            CARE_SLOT_HUNGER_LAST_FED_MS,
            CARE_SLOT_HUNGER_REMAINING_MS,
        )
        payload = run_node(script)
        assert_mask(self, payload["hungryEvents"], CARE_EVENT_HUNGER_STARTED, "hunger-started events")
        self.assertEqual(payload["wasHungry"], 1.0)
        assert_mask(
            self,
            payload["events"],
            CARE_EVENT_FEED_ACCEPTED
            | CARE_EVENT_HUNGER_RESOLVED
            | CARE_EVENT_UI_FLASH
            | CARE_EVENT_TOAST,
            "feed-accepted events",
        )
        self.assertEqual(payload["isHungry"], 0.0)
        self.assertEqual(payload["remaining"], DEFAULT_HUNGER_DURATION_MS)
        self.assertEqual(payload["lastFed"], DEFAULT_HUNGER_DURATION_MS)

    def test_event_bitmask_slot_mirrors_return(self):
        script = WASM_SHIM + """
        hungerReset();
        hungerBuf[%d] = %d;
        const events = hungerStep(0);
        const slot = hungerBuf[%d] >>> 0;
        console.log(JSON.stringify({ events, slot }));
        """ % (CARE_SLOT_ACTION_FLAGS, CARE_CMD_FEED, CARE_SLOT_EVENT_BITMASK)
        payload = run_node(script)
        self.assertEqual(
            payload["slot"],
            payload["events"],
            "CARE_SLOT_EVENT_BITMASK (%s) must mirror the returned mask (%s)"
            % ("0x%08x" % payload["slot"], "0x%08x" % payload["events"]),
        )


if __name__ == "__main__":
    unittest.main()


