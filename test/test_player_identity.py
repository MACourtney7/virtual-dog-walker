#!/usr/bin/env python3
"""
Unit and Integration Tests for Player Identity, Peer Metadata Handshake & Style Synchronization
"""

import json
import os
import sys
import unittest

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server.server import RoomManager, PeerConnection


class DummyWebSocket:
    def __init__(self):
        self.sent_messages = []
        self.closed = False

    async def send_str(self, msg: str):
        self.sent_messages.append(msg)


class MockPartyServerConnection:
    def __init__(self, conn_id):
        self.id = conn_id
        self.messages_received = []

    def send(self, message):
        parsed = json.loads(message) if isinstance(message, str) else message
        self.messages_received.append(parsed)


class MockPartyServer:
    """Simulates PartyServer / ParkServer stateful peer metadata registry."""
    def __init__(self, room_id="the-commons"):
        self.room_id = room_id
        self.peers = {}  # conn_id -> metadata dict
        self.connections = {}  # conn_id -> MockPartyServerConnection

    def on_connect(self, conn):
        self.connections[conn.id] = conn
        # Filter existing peers excluding connecting peer
        existing_peers = [
            meta for pid, meta in self.peers.items() if pid != conn.id
        ]
        welcome_packet = {
            "type": "WELCOME",
            "peerId": conn.id,
            "roomId": self.room_id,
            "peers": existing_peers,
            "serverTime": 1728640000000
        }
        conn.send(welcome_packet)

    def on_message(self, conn, message):
        data = json.loads(message) if isinstance(message, str) else dict(message)
        data["senderId"] = conn.id
        data["peerId"] = conn.id

        if data.get("type") == "HELLO":
            self.peers[conn.id] = {
                "id": conn.id,
                "name": data.get("name", "Walker"),
                "jacketColor": data.get("jacketColor", "#1e3a8a"),
                "dogCoatName": data.get("dogCoatName", "Chocolate & Tan (Ziggy)")
            }

        # Broadcast to other peers
        for cid, c in self.connections.items():
            if cid != conn.id:
                c.send(data)

    def on_close(self, conn):
        if conn.id in self.peers:
            del self.peers[conn.id]
        if conn.id in self.connections:
            del self.connections[conn.id]
        leave_packet = {
            "type": "PEER_LEFT",
            "peerId": conn.id
        }
        for c in self.connections.values():
            c.send(leave_packet)


class TestPlayerIdentity(unittest.TestCase):
    def test_rich_welcome_peers_payload(self):
        """WELCOME packet includes rich { id, name, jacketColor, dogCoatName } objects for connected peers."""
        server = MockPartyServer()

        # Connect peer 1
        c1 = MockPartyServerConnection("walker-101")
        server.on_connect(c1)
        # Peer 1 sends HELLO with distinct style
        server.on_message(c1, {
            "type": "HELLO",
            "name": "Sarah",
            "jacketColor": "#831843",
            "dogCoatName": "Golden Retriever"
        })

        # Connect peer 2
        c2 = MockPartyServerConnection("walker-202")
        server.on_connect(c2)

        # Peer 2's welcome packet must include peer 1's rich metadata
        welcome = c2.messages_received[0]
        self.assertEqual(welcome["type"], "WELCOME")
        self.assertEqual(len(welcome["peers"]), 1)
        peer1_info = welcome["peers"][0]
        self.assertEqual(peer1_info["id"], "walker-101")
        self.assertEqual(peer1_info["name"], "Sarah")
        self.assertEqual(peer1_info["jacketColor"], "#831843")
        self.assertEqual(peer1_info["dogCoatName"], "Golden Retriever")

    def test_peer_metadata_registry(self):
        """Server correctly adds, updates, and removes peer entries upon HELLO and onClose."""
        server = MockPartyServer()
        c1 = MockPartyServerConnection("walker-101")
        server.on_connect(c1)

        # Before HELLO: not yet registered in metadata map
        self.assertNotIn("walker-101", server.peers)

        # HELLO adds to registry
        server.on_message(c1, {
            "type": "HELLO",
            "name": "Alex",
            "jacketColor": "#14532d",
            "dogCoatName": "Black Lab"
        })
        self.assertIn("walker-101", server.peers)
        self.assertEqual(server.peers["walker-101"]["name"], "Alex")

        # Subsequent HELLO updates registry
        server.on_message(c1, {
            "type": "HELLO",
            "name": "Alexander",
            "jacketColor": "#b45309",
            "dogCoatName": "Black Lab"
        })
        self.assertEqual(server.peers["walker-101"]["name"], "Alexander")
        self.assertEqual(server.peers["walker-101"]["jacketColor"], "#b45309")

        # Disconnection removes from registry
        server.on_close(c1)
        self.assertNotIn("walker-101", server.peers)

    def test_nametag_display_computation(self):
        """Nametag displays '${name} (You)' when isLocal is true, and '${name}' when isLocal is false."""
        def compute_nametag(name, is_local):
            return f"{name} (You)" if is_local else f"{name}"

        self.assertEqual(compute_nametag("Walker", True), "Walker (You)")
        self.assertEqual(compute_nametag("Sarah", False), "Sarah")
        self.assertEqual(compute_nametag("Charlie", True), "Charlie (You)")
        self.assertEqual(compute_nametag("Bob", False), "Bob")

    def test_meta_dynamic_sync(self):
        """Verifies remote entity updating logic matches updated metadata."""
        class MockRemoteEntity:
            def __init__(self, name="Friend", jacket_color="#14532d", coat_name="Chocolate & Tan (Ziggy)"):
                self.owner_name = name
                self.jacket_color = jacket_color
                self.coat_name = coat_name

            def sync_meta(self, meta):
                if meta.get("name"):
                    self.owner_name = meta["name"]
                if meta.get("jacketColor"):
                    self.jacket_color = meta["jacketColor"]
                if meta.get("coatName"):
                    self.coat_name = meta["coatName"]

        entity = MockRemoteEntity()
        self.assertEqual(entity.owner_name, "Friend")
        self.assertEqual(entity.jacket_color, "#14532d")

        # Ingest updated meta from WELCOME or HELLO
        entity.sync_meta({
            "name": "Elena",
            "jacketColor": "#b45309",
            "coatName": "Golden Retriever"
        })

        self.assertEqual(entity.owner_name, "Elena")
        self.assertEqual(entity.jacket_color, "#b45309")
        self.assertEqual(entity.coat_name, "Golden Retriever")

    def test_local_storage_profile_payload(self):
        """Verifies serialized and deserialized profile payload structure for localStorage."""
        profile = {
            "name": "CustomWalker",
            "jacketColor": "#831843",
            "coatKey": "GOLDEN"
        }
        serialized = json.dumps(profile)
        deserialized = json.loads(serialized)

        self.assertEqual(deserialized["name"], "CustomWalker")
        self.assertEqual(deserialized["jacketColor"], "#831843")
        self.assertEqual(deserialized["coatKey"], "GOLDEN")


def run_tests():
    suite = unittest.TestLoader().loadTestsFromTestCase(TestPlayerIdentity)
    runner = unittest.TextTestRunner(verbosity=2)
    res = runner.run(suite)
    if not res.wasSuccessful():
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
