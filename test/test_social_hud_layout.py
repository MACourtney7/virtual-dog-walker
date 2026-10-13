#!/usr/bin/env python3
"""
Unit & Acceptance Tests for HUD Top-Bar Reorganization (Ticket-019).
Validates:
- AC-019.1: Share Park and Style buttons consolidated in top-left with park badges.
- AC-019.2: Top-right corner clear across desktop and mobile viewports.
- AC-019.3: Element IDs and event listeners preserved.
- AC-019.4: Clean test integration.
"""

import os
import re
import unittest


class TestSocialHUDLayout(unittest.TestCase):
    def setUp(self):
        self.hud_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "ui", "social_hud.js")
        self.style_css_path = os.path.join(os.path.dirname(__file__), "..", "src", "style.css")

        with open(self.hud_js_path, "r", encoding="utf-8") as f:
            self.hud_js = f.read()

        with open(self.style_css_path, "r", encoding="utf-8") as f:
            self.style_css = f.read()

    def test_hud_overlay_consolidated_dom(self):
        """
        Verify that this.hudOverlay.innerHTML contains only a single <div class="hud-panel"> block
        containing #btn-room-action and #btn-customize along with The Downs title pill and #hud-player-count,
        and no second .hud-panel in #hud-overlay.
        """
        overlay_match = re.search(r'this\.hudOverlay\.innerHTML\s*=\s*`([^`]+)`', self.hud_js)
        self.assertIsNotNone(overlay_match, "Could not find this.hudOverlay.innerHTML template in social_hud.js")
        overlay_html = overlay_match.group(1)

        # Count occurrences of class="hud-panel"
        panel_occurrences = re.findall(r'class=["\'][^"\']*hud-panel[^"\']*["\']', overlay_html)
        self.assertEqual(len(panel_occurrences), 1, f"Expected exactly 1 .hud-panel in hudOverlay, found {len(panel_occurrences)}")

        # Verify #btn-room-action and #btn-customize are inside the template
        self.assertIn('id="btn-room-action"', overlay_html, "Missing #btn-room-action in hudOverlay template")
        self.assertIn('id="btn-customize"', overlay_html, "Missing #btn-customize in hudOverlay template")
        self.assertIn('The Downs', overlay_html, "Missing 'The Downs' park title pill in hudOverlay template")
        self.assertIn('id="hud-player-count"', overlay_html, "Missing #hud-player-count in hudOverlay template")
        self.assertIn('id="hud-mode-badge"', overlay_html, "Missing #hud-mode-badge in hudOverlay template")
        self.assertIn('id="btn-room-label"', overlay_html, "Missing #btn-room-label in hudOverlay template")

    def test_css_top_left_alignment(self):
        """
        Verify CSS layout rules for #hud-overlay and .hud-panel guarantee top-left alignment
        and clear top-right corner on both desktop and mobile viewports.
        """
        # Desktop #hud-overlay block
        hud_overlay_block_match = re.search(r'#hud-overlay\s*\{([^}]+)\}', self.style_css)
        self.assertIsNotNone(hud_overlay_block_match, "Could not find desktop #hud-overlay block in style.css")
        hud_overlay_css = hud_overlay_block_match.group(1)

        self.assertIn("justify-content: flex-start", hud_overlay_css, "#hud-overlay must use justify-content: flex-start")
        self.assertNotIn("justify-content: space-between", hud_overlay_css, "#hud-overlay must NOT use justify-content: space-between")

        # Desktop .hud-panel block
        hud_panel_block_match = re.search(r'\.hud-panel\s*\{([^}]+)\}', self.style_css)
        self.assertIsNotNone(hud_panel_block_match, "Could not find desktop .hud-panel block in style.css")
        hud_panel_css = hud_panel_block_match.group(1)

        self.assertIn("flex-wrap: wrap", hud_panel_css, ".hud-panel must include flex-wrap: wrap for responsive wrapping")

        # Mobile media query (@media containing max-width: 768px)
        mq_match = re.search(r'@media[^{]*max-width:\s*768px[^{]*\{([\s\S]*?)\n\}', self.style_css)
        self.assertIsNotNone(mq_match, "Could not find mobile media query containing max-width: 768px in style.css")
        mq_css = mq_match.group(1)

        # Mobile #hud-overlay rules
        mobile_overlay_match = re.search(r'#hud-overlay\s*\{([^}]+)\}', mq_css)
        self.assertIsNotNone(mobile_overlay_match, "Could not find #hud-overlay inside mobile media query")
        mobile_overlay_css = mobile_overlay_match.group(1)

        self.assertIn("justify-content: flex-start", mobile_overlay_css, "Mobile #hud-overlay must maintain justify-content: flex-start")
        self.assertNotIn("justify-content: space-between", mobile_overlay_css, "Mobile #hud-overlay must NOT use space-between")

        # Mobile .hud-panel rules
        mobile_panel_match = re.search(r'\.hud-panel\s*\{([^}]+)\}', mq_css)
        self.assertIsNotNone(mobile_panel_match, "Could not find .hud-panel inside mobile media query")
        mobile_panel_css = mobile_panel_match.group(1)
        self.assertIn("flex-wrap: wrap", mobile_panel_css, "Mobile .hud-panel must maintain flex-wrap: wrap")

    def test_button_attributes_and_listeners_preserved(self):
        """
        Verify presence of element IDs and that bindEvents attaches listeners for #btn-room-action
        and #btn-customize, and reactive methods are intact.
        """
        # Element IDs present in social_hud.js
        required_ids = [
            'btn-room-action',
            'btn-customize',
            'btn-room-label',
            'hud-mode-badge',
            'hud-player-count'
        ]
        for el_id in required_ids:
            self.assertIn(f"'{el_id}'", self.hud_js, f"ID '{el_id}' not referenced in social_hud.js")

        # Event listener wiring inside bindEvents()
        bind_events_match = re.search(r'bindEvents\(\)\s*\{([\s\S]*?)\n  \}', self.hud_js)
        self.assertIsNotNone(bind_events_match, "Could not locate bindEvents() in social_hud.js")
        bind_events_body = bind_events_match.group(1)

        self.assertIn("btnRoomAction.addEventListener('click'", bind_events_body, "Click listener for btnRoomAction missing in bindEvents()")
        self.assertIn("btnCustomize.addEventListener('click'", bind_events_body, "Click listener for btnCustomize missing in bindEvents()")

        # Reactive methods intact
        self.assertIn("updatePlayerCount(count)", self.hud_js, "updatePlayerCount method missing")
        self.assertIn("updateNetworkState(status, message)", self.hud_js, "updateNetworkState method missing")


if __name__ == '__main__':
    unittest.main()
