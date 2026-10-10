#!/usr/bin/env python3
import sys

class MockZiggy:
    def __init__(self):
        self.state = "IDLE"
        self.can_flutter = True
        self.is_fluttering = False
        self.is_grounded = True
        self.vel_y = 0.0
        self.bark_cooldown = 0.0
        self.active_barks = 0

    def jump(self):
        if self.is_grounded:
            self.vel_y = -490.0
            self.is_grounded = False
            self.state = "JUMPING"
        elif self.can_flutter and not self.is_grounded:
            self.can_flutter = False
            self.is_fluttering = True
            self.vel_y = -180.0
            self.state = "FLUTTERING"

    def bark(self):
        if self.bark_cooldown <= 0.0:
            self.bark_cooldown = 0.45
            self.active_barks += 1
            self.state = "BARKING"

    def land(self):
        self.is_grounded = True
        self.is_fluttering = False
        self.can_flutter = True
        self.vel_y = 0.0
        self.state = "IDLE"

def test_ziggy_jump_and_flutter():
    ziggy = MockZiggy()
    assert ziggy.state == "IDLE"
    
    # Ground jump
    ziggy.jump()
    assert ziggy.state == "JUMPING"
    assert ziggy.vel_y == -490.0
    assert not ziggy.is_grounded
    
    # Mid-air ear-flap flutter
    ziggy.jump()
    assert ziggy.state == "FLUTTERING"
    assert ziggy.vel_y == -180.0
    assert not ziggy.can_flutter
    
    # Land on ground
    ziggy.land()
    assert ziggy.state == "IDLE"
    assert ziggy.can_flutter
    print("✅ test_ziggy_jump_and_flutter passed")

def test_ziggy_bark_cooldown():
    ziggy = MockZiggy()
    assert ziggy.bark_cooldown == 0.0
    
    ziggy.bark()
    assert ziggy.active_barks == 1
    assert ziggy.bark_cooldown == 0.45
    
    # Immediate secondary bark should be blocked by cooldown
    ziggy.bark()
    assert ziggy.active_barks == 1
    print("✅ test_ziggy_bark_cooldown passed")

if __name__ == "__main__":
    test_ziggy_jump_and_flutter()
    test_ziggy_bark_cooldown()
    print("🎉 All Ziggy entity tests passed!")
