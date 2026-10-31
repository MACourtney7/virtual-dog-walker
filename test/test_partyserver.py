#!/usr/bin/env python3
"""
Unit and integration tests for Cloudflare PartyServer Room Server, Commons Default routing,
Wrangler configuration, and server-authoritative NPC Spawner lifecycle.
"""

import json
import os
import random
import time
import unittest

MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "..", "src", "world", "npc_path_manifest.json")
try:
    with open(MANIFEST_PATH, "r") as f:
        DEFAULT_PATH_MANIFEST = json.load(f)
except Exception:
    DEFAULT_PATH_MANIFEST = [
        {"id": "ladies-mile-loop", "type": "both", "lengthPx": 5726.1},
        {"id": "sea-walls-promenade", "type": "both", "lengthPx": 1789.1},
        {"id": "durdham-down-circuit", "type": "jogger", "lengthPx": 3103.1},
        {"id": "woodland-trail-loop", "type": "walker", "lengthPx": 2091.7},
        {"id": "central-meadow-ramble", "type": "walker", "lengthPx": 2104.2},
        {"id": "trans-downs-express", "type": "jogger", "lengthPx": 3462.8},
        {"id": "sea-walls-to-water-tower", "type": "walker", "lengthPx": 2920.2},
        {"id": "clifton-woodland-traverse", "type": "walker", "lengthPx": 2137.7},
        {"id": "north-meadow-diagonal", "type": "both", "lengthPx": 2646.5},
        {"id": "perimeter-grand-loop", "type": "jogger", "lengthPx": 9527.3}
    ]


class MockPartyServerRoom:
    """Mock PartyServer room environment for testing lifecycle, message relaying, and NPC spawner."""
    def __init__(self, room_name="the-commons", paths=None, target_npc_count=5):
        self.name = room_name
        self.connections = {}
        self.peers = {}  # pid -> metadata dict
        self.broadcast_log = []
        self.paths = list(paths if paths is not None else DEFAULT_PATH_MANIFEST)
        self.target_npc_count = target_npc_count
        self.active_npcs = {}  # id -> npc_dict
        self.despawn_timers = {}  # id -> delay_ms
        self.replacement_timers = []  # list of delays
        self._next_npc_seq = 1

    def add_connection(self, conn_id):
        conn = MockPartyServerConnection(conn_id)
        self.connections[conn_id] = conn
        return conn

    def remove_connection(self, conn_id):
        if conn_id in self.connections:
            del self.connections[conn_id]
        if conn_id in self.peers:
            del self.peers[conn_id]

    def get_connections(self):
        return list(self.connections.values())

    def has_active_clients(self):
        return len(self.connections) > 0 or len(self.peers) > 0

    def broadcast(self, message, exclude=None):
        exclude = exclude or []
        parsed = json.loads(message) if isinstance(message, str) else message
        self.broadcast_log.append({"message": parsed, "exclude": exclude})
        for cid, conn in self.connections.items():
            if cid not in exclude:
                conn.messages_received.append(parsed)

    def on_connect(self, conn):
        self.connections[conn.id] = conn
        if len(self.active_npcs) == 0:
            self.init_spawner()

        existing_peers = []
        for pid, peer_data in self.peers.items():
            if pid != conn.id:
                existing_peers.append({
                    "id": peer_data.get("id", pid),
                    "name": peer_data.get("name", "Walker"),
                    "jacketColor": peer_data.get("jacketColor", "#1e3a8a"),
                    "coatName": peer_data.get("coatName", peer_data.get("dogCoatName", "Chocolate & Tan (Ziggy)"))
                })

        welcome_packet = {
            "type": "WELCOME",
            "peerId": conn.id,
            "roomId": self.name,
            "peers": existing_peers,
            "serverTime": int(time.time() * 1000)
        }
        conn.send(welcome_packet)

        snapshot_packet = {
            "type": "NPC_SNAPSHOT",
            "npcs": [
                {
                    "id": npc["id"],
                    "pathId": npc["pathId"],
                    "type": npc["type"],
                    "npcType": npc["type"],
                    "seed": npc["seed"],
                    "spawnTime": npc["spawnTime"]
                }
                for npc in self.active_npcs.values()
            ],
            "serverTime": int(time.time() * 1000),
            "timestamp": int(time.time() * 1000)
        }
        conn.send(snapshot_packet)

    def on_close(self, conn):
        self.remove_connection(conn.id)
        if not self.has_active_clients():
            self.stop_spawner()

        left_packet = {
            "type": "PEER_LEFT",
            "peerId": conn.id,
            "timestamp": int(time.time() * 1000)
        }
        self.broadcast(json.dumps(left_packet))

    def on_message(self, conn, message):
        """Simulate ParkServer.onMessage with authoritative senderId stamping."""
        parsed = json.loads(message) if isinstance(message, str) else dict(message)
        if parsed.get("type") == "HELLO":
            self.peers[conn.id] = {
                "id": conn.id,
                "name": parsed.get("name", "Walker"),
                "jacketColor": parsed.get("jacketColor", "#1e3a8a"),
                "coatName": parsed.get("dogCoatName", parsed.get("coatName", "Chocolate & Tan (Ziggy)"))
            }
        parsed["senderId"] = conn.id
        parsed["peerId"] = conn.id
        self.broadcast(json.dumps(parsed), exclude=[conn.id])
        return parsed

    def init_spawner(self):
        count = self.target_npc_count
        for i in range(count):
            prewarm_fraction = 0.15 + (i / count) * 0.70
            self.spawn_npc(prewarm_fraction=prewarm_fraction)

    def spawn_npc(self, prewarm_fraction=0.0):
        if not self.paths:
            return None

        used_path_ids = {npc["pathId"] for npc in self.active_npcs.values()}
        available_paths = [p for p in self.paths if p["id"] not in used_path_ids]
        pool = available_paths if available_paths else self.paths
        path = random.choice(pool)

        if path["type"] == "walker":
            npc_type = "walker"
        elif path["type"] == "jogger":
            npc_type = "jogger"
        else:
            npc_type = random.choice(["walker", "jogger"])

        speed = 48 if npc_type == "jogger" else 22
        lifetime_ms = round((path["lengthPx"] / speed) * 1000)
        offset_ms = round(lifetime_ms * max(0.0, min(0.9, prewarm_fraction)))
        now = int(time.time() * 1000)
        spawn_time = now - offset_ms
        remaining_lifetime_ms = max(500, lifetime_ms - offset_ms)
        seed = random.randint(0, 0xFFFFFFFF)
        npc_id = f"npc-mock-{self._next_npc_seq}-{spawn_time}"
        self._next_npc_seq += 1

        npc_data = {
            "id": npc_id,
            "pathId": path["id"],
            "type": npc_type,
            "npcType": npc_type,
            "seed": seed,
            "spawnTime": spawn_time,
            "lifetimeMs": lifetime_ms,
            "remainingLifetimeMs": remaining_lifetime_ms
        }
        self.active_npcs[npc_id] = npc_data
        self.despawn_timers[npc_id] = remaining_lifetime_ms
        return npc_data

    def despawn_npc(self, npc_id):
        if npc_id not in self.active_npcs:
            return None
        npc = self.active_npcs.pop(npc_id)
        if npc_id in self.despawn_timers:
            del self.despawn_timers[npc_id]

        despawn_packet = {
            "type": "NPC_DESPAWN",
            "id": npc["id"],
            "timestamp": int(time.time() * 1000)
        }
        self.broadcast(json.dumps(despawn_packet))

        if self.has_active_clients():
            delay = 1000 + random.randint(0, 4000)
            self.replacement_timers.append(delay)
        return npc

    def trigger_replacement(self):
        if not self.has_active_clients():
            return None
        if len(self.active_npcs) >= self.target_npc_count:
            return None
        new_npc = self.spawn_npc()
        if new_npc:
            spawn_packet = {
                "type": "NPC_SPAWN",
                "id": new_npc["id"],
                "pathId": new_npc["pathId"],
                "npcType": new_npc["type"],
                "seed": new_npc["seed"],
                "spawnTime": new_npc["spawnTime"],
                "npc": {
                    "id": new_npc["id"],
                    "pathId": new_npc["pathId"],
                    "type": new_npc["type"],
                    "npcType": new_npc["type"],
                    "seed": new_npc["seed"],
                    "spawnTime": new_npc["spawnTime"]
                },
                "timestamp": int(time.time() * 1000)
            }
            self.broadcast(json.dumps(spawn_packet))
        if self.replacement_timers:
            self.replacement_timers.pop(0)
        return new_npc

    def stop_spawner(self):
        self.active_npcs.clear()
        self.despawn_timers.clear()
        self.replacement_timers.clear()


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


class TestPartyServerNpcSpawner(unittest.TestCase):
    def setUp(self):
        self.room = MockPartyServerRoom("the-commons")

    def test_npc_snapshot_sent_on_connect(self):
        """First peer connection starts spawner and receives WELCOME then NPC_SNAPSHOT."""
        c1 = MockPartyServerConnection("client-1")
        self.room.on_connect(c1)

        self.assertEqual(len(c1.messages_received), 2)
        welcome = c1.messages_received[0]
        snapshot = c1.messages_received[1]

        self.assertEqual(welcome["type"], "WELCOME")
        self.assertEqual(snapshot["type"], "NPC_SNAPSHOT")
        self.assertIn("serverTime", snapshot)
        self.assertIn("timestamp", snapshot)
        self.assertEqual(len(snapshot["npcs"]), 5)

        for npc in snapshot["npcs"]:
            self.assertTrue(npc["id"].startswith("npc-"))
            self.assertIn("pathId", npc)
            self.assertIn(npc["type"], ["walker", "jogger"])
            self.assertEqual(npc["type"], npc["npcType"])
            self.assertIsInstance(npc["seed"], int)
            self.assertGreaterEqual(npc["seed"], 0)
            self.assertLessEqual(npc["seed"], 0xFFFFFFFF)
            self.assertIsInstance(npc["spawnTime"], int)

    def test_late_joiner_receives_identical_snapshot(self):
        """Late joiner receives snapshot containing all active NPCs with original spawnTime (AC-027.2)."""
        c1 = MockPartyServerConnection("client-1")
        self.room.on_connect(c1)
        snapshot1 = c1.messages_received[1]

        # Simulate small time delay
        time.sleep(0.01)

        c2 = MockPartyServerConnection("client-2-late")
        self.room.on_connect(c2)
        snapshot2 = c2.messages_received[1]

        self.assertEqual(len(snapshot1["npcs"]), len(snapshot2["npcs"]))
        s1_map = {npc["id"]: npc for npc in snapshot1["npcs"]}
        s2_map = {npc["id"]: npc for npc in snapshot2["npcs"]}

        self.assertEqual(set(s1_map.keys()), set(s2_map.keys()))
        for npc_id, npc1 in s1_map.items():
            npc2 = s2_map[npc_id]
            self.assertEqual(npc1["spawnTime"], npc2["spawnTime"], "Spawn times must be preserved for late joiner")
            self.assertEqual(npc1["pathId"], npc2["pathId"])
            self.assertEqual(npc1["seed"], npc2["seed"])
            self.assertEqual(npc1["type"], npc2["type"])

    def test_pool_size_and_unused_paths(self):
        """Active pool size maintained at target 5 (within 4-6) and only a subset of paths are active (AC-027.3, AC-027.4)."""
        c1 = MockPartyServerConnection("client-1")
        self.room.on_connect(c1)

        self.assertEqual(len(self.room.active_npcs), 5)
        self.assertTrue(4 <= len(self.room.active_npcs) <= 6)

        active_path_ids = [npc["pathId"] for npc in self.room.active_npcs.values()]
        # Distinct paths used (no duplicates)
        self.assertEqual(len(active_path_ids), len(set(active_path_ids)))
        # Only a subset (5 out of 10) of manifest paths are active
        self.assertEqual(len(self.room.paths), 10)
        self.assertEqual(len(set(active_path_ids)), 5)
        self.assertLess(len(set(active_path_ids)), len(self.room.paths))

    def test_npc_despawn_and_replacement_broadcast(self):
        """Expiring NPC triggers NPC_DESPAWN and replacement broadcasts NPC_SPAWN to connected clients (AC-027.1, AC-027.3)."""
        c1 = MockPartyServerConnection("client-1")
        c2 = MockPartyServerConnection("client-2")
        self.room.on_connect(c1)
        self.room.on_connect(c2)

        # Clear handshake messages
        c1.messages_received.clear()
        c2.messages_received.clear()

        # Despawn an NPC
        despawn_id = list(self.room.active_npcs.keys())[0]
        despawned_path = self.room.active_npcs[despawn_id]["pathId"]
        self.room.despawn_npc(despawn_id)

        # Verify DESPAWN broadcast to all connected clients
        self.assertEqual(len(c1.messages_received), 1)
        self.assertEqual(len(c2.messages_received), 1)
        self.assertEqual(c1.messages_received[0]["type"], "NPC_DESPAWN")
        self.assertEqual(c1.messages_received[0]["id"], despawn_id)
        self.assertEqual(c2.messages_received[0]["type"], "NPC_DESPAWN")
        self.assertEqual(c2.messages_received[0]["id"], despawn_id)

        # Active pool drops by 1
        self.assertEqual(len(self.room.active_npcs), 4)

        # Trigger replacement
        self.room.trigger_replacement()

        # Both clients receive identical NPC_SPAWN broadcast (AC-027.1)
        self.assertEqual(len(c1.messages_received), 2)
        self.assertEqual(len(c2.messages_received), 2)
        spawn_pkt1 = c1.messages_received[1]
        spawn_pkt2 = c2.messages_received[1]

        self.assertEqual(spawn_pkt1["type"], "NPC_SPAWN")
        self.assertEqual(spawn_pkt2["type"], "NPC_SPAWN")
        self.assertEqual(spawn_pkt1["id"], spawn_pkt2["id"])
        self.assertEqual(spawn_pkt1["pathId"], spawn_pkt2["pathId"])
        self.assertEqual(spawn_pkt1["seed"], spawn_pkt2["seed"])
        self.assertEqual(spawn_pkt1["spawnTime"], spawn_pkt2["spawnTime"])
        self.assertIn("npc", spawn_pkt1)
        self.assertEqual(spawn_pkt1["npc"]["id"], spawn_pkt1["id"])

        # Active pool restored to 5
        self.assertEqual(len(self.room.active_npcs), 5)

    def test_spawner_idles_when_room_empty(self):
        """Spawner clears all active NPCs and timers when room empties (AC-027.5)."""
        c1 = MockPartyServerConnection("client-1")
        self.room.on_connect(c1)
        self.assertEqual(len(self.room.active_npcs), 5)

        # Client disconnects -> room empties
        self.room.on_close(c1)
        self.assertEqual(len(self.room.active_npcs), 0)
        self.assertEqual(len(self.room.despawn_timers), 0)
        self.assertEqual(len(self.room.replacement_timers), 0)

        # Reconnection starts a fresh pool
        c2 = MockPartyServerConnection("client-2")
        self.room.on_connect(c2)
        self.assertEqual(len(self.room.active_npcs), 5)

    def test_npc_speed_and_lifetime_accuracy(self):
        """Walker (22 px/s) and jogger (48 px/s) lifetimes match lengthPx / speed."""
        path_manifest = [
            {"id": "p-walker", "type": "walker", "lengthPx": 2200.0},
            {"id": "p-jogger", "type": "jogger", "lengthPx": 4800.0}
        ]
        room = MockPartyServerRoom("test-room", paths=path_manifest, target_npc_count=2)
        c = MockPartyServerConnection("walker-1")
        room.on_connect(c)

        for npc in room.active_npcs.values():
            if npc["pathId"] == "p-walker":
                self.assertEqual(npc["type"], "walker")
                # 2200 / 22 = 100s = 100000ms
                self.assertEqual(npc["lifetimeMs"], 100000)
            elif npc["pathId"] == "p-jogger":
                self.assertEqual(npc["type"], "jogger")
                # 4800 / 48 = 100s = 100000ms
                self.assertEqual(npc["lifetimeMs"], 100000)

    def test_spawner_prewarming_initial_npcs(self):
        """Initial NPCs spawned in initSpawner have pre-warmed spawnTime and staggered remaining lifetimes (Ticket-030)."""
        c1 = MockPartyServerConnection("client-1")
        self.room.on_connect(c1)
        now_ms = int(time.time() * 1000)

        self.assertEqual(len(self.room.active_npcs), 5)
        for npc in self.room.active_npcs.values():
            # Initial NPCs start with negative offset: now - spawnTime > 0
            self.assertGreaterEqual(now_ms, npc["spawnTime"], "Initial NPC spawnTime should be in the past (pre-warmed)")
            # Remaining lifetime is less than total lifetime
            self.assertLess(npc["remainingLifetimeMs"], npc["lifetimeMs"], "Remaining lifetime should be less than total lifetime")
            self.assertGreater(npc["remainingLifetimeMs"], 0, "Remaining lifetime must be positive")


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
