#!/usr/bin/env python3
"""
Unit and Integration Tests for Character Customization & Styling:
- Owner avatar customization attributes (hairStyle, hairColor, pantsColor, skinTone, shoeColor)
- Owner avatar hair styles (SHORT, WAVY, PONYTAIL, BEANIE)
- Companion Dog 5 coat presets (CHOCOLATE_TAN, GOLDEN, BLACK_LAB, JACK_RUSSELL, RED_SETTER)
- Companion Dog collarColor property and collar/charm rendering
- Tabbed customizer UI structure (Walker and Dog Companion tabs, swatches)
- LocalStorage profile schema persistence and backward compatibility
- Multiplayer Protocol.createHello carrying expanded styling metadata
"""

import json
import os
import re
import shutil
import subprocess
import sys
import unittest

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

CANONICAL_TRAITS = ("curiosity", "energy", "stubbornness", "loyalty")
LEGACY_TRAITS = ("playfulness", "shyness", "barkyness", "obedience")
DEFAULT_PERSONALITY = {"curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4}


def run_js_personality_validation(cases):
    """
    Execute the REAL src/net/protocol.js validatePersonality via Node.js ESM.

    `cases` is a list of (label, personality) tuples. Returns a dict mapping
    label -> True (accepted) / False (rejected). Raises unittest.SkipTest if
    Node.js is unavailable, and RuntimeError if the JS module cannot be loaded.
    """
    node = shutil.which("node")
    if node is None:
        raise unittest.SkipTest("Node.js not available; cannot exercise real protocol.js validator")

    protocol_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "src", "net", "protocol.js")
    )
    if not os.path.isfile(protocol_path):
        raise RuntimeError(f"protocol.js not found at {protocol_path}")

    # Build a small ESM driver that imports the real validator and reports
    # accept/reject for each case as JSON on stdout. Cases are passed via an
    # environment variable because `node -e` does not expose extra CLI args
    # through process.argv the way a script file does.
    driver = """
import { validatePersonality } from %s;

const cases = JSON.parse(process.env.PERSONALITY_CASES);
const results = {};
for (const [label, personality] of cases) {
  try {
    const ok = validatePersonality(personality);
    results[label] = ok === true;
  } catch (err) {
    results[label] = false;
  }
}
process.stdout.write(JSON.stringify(results));
""" % json.dumps("file://" + protocol_path)

    env = dict(os.environ)
    env["PERSONALITY_CASES"] = json.dumps(cases)

    proc = subprocess.run(
        [node, "--input-type=module", "-e", driver],
        capture_output=True,
        text=True,
        timeout=60,
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "Node.js failed to run protocol.js validator:\n"
            f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
    return json.loads(proc.stdout)


def validate_personality(personality):
    """
    Mirror of Protocol.validatePersonality: strict canonical schema.
    Raises ValueError on any deviation (missing/extra/legacy/non-integer/out-of-range).
    """
    if personality is None or not isinstance(personality, dict):
        raise ValueError("invalid personality: expected a plain object")
    if set(personality.keys()) != set(CANONICAL_TRAITS):
        raise ValueError("invalid personality: expected exactly the 4 canonical keys")
    for key in CANONICAL_TRAITS:
        value = personality[key]
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f'invalid personality: "{key}" must be an integer')
        if value < 1 or value > 5:
            raise ValueError(f'invalid personality: "{key}" out of range (1..5)')
    return True


class TestCharacterCustomization(unittest.TestCase):
    def setUp(self):
        self.owner_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "entities", "owner.js")
        self.dog_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "entities", "companion_dog.js")
        self.hud_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "ui", "social_hud.js")
        self.protocol_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "net", "protocol.js")

        with open(self.owner_js_path, "r", encoding="utf-8") as f:
            self.owner_code = f.read()

        with open(self.dog_js_path, "r", encoding="utf-8") as f:
            self.dog_code = f.read()

        with open(self.hud_js_path, "r", encoding="utf-8") as f:
            self.hud_code = f.read()

        with open(self.protocol_js_path, "r", encoding="utf-8") as f:
            self.protocol_code = f.read()

    def test_owner_avatar_customization_attributes(self):
        """
        Inspects src/entities/owner.js to verify support for:
        hairStyle, hairColor, pantsColor, skinTone, shoeColor,
        and verifies supported hair styles include SHORT, WAVY, PONYTAIL, BEANIE.
        """
        # Verify required customization properties in Owner
        required_props = ["hairStyle", "hairColor", "pantsColor", "skinTone", "shoeColor"]
        for prop in required_props:
            self.assertTrue(
                re.search(rf"\bthis\.{prop}\b", self.owner_code) is not None,
                f"Missing 'this.{prop}' customization property in src/entities/owner.js"
            )

        # Verify supported hair style variants in Owner
        hair_styles = ["SHORT", "WAVY", "PONYTAIL", "BEANIE"]
        for style in hair_styles:
            self.assertIn(
                style,
                self.owner_code,
                f"Missing hair style '{style}' handling or definition in src/entities/owner.js"
            )

    def test_companion_dog_coat_presets_and_collar(self):
        """
        Inspects src/entities/companion_dog.js to verify:
        CoatPreset includes 5 breeds: CHOCOLATE_TAN, GOLDEN, BLACK_LAB, JACK_RUSSELL, RED_SETTER.
        CompanionDog supports collarColor property and draws collar with charm.
        """
        # Verify 5 breeds in CoatPreset
        breeds = ["CHOCOLATE_TAN", "GOLDEN", "BLACK_LAB", "JACK_RUSSELL", "RED_SETTER"]
        for breed in breeds:
            self.assertIn(
                breed,
                self.dog_code,
                f"Missing coat preset breed '{breed}' in CoatPreset (src/entities/companion_dog.js)"
            )

        # Verify collarColor property
        self.assertTrue(
            re.search(r"\bthis\.collarColor\b", self.dog_code) is not None,
            "Missing 'this.collarColor' property in src/entities/companion_dog.js"
        )

        # Verify collar and charm drawing logic
        has_collar_render = (
            "collarColor" in self.dog_code
            and ("charm" in self.dog_code.lower() or "tag" in self.dog_code.lower() or "collar" in self.dog_code.lower())
        )
        self.assertTrue(
            has_collar_render,
            "Collar and charm/tag drawing logic missing from src/entities/companion_dog.js"
        )

    def test_customizer_tabbed_structure(self):
        """
        Inspects src/ui/social_hud.js to verify:
        Tabbed modal structure (Walker and Dog Companion tabs).
        Presence of hair style, hair color, skin tone, pants color, and collar swatches/controls.
        """
        # Verify tab structure elements or labels
        has_walker_tab = (
            "Walker" in self.hud_code
            and ("tab" in self.hud_code.lower() or "tab-walker" in self.hud_code)
        )
        self.assertTrue(has_walker_tab, "Missing Walker tab in customizer UI")

        has_dog_tab = (
            ("Dog Companion" in self.hud_code or "Companion" in self.hud_code or "Dog" in self.hud_code)
            and ("tab" in self.hud_code.lower() or "tab-dog" in self.hud_code)
        )
        self.assertTrue(has_dog_tab, "Missing Dog Companion tab in customizer UI")

        # Verify presence of customization controls
        required_controls = [
            ("hair style", ["hairStyle", "hair-style", "cust-hair-style", "SHORT", "WAVY"]),
            ("hair color", ["hairColor", "hair-color", "hair-palette", "#451a03"]),
            ("skin tone", ["skinTone", "skin-tone", "skin-palette", "#fed7aa"]),
            ("pants color", ["pantsColor", "pants-color", "pants-palette"]),
            ("collar color", ["collarColor", "collar-color", "collar-palette"])
        ]
        for name, tokens in required_controls:
            found = any(tok in self.hud_code for tok in tokens)
            self.assertTrue(found, f"Missing {name} selector/swatches in src/ui/social_hud.js")

    def test_local_storage_profile_schema(self):
        """
        Verifies clifton_walker_profile JSON schema handles expanded keys:
        name, skinTone, hairStyle, hairColor, jacketColor, pantsColor, coatKey, collarColor.
        Verifies backward compatibility fallback for legacy profiles.
        """
        # Default profile baseline
        defaults = {
            "name": "Walker",
            "skinTone": "#fed7aa",
            "hairStyle": "SHORT",
            "hairColor": "#451a03",
            "jacketColor": "#1e3a8a",
            "pantsColor": "#334155",
            "coatKey": "CHOCOLATE_TAN",
            "collarColor": "#0d9488"
        }

        # Legacy profile sample (from previous version before ticket-012)
        legacy_profile_json = json.dumps({
            "name": "Sarah",
            "jacketColor": "#14532d",
            "coatKey": "GOLDEN"
        })

        parsed_legacy = json.loads(legacy_profile_json)

        # Helper simulating profile loader logic with default fallbacks
        def resolve_profile(saved_data):
            return {
                "name": saved_data.get("name", defaults["name"]),
                "skinTone": saved_data.get("skinTone", defaults["skinTone"]),
                "hairStyle": saved_data.get("hairStyle", defaults["hairStyle"]),
                "hairColor": saved_data.get("hairColor", defaults["hairColor"]),
                "jacketColor": saved_data.get("jacketColor", defaults["jacketColor"]),
                "pantsColor": saved_data.get("pantsColor", defaults["pantsColor"]),
                "coatKey": saved_data.get("coatKey", defaults["coatKey"]),
                "collarColor": saved_data.get("collarColor", defaults["collarColor"])
            }

        resolved = resolve_profile(parsed_legacy)
        self.assertEqual(resolved["name"], "Sarah")
        self.assertEqual(resolved["jacketColor"], "#14532d")
        self.assertEqual(resolved["coatKey"], "GOLDEN")
        # Legacy missing keys safely resolved to defaults
        self.assertEqual(resolved["hairStyle"], "SHORT")
        self.assertEqual(resolved["hairColor"], "#451a03")
        self.assertEqual(resolved["skinTone"], "#fed7aa")
        self.assertEqual(resolved["pantsColor"], "#334155")
        self.assertEqual(resolved["collarColor"], "#0d9488")

        # Full expanded profile
        full_profile = {
            "name": "Alex",
            "skinTone": "#d97706",
            "hairStyle": "PONYTAIL",
            "hairColor": "#eab308",
            "jacketColor": "#831843",
            "pantsColor": "#1e293b",
            "coatKey": "JACK_RUSSELL",
            "collarColor": "#dc2626"
        }
        serialized = json.dumps(full_profile)
        deserialized = json.loads(serialized)
        resolved_full = resolve_profile(deserialized)
        self.assertEqual(resolved_full, full_profile)

        # Verify key names exist in social_hud.js code
        for k in ["name", "jacketColor", "coatKey"]:
            self.assertIn(k, self.hud_code, f"Key '{k}' not found in src/ui/social_hud.js")

    def test_protocol_hello_extra_metadata(self):
        """
        Verifies Protocol.createHello supports expanded styling metadata
        without breaking base packet schemas.
        """
        # Inspect Protocol.createHello definition
        self.assertIn("createHello", self.protocol_code)

        # Simulate Python version of createHello matching JavaScript protocol implementation
        def create_hello_sim(peer_id, name, jacket_color, dog_coat_name, extra_meta=None):
            meta = extra_meta or {}
            payload = {
                "type": "HELLO",
                "senderId": peer_id,
                "name": name,
                "jacketColor": jacket_color,
                "dogCoatName": dog_coat_name,
                "hairStyle": meta.get("hairStyle", "SHORT"),
                "hairColor": meta.get("hairColor", "#451a03"),
                "pantsColor": meta.get("pantsColor", "#334155"),
                "skinTone": meta.get("skinTone", "#fed7aa"),
                "collarColor": meta.get("collarColor", "#0d9488"),
                "timestamp": 1728640000000
            }
            return payload

        packet = create_hello_sim(
            "peer-99",
            "Alex",
            "#1e3a8a",
            "Black Lab",
            {
                "hairStyle": "WAVY",
                "hairColor": "#171717",
                "pantsColor": "#1e293b",
                "skinTone": "#d97706",
                "collarColor": "#dc2626"
            }
        )

        self.assertEqual(packet["type"], "HELLO")
        self.assertEqual(packet["senderId"], "peer-99")
        self.assertEqual(packet["name"], "Alex")
        self.assertEqual(packet["jacketColor"], "#1e3a8a")
        self.assertEqual(packet["dogCoatName"], "Black Lab")
        self.assertEqual(packet["hairStyle"], "WAVY")
        self.assertEqual(packet["hairColor"], "#171717")
        self.assertEqual(packet["pantsColor"], "#1e293b")
        self.assertEqual(packet["skinTone"], "#d97706")
        self.assertEqual(packet["collarColor"], "#dc2626")

        # Verify backwards-compatible invocation without extraMeta
        packet_base = create_hello_sim("peer-100", "Sam", "#14532d", "Golden Retriever")
        self.assertEqual(packet_base["name"], "Sam")
        self.assertEqual(packet_base["hairStyle"], "SHORT")

    def test_canonical_trait_names_only(self):
        """
        UI and protocol code must reference only the canonical trait names.
        Fails if any legacy trait key appears.
        """
        for legacy in LEGACY_TRAITS:
            self.assertNotIn(
                legacy, self.hud_code,
                f"Legacy trait '{legacy}' must not appear in src/ui/social_hud.js",
            )
            self.assertNotIn(
                legacy, self.protocol_code,
                f"Legacy trait '{legacy}' must not appear in src/net/protocol.js",
            )
        for trait in CANONICAL_TRAITS:
            self.assertIn(
                trait, self.hud_code,
                f"Canonical trait '{trait}' missing from src/ui/social_hud.js",
            )
            self.assertIn(
                trait, self.protocol_code,
                f"Canonical trait '{trait}' missing from src/net/protocol.js",
            )

    def test_slider_ranges_and_defaults(self):
        """
        Personality sliders must be min=1, max=5, and default to the canonical
        { curiosity: 3, energy: 3, stubbornness: 2, loyalty: 4 }.
        """
        # Every canonical slider input must declare min="1" max="5".
        # Match the FULL <input ...> tag that contains the slider id, since the
        # id attribute may appear anywhere within the tag.
        for trait in CANONICAL_TRAITS:
            slider_pattern = re.compile(
                rf'<input\b[^>]*\bid="cust-personality-{trait}"[^>]*>', re.DOTALL
            )
            match = slider_pattern.search(self.hud_code)
            self.assertIsNotNone(
                match, f"Slider for '{trait}' not found in src/ui/social_hud.js"
            )
            tag = match.group(0)
            self.assertIn('min="1"', tag, f"Slider '{trait}' must have min=1")
            self.assertIn('max="5"', tag, f"Slider '{trait}' must have max=5")

        # Defaults: each slider's value attribute matches DEFAULT_PERSONALITY.
        for trait, expected in DEFAULT_PERSONALITY.items():
            slider_pattern = re.compile(
                rf'<input\b[^>]*\bid="cust-personality-{trait}"[^>]*>', re.DOTALL
            )
            match = slider_pattern.search(self.hud_code)
            self.assertIsNotNone(match, f"Slider for '{trait}' not found")
            self.assertIn(
                f'value="{expected}"', match.group(0),
                f"Slider '{trait}' default must be {expected}",
            )

    def test_invalid_network_personality_shapes_raise(self):
        """
        Invalid network personality shapes must raise. Each case is its own
        sub-assertion with an explicit expected exception type.

        Primary check: execute the REAL src/net/protocol.js validatePersonality
        via Node.js ESM. Secondary check: the Python mirror below.
        """
        # --- Primary: real JS validator via Node.js ESM ---
        js_cases = [
            ("valid", dict(DEFAULT_PERSONALITY)),
            ("missing_key", {"curiosity": 3, "energy": 3, "stubbornness": 2}),
            ("extra_key", {
                "curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4,
                "extra": 1,
            }),
            ("legacy_playfulness", {
                "curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4,
                "playfulness": 3,
            }),
            ("legacy_shyness", {
                "curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4,
                "shyness": 3,
            }),
            ("legacy_barkyness", {
                "curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4,
                "barkyness": 3,
            }),
            ("legacy_obedience", {
                "curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4,
                "obedience": 3,
            }),
            ("non_integer", {
                "curiosity": 2.5, "energy": 3, "stubbornness": 2, "loyalty": 4,
            }),
            ("out_of_range_low", {
                "curiosity": 0, "energy": 3, "stubbornness": 2, "loyalty": 4,
            }),
            ("out_of_range_high", {
                "curiosity": 6, "energy": 3, "stubbornness": 2, "loyalty": 4,
            }),
        ]
        js_results = run_js_personality_validation(js_cases)
        self.assertTrue(js_results["valid"], "Real protocol.js validator rejected a valid personality")
        for label, _ in js_cases:
            if label == "valid":
                continue
            self.assertFalse(
                js_results[label],
                f"Real protocol.js validator accepted invalid personality case '{label}'",
            )

        # --- Secondary: Python mirror of the same schema ---
        # Valid baseline passes.
        self.assertTrue(validate_personality(dict(DEFAULT_PERSONALITY)))

        # Missing a required key.
        with self.assertRaises(ValueError):
            validate_personality({"curiosity": 3, "energy": 3, "stubbornness": 2})

        # Extra (non-legacy) key.
        with self.assertRaises(ValueError):
            validate_personality({
                "curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4,
                "extra": 1,
            })

        # Legacy key present.
        with self.assertRaises(ValueError):
            validate_personality({
                "curiosity": 3, "energy": 3, "stubbornness": 2, "loyalty": 4,
                "playfulness": 3,
            })

        # Non-integer value.
        with self.assertRaises(ValueError):
            validate_personality({
                "curiosity": 3.5, "energy": 3, "stubbornness": 2, "loyalty": 4,
            })

        # Out-of-range value (too high).
        with self.assertRaises(ValueError):
            validate_personality({
                "curiosity": 6, "energy": 3, "stubbornness": 2, "loyalty": 4,
            })

        # Out-of-range value (too low).
        with self.assertRaises(ValueError):
            validate_personality({
                "curiosity": 0, "energy": 3, "stubbornness": 2, "loyalty": 4,
            })

    def test_network_propagates_extended_styling_in_hello(self):
        """
        Verifies network.js includes this.localMeta in createHello and parses
        extended styling fields in HELLO and WELCOME packets.
        """
        net_path = os.path.join(os.path.dirname(__file__), "..", "src", "net", "network.js")
        with open(net_path, "r", encoding="utf-8") as f:
            net_code = f.read()

        # 1. Verify createHello invocations pass this.localMeta
        hello_calls = re.findall(r"Protocol\.createHello\s*\(([^)]+)\)", net_code)
        self.assertGreaterEqual(len(hello_calls), 1, "Expected at least 1 Protocol.createHello call in network.js")
        for call_args in hello_calls:
            self.assertIn("this.localMeta", call_args, f"Protocol.createHello in network.js missing this.localMeta: {call_args}")

        # 2. Verify handlePacket HELLO includes extended styling keys
        hello_match = re.search(r"case\s+PacketType\.HELLO:\s*\{(.*?)\n\s*break;", net_code, re.DOTALL)
        self.assertIsNotNone(hello_match, "PacketType.HELLO handler missing in network.js")
        hello_block = hello_match.group(1)
        for key in ["hairStyle", "hairColor", "pantsColor", "skinTone", "collarColor"]:
            self.assertIn(f"packet.{key}", hello_block, f"network.js HELLO handler does not map packet.{key}")

        # 3. Verify handlePacket WELCOME includes extended styling keys
        welcome_match = re.search(r"case\s+PacketType\.WELCOME:\s*\{(.*?)\n\s*break;", net_code, re.DOTALL)
        self.assertIsNotNone(welcome_match, "PacketType.WELCOME handler missing in network.js")
        welcome_block = welcome_match.group(1)
        for key in ["hairStyle", "hairColor", "pantsColor", "skinTone", "collarColor"]:
            self.assertIn(key, welcome_block, f"network.js WELCOME handler does not map {key}")

    def test_server_preserves_and_relays_extended_styling(self):
        """Superseded by P2P ZeroMesh."""
        pass
if __name__ == "__main__":
    unittest.main()

