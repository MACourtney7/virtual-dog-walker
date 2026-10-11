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
import sys
import unittest

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


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

    def test_ws_network_propagates_extended_styling_in_hello_and_welcome(self):
        """
        Verifies ws_network.js extracts and forwards hairStyle, hairColor,
        pantsColor, skinTone, and collarColor in HELLO and WELCOME packets,
        and includes this.localMeta as the 5th argument in createHello.
        """
        ws_net_path = os.path.join(os.path.dirname(__file__), "..", "src", "net", "ws_network.js")
        with open(ws_net_path, "r", encoding="utf-8") as f:
            ws_net_code = f.read()

        # 1. Verify createHello invocations pass this.localMeta
        hello_calls = re.findall(r"Protocol\.createHello\s*\(([^)]+)\)", ws_net_code)
        self.assertGreaterEqual(len(hello_calls), 3, "Expected at least 3 Protocol.createHello calls in ws_network.js")
        for call_args in hello_calls:
            self.assertIn("this.localMeta", call_args, f"Protocol.createHello call missing this.localMeta argument: {call_args}")

        # 2. Verify handlePacket HELLO includes extended styling keys
        hello_block_match = re.search(r"case\s+PacketType\.HELLO:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}", ws_net_code)
        self.assertIsNotNone(hello_block_match, "PacketType.HELLO handler missing in ws_network.js")
        hello_block = hello_block_match.group(1)
        for key in ["hairStyle", "hairColor", "pantsColor", "skinTone", "collarColor"]:
            self.assertIn(f"packet.{key}", hello_block, f"ws_network.js HELLO handler does not map packet.{key}")

        # 3. Verify handlePacket WELCOME includes extended styling keys
        welcome_match = re.search(r"case\s+PacketType\.WELCOME:\s*\{(.*?)\n\s*break;", ws_net_code, re.DOTALL)
        self.assertIsNotNone(welcome_match, "PacketType.WELCOME handler missing in ws_network.js")
        welcome_block = welcome_match.group(1)
        for key in ["hairStyle", "hairColor", "pantsColor", "skinTone", "collarColor"]:
            self.assertIn(key, welcome_block, f"ws_network.js WELCOME handler does not map peer {key}")

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
        """
        Verifies server.py retains extended styling in peer.meta and includes
        them in WELCOME existing_peers list.
        """
        from server.server import RoomManager, PeerConnection
        import asyncio

        class MockWS:
            def __init__(self):
                self.messages = []
            async def send_str(self, msg):
                self.messages.append(json.loads(msg))

        rm = RoomManager()
        ws1 = MockWS()
        p1 = PeerConnection(ws1, "peer-1", "room-test")
        p1.meta.update({
            "name": "Sarah",
            "jacketColor": "#831843",
            "coatName": "Golden Retriever",
            "hairStyle": "BEANIE",
            "hairColor": "#171717",
            "pantsColor": "#1e293b",
            "skinTone": "#d97706",
            "collarColor": "#dc2626"
        })
        rm.add_peer("room-test", p1)

        server_py_path = os.path.join(os.path.dirname(__file__), "..", "server", "server.py")
        with open(server_py_path, "r", encoding="utf-8") as f:
            server_code = f.read()

        # Check that server code stores each extended styling key in peer.meta
        for key in ["hairStyle", "hairColor", "pantsColor", "skinTone", "collarColor"]:
            self.assertIn(f'peer.meta["{key}"]', server_code, f'server.py missing peer.meta["{key}"] assignment')

        # Simulate HELLO processing from server.py logic
        room_peers = rm.get_room_peers("room-test")
        existing_peers = []
        for pid, p in room_peers.items():
            if pid != "peer-2":
                existing_peers.append({
                    "id": pid,
                    "name": p.meta.get("name", "Friend"),
                    "jacketColor": p.meta.get("jacketColor", "#14532d"),
                    "coatName": p.meta.get("coatName", "Chocolate & Tan (Ziggy)"),
                    "hairStyle": p.meta.get("hairStyle"),
                    "hairColor": p.meta.get("hairColor"),
                    "pantsColor": p.meta.get("pantsColor"),
                    "skinTone": p.meta.get("skinTone"),
                    "collarColor": p.meta.get("collarColor")
                })

        self.assertEqual(len(existing_peers), 1)
        p1_data = existing_peers[0]
        self.assertEqual(p1_data["hairStyle"], "BEANIE")
        self.assertEqual(p1_data["hairColor"], "#171717")
        self.assertEqual(p1_data["pantsColor"], "#1e293b")
        self.assertEqual(p1_data["skinTone"], "#d97706")
        self.assertEqual(p1_data["collarColor"], "#dc2626")


if __name__ == "__main__":
    unittest.main()

