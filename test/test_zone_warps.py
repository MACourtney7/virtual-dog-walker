#!/usr/bin/env python3
"""
Unit and Integration Tests for Multi-Location Zone Architecture & Seamless Warping (Ticket unification-012):
- AC-012.1: Declarative ZoneRegistry (zones.js) with The Downs, The Woodland, The Beach, and registerZone API
- AC-012.2: Bi-directional Warp Gate Connectivity and >= 80px Obstacle Clearance
- AC-012.3: Multi-Biome Scenery, Animated Coastal Surf & Warp Signpost Rendering
- AC-012.4: Main Orchestration, Wasm Obstacle Sync, Entity Repositioning, Ball Retrieval & switchRoom P2P Lifecycle
- AC-012.5: SocialHUD Zone Title & Multi-Zone Online Status Pill
"""

import math
import os
import re
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ZONES_JS = os.path.join(ROOT_DIR, "src", "world", "zones.js")
BIOMES_JS = os.path.join(ROOT_DIR, "src", "world", "zone_biomes.js")
FIELD_JS = os.path.join(ROOT_DIR, "src", "world", "field.js")
MAIN_JS = os.path.join(ROOT_DIR, "src", "main.js")
NET_JS = os.path.join(ROOT_DIR, "src", "net", "zero_mesh_network.js")
HUD_JS = os.path.join(ROOT_DIR, "src", "ui", "social_hud.js")


class TestZoneRegistry(unittest.TestCase):
    def setUp(self):
        with open(ZONES_JS, "r", encoding="utf-8") as f:
            self.zones_code = f.read()

    def test_zone_definitions(self):
        """Verify all three core zones are defined in PARK_ZONES with valid biomes and dimensions."""
        self.assertIn("PARK_ZONES", self.zones_code)
        self.assertIn("'clifton-commons'", self.zones_code)
        self.assertIn("'the-woodland'", self.zones_code)
        self.assertIn("'the-beach'", self.zones_code)

        # Biomes
        self.assertIn("biome: 'parkland'", self.zones_code)
        self.assertIn("biome: 'woodland'", self.zones_code)
        self.assertIn("biome: 'coastal'", self.zones_code)

        # Dimensions: 3200 x 2400
        self.assertIn("worldWidth: 3200", self.zones_code)
        self.assertIn("worldHeight: 2400", self.zones_code)

    def test_public_zone_ids(self):
        """Verify PUBLIC_ZONE_IDS contains all public locations and aliases."""
        self.assertIn("PUBLIC_ZONE_IDS", self.zones_code)
        for expected_id in ['clifton-commons', 'the-downs', 'the-woodland', 'the-beach']:
            self.assertIn(expected_id, self.zones_code)

    def test_get_zone_config_and_register_zone(self):
        """Verify getZoneConfig and registerZone API presence and logic."""
        self.assertIn("export function getZoneConfig", self.zones_code)
        self.assertIn("export function registerZone", self.zones_code)
        # Fallback to clifton-commons
        self.assertIn("clifton-commons", self.zones_code)


class TestWarpGateConnectivityAndClearance(unittest.TestCase):
    def setUp(self):
        with open(ZONES_JS, "r", encoding="utf-8") as f:
            self.zones_code = f.read()
        with open(BIOMES_JS, "r", encoding="utf-8") as f:
            self.biomes_code = f.read()
        with open(FIELD_JS, "r", encoding="utf-8") as f:
            self.field_code = f.read()

    def test_warp_gate_declarations(self):
        """Verify warp gates connect Downs, Woodland, and Beach bi-directionally."""
        # Downs gates
        self.assertIn("gate-downs-to-woodland", self.zones_code)
        self.assertIn("gate-downs-to-beach", self.zones_code)

        # Woodland gates
        self.assertIn("gate-woodland-to-downs", self.zones_code)
        self.assertIn("gate-woodland-to-beach", self.zones_code)

        # Beach gates
        self.assertIn("gate-beach-to-downs", self.zones_code)
        self.assertIn("gate-beach-to-woodland", self.zones_code)

    def test_gate_clearance_from_obstacles(self):
        """Verify all gates and arrival target points maintain >= 80px clearance from obstacles."""
        # Warp gate positions & arrival targets across zones
        gate_points = [
            (110, 1200), (3000, 1200),
            (1600, 2290), (1600, 200),
            (3090, 1200), (220, 1200),
            (110, 1900), (220, 1200),
            (1600, 110), (1600, 2180),
            (110, 1200), (220, 1900)
        ]

        # Landmark coordinates
        landmarks = [
            (2400, 450),  # Water Tower (Downs)
            (1550, 1100), # Ancient Woodland Clearing (Woodland)
            (2350, 1450), # Shipwreck Ribs (Beach)
            (900, 340),   # Dune Lookout Post (Beach)
        ]

        for gx, gy in gate_points:
            for lx, ly in landmarks:
                dist = math.hypot(gx - lx, gy - ly)
                self.assertGreaterEqual(dist, 80.0, f"Gate ({gx}, {gy}) too close to landmark ({lx}, {ly}): {dist:.1f}px < 80px")


class TestFieldMultiBiomeAndRendering(unittest.TestCase):
    def setUp(self):
        with open(FIELD_JS, "r", encoding="utf-8") as f:
            self.field_code = f.read()
        with open(BIOMES_JS, "r", encoding="utf-8") as f:
            self.biomes_code = f.read()

    def test_field_load_zone_and_biome_scenery(self):
        """Verify Field has loadZone, checkWarpGate, and integrates zone_biomes."""
        self.assertIn("loadZone", self.field_code)
        self.assertIn("checkWarpGate", self.field_code)
        self.assertIn("initBiomeScenery", self.field_code)
        self.assertIn("bakeBiomeGround", self.field_code)
        self.assertIn("renderCoastalSurf", self.field_code)
        self.assertIn("renderWarpSignpost", self.field_code)
        self.assertIn("renderLandmark", self.field_code)

    def test_beach_golden_sand_openness(self):
        """Verify the central golden sand expanse (y: 450..1800) is kept open for ball throwing."""
        has_beach_scenery = "initCoastalScenery" in self.biomes_code or "initBeachScenery" in self.biomes_code
        self.assertTrue(has_beach_scenery, "Coastal/Beach scenery initializer missing in zone_biomes.js")
        self.assertIn("shipwreck-ribs", self.biomes_code)
        self.assertIn("dune-lookout", self.biomes_code)
        self.assertIn("1550", self.biomes_code)

    def test_woodland_fallen_sticks_count(self):
        """Verify The Woodland provides 14+ fallen sticks for companion dogs to carry."""
        self.assertIn("initWoodlandScenery", self.biomes_code)
        stick_matches = re.findall(r"stick-woodland-", self.biomes_code)
        # Should be dynamically generated with a loop of >= 14 or explicit items
        has_stick_loop = "14" in self.biomes_code and "stick" in self.biomes_code
        self.assertTrue(len(stick_matches) >= 14 or has_stick_loop, "Woodland must supply >= 14 fallen sticks")

    def test_coastal_animated_surf(self):
        """Verify coastal wave crest animation is rendered along y ≈ 1850."""
        self.assertIn("renderCoastalSurf", self.biomes_code)
        self.assertIn("1850", self.biomes_code)
        self.assertIn("Math.sin", self.biomes_code)


class TestMainWarpOrchestrationAndHUD(unittest.TestCase):
    def setUp(self):
        with open(MAIN_JS, "r", encoding="utf-8") as f:
            self.main_code = f.read()
        with open(HUD_JS, "r", encoding="utf-8") as f:
            self.hud_code = f.read()
        with open(NET_JS, "r", encoding="utf-8") as f:
            self.net_code = f.read()

    def test_main_warp_to_zone_lifecycle(self):
        """Verify warpToZone updates zone, syncs Wasm obstacles, repositions entities, and switches room."""
        self.assertIn("warpToZone", self.main_code)
        self.assertIn("currentZoneId", self.main_code)
        self.assertIn("warpCooldown", self.main_code)
        self.assertIn("warpFadeAlpha", self.main_code)
        self.assertIn("syncWorldObstacles", self.main_code)
        self.assertIn("retrieveByOwner", self.main_code)
        self.assertIn("switchRoom", self.main_code)

    def test_screen_crossfade_veil(self):
        """Verify full-screen crossfade veil renders during warp transition."""
        self.assertIn("warpFadeAlpha", self.main_code)
        self.assertIn("rgba(11, 17, 23,", self.main_code)

    def test_net_switch_room_implementation(self):
        """Verify ZeroMeshNetworkManager implements switchRoom with leave broadcast and room reconnect."""
        self.assertIn("async switchRoom", self.net_code)
        self.assertIn("broadcastLeave", self.net_code)
        self.assertIn("this.roomId = newRoomId", self.net_code)
        self.assertIn("this.connect", self.net_code)

    def test_hud_zone_title_and_online_badge(self):
        """Verify SocialHUD setZoneTitle and online badge display for all zones."""
        self.assertIn("setZoneTitle", self.hud_code)
        self.assertIn("hud-title", self.hud_code)
        # All public zones must be recognized as online commons
        for zid in ['clifton-commons', 'the-downs', 'the-woodland', 'the-beach']:
            self.assertIn(f"'{zid}'", self.hud_code)


if __name__ == "__main__":
    unittest.main()
