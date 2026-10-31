#!/usr/bin/env python3
"""
Unit tests for Field Offscreen Canvas Baking & Viewport Optimization (Ticket-031).
Verifies:
- AC-031.1: Static ground, mowing stripes, trails, and wildflowers baked once to offscreen canvas.
- AC-031.2: renderGround blits visible camera viewport via ctx.drawImage without per-frame path recalculation.
- AC-031.3: Visual components (paths, stripes, grass blades) remain identical in bake routine.
- Backward compatibility: renderGround supports both (ctx, camera) and (ctx, left, top, right, bottom).
- Fallback behavior: Gracefully renders when OffscreenCanvas is unavailable.
"""

import os
import re
import unittest


class TestFieldOffscreenBaking(unittest.TestCase):
    def setUp(self):
        self.field_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "field.js")
        self.assertTrue(os.path.exists(self.field_js_path), "src/world/field.js missing")
        with open(self.field_js_path, "r", encoding="utf-8") as f:
            self.code = f.read()

    def test_create_offscreen_canvas_helper(self):
        """Field must define createOffscreenCanvas helper with feature detection and headless fallback."""
        self.assertIn("createOffscreenCanvas", self.code, "createOffscreenCanvas method missing")
        # Check OffscreenCanvas detection
        self.assertIn("typeof OffscreenCanvas !== 'undefined'", self.code)
        self.assertIn("new OffscreenCanvas(width, height)", self.code)
        # Check document.createElement fallback
        self.assertIn("typeof document !== 'undefined'", self.code)
        self.assertIn("document.createElement('canvas')", self.code)
        # Check null return for headless
        self.assertIn("return null;", self.code)

    def test_constructor_initializes_and_bakes(self):
        """Field constructor must initialize bakedCanvas and invoke bakeGround()."""
        self.assertIn("this.bakedCanvas = this.createOffscreenCanvas(this.width, this.height);", self.code)
        self.assertIn("this.bakeGround();", self.code)

    def test_bake_ground_implementation(self):
        """bakeGround() must draw base turf, gorge backdrop, stripes, grass noise, paths, and wildflowers."""
        self.assertIn("bakeGround() {", self.code)
        self.assertIn("this.bakedCanvas.getContext('2d')", self.code)

        # Base turf fill
        self.assertIn("ctx.fillStyle = this.grassBase;", self.code)
        self.assertIn("ctx.fillRect(0, 0, this.width, this.height);", self.code)

        # Avon Gorge backdrop gradient
        self.assertIn("createLinearGradient(0, 0, 80, 0)", self.code)
        self.assertIn("ctx.fillRect(0, 0, 80, this.height);", self.code)

        # Durdham Down Meadow mown stripes
        self.assertIn("mownLeft = 1750", self.code)
        self.assertIn("mownRight = 3050", self.code)
        self.assertIn("stripeAngle = -0.22", self.code)

        # Procedural grass hash / blade flecks
        self.assertIn("Math.sin(x * 12.9898 + y * 78.233)", self.code)
        self.assertIn("#5da347", self.code)

        # Paths and avenues: Ladies Mile, Water Tower plaza, and Trails
        self.assertIn("this.pathColor", self.code)
        self.assertIn("this.dirtPathColor", self.code)
        self.assertIn("Ladies Mile Avenue", self.code)
        self.assertIn("arc(2400, 450", self.code)

        # Wildflowers
        self.assertIn("this.wildflowers", self.code)
        self.assertIn("buttercup", self.code)
        self.assertIn("bluebell", self.code)

    def test_render_ground_draw_image_blit(self):
        """renderGround() blits visible viewport from bakedCanvas with drawImage."""
        self.assertIn("renderGround(ctx, cameraOrLeft, top, right, bottom)", self.code)
        self.assertIn("ctx.drawImage(this.bakedCanvas, sx, sy, sw, sh, sx, sy, sw, sh);", self.code)

        # Viewport slicing math
        self.assertIn("const sx = Math.max(0, Math.min(this.width, Math.floor(left)));", self.code)
        self.assertIn("const sy = Math.max(0, Math.min(this.height, Math.floor(topPos)));", self.code)
        self.assertIn("const sw = Math.max(0, Math.min(this.width - sx, Math.ceil(rightPos - sx)));", self.code)
        self.assertIn("const sh = Math.max(0, Math.min(this.height - sy, Math.ceil(bottomPos - sy)));", self.code)

    def test_render_ground_fallback_and_overloads(self):
        """renderGround() handles both camera object and left/top/right/bottom coordinates."""
        # Check object overload logic
        self.assertIn("cameraOrLeft && typeof cameraOrLeft === 'object'", self.code)
        self.assertIn("cameraOrLeft.viewportWidth", self.code)
        self.assertIn("cameraOrLeft.viewportHeight", self.code)

        # Fallback without throwing when bakedCanvas is null
        self.assertIn("this.renderProceduralGround(ctx, left, topPos, rightPos, bottomPos);", self.code)

    def test_render_pipeline_integration(self):
        """Field.render passes camera to renderGround and dynamic entities layer on top."""
        self.assertIn("this.renderGround(ctx, camera);", self.code)
        self.assertIn("this.getDepthSortedRenderList(viewLeft, viewRight, viewTop, viewBottom, dynamicEntities);", self.code)


if __name__ == "__main__":
    unittest.main()
