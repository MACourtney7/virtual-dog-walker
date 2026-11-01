#!/usr/bin/env python3
"""
Unit tests for Ticket-035:
Canine Fetching Perimeter Exemption, Ball Disappearance on Return & Single Ball Throw Restriction.

Covers:
- AC-035.1 (Perimeter Exemption):
  - Companion dog in DogState.FETCHING is NOT clamped at maxRoam = 230 px away from owner.
  - Dog can move freely to distances > 230 px (e.g. 350 px) to retrieve the ball.
- AC-035.2 (Ball Pickup on Owner Contact):
  - When returning with hasBall = True, reaching contact distance (dist <= 36) triggers retrieveByOwner().
  - inOwnerPossession becomes True, hasBall becomes False, targetBall cleared.
  - When inOwnerPossession is True, draw() and update() suppress rendering and physics.
- AC-035.3 (Single Active Ball Constraint):
  - canThrowBall() returns True ONLY when inOwnerPossession is True, ball is not thrown/carried,
    and dog is not fetching/carrying ball.
  - throwBall() and throwBallAt() abort when canThrowBall() is False.
- AC-035.4 (Direct Owner Pickup Safeguard):
  - When an uncarried ball is on the ground within 32 px of owner, owner retrieves ball into possession,
    and dog targetBall / fetching state is reset.
"""

import math
import os
import unittest


class MockOwner:
    def __init__(self, x=1000.0, y=1000.0, is_leashed=False, angle=0.0):
        self.x = x
        self.y = y
        self.isLeashed = is_leashed
        self.angle = angle
        self.isMoving = False


class DogState:
    IDLE = "IDLE"
    ROAMING = "ROAMING"
    FOLLOWING = "FOLLOWING"
    SNIFFING = "SNIFFING"
    PLAYING = "PLAYING"
    PLAY_BOW = "PLAY_BOW"
    LOST = "LOST"
    FETCHING = "FETCHING"
    RETURNING = "RETURNING"
    RECALLED = "RECALLED"


class MockTennisBall:
    """Python model mirroring TennisBall in src/entities/toy.js"""
    def __init__(self, x=0.0, y=0.0):
        self.x = x
        self.y = y
        self.z = 0.0
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0
        self.isThrown = False
        self.isCarried = False
        self.carrier = None
        self.inOwnerPossession = True
        self.depthY = self.y

    def throw(self, from_x, from_y, dir_x, dir_y, speed, launch_z=120.0):
        self.x = from_x
        self.y = from_y
        self.z = 10.0
        self.vx = dir_x * speed
        self.vy = dir_y * speed
        self.vz = launch_z
        self.isThrown = True
        self.isCarried = False
        self.carrier = None
        self.inOwnerPossession = False

    def attachToDog(self, dog):
        self.isCarried = True
        self.isThrown = False
        self.carrier = dog
        self.inOwnerPossession = False
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0
        self.z = 0.0

    def drop(self, x, y):
        self.isCarried = False
        self.carrier = None
        self.inOwnerPossession = False
        self.x = x
        self.y = y
        self.z = 0.0
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0

    def retrieveByOwner(self):
        self.inOwnerPossession = True
        self.isThrown = False
        self.isCarried = False
        self.carrier = None
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0
        self.z = 0.0

    def update(self, dt=0.016, field=None):
        if self.inOwnerPossession:
            return False  # physics suppressed
        if self.isCarried and self.carrier:
            mouth_offset = 18.0
            self.x = self.carrier.x + math.cos(self.carrier.angle) * mouth_offset
            self.y = self.carrier.y + math.sin(self.carrier.angle) * mouth_offset
            self.z = 4.0
            self.depthY = self.y + 4.0
            return True
        # ballistic trajectory update
        self.vz -= 720.0 * dt
        self.z += self.vz * dt
        self.x += self.vx * dt
        self.y += self.vy * dt
        if self.z <= 0:
            self.z = 0
            self.vz = -self.vz * 0.62
            if abs(self.vz) < 40:
                self.vz = 0
        friction = math.pow(0.94, dt * 60)
        self.vx *= friction
        self.vy *= friction
        return True

    def draw(self, ctx=None):
        if self.inOwnerPossession:
            return False  # draw suppressed
        return True


class MockCompanionDog:
    """Python model mirroring CompanionDog in src/entities/companion_dog.js"""
    def __init__(self, x=1000.0, y=1000.0, owner=None):
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.angle = 0.0
        self.speed = 220.0
        self.owner = owner
        self.state = DogState.ROAMING
        self.targetBall = None
        self.hasBall = False
        self.isPullingLeash = False
        self.wagSpeed = 4.0
        self.petCount = 0
        self.emoteBubble = None
        self.emoteTimer = 0.0

    def pet(self):
        self.petCount += 1

    def chaseBall(self, ball):
        self.targetBall = ball
        self.hasBall = False
        self.state = DogState.FETCHING

    def clampPerimeter(self):
        """Simulates line 498-510 in src/entities/companion_dog.js"""
        if self.owner and not self.owner.isLeashed and self.state != DogState.LOST and self.state != DogState.FETCHING:
            self.isPullingLeash = False
            max_roam = 230.0
            dx = self.x - self.owner.x
            dy = self.y - self.owner.y
            dist = math.hypot(dx, dy)
            if dist > max_roam:
                self.x = self.owner.x + (dx / dist) * max_roam
                self.y = self.owner.y + (dy / dist) * max_roam

    def updateFetching(self, dt=0.016):
        """Simulates updateFetching in src/entities/companion_dog.js"""
        if not self.targetBall:
            self.state = DogState.ROAMING
            return

        if not self.hasBall:
            # Running towards ball
            dx = self.targetBall.x - self.x
            dy = self.targetBall.y - self.y
            dist = math.hypot(dx, dy)
            if dist > 18:
                self.vx = (dx / dist) * (self.speed * 1.35)
                self.vy = (dy / dist) * (self.speed * 1.35)
                self.x += self.vx * dt
                self.y += self.vy * dt
                self.angle = math.atan2(self.vy, self.vx)
            else:
                # Pick up ball
                self.hasBall = True
                self.targetBall.attachToDog(self)
                self.vx = 0
                self.vy = 0
        else:
            # Return ball to owner
            if not self.owner:
                self.hasBall = False
                self.targetBall.drop(self.x, self.y)
                self.targetBall = null
                self.state = DogState.ROAMING
                return

            dx = self.owner.x - self.x
            dy = self.owner.y - self.y
            dist = math.hypot(dx, dy)
            if dist > 36:
                self.vx = (dx / dist) * self.speed
                self.vy = (dy / dist) * self.speed
                self.x += self.vx * dt
                self.y += self.vy * dt
                self.angle = math.atan2(self.vy, self.vx)
                self.wagSpeed = 14
            else:
                # Hand off ball to owner
                if hasattr(self.targetBall, "retrieveByOwner"):
                    self.targetBall.retrieveByOwner()
                else:
                    self.targetBall.inOwnerPossession = True
                    self.targetBall.isCarried = False
                    self.targetBall.carrier = None
                self.hasBall = False
                self.targetBall = None
                self.state = DogState.FOLLOWING if (self.owner and self.owner.isLeashed) else DogState.ROAMING
                self.pet()
                self.emoteBubble = "❤️"
                self.emoteTimer = 2.0


class MockCliftonDownGame:
    """Python model mirroring CliftonDownGame ball management in src/main.js"""
    def __init__(self, start_x=1000.0, start_y=1000.0):
        self.owner = MockOwner(start_x, start_y, is_leashed=False)
        self.dog = MockCompanionDog(start_x + 40, start_y + 20, self.owner)
        self.ball = MockTennisBall(start_x + 20, start_y + 20)
        self.ball.inOwnerPossession = True
        self.toasts = []

    def showToast(self, msg):
        self.toasts.append(msg)

    def canThrowBall(self):
        return bool(
            self.ball
            and self.ball.inOwnerPossession
            and not self.ball.isThrown
            and not self.ball.isCarried
            and (not self.dog or (self.dog.state != DogState.FETCHING and not self.dog.hasBall))
        )

    def throwBall(self):
        if not self.canThrowBall():
            self.showToast("🎾 Wait for your dog to return the ball!")
            return False
        dir_x = math.cos(self.owner.angle)
        dir_y = math.sin(self.owner.angle)
        return self.throwBallAt(self.owner.x + dir_x * 320, self.owner.y + dir_y * 320, dir_x, dir_y)

    def throwBallAt(self, target_x, target_y, dir_x, dir_y):
        if not self.canThrowBall():
            self.showToast("🎾 Wait for your dog to return the ball!")
            return False
        dist = math.hypot(target_x - self.owner.x, target_y - self.owner.y)
        speed = min(500.0, max(240.0, dist * 1.4))
        self.ball.throw(self.owner.x, self.owner.y, dir_x, dir_y, speed, speed * 0.5)
        self.ball.inOwnerPossession = False
        self.dog.chaseBall(self.ball)
        self.showToast("🎾 Ball thrown! Fetch!")
        return True

    def update(self, dt=0.016):
        # Update ball & dog
        self.dog.clampPerimeter()
        self.dog.updateFetching(dt)
        self.ball.update(dt)

        # Direct Owner Ball Pickup Safeguard
        if self.ball and self.owner and not self.ball.inOwnerPossession and not self.ball.isCarried:
            if self.ball.isThrown and self.ball.z <= 0 and math.hypot(self.ball.vx, self.ball.vy) < 10:
                self.ball.isThrown = False
            if not self.ball.isThrown:
                dist_to_ball = math.hypot(self.owner.x - self.ball.x, self.owner.y - self.ball.y)
                if dist_to_ball < 32:
                    if hasattr(self.ball, "retrieveByOwner"):
                        self.ball.retrieveByOwner()
                    else:
                        self.ball.inOwnerPossession = True
                        self.ball.isThrown = False
                        self.ball.isCarried = False
                        self.ball.carrier = None
                    if self.dog:
                        if self.dog.targetBall == self.ball or self.dog.targetBall:
                            self.dog.targetBall = None
                        if self.dog.state == DogState.FETCHING:
                            self.dog.hasBall = False
                            self.dog.targetBall = None
                            self.dog.state = DogState.FOLLOWING if self.owner.isLeashed else DogState.ROAMING
                    self.showToast("🎾 Picked up tennis ball.")


class TestFetchingMechanics(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        with open(os.path.join(self.base_dir, "src", "entities", "companion_dog.js"), "r", encoding="utf-8") as f:
            self.dog_source = f.read()
        with open(os.path.join(self.base_dir, "src", "entities", "toy.js"), "r", encoding="utf-8") as f:
            self.toy_source = f.read()
        with open(os.path.join(self.base_dir, "src", "main.js"), "r", encoding="utf-8") as f:
            self.main_source = f.read()
        with open(os.path.join(self.base_dir, "src", "ui", "touch_controls.js"), "r", encoding="utf-8") as f:
            self.touch_source = f.read()

    def test_source_code_contract_ac035_1_perimeter_exemption(self):
        """Assert companion_dog.js contains DogState.FETCHING perimeter exemption."""
        self.assertIn("this.state !== DogState.FETCHING", self.dog_source,
                      "companion_dog.js perimeter check must exempt DogState.FETCHING")
        self.assertIn("const maxRoam = 230;", self.dog_source)

    def test_source_code_contract_ac035_2_retrieve_by_owner(self):
        """Assert companion_dog.js and toy.js implement retrieveByOwner hand-off and render suppression."""
        self.assertIn("retrieveByOwner()", self.toy_source, "toy.js must define retrieveByOwner()")
        self.assertIn("this.inOwnerPossession = true", self.toy_source, "toy.js must set inOwnerPossession = true")
        self.assertIn("if (this.inOwnerPossession) {\n      return;\n    }", self.toy_source,
                      "toy.js update/draw must return early if inOwnerPossession")
        self.assertIn("this.targetBall.retrieveByOwner", self.dog_source,
                      "companion_dog.js updateFetching must call retrieveByOwner")

    def test_source_code_contract_ac035_3_single_ball_constraint(self):
        """Assert main.js enforces canThrowBall and single ball constraints."""
        self.assertIn("canThrowBall()", self.main_source, "main.js must define canThrowBall()")
        self.assertIn("this.ball.inOwnerPossession", self.main_source, "canThrowBall must require inOwnerPossession")
        self.assertIn("this.dog.state !== DogState.FETCHING", self.main_source,
                      "canThrowBall must verify dog is not FETCHING")
        self.assertIn("Wait for your dog to return the ball!", self.main_source,
                      "main.js throwBall must warn user if ball cannot be thrown")

    def test_source_code_contract_ac035_4_direct_owner_pickup(self):
        """Assert main.js contains direct owner ball pickup safeguard within 32px."""
        self.assertIn("distToBall < 32", self.main_source, "main.js must check owner pickup distance < 32")
        self.assertIn("retrieveByOwner", self.main_source, "main.js pickup must retrieve ball into owner possession")

    def test_source_code_contract_touch_controls_toggle(self):
        """Assert touch_controls.js defines setThrowEnabled and applies styling/attributes."""
        self.assertIn("setThrowEnabled(enabled)", self.touch_source, "touch_controls.js must have setThrowEnabled")
        self.assertIn("btn-touch-throw", self.touch_source)
        self.assertIn("is-disabled", self.touch_source)

    def test_ac035_1_perimeter_exemption_simulation(self):
        """
        AC-035.1: Assert that when companion dog is in FETCHING, its position
        is NOT clamped at maxRoam = 230 px away from owner, and can travel > 230 px (e.g. 350 px).
        """
        owner = MockOwner(1000.0, 1000.0, is_leashed=False)
        dog = MockCompanionDog(1000.0, 1000.0, owner)

        # Non-fetching dog roaming beyond 230 px gets clamped
        dog.state = DogState.ROAMING
        dog.x = 1000.0 + 350.0  # 350 px away
        dog.y = 1000.0
        dog.clampPerimeter()
        dist_clamped = math.hypot(dog.x - owner.x, dog.y - owner.y)
        self.assertAlmostEqual(dist_clamped, 230.0, places=2,
                               msg=f"Roaming dog must be clamped to 230 px, got {dist_clamped}")

        # When dog enters FETCHING state, it can exceed 230 px without being clamped
        dog.state = DogState.FETCHING
        dog.x = 1000.0 + 350.0
        dog.y = 1000.0
        dog.clampPerimeter()
        dist_fetching = math.hypot(dog.x - owner.x, dog.y - owner.y)
        self.assertAlmostEqual(dist_fetching, 350.0, places=2,
                               msg=f"Fetching dog must not be clamped, expected 350.0, got {dist_fetching}")

        # Can go even further to distant ball target (e.g. 480 px)
        dog.x = 1000.0
        dog.y = 1000.0 + 480.0
        dog.clampPerimeter()
        dist_far = math.hypot(dog.x - owner.x, dog.y - owner.y)
        self.assertAlmostEqual(dist_far, 480.0, places=2,
                               msg=f"Fetching dog must maintain position at 480 px, got {dist_far}")

    def test_ac035_2_ball_pickup_on_owner_contact_and_suppression(self):
        """
        AC-035.2: Assert that when dog returns with hasBall = True and reaches contact distance
        (dist <= 36), retrieveByOwner() is triggered, inOwnerPossession becomes True, hasBall becomes False,
        targetBall is cleared, and draw()/update() suppress rendering and physics.
        """
        owner = MockOwner(1000.0, 1000.0, is_leashed=False)
        dog = MockCompanionDog(1000.0 + 40.0, 1000.0, owner)
        ball = MockTennisBall(1000.0 + 40.0, 1000.0)

        dog.state = DogState.FETCHING
        dog.hasBall = True
        dog.targetBall = ball
        ball.attachToDog(dog)
        self.assertFalse(ball.inOwnerPossession)
        self.assertTrue(ball.isCarried)
        self.assertEqual(ball.carrier, dog)

        # Dog moves into contact distance (dist <= 36 px)
        dog.x = 1000.0 + 30.0
        dog.y = 1000.0
        dog.updateFetching(dt=0.016)

        # Assert ball hand-off results
        self.assertTrue(ball.inOwnerPossession, "Ball must be in owner possession")
        self.assertFalse(ball.isCarried, "Ball must not be carried anymore")
        self.assertIsNone(ball.carrier, "Ball carrier must be cleared")
        self.assertFalse(ball.isThrown, "Ball isThrown must be false")
        self.assertFalse(dog.hasBall, "Dog hasBall must be False")
        self.assertIsNone(dog.targetBall, "Dog targetBall must be cleared")
        self.assertEqual(dog.state, DogState.ROAMING, "Dog should transition to ROAMING")
        self.assertEqual(dog.emoteBubble, "❤️")

        # Test render and update suppression
        update_result = ball.update(dt=0.016)
        self.assertFalse(update_result, "Ball update must return immediately/suppress physics when in owner possession")
        draw_result = ball.draw(ctx=None)
        self.assertFalse(draw_result, "Ball draw must return immediately/suppress rendering when in owner possession")

    def test_ac035_3_single_active_ball_constraint(self):
        """
        AC-035.3: Assert canThrowBall() returns True ONLY when inOwnerPossession is True,
        ball is not thrown/carried, and dog is not fetching.
        Assert throwBall / throwBallAt aborts when canThrowBall() is False.
        """
        game = MockCliftonDownGame(1000.0, 1000.0)

        # Initial state: ball is stowed in owner possession, dog is roaming
        self.assertTrue(game.ball.inOwnerPossession)
        self.assertTrue(game.canThrowBall(), "Initial state: owner should be able to throw ball")

        # First throw succeeds
        success = game.throwBall()
        self.assertTrue(success, "First throw should succeed")
        self.assertFalse(game.ball.inOwnerPossession)
        self.assertTrue(game.ball.isThrown)
        self.assertEqual(game.dog.state, DogState.FETCHING)
        self.assertEqual(game.dog.targetBall, game.ball)

        # Attempting second throw while ball is in flight / dog fetching MUST fail
        self.assertFalse(game.canThrowBall(), "canThrowBall must be False while ball is active in play")
        second_throw = game.throwBall()
        self.assertFalse(second_throw, "Subsequent throw must abort while ball is in play")
        self.assertIn("🎾 Wait for your dog to return the ball!", game.toasts)

        # Even if ball lands on ground (isThrown=False) but uncollected, throw must still be blocked
        game.ball.isThrown = False
        self.assertFalse(game.canThrowBall(), "canThrowBall must be False when ball is on ground not in possession")

        # If dog picks it up (hasBall=True), throw must still be blocked
        game.dog.hasBall = True
        game.ball.attachToDog(game.dog)
        self.assertFalse(game.canThrowBall(), "canThrowBall must be False when dog is carrying ball")

        # Once dog returns ball to owner, canThrowBall becomes True again
        game.dog.x = game.owner.x + 20.0
        game.dog.y = game.owner.y
        game.dog.updateFetching(dt=0.016)
        self.assertTrue(game.ball.inOwnerPossession)
        self.assertTrue(game.canThrowBall(), "canThrowBall must be True after ball is returned to owner")

    def test_ac035_4_direct_owner_pickup_safeguard(self):
        """
        AC-035.4: Assert that when an uncarried ball is on the ground within 32 px of owner,
        owner retrieves the ball into possession and dog fetching state is reset.
        """
        game = MockCliftonDownGame(1000.0, 1000.0)
        # Drop ball on ground 20 px away from owner (within 32 px)
        game.ball.drop(1000.0 + 20.0, 1000.0)
        game.dog.chaseBall(game.ball)
        self.assertFalse(game.ball.inOwnerPossession)
        self.assertEqual(game.dog.state, DogState.FETCHING)
        self.assertEqual(game.dog.targetBall, game.ball)

        # Run game update tick
        game.update(dt=0.016)

        # Assert direct pickup occurred
        self.assertTrue(game.ball.inOwnerPossession, "Ball must be retrieved into owner possession")
        self.assertIsNone(game.dog.targetBall, "Dog targetBall must be cleared")
        self.assertEqual(game.dog.state, DogState.ROAMING, "Dog state should reset to ROAMING")
        self.assertIn("🎾 Picked up tennis ball.", game.toasts)
        self.assertTrue(game.canThrowBall(), "Owner can now throw ball again")

        # Verify that if ball is farther than 32 px (e.g. 50 px), owner does NOT auto-pickup
        game.ball.drop(1000.0 + 50.0, 1000.0)
        game.update(dt=0.016)
        self.assertFalse(game.ball.inOwnerPossession, "Ball beyond 32 px should not be auto-picked up")


if __name__ == "__main__":
    unittest.main()
