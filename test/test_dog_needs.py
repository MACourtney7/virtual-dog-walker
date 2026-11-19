"""Tests for dog need signals and need-based speed reduction.

These tests exercise the JS modules `src/entities/companion_dog.js` and
`src/state/dog_state_store.js` via Node, verifying that:

  * `getEffectiveSpeed()` returns the base speed when no needs are active.
  * Any single active need (hunger / grooming / tiredness) reduces speed by
    the flat `NEED_SPEED_MULTIPLIER` (0.4x).
  * Multiple simultaneous needs do NOT stack multiplicatively.
  * Speed is restored once needs clear.
  * The need getters are read-only (no setter / assignment is a no-op or throws).
"""

import json
import os
import shutil
import subprocess
import textwrap

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO_ROOT, "src")


def _node_available():
    return shutil.which("node") is not None


pytestmark = pytest.mark.skipif(
    not _node_available(), reason="node is required to run JS module tests"
)


def _run_node(script_body):
    """Run a Node ESM script that imports the project modules.

    The script is written to a temp file inside the repo so relative imports
    resolve correctly, then executed with `node`.
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

    tmp_path = os.path.join(REPO_ROOT, "_tmp_test_dog_needs.mjs")
    try:
        with open(tmp_path, "w", encoding="utf-8") as fh:
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


def test_effective_speed_default_is_base():
    out = _run_node(
        """
        const dog = new CompanionDog(0, 0, null);
        dog.speed = 200;
        results.base = dog.speed;
        results.effective = dog.getEffectiveSpeed();
        results.multiplier = NEED_SPEED_MULTIPLIER;
        """
    )
    assert out["base"] == 200
    assert out["effective"] == 200
    assert out["multiplier"] == 0.4


def test_speed_reduced_when_hungry():
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
    assert out["isHungry"] is True
    assert out["base"] == 200
    assert abs(out["effective"] - 200 * 0.4) < 1e-9


def test_speed_reduced_when_needs_grooming():
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
    assert out["needsGrooming"] is True
    assert out["base"] == 200
    assert abs(out["effective"] - 200 * 0.4) < 1e-9


def test_speed_reduced_when_tired():
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
    assert out["isTired"] is True
    assert out["base"] == 200
    assert abs(out["effective"] - 200 * 0.4) < 1e-9


def test_speed_not_multiplicative_for_multiple_needs():
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
    assert out["base"] == 200
    # Single flat multiplier, NOT 0.4^3.
    assert abs(out["effective"] - 200 * 0.4) < 1e-9
    assert abs(out["effective"] - 200 * (0.4 ** 3)) > 1e-6


def test_speed_restored_when_needs_clear():
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
    assert abs(out["reduced"] - 200 * 0.4) < 1e-9
    assert out["restored"] == 200
    assert out["base"] == 200


def test_need_getters_are_read_only():
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
    assert out["isHungryAfterAssign"] is False
    assert out["needsGroomingAfterAssign"] is False
    assert out["isTiredAfterAssign"] is False
    # Setter still works.
    assert out["isHungryAfterSetter"] is True
