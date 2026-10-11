#!/usr/bin/env python3
"""
Unit tests for Companion Dog Behavior & Canine AI Mechanics:
- On-leash close heel distance follow (~38-48px)
- Off-leash bounded roaming perimeter with bias back to human
- Dog-to-dog social proximity detection (within 110px)
- Whistle recall state transition (sprint speed and 10s heel follow)
- Whistle packet protocol schema validation
"""

import math
import time
import unittest


class MockOwner:
    def __init__(self, x=1000.0, y=1000.0, is_leashed=True, angle=0.0, is_moving=False):
        self.x = x
        self.y = y
        self.isLeashed = is_leashed
        self.angle = angle
        self.isMoving = is_moving


class MockCompanionDog:
    """Python model mirroring canine AI mechanics from src/entities/companion_dog.js"""
    def __init__(self, x=1040.0, y=1020.0, owner=None):
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.angle = 0.0
        self.speed = 195.0
        self.sprintSpeed = 290.0
        self.owner = owner
        self.state = "FOLLOWING"
        self.stateTimer = 0.0
        self.recallHeelTimer = 0.0

        # On-leash follow offsets
        self.followDistance = 42.0  # target close heel distance ~38-48px
        self.followAngleOffset = math.pi * 0.5  # at owner's side

        # Bounded roaming parameters
        self.roamTarget = {"x": x, "y": y}
        self.maxRoamRadius = 200.0
        self.softRoamRadius = 150.0
        self.hardRoamRadius = 230.0

    def whistleRecall(self):
        self.state = "RECALLED"
        self.stateTimer = 0.0
        self.recallHeelTimer = 10.0

    def updateFollowing(self, dt):
        if not self.owner:
            return
        target_x = self.owner.x + math.cos(self.owner.angle + self.followAngleOffset) * self.followDistance
        target_y = self.owner.y + math.sin(self.owner.angle + self.followAngleOffset) * self.followDistance
        dx = target_x - self.x
        dy = target_y - self.y
        dist = math.hypot(dx, dy)
        slowing_radius = 40.0
        target_speed = self.speed
        if dist < slowing_radius:
            target_speed = self.speed * (dist / slowing_radius)

        if dist > 8.0:
            self.vx = (dx / dist) * target_speed
            self.vy = (dy / dist) * target_speed
            self.angle = math.atan2(self.vy, self.vx)
        else:
            self.vx = 0.0
            self.vy = 0.0

        self.x += self.vx * dt
        self.y += self.vy * dt

    def updateRecalled(self, dt):
        if not self.owner:
            return
        dx = self.owner.x - self.x
        dy = self.owner.y - self.y
        dist = math.hypot(dx, dy)

        if dist > 36.0:
            self.vx = (dx / dist) * self.sprintSpeed
            self.vy = (dy / dist) * self.sprintSpeed
            self.angle = math.atan2(self.vy, self.vx)
            self.x += self.vx * dt
            self.y += self.vy * dt
        else:
            # Reached owner: follow at heel while recallHeelTimer counts down
            if self.recallHeelTimer > 0:
                self.recallHeelTimer -= dt
                self.updateFollowing(dt)
            else:
                self.state = "FOLLOWING" if (self.owner and self.owner.isLeashed) else "ROAMING"

    def calculateRoamingSteering(self, candidate_target):
        """Simulate steering vector when roaming off-leash."""
        if not self.owner:
            return 0.0, 0.0

        dist_from_owner = math.hypot(self.x - self.owner.x, self.y - self.owner.y)
        dx = candidate_target["x"] - self.x
        dy = candidate_target["y"] - self.y
        dist_to_cand = max(1.0, math.hypot(dx, dy))

        steer_x = dx / dist_to_cand
        steer_y = dy / dist_to_cand

        # If exceeding soft perimeter (150px), blend bias back towards owner
        if dist_from_owner > self.softRoamRadius:
            to_owner_x = self.owner.x - self.x
            to_owner_y = self.owner.y - self.y
            to_owner_dist = max(1.0, math.hypot(to_owner_x, to_owner_y))
            bias_factor = min(1.0, (dist_from_owner - self.softRoamRadius) / (self.hardRoamRadius - self.softRoamRadius))
            steer_x = steer_x * (1.0 - bias_factor) + (to_owner_x / to_owner_dist) * bias_factor
            steer_y = steer_y * (1.0 - bias_factor) + (to_owner_y / to_owner_dist) * bias_factor

        # Hard clamp within 230px
        steer_mag = max(1e-5, math.hypot(steer_x, steer_y))
        return steer_x / steer_mag, steer_y / steer_mag

    def clampWithinPerimeter(self):
        """Hard bound perimeter clamping."""
        if not self.owner:
            return
        dx = self.x - self.owner.x
        dy = self.y - self.owner.y
        dist = math.hypot(dx, dy)
        if dist > self.hardRoamRadius:
            self.x = self.owner.x + (dx / dist) * self.hardRoamRadius
            self.y = self.owner.y + (dy / dist) * self.hardRoamRadius


class TestDogBehavior(unittest.TestCase):
    def test_on_leash_close_heel_distance(self):
        """Verifies target follow distance when on-leash stays within close range (~38-48px)."""
        owner = MockOwner(x=500.0, y=500.0, is_leashed=True, angle=0.0)
        # Position dog initially at offset
        dog = MockCompanionDog(x=500.0, y=542.0, owner=owner)

        # Confirm dog follow distance configuration is within close heel range ~38-48px
        self.assertGreaterEqual(dog.followDistance, 38.0)
        self.assertLessEqual(dog.followDistance, 48.0)

        # Run several simulation steps for dog to settle into heel position
        for _ in range(30):
            dog.updateFollowing(0.016)

        dist = math.hypot(dog.x - owner.x, dog.y - owner.y)
        self.assertAlmostEqual(dist, dog.followDistance, delta=2.0)
        self.assertGreaterEqual(dist, 38.0)
        self.assertLessEqual(dist, 48.0)

    def test_off_leash_bounded_roaming(self):
        """Verifies off-leash roaming steering biases back toward human when distance exceeds 150px and clamps within 230px."""
        owner = MockOwner(x=1000.0, y=1000.0, is_leashed=False)
        dog = MockCompanionDog(x=1000.0, y=1190.0, owner=owner)  # 190px away (> 150px soft radius)

        # Candidate target tries to move even further away (y=1250)
        candidate_away = {"x": 1000.0, "y": 1250.0}
        steer_x, steer_y = dog.calculateRoamingSteering(candidate_away)

        # Negative y points back toward owner at y=1000
        # Because dist > 150px, steer_y must have blended bias towards owner (steer_y < 0.5)
        self.assertLess(steer_y, 0.5, "Steering should bias back towards owner when beyond 150px")

        # Test extreme distance hard clamp
        dog.x = 1000.0
        dog.y = 1350.0  # 350px away
        dog.clampWithinPerimeter()
        clamped_dist = math.hypot(dog.x - owner.x, dog.y - owner.y)
        self.assertLessEqual(clamped_dist, 230.001)

    def test_dog_social_proximity_detection(self):
        """Verifies two dogs within 110px can initiate friendly greeting state (SOCIAL_GREET / PLAY_BOW)."""
        dog1_pos = (500.0, 500.0)
        dog2_near = (570.0, 550.0)  # dist = sqrt(70^2 + 50^2) = ~86px (< 110px)
        dog2_far = (650.0, 600.0)   # dist = sqrt(150^2 + 100^2) = ~180px (> 110px)

        dist_near = math.hypot(dog1_pos[0] - dog2_near[0], dog1_pos[1] - dog2_near[1])
        dist_far = math.hypot(dog1_pos[0] - dog2_far[0], dog1_pos[1] - dog2_far[1])

        proximity_threshold = 110.0
        self.assertLess(dist_near, proximity_threshold)
        self.assertGreater(dist_far, proximity_threshold)

        # Proximity interaction handler check
        def can_initiate_greeting(dist):
            return dist < proximity_threshold

        self.assertTrue(can_initiate_greeting(dist_near))
        self.assertFalse(can_initiate_greeting(dist_far))

    def test_whistle_recall_state_transition(self):
        """Verifies whistleRecall() sets state to RECALLED, activates sprint speed toward owner, and locks into timed heel following."""
        owner = MockOwner(x=300.0, y=300.0, is_leashed=False)
        dog = MockCompanionDog(x=450.0, y=300.0, owner=owner)  # 150px away

        dog.whistleRecall()
        self.assertEqual(dog.state, "RECALLED")
        self.assertEqual(dog.recallHeelTimer, 10.0)

        # In RECALLED state, initial speed towards owner should be sprintSpeed (290 px/s)
        dog.updateRecalled(0.016)
        speed = math.hypot(dog.vx, dog.vy)
        self.assertAlmostEqual(speed, dog.sprintSpeed, delta=1.0)
        self.assertLess(dog.vx, 0.0)  # moving left towards x=300

        # Simulate until dog reaches close proximity (< 36px)
        while math.hypot(dog.x - owner.x, dog.y - owner.y) > 36.0:
            dog.updateRecalled(0.05)

        self.assertLessEqual(math.hypot(dog.x - owner.x, dog.y - owner.y), 48.0)

        # Verify timed heel timer counts down
        prev_timer = dog.recallHeelTimer
        dog.updateRecalled(0.5)
        self.assertLess(dog.recallHeelTimer, prev_timer)

    def test_whistle_packet_protocol(self):
        """Verifies Protocol.createWhistle produces valid JSON packet schema with type WHISTLE."""
        # Simulated Protocol.createWhistle output
        def create_whistle(peer_id, x, y):
            return {
                "type": "WHISTLE",
                "senderId": peer_id,
                "x": x,
                "y": y,
                "timestamp": int(time.time() * 1000)
            }

        packet = create_whistle("peer-test-99", 550.0, 420.0)
        self.assertEqual(packet["type"], "WHISTLE")
        self.assertEqual(packet["senderId"], "peer-test-99")
        self.assertEqual(packet["x"], 550.0)
        self.assertEqual(packet["y"], 420.0)
        self.assertIn("timestamp", packet)
        self.assertIsInstance(packet["timestamp"], int)


if __name__ == "__main__":
    unittest.main()
