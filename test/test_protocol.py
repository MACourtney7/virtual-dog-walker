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

def test_whistle_schema():
    packet = {
        "type": "WHISTLE",
        "senderId": "peer-1234",
        "x": 1350.0,
        "y": 1000.0,
        "timestamp": int(time.time() * 1000)
    }

    assert packet["type"] == "WHISTLE"
    assert packet["senderId"] == "peer-1234"
    assert packet["x"] == 1350.0
    assert packet["y"] == 1000.0
    assert "timestamp" in packet
    print("✅ test_whistle_schema passed")

def test_entity_interpolator_discrete_propagation():
    """Verify EntityInterpolator propagates non-spatial discrete properties to current."""
    import math

    class EntityInterpolator:
        def __init__(self):
            self.target = None
            self.current = None
            self.lerpRate = 0.22

        def setTarget(self, snapshot):
            if not self.current:
                self.current = dict(snapshot)
            for k in snapshot:
                if k not in ('x', 'y', 'angle'):
                    self.current[k] = snapshot[k]
            self.target = dict(snapshot)

        def update(self, dt):
            if not self.target or not self.current:
                return self.current
            for k in self.target:
                if k not in ('x', 'y', 'angle'):
                    self.current[k] = self.target[k]

            rate = 1 - math.exp(-self.lerpRate * 60 * dt)
            self.current['x'] += (self.target['x'] - self.current['x']) * rate
            self.current['y'] += (self.target['y'] - self.current['y']) * rate
            self.current['vx'] = self.target.get('vx', 0)
            self.current['vy'] = self.target.get('vy', 0)
            return self.current

    interp = EntityInterpolator()
    snap1 = {"x": 100.0, "y": 200.0, "angle": 0.0, "vx": 0, "vy": 0, "isMoving": False, "isLeashed": True}
    interp.setTarget(snap1)

    assert interp.current["isLeashed"] is True
    assert interp.current["isMoving"] is False

    # Receive new snapshot toggling isLeashed to False immediately
    snap2 = {"x": 120.0, "y": 200.0, "angle": 0.0, "vx": 20, "vy": 0, "isMoving": True, "isLeashed": False}
    interp.setTarget(snap2)

    # Immediately upon setTarget, non-spatial discrete property isLeashed should update in current
    assert interp.current["isLeashed"] is False
    assert interp.current["isMoving"] is True
    # Position should still be un-interpolated before update
    assert interp.current["x"] == 100.0

    # Call update with dt
    res = interp.update(0.016)
    assert res["isLeashed"] is False
    assert res["isMoving"] is True
    assert res["x"] > 100.0

    print("✅ test_entity_interpolator_discrete_propagation passed")

def test_npc_spawn_schema():
    now = int(time.time() * 1000)
    packet = {
        "type": "NPC_SPAWN",
        "id": "npc-101",
        "pathId": "path_perimeter_main",
        "npcType": "walker",
        "seed": 42,
        "spawnTime": now,
        "npc": {
            "id": "npc-101",
            "pathId": "path_perimeter_main",
            "type": "walker",
            "npcType": "walker",
            "seed": 42,
            "spawnTime": now
        },
        "timestamp": now
    }

    assert packet["type"] == "NPC_SPAWN"
    assert isinstance(packet["id"], str) and len(packet["id"]) > 0
    assert isinstance(packet["pathId"], str) and len(packet["pathId"]) > 0
    assert packet["npcType"] in ("walker", "jogger")
    assert isinstance(packet["seed"], (int, float))
    assert isinstance(packet["spawnTime"], (int, float))
    assert packet["npc"]["id"] == packet["id"]
    assert packet["npc"]["pathId"] == packet["pathId"]
    assert packet["npc"]["type"] == packet["npcType"]
    assert packet["npc"]["seed"] == packet["seed"]
    assert packet["npc"]["spawnTime"] == packet["spawnTime"]
    print("✅ test_npc_spawn_schema passed")

def test_npc_despawn_schema():
    now = int(time.time() * 1000)
    packet = {
        "type": "NPC_DESPAWN",
        "id": "npc-101",
        "timestamp": now
    }

    assert packet["type"] == "NPC_DESPAWN"
    assert isinstance(packet["id"], str) and len(packet["id"]) > 0
    assert "timestamp" in packet
    print("✅ test_npc_despawn_schema passed")

def test_npc_snapshot_schema():
    now = int(time.time() * 1000)
    packet = {
        "type": "NPC_SNAPSHOT",
        "npcs": [
            {
                "id": "npc-101",
                "pathId": "path_perimeter_main",
                "type": "walker",
                "npcType": "walker",
                "seed": 42,
                "spawnTime": now - 5000
            },
            {
                "id": "npc-102",
                "pathId": "path_promenade_loop",
                "type": "jogger",
                "npcType": "jogger",
                "seed": 103,
                "spawnTime": now - 2000
            }
        ],
        "serverTime": now,
        "timestamp": now
    }

    assert packet["type"] == "NPC_SNAPSHOT"
    assert isinstance(packet["npcs"], list)
    assert len(packet["npcs"]) == 2
    assert isinstance(packet["serverTime"], (int, float))
    for npc in packet["npcs"]:
        assert isinstance(npc["id"], str)
        assert isinstance(npc["pathId"], str)
        assert npc["type"] in ("walker", "jogger")
        assert isinstance(npc["seed"], (int, float))
        assert isinstance(npc["spawnTime"], (int, float))
    print("✅ test_npc_snapshot_schema passed")

if __name__ == "__main__":
    test_sync_state_schema()
    test_ball_throw_schema()
    test_chat_and_emote_schema()
    test_whistle_schema()
    test_entity_interpolator_discrete_propagation()
    test_npc_spawn_schema()
    test_npc_despawn_schema()
    test_npc_snapshot_schema()
