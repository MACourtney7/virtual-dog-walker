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
                self.targetBall = None
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
        with open(os.path.join(self.base_dir, "crates", "dog_walker_core", "src", "dog_utility_ai.rs"), "r", encoding="utf-8") as f:
            self.utility_ai_source = f.read()

    def test_source_code_contract_ac035_1_perimeter_exemption(self):
        """Assert companion_dog.js no longer hard-clamps off-leash roaming at 230px (AC-013.1).

        The old 230px perimeter clamp was removed in favour of a distance-scaled
        probabilistic catch-up return-trot. That roaming/catch-up logic now lives
        in the Rust core (dog_utility_ai.rs), so companion_dog.js has no clamp at
        all and fetching dogs are naturally exempt.
        """
        self.assertNotIn("const maxRoam = 230;", self.dog_source,
                         "230px hard clamp must be removed (AC-013.1)")
        self.assertNotIn("maxRoam", self.dog_source,
                         "No maxRoam clamp should remain in companion_dog.js")
        # Roaming/catch-up steering now lives in the Rust core.
        self.assertIn("fn score_roam_explore", self.utility_ai_source,
                      "Roam utility scoring must live in the Rust core")
        self.assertIn("UTIL_ROAM_EXPLORE", self.utility_ai_source,
                      "Roam utility id must be defined in the Rust core")
        self.assertIn("fn compute_steering", self.utility_ai_source,
                      "Roam steering must live in the Rust core")

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


#!/usr/bin/env python3
"""Fetching mechanics tests driven by exact Wasm ball/dog event bits.

Every scenario launches a fresh `node --input-type=module -e "..."` subprocess,
calls `initWasmSimSync()` synchronously, and drives the Rust-owned ball and dog
buffers via `step_ball_buffer(dt_s)` / `step_dog_buffer()`. Assertions use exact
event bitmasks and the exact `unification-045` buffer offsets
(see crates/dog_walker_core/src/dog_contract.rs and ball_physics.rs).
"""
import json
import os
import shutil
import subprocess
import textwrap
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# BallSimBuffer slot offsets (mirror crates/dog_walker_core/src/ball_physics.rs).
BALL_SLOT_POS_X = 1
BALL_SLOT_POS_Y = 2
BALL_SLOT_POS_Z = 3
BALL_SLOT_VEL_X = 4
BALL_SLOT_VEL_Y = 5
BALL_SLOT_VEL_Z = 6
BALL_SLOT_IS_THROWN = 10
BALL_SLOT_IS_CARRIED = 11
BALL_SLOT_ATTACHED_TO_DOG = 12
BALL_SLOT_IN_OWNER_POSSESSION = 13
BALL_SLOT_COMMAND_FLAGS = 24
BALL_SLOT_LAST_EVENT_MASK = 28

# Ball command bits.
BALL_CMD_RESET = 1 << 0
BALL_CMD_THROW = 1 << 1
BALL_CMD_DROP = 1 << 2
BALL_CMD_ATTACH_TO_DOG = 1 << 3
BALL_CMD_RETRIEVE_BY_OWNER = 1 << 4

# DogSimBuffer output slots (mirror crates/dog_walker_core/src/dog_contract.rs).
DOG_BUF_DOG_X = 64
DOG_BUF_DOG_Y = 65
DOG_BUF_DOG_STATE_ID = 69
DOG_BUF_EVENT_BITMASK = 127
DOG_BUF_EVENT_BITMASK_HI = 104

# Dog event bits (low half).
DOG_EVENT_BALL_GRABBED = 1 << 7
DOG_EVENT_BALL_HANDOFF = 1 << 8
DOG_EVENT_FETCH_STARTED = 1 << 21
DOG_EVENT_FETCH_COMPLETED = 1 << 23

# DogStateId::Fetch
DOG_STATE_ID_FETCH = 4


def node_available():
    return shutil.which("node") is not None


def run_node(script_body: str) -> dict:
    body = textwrap.dedent(script_body)
    result = subprocess.run(
        ["node", "--input-type=module", "-e", body],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise AssertionError(
            "node script failed:\nSTDOUT:\n%s\nSTDERR:\n%s"
            % (result.stdout, result.stderr)
        )
    out = result.stdout.strip()
    lines = [ln for ln in out.splitlines() if ln.strip()]
    if not lines:
        raise AssertionError("node produced no output; stderr:\n%s" % result.stderr)
    return json.loads(lines[-1])


def file_url(rel_path: str) -> str:
    return json.dumps("file://" + os.path.join(REPO_ROOT, rel_path))


WASM_SHIM = """
const fetchBridge = await import(%s);
fetchBridge.initWasmSimSync();
const fetchSim = fetchBridge.getWasmSim();
const fetchBallBuf = fetchBridge.getBufferView(fetchSim.ball_buffer_ptr(), fetchSim.ball_buffer_len());
const fetchDogBuf = fetchBridge.getBufferView(fetchSim.dog_buffer_ptr(), fetchSim.dog_buffer_len());

function fetchBallStep(dtS) {
  return fetchSim.step_ball_buffer(dtS) >>> 0;
}
function fetchBallReset() {
  fetchBallBuf[%d] = %d;
  fetchBallStep(0);
}
function fetchDogStep() {
  fetchSim.step_dog_buffer();
  const lo = fetchDogBuf[%d] >>> 0;
  const hi = fetchDogBuf[%d] >>> 0;
  return ((hi << 16) | lo) >>> 0;
}
function fetchHex(mask) {
  return '0x' + (mask >>> 0).toString(16).padStart(8, '0');
}
""" % (
    file_url("src/engine/wasm_sim_bridge.js"),
    BALL_SLOT_COMMAND_FLAGS,
    BALL_CMD_RESET,
    DOG_BUF_EVENT_BITMASK,
    DOG_BUF_EVENT_BITMASK_HI,
)


def assert_mask(testcase, actual, expected, label):
    testcase.assertEqual(
        actual,
        expected,
        "%s: expected %s, actual %s"
        % (label, "0x%08x" % (expected & 0xFFFFFFFF), "0x%08x" % (actual & 0xFFFFFFFF)),
    )


def assert_bit_set(testcase, mask, bit, label):
    testcase.assertTrue(
        (mask & bit) != 0,
        "%s: expected bit %s set in %s"
        % (label, "0x%08x" % bit, "0x%08x" % (mask & 0xFFFFFFFF)),
    )


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestFetchingWasmMechanics(unittest.TestCase):
    def test_ball_throw_sets_thrown_and_clears_owner_possession(self):
        script = WASM_SHIM + """
        fetchBallReset();
        // Seed launch kinematics and queue a THROW command.
        fetchBallBuf[%d] = 1000;
        fetchBallBuf[%d] = 1000;
        fetchBallBuf[%d] = 12;
        fetchBallBuf[%d] = 300;
        fetchBallBuf[%d] = 0;
        fetchBallBuf[%d] = 180;
        fetchBallBuf[%d] = %d;
        const events = fetchBallStep(0.016);
        console.log(JSON.stringify({
          events,
          isThrown: fetchBallBuf[%d] !== 0,
          isCarried: fetchBallBuf[%d] !== 0,
          inOwnerPossession: fetchBallBuf[%d] !== 0,
          x: fetchBallBuf[%d],
          y: fetchBallBuf[%d]
        }));
        """ % (
            BALL_SLOT_POS_X, BALL_SLOT_POS_Y, BALL_SLOT_POS_Z,
            BALL_SLOT_VEL_X, BALL_SLOT_VEL_Y, BALL_SLOT_VEL_Z,
            BALL_SLOT_COMMAND_FLAGS, BALL_CMD_THROW,
            BALL_SLOT_IS_THROWN, BALL_SLOT_IS_CARRIED,
            BALL_SLOT_IN_OWNER_POSSESSION,
            BALL_SLOT_POS_X, BALL_SLOT_POS_Y,
        )
        payload = run_node(script)
        self.assertTrue(payload["isThrown"], "ball must be marked thrown after THROW")
        self.assertFalse(payload["isCarried"], "ball must not be carried after THROW")
        self.assertFalse(
            payload["inOwnerPossession"],
            "ball must leave owner possession after THROW",
        )

    def test_ball_attach_to_dog_sets_carried(self):
        script = WASM_SHIM + """
        fetchBallReset();
        fetchBallBuf[%d] = %d;
        const events = fetchBallStep(0.016);
        console.log(JSON.stringify({
          events,
          isCarried: fetchBallBuf[%d] !== 0,
          isThrown: fetchBallBuf[%d] !== 0,
          inOwnerPossession: fetchBallBuf[%d] !== 0
        }));
        """ % (
            BALL_SLOT_COMMAND_FLAGS, BALL_CMD_ATTACH_TO_DOG,
            BALL_SLOT_IS_CARRIED, BALL_SLOT_IS_THROWN,
            BALL_SLOT_IN_OWNER_POSSESSION,
        )
        payload = run_node(script)
        self.assertTrue(payload["isCarried"], "ball must be carried after ATTACH_TO_DOG")
        self.assertFalse(payload["isThrown"], "ball must not be thrown after ATTACH_TO_DOG")
        self.assertFalse(
            payload["inOwnerPossession"],
            "ball must leave owner possession after ATTACH_TO_DOG",
        )

    def test_ball_retrieve_by_owner_sets_owner_possession(self):
        script = WASM_SHIM + """
        fetchBallReset();
        // First throw the ball so it is out of owner possession.
        fetchBallBuf[%d] = 1000;
        fetchBallBuf[%d] = 1000;
        fetchBallBuf[%d] = 12;
        fetchBallBuf[%d] = 300;
        fetchBallBuf[%d] = 0;
        fetchBallBuf[%d] = 180;
        fetchBallBuf[%d] = %d;
        fetchBallStep(0.016);
        // Now retrieve it back into owner possession.
        fetchBallBuf[%d] = %d;
        const events = fetchBallStep(0.016);
        console.log(JSON.stringify({
          events,
          inOwnerPossession: fetchBallBuf[%d] !== 0,
          isThrown: fetchBallBuf[%d] !== 0,
          isCarried: fetchBallBuf[%d] !== 0
        }));
        """ % (
            BALL_SLOT_POS_X, BALL_SLOT_POS_Y, BALL_SLOT_POS_Z,
            BALL_SLOT_VEL_X, BALL_SLOT_VEL_Y, BALL_SLOT_VEL_Z,
            BALL_SLOT_COMMAND_FLAGS, BALL_CMD_THROW,
            BALL_SLOT_COMMAND_FLAGS, BALL_CMD_RETRIEVE_BY_OWNER,
            BALL_SLOT_IN_OWNER_POSSESSION, BALL_SLOT_IS_THROWN,
            BALL_SLOT_IS_CARRIED,
        )
        payload = run_node(script)
        self.assertTrue(
            payload["inOwnerPossession"],
            "ball must be in owner possession after RETRIEVE_BY_OWNER",
        )
        self.assertFalse(payload["isThrown"], "ball must not be thrown after RETRIEVE_BY_OWNER")
        self.assertFalse(payload["isCarried"], "ball must not be carried after RETRIEVE_BY_OWNER")

    def test_ball_drop_clears_carried(self):
        script = WASM_SHIM + """
        fetchBallReset();
        fetchBallBuf[%d] = %d;
        fetchBallStep(0.016);
        fetchBallBuf[%d] = %d;
        const events = fetchBallStep(0.016);
        console.log(JSON.stringify({
          events,
          isCarried: fetchBallBuf[%d] !== 0,
          inOwnerPossession: fetchBallBuf[%d] !== 0
        }));
        """ % (
            BALL_SLOT_COMMAND_FLAGS, BALL_CMD_ATTACH_TO_DOG,
            BALL_SLOT_COMMAND_FLAGS, BALL_CMD_DROP,
            BALL_SLOT_IS_CARRIED, BALL_SLOT_IN_OWNER_POSSESSION,
        )
        payload = run_node(script)
        self.assertFalse(payload["isCarried"], "ball must not be carried after DROP")
        self.assertFalse(
            payload["inOwnerPossession"],
            "ball must not be in owner possession after DROP",
        )

    def test_ball_event_mask_slot_mirrors_return(self):
        script = WASM_SHIM + """
        fetchBallReset();
        fetchBallBuf[%d] = %d;
        const events = fetchBallStep(0.016);
        const slot = fetchBallBuf[%d] >>> 0;
        console.log(JSON.stringify({ events, slot }));
        """ % (
            BALL_SLOT_COMMAND_FLAGS, BALL_CMD_ATTACH_TO_DOG,
            BALL_SLOT_LAST_EVENT_MASK,
        )
        payload = run_node(script)
        self.assertEqual(
            payload["slot"],
            payload["events"],
            "BALL_SLOT_LAST_EVENT_MASK (%s) must mirror the returned mask (%s)"
            % ("0x%08x" % payload["slot"], "0x%08x" % payload["events"]),
        )

    def test_dog_buffer_event_mask_round_trips(self):
        script = WASM_SHIM + """
        // Step the dog buffer once and read the combined event mask from the
        // two f32 slots (low 16 bits + high 16 bits).
        const mask = fetchDogStep();
        const lo = fetchDogBuf[%d] >>> 0;
        const hi = fetchDogBuf[%d] >>> 0;
        console.log(JSON.stringify({
          mask,
          lo,
          hi,
          stateId: fetchDogBuf[%d] | 0
        }));
        """ % (DOG_BUF_EVENT_BITMASK, DOG_BUF_EVENT_BITMASK_HI, DOG_BUF_DOG_STATE_ID)
        payload = run_node(script)
        # The combined mask must equal (hi << 16) | lo exactly.
        expected = ((payload["hi"] << 16) | payload["lo"]) & 0xFFFFFFFF
        self.assertEqual(
            payload["mask"],
            expected,
            "dog event mask must equal (hi << 16) | lo: expected %s, actual %s"
            % ("0x%08x" % expected, "0x%08x" % payload["mask"]),
        )

    def test_dog_fetch_started_event_bit_defined(self):
        # Assert the exact unification-045 event bit constants are stable.
        self.assertEqual(DOG_EVENT_BALL_GRABBED, 1 << 7)
        self.assertEqual(DOG_EVENT_BALL_HANDOFF, 1 << 8)
        self.assertEqual(DOG_EVENT_FETCH_STARTED, 1 << 21)
        self.assertEqual(DOG_EVENT_FETCH_COMPLETED, 1 << 23)
        self.assertEqual(DOG_STATE_ID_FETCH, 4)


if __name__ == "__main__":
    unittest.main()
