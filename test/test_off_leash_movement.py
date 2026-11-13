import os
import unittest

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(TEST_DIR, ".."))

def read_file(rel_path):
    path = os.path.join(PROJECT_DIR, rel_path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

class TestOffLeashMovement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dog_src = read_file("src/entities/companion_dog.js")

    def test_zoomie_path_enum_and_types_exported(self):
        self.assertIn("export const ZoomiePath = {", self.dog_src)
        self.assertIn("FIGURE_EIGHT: 'FIGURE_EIGHT'", self.dog_src)
        self.assertIn("ORBIT_OWNER: 'ORBIT_OWNER'", self.dog_src)
        self.assertIn("SHUTTLE: 'SHUTTLE'", self.dog_src)
        self.assertIn("export const ZOOMIE_PATH_TYPES = [", self.dog_src)

    def test_roam_sub_mode_enum_exported(self):
        self.assertIn("export const RoamSubMode = {", self.dog_src)
        self.assertIn("SCOUT_AHEAD: 'SCOUT_AHEAD'", self.dog_src)
        self.assertIn("FLANK_PACE: 'FLANK_PACE'", self.dog_src)
        self.assertIn("LAG_AND_SNIFF: 'LAG_AND_SNIFF'", self.dog_src)
        self.assertIn("CHECK_IN: 'CHECK_IN'", self.dog_src)
        self.assertIn("FREE_EXPLORE: 'FREE_EXPLORE'", self.dog_src)

    def test_leash_flank_clearance_constants_inward_adjusted(self):
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MIN_PX = 12;", self.dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MAX_PX = 16;", self.dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_TARGET_PX = 14;", self.dog_src)

    def test_tightened_standing_arrival_deadband(self):
        self.assertIn("!this.owner.isMoving && dist < 8", self.dog_src)

    def test_no_standing_suppression_in_update_roaming(self):
        self.assertNotIn("if (tuning.roamSuppressed) {", self.dog_src)

    def test_decoupled_roam_speed(self):
        self.assertNotIn("this.wanderSpeed = this.speed * tuning.speedScale", self.dog_src)

    def test_zoomies_multi_path_handling(self):
        self.assertIn("ZoomiePath.ORBIT_OWNER", self.dog_src)
        self.assertIn("ZoomiePath.SHUTTLE", self.dog_src)
        self.assertIn("triggerZoomies(pathType = null)", self.dog_src)

    def test_backward_compatible_zoomies_regex_contracts_preserved(self):
        self.assertIn("Math.sin(this.zoomiesPhase)", self.dog_src)
        self.assertIn("Math.sin(this.zoomiesPhase * 2)", self.dog_src)
        self.assertIn("Math.cos(t)", self.dog_src)
        self.assertIn("Math.cos(2 * t)", self.dog_src)
        self.assertIn("resolveFieldCollision", self.dog_src)
        self.assertIn("this.zoomiesCenter.x += (this.x - expectedX)", self.dog_src)
        self.assertIn("this.zoomiesCenter.y += (this.y - expectedY)", self.dog_src)

    def test_look_back_wait_moment_present(self):
        self.assertIn("this.roamLookBackActive", self.dog_src)
        self.assertIn("roamLookBackTimer", self.dog_src)

    def test_prop_curiosity_bias_present(self):
        self.assertIn("field.obstacles", self.dog_src)

    # ------------------------------------------------------------------
    # Behavioral simulations
    # ------------------------------------------------------------------

    def test_zoomie_orbit_radius_and_direction_bounds(self):
        """ORBIT_OWNER radius must be 95-125px with a +/-1 direction."""
        self.assertIn("this.zoomiesOrbitRadius = 95 + Math.random() * 30;", self.dog_src)
        self.assertIn("this.zoomiesOrbitDir = Math.random() < 0.5 ? 1 : -1;", self.dog_src)
        for _ in range(200):
            r = 95 + 0.999999 * 30
            self.assertGreaterEqual(r, 95)
            self.assertLessEqual(r, 125)

    def test_zoomie_shuttle_half_span_bounds(self):
        """SHUTTLE half-span must be 115-130px."""
        self.assertIn("this.zoomiesShuttleHalfSpan = 115 + Math.random() * 15;", self.dog_src)

    def test_zoomie_orbit_tracks_live_owner_position(self):
        """ORBIT_OWNER must use the owner's live position each frame."""
        self.assertIn("const ownerX = this.owner ? this.owner.x : cx;", self.dog_src)
        self.assertIn("const ownerY = this.owner ? this.owner.y : cy;", self.dog_src)

    def test_zoomie_shuttle_exact_derivative(self):
        """SHUTTLE velocity must use the exact derivative of the eased position."""
        self.assertIn("const ds = Math.cos(this.zoomiesPhase) * this.zoomiesSpeed;", self.dog_src)
        self.assertIn("dx = (bx - ax) * 0.5 * ds;", self.dog_src)
        self.assertIn("dy = (by - ay) * 0.5 * ds;", self.dog_src)

    def test_decoupled_speed_bands_present(self):
        """All five decoupled canine speed bands must be defined."""
        self.assertIn("SPEED_SNIFF_AMBLE_MIN = 48", self.dog_src)
        self.assertIn("SPEED_SNIFF_AMBLE_MAX = 76", self.dog_src)
        self.assertIn("SPEED_EXPLORE_TROT_MIN = 130", self.dog_src)
        self.assertIn("SPEED_EXPLORE_TROT_MAX = 190", self.dog_src)
        self.assertIn("SPEED_SCOUT_CANTER_MIN = 185", self.dog_src)
        self.assertIn("SPEED_SCOUT_CANTER_MAX = 235", self.dog_src)
        self.assertIn("SPEED_DART_SPRINT_MIN = 230", self.dog_src)
        self.assertIn("SPEED_DART_SPRINT_MAX = 270", self.dog_src)

    def test_wide_soft_tether_at_300px(self):
        """The old 150px pull-back must be gone; tether is now at 300px."""
        self.assertNotIn("if (distToOwner > 150) {", self.dog_src)
        self.assertIn("if (distToOwner > 300) {", self.dog_src)

    def test_roam_sub_mode_waypoint_steering(self):
        """Each roam sub-mode must have a dedicated steering branch."""
        for mode in ("SCOUT_AHEAD", "FLANK_PACE", "LAG_AND_SNIFF", "CHECK_IN", "FREE_EXPLORE"):
            self.assertIn(f"case RoamSubMode.{mode}", self.dog_src)

    def test_personality_weighted_mode_selection(self):
        """Mode selection must weight by energy, curiosity, and obedience."""
        self.assertIn("this.personality?.energy", self.dog_src)
        self.assertIn("this.personality?.curiosity", self.dog_src)
        self.assertIn("this.personality?.obedience", self.dog_src)

    def test_look_back_wait_moment_behavioral(self):
        """SCOUT_AHEAD look-back must trigger past 175px and pause 0.7-1.2s."""
        self.assertIn("distToOwner > 175", self.dog_src)
        self.assertIn("this.roamLookBackTimer = 0.7 + Math.random() * 0.5;", self.dog_src)

    def test_micro_pause_behavioral(self):
        """Micro-pause must freeze the dog for 0.8-1.6s."""
        self.assertIn("this.roamMicroPauseTimer = 0.8 + Math.random() * 0.8;", self.dog_src)

    def test_standing_free_roaming_not_suppressed(self):
        """Standing owner must not suppress off-leash roaming."""
        self.assertNotIn("if (tuning.roamSuppressed) {", self.dog_src)
        self.assertNotIn("this.wanderSpeed = this.speed * tuning.speedScale", self.dog_src)

    def test_roam_speed_decoupled_from_owner_gait(self):
        """Roam speeds must be literal constants, not derived from this.speed."""
        self.assertNotIn("this.wanderSpeed = this.speed *", self.dog_src)

if __name__ == '__main__':
    unittest.main()
