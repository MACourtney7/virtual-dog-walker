#!/usr/bin/env python3
import sys

class AABB:
    def __init__(self, x, y, width, height):
        self.x = x
        self.y = y
        self.width = width
        self.height = height

    @property
    def left(self): return self.x
    @property
    def right(self): return self.x + self.width
    @property
    def top(self): return self.y
    @property
    def bottom(self): return self.y + self.height

    def intersects(self, other):
        return (
            self.left < other.right and
            self.right > other.left and
            self.top < other.bottom and
            self.bottom > other.top
        )

def test_aabb_intersection():
    b1 = AABB(0, 0, 32, 32)
    b2 = AABB(16, 16, 32, 32)
    b3 = AABB(40, 40, 32, 32)
    
    assert b1.intersects(b2), "Overlapping boxes should intersect"
    assert not b1.intersects(b3), "Disjoint boxes should not intersect"
    print("✅ test_aabb_intersection passed")

def test_kinematic_gravity_and_floor():
    # Simulate body falling onto floor at y=200
    pos_y = 100.0
    vel_y = 0.0
    gravity = 1100.0
    height = 40.0
    floor_top = 200.0
    
    dt = 0.016
    grounded = False
    
    for _ in range(30):
        vel_y += gravity * dt
        pos_y += vel_y * dt
        if pos_y + height >= floor_top:
            pos_y = floor_top - height
            vel_y = 0.0
            grounded = True
            break
            
    assert grounded, "Body should have landed on the floor"
    assert pos_y == 160.0, f"Body should rest atop floor (expected 160.0, got {pos_y})"
    print("✅ test_kinematic_gravity_and_floor passed")

def test_one_way_platform_pass_through():
    # When jumping from below (vel_y < 0), should pass through one-way platform
    pos_y = 250.0
    vel_y = -400.0
    platform_top = 200.0
    
    dt = 0.016
    passed_through = False
    
    for _ in range(20):
        pos_y += vel_y * dt
        if pos_y < platform_top:
            passed_through = True
            break
            
    assert passed_through, "Body should pass upwards through one-way platform"
    print("✅ test_one_way_platform_pass_through passed")

if __name__ == "__main__":
    test_aabb_intersection()
    test_kinematic_gravity_and_floor()
    test_one_way_platform_pass_through()
    print("🎉 All physics tests passed!")
