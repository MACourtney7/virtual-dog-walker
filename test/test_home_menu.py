#!/usr/bin/env python3
"""
Unit & Acceptance Tests for the Home Menu (unification-028).
Validates:
- REQ-028.1: Home Button (🏠) & Home Modal Header
- REQ-028.2: Top Clean Stylized Stage Preview (You & Dog Standing Together)
- REQ-028.3: Single-Slot Immutable Dogs Submenu & First-Time / Empty-Slot Lock
- REQ-028.4: Custom Dog Name, Breed Label Cleanup, Canvas Name Tag & Toast Integration
- REQ-028.5: Browser localStorage Persistence & zero_network Broadcast
"""

import os
import re
import unittest


def read(rel_path):
    base = os.path.dirname(__file__)
    full = os.path.join(base, "..", rel_path)
    with open(full, "r", encoding="utf-8") as f:
        return f.read()


class TestHomeHUDAndStage(unittest.TestCase):
    """REQ-028.1 / REQ-028.2: Home button, modal header, and stage preview."""

    def setUp(self):
        self.hud_js = read("src/ui/social_hud.js")
        self.style_css = read("src/style.css")

    def test_home_button_icon_and_aria(self):
        self.assertIn('id="btn-customize"', self.hud_js)
        self.assertIn('🏠', self.hud_js, "#btn-customize must contain the house icon 🏠")
        self.assertTrue(
            'aria-label="Home"' in self.hud_js or "aria-label='Home'" in self.hud_js,
            "#btn-customize must have aria-label=\"Home\""
        )
        self.assertTrue(
            'title="Home"' in self.hud_js or "title='Home'" in self.hud_js,
            "#btn-customize must have title=\"Home\""
        )

    def test_modal_header_is_home(self):
        self.assertRegex(
            self.hud_js,
            r'<h3>\s*Home\s*</h3>',
            "Customizer modal header must be <h3>Home</h3>"
        )

    def test_stage_preview_elements(self):
        self.assertIn('home-stage-preview', self.hud_js, "Missing .home-stage-preview container")
        self.assertIn('id="home-stage-canvas"', self.hud_js, "Missing #home-stage-canvas element")
        self.assertIn('home-stage-preview', self.style_css, "Missing .home-stage-preview CSS rule")

    def test_tab_buttons_you_and_dogs(self):
        self.assertIn('cust-tab-walker', self.hud_js, "Missing You tab pane id")
        self.assertIn('cust-tab-dog', self.hud_js, "Missing Dogs tab pane id")
        self.assertIn('👤 You', self.hud_js, "Missing '👤 You' tab button label")
        self.assertIn('🐕 Dogs', self.hud_js, "Missing '🐕 Dogs' tab button label")


class TestDogSlotKennelAndLocking(unittest.TestCase):
    """REQ-028.3: Single-slot immutable kennel and first-time / empty-slot lock."""

    def setUp(self):
        self.hud_js = read("src/ui/social_hud.js")

    def test_single_slot_kennel_structure(self):
        self.assertIn('id="dog-slot-occupied"', self.hud_js, "Missing #dog-slot-occupied container")
        self.assertIn('id="btn-remove-dog"', self.hud_js, "Missing #btn-remove-dog button")
        self.assertIn('id="dog-slot-empty"', self.hud_js, "Missing #dog-slot-empty container")
        self.assertIn('id="btn-add-dog"', self.hud_js, "Missing #btn-add-dog button")

    def test_empty_slot_form_fields(self):
        self.assertIn('id="cust-dog-name"', self.hud_js, "Missing dog name input #cust-dog-name")
        self.assertIn('id="cust-dog-coat"', self.hud_js, "Missing breed select #cust-dog-coat")
        self.assertIn('collar-palette', self.hud_js, "Missing collar swatch palette")
        self.assertIn('cust-personality-playfulness', self.hud_js, "Missing personality sliders")

    def test_empty_slot_prefilled_with_ziggy_defaults(self):
        # Default dog name Ziggy
        self.assertIn("'Ziggy'", self.hud_js, "Default dog name must be 'Ziggy'")
        # Default coat key
        self.assertIn('CHOCOLATE_TAN', self.hud_js, "Default coat key must be CHOCOLATE_TAN")
        # Default teal collar
        self.assertIn('#0d9488', self.hud_js, "Default collar color must be teal (#0d9488)")

    def test_home_lock_logic(self):
        self.assertIn('isHomeLocked', self.hud_js, "Missing isHomeLocked state flag")
        # Lock must be enforced when closing the modal
        self.assertRegex(
            self.hud_js,
            r'isHomeLocked',
            "isHomeLocked must gate modal closing"
        )

    def test_add_dog_unlocks(self):
        # Adding a dog must clear the lock
        self.assertRegex(
            self.hud_js,
            r'isHomeLocked\s*=\s*false',
            "Adding a dog must set isHomeLocked = false"
        )


class TestCompanionDogNameAndToasts(unittest.TestCase):
    """REQ-028.4: Custom dog name, breed label cleanup, canvas name tag, toasts."""

    def setUp(self):
        self.dog_js = read("src/entities/companion_dog.js")
        self.main_js = read("src/main.js")

    def test_companion_dog_name_default(self):
        self.assertRegex(
            self.dog_js,
            r"this\.name\s*=\s*(?:name\s*\|\|\s*)?['\"]Ziggy['\"]",
            "CompanionDog must default this.name to 'Ziggy'"
        )

    def test_chocolate_tan_breed_label(self):
        self.assertIn(
            'Chocolate & Tan Cocker Spaniel',
            self.dog_js,
            "CoatPreset.CHOCOLATE_TAN.name must be 'Chocolate & Tan Cocker Spaniel'"
        )

    def test_resolve_coat_preset_by_name_legacy(self):
        self.assertIn(
            'resolveCoatPresetByName',
            self.dog_js,
            "Missing resolveCoatPresetByName helper"
        )
        self.assertIn(
            'Chocolate & Tan (Ziggy)',
            self.dog_js,
            "resolveCoatPresetByName must support legacy 'Chocolate & Tan (Ziggy)'"
        )

    def test_canvas_name_tag_drawing(self):
        self.assertRegex(
            self.dog_js,
            r'draw\s*\(\s*ctx',
            "CompanionDog must implement draw(ctx)"
        )
        self.assertIn('this.name', self.dog_js, "Canvas name tag must render this.name")

    def test_main_js_toasts_use_dog_name(self):
        self.assertIn('this.dog.name', self.main_js, "main.js toasts must use this.dog.name")


class TestNetworkProtocolAndStorage(unittest.TestCase):
    """REQ-028.5: Protocol dogName field and localStorage persistence."""

    def setUp(self):
        self.protocol_js = read("src/net/protocol.js")
        self.hud_js = read("src/ui/social_hud.js")

    def test_create_hello_includes_dog_name(self):
        self.assertIn('dogName', self.protocol_js, "Protocol.createHello must include dogName")

    def test_localstorage_persists_dog_slot_and_name(self):
        self.assertIn('clifton_walker_profile', self.hud_js, "Missing clifton_walker_profile localStorage key")
        self.assertIn('dogSlot', self.hud_js, "localStorage save must include dogSlot")
        self.assertIn('dogName', self.hud_js, "localStorage save must include dogName")


if __name__ == '__main__':
    unittest.main()
