#!/usr/bin/env python3
"""
Dedicated Acceptance Test Suite for Ticket-023:
UI Refinements: Toolbar & Button Streamlining, Cog Icon & Chat Hotkey

Verifies:
- AC-023.1: "Share Park" button (#btn-room-action) is absent from HUD DOM.
- AC-023.2: Manual bark retired — KeyB removed from keyboard switch, #btn-touch-bark absent from touch pad, autonomous barking preserved.
- AC-023.3: Bottom toolbar (#controls-hint) removed / display none.
- AC-023.4: Speech bubble chat bar (#chat-container) contains only #chat-input (no #quick-emotes).
- AC-023.5: Style button (#btn-customize) is top-right circular cog icon button (⚙️) with no "Style" text.
- AC-023.6: Header badge shows "Online" (not "Clifton Commons") on commons connect; title is "The Downs".
- AC-023.7: KeyC toggles proximity group chat window visibility via toggleVisibility().
- AC-023.8: Proximity group chat panel has no .proximity-emoji-bar or #proximity-chat-send-btn, only #proximity-chat-input.
- AC-023.9: Full test suite integration and execution pass.
"""

import os
import re
import sys
import unittest


class TestTicket023Refinements(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        cls.main_js_path = os.path.join(cls.root_dir, "src", "main.js")
        cls.social_hud_js_path = os.path.join(cls.root_dir, "src", "ui", "social_hud.js")
        cls.touch_controls_js_path = os.path.join(cls.root_dir, "src", "ui", "touch_controls.js")
        cls.proximity_chat_js_path = os.path.join(cls.root_dir, "src", "ui", "proximity_chat.js")
        cls.companion_dog_js_path = os.path.join(cls.root_dir, "src", "entities", "companion_dog.js")
        cls.style_css_path = os.path.join(cls.root_dir, "src", "style.css")
        cls.run_tests_py_path = os.path.join(cls.root_dir, "test", "run_tests.py")

        with open(cls.main_js_path, "r", encoding="utf-8") as f:
            cls.main_js = f.read()
        with open(cls.social_hud_js_path, "r", encoding="utf-8") as f:
            cls.social_hud_js = f.read()
        with open(cls.touch_controls_js_path, "r", encoding="utf-8") as f:
            cls.touch_controls_js = f.read()
        with open(cls.proximity_chat_js_path, "r", encoding="utf-8") as f:
            cls.proximity_chat_js = f.read()
        with open(cls.companion_dog_js_path, "r", encoding="utf-8") as f:
            cls.companion_dog_js = f.read()
        with open(cls.style_css_path, "r", encoding="utf-8") as f:
            cls.style_css = f.read()
        with open(cls.run_tests_py_path, "r", encoding="utf-8") as f:
            cls.run_tests_py = f.read()

    # =========================================================================
    # AC-023.1: Share Park Button Absent from HUD DOM
    # =========================================================================
    def test_ac023_1_share_park_button_absent_from_hud(self):
        """
        Verify that #btn-room-action ("Share Park" / "Host Field") is completely absent
        from the HUD overlay DOM template.
        """
        overlay_match = re.search(r'this\.hudOverlay\.innerHTML\s*=\s*`([^`]+)`', self.social_hud_js)
        self.assertIsNotNone(overlay_match, "hudOverlay.innerHTML template missing in social_hud.js")
        overlay_html = overlay_match.group(1)

        self.assertNotIn('id="btn-room-action"', overlay_html, "btn-room-action must not exist in hudOverlay template")
        self.assertNotIn('id="btn-room-label"', overlay_html, "btn-room-label must not exist in hudOverlay template")
        self.assertNotIn('Share Park', overlay_html, "Text 'Share Park' must not appear in hudOverlay template")

        # Any code references to btn-room-action in social_hud.js must be null-guarded
        btn_action_matches = re.findall(r'getElementById\([\'"]btn-room-action[\'"]\)', self.social_hud_js)
        self.assertTrue(len(btn_action_matches) > 0, "Expected getElementById('btn-room-action') lookup to exist")
        self.assertIn('if (btnRoomAction)', self.social_hud_js, "btnRoomAction must be null-checked before attaching listeners")

    # =========================================================================
    # AC-023.2: Manual Bark Retired & Autonomous Barking Preserved
    # =========================================================================
    def test_ac023_2_manual_bark_retired_from_keyboard_and_touch(self):
        """
        Verify that manual barking is retired:
        - KeyB handler removed from keyboard input switch in main.js
        - #btn-touch-bark button removed from touch action pad in touch_controls.js
        - onBark callback removed from TouchControls instantiation
        """
        # Keyboard switch in main.js
        self.assertNotIn("case 'KeyB':", self.main_js, "KeyB must not be handled in bindInputs switch")

        # Touch controls action pad HTML template
        touch_match = re.search(r'this\.actionPad\.innerHTML\s*=\s*`([^`]+)`', self.touch_controls_js)
        self.assertIsNotNone(touch_match, "actionPad.innerHTML template missing in touch_controls.js")
        touch_pad_html = touch_match.group(1)
        self.assertNotIn('id="btn-touch-bark"', touch_pad_html, "btn-touch-bark must not be in touch pad template")
        self.assertNotIn('aria-label="Bark"', touch_pad_html, "Bark touch action button must be removed")

        # Touch callback wiring
        self.assertNotIn("onBark:", self.main_js, "onBark callback must not be passed to TouchControls")
        self.assertNotIn("bindButton('btn-touch-bark'", self.touch_controls_js, "btn-touch-bark must not be bound in touch_controls.js")

    def test_ac023_2_autonomous_barking_preserved(self):
        """
        Verify that autonomous canine barking logic is intact in companion_dog.js:
        - bark() method exists
        - personality.barkyness influences autonomous barking
        - spontaneous and reaction-based barking routines are present
        """
        self.assertIn("bark(audioEngine = null)", self.companion_dog_js, "CompanionDog.bark method must exist")
        self.assertIn("this.personality.barkyness", self.companion_dog_js, "barkyness personality trait must be used")
        self.assertIn("this.barkWaveRadius", self.companion_dog_js, "Bark wave visual representation must be preserved")
        # Reaction to joggers preserved
        self.assertIn("npc.isJogger", self.companion_dog_js, "Jogger reaction barking logic must be preserved")
        # Bark response to remote dogs preserved
        self.assertIn("dist < 260", self.companion_dog_js, "Remote dog response barking must be preserved")

    # =========================================================================
    # AC-023.3: Bottom Toolbar Controls Hint Removed
    # =========================================================================
    def test_ac023_3_bottom_toolbar_controls_hint_removed(self):
        """
        Verify that the bottom keybindings toolbar (#controls-hint) is removed/cleared in JS
        and styled with display: none !important in CSS.
        """
        # JS clearance
        self.assertIn("this.controlsHint.innerHTML = ''", self.social_hud_js, "controlsHint must be cleared in social_hud.js")
        self.assertIn("this.controlsHint.style.display = 'none'", self.social_hud_js, "controlsHint display must be set to 'none'")

        # CSS rules
        hint_css_match = re.search(r'#controls-hint\s*\{([^}]+)\}', self.style_css)
        self.assertIsNotNone(hint_css_match, "#controls-hint block missing in style.css")
        hint_css = hint_css_match.group(1)
        self.assertIn("display: none !important", hint_css, "#controls-hint must enforce display: none !important")

    # =========================================================================
    # AC-023.4: Speech Bubble Chat Bar Has Only Text Input (No Quick Emotes)
    # =========================================================================
    def test_ac023_4_speech_bubble_chat_bar_has_only_text_input(self):
        """
        Verify that speech bubble chat bar (#chat-container) contains only the text input box
        (#chat-input) with quick emote buttons (#quick-emotes) removed.
        """
        chat_bar_match = re.search(r'chatBar\.innerHTML\s*=\s*`([^`]+)`', self.social_hud_js)
        self.assertIsNotNone(chat_bar_match, "chatBar.innerHTML template missing in social_hud.js")
        chat_html = chat_bar_match.group(1)

        self.assertIn('id="chat-input"', chat_html, "#chat-input must be present in chatBar template")
        self.assertNotIn('id="quick-emotes"', chat_html, "#quick-emotes container must be removed from chatBar template")
        self.assertNotIn('class="emote-btn"', chat_html, "emote-btn buttons must be removed from chatBar template")

    # =========================================================================
    # AC-023.5: Style Button Relocated as Top-Right Cog Icon Button
    # =========================================================================
    def test_ac023_5_style_button_relocated_as_cog_icon(self):
        """
        Verify that #btn-customize is positioned top-right adjacent to the chat toggle icon,
        displays a cog icon ⚙️, contains no 'Style' text, and opens the modal.
        """
        # Template assertion
        overlay_match = re.search(r'this\.hudOverlay\.innerHTML\s*=\s*`([^`]+)`', self.social_hud_js)
        self.assertIsNotNone(overlay_match)
        overlay_html = overlay_match.group(1)

        # Ensure #btn-customize is outside .hud-panel
        panel_match = re.search(r'<div class="hud-panel">([\s\S]*?)</div>', overlay_html)
        self.assertIsNotNone(panel_match, "hud-panel missing in hudOverlay")
        panel_html = panel_match.group(1)
        self.assertNotIn('id="btn-customize"', panel_html, "#btn-customize must not be inside .hud-panel")

        # In overlay template as cog icon
        self.assertIn('id="btn-customize"', overlay_html, "#btn-customize must exist in hudOverlay")
        self.assertIn('⚙️', overlay_html, "⚙️ cog icon must be present in #btn-customize")
        self.assertNotIn('>Style<', overlay_html, "Word 'Style' text must not be rendered on the button")

        # CSS layout assertions
        cust_css_match = re.search(r'#btn-customize\s*\{([^}]+)\}', self.style_css)
        self.assertIsNotNone(cust_css_match, "#btn-customize block missing in style.css")
        cust_css = cust_css_match.group(1)
        self.assertIn("position: fixed", cust_css)
        self.assertIn("top: 16px", cust_css)
        self.assertIn("right: 66px", cust_css)
        self.assertIn("border-radius: 50%", cust_css)

        # Mobile responsiveness
        mq_match = re.search(r'@media[^{]*max-width:\s*768px[^{]*\{([\s\S]*?)\n\}', self.style_css)
        self.assertIsNotNone(mq_match, "Mobile media query missing in style.css")
        mq_css = mq_match.group(1)
        mobile_cust_match = re.search(r'#btn-customize\s*\{([^}]+)\}', mq_css)
        self.assertIsNotNone(mobile_cust_match, "#btn-customize mobile block missing")
        mobile_cust_css = mobile_cust_match.group(1)
        self.assertIn("right: 58px", mobile_cust_css)
        self.assertIn("top: 12px", mobile_cust_css)

    # =========================================================================
    # AC-023.6: Header Badge Online & Title "The Downs"
    # =========================================================================
    def test_ac023_6_header_badge_online_and_title_the_downs(self):
        """
        Verify that header shows "The Downs" as park title and badge shows "Online"
        (never "Clifton Commons") upon commons connection.
        """
        # Template title
        self.assertIn("The Downs", self.social_hud_js, "Header template must include 'The Downs'")

        # Network update logic
        self.assertIn("badge.textContent = 'Online'", self.social_hud_js, "Badge must display 'Online' on commons connect")
        self.assertNotIn("Clifton Commons", self.social_hud_js, "social_hud.js must not contain 'Clifton Commons'")

    # =========================================================================
    # AC-023.7: KeyC Toggles Proximity Group Chat Visibility
    # =========================================================================
    def test_ac023_7_key_c_toggles_proximity_chat(self):
        """
        Verify that KeyC is bound in bindInputs to toggle proximity group chat visibility,
        and is guarded against active input field typing.
        """
        # KeyC in bindInputs
        self.assertIn("case 'KeyC':", self.main_js, "KeyC must be handled in bindInputs switch")
        key_c_match = re.search(r"case 'KeyC':\s*([\s\S]*?)break;", self.main_js)
        self.assertIsNotNone(key_c_match, "KeyC case block missing in main.js")
        key_c_block = key_c_match.group(1)
        self.assertIn("toggleVisibility", key_c_block, "KeyC must invoke toggleVisibility on proximityChat")

        # Typing guard in bindInputs
        active_element_check = re.search(
            r'document\.activeElement\s*===\s*chatInput\s*\|\|\s*document\.activeElement\s*===\s*proxInput',
            self.main_js
        )
        self.assertIsNotNone(active_element_check, "Chat input focus guard must precede keyboard hotkeys")

        # ProximityChat public methods
        self.assertIn("toggleVisibility()", self.proximity_chat_js, "toggleVisibility() must exist on ProximityChat")
        self.assertIn("isVisible()", self.proximity_chat_js, "isVisible() helper must exist on ProximityChat")

    # =========================================================================
    # AC-023.8: Proximity Chat Panel Input Streamlined (No Emoji Bar / Send Btn)
    # =========================================================================
    def test_ac023_8_proximity_chat_panel_input_streamlined(self):
        """
        Verify that proximity group chat panel bottom area contains solely #proximity-chat-input,
        with .proximity-emoji-bar and #proximity-chat-send-btn completely removed.
        """
        # DOM template assertions
        input_container_match = re.search(r'id="proximity-chat-input-container"[\s\S]*?</div>\s*</div>', self.proximity_chat_js)
        self.assertIsNotNone(input_container_match, "proximity-chat-input-container missing in proximity_chat.js")
        input_container_html = input_container_match.group(0)

        self.assertIn('id="proximity-chat-input"', input_container_html, "#proximity-chat-input must be in input container")
        self.assertNotIn('class="proximity-emoji-bar"', input_container_html, "proximity-emoji-bar must be removed")
        self.assertNotIn('id="proximity-chat-send-btn"', input_container_html, "proximity-chat-send-btn must be removed")

        # CSS input bar spans cleanly
        input_css_match = re.search(r'#proximity-chat-input\s*\{([^}]+)\}', self.style_css)
        self.assertIsNotNone(input_css_match, "#proximity-chat-input block missing in style.css")
        input_css = input_css_match.group(1)
        self.assertIn("width: 100%", input_css, "#proximity-chat-input must span 100% width")

    # =========================================================================
    # AC-023.9: Full Test Runner Integration
    # =========================================================================
    def test_ac023_9_full_test_runner_integration(self):
        """
        Verify that test/run_tests.py includes test_ticket_023_refinements.py in test_suites.
        """
        self.assertIn("test/test_ticket_023_refinements.py", self.run_tests_py, "run_tests.py must list test_ticket_023_refinements.py")


if __name__ == '__main__':
    unittest.main()
