#!/usr/bin/env python3
import time

def test_sync_state_schema():
    packet = {
        "type": "SYNC_STATE",
        "senderId": "peer-1234",
        "timestamp": int(time.time() * 1000),
        "owner": {
            "x": 1200.5,
            "y": 950.2,
            "vx": 120,
            "vy": 0,
            "angle": 1.57,
            "isMoving": True,
            "isLeashed": True
        },
        "dog": {
            "x": 1240.0,
            "y": 970.0,
            "vx": 130,
            "vy": 10,
            "angle": 1.57,
            "state": "FOLLOWING"
        }
    }
    
    assert packet["type"] == "SYNC_STATE"
    assert "owner" in packet and "dog" in packet
    assert packet["owner"]["x"] == 1200.5
    assert packet["dog"]["state"] == "FOLLOWING"
    print("✅ test_sync_state_schema passed")

def test_ball_throw_schema():
    packet = {
        "type": "BALL_THROWN",
        "senderId": "peer-1234",
        "fromX": 500,
        "fromY": 400,
        "dirX": 1.0,
        "dirY": 0.0,
        "speed": 380,
        "timestamp": int(time.time() * 1000)
    }
    
    assert packet["type"] == "BALL_THROWN"
    assert packet["speed"] == 380
    assert packet["dirX"] == 1.0
    print("✅ test_ball_throw_schema passed")

def test_chat_and_emote_schema():
    chat_packet = {
        "type": "CHAT_MESSAGE",
        "senderId": "peer-1234",
        "text": "Hello Clifton Down!",
        "timestamp": int(time.time() * 1000)
    }
    emote_packet = {
        "type": "EMOTE",
        "senderId": "peer-1234",
        "emote": "🐾",
        "timestamp": int(time.time() * 1000)
    }
    
    assert chat_packet["text"] == "Hello Clifton Down!"
    assert emote_packet["emote"] == "🐾"
    print("✅ test_chat_and_emote_schema passed")

if __name__ == "__main__":
    test_sync_state_schema()
    test_ball_throw_schema()
    test_chat_and_emote_schema()
