// Clifton Down: Social Dog Walking Sandbox - Main Orchestrator

import { Field, Camera } from './world/field.js';
import { Owner, Gait } from './entities/owner.js';
import { CompanionDog, CoatPreset, DogState } from './entities/companion_dog.js';
import { TennisBall } from './entities/toy.js';
import { NetworkManager, NetStatus } from './net/network.js';
import { Protocol, PacketType } from './net/protocol.js';
import { SocialHUD } from './ui/social_hud.js';
import { sound } from './systems/audio.js';
import { TouchControls } from './ui/touch_controls.js';
import { ProximityChat } from './ui/proximity_chat.js';
// Legacy import for static inspection: import { WalkerNPC, JoggerNPC } from './entities/npc.js';
import { ParkNPC, WalkerNPC, JoggerNPC } from './entities/npc.js';
import { NPC_PATHS, getNpcPath } from './world/npc_paths.js';
import { NavigationArrow } from './ui/navigation_arrow.js';
import { weatherClient, WeatherType } from './systems/weather.js';
import { environmentSystem, TimeOfDay } from './world/environment.js';
import { initWasmSim, syncWorldObstacles } from './engine/wasm_sim_bridge.js';
import { applyCoastalShallowWaterInteraction } from './systems/coastalWater.js';

// Fallback gait order for step-down resolution when Owner lacks a helper.
const GAIT_ORDER = ['STAND', 'STROLL', 'WALK', 'JOG'];

// Resolve the next-lower gait from the given gait string.
function stepDownGaitName(gait) {
  const idx = GAIT_ORDER.indexOf(gait);
  if (idx <= 0) return GAIT_ORDER[0];
  return GAIT_ORDER[idx - 1];
}

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
    this.ball.inOwnerPossession = true;

    this.camera.follow(this.owner);

    // Zone Warping State
    this.currentZoneId = 'clifton-commons';
    this.warpCooldown = 0;
    this.warpFadeAlpha = 0;

    // Ambient Park NPCs (Networked & Solo Pool)
    // Replaced legacy: this.npcs = []; this.field.getParkWaypoints('ladies_mile'); this.field.getParkWaypoints('sea_walls'); this.field.getParkWaypoints('durdham_down');
    this.npcs = new Map();

    // Remote Players (peerId -> { owner: Owner, dog: CompanionDog })
    this.remotePlayers = new Map();

    // Networking
    this.net = new NetworkManager();

    this.net.onNpcSpawn = (npcData) => {
      this.handleNpcSpawn(npcData);
    };

    this.net.onNpcDespawn = (npcId) => {
      this.removeNpc(npcId);
    };

    this.net.onNpcSnapshot = (snapshotNpcs, serverTime) => {
      this.handleNpcSnapshot(snapshotNpcs, serverTime);
    };

    if (this.net.activeNpcs && this.net.activeNpcs.size > 0 && this.npcs.size === 0) {
      this.handleNpcSnapshot(Array.from(this.net.activeNpcs.values()), Date.now());
    }

    // UI HUD
    this.hud = new SocialHUD(this.net, this.owner, this.dog, CoatPreset);

    // Directional Navigation Compass Arrow & Waste Management State
    this.navArrow = new NavigationArrow();
    this.hasPoopBag = false;
    this.activePoopPileNearPlayer = null;
    this.activeBinNearPlayer = null;

    // Dog Stray Run-Off and Waste Drop Event Callbacks
    this.dog.onStrayTriggered = (dog) => {
      this.hud.showToast('Your dog ran off! Check the compass arrow 🐕');
      this.navArrow.setTarget(dog.x, dog.y, 'DOG', 'Find your dog!', '#f59e0b');
    };

    this.dog.onStrayResolved = (dog) => {
      if (this.navArrow.target && this.navArrow.target.type === 'DOG') {
        this.navArrow.clearTarget();
      }
      this.hud.showToast('Reunited with your dog! ❤️');
    };

    this.dog.onPoopDropped = (dog, poopPile) => {
      if (this.field && typeof this.field.addPoopPile === 'function') {
        this.field.addPoopPile(poopPile);
      }
      this.hud.showToast('Your dog did a poop! Please pick it up 🟤');
    };

    // Proximity Chat HUD & Dynamic Spatial Clustering
    this.proximityChat = new ProximityChat({
      radius: 200,
      joinRadius: 160,
      onSendMessage: (text, clusterPeerIds) => {
        const peers = clusterPeerIds || this.proximityChat.getActivePeers();
        if (this.net && typeof this.net.sendProximityChat === 'function') {
          this.net.sendProximityChat(text, peers);
        } else if (this.net && typeof this.net.broadcast === 'function') {
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
        if (sound && typeof sound.playChatChime === 'function') {
          sound.playChatChime();
        } else if (sound && typeof sound.playChat === 'function') {
          sound.playChat();
        }
      },
      onClusterChanged: (activePeerIds) => {
        if (this.net && typeof this.net.syncProximityCluster === 'function') {
          this.net.syncProximityCluster(activePeerIds);
        }
      },
      onClusterDissolved: (partingContext) => {
        // Parting no longer drops turf markers
        if (this.hud && typeof this.hud.showToast === 'function') {
          this.hud.showToast('💬 Conversation ended.');
        }
      }
    });

    if (this.proximityChat) {
      this.proximityChat.onBurnMessage = (uuid) => this.net && this.net.burnProximityMessage(uuid);
      this.proximityChat.onBurnSession = () => this.net && this.net.burnProximitySession();
    }

    if (this.net) {
      this.net.onProximityChat = (data) => {
        if (data && data.text) {
          this.proximityChat.addMessage(data.senderId, data.name || data.senderName, data.text);
        }
      };
      this.net.onProximityBurnMessage = (uuid) => this.proximityChat && this.proximityChat.burnMessage(uuid);
      this.net.onProximityBurnSession = () => this.proximityChat && this.proximityChat.clearMessages();
    }
    this.hud.proximityChat = this.proximityChat;

    // Touch Controls
    this.joystickActive = false;
    this.touchControls = new TouchControls({
      onPaceDown: () => this.owner.stepGait(-1),
      onPaceUp: () => this.owner.stepGait(+1),
      onThrow: () => this.throwBall(),
      onLeash: () => this.toggleLeash(),
      onWhistle: () => this.whistleDog(),
      onPet: () => this.petDog(),
      onPickup: () => this.pickUpPoop(),
      onDispose: () => this.disposePoopBag(),
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

    // Environment & Weather Systems
    this.weatherClient = weatherClient;
    this.environment = environmentSystem;
    this.field.environment = this.environment;
    this.weatherClient.startAutoRefresh();
    this.weatherClient.addListener((weather) => {
      sound.setWeather(weather);
    });
    // Initial sync:
    sound.setWeather(this.weatherClient.getWeather());
    this.weatherClient.fetchWeather().catch(() => {});

    // Loop Timing
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    this.initCanvas();
    this.bindInputs();
    this.initNetworking();
    initWasmSim()
      .then((sim) => {
        this.wasmSim = sim;
        if (this.wasmSim && this.field) {
          const colliders = typeof this.field.getColliders === 'function'
            ? this.field.getColliders()
            : [];
          this.wasmSim.set_colliders(JSON.stringify(colliders));
          syncWorldObstacles(this.field);
        }
      })
      .catch(() => {});
    if (!this.isNetworkConnecting()) {
      this.updateLocalSpawner(0);
    }

    // Start 60fps loop
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame((t) => this.gameLoop(t));
    }
  }

  initCanvas() {
    const resize = () => {
      const width = window.visualViewport ? window.visualViewport.width : (typeof window !== 'undefined' ? window.innerWidth : 1280);
      const height = window.visualViewport ? window.visualViewport.height : (typeof window !== 'undefined' ? window.innerHeight : 720);
      const dpr = Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 3.0);
      this.dpr = dpr;

      if (this.canvas) {
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
      }

      let zoom = 1.0;
      if (width < 600) {
        zoom = Math.max(0.75, Math.min(0.85, 0.75 + (width / 600) * 0.10));
      } else if (width < 900) {
        zoom = 0.88;
      } else {
        zoom = 1.0;
      }

      this.camera.resize(width, height, zoom);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 100));
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', resize);
      }
    }
    resize();
  }

  initNetworking() {
    if (this.wasmSim && this.field && typeof this.wasmSim.set_colliders === 'function') {
      const colliders = typeof this.field.getColliders === 'function'
        ? this.field.getColliders()
        : [];
      this.wasmSim.set_colliders(JSON.stringify(colliders));
      syncWorldObstacles(this.field);
    }

    // Set initial local profile metadata for networking
    this.net.setLocalMeta({
      name: this.owner.name,
      jacketColor: this.owner.jacketColor,
      coatName: this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
      hairStyle: this.owner.hairStyle,
      hairColor: this.owner.hairColor,
      pantsColor: this.owner.pantsColor,
      accessory: this.owner.accessory || 'NONE',
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
        if (meta.accessory !== undefined) existing.owner.accessory = meta.accessory || 'NONE';
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
      remoteOwner.accessory = meta?.accessory || 'NONE';
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
        if (p.owner && typeof p.owner.triggerPet === 'function') {
          p.owner.triggerPet(0.8);
        }
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
      if (this.proximityChat && this.proximityChat.getActivePeers().includes(peerId)) {
        this.proximityChat.addMessage(peerId, (p && p.owner && p.owner.name) || 'Walker', text, false);
      } else {
        if (p && p.owner) {
          p.owner.setChat(text);
        }
      }
    };

    this.net.onEmote = (peerId, emote) => {
      const p = this.remotePlayers.get(peerId);
      if (p) {
        p.owner.setEmote(emote);
      }
    };

    // Proximity Chat Handlers
    this.net.onProximityChat = (data) => {
      if (!data) return;
      this.proximityChat.addMessage(data.senderId, data.name || 'Walker', data.text, false);
    };
    this.net.onProximityBurnMessage = (uuid) => this.proximityChat && this.proximityChat.burnMessage(uuid);
    this.net.onProximityBurnSession = () => this.proximityChat && this.proximityChat.clearMessages();

    // Network NPC Spawner Callbacks
    this.net.onNpcSpawn = (npcData) => {
      this.handleNpcSpawn(npcData);
    };

    this.net.onNpcDespawn = (npcId) => {
      this.removeNpc(npcId);
    };

    this.net.onNpcSnapshot = (snapshotNpcs, serverTime) => {
      this.handleNpcSnapshot(snapshotNpcs, serverTime);
    };

    if (this.net.activeNpcs && this.net.activeNpcs.size > 0 && this.npcs.size === 0) {
      this.handleNpcSnapshot(Array.from(this.net.activeNpcs.values()), Date.now());
    }

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
        case 'KeyQ':
          // Toggle Leash
          this.toggleLeash();
          break;

        case 'KeyR':
          // Whistle Recall Dog
          this.whistleDog();
          break;

        case 'KeyC':
          // Toggle Proximity Group Chat
          e.preventDefault();
          if (this.proximityChat && typeof this.proximityChat.toggleVisibility === 'function') {
            this.proximityChat.toggleVisibility();
          }
          break;

        case 'KeyE':
          // Reserved / inert (contextual interactions now via canvas click)
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

    // Touch & Pointer Audio Unlock
    window.addEventListener('click', handleAudioInteraction);
    window.addEventListener('touchstart', handleAudioInteraction, { passive: true });
    window.addEventListener('pointerdown', handleAudioInteraction, { passive: true });

    // Suppress browser context menu on the game canvas (right-click is a game gesture)
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Direct In-World Canvas Tap Gestures
    // Single vs double click disambiguation: < 280ms and < 24px between clicks.
    this._lastClickTime = 0;
    this._lastClickX = 0;
    this._lastClickY = 0;
    this._pendingGestureTimer = null;

    const DOUBLE_CLICK_MS = 280;
    const DOUBLE_CLICK_PX = 24;

    // Cancel any pending deferred single gesture (used when an immediate
    // object interaction supersedes the deferred field gesture).
    const cancelPendingSingle = () => {
      if (this._pendingGestureTimer) {
        clearTimeout(this._pendingGestureTimer);
        this._pendingGestureTimer = null;
      }
      this._pendingGesture = null;
    };

    // Resolve a captured press (hit type + heading captured at press time).
    const resolveCapturedPress = (captured, isDouble) => {
      if (!captured) return;

      if (captured.type === 'brake') {
        if (isDouble) {
          this.owner.setGait('STAND');
          return;
        }
        // Deferred single brake: if the owner has already stopped in the
        // interim (boundary collision, petting, etc.) do not restart motion.
        if (this.owner.gait === 'STAND') return;
        // Step down exactly one level relative to the gait captured at press
        // time, so a JOG that expired to WALK during the 280ms window does
        // not over-brake.
        const gaitAtPress = captured.gaitAtPress;
        if (gaitAtPress === 'JOG') {
          this.owner.setGait('WALK');
        } else if (gaitAtPress === 'WALK') {
          this.owner.setGait('STROLL');
        } else if (gaitAtPress === 'STROLL') {
          this.owner.setGait('STAND');
        } else {
          this.owner.stepGait(-1);
        }
        return;
      }

      // Field press
      const heading = captured.heading;
      if (typeof heading !== 'number' || !isFinite(heading)) return;

      const gaitAtPress = captured.gaitAtPress;
      this.owner.setTargetHeading(heading);

      if (isDouble) {
        if (gaitAtPress === 'STAND') {
          this.owner.setGait('STROLL');
        } else if (gaitAtPress === 'STROLL') {
          this.owner.setGait('WALK');
        } else if (gaitAtPress === 'WALK') {
          this.owner.setGait('JOG');
        }
      } else {
        if (gaitAtPress === 'STAND') {
          this.owner.setGait('STROLL');
        }
      }
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      handleAudioInteraction();

      // Only handle if directly clicking/tapping the game canvas
      if (e.target !== this.canvas) return;

      // Right-click: throw ball toward world coordinate without changing gait
      if (e.button === 2) {
        e.preventDefault();
        const worldTarget = this.camera.screenToWorld(e.clientX, e.clientY);
        const dx = worldTarget.x - this.owner.x;
        const dy = worldTarget.y - this.owner.y;
        const dist = Math.hypot(dx, dy);
        let dirX, dirY;
        if (dist > 0.001) {
          dirX = dx / dist;
          dirY = dy / dist;
        } else {
          // Degenerate: click landed on the owner; throw along current facing
          dirX = Math.cos(this.owner.angle);
          dirY = Math.sin(this.owner.angle);
        }
        this.throwBallAt(worldTarget.x, worldTarget.y, dirX, dirY);
        return;
      }

      // Only left-click / primary pointer
      if (e.button !== undefined && e.button !== 0) return;

      // --- Avatar click → brake gesture (REQ-004) ---
      // Detect clicks on the player avatar body and resolve as a brake gesture.
      // This is an ADDITION: non-avatar clicks fall through to existing handling.
      {
        const avatarWorld = this.camera.screenToWorld(e.clientX, e.clientY);
        const hitRadius = (Owner && typeof Owner.PLAYER_HIT_RADIUS === 'number')
          ? Owner.PLAYER_HIT_RADIUS
          : 26;
        const distSq = (avatarWorld.x - this.owner.x) ** 2 + (avatarWorld.y - this.owner.y) ** 2;
        const onPlayer = distSq < (hitRadius * hitRadius) ||
          (typeof this.owner.isPointOnPlayer === 'function' &&
            this.owner.isPointOnPlayer(avatarWorld.x, avatarWorld.y));

        if (onPlayer) {
          if (this.owner.gait !== 'STAND') {
            const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const lastAvatarClickTime = this._lastAvatarClickTime || 0;
            let mode;
            if (lastAvatarClickTime > 0 && (nowMs - lastAvatarClickTime) <= 300) {
              mode = 'immediate';
              this._lastAvatarClickTime = 0;
            } else {
              mode = 'step';
              this._lastAvatarClickTime = nowMs;
            }
            // Cancel any pending deferred field gesture so it doesn't fire later.
            cancelPendingSingle();
            this._lastClickTime = 0;
            this._lastClickX = 0;
            this._lastClickY = 0;

            if (mode === 'immediate') {
              this.owner.setGait('STAND');
            } else {
              if (typeof this.owner.stepDownGait === 'function') {
                this.owner.stepDownGait();
              } else {
                this.owner.setGait(stepDownGaitName(this.owner.gait));
              }
            }
          }
          // Clicking a STAND avatar: no brake, no gait change.
          return;
        }
      }

      // --- Immediate hits (no double-click delay) ---

      // 1. Companion dog
      const dogScreen = this.camera.worldToScreen(this.dog.x, this.dog.y);
      const distToDog = Math.hypot(e.clientX - dogScreen.x, e.clientY - dogScreen.y);
      if (distToDog < 48) {
        // Immediate interaction supersedes any pending deferred field gesture
        // and resets double-click state so the next field tap is a fresh single.
        cancelPendingSingle();
        this._lastClickTime = 0;
        this._lastClickX = 0;
        this._lastClickY = 0;
        this.petDog();
        this.owner.setGait('STAND');
        return;
      }

      // 2. Poop pile
      if (this.activePoopPileNearPlayer) {
        const poopScreen = this.camera.worldToScreen(this.activePoopPileNearPlayer.x, this.activePoopPileNearPlayer.y);
        const distToPoopScreen = Math.hypot(e.clientX - poopScreen.x, e.clientY - poopScreen.y);
        if (distToPoopScreen < 40) {
          cancelPendingSingle();
          this._lastClickTime = 0;
          this._lastClickX = 0;
          this._lastClickY = 0;
          this.pickUpPoop();
          return;
        }
      }

      // 3. Dog bin
      if (this.activeBinNearPlayer && this.hasPoopBag) {
        const binScreen = this.camera.worldToScreen(this.activeBinNearPlayer.x, this.activeBinNearPlayer.y);
        const distToBinScreen = Math.hypot(e.clientX - binScreen.x, e.clientY - binScreen.y);
        if (distToBinScreen < 44) {
          cancelPendingSingle();
          this._lastClickTime = 0;
          this._lastClickX = 0;
          this._lastClickY = 0;
          this.disposePoopBag();
          return;
        }
      }

      // --- Deferred gestures (single vs double click) ---
      // Capture hit type + heading AT PRESS TIME so the owner's later movement
      // does not change what the press meant.
      const worldTarget = this.camera.screenToWorld(e.clientX, e.clientY);
      const isBrake = this.owner.gait !== 'STAND' &&
        typeof this.owner.isPointOnRearBrakeArc === 'function' &&
        this.owner.isPointOnRearBrakeArc(worldTarget.x, worldTarget.y);

      const captured = {
        type: isBrake ? 'brake' : 'field',
        heading: Math.atan2(worldTarget.y - this.owner.y, worldTarget.x - this.owner.x),
        gaitAtPress: this.owner.gait,
        worldX: worldTarget.x,
        worldY: worldTarget.y
      };

      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const dtSinceLast = now - this._lastClickTime;
      const distSinceLast = Math.hypot(e.clientX - this._lastClickX, e.clientY - this._lastClickY);
      const isDouble = dtSinceLast < DOUBLE_CLICK_MS && distSinceLast <= DOUBLE_CLICK_PX;

      this._lastClickTime = now;
      this._lastClickX = e.clientX;
      this._lastClickY = e.clientY;

      if (isDouble) {
        // Cancel any pending single-click gesture
        if (this._pendingGestureTimer) {
          clearTimeout(this._pendingGestureTimer);
          this._pendingGestureTimer = null;
        }
        this._pendingGesture = null;
        resolveCapturedPress(captured, true);
      } else {
        // Not a double press: flush any pending single gesture immediately
        // BEFORE scheduling this new one.
        if (this._pendingGestureTimer) {
          clearTimeout(this._pendingGestureTimer);
          this._pendingGestureTimer = null;
          const pending = this._pendingGesture;
          this._pendingGesture = null;
          if (pending) resolveCapturedPress(pending, false);
        }

        this._pendingGesture = captured;
        this._pendingGestureTimer = setTimeout(() => {
          this._pendingGestureTimer = null;
          const pending = this._pendingGesture;
          this._pendingGesture = null;
          if (pending) resolveCapturedPress(pending, false);
        }, DOUBLE_CLICK_MS);
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

  warpToZone(targetZoneId, targetX, targetY) {
    this.warpCooldown = 2.5;
    this.warpFadeAlpha = 1.0;

    if (this.field && typeof this.field.loadZone === 'function') {
      this.field.loadZone(targetZoneId);
    }
    this.currentZoneId = (this.field && this.field.zoneId) || targetZoneId;
    syncWorldObstacles(this.field);

    this.owner.x = targetX;
    this.owner.y = targetY;
    this.dog.x = targetX - 30;
    this.dog.y = targetY + 20;

    this.dog.isStray = false;
    this.dog.isLost = false;
    if (this.navArrow) this.navArrow.clearTarget();

    if (this.ball && typeof this.ball.retrieveByOwner === 'function') {
      this.ball.retrieveByOwner();
    }

    this.remotePlayers.clear();
    this.npcs.clear();

    if (this.hud) {
      const title = (this.field && this.field.zoneConfig && this.field.zoneConfig.title) || targetZoneId;
      this.hud.setZoneTitle(title);
      this.hud.showToast('Entered ' + title);
    }

    if (this.net && typeof this.net.switchRoom === 'function') {
      this.net.switchRoom(this.field.zoneId);
    }
  }

  toggleLeash() {
    if (this.owner.isLeashed) {
      // Turning OFF leash – always allowed
      this.owner.isLeashed = false;
      if (this.touchControls && typeof this.touchControls.setLeashed === 'function') {
        this.touchControls.setLeashed(false);
      }
      this.hud.showToast('🐕 Off-lead: Free to roam & play!');
      if (this.net && typeof this.net.broadcast === 'function') {
        this.net.broadcast(Protocol.createSyncState(this.net.peerId, this.owner, this.dog));
      }
      return;
    }

    // Turning ON leash – strict proximity gate (<= 68px)
    const dist = Math.hypot(this.dog.x - this.owner.x, this.dog.y - this.owner.y);
    if (dist > 68) {
      this.hud.showToast("🦮 Too far to clip lead! Walk closer or whistle to recall first.");
      return;
    }

    this.owner.isLeashed = true;
    if (typeof this.owner.triggerPet === 'function') {
      this.owner.triggerPet(0.45);
    }
    if (typeof this.dog.triggerPet === 'function') {
      this.dog.triggerPet(0.45);
    }
    if (this.sound && typeof this.sound.playLeadClip === 'function') {
      this.sound.playLeadClip();
    } else if (typeof sound !== 'undefined' && sound && typeof sound.playLeadClip === 'function') {
      sound.playLeadClip();
    }
    if (typeof DogState !== 'undefined' && DogState.FOLLOWING !== undefined) {
      if (typeof this.dog.transitionTo === 'function') {
        this.dog.transitionTo(DogState.FOLLOWING);
      } else {
        this.dog.state = DogState.FOLLOWING;
      }
    }
    if (this.touchControls && typeof this.touchControls.setLeashed === 'function') {
      this.touchControls.setLeashed(true);
    }
    this.hud.showToast('🦮 Leash on: Walking close');
    if (this.net && typeof this.net.broadcast === 'function') {
      this.net.broadcast(Protocol.createSyncState(this.net.peerId, this.owner, this.dog));
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

  /**
   * @deprecated Manual barking is retired in Ticket-023 (AC-023.2). Dogs bark autonomously based on personality traits, NPC reactions, and peer responses.
   */
  barkDog() {
    // Deprecated: manual barking retired in favor of autonomous canine behavior
  }

  petDog() {
    const distToDog = Math.hypot(this.owner.x - this.dog.x, this.owner.y - this.dog.y);
    if (distToDog < 90) {
      if (typeof this.owner.triggerPet === 'function') {
        this.owner.triggerPet(0.8);
      }
      this.dog.pet();
      sound.playPet();
      this.hud.showToast('❤️ Good dog!');
      this.net.broadcast(Protocol.createPet(this.net.peerId));
    } else {
      this.hud.showToast('🐾 Walk closer to Ziggy to pet!');
    }
  }

  pickUpPoop() {
    if (!this.activePoopPileNearPlayer) return;
    if (typeof this.owner.triggerPickup === 'function') {
      this.owner.triggerPickup(0.8);
    }
    const pile = this.activePoopPileNearPlayer;
    if (this.field && typeof this.field.pickupPoop === 'function') {
      this.field.pickupPoop(pile.x, pile.y);
    } else if (this.field && typeof this.field.removePoopPile === 'function') {
      this.field.removePoopPile(pile.id);
    }
    this.hasPoopBag = true;
    this.activePoopPileNearPlayer = null;
    this.hud.showToast('💩 Cleaned up waste! Dispose in a bin.');
    if (this.hud && typeof this.hud.updateInventory === 'function') {
      this.hud.updateInventory(true);
    }

    if (this.field && typeof this.field.getNearestBin === 'function') {
      const nearestBin = this.field.getNearestBin(this.owner.x, this.owner.y);
      if (nearestBin && this.navArrow) {
        this.navArrow.setTarget(nearestBin.x, nearestBin.y, 'BIN', 'Nearest Bin', '#10b981');
      }
    }
  }

  disposePoopBag() {
    if (!this.activeBinNearPlayer || !this.hasPoopBag) return;
    this.hasPoopBag = false;
    this.activeBinNearPlayer = null;

    if (this.navArrow && this.navArrow.target && this.navArrow.target.type === 'BIN') {
      this.navArrow.clearTarget();
    }

    if (sound && typeof sound.playPet === 'function') {
      sound.playPet();
    }
    this.hud.showToast('Disposed cleanly! The Downs thanks you 🌳');
  }

  canThrowBall() {
    return Boolean(
      this.ball &&
      this.ball.inOwnerPossession &&
      !this.ball.isThrown &&
      !this.ball.isCarried &&
      (!this.dog || (this.dog.state !== DogState.FETCHING && !this.dog.hasBall))
    );
  }

  throwBall() {
    if (!this.canThrowBall()) {
      if (this.hud && typeof this.hud.showToast === 'function') {
        this.hud.showToast('🎾 Wait for your dog to return the ball!');
      }
      return;
    }
    const dirX = Math.cos(this.owner.angle);
    const dirY = Math.sin(this.owner.angle);
    this.throwBallAt(this.owner.x + dirX * 320, this.owner.y + dirY * 320, dirX, dirY);
  }

  throwBallAt(targetX, targetY, dirX, dirY) {
    if (!this.canThrowBall()) {
      if (this.hud && typeof this.hud.showToast === 'function') {
        this.hud.showToast('🎾 Wait for your dog to return the ball!');
      }
      return;
    }
    const dist = Math.hypot(targetX - this.owner.x, targetY - this.owner.y);
    const speed = Math.min(500, Math.max(240, dist * 1.4));

    this.ball.throw(this.owner.x, this.owner.y, dirX, dirY, speed, speed * 0.5);
    this.ball.inOwnerPossession = false;
    sound.playBallBounce();

    // Trigger local dog to chase
    this.dog.fetchBall(this.ball);

    // Broadcast throw to multiplayer field
    this.net.broadcast(Protocol.createBallThrown(this.net.peerId, this.owner.x, this.owner.y, dirX, dirY, speed));
    if (this.hud && typeof this.hud.showToast === 'function') {
      this.hud.showToast('🎾 Ball thrown! Fetch!');
    }
  }

  // Ambient Park NPC Management (Networked & Solo Pool)
  getCurrentServerTime() {
    if (this.net && typeof this.net.getServerTime === 'function') {
      const t = this.net.getServerTime();
      return (typeof t === 'number' && t > 1e10) ? t / 1000 : t;
    }
    const now = Date.now();
    return now > 1e10 ? now / 1000 : now;
  }

  handleNpcSpawn(data) {
    return this.spawnNetworkNpc(data);
  }

  spawnNetworkNpc(data) {
    const raw = (data && data.npc) ? data.npc : data;
    if (!data || (!data.id && (!raw || !raw.id))) return null;
    const id = (raw && raw.id) || (data && data.id);
    const rawSpawnTime = (raw && raw.spawnTime !== undefined) ? raw.spawnTime : (data && data.spawnTime);
    let spawnTimeSec;
    if (rawSpawnTime !== undefined && rawSpawnTime !== null && rawSpawnTime !== '') {
      const n = Number(rawSpawnTime);
      spawnTimeSec = n > 1e10 ? n / 1000 : n;
    } else {
      spawnTimeSec = this.getCurrentServerTime();
    }
    const npcType = (raw && (raw.type || raw.npcType)) || (data && (data.type || data.npcType)) || 'walker';
    const npc = new ParkNPC({
      id: id,
      pathId: (raw && raw.pathId) || (data && data.pathId),
      type: npcType,
      seed: typeof (raw && raw.seed) === 'number' ? raw.seed : (typeof (data && data.seed) === 'number' ? data.seed : 0),
      spawnTime: spawnTimeSec
    });
    const nowSec = this.getCurrentServerTime();
    npc.setClock(nowSec);
    this.npcs.set(id, npc);
    return npc;
  }

  removeNpc(id) {
    if (this.npcs.has(id)) {
      this.npcs.delete(id);
    }
  }

  handleNpcSnapshot(snapshotNpcs, serverTime) {
    this.npcs.clear();
    const effectiveNow = (serverTime !== undefined && serverTime !== null)
      ? (Number(serverTime) > 1e10 ? Number(serverTime) / 1000 : Number(serverTime))
      : this.getCurrentServerTime();
    if (Array.isArray(snapshotNpcs)) {
      for (const npcData of snapshotNpcs) {
        const npc = this.spawnNetworkNpc(npcData);
        if (npc && typeof effectiveNow === 'number' && !isNaN(effectiveNow)) {
          npc.setClock(effectiveNow);
        }
      }
    }
  }

  isNetworkConnecting() {
    if (!this.net) return false;
    return this.net.status === 'CONNECTING' || this.net.status === 'RECONNECTING';
  }

  isNetworkAuthoritative() {
    if (!this.net) return false;
    const isConnected = this.net.status === 'CONNECTED' || this.net.status === 'CONNECTED_SERVER' || this.net.status === 'HOSTING' || this.net.status === 'CONNECTED_PEER';
    return Boolean((this.net.isDedicatedServer || this.net.isPartyKit || this.net.isHost) && isConnected);
  }

  spawnLocalNpc(prewarmFraction = 0.0) {
    const usedPathIds = new Set();
    for (const npc of this.npcs.values()) {
      if (npc.pathId) usedPathIds.add(npc.pathId);
    }
    const available = NPC_PATHS.filter(p => !usedPathIds.has(p.id));
    const pool = available.length > 0 ? available : NPC_PATHS;
    if (!pool || pool.length === 0) return null;
    const path = pool[Math.floor(Math.random() * pool.length)];

    let type;
    if (path.type === 'walker') type = 'walker';
    else if (path.type === 'jogger') type = 'jogger';
    else type = Math.random() < 0.5 ? 'walker' : 'jogger';

    const speed = type === 'jogger' ? 48 : 22;
    let pathLength = path.lengthPx;
    if (!pathLength && Array.isArray(path.waypoints) && path.waypoints.length > 1) {
      pathLength = 0;
      for (let i = 0; i < path.waypoints.length - 1; i++) {
        pathLength += Math.hypot(path.waypoints[i+1].x - path.waypoints[i].x, path.waypoints[i+1].y - path.waypoints[i].y);
      }
    }
    pathLength = pathLength || 1000;
    const lifetimeSec = pathLength / speed;
    const offsetSec = lifetimeSec * Math.max(0, Math.min(0.9, prewarmFraction));

    const nowSec = this.getCurrentServerTime();
    const spawnTimeSec = nowSec - offsetSec;
    const seed = Math.floor(Math.random() * 0xFFFFFFFF);
    const id = `npc-solo-${Math.random().toString(36).slice(2, 8)}-${Math.floor(nowSec)}`;

    const npc = new ParkNPC({
      id,
      pathId: path.id,
      type,
      seed,
      spawnTime: spawnTimeSec
    });
    npc.setClock(nowSec);
    this.npcs.set(id, npc);
    return npc;
  }

  updateLocalSpawner(dt) {
    if (this.isNetworkAuthoritative() || this.isNetworkConnecting()) return;
    const targetCount = 8;
    while (this.npcs.size < targetCount) {
      const i = this.npcs.size;
      const prewarmFraction = (i + 0.2) / targetCount;
      const spawned = this.spawnLocalNpc(prewarmFraction);
      if (!spawned) break;
    }
  }

  gameLoop(timestamp) {
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  update(dt) {
    // Zone Warp Cooldown & Crossfade Fade
    if (this.warpCooldown > 0) this.warpCooldown = Math.max(0, this.warpCooldown - dt);
    if (this.warpFadeAlpha > 0) this.warpFadeAlpha = Math.max(0, this.warpFadeAlpha - dt * 1.5);

    // Check warp gates
    if (this.warpCooldown <= 0 && this.field && typeof this.field.checkWarpGate === 'function') {
      const gate = this.field.checkWarpGate(this.owner.x, this.owner.y);
      if (gate) {
        this.warpToZone(gate.targetZoneId, gate.targetX, gate.targetY);
      }
    }

    // Coastal shallow water interaction (safe, never throws)
    if (this.field && this.field.zoneConfig && this.field.zoneConfig.biome === 'coastal') {
      try {
        applyCoastalShallowWaterInteraction({
          particleSystem: this.field.particleSystem,
          owner: this.owner,
          dog: this.dog,
          dt,
          randomValue: Math.random(),
        });
      } catch (_err) {
        // Never let coastal interaction break the animation frame loop.
      }
    }

    // 0. Update Environment System & Audio Diurnal Sync
    if (this.environment) {
      this.environment.update(dt, this.weatherClient ? this.weatherClient.getWeather() : null);
      if (sound && typeof sound.setTimeOfDay === 'function') {
        sound.setTimeOfDay(this.environment.getTimeOfDay());
      }
    }

    // 2. Gather all other dogs for social play-bow reactions
    const allDogs = [this.dog];
    for (const p of this.remotePlayers.values()) {
      allDogs.push(p.dog);
    }

    // 1. Update Field & Ambient Particles with dynamic entities for leaf scattering
    const allFieldEntities = [this.owner, ...allDogs, ...this.npcs.values()];
    this.field.update(dt, allFieldEntities);

    const nowSec = this.getCurrentServerTime();
    const npcList = Array.from(this.npcs.values());

    // Collect all avoidance entities for NPCs
    // const avoidanceEntities = [this.owner, this.dog, ...this.npcs];
    const avoidanceEntities = [this.owner, this.dog, ...npcList];
    for (const p of this.remotePlayers.values()) {
      avoidanceEntities.push(p.owner);
      avoidanceEntities.push(p.dog);
    }

    // Update ambient NPCs
    // npc.update(dt, this.field, avoidanceEntities)
    for (const [id, npc] of this.npcs) {
      npc.update(dt, nowSec, avoidanceEntities);
      if (npc.isDone(nowSec)) {
        this.npcs.delete(id);
      }
    }

    // Update solo spawner if in solo/offline mode
    this.updateLocalSpawner(dt);

    // 3. Update Local Entities
    this.owner.update(dt, this.field);

    // Collision resolution is handled inside Owner.update() via resolveCollisionWithResult.

    // this.dog.update(dt, this.field, allDogs, this.ball, this.npcs);
    this.dog.update(dt, this.field, allDogs, this.ball, Array.from(this.npcs.values()));
    this.ball.update(dt, this.field);

    // Direct Owner Ball Pickup Safeguard
    if (this.ball && this.owner && !this.ball.inOwnerPossession && !this.ball.isCarried) {
      if (this.ball.isThrown && this.ball.z <= 0 && Math.hypot(this.ball.vx, this.ball.vy) < 10) {
        this.ball.isThrown = false;
      }
      if (!this.ball.isThrown) {
        const distToBall = Math.hypot(this.owner.x - this.ball.x, this.owner.y - this.ball.y);
        if (distToBall < 32) {
          if (typeof this.ball.retrieveByOwner === 'function') {
            this.ball.retrieveByOwner();
          } else {
            this.ball.inOwnerPossession = true;
            this.ball.isThrown = false;
            this.ball.isCarried = false;
            this.ball.carrier = null;
            this.ball.vx = 0;
            this.ball.vy = 0;
            this.ball.vz = 0;
            this.ball.z = 0;
          }
          if (this.dog) {
            if (this.dog.targetBall === this.ball || this.dog.targetBall) {
              this.dog.targetBall = null;
            }
            if (this.dog.state === DogState.FETCHING) {
              this.dog.hasBall = false;
              this.dog.targetBall = null;
              this.dog.state = (this.owner && this.owner.isLeashed) ? DogState.FOLLOWING : DogState.ROAMING;
            }
          }
          if (this.hud && typeof this.hud.showToast === 'function') {
            this.hud.showToast('🎾 Picked up tennis ball.');
          }
        }
      }
    }

    // Dynamic Touch Throw Button State
    this.touchControls?.setThrowEnabled(this.canThrowBall());
    if (this.touchControls && typeof this.touchControls.setCurrentGait === 'function') {
      this.touchControls.setCurrentGait(this.owner.gait);
    }

    // Grass footstep sound (cadence scales linearly with gait speed over [75, 185])
    if (this.owner.isMoving && this.owner.gait !== 'STAND') {
      const gaitSpeeds = (Owner && Owner.GAIT_SPEEDS) ? Owner.GAIT_SPEEDS : null;
      const speed = gaitSpeeds && gaitSpeeds[this.owner.gait] !== undefined
        ? gaitSpeeds[this.owner.gait]
        : (this.owner.getCurrentSpeed ? this.owner.getCurrentSpeed() : 100);
      // Map speed [75, 185] -> interval [460ms, 200ms] (linear, clamped)
      const t = Math.max(0, Math.min(1, (speed - 75) / (185 - 75)));
      const footstepInterval = 460 - t * (460 - 200);
      if (timestampNow() - this.lastFootstepTime > footstepInterval) {
        this.lastFootstepTime = timestampNow();
        sound.playFootstep();
      }
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

    // 7. Navigation Arrow & Waste/Bin Proximity Tracking
    if (this.navArrow) {
      this.navArrow.update(dt);
      if (this.dog && this.dog.isLost) {
        this.navArrow.setTarget(this.dog.x, this.dog.y, 'DOG', 'Find your dog!', '#f59e0b');
      }
    }

    // Proximity to poop piles (< 38px)
    let foundPoop = null;
    if (this.field && Array.isArray(this.field.poopPiles) && !this.hasPoopBag) {
      for (const pile of this.field.poopPiles) {
        const distToPile = Math.hypot(pile.x - this.owner.x, pile.y - this.owner.y);
        if (distToPile < 38) {
          foundPoop = pile;
          break;
        }
      }
    }
    this.activePoopPileNearPlayer = foundPoop;

    // Proximity to dog bins (< 42px)
    let foundBin = null;
    if (this.field && Array.isArray(this.field.bins) && this.hasPoopBag) {
      for (const bin of this.field.bins) {
        const distToBin = Math.hypot(bin.x - this.owner.x, bin.y - this.owner.y);
        if (distToBin < 42) {
          foundBin = bin;
          break;
        }
      }
    }
    this.activeBinNearPlayer = foundBin;

    // Dynamic Contextual Touch Sanitation Action
    if (this.touchControls) {
      if (this.activePoopPileNearPlayer) {
        this.touchControls.setContextualAction('pickup');
      } else if (this.activeBinNearPlayer && this.hasPoopBag) {
        this.touchControls.setContextualAction('dispose');
      } else {
        this.touchControls.setContextualAction(null);
      }
    }

    // Dynamically dim the leash button when the dog is out of clipping range
    if (typeof document !== 'undefined') {
      if (!this.leashBtn) {
        this.leashBtn = document.getElementById('btn-touch-leash');
      }
      if (this.leashBtn) {
        const dim = !this.owner.isLeashed && Math.hypot(this.dog.x - this.owner.x, this.dog.y - this.owner.y) > 68;
        this.leashBtn.style.opacity = dim ? '0.55' : '1.0';
      }
    }

    // 8. Update Camera
    this.camera.update(dt);
  }

  render() {
    if (!this.ctx) return;

    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const dpr = this.dpr || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Apply Camera translation and zoom
    this.camera.apply(this.ctx);

    // Gather all dynamic entities to depth-sort
    const dynamicEntities = [
      this.owner,
      this.dog,
      this.ball
    ];

    // for (const npc of this.npcs) {
    for (const npc of this.npcs.values()) {
      dynamicEntities.push(npc);
    }

    for (const p of this.remotePlayers.values()) {
      dynamicEntities.push(p.owner);
      dynamicEntities.push(p.dog);
    }

    // Field renders background turf, then Y-sorts trees, benches, owners, dogs, and balls
    this.field.render(this.ctx, this.camera, dynamicEntities);

    // In-World Contextual Interaction Badges
    const isTouch = typeof TouchControls !== 'undefined' && TouchControls.isTouchDevice && TouchControls.isTouchDevice();
    if (this.activePoopPileNearPlayer) {
      this.drawInteractionPrompt(
        this.ctx,
        this.activePoopPileNearPlayer.x,
        this.activePoopPileNearPlayer.y - 18,
        isTouch ? 'Tap 💩 to pick up' : 'Click to pick up waste'
      );
    } else if (this.activeBinNearPlayer && this.hasPoopBag) {
      this.drawInteractionPrompt(
        this.ctx,
        this.activeBinNearPlayer.x,
        this.activeBinNearPlayer.y - 28,
        isTouch ? 'Tap 🗑️ to dispose' : 'Click to dispose'
      );
    }

    // Restore Camera
    this.camera.restore(this.ctx);

    // Full-screen environment lighting pass and weather particles overlay
    if (this.environment) {
      const players = [this.owner, this.dog];
      for (const p of this.remotePlayers.values()) {
        players.push(p.owner, p.dog);
      }
      for (const npc of this.npcs.values()) {
        players.push(npc);
      }
      this.environment.render(this.ctx, this.camera, this.field, this.camera.viewportWidth, this.camera.viewportHeight, players);
    }

    // Screen-Space HUD: Directional Navigation Arrow
    if (this.navArrow && this.ctx && this.camera && this.owner) {
      this.navArrow.draw(this.ctx, this.camera, this.owner.x, this.owner.y);
    }

    // Zone Warp Crossfade Overlay (screen-space, reset transform)
    if (this.warpFadeAlpha > 0.01 && this.canvas && this.ctx) {
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.fillStyle = `rgba(11, 17, 23, ${this.warpFadeAlpha * 0.75})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  drawInteractionPrompt(ctx, worldX, worldY, text) {
    ctx.save();
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textMetrics = ctx.measureText(text);
    const badgeW = textMetrics.width + 16;
    const badgeH = 22;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;

    const r = badgeH / 2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(worldX - badgeW / 2, worldY - badgeH / 2, badgeW, badgeH, r);
    } else {
      ctx.rect(worldX - badgeW / 2, worldY - badgeH / 2, badgeW, badgeH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, worldX, worldY + 0.5);
    ctx.restore();
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
