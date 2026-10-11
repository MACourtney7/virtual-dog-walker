// Pure In-Browser WebRTC Multiplayer Protocol & Packet Definitions

export const PacketType = {
  HELLO: 'HELLO',
  WELCOME: 'WELCOME',
  SYNC_STATE: 'SYNC_STATE',
  BALL_THROWN: 'BALL_THROWN',
  BALL_SYNC: 'BALL_SYNC',
  BARK: 'BARK',
  PET: 'PET',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  EMOTE: 'EMOTE',
  WHISTLE: 'WHISTLE',
  PROXIMITY_CHAT: 'PROXIMITY_CHAT',
  TOMBSTONE_DROP: 'TOMBSTONE_DROP',
  PEER_LEFT: 'PEER_LEFT'
};

export class Protocol {
  static createHello(peerId, name, jacketColor, dogCoatName, extraMeta = {}) {
    return {
      type: PacketType.HELLO,
      senderId: peerId,
      name,
      jacketColor,
      dogCoatName,
      hairStyle: extraMeta.hairStyle,
      hairColor: extraMeta.hairColor,
      pantsColor: extraMeta.pantsColor,
      skinTone: extraMeta.skinTone,
      collarColor: extraMeta.collarColor,
      timestamp: Date.now()
    };
  }

  static createWelcome(hostId, hostMeta, peersList = [], ballState = null) {
    return {
      type: PacketType.WELCOME,
      senderId: hostId,
      hostId: hostId,
      hostMeta: hostMeta,
      peers: peersList,
      ball: ballState,
      timestamp: Date.now()
    };
  }

  static createSyncState(peerId, owner, dog) {
    return {
      type: PacketType.SYNC_STATE,
      senderId: peerId,
      timestamp: Date.now(),
      owner: {
        x: Math.round(owner.x * 10) / 10,
        y: Math.round(owner.y * 10) / 10,
        vx: Math.round(owner.vx),
        vy: Math.round(owner.vy),
        angle: Math.round(owner.angle * 100) / 100,
        isMoving: owner.isMoving,
        isLeashed: owner.isLeashed
      },
      dog: {
        x: Math.round(dog.x * 10) / 10,
        y: Math.round(dog.y * 10) / 10,
        vx: Math.round(dog.vx),
        vy: Math.round(dog.vy),
        angle: Math.round(dog.angle * 100) / 100,
        state: dog.state
      }
    };
  }

  static createBallThrown(peerId, fromX, fromY, dirX, dirY, speed) {
    return {
      type: PacketType.BALL_THROWN,
      senderId: peerId,
      fromX,
      fromY,
      dirX,
      dirY,
      speed,
      timestamp: Date.now()
    };
  }

  static createBallSync(ball) {
    return {
      type: PacketType.BALL_SYNC,
      x: Math.round(ball.x * 10) / 10,
      y: Math.round(ball.y * 10) / 10,
      z: Math.round(ball.z * 10) / 10,
      vx: Math.round(ball.vx),
      vy: Math.round(ball.vy),
      vz: Math.round(ball.vz),
      isThrown: ball.isThrown,
      isCarried: ball.isCarried,
      timestamp: Date.now()
    };
  }

  static createBark(peerId, x, y) {
    return {
      type: PacketType.BARK,
      senderId: peerId,
      x,
      y,
      timestamp: Date.now()
    };
  }

  static createPet(peerId) {
    return {
      type: PacketType.PET,
      senderId: peerId,
      timestamp: Date.now()
    };
  }

  static createChatMessage(peerId, text) {
    return {
      type: PacketType.CHAT_MESSAGE,
      senderId: peerId,
      text,
      timestamp: Date.now()
    };
  }

  static createEmote(peerId, emote) {
    return {
      type: PacketType.EMOTE,
      senderId: peerId,
      emote,
      timestamp: Date.now()
    };
  }

  static createWhistle(peerId, x, y) {
    return {
      type: PacketType.WHISTLE,
      senderId: peerId,
      x,
      y,
      timestamp: Date.now()
    };
  }

  static createProximityChat(peerId, name, text, x, y, clusterPeers = []) {
    return {
      type: PacketType.PROXIMITY_CHAT,
      senderId: peerId,
      name,
      text,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      clusterPeers,
      timestamp: Date.now()
    };
  }

  static createTombstoneDrop(peerId, x, y, text, participants = []) {
    return {
      type: PacketType.TOMBSTONE_DROP,
      senderId: peerId,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      text,
      participants,
      timestamp: Date.now()
    };
  }
}

