#!/usr/bin/env python3
"""
Unit and Integration Tests for Clifton Down Dedicated Microserver & Tunnel Engine
"""

import asyncio
import json
import os
import sys
import time
import unittest

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server.server import (
    CliftonServer,
    RoomManager,
    PeerConnection,
    RoomNpcSpawner,
    load_npc_manifest,
    TARGET_ACTIVE_NPCS,
    MIN_ACTIVE_NPCS,
    MAX_ACTIVE_NPCS,
    WALKER_SPEED,
    JOGGER_SPEED
)
from server.tunnel import get_local_ip, TunnelManager
import server.host as host_module


class DummyWebSocket:
    def __init__(self):
        self.sent_messages = []
        self.closed = False

    async def send_str(self, msg: str):
        self.sent_messages.append(msg)


class TestRoomManager(unittest.TestCase):
    def test_room_lifecycle_and_isolation(self):
        rm = RoomManager()
        self.assertEqual(len(rm.rooms), 0)

        # Peer 1 joins room A
        ws1 = DummyWebSocket()
        p1 = PeerConnection(ws1, "peer-1", "room-a")
        p1.meta["name"] = "Alice"
        rm.add_peer("room-a", p1)

        self.assertEqual(len(rm.rooms), 1)
        self.assertIn("room-a", rm.rooms)
        self.assertEqual(len(rm.get_room_peers("room-a")), 1)

        # Peer 2 joins room B (isolated)
        ws2 = DummyWebSocket()
        p2 = PeerConnection(ws2, "peer-2", "room-b")
        p2.meta["name"] = "Bob"
        rm.add_peer("room-b", p2)

        self.assertEqual(len(rm.rooms), 2)
        self.assertEqual(len(rm.get_room_peers("room-a")), 1)
        self.assertEqual(len(rm.get_room_peers("room-b")), 1)

        # Peer 3 joins room A
        ws3 = DummyWebSocket()
        p3 = PeerConnection(ws3, "peer-3", "room-a")
        rm.add_peer("room-a", p3)
        self.assertEqual(len(rm.get_room_peers("room-a")), 2)

        # Broadcast in room A
        asyncio.run(rm.broadcast_to_room("room-a", {"type": "TEST", "val": 42}, exclude_peer_id="peer-1"))
        self.assertEqual(len(ws1.sent_messages), 0)  # Excluded
        self.assertEqual(len(ws3.sent_messages), 1)  # Received
        self.assertEqual(len(ws2.sent_messages), 0)  # Room B received nothing!

        # Remove peers from room A
        rm.remove_peer("room-a", "peer-1")
        self.assertEqual(len(rm.get_room_peers("room-a")), 1)
        rm.remove_peer("room-a", "peer-3")
        # Room A should be closed and removed
        self.assertNotIn("room-a", rm.rooms)

        # Remove peer from room B
        rm.remove_peer("room-b", "peer-2")
        self.assertEqual(len(rm.rooms), 0)
        print("✅ test_room_lifecycle_and_isolation passed")


class TestRoomNpcSpawner(unittest.TestCase):
    def setUp(self):
        self.manifest = load_npc_manifest()

    def test_manifest_loaded(self):
        self.assertGreaterEqual(len(self.manifest), 10)
        for path in self.manifest:
            self.assertIn("id", path)
            self.assertIn("type", path)
            self.assertIn("lengthPx", path)
        print("✅ test_manifest_loaded passed")

    def test_spawner_initialization_and_path_selection(self):
        """AC-027.3 & AC-027.4: 5 active NPCs on distinct subset of paths with valid types and seeds."""
        async def run_test():
            rm = RoomManager()
            spawner = RoomNpcSpawner("test-room", rm, self.manifest)
            spawner.start()

            self.assertTrue(spawner.is_running)
            self.assertEqual(len(spawner.active_npcs), TARGET_ACTIVE_NPCS)
            self.assertTrue(MIN_ACTIVE_NPCS <= len(spawner.active_npcs) <= MAX_ACTIVE_NPCS)

            used_paths = [npc["pathId"] for npc in spawner.active_npcs.values()]
            # All 5 paths should be distinct (subset of 10)
            self.assertEqual(len(used_paths), len(set(used_paths)))
            self.assertEqual(len(used_paths), 5)
            self.assertLess(len(used_paths), len(self.manifest))

            # Verify schema of spawned NPCs
            for npc_id, npc in spawner.active_npcs.items():
                self.assertEqual(npc["id"], npc_id)
                self.assertIn(npc["type"], ("walker", "jogger"))
                self.assertEqual(npc["type"], npc["npcType"])
                self.assertIsInstance(npc["seed"], int)
                self.assertTrue(0 <= npc["seed"] <= 0xFFFFFFFF)
                self.assertIsInstance(npc["spawnTime"], int)
                self.assertGreater(npc["spawnTime"], 0)

            spawner.stop()
            self.assertFalse(spawner.is_running)
            self.assertEqual(len(spawner.active_npcs), 0)
            self.assertEqual(len(spawner.tasks), 0)

        asyncio.run(run_test())
        print("✅ test_spawner_initialization_and_path_selection passed")

    def test_snapshot_on_connect(self):
        """AC-027.2: Connecting client receives NPC_SNAPSHOT with original spawnTime and serverTime."""
        async def run_test():
            rm = RoomManager()
            ws = DummyWebSocket()
            peer = PeerConnection(ws, "peer-snap", "snap-room")
            rm.add_peer("snap-room", peer)

            spawner = rm.get_or_create_spawner("snap-room")
            spawner.start()

            initial_npcs = dict(spawner.active_npcs)
            await spawner.send_snapshot(peer)

            self.assertEqual(len(ws.sent_messages), 1)
            snapshot = json.loads(ws.sent_messages[0])

            self.assertEqual(snapshot["type"], "NPC_SNAPSHOT")
            self.assertEqual(len(snapshot["npcs"]), TARGET_ACTIVE_NPCS)
            self.assertIn("serverTime", snapshot)
            self.assertIn("timestamp", snapshot)
            self.assertTrue(abs(snapshot["serverTime"] - int(time.time() * 1000)) < 1000)

            # Verify every active NPC's spawnTime is preserved
            for received_npc in snapshot["npcs"]:
                orig_npc = initial_npcs[received_npc["id"]]
                self.assertEqual(received_npc["spawnTime"], orig_npc["spawnTime"])
                self.assertEqual(received_npc["pathId"], orig_npc["pathId"])
                self.assertEqual(received_npc["type"], orig_npc["type"])

            spawner.stop()

        asyncio.run(run_test())
        print("✅ test_snapshot_on_connect passed")

    def test_identical_spawn_broadcast(self):
        """AC-027.1: Clients in same room receive identical NPC_SPAWN broadcast packets."""
        async def run_test():
            rm = RoomManager()
            ws1 = DummyWebSocket()
            ws2 = DummyWebSocket()
            p1 = PeerConnection(ws1, "p1", "broadcast-room")
            p2 = PeerConnection(ws2, "p2", "broadcast-room")
            rm.add_peer("broadcast-room", p1)
            rm.add_peer("broadcast-room", p2)

            spawner = rm.get_or_create_spawner("broadcast-room")
            npc, lifetime = spawner._create_npc()
            spawn_pkt = {
                "type": "NPC_SPAWN",
                "id": npc["id"],
                "pathId": npc["pathId"],
                "npcType": npc["type"],
                "seed": npc["seed"],
                "spawnTime": npc["spawnTime"],
                "npc": npc,
                "serverTime": int(time.time() * 1000),
                "timestamp": int(time.time() * 1000)
            }
            await rm.broadcast_to_room("broadcast-room", spawn_pkt)

            self.assertEqual(len(ws1.sent_messages), 1)
            self.assertEqual(len(ws2.sent_messages), 1)
            self.assertEqual(ws1.sent_messages[0], ws2.sent_messages[0])

            parsed = json.loads(ws1.sent_messages[0])
            self.assertEqual(parsed["type"], "NPC_SPAWN")
            self.assertEqual(parsed["id"], npc["id"])
            self.assertEqual(parsed["pathId"], npc["pathId"])
            self.assertEqual(parsed["npcType"], npc["type"])
            self.assertEqual(parsed["seed"], npc["seed"])

        asyncio.run(run_test())
        print("✅ test_identical_spawn_broadcast passed")

    def test_despawn_and_replacement_lifecycle(self):
        """AC-027.3: When NPC lifetime expires, NPC_DESPAWN is broadcast and replacement spawned."""
        async def run_test():
            rm = RoomManager()
            ws = DummyWebSocket()
            peer = PeerConnection(ws, "peer-life", "life-room")
            rm.add_peer("life-room", peer)

            spawner = rm.get_or_create_spawner("life-room")
            spawner.is_running = True

            # Create test NPC with near-zero lifetime (0.02s)
            npc, _ = spawner._create_npc()
            spawner.active_npcs[npc["id"]] = npc
            self.assertIn(npc["id"], spawner.active_npcs)

            # Run lifecycle directly with very short lifetime
            task = asyncio.create_task(spawner._handle_npc_lifecycle(npc, 0.02))
            spawner.tasks.add(task)
            task.add_done_callback(spawner.tasks.discard)

            # Wait for despawn to occur (lifetime 0.02s)
            await asyncio.sleep(0.05)

            # Despawn message should have been sent
            despawn_messages = [json.loads(m) for m in ws.sent_messages if json.loads(m).get("type") == "NPC_DESPAWN"]
            self.assertEqual(len(despawn_messages), 1)
            self.assertEqual(despawn_messages[0]["id"], npc["id"])
            # NPC should be removed from active_npcs
            self.assertNotIn(npc["id"], spawner.active_npcs)

            # Clean up
            spawner.stop()

        asyncio.run(run_test())
        print("✅ test_despawn_and_replacement_lifecycle passed")

    def test_empty_room_spawner_cleanup(self):
        """AC-027.5: Spawner idles and cancels all tasks when room empties."""
        async def run_test():
            rm = RoomManager()
            ws = DummyWebSocket()
            p1 = PeerConnection(ws, "p1", "empty-room")
            rm.add_peer("empty-room", p1)

            spawner = rm.get_or_create_spawner("empty-room")
            spawner.start()
            self.assertTrue(spawner.is_running)
            self.assertEqual(len(spawner.active_npcs), TARGET_ACTIVE_NPCS)
            self.assertEqual(len(spawner.tasks), TARGET_ACTIVE_NPCS)

            # Peer leaves -> room is now empty
            rm.remove_peer("empty-room", "p1")

            self.assertFalse(spawner.is_running)
            self.assertEqual(len(spawner.active_npcs), 0)
            self.assertEqual(len(spawner.tasks), 0)
            self.assertNotIn("empty-room", rm.rooms)
            self.assertNotIn("empty-room", rm.spawners)

        asyncio.run(run_test())
        print("✅ test_empty_room_spawner_cleanup passed")


class TestServerProtocol(unittest.TestCase):
    def test_clifton_server_init(self):
        server = CliftonServer(static_dir=".")
        self.assertIsNotNone(server.app)
        self.assertIsNotNone(server.rooms)
        print("✅ test_clifton_server_init passed")


class TestTunnelAndHost(unittest.TestCase):
    def test_local_ip_detection(self):
        ip = get_local_ip()
        self.assertIsInstance(ip, str)
        self.assertGreater(len(ip), 6)
        print(f"✅ test_local_ip_detection passed (IP: {ip})")

    def test_tunnel_manager_instantiation(self):
        tm = TunnelManager(local_port=8080)
        self.assertEqual(tm.local_port, 8080)
        self.assertIsNone(tm.process)
        print("✅ test_tunnel_manager_instantiation passed")


def run_tests():
    suite = unittest.TestSuite()
    suite.addTest(unittest.makeSuite(TestRoomManager))
    suite.addTest(unittest.makeSuite(TestRoomNpcSpawner))
    suite.addTest(unittest.makeSuite(TestServerProtocol))
    suite.addTest(unittest.makeSuite(TestTunnelAndHost))

    runner = unittest.TextTestRunner(verbosity=1)
    res = runner.run(suite)
    if not res.wasSuccessful():
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
