#!/usr/bin/env python3
"""
Unit and Integration Tests for Clifton Down Dedicated Microserver & Tunnel Engine
"""

import asyncio
import json
import os
import sys
import unittest

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server.server import CliftonServer, RoomManager, PeerConnection
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
    suite.addTest(unittest.makeSuite(TestServerProtocol))
    suite.addTest(unittest.makeSuite(TestTunnelAndHost))

    runner = unittest.TextTestRunner(verbosity=1)
    res = runner.run(suite)
    if not res.wasSuccessful():
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
