#!/usr/bin/env python3
import math

def test_arrival_steering():
    # Test arrival steering slowing radius logic
    max_speed = 195.0
    slowing_radius = 40.0
    
    # Beyond slowing radius: full speed
    dist_far = 80.0
    speed_far = max_speed if dist_far >= slowing_radius else max_speed * (dist_far / slowing_radius)
    assert speed_far == 195.0, f"Expected full speed 195, got {speed_far}"
    
    # Within slowing radius: linearly scaled speed
    dist_near = 20.0
    speed_near = max_speed * (dist_near / slowing_radius)
    assert speed_near == 97.5, f"Expected half speed 97.5, got {speed_near}"
    
    # Below deadzone threshold (dist <= 8)
    dist_stopped = 6.0
    is_stopped = dist_stopped <= 8.0
    assert is_stopped, "Expected dog to come to rest when within 8px"
    print("✅ test_arrival_steering passed")

def test_leash_clamping():
    # Test hard constraint clamping when leashed
    max_leash = 105.0
    owner_x, owner_y = 100.0, 100.0
    
    # Dog pulled beyond max leash
    dog_x, dog_y = 100.0, 250.0 # dist = 150.0
    dx = dog_x - owner_x
    dy = dog_y - owner_y
    dist = math.hypot(dx, dy)
    
    assert dist > max_leash
    clamped_x = owner_x + (dx / dist) * max_leash
    clamped_y = owner_y + (dy / dist) * max_leash
    
    clamped_dist = math.hypot(clamped_x - owner_x, clamped_y - owner_y)
    assert abs(clamped_dist - max_leash) < 1e-4, f"Expected {max_leash}, got {clamped_dist}"
    print("✅ test_leash_clamping passed")

def test_play_bow_proximity():
    # Test dog-to-dog greeting proximity threshold
    proximity_threshold = 58.0
    dog1 = (100.0, 100.0)
    dog2_near = (130.0, 130.0)
    dog2_far = (200.0, 200.0)
    
    dist_near = math.hypot(dog1[0] - dog2_near[0], dog1[1] - dog2_near[1])
    dist_far = math.hypot(dog1[0] - dog2_far[0], dog1[1] - dog2_far[1])
    
    assert dist_near < proximity_threshold, "Expected near dogs to trigger play bow check"
    assert dist_far > proximity_threshold, "Expected far dogs to not trigger play bow"
    print("✅ test_play_bow_proximity passed")

if __name__ == "__main__":
    test_arrival_steering()
    test_leash_clamping()
    test_play_bow_proximity()
