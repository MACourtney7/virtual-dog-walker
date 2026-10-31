#!/usr/bin/env python3
"""
Test Suite for Obstacle-Free NPC Path Library & Manifest (Ticket-025):
- AC-025.1: Path count >= 8, >= 3 usable by joggers and >= 5 by walkers,
            coverage across Ladies Mile, Sea Walls, Durdham Down, woodland, meadow.
- AC-025.2: Segments sampled at <= 8 px steps assert clearance from all trees,
            benches, and bins in field.js, strictly within world bounds.
- AC-025.3: Manifest lengths match computed polyline lengths within 1.0 px.
- AC-025.4: All test assertions pass in run_tests.py.
"""

import os
import sys
import math
import json
import re
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIELD_JS = os.path.join(ROOT_DIR, "src", "world", "field.js")
NPC_PATHS_JS = os.path.join(ROOT_DIR, "src", "world", "npc_paths.js")
MANIFEST_JSON = os.path.join(ROOT_DIR, "src", "world", "npc_path_manifest.json")


def load_npc_paths():
    """Extracts NPC_PATHS array from src/world/npc_paths.js."""
    with open(NPC_PATHS_JS, "r", encoding="utf-8") as f:
        content = f.read()
    match = re.search(r"export\s+const\s+NPC_PATHS\s*=\s*(\[.*?\]);\s*export\s+const\s+NPC_PATH_IDS", content, re.DOTALL)
    if not match:
        raise ValueError("Could not extract NPC_PATHS from npc_paths.js")
    return json.loads(match.group(1))


def load_manifest():
    """Loads src/world/npc_path_manifest.json."""
    with open(MANIFEST_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_field_obstacles():
    """Extracts all trees, bins, and benches from src/world/field.js."""
    with open(FIELD_JS, "r", encoding="utf-8") as f:
        content = f.read()

    # Bins
    bins_match = re.search(r"const binDefinitions = \[(.*?)\];", content, re.DOTALL)
    bins = []
    for m in re.finditer(r"\{\s*id:\s*['\"]([^'\"]+)['\"],\s*x:\s*(\d+),\s*y:\s*(\d+)\s*\}", bins_match.group(1)):
        bins.append({
            "id": m.group(1),
            "x": float(m.group(2)),
            "y": float(m.group(3)),
            "radius": 12.0
        })

    # Benches
    benches_match = re.search(r"const benchPositions = \[(.*?)\];\s*this\.benches", content, re.DOTALL)
    benches = []
    for m in re.finditer(r"\{\s*id:\s*['\"]([^'\"]+)['\"],\s*x:\s*(\d+),\s*y:\s*(\d+)(?:,\s*angle:\s*([^}]+))?\s*\}", benches_match.group(1)):
        angle_expr = (m.group(4) or "0").strip().replace("Math.PI", "math.pi")
        angle = eval(angle_expr, {"math": math})
        benches.append({
            "id": m.group(1),
            "x": float(m.group(2)),
            "y": float(m.group(3)),
            "angle": float(angle),
            "w": 64.0,
            "h": 26.0
        })

    # Trees
    trees_match = re.search(r"const treePositions = \[(.*?)\];\s*this\.trees", content, re.DOTALL)
    trees = []
    for m in re.finditer(r"\{\s*x:\s*(\d+),\s*y:\s*(\d+),\s*r:\s*(\d+)", trees_match.group(1)):
        r = float(m.group(3))
        trees.append({
            "x": float(m.group(1)),
            "y": float(m.group(2)),
            "depthY": float(m.group(2)) + 10.0,
            "radius": r,
            "trunkRadius": float(round(r * 0.28))
        })

    # Rocks
    rocks = []
    rocks_match = re.search(r"// 3\. West Zone: Sea Walls Rocky Limestone Outcrops.*?this\.rockOutcrops = \[(.*?)\];", content, re.DOTALL)
    if rocks_match:
        for m in re.finditer(r"\{\s*id:\s*['\"]([^'\"]+)['\"],\s*x:\s*(\d+),\s*y:\s*(\d+).*?depthY:\s*(\d+),\s*r:\s*(\d+)", rocks_match.group(1)):
            rocks.append({
                "id": m.group(1),
                "x": float(m.group(2)),
                "y": float(m.group(3)),
                "depthY": float(m.group(4)),
                "r": float(m.group(5))
            })

    # Water Tower Landmark
    water_tower = {"x": 2400.0, "y": 450.0, "radius": 42.0}

    return {"bins": bins, "benches": benches, "trees": trees, "rocks": rocks, "waterTower": water_tower}


class TestNpcPaths(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.paths = load_npc_paths()
        cls.manifest = load_manifest()
        cls.obstacles = extract_field_obstacles()

    def test_ac_025_1_path_counts_and_variety(self):
        """AC-025.1: >= 8 distinct paths, >= 3 jogger, >= 5 walker, zone coverage."""
        self.assertGreaterEqual(len(self.paths), 8, f"Expected >= 8 paths, got {len(self.paths)}")

        jogger_paths = [p for p in self.paths if p.get("type") in ("jogger", "both")]
        walker_paths = [p for p in self.paths if p.get("type") in ("walker", "both")]

        self.assertGreaterEqual(len(jogger_paths), 3, f"Expected >= 3 jogger paths, got {len(jogger_paths)}")
        self.assertGreaterEqual(len(walker_paths), 5, f"Expected >= 5 walker paths, got {len(walker_paths)}")

        # Path IDs unique
        ids = [p["id"] for p in self.paths]
        self.assertEqual(len(ids), len(set(ids)), "Path IDs must be unique")

        # Check coverage of key zones
        id_str = " ".join(ids)
        self.assertTrue(any("ladies" in i for i in ids), "Missing Ladies Mile route")
        self.assertTrue(any("sea-walls" in i or "sea_walls" in i for i in ids), "Missing Sea Walls route")
        self.assertTrue(any("durdham" in i for i in ids), "Missing Durdham Down route")
        self.assertTrue(any("woodland" in i for i in ids), "Missing Woodland route")
        self.assertTrue(any("meadow" in i for i in ids), "Missing Meadow route")

        # Check that all 10 paths are point-to-point (start != end) spanning perimeter boundaries
        self.assertEqual(len(self.paths), 10, f"Expected 10 paths, got {len(self.paths)}")
        loops = [p for p in self.paths if math.hypot(p["waypoints"][0]["x"] - p["waypoints"][-1]["x"],
                                                     p["waypoints"][0]["y"] - p["waypoints"][-1]["y"]) < 5.0]
        p2p = [p for p in self.paths if math.hypot(p["waypoints"][0]["x"] - p["waypoints"][-1]["x"],
                                                   p["waypoints"][0]["y"] - p["waypoints"][-1]["y"]) >= 5.0]
        self.assertEqual(len(loops), 0, "Expected all paths to be point-to-point (0 closed loops)")
        self.assertEqual(len(p2p), 10, "Expected all 10 paths to be point-to-point edge-to-edge routes")

        def is_perimeter_boundary(wp):
            return (
                (75 <= wp['x'] <= 140 or 3060 <= wp['x'] <= 3125 or
                 75 <= wp['y'] <= 140 or 2260 <= wp['y'] <= 2325) and
                (0 <= wp['x'] <= 3200 and 0 <= wp['y'] <= 2400)
            )

        for p in self.paths:
            start_wp = p["waypoints"][0]
            end_wp = p["waypoints"][-1]
            self.assertTrue(is_perimeter_boundary(start_wp), f"Path {p['id']} start waypoint {start_wp} not inside perimeter wall boundary")
            self.assertTrue(is_perimeter_boundary(end_wp), f"Path {p['id']} end waypoint {end_wp} not inside perimeter wall boundary")
            span = math.hypot(end_wp['x'] - start_wp['x'], end_wp['y'] - start_wp['y'])
            self.assertGreaterEqual(span, 1200.0, f"Path {p['id']} span {span:.1f} < 1200.0 px")

    def test_ac_025_2_obstacle_clearance_and_world_bounds(self):
        """AC-025.2: Sample every segment at <= 8 px steps and assert clearance and bounds."""
        step_size = 6.0  # Finer than <= 8 px

        for path in self.paths:
            pid = path["id"]
            wps = path["waypoints"]
            self.assertGreaterEqual(len(wps), 2, f"Path {pid} must have >= 2 waypoints")

            for i in range(len(wps) - 1):
                p1, p2 = wps[i], wps[i + 1]
                dist = math.hypot(p2["x"] - p1["x"], p2["y"] - p1["y"])
                steps = max(1, math.ceil(dist / step_size))

                for s in range(steps + 1):
                    t = s / steps
                    sx = p1["x"] + (p2["x"] - p1["x"]) * t
                    sy = p1["y"] + (p2["y"] - p1["y"]) * t

                    # 1. World bounds: [0.0, 3200.0] x [0.0, 2400.0]
                    self.assertGreaterEqual(sx, 0.0, f"{pid} seg {i} X {sx:.1f} < 0")
                    self.assertLessEqual(sx, 3200.0, f"{pid} seg {i} X {sx:.1f} > 3200")
                    self.assertGreaterEqual(sy, 0.0, f"{pid} seg {i} Y {sy:.1f} < 0")
                    self.assertLessEqual(sy, 2400.0, f"{pid} seg {i} Y {sy:.1f} > 2400")

                    # 2. Tree clearance: hypot >= tree.trunkRadius + 20
                    for tree in self.obstacles["trees"]:
                        td = math.hypot(sx - tree["x"], sy - tree["depthY"])
                        min_td = tree["trunkRadius"] + 20.0
                        self.assertGreaterEqual(
                            td, min_td,
                            f"{pid} seg {i} step {s}/{steps} collides with tree ({tree['x']},{tree['depthY']}): {td:.1f} < {min_td:.1f}"
                        )

                    # 3. Bin clearance: hypot >= 32
                    for bin_obj in self.obstacles["bins"]:
                        bd = math.hypot(sx - bin_obj["x"], sy - bin_obj["y"])
                        self.assertGreaterEqual(
                            bd, 32.0,
                            f"{pid} seg {i} step {s}/{steps} collides with bin {bin_obj['id']}: {bd:.1f} < 32.0"
                        )

                    # 4. Bench clearance: box distance >= 20 px or center distance >= 55 px
                    for bench in self.obstacles["benches"]:
                        cd = math.hypot(sx - bench["x"], sy - bench["y"])
                        dx = sx - bench["x"]
                        dy = sy - bench["y"]
                        ang = bench["angle"]
                        lx = dx * math.cos(ang) + dy * math.sin(ang)
                        ly = -dx * math.sin(ang) + dy * math.cos(ang)
                        hw = bench["w"] / 2.0
                        hh = bench["h"] / 2.0
                        cx = max(-hw, min(hw, lx))
                        cy = max(-hh, min(hh, ly))
                        box_d = math.hypot(lx - cx, ly - cy)
                        has_clearance = (box_d >= 20.0) or (cd >= 55.0)
                        self.assertTrue(
                            has_clearance,
                            f"{pid} seg {i} step {s}/{steps} collides with bench {bench['id']}: box_d={box_d:.1f}, cd={cd:.1f}"
                        )

                    # 5. Rock outcrops clearance: hypot >= rock.r + 20 px
                    for rock in self.obstacles.get("rocks", []):
                        rd = math.hypot(sx - rock["x"], sy - rock.get("depthY", rock["y"]))
                        min_rd = rock["r"] + 20.0
                        self.assertGreaterEqual(
                            rd, min_rd,
                            f"{pid} seg {i} step {s}/{steps} collides with rock {rock['id']}: {rd:.1f} < {min_rd:.1f}"
                        )

                    # 6. Water Tower clearance: hypot >= wt.radius + 20 px (62 px)
                    wt = self.obstacles.get("waterTower", {"x": 2400.0, "y": 450.0, "radius": 42.0})
                    wtd = math.hypot(sx - wt["x"], sy - wt["y"])
                    self.assertGreaterEqual(
                        wtd, wt["radius"] + 20.0,
                        f"{pid} seg {i} step {s}/{steps} collides with water tower: {wtd:.1f} < {wt['radius'] + 20.0:.1f}"
                    )

    def test_ac_033_2_central_interior_traversal(self):
        """AC-033.2: At least 6 of the 10 paths have intermediate waypoints traversing the central region (900 <= x <= 2500, 450 <= y <= 1450)."""
        def traverses_central(p):
            return any(900 <= wp['x'] <= 2500 and 450 <= wp['y'] <= 1450 for wp in p["waypoints"][1:-1])

        central_paths = [p for p in self.paths if traverses_central(p)]
        self.assertGreaterEqual(
            len(central_paths), 6,
            f"Expected >= 6 paths traversing central region, got {len(central_paths)}: {[p['id'] for p in central_paths]}"
        )

    def test_ac_025_3_manifest_lengths_match_polylines(self):
        """AC-025.3: Manifest lengths match computed polyline lengths within 1.0 px."""
        manifest_map = {m["id"]: m for m in self.manifest}
        self.assertEqual(len(manifest_map), len(self.paths), "Manifest count must match paths count")
        self.assertEqual(len(self.paths), 10, f"Expected 10 paths, got {len(self.paths)}")

        for path in self.paths:
            pid = path["id"]
            self.assertIn(pid, manifest_map, f"Path {pid} missing in manifest")
            m_entry = manifest_map[pid]
            self.assertEqual(path["type"], m_entry["type"], f"Type mismatch for {pid}")

            # Compute polyline length
            wps = path["waypoints"]
            computed_len = sum(
                math.hypot(wps[i + 1]["x"] - wps[i]["x"], wps[i + 1]["y"] - wps[i]["y"])
                for i in range(len(wps) - 1)
            )
            manifest_len = m_entry["lengthPx"]

            diff = abs(computed_len - manifest_len)
            self.assertLessEqual(
                diff, 1.0,
                f"Path {pid} length mismatch: computed {computed_len:.2f} vs manifest {manifest_len:.2f} (diff={diff:.2f} > 1.0)"
            )

    def test_npc_paths_js_exports(self):
        """Verify npc_paths.js exports NPC_PATHS, NPC_PATH_IDS, and getNpcPath."""
        with open(NPC_PATHS_JS, "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("export const NPC_PATHS", code)
        self.assertIn("export const NPC_PATH_IDS", code)
        self.assertIn("export function getNpcPath", code)


if __name__ == "__main__":
    unittest.main()
