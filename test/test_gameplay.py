#!/usr/bin/env python3
import sys

class MockGame:
    def __init__(self):
        self.score = 0
        self.bones = 0
        self.lives = 3
        self.speed_boost = 0.0
        self.is_victory = False

    def collect_item(self, item_type):
        if item_type == "BONE":
            self.bones += 1
            self.score += 100
        elif item_type == "TENNIS_BALL":
            self.score += 50
            self.speed_boost = 5.0
        elif item_type == "SAUSAGE":
            self.score += 150
            self.lives = min(3, self.lives + 1)

    def reach_goal(self):
        self.is_victory = True
        self.score += 500

def test_collectible_scoring():
    game = MockGame()
    game.collect_item("BONE")
    game.collect_item("BONE")
    assert game.bones == 2
    assert game.score == 200

    game.collect_item("TENNIS_BALL")
    assert game.speed_boost == 5.0
    assert game.score == 250

    game.collect_item("SAUSAGE")
    assert game.score == 400
    assert game.lives == 3
    print("✅ test_collectible_scoring passed")

def test_goal_gate_victory():
    game = MockGame()
    assert not game.is_victory
    game.reach_goal()
    assert game.is_victory
    assert game.score == 500
    print("✅ test_goal_gate_victory passed")

if __name__ == "__main__":
    test_collectible_scoring()
    test_goal_gate_victory()
    print("🎉 All gameplay tests passed!")
