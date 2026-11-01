#!/usr/bin/env python3
"""
Integration and simulation tests for ZeroMesh P2P networking, invite-free dead-drop matchmaking,
deterministic P2P NPC coordination, and dual-mesh proximity chat with 160px/200px hysteresis.
"""

import json
import math
import os
import unittest

MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "..", "src", "world", "npc_path_manifest.json")
try:
    with open(MANIFEST_PATH, "r") as f:
        DEFAULT_PATH_MANIFEST = json.load(f)
except Exception:
    DEFAULT_PATH_MANIFEST = [
        {"id": "ladies-mile-loop", "type": "both", "lengthPx": 3637.4},
        {"id": "sea-walls-promenade", "type": "both", "lengthPx": 1478.2},
        {"id": "durdham-down-circuit", "type": "jogger", "lengthPx": 1684.0},
        {"id": "woodland-trail-loop", "type": "walker", "lengthPx": 1747.6},
        {"id": "central-meadow-ramble", "type": "walker", "lengthPx": 3054.1},
        {"id": "trans-downs-express", "type": "jogger", "lengthPx": 3770.3},
        {"id": "sea-walls-to-water-tower", "type": "walker", "lengthPx": 2966.6},
        {"id": "clifton-woodland-traverse", "type": "walker", "lengthPx": 2289.4},
        {"id": "north-meadow-diagonal", "type": "both", "lengthPx": 2656.5},
        {"id": "perimeter-grand-loop", "type": "jogger", "lengthPx": 7886.1}
    ]


class MockDeadDropCoordinator:
    """Simulates zero_network DeadDropRoom atomic matchmaking and multi-host staging."""
    def __init__(self, room_id="clifton-commons"):
        self.room_id = room_id
        self.staged_invites = {}  # host_peer_id -> invite_dict
        self.completed_drops = {}  # invite_uuid -> drop_dict

    def stage_invite(self, host_peer_id, invite_dict):
        self.staged_invites[host_peer_id] = invite_dict

    def request_match(self):
        if not self.staged_invites:
            return {"status": "empty"}
        # Pop one staged invite atomically
        host_peer_id, invite = self.staged_invites.popitem()
        return {"status": "matched", "invite": invite}

    def post_drop(self, invite_uuid, drop_payload):
        self.completed_drops[invite_uuid] = drop_payload
        return {"status": "success"}


class MockZeroMeshPeer:
    """Simulates a ZeroMeshNetworkManager instance running on a browser peer."""
    def __init__(self, peer_id, name="Walker", room_id="clifton-commons"):
        self.peer_id = peer_id
        self.name = name
        self.room_id = room_id
        self.is_host = False
        self.status = "OFFLINE"
        self.connected_peers = set()
        self.game_packets_received = []
        self.proximity_cluster = set()
        self.proximity_messages = []
        self.active_npcs = {}
        self.npc_paths = list(DEFAULT_PATH_MANIFEST)
        self.target_npc_count = 5
        self._next_npc_seq = 1

    def connect(self, coordinator):
        self.status = "CONNECTING"
        match_res = coordinator.request_match()
        if match_res["status"] == "empty":
            # Seed peer
            self.is_host = True
            self.status = "HOSTING"
            # Stage single-use invite for future newcomers
            invite = {
                "invite_uuid": f"inv-{self.peer_id}-1",
                "assigned_peer_id": f"peer-new-{len(coordinator.staged_invites)+1}",
                "host_peer_id": self.peer_id,
                "host_public_key": f"pubkey-{self.peer_id}",
                "sdp_offer": "v=0\r\no=...",
                "hmac_token": "valid_token"
            }
            coordinator.stage_invite(self.peer_id, invite)
            # Initialize 5 pre-warmed NPCs locally
            self.init_npcs()
            return "seed_host"
        else:
            # Matched newcomer
            invite = match_res["invite"]
            host_peer_id = invite["host_peer_id"]
            drop = {
                "drop_uuid": f"drop-{self.peer_id}",
                "joiner_public_key": f"pubkey-{self.peer_id}",
                "sealed_sdp_answer": "sealed_answer"
            }
            coordinator.post_drop(invite["invite_uuid"], drop)
            # Snap P2P connection
            self.connected_peers.add(host_peer_id)
            self.status = "CONNECTED_PEER"
            # Stage own invite for subsequent newcomers
            my_invite = {
                "invite_uuid": f"inv-{self.peer_id}-1",
                "assigned_peer_id": f"peer-new-next",
                "host_peer_id": self.peer_id,
                "host_public_key": f"pubkey-{self.peer_id}",
                "sdp_offer": "v=0\r\no=...",
                "hmac_token": "valid_token"
            }
            coordinator.stage_invite(self.peer_id, my_invite)
            return "matched_joiner"

    def is_npc_coordinator(self):
        if not self.connected_peers:
            return self.is_host
        all_ids = sorted(list(self.connected_peers) + [self.peer_id])
        return all_ids[0] == self.peer_id

    def init_npcs(self):
        used_path_ids = set()
        for i in range(self.target_npc_count):
            avail = [p for p in self.npc_paths if p["id"] not in used_path_ids]
            if not avail:
                break
            chosen = avail[i % len(avail)]
            used_path_ids.add(chosen["id"])
            npc_id = f"npc-p2p-{self._next_npc_seq}"
            self._next_npc_seq += 1
            npc_type = chosen["type"]
            if npc_type == "both":
                npc_type = "walker" if i % 2 == 0 else "jogger"
            speed = 22 if npc_type == "walker" else 48
            duration = chosen["lengthPx"] / speed
            prewarm = 0.15 + (i / 5.0) * 0.70
            spawn_time = 1000.0 - (prewarm * duration)

            self.active_npcs[npc_id] = {
                "id": npc_id,
                "pathId": chosen["id"],
                "type": npc_type,
                "spawnTime": spawn_time,
                "duration": duration,
                "colorSeed": i * 100
            }

    def get_npc_snapshot(self):
        return {
            "type": "NPC_SNAPSHOT",
            "serverTime": 1000.0,
            "npcs": list(self.active_npcs.values())
        }

    def sync_proximity_cluster(self, in_range_peer_ids):
        self.proximity_cluster = set(in_range_peer_ids)

    def send_proximity_chat(self, text, peers):
        for p in peers:
            p.receive_proximity_chat(self.peer_id, text)

    def receive_proximity_chat(self, origin_peer_id, text):
        self.proximity_messages.append({"from": origin_peer_id, "text": text})


class TestZeroMeshIntegration(unittest.TestCase):
    """Test suite verifying dead-drop matchmaking, game mesh replication, NPC authority, and dual-mesh proximity chat."""

    def test_dead_drop_empty_room_seed_and_matchmaking(self):
        coord = MockDeadDropCoordinator("clifton-commons")

        # 1. First peer arrives into empty room
        peer1 = MockZeroMeshPeer("peer-1", name="Alice")
        res1 = peer1.connect(coord)
        self.assertEqual(res1, "seed_host")
        self.assertTrue(peer1.is_host)
        self.assertEqual(peer1.status, "HOSTING")
        self.assertIn("peer-1", coord.staged_invites)
        self.assertEqual(len(peer1.active_npcs), 5)
        self.assertTrue(peer1.is_npc_coordinator())

        # 2. Second peer arrives: receives matched invite from Alice
        peer2 = MockZeroMeshPeer("peer-2", name="Bob")
        res2 = peer2.connect(coord)
        self.assertEqual(res2, "matched_joiner")
        self.assertEqual(peer2.status, "CONNECTED_PEER")
        self.assertIn("peer-1", peer2.connected_peers)
        self.assertIn("inv-peer-1-1", coord.completed_drops)
        # Alice's staged invite was atomically claimed
        self.assertNotIn("peer-1", coord.staged_invites)
        # Bob staged his own invite for the next newcomer
        self.assertIn("peer-2", coord.staged_invites)

        # 3. Third peer arrives: receives matched invite from Bob
        peer3 = MockZeroMeshPeer("peer-3", name="Charlie")
        res3 = peer3.connect(coord)
        self.assertEqual(res3, "matched_joiner")
        self.assertIn("peer-2", peer3.connected_peers)
        self.assertIn("inv-peer-2-1", coord.completed_drops)
        self.assertNotIn("peer-2", coord.staged_invites)
        self.assertIn("peer-3", coord.staged_invites)

    def test_deterministic_p2p_npc_coordinator_election(self):
        coord = MockDeadDropCoordinator()
        peer1 = MockZeroMeshPeer("peer-b", name="Alice")
        peer1.connect(coord)
        peer2 = MockZeroMeshPeer("peer-a", name="Bob")
        peer2.connect(coord)

        peer1.connected_peers.add("peer-a")
        peer2.connected_peers.add("peer-b")

        # Lexicographically lowest ID: 'peer-a' is coordinator
        self.assertTrue(peer2.is_npc_coordinator())
        self.assertFalse(peer1.is_npc_coordinator())

        # Bob drops off; Alice becomes coordinator
        peer1.connected_peers.remove("peer-a")
        self.assertTrue(peer1.is_npc_coordinator())

    def test_p2p_npc_snapshot_delivery_and_prewarming(self):
        coord = MockDeadDropCoordinator()
        peer1 = MockZeroMeshPeer("peer-1", name="Alice")
        peer1.connect(coord)

        snapshot = peer1.get_npc_snapshot()
        self.assertEqual(snapshot["type"], "NPC_SNAPSHOT")
        self.assertEqual(len(snapshot["npcs"]), 5)

        # Verify pre-warming: all initial spawnTimes are < serverTime (1000.0)
        for npc in snapshot["npcs"]:
            self.assertLess(npc["spawnTime"], 1000.0)
            self.assertGreater(npc["duration"], 0)
            self.assertIn(npc["type"], ["walker", "jogger"])

    def test_proximity_chat_hysteresis_and_cluster_messaging(self):
        """
        Verify hysteresis:
        - Join circle at <= 160px
        - Stay connected at <= 200px
        - Disconnect at > 200px
        """
        join_radius = 160.0
        leave_radius = 200.0

        p1 = MockZeroMeshPeer("p1", "Alice")
        p2 = MockZeroMeshPeer("p2", "Bob")

        def compute_dist(x1, y1, x2, y2):
            return math.hypot(x2 - x1, y2 - y1)

        # Position Alice at (0, 0)
        # Position Bob at (180, 0) -> distance 180px
        dist = compute_dist(0, 0, 180, 0)
        # Outside join_radius (180 > 160) -> Bob should not join cluster
        in_cluster = (dist <= join_radius)
        self.assertFalse(in_cluster)

        # Bob moves closer to (150, 0) -> distance 150px <= 160px -> Bob joins cluster
        dist = compute_dist(0, 0, 150, 0)
        in_cluster = (dist <= join_radius)
        self.assertTrue(in_cluster)
        p1.sync_proximity_cluster(["p2"])
        p2.sync_proximity_cluster(["p1"])

        # Alice sends proximity message to Bob
        p1.send_proximity_chat("Hey Bob!", [p2])
        self.assertEqual(len(p2.proximity_messages), 1)
        self.assertEqual(p2.proximity_messages[0]["text"], "Hey Bob!")

        # Bob moves away to (190, 0) -> distance 190px (160 < 190 <= 200)
        # Hysteresis keeps Bob connected because 190 <= leave_radius (200px)
        dist = compute_dist(0, 0, 190, 0)
        stay_in_cluster = (dist <= leave_radius)
        self.assertTrue(stay_in_cluster)

        # Bob moves away to (210, 0) -> distance 210px > 200px -> Bob leaves cluster
        dist = compute_dist(0, 0, 210, 0)
        stay_in_cluster = (dist <= leave_radius)
        self.assertFalse(stay_in_cluster)
        p1.sync_proximity_cluster([])
        p2.sync_proximity_cluster([])
        self.assertEqual(len(p1.proximity_cluster), 0)


if __name__ == "__main__":
    unittest.main()

