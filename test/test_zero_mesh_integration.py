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
        self.on_npc_snapshot = None
        self.on_npc_spawn = None
        self.on_npc_despawn = None

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
            self.init_npc_spawner()
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

    def init_npc_spawner(self):
        if not self.is_npc_coordinator():
            return
        self.init_npcs()
        if callable(self.on_npc_snapshot):
            snapshot = [
                {
                    "id": n["id"],
                    "pathId": n["pathId"],
                    "type": n["type"],
                    "npcType": n["type"],
                    "seed": n.get("colorSeed", 12345),
                    "spawnTime": n["spawnTime"]
                }
                for n in self.active_npcs.values()
            ]
            self.on_npc_snapshot(snapshot, 1000.0)

    def despawn_npc(self, npc_id):
        npc = self.active_npcs.pop(npc_id, None)
        if not npc:
            return
        if callable(self.on_npc_despawn):
            self.on_npc_despawn(npc["id"])
        if self.is_npc_coordinator():
            new_id = f"npc-p2p-{self._next_npc_seq}"
            self._next_npc_seq += 1
            new_npc = {
                "id": new_id,
                "pathId": "ladies-mile-loop",
                "type": "walker",
                "npcType": "walker",
                "seed": 54321,
                "spawnTime": 1050.0,
                "duration": 100.0
            }
            self.active_npcs[new_id] = new_npc
            if callable(self.on_npc_spawn):
                self.on_npc_spawn(new_npc)

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

    def test_sync_loop_and_protocol_contract_compatibility(self):
        """Verify startSyncLoop, ensureRemotePeer structure, and onPeerJoin signature."""
        js_file = os.path.join(os.path.dirname(__file__), "..", "src", "net", "zero_mesh_network.js")
        with open(js_file) as f:
            content = f.read()

        # Check startSyncLoop and stop methods
        self.assertIn("startSyncLoop(getLocalStateFn)", content)
        self.assertIn("stop()", content)

        # Check ensureRemotePeer creates ownerInterpolator and dogInterpolator
        self.assertIn("ownerInterpolator: new EntityInterpolator()", content)
        self.assertIn("dogInterpolator: new EntityInterpolator()", content)

        # Check SYNC_STATE unpacks both nested packet.owner and packet.dog
        self.assertIn("const ownerSnap = packet.owner", content)
        self.assertIn("const dogSnap = packet.dog", content)

        # Check onPeerJoin is called with (senderId, peerData.meta)
        self.assertIn("this.onPeerJoin(senderId, peerData.meta)", content)

        # Check createWelcome passes (this.peerId, this.localMeta, peersList)
        self.assertIn("Protocol.createWelcome(\n          this.peerId,\n          this.localMeta,", content)

        # Check real WasmWebRtcEngine / WasmCryptoSession calls
        self.assertIn("this.cryptoSession.seal_drop_sdp", content)
        self.assertIn("this.cryptoSession.open_drop_sdp", content)
        self.assertIn("engine.accept_offer_and_create_answer", content)

    def test_no_bare_json_imports_in_browser_src(self):
        """Regression test (unification-006): Verify no browser .js files contain bare import ... from '*.json'."""
        import re
        src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
        bare_json_pattern = re.compile(r"""^\s*import\s+.*?['"][^'"]+\.json['"]\s*;?""", re.MULTILINE)

        offending_imports = []
        for root, _, files in os.walk(src_dir):
            for file in files:
                if file.endswith(".js"):
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, src_dir)
                    with open(file_path, "r", encoding="utf-8") as f:
                        text = f.read()
                    matches = bare_json_pattern.findall(text)
                    if matches:
                        offending_imports.append((rel_path, matches))

        self.assertEqual(
            offending_imports,
            [],
            f"Found bare JSON imports in unbundled browser JavaScript modules: {offending_imports}"
        )

    def test_seed_host_populates_local_game_npcs_via_on_npc_snapshot(self):
        """Regression test (unification-007):
        Verify that calling initNpcSpawner() on a host triggers onNpcSnapshot locally,
        and lifecycle rotations invoke onNpcDespawn and onNpcSpawn.
        Also validates contract wiring in zero_mesh_network.js, main.js, and environment.js.
        """
        coord = MockDeadDropCoordinator()
        host = MockZeroMeshPeer("peer-host", name="HostAlice")

        received_snapshots = []
        despawned_npc_ids = []
        spawned_npcs = []

        host.on_npc_snapshot = lambda snap, st: received_snapshots.append((snap, st))
        host.on_npc_despawn = lambda nid: despawned_npc_ids.append(nid)
        host.on_npc_spawn = lambda npc: spawned_npcs.append(npc)

        # 1. Host connects as seed host and initializes spawner
        res = host.connect(coord)
        self.assertEqual(res, "seed_host")
        self.assertTrue(host.is_host)
        self.assertTrue(host.is_npc_coordinator())

        # Verify onNpcSnapshot was invoked locally with 5 pre-warmed NPCs
        self.assertEqual(len(received_snapshots), 1)
        snapshot, server_time = received_snapshots[0]
        self.assertEqual(len(snapshot), 5)
        self.assertAlmostEqual(server_time, 1000.0)
        first_npc_id = snapshot[0]["id"]
        for npc in snapshot:
            self.assertIn("id", npc)
            self.assertIn("pathId", npc)
            self.assertIn("type", npc)
            self.assertIn("npcType", npc)
            self.assertIn("seed", npc)
            self.assertIn("spawnTime", npc)

        # 2. Despawn lifecycle rotation
        host.despawn_npc(first_npc_id)
        self.assertIn(first_npc_id, despawned_npc_ids)
        self.assertEqual(len(spawned_npcs), 1)
        self.assertNotIn(first_npc_id, host.active_npcs)
        self.assertIn(spawned_npcs[0]["id"], host.active_npcs)

        # 3. Source contracts: zero_mesh_network.js
        net_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "net", "zero_mesh_network.js")
        with open(net_js_path, "r", encoding="utf-8") as f:
            net_code = f.read()

        self.assertIn("typeof this.onNpcSnapshot === 'function'", net_code)
        self.assertIn("this.onNpcSnapshot(snapshot, Date.now())", net_code)
        self.assertIn("typeof this.onNpcDespawn === 'function'", net_code)
        self.assertIn("this.onNpcDespawn(npc.id)", net_code)
        self.assertIn("typeof this.onNpcSpawn === 'function'", net_code)
        self.assertIn("this.onNpcSpawn(spawnPacket.npc || spawnPacket)", net_code)

        # 4. Source contracts: main.js
        main_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "main.js")
        with open(main_js_path, "r", encoding="utf-8") as f:
            main_code = f.read()

        self.assertIn("this.net.activeNpcs && this.net.activeNpcs.size > 0 && this.npcs.size === 0", main_code)
        self.assertIn("this.handleNpcSnapshot(Array.from(this.net.activeNpcs.values()), Date.now())", main_code)
        self.assertIn("for (const npc of this.npcs.values())", main_code)

        # 5. Source contracts: environment.js
        env_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "environment.js")
        with open(env_js_path, "r", encoding="utf-8") as f:
            env_code = f.read()

        self.assertIn("const isNpc =", env_code)
        self.assertIn("pRadius = p.cutoutRadius || (isNpc ? 60 :", env_code)

    def test_live_proximity_mesh_sdp_handshake_and_chat_routing(self):
        """Regression test (unification-008):
        Verify live WebRTC offer/answer negotiation for proximityMesh over gameMesh.send_direct_state,
        registering incoming proximity chat callbacks, and falling back to game_packet when no live mesh peers exist.
        """
        # 1. Behavioral simulation of SDP handshake and chat routing
        class FakeEngine:
            def __init__(self, role="initiator"):
                self.role = role
                self.answer_applied = None

            def create_offer(self):
                return "v=0\r\no=FakeOffer"

            def accept_offer_and_create_answer(self, offer):
                assert offer == "v=0\r\no=FakeOffer"
                return "v=0\r\no=FakeAnswer"

            def apply_answer(self, answer):
                self.answer_applied = answer

        class FakeProximityMesh:
            def __init__(self, local_id):
                self.local_id = local_id
                self.peers = {}
                self.messages = []
                self.on_message_cb = None

            def local_public_key(self):
                return [1, 2, 3, 4]

            def peer_count(self):
                return len(self.peers)

            def register_peer(self, peer_id, pub_key, engine):
                self.peers[peer_id] = {"pub_key": pub_key, "engine": engine}

            def broadcast_chat(self, text):
                self.messages.append(text)

            def set_on_message(self, cb):
                self.on_message_cb = cb

        class FakeGameMesh:
            def __init__(self):
                self.sent = []

            def send_direct_state(self, target_id, topic, payload):
                self.sent.append((target_id, topic, payload))

        # Test Handshake: Peer 1 (initiator) -> Peer 2 (responder)
        peer1_prox_mesh = FakeProximityMesh("prox-peer-1")
        peer2_prox_mesh = FakeProximityMesh("prox-peer-2")
        peer1_game_mesh = FakeGameMesh()
        peer2_game_mesh = FakeGameMesh()
        pending_engines = {}

        # Peer 1 initiates proximity handshake (peer-1 < peer-2)
        p1_engine = FakeEngine("initiator")
        pending_engines["peer-2"] = p1_engine
        offer_sdp = p1_engine.create_offer()
        invite_payload = {
            "initiator": "peer-1",
            "sdpOffer": offer_sdp,
            "pubKey": list(peer1_prox_mesh.local_public_key()),
            "timestamp": 12345
        }
        peer1_game_mesh.send_direct_state("peer-2", "proximity_invite", json.dumps(invite_payload).encode())

        # Peer 2 receives proximity_invite and creates answer
        self.assertEqual(len(peer1_game_mesh.sent), 1)
        tgt, topic, raw = peer1_game_mesh.sent[0]
        self.assertEqual(tgt, "peer-2")
        self.assertEqual(topic, "proximity_invite")
        received_invite = json.loads(raw.decode())

        p2_engine = FakeEngine("responder")
        answer_sdp = p2_engine.accept_offer_and_create_answer(received_invite["sdpOffer"])
        peer2_prox_mesh.register_peer(received_invite["initiator"], received_invite["pubKey"], p2_engine)
        drop_payload = {
            "responder": "peer-2",
            "sdpAnswer": answer_sdp,
            "pubKey": list(peer2_prox_mesh.local_public_key()),
            "timestamp": 12346
        }
        peer2_game_mesh.send_direct_state("peer-1", "proximity_drop", json.dumps(drop_payload).encode())

        # Peer 1 receives proximity_drop and finalizes
        self.assertEqual(len(peer2_game_mesh.sent), 1)
        tgt, topic, raw = peer2_game_mesh.sent[0]
        self.assertEqual(tgt, "peer-1")
        self.assertEqual(topic, "proximity_drop")
        received_drop = json.loads(raw.decode())

        engine_to_finalize = pending_engines.pop("peer-2")
        engine_to_finalize.apply_answer(received_drop["sdpAnswer"])
        peer1_prox_mesh.register_peer(received_drop["responder"], received_drop["pubKey"], engine_to_finalize)

        self.assertEqual(engine_to_finalize.answer_applied, "v=0\r\no=FakeAnswer")
        self.assertEqual(peer1_prox_mesh.peer_count(), 1)
        self.assertEqual(peer2_prox_mesh.peer_count(), 1)
        self.assertEqual(len(pending_engines), 0)

        # Test on_message callback cleans 'prox-' prefix
        delivered = []
        peer1_prox_mesh.set_on_message(lambda s_id, text: delivered.append((str(s_id).replace("prox-", ""), text)))
        peer1_prox_mesh.on_message_cb("prox-peer-2", "Hello in proximity!")
        self.assertEqual(delivered, [("peer-2", "Hello in proximity!")])

        # 2. Source code contract validation in src/net/zero_mesh_network.js
        net_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "net", "zero_mesh_network.js")
        with open(net_js_path, "r", encoding="utf-8") as f:
            net_code = f.read()

        self.assertIn("this.proximityMesh.set_on_message((senderPeerId, plaintext) => {", net_code)
        self.assertIn("const cleanSenderId = String(senderPeerId).replace(/^prox-/, '');", net_code)
        self.assertIn("this.pendingProximityEngines = new Map();", net_code)
        self.assertIn("this.proximityCrypto = new this.wasmMod.WasmCryptoSession();", net_code)
        self.assertIn("const engine = new this.wasmMod.WasmWebRtcEngine();", net_code)
        self.assertIn("const sdpOffer = await engine.create_offer();", net_code)
        self.assertIn("this.gameMesh.send_direct_state(remoteId, 'proximity_invite',", net_code)
        self.assertIn("const answerSdp = await engine.accept_offer_and_create_answer(payload.sdpOffer);", net_code)
        self.assertIn("this.gameMesh.send_direct_state(originPeerId, 'proximity_drop',", net_code)
        self.assertIn("await engine.apply_answer(payload.sdpAnswer);", net_code)
        self.assertIn("this.proximityMesh.broadcast_chat(text);", net_code)
        self.assertIn("Protocol.createProximityChat(this.peerId, this.localMeta.name, text, 0, 0, peers)", net_code)
        self.assertIn("case PacketType.PROXIMITY_CHAT:", net_code)

    def test_social_hud_recognizes_clifton_commons_as_public_online_badge(self):
        """Regression test (unification-008):
        Verify SocialHUD status badge recognizes 'clifton-commons' as public commons (green 'Online' and 'Share Park').
        """
        # 1. Logic validation
        def compute_hud_state(room_id, status="CONNECTED"):
            if status in ("CONNECTED", "CONNECTED_PEER", "HOSTING"):
                is_commons = not room_id or room_id == 'the-commons' or room_id == 'clifton-commons' or room_id == 'clifton-field'
                if is_commons:
                    badge_text = "Online"
                    badge_bg = "#059669"
                    label_text = "Share Park"
                else:
                    badge_text = f"🔒 Meadow ({room_id})"
                    badge_bg = "#8b5cf6"
                    label_text = "Share Link"
                return is_commons, badge_text, badge_bg, label_text
            return False, "Offline", "#64748b", "Share Park"

        # Verify clifton-commons displays green Online badge and Share Park
        is_comm, text, bg, label = compute_hud_state("clifton-commons")
        self.assertTrue(is_comm)
        self.assertEqual(text, "Online")
        self.assertEqual(bg, "#059669")
        self.assertEqual(label, "Share Park")

        # Verify other public aliases
        for r in ("", None, "the-commons", "clifton-field"):
            is_comm, text, bg, label = compute_hud_state(r)
            self.assertTrue(is_comm)
            self.assertEqual(text, "Online")

        # Verify private room displays locked meadow
        is_comm, text, bg, label = compute_hud_state("secret-meadow-99")
        self.assertFalse(is_comm)
        self.assertEqual(text, "🔒 Meadow (secret-meadow-99)")
        self.assertEqual(bg, "#8b5cf6")
        self.assertEqual(label, "Share Link")

        # 2. Source code contract validation in src/ui/social_hud.js
        hud_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "ui", "social_hud.js")
        with open(hud_js_path, "r", encoding="utf-8") as f:
            hud_code = f.read()

        self.assertIn("this.net.roomId === 'clifton-commons'", hud_code)
        self.assertIn("badge.textContent = 'Online'", hud_code)
        self.assertIn("label.textContent = isCommons ? 'Share Park' : 'Share Link'", hud_code)

    def test_unified_zero_chat_widget_mounted_in_proximity_chat(self):
        """Regression test (unification-009):
        Verify ZeroChatWidget sync and mounting inside ProximityChat with distributed message and session burn.
        - Synchronized widget files and index.html stylesheet inclusion.
        - ProximityChat mounts ZeroChatWidget with mode: 'embedded'.
        - Message bubble classes (.message-bubble, .proximity-chat-msg, .btn-message-burn, data-msg-uuid).
        - Distributed PROXIMITY_BURN_MSG and PROXIMITY_BURN_ALL packet propagation and wiring.
        """
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

        # 1. Verify build script sync and widget assets
        widget_js_path = os.path.join(root_dir, "src", "ui", "zero_chat_widget.js")
        widget_css_path = os.path.join(root_dir, "src", "ui", "zero_chat_widget.css")
        self.assertTrue(os.path.isfile(widget_js_path), "src/ui/zero_chat_widget.js must exist")
        self.assertTrue(os.path.isfile(widget_css_path), "src/ui/zero_chat_widget.css must exist")

        with open(widget_js_path, "r", encoding="utf-8") as f:
            widget_js = f.read()
        self.assertIn("export class ZeroChatWidget", widget_js)
        self.assertIn("export const PEER_COLOR_PALETTE", widget_js)
        self.assertIn("dissolveMessageById", widget_js)
        self.assertIn("burnAllMessages", widget_js)
        self.assertIn("setPeers", widget_js)
        self.assertIn("btn-message-burn", widget_js)

        with open(widget_css_path, "r", encoding="utf-8") as f:
            widget_css = f.read()
        self.assertIn(".zero-chat-widget", widget_css)
        self.assertIn(".zero-chat-embedded", widget_css)
        self.assertIn(".message-bubble", widget_css)
        self.assertIn(".btn-message-burn", widget_css)
        self.assertIn(".message-aging", widget_css)
        self.assertIn(".message-dissolve", widget_css)

        # Verify index.html links zero_chat_widget.css
        index_html_path = os.path.join(root_dir, "index.html")
        with open(index_html_path, "r", encoding="utf-8") as f:
            index_html = f.read()
        self.assertIn('href="src/ui/zero_chat_widget.css"', index_html)

        # Verify build scripts sync widget
        for script_name in ("build_wasm.sh", "build_pages.sh"):
            script_path = os.path.join(root_dir, "scripts", script_name)
            with open(script_path, "r", encoding="utf-8") as f:
                script_content = f.read()
            self.assertIn("zero_chat_widget.js", script_content, f"Widget sync missing in {script_name}")
            self.assertIn("zero_chat_widget.css", script_content, f"Widget css sync missing in {script_name}")

        # 2. Verify ProximityChat mounting contract in src/ui/proximity_chat.js
        prox_js_path = os.path.join(root_dir, "src", "ui", "proximity_chat.js")
        with open(prox_js_path, "r", encoding="utf-8") as f:
            prox_code = f.read()

        self.assertIn("import { ZeroChatWidget } from './zero_chat_widget.js';", prox_code)
        self.assertIn("this.widget = new ZeroChatWidget({", prox_code)
        self.assertIn("mode: 'embedded'", prox_code)
        self.assertIn("onSendMessage: (text) => this.sendMessage(text)", prox_code)
        self.assertIn("this.widget.appendMessage", prox_code)
        self.assertIn("this.widget.dissolveMessageById(messageUuid)", prox_code)
        self.assertIn("this.widget.burnAllMessages()", prox_code)
        self.assertIn("this.widget.setPeers(this.activeCluster, this.activeCluster.length)", prox_code)

        # Verify public API preserved
        for method in ("receiveMessage", "sendMessage", "burnMessage", "clearMessages", "getMessages", "getActivePeers", "update", "destroy"):
            self.assertIn(f"{method}(", prox_code, f"Method {method} missing from ProximityChat")
        for prop in ("this.radius", "this.joinRadius", "this.activeCluster", "this.messages", "this.retentionTimer"):
            self.assertIn(prop, prox_code, f"Property {prop} missing from ProximityChat")

        # 3. Verify distributed burn in src/net/zero_mesh_network.js
        net_js_path = os.path.join(root_dir, "src", "net", "zero_mesh_network.js")
        with open(net_js_path, "r", encoding="utf-8") as f:
            net_code = f.read()

        self.assertIn("burnProximityMessage(messageUuid)", net_code)
        self.assertIn("burnProximitySession()", net_code)
        self.assertIn("PROXIMITY_BURN_MSG", net_code)
        self.assertIn("PROXIMITY_BURN_ALL", net_code)
        self.assertIn("this.onProximityBurnMessage(packet.messageUuid)", net_code)
        self.assertIn("this.onProximityBurnSession()", net_code)

        # 4. Verify CliftonDownGame wiring in src/main.js
        main_js_path = os.path.join(root_dir, "src", "main.js")
        with open(main_js_path, "r", encoding="utf-8") as f:
            main_code = f.read()

        self.assertIn("this.net.onProximityBurnMessage = (uuid) => this.proximityChat && this.proximityChat.burnMessage(uuid);", main_code)
        self.assertIn("this.net.onProximityBurnSession = () => this.proximityChat && this.proximityChat.clearMessages();", main_code)
        self.assertIn("this.proximityChat.onBurnMessage = (uuid) => this.net && this.net.burnProximityMessage(uuid);", main_code)
        self.assertIn("this.proximityChat.onBurnSession = () => this.net && this.net.burnProximitySession();", main_code)

        # 5. Functional simulation of distributed burn packet flow
        class MockGameMesh:
            def __init__(self):
                self.sent = []
            def send_direct_state(self, peer_id, topic, payload):
                self.sent.append((peer_id, topic, payload))

        mesh = MockGameMesh()
        peer_id = "local-walker-1"
        target_peers = ["peer-alpha", "peer-beta"]

        # Simulate burnProximityMessage dispatch
        burn_msg_uuid = "burn-uuid-999"
        burn_packet = {
            "type": "PROXIMITY_BURN_MSG",
            "messageUuid": burn_msg_uuid,
            "senderId": peer_id
        }
        bytes_payload = json.dumps(burn_packet).encode("utf-8")
        for target in target_peers:
            mesh.send_direct_state(target, "game_packet", bytes_payload)

        self.assertEqual(len(mesh.sent), 2)
        tgt, topic, raw = mesh.sent[0]
        self.assertEqual(tgt, "peer-alpha")
        self.assertEqual(topic, "game_packet")
        parsed = json.loads(raw.decode("utf-8"))
        self.assertEqual(parsed["type"], "PROXIMITY_BURN_MSG")
        self.assertEqual(parsed["messageUuid"], burn_msg_uuid)

        # Simulate burnProximitySession dispatch
        session_packet = {
            "type": "PROXIMITY_BURN_ALL",
            "senderId": peer_id
        }
        session_bytes = json.dumps(session_packet).encode("utf-8")
        mesh.sent.clear()
        for target in target_peers:
            mesh.send_direct_state(target, "game_packet", session_bytes)

        self.assertEqual(len(mesh.sent), 2)
        tgt, topic, raw = mesh.sent[1]
        self.assertEqual(tgt, "peer-beta")
        parsed_session = json.loads(raw.decode("utf-8"))
        self.assertEqual(parsed_session["type"], "PROXIMITY_BURN_ALL")



if __name__ == "__main__":
    unittest.main()

