"""E2E tests for HUD elements, canvas input, and modal interactions."""

from __future__ import annotations

import math
import unittest

from harness import GameSession


class UIAndInputTests(unittest.TestCase):
    def test_hud_elements_present_and_visible(self):
        with GameSession() as gs:
            for selector in (
                "#game-canvas",
                "#hud-title",
                "#hud-mode-badge",
                "#btn-customize",
            ):
                self.assertEqual(
                    gs.page.locator(selector).count(),
                    1,
                    f"{selector} not present in DOM",
                )

            box = gs.page.locator("#game-canvas").bounding_box()
            self.assertIsNotNone(box, "#game-canvas has no bounding box")
            self.assertGreater(box["width"], 100, "canvas too narrow")
            self.assertGreater(box["height"], 100, "canvas too short")
            gs.assert_no_errors()

    def test_real_canvas_click_steers_and_moves_owner(self):
        with GameSession() as gs:
            # Let the camera settle on the owner before clicking.
            gs.step_frames(10)
            s0 = gs.snapshot()
            gs.click_canvas(900, 360)
            # Wait past the 280ms single-vs-double-click disambiguation timer
            # so the game commits to a single click and calls setGait('STROLL').
            gs.page.wait_for_timeout(350)
            gs.step_frames(60)
            snap = gs.snapshot()
            owner = snap["owner"]
            self.assertNotEqual(owner["gait"], "STAND", "owner did not start walking")
            self.assertGreater(
                math.hypot(
                    owner["x"] - s0["owner"]["x"],
                    owner["y"] - s0["owner"]["y"],
                ),
                20,
                "owner did not move after canvas click",
            )
            gs.assert_no_errors()

    def test_home_sanctuary_modal_opens_and_closes_via_dom_clicks(self):
        with GameSession() as gs:
            gs.click_selector("#btn-customize")
            gs.page.wait_for_timeout(200)
            modal = gs.page.locator("#customizer-modal")
            self.assertEqual(modal.count(), 1, "#customizer-modal not in DOM")
            is_visible = modal.is_visible()
            if not is_visible:
                classes = modal.get_attribute("class") or ""
                display = modal.evaluate("el => getComputedStyle(el).display")
                self.assertTrue(
                    "open" in classes.split() or display != "none",
                    "customizer modal did not open",
                )

            # #btn-close-customizer is intentionally disabled while home-locked
            # with zero dogs, so navigate the home views instead.
            gs.click_selector("#btn-home-settings")
            gs.page.wait_for_timeout(200)
            self.assertTrue(
                gs.page.locator("#home-view-settings").is_visible(),
                "#home-view-settings did not become visible",
            )

            gs.click_selector("#btn-home-back")
            gs.page.wait_for_timeout(200)
            self.assertTrue(
                gs.page.locator("#home-view-sanctuary").is_visible(),
                "#home-view-sanctuary did not become visible after back",
            )
            gs.assert_no_errors()

    def test_proximity_chat_key_c_toggles_cleanly(self):
        with GameSession() as gs:
            gs.press_key("KeyC")
            gs.step_frames(5)
            gs.press_key("KeyC")
            gs.step_frames(5)
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
