// Clifton Down: Social Dog Walking Sandbox - Main Orchestrator

import { Field, Camera } from './world/field.js';
import { Owner } from './entities/owner.js';
import { CompanionDog, CoatPreset, DogState } from './entities/companion_dog.js';
import { TennisBall } from './entities/toy.js';
import { NetworkManager, NetStatus } from './net/network.js';
import { Protocol, PacketType } from './net/protocol.js';
import { SocialHUD } from './ui/social_hud.js';
import { sound } from './systems/audio.js';
import { TouchControls } from './ui/touch_controls.js';
import { ProximityChat } from './ui/proximity_chat.js';
import { ChatTombstone } from './entities/tombstone.js';

export class CliftonDownGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    // World & Viewport
    this.field = new Field(2600, 1900);
    this.camera = new Camera(
      typeof window !== 'undefined' ? window.innerWidth : 1280,
      typeof window !== 'undefined' ? window.innerHeight : 720,
      this.field.width,
      this.field.height
    );

    // Local Entities
    const startX = 1350;
    const startY = 1000;
    this.owner = new Owner(startX, startY, 'Walker', true);
    this.dog = new CompanionDog(startX + 40, startY + 20, this.owner, CoatPreset.CHOCOLATE_TAN);
    this.ball = new TennisBall(startX + 20, startY + 20);

    this.camera.follow(this.owner);

    // Remote Players (peerId -> { owner: Owner, dog: CompanionDog })
    this.remotePlayers = new Map();

    // Networking
    this.net = new NetworkManager();

    // UI HUD
    this.hud = new SocialHUD(this.net, this.owner, this.dog, CoatPreset);

    // Proximity Chat HUD & Dynamic Spatial Clustering
    this.proximityChat = new ProximityChat({
      onSendMessage: (text, clusterPeerIds) => {
        const peers = clusterPeerIds || this.proximityChat.getActivePeers();
        if (this.net && typeof this.net.broadcast === 'function') {
          if (typeof Protocol.createProximityChat === 'function') {
            this.net.broadcast(Protocol.createProximityChat(
              this.net.peerId,
              this.owner.name,
              text,
              this.owner.x,
              this.owner.y,
              peers
            ));
          } else if (typeof Protocol.createChatMessage === 'function') {
            this.net.broadcast(Protocol.createChatMessage(this.net.peerId, text));
          }
        }
        this.owner.setChat(text);
        if (sound && typeof sound.playChatChime === 'function') {
          sound.playChatChime();
        } else if (sound && typeof sound.playChat === 'function') {
          sound.playChat();
        }
      },
      onClusterDissolved: (partingContext) => {
        const text = partingContext.snippet || (partingContext.lastMessage ? (typeof partingContext.lastMessage === 'string' ? partingContext.lastMessage : partingContext.lastMessage.text) : '');
        const participants = (partingContext.participants || []).map(p => p.name || 'Walker');
        const tombstone = new ChatTombstone(partingContext.x, partingContext.y, {
          text,
          participants
        });
        this.field.addTombstone(tombstone);
        if (this.net && typeof this.net.broadcast === 'function') {
          if (typeof Protocol.createTombstoneDrop === 'function') {
            this.net.broadcast(Protocol.createTombstoneDrop(
              this.net.peerId,
              partingContext.x,
              partingContext.y,
              tombstone.text,
              tombstone.participants
            ));
          }
        }
        this.hud.showToast('💬 Conversation parted. Placed marker on the turf.');
      }
    });

    // Touch Controls
    this.joystickActive = false;
    this.touchControls = new TouchControls({
      onMove: (vec) => this.handleJoystickMove(vec),
      onThrow: () => this.throwBall(),
      onLeash: () => this.toggleLeash(),
      onWhistle: () => this.whistleDog(),
      onBark: () => this.barkDog(),
      onPet: () => this.petDog(),
      onChat: () => {
        if (this.proximityChat && this.proximityChat.isClusterActive()) {
          const proxInput = document.getElementById('proximity-chat-input');
          if (proxInput) {
            proxInput.focus();
            return;
          }
        }
        this.hud.toggleChatInput();
      }
    });

    // Audio tracking
    this.hasInteracted = false;
    this.lastFootstepTime = 0;

    // Loop Timing
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    this.initCanvas();
    this.bindInputs();
    this.initNetworking();

    // Start 60fps loop
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame((t) => this.gameLoop(t));
    }
  }

  initCanvas() {
    const resize = () => {
      const width = window.visualViewport ? window.visualViewport.width : window.innerWidth;
      const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      this.canvas.width = width;
      this.canvas.height = height;
      this.camera.resize(this.canvas.width, this.canvas.height);
    };

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 100));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resize);
    }
    resize();
  }

  initNetworking() {
    // Set initial local profile metadata for networking
    this.net.setLocalMeta({
      name: this.owner.name,
      jacketColor: this.owner.jacketColor,
      coatName: this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
      hairStyle: this.owner.hairStyle,
      hairColor: this.owner.hairColor,
      pantsColor: this.owner.pantsColor,
      skinTone: this.owner.skinTone,
      collarColor: this.dog.collarColor,
      personality: this.dog.personality || null
    });

    this.net.onStatusChange = (status, msg) => {
      this.hud.updateNetworkState(status, msg);
    };

    // Auto-connect to dedicated server or join room via query parameters
    if (typeof this.net.autoConnect === 'function') {
      this.net.autoConnect();
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      const targetRoom = urlParams.get('room');
      if (targetRoom) {
        this.net.joinRoom(targetRoom);
      }
    }

    // Helper to resolve CoatPreset from coatName or coatKey
    const resolveCoat = (coatName) => {
      if (!coatName) return CoatPreset.CHOCOLATE_TAN;
      const cn = String(coatName).toLowerCase();
      if (cn.includes('golden')) return CoatPreset.GOLDEN;
      if (cn.includes('black')) return CoatPreset.BLACK_LAB;
      if (cn.includes('jack') || cn.includes('russell')) return CoatPreset.JACK_RUSSELL || CoatPreset.CHOCOLATE_TAN;
      if (cn.includes('setter') || cn.includes('red')) return CoatPreset.RED_SETTER || CoatPreset.CHOCOLATE_TAN;
      if (cn.includes('chocolate') || cn.includes('ziggy')) return CoatPreset.CHOCOLATE_TAN;
      return CoatPreset.CHOCOLATE_TAN;
    };

    // When a peer connects or updates appearance
    this.net.onPeerJoin = (peerId, meta) => {
      if (peerId === this.net.peerId) return;

      const coat = resolveCoat(meta && meta.coatName);

      let existing = this.remotePlayers.get(peerId);
      if (existing) {
        if (meta.name) existing.owner.name = meta.name;
        if (meta.jacketColor) existing.owner.jacketColor = meta.jacketColor;
        if (meta.hairStyle) existing.owner.hairStyle = meta.hairStyle;
        if (meta.hairColor) existing.owner.hairColor = meta.hairColor;
        if (meta.pantsColor) existing.owner.pantsColor = meta.pantsColor;
        if (meta.skinTone) existing.owner.skinTone = meta.skinTone;
        if (meta.collarColor) existing.dog.collarColor = meta.collarColor;
        if (meta.personality) {
          if (typeof existing.dog.setPersonality === 'function') {
            existing.dog.setPersonality(meta.personality);
          } else {
            existing.dog.personality = { ...meta.personality };
          }
        }
        existing.dog.coat = coat;
        return;
      }

      const remoteOwner = new Owner(this.owner.x, this.owner.y, meta?.name || 'Walker', false);
      if (meta?.jacketColor) remoteOwner.jacketColor = meta.jacketColor;
      if (meta?.hairStyle) remoteOwner.hairStyle = meta.hairStyle;
      if (meta?.hairColor) remoteOwner.hairColor = meta.hairColor;
      if (meta?.pantsColor) remoteOwner.pantsColor = meta.pantsColor;
      if (meta?.skinTone) remoteOwner.skinTone = meta.skinTone;

      const remoteDog = new CompanionDog(this.owner.x + 30, this.owner.y + 20, remoteOwner, coat);
      if (meta?.collarColor) remoteDog.collarColor = meta.collarColor;
      if (meta?.personality) {
        if (typeof remoteDog.setPersonality === 'function') {
          remoteDog.setPersonality(meta.personality);
        } else {
          remoteDog.personality = { ...meta.personality };
        }
      }

      this.remotePlayers.set(peerId, { owner: remoteOwner, dog: remoteDog });

      this.hud.updatePlayerCount(this.remotePlayers.size + 1);
      this.hud.showToast(`👋 ${remoteOwner.name} joined the field!`);
    };

    this.net.onPeerLeave = (peerId) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        this.hud.showToast(`🚶 ${p.owner.name} left the park.`);
        this.remotePlayers.delete(peerId);
        this.hud.updatePlayerCount(this.remotePlayers.size + 1);
        if (this.proximityChat) {
          this.proximityChat.update(0, this.owner, this.remotePlayers);
        }
      }
    };

    // Handle Network Events
    this.net.onBallThrown = (data) => {
      this.ball.throw(data.fromX, data.fromY, data.dirX, data.dirY, data.speed);
      sound.playBallPickup();
    };

    this.net.onBark = (peerId, data) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        p.dog.bark(sound);
      }
    };

    this.net.onPet = (peerId) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        p.dog.pet();
      }
    };

    this.net.onWhistle = (peerId, packet) => {
      sound.playWhistle();
      const p = this.remotePlayers.get(peerId);
      if (p) {
        if (p.dog && typeof p.dog.whistleRecall === 'function') {
          p.dog.whistleRecall();
        }
        if (p.owner && typeof p.owner.setEmote === 'function') {
          p.owner.setEmote('📯', 2.0);
        }
      }
    };

    this.net.onChatMessage = (peerId, text) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        p.owner.setChat(text);
      }
    };

    this.net.onEmote = (peerId, emote) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        p.owner.setEmote(emote);
      }
    };

    // Proximity Chat & Parting Tombstone Handlers
    this.net.onProximityChat = (data) => {
      if (!data) return;
      this.proximityChat.addMessage(data.senderId, data.name || 'Walker', data.text, false);
      const p = this.remotePlayers.get(data.senderId);
      if (p && p.owner) {
        p.owner.setChat(data.text);
      }
    };

    this.net.onTombstoneDrop = (data) => {
      if (!data) return;
      const tombstone = new ChatTombstone(data.x, data.y, {
        text: data.text,
        participants: data.participants
      });
      this.field.addTombstone(tombstone);
    };

    // Intercept packets on underlying network adapter if adapter lacks native dispatch
    if (this.net.adapter && typeof this.net.adapter.handlePacket === 'function') {
      const originalHandlePacket = this.net.adapter.handlePacket.bind(this.net.adapter);
      this.net.adapter.handlePacket = (...args) => {
        const packet = args.length > 1 ? args[1] : args[0];
        const senderId = args.length > 1 ? args[0] : (packet ? packet.senderId : null);
        if (packet) {
          if (packet.type === PacketType.PROXIMITY_CHAT || packet.type === 'PROXIMITY_CHAT') {
            const data = { ...packet, senderId: packet.senderId || senderId };
            this.net.onProximityChat(data);
            if (this.net.isHost && typeof this.net.relayToOthers === 'function') {
              this.net.relayToOthers(senderId, packet);
            }
            return;
          }
          if (packet.type === PacketType.TOMBSTONE_DROP || packet.type === 'TOMBSTONE_DROP') {
            const data = { ...packet, senderId: packet.senderId || senderId };
            this.net.onTombstoneDrop(data);
            if (this.net.isHost && typeof this.net.relayToOthers === 'function') {
              this.net.relayToOthers(senderId, packet);
            }
            return;
          }
        }
        return originalHandlePacket(...args);
      };
    }

    // Start 16Hz sync loop
    this.net.startSyncLoop(() => {
      return {
        owner: this.owner,
        dog: this.dog
      };
    });
  }

  bindInputs() {
    const handleAudioInteraction = () => {
      sound.unlockAudio();
      if (!this.hasInteracted) {
        this.hasInteracted = true;
        sound.startAmbientBreeze();
      }
    };

    window.addEventListener('keydown', (e) => {
      handleAudioInteraction();

      // Ignore game inputs when typing in chat
      const chatInput = document.getElementById('chat-input');
      const proxInput = document.getElementById('proximity-chat-input');
      if (document.activeElement === chatInput || document.activeElement === proxInput) {
        return;
      }

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.owner.keys.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.owner.keys.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.owner.keys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.owner.keys.right = true;
          break;

        case 'Space':
        case 'KeyT':
          // Throw Tennis Ball
          e.preventDefault();
          this.throwBall();
          break;

        case 'KeyL':
          // Toggle Leash
          this.toggleLeash();
          break;

        case 'KeyB':
          // Bark!
          this.barkDog();
          break;

        case 'KeyE':
          // Pet Dog
          this.petDog();
          break;

        case 'KeyH':
        case 'KeyR':
          // Whistle Recall Dog
          this.whistleDog();
          break;

        case 'Enter':
          e.preventDefault();
          if (this.proximityChat && this.proximityChat.isClusterActive()) {
            const proxInput = document.getElementById('proximity-chat-input');
            if (proxInput) {
              proxInput.focus();
              break;
            }
          }
          this.hud.toggleChatInput();
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.owner.keys.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.owner.keys.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.owner.keys.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.owner.keys.right = false;
          break;
      }
    });

    // Touch & Pointer Audio Unlock
    window.addEventListener('click', handleAudioInteraction);
    window.addEventListener('touchstart', handleAudioInteraction, { passive: true });
    window.addEventListener('pointerdown', handleAudioInteraction, { passive: true });

    // Direct In-World Canvas Tap Gestures
    this.canvas.addEventListener('pointerdown', (e) => {
      handleAudioInteraction();

      // Only handle if directly clicking/tapping the game canvas
      if (e.target !== this.canvas) return;

      // Check if tap was on or close to the companion dog
      const dogScreen = this.camera.worldToScreen(this.dog.x, this.dog.y);
      const distToDog = Math.hypot(e.clientX - dogScreen.x, e.clientY - dogScreen.y);
      if (distToDog < 48) {
        this.petDog();
        return;
      }

      // Open field tap: Throw ball towards tapped world coordinate
      const worldTarget = this.camera.screenToWorld(e.clientX, e.clientY);
      const dx = worldTarget.x - this.owner.x;
      const dy = worldTarget.y - this.owner.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 30) {
        const dirX = dx / dist;
        const dirY = dy / dist;
        this.owner.angle = Math.atan2(dy, dx);
        this.throwBallAt(worldTarget.x, worldTarget.y, dirX, dirY);
      }
    });
  }

  handleJoystickMove(vec) {
    if (vec.active) {
      this.joystickActive = true;
      this.owner.keys.up = vec.vy < -0.2;
      this.owner.keys.down = vec.vy > 0.2;
      this.owner.keys.left = vec.vx < -0.2;
      this.owner.keys.right = vec.vx > 0.2;
      this.owner.angle = vec.angle;
      this.owner.isMoving = true;
    } else if (this.joystickActive) {
      this.joystickActive = false;
      this.owner.keys.up = false;
      this.owner.keys.down = false;
      this.owner.keys.left = false;
      this.owner.keys.right = false;
    }
  }

  toggleLeash() {
    this.owner.isLeashed = !this.owner.isLeashed;
    if (this.touchControls && typeof this.touchControls.setLeashed === 'function') {
      this.touchControls.setLeashed(this.owner.isLeashed);
    }
    this.hud.showToast(this.owner.isLeashed ? '🦮 Leash on: Walking close' : '🐕 Off-lead: Free to roam & play!');

    if (this.net && typeof this.net.broadcast === 'function') {
      this.net.broadcast(Protocol.createSyncState(this.net.peerId, this.owner, this.dog));
    }

    if (this.touchControls && typeof this.touchControls.setLeashed === 'function') {
      this.touchControls.setLeashed(this.owner.isLeashed);
    }
  }

  whistleDog() {
    if (this.dog && typeof this.dog.whistleRecall === 'function') {
      this.dog.whistleRecall();
    }
    if (sound && typeof sound.playWhistle === 'function') {
      sound.playWhistle();
    }
    this.hud.showToast('📯 Whistle! Ziggy recalled to heel');
    if (this.net && typeof this.net.broadcast === 'function') {
      if (typeof Protocol.createWhistle === 'function') {
        this.net.broadcast(Protocol.createWhistle(this.net.peerId, this.owner.x, this.owner.y));
      } else {
        this.net.broadcast({ type: 'WHISTLE', senderId: this.net.peerId, x: this.owner.x, y: this.owner.y, timestamp: Date.now() });
      }
    }
  }

  barkDog() {
    this.dog.bark(sound);
    this.net.broadcast(Protocol.createBark(this.net.peerId, this.dog.x, this.dog.y));
  }

  petDog() {
    const distToDog = Math.hypot(this.owner.x - this.dog.x, this.owner.y - this.dog.y);
    if (distToDog < 90) {
      this.dog.pet();
      sound.playPet();
      this.hud.showToast('❤️ Good dog!');
      this.net.broadcast(Protocol.createPet(this.net.peerId));
    } else {
      this.hud.showToast('🐾 Walk closer to Ziggy to pet!');
    }
  }

  throwBall() {
    const dirX = Math.cos(this.owner.angle);
    const dirY = Math.sin(this.owner.angle);
    this.throwBallAt(this.owner.x + dirX * 320, this.owner.y + dirY * 320, dirX, dirY);
  }

  throwBallAt(targetX, targetY, dirX, dirY) {
    const dist = Math.hypot(targetX - this.owner.x, targetY - this.owner.y);
    const speed = Math.min(500, Math.max(240, dist * 1.4));

    this.ball.throw(this.owner.x, this.owner.y, dirX, dirY, speed, speed * 0.5);
    sound.playBallBounce();

    // Trigger local dog to chase
    this.dog.fetchBall(this.ball);

    // Broadcast throw to multiplayer field
    this.net.broadcast(Protocol.createBallThrown(this.net.peerId, this.owner.x, this.owner.y, dirX, dirY, speed));
    this.hud.showToast('🎾 Ball thrown! Fetch!');
  }

  gameLoop(timestamp) {
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  update(dt) {
    // 1. Update Field & Ambient Particles
    this.field.update(dt);

    // 2. Gather all other dogs for social play-bow reactions
    const allDogs = [this.dog];
    for (const p of this.remotePlayers.values()) {
      allDogs.push(p.dog);
    }

    // 3. Update Local Entities
    this.owner.update(dt, this.field);
    this.dog.update(dt, this.field, allDogs, this.ball);
    this.ball.update(dt, this.field);

    // Grass footstep sound
    if (this.owner.isMoving && timestampNow() - this.lastFootstepTime > 320) {
      this.lastFootstepTime = timestampNow();
      sound.playFootstep();
    }

    // 4. Update Remote Peers via Interpolators
    for (const [peerId, interpolatorData] of this.net.remotePeers) {
      if (peerId === this.net.peerId) continue;

      let remote = this.remotePlayers.get(peerId);
      const meta = interpolatorData.meta || {};
      let coat = CoatPreset.CHOCOLATE_TAN;
      const coatName = (meta && meta.coatName) ? meta.coatName : '';
      if (coatName.includes('Golden')) coat = CoatPreset.GOLDEN;
      else if (coatName.includes('Black')) coat = CoatPreset.BLACK_LAB;

      if (!remote) {
        // Auto-create remote player if not yet instantiated
        const remoteOwner = new Owner(this.owner.x, this.owner.y, meta.name || 'Walker', false);
        remoteOwner.jacketColor = meta.jacketColor || '#1e3a8a';
        const remoteDog = new CompanionDog(this.owner.x + 30, this.owner.y + 20, remoteOwner, coat);
        remote = { owner: remoteOwner, dog: remoteDog };
        this.remotePlayers.set(peerId, remote);
        this.hud.updatePlayerCount(this.remotePlayers.size + 1);
      } else {
        // Continuously reflect interpolatorData.meta changes
        if (meta.name && remote.owner.name !== meta.name) {
          remote.owner.name = meta.name;
        }
        if (meta.jacketColor && remote.owner.jacketColor !== meta.jacketColor) {
          remote.owner.jacketColor = meta.jacketColor;
        }
        if (meta.coatName && remote.dog.coat !== coat) {
          remote.dog.coat = coat;
        }
        if (meta.personality) {
          if (typeof remote.dog.setPersonality === 'function') {
            remote.dog.setPersonality(meta.personality);
          } else {
            remote.dog.personality = { ...meta.personality };
          }
        }
      }

      const ownerState = interpolatorData.ownerInterpolator.update(dt);
      if (ownerState) {
        remote.owner.x = ownerState.x;
        remote.owner.y = ownerState.y;
        remote.owner.vx = ownerState.vx;
        remote.owner.vy = ownerState.vy;
        remote.owner.angle = ownerState.angle;
        remote.owner.isMoving = ownerState.isMoving;
        remote.owner.isLeashed = !!ownerState.isLeashed;
        remote.owner.depthY = remote.owner.y + 12;
      }

      const dogState = interpolatorData.dogInterpolator.update(dt);
      if (dogState) {
        remote.dog.x = dogState.x;
        remote.dog.y = dogState.y;
        remote.dog.vx = dogState.vx;
        remote.dog.vy = dogState.vy;
        remote.dog.angle = dogState.angle;
        remote.dog.state = dogState.state;
        remote.dog.depthY = remote.dog.y + 6;
      }
    }

    // 5. Update Proximity Chat Spatial Clustering
    if (this.proximityChat) {
      if (this.owner && this.net && this.net.peerId) {
        this.owner.id = this.net.peerId;
      }
      this.proximityChat.update(dt, this.owner, this.remotePlayers);
    }

    // 6. Host broadcasts authoritative ball state when ball is in play
    if (this.net.isHost && (this.ball.isThrown || this.ball.isCarried || Math.hypot(this.ball.vx, this.ball.vy) > 1)) {
      this.net.broadcast(Protocol.createBallSync(this.ball));
    }

    // 7. Update Camera
    this.camera.update(dt);
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply Camera translation
    this.camera.apply(this.ctx);

    // Gather all dynamic entities to depth-sort
    const dynamicEntities = [
      this.owner,
      this.dog,
      this.ball
    ];

    for (const p of this.remotePlayers.values()) {
      dynamicEntities.push(p.owner);
      dynamicEntities.push(p.dog);
    }

    // Field renders background turf, then Y-sorts trees, benches, tombstones, owners, dogs, and balls
    this.field.render(this.ctx, this.camera, dynamicEntities);

    // Restore Camera
    this.camera.restore(this.ctx);
  }
}

function timestampNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new CliftonDownGame();
  });
}

export default CliftonDownGame;
