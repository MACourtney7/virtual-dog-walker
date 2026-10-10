// Clifton Down: Social Dog Walking Sandbox - Main Orchestrator

import { Field, Camera } from './world/field.js';
import { Owner } from './entities/owner.js';
import { CompanionDog, CoatPreset, DogState } from './entities/companion_dog.js';
import { TennisBall } from './entities/toy.js';
import { NetworkManager, NetStatus } from './net/network.js';
import { Protocol } from './net/protocol.js';
import { SocialHUD } from './ui/social_hud.js';
import { sound } from './systems/audio.js';

class CliftonDownGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    // World & Viewport
    this.field = new Field(2600, 1900);
    this.camera = new Camera(window.innerWidth, window.innerHeight, this.field.width, this.field.height);

    // Local Entities
    const startX = 1350;
    const startY = 1000;
    this.owner = new Owner(startX, startY, 'You (Walker)', true);
    this.dog = new CompanionDog(startX + 40, startY + 20, this.owner, CoatPreset.CHOCOLATE_TAN);
    this.ball = new TennisBall(startX + 20, startY + 20);

    this.camera.follow(this.owner);

    // Remote Players (peerId -> { owner: Owner, dog: CompanionDog })
    this.remotePlayers = new Map();

    // Networking
    this.net = new NetworkManager();

    // UI HUD
    this.hud = new SocialHUD(this.net, this.owner, this.dog, CoatPreset);

    // Audio tracking
    this.hasInteracted = false;
    this.lastFootstepTime = 0;

    // Loop Timing
    this.lastTime = performance.now();

    this.initCanvas();
    this.bindInputs();
    this.initNetworking();

    // Start 60fps loop
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  initCanvas() {
    const resize = () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.camera.resize(this.canvas.width, this.canvas.height);
    };
    window.addEventListener('resize', resize);
    resize();
  }

  initNetworking() {
    // Set initial local profile metadata for networking
    this.net.setLocalMeta({
      name: this.owner.name,
      jacketColor: this.owner.jacketColor,
      coatName: this.dog.coat.name
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

    // When a peer connects
    this.net.onPeerJoin = (peerId, meta) => {
      if (peerId === this.net.peerId) return;

      let coat = CoatPreset.CHOCOLATE_TAN;
      const coatName = (meta && meta.coatName) ? meta.coatName : '';
      if (coatName.includes('Golden')) coat = CoatPreset.GOLDEN;
      else if (coatName.includes('Black')) coat = CoatPreset.BLACK_LAB;

      let existing = this.remotePlayers.get(peerId);
      if (existing) {
        if (meta.name) existing.owner.name = meta.name;
        if (meta.jacketColor) existing.owner.jacketColor = meta.jacketColor;
        existing.dog.coat = coat;
        return;
      }

      const remoteOwner = new Owner(this.owner.x, this.owner.y, meta.name || 'Friend', false);
      remoteOwner.jacketColor = meta.jacketColor || '#14532d';

      const remoteDog = new CompanionDog(this.owner.x + 30, this.owner.y + 20, remoteOwner, coat);
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
      if (!this.hasInteracted) {
        this.hasInteracted = true;
        sound.startAmbientBreeze();
      }
    };

    window.addEventListener('keydown', (e) => {
      handleAudioInteraction();

      // Ignore game inputs when typing in chat
      if (document.activeElement === document.getElementById('chat-input')) {
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
          this.owner.isLeashed = !this.owner.isLeashed;
          this.hud.showToast(this.owner.isLeashed ? '🦮 Leash on: Walking close' : '🐕 Off-lead: Free to roam & play!');
          break;

        case 'KeyB':
          // Bark!
          this.dog.bark(sound);
          this.net.broadcast(Protocol.createBark(this.net.peerId, this.dog.x, this.dog.y));
          break;

        case 'KeyE':
          // Pet Dog
          const distToDog = Math.hypot(this.owner.x - this.dog.x, this.owner.y - this.dog.y);
          if (distToDog < 75) {
            this.dog.pet();
            sound.playPet();
            this.hud.showToast('❤️ Good dog!');
            this.net.broadcast(Protocol.createPet(this.net.peerId));
          }
          break;

        case 'Enter':
          e.preventDefault();
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

    window.addEventListener('click', () => {
      handleAudioInteraction();
    });
  }

  throwBall() {
    const dirX = Math.cos(this.owner.angle);
    const dirY = Math.sin(this.owner.angle);

    this.ball.throw(this.owner.x, this.owner.y, dirX, dirY, 380, 190);
    sound.playBallBounce();

    // Trigger local dog to chase
    this.dog.fetchBall(this.ball);

    // Broadcast throw to multiplayer field
    this.net.broadcast(Protocol.createBallThrown(this.net.peerId, this.owner.x, this.owner.y, dirX, dirY, 380));
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
      if (!remote) {
        // Auto-create remote player if not yet instantiated
        const meta = interpolatorData.meta || {};
        let coat = CoatPreset.CHOCOLATE_TAN;
        const coatName = (meta && meta.coatName) ? meta.coatName : '';
        if (coatName.includes('Golden')) coat = CoatPreset.GOLDEN;
        else if (coatName.includes('Black')) coat = CoatPreset.BLACK_LAB;

        const remoteOwner = new Owner(this.owner.x, this.owner.y, meta.name || 'Friend', false);
        remoteOwner.jacketColor = meta.jacketColor || '#14532d';
        const remoteDog = new CompanionDog(this.owner.x + 30, this.owner.y + 20, remoteOwner, coat);
        remote = { owner: remoteOwner, dog: remoteDog };
        this.remotePlayers.set(peerId, remote);
        this.hud.updatePlayerCount(this.remotePlayers.size + 1);
      }

      const ownerState = interpolatorData.ownerInterpolator.update(dt);
      if (ownerState) {
        remote.owner.x = ownerState.x;
        remote.owner.y = ownerState.y;
        remote.owner.vx = ownerState.vx;
        remote.owner.vy = ownerState.vy;
        remote.owner.angle = ownerState.angle;
        remote.owner.isMoving = ownerState.isMoving;
        remote.owner.isLeashed = ownerState.isLeashed;
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

    // 5. Host broadcasts authoritative ball state when ball is in play
    if (this.net.isHost && (this.ball.isThrown || this.ball.isCarried || Math.hypot(this.ball.vx, this.ball.vy) > 1)) {
      this.net.broadcast(Protocol.createBallSync(this.ball));
    }

    // 5. Update Camera
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

    // Field renders background turf, then Y-sorts trees, benches, owners, dogs, and balls
    this.field.render(this.ctx, this.camera, dynamicEntities);

    // Restore Camera
    this.camera.restore(this.ctx);
  }
}

function timestampNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

window.addEventListener('DOMContentLoaded', () => {
  new CliftonDownGame();
});
