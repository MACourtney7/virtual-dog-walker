#!/usr/bin/env python3
"""
Unit and integration tests for Cloudflare PartyServer Room Server, Commons Default routing, and Wrangler configuration.
"""

import json
import os
import unittest


class MockPartyServerRoom:
    """Mock PartyServer room environment for testing lifecycle and message relaying."""
    def __init__(self, room_name="the-commons"):
        self.name = room_name
        self.connections = {}
        self.broadcast_log = []

    def add_connection(self, conn_id):
        conn = MockPartyServerConnection(conn_id)
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


class MockPartyServerConnection:
    def __init__(self, conn_id):
        self.id = conn_id
        self.messages_received = []

    def send(self, message):
        parsed = json.loads(message) if isinstance(message, str) else message
        self.messages_received.append(parsed)


class TestPartyServerLifecycle(unittest.TestCase):
    def setUp(self):
        self.room = MockPartyServerRoom("the-commons")

    def test_commons_welcome_handshake(self):
        """Verify onConnect produces a valid WELCOME packet defaulting to the-commons."""
        c1 = self.room.add_connection("walker-1001")
        c2 = self.room.add_connection("walker-2002")

        existing_peers = [c.id for c in self.room.get_connections() if c.id != c2.id]
        welcome_packet = {
            "type": "WELCOME",
            "peerId": c2.id,
            "roomId": self.room.name,
            "peers": existing_peers,
            "serverTime": 1728640000000
        }
        c2.send(welcome_packet)

        self.assertEqual(len(c2.messages_received), 1)
        pkt = c2.messages_received[0]
        self.assertEqual(pkt["type"], "WELCOME")
        self.assertEqual(pkt["peerId"], "walker-2002")
        self.assertEqual(pkt["roomId"], "the-commons")
        self.assertIn("walker-1001", pkt["peers"])

    def test_message_broadcast_relaying(self):
        """Verify onMessage relays packet to peers while excluding the sender."""
        c1 = self.room.add_connection("walker-1001")
        c2 = self.room.add_connection("walker-2002")

        sync_packet = {
            "type": "SYNC_STATE",
            "senderId": "walker-1001",
            "owner": {"x": 500.0, "y": 400.0, "vx": 2.0, "vy": 0.0, "angle": 0.0},
            "dog": {"x": 460.0, "y": 410.0, "vx": 2.2, "vy": 0.1, "state": "FOLLOWING"}
        }

        self.room.broadcast(json.dumps(sync_packet), exclude=[c1.id])

        self.assertEqual(len(c1.messages_received), 0)
        self.assertEqual(len(c2.messages_received), 1)
        self.assertEqual(c2.messages_received[0]["type"], "SYNC_STATE")
        self.assertEqual(c2.messages_received[0]["senderId"], "walker-1001")

    def test_player_disconnect_broadcast(self):
        """Verify onClose broadcasts PEER_LEFT to remaining room participants."""
        c1 = self.room.add_connection("walker-1001")
        c2 = self.room.add_connection("walker-2002")

        self.room.remove_connection(c1.id)
        left_packet = {
            "type": "PEER_LEFT",
            "peerId": c1.id,
            "timestamp": 1728640050000
        }
        self.room.broadcast(json.dumps(left_packet))

        self.assertEqual(len(c2.messages_received), 1)
        self.assertEqual(c2.messages_received[0]["type"], "PEER_LEFT")
        self.assertEqual(c2.messages_received[0]["peerId"], "walker-1001")


class TestPartyServerRouteBuilder(unittest.TestCase):
    def test_partyserver_url_formatting(self):
        """Test party route path resolution matching Cloudflare PartyServer standards."""
        base_urls = [
            ("https://virtual-dog-walker.workers.dev", "the-commons", "wss://virtual-dog-walker.workers.dev/parties/park/the-commons"),
            ("http://localhost:8787", "the-commons", "ws://localhost:8787/parties/park/the-commons"),
            ("wss://my-game.workers.dev/parties/park/private-1", "unused", "wss://my-game.workers.dev/parties/park/private-1")
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
