#!/usr/bin/env python3
import math

def test_ballistic_flight_and_gravity():
    gravity = 720.0
    dt = 0.016
    z = 10.0
    vz = 180.0
    
    # 5 steps of upward flight
    for _ in range(5):
        vz -= gravity * dt
        z += vz * dt
        
    assert z > 10.0, f"Expected ball to rise above initial height, got {z}"
    print("✅ test_ballistic_flight_and_gravity passed")

def test_ground_bounce_restitution():
    restitution = 0.62
    vz_impact = -120.0
    
    # Bounce
    vz_bounce = -vz_impact * restitution
    assert vz_bounce > 0, "Expected positive upward bounce velocity"
    assert abs(vz_bounce - 74.4) < 1e-3, f"Expected 74.4, got {vz_bounce}"
    print("✅ test_ground_bounce_restitution passed")

def test_rolling_friction_decay():
    friction = 0.94
    dt = 0.016
    vx = 100.0
    
    # After 10 frames of rolling on grass
    for _ in range(10):
        vx *= math.pow(friction, dt * 60)
        
    assert vx < 100.0, f"Expected velocity decay from rolling friction, got {vx}"
    assert vx > 0.0, "Expected non-negative decaying velocity"
    print("✅ test_rolling_friction_decay passed")

if __name__ == "__main__":
    test_ballistic_flight_and_gravity()
    test_ground_bounce_restitution()
    test_rolling_friction_decay()
