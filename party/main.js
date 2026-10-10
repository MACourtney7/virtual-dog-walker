// party/main.js - PartyKit Global Edge Room Server for Clifton Down

export default class ParkServer {
  constructor(room) {
    this.room = room;
  }

  onConnect(conn, ctx) {
    // Gather all existing connected peers in this room
    const existingPeers = [];
    for (const otherConn of this.room.getConnections()) {
      if (otherConn.id !== conn.id) {
        existingPeers.push(otherConn.id);
      }
    }

    // Send WELCOME packet containing assigned peerId, room info, and active peers
    const welcomePacket = {
      type: "WELCOME",
      peerId: conn.id,
      roomId: this.room.id,
      peers: existingPeers,
      serverTime: Date.now()
    };

    conn.send(JSON.stringify(welcomePacket));
  }

  onMessage(message, sender) {
    try {
      const data = typeof message === "string" ? JSON.parse(message) : message;

      // Stamp origin peerId if missing
      if (!data.peerId) {
        data.peerId = sender.id;
      }

      // Forward supported packets: HELLO, SYNC_STATE, BALL_THROWN, BALL_SYNC, BARK, PET, CHAT_MESSAGE, EMOTE
      const payload = JSON.stringify(data);
      this.room.broadcast(payload, [sender.id]);
    } catch (err) {
      console.error("[PartyKit] Error parsing or relaying message:", err);
    }
  }

  onClose(conn) {
    // Broadcast PEER_LEFT to all remaining participants in the park
    const leftPacket = {
      type: "PEER_LEFT",
      peerId: conn.id,
      timestamp: Date.now()
    };

    this.room.broadcast(JSON.stringify(leftPacket));
  }

  onError(conn, err) {
    console.error(`[PartyKit] Error on connection ${conn.id}:`, err);
  }
}
