#!/usr/bin/env python3
"""
Clifton Down: Dedicated Multiplayer Microserver
Asynchronous HTTP & WebSocket Room Relay Engine with Server-Authoritative NPC Spawner
"""

import argparse
import asyncio
import json
import logging
import os
import random
import sys
import time
import uuid
from typing import Dict, List, Optional, Set, Tuple
from aiohttp import web, WSMsgType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("CliftonServer")

WALKER_SPEED = 22.0  # px/s
JOGGER_SPEED = 48.0  # px/s
TARGET_ACTIVE_NPCS = 5
MIN_ACTIVE_NPCS = 4
MAX_ACTIVE_NPCS = 6


def load_npc_manifest(static_dir: str = ".") -> list:
    """Load NPC path definitions from npc_path_manifest.json."""
    manifest_path = os.path.join(static_dir, "src", "world", "npc_path_manifest.json")
    if not os.path.exists(manifest_path):
        manifest_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "npc_path_manifest.json")
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load NPC path manifest from {manifest_path}: {e}")
    return []


class PeerConnection:
    def __init__(self, ws: web.WebSocketResponse, peer_id: str, room_id: str):
        self.ws = ws
        self.peer_id = peer_id
        self.room_id = room_id
        self.meta: Dict = {
            "name": "Walker",
            "jacketColor": "#1e3a8a",
            "coatName": "Chocolate & Tan (Ziggy)"
        }

    async def send_json(self, data: dict):
        if not self.ws.closed:
            try:
                await self.ws.send_str(json.dumps(data))
            except Exception as e:
                logger.debug(f"Failed to send to peer {self.peer_id}: {e}")


class RoomNpcSpawner:
    """
    Server-authoritative global NPC spawner per room.
    Maintains an active pool of 4-6 NPCs (target 5) on unused paths,
    broadcasting NPC_SPAWN, NPC_DESPAWN, and sending NPC_SNAPSHOT.
    """
    def __init__(self, room_id: str, room_manager: "RoomManager", manifest: Optional[list] = None):
        self.room_id = room_id
        self.room_manager = room_manager
        self.manifest: list = manifest if manifest is not None else []
        self.active_npcs: Dict[str, dict] = {}
        self.tasks: Set[asyncio.Task] = set()
        self.is_running: bool = False

    def _create_npc(self, prewarm_fraction: float = 0.0) -> Tuple[Optional[dict], float]:
        if not self.manifest:
            return None, 0.0

        used_path_ids = {npc["pathId"] for npc in self.active_npcs.values()}
        available_paths = [p for p in self.manifest if p.get("id") not in used_path_ids]
        if not available_paths:
            available_paths = self.manifest

        path = random.choice(available_paths)
        p_type = path.get("type", "both")
        if p_type == "walker":
            npc_type = "walker"
        elif p_type == "jogger":
            npc_type = "jogger"
        else:
            npc_type = random.choice(["walker", "jogger"])

        speed = WALKER_SPEED if npc_type == "walker" else JOGGER_SPEED
        length_px = float(path.get("lengthPx", 2000.0))
        lifetime = max(1.0, length_px / speed)

        offset_sec = lifetime * min(0.9, max(0.0, prewarm_fraction))
        spawn_time = int((time.time() - offset_sec) * 1000)
        npc_id = f"npc-{uuid.uuid4().hex[:8]}-{spawn_time}"
        seed = random.randint(0, 0xFFFFFFFF)

        npc = {
            "id": npc_id,
            "pathId": path["id"],
            "type": npc_type,
            "npcType": npc_type,
            "seed": seed,
            "spawnTime": spawn_time
        }
        return npc, lifetime

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        logger.info(f"Starting NPC spawner for room '{self.room_id}'")

        # Initialize pool (target 5 active NPCs) with pre-warmed spawn times
        for i in range(TARGET_ACTIVE_NPCS):
            prewarm_fraction = 0.15 + (i / TARGET_ACTIVE_NPCS) * 0.70
            npc, lifetime = self._create_npc(prewarm_fraction=prewarm_fraction)
            if npc:
                self.active_npcs[npc["id"]] = npc
                offset_sec = lifetime * prewarm_fraction
                remaining_lifetime = max(0.5, lifetime - offset_sec)
                task = asyncio.create_task(self._handle_npc_lifecycle(npc, remaining_lifetime))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)

    def stop(self):
        if not self.is_running and not self.tasks and not self.active_npcs:
            return
        self.is_running = False
        logger.info(f"Stopping NPC spawner for room '{self.room_id}' (cancelling {len(self.tasks)} tasks)")
        for task in list(self.tasks):
            task.cancel()
        self.tasks.clear()
        self.active_npcs.clear()

    async def _handle_npc_lifecycle(self, npc: dict, lifetime: float):
        npc_id = npc["id"]
        try:
            await asyncio.sleep(lifetime)
            if not self.is_running:
                return

            # Broadcast NPC_DESPAWN
            despawn_pkt = {
                "type": "NPC_DESPAWN",
                "id": npc_id,
                "timestamp": int(time.time() * 1000)
            }
            await self.room_manager.broadcast_to_room(self.room_id, despawn_pkt)

            # Remove from active_npcs
            self.active_npcs.pop(npc_id, None)

            # Wait a random gap of 1.0 to 5.0 seconds before spawning replacement
            gap = random.uniform(1.0, 5.0)
            await asyncio.sleep(gap)
            if not self.is_running:
                return

            # If room still has connected peers, spawn replacement NPC
            peers = self.room_manager.get_room_peers(self.room_id)
            if len(peers) > 0 and len(self.active_npcs) < MAX_ACTIVE_NPCS:
                new_npc, new_lifetime = self._create_npc()
                if new_npc:
                    self.active_npcs[new_npc["id"]] = new_npc
                    spawn_pkt = {
                        "type": "NPC_SPAWN",
                        "id": new_npc["id"],
                        "pathId": new_npc["pathId"],
                        "npcType": new_npc["type"],
                        "seed": new_npc["seed"],
                        "spawnTime": new_npc["spawnTime"],
                        "npc": new_npc,
                        "serverTime": int(time.time() * 1000),
                        "timestamp": int(time.time() * 1000)
                    }
                    await self.room_manager.broadcast_to_room(self.room_id, spawn_pkt)
                    task = asyncio.create_task(self._handle_npc_lifecycle(new_npc, new_lifetime))
                    self.tasks.add(task)
                    task.add_done_callback(self.tasks.discard)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in NPC lifecycle for {npc_id} in {self.room_id}: {e}")

    async def send_snapshot(self, peer: PeerConnection):
        """Send current snapshot of all active NPCs to connecting peer."""
        snapshot_pkt = {
            "type": "NPC_SNAPSHOT",
            "npcs": list(self.active_npcs.values()),
            "serverTime": int(time.time() * 1000),
            "timestamp": int(time.time() * 1000)
        }
        await peer.send_json(snapshot_pkt)


class RoomManager:
    def __init__(self, static_dir: str = "."):
        # room_id -> Dict[peer_id, PeerConnection]
        self.rooms: Dict[str, Dict[str, PeerConnection]] = {}
        self.spawners: Dict[str, RoomNpcSpawner] = {}
        self.static_dir = static_dir
        self.manifest = load_npc_manifest(static_dir)

    def get_or_create_room(self, room_id: str) -> Dict[str, PeerConnection]:
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
            logger.info(f"Created new room: {room_id}")
        return self.rooms[room_id]

    def get_or_create_spawner(self, room_id: str) -> RoomNpcSpawner:
        if room_id not in self.spawners:
            self.spawners[room_id] = RoomNpcSpawner(room_id, self, self.manifest)
        return self.spawners[room_id]

    def add_peer(self, room_id: str, peer: PeerConnection):
        room = self.get_or_create_room(room_id)
        is_first = (len(room) == 0)
        room[peer.peer_id] = peer
        logger.info(f"Peer '{peer.peer_id}' joined room '{room_id}' (Total peers: {len(room)})")

        if is_first:
            try:
                loop = asyncio.get_running_loop()
                if loop and loop.is_running():
                    spawner = self.get_or_create_spawner(room_id)
                    if not spawner.is_running:
                        spawner.start()
            except RuntimeError:
                pass

    def remove_peer(self, room_id: str, peer_id: str) -> bool:
        if room_id in self.rooms and peer_id in self.rooms[room_id]:
            del self.rooms[room_id][peer_id]
            logger.info(f"Peer '{peer_id}' left room '{room_id}' (Remaining: {len(self.rooms[room_id])})")
            if len(self.rooms[room_id]) == 0:
                if room_id in self.spawners:
                    self.spawners[room_id].stop()
                    del self.spawners[room_id]
                del self.rooms[room_id]
                logger.info(f"Room '{room_id}' is empty and closed.")
            return True
        return False

    def update_peer_id(self, room_id: str, old_id: str, new_id: str):
        if room_id in self.rooms and old_id in self.rooms[room_id]:
            peer = self.rooms[room_id].pop(old_id)
            peer.peer_id = new_id
            self.rooms[room_id][new_id] = peer
            logger.info(f"Updated peer ID from '{old_id}' to '{new_id}' in room '{room_id}'")

    def get_room_peers(self, room_id: str) -> Dict[str, PeerConnection]:
        return self.rooms.get(room_id, {})

    async def broadcast_to_room(self, room_id: str, data: dict, exclude_peer_id: str = None):
        room = self.get_room_peers(room_id)
        tasks = []
        for pid, peer in room.items():
            if exclude_peer_id and pid == exclude_peer_id:
                continue
            tasks.append(peer.send_json(data))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


class CliftonServer:
    def __init__(self, static_dir: str = "."):
        self.static_dir = os.path.abspath(static_dir)
        self.rooms = RoomManager(static_dir=self.static_dir)
        self.app = web.Application()
        self.setup_routes()

    def setup_routes(self):
        # WebSocket handler
        self.app.router.add_get("/ws", self.handle_websocket)
        # Health check
        self.app.router.add_get("/health", self.handle_health)
        # Static files serving
        self.app.router.add_get("/", self.handle_index)
        self.app.router.add_static("/src", path=os.path.join(self.static_dir, "src"), show_index=False)
        # Serve any other static root assets if they exist (style.css, etc.)
        self.app.router.add_static("/static", path=self.static_dir, show_index=False)

    async def handle_health(self, request: web.Request) -> web.Response:
        total_peers = sum(len(r) for r in self.rooms.rooms.values())
        return web.json_response({
            "status": "ok",
            "active_rooms": len(self.rooms.rooms),
            "total_connected_peers": total_peers
        }, headers={"Access-Control-Allow-Origin": "*"})

    async def handle_index(self, request: web.Request) -> web.Response:
        index_file = os.path.join(self.static_dir, "index.html")
        if os.path.exists(index_file):
            return web.FileResponse(index_file)
        return web.Response(text="Clifton Down Server Running. index.html not found.", status=404)

    async def handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=20.0, max_msg_size=1024 * 1024)
        await ws.prepare(request)

        # Parse query parameters if provided
        query_room = request.query.get("room") or "clifton-main"
        query_peer = request.query.get("peer") or f"peer-{os.urandom(3).hex()}"

        peer = PeerConnection(ws, query_peer, query_room)
        self.rooms.add_peer(query_room, peer)

        # Ensure spawner is running for this room and send snapshot immediately
        spawner = self.rooms.get_or_create_spawner(query_room)
        if not spawner.is_running:
            spawner.start()
        await spawner.send_snapshot(peer)

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        packet = json.loads(msg.data)
                    except json.JSONDecodeError:
                        continue

                    ptype = packet.get("type")
                    if not ptype:
                        continue

                    # Update sender ID if provided in packet
                    sender_id = packet.get("senderId", peer.peer_id)
                    if sender_id != peer.peer_id:
                        old_id = peer.peer_id
                        self.rooms.update_peer_id(peer.room_id, old_id, sender_id)

                    # Packet Dispatching
                    if ptype == "HELLO":
                        peer.meta["name"] = packet.get("name", "Walker")
                        peer.meta["jacketColor"] = packet.get("jacketColor", "#1e3a8a")
                        peer.meta["coatName"] = packet.get("dogCoatName", "Chocolate & Tan (Ziggy)")
                        peer.meta["hairStyle"] = packet.get("hairStyle")
                        peer.meta["hairColor"] = packet.get("hairColor")
                        peer.meta["pantsColor"] = packet.get("pantsColor")
                        peer.meta["skinTone"] = packet.get("skinTone")
                        peer.meta["collarColor"] = packet.get("collarColor")
                        if packet.get("personality") is not None:
                            peer.meta["personality"] = packet.get("personality")
                        elif "personality" in packet:
                            peer.meta["personality"] = None

                        # Send WELCOME packet back to this peer with list of existing peers
                        room_peers = self.rooms.get_room_peers(peer.room_id)
                        existing_peers = []
                        for pid, p in room_peers.items():
                            if pid != peer.peer_id:
                                existing_peers.append({
                                    "id": pid,
                                    "name": p.meta.get("name", "Friend"),
                                    "jacketColor": p.meta.get("jacketColor", "#14532d"),
                                    "coatName": p.meta.get("coatName", "Chocolate & Tan (Ziggy)"),
                                    "hairStyle": p.meta.get("hairStyle"),
                                    "hairColor": p.meta.get("hairColor"),
                                    "pantsColor": p.meta.get("pantsColor"),
                                    "skinTone": p.meta.get("skinTone"),
                                    "collarColor": p.meta.get("collarColor"),
                                    "personality": p.meta.get("personality")
                                })

                        welcome_pkt = {
                            "type": "WELCOME",
                            "hostId": "server-host",
                            "peers": existing_peers,
                            "timestamp": packet.get("timestamp")
                        }
                        await peer.send_json(welcome_pkt)

                        # Broadcast this peer's HELLO to all other peers in the room
                        await self.rooms.broadcast_to_room(peer.room_id, packet, exclude_peer_id=peer.peer_id)

                        # Send NPC snapshot upon HELLO handshake
                        spawner = self.rooms.get_or_create_spawner(peer.room_id)
                        await spawner.send_snapshot(peer)

                    elif ptype in ("SYNC_STATE", "BALL_THROWN", "BALL_SYNC", "BARK", "PET", "CHAT_MESSAGE", "EMOTE"):
                        # High-frequency or event relay to other room members
                        await self.rooms.broadcast_to_room(peer.room_id, packet, exclude_peer_id=peer.peer_id)

                    elif ptype == "PING":
                        await peer.send_json({"type": "PONG", "timestamp": packet.get("timestamp")})

                elif msg.type == WSMsgType.ERROR:
                    logger.warning(f"WebSocket connection closed with exception: {ws.exception()}")

        finally:
            # Client disconnected
            self.rooms.remove_peer(peer.room_id, peer.peer_id)
            # Notify remaining peers that this player left
            leave_pkt = {
                "type": "PEER_LEFT",
                "peerId": peer.peer_id
            }
            await self.rooms.broadcast_to_room(peer.room_id, leave_pkt)

        return ws


def main():
    parser = argparse.ArgumentParser(description="Clifton Down Multiplayer Microserver")
    parser.add_argument("--host", default="0.0.0.0", help="Host interface (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    parser.add_argument("--root", default=".", help="Root directory containing index.html and src/")
    args = parser.parse_args()

    server = CliftonServer(static_dir=args.root)
    print(f"🌲 Clifton Down Multiplayer Microserver listening on http://{args.host}:{args.port}")
    web.run_app(server.app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
