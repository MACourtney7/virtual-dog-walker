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
    return "import { DogStateStore } from %s;" % json.dumps("file://" + STORE_MODULE)


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
        metaSnap.customMetadata = { foo: 'bar', count: 42 };
        metaStorage.setItem('dog_state', JSON.stringify(metaSnap));

        // Fresh store loads persisted state, mutates needs, then persists again.
        const metaStore2 = new DogStateStore({ storage: metaStorage });
        metaStore2.groom();
        metaStore2.rest();

        // Fresh reload must still carry the custom metadata.
        const metaStore3 = new DogStateStore({ storage: metaStorage });
        const metaAfter = metaStore3.getSnapshot();
        console.log(JSON.stringify({
          customMetadata: metaAfter.customMetadata || null
        }));
        """
        )
        payload = run_node(script)
        self.assertIsNotNone(payload["customMetadata"])
        self.assertEqual(payload["customMetadata"]["foo"], "bar")
        self.assertEqual(payload["customMetadata"]["count"], 42)

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
        legacyStorage.setItem('dog_state', JSON.stringify(legacyInput));

        const legacyStore = new DogStateStore({ storage: legacyStorage });
        const legacySnap = legacyStore.getSnapshot();
        const legacyGrooming = legacyStore.getGrooming();
        const legacyTiredness = legacyStore.getTiredness();
        console.log(JSON.stringify({
          grooming: legacySnap.needs.grooming,
          tiredness: legacySnap.needs.tiredness,
          hunger: legacySnap.needs.hunger,
          needsGrooming: legacyGrooming.needsGrooming,
          isTired: legacyTiredness.isTired
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

    def test_no_persisted_booleans(self):
        script = store_import() + """
        const boolStore = new DogStateStore();
        boolStore.groom();
        boolStore.rest();
        const boolSnap = boolStore.getSnapshot();
        console.log(JSON.stringify({ snapshot: boolSnap }));
        """
        payload = run_node(script)
        serialized = json.dumps(payload["snapshot"])
        for forbidden in ("isHungry", "needsGrooming", "isTired", "isDue"):
            self.assertNotIn(
                '"%s"' % forbidden,
                serialized,
                "Serialized snapshot must not persist derived boolean %r" % forbidden,
            )


if __name__ == "__main__":
    unittest.main()
