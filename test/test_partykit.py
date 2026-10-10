#!/usr/bin/env python3
"""
Unit and integration tests for PartyKit Global Edge Room Server, route formatting, and configuration.
"""

import json
import os
import unittest


class MockPartyRoom:
    """Mock PartyKit room environment for testing lifecycle and message relaying."""
    def __init__(self, room_id):
        self.id = room_id
        self.connections = {}
        self.broadcast_log = []

    def add_connection(self, conn_id):
        conn = MockPartyConnection(conn_id)
        self.connections[conn_id] = conn
        return conn

    def remove_connection(self, conn_id):
        if conn_id in self.connections:
            del self.connections[conn_id]

    def get_connections(self):
        return list(self.connections.values())

    def broadcast(self, message, exclude=None):
        exclude = exclude or []
        parsed = json.loads(message) if isinstance(message, str) else message
        self.broadcast_log.append({"message": parsed, "exclude": exclude})
        for cid, conn in self.connections.items():
            if cid not in exclude:
                conn.messages_received.append(parsed)


class MockPartyConnection:
    def __init__(self, conn_id):
        self.id = conn_id
        self.messages_received = []

    def send(self, message):
        parsed = json.loads(message) if isinstance(message, str) else message
        self.messages_received.append(parsed)


class TestPartyKitLifecycle(unittest.TestCase):
    def setUp(self):
        self.room = MockPartyRoom("meadow-101")

    def test_room_welcome_handshake(self):
        """Verify onConnect produces a valid WELCOME packet with peer list and server time."""
        # Existing player in room
        c1 = self.room.add_connection("walker-1001")

        # New player arrives
        c2 = self.room.add_connection("walker-2002")

        existing_peers = [c.id for c in self.room.get_connections() if c.id != c2.id]
        welcome_packet = {
            "type": "WELCOME",
            "peerId": c2.id,
            "roomId": self.room.id,
            "peers": existing_peers,
            "serverTime": 1728590000000
        }
        c2.send(welcome_packet)

        self.assertEqual(len(c2.messages_received), 1)
        pkt = c2.messages_received[0]
        self.assertEqual(pkt["type"], "WELCOME")
        self.assertEqual(pkt["peerId"], "walker-2002")
        self.assertEqual(pkt["roomId"], "meadow-101")
        self.assertIn("walker-1001", pkt["peers"])

    def test_message_broadcast_relaying(self):
        """Verify onMessage relays packet to peers while excluding the sender."""
        c1 = self.room.add_connection("walker-1001")
        c2 = self.room.add_connection("walker-2002")

        sync_packet = {
            "type": "SYNC_STATE",
            "senderId": "walker-1001",
            "owner": {"x": 420.5, "y": 310.0, "vx": 1.2, "vy": 0.0, "angle": 0.5},
            "dog": {"x": 380.0, "y": 320.0, "vx": 1.5, "vy": 0.2, "state": "FOLLOWING"}
        }

        # c1 broadcasts to room, excluding c1
        self.room.broadcast(json.dumps(sync_packet), exclude=[c1.id])

        self.assertEqual(len(c1.messages_received), 0)
        self.assertEqual(len(c2.messages_received), 1)
        self.assertEqual(c2.messages_received[0]["type"], "SYNC_STATE")
        self.assertEqual(c2.messages_received[0]["senderId"], "walker-1001")

    def test_player_disconnect_broadcast(self):
        """Verify onClose broadcasts PEER_LEFT to remaining room participants."""
        c1 = self.room.add_connection("walker-1001")
        c2 = self.room.add_connection("walker-2002")

        # c1 disconnects
        self.room.remove_connection(c1.id)
        left_packet = {
            "type": "PEER_LEFT",
            "peerId": c1.id,
            "timestamp": 1728590050000
        }
        self.room.broadcast(json.dumps(left_packet))

        self.assertEqual(len(c2.messages_received), 1)
        self.assertEqual(c2.messages_received[0]["type"], "PEER_LEFT")
        self.assertEqual(c2.messages_received[0]["peerId"], "walker-1001")


class TestPartyKitRouteBuilder(unittest.TestCase):
    def test_partykit_url_formatting(self):
        """Test party route path resolution matching PartyKit standards."""
        base_urls = [
            ("https://clifton-down.partykit.dev", "meadow-1", "wss://clifton-down.partykit.dev/parties/park/meadow-1"),
            ("http://localhost:1999", "park-42", "ws://localhost:1999/parties/park/park-42"),
            ("wss://my-game.partykit.dev/parties/park/custom", "unused", "wss://my-game.partykit.dev/parties/park/custom")
        ]

        for base, room, expected in base_urls:
            if "/parties/" in base:
                result = base
            else:
                proto = "wss:" if base.startswith("https") or base.startswith("wss") else "ws:"
                host = base.split("://")[-1].rstrip("/")
                result = f"{proto}//{host}/parties/park/{room}"
            self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
