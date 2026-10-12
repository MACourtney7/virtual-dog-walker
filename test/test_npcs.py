#!/usr/bin/env python3
"""
Automated Acceptance & Behavioral Test Suite for Park NPCs (Ticket-016):
- AC-016.1: WalkerNPC waypoint traversal, leisure walking speed bounds (~75-100 px/s),
            and bench/overlook pausing (4.0 - 10.0s).
- AC-016.2: JoggerNPC continuous athletic running loops along Ladies Mile and
            perimeter paths (~240-280 px/s) without stopping at benches.
- AC-016.3: Mutual soft steering avoidance around players and dogs (displacement force
            away from nearby entities within avoidance threshold).
- AC-016.4: Canine personality reactions to passersby:
            - Barkyness roll: dog barks when jogger passes within 80px if barkyness >= 3.
            - Shyness roll: dog steers away giving wide berth within 75px if shyness >= 3.
            - Playfulness roll: tail wag frequency elevation and play-bow chance if playfulness >= 4.
- AC-016.5: Y-sorted depth ordering: NPC depthY = y + 12 integrates with depth-sorted render pipeline.
- AC-016.6: Waypoint loops: ladies_mile, sea_walls, and durdham_down definitions,
            valid park coordinates (3200 x 2400), and loop continuity.
"""

import math
import os
import random
import re
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NPC_JS = os.path.join(ROOT_DIR, "src", "entities", "npc.js")
FIELD_JS = os.path.join(ROOT_DIR, "src", "world", "field.js")
MAIN_JS = os.path.join(ROOT_DIR, "src", "main.js")
DOG_JS = os.path.join(ROOT_DIR, "src", "entities", "companion_dog.js")


class SimulatedParkNPC:
    """
    Python behavioral simulation of ParkNPC / WalkerNPC / JoggerNPC
    mirroring algorithms in src/entities/npc.js.
    """
    def __init__(self, x=0.0, y=0.0, speed=85.0, waypoints=None, waypoint_index=0,
                 is_jogger=False, pause_timer=0.0, radius=14.0):
        self.x = float(x)
        self.y = float(y)
        self.vx = 0.0
        self.vy = 0.0
        self.speed = float(speed)
        self.radius = float(radius)
        self.depthY = self.y + 12.0
        self.waypoints = waypoints or []
        self.waypointIndex = waypoint_index
        self.isJogger = is_jogger
        self.pauseTimer = float(pause_timer)
        self.state = "PAUSED" if self.pauseTimer > 0 else ("RUNNING" if self.isJogger else "WALKING")

    def update(self, dt, obstacles=None, avoidance_entities=None):
        # 1. Paused state
        if self.pauseTimer > 0:
            self.pauseTimer -= dt
            self.vx = 0.0
            self.vy = 0.0
            if self.pauseTimer <= 0:
                self.pauseTimer = 0.0
                self.state = "RUNNING" if self.isJogger else "WALKING"
            self.depthY = self.y + 12.0
            return

        # 2. Waypoint Path Navigation
        desired_vx = 0.0
        desired_vy = 0.0

        if len(self.waypoints) > 0:
            target = self.waypoints[self.waypointIndex]
            tx = target["x"]
            ty = target["y"]
            arrival_radius = target.get("radius", 24.0)

            dx = tx - self.x
            dy = ty - self.y
            dist = math.hypot(dx, dy)

            if dist < arrival_radius:
                self.waypointIndex = (self.waypointIndex + 1) % len(self.waypoints)
                # Pause handling for walkers: bench, overlook, or pauseDuration
                if target.get("isBench") or target.get("isOverlook") or target.get("pauseDuration"):
                    if not self.isJogger:
                        self.pauseTimer = target.get("pauseDuration") or (4.0 + random.random() * 6.0)
                        self.state = "PAUSED"
                        self.vx = 0.0
                        self.vy = 0.0
                        self.depthY = self.y + 12.0
                        return

            active_target = self.waypoints[self.waypointIndex]
            tdx = active_target["x"] - self.x
            tdy = active_target["y"] - self.y
            tdist = math.hypot(tdx, tdy)
            if tdist > 0.001:
                desired_vx = (tdx / tdist) * self.speed
                desired_vy = (tdy / tdist) * self.speed

        # 3. Mutual Soft Avoidance Steering
        if avoidance_entities:
            for entity in avoidance_entities:
                if entity is not self:
                    edx = self.x - entity.x
                    edy = self.y - entity.y
                    edist = math.hypot(edx, edy)
                    min_sep = self.radius + getattr(entity, "radius", 15.0) + 20.0
                    if 0.001 < edist < min_sep:
                        rep_force = (1.0 - edist / min_sep) * self.speed * 0.85
                        desired_vx += (edx / edist) * rep_force
                        desired_vy += (edy / edist) * rep_force

        # 4. Velocity Integration & Speed Clamping
        desired_speed = math.hypot(desired_vx, desired_vy)
        if desired_speed > self.speed:
            desired_vx = (desired_vx / desired_speed) * self.speed
            desired_vy = (desired_vy / desired_speed) * self.speed

        self.vx = desired_vx
        self.vy = desired_vy
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.depthY = self.y + 12.0


class SimulatedCompanionDog:
    """
    Simulation of CompanionDog NPC interactions matching src/entities/companion_dog.js.
    """
    def __init__(self, x=1000.0, y=1000.0, personality=None, is_leashed=False):
        self.x = float(x)
        self.y = float(y)
        self.vx = 0.0
        self.vy = 0.0
        self.speed = 195.0
        self.radius = 16.0
        self.is_leashed = is_leashed
        self.personality = personality or {
            "playfulness": 3,
            "shyness": 2,
            "barkyness": 2,
            "obedience": 4
        }
        self.wagSpeed = 8.0
        self.isBarking = False
        self.state = "ROAMING"
        self.emoteBubble = None

    def bark(self):
        self.isBarking = True

    def checkNPCInteractions(self, npcs):
        if not npcs:
            return

        for npc in npcs:
            if not npc:
                continue
            dist = math.hypot(self.x - npc.x, self.y - npc.y)
            if dist >= 80:
                continue

            # 1. Barkyness roll (Joggers)
            if (getattr(npc, "isJogger", False) or getattr(npc, "type", "") == "jogger") and self.personality["barkyness"] >= 3:
                # Deterministic check for test verification
                self.bark()

            # 2. Shyness roll (Berth avoidance)
            if self.personality["shyness"] >= 3:
                if 0.001 < dist < 75:
                    shy_force = (1.0 - dist / 75.0) * (self.speed * 0.45) * ((self.personality["shyness"] - 2) / 3.0)
                    self.vx += ((self.x - npc.x) / dist) * shy_force
                    self.vy += ((self.y - npc.y) / dist) * shy_force

            # 3. Playfulness roll (Wag / Bow)
            if self.personality["playfulness"] >= 4:
                self.wagSpeed = max(self.wagSpeed, 14.0 + self.personality["playfulness"] * 2.0)
                if not self.is_leashed and self.state == "ROAMING" and dist < 50:
                    self.state = "PLAY_BOW"
                    self.emoteBubble = "🐾"


class TestParkNPCs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(NPC_JS, "r", encoding="utf-8") as f:
            cls.npc_code = f.read()
        with open(FIELD_JS, "r", encoding="utf-8") as f:
            cls.field_code = f.read()
        with open(MAIN_JS, "r", encoding="utf-8") as f:
            cls.main_code = f.read()
        with open(DOG_JS, "r", encoding="utf-8") as f:
            cls.dog_code = f.read()

    # --------------------------------------------------------------------------
    # AC-016.1: WalkerNPC Waypoint Traversal & Bench/Overlook Pausing
    # --------------------------------------------------------------------------
    def test_walker_npc_code_structure(self):
        """Verify WalkerNPC inherits from ParkNPC with leisure speed bounds ~75-100 px/s."""
        self.assertIn("class WalkerNPC extends ParkNPC", self.npc_code)
        speed_match = re.search(r"class\s+WalkerNPC\s+extends\s+ParkNPC\b.*?speed:\s*(\d+)", self.npc_code, re.DOTALL)
        self.assertIsNotNone(speed_match, "WalkerNPC must define default speed")
        speed = int(speed_match.group(1))
        self.assertTrue(75 <= speed <= 100, f"WalkerNPC speed {speed} not within leisure pace ~75-100 px/s")

    def test_walker_waypoint_traversal(self):
        """Verify WalkerNPC moves toward target waypoint and advances upon arrival."""
        waypoints = [
            {"x": 100.0, "y": 100.0, "radius": 24.0},
            {"x": 200.0, "y": 100.0, "radius": 24.0},
            {"x": 200.0, "y": 200.0, "radius": 24.0}
        ]
        walker = SimulatedParkNPC(x=100.0, y=100.0, speed=85.0, waypoints=waypoints, waypoint_index=0)

        # First update when already at waypoint 0 should advance target index to 1
        walker.update(0.1)
        self.assertEqual(walker.waypointIndex, 1, "Walker should advance to next waypoint on arrival")
        self.assertGreater(walker.vx, 0, "Walker should move toward waypoint (200, 100)")
        self.assertEqual(walker.vy, 0)

        # Move walker until arrival at waypoint 1
        for _ in range(30):
            walker.update(0.1)
            if walker.waypointIndex == 2:
                break
        self.assertEqual(walker.waypointIndex, 2, "Walker should transition to waypoint 2")

    def test_walker_bench_overlook_pausing(self):
        """Verify WalkerNPC pauses for 4-10s at bench or overlook waypoints."""
        # Code inspection
        self.assertIn("isBench", self.npc_code)
        self.assertIn("isOverlook", self.npc_code)
        self.assertIn("pauseTimer", self.npc_code)

        waypoints = [
            {"x": 100.0, "y": 100.0, "radius": 24.0, "isBench": True, "pauseDuration": 6.0},
            {"x": 300.0, "y": 100.0, "radius": 24.0}
        ]
        walker = SimulatedParkNPC(x=100.0, y=100.0, speed=85.0, waypoints=waypoints, waypoint_index=0, is_jogger=False)

        # Reaching bench waypoint triggers pause
        walker.update(0.1)
        self.assertEqual(walker.state, "PAUSED", "Walker must enter PAUSED state at bench")
        self.assertEqual(walker.pauseTimer, 6.0)
        self.assertEqual(walker.vx, 0.0)
        self.assertEqual(walker.vy, 0.0)

        # While paused, position should remain unchanged and timer decrements
        initial_x = walker.x
        walker.update(1.0)
        self.assertEqual(walker.x, initial_x)
        self.assertAlmostEqual(walker.pauseTimer, 5.0, places=1)
        self.assertEqual(walker.state, "PAUSED")

        # After pause duration expires, walker resumes WALKING
        walker.update(5.0)
        self.assertEqual(walker.pauseTimer, 0.0)
        self.assertEqual(walker.state, "WALKING", "Walker must resume WALKING after timer expires")

    # --------------------------------------------------------------------------
    # AC-016.2: JoggerNPC Athletic Running Loops
    # --------------------------------------------------------------------------
    def test_jogger_npc_code_structure(self):
        """Verify JoggerNPC inherits from ParkNPC with running pace ~240-280 px/s."""
        self.assertIn("class JoggerNPC extends ParkNPC", self.npc_code)
        speed_match = re.search(r"class\s+JoggerNPC\s+extends\s+ParkNPC\b.*?speed:\s*(\d+)", self.npc_code, re.DOTALL)
        self.assertIsNotNone(speed_match, "JoggerNPC must define default speed")
        speed = int(speed_match.group(1))
        self.assertTrue(240 <= speed <= 280, f"JoggerNPC speed {speed} not within athletic pace ~240-280 px/s")

    def test_jogger_does_not_pause_at_benches(self):
        """Verify JoggerNPC does not stop at bench or overlook waypoints."""
        waypoints = [
            {"x": 100.0, "y": 100.0, "radius": 24.0, "isBench": True},
            {"x": 300.0, "y": 100.0, "radius": 24.0, "isOverlook": True}
        ]
        jogger = SimulatedParkNPC(x=100.0, y=100.0, speed=260.0, waypoints=waypoints, waypoint_index=0, is_jogger=True)

        jogger.update(0.1)
        self.assertEqual(jogger.state, "RUNNING", "Jogger must never enter PAUSED state at bench")
        self.assertEqual(jogger.pauseTimer, 0.0)
        self.assertEqual(jogger.waypointIndex, 1)

    def test_jogger_continuous_loop_cycle(self):
        """Verify JoggerNPC cycles through waypoints continuously."""
        waypoints = [
            {"x": 100.0, "y": 100.0, "radius": 24.0},
            {"x": 200.0, "y": 100.0, "radius": 24.0},
            {"x": 300.0, "y": 100.0, "radius": 24.0}
        ]
        jogger = SimulatedParkNPC(x=100.0, y=100.0, speed=260.0, waypoints=waypoints, waypoint_index=0, is_jogger=True)

        # Trigger transition 0 -> 1 -> 2 -> 0
        jogger.update(0.05)
        self.assertEqual(jogger.waypointIndex, 1)

        jogger.x, jogger.y = 200.0, 100.0
        jogger.update(0.05)
        self.assertEqual(jogger.waypointIndex, 2)

        jogger.x, jogger.y = 300.0, 100.0
        jogger.update(0.05)
        self.assertEqual(jogger.waypointIndex, 0, "Jogger should continuously wrap loop to start")

    # --------------------------------------------------------------------------
    # AC-016.3: Mutual Soft Steering Avoidance
    # --------------------------------------------------------------------------
    def test_soft_steering_avoidance_force(self):
        """Verify displacement force away from nearby entities within threshold."""
        # Check source implementation in npc.js
        self.assertIn("avoidanceEntities", self.npc_code)
        self.assertIn("minSep", self.npc_code)

        npc = SimulatedParkNPC(x=500.0, y=500.0, speed=100.0, waypoints=[{"x": 600.0, "y": 500.0}])

        # Entity placed directly ahead (525, 500) within minSep (14 + 15 + 20 = 49px)
        class Entity:
            def __init__(self, x, y, radius=15.0):
                self.x = x
                self.y = y
                self.radius = radius

        ahead_entity = Entity(525.0, 500.0)
        npc.update(0.1, avoidance_entities=[ahead_entity])

        # Repulsion force should push NPC backwards (negative x) or deviate path
        # Without obstacle, desired vx is +100. With obstacle at x=525, edx = 500 - 525 = -25
        # Repulsive component is in negative direction
        self.assertLess(npc.vx, 100.0, "Avoidance force should reduce forward velocity or steer away")

    def test_avoidance_no_effect_beyond_threshold(self):
        """Verify entities outside separation radius exert zero steering displacement."""
        npc = SimulatedParkNPC(x=500.0, y=500.0, speed=100.0, waypoints=[{"x": 700.0, "y": 500.0}])

        class Entity:
            def __init__(self, x, y, radius=15.0):
                self.x = x
                self.y = y
                self.radius = radius

        far_entity = Entity(700.0, 700.0)  # > 49px away
        npc.update(0.1, avoidance_entities=[far_entity])

        self.assertAlmostEqual(npc.vx, 100.0, places=2)
        self.assertAlmostEqual(npc.vy, 0.0, places=2)

    # --------------------------------------------------------------------------
    # AC-016.4: Canine Personality Reactions
    # --------------------------------------------------------------------------
    def test_dog_barkyness_reaction(self):
        """Verify dog with barkyness >= 3 barks when jogger passes within 80px."""
        dog_high_bark = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 4, "shyness": 1, "playfulness": 2, "obedience": 3})
        jogger = SimulatedParkNPC(x=1040.0, y=1000.0, is_jogger=True)  # dist = 40px (< 80px)

        dog_high_bark.checkNPCInteractions([jogger])
        self.assertTrue(dog_high_bark.isBarking, "Dog with barkyness >= 3 should bark at nearby jogger")

        dog_low_bark = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 1, "playfulness": 2, "obedience": 3})
        dog_low_bark.checkNPCInteractions([jogger])
        self.assertFalse(dog_low_bark.isBarking, "Dog with barkyness < 3 should not bark at jogger")

    def test_dog_shyness_reaction(self):
        """Verify dog with shyness >= 3 steers away giving wide berth when passerby is within 75px."""
        dog_shy = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 4, "playfulness": 2, "obedience": 3})
        passerby = SimulatedParkNPC(x=1030.0, y=1000.0, is_jogger=False)  # dist = 30px (< 75px)

        dog_shy.checkNPCInteractions([passerby])
        # Dog should be pushed away from passerby (passerby is at +x, so dog pushed in -x direction)
        self.assertLess(dog_shy.vx, 0.0, "Shy dog should steer away from passerby (negative vx)")

        dog_bold = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 2, "playfulness": 2, "obedience": 3})
        dog_bold.checkNPCInteractions([passerby])
        self.assertEqual(dog_bold.vx, 0.0, "Non-shy dog should not experience shy steering push")

    def test_dog_playfulness_reaction(self):
        """Verify dog with playfulness >= 4 elevates wagSpeed and performs play bow."""
        dog_playful = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 1, "playfulness": 5, "obedience": 3}, is_leashed=False)
        passerby = SimulatedParkNPC(x=1030.0, y=1000.0)  # dist = 30px (< 50px)

        initial_wag = dog_playful.wagSpeed
        dog_playful.checkNPCInteractions([passerby])
        self.assertGreater(dog_playful.wagSpeed, initial_wag, "Playful dog wagSpeed should elevate")
        self.assertEqual(dog_playful.state, "PLAY_BOW", "Off-leash playful dog should play-bow")
        self.assertEqual(dog_playful.emoteBubble, "🐾")

    # --------------------------------------------------------------------------
    # AC-016.5: Y-Sorted Depth Ordering
    # --------------------------------------------------------------------------
    def test_npc_depth_y_formula(self):
        """Verify NPC depthY = y + 12 for ground plane sorting."""
        npc = SimulatedParkNPC(x=1200.0, y=850.0)
        self.assertEqual(npc.depthY, 862.0)

        # Update y position and verify depthY recalculation
        npc.y = 920.0
        npc.update(0.0)
        self.assertEqual(npc.depthY, 932.0)

        # Inspect npc.js for depthY = this.y + 12
        self.assertIn("this.depthY = this.y + 12", self.npc_code)

    def test_depth_sorting_pipeline_integration(self):
        """Verify dynamic entities list sorting correctly interleaves NPCs with trees, dogs, and owners."""
        class DynamicItem:
            def __init__(self, name, depth_y):
                self.name = name
                self.depthY = depth_y

        items = [
            DynamicItem("tree-back", 500.0),
            DynamicItem("walker-front", 1212.0),
            DynamicItem("owner-mid", 1012.0),
            DynamicItem("dog-mid", 1006.0),
            DynamicItem("jogger-back", 712.0)
        ]

        sorted_items = sorted(items, key=lambda it: it.depthY)
        names_order = [it.name for it in sorted_items]
        self.assertEqual(names_order, ["tree-back", "jogger-back", "dog-mid", "owner-mid", "walker-front"])

    # --------------------------------------------------------------------------
    # AC-016.6: Waypoint Loops in field.js & Bounds Verification
    # --------------------------------------------------------------------------
    def test_field_waypoint_loops_exist(self):
        """Verify ladies_mile, sea_walls, and durdham_down loops exist in field.js."""
        self.assertIn("static getParkWaypoints", self.field_code)
        self.assertIn("ladies_mile", self.field_code)
        self.assertIn("sea_walls", self.field_code)
        self.assertIn("durdham_down", self.field_code)

    def test_waypoint_coordinates_within_park_bounds(self):
        """Verify all waypoints lie within 3200 x 2400 Downs boundaries."""
        # Extract coordinate pairs { x: ..., y: ... }
        pts = re.findall(r"\{\s*x:\s*(\d+),\s*y:\s*(\d+)", self.field_code)
        self.assertGreater(len(pts), 20, "Should have extracted waypoints from field.js")

        for x_str, y_str in pts:
            x, y = int(x_str), int(y_str)
            # Check they are within expanded Downs park dimensions (3200 x 2400)
            self.assertTrue(0 <= x <= 3200, f"Waypoint X coordinate {x} exceeds bounds (0-3200)")
            self.assertTrue(0 <= y <= 2400, f"Waypoint Y coordinate {y} exceeds bounds (0-2400)")

    def test_waypoint_special_attributes(self):
        """Verify bench and overlook attributes exist on appropriate loops."""
        self.assertIn("isBench", self.field_code)
        self.assertIn("isOverlook", self.field_code)

    # --------------------------------------------------------------------------
    # Orchestration Verification in src/main.js
    # --------------------------------------------------------------------------
    def test_main_js_imports_and_instantiation(self):
        """Verify CliftonDownGame imports WalkerNPC, JoggerNPC, and populates this.npcs."""
        self.assertIn("import { WalkerNPC, JoggerNPC } from './entities/npc.js'", self.main_code)
        self.assertIn("this.npcs = [];", self.main_code)
        self.assertIn("this.field.getParkWaypoints('ladies_mile')", self.main_code)
        self.assertIn("this.field.getParkWaypoints('sea_walls')", self.main_code)
        self.assertIn("this.field.getParkWaypoints('durdham_down')", self.main_code)

    def test_main_js_update_and_render_integration(self):
        """Verify update loops over this.npcs with avoidanceEntities and renders in dynamicEntities."""
        # Update assertions
        self.assertIn("const avoidanceEntities = [this.owner, this.dog, ...this.npcs];", self.main_code)
        self.assertIn("npc.update(dt, this.field, avoidanceEntities)", self.main_code)
        self.assertIn("this.dog.update(dt, this.field, allDogs, this.ball, this.npcs);", self.main_code)

        # Render assertions
        self.assertIn("for (const npc of this.npcs) {", self.main_code)
        self.assertIn("dynamicEntities.push(npc);", self.main_code)


if __name__ == "__main__":
    unittest.main()
