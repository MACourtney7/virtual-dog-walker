#!/usr/bin/env python3
"""
Clifton Down: Dedicated Multiplayer Microserver
Asynchronous HTTP & WebSocket Room Relay Engine
"""

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Dict, Set
from aiohttp import web, WSMsgType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("CliftonServer")


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


class RoomManager:
    def __init__(self):
        # room_id -> Dict[peer_id, PeerConnection]
        self.rooms: Dict[str, Dict[str, PeerConnection]] = {}

    def get_or_create_room(self, room_id: str) -> Dict[str, PeerConnection]:
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
            logger.info(f"Created new room: {room_id}")
        return self.rooms[room_id]

    def add_peer(self, room_id: str, peer: PeerConnection):
        room = self.get_or_create_room(room_id)
        room[peer.peer_id] = peer
        logger.info(f"Peer '{peer.peer_id}' joined room '{room_id}' (Total peers: {len(room)})")

    def remove_peer(self, room_id: str, peer_id: str) -> bool:
        if room_id in self.rooms and peer_id in self.rooms[room_id]:
            del self.rooms[room_id][peer_id]
            logger.info(f"Peer '{peer_id}' left room '{room_id}' (Remaining: {len(self.rooms[room_id])})")
            if len(self.rooms[room_id]) == 0:
                del self.rooms[room_id]
                logger.info(f"Room '{room_id}' is empty and closed.")
            return True
        return False

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
        self.rooms = RoomManager()
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
                        # Update registration if peerId changed upon client initialization
                        old_id = peer.peer_id
                        self.rooms.remove_peer(peer.room_id, old_id)
                        peer.peer_id = sender_id
                        self.rooms.add_peer(peer.room_id, peer)

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
