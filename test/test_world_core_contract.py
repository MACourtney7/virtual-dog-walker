#!/usr/bin/env python3
"""Contract test entry point for the Rust world core ABI.

Runs the Rust contract tests in ``crates/dog_walker_core`` from the repo root
and fails loudly (non-zero exit + diagnostics) if they fail.

Usage (from the ``virtual_dog_walker`` repo root)::

    python3 test/test_world_core_contract.py

This script requires no generated Wasm bindings and is safe to run repeatedly.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

# The repo root is the parent of this script's ``test`` directory.
REPO_ROOT = Path(__file__).resolve().parent.parent

MANIFEST_PATH = "crates/dog_walker_core/Cargo.toml"
TEST_FILTER = "world_core_contract"
TIMEOUT_SECONDS = 120

# Matches cargo's summary line, e.g. "test result: ok. 3 passed; 0 failed; ...".
TEST_RESULT_RE = re.compile(r"test result:\s*ok\.\s*(\d+)\s*passed")


def main() -> int:
    """Run the Rust contract tests and return a process exit code."""
    cmd = [
        "cargo",
        "test",
        "--manifest-path",
        MANIFEST_PATH,
        TEST_FILTER,
        "--",
        "--nocapture",
    ]

    print(f"[world_core_contract] repo root: {REPO_ROOT}")
    print(f"[world_core_contract] running: {' '.join(cmd)}")

    try:
        result = subprocess.run(
            cmd,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        print(
            "[world_core_contract] ERROR: 'cargo' was not found on PATH. "
            "Install the Rust toolchain (https://rustup.rs) and retry.",
            file=sys.stderr,
        )
        return 127
    except subprocess.TimeoutExpired:
        print(
            f"[world_core_contract] FAILED: cargo timed out after "
            f"{TIMEOUT_SECONDS}s",
            file=sys.stderr,
        )
        return 124

    stdout = result.stdout or ""
    stderr = result.stderr or ""

    if stdout:
        print(stdout, end="")
    if stderr:
        print(stderr, end="", file=sys.stderr)

    # Normalize negative return codes (e.g. -9 for SIGKILL) to a positive value.
    return_code = result.returncode
    if return_code < 0:
        return_code = abs(return_code)

    if return_code != 0:
        print(
            f"[world_core_contract] FAILED: cargo exited with code {return_code}",
            file=sys.stderr,
        )
        return return_code or 1

    combined = stdout + "\n" + stderr
    total_passed = sum(int(m) for m in TEST_RESULT_RE.findall(combined))
    print(f"[world_core_contract] total_passed: {total_passed}")

    if total_passed < 1:
        print(
            "[world_core_contract] FAILED: no contract tests passed "
            f"(total_passed={total_passed}).",
            file=sys.stderr,
        )
        return 1

    print(
        f"[world_core_contract] OK: {total_passed} Rust contract test(s) passed."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
