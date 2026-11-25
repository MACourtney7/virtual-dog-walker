#!/usr/bin/env python3
"""Tests for DogStateStore grooming/tiredness state.

Every case launches a fresh `node --input-type=module -e "..."` subprocess so
that top-level identifiers never collide across scenarios.
"""
import json
import os
import shutil
import subprocess
import textwrap
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORE_MODULE = os.path.join(REPO_ROOT, "src", "state", "dog_state_store.js")


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
    )
    if result.returncode != 0:
        raise AssertionError(
            "node script failed:\nSTDOUT:\n%s\nSTDERR:\n%s"
            % (result.stdout, result.stderr)
        )
    out = result.stdout.strip()
    if not out:
        raise AssertionError("node script produced no output; stderr:\n%s" % result.stderr)
    # Use the last line so stray console output doesn't break parsing.
    last_line = out.splitlines()[-1]
    return json.loads(last_line)


def store_import() -> str:
    # Use a file:// URL so ESM import works regardless of cwd.
    return "import { DogStateStore, DOG_STATE_STORAGE_KEY } from %s;" % json.dumps(
        "file://" + STORE_MODULE
    )


def memory_storage_import() -> str:
    """Return a JS snippet defining an in-memory storage shim.

    The shim exposes the subset of the Web Storage API that DogStateStore
    relies on (getItem/setItem/removeItem) so tests can persist state across
    fresh store instances without touching the real localStorage.
    """
    return textwrap.dedent(
        """
        function makeMemoryStorage() {
          const backing = new Map();
          return {
            getItem(key) { return backing.has(key) ? backing.get(key) : null; },
            setItem(key, value) { backing.set(key, String(value)); },
            removeItem(key) { backing.delete(key); },
            clear() { backing.clear(); }
          };
        }
        """
    )


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestGroomingTirednessState(unittest.TestCase):
    def test_initial_durations(self):
        script = store_import() + """
        const groomingTestStore = new DogStateStore();
        const groomingTestSnap = groomingTestStore.getSnapshot();
        console.log(JSON.stringify({
          groomingDuration: groomingTestSnap.needs.grooming.durationMs,
          tirednessDuration: groomingTestSnap.needs.tiredness.durationMs
        }));
        """
        payload = run_node(script)
        self.assertIsInstance(payload["groomingDuration"], (int, float))
        self.assertGreater(payload["groomingDuration"], 0)
        self.assertIsInstance(payload["tirednessDuration"], (int, float))
        self.assertGreater(payload["tirednessDuration"], 0)

    def test_needs_grooming_true_initially(self):
        script = store_import() + """
        const groomingInitStore = new DogStateStore();
        const groomingInitGrooming = groomingInitStore.getGrooming();
        const groomingInitTiredness = groomingInitStore.getTiredness();
        console.log(JSON.stringify({
          needsGrooming: groomingInitGrooming.needsGrooming,
          isTired: groomingInitTiredness.isTired
        }));
        """
        payload = run_node(script)
        self.assertTrue(payload["needsGrooming"])
        self.assertTrue(payload["isTired"])

    def test_groom_resets(self):
        script = store_import() + """
        const groomResetStore = new DogStateStore();
        const groomResetBefore = groomResetStore.getSnapshot();
        const groomResetBeforeGrooming = groomResetStore.getGrooming();
        groomResetStore.groom();
        const groomResetAfter = groomResetStore.getSnapshot();
        const groomResetAfterGrooming = groomResetStore.getGrooming();
        console.log(JSON.stringify({
          beforeNeedsGrooming: groomResetBeforeGrooming.needsGrooming,
          afterNeedsGrooming: groomResetAfterGrooming.needsGrooming,
          hungerBefore: groomResetBefore.needs.hunger,
          hungerAfter: groomResetAfter.needs.hunger
        }));
        """
        payload = run_node(script)
        self.assertTrue(payload["beforeNeedsGrooming"])
        self.assertFalse(payload["afterNeedsGrooming"])
        # Hunger must be untouched by grooming.
        self.assertEqual(
            payload["hungerBefore"]["lastFedAt"],
            payload["hungerAfter"]["lastFedAt"],
        )
        self.assertEqual(
            payload["hungerBefore"]["durationMs"],
            payload["hungerAfter"]["durationMs"],
        )

    def test_rest_resets(self):
        script = store_import() + """
        const restResetStore = new DogStateStore();
        const restResetBefore = restResetStore.getSnapshot();
        const restResetBeforeTiredness = restResetStore.getTiredness();
        restResetStore.rest();
        const restResetAfter = restResetStore.getSnapshot();
        const restResetAfterTiredness = restResetStore.getTiredness();
        console.log(JSON.stringify({
          beforeIsTired: restResetBeforeTiredness.isTired,
          afterIsTired: restResetAfterTiredness.isTired,
          groomingBefore: restResetBefore.needs.grooming,
          groomingAfter: restResetAfter.needs.grooming
        }));
        """
        payload = run_node(script)
        self.assertTrue(payload["beforeIsTired"])
        self.assertFalse(payload["afterIsTired"])
        # Sibling grooming state must be untouched by rest.
        self.assertEqual(
            payload["groomingBefore"]["lastGroomedAt"],
            payload["groomingAfter"]["lastGroomedAt"],
        )
        self.assertEqual(
            payload["groomingBefore"]["durationMs"],
            payload["groomingAfter"]["durationMs"],
        )

    def test_custom_metadata_preserved(self):
        script = (
            store_import()
            + memory_storage_import()
            + """
        const metaStorage = makeMemoryStorage();
        const metaStore = new DogStateStore({ storage: metaStorage });
        const metaSnap = metaStore.getSnapshot();
        // Custom metadata is preserved on individual needs entries, not at
        // the top level of the snapshot.
        metaSnap.needs.hunger.customFlag = 'keep-me';
        metaStorage.setItem(DOG_STATE_STORAGE_KEY, JSON.stringify(metaSnap));

        // Fresh store loads persisted state, mutates needs, then persists again.
        const metaStore2 = new DogStateStore({ storage: metaStorage });
        metaStore2.groom();
        metaStore2.rest();

        // Fresh reload must still carry the custom metadata on needs.hunger.
        const metaStore3 = new DogStateStore({ storage: metaStorage });
        const metaAfter = metaStore3.getSnapshot();
        console.log(JSON.stringify({
          customFlag: metaAfter.needs.hunger.customFlag || null
        }));
        """
        )
        payload = run_node(script)
        self.assertEqual(payload["customFlag"], "keep-me")

    def test_legacy_state_backfill(self):
        script = (
            store_import()
            + memory_storage_import()
            + """
        const legacyStorage = makeMemoryStorage();
        const legacyInput = {
          version: 1,
          needs: {
            hunger: { lastCompletedAt: 0, durationMs: 120000 }
          }
        };
        legacyStorage.setItem(DOG_STATE_STORAGE_KEY, JSON.stringify(legacyInput));

        const legacyStore = new DogStateStore({ storage: legacyStorage });
        const legacySnap = legacyStore.getSnapshot();
        const legacyGrooming = legacyStore.getGrooming();
        const legacyTiredness = legacyStore.getTiredness();
        const legacyHunger = legacyStore.getHunger();
        console.log(JSON.stringify({
          grooming: legacySnap.needs.grooming,
          tiredness: legacySnap.needs.tiredness,
          hunger: legacySnap.needs.hunger,
          needsGrooming: legacyGrooming.needsGrooming,
          isTired: legacyTiredness.isTired,
          hungerLastFedAt: legacyHunger.lastFedAt
        }));
        """
        )
        payload = run_node(script)
        # New needs backfilled with null timestamps + default durations.
        self.assertIn("grooming", payload)
        self.assertIn("tiredness", payload)
        self.assertIsNone(payload["grooming"].get("lastGroomedAt"))
        self.assertIsNone(payload["tiredness"].get("lastRestedAt"))
        self.assertGreater(payload["grooming"]["durationMs"], 0)
        self.assertGreater(payload["tiredness"]["durationMs"], 0)
        # Derived booleans are backfilled cleanly (never-groomed/rested => due).
        self.assertTrue(payload["needsGrooming"])
        self.assertTrue(payload["isTired"])
        # Hunger preserved verbatim.
        self.assertEqual(payload["hunger"]["durationMs"], 120000)
        # Legacy hydration actually loaded the supplied lastFedAt.
        self.assertEqual(payload["hungerLastFedAt"], 0)

    def test_no_persisted_booleans(self):
        script = (
            store_import()
            + memory_storage_import()
            + """
        const boolStorage = makeMemoryStorage();
        const boolStore = new DogStateStore({ storage: boolStorage });
        boolStore.feed();
        boolStore.groom();
        boolStore.rest();
        const persisted = boolStorage.getItem(DOG_STATE_STORAGE_KEY);
        console.log(JSON.stringify({ persisted }));
        """
        )
        payload = run_node(script)
        persisted = payload["persisted"]
        self.assertIsNotNone(persisted)
        for forbidden in ("isHungry", "needsGrooming", "isTired", "isDue"):
            self.assertNotIn(
                '"%s"' % forbidden,
                persisted,
                "Persisted storage must not contain derived boolean %r" % forbidden,
            )


#!/usr/bin/env python3
"""Tests for the Wasm care buffer grooming/tiredness state.

Every scenario launches a fresh `node --input-type=module -e "..."` subprocess,
calls `initWasmSimSync()` synchronously, and drives the Rust-owned care buffer
via `step_care_buffer(dt_ms)`. Assertions use exact Wasm event bitmasks
(see crates/dog_walker_core/src/care_sim.rs).
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
CARE_SLOT_GROOMING_ELAPSED_MS = 4
CARE_SLOT_GROOMING_REMAINING_MS = 5
CARE_SLOT_TIREDNESS_ELAPSED_MS = 6
CARE_SLOT_TIREDNESS_REMAINING_MS = 7
CARE_SLOT_NEEDS_GROOMING = 9
CARE_SLOT_IS_TIRED = 10
CARE_SLOT_ACTION_FLAGS = 11
CARE_SLOT_EVENT_BITMASK = 12
CARE_SLOT_GROOMING_LAST_GROOMED_MS = 18
CARE_SLOT_TIREDNESS_LAST_RESTED_MS = 19
CARE_SLOT_GROOMING_DURATION_MS = 28
CARE_SLOT_TIREDNESS_DURATION_MS = 29

# Care command bits.
CARE_CMD_GROOM = 1 << 1
CARE_CMD_REST = 1 << 2
CARE_CMD_RESET = 1 << 3

# Care event bits.
CARE_EVENT_GROOMING_NEEDED = 1 << 1
CARE_EVENT_TIREDNESS_STARTED = 1 << 2
CARE_EVENT_GROOM_ACCEPTED = 1 << 5
CARE_EVENT_REST_ACCEPTED = 1 << 6
CARE_EVENT_GROOMING_RESOLVED = 1 << 8
CARE_EVENT_TIREDNESS_RESOLVED = 1 << 9
CARE_EVENT_ACTION_REJECTED = 1 << 10
CARE_EVENT_UI_FLASH = 1 << 11
CARE_EVENT_TOAST = 1 << 12

DEFAULT_GROOMING_DURATION_MS = 180000.0
DEFAULT_TIREDNESS_DURATION_MS = 180000.0


def node_available():
    return shutil.which("node") is not None


def run_node(script_body: str) -> dict:
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


WASM_SHIM = """
const groomBridge = await import(%s);
groomBridge.initWasmSimSync();
const groomSim = groomBridge.getWasmSim();
const groomBuf = groomBridge.getBufferView(groomSim.care_buffer_ptr(), groomSim.care_buffer_len());

function groomStep(dtMs) {
  return groomSim.step_care_buffer(dtMs) >>> 0;
}
// step_care_buffer clamps dt_ms to [0, 1000], so advance in <=1000ms chunks.
function groomAdvance(totalMs) {
  let rem = totalMs;
  let events = 0;
  while (rem > 0) {
    const chunk = Math.min(1000, rem);
    events = (events | groomStep(chunk)) >>> 0;
    rem -= chunk;
  }
  return events >>> 0;
}
function groomReset() {
  groomBuf[%d] = %d;
  groomStep(0);
}
""" % (
    file_url("src/engine/wasm_sim_bridge.js"),
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
class TestGroomingTirednessWasmState(unittest.TestCase):
    def test_initial_durations(self):
        # The core never writes the duration slots (28/29); it only reads them
        # and falls back to the locked defaults when they are 0. So the
        # observable "initial duration" is the remaining timer, which the core
        # computes from the default durations on the first clean step.
        script = WASM_SHIM + """
        groomReset();
        groomStep(0);
        console.log(JSON.stringify({
          groomingRemaining: groomBuf[%d],
          tirednessRemaining: groomBuf[%d]
        }));
        """ % (CARE_SLOT_GROOMING_REMAINING_MS, CARE_SLOT_TIREDNESS_REMAINING_MS)
        payload = run_node(script)
        self.assertEqual(payload["groomingRemaining"], DEFAULT_GROOMING_DURATION_MS)
        self.assertEqual(payload["tirednessRemaining"], DEFAULT_TIREDNESS_DURATION_MS)

    def test_needs_grooming_and_tired_true_initially(self):
        script = WASM_SHIM + """
        groomReset();
        const events = groomStep(0);
        console.log(JSON.stringify({
          events,
          needsGrooming: groomBuf[%d],
          isTired: groomBuf[%d]
        }));
        """ % (CARE_SLOT_NEEDS_GROOMING, CARE_SLOT_IS_TIRED)
        payload = run_node(script)
        assert_mask(self, payload["events"], 0, "reset step events")
        self.assertEqual(payload["needsGrooming"], 1.0)
        self.assertEqual(payload["isTired"], 1.0)

    def test_groom_resets(self):
        script = WASM_SHIM + """
        groomReset();
        groomBuf[%d] = %d;
        const events = groomStep(0);
        console.log(JSON.stringify({
          events,
          needsGrooming: groomBuf[%d],
          lastGroomed: groomBuf[%d],
          remaining: groomBuf[%d]
        }));
        """ % (
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_GROOM,
            CARE_SLOT_NEEDS_GROOMING,
            CARE_SLOT_GROOMING_LAST_GROOMED_MS,
            CARE_SLOT_GROOMING_REMAINING_MS,
        )
        payload = run_node(script)
        assert_mask(
            self,
            payload["events"],
            CARE_EVENT_GROOM_ACCEPTED
            | CARE_EVENT_GROOMING_RESOLVED
            | CARE_EVENT_UI_FLASH
            | CARE_EVENT_TOAST,
            "groom-accepted events",
        )
        self.assertEqual(payload["needsGrooming"], 0.0)
        self.assertEqual(payload["remaining"], DEFAULT_GROOMING_DURATION_MS)

    def test_rest_resets(self):
        script = WASM_SHIM + """
        groomReset();
        groomBuf[%d] = %d;
        const events = groomStep(0);
        console.log(JSON.stringify({
          events,
          isTired: groomBuf[%d],
          lastRested: groomBuf[%d],
          remaining: groomBuf[%d]
        }));
        """ % (
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_REST,
            CARE_SLOT_IS_TIRED,
            CARE_SLOT_TIREDNESS_LAST_RESTED_MS,
            CARE_SLOT_TIREDNESS_REMAINING_MS,
        )
        payload = run_node(script)
        assert_mask(
            self,
            payload["events"],
            CARE_EVENT_REST_ACCEPTED
            | CARE_EVENT_TIREDNESS_RESOLVED
            | CARE_EVENT_UI_FLASH
            | CARE_EVENT_TOAST,
            "rest-accepted events",
        )
        self.assertEqual(payload["isTired"], 0.0)
        self.assertEqual(payload["remaining"], DEFAULT_TIREDNESS_DURATION_MS)

    def test_groom_second_rejects_not_dirty(self):
        script = WASM_SHIM + """
        groomReset();
        groomBuf[%d] = %d;
        const first = groomStep(0);
        groomBuf[%d] = %d;
        const second = groomStep(0);
        console.log(JSON.stringify({ first, second }));
        """ % (
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_GROOM,
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_GROOM,
        )
        payload = run_node(script)
        assert_mask(
            self,
            payload["first"],
            CARE_EVENT_GROOM_ACCEPTED
            | CARE_EVENT_GROOMING_RESOLVED
            | CARE_EVENT_UI_FLASH
            | CARE_EVENT_TOAST,
            "first groom events",
        )
        assert_mask(
            self,
            payload["second"],
            CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST,
            "second groom events",
        )

    def test_rest_second_rejects_not_tired(self):
        script = WASM_SHIM + """
        groomReset();
        groomBuf[%d] = %d;
        const first = groomStep(0);
        groomBuf[%d] = %d;
        const second = groomStep(0);
        console.log(JSON.stringify({ first, second }));
        """ % (
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_REST,
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_REST,
        )
        payload = run_node(script)
        assert_mask(
            self,
            payload["first"],
            CARE_EVENT_REST_ACCEPTED
            | CARE_EVENT_TIREDNESS_RESOLVED
            | CARE_EVENT_UI_FLASH
            | CARE_EVENT_TOAST,
            "first rest events",
        )
        assert_mask(
            self,
            payload["second"],
            CARE_EVENT_ACTION_REJECTED | CARE_EVENT_TOAST,
            "second rest events",
        )

    def test_grooming_need_cycles_after_groom(self):
        script = WASM_SHIM + """
        groomReset();
        groomBuf[%d] = %d;
        groomStep(0);
        // Just before the threshold: still clean.
        groomAdvance(%d - 1);
        const before = groomStep(0);
        const beforeNeeds = groomBuf[%d];
        // Cross the threshold.
        const cross = groomStep(1);
        const afterNeeds = groomBuf[%d];
        console.log(JSON.stringify({ before, beforeNeeds, cross, afterNeeds }));
        """ % (
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_GROOM,
            int(DEFAULT_GROOMING_DURATION_MS),
            CARE_SLOT_NEEDS_GROOMING,
            CARE_SLOT_NEEDS_GROOMING,
        )
        payload = run_node(script)
        assert_mask(self, payload["before"], 0, "below-threshold events")
        self.assertEqual(payload["beforeNeeds"], 0.0)
        assert_mask(self, payload["cross"], CARE_EVENT_GROOMING_NEEDED, "grooming-needed events")
        self.assertEqual(payload["afterNeeds"], 1.0)

    def test_tiredness_need_cycles_after_rest(self):
        script = WASM_SHIM + """
        groomReset();
        groomBuf[%d] = %d;
        groomStep(0);
        groomAdvance(%d - 1);
        const before = groomStep(0);
        const beforeTired = groomBuf[%d];
        const cross = groomStep(1);
        const afterTired = groomBuf[%d];
        console.log(JSON.stringify({ before, beforeTired, cross, afterTired }));
        """ % (
            CARE_SLOT_ACTION_FLAGS,
            CARE_CMD_REST,
            int(DEFAULT_TIREDNESS_DURATION_MS),
            CARE_SLOT_IS_TIRED,
            CARE_SLOT_IS_TIRED,
        )
        payload = run_node(script)
        assert_mask(self, payload["before"], 0, "below-threshold events")
        self.assertEqual(payload["beforeTired"], 0.0)
        assert_mask(self, payload["cross"], CARE_EVENT_TIREDNESS_STARTED, "tiredness-started events")
        self.assertEqual(payload["afterTired"], 1.0)

    def test_event_bitmask_slot_mirrors_return(self):
        script = WASM_SHIM + """
        groomReset();
        groomBuf[%d] = %d;
        const events = groomStep(0);
        const slot = groomBuf[%d] >>> 0;
        console.log(JSON.stringify({ events, slot }));
        """ % (CARE_SLOT_ACTION_FLAGS, CARE_CMD_GROOM, CARE_SLOT_EVENT_BITMASK)
        payload = run_node(script)
        self.assertEqual(
            payload["slot"],
            payload["events"],
            "CARE_SLOT_EVENT_BITMASK (%s) must mirror the returned mask (%s)"
            % ("0x%08x" % payload["slot"], "0x%08x" % payload["events"]),
        )


if __name__ == "__main__":
    unittest.main()
