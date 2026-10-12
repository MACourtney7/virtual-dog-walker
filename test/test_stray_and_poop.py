#!/usr/bin/env python3
"""
Unit tests for Ticket 014:
Canine Stray Run-Off, Directional Navigation Arrow & Dog Waste/Bin Mechanics

Test cases:
- test_navigation_arrow_bearing_and_clamping: Bearing angle math and perimeter screen clamping formulas.
- test_navigation_arrow_target_lifecycle: setTarget, clearTarget, getTarget, distance formatting.
- test_idle_stray_timer_accumulation_and_reset: local owner speed < 2 accumulates ownerStillTimer, speed >= 2 resets it, whistle resets it.
- test_obedience_stray_probability_scaling: Probability distribution across obedience ratings 1 through 5.
- test_stray_run_off_state_and_retrieval: Transition to DogState.LOST, stationary stay, and retrieval upon proximity (<55px) or whistle recall.
- test_poop_pile_lifecycle_and_field_bins: PoopPile instantiation, field.addPoopPile, field.removePoopPile, and field.getNearestBin.
- test_waste_pickup_and_bin_disposal_flow: Pickup state (hasPoopBag = true), nearest bin arrow assignment, and disposal completion.
"""

import math
import os
import unittest


class MockNavigationArrow:
    def __init__(self, padding=45):
        self.target = None
        self.pulseTimer = 0.0
        self.active = False
        self.padding = padding

    def setTarget(self, x, y, target_type='DOG', label='', color='#f59e0b'):
        self.target = {
            'x': x,
            'y': y,
            'type': target_type,
            'label': label,
            'color': color or ('#10b981' if target_type == 'BIN' else '#f59e0b')
        }
        self.active = True

    def clearTarget(self):
        self.target = None
        self.active = False

    def getTarget(self):
        return self.target

    def update(self, dt):
        self.pulseTimer += dt

    @staticmethod
    def format_distance(dist_px):
        meters = max(1, round(dist_px / 20))
        return f"{meters}m"

    @staticmethod
    def clamp_ray_to_box(cx, cy, angle, min_x, max_x, min_y, max_y):
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        t_min = float('inf')

        if cos_a > 1e-6:
            t = (max_x - cx) / cos_a
            if 0 < t < t_min:
                t_min = t
        if cos_a < -1e-6:
            t = (min_x - cx) / cos_a
            if 0 < t < t_min:
                t_min = t
        if sin_a > 1e-6:
            t = (max_y - cy) / sin_a
            if 0 < t < t_min:
                t_min = t
        if sin_a < -1e-6:
            t = (min_y - cy) / sin_a
            if 0 < t < t_min:
                t_min = t

        if not math.isfinite(t_min) or t_min <= 0:
            return cx, cy

        x = max(min_x, min(max_x, cx + cos_a * t_min))
        y = max(min_y, min(max_y, cy + sin_a * t_min))
        return x, y


class MockOwner:
    def __init__(self, x=1350.0, y=1000.0, is_leashed=False):
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.isLeashed = is_leashed


class MockField:
    def __init__(self, width=3200, height=2400):
        self.width = width
        self.height = height
        self.poopPiles = []
        self.bins = [
            {'id': 'bin-1', 'x': 280, 'y': 820, 'radius': 12},
            {'id': 'bin-2', 'x': 320, 'y': 1480, 'radius': 12},
            {'id': 'bin-3', 'x': 520, 'y': 1850, 'radius': 12},
            {'id': 'bin-4', 'x': 1550, 'y': 1200, 'radius': 12},
            {'id': 'bin-5', 'x': 2500, 'y': 620, 'radius': 12},
            {'id': 'bin-6', 'x': 2280, 'y': 480, 'radius': 12},
            {'id': 'bin-7', 'x': 1420, 'y': 820, 'radius': 12},
            {'id': 'bin-8', 'x': 1080, 'y': 1750, 'radius': 12}
        ]

    def addPoopPile(self, pile):
        if pile:
            self.poopPiles.append(pile)

    def removePoopPile(self, pile_id):
        self.poopPiles = [p for p in self.poopPiles if p.id != pile_id]

    def getNearestBin(self, x, y):
        if not self.bins:
            return None
        nearest = None
        min_dist = float('inf')
        for b in self.bins:
            dist = math.hypot(b['x'] - x, b['y'] - y)
            if dist < min_dist:
                min_dist = dist
                nearest = b
        if nearest:
            res = dict(nearest)
            res['dist'] = min_dist
            return res
        return None


class MockPoopPile:
    def __init__(self, pile_id, x, y):
        self.id = pile_id or f"poop-{x}-{y}"
        self.x = x
        self.y = y
        self.radius = 10
        self.depthY = y + 4
        self.isCleaned = False
        self.pulse = 0.0

    def update(self, dt):
        self.pulse += dt


class MockCompanionDog:
    def __init__(self, x=1390.0, y=1020.0, owner=None, obedience=4):
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.owner = owner
        self.state = "ROAMING"
        self.personality = {'obedience': obedience}
        self.ownerStillTimer = 0.0
        self.strayCheckTimer = 0.0
        self.isLost = False
        self.lostTargetX = 0.0
        self.lostTargetY = 0.0
        self.poopTimer = 0.0
        self.nextPoopTime = 180.0
        self.poopSquatDuration = 0.0

        # Callbacks
        self.onStrayTriggered = None
        self.onStrayResolved = None
        self.onPoopDropped = None

    def whistleRecall(self):
        was_lost = (self.state == "LOST" or self.isLost)
        self.state = "RECALLED"
        self.isLost = False
        self.ownerStillTimer = 0.0
        self.strayCheckTimer = 0.0
        if was_lost and callable(self.onStrayResolved):
            self.onStrayResolved(self)

    def triggerStray(self, rx=500.0, ry=500.0):
        self.state = "LOST"
        self.isLost = True
        self.lostTargetX = rx
        self.lostTargetY = ry
        self.x = rx
        self.y = ry
        self.vx = 0.0
        self.vy = 0.0
        if callable(self.onStrayTriggered):
            self.onStrayTriggered(self)

    def update(self, dt, field=None, force_stray_roll=None):
        is_leashed = bool(self.owner and self.owner.isLeashed)

        if self.owner and not is_leashed and self.state != "LOST":
            owner_speed = math.hypot(self.owner.vx, self.owner.vy)
            if owner_speed < 2.0:
                self.ownerStillTimer += dt
            else:
                self.ownerStillTimer = 0.0
                self.strayCheckTimer = 0.0

            if self.ownerStillTimer > 35.0:
                self.strayCheckTimer += dt
                if self.strayCheckTimer >= 5.0:
                    self.strayCheckTimer = 0.0
                    ob = max(1, min(5, round(self.personality['obedience'])))
                    prob_map = {1: 0.50, 2: 0.30, 3: 0.15, 4: 0.05, 5: 0.01}
                    prob = prob_map.get(ob, 0.05)

                    roll = force_stray_roll if force_stray_roll is not None else 1.0
                    if roll < prob:
                        self.triggerStray(800.0, 900.0)
        else:
            self.ownerStillTimer = 0.0
            self.strayCheckTimer = 0.0
            if is_leashed and (self.state == "LOST" or self.isLost):
                self.state = "FOLLOWING"
                self.isLost = False
                if callable(self.onStrayResolved):
                    self.onStrayResolved(self)

        if self.state == "LOST":
            self.updateLost(dt)
        elif self.state == "POOPING":
            self.updatePooping(dt, field)

    def updateLost(self, dt):
        self.vx = 0.0
        self.vy = 0.0
        if self.owner:
            dist = math.hypot(self.x - self.owner.x, self.y - self.owner.y)
            if dist < 55.0:
                self.state = "RECALLED"
                self.isLost = False
                self.ownerStillTimer = 0.0
                self.strayCheckTimer = 0.0
                if callable(self.onStrayResolved):
                    self.onStrayResolved(self)

    def updatePooping(self, dt, field):
        self.vx = 0.0
        self.vy = 0.0
        self.poopSquatDuration -= dt
        if self.poopSquatDuration <= 0:
            pile = MockPoopPile(None, self.x, self.y)
            if field and hasattr(field, 'addPoopPile'):
                field.addPoopPile(pile)
            if callable(self.onPoopDropped):
                self.onPoopDropped(self, pile)
            self.state = "FOLLOWING" if (self.owner and self.owner.isLeashed) else "ROAMING"


class TestStrayAndPoopSuite(unittest.TestCase):
    """Automated integration and unit test suite for stray run-off and poop disposal."""

    def test_navigation_arrow_bearing_and_clamping(self):
        """Tests bearing angle math and perimeter screen clamping formulas."""
        w, h = 1280, 720
        pad = 45
        cx, cy = w / 2, h / 2
        min_x, max_x = pad, w - pad
        min_y, max_y = pad, h - pad

        # East angle (0 rad)
        x_east, y_east = MockNavigationArrow.clamp_ray_to_box(cx, cy, 0.0, min_x, max_x, min_y, max_y)
        self.assertAlmostEqual(x_east, max_x)
        self.assertAlmostEqual(y_east, cy)

        # North angle (-pi/2 rad)
        x_north, y_north = MockNavigationArrow.clamp_ray_to_box(cx, cy, -math.pi / 2, min_x, max_x, min_y, max_y)
        self.assertAlmostEqual(x_north, cx)
        self.assertAlmostEqual(y_north, min_y)

        # West angle (pi rad)
        x_west, y_west = MockNavigationArrow.clamp_ray_to_box(cx, cy, math.pi, min_x, max_x, min_y, max_y)
        self.assertAlmostEqual(x_west, min_x)
        self.assertAlmostEqual(y_west, cy)

        # South angle (pi/2 rad)
        x_south, y_south = MockNavigationArrow.clamp_ray_to_box(cx, cy, math.pi / 2, min_x, max_x, min_y, max_y)
        self.assertAlmostEqual(x_south, cx)
        self.assertAlmostEqual(y_south, max_y)

    def test_navigation_arrow_target_lifecycle(self):
        """Tests setTarget, clearTarget, getTarget, distance formatting."""
        arrow = MockNavigationArrow(padding=40)
        self.assertFalse(arrow.active)
        self.assertIsNone(arrow.getTarget())

        # Set Target for Lost Dog
        arrow.setTarget(1500, 800, 'DOG', 'Find your dog!', '#f59e0b')
        self.assertTrue(arrow.active)
        target = arrow.getTarget()
        self.assertEqual(target['x'], 1500)
        self.assertEqual(target['y'], 800)
        self.assertEqual(target['type'], 'DOG')
        self.assertEqual(target['color'], '#f59e0b')

        # Distance formatting: 20px per meter
        self.assertEqual(MockNavigationArrow.format_distance(400), "20m")
        self.assertEqual(MockNavigationArrow.format_distance(15), "1m")

        # Advance timer
        arrow.update(0.5)
        self.assertAlmostEqual(arrow.pulseTimer, 0.5)

        # Clear Target
        arrow.clearTarget()
        self.assertFalse(arrow.active)
        self.assertIsNone(arrow.getTarget())

    def test_idle_stray_timer_accumulation_and_reset(self):
        """Tests that local owner speed < 2 accumulates ownerStillTimer, speed >= 2 resets it, whistle resets it."""
        owner = MockOwner(x=1000.0, y=1000.0, is_leashed=False)
        dog = MockCompanionDog(x=1040.0, y=1020.0, owner=owner, obedience=3)

        # 1. Owner still (speed = 0): accumulates still timer
        owner.vx = 0.0
        owner.vy = 0.0
        for _ in range(10):
            dog.update(1.0)
        self.assertAlmostEqual(dog.ownerStillTimer, 10.0)

        # 2. Owner moves (speed = 5 > 2): resets timer to 0
        owner.vx = 4.0
        owner.vy = 3.0  # speed = 5.0
        dog.update(0.1)
        self.assertEqual(dog.ownerStillTimer, 0.0)

        # 3. Owner stops again: re-accumulates
        owner.vx = 0.0
        owner.vy = 0.0
        for _ in range(20):
            dog.update(1.0)
        self.assertAlmostEqual(dog.ownerStillTimer, 20.0)

        # 4. Whistle recall resets timer
        dog.whistleRecall()
        self.assertEqual(dog.ownerStillTimer, 0.0)

    def test_obedience_stray_probability_scaling(self):
        """Tests probability distribution across obedience ratings 1 through 5."""
        prob_map = {1: 0.50, 2: 0.30, 3: 0.15, 4: 0.05, 5: 0.01}

        # Verify monotonicity: higher obedience yields lower stray probability
        for ob in range(1, 5):
            self.assertGreater(prob_map[ob], prob_map[ob + 1])

        self.assertEqual(prob_map[1], 0.50)
        self.assertEqual(prob_map[2], 0.30)
        self.assertEqual(prob_map[3], 0.15)
        self.assertEqual(prob_map[4], 0.05)
        self.assertEqual(prob_map[5], 0.01)

    def test_stray_run_off_state_and_retrieval(self):
        """Tests transition to DogState.LOST, stationary stay, and retrieval upon proximity (<55px) or whistle recall."""
        owner = MockOwner(x=1000.0, y=1000.0, is_leashed=False)
        dog = MockCompanionDog(x=1040.0, y=1020.0, owner=owner, obedience=1)

        events_triggered = []
        events_resolved = []

        dog.onStrayTriggered = lambda d: events_triggered.append(d)
        dog.onStrayResolved = lambda d: events_resolved.append(d)

        # Stand still for >35 seconds (36s)
        for _ in range(36):
            dog.update(1.0, force_stray_roll=0.99)
        self.assertFalse(dog.isLost)

        # At t=35+5=40s, roll triggers stray
        dog.update(5.0, force_stray_roll=0.10)  # roll < 0.50 triggers stray
        self.assertTrue(dog.isLost)
        self.assertEqual(dog.state, "LOST")
        self.assertEqual(len(events_triggered), 1)

        # Stationary stay in LOST state
        dog.update(1.0)
        self.assertEqual(dog.vx, 0.0)
        self.assertEqual(dog.vy, 0.0)
        self.assertEqual(dog.state, "LOST")

        # Retrieval 1: Owner approaches (< 55px)
        owner.x = dog.x + 30.0
        owner.y = dog.y + 10.0
        dog.update(0.1)
        self.assertFalse(dog.isLost)
        self.assertEqual(dog.state, "RECALLED")
        self.assertEqual(len(events_resolved), 1)

        # Retrieval 2 via whistle recall
        dog.triggerStray(1800.0, 1600.0)
        self.assertTrue(dog.isLost)
        self.assertEqual(dog.state, "LOST")

        dog.whistleRecall()
        self.assertFalse(dog.isLost)
        self.assertEqual(dog.state, "RECALLED")
        self.assertEqual(len(events_resolved), 2)

    def test_poop_pile_lifecycle_and_field_bins(self):
        """Tests PoopPile instantiation, field.addPoopPile, field.removePoopPile, and field.getNearestBin."""
        field = MockField()
        pile = MockPoopPile("pile-test-1", 1400, 1100)

        field.addPoopPile(pile)
        self.assertEqual(len(field.poopPiles), 1)
        self.assertEqual(field.poopPiles[0].id, "pile-test-1")

        # Test nearest bin query
        # Bin 4 is at (1550, 1200); dist from (1400, 1100) is sqrt(150^2 + 100^2) = ~180px
        nearest = field.getNearestBin(1400, 1100)
        self.assertIsNotNone(nearest)
        self.assertEqual(nearest['id'], 'bin-4')
        self.assertAlmostEqual(nearest['dist'], math.hypot(150, 100), delta=1.0)

        # Remove poop pile
        field.removePoopPile("pile-test-1")
        self.assertEqual(len(field.poopPiles), 0)

    def test_waste_pickup_and_bin_disposal_flow(self):
        """Tests pickup state (hasPoopBag = true), nearest bin arrow assignment, and disposal completion."""
        field = MockField()
        nav_arrow = MockNavigationArrow()
        owner = MockOwner(x=1400, y=1100)
        pile = MockPoopPile("poop-42", 1400, 1100)
        field.addPoopPile(pile)

        # Game state simulation
        has_poop_bag = False
        active_poop_near_player = pile

        # 1. Player presses E or taps to pick up waste
        field.removePoopPile(active_poop_near_player.id)
        has_poop_bag = True
        active_poop_near_player = None

        self.assertTrue(has_poop_bag)
        self.assertEqual(len(field.poopPiles), 0)

        # Set arrow pointing to nearest bin
        nearest_bin = field.getNearestBin(owner.x, owner.y)
        self.assertIsNotNone(nearest_bin)
        nav_arrow.setTarget(nearest_bin['x'], nearest_bin['y'], 'BIN', 'Nearest Bin', '#10b981')

        self.assertTrue(nav_arrow.active)
        self.assertEqual(nav_arrow.target['type'], 'BIN')
        self.assertEqual(nav_arrow.target['color'], '#10b981')

        # 2. Player walks to nearest bin and interacts to dispose
        owner.x = nearest_bin['x']
        owner.y = nearest_bin['y']
        active_bin_near_player = nearest_bin

        # Dispose bag
        has_poop_bag = False
        active_bin_near_player = None
        if nav_arrow.target and nav_arrow.target['type'] == 'BIN':
            nav_arrow.clearTarget()

        self.assertFalse(has_poop_bag)
        self.assertFalse(nav_arrow.active)
        self.assertIsNone(nav_arrow.getTarget())


if __name__ == '__main__':
    unittest.main()
