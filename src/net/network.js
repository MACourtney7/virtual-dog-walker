// Pure In-Browser WebRTC Peer-to-Peer Multiplayer Network Engine (PeerJS)

import { PacketType, Protocol } from './protocol.js';

export const NetStatus = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  HOSTING: 'HOSTING',
  CONNECTED_PEER: 'CONNECTED_PEER',
  ERROR: 'ERROR'
};

export class EntityInterpolator {
  constructor() {
    this.target = null;
    this.current = null;
    this.lerpRate = 0.22;
  }

  setTarget(snapshot) {
    if (!this.current) {
      this.current = { ...snapshot };
    }
    this.target = { ...snapshot };
  }

  update(dt) {
    if (!this.target || !this.current) return this.current;

    const rate = 1 - Math.exp(-this.lerpRate * 60 * dt);
    this.current.x += (this.target.x - this.current.x) * rate;
    this.current.y += (this.target.y - this.current.y) * rate;
    this.current.vx = this.target.vx;
    this.current.vy = this.target.vy;

    // Angle shortest path interpolation
    let dAngle = this.target.angle - this.current.angle;
    while (dAngle > Math.PI) dAngle -= Math.PI * 2;
    while (dAngle < -Math.PI) dAngle += Math.PI * 2;
    this.current.angle += dAngle * rate;

    return this.current;
  }
}

export class NetworkManager {
  constructor() {
    this.status = NetStatus.OFFLINE;
    this.peer = null;
    this.peerId = null;
    this.roomId = null;
    this.isHost = false;

    // Connections map (peerId -> DataConnection)
    this.connections = new Map();
    this.hostConnection = null;

    // Remote entity interpolators (peerId -> { owner: EntityInterpolator, dog: EntityInterpolator, meta: {} })
    this.remotePeers = new Map();

    // Event hooks
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onBallThrown = null;
    this.onBallSync = null;
    this.onBark = null;
    this.onPet = null;
    this.onChatMessage = null;
    this.onEmote = null;
    this.onStatusChange = null;

    // Sync broadcast ticker
    this.syncInterval = null;
    this.syncHz = 16; // 16 updates per sec
  }

  setStatus(newStatus, msg = '') {
    this.status = newStatus;
    if (this.onStatusChange) {
      this.onStatusChange(newStatus, msg);
    }
  }

  // Load PeerJS library dynamically if not already available on window
  async ensurePeerJS() {
    if (window.Peer) return window.Peer;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
      script.async = true;
      script.onload = () => {
        if (window.Peer) resolve(window.Peer);
        else reject(new Error('PeerJS failed to load'));
      };
      script.onerror = () => reject(new Error('Network error loading PeerJS CDN'));
      document.head.appendChild(script);
    });
  }

  // Generate clean room code
  generateRoomId() {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `clifton-${num}`;
  }

  getShareUrl() {
    if (!this.roomId) return window.location.href;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    return url.toString();
  }

  // 1. Host a Field Room
  async hostRoom(customRoomId = null) {
    try {
      this.setStatus(NetStatus.CONNECTING, 'Initializing PeerJS host...');
      await this.ensurePeerJS();

      this.roomId = customRoomId || this.generateRoomId();
      this.isHost = true;

      this.peer = new window.Peer(this.roomId, {
        debug: 1
      });

      this.peer.on('open', (id) => {
        this.peerId = id;
        this.setStatus(NetStatus.HOSTING, `Field hosted! Room: ${this.roomId}`);
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.warn('PeerJS Host Error:', err);
        // If room ID is taken, fallback to random ID
        if (err.type === 'unavailable-id') {
          this.hostRoom(this.generateRoomId());
        } else {
          this.setStatus(NetStatus.ERROR, err.message);
        }
      });
    } catch (e) {
      console.error('Failed to host room:', e);
      this.setStatus(NetStatus.ERROR, 'Could not host room');
    }
  }

  // 2. Join an existing Field Room
  async joinRoom(roomId) {
    try {
      this.setStatus(NetStatus.CONNECTING, `Connecting to field: ${roomId}...`);
      await this.ensurePeerJS();

      this.roomId = roomId;
      this.isHost = false;

      this.peer = new window.Peer({
        debug: 1
      });

      this.peer.on('open', (id) => {
        this.peerId = id;
        const conn = this.peer.connect(roomId, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', () => {
          this.setStatus(NetStatus.CONNECTED_PEER, `Joined field: ${roomId}`);
          // Send HELLO packet with local player info
          conn.send(Protocol.createHello(this.peerId, 'Visitor', '#14532d', 'Chocolate & Tan'));
        });

        conn.on('data', (data) => {
          this.handlePacket(conn.peer, data);
        });

        conn.on('close', () => {
          this.setStatus(NetStatus.OFFLINE, 'Host closed the connection');
        });

        conn.on('error', (err) => {
          console.warn('Connection error:', err);
          this.setStatus(NetStatus.ERROR, 'Connection failed');
        });
      });

      this.peer.on('error', (err) => {
        console.warn('PeerJS Client Error:', err);
        this.setStatus(NetStatus.ERROR, err.message);
      });
    } catch (e) {
      console.error('Failed to join room:', e);
      this.setStatus(NetStatus.ERROR, 'Could not join room');
    }
  }

  handleIncomingConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);

      // Initialize remote peer interpolators
      this.remotePeers.set(conn.peer, {
        ownerInterpolator: new EntityInterpolator(),
        dogInterpolator: new EntityInterpolator(),
        meta: { name: 'Player', jacketColor: '#1e3a8a', coatName: 'Chocolate & Tan' }
      });

      if (this.onPeerJoin) {
        this.onPeerJoin(conn.peer, { name: 'Player' });
      }
    });

    conn.on('data', (data) => {
      this.handlePacket(conn.peer, data);

      // If host, relay broadcast to other connected clients
      if (this.isHost && data && data.type !== PacketType.SYNC_STATE) {
        for (const [id, c] of this.connections) {
          if (id !== conn.peer && c.open) {
            c.send(data);
          }
        }
      }
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.remotePeers.delete(conn.peer);
      if (this.onPeerLeave) {
        this.onPeerLeave(conn.peer);
      }
    });
  }

  handlePacket(senderId, packet) {
    if (!packet || !packet.type) return;

    switch (packet.type) {
      case PacketType.HELLO: {
        let peerData = this.remotePeers.get(senderId);
        if (!peerData) {
          peerData = {
            ownerInterpolator: new EntityInterpolator(),
            dogInterpolator: new EntityInterpolator(),
            meta: {}
          };
          this.remotePeers.set(senderId, peerData);
        }
        peerData.meta.name = packet.name || 'Player';
        peerData.meta.jacketColor = packet.jacketColor || '#1e3a8a';
        peerData.meta.coatName = packet.dogCoatName || 'Chocolate & Tan';
        if (this.onPeerJoin) {
          this.onPeerJoin(senderId, peerData.meta);
        }
        break;
      }

      case PacketType.SYNC_STATE: {
        const peerData = this.remotePeers.get(senderId);
        if (peerData) {
          peerData.ownerInterpolator.setTarget(packet.owner);
          peerData.dogInterpolator.setTarget(packet.dog);
        }
        break;
      }

      case PacketType.BALL_THROWN: {
        if (this.onBallThrown) this.onBallThrown(packet);
        break;
      }

      case PacketType.BALL_SYNC: {
        if (this.onBallSync) this.onBallSync(packet);
        break;
      }

      case PacketType.BARK: {
        if (this.onBark) this.onBark(senderId, packet);
        break;
      }

      case PacketType.PET: {
        if (this.onPet) this.onPet(senderId);
        break;
      }

      case PacketType.CHAT_MESSAGE: {
        if (this.onChatMessage) this.onChatMessage(senderId, packet.text);
        break;
      }

      case PacketType.EMOTE: {
        if (this.onEmote) this.onEmote(senderId, packet.emote);
        break;
      }
    }
  }

  // Broadcast packet to all connected peers
  broadcast(packet) {
    if (this.isHost) {
      for (const conn of this.connections.values()) {
        if (conn.open) conn.send(packet);
      }
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(packet);
    }
  }

  // Start periodic 16Hz state broadcast
  startSyncLoop(getLocalStateFn) {
    if (this.syncInterval) clearInterval(this.syncInterval);

    this.syncInterval = setInterval(() => {
      if (this.status !== NetStatus.HOSTING && this.status !== NetStatus.CONNECTED_PEER) return;

      const state = getLocalStateFn();
      if (!state || !state.owner || !state.dog) return;

      const packet = Protocol.createSyncState(this.peerId, state.owner, state.dog);
      this.broadcast(packet);
    }, 1000 / this.syncHz);
  }

  stop() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.peer) this.peer.destroy();
    this.connections.clear();
    this.remotePeers.clear();
    this.setStatus(NetStatus.OFFLINE);
  }
}
