// Dedicated WebSocket Multiplayer Network Engine for Clifton Down
import { PacketType, Protocol } from './protocol.js';
import { EntityInterpolator } from './network.js';

export const WSStatus = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR'
};

export class WebSocketNetworkManager {
  constructor() {
    this.status = WSStatus.OFFLINE;
    this.ws = null;
    this.serverUrl = null;
    this.peerId = `walker-${Math.floor(1000 + Math.random() * 9000)}`;
    this.roomId = 'the-commons';
    this.isHost = false;
    this.isDedicatedServer = true;
    this.isPartyKit = false;

    // Local player metadata to broadcast during handshakes
    this.localMeta = {
      name: 'Walker',
      jacketColor: '#1e3a8a',
      coatName: 'Chocolate & Tan (Ziggy)'
    };

    // Remote entity interpolators (peerId -> { ownerInterpolator, dogInterpolator, meta })
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

    // Auto-reconnect handling
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 6;
    this.reconnectTimeout = null;
    this.manualDisconnect = false;
  }

  isPartyKitHost(url) {
    if (!url) {
      if (typeof window !== 'undefined') {
        const host = window.location.hostname.toLowerCase();
        const port = window.location.port;
        const search = new URLSearchParams(window.location.search);
        return host.includes('workers.dev') ||
               host.includes('partykit.dev') ||
               port === '8787' ||
               port === '1999' ||
               search.has('party') ||
               search.has('partyserver') ||
               search.has('partykit');
      }
      return false;
    }
    const str = String(url).toLowerCase();
    return str.includes('workers.dev') ||
           str.includes('partykit.dev') ||
           str.includes(':8787') ||
           str.includes(':1999') ||
           str.includes('/parties/') ||
           str === 'party' ||
           str === 'partyserver' ||
           str === 'partykit';
  }

  buildWebSocketUrl(serverEndpoint, roomId) {
    if (this.isPartyKitHost(serverEndpoint)) {
      this.isPartyKit = true;
      let base = serverEndpoint;
      if (!base || base === 'partykit' || base === 'party') {
        const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = typeof window !== 'undefined' ? window.location.host : 'localhost:1999';
        base = `${proto}//${host}`;
      }
      let clean = base.trim();
      if (clean.startsWith('http://')) clean = clean.replace('http://', 'ws://');
      else if (clean.startsWith('https://')) clean = clean.replace('https://', 'wss://');
      else if (!clean.startsWith('ws://') && !clean.startsWith('wss://')) clean = `wss://${clean}`;

      if (clean.includes('/parties/')) {
        return new URL(clean);
      }
      clean = clean.replace(/\/+$/, '');
      return new URL(`${clean}/parties/parkserver/${roomId}`);
    }

    // Standard Dedicated Microserver fallback
    this.isPartyKit = false;
    const wsUrl = new URL(serverEndpoint);
    wsUrl.searchParams.set('room', roomId);
    wsUrl.searchParams.set('peer', this.peerId);
    return wsUrl;
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

  getShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('server');
    url.searchParams.delete('party');
    url.searchParams.delete('partykit');
    if (this.roomId && this.roomId !== 'the-commons' && this.roomId !== 'clifton-field') {
      url.searchParams.set('room', this.roomId);
    } else {
      url.searchParams.delete('room');
    }
    return url.toString();
  }

  ensureRemotePeer(peerId, meta = {}) {
    let peerData = this.remotePeers.get(peerId);
    if (!peerData) {
      peerData = {
        ownerInterpolator: new EntityInterpolator(),
        dogInterpolator: new EntityInterpolator(),
        meta: {
          name: meta.name || 'Walker',
          jacketColor: meta.jacketColor || '#1e3a8a',
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

  connect(serverEndpoint, roomId = null) {
    this.manualDisconnect = false;
    this.serverUrl = serverEndpoint;
    if (roomId) this.roomId = roomId;

    const modeLabel = this.isPartyKitHost(serverEndpoint) ? 'PartyKit edge room' : 'dedicated park server';
    this.setStatus(WSStatus.CONNECTING, `Connecting to ${modeLabel}...`);

    try {
      const wsUrl = this.buildWebSocketUrl(this.serverUrl, this.roomId);
      this.ws = new WebSocket(wsUrl.toString());

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus(WSStatus.CONNECTED, `Park connected (${this.roomId})`);

        // Send HELLO handshake packet
        this.broadcast(Protocol.createHello(
          this.peerId,
          this.localMeta.name,
          this.localMeta.jacketColor,
          this.localMeta.coatName
        ));
      };

      this.ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handlePacket(packet);
        } catch (e) {
          console.warn('Invalid JSON packet received from server:', e);
        }
      };

      this.ws.onclose = () => {
        if (!this.manualDisconnect) {
          this.scheduleReconnect();
        } else {
          this.setStatus(WSStatus.OFFLINE, 'Disconnected');
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket connection error:', err);
        this.setStatus(WSStatus.ERROR, 'Server connection error');
      };
    } catch (e) {
      console.error('Failed to instantiate WebSocket:', e);
      this.setStatus(WSStatus.ERROR, 'Could not connect to server');
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 8000);
      this.setStatus(WSStatus.RECONNECTING, `Connection lost. Reconnecting in ${Math.round(delay / 1000)}s...`);

      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        if (!this.manualDisconnect) {
          this.connect(this.serverUrl, this.roomId);
        }
      }, delay);
    } else {
      this.setStatus(WSStatus.OFFLINE, 'Server unreachable. Playing in solo mode.');
    }
  }

  handlePacket(packet) {
    if (!packet || !packet.type) return;

    const senderId = packet.senderId;
    if (senderId === this.peerId) return; // Ignore echoes of our own packets

    switch (packet.type) {
      case PacketType.HELLO: {
        const isNewPeer = !this.remotePeers.has(senderId);
        const meta = {
          name: packet.name || 'Walker',
          jacketColor: packet.jacketColor || '#1e3a8a',
          coatName: packet.dogCoatName || 'Chocolate & Tan (Ziggy)'
        };
        this.ensureRemotePeer(senderId, meta);
        if (this.onPeerJoin) {
          this.onPeerJoin(senderId, meta);
        }
        // Bidirectional greeting: ensure late joiners receive our appearance
        if (isNewPeer) {
          this.broadcast(Protocol.createHello(
            this.peerId,
            this.localMeta.name,
            this.localMeta.jacketColor,
            this.localMeta.coatName
          ));
        }
        break;
      }

      case PacketType.WELCOME: {
        if (packet.peerId) {
          this.peerId = packet.peerId;
        }

        // Immediately re-broadcast the local player's HELLO packet so existing peers and server
        // record the profile mapped directly to the authoritative connection ID
        this.broadcast(Protocol.createHello(
          this.peerId,
          this.localMeta.name,
          this.localMeta.jacketColor,
          this.localMeta.coatName
        ));

        // Populate all existing peers in the room
        if (Array.isArray(packet.peers)) {
          for (const p of packet.peers) {
            const peerId = typeof p === 'string' ? p : p?.id;
            const meta = typeof p === 'object' && p !== null ? {
              name: p.name,
              jacketColor: p.jacketColor,
              coatName: p.coatName || p.dogCoatName
            } : {};
            if (peerId && peerId !== this.peerId) {
              this.ensureRemotePeer(peerId, meta);
              if (this.onPeerJoin) {
                this.onPeerJoin(peerId, meta);
              }
            }
          }
        }
        break;
      }

      case PacketType.SYNC_STATE: {
        let peerData = this.remotePeers.get(senderId);
        if (!peerData) {
          peerData = this.ensureRemotePeer(senderId, { name: 'Player' });
          if (this.onPeerJoin) {
            this.onPeerJoin(senderId, peerData.meta);
          }
        }
        if (packet.owner) peerData.ownerInterpolator.setTarget(packet.owner);
        if (packet.dog) peerData.dogInterpolator.setTarget(packet.dog);
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

      case PacketType.PEER_LEFT: {
        const leftId = packet.peerId || senderId;
        this.remotePeers.delete(leftId);
        if (this.onPeerLeave) this.onPeerLeave(leftId);
        break;
      }
    }
  }

  broadcast(packet) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (!packet.senderId) packet.senderId = this.peerId;
      this.ws.send(JSON.stringify(packet));
    }
  }

  startSyncLoop(getLocalStateFn) {
    if (this.syncInterval) clearInterval(this.syncInterval);

    this.syncInterval = setInterval(() => {
      if (this.status !== WSStatus.CONNECTED) return;

      const state = getLocalStateFn();
      if (!state || !state.owner || !state.dog) return;

      const packet = Protocol.createSyncState(this.peerId, state.owner, state.dog);
      this.broadcast(packet);
    }, 1000 / this.syncHz);
  }

  stop() {
    this.manualDisconnect = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.remotePeers.clear();
    this.setStatus(WSStatus.OFFLINE);
  }
}
