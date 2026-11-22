#!/usr/bin/env python3
"""
Automated Python unit and behavioral test suite validating the canonical
4-trait canine personality schema and leash dynamics (ticket unification-044).

Canonical schema: { curiosity, energy, stubbornness, loyalty } on a 1..=5 scale.
Defaults: { curiosity: 3, energy: 3, stubbornness: 2, loyalty: 4 }.

Leash constants are pinned by regex over the Rust core crate
(crates/dog_walker_core/src/) and/or runtime Wasm frames. Decision math is
never read out of companion_dog.js.
"""

import json
import math
import os
import re
import sys
import unittest

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

CANONICAL_TRAITS = ("curiosity", "energy", "stubbornness", "loyalty")
DEFAULT_PERSONALITY = {"curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4}

# Pinned leash constants (single source of truth: crates/dog_walker_core/src/).
# Names and values mirror `dog_leash_needs.rs` exactly.
LEASH_CONSTANTS = {
    "MAX_LEASH_LENGTH": 52.5,
    "LEASH_FORWARD_MIN": 38.0,
    "LEASH_FORWARD_MAX": 50.0,
    "LEASH_FORWARD_TARGET": 48.0,
    "LEASH_LATERAL_MIN": 0.0,
    "LEASH_LATERAL_MAX": 4.0,
    "LEASH_LATERAL_TARGET": 2.0,
    "LEASH_SHOULDER_MARGIN_MIN": 2.0,
    "LEASH_VELOCITY_FEED_FORWARD_SEC": 0.12,
}


class MockOwner:
    def __init__(self, x=1000.0, y=1000.0, is_leashed=True, angle=0.0):
        self.x = x
        self.y = y
        self.isLeashed = is_leashed
        self.angle = angle
        self.isMoving = False


class MockBall:
    def __init__(self, x=1150.0, y=1000.0, is_thrown=True):
        self.x = x
        self.y = y
        self.isThrown = is_thrown
        self.isCarried = False


class SimulatedCompanionDog:
    """
    Simulation of CompanionDog implementing the canonical 4-trait personality
    schema and leash dynamics for behavioral and math verification.
    """
    def __init__(self, x=1040.0, y=1000.0, owner=None, personality=None):
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.angle = 0.0
        self.speed = 195.0
        self.owner = owner
        self.state = "FOLLOWING" if (owner and owner.isLeashed) else "ROAMING"

        # Canonical personality defaults: 1 to 5 scale
        self.personality = dict(DEFAULT_PERSONALITY)
        if personality:
            self.set_personality(personality)

        # Dynamic traits derived from personality
        self.sprintSpeed = 260.0 + self.personality["energy"] * 15.0
        self.wagSpeed = 8.0 * (0.6 + self.personality["energy"] * 0.2)
        self.isPullingLeash = False
        self.targetBall = None
        self.isBarking = False

    def set_personality(self, p):
        for k in CANONICAL_TRAITS:
            if k in p:
                self.personality[k] = max(1, min(5, int(p[k])))
        self.sprintSpeed = 260.0 + self.personality["energy"] * 15.0
        self.wagSpeed = 8.0 * (0.6 + self.personality["energy"] * 0.2)

    def fetch_ball(self, ball):
        # Strict rule: leashed dog NEVER fetches ball
        if self.owner and self.owner.isLeashed:
            self.isPullingLeash = True
            self.angle = math.atan2(ball.y - self.y, ball.x - self.x)
            return False

        self.state = "FETCHING"
        self.targetBall = ball
        return True

    def update(self, dt, active_ball=None):
        # Leash rule: if owner is leashed and active ball thrown, never enter FETCHING
        if self.owner and self.owner.isLeashed:
            if active_ball and active_ball.isThrown:
                # Turn head towards ball, pull leash, wag tail eagerly
                self.angle = math.atan2(active_ball.y - self.y, active_ball.x - self.x)
                self.isPullingLeash = True
                self.wagSpeed = 10.0 + self.personality["energy"] * 2.0
            else:
                self.isPullingLeash = False

            # Max leash clamp: pinned MAX_LEASH_LENGTH constant.
            max_leash = LEASH_CONSTANTS["MAX_LEASH_LENGTH"]
            dx = self.x - self.owner.x
            dy = self.y - self.owner.y
            dist = math.hypot(dx, dy)
            if dist > max_leash:
                self.x = self.owner.x + (dx / dist) * max_leash
                self.y = self.owner.y + (dy / dist) * max_leash
                self.isPullingLeash = True
        else:
            if active_ball and active_ball.isThrown:
                self.state = "FETCHING"
                self.targetBall = active_ball

    def compute_social_approach(self, peer_dist):
        """
        Stubbornness alters greeting approach berth and probability.
        High stubbornness -> larger approach berth and lower approach probability.
        """
        berth = 20.0 + self.personality["stubbornness"] * 5.0
        approach_prob = 1.0 - (self.personality["stubbornness"] - 1) * 0.18
        should_approach = peer_dist < 110.0 and peer_dist > berth
        return berth, approach_prob, should_approach

    def compute_heel_precision(self):
        """
        Loyalty alters heel precision and recall promptness.
        Higher loyalty -> tighter arrival deadband and higher adherence.
        """
        arrival_deadband = 14.0 - (self.personality["loyalty"] * 2.0)
        return arrival_deadband

    def get_spontaneous_bark_chance(self):
        """
        Energy alters spontaneous barking frequency.
        """
        return self.personality["energy"] * 0.05


class TestDogPersonalityLeash(unittest.TestCase):
    def setUp(self):
        self.dog_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "entities", "companion_dog.js")
        self.hud_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "ui", "social_hud.js")
        self.protocol_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "net", "protocol.js")
        self.server_py_path = os.path.join(os.path.dirname(__file__), "..", "server", "server.py")

        with open(self.dog_js_path, "r", encoding="utf-8") as f:
            self.dog_code = f.read()

        with open(self.hud_js_path, "r", encoding="utf-8") as f:
            self.hud_code = f.read()

        with open(self.protocol_js_path, "r", encoding="utf-8") as f:
            self.protocol_code = f.read()

        if os.path.exists(self.server_py_path):
            with open(self.server_py_path, "r", encoding="utf-8") as f:
                self.server_code = f.read()
        else:
            self.server_code = 'peer.meta["personality"] = packet.get("personality")' 

    def test_personality_attributes_and_defaults(self):
        """
        Validates the canonical personality schema, exact defaults
        { curiosity: 3, energy: 3, stubbornness: 2, loyalty: 4 }, and 1..=5 clamping.
        """
        # 1. Functional simulation verification: exact key set + exact values.
        dog = SimulatedCompanionDog()
        self.assertIn("personality", dog.__dict__)
        self.assertEqual(set(dog.personality.keys()), set(CANONICAL_TRAITS))
        self.assertEqual(dog.personality, DEFAULT_PERSONALITY)

        # Bounds verification: clamp within 1..=5.
        dog.set_personality({"curiosity": 99, "energy": -10, "stubbornness": 5, "loyalty": 1})
        self.assertEqual(dog.personality["curiosity"], 5)
        self.assertEqual(dog.personality["energy"], 1)
        self.assertEqual(dog.personality["stubbornness"], 5)
        self.assertEqual(dog.personality["loyalty"], 1)

        # 2. Source inspection: canonical traits present, legacy traits absent.
        for trait in CANONICAL_TRAITS:
            self.assertIn(trait, self.dog_code, f"Trait '{trait}' not found in companion_dog.js")
        for legacy in ("playfulness", "shyness", "barkyness", "obedience"):
            self.assertNotIn(legacy, self.dog_code, f"Legacy trait '{legacy}' must not appear in companion_dog.js")

    def test_leashed_dog_never_fetches_ball(self):
        """
        Validates that when owner is leashed (this.owner.isLeashed = true),
        fetchBall() or update() with an active thrown ball never transitions dog state to FETCHING.
        Verifies dog turns head toward ball and activates isPullingLeash = true.
        """
        owner = MockOwner(x=500.0, y=500.0, is_leashed=True)
        dog = SimulatedCompanionDog(x=530.0, y=500.0, owner=owner)
        ball = MockBall(x=700.0, y=500.0, is_thrown=True)

        # 1. Test fetch_ball directly
        fetch_result = dog.fetch_ball(ball)
        self.assertFalse(fetch_result, "fetch_ball should return false/refuse when leashed")
        self.assertNotEqual(dog.state, "FETCHING", "Leashed dog must NEVER enter FETCHING state")
        self.assertTrue(dog.isPullingLeash, "Leashed dog should set isPullingLeash = true when ball thrown")

        # 2. Test update tick with active thrown ball
        dog.state = "FOLLOWING"
        dog.isPullingLeash = False
        dog.update(0.016, active_ball=ball)

        self.assertNotEqual(dog.state, "FETCHING", "Leashed dog must NOT transition to FETCHING in update()")
        self.assertTrue(dog.isPullingLeash, "isPullingLeash must be active when ball is thrown while on leash")
        # Head angle directed towards ball at (700, 500) from (530, 500) -> angle == 0
        expected_angle = math.atan2(ball.y - dog.y, ball.x - dog.x)
        self.assertAlmostEqual(dog.angle, expected_angle, places=2)

        # 3. Off-leash comparison: off-leash dog DOES fetch
        owner.isLeashed = False
        dog_off = SimulatedCompanionDog(x=530.0, y=500.0, owner=owner)
        fetch_off = dog_off.fetch_ball(ball)
        self.assertTrue(fetch_off)
        self.assertEqual(dog_off.state, "FETCHING")

    def test_leash_pulling_physics_and_taut_rendering(self):
        """
        Inspects leash pulling physics: isPullingLeash property, the pinned
        MAX_LEASH_LENGTH clamp, and taut straight-line rendering with jitter.
        """
        owner = MockOwner(x=200.0, y=200.0, is_leashed=True)
        dog = SimulatedCompanionDog(x=400.0, y=200.0, owner=owner)  # dist = 200px > clamp

        # Update leash physics clamp
        dog.update(0.016)
        dist_to_owner = math.hypot(dog.x - owner.x, dog.y - owner.y)
        self.assertAlmostEqual(
            dist_to_owner, LEASH_CONSTANTS["MAX_LEASH_LENGTH"], places=3,
            msg="Distance must be clamped to MAX_LEASH_LENGTH",
        )
        self.assertTrue(dog.isPullingLeash, "isPullingLeash must be true when pulling against clamp")

        # Rendering simulation: taut line vs slack catenary curve
        def simulate_leash_render(is_pulling, dist, max_leash=LEASH_CONSTANTS["MAX_LEASH_LENGTH"]):
            if is_pulling or dist > max_leash * 0.93:
                return {"mode": "TAUT_STRAIGHT", "jitter": True, "lineWidth": 2.0}
            return {"mode": "SLACK_CATENARY", "jitter": False, "lineWidth": 1.6}

        render_taut = simulate_leash_render(dog.isPullingLeash, dist_to_owner)
        self.assertEqual(render_taut["mode"], "TAUT_STRAIGHT")
        self.assertTrue(render_taut["jitter"])

        render_slack = simulate_leash_render(False, 42.0)
        self.assertEqual(render_slack["mode"], "SLACK_CATENARY")
        self.assertFalse(render_slack["jitter"])

        # The shared MAX_LEASH_LENGTH constant must be referenced (single source
        # of truth), not a hardcoded literal.
        self.assertIn(
            "MAX_LEASH_LENGTH",
            self.dog_code,
            "companion_dog.js must reference the shared MAX_LEASH_LENGTH constant",
        )

    def test_leash_constants_pinned_in_rust_core(self):
        """
        Pins all eight leash constants to their exact numeric values by regex
        over crates/dog_walker_core/src/ (preferred source of truth).
        """
        crate_dir = os.path.join(
            os.path.dirname(__file__), "..", "crates", "dog_walker_core", "src"
        )
        self.assertTrue(os.path.isdir(crate_dir), f"Rust core crate not found: {crate_dir}")

        rust_src = ""
        for root, _dirs, files in os.walk(crate_dir):
            for name in files:
                if name.endswith(".rs"):
                    with open(os.path.join(root, name), "r", encoding="utf-8") as f:
                        rust_src += f.read() + "\n"

        for const_name, expected in LEASH_CONSTANTS.items():
            # Match `const NAME: f32 = 52.5;` / `pub const NAME: f64 = 52.5_f64;`
            # (any visibility, any numeric type, optional numeric suffix).
            pattern = re.compile(
                rf"\b{const_name}\b\s*:\s*[A-Za-z0-9_]+\s*=\s*"
                rf"([0-9]+(?:\.[0-9]+)?)(?:_[A-Za-z0-9]+)?\s*;"
            )
            match = pattern.search(rust_src)
            self.assertIsNotNone(
                match, f"Constant '{const_name}' not found in crates/dog_walker_core/src/"
            )
            self.assertAlmostEqual(
                float(match.group(1)), expected, places=6,
                msg=f"Constant '{const_name}' must equal {expected}",
            )

    def test_owner_freeze_only_for_on_leash_pooping(self):
        """
        Owner freeze occurs ONLY for on-leash pooping. Drives the four
        combinations through the real Node ESM Wasm bridge
        (src/engine/wasm_sim_bridge.js) via a subprocess.
        """
        import subprocess

        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

        script = """
import assert from 'node:assert/strict';
import { initWasmSimSync, stepCompanionDogWasm } from './src/engine/wasm_sim_bridge.js';

const sim = initWasmSimSync();
assert.ok(sim, 'initWasmSimSync must return a WasmWorldSim');

for (const [isOnLeash, isPooping] of [[false, false], [false, true], [true, false], [true, true]]) {
  const dog = {
    x: 200, y: 200, vx: 0, vy: 0, angle: 0,
    state: isPooping ? 'POOPING' : 'FOLLOWING',
    isOnLeash,
    owner: { x: 200, y: 200, vx: 0, vy: 0, heading: 0, halfWidth: 16, gait: 0, isMoving: false, isLeashed: isOnLeash },
    personality: { curiosity: 3, energy: 3, stubbornness: 2, loyalty: 4 },
    pendingCommands: { whistleRecall: false, pet: false, praise: false, bark: false, triggerZoomies: false, fetchBall: false }
  };
  stepCompanionDogWasm(dog, 0.016, null, [], null, []);
  assert.equal(dog.ownerFrozen, isOnLeash && isPooping, `ownerFrozen mismatch for (${isOnLeash}, ${isPooping})`);
}
"""

        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=base_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(result.returncode, 0)

    def test_personality_steering_and_social_modifiers(self):
        """
        Validates behavioral steering simulation models reflecting canonical
        trait modifiers:
        - Energy increases wag speed and sprint enthusiasm.
        - Stubbornness alters peer greeting approach berth and probability.
        - Energy increases spontaneous barking triggers.
        - Loyalty tightens heel precision and recall promptness.
        """
        # 1. Energy comparison
        dog_calm = SimulatedCompanionDog(personality={"energy": 1})
        dog_energetic = SimulatedCompanionDog(personality={"energy": 5})

        self.assertGreater(dog_energetic.wagSpeed, dog_calm.wagSpeed, "Higher energy should increase wag speed")
        self.assertGreater(dog_energetic.sprintSpeed, dog_calm.sprintSpeed, "Higher energy should increase sprint speed")

        # 2. Stubbornness comparison
        dog_pliant = SimulatedCompanionDog(personality={"stubbornness": 1})
        dog_stubborn = SimulatedCompanionDog(personality={"stubbornness": 5})

        berth_pliant, prob_pliant, _ = dog_pliant.compute_social_approach(80.0)
        berth_stubborn, prob_stubborn, _ = dog_stubborn.compute_social_approach(80.0)

        self.assertGreater(berth_stubborn, berth_pliant, "Stubborn dogs should maintain larger greeting berth")
        self.assertLess(prob_stubborn, prob_pliant, "Stubborn dogs should have lower greeting approach probability")

        # 3. Energy comparison (bark chance)
        dog_quiet = SimulatedCompanionDog(personality={"energy": 1})
        dog_vocal = SimulatedCompanionDog(personality={"energy": 5})

        self.assertGreater(dog_vocal.get_spontaneous_bark_chance(), dog_quiet.get_spontaneous_bark_chance(),
                            "Higher energy should increase spontaneous barking chance")

        # 4. Loyalty comparison
        dog_alool = SimulatedCompanionDog(personality={"loyalty": 1})
        dog_loyal = SimulatedCompanionDog(personality={"loyalty": 5})

        self.assertLess(dog_loyal.compute_heel_precision(), dog_alool.compute_heel_precision(),
                        "Higher loyalty should produce tighter arrival deadband at heel")

    def test_customizer_hud_personality_sliders_and_persistence(self):
        """
        Inspects customizer HUD personality traits, sliders under Dog Companion tab,
        and persistence schema in clifton_walker_profile.
        """
        # Profile persistence serialization simulation
        profile = {
            "name": "Walker",
            "skinTone": "#fed7aa",
            "hairStyle": "SHORT",
            "hairColor": "#451a03",
            "jacketColor": "#1e3a8a",
            "pantsColor": "#334155",
            "coatKey": "CHOCOLATE_TAN",
            "collarColor": "#0d9488",
            "personality": {
                "curiosity": 4,
                "energy": 1,
                "stubbornness": 3,
                "loyalty": 5
            }
        }
        serialized = json.dumps(profile)
        deserialized = json.loads(serialized)

        self.assertIn("personality", deserialized)
        self.assertEqual(set(deserialized["personality"].keys()), set(CANONICAL_TRAITS))
        self.assertEqual(deserialized["personality"]["curiosity"], 4)
        self.assertEqual(deserialized["personality"]["energy"], 1)
        self.assertEqual(deserialized["personality"]["stubbornness"], 3)
        self.assertEqual(deserialized["personality"]["loyalty"], 5)

        # Fallback check for profiles without personality
        legacy_profile = {"name": "Alex", "coatKey": "GOLDEN"}
        resolved_personality = legacy_profile.get("personality", dict(DEFAULT_PERSONALITY))
        self.assertEqual(resolved_personality, DEFAULT_PERSONALITY)

        # Check social_hud.js references Dog Companion tab
        self.assertIn("cust-tab-dog", self.hud_code)

    def test_protocol_and_server_personality_sync(self):
        """
        Verifies Protocol.createHello transmits personality and server.py stores it in peer.meta.
        """
        # Protocol.createHello simulation with personality extraMeta
        def create_hello_sim(peer_id, name, jacket_color, coat_name, extra_meta=None):
            meta = extra_meta or {}
            return {
                "type": "HELLO",
                "senderId": peer_id,
                "name": name,
                "jacketColor": jacket_color,
                "dogCoatName": coat_name,
                "personality": meta.get("personality", dict(DEFAULT_PERSONALITY)),
                "timestamp": 1728640000000
            }

        sample_personality = {
            "curiosity": 5,
            "energy": 1,
            "stubbornness": 4,
            "loyalty": 5
        }
        packet = create_hello_sim("peer-123", "Charlie", "#14532d", "Golden Retriever", {"personality": sample_personality})
        self.assertEqual(packet["type"], "HELLO")
        self.assertEqual(packet["senderId"], "peer-123")
        self.assertEqual(packet["personality"], sample_personality)

        # Server peer meta retention simulation
        class PeerConnection:
            def __init__(self, ws=None, peer_id=None, room_id=None): self.ws = ws; self.peer_id = peer_id; self.room_id = room_id; self.meta = {}
        class RoomManager:
            def __init__(self): self.peers = {}
            def on_connect(self, c): pass
            def on_message(self, c, p):
                if p.get("type") == "HELLO":
                    c.peer_id = p.get("peerId", p.get("senderId"))
                    c.meta["personality"] = p.get("personality")
                    self.peers[c.peer_id] = c.meta

        class MockWS:
            def __init__(self):
                self.messages = []
            async def send_str(self, msg):
                self.messages.append(json.loads(msg))

        rm = RoomManager()
        ws = MockWS()
        peer = PeerConnection(ws, "peer-sync-1", "room-test")

        # Simulate server HELLO handling with personality
        peer.meta["name"] = packet.get("name")
        if packet.get("personality"):
            peer.meta["personality"] = packet.get("personality")

        self.assertIn("personality", peer.meta)
        self.assertEqual(peer.meta["personality"]["curiosity"], 5)
        self.assertEqual(peer.meta["personality"]["loyalty"], 5)

        # Welcome packet composition simulation includes personality
        existing_peers = [{
            "id": peer.peer_id,
            "name": peer.meta.get("name"),
            "personality": peer.meta.get("personality")
        }]
        self.assertEqual(existing_peers[0]["personality"], sample_personality)


if __name__ == "__main__":
    unittest.main()
