// party/server.js - Cloudflare PartyServer Room Relay & Asset Server
import { Server, routePartykitRequest } from "partyserver";

export class ParkServer extends Server {
  onConnect(conn, ctx) {
    const roomId = this.name || (this.room && this.room.id) || "the-commons";
    
    // Collect existing connected peers
    const existingPeers = [];
    const connections = this.getConnections ? this.getConnections() : (this.room ? this.room.getConnections() : []);
    for (const otherConn of connections) {
      if (otherConn.id !== conn.id) {
        existingPeers.push(otherConn.id);
      }
    }

    // Transmit WELCOME packet with assigned peerId, room info, and active peers
    const welcomePacket = {
      type: "WELCOME",
      peerId: conn.id,
      roomId: roomId,
      peers: existingPeers,
      serverTime: Date.now()
    };

    conn.send(JSON.stringify(welcomePacket));
  }

  onMessage(conn, message) {
    try {
      const data = typeof message === "string" ? JSON.parse(message) : message;

      data.senderId = conn.id;
      data.peerId = conn.id;

      const payload = JSON.stringify(data);
      // Broadcast to other peers in this room
      this.broadcast(payload, [conn.id]);
    } catch (err) {
      console.error("[ParkServer] Message parse/relay error:", err);
    }
  }

  onClose(conn) {
    const leftPacket = {
      type: "PEER_LEFT",
      peerId: conn.id,
      timestamp: Date.now()
    };

    this.broadcast(JSON.stringify(leftPacket));
  }

  onError(conn, err) {
    console.error(`[ParkServer] Error on peer ${conn.id}:`, err);
  }
}

export default {
  async fetch(request, env, ctx) {
    // Durable Object Namespace Aliasing
    if (env && env.ParkServer) {
      if (!env.park) env.park = env.ParkServer;
      if (!env.parkserver) env.parkserver = env.ParkServer;
    }

    // 1. Route PartyServer WebSocket / partykit requests with crash guard
    if (typeof routePartykitRequest === "function") {
      try {
        const partyResponse = await routePartykitRequest(request, env);
        if (partyResponse) {
          return partyResponse;
        }
      } catch (err) {
        console.error("[ParkServer] routePartykitRequest error:", err);
      }
    }

    // 2. Fallback to Cloudflare Static Assets binding if present
    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
