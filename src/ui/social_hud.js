// Social HUD Component - Room Status, One-Click Share, Chat Input, and Character Customizer
import { Protocol } from '../net/protocol.js';
import { TouchControls } from './touch_controls.js';
import { WSStatus } from '../net/ws_network.js';
import { NetStatus } from '../net/network.js';

export class SocialHUD {
  constructor(networkManager, localOwner, localDog, coatPresets) {
    this.net = networkManager;
    this.owner = localOwner;
    this.dog = localDog;
    this.coatPresets = coatPresets;

    this.container = document.getElementById('game-container');
    this.hudOverlay = document.getElementById('hud-overlay');
    this.controlsHint = document.getElementById('controls-hint');

    this.toastTimer = null;
    this.initHUD();
  }

  initHUD() {
    // 1. Build Glassmorphic Top Overlay
    if (this.hudOverlay) {
      this.hudOverlay.innerHTML = `
        <div class="hud-panel">
          <div class="hud-pill">
            <span style="font-size: 1.2rem;">🌳</span>
            <span style="font-weight: 700; color: #f8fafc;">Clifton Down</span>
            <span class="hud-pill-badge" id="hud-mode-badge">Solo</span>
          </div>
          <div class="hud-pill" id="hud-player-count">
            <span>🐾 1</span>
          </div>
        </div>

        <div class="hud-panel">
          <button class="btn-share" id="btn-room-action">
            <span>🔗</span>
            <span id="btn-room-label">Share Park</span>
          </button>
          <button class="btn-share" id="btn-customize" style="background: rgba(255, 255, 255, 0.12);">
            <span>🎨</span>
            <span>Style</span>
          </button>
        </div>
      `;
    }

    // 2. Build Controls Guidance
    if (this.controlsHint) {
      if (TouchControls.isTouchDevice()) {
        this.controlsHint.style.display = 'none';
      } else {
        this.controlsHint.innerHTML = `
          <kbd>WASD</kbd> Walk &bull; 
          <kbd>SPACE</kbd> Throw Ball &bull; 
          <kbd>L</kbd> Leash &bull; 
          <kbd>B</kbd> Bark &bull; 
          <kbd>E</kbd> Pet &bull; 
          <kbd>ENTER</kbd> Chat
        `;
      }
    }

    // 3. Build Chat Input Bar & Emotes
    const chatBar = document.createElement('div');
    chatBar.id = 'chat-container';
    chatBar.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" id="chat-input" placeholder="Say something in the park... (Enter to send)" maxlength="60" autocomplete="off" />
        <div id="quick-emotes" style="display: flex; gap: 4px;">
          <button class="emote-btn" data-emote="👋" style="background: rgba(15,23,42,0.85); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 4px 8px; cursor: pointer; font-size: 1.1rem;">👋</button>
          <button class="emote-btn" data-emote="🐾" style="background: rgba(15,23,42,0.85); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 4px 8px; cursor: pointer; font-size: 1.1rem;">🐾</button>
          <button class="emote-btn" data-emote="❤️" style="background: rgba(15,23,42,0.85); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 4px 8px; cursor: pointer; font-size: 1.1rem;">❤️</button>
          <button class="emote-btn" data-emote="🎾" style="background: rgba(15,23,42,0.85); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 4px 8px; cursor: pointer; font-size: 1.1rem;">🎾</button>
        </div>
      </div>
    `;
    this.container.appendChild(chatBar);

    // 4. Build Customizer Modal
    const modal = document.createElement('div');
    modal.id = 'customizer-modal';
    modal.style.cssText = `
      display: none;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 16px;
      padding: 24px;
      color: #f8fafc;
      width: 320px;
      z-index: 100;
      box-shadow: 0 16px 40px rgba(0,0,0,0.6);
    `;
    modal.innerHTML = `
      <h3 style="margin-bottom: 16px; font-weight: 700; display: flex; justify-content: space-between; align-items: center;">
        <span>Park Walker Style</span>
        <span id="close-modal" style="cursor: pointer; opacity: 0.7;">&times;</span>
      </h3>
      <div style="margin-bottom: 14px;">
        <label style="font-size: 0.85rem; color: #94a3b8; display: block; margin-bottom: 6px;">Walker Name</label>
        <input type="text" id="cust-name" value="${this.owner.name}" maxlength="14" style="width: 100%; padding: 8px 12px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #fff; font-family: inherit;" />
      </div>
      <div style="margin-bottom: 14px;">
        <label style="font-size: 0.85rem; color: #94a3b8; display: block; margin-bottom: 6px;">Jacket Color</label>
        <div style="display: flex; gap: 8px;" id="jacket-palette">
          <div class="color-swatch" data-color="#1e3a8a" style="width: 28px; height: 28px; border-radius: 50%; background: #1e3a8a; cursor: pointer; border: 2px solid #fff;"></div>
          <div class="color-swatch" data-color="#14532d" style="width: 28px; height: 28px; border-radius: 50%; background: #14532d; cursor: pointer;"></div>
          <div class="color-swatch" data-color="#831843" style="width: 28px; height: 28px; border-radius: 50%; background: #831843; cursor: pointer;"></div>
          <div class="color-swatch" data-color="#b45309" style="width: 28px; height: 28px; border-radius: 50%; background: #b45309; cursor: pointer;"></div>
          <div class="color-swatch" data-color="#334155" style="width: 28px; height: 28px; border-radius: 50%; background: #334155; cursor: pointer;"></div>
        </div>
      </div>
      <div style="margin-bottom: 18px;">
        <label style="font-size: 0.85rem; color: #94a3b8; display: block; margin-bottom: 6px;">Dog Breed / Coat</label>
        <select id="cust-dog-coat" style="width: 100%; padding: 8px 12px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #fff; font-family: inherit;">
          <option value="CHOCOLATE_TAN">Ziggy (Chocolate & Tan Cocker)</option>
          <option value="GOLDEN">Golden Retriever</option>
          <option value="BLACK_LAB">Black Lab</option>
        </select>
      </div>
      <button id="btn-save-cust" style="width: 100%; padding: 10px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">Save & Walk</button>
    `;
    this.container.appendChild(modal);

    // Toast Container
    const toast = document.createElement('div');
    toast.id = 'hud-toast';
    toast.style.cssText = `
      position: absolute;
      top: 76px;
      left: 50%;
      transform: translateX(-50%);
      background: #059669;
      color: #fff;
      padding: 8px 20px;
      border-radius: 20px;
      font-weight: 600;
      font-size: 0.9rem;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      display: none;
      z-index: 200;
    `;
    this.container.appendChild(toast);

    this.bindEvents();
  }

  showToast(text) {
    const toast = document.getElementById('hud-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.style.display = 'block';

    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
  }

  bindEvents() {
    // 1. Room Button action
    const btnRoomAction = document.getElementById('btn-room-action');
    if (btnRoomAction) {
      btnRoomAction.addEventListener('click', () => {
        if (!this.net.roomId) {
          // In Solo mode: Host room
          this.net.hostRoom();
        } else {
          // In Hosted or Joined mode: Copy Share Link
          const shareUrl = this.net.getShareUrl();
          navigator.clipboard.writeText(shareUrl).then(() => {
            this.showToast('📋 Field link copied! Send to friends to join.');
          }).catch(() => {
            prompt('Copy field link:', shareUrl);
          });
        }
      });
    }

    // 2. Customizer modal toggle
    const btnCustomize = document.getElementById('btn-customize');
    const modal = document.getElementById('customizer-modal');
    const closeModal = document.getElementById('close-modal');
    const btnSaveCust = document.getElementById('btn-save-cust');

    if (btnCustomize && modal) {
      btnCustomize.addEventListener('click', () => {
        modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
      });
    }

    if (closeModal && modal) {
      closeModal.addEventListener('click', () => { modal.style.display = 'none'; });
    }

    // Swatches
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        swatches.forEach(s => s.style.border = 'none');
        swatch.style.border = '2px solid #fff';
        this.owner.jacketColor = swatch.getAttribute('data-color');
      });
    });

    if (btnSaveCust && modal) {
      btnSaveCust.addEventListener('click', () => {
        const nameInput = document.getElementById('cust-name');
        if (nameInput && nameInput.value.trim()) {
          this.owner.name = nameInput.value.trim();
        }

        const coatSelect = document.getElementById('cust-dog-coat');
        if (coatSelect && this.coatPresets[coatSelect.value]) {
          this.dog.coat = this.coatPresets[coatSelect.value];
        }

        if (this.net && typeof this.net.setLocalMeta === 'function') {
          this.net.setLocalMeta({
            name: this.owner.name,
            jacketColor: this.owner.jacketColor,
            coatName: this.dog.coat.name
          });
          this.net.broadcast(Protocol.createHello(
            this.net.peerId,
            this.owner.name,
            this.owner.jacketColor,
            this.dog.coat.name
          ));
        }

        modal.style.display = 'none';
        this.showToast('✨ Appearance updated!');
      });
    }

    // 3. Quick Emote buttons
    const emoteBtns = document.querySelectorAll('.emote-btn');
    emoteBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const emote = btn.getAttribute('data-emote');
        this.owner.setEmote(emote);
        this.net.broadcast({ type: 'EMOTE', senderId: this.net.peerId, emote });
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) chatContainer.style.display = 'none';
      });
    });

    // 4. Chat Input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const text = chatInput.value.trim();
          if (text) {
            this.owner.setChat(text);
            this.net.broadcast({ type: 'CHAT_MESSAGE', senderId: this.net.peerId, text });
            chatInput.value = '';
          }
          const chatContainer = document.getElementById('chat-container');
          if (chatContainer) chatContainer.style.display = 'none';
        } else if (e.key === 'Escape') {
          const chatContainer = document.getElementById('chat-container');
          if (chatContainer) chatContainer.style.display = 'none';
        }
      });
    }
  }

  updatePlayerCount(count) {
    const pill = document.getElementById('hud-player-count');
    if (pill) {
      pill.innerHTML = `<span>🐾 ${count}</span>`;
    }
  }

  updateNetworkState(status, message) {
    const badge = document.getElementById('hud-mode-badge');
    const label = document.getElementById('btn-room-label');

    if (status === WSStatus.CONNECTED || status === NetStatus.CONNECTED_PEER || status === NetStatus.HOSTING) {
      const isCommons = !this.net.roomId || this.net.roomId === 'the-commons' || this.net.roomId === 'clifton-field';
      if (badge) {
        if (isCommons) {
          badge.textContent = '🌳 Clifton Commons';
          badge.style.background = '#059669';
        } else {
          badge.textContent = `🔒 Meadow (${this.net.roomId})`;
          badge.style.background = '#8b5cf6';
        }
      }
      if (label) {
        label.textContent = isCommons ? 'Share Park' : 'Share Link';
      }
    } else if (status === WSStatus.CONNECTING || status === NetStatus.CONNECTING) {
      if (badge) {
        badge.textContent = '⏳ Connecting...';
        badge.style.background = '#d97706';
      }
      if (label) {
        label.textContent = 'Connecting...';
      }
    } else if (status === WSStatus.RECONNECTING) {
      if (badge) {
        badge.textContent = '🔄 Reconnecting...';
        badge.style.background = '#d97706';
      }
      if (label) {
        label.textContent = 'Connecting...';
      }
    } else if (status === WSStatus.OFFLINE || status === WSStatus.ERROR || status === NetStatus.OFFLINE || status === NetStatus.ERROR) {
      if (badge) {
        badge.textContent = 'Solo (Offline)';
        badge.style.background = '#64748b';
      }
      if (label) {
        label.textContent = 'Host Field';
      }
    } else {
      if (badge) {
        badge.textContent = 'Solo (Offline)';
        badge.style.background = '#64748b';
      }
      if (label) {
        label.textContent = 'Host Field';
      }
    }
  }

  toggleChatInput() {
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    if (!chatContainer || !chatInput) return;

    if (chatContainer.style.display === 'block') {
      chatContainer.style.display = 'none';
      chatInput.blur();
    } else {
      chatContainer.style.display = 'block';
      chatInput.focus();
    }
  }
}
