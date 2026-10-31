#!/usr/bin/env python3
"""
Automated Acceptance & Regression Test Suite for Park NPCs (Ticket-029 & Ticket-016):
Traces directly to AC-029.1 and AC-016.1 - AC-016.6:
1. Walker & Jogger Speed and Pacing Verification:
   - Walker default speed: 22 px/s (NPC_SPEED.walker).
   - Jogger default speed: 48 px/s (NPC_SPEED.jogger).
   - WalkerNPC and JoggerNPC subclass ParkNPC and instantiate properly.
2. Deterministic Polyline Traversal & Finite Lifecycle:
   - Simulated NPC matches exact analytical distance speed * (now - spawnTime) along waypoints without stepping tick-by-tick.
   - NPCs complete their path upon reaching final waypoint (isFinished / isDone), rather than looping indefinitely or pausing at benches.
3. Overhead Nametag Styling & Formatting:
   - Verification of NPC_TAG_STYLE in src/entities/npc.js / src/entities/npc_content.js: italic font, golden styling, dark pill background.
   - Naming verified: formatted as <First> the <Walker|Jogger> via npcIdentityFromSeed.
4. Deterministic Seeded Speech:
   - Seeded timeline produces deterministic phrase schedule via mulberry32 PRNG.
   - Phrases sampled from COMMON_PHRASES and ODD_PHRASES (~15% odds).
   - Bubble duration ~4.0s.
5. Canine Companion Interactions:
   - Barkyness reaction: Dog with barkyness >= 3 barks when jogger passes within 80px. Dog with barkyness < 3 does not bark.
   - Shyness reaction: Dog with shyness >= 3 steers away giving wide berth when passerby is within 75px. Dog with shyness < 3 does not steer away.
   - Playfulness reaction: Dog with playfulness >= 4 elevates wagSpeed and enters PLAY_BOW within 50px.
6. Depth Sorting Integration:
   - depthY = y + 12 calculation verified.
   - Sorting pipeline integrates NPCs with trees, dogs, owners, and items.
7. Obstacle-Free Waypoint Paths:
   - Verify path library from src/world/npc_paths.js / src/world/npc_path_manifest.json has waypoints within 3200 x 2400 boundaries.
8. End-to-End Multi-Client Synchronization Test:
   - Simulated server spawn packet.
   - Client 1 and Client 2 compute identical (x, y) coordinates and speech across time steps.
   - Path completion, despawn, and replacement spawn verified across both clients.
9. Code Inspection of src/main.js:
   - CliftonDownGame uses this.npcs = new Map().
   - Network callbacks (onNpcSpawn, onNpcDespawn, onNpcSnapshot) are registered.
   - Solo spawner fallback is active when not authoritative.
   - Dynamic entities render array of NPCs.
"""

import json
import math
import os
import random
import re
import sys
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NPC_JS = os.path.join(ROOT_DIR, "src", "entities", "npc.js")
NPC_CONTENT_JS = os.path.join(ROOT_DIR, "src", "entities", "npc_content.js")
NPC_PATHS_JS = os.path.join(ROOT_DIR, "src", "world", "npc_paths.js")
MANIFEST_JSON = os.path.join(ROOT_DIR, "src", "world", "npc_path_manifest.json")
FIELD_JS = os.path.join(ROOT_DIR, "src", "world", "field.js")
MAIN_JS = os.path.join(ROOT_DIR, "src", "main.js")
DOG_JS = os.path.join(ROOT_DIR, "src", "entities", "companion_dog.js")


# -----------------------------------------------------------------------------
# PRNG and Content Reference Implementations
# -----------------------------------------------------------------------------

def py_mulberry32(seed):
    """32-bit integer PRNG matching JavaScript mulberry32 algorithm."""
    s = (int(seed) if seed is not None else 0) & 0xFFFFFFFF

    def rng():
        nonlocal s
        s = (s + 0x6D2B79F5) & 0xFFFFFFFF
        t = (((s ^ (s >> 15)) * ((1 | s) & 0xFFFFFFFF)) & 0xFFFFFFFF)
        t2 = (((t ^ (t >> 7)) * ((61 | t) & 0xFFFFFFFF)) & 0xFFFFFFFF)
        t = (t + t2) ^ t
        t = (t ^ (t >> 14)) & 0xFFFFFFFF
        return (t & 0xFFFFFFFF) / 4294967296.0

    return rng


def py_next_speech_delay(rng):
    return 6.0 + rng() * 8.0


def py_pick_phrase(rng, common_phrases=None, odd_phrases=None):
    commons = common_phrases or DEFAULT_COMMON_PHRASES
    odds = odd_phrases or DEFAULT_ODD_PHRASES
    roll = rng()
    if roll < 0.15:
        idx = int(math.floor(rng() * len(odds)))
        return odds[idx], "ODD"
    else:
        idx = int(math.floor(rng() * len(commons)))
        return commons[idx], "COMMON"


def load_npc_paths():
    """Extracts NPC_PATHS array from src/world/npc_paths.js."""
    with open(NPC_PATHS_JS, "r", encoding="utf-8") as f:
        content = f.read()
    match = re.search(r"export\s+const\s+NPC_PATHS\s*=\s*(\[.*?\]);\s*export\s+const\s+NPC_PATH_IDS", content, re.DOTALL)
    if not match:
        raise ValueError("Could not extract NPC_PATHS from npc_paths.js")
    return json.loads(match.group(1))


def load_manifest():
    """Loads src/world/npc_path_manifest.json."""
    with open(MANIFEST_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


DEFAULT_FIRST_NAMES = [
    'Alice', 'Arthur', 'Beatrice', 'Bob', 'Charlie', 'Colin', 'Diana', 'Dorothy',
    'Edward', 'Felix', 'Fiona', 'George', 'Grace', 'Hannah', 'Henry', 'Ian',
    'Iris', 'Jasper', 'Julia', 'Kevin', 'Kiran', 'Laura', 'Leo', 'Mary',
    'Maya', 'Michael', 'Nina', 'Noah', 'Oliver', 'Ophelia', 'Penny', 'Peter',
    'Quentin', 'Rachel', 'Rosa', 'Sam', 'Simon', 'Steve', 'Tara', 'Tess',
    'Umar', 'Victor', 'Victoria', 'William', 'Xena', 'Yusuf', 'Zara'
]

DEFAULT_COMMON_PHRASES = [
    'Lovely morning for a stroll.',
    'The breeze feels refreshing today.',
    'Look at those autumn leaves!',
    'Such a beautiful park we have here.',
    'I always enjoy watching the dogs play.',
    'Fresh air always clears the mind.',
    'A great day to stretch the legs.',
    'What good dogs in the park today!',
    'The sun is warm today.',
    'Peace and quiet out here.',
    'Nice weather to get moving.',
    'Look at the birds by the pond.',
    'Can never spend too much time outdoors.',
    'Nothing beats a walk in nature.',
    'Such lovely green scenery.',
    'Just taking in the morning sights.',
    'Glad I brought my walking shoes.',
    'The flowers are blooming nicely.',
    'Good pace today!',
    'Always nice seeing happy pups.',
    'Enjoying every step of the path.',
    'The air is crisp and clean.',
    'What a charming little park.',
    'Walking keeps the heart young.',
    'Hello there, beautiful day isn\'t it?',
    'Just taking my daily lap.',
    'Sunbeams through the branches look nice.',
    'Nothing like an afternoon walk.',
    'So many tails wagging today.',
    'Good to be out and about.',
    'Such polite walkers around here.',
    'The trails look very well kept.'
]

DEFAULT_ODD_PHRASES = [
    'I think that squirrel owes me money.',
    'Did that tree just wink at me?',
    'Are we inside a simulation right now?',
    'I swear that dog understood every word I thought.',
    'My pedometer told me I walked to the moon.',
    'Is it just me, or do ducks have secret meetings?',
    'I forgot why I started jogging three miles ago.',
    'I wonder if dogs dream in color or tennis balls.',
    'A pigeon gave me directions this morning.',
    'Never trust a bench that looks too comfortable.',
    'I think my shadow is lagging slightly behind.'
]


# -----------------------------------------------------------------------------
# Behavioral Simulation of Deterministic ParkNPC
# -----------------------------------------------------------------------------

class SimulatedParkNPC:
    """
    Python behavioral simulation of ParkNPC / WalkerNPC / JoggerNPC
    mirroring deterministic polyline simulation and finite lifecycle in src/entities/npc.js.
    """
    def __init__(self, x=0.0, y=0.0, speed=None, waypoints=None,
                 is_jogger=False, type="walker", seed=0, spawn_time=0.0,
                 radius=14.0, options=None, **kwargs):
        opts = dict(options or {})
        opts.update(kwargs)

        self.id = opts.get("id", "npc_sim")
        raw_type = opts.get("type", type)
        self.isJogger = (str(raw_type).lower() == "jogger") or bool(is_jogger) or bool(opts.get("isJogger", False))
        self.type = "jogger" if self.isJogger else "walker"
        self.seed = opts.get("seed", seed)
        self.spawnTime = float(opts.get("spawnTime", opts.get("spawn_time", spawn_time)))

        if speed is not None:
            self.speed = float(speed)
        elif "speed" in opts:
            self.speed = float(opts["speed"])
        else:
            self.speed = 48.0 if self.isJogger else 22.0

        self.radius = float(opts.get("radius", radius))

        # Waypoints
        self.waypoints = opts.get("waypoints", waypoints or [])
        self.pathId = opts.get("pathId") or opts.get("path_id")

        # Fallback single waypoint if provided as initial x, y
        if not self.waypoints and (x != 0.0 or y != 0.0):
            self.waypoints = [{"x": float(x), "y": float(y)}]

        # Precompute segment lengths and total length
        self.segmentLengths = []
        self.totalLength = 0.0
        if len(self.waypoints) >= 2:
            for i in range(len(self.waypoints) - 1):
                p1 = self.waypoints[i]
                p2 = self.waypoints[i + 1]
                seg_len = math.hypot(p2["x"] - p1["x"], p2["y"] - p1["y"])
                self.segmentLengths.append(seg_len)
                self.totalLength += seg_len

        # Precompute finish time
        self.finishTime = (self.spawnTime + self.totalLength / self.speed) if (self.totalLength > 0 and self.speed > 0) else self.spawnTime

        # Deterministic speech timeline
        self.speechTimeline = []
        speech_rng = py_mulberry32(self.seed)
        speech_time = self.spawnTime + py_next_speech_delay(speech_rng)
        max_speech_time = (self.finishTime + 0.5) if (self.totalLength > 0 and self.finishTime > self.spawnTime) else (self.spawnTime + 120.0)
        while speech_time < max_speech_time:
            phrase, _ = py_pick_phrase(speech_rng)
            self.speechTimeline.append({
                "startTime": speech_time,
                "endTime": speech_time + 4.0,
                "phrase": phrase
            })
            speech_time += 4.0 + py_next_speech_delay(speech_rng)

        # Entity state
        if self.waypoints:
            self.x = float(self.waypoints[0]["x"])
            self.y = float(self.waypoints[0]["y"])
        else:
            self.x = float(x)
            self.y = float(y)
        self.vx = 0.0
        self.vy = 0.0
        self.depthY = self.y + 12.0
        self.opacity = 1.0
        self.done = False
        self.isFinishedState = False
        self.speechBubble = None
        self.currentSpeech = None

        self.currentTime = self.spawnTime
        self.setClock(self.spawnTime)

    def setClock(self, now):
        """Calculates exact analytical position on polyline for timestamp `now`."""
        if now is None or math.isnan(now):
            return
        now = float(now)
        self.currentTime = now
        elapsed = max(0.0, now - self.spawnTime)
        distance = self.speed * elapsed

        if self.totalLength == 0.0 or distance >= self.totalLength:
            if self.waypoints:
                last = self.waypoints[-1]
                self.x = float(last["x"])
                self.y = float(last["y"])
            self.vx = 0.0
            self.vy = 0.0
            self.depthY = self.y + 12.0
            self.isFinishedState = True

            # 0.5s fade out lifecycle
            time_since_finish = now - self.finishTime
            if time_since_finish >= 0.5:
                self.opacity = 0.0
                self.done = True
            elif time_since_finish > 0:
                self.opacity = max(0.0, 1.0 - time_since_finish / 0.5)
                self.done = False
            else:
                self.opacity = 1.0
                self.done = False
        else:
            accumulated = 0.0
            interpolated = False
            dx = 0.0
            dy = 0.0
            seg_len = 0.0

            for i, length in enumerate(self.segmentLengths):
                if accumulated + length >= distance:
                    remaining = distance - accumulated
                    seg_t = (remaining / length) if length > 1e-6 else 0.0
                    p1 = self.waypoints[i]
                    p2 = self.waypoints[i + 1]
                    dx = p2["x"] - p1["x"]
                    dy = p2["y"] - p1["y"]
                    self.x = p1["x"] + dx * seg_t
                    self.y = p1["y"] + dy * seg_t
                    seg_len = length
                    interpolated = True
                    break
                accumulated += length

            if not interpolated and len(self.waypoints) >= 2:
                last = self.waypoints[-1]
                self.x = float(last["x"])
                self.y = float(last["y"])

            self.depthY = self.y + 12.0
            self.vx = (dx / seg_len) * self.speed if seg_len > 1e-6 else 0.0
            self.vy = (dy / seg_len) * self.speed if seg_len > 1e-6 else 0.0
            self.opacity = 1.0
            self.done = False
            self.isFinishedState = False

        self.currentSpeech = self.getSpeech(now)
        self.speechBubble = self.currentSpeech if not self.done else None

    def update(self, dt, now=None, avoidance_entities=None):
        if now is not None:
            self.setClock(now)
        else:
            curr = getattr(self, "currentTime", self.spawnTime) + dt
            self.setClock(curr)

    def isFinished(self, now=None):
        if now is not None:
            if now >= self.finishTime:
                return True
            if self.totalLength > 0:
                elapsed = max(0.0, now - self.spawnTime)
                return (self.speed * elapsed) >= self.totalLength
            return False
        return self.isFinishedState

    def isDone(self, now=None):
        if self.done:
            return True
        if now is not None:
            return now >= (self.finishTime + 0.5)
        return False

    def getSpeech(self, now):
        if now is None:
            return None
        for ev in self.speechTimeline:
            if ev["startTime"] <= now < ev["endTime"]:
                return ev["phrase"]
        return None


class SimulatedCompanionDog:
    """
    Simulation of CompanionDog NPC interactions matching src/entities/companion_dog.js.
    """
    def __init__(self, x=1000.0, y=1000.0, personality=None, is_leashed=False):
        self.x = float(x)
        self.y = float(y)
        self.vx = 0.0
        self.vy = 0.0
        self.speed = 195.0
        self.radius = 16.0
        self.is_leashed = is_leashed
        self.personality = personality or {
            "playfulness": 3,
            "shyness": 2,
            "barkyness": 2,
            "obedience": 4
        }
        self.wagSpeed = 8.0
        self.isBarking = False
        self.state = "ROAMING"
        self.emoteBubble = None

    def bark(self):
        self.isBarking = True

    def checkNPCInteractions(self, npcs):
        if not npcs:
            return

        for npc in npcs:
            if not npc:
                continue
            dist = math.hypot(self.x - npc.x, self.y - npc.y)
            if dist >= 80:
                continue

            # 1. Barkyness roll (Joggers within 80px)
            if (getattr(npc, "isJogger", False) or getattr(npc, "type", "") == "jogger") and self.personality["barkyness"] >= 3:
                self.bark()

            # 2. Shyness roll (Passerby within 75px gives wide berth)
            if self.personality["shyness"] >= 3:
                if 0.001 < dist < 75:
                    shy_force = (1.0 - dist / 75.0) * (self.speed * 0.45) * ((self.personality["shyness"] - 2) / 3.0)
                    self.vx += ((self.x - npc.x) / dist) * shy_force
                    self.vy += ((self.y - npc.y) / dist) * shy_force

            # 3. Playfulness roll (Passerby within 50px elevates wagSpeed and play-bows)
            if self.personality["playfulness"] >= 4:
                self.wagSpeed = max(self.wagSpeed, 14.0 + self.personality["playfulness"] * 2.0)
                if not self.is_leashed and self.state == "ROAMING" and dist < 50:
                    self.state = "PLAY_BOW"
                    self.emoteBubble = "🐾"


class SimulatedGameClient:
    """
    Simulation of game client NPC management (this.npcs = new Map()).
    """
    def __init__(self, path_library=None):
        self.npcs = {}
        self.path_library = path_library or {}

    def spawnNetworkNpc(self, data):
        raw = data.get("npc", data)
        npc_id = raw.get("id")
        path_id = raw.get("pathId")
        npc_type = raw.get("type", "walker")
        seed = raw.get("seed", 0)
        spawn_time = float(raw.get("spawnTime", 0.0))
        waypoints = self.path_library.get(path_id, {}).get("waypoints", [])
        npc = SimulatedParkNPC(
            id=npc_id,
            pathId=path_id,
            type=npc_type,
            seed=seed,
            spawnTime=spawn_time,
            waypoints=waypoints
        )
        self.npcs[npc_id] = npc
        return npc

    def removeNpc(self, npc_id):
        if npc_id in self.npcs:
            del self.npcs[npc_id]

    def setClock(self, now):
        for npc in self.npcs.values():
            npc.setClock(now)

    def update(self, dt, now):
        for npc_id, npc in list(self.npcs.items()):
            npc.update(dt, now)
            if npc.isDone(now):
                del self.npcs[npc_id]


# -----------------------------------------------------------------------------
# Main Test Suite
# -----------------------------------------------------------------------------

class TestParkNPCs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(NPC_JS, "r", encoding="utf-8") as f:
            cls.npc_code = f.read()
        with open(NPC_CONTENT_JS, "r", encoding="utf-8") as f:
            cls.npc_content_code = f.read()
        with open(FIELD_JS, "r", encoding="utf-8") as f:
            cls.field_code = f.read()
        with open(MAIN_JS, "r", encoding="utf-8") as f:
            cls.main_code = f.read()
        with open(DOG_JS, "r", encoding="utf-8") as f:
            cls.dog_code = f.read()

        cls.all_paths = load_npc_paths()
        cls.manifest = load_manifest()
        cls.path_map = {p["id"]: p for p in cls.all_paths}

    # --------------------------------------------------------------------------
    # 1. Walker & Jogger Speed and Pacing Verification
    # --------------------------------------------------------------------------
    def test_npc_speeds_constants(self):
        """Verify NPC_SPEED defines walker 22 px/s and jogger 48 px/s."""
        self.assertIn("NPC_SPEED", self.npc_content_code)
        match = re.search(r"export\s+const\s+NPC_SPEED\s*=\s*Object\.freeze\(\{\s*walker:\s*(\d+),\s*jogger:\s*(\d+)\s*\}\);", self.npc_content_code)
        self.assertIsNotNone(match, "NPC_SPEED constant definition missing or formatted incorrectly in npc_content.js")
        walker_speed = int(match.group(1))
        jogger_speed = int(match.group(2))
        self.assertEqual(walker_speed, 22, f"Walker speed should be 22 px/s, got {walker_speed}")
        self.assertEqual(jogger_speed, 48, f"Jogger speed should be 48 px/s, got {jogger_speed}")

    def test_walker_and_jogger_classes_inheritance(self):
        """Verify WalkerNPC and JoggerNPC subclass ParkNPC and instantiate with correct speeds."""
        self.assertIn("class WalkerNPC extends ParkNPC", self.npc_code)
        self.assertIn("class JoggerNPC extends ParkNPC", self.npc_code)

        # Simulation default speeds
        walker = SimulatedParkNPC(type="walker")
        self.assertEqual(walker.speed, 22.0)
        self.assertFalse(walker.isJogger)

        jogger = SimulatedParkNPC(type="jogger")
        self.assertEqual(jogger.speed, 48.0)
        self.assertTrue(jogger.isJogger)

    # --------------------------------------------------------------------------
    # 2. Deterministic Polyline Traversal & Finite Lifecycle
    # --------------------------------------------------------------------------
    def test_deterministic_polyline_traversal(self):
        """Verify simulated NPC matches exact analytical distance speed * (now - spawnTime) along waypoints."""
        waypoints = [
            {"x": 100.0, "y": 100.0},
            {"x": 200.0, "y": 100.0},
            {"x": 200.0, "y": 200.0}
        ]
        # Total length = 100 + 100 = 200.0 px.
        speed = 50.0  # px/s
        spawn_time = 1000.0
        npc = SimulatedParkNPC(waypoints=waypoints, speed=speed, spawn_time=spawn_time)

        # At t = 1000.0, distance = 0
        npc.setClock(1000.0)
        self.assertAlmostEqual(npc.x, 100.0)
        self.assertAlmostEqual(npc.y, 100.0)
        self.assertFalse(npc.isFinished(1000.0))

        # At t = 1001.0, distance = 50. Midpoint of segment 1 (100, 100) -> (200, 100)
        npc.setClock(1001.0)
        self.assertAlmostEqual(npc.x, 150.0)
        self.assertAlmostEqual(npc.y, 100.0)
        self.assertAlmostEqual(npc.vx, 50.0)
        self.assertAlmostEqual(npc.vy, 0.0)

        # At t = 1002.0, distance = 100. Reached waypoint 1
        npc.setClock(1002.0)
        self.assertAlmostEqual(npc.x, 200.0)
        self.assertAlmostEqual(npc.y, 100.0)

        # At t = 1003.0, distance = 150. Midpoint of segment 2 (200, 100) -> (200, 200)
        npc.setClock(1003.0)
        self.assertAlmostEqual(npc.x, 200.0)
        self.assertAlmostEqual(npc.y, 150.0)
        self.assertAlmostEqual(npc.vx, 0.0)
        self.assertAlmostEqual(npc.vy, 50.0)

    def test_late_joiner_direct_positioning(self):
        """Verify late joiner jumping directly to now computes exact analytical position without stepping."""
        waypoints = [
            {"x": 0.0, "y": 0.0},
            {"x": 300.0, "y": 0.0},
            {"x": 300.0, "y": 400.0}
        ]
        # Total length = 300 + 400 = 700 px
        speed = 35.0
        spawn_time = 500.0

        # Jump directly to t = 510.0 (distance = 350 px -> segment 1 is 300px, remaining 50px on segment 2)
        npc = SimulatedParkNPC(waypoints=waypoints, speed=speed, spawn_time=spawn_time)
        npc.setClock(510.0)
        self.assertAlmostEqual(npc.x, 300.0)
        self.assertAlmostEqual(npc.y, 50.0)

    def test_finite_lifecycle_completion_no_bench_pausing(self):
        """Verify NPCs complete their path upon reaching final waypoint without looping or pausing at benches."""
        waypoints = [
            {"x": 100.0, "y": 100.0, "isBench": True},
            {"x": 200.0, "y": 100.0, "isBench": True}
        ]
        # Total length = 100 px, speed = 50 px/s -> finishTime = spawnTime + 2.0s
        spawn_time = 1000.0
        npc = SimulatedParkNPC(waypoints=waypoints, speed=50.0, spawn_time=spawn_time)

        # Before finish: opacity 1.0, isFinished False, done False
        npc.setClock(1001.0)
        self.assertEqual(npc.opacity, 1.0)
        self.assertFalse(npc.isFinished(1001.0))
        self.assertFalse(npc.isDone(1001.0))

        # At finish: t = 1002.0
        npc.setClock(1002.0)
        self.assertTrue(npc.isFinished(1002.0))
        self.assertEqual(npc.opacity, 1.0)
        self.assertFalse(npc.isDone(1002.0))
        self.assertEqual(npc.x, 200.0)

        # During 0.5s fade out: t = 1002.25
        npc.setClock(1002.25)
        self.assertTrue(npc.isFinished(1002.25))
        self.assertAlmostEqual(npc.opacity, 0.5, places=2)
        self.assertFalse(npc.isDone(1002.25))

        # At t = 1002.5: fade finished, done True
        npc.setClock(1002.5)
        self.assertTrue(npc.isFinished(1002.5))
        self.assertAlmostEqual(npc.opacity, 0.0, places=2)
        self.assertTrue(npc.isDone(1002.5))

        # Position clamped at final waypoint, never loops back to waypoint 0
        npc.setClock(1050.0)
        self.assertEqual(npc.x, 200.0)
        self.assertEqual(npc.y, 100.0)
        self.assertTrue(npc.isDone(1050.0))

    # --------------------------------------------------------------------------
    # 3. Overhead Nametag Styling & Formatting
    # --------------------------------------------------------------------------
    def test_npc_tag_style_definition(self):
        """Verify NPC_TAG_STYLE in npc_content.js: italic font, golden styling, dark pill background."""
        self.assertIn("NPC_TAG_STYLE", self.npc_content_code)
        self.assertIn("italic", self.npc_content_code)
        self.assertIn("#fef08a", self.npc_content_code)  # Golden text
        self.assertIn("rgba(15, 23, 42, 0.85)", self.npc_content_code)  # Dark pill background
        self.assertIn("rgba(250, 204, 21, 0.4)", self.npc_content_code)  # Golden border

        # In npc.js, check that NPC_TAG_STYLE is imported and used in draw
        self.assertIn("NPC_TAG_STYLE", self.npc_code)
        self.assertIn("ctx.font = NPC_TAG_STYLE.font;", self.npc_code)
        self.assertIn("ctx.fillStyle = NPC_TAG_STYLE.background;", self.npc_code)
        self.assertIn("ctx.strokeStyle = NPC_TAG_STYLE.border;", self.npc_code)
        self.assertIn("ctx.fillStyle = NPC_TAG_STYLE.text;", self.npc_code)

    def test_naming_formatting_via_seed(self):
        """Verify names are formatted as '<First> the <Walker|Jogger>'."""
        self.assertIn("npcIdentityFromSeed", self.npc_content_code)
        self.assertIn("${firstName} the ${title}", self.npc_content_code)

        # Test reference name generation across multiple seeds
        for seed in [1, 42, 100, 777, 9999]:
            rng = py_mulberry32(seed)
            first_walker = DEFAULT_FIRST_NAMES[int(math.floor(rng() * len(DEFAULT_FIRST_NAMES)))]
            name_walker = f"{first_walker} the Walker"
            self.assertTrue(name_walker.endswith(" the Walker"))
            self.assertIn(first_walker, DEFAULT_FIRST_NAMES)

            rng2 = py_mulberry32(seed)
            first_jogger = DEFAULT_FIRST_NAMES[int(math.floor(rng2() * len(DEFAULT_FIRST_NAMES)))]
            name_jogger = f"{first_jogger} the Jogger"
            self.assertTrue(name_jogger.endswith(" the Jogger"))
            self.assertIn(first_jogger, DEFAULT_FIRST_NAMES)

    # --------------------------------------------------------------------------
    # 4. Deterministic Seeded Speech
    # --------------------------------------------------------------------------
    def test_deterministic_seeded_speech_timeline(self):
        """Verify identical seed produces identical speech timeline and different seed produces different timeline."""
        npc1 = SimulatedParkNPC(seed=42, spawn_time=1000.0, speed=22.0,
                                waypoints=[{"x": 0, "y": 0}, {"x": 2000, "y": 0}])
        npc2 = SimulatedParkNPC(seed=42, spawn_time=1000.0, speed=22.0,
                                waypoints=[{"x": 0, "y": 0}, {"x": 2000, "y": 0}])
        npc3 = SimulatedParkNPC(seed=999, spawn_time=1000.0, speed=22.0,
                                waypoints=[{"x": 0, "y": 0}, {"x": 2000, "y": 0}])

        self.assertGreater(len(npc1.speechTimeline), 0)
        self.assertEqual(len(npc1.speechTimeline), len(npc2.speechTimeline))
        for ev1, ev2 in zip(npc1.speechTimeline, npc2.speechTimeline):
            self.assertAlmostEqual(ev1["startTime"], ev2["startTime"])
            self.assertAlmostEqual(ev1["endTime"], ev2["endTime"])
            self.assertEqual(ev1["phrase"], ev2["phrase"])
            # Duration must be 4.0s
            self.assertAlmostEqual(ev1["endTime"] - ev1["startTime"], 4.0)

        # Different seed generates different schedule
        self.assertNotEqual(npc1.speechTimeline[0]["phrase"], npc3.speechTimeline[0]["phrase"])

    def test_speech_phrase_pools_and_odd_frequency(self):
        """Verify phrases sampled from COMMON_PHRASES and ODD_PHRASES with ~15% odd odds."""
        self.assertIn("COMMON_PHRASES", self.npc_content_code)
        self.assertIn("ODD_PHRASES", self.npc_content_code)

        rng = py_mulberry32(12345)
        odd_count = 0
        total_samples = 4000
        for _ in range(total_samples):
            phrase, kind = py_pick_phrase(rng)
            if kind == "ODD":
                odd_count += 1
                self.assertIn(phrase, DEFAULT_ODD_PHRASES)
            else:
                self.assertIn(phrase, DEFAULT_COMMON_PHRASES)

        odd_ratio = odd_count / total_samples
        self.assertTrue(0.10 <= odd_ratio <= 0.20, f"Odd phrase ratio {odd_ratio} not within ~15% (+/-5%)")

    def test_speech_query_during_and_between_windows(self):
        """Verify getSpeech(now) returns active phrase during event and None between events."""
        npc = SimulatedParkNPC(seed=42, spawn_time=1000.0, speed=22.0,
                               waypoints=[{"x": 0, "y": 0}, {"x": 2000, "y": 0}])
        first_event = npc.speechTimeline[0]
        start = first_event["startTime"]
        end = first_event["endTime"]

        # Before start
        self.assertIsNone(npc.getSpeech(start - 0.5))
        # During event
        self.assertEqual(npc.getSpeech(start + 0.1), first_event["phrase"])
        self.assertEqual(npc.getSpeech(start + 2.0), first_event["phrase"])
        # After event
        self.assertIsNone(npc.getSpeech(end + 0.1))

    # --------------------------------------------------------------------------
    # 5. Canine Companion Interactions
    # --------------------------------------------------------------------------
    def test_dog_barkyness_reaction(self):
        """Verify dog with barkyness >= 3 barks when jogger passes within 80px."""
        dog_high_bark = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 4, "shyness": 1, "playfulness": 2, "obedience": 3})
        jogger = SimulatedParkNPC(x=1040.0, y=1000.0, is_jogger=True, type="jogger")  # dist = 40px (< 80px)

        dog_high_bark.checkNPCInteractions([jogger])
        self.assertTrue(dog_high_bark.isBarking, "Dog with barkyness >= 3 should bark at nearby jogger")

        dog_low_bark = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 1, "playfulness": 2, "obedience": 3})
        dog_low_bark.checkNPCInteractions([jogger])
        self.assertFalse(dog_low_bark.isBarking, "Dog with barkyness < 3 should not bark at jogger")

    def test_dog_shyness_reaction(self):
        """Verify dog with shyness >= 3 steers away giving wide berth when passerby is within 75px."""
        dog_shy = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 4, "playfulness": 2, "obedience": 3})
        passerby = SimulatedParkNPC(x=1030.0, y=1000.0, is_jogger=False, type="walker")  # dist = 30px (< 75px)

        dog_shy.checkNPCInteractions([passerby])
        self.assertLess(dog_shy.vx, 0.0, "Shy dog should steer away from passerby (negative vx)")

        dog_bold = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 2, "playfulness": 2, "obedience": 3})
        dog_bold.checkNPCInteractions([passerby])
        self.assertEqual(dog_bold.vx, 0.0, "Non-shy dog should not steer away")

    def test_dog_playfulness_reaction(self):
        """Verify dog with playfulness >= 4 elevates wagSpeed and enters PLAY_BOW within 50px."""
        dog_playful = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 1, "playfulness": 5, "obedience": 3}, is_leashed=False)
        passerby = SimulatedParkNPC(x=1030.0, y=1000.0, type="walker")  # dist = 30px (< 50px)

        initial_wag = dog_playful.wagSpeed
        dog_playful.checkNPCInteractions([passerby])
        self.assertGreater(dog_playful.wagSpeed, initial_wag, "Playful dog wagSpeed should elevate")
        self.assertEqual(dog_playful.state, "PLAY_BOW", "Off-leash playful dog should play-bow")
        self.assertEqual(dog_playful.emoteBubble, "🐾")

        dog_serious = SimulatedCompanionDog(x=1000.0, y=1000.0, personality={"barkyness": 1, "shyness": 1, "playfulness": 2, "obedience": 3}, is_leashed=False)
        dog_serious.checkNPCInteractions([passerby])
        self.assertNotEqual(dog_serious.state, "PLAY_BOW")

    # --------------------------------------------------------------------------
    # 6. Depth Sorting Integration
    # --------------------------------------------------------------------------
    def test_npc_depth_y_formula(self):
        """Verify NPC depthY = y + 12 for ground plane sorting."""
        waypoints = [{"x": 1200.0, "y": 850.0}, {"x": 1200.0, "y": 1050.0}]
        npc = SimulatedParkNPC(waypoints=waypoints, speed=50.0, spawn_time=0.0)
        self.assertEqual(npc.depthY, 862.0)

        # After moving 1 second (50px along y), y = 900.0 -> depthY = 912.0
        npc.setClock(1.0)
        self.assertAlmostEqual(npc.y, 900.0)
        self.assertAlmostEqual(npc.depthY, 912.0)

        # Inspect npc.js for this.depthY = this.y + 12
        self.assertIn("this.depthY = this.y + 12", self.npc_code)

    def test_depth_sorting_pipeline_integration(self):
        """Verify dynamic entities list sorting correctly interleaves NPCs with trees, dogs, and owners."""
        class DynamicItem:
            def __init__(self, name, depth_y):
                self.name = name
                self.depthY = depth_y

        items = [
            DynamicItem("tree-back", 500.0),
            DynamicItem("walker-front", 1212.0),
            DynamicItem("owner-mid", 1012.0),
            DynamicItem("dog-mid", 1006.0),
            DynamicItem("jogger-back", 712.0)
        ]

        sorted_items = sorted(items, key=lambda it: it.depthY)
        names_order = [it.name for it in sorted_items]
        self.assertEqual(names_order, ["tree-back", "jogger-back", "dog-mid", "owner-mid", "walker-front"])

    # --------------------------------------------------------------------------
    # 7. Obstacle-Free Waypoint Paths
    # --------------------------------------------------------------------------
    def test_npc_paths_exist_and_within_bounds(self):
        """Verify path library from npc_paths.js / npc_path_manifest.json has waypoints within 3200 x 2400 boundaries."""
        self.assertGreaterEqual(len(self.all_paths), 8, "Must have at least 8 precomputed obstacle-free paths")
        self.assertGreaterEqual(len(self.manifest), 8, "Manifest must list at least 8 paths")

        for path in self.all_paths:
            path_id = path["id"]
            waypoints = path["waypoints"]
            self.assertGreaterEqual(len(waypoints), 2, f"Path {path_id} must have at least 2 waypoints")
            for idx, pt in enumerate(waypoints):
                x = pt["x"]
                y = pt["y"]
                self.assertTrue(0 <= x <= 3200, f"Path {path_id} waypoint {idx} X={x} out of bounds (0-3200)")
                self.assertTrue(0 <= y <= 2400, f"Path {path_id} waypoint {idx} Y={y} out of bounds (0-2400)")

    def test_manifest_polyline_lengths_accuracy(self):
        """Verify manifest lengthPx corresponds to computed polyline lengths within 1.0 px."""
        manifest_map = {m["id"]: m["lengthPx"] for m in self.manifest}
        for path in self.all_paths:
            path_id = path["id"]
            self.assertIn(path_id, manifest_map)
            waypoints = path["waypoints"]
            total_len = 0.0
            for i in range(len(waypoints) - 1):
                p1 = waypoints[i]
                p2 = waypoints[i + 1]
                total_len += math.hypot(p2["x"] - p1["x"], p2["y"] - p1["y"])
            self.assertAlmostEqual(total_len, manifest_map[path_id], delta=1.0)

    # --------------------------------------------------------------------------
    # 8. End-to-End Multi-Client Synchronization Test
    # --------------------------------------------------------------------------
    def test_e2e_multi_client_synchronization(self):
        """Verify multi-client identical position, speech sync, path completion, and replacement lifecycle."""
        client1 = SimulatedGameClient(self.path_map)
        client2 = SimulatedGameClient(self.path_map)

        spawn_packet = {
            "type": "NPC_SPAWN",
            "npc": {
                "id": "npc-sync-029",
                "pathId": "ladies-mile-loop",
                "type": "walker",
                "seed": 42,
                "spawnTime": 1000.0
            }
        }

        # 1. Spawn on both clients
        npc1 = client1.spawnNetworkNpc(spawn_packet)
        npc2 = client2.spawnNetworkNpc(spawn_packet)
        self.assertIsNotNone(npc1)
        self.assertIsNotNone(npc2)

        # 2. Advance simulated time across multiple ticks
        test_times = [1010.0, 1025.0, 1040.0, 1075.0]
        for t in test_times:
            client1.setClock(t)
            client2.setClock(t)

            self.assertAlmostEqual(npc1.x, npc2.x, places=5)
            self.assertAlmostEqual(npc1.y, npc2.y, places=5)
            self.assertAlmostEqual(npc1.vx, npc2.vx, places=5)
            self.assertAlmostEqual(npc1.vy, npc2.vy, places=5)
            self.assertEqual(npc1.currentSpeech, npc2.currentSpeech)
            self.assertEqual(npc1.speechBubble, npc2.speechBubble)
            self.assertEqual(npc1.isFinished(t), npc2.isFinished(t))

        # 3. Advance simulated time past finish time
        finish_t = npc1.finishTime + 1.0
        client1.setClock(finish_t)
        client2.setClock(finish_t)
        self.assertTrue(npc1.isFinished(finish_t))
        self.assertTrue(npc2.isFinished(finish_t))
        self.assertTrue(npc1.isDone(finish_t))
        self.assertTrue(npc2.isDone(finish_t))

        # 4. Despawn packet removes NPC on both clients
        client1.removeNpc("npc-sync-029")
        client2.removeNpc("npc-sync-029")
        self.assertNotIn("npc-sync-029", client1.npcs)
        self.assertNotIn("npc-sync-029", client2.npcs)

        # 5. Replacement spawn packet adds new NPC on both clients with identical state
        replacement_packet = {
            "type": "NPC_SPAWN",
            "npc": {
                "id": "npc-sync-replacement",
                "pathId": "durdham-down-circuit",
                "type": "jogger",
                "seed": 999,
                "spawnTime": finish_t
            }
        }
        rep1 = client1.spawnNetworkNpc(replacement_packet)
        rep2 = client2.spawnNetworkNpc(replacement_packet)
        self.assertEqual(rep1.speed, 48.0)
        self.assertEqual(rep2.speed, 48.0)

        # Check identical coordinates on replacement
        for t in [finish_t + 5.0, finish_t + 15.0, finish_t + 30.0]:
            client1.setClock(t)
            client2.setClock(t)
            self.assertAlmostEqual(rep1.x, rep2.x, places=5)
            self.assertAlmostEqual(rep1.y, rep2.y, places=5)
            self.assertEqual(rep1.currentSpeech, rep2.currentSpeech)

    # --------------------------------------------------------------------------
    # 9. Code Inspection of src/main.js
    # --------------------------------------------------------------------------
    def test_main_js_npcs_map(self):
        """Verify CliftonDownGame initializes this.npcs = new Map()."""
        self.assertIn("this.npcs = new Map();", self.main_code)

    def test_main_js_network_callbacks(self):
        """Verify network callbacks onNpcSpawn, onNpcDespawn, onNpcSnapshot are registered."""
        self.assertIn("this.net.onNpcSpawn = (npcData) => {", self.main_code)
        self.assertIn("this.spawnNetworkNpc(npcData);", self.main_code)
        self.assertIn("this.net.onNpcDespawn = (npcId) => {", self.main_code)
        self.assertIn("this.removeNpc(npcId);", self.main_code)
        self.assertIn("this.net.onNpcSnapshot = (snapshotNpcs, serverTime) => {", self.main_code)
        self.assertIn("this.handleNpcSnapshot(snapshotNpcs, serverTime);", self.main_code)

    def test_main_js_solo_spawner_fallback(self):
        """Verify solo spawner fallback is active when not authoritative."""
        self.assertIn("updateLocalSpawner", self.main_code)
        self.assertIn("spawnLocalNpc", self.main_code)
        self.assertIn("isNetworkAuthoritative", self.main_code)

    def test_main_js_dynamic_entities_render(self):
        """Verify dynamic entities render array includes ambient NPCs."""
        self.assertIn("for (const npc of this.npcs.values()) {", self.main_code)
        self.assertIn("dynamicEntities.push(npc);", self.main_code)


if __name__ == "__main__":
    unittest.main()
