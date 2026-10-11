// Universal Multiplayer Network Engine (Supporting Dedicated WebSocket Server & In-Browser PeerJS)

import { PacketType, Protocol } from './protocol.js';
import { WebSocketNetworkManager, WSStatus } from './ws_network.js';

export const NetStatus = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  HOSTING: 'HOSTING',
  CONNECTED_PEER: 'CONNECTED_PEER',
  CONNECTED_SERVER: 'CONNECTED_SERVER',
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

// PeerJS-based P2P Network Implementation
export class PeerNetworkManager {
  constructor() {
    this.status = NetStatus.OFFLINE;
    this.peer = null;
    this.peerId = null;
    this.roomId = null;
    this.isHost = false;
    this.isDedicatedServer = false;

    this.localMeta = {
      name: 'Park Walker',
      jacketColor: '#1e3a8a',
      coatName: 'Chocolate & Tan (Ziggy)'
    };

    this.connections = new Map();
    this.hostConnection = null;
    this.remotePeers = new Map();

    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onBallThrown = null;
    this.onBallSync = null;
    this.onBark = null;
    this.onPet = null;
    this.onChatMessage = null;
    this.onEmote = null;
    this.onStatusChange = null;

    this.syncInterval = null;
    this.syncHz = 16;
  }

  setLocalMeta(meta) {
    this.localMeta = { ...this.localMeta, ...meta };
  }

  setStatus(newStatus, msg = '') {
    this.status = newStatus;
    if (this.onStatusChange) {
      this.onStatusChange(newStatus, msg);
    }
  }

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

  generateRoomId() {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `clifton-${num}`;
  }

  getShareUrl() {
    if (!this.roomId) return window.location.href;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    url.searchParams.set('p2p', '1');
    return url.toString();
  }

  ensureRemotePeer(peerId, meta = {}) {
    let peerData = this.remotePeers.get(peerId);
    if (!peerData) {
      peerData = {
        ownerInterpolator: new EntityInterpolator(),
        dogInterpolator: new EntityInterpolator(),
        meta: {
          name: meta.name || 'Player',
          jacketColor: meta.jacketColor || '#14532d',
          coatName: meta.coatName || 'Chocolate & Tan (Ziggy)'
        }
      };
      this.remotePeers.set(peerId, peerData);
    } else if (meta && (meta.name || meta.jacketColor || meta.coatName)) {
      if (meta.name) peerData.meta.name = meta.name;
      if (meta.jacketColor) peerData.meta.jacketColor = meta.jacketColor;
      if (meta.coatName) peerData.meta.coatName = meta.coatName;
    }
    return peerData;
  }

  async hostRoom(customRoomId = null) {
    try {
      this.setStatus(NetStatus.CONNECTING, 'Initializing PeerJS host...');
      await this.ensurePeerJS();

      this.roomId = customRoomId || this.generateRoomId();
      this.isHost = true;

      this.peer = new window.Peer(this.roomId, { debug: 1 });

      this.peer.on('open', (id) => {
        this.peerId = id;
        this.setStatus(NetStatus.HOSTING, `Field hosted! Room: ${this.roomId}`);
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.warn('PeerJS Host Error:', err);
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

  async joinRoom(roomId) {
    try {
      this.setStatus(NetStatus.CONNECTING, `Connecting to field: ${roomId}...`);
      await this.ensurePeerJS();

      this.roomId = roomId;
      this.isHost = false;

      this.peer = new window.Peer({ debug: 1 });

      this.peer.on('open', (id) => {
        this.peerId = id;
        const conn = this.peer.connect(roomId, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', () => {
          this.setStatus(NetStatus.CONNECTED_PEER, `Joined field: ${roomId}`);
          conn.send(Protocol.createHello(
            this.peerId,
            this.localMeta.name,
            this.localMeta.jacketColor,
            this.localMeta.coatName
          ));
        });

        conn.on('data', (data) => {
          this.handlePacket(conn.peer, data);
        });

        conn.on('close', () => {
          this.setStatus(NetStatus.OFFLINE, 'Host closed connection');
          this.remotePeers.delete(roomId);
          if (this.onPeerLeave) this.onPeerLeave(roomId);
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
    });

    conn.on('data', (data) => {
      this.handlePacket(conn.peer, data);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.remotePeers.delete(conn.peer);
      if (this.onPeerLeave) {
        this.onPeerLeave(conn.peer);
      }
      this.broadcast({ type: PacketType.PEER_LEFT, peerId: conn.peer });
    });
  }

  handlePacket(senderId, packet) {
    if (!packet || !packet.type) return;

    switch (packet.type) {
      case PacketType.HELLO: {
        const meta = {
          name: packet.name || 'Visitor',
          jacketColor: packet.jacketColor || '#14532d',
          coatName: packet.dogCoatName || 'Chocolate & Tan (Ziggy)'
        };
        this.ensureRemotePeer(senderId, meta);
        if (this.onPeerJoin) this.onPeerJoin(senderId, meta);

        if (this.isHost) {
          const conn = this.connections.get(senderId);
          if (conn && conn.open) {
            const peersList = [];
            for (const [id, d] of this.remotePeers) {
              if (id !== senderId) peersList.push({ id, ...d.meta });
            }
            conn.send(Protocol.createWelcome(this.peerId, this.localMeta, peersList));
          }
          for (const [id, c] of this.connections) {
            if (id !== senderId && c.open) c.send(packet);
          }
        }
        break;
      }

      case PacketType.WELCOME: {
        const hostId = packet.hostId || senderId;
        const hostMeta = packet.hostMeta || {
          name: 'Host Walker',
          jacketColor: '#1e3a8a',
          coatName: 'Chocolate & Tan (Ziggy)'
        };
        this.ensureRemotePeer(hostId, hostMeta);
        if (this.onPeerJoin) this.onPeerJoin(hostId, hostMeta);

        if (Array.isArray(packet.peers)) {
          for (const p of packet.peers) {
            if (p.id && p.id !== this.peerId) {
              this.ensureRemotePeer(p.id, p);
              if (this.onPeerJoin) this.onPeerJoin(p.id, p);
            }
          }
        }
        break;
      }

      case PacketType.SYNC_STATE: {
        let peerData = this.remotePeers.get(senderId);
        if (!peerData) {
          peerData = this.ensureRemotePeer(senderId, { name: 'Player' });
          if (this.onPeerJoin) this.onPeerJoin(senderId, peerData.meta);
        }

        peerData.ownerInterpolator.setTarget(packet.owner);
        peerData.dogInterpolator.setTarget(packet.dog);

        if (this.isHost) {
          for (const [id, c] of this.connections) {
            if (id !== senderId && c.open) c.send(packet);
          }
        }
        break;
      }

      case PacketType.BALL_THROWN: {
        if (this.onBallThrown) this.onBallThrown(packet);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.BALL_SYNC: {
        if (this.onBallSync) this.onBallSync(packet);
        break;
      }

      case PacketType.BARK: {
        if (this.onBark) this.onBark(senderId, packet);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.PET: {
        if (this.onPet) this.onPet(senderId);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.CHAT_MESSAGE: {
        if (this.onChatMessage) this.onChatMessage(senderId, packet.text);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.EMOTE: {
        if (this.onEmote) this.onEmote(senderId, packet.emote);
        if (this.isHost) this.relayToOthers(senderId, packet);
        break;
      }

      case PacketType.PEER_LEFT: {
        const leftId = packet.peerId || senderId;
        this.remotePeers.delete(leftId);
        if (this.onPeerLeave) this.onPeerLeave(leftId);
        break;
      }
    }
  }

  relayToOthers(excludePeerId, packet) {
    if (!this.isHost) return;
    for (const [id, c] of this.connections) {
      if (id !== excludePeerId && c.open) {
        c.send(packet);
      }
    }
  }

  broadcast(packet) {
    if (this.isHost) {
      for (const conn of this.connections.values()) {
        if (conn.open) conn.send(packet);
      }
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(packet);
    }
  }

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

// Universal Network Manager Factory & Polymorphic Wrapper
export class NetworkManager {
  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    const serverParam = urlParams.get('server');
    const partyParam = urlParams.get('party') || urlParams.get('partykit');
    const isP2P = urlParams.get('p2p') === '1';

    // Auto-detect whether to use PartyKit Edge, Dedicated WebSocket Server, or PeerJS P2P
    const isHttp = window.location.protocol.startsWith('http');
    const isPartyHost = window.location.hostname.includes('workers.dev') ||
                        window.location.hostname.includes('partykit.dev') ||
                        window.location.port === '8787' ||
                        window.location.port === '1999' ||
                        Boolean(partyParam);

    if (!isP2P && (partyParam || isPartyHost)) {
      // 1. PartyKit Global Edge Mode
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const targetHost = partyParam && partyParam !== '1' ? partyParam : window.location.host;
      this.wsEndpoint = `${proto}//${targetHost}`;
      this.adapter = new WebSocketNetworkManager();
      this.isDedicatedServer = true;
      this.isPartyKit = true;
      this.adapter.isPartyKit = true;
    } else if (!isP2P && (serverParam || isHttp)) {
      // 2. Local/Dedicated Python Microserver Mode
      let wsEndpoint = '';
      if (serverParam) {
        let clean = serverParam.trim();
        if (clean.startsWith('http://')) clean = clean.replace('http://', 'ws://');
        else if (clean.startsWith('https://')) clean = clean.replace('https://', 'wss://');
        else if (!clean.startsWith('ws://') && !clean.startsWith('wss://')) clean = `wss://${clean}`;

        if (!clean.endsWith('/ws')) clean = clean.replace(/\/+$/, '') + '/ws';
        wsEndpoint = clean;
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsEndpoint = `${proto}//${window.location.host}/ws`;
      }

      this.adapter = new WebSocketNetworkManager();
      this.isDedicatedServer = true;
      this.isPartyKit = false;
      this.wsEndpoint = wsEndpoint;
    } else {
      // 3. PeerJS P2P Fallback Mode
      this.adapter = new PeerNetworkManager();
      this.isDedicatedServer = false;
      this.isPartyKit = false;
    }

    // Proxy properties & methods
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        const val = target.adapter[prop];
        if (typeof val === 'function') return val.bind(target.adapter);
        return val;
      },
      set: (target, prop, value) => {
        if (prop in target) {
          target[prop] = value;
          return true;
        }
        target.adapter[prop] = value;
        return true;
      }
    });
  }

  autoConnect() {
    const urlParams = new URLSearchParams(window.location.search);
    const targetRoom = urlParams.get('room') || 'the-commons';

    if (this.isDedicatedServer && this.wsEndpoint) {
      this.adapter.connect(this.wsEndpoint, targetRoom);
    } else if (urlParams.get('room')) {
      this.adapter.joinRoom(targetRoom);
    }
  }
}
