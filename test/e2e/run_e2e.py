#!/usr/bin/env python3
"""CLI runner for the Virtual Dog Walker Playwright E2E suite.

Usage:
    python3 test/e2e/run_e2e.py [--serve-dir PATH] [-v]
    python3 test/e2e/run_e2e.py --compare BASELINE_DIR CANDIDATE_DIR
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import sys
import time
import unittest
from typing import Any, Dict, List, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(os.path.dirname(_HERE))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


def _run_suite(serve_dir: str, verbose: bool) -> int:
    os.environ["VDW_E2E_SERVE_DIR"] = serve_dir
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=_HERE, pattern="test_*.py", top_level_dir=_REPO_ROOT)
    runner = unittest.TextTestRunner(verbosity=2 if verbose else 1)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


# ---------------------------------------------------------------------------
# Parallel per-module runner
# ---------------------------------------------------------------------------


def _discover_modules() -> List[str]:
    """Return sorted test module filenames (e.g. ``test_foo.py``) in _HERE."""
    modules: List[str] = []
    for name in sorted(os.listdir(_HERE)):
        if name.startswith("test_") and name.endswith(".py"):
            modules.append(name)
    return modules


def _run_module(module_name: str, serve_dir: str) -> Tuple[str, int, int, List[str]]:
    """Run a single test module in an isolated process.

    Returns ``(module_name, tests_run, failures, error_lines)``.
    """
    os.environ["VDW_E2E_SERVE_DIR"] = serve_dir
    if _REPO_ROOT not in sys.path:
        sys.path.insert(0, _REPO_ROOT)

    module_path = os.path.join(_HERE, module_name)
    loader = unittest.TestLoader()
    try:
        suite = loader.discover(
            start_dir=_HERE,
            pattern=module_name,
            top_level_dir=_REPO_ROOT,
        )
    except Exception as exc:  # pragma: no cover - defensive
        return (module_name, 0, 1, [f"discovery error: {exc!r}"])

    runner = unittest.TextTestRunner(verbosity=0, stream=open(os.devnull, "w"))
    try:
        result = runner.run(suite)
    except Exception as exc:  # pragma: no cover - defensive
        return (module_name, 0, 1, [f"runner error: {exc!r}"])

    error_lines: List[str] = []
    for test, trace in result.failures:
        error_lines.append(f"FAIL: {test}")
        error_lines.append(trace)
    for test, trace in result.errors:
        error_lines.append(f"ERROR: {test}")
        error_lines.append(trace)

    failures = len(result.failures) + len(result.errors)
    return (module_name, result.testsRun, failures, error_lines)


def _run_parallel(serve_dir: str, workers: int) -> int:
    modules = _discover_modules()
    if not modules:
        print("No test modules discovered.")
        return 0

    print(f"Running {len(modules)} module(s) with {workers} worker(s)...")
    start = time.time()
    total_tests = 0
    total_failures = 0
    all_ok = True

    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_run_module, mod, serve_dir): mod for mod in modules
        }
        for future in concurrent.futures.as_completed(futures):
            mod = futures[future]
            try:
                name, tests_run, failures, error_lines = future.result()
            except Exception as exc:  # pragma: no cover - defensive
                print(f"[{mod}] worker crashed: {exc!r}")
                all_ok = False
                total_failures += 1
                continue

            total_tests += tests_run
            total_failures += failures
            status = "OK" if failures == 0 else "FAIL"
            print(f"[{name}] {tests_run} test(s), {failures} failure(s) - {status}")
            if failures:
                all_ok = False
                for line in error_lines:
                    print(line)

    elapsed = time.time() - start
    print()
    print(f"Total tests: {total_tests}")
    print(f"Total failures: {total_failures}")
    print(f"Elapsed: {elapsed:.2f}s")
    print("RESULT:", "PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1


# ---------------------------------------------------------------------------
# Deterministic comparison probe
# ---------------------------------------------------------------------------


def _probe(serve_dir: str) -> Dict[str, Any]:
    """Run a standardized deterministic probe against a serve directory."""
    from test.e2e.harness import GameSession

    metrics: Dict[str, Any] = {}
    with GameSession(serve_dir=serve_dir, unlock_home=True, pause_loop=True) as gs:
        # Spawn stability: initial snapshot.
        snap0 = gs.snapshot()
        metrics["spawn_owner_x"] = round(snap0["owner"]["x"], 2)
        metrics["spawn_owner_y"] = round(snap0["owner"]["y"], 2)
        metrics["spawn_dog_x"] = round(snap0["dog"]["x"], 2)
        metrics["spawn_dog_y"] = round(snap0["dog"]["y"], 2)

        # Owner walk + turn.
        gs.set_keys(up=True)
        gs.step_frames(30)
        walk_snap = gs.snapshot()
        metrics["walk_owner_speed"] = round(walk_snap["owner"]["speed"], 2)
        metrics["walk_owner_gait"] = walk_snap["owner"]["gait"]

        gs.set_keys(right=True)
        gs.step_frames(30)
        turn_snap = gs.snapshot()
        metrics["turn_owner_angle"] = round(turn_snap["owner"]["angle"], 3)

        # On-leash stop.
        gs.set_keys()
        gs.set_leash(True)
        gs.step_frames(30)
        leash_snap = gs.snapshot()
        metrics["leash_owner_speed"] = round(leash_snap["owner"]["speed"], 2)
        metrics["leash_is_leashed"] = leash_snap["owner"]["isLeashed"]

        # Off-leash roam.
        gs.set_leash(False)
        gs.set_keys(up=True)
        gs.step_frames(60)
        roam_snap = gs.snapshot()
        metrics["roam_dog_speed"] = round(roam_snap["dog"]["speed"], 2)
        metrics["roam_dog_state"] = roam_snap["dog"]["state"]

        # Zoomies.
        gs.set_keys()
        gs.trigger_zoomies()
        gs.step_frames(10)
        zoom_snap = gs.snapshot()
        metrics["zoomies_timer"] = round(zoom_snap["dog"]["zoomiesTimer"], 2)

        # NPCs.
        npc_snap = gs.snapshot()
        metrics["npc_count"] = len(npc_snap["npcs"])

        # Warp.
        gates = gs.get_warp_gates()
        metrics["warp_gate_count"] = len(gates)
        if gates:
            gate = gates[0]
            gs.warp_to(gate["targetZoneId"], gate["targetX"], gate["targetY"])
            gs.step_frames(5)
            warp_snap = gs.snapshot()
            metrics["warp_zone_id"] = warp_snap["zoneId"]
        else:
            metrics["warp_zone_id"] = None

        gs.assert_no_errors()

    return metrics


def _run_compare(baseline_dir: str, candidate_dir: str) -> int:
    print(f"Probing baseline: {baseline_dir}")
    baseline = _probe(baseline_dir)
    print(f"Probing candidate: {candidate_dir}")
    candidate = _probe(candidate_dir)

    keys: List[str] = sorted(set(baseline) | set(candidate))
    name_width = max(len(k) for k in keys) + 2
    col_width = 22

    header = f"{'metric'.ljust(name_width)}{'baseline'.ljust(col_width)}{'candidate'.ljust(col_width)}match"
    print()
    print(header)
    print("-" * len(header))
    all_match = True
    for key in keys:
        b = baseline.get(key)
        c = candidate.get(key)
        match = b == c
        if not match:
            all_match = False
        print(
            f"{key.ljust(name_width)}"
            f"{str(b).ljust(col_width)}"
            f"{str(c).ljust(col_width)}"
            f"{'OK' if match else 'DIFF'}"
        )
    print()
    print("RESULT:", "MATCH" if all_match else "MISMATCH")
    return 0 if all_match else 1


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Virtual Dog Walker E2E runner")
    parser.add_argument("--serve-dir", default=None, help="Directory to serve")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of parallel worker processes (1 = single-process)",
    )
    parser.add_argument(
        "--compare",
        nargs=2,
        metavar=("BASELINE_DIR", "CANDIDATE_DIR"),
        help="Compare deterministic probe metrics between two serve directories",
    )
    args = parser.parse_args(argv)

    if args.compare:
        return _run_compare(args.compare[0], args.compare[1])

    serve_dir = args.serve_dir or os.environ.get("VDW_E2E_SERVE_DIR")
    if not serve_dir:
        if os.path.isfile(os.path.join(_REPO_ROOT, "index.html")):
            serve_dir = _REPO_ROOT
        else:
            default = os.path.join(_REPO_ROOT, "virtual_dog_walker")
            serve_dir = default if os.path.isdir(default) else _REPO_ROOT

    if args.workers and args.workers > 1:
        return _run_parallel(serve_dir, args.workers)
    return _run_suite(serve_dir, args.verbose)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
