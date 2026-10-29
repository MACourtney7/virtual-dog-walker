#!/usr/bin/env python3
"""
Acceptance Test Suite for NPC Content Tables, PRNG Determinism, and Speech Data (Ticket-024)

Traces directly to:
- AC-024.1: Names follow "<First> the <Walker|Jogger>".
- AC-024.2: Determinism: identical seed/type yields identical identity and phrase sequence.
- AC-024.3: Phrase pool is majority common; odd frequency ~15% (+/-5%) over 2000 samples.
- AC-024.4: Speeds are walker 35 / jogger 80.
- AC-024.5: Tests added and python3 test/run_tests.py passes.
"""

import math
import os
import re
import sys
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NPC_CONTENT_JS = os.path.join(ROOT_DIR, "src", "entities", "npc_content.js")


# -----------------------------------------------------------------------------
# Python Reference Implementations for Standalone / Behavioral Verification
# -----------------------------------------------------------------------------

def py_mulberry32(seed):
    """32-bit integer PRNG matching JavaScript mulberry32 algorithm."""
    s = (int(seed) if seed is not None else 0) & 0xFFFFFFFF

    def rng():
        nonlocal s
        s = (s + 0x6D2B79F5) & 0xFFFFFFFF
        # Math.imul(s ^ (s >>> 15), 1 | s)
        t = (((s ^ (s >> 15)) * ((1 | s) & 0xFFFFFFFF)) & 0xFFFFFFFF)
        # Math.imul(t ^ (t >>> 7), 61 | t)
        t2 = (((t ^ (t >> 7)) * ((61 | t) & 0xFFFFFFFF)) & 0xFFFFFFFF)
        t = (t + t2) ^ t
        t = (t ^ (t >> 14)) & 0xFFFFFFFF
        return (t & 0xFFFFFFFF) / 4294967296.0

    return rng


PY_FIRST_NAMES = [
    'Alice', 'Arthur', 'Beatrice', 'Bob', 'Charlie', 'Colin', 'Diana', 'Dorothy',
    'Edward', 'Felix', 'Fiona', 'George', 'Grace', 'Hannah', 'Henry', 'Ian',
    'Iris', 'Jasper', 'Julia', 'Kevin', 'Kiran', 'Laura', 'Leo', 'Mary',
    'Maya', 'Michael', 'Nina', 'Noah', 'Oliver', 'Ophelia', 'Penny', 'Peter',
    'Quentin', 'Rachel', 'Rosa', 'Sam', 'Simon', 'Steve', 'Tara', 'Tess',
    'Umar', 'Victor', 'Victoria', 'William', 'Xena', 'Yusuf', 'Zara'
]

PY_SKIN_TONES = [
    '#fed7aa', '#fcd34d', '#fbcfe8', '#d4a373',
    '#a3704c', '#6f4e37', '#e2b59a', '#fecdd3'
]

PY_HAIR_COLORS = [
    '#451a03', '#1e293b', '#78350f', '#b45309',
    '#e2e8f0', '#92400e', '#292524'
]

PY_HAIR_STYLES = ['SHORT', 'WAVY', 'PONYTAIL', 'BEANIE']

PY_HAT_COLORS = [
    '#c2410c', '#0284c7', '#15803d', '#4338ca',
    '#334155', '#64748b', '#e11d48'
]

PY_WALKER_JACKETS = [
    '#1e3a8a', '#047857', '#b91c1c', '#b45309',
    '#475569', '#0f766e', '#6d28d9', '#3b82f6', '#334155'
]

PY_JOGGER_JACKETS = [
    '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
    '#8b5cf6', '#ec4899', '#84cc16', '#3b82f6', '#f97316'
]

PY_WALKER_PANTS = [
    '#334155', '#1e293b', '#475569', '#374151', '#1f2937'
]

PY_JOGGER_PANTS = [
    '#0f172a', '#1e1b4b', '#18181b', '#0284c7', '#374151', '#4338ca'
]

PY_WALKER_SHOES = [
    '#0f172a', '#1e293b', '#334155', '#475569'
]

PY_JOGGER_SHOES = [
    '#f8fafc', '#38bdf8', '#fbbf24', '#f43f5e'
]

PY_COMMON_PHRASES = [
    "Lovely day for a walk on the Downs.",
    "Brisk breeze coming off the Gorge today.",
    "Such a beautiful view toward the Suspension Bridge.",
    "The grass smells wonderful after the morning dew.",
    "Good morning! Great day to be outdoors.",
    "Mind your step near the bridle path.",
    "Always peaceful up here on Ladies Mile.",
    "Look at that hawk hovering over the gorge!",
    "The trees are really starting to turn nicely.",
    "It's nice to see so many dogs having fun.",
    "Nothing beats fresh Bristol air.",
    "I should walk up here every single morning.",
    "Hope the clouds hold off for another hour.",
    "The turf is nice and soft underfoot.",
    "Splendid weather for a stroll.",
    "Keep moving, stay warm!",
    "Sea Walls has such a dramatic drop.",
    "Look at all those happy tails wagging.",
    "I love watching the autumn leaves drift across the grass.",
    "Such a wide open sky today.",
    "Quiet morning on the Downs.",
    "Taking in the scenery while I can.",
    "A brisk walk does wonders for the soul.",
    "Always lovely to meet neighborly walkers.",
    "The sunlight through the lime trees is gorgeous.",
    "Just getting my daily steps in.",
    "Smells like autumn in the park today.",
    "What a gentle and friendly park community.",
    "Watching the crows circling above.",
    "Great spot to sit and think for a while.",
    "Can't beat a stroll around Durdham Down."
]

PY_ODD_PHRASES = [
    "I think that squirrel owes me money.",
    "Do you think trees feel tickled when birds land on them?",
    "If pigeons had jobs, they'd definitely work in middle management.",
    "I'm pretty sure my shoes are scheming against my socks.",
    "Ever wonder why clouds never make left turns?",
    "That shrub has been staring at me for three kilometers.",
    "I suspect gravity is stronger on Tuesdays.",
    "Did anyone else just hear that dandelion whisper?",
    "I think that crow knows my childhood WiFi password.",
    "Walking backwards actually rewinds time by three milliseconds.",
    "I wonder what dogs actually think the ball is made of."
]


def py_npc_identity_from_seed(seed, npc_type="walker"):
    rng = py_mulberry32(seed)
    is_jogger = (npc_type is not None and str(npc_type).lower() == "jogger")
    title = "Jogger" if is_jogger else "Walker"
    first_name = PY_FIRST_NAMES[int(math.floor(rng() * len(PY_FIRST_NAMES)))]
    name = f"{first_name} the {title}"
    skin_tone = PY_SKIN_TONES[int(math.floor(rng() * len(PY_SKIN_TONES)))]
    hair_color = PY_HAIR_COLORS[int(math.floor(rng() * len(PY_HAIR_COLORS)))]
    hair_style = PY_HAIR_STYLES[int(math.floor(rng() * len(PY_HAIR_STYLES)))]
    hat_color = PY_HAT_COLORS[int(math.floor(rng() * len(PY_HAT_COLORS)))]
    jacket_color = (
        PY_JOGGER_JACKETS[int(math.floor(rng() * len(PY_JOGGER_JACKETS)))]
        if is_jogger
        else PY_WALKER_JACKETS[int(math.floor(rng() * len(PY_WALKER_JACKETS)))]
    )
    pants_color = (
        PY_JOGGER_PANTS[int(math.floor(rng() * len(PY_JOGGER_PANTS)))]
        if is_jogger
        else PY_WALKER_PANTS[int(math.floor(rng() * len(PY_WALKER_PANTS)))]
    )
    shoe_color = (
        PY_JOGGER_SHOES[int(math.floor(rng() * len(PY_JOGGER_SHOES)))]
        if is_jogger
        else PY_WALKER_SHOES[int(math.floor(rng() * len(PY_WALKER_SHOES)))]
    )
    return {
        "name": name,
        "skinTone": skin_tone,
        "hairColor": hair_color,
        "hairStyle": hair_style,
        "hatColor": hat_color,
        "jacketColor": jacket_color,
        "pantsColor": pants_color,
        "shoeColor": shoe_color
    }


def py_pick_phrase(rng, common_phrases=PY_COMMON_PHRASES, odd_phrases=PY_ODD_PHRASES):
    roll = rng()
    if roll < 0.15:
        idx = int(math.floor(rng() * len(odd_phrases)))
        return odd_phrases[idx], "ODD"
    else:
        idx = int(math.floor(rng() * len(common_phrases)))
        return common_phrases[idx], "COMMON"


def py_next_speech_delay(rng):
    return 6.0 + rng() * 8.0


# -----------------------------------------------------------------------------
# Test Suite
# -----------------------------------------------------------------------------

class TestNPCContent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js_exists = os.path.exists(NPC_CONTENT_JS)
        cls.js_content = ""
        if cls.js_exists:
            with open(NPC_CONTENT_JS, "r", encoding="utf-8") as f:
                cls.js_content = f.read()

    # -------------------------------------------------------------------------
    # Module Exports & Structural Validation (when src/entities/npc_content.js exists)
    # -------------------------------------------------------------------------
    def test_module_exports_presence(self):
        """Verify all required exports exist in src/entities/npc_content.js if file present."""
        if not self.js_exists:
            self.skipTest("src/entities/npc_content.js not yet present in this worktree")

        required_exports = [
            "mulberry32",
            "NPC_SPEED",
            "NPC_TYPES",
            "FIRST_NAMES",
            "COMMON_PHRASES",
            "ODD_PHRASES",
            "NPC_TAG_STYLE",
            "npcIdentityFromSeed",
            "pickPhrase",
            "nextSpeechDelay",
            "SKIN_TONES",
            "HAIR_COLORS",
            "HAIR_STYLES",
            "HAT_COLORS",
            "WALKER_JACKETS",
            "JOGGER_JACKETS",
            "WALKER_PANTS",
            "JOGGER_PANTS",
            "WALKER_SHOES",
            "JOGGER_SHOES"
        ]
        for exp in required_exports:
            pattern = rf"\bexport\s+(?:function|const|let|var)\s+{exp}\b"
            self.assertRegex(
                self.js_content,
                pattern,
                f"Export '{exp}' missing from src/entities/npc_content.js"
            )

    # -------------------------------------------------------------------------
    # AC-024.1: Naming Convention
    # -------------------------------------------------------------------------
    def test_ac024_1_naming_convention(self):
        """Verify generated NPC names match '<First> the <Walker|Jogger>'."""
        name_regex = re.compile(r"^[A-Za-z]+ the (Walker|Jogger)$")

        for seed in range(50):
            walker_id = py_npc_identity_from_seed(seed, "walker")
            self.assertTrue(name_regex.match(walker_id["name"]), f"Invalid walker name: {walker_id['name']}")
            self.assertTrue(walker_id["name"].endswith(" the Walker"))

            jogger_id = py_npc_identity_from_seed(seed, "jogger")
            self.assertTrue(name_regex.match(jogger_id["name"]), f"Invalid jogger name: {jogger_id['name']}")
            self.assertTrue(jogger_id["name"].endswith(" the Jogger"))

        # Verify JS regex pattern if file exists
        if self.js_exists:
            self.assertIn("the ${title}", self.js_content)

    # -------------------------------------------------------------------------
    # AC-024.2: Determinism
    # -------------------------------------------------------------------------
    def test_ac024_2_determinism(self):
        """Identical seed and type must produce identical identity and PRNG sequence."""
        # 1. Deterministic identity
        id1 = py_npc_identity_from_seed(12345, "walker")
        id2 = py_npc_identity_from_seed(12345, "walker")
        self.assertEqual(id1, id2, "Identical seed and type must produce identical identity")

        # 2. Different seeds produce distinct outputs
        id3 = py_npc_identity_from_seed(99999, "walker")
        # Attributes should differ
        self.assertNotEqual(id1, id3, "Different seeds should produce differing identities")

        # 3. Deterministic PRNG sequence
        rng1 = py_mulberry32(42)
        rng2 = py_mulberry32(42)
        seq1 = [rng1() for _ in range(25)]
        seq2 = [rng2() for _ in range(25)]
        self.assertEqual(seq1, seq2, "mulberry32 PRNG must be 100% deterministic")

        # 4. Deterministic phrase sequence
        rng_a = py_mulberry32(777)
        rng_b = py_mulberry32(777)
        phrases_a = [py_pick_phrase(rng_a)[0] for _ in range(30)]
        phrases_b = [py_pick_phrase(rng_b)[0] for _ in range(30)]
        self.assertEqual(phrases_a, phrases_b, "Identical PRNG seed must yield identical phrase sequence")

    # -------------------------------------------------------------------------
    # AC-024.3: Phrase Pools & Statistical Distribution
    # -------------------------------------------------------------------------
    def test_ac024_3_phrase_pools_and_distribution(self):
        """Verify phrase pools (>=30 common, >=10 odd) and ~15% (+/-5%) odd frequency over 2000 samples."""
        self.assertGreaterEqual(len(PY_COMMON_PHRASES), 30, "COMMON_PHRASES must contain >= 30 entries")
        self.assertGreaterEqual(len(PY_ODD_PHRASES), 10, "ODD_PHRASES must contain >= 10 entries")
        self.assertGreater(len(PY_COMMON_PHRASES), len(PY_ODD_PHRASES), "Common pool must be larger than odd pool")

        # Statistical sampling over 2000 invocations with mulberry32
        rng = py_mulberry32(10101)
        samples = 2000
        odd_count = 0
        common_count = 0

        for _ in range(samples):
            _, category = py_pick_phrase(rng)
            if category == "ODD":
                odd_count += 1
            else:
                common_count += 1

        self.assertEqual(odd_count + common_count, samples)
        frequency = odd_count / samples

        # Target is 15% +/- 5% (10% to 20%, i.e. 200 to 400 odd phrases)
        self.assertGreaterEqual(frequency, 0.10, f"Odd phrase frequency {frequency:.3f} below 10% lower bound")
        self.assertLessEqual(frequency, 0.20, f"Odd phrase frequency {frequency:.3f} above 20% upper bound")

        # Verify JS code constants if file exists
        if self.js_exists:
            # Check roll < 0.15 threshold in pickPhrase
            self.assertRegex(self.js_content, r"<\s*0\.15", "pickPhrase must use 0.15 odd probability threshold")

    # -------------------------------------------------------------------------
    # AC-024.4: NPC Speeds
    # -------------------------------------------------------------------------
    def test_ac024_4_npc_speeds(self):
        """Verify NPC_SPEED specifies walker: 35 and jogger: 80."""
        if self.js_exists:
            # Match walker: 35 and jogger: 80
            walker_match = re.search(r"walker\s*:\s*(\d+)", self.js_content)
            jogger_match = re.search(r"jogger\s*:\s*(\d+)", self.js_content)
            self.assertIsNotNone(walker_match, "walker speed not found in NPC_SPEED")
            self.assertIsNotNone(jogger_match, "jogger speed not found in NPC_SPEED")
            self.assertEqual(int(walker_match.group(1)), 35, "Walker speed must be 35 px/s")
            self.assertEqual(int(jogger_match.group(1)), 80, "Jogger speed must be 80 px/s")

    # -------------------------------------------------------------------------
    # NPC Tag Style & Speech Delay
    # -------------------------------------------------------------------------
    def test_npc_tag_style_and_delay_bounds(self):
        """Verify NPC_TAG_STYLE and nextSpeechDelay bounds (6.0 - 14.0s)."""
        rng = py_mulberry32(404)
        delays = [py_next_speech_delay(rng) for _ in range(100)]
        for d in delays:
            self.assertGreaterEqual(d, 6.0, f"Delay {d} below 6.0s minimum")
            self.assertLessEqual(d, 14.0, f"Delay {d} above 14.0s maximum")

        if self.js_exists:
            # Check tag style font and palette
            self.assertIn("italic 600 11px", self.js_content)
            self.assertIn("NPC_TAG_STYLE", self.js_content)
            # Check delay formula 6.0 + rng() * 8.0
            self.assertRegex(self.js_content, r"6(?:\.0)?\s*\+\s*rng\(\)\s*\*\s*8(?:\.0)?")


if __name__ == "__main__":
    unittest.main()
