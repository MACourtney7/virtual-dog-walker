import json
import os
import shutil
import subprocess
import unittest


HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, ".."))
MODULE_PATH = os.path.join(PROJECT_ROOT, "src", "state", "dog_state_store.js")


def run_node(script):
    """Run a Node.js script that imports the DogStateStore module and prints JSON."""
    node = shutil.which("node")
    if not node:
        raise unittest.SkipTest("node executable not found on PATH")

    module_url = "file://" + MODULE_PATH.replace(os.sep, "/")
    full_script = (
        "import { DogStateStore, createInitialDogState, "
        "DOG_STATE_STORAGE_KEY, DEFAULT_HUNGER_DURATION_MS, "
        "DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS } from %s;\n" % json.dumps(module_url)
    ) + script

    result = subprocess.run(
        [node, "--input-type=module", "-e", full_script],
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
    )
    if result.returncode != 0:
        raise AssertionError(
            "node script failed (exit %s)\nSTDOUT:\n%s\nSTDERR:\n%s"
            % (result.returncode, result.stdout, result.stderr)
        )
    out = result.stdout.strip()
    return json.loads(out) if out else None


class TestDogStateStore(unittest.TestCase):
    def test_module_exists(self):
        self.assertTrue(os.path.exists(MODULE_PATH), "dog_state_store.js missing")

    def test_constants(self):
        data = run_node(
            "console.log(JSON.stringify({"
            " key: DOG_STATE_STORAGE_KEY,"
            " dur: DEFAULT_HUNGER_DURATION_MS,"
            " anim: DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS"
            "}));"
        )
        self.assertEqual(data["key"], "virtual_dog_walker.dog_state.v1")
        self.assertEqual(data["dur"], 120000)
        self.assertEqual(data["anim"], 5000)

    def test_initial_state_shape(self):
        data = run_node(
            "const s = createInitialDogState(1000, 5000);"
            "console.log(JSON.stringify(s));"
        )
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["needs"]["hunger"]["lastFedAt"], 1000)
        self.assertEqual(data["needs"]["hunger"]["durationMs"], 5000)

    def test_not_hungry_at_119999ms(self):
        data = run_node(
            "const store = new DogStateStore({ storage: null, now: () => 0 });"
            "store.feed(0);"
            "const h = store.getHunger(119999);"
            "console.log(JSON.stringify(h));"
        )
        self.assertFalse(data["isHungry"])
        self.assertEqual(data["remainingMs"], 1)
        self.assertEqual(data["elapsedMs"], 119999)

    def test_hungry_at_120000ms(self):
        data = run_node(
            "const store = new DogStateStore({ storage: null, now: () => 0 });"
            "store.feed(0);"
            "const h = store.getHunger(120000);"
            "console.log(JSON.stringify(h));"
        )
        self.assertTrue(data["isHungry"])
        self.assertEqual(data["remainingMs"], 0)

    def test_feed_resets_and_persists(self):
        data = run_node(
            "const mem = {};"
            "const storage = {"
            "  getItem: (k) => (k in mem ? mem[k] : null),"
            "  setItem: (k, v) => { mem[k] = String(v); }"
            "};"
            "const s1 = new DogStateStore({ storage, now: () => 0 });"
            "s1.feed(0);"
            "const before = s1.getHunger(200000);"
            "s1.feed(200000);"
            "const after = s1.getHunger(200000);"
            "const s2 = new DogStateStore({ storage, now: () => 200000 });"
            "const reloaded = s2.getHunger(200000);"
            "console.log(JSON.stringify({ before, after, reloaded }));"
        )
        self.assertTrue(data["before"]["isHungry"])
        self.assertFalse(data["after"]["isHungry"])
        self.assertEqual(data["after"]["lastFedAt"], 200000)
        self.assertFalse(data["reloaded"]["isHungry"])
        self.assertEqual(data["reloaded"]["lastFedAt"], 200000)

    def test_corrupt_json_resets_cleanly(self):
        data = run_node(
            "const mem = { 'virtual_dog_walker.dog_state.v1': '{not valid json' };"
            "const storage = {"
            "  getItem: (k) => (k in mem ? mem[k] : null),"
            "  setItem: (k, v) => { mem[k] = String(v); }"
            "};"
            "const store = new DogStateStore({ storage, now: () => 42 });"
            "const snap = store.getSnapshot(42);"
            "console.log(JSON.stringify({ snap, persisted: mem['virtual_dog_walker.dog_state.v1'] }));"
        )
        self.assertEqual(data["snap"]["version"], 1)
        self.assertEqual(data["snap"]["needs"]["hunger"]["lastFedAt"], 42)
        self.assertFalse(data["snap"]["needs"]["hunger"]["isHungry"])
        # Persisted value should now be valid JSON.
        parsed = json.loads(data["persisted"])
        self.assertEqual(parsed["version"], 1)

    def test_invalid_shape_resets_cleanly(self):
        data = run_node(
            "const mem = { 'virtual_dog_walker.dog_state.v1': JSON.stringify({ version: 2 }) };"
            "const storage = {"
            "  getItem: (k) => (k in mem ? mem[k] : null),"
            "  setItem: (k, v) => { mem[k] = String(v); }"
            "};"
            "const store = new DogStateStore({ storage, now: () => 7 });"
            "console.log(JSON.stringify(store.getSnapshot(7)));"
        )
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["needs"]["hunger"]["lastFedAt"], 7)

    def test_storage_errors_do_not_crash(self):
        data = run_node(
            "const storage = {"
            "  getItem: () => { throw new Error('boom-get'); },"
            "  setItem: () => { throw new Error('boom-set'); }"
            "};"
            "const store = new DogStateStore({ storage, now: () => 0 });"
            "const snap = store.feed(0);"
            "const h = store.getHunger(0);"
            "console.log(JSON.stringify({ snap, h }));"
        )
        self.assertEqual(data["snap"]["version"], 1)
        self.assertFalse(data["h"]["isHungry"])

    def test_subscribe_and_unsubscribe(self):
        data = run_node(
            "const store = new DogStateStore({ storage: null, now: () => 0 });"
            "const events = [];"
            "const unsub = store.subscribe((snap) => events.push(snap.needs.hunger.lastFedAt));"
            "store.feed(100);"
            "store.reset(200);"
            "unsub();"
            "store.feed(300);"
            "console.log(JSON.stringify({ events }));"
        )
        self.assertEqual(data["events"], [100, 200])


if __name__ == "__main__":
    unittest.main()
