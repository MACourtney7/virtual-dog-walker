"""Tests for leash length constraints and owner hold-up logic.

These tests exercise the JS module `src/world/leash.js` and the owner
integration in `src/entities/owner.js` via Node subprocesses.
"""
import json
import os
import shutil
import subprocess

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LEASH_MODULE = os.path.join(REPO_ROOT, "src", "world", "leash.js")
OWNER_MODULE = os.path.join(REPO_ROOT, "src", "entities", "owner.js")


def _node_available():
    return shutil.which("node") is not None


pytestmark = pytest.mark.skipif(
    not _node_available(), reason="node is required to run leash JS tests"
)


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


def test_max_leash_length_exported():
    script = f"""
    import {{ MAX_LEASH_LENGTH }} from {json.dumps(LEASH_MODULE)};
    console.log(JSON.stringify({{ value: MAX_LEASH_LENGTH }}));
    """
    out = _run_node(script)
    assert out["value"] == 3.0


def test_owner_clamped_to_leash_radius():
    script = f"""
    import {{ clampOwnerToLeash, MAX_LEASH_LENGTH }} from {json.dumps(LEASH_MODULE)};
    const dog = {{ x: 0, y: 0 }};
    const owner = {{ x: 10, y: 0 }};
    const clamped = clampOwnerToLeash(owner, dog, MAX_LEASH_LENGTH);
    const dist = Math.hypot(clamped.x - dog.x, clamped.y - dog.y);
    console.log(JSON.stringify({{ clamped, dist }}));
    """
    out = _run_node(script)
    assert abs(out["dist"] - 3.0) < 1e-9
    assert abs(out["clamped"]["x"] - 3.0) < 1e-9
    assert abs(out["clamped"]["y"]) < 1e-9


def test_owner_frozen_while_pooping_on_leash():
    script = f"""
    import {{ isOwnerFrozen }} from {json.dumps(LEASH_MODULE)};
    const dog = {{ isOnLeash: true, isPooping: true }};
    console.log(JSON.stringify({{ frozen: isOwnerFrozen(dog) }}));
    """
    out = _run_node(script)
    assert out["frozen"] is True


def test_owner_free_off_leash():
    script = f"""
    import {{ isOwnerFrozen, clampOwnerToLeash }} from {json.dumps(LEASH_MODULE)};
    const dog = {{ x: 0, y: 0, isOnLeash: false, isPooping: true }};
    const owner = {{ x: 100, y: 0 }};
    const clamped = clampOwnerToLeash(owner, dog, 3.0);
    console.log(JSON.stringify({{
      frozen: isOwnerFrozen(dog),
      unchanged: clamped === owner,
      x: clamped.x,
    }}));
    """
    out = _run_node(script)
    # Off-leash: not frozen, and clamp is a no-op when caller bypasses it.
    assert out["frozen"] is False
    assert out["unchanged"] is True
    assert out["x"] == 100


def test_force_stop_releases_after_poop():
    script = f"""
    import {{ isOwnerFrozen }} from {json.dumps(LEASH_MODULE)};
    const dog = {{ isOnLeash: true, isPooping: true }};
    const before = isOwnerFrozen(dog);
    dog.isPooping = false;
    const after = isOwnerFrozen(dog);
    console.log(JSON.stringify({{ before, after }}));
    """
    out = _run_node(script)
    assert out["before"] is True
    assert out["after"] is False


def test_slowed_dog_holds_owner_back():
    """A dog that has moved away drags the owner back within leash range."""
    script = f"""
    import {{ clampOwnerToLeash, MAX_LEASH_LENGTH }} from {json.dumps(LEASH_MODULE)};
    const dog = {{ x: 0, y: 0 }};
    const owner = {{ x: 0, y: 0 }};
    // Simulate the dog walking away while the owner stays put.
    dog.x = 5;
    dog.y = 0;
    const clamped = clampOwnerToLeash(owner, dog, MAX_LEASH_LENGTH);
    const dist = Math.hypot(clamped.x - dog.x, clamped.y - dog.y);
    console.log(JSON.stringify({{ clamped, dist }}));
    """
    out = _run_node(script)
    assert abs(out["dist"] - 3.0) < 1e-9
    # Owner is pulled toward the dog along the leash axis.
    assert abs(out["clamped"]["x"] - 2.0) < 1e-9
    assert abs(out["clamped"]["y"]) < 1e-9
