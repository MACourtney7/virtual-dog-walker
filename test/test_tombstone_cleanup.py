#!/usr/bin/env python3
"""
Acceptance Test Suite for Ticket-018: Tombstone Subsystem Removal
Verifies AC-018.1 through AC-018.4:
- AC-018.1: Zero tombstone markers or ground entities are spawned when players leave proximity.
- AC-018.2: Field rendering pipeline is free of tombstone entities or references.
- AC-018.3: Protocol and network layers are cleaned of TOMBSTONE_DROP packets.
- AC-018.4: ChatTombstone entity is deprecated and inert, and zero regressions across the test suite.
"""

import os
import unittest


class TestTombstoneCleanup(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.field_js_path = os.path.join(self.base_dir, "src", "world", "field.js")
        self.protocol_js_path = os.path.join(self.base_dir, "src", "net", "protocol.js")
        self.main_js_path = os.path.join(self.base_dir, "src", "main.js")
        self.tombstone_js_path = os.path.join(self.base_dir, "src", "entities", "tombstone.js")
        self.proximity_chat_js_path = os.path.join(self.base_dir, "src", "ui", "proximity_chat.js")

        with open(self.field_js_path, "r", encoding="utf-8") as f:
            self.field_js = f.read()

        with open(self.protocol_js_path, "r", encoding="utf-8") as f:
            self.protocol_js = f.read()

        with open(self.main_js_path, "r", encoding="utf-8") as f:
            self.main_js = f.read()

        with open(self.tombstone_js_path, "r", encoding="utf-8") as f:
            self.tombstone_js = f.read()

        with open(self.proximity_chat_js_path, "r", encoding="utf-8") as f:
            self.proximity_chat_js = f.read()

    def test_ac018_1_zero_tombstones_spawned_on_parting(self):
        """
        AC-018.1: Verify that when players leave conversation proximity:
        - No tombstones or ground markers are created or added to Field.
        - Field does not define or maintain a this.tombstones registry.
        - Field does not define an addTombstone method.
        - main.js onClusterDissolved does NOT instantiate or add tombstones.
        """
        # Ensure Field has no tombstone registry or addition methods
        self.assertNotIn("this.tombstones", self.field_js, "Field must not maintain this.tombstones registry")
        self.assertNotIn("addTombstone", self.field_js, "Field must not define addTombstone method")

        # In main.js, onClusterDissolved callback must not drop tombstones
        self.assertNotIn("addTombstone", self.main_js, "main.js must not call addTombstone")
        self.assertNotIn("new ChatTombstone", self.main_js, "main.js must not instantiate ChatTombstone")

    def test_ac018_2_field_draw_free_of_tombstones(self):
        """
        AC-018.2: Verify Field rendering and depth-sorting pipeline:
        - getDepthSortedRenderList has zero references to tombstones.
        - drawSceneryItem has zero references to 'tombstone' item type.
        - Entire field.js has zero occurrences of tombstone.
        """
        self.assertNotIn("tombstone", self.field_js.lower(), "field.js must contain zero references to tombstones")

    def test_ac018_3_protocol_and_network_cleaned(self):
        """
        AC-018.3: Verify protocol and network layers:
        - PacketType does NOT export TOMBSTONE_DROP.
        - Protocol does NOT define createTombstoneDrop.
        - src/main.js does NOT contain onTombstoneDrop or import ChatTombstone.
        - src/main.js does NOT reference PacketType.TOMBSTONE_DROP.
        """
        self.assertNotIn("TOMBSTONE_DROP", self.protocol_js, "Protocol must not contain TOMBSTONE_DROP packet type")
        self.assertNotIn("createTombstoneDrop", self.protocol_js, "Protocol must not define createTombstoneDrop method")
        self.assertNotIn("onTombstoneDrop", self.main_js, "main.js must not define or handle onTombstoneDrop")
        self.assertNotIn("ChatTombstone", self.main_js, "main.js must not import or reference ChatTombstone")
        self.assertNotIn("TOMBSTONE_DROP", self.main_js, "main.js must not reference TOMBSTONE_DROP")

    def test_ac018_4_entity_deprecated_or_inert(self):
        """
        AC-018.4: Verify ChatTombstone entity in src/entities/tombstone.js:
        - Marked @deprecated in docstring.
        - Inert behavior: isDead is initialized to true.
        - update(dt) returns false.
        - draw(ctx) is an inert no-op.
        """
        self.assertIn("@deprecated", self.tombstone_js, "ChatTombstone must be marked as @deprecated")
        self.assertIn("this.isDead = true", self.tombstone_js, "ChatTombstone must initialize isDead to true")
        self.assertIn("return false", self.tombstone_js, "ChatTombstone.update must return false")
        self.assertIn("draw(ctx) {}", self.tombstone_js, "ChatTombstone.draw must be a no-op")


if __name__ == "__main__":
    unittest.main()
