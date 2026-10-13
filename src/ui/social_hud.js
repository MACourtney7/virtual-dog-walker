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
    this.proximityChat = null;

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
            <span style="font-weight: 700; color: #f8fafc;">The Downs</span>
            <span class="hud-pill-badge" id="hud-mode-badge">Solo</span>
          </div>
          <div class="hud-pill" id="hud-player-count">
            <span>🐾 1</span>
          </div>
        </div>
        <button id="btn-customize" class="style-toggle-btn" aria-label="Customize Style" title="Customize Style">
          <span class="style-toggle-icon">⚙️</span>
        </button>
      `;
    }

    // 2. Build Controls Guidance (Retired bottom toolbar)
    if (this.controlsHint) {
      this.controlsHint.innerHTML = '';
      this.controlsHint.style.display = 'none';
    }

    // 3. Build Chat Input Bar (without quick emotes)
    const chatBar = document.createElement('div');
    chatBar.id = 'chat-container';
    chatBar.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" id="chat-input" placeholder="Say something in the park... (Enter to send)" maxlength="60" autocomplete="off" />
      </div>
    `;
    this.container.appendChild(chatBar);

    // 4. Build Customizer Modal
    const modal = document.createElement('div');
    modal.id = 'customizer-modal';
    modal.innerHTML = `
      <div class="customizer-header">
        <h3>Style Customizer</h3>
        <button class="customizer-close" id="close-modal" aria-label="Close">&times;</button>
      </div>

      <!-- Tab Navigation -->
      <div class="customizer-tabs">
        <button class="customizer-tab-btn active" id="tab-btn-walker" data-tab="cust-tab-walker">👤 Walker</button>
        <button class="customizer-tab-btn" id="tab-btn-dog" data-tab="cust-tab-dog">🐕 Dog Companion</button>
      </div>

      <!-- Tab 1: Walker -->
      <div class="customizer-tab-pane active" id="cust-tab-walker">
        <div class="cust-form-group">
          <label class="cust-label" for="cust-name">Walker Name</label>
          <input type="text" id="cust-name" class="cust-input" value="${this.owner.name || 'Walker'}" maxlength="14" autocomplete="off" />
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Skin Tone</label>
          <div class="cust-palette" id="skin-palette">
            <div class="color-swatch" data-palette="skinTone" data-color="#fed7aa" style="background: #fed7aa;" title="Light Peach"></div>
            <div class="color-swatch" data-palette="skinTone" data-color="#fcd34d" style="background: #fcd34d;" title="Warm Gold"></div>
            <div class="color-swatch" data-palette="skinTone" data-color="#d97706" style="background: #d97706;" title="Honey Tan"></div>
            <div class="color-swatch" data-palette="skinTone" data-color="#92400e" style="background: #92400e;" title="Warm Chestnut"></div>
            <div class="color-swatch" data-palette="skinTone" data-color="#7c2d12" style="background: #7c2d12;" title="Deep Espresso"></div>
          </div>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Hair Style</label>
          <div class="cust-btn-group" id="hair-style-group">
            <button class="cust-style-btn active" data-style="SHORT">Short</button>
            <button class="cust-style-btn" data-style="WAVY">Wavy</button>
            <button class="cust-style-btn" data-style="PONYTAIL">Ponytail</button>
            <button class="cust-style-btn" data-style="BEANIE">Beanie</button>
          </div>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Hair Color</label>
          <div class="cust-palette" id="hair-palette">
            <div class="color-swatch" data-palette="hairColor" data-color="#451a03" style="background: #451a03;" title="Brown"></div>
            <div class="color-swatch" data-palette="hairColor" data-color="#eab308" style="background: #eab308;" title="Blonde"></div>
            <div class="color-swatch" data-palette="hairColor" data-color="#171717" style="background: #171717;" title="Black"></div>
            <div class="color-swatch" data-palette="hairColor" data-color="#9a3412" style="background: #9a3412;" title="Auburn"></div>
            <div class="color-swatch" data-palette="hairColor" data-color="#94a3b8" style="background: #94a3b8;" title="Silver"></div>
          </div>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Jacket Color</label>
          <div class="cust-palette" id="jacket-palette">
            <div class="color-swatch" data-palette="jacketColor" data-color="#1e3a8a" style="background: #1e3a8a;" title="Navy"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#14532d" style="background: #14532d;" title="Forest"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#831843" style="background: #831843;" title="Crimson"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#b45309" style="background: #b45309;" title="Amber"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#334155" style="background: #334155;" title="Slate"></div>
            <div class="color-swatch" data-palette="jacketColor" data-color="#d97706" style="background: #d97706;" title="Ochre"></div>
          </div>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Pants Color</label>
          <div class="cust-palette" id="pants-palette">
            <div class="color-swatch" data-palette="pantsColor" data-color="#1e293b" style="background: #1e293b;" title="Denim"></div>
            <div class="color-swatch" data-palette="pantsColor" data-color="#78350f" style="background: #78350f;" title="Tan"></div>
            <div class="color-swatch" data-palette="pantsColor" data-color="#365314" style="background: #365314;" title="Olive"></div>
            <div class="color-swatch" data-palette="pantsColor" data-color="#1f2937" style="background: #1f2937;" title="Dark Slate"></div>
          </div>
        </div>
      </div>

      <!-- Tab 2: Dog Companion -->
      <div class="customizer-tab-pane" id="cust-tab-dog">
        <div class="cust-form-group">
          <label class="cust-label" for="cust-dog-coat">Dog Breed / Coat</label>
          <select id="cust-dog-coat" class="cust-select">
            <option value="CHOCOLATE_TAN">Ziggy (Chocolate & Tan Cocker)</option>
            <option value="GOLDEN">Golden Retriever</option>
            <option value="BLACK_LAB">Black Lab</option>
            <option value="JACK_RUSSELL">Jack Russell Terrier</option>
            <option value="RED_SETTER">Irish Red Setter</option>
          </select>
        </div>

        <div class="cust-form-group">
          <label class="cust-label">Collar Color</label>
          <div class="cust-palette" id="collar-palette">
            <div class="color-swatch" data-palette="collarColor" data-color="#0d9488" style="background: #0d9488;" title="Teal"></div>
            <div class="color-swatch" data-palette="collarColor" data-color="#dc2626" style="background: #dc2626;" title="Red"></div>
            <div class="color-swatch" data-palette="collarColor" data-color="#2563eb" style="background: #2563eb;" title="Blue"></div>
            <div class="color-swatch" data-palette="collarColor" data-color="#eab308" style="background: #eab308;" title="Gold"></div>
            <div class="color-swatch" data-palette="collarColor" data-color="#7c3aed" style="background: #7c3aed;" title="Purple"></div>
          </div>
        </div>

        <!-- Canine Personality Editor (1-5 Traits) -->
        <div class="cust-form-group cust-personality-group">
          <label class="cust-label" style="margin-bottom: 8px;">Canine Personality Traits</label>
          
          <div class="cust-trait-row">
            <div class="cust-trait-header">
              <label class="cust-trait-label" for="cust-personality-playfulness">🎾 Playfulness</label>
              <span class="cust-trait-badge" id="val-personality-playfulness">3</span>
            </div>
            <input type="range" min="1" max="5" step="1" value="3" class="cust-range" id="cust-personality-playfulness" />
          </div>

          <div class="cust-trait-row">
            <div class="cust-trait-header">
              <label class="cust-trait-label" for="cust-personality-shyness">🙈 Shyness</label>
              <span class="cust-trait-badge" id="val-personality-shyness">2</span>
            </div>
            <input type="range" min="1" max="5" step="1" value="2" class="cust-range" id="cust-personality-shyness" />
          </div>

          <div class="cust-trait-row">
            <div class="cust-trait-header">
              <label class="cust-trait-label" for="cust-personality-barkyness">🗣️ Barkyness</label>
              <span class="cust-trait-badge" id="val-personality-barkyness">2</span>
            </div>
            <input type="range" min="1" max="5" step="1" value="2" class="cust-range" id="cust-personality-barkyness" />
          </div>

          <div class="cust-trait-row">
            <div class="cust-trait-header">
              <label class="cust-trait-label" for="cust-personality-obedience">🎓 Obedience</label>
              <span class="cust-trait-badge" id="val-personality-obedience">4</span>
            </div>
            <input type="range" min="1" max="5" step="1" value="4" class="cust-range" id="cust-personality-obedience" />
          </div>
        </div>
      </div>

      <button id="btn-save-cust" class="btn-primary-cust">Save & Walk</button>
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

    // Load saved profile from localStorage if available
    this.loadSavedProfile();

    this.bindEvents();
  }

  loadSavedProfile() {
    if (typeof localStorage === 'undefined') return;
    try {
      const savedStr = localStorage.getItem('clifton_walker_profile');
      if (!savedStr) {
        // Initialize default personality if not present on dog
        if (this.dog) {
          if (!this.dog.personality) {
            this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
          }
        }
        this.updateModalActiveSelections();
        return;
      }
      const saved = JSON.parse(savedStr);
      if (!saved || typeof saved !== 'object') {
        if (this.dog && !this.dog.personality) {
          this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
        }
        this.updateModalActiveSelections();
        return;
      }

      // 1. Walker attributes (with fallback defaults)
      if (saved.name) {
        this.owner.name = saved.name;
        const nameInput = document.getElementById('cust-name');
        if (nameInput) nameInput.value = saved.name;
      }
      if (saved.skinTone) {
        this.owner.skinTone = saved.skinTone;
      }
      if (saved.hairStyle) {
        this.owner.hairStyle = saved.hairStyle;
      }
      if (saved.hairColor) {
        this.owner.hairColor = saved.hairColor;
      }
      if (saved.jacketColor) {
        this.owner.jacketColor = saved.jacketColor;
      }
      if (saved.pantsColor) {
        this.owner.pantsColor = saved.pantsColor;
      }

      // 2. Dog companion attributes (with fallback defaults)
      if (saved.coatKey && this.coatPresets && this.coatPresets[saved.coatKey]) {
        this.dog.coat = this.coatPresets[saved.coatKey];
        const coatSelect = document.getElementById('cust-dog-coat');
        if (coatSelect) coatSelect.value = saved.coatKey;
      }
      if (saved.collarColor) {
        this.dog.collarColor = saved.collarColor;
      }

      // 3. Canine Personality attributes (with fallback defaults)
      const personalityDefaults = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
      if (this.dog) {
        const loadedPersonality = saved.personality && typeof saved.personality === 'object'
          ? {
              playfulness: parseInt(saved.personality.playfulness, 10) || personalityDefaults.playfulness,
              shyness: parseInt(saved.personality.shyness, 10) || personalityDefaults.shyness,
              barkyness: parseInt(saved.personality.barkyness, 10) || personalityDefaults.barkyness,
              obedience: parseInt(saved.personality.obedience, 10) || personalityDefaults.obedience
            }
          : { ...personalityDefaults };

        if (typeof this.dog.setPersonality === 'function') {
          this.dog.setPersonality(loadedPersonality);
        } else {
          this.dog.personality = loadedPersonality;
        }
      }

      this.updateModalActiveSelections();

      if (this.net && typeof this.net.setLocalMeta === 'function') {
        const personality = this.dog && this.dog.personality ? this.dog.personality : personalityDefaults;
        this.net.setLocalMeta({
          name: this.owner.name,
          jacketColor: this.owner.jacketColor,
          coatName: this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
          hairStyle: this.owner.hairStyle,
          hairColor: this.owner.hairColor,
          pantsColor: this.owner.pantsColor,
          skinTone: this.owner.skinTone,
          collarColor: this.dog.collarColor,
          personality
        });
      }
    } catch (e) {
      console.warn('Could not load saved walker profile from localStorage:', e);
      if (this.dog && !this.dog.personality) {
        this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
      }
      this.updateModalActiveSelections();
    }
  }

  updateModalActiveSelections() {
    // Update swatch active classes
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
      const palette = swatch.getAttribute('data-palette');
      const color = swatch.getAttribute('data-color');
      let matches = false;

      if (palette === 'skinTone' && this.owner.skinTone === color) matches = true;
      else if (palette === 'hairColor' && this.owner.hairColor === color) matches = true;
      else if (palette === 'jacketColor' && this.owner.jacketColor === color) matches = true;
      else if (palette === 'pantsColor' && this.owner.pantsColor === color) matches = true;
      else if (palette === 'collarColor' && this.dog.collarColor === color) matches = true;

      if (matches) {
        swatch.classList.add('active');
        swatch.style.border = '2px solid #fff';
      } else {
        swatch.classList.remove('active');
        swatch.style.border = '2px solid transparent';
      }
    });

    // Update hair style buttons
    const styleBtns = document.querySelectorAll('.cust-style-btn');
    styleBtns.forEach(btn => {
      if (btn.getAttribute('data-style') === (this.owner.hairStyle || 'SHORT')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update dog coat select
    const coatSelect = document.getElementById('cust-dog-coat');
    if (coatSelect && this.dog.coat) {
      for (const [key, preset] of Object.entries(this.coatPresets || {})) {
        if (preset === this.dog.coat || preset.name === this.dog.coat.name) {
          coatSelect.value = key;
          break;
        }
      }
    }

    // Update personality sliders and badges
    const personality = (this.dog && this.dog.personality)
      ? this.dog.personality
      : { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };

    const traits = ['playfulness', 'shyness', 'barkyness', 'obedience'];
    traits.forEach(trait => {
      const slider = document.getElementById(`cust-personality-${trait}`);
      const badge = document.getElementById(`val-personality-${trait}`);
      const val = personality[trait] !== undefined ? personality[trait] : 3;
      if (slider) slider.value = val;
      if (badge) badge.textContent = val;
    });
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

  openModal() {
    const modal = document.getElementById('customizer-modal');
    if (!modal) return;
    this.updateModalActiveSelections();
    modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
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

    if (btnCustomize) {
      btnCustomize.addEventListener('click', () => {
        this.openModal();
      });
    }

    if (closeModal && modal) {
      closeModal.addEventListener('click', () => { modal.style.display = 'none'; });
    }

    // Tab navigation switching
    const tabBtns = document.querySelectorAll('.customizer-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetTabId = btn.getAttribute('data-tab');
        document.querySelectorAll('.customizer-tab-pane').forEach(pane => {
          pane.classList.remove('active');
        });
        const targetPane = document.getElementById(targetTabId);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // Hair Style selector buttons
    const hairStyleBtns = document.querySelectorAll('.cust-style-btn');
    hairStyleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        hairStyleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.owner.hairStyle = btn.getAttribute('data-style');
      });
    });

    // Palette swatches selection
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        const palette = swatch.getAttribute('data-palette');
        const color = swatch.getAttribute('data-color');

        // Deactivate sibling swatches in the same palette
        const siblings = swatch.parentElement.querySelectorAll('.color-swatch');
        siblings.forEach(s => {
          s.classList.remove('active');
          s.style.border = '2px solid transparent';
        });

        swatch.classList.add('active');
        swatch.style.border = '2px solid #fff';

        // Apply immediately to local avatar for live preview
        if (palette === 'skinTone') this.owner.skinTone = color;
        else if (palette === 'hairColor') this.owner.hairColor = color;
        else if (palette === 'jacketColor') this.owner.jacketColor = color;
        else if (palette === 'pantsColor') this.owner.pantsColor = color;
        else if (palette === 'collarColor') this.dog.collarColor = color;
      });
    });

    // Canine Personality slider event wiring
    const traits = ['playfulness', 'shyness', 'barkyness', 'obedience'];
    traits.forEach(trait => {
      const slider = document.getElementById(`cust-personality-${trait}`);
      const badge = document.getElementById(`val-personality-${trait}`);
      if (slider) {
        slider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          if (badge) badge.textContent = val;
          if (this.dog) {
            if (!this.dog.personality) {
              this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
            }
            if (typeof this.dog.setPersonality === 'function') {
              this.dog.setPersonality({ [trait]: val });
            } else {
              this.dog.personality[trait] = val;
            }
          }
        });
      }
    });

    // Save & Walk button
    if (btnSaveCust && modal) {
      btnSaveCust.addEventListener('click', () => {
        const nameInput = document.getElementById('cust-name');
        if (nameInput && nameInput.value.trim()) {
          this.owner.name = nameInput.value.trim();
        }

        const coatSelect = document.getElementById('cust-dog-coat');
        let coatKey = 'CHOCOLATE_TAN';
        if (coatSelect && this.coatPresets && this.coatPresets[coatSelect.value]) {
          coatKey = coatSelect.value;
          this.dog.coat = this.coatPresets[coatSelect.value];
        }

        // Current personality configuration
        const personality = {
          playfulness: parseInt(document.getElementById('cust-personality-playfulness')?.value || (this.dog?.personality?.playfulness ?? 3), 10),
          shyness: parseInt(document.getElementById('cust-personality-shyness')?.value || (this.dog?.personality?.shyness ?? 2), 10),
          barkyness: parseInt(document.getElementById('cust-personality-barkyness')?.value || (this.dog?.personality?.barkyness ?? 2), 10),
          obedience: parseInt(document.getElementById('cust-personality-obedience')?.value || (this.dog?.personality?.obedience ?? 4), 10)
        };

        if (this.dog) {
          if (typeof this.dog.setPersonality === 'function') {
            this.dog.setPersonality(personality);
          } else {
            this.dog.personality = personality;
          }
        }

        // Save updated profile to localStorage
        if (typeof localStorage !== 'undefined') {
          try {
            const profileToSave = {
              name: this.owner.name,
              skinTone: this.owner.skinTone,
              hairStyle: this.owner.hairStyle,
              hairColor: this.owner.hairColor,
              jacketColor: this.owner.jacketColor,
              pantsColor: this.owner.pantsColor,
              coatKey: coatSelect ? coatSelect.value : coatKey,
              collarColor: this.dog.collarColor,
              personality: personality
            };
            localStorage.setItem('clifton_walker_profile', JSON.stringify(profileToSave));
          } catch (e) {
            console.warn('Could not save walker profile to localStorage:', e);
          }
        }

        if (this.net && typeof this.net.setLocalMeta === 'function') {
          const extraMeta = {
            hairStyle: this.owner.hairStyle,
            hairColor: this.owner.hairColor,
            pantsColor: this.owner.pantsColor,
            skinTone: this.owner.skinTone,
            collarColor: this.dog.collarColor,
            personality: personality
          };

          this.net.setLocalMeta({
            name: this.owner.name,
            jacketColor: this.owner.jacketColor,
            coatName: this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
            ...extraMeta
          });

          this.net.broadcast(Protocol.createHello(
            this.net.peerId,
            this.owner.name,
            this.owner.jacketColor,
            this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan (Ziggy)',
            extraMeta
          ));
        }

        modal.style.display = 'none';
        this.showToast('✨ Appearance updated!');
      });
    }

    // 3. Quick Emote buttons (guarded)
    const emoteBtns = document.querySelectorAll('.emote-btn');
    if (emoteBtns && emoteBtns.length > 0) {
      emoteBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const emote = btn.getAttribute('data-emote');
          this.owner.setEmote(emote);
          this.net.broadcast({ type: 'EMOTE', senderId: this.net.peerId, emote });
          const chatContainer = document.getElementById('chat-container');
          if (chatContainer) chatContainer.style.display = 'none';
        });
      });
    }

    // 4. Chat Input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const text = chatInput.value.trim();
          if (text) {
            if (this.proximityChat && this.proximityChat.isClusterActive()) {
              this.proximityChat.submitMessage(text);
            } else {
              this.owner.setChat(text);
              this.net.broadcast({ type: 'CHAT_MESSAGE', senderId: this.net.peerId, text });
            }
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
          badge.textContent = 'Online';
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
