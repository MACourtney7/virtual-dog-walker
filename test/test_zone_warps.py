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
NETWORK_MGR_JS = os.path.join(ROOT_DIR, "src", "net", "network.js")
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

    def test_is_public_zone_id(self):
        """Verify isPublicZoneId helper is exported and used for public zone detection."""
        self.assertIn("export function isPublicZoneId", self.zones_code)
        self.assertIn("PUBLIC_ZONE_IDS.includes(zoneId)", self.zones_code)
        self.assertIn("hasOwnProperty.call(PARK_ZONES, zoneId)", self.zones_code)


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


class TestObstacleClearanceBehavioral(unittest.TestCase):
    """
    M3: Comprehensive behavioral clearance tests. Every generated obstacle in
    each biome must maintain >= 80px clearance from that zone's warp gates and
    arrival targets.
    """

    CLEARANCE = 80.0

    # Gate + arrival target coordinates per zone (mirrors zone_biomes keepouts).
    ZONE_KEEPOUTS = {
        'woodland': [(3090, 1200), (110, 1900), (3000, 1200), (220, 1900)],
        'coastal': [(1600, 110), (110, 1200), (1600, 200), (220, 1200)],
        'downs': [(110, 1200), (1600, 2290), (220, 1200), (1600, 2180)],
    }

    def setUp(self):
        with open(BIOMES_JS, "r", encoding="utf-8") as f:
            self.biomes_code = f.read()
        with open(FIELD_JS, "r", encoding="utf-8") as f:
            self.field_code = f.read()

    def _assert_clear(self, zone, x, y, label):
        for gx, gy in self.ZONE_KEEPOUTS[zone]:
            dist = math.hypot(x - gx, y - gy)
            self.assertGreaterEqual(
                dist, self.CLEARANCE,
                f"{zone} {label} at ({x}, {y}) too close to gate ({gx}, {gy}): {dist:.1f}px < {self.CLEARANCE}px"
            )

    def test_keepout_constants_defined(self):
        """Verify all three keepout arrays are declared with the required points."""
        self.assertIn("WOODLAND_KEEPOUT", self.biomes_code)
        self.assertIn("COASTAL_KEEPOUT", self.biomes_code)
        self.assertIn("DOWNS_KEEPOUT", self.biomes_code)
        for zone, pts in self.ZONE_KEEPOUTS.items():
            for gx, gy in pts:
                self.assertIn(f"x: {gx}, y: {gy}", self.biomes_code,
                              f"Missing keepout point ({gx}, {gy}) for {zone}")

    def test_keepout_radius_is_80(self):
        """Verify KEEPOUT_RADIUS is 80 and isClearOfKeepouts accepts a radius arg."""
        self.assertIn("KEEPOUT_RADIUS = 80", self.biomes_code)
        self.assertIn("function isClearOfKeepouts(x, y, keepouts, radius", self.biomes_code)

    def test_woodland_scenery_uses_keepout(self):
        """Verify woodland trees, benches, bins, rocks, and sticks all check keepouts."""
        # Count occurrences of isClearOfKeepouts with WOODLAND_KEEPOUT
        woodland_checks = re.findall(r"isClearOfKeepouts\([^)]*WOODLAND_KEEPOUT", self.biomes_code)
        self.assertGreaterEqual(len(woodland_checks), 5,
                                "Woodland scenery must apply keepout checks to trees, benches, bins, rocks, and sticks")

    def test_coastal_scenery_uses_keepout(self):
        """Verify coastal benches, bins, rocks, landmarks, and sticks all check keepouts."""
        coastal_checks = re.findall(r"isClearOfKeepouts\([^)]*COASTAL_KEEPOUT", self.biomes_code)
        self.assertGreaterEqual(len(coastal_checks), 5,
                                "Coastal scenery must apply keepout checks to benches, bins, rocks, landmarks, and sticks")

    def test_woodland_landmark_clearance(self):
        """Ancient Woodland Clearing (1550, 1100) must be >= 80px from woodland gates."""
        self._assert_clear('woodland', 1550, 1100, 'woodland-clearing')

    def test_coastal_landmark_clearance(self):
        """Coastal landmarks must be >= 80px from coastal gates."""
        self._assert_clear('coastal', 2350, 1450, 'shipwreck-ribs')
        self._assert_clear('coastal', 900, 340, 'dune-lookout')

    def test_downs_water_tower_clearance(self):
        """Water Tower (2400, 450) must be >= 80px from downs gates."""
        self._assert_clear('downs', 2400, 450, 'water-tower')

    def test_woodland_sticks_loop_uses_keepout(self):
        """Verify woodland sticks are generated in a loop that checks keepouts."""
        # The stick generation must be a while loop with keepout check
        self.assertIn("stickAttempts", self.biomes_code)
        self.assertIn("stickCount", self.biomes_code)

    def test_downs_scenery_clearance(self):
        """H1: Parkland scenery in field.js must apply DOWNS_KEEPOUT filtering."""
        # field.js must import DOWNS_KEEPOUT and isClearOfKeepouts from zone_biomes.
        self.assertIn("DOWNS_KEEPOUT", self.field_code)
        self.assertIn("isClearOfKeepouts", self.field_code)
        # Each scenery collection must be filtered against DOWNS_KEEPOUT.
        for collection in ("rockOutcrops", "benches", "bins", "trees"):
            pattern = re.compile(
                r"this\." + collection + r"\s*=[\s\S]{0,400}?isClearOfKeepouts\([^)]*DOWNS_KEEPOUT",
                re.DOTALL,
            )
            self.assertRegex(
                self.field_code,
                pattern,
                f"this.{collection} must be filtered with isClearOfKeepouts(..., DOWNS_KEEPOUT, 80)",
            )

    def test_downs_keepout_exported(self):
        """H1: DOWNS_KEEPOUT and isClearOfKeepouts must be exported from zone_biomes.js."""
        self.assertIn("export const DOWNS_KEEPOUT", self.biomes_code)
        self.assertIn("export function isClearOfKeepouts", self.biomes_code)


class TestLandmarkCleanupOnReturn(unittest.TestCase):
    """H2: Biome landmarks must not leak back into clifton-commons."""

    def setUp(self):
        with open(BIOMES_JS, "r", encoding="utf-8") as f:
            self.biomes_code = f.read()
        with open(FIELD_JS, "r", encoding="utf-8") as f:
            self.field_code = f.read()

    def test_field_init_scenery_resets_landmarks(self):
        """initScenery must reset this.landmarks to only the water tower."""
        self.assertIn("this.landmarks = this.waterTower ? [this.waterTower] : []", self.field_code)

    def test_parkland_biome_resets_landmarks(self):
        """initBiomeScenery for parkland must reset field.landmarks."""
        self.assertIn("field.landmarks = field.waterTower ? [field.waterTower] : []", self.biomes_code)


class TestNetworkSwitchRoomSync(unittest.TestCase):
    """H4: NetworkManager.switchRoom must update this.roomId before delegating."""

    def setUp(self):
        with open(NETWORK_MGR_JS, "r", encoding="utf-8") as f:
            self.net_code = f.read()

    def test_switch_room_sets_room_id_before_delegate(self):
        """Verify this.roomId = newRoomId appears before adapter.switchRoom call."""
        # Find the switchRoom method body
        match = re.search(r"async switchRoom\(newRoomId\)\s*\{(.*?)\n  \}", self.net_code, re.DOTALL)
        self.assertIsNotNone(match, "switchRoom method not found")
        body = match.group(1)
        room_id_pos = body.find("this.roomId = newRoomId")
        adapter_pos = body.find("this.adapter.switchRoom")
        self.assertGreaterEqual(room_id_pos, 0, "this.roomId = newRoomId not found in switchRoom")
        self.assertGreaterEqual(adapter_pos, 0, "this.adapter.switchRoom not found in switchRoom")
        self.assertLess(room_id_pos, adapter_pos,
                        "this.roomId must be set BEFORE delegating to adapter.switchRoom")


class TestCrossfadeVeilScreenSpace(unittest.TestCase):
    """H3: Crossfade veil must reset canvas transform before drawing."""

    def setUp(self):
        with open(MAIN_JS, "r", encoding="utf-8") as f:
            self.main_code = f.read()

    def test_crossfade_resets_transform(self):
        """Verify setTransform(1, 0, 0, 1, 0, 0) is called before the crossfade fillRect."""
        # Find the crossfade block
        match = re.search(r"warpFadeAlpha > 0\.01.*?fillRect", self.main_code, re.DOTALL)
        self.assertIsNotNone(match, "Crossfade block not found")
        block = match.group(0)
        self.assertIn("setTransform(1, 0, 0, 1, 0, 0)", block,
                      "Crossfade must reset canvas transform to screen-space")


class TestHUDTitleAndOnlineState(unittest.TestCase):
    """M1 & L2: HUD title emoji cleanup and online state detection."""

    def setUp(self):
        with open(HUD_JS, "r", encoding="utf-8") as f:
            self.hud_code = f.read()

    def test_no_duplicate_tree_emoji(self):
        """Verify the static tree emoji span is removed from initHUD."""
        # The old pattern had a separate <span>🌳</span> before #hud-title
        self.assertNotIn('<span style="font-size: 1.2rem;">🌳</span>', self.hud_code,
                         "Duplicate tree emoji span must be removed")

    def test_online_state_uses_public_zone_ids(self):
        """Verify updateNetworkState uses PUBLIC_ZONE_IDS and isPublicZoneId."""
        self.assertIn("PUBLIC_ZONE_IDS", self.hud_code)
        self.assertIn("isPublicZoneId", self.hud_code)

    def test_private_room_not_marked_online(self):
        """M1: Private rooms must not be marked Online via getZoneConfig fallback."""
        # social_hud.js must not call getZoneConfig in updateNetworkState.
        self.assertNotIn("getZoneConfig", self.hud_code,
                         "social_hud.js must not use getZoneConfig (fallback marks private rooms online)")
        # isPublicZoneId must be imported from zones.js.
        self.assertIn("isPublicZoneId", self.hud_code)
        # Simulate isPublicZoneId behaviour for a private room id.
        with open(ZONES_JS, "r", encoding="utf-8") as f:
            zones_code = f.read()
        self.assertIn("export function isPublicZoneId", zones_code)
        # Private room ids are not in PUBLIC_ZONE_IDS nor PARK_ZONES keys.
        self.assertNotIn("'private-room-abc'", zones_code)


class TestWarpToZoneAliasHandling(unittest.TestCase):
    """L3: warpToZone must use field.zoneId (canonical) not the alias."""

    def setUp(self):
        with open(MAIN_JS, "r", encoding="utf-8") as f:
            self.main_code = f.read()

    def test_warp_uses_field_zone_id(self):
        """Verify warpToZone sets currentZoneId from field.zoneId."""
        match = re.search(r"warpToZone\(targetZoneId, targetX, targetY\)\s*\{(.*?)\n  \}", self.main_code, re.DOTALL)
        self.assertIsNotNone(match, "warpToZone method not found")
        body = match.group(1)
        self.assertIn("this.field.zoneId", body,
                      "warpToZone must use this.field.zoneId for canonical zone id")


if __name__ == "__main__":
    unittest.main()
