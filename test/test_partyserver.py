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


    def on_message(self, conn, message):
        """Simulate ParkServer.onMessage with authoritative senderId stamping."""
        parsed = json.loads(message) if isinstance(message, str) else dict(message)
        parsed["senderId"] = conn.id
        parsed["peerId"] = conn.id
        self.broadcast(json.dumps(parsed), exclude=[conn.id])
        return parsed


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

    def test_authoritative_sender_stamping(self):
        """Verify that when a client sends a message, relayed payload stamps senderId to conn.id."""
        c1 = self.room.add_connection("conn-authoritative-777")
        c2 = self.room.add_connection("conn-peer-888")

        client_spoofed_packet = {
            "type": "SYNC_STATE",
            "senderId": "unverified-temp-id",
            "owner": {"x": 100.0, "y": 200.0}
        }

        relayed = self.room.on_message(c1, client_spoofed_packet)
        self.assertEqual(relayed["senderId"], "conn-authoritative-777")
        self.assertEqual(relayed["peerId"], "conn-authoritative-777")

        self.assertEqual(len(c1.messages_received), 0)
        self.assertEqual(len(c2.messages_received), 1)
        received = c2.messages_received[0]
        self.assertEqual(received["senderId"], "conn-authoritative-777")
        self.assertEqual(received["peerId"], "conn-authoritative-777")

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
    def _build_url(self, base, room):
        if not base or base in ("partykit", "party"):
            base = "wss://play.virtual-dog-walker.workers.dev"
        clean = base.strip()
        if clean.startswith("http://"):
            clean = "ws://" + clean[7:]
        elif clean.startswith("https://"):
            clean = "wss://" + clean[8:]
        elif not clean.startswith("ws://") and not clean.startswith("wss://"):
            clean = f"wss://{clean}"

        if "/parties/" in clean:
            return clean

        clean = clean.rstrip("/")
        return f"{clean}/parties/parkserver/{room}"

    def test_canonical_route_resolution_default(self):
        """Test building PartyServer URLs formats to wss://<host>/parties/parkserver/<room> by default."""
        cases = [
            ("https://virtual-dog-walker.workers.dev", "the-commons", "wss://virtual-dog-walker.workers.dev/parties/parkserver/the-commons"),
            ("http://localhost:8787", "the-commons", "ws://localhost:8787/parties/parkserver/the-commons"),
            ("play.virtual-dog-walker.workers.dev", "meadow-99", "wss://play.virtual-dog-walker.workers.dev/parties/parkserver/meadow-99"),
        ]
        for base, room, expected in cases:
            res = self._build_url(base, room)
            self.assertEqual(res, expected)

    def test_alias_route_preservation(self):
        """Verify that existing /parties/park/<room> paths are preserved if explicitly passed."""
        alias_urls = [
            ("wss://my-game.workers.dev/parties/park/private-1", "unused", "wss://my-game.workers.dev/parties/park/private-1"),
            ("https://virtual-dog-walker.workers.dev/parties/park/the-commons", "the-commons", "wss://virtual-dog-walker.workers.dev/parties/park/the-commons"),
            ("ws://localhost:8787/parties/park/dev-room", "dev-room", "ws://localhost:8787/parties/park/dev-room")
        ]
        for base, room, expected in alias_urls:
            res = self._build_url(base, room)
            self.assertEqual(res, expected)


class MockWebSocketNetworkManager:
    """Mock client network manager to test handshake registration and post-WELCOME hello dispatch."""
    def __init__(self, initial_peer_id="temp-walker-1"):
        self.peerId = initial_peer_id
        self.roomId = "the-commons"
        self.remotePeers = {}
        self.outgoing_broadcasts = []
        self.localMeta = {
            "name": "Park Walker",
            "jacketColor": "#1e3a8a",
            "coatName": "Chocolate & Tan (Ziggy)"
        }

    def broadcast(self, packet):
        self.outgoing_broadcasts.append(packet)

    def ensureRemotePeer(self, peer_id, meta=None):
        if peer_id not in self.remotePeers:
            self.remotePeers[peer_id] = meta or {}
        return self.remotePeers[peer_id]

    def handlePacket(self, packet):
        if not packet or not packet.get("type"):
            return

        pkt_type = packet.get("type")
        if pkt_type == "WELCOME":
            if packet.get("peerId"):
                self.peerId = packet["peerId"]

            # Re-broadcast HELLO packet with newly assigned peerId
            self.broadcast({
                "type": "HELLO",
                "senderId": self.peerId,
                "name": self.localMeta["name"],
                "jacketColor": self.localMeta["jacketColor"],
                "dogCoatName": self.localMeta["coatName"]
            })

            # Populate existing peers
            peers = packet.get("peers", [])
            for p in peers:
                pid = p if isinstance(p, str) else p.get("id")
                meta = p if isinstance(p, dict) else {}
                if pid and pid != self.peerId:
                    self.ensureRemotePeer(pid, meta)


class TestPartyServerHandshakeAndHUD(unittest.TestCase):
    def test_welcome_packet_peer_id_registration(self):
        """Verify that receiving a WELCOME packet triggers authoritative peer ID registration and HELLO re-dispatch."""
        net = MockWebSocketNetworkManager("temp-walker-random")
        self.assertEqual(net.peerId, "temp-walker-random")

        welcome_packet = {
            "type": "WELCOME",
            "peerId": "authoritative-cf-worker-conn-42",
            "roomId": "the-commons",
            "peers": ["peer-existing-1", "peer-existing-2"],
            "serverTime": 1728640000000
        }

        net.handlePacket(welcome_packet)

        # Peer ID should now be updated to authoritative server ID
        self.assertEqual(net.peerId, "authoritative-cf-worker-conn-42")

        # Existing peers registered
        self.assertIn("peer-existing-1", net.remotePeers)
        self.assertIn("peer-existing-2", net.remotePeers)

        # Handshake alignment: verify HELLO was dispatched with authoritative ID
        self.assertEqual(len(net.outgoing_broadcasts), 1)
        hello_pkt = net.outgoing_broadcasts[0]
        self.assertEqual(hello_pkt["type"], "HELLO")
        self.assertEqual(hello_pkt["senderId"], "authoritative-cf-worker-conn-42")
        self.assertEqual(hello_pkt["name"], "Park Walker")

    def test_hud_state_diagnostics_mapping(self):
        """Verify HUD badge text and color mapping across connection states."""
        def get_hud_badge(status, room_id):
            if status == "CONNECTED":
                if not room_id or room_id in ("the-commons", "clifton-field"):
                    return ("🌳 Clifton Commons", "#059669")
                else:
                    return (f"🔒 Meadow ({room_id})", "#8b5cf6")
            elif status == "CONNECTING":
                return ("⏳ Connecting...", "#d97706")
            elif status == "RECONNECTING":
                return ("🔄 Reconnecting...", "#d97706")
            else:
                return ("Solo (Offline)", "#64748b")

        # Connected to commons
        text, bg = get_hud_badge("CONNECTED", "the-commons")
        self.assertEqual(text, "🌳 Clifton Commons")
        self.assertEqual(bg, "#059669")

        # Connected to private meadow
        text, bg = get_hud_badge("CONNECTED", "private-room-99")
        self.assertEqual(text, "🔒 Meadow (private-room-99)")
        self.assertEqual(bg, "#8b5cf6")

        # Connecting
        text, bg = get_hud_badge("CONNECTING", "the-commons")
        self.assertEqual(text, "⏳ Connecting...")
        self.assertEqual(bg, "#d97706")

        # Reconnecting
        text, bg = get_hud_badge("RECONNECTING", "the-commons")
        self.assertEqual(text, "🔄 Reconnecting...")
        self.assertEqual(bg, "#d97706")

        # Offline / Error
        for s in ["OFFLINE", "ERROR"]:
            text, bg = get_hud_badge(s, "the-commons")
            self.assertEqual(text, "Solo (Offline)")
            self.assertEqual(bg, "#64748b")


if __name__ == "__main__":
    unittest.main()
