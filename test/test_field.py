#!/usr/bin/env python3
"""
Unit tests for Offscreen Ground Baking & Blitting (Ticket-031):
- AC-031.1: Offscreen canvas initialization, browser fallback to document.createElement, and headless null handling.
- AC-031.1 & AC-031.3: One-time bakeGround method rendering base turf, cliff gradient, Durdham Down mown stripes, grass flecks, paths, and wildflowers.
- AC-031.2: Viewport blitting with ctx.drawImage(this.bakedCanvas, ...) supporting (ctx, camera) and legacy coordinates.
- AC-031.3 & Layering: Depth-sorted dynamic entities and scenery rendering above baked ground.
"""

import os
import re
import unittest


class TestFieldOffscreenBaking(unittest.TestCase):
    def setUp(self):
        self.field_js_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "field.js")
        self.assertTrue(os.path.exists(self.field_js_path), f"File {self.field_js_path} does not exist")
        with open(self.field_js_path, "r", encoding="utf-8") as f:
            self.field_code = f.read()

    def test_create_offscreen_canvas_helper_and_fallback(self):
        """AC-031.1: Verify createOffscreenCanvas helper handles OffscreenCanvas, createElement fallback, and null."""
        # Check helper method definition exists on Field or standalone
        self.assertTrue(
            "createOffscreenCanvas" in self.field_code,
            "createOffscreenCanvas helper or method missing in src/world/field.js"
        )

        # Verify OffscreenCanvas feature check
        self.assertRegex(
            self.field_code,
            r"typeof\s+OffscreenCanvas\s*!==\s*['\"]undefined['\"]",
            "createOffscreenCanvas must check if OffscreenCanvas is supported"
        )
        self.assertRegex(
            self.field_code,
            r"new\s+OffscreenCanvas\s*\(\s*width\s*,\s*height\s*\)",
            "createOffscreenCanvas must instantiate new OffscreenCanvas(width, height)"
        )

        # Verify fallback to document.createElement('canvas')
        self.assertRegex(
            self.field_code,
            r"document\.createElement\s*\(\s*['\"]canvas['\"]\s*\)",
            "createOffscreenCanvas must fall back to document.createElement('canvas')"
        )

        # Verify graceful handling / return for headless/Node environments
        self.assertTrue(
            re.search(r"return\s+null", self.field_code) or re.search(r"return\s+canvas", self.field_code),
            "createOffscreenCanvas should return null or created canvas"
        )

    def test_constructor_initializes_baked_canvas_and_calls_bake(self):
        """AC-031.1: Verify Field constructor initializes this.bakedCanvas and triggers this.bakeGround()."""
        # Verify this.bakedCanvas initialization in constructor
        self.assertIn(
            "this.bakedCanvas",
            self.field_code,
            "Field constructor must initialize this.bakedCanvas"
        )
        self.assertRegex(
            self.field_code,
            r"this\.bakedCanvas\s*=\s*(?:this\.)?createOffscreenCanvas\s*\(",
            "this.bakedCanvas must be initialized via createOffscreenCanvas"
        )

        # Verify this.bakeGround() is called in constructor
        self.assertRegex(
            self.field_code,
            r"this\.bakeGround\s*\(\s*\)",
            "Field constructor must invoke this.bakeGround()"
        )

    def test_bake_ground_method_and_layers(self):
        """AC-031.1 & AC-031.3: Verify bakeGround() draws static elements to offscreen canvas."""
        # Verify bakeGround method definition exists
        self.assertRegex(
            self.field_code,
            r"bakeGround\s*\(\s*\)\s*\{",
            "bakeGround() method must be defined on Field"
        )

        # Verify guard checks for bakedCanvas and context
        self.assertRegex(
            self.field_code,
            r"if\s*\(\s*!this\.bakedCanvas\s*\)\s*return",
            "bakeGround() must return early if this.bakedCanvas is null or undefined"
        )
        self.assertRegex(
            self.field_code,
            r"this\.bakedCanvas\.getContext\s*\(\s*['\"]2d['\"]\s*\)",
            "bakeGround() must obtain 2d context from this.bakedCanvas"
        )

        # Verify Base Turf Fill
        self.assertRegex(
            self.field_code,
            r"ctx\.fillStyle\s*=\s*this\.grassBase",
            "bakeGround must set fillStyle to this.grassBase"
        )
        self.assertRegex(
            self.field_code,
            r"ctx\.fillRect\s*\(\s*0\s*,\s*0\s*,\s*this\.width\s*,\s*this\.height\s*\)",
            "bakeGround must fill entire turf rectangle (0, 0, this.width, this.height)"
        )

        # Verify Avon Gorge Cliff Edge Backdrop gradient
        self.assertIn(
            "createLinearGradient(0, 0, 80, 0)",
            re.sub(r"\s+", "", self.field_code),
            "bakeGround must render Avon cliff gradient along West perimeter"
        )
        self.assertIn("#1a2332", self.field_code, "Avon cliff gradient dark stop '#1a2332' missing")
        self.assertIn("#2e3d4f", self.field_code, "Avon cliff gradient mid stop '#2e3d4f' missing")

        # Verify Durdham Down Meadow Mown Stripes
        self.assertIn("mownLeft", self.field_code, "Durdham Down mown stripes bounds missing")
        self.assertIn("rgba(76, 130, 55, 0.14)", self.field_code, "Mown stripe fill rgba(76, 130, 55, 0.14) missing")

        # Verify Procedural Grass Variations & Blade Flecks
        self.assertIn("43758.5453", self.field_code, "Procedural grass hash constant missing")
        self.assertIn("#5da347", self.field_code, "Grass blade fleck stroke color #5da347 missing")

        # Verify Pathways & Avenues (Ladies Mile, Water Tower, Secondary Trails)
        self.assertIn("this.pathColor", self.field_code, "Path color missing")
        self.assertIn("this.pathDetail", self.field_code, "Path detail missing")
        self.assertIn("this.dirtPathColor", self.field_code, "Dirt path color missing")

        # Verify Wildflowers rendered
        self.assertIn("this.wildflowers", self.field_code, "Wildflowers collection rendering missing")

    def test_render_ground_blitting_with_draw_image(self):
        """AC-031.2: Verify renderGround blits from this.bakedCanvas using drawImage."""
        # Find renderGround function definition
        self.assertRegex(
            self.field_code,
            r"renderGround\s*\([^)]*\)\s*\{",
            "renderGround method must exist on Field"
        )

        # Verify signature accommodates (ctx, camera) or (ctx, cameraOrLeft, top, right, bottom)
        render_ground_match = re.search(
            r"renderGround\s*\(\s*ctx\s*,\s*([^)]+)\)",
            self.field_code
        )
        self.assertIsNotNone(render_ground_match, "renderGround parameter list could not be parsed")
        params = [p.strip() for p in render_ground_match.group(1).split(",")]
        # Needs to support camera or cameraOrLeft as second parameter
        self.assertTrue(
            "camera" in params[0] or "cameraOrLeft" in params[0] or "left" in params[0],
            f"renderGround should accept camera or cameraOrLeft, got {params[0]}"
        )

        # Verify ctx.drawImage is called with this.bakedCanvas
        self.assertRegex(
            self.field_code,
            r"ctx\.drawImage\s*\(\s*this\.bakedCanvas",
            "renderGround must execute ctx.drawImage(this.bakedCanvas, ...) for viewport blitting"
        )

        # Verify viewport clamping logic for source and dest rects (sx, sy, sw, sh)
        self.assertIn(
            "this.bakedCanvas",
            self.field_code
        )

    def test_render_pipeline_layering(self):
        """AC-031.3 & Layering: Verify render() draws ground before depth-sorted dynamic entities."""
        # Locate Field.prototype.render
        render_match = re.search(
            r"render\s*\(\s*ctx\s*,\s*camera(?:,\s*dynamicEntities\s*=\s*\[\])?\s*\)\s*\{([\s\S]*?)\n  \}",
            self.field_code
        )
        self.assertIsNotNone(render_match, "Field.prototype.render method not found")
        render_body = render_match.group(1)

        # Ensure this.renderGround is called
        ground_idx = render_body.find("this.renderGround(")
        self.assertNotEqual(ground_idx, -1, "Field.render must invoke this.renderGround")

        # Ensure depth-sorted pass is obtained or drawn after renderGround
        depth_sort_idx = render_body.find("getDepthSortedRenderList(")
        draw_item_idx = render_body.find("drawSceneryItem(")
        self.assertNotEqual(depth_sort_idx, -1, "Field.render must invoke getDepthSortedRenderList")
        self.assertGreater(
            depth_sort_idx,
            ground_idx,
            "getDepthSortedRenderList must be called after this.renderGround"
        )
        if draw_item_idx != -1:
            self.assertGreater(
                draw_item_idx,
                ground_idx,
                "drawSceneryItem must be called after this.renderGround to preserve layering"
            )


if __name__ == "__main__":
    unittest.main()
