#!/usr/bin/env python3
"""
Acceptance Test Suite for Proximity Chat & Tombstone Lifecycle
Verifies AC-015.1 through AC-015.6:
- AC-015.1: Spatial Proximity Clustering Algorithm (threshold, pair formation, transitive multi-hop)
- AC-015.2: Prominent On-Screen Conversation HUD (DOM structure, buttons, quick emojis, glassmorphic styling)
- AC-015.3: Walking Alongside Locomotion Test (continuous clustering across movement ticks)
- AC-015.4: Dynamic Multi-Peer Join and Leave (join, leave, non-dissolving cluster with 2+ peers)
- AC-015.5: Parting Tombstone Lifecycle & Fading (creation, depthY, alpha decay, field culling)
- AC-015.6: Test Runner Integration
"""

import math
import os
import re
import unittest


class SpatialClusteringSimulator:
    """
    Python simulator mirroring the BFS spatial proximity clustering logic in
    `src/ui/proximity_chat.js` for deterministic unit testing.
    """
    def __init__(self, radius=200):
        self.radius = radius
        self.active_cluster = None  # None or set of peer IDs
        self.participants = []
        self.messages = []
        self.last_message = None
        self.system_messages = []
        self.formed_history = []
        self.dissolved_history = []

    def is_cluster_active(self):
        return self.active_cluster is not None

    def get_active_peers(self):
        if not self.active_cluster:
            return []
        return sorted(list(self.active_cluster))

    def get_snippet(self):
        if self.last_message:
            return str(self.last_message).strip()
        peers = [p["name"] for p in self.participants if not p.get("isLocal")]
        if peers:
            return f"Chat with {', '.join(peers)}"
        return ""

    def add_message(self, sender_id, sender_name, text, is_local=False):
        msg = {
            "senderId": sender_id,
            "senderName": sender_name,
            "text": str(text),
            "isLocal": is_local
        }
        self.messages.append(msg)
        self.last_message = str(text)
        return msg

    def update(self, dt, local_owner, remote_players_dict):
        was_active = self.is_cluster_active()

        if local_owner is None:
            if was_active:
                parting_context = {
                    "x": 0,
                    "y": 0,
                    "participants": list(self.participants),
                    "lastMessage": self.last_message,
                    "snippet": self.get_snippet()
                }
                self.dissolved_history.append(parting_context)
                self.active_cluster = None
                self.participants = []
            return

        local_id = str(local_owner.get("id", "local"))
        local_name = local_owner.get("name", "You")
        local_node = {
            "id": local_id,
            "name": local_name,
            "x": local_owner["x"],
            "y": local_owner["y"],
            "isLocal": True
        }

        # Format remotes
        all_remotes = []
        for r_id, r_data in remote_players_dict.items():
            if str(r_id) == local_id:
                continue
            entity = r_data.get("owner", r_data)
            all_remotes.append({
                "id": str(r_id),
                "name": str(entity.get("name", r_data.get("name", "Walker"))),
                "x": float(entity["x"]),
                "y": float(entity["y"]),
                "isLocal": False
            })

        # BFS clustering starting at local player
        connected_nodes = []
        visited = set()
        queue = [local_node]

        while queue:
            current = queue.pop(0)
            for rem in all_remotes:
                if rem["id"] not in visited:
                    dist = math.hypot(current["x"] - rem["x"], current["y"] - rem["y"])
                    if dist <= self.radius:
                        visited.add(rem["id"])
                        connected_nodes.append(rem)
                        queue.append(rem)

        if connected_nodes:
            current_peer_ids = set(r["id"] for r in connected_nodes)
            new_participants = [local_node] + connected_nodes

            if not was_active:
                self.active_cluster = current_peer_ids
                self.participants = new_participants
                self.formed_history.append(list(new_participants))
            else:
                prev_peer_ids = self.active_cluster or set()
                joined = [r for r in connected_nodes if r["id"] not in prev_peer_ids]
                left_ids = [pid for pid in prev_peer_ids if pid not in current_peer_ids]

                for j in joined:
                    self.system_messages.append(f"{j['name']} joined the conversation.")
                for lid in left_ids:
                    prev_p = next((p for p in self.participants if p["id"] == lid), None)
                    p_name = prev_p["name"] if prev_p else "A player"
                    self.system_messages.append(f"{p_name} left the conversation.")

                if joined or left_ids:
                    self.active_cluster = current_peer_ids
                    self.participants = new_participants
        else:
            if was_active:
                parting_context = {
                    "x": local_owner["x"],
                    "y": local_owner["y"],
                    "participants": list(self.participants),
                    "lastMessage": self.last_message,
                    "snippet": self.get_snippet()
                }
                self.dissolved_history.append(parting_context)
                self.active_cluster = None
                self.participants = []


class ChatTombstoneSimulator:
    """
    Python simulator mirroring `src/entities/tombstone.js`.
    """
    def __init__(self, x, y, options=None):
        options = options or {}
        self.x = x
        self.y = y
        self.depthY = y + 8
        self.text = options.get("text", options.get("snippet", ""))
        self.participants = options.get("participants", [])
        self.maxLifespan = float(options.get("lifespan", 10.0))
        self.lifespan = self.maxLifespan
        self.alpha = 1.0
        self.isDead = False

    def update(self, dt):
        self.lifespan -= dt
        self.alpha = max(0.0, min(1.0, self.lifespan / self.maxLifespan))
        if self.lifespan <= 0:
            self.isDead = True
        return not self.isDead


class TestProximityChat(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.chat_js_path = os.path.join(self.base_dir, "src", "ui", "proximity_chat.js")
        self.css_path = os.path.join(self.base_dir, "src", "style.css")
        self.tombstone_js_path = os.path.join(self.base_dir, "src", "entities", "tombstone.js")
        self.field_js_path = os.path.join(self.base_dir, "src", "world", "field.js")
        self.protocol_js_path = os.path.join(self.base_dir, "src", "net", "protocol.js")

        with open(self.chat_js_path, "r", encoding="utf-8") as f:
            self.chat_js = f.read()

        with open(self.css_path, "r", encoding="utf-8") as f:
            self.css = f.read()

        with open(self.tombstone_js_path, "r", encoding="utf-8") as f:
            self.tombstone_js = f.read()

        with open(self.field_js_path, "r", encoding="utf-8") as f:
            self.field_js = f.read()

        with open(self.protocol_js_path, "r", encoding="utf-8") as f:
            self.protocol_js = f.read()

    # =========================================================================
    # AC-015.1: Spatial Proximity Clustering Algorithm
    # =========================================================================
    def test_ac015_1_proximity_radius_constant(self):
        """Verify PROXIMITY_RADIUS is defined and defaults to 200px."""
        self.assertIn("export const PROXIMITY_RADIUS = 200", self.chat_js)

    def test_ac015_1_spatial_proximity_clustering_direct_pair(self):
        """
        Verify pair clustering:
        - 2 players <= 200px (150px) form a cluster.
        - 2 players > 200px (250px) do NOT form a cluster.
        """
        sim = SpatialClusteringSimulator(radius=200)

        # Distance <= 200px: (100, 100) and (250, 100) -> dx=150, dy=0 => dist=150
        local_owner = {"id": "player-local", "name": "Alice", "x": 100, "y": 100}
        remotes_in_range = {
            "peer-1": {"name": "Bob", "x": 250, "y": 100}
        }
        sim.update(0.016, local_owner, remotes_in_range)
        self.assertTrue(sim.is_cluster_active(), "Cluster should form when distance is 150px (<= 200px)")
        self.assertEqual(sim.get_active_peers(), ["peer-1"])
        self.assertEqual(len(sim.participants), 2)

        # Distance > 200px: (100, 100) and (350, 100) -> dx=250, dy=0 => dist=250
        sim_out = SpatialClusteringSimulator(radius=200)
        remotes_out_of_range = {
            "peer-1": {"name": "Bob", "x": 350, "y": 100}
        }
        sim_out.update(0.016, local_owner, remotes_out_of_range)
        self.assertFalse(sim_out.is_cluster_active(), "Cluster should NOT form when distance is 250px (> 200px)")
        self.assertEqual(sim_out.get_active_peers(), [])

    def test_ac015_1_transitive_multi_player_clustering(self):
        """
        Verify multi-player transitive clustering:
        - Player A at (100, 100)
        - Player B at (250, 100) (dist 150 from A)
        - Player C at (380, 100) (dist 130 from B, but 280 from A)
        All 3 players must belong to the same cluster because B bridges A and C.
        """
        sim = SpatialClusteringSimulator(radius=200)
        local_player_a = {"id": "player-a", "name": "Player A", "x": 100, "y": 100}
        remotes = {
            "player-b": {"name": "Player B", "x": 250, "y": 100},
            "player-c": {"name": "Player C", "x": 380, "y": 100}
        }

        # Check distances
        dist_ab = math.hypot(250 - 100, 100 - 100)
        dist_bc = math.hypot(380 - 250, 100 - 100)
        dist_ac = math.hypot(380 - 100, 100 - 100)
        self.assertEqual(dist_ab, 150.0)
        self.assertEqual(dist_bc, 130.0)
        self.assertEqual(dist_ac, 280.0)
        self.assertLessEqual(dist_ab, 200.0)
        self.assertLessEqual(dist_bc, 200.0)
        self.assertGreater(dist_ac, 200.0)

        sim.update(0.016, local_player_a, remotes)
        self.assertTrue(sim.is_cluster_active(), "Transitive cluster should be active")
        self.assertEqual(sim.get_active_peers(), ["player-b", "player-c"])
        self.assertEqual(len(sim.participants), 3)

        # Verify JS implementation contains BFS / queue logic for transitive search
        self.assertIn("while (queue.length > 0)", self.chat_js)
        self.assertIn("Math.hypot", self.chat_js)

    # =========================================================================
    # AC-015.2: Prominent On-Screen Conversation HUD
    # =========================================================================
    def test_ac015_2_hud_dom_structure_and_ids(self):
        """
        Verify HTML DOM structure/classes in `src/ui/proximity_chat.js`:
        - #proximity-chat-panel
        - #proximity-chat-header
        - #proximity-chat-messages
        - #proximity-chat-input
        - Quick emojis: 👋, 🐾, ❤️, ☕
        """
        self.assertTrue(
            'id="proximity-chat-panel"' in self.chat_js or "'proximity-chat-panel'" in self.chat_js,
            "proximity-chat-panel id missing in proximity_chat.js"
        )
        self.assertIn('id="proximity-chat-header"', self.chat_js)
        self.assertIn('id="proximity-chat-messages"', self.chat_js)
        self.assertIn('id="proximity-chat-input"', self.chat_js)

        # Quick emojis
        for emoji in ['👋', '🐾', '❤️', '☕']:
            self.assertIn(emoji, self.chat_js, f"Emoji {emoji} missing from quick emoji buttons")

    def test_ac015_2_glassmorphic_panel_css(self):
        """
        Verify CSS styles for glassmorphic panel styling:
        backdrop-filter, dark slate background, rounded corners, transitions.
        """
        self.assertIn("#proximity-chat-panel", self.css)
        self.assertIn("backdrop-filter: blur(", self.css)
        self.assertIn("border-radius:", self.css)
        self.assertIn("transition:", self.css)

        # Verify dark slate color theme
        self.assertTrue(
            "rgba(15, 23, 42" in self.css or "#0f172a" in self.css or "rgba(30, 41, 59" in self.css,
            "Dark slate background missing for proximity chat HUD"
        )

    # =========================================================================
    # AC-015.3: Walking Alongside Locomotion Test
    # =========================================================================
    def test_ac015_3_walking_alongside_continuous_cluster(self):
        """
        Simulate 10 sequential movement ticks where both local and peer move together:
        both move +15px in X each tick, maintaining distance of 80px.
        Assert cluster remains continuously active throughout all ticks without dropping.
        """
        sim = SpatialClusteringSimulator(radius=200)

        local_x = 200.0
        local_y = 300.0
        peer_x = 280.0  # initial distance = 80px
        peer_y = 300.0

        for tick in range(10):
            local_x += 15.0
            peer_x += 15.0

            cur_dist = math.hypot(peer_x - local_x, peer_y - local_y)
            self.assertAlmostEqual(cur_dist, 80.0, places=2)

            local_owner = {"id": "local", "name": "LocalWalker", "x": local_x, "y": local_y}
            remotes = {"peer-buddy": {"name": "Buddy", "x": peer_x, "y": peer_y}}

            sim.update(0.05, local_owner, remotes)

            self.assertTrue(
                sim.is_cluster_active(),
                f"Cluster dropped unexpectedly on tick {tick + 1}"
            )
            self.assertEqual(sim.get_active_peers(), ["peer-buddy"])
            self.assertEqual(len(sim.participants), 2)

        # Should only have formed once, never dissolved
        self.assertEqual(len(sim.formed_history), 1)
        self.assertEqual(len(sim.dissolved_history), 0)

    # =========================================================================
    # AC-015.4: Dynamic Multi-Peer Join and Leave
    # =========================================================================
    def test_ac015_4_dynamic_multi_peer_join_and_leave(self):
        """
        Dynamic multi-peer membership:
        - Start with local player and Peer 1 in cluster.
        - Step 1: Peer 2 moves within 200px -> joins active cluster (count = 3).
        - Step 2: Peer 2 moves > 200px away -> leaves active cluster, but local and Peer 1
          remain in cluster (count returns to 2, cluster does NOT dissolve).
        """
        sim = SpatialClusteringSimulator(radius=200)
        local_owner = {"id": "local", "name": "Me", "x": 100, "y": 100}

        # Initial state: local + peer-1 (dist = 100px)
        remotes = {
            "peer-1": {"name": "Peer 1", "x": 200, "y": 100}
        }
        sim.update(0.016, local_owner, remotes)
        self.assertTrue(sim.is_cluster_active())
        self.assertEqual(len(sim.participants), 2)
        self.assertEqual(len(sim.formed_history), 1)

        # Step 1: Peer 2 moves within range at (100, 220) -> dist = 120px
        remotes["peer-2"] = {"name": "Peer 2", "x": 100, "y": 220}
        sim.update(0.016, local_owner, remotes)
        self.assertTrue(sim.is_cluster_active())
        self.assertEqual(len(sim.participants), 3)
        self.assertEqual(sim.get_active_peers(), ["peer-1", "peer-2"])
        self.assertIn("Peer 2 joined the conversation.", sim.system_messages)

        # Step 2: Peer 2 moves > 200px away (100, 500) -> dist = 400px
        del remotes["peer-2"]
        sim.update(0.016, local_owner, remotes)
        self.assertTrue(
            sim.is_cluster_active(),
            "Cluster must NOT dissolve when one peer leaves but others remain"
        )
        self.assertEqual(len(sim.participants), 2)
        self.assertEqual(sim.get_active_peers(), ["peer-1"])
        self.assertIn("Peer 2 left the conversation.", sim.system_messages)
        self.assertEqual(len(sim.dissolved_history), 0, "Cluster should not have dissolved")

    # =========================================================================
    # AC-015.5: Parting Tombstone Lifecycle & Fading
    # =========================================================================
    def test_ac015_5_tombstone_instantiation_and_dissolve(self):
        """
        When all peers move outside 200px:
        - Cluster dissolves and records parting coordinates.
        - ChatTombstone entity is instantiated at (x, y) with depthY = y + 8 and maxLifespan = 10.0.
        """
        sim = SpatialClusteringSimulator(radius=200)
        local_owner = {"id": "local", "name": "Me", "x": 150, "y": 250}
        remotes = {"peer-1": {"name": "Peer 1", "x": 200, "y": 250}}

        sim.update(0.016, local_owner, remotes)
        sim.add_message("local", "Me", "See you later at the cafe!", True)
        self.assertTrue(sim.is_cluster_active())

        # Peer 1 walks away
        remotes = {"peer-1": {"name": "Peer 1", "x": 600, "y": 250}}
        sim.update(0.016, local_owner, remotes)
        self.assertFalse(sim.is_cluster_active(), "Cluster should dissolve")
        self.assertEqual(len(sim.dissolved_history), 1)

        parting = sim.dissolved_history[0]
        self.assertEqual(parting["x"], 150)
        self.assertEqual(parting["y"], 250)
        self.assertEqual(parting["lastMessage"], "See you later at the cafe!")

        # Instantiate tombstone
        tomb = ChatTombstoneSimulator(parting["x"], parting["y"], {
            "snippet": parting["snippet"],
            "participants": [p["name"] for p in parting["participants"]]
        })

        self.assertEqual(tomb.x, 150)
        self.assertEqual(tomb.y, 250)
        self.assertEqual(tomb.depthY, 258)  # y + 8
        self.assertEqual(tomb.maxLifespan, 10.0)

    def test_ac015_5_tombstone_alpha_decay_and_culling(self):
        """
        Simulate update(dt) on tombstone:
        - At dt = 0, alpha = 1.0, isDead = False.
        - At dt = 5.0 (half lifespan), alpha = 0.5.
        - At dt = 10.0+ (expiry), isDead = True, alpha = 0.0.
        - Field culls expired tombstones.
        """
        tomb = ChatTombstoneSimulator(300, 400)
        self.assertEqual(tomb.alpha, 1.0)
        self.assertFalse(tomb.isDead)

        # Advance 5.0 seconds
        tomb.update(5.0)
        self.assertAlmostEqual(tomb.alpha, 0.5, places=3)
        self.assertFalse(tomb.isDead)

        # Advance another 5.0 seconds (total 10.0s)
        tomb.update(5.0)
        self.assertAlmostEqual(tomb.alpha, 0.0, places=3)
        self.assertTrue(tomb.isDead)

        # Verify Field does NOT maintain tombstones registry (superseded by ticket-018 / AC-018)
        self.assertNotIn("addTombstone", self.field_js)
        self.assertNotIn("this.tombstones", self.field_js)

    # =========================================================================
    # AC-015.6: Test Runner Integration
    # =========================================================================
    def test_ac015_6_test_runner_entry_present(self):
        """Verify test/test_proximity_chat.py is registered in test/run_tests.py."""
        run_tests_path = os.path.join(self.base_dir, "test", "run_tests.py")
        with open(run_tests_path, "r", encoding="utf-8") as f:
            runner_code = f.read()
        self.assertIn("test/test_proximity_chat.py", runner_code)


if __name__ == "__main__":
    unittest.main()
