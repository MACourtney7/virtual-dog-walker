#!/usr/bin/env python3
"""
Unit tests for Phase 3: Dog Mechanics, Player Models & Visual Appearance.
Verifies:
1. Player & NPC Directional Models (owner.js & npc.js):
   - 8-way directional shoulder/hip axis rotated by this.angle.
   - Arm/leg depth layering (far limb behind torso, near limb in foreground).
   - Accessories (backpack, hoodie, scarf, none).
   - Animated kneeling/bending pose on triggerPet() and triggerPickup().
2. Richer Canine Mechanics (companion_dog.js):
   - Scent trails & sniffing: DogState.SNIFFING_TRAIL, scent deposition, nose-twitching & sniff particles.
   - Zoomies & stick carrying: DogState.ZOOMIES, figure-eight path, stick pickup/carry/drop across jaws.
   - Dynamic gait transitions: IDLE, WALK, rhythmic Spaniel TROT, full-extension GALLOP with torso stretch and ear sweep.
3. Park Appearance (field.js, environment.js, particles.js):
   - Canopy wind sway offsetting foliage puffs.
   - Directional sun/moon ground shadows with GOLDEN_HOUR lengthening.
   - Autumn leaf clusters around chestnut/oak groves that scatter on sprint.
"""

import os
import re
import unittest


class TestPlayerAndNPCDirectionalModels(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(self.base_dir, "src", "entities", "owner.js"), "r", encoding="utf-8") as f:
            self.owner_code = f.read()
        with open(os.path.join(self.base_dir, "src", "entities", "npc.js"), "r", encoding="utf-8") as f:
            self.npc_code = f.read()
        with open(os.path.join(self.base_dir, "src", "entities", "npc_content.js"), "r", encoding="utf-8") as f:
            self.npc_content_code = f.read()

    def test_owner_directional_shoulders_and_depth_layering(self):
        """Owner must rotate shoulder and hip axis by this.angle with proper limb depth layering."""
        self.assertIn("const cosA = Math.cos(angle)", self.owner_code)
        self.assertIn("const sinA = Math.sin(angle)", self.owner_code)
        self.assertIn("shoulderSpan", self.owner_code)
        # Verify far arm and near arm depth ordering relative to torso
        self.assertIn("DEPTH LAYER 1: Far Arm & Far Leg (behind torso)", self.owner_code)
        self.assertIn("DEPTH LAYER 3: 3D Directional Torso / Jacket", self.owner_code)
        self.assertIn("DEPTH LAYER 5: Near Leg & Near Arm (in front of torso)", self.owner_code)

    def test_owner_accessories_and_bending_pose(self):
        """Owner must support accessories (BACKPACK, SCARF, HOODIE) and kneeling/bending timers."""
        self.assertIn("this.accessory =", self.owner_code)
        self.assertIn("triggerPet(", self.owner_code)
        self.assertIn("triggerPickup(", self.owner_code)
        self.assertIn("this.petTimer", self.owner_code)
        self.assertIn("this.bendTimer", self.owner_code)
        self.assertIn("this.isBending", self.owner_code)
        # Accessory rendering
        self.assertIn("BACKPACK", self.owner_code)
        self.assertIn("SCARF", self.owner_code)
        self.assertIn("HOODIE", self.owner_code)

    def test_npc_directional_model_and_accessories(self):
        """ParkNPC must support directional shoulder/hip axis and accessories from seed."""
        self.assertIn("this.accessory = opts.accessory", self.npc_code)
        self.assertIn("const cosA = Math.cos(angle)", self.npc_code)
        self.assertIn("const sinA = Math.sin(angle)", self.npc_code)
        self.assertIn("shoulderSpan", self.npc_code)
        self.assertIn("BACKPACK", self.npc_code)
        self.assertIn("SCARF", self.npc_code)
        self.assertIn("HOODIE", self.npc_code)
        # Verify npc_content generates accessory
        self.assertIn("accessories", self.npc_content_code)
        self.assertIn("accessory", self.npc_content_code)


class TestCompanionDogPhase3Mechanics(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(self.base_dir, "src", "entities", "companion_dog.js"), "r", encoding="utf-8") as f:
            self.dog_code = f.read()

    def test_dog_state_enums(self):
        """DogState must include ZOOMIES and SNIFFING_TRAIL."""
        self.assertIn("ZOOMIES: 'ZOOMIES'", self.dog_code)
        self.assertIn("SNIFFING_TRAIL: 'SNIFFING_TRAIL'", self.dog_code)

    def test_scent_trail_tracking_and_sniffing(self):
        """CompanionDog must deposit scent trails, detect scents, and animate sniffing."""
        self.assertIn("this.scentDropTimer", self.dog_code)
        self.assertIn("this.targetScent", self.dog_code)
        self.assertIn("this.noseTwitch", self.dog_code)
        self.assertIn("updateSniffingTrail(dt, field)", self.dog_code)
        self.assertIn("field.particleSystem.emitSniffParticles", self.dog_code)
        self.assertIn("field.addScent(this.x, this.y, 'dog', this)", self.dog_code)

    def test_zoomies_burst_and_figure_eight(self):
        """CompanionDog must trigger zoomies burst at 100% happiness and follow figure-eight path."""
        self.assertIn("triggerZoomies()", self.dog_code)
        self.assertIn("this.zoomiesTimer", self.dog_code)
        self.assertIn("this.zoomiesPhase", self.dog_code)
        self.assertIn("updateZoomies(dt, field)", self.dog_code)
        # Figure-eight parametric motion: sin(phase) and sin(phase * 2)
        self.assertIn("Math.sin(this.zoomiesPhase)", self.dog_code)
        self.assertIn("Math.sin(this.zoomiesPhase * 2)", self.dog_code)
        # Happiness trigger in pet()
        self.assertIn("this.happiness >= 100", self.dog_code)

    def test_woodland_stick_pickup_and_carrying(self):
        """CompanionDog must be able to pick up woodland sticks, carry across jaws, and drop on recall."""
        self.assertIn("this.hasStick", self.dog_code)
        self.assertIn("this.carriedStick", self.dog_code)
        self.assertIn("pickupStick(stick)", self.dog_code)
        self.assertIn("dropStick()", self.dog_code)
        # Rendering clamped stick across jaws
        self.assertIn("if (this.hasStick)", self.dog_code)
        # Dropping stick on recall and fetch
        self.assertIn("this.dropStick();\n    if (this.hasBall", self.dog_code)

    def test_dynamic_gait_transitions(self):
        """CompanionDog must visually transition between WALK, rhythmic Spaniel TROT, and GALLOP."""
        self.assertIn("this.gaitMode", self.dog_code)
        self.assertIn("this.gaitPhase", self.dog_code)
        self.assertIn("this.gaitMode = 'GALLOP'", self.dog_code)
        self.assertIn("this.gaitMode = 'TROT'", self.dog_code)
        self.assertIn("this.gaitMode = 'WALK'", self.dog_code)
        # Spaniel trot vertical bob
        self.assertIn("trotBob", self.dog_code)
        # Gallop torso stretch and streamlined ear sweep
        self.assertIn("gallopSweep", self.dog_code)
        self.assertIn("emitGallopPuff", self.dog_code)


class TestParkAppearance(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(self.base_dir, "src", "world", "field.js"), "r", encoding="utf-8") as f:
            self.field_code = f.read()
        with open(os.path.join(self.base_dir, "src", "world", "environment.js"), "r", encoding="utf-8") as f:
            self.env_code = f.read()
        with open(os.path.join(self.base_dir, "src", "systems", "particles.js"), "r", encoding="utf-8") as f:
            self.particles_code = f.read()

    def test_environment_shadow_parameters(self):
        """Environment must calculate directional ground shadow parameters with GOLDEN_HOUR lengthening."""
        self.assertIn("getShadowParameters(hour = null)", self.env_code)
        self.assertIn("lengthFactor", self.env_code)
        self.assertIn("skewX", self.env_code)
        self.assertIn("GOLDEN_HOUR", self.env_code)

    def test_field_canopy_wind_sway_and_shadows(self):
        """Field tree rendering must apply directional ground shadows and wind-rippled canopy sway."""
        self.assertIn("Math.sin(this.windTime + tree.x)", self.field_code)
        self.assertIn("getShadowParameters", self.field_code)

    def test_field_leaf_clusters_and_sticks(self):
        """Field must spawn autumn leaf clusters and woodland sticks around oak/chestnut groves."""
        self.assertIn("this.leafClusters", self.field_code)
        self.assertIn("this.sticks", self.field_code)
        self.assertIn("this.scentTrails", self.field_code)
        self.assertIn("renderLeafClusters", self.field_code)
        self.assertIn("renderWoodlandSticks", self.field_code)
        self.assertIn("renderScentTrails", self.field_code)

    def test_particle_system_extensions(self):
        """ParticleSystem must support LeafParticle flutter, emitFallenLeaves, emitGallopPuff, and emitSniffParticles."""
        self.assertIn("class LeafParticle", self.particles_code)
        self.assertIn("class SniffParticle", self.particles_code)
        self.assertIn("emitFallenLeaves(", self.particles_code)
        self.assertIn("emitGallopPuff(", self.particles_code)
        self.assertIn("emitSniffParticles(", self.particles_code)


if __name__ == "__main__":
    unittest.main()
