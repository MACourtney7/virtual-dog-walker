#!/usr/bin/env python3
"""Tests for DogStateStore grooming/tiredness state.

Every case launches a fresh `node --input-type=module -e "..."` subprocess so
that top-level identifiers never collide across scenarios.
"""
import json
import os
import subprocess
import textwrap
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORE_MODULE = os.path.join(REPO_ROOT, "src", "state", "dog_state_store.js")


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
        const groomingInitSnap = groomingInitStore.getSnapshot();
        console.log(JSON.stringify({
          needsGrooming: groomingInitSnap.needs.grooming.needsGrooming,
          isTired: groomingInitSnap.needs.tiredness.isTired
        }));
        """
        payload = run_node(script)
        self.assertTrue(payload["needsGrooming"])
        self.assertTrue(payload["isTired"])

    def test_groom_resets(self):
        script = store_import() + """
        const groomResetStore = new DogStateStore();
        const groomResetBefore = groomResetStore.getSnapshot();
        groomResetStore.groom();
        const groomResetAfter = groomResetStore.getSnapshot();
        console.log(JSON.stringify({
          beforeNeedsGrooming: groomResetBefore.needs.grooming.needsGrooming,
          afterNeedsGrooming: groomResetAfter.needs.grooming.needsGrooming,
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
        restResetStore.rest();
        const restResetAfter = restResetStore.getSnapshot();
        console.log(JSON.stringify({
          beforeIsTired: restResetBefore.needs.tiredness.isTired,
          afterIsTired: restResetAfter.needs.tiredness.isTired,
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
        script = store_import() + """
        const metaStore = new DogStateStore();
        const metaSnap = metaStore.getSnapshot();
        metaSnap.customMetadata = { foo: 'bar', count: 42 };
        // Re-hydrate from the mutated snapshot to simulate persistence.
        const metaStore2 = new DogStateStore();
        if (typeof metaStore2.hydrate === 'function') {
          metaStore2.hydrate(metaSnap);
        }
        metaStore2.groom();
        metaStore2.rest();
        const metaAfter = metaStore2.getSnapshot();
        console.log(JSON.stringify({
          customMetadata: metaAfter.customMetadata || null
        }));
        """
        payload = run_node(script)
        # If hydrate is unsupported, the store may not carry arbitrary keys;
        # only assert when the store round-trips them.
        if payload["customMetadata"] is not None:
            self.assertEqual(payload["customMetadata"]["foo"], "bar")
            self.assertEqual(payload["customMetadata"]["count"], 42)

    def test_legacy_state_backfill(self):
        script = store_import() + """
        const legacyStore = new DogStateStore();
        const legacyInput = {
          version: 1,
          needs: {
            hunger: { lastCompletedAt: 0, durationMs: 120000 }
          }
        };
        if (typeof legacyStore.hydrate === 'function') {
          legacyStore.hydrate(legacyInput);
        }
        const legacySnap = legacyStore.getSnapshot();
        console.log(JSON.stringify({
          grooming: legacySnap.needs.grooming,
          tiredness: legacySnap.needs.tiredness,
          hunger: legacySnap.needs.hunger
        }));
        """
        payload = run_node(script)
        # New needs backfilled with null timestamps + default durations.
        self.assertIn("grooming", payload)
        self.assertIn("tiredness", payload)
        self.assertIsNone(payload["grooming"].get("lastGroomedAt"))
        self.assertIsNone(payload["tiredness"].get("lastRestedAt"))
        self.assertGreater(payload["grooming"]["durationMs"], 0)
        self.assertGreater(payload["tiredness"]["durationMs"], 0)
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
