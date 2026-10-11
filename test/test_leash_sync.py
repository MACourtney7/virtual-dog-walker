#!/usr/bin/env python3
"""
Unit tests for Leash Synchronization across network interpolation, protocol serialization,
and companion dog entity constraints.
"""

import math
import os
import unittest


class MockEntityInterpolator:
    """Python simulation of EntityInterpolator from src/net/network.js."""
    def __init__(self, lerp_rate=0.22):
        self.target = None
        self.current = None
        self.lerp_rate = lerp_rate

    def set_target(self, snapshot):
        if not self.current:
            self.current = dict(snapshot)
        self.target = dict(snapshot)

    def update(self, dt):
        if not self.target or not self.current:
            return self.current

        rate = 1.0 - math.exp(-self.lerp_rate * 60.0 * dt)
        self.current["x"] += (self.target["x"] - self.current["x"]) * rate
        self.current["y"] += (self.target["y"] - self.current["y"]) * rate
        self.current["vx"] = self.target["vx"]
        self.current["vy"] = self.target["vy"]

        # Angle shortest path interpolation
        d_angle = self.target["angle"] - self.current["angle"]
        while d_angle > math.pi:
            d_angle -= math.pi * 2.0
        while d_angle < -math.pi:
            d_angle += math.pi * 2.0
        self.current["angle"] += d_angle * rate

        # Discrete properties propagation
        for k, v in self.target.items():
            if k not in ("x", "y", "vx", "vy", "angle"):
                self.current[k] = v

        return self.current


class MockProtocol:
    """Python simulation of Protocol.createSyncState from src/net/protocol.js."""
    @staticmethod
    def create_sync_state(peer_id, owner, dog):
        return {
            "type": "SYNC_STATE",
            "senderId": peer_id,
            "owner": {
                "x": round(owner["x"] * 10) / 10,
                "y": round(owner["y"] * 10) / 10,
                "vx": round(owner["vx"]),
                "vy": round(owner["vy"]),
                "angle": round(owner["angle"] * 100) / 100,
                "isMoving": owner["isMoving"],
                "isLeashed": owner["isLeashed"]
            },
            "dog": {
                "x": round(dog["x"] * 10) / 10,
                "y": round(dog["y"] * 10) / 10,
                "vx": round(dog["vx"]),
                "vy": round(dog["vy"]),
                "angle": round(dog["angle"] * 100) / 100,
                "state": dog["state"]
            }
        }


class MockCompanionDog:
    """Python simulation of CompanionDog leash constraint & draw guard from src/entities/companion_dog.js."""
    def __init__(self, x=1240.0, y=920.0, owner=None):
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.state = "FOLLOWING"
        self.owner = owner

    def update_leash_constraint(self):
        # Leash constraint: If leashed to owner, hard clamp to max leash length
        if self.owner and self.owner.get("isLeashed", False) and self.state != "FETCHING":
            max_leash = 105.0
            dx = self.x - self.owner["x"]
            dy = self.y - self.owner["y"]
            dist = math.hypot(dx, dy)

            if dist > max_leash:
                self.x = self.owner["x"] + (dx / dist) * max_leash
                self.y = self.owner["y"] + (dy / dist) * max_leash
                self.vx *= 0.5
                self.vy *= 0.5
                return True
        return False

    def should_draw_leash(self):
        return bool(self.owner and self.owner.get("isLeashed", False) and self.state != "FETCHING")


class TestEntityInterpolatorLeashSync(unittest.TestCase):
    def setUp(self):
        self.interpolator = MockEntityInterpolator(lerp_rate=0.22)

    def test_initial_snapshot_is_leashed(self):
        """Initial snapshot with isLeashed: true sets current.isLeashed to true."""
        initial = {
            "x": 100.0,
            "y": 200.0,
            "vx": 0.0,
            "vy": 0.0,
            "angle": 0.0,
            "isMoving": False,
            "isLeashed": True
        }
        self.interpolator.set_target(initial)
        self.assertIsNotNone(self.interpolator.current)
        self.assertTrue(self.interpolator.current["isLeashed"])
        self.assertEqual(self.interpolator.current["x"], 100.0)

    def test_toggle_leash_propagation(self):
        """Subsequent snapshot with isLeashed: false updates current.isLeashed across set_target and update()."""
        # Initial: leashed
        self.interpolator.set_target({
            "x": 100.0,
            "y": 200.0,
            "vx": 0.0,
            "vy": 0.0,
            "angle": 0.0,
            "isMoving": False,
            "isLeashed": True
        })
        self.assertTrue(self.interpolator.current["isLeashed"])

        # Second snapshot: off-leash and moving
        next_snapshot = {
            "x": 120.0,
            "y": 210.0,
            "vx": 50.0,
            "vy": 25.0,
            "angle": 0.5,
            "isMoving": True,
            "isLeashed": False
        }
        self.interpolator.set_target(next_snapshot)
        self.assertFalse(self.interpolator.target["isLeashed"])

        # Run update tick (dt = 0.016s)
        updated = self.interpolator.update(0.016)
        self.assertFalse(updated["isLeashed"], "isLeashed should be false after target update")
        # Continuous interpolation progress
        self.assertGreater(updated["x"], 100.0)
        self.assertLess(updated["x"], 120.0)
        self.assertGreater(updated["angle"], 0.0)

    def test_dog_state_discrete_propagation(self):
        """Dog discrete state (FOLLOWING -> SITTING -> SNIFFING) updates cleanly across snapshots."""
        dog_interpolator = MockEntityInterpolator()
        dog_interpolator.set_target({
            "x": 50.0,
            "y": 50.0,
            "vx": 0.0,
            "vy": 0.0,
            "angle": 0.0,
            "state": "FOLLOWING"
        })
        self.assertEqual(dog_interpolator.current["state"], "FOLLOWING")

        dog_interpolator.set_target({
            "x": 60.0,
            "y": 50.0,
            "vx": 10.0,
            "vy": 0.0,
            "angle": 0.0,
            "state": "SITTING"
        })
        dog_interpolator.update(0.016)
        self.assertEqual(dog_interpolator.current["state"], "SITTING")

        dog_interpolator.set_target({
            "x": 70.0,
            "y": 50.0,
            "vx": 5.0,
            "vy": 0.0,
            "angle": 0.0,
            "state": "IDLE_SNIFF"
        })
        dog_interpolator.update(0.016)
        self.assertEqual(dog_interpolator.current["state"], "IDLE_SNIFF")


class TestProtocolSerialization(unittest.TestCase):
    def test_sync_state_leash_capture(self):
        """Protocol.createSyncState accurately captures owner.isLeashed."""
        owner_leashed = {
            "x": 1200.45,
            "y": 950.23,
            "vx": 119.8,
            "vy": 0.2,
            "angle": 1.5707,
            "isMoving": True,
            "isLeashed": True
        }
        dog = {
            "x": 1240.0,
            "y": 970.0,
            "vx": 130.0,
            "vy": 10.0,
            "angle": 1.57,
            "state": "FOLLOWING"
        }
        packet_leashed = MockProtocol.create_sync_state("peer-1", owner_leashed, dog)
        self.assertEqual(packet_leashed["type"], "SYNC_STATE")
        self.assertEqual(packet_leashed["senderId"], "peer-1")
        self.assertTrue(packet_leashed["owner"]["isLeashed"])

        # Test off-leash serialization
        owner_off_leash = dict(owner_leashed)
        owner_off_leash["isLeashed"] = False
        packet_off_leash = MockProtocol.create_sync_state("peer-1", owner_off_leash, dog)
        self.assertFalse(packet_off_leash["owner"]["isLeashed"])


class TestCompanionDogLeashConstraints(unittest.TestCase):
    def test_leashed_distance_clamping(self):
        """When owner.isLeashed is true, distance clamping is enforced beyond 105px."""
        owner = {"x": 100.0, "y": 100.0, "isLeashed": True}
        dog = MockCompanionDog(x=100.0, y=250.0, owner=owner) # dist = 150px > 105px
        self.assertTrue(dog.should_draw_leash())

        clamped = dog.update_leash_constraint()
        self.assertTrue(clamped)
        dist = math.hypot(dog.x - owner["x"], dog.y - owner["y"])
        self.assertAlmostEqual(dist, 105.0, places=4)

    def test_off_leash_distance_unclamped_and_render_suppressed(self):
        """When owner.isLeashed is false, distance clamping is not enforced and leash rendering is suppressed."""
        owner = {"x": 100.0, "y": 100.0, "isLeashed": False}
        dog = MockCompanionDog(x=100.0, y=300.0, owner=owner) # dist = 200px > 105px
        self.assertFalse(dog.should_draw_leash(), "Leash rendering must be suppressed when off-leash")

        clamped = dog.update_leash_constraint()
        self.assertFalse(clamped, "No distance clamping should be enforced when off-leash")
        self.assertEqual(dog.x, 100.0)
        self.assertEqual(dog.y, 300.0)

    def test_fetching_suppresses_leash_clamping_and_render(self):
        """When fetching a ball, leash constraint and rendering are suppressed even if owner is marked leashed."""
        owner = {"x": 100.0, "y": 100.0, "isLeashed": True}
        dog = MockCompanionDog(x=100.0, y=300.0, owner=owner)
        dog.state = "FETCHING"

        self.assertFalse(dog.should_draw_leash())
        clamped = dog.update_leash_constraint()
        self.assertFalse(clamped)
        self.assertEqual(dog.x, 100.0)
        self.assertEqual(dog.y, 300.0)


if __name__ == "__main__":
    unittest.main()
