// Social HUD Component - Room Status, One-Click Share, Chat Input, and Character Customizer
import { Protocol } from '../net/protocol.js';
import { TouchControls } from './touch_controls.js';
import { WSStatus } from '../net/network.js';
import { NetStatus } from '../net/network.js';
import { PUBLIC_ZONE_IDS, isPublicZoneId } from '../world/zones.js';

export class SocialHUD {
  constructor(networkManager, localOwner, localDog, coatPresets) {
    this.net = networkManager;
    this.owner = localOwner;
    this.dog = localDog;
    this.coatPresets = coatPresets;
    this.proximityChat = null;

    // Single-slot immutable kennel state
    this.dogSlot = null;
    this.isHomeLocked = false;

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
            <span id="hud-title" class="hud-title" style="font-weight: 700; color: #f8fafc;">🌳 The Downs</span>
            <span class="hud-pill-badge" id="hud-mode-badge">Solo</span>
          </div>
          <div class="hud-pill" id="hud-player-count">
            <span>🐾 1</span>
          </div>
        </div>
        <button id="btn-customize" class="style-toggle-btn" aria-label="Home" title="Home">
          <span class="style-toggle-icon">🏠</span>
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
        <h3>Home</h3>
        <button class="customizer-close" id="close-modal" aria-label="Close">&times;</button>
      </div>

      <!-- Top Stylized Stage Preview -->
      <div class="home-stage-preview">
        <canvas id="home-stage-canvas" width="340" height="140"></canvas>
      </div>

      <!-- Tab Navigation -->
      <div class="customizer-tabs">
        <button class="customizer-tab-btn active" id="tab-btn-walker" data-tab="cust-tab-walker">👤 You</button>
        <button class="customizer-tab-btn" id="tab-btn-dog" data-tab="cust-tab-dog">🐕 Dogs</button>
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

        <div class="cust-form-group">
          <label class="cust-label">Accessory</label>
          <div class="cust-btn-group" id="accessory-options">
            <button class="accessory-btn active" data-accessory="NONE">None</button>
            <button class="accessory-btn" data-accessory="BACKPACK">Backpack</button>
            <button class="accessory-btn" data-accessory="SCARF">Scarf</button>
            <button class="accessory-btn" data-accessory="HOODIE">Hoodie</button>
          </div>
        </div>
      </div>

      <!-- Tab 2: Dogs (Single-Slot Immutable Kennel) -->
      <div class="customizer-tab-pane" id="cust-tab-dog">
        <div id="dog-slot-container"></div>
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

  getBreedLabel(coatKey) {
    const labels = {
      CHOCOLATE_TAN: 'Chocolate & Tan Cocker Spaniel',
      GOLDEN: 'Golden Retriever',
      BLACK_LAB: 'Black Labrador',
      JACK_RUSSELL: 'Jack Russell Terrier',
      RED_SETTER: 'Irish Red Setter'
    };
    return labels[coatKey] || 'Chocolate & Tan Cocker Spaniel';
  }

  renderDogSlot() {
    const container = document.getElementById('dog-slot-container');
    if (!container) return;

    if (this.dogSlot) {
      // Occupied: read-only card
      const p = this.dogSlot.personality || { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
      container.innerHTML = `
        <div class="dog-slot-card" id="dog-slot-occupied">
          <div class="dog-slot-header">
            <span class="dog-slot-name">🐕 ${this.dogSlot.name}</span>
            <span class="dog-slot-collar" style="background: ${this.dogSlot.collarColor};" title="Collar color"></span>
          </div>
          <div class="dog-slot-breed">${this.getBreedLabel(this.dogSlot.coatKey)}</div>
          <div class="dog-slot-traits">
            <div class="dog-slot-trait"><span>🎾 Playfulness</span><strong>${p.playfulness}</strong></div>
            <div class="dog-slot-trait"><span>🙈 Shyness</span><strong>${p.shyness}</strong></div>
            <div class="dog-slot-trait"><span>🗣️ Barkyness</span><strong>${p.barkyness}</strong></div>
            <div class="dog-slot-trait"><span>🎓 Obedience</span><strong>${p.obedience}</strong></div>
          </div>
          <button id="btn-remove-dog" class="btn-remove-dog">Remove Dog</button>
        </div>
      `;
      const removeBtn = document.getElementById('btn-remove-dog');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          this.dogSlot = null;
          this.isHomeLocked = true;
          this.renderDogSlot();
          this.renderHomeStage();
          this.updateCloseButtonState();
        });
      }
    } else {
      // Empty: creation form pre-filled with Ziggy defaults
      container.innerHTML = `
        <div class="dog-slot-card" id="dog-slot-empty">
          <div class="cust-form-group">
            <label class="cust-label" for="cust-dog-name">Dog Name</label>
            <input type="text" id="cust-dog-name" class="cust-input" value="Ziggy" maxlength="14" autocomplete="off" />
          </div>

          <div class="cust-form-group">
            <label class="cust-label" for="cust-dog-coat">Dog Breed / Coat</label>
            <select id="cust-dog-coat" class="cust-select">
              <option value="CHOCOLATE_TAN" selected>Chocolate & Tan Cocker Spaniel</option>
              <option value="GOLDEN">Golden Retriever</option>
              <option value="BLACK_LAB">Black Labrador</option>
              <option value="JACK_RUSSELL">Jack Russell Terrier</option>
              <option value="RED_SETTER">Irish Red Setter</option>
            </select>
          </div>

          <div class="cust-form-group">
            <label class="cust-label">Collar Color</label>
            <div class="cust-palette" id="collar-palette">
              <div class="color-swatch active" data-palette="collarColor" data-color="#0d9488" style="background: #0d9488; border: 2px solid #fff;" title="Teal"></div>
              <div class="color-swatch" data-palette="collarColor" data-color="#dc2626" style="background: #dc2626;" title="Red"></div>
              <div class="color-swatch" data-palette="collarColor" data-color="#2563eb" style="background: #2563eb;" title="Blue"></div>
              <div class="color-swatch" data-palette="collarColor" data-color="#eab308" style="background: #eab308;" title="Gold"></div>
              <div class="color-swatch" data-palette="collarColor" data-color="#7c3aed" style="background: #7c3aed;" title="Purple"></div>
            </div>
          </div>

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

          <button id="btn-add-dog" class="btn-primary-cust">Adopt Dog</button>
        </div>
      `;

      // Wire collar swatches
      const swatches = container.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
          swatches.forEach(s => {
            s.classList.remove('active');
            s.style.border = '2px solid transparent';
          });
          swatch.classList.add('active');
          swatch.style.border = '2px solid #fff';
          this.renderHomeStage();
        });
      });

      // Wire personality sliders
      ['playfulness', 'shyness', 'barkyness', 'obedience'].forEach(trait => {
        const slider = document.getElementById(`cust-personality-${trait}`);
        const badge = document.getElementById(`val-personality-${trait}`);
        if (slider) {
          slider.addEventListener('input', (e) => {
            if (badge) badge.textContent = e.target.value;
            this.renderHomeStage();
          });
        }
      });

      // Wire breed select + name input to refresh preview
      const coatSelect = document.getElementById('cust-dog-coat');
      if (coatSelect) coatSelect.addEventListener('change', () => this.renderHomeStage());
      const nameInput = document.getElementById('cust-dog-name');
      if (nameInput) nameInput.addEventListener('input', () => this.renderHomeStage());

      // Wire add button
      const addBtn = document.getElementById('btn-add-dog');
      if (addBtn) {
        addBtn.addEventListener('click', () => this.adoptDogFromForm());
      }
    }
  }

  adoptDogFromForm() {
    const nameInput = document.getElementById('cust-dog-name');
    const coatSelect = document.getElementById('cust-dog-coat');
    const activeCollar = document.querySelector('#collar-palette .color-swatch.active');

    const name = (nameInput && nameInput.value.trim()) || 'Ziggy';
    const coatKey = (coatSelect && coatSelect.value) || 'CHOCOLATE_TAN';
    const collarColor = (activeCollar && activeCollar.getAttribute('data-color')) || '#0d9488';
    const personality = {
      playfulness: parseInt(document.getElementById('cust-personality-playfulness')?.value || '3', 10),
      shyness: parseInt(document.getElementById('cust-personality-shyness')?.value || '2', 10),
      barkyness: parseInt(document.getElementById('cust-personality-barkyness')?.value || '2', 10),
      obedience: parseInt(document.getElementById('cust-personality-obedience')?.value || '4', 10)
    };

    this.dogSlot = { name, coatKey, collarColor, personality };

    if (this.dog) {
      this.dog.name = name;
      if (this.coatPresets && this.coatPresets[coatKey]) {
        this.dog.coat = this.coatPresets[coatKey];
      }
      this.dog.collarColor = collarColor;
      if (typeof this.dog.setPersonality === 'function') {
        this.dog.setPersonality(personality);
      } else {
        this.dog.personality = personality;
      }
    }

    this.isHomeLocked = false;
    this.renderDogSlot();
    this.renderHomeStage();
    this.updateCloseButtonState();
    this.persistProfile();
    this.broadcastProfile();
  }

  updateCloseButtonState() {
    const closeBtn = document.getElementById('close-modal');
    if (!closeBtn) return;
    if (this.isHomeLocked) {
      closeBtn.style.display = 'none';
    } else {
      closeBtn.style.display = '';
    }
  }

  renderHomeStage(previewDogData = null) {
    const canvas = document.getElementById('home-stage-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const stageW = canvas.width;
    const stageH = canvas.height;

    ctx.clearRect(0, 0, stageW, stageH);

    // Stylized dark stage background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, stageH);
    bgGrad.addColorStop(0, '#0d1522');
    bgGrad.addColorStop(1, '#090e17');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, stageW, stageH);

    // Soft radial spotlight
    const spot = ctx.createRadialGradient(stageW / 2, stageH * 0.35, 10, stageW / 2, stageH * 0.35, stageW * 0.6);
    spot.addColorStop(0, 'rgba(56, 189, 248, 0.18)');
    spot.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, stageW, stageH);

    // Ellipse pedestal floor
    ctx.beginPath();
    ctx.ellipse(stageW / 2, stageH - 24, stageW * 0.42, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw owner
    if (this.owner && typeof this.owner.draw === 'function') {
      const saved = { x: this.owner.x, y: this.owner.y, angle: this.owner.angle };
      this.owner.x = 110;
      this.owner.y = 100;
      this.owner.angle = Math.PI / 2;
      try {
        this.owner.draw(ctx);
      } catch (e) {
        console.warn('Home stage owner draw failed:', e);
      }
      this.owner.x = saved.x;
      this.owner.y = saved.y;
      this.owner.angle = saved.angle;
    }

    // Draw dog
    const hasDog = this.dogSlot || previewDogData;
    if (hasDog && this.dog && typeof this.dog.draw === 'function') {
      const saved = {
        x: this.dog.x,
        y: this.dog.y,
        angle: this.dog.angle,
        coat: this.dog.coat,
        collarColor: this.dog.collarColor,
        name: this.dog.name
      };

      const data = previewDogData || this.dogSlot;
      if (data) {
        if (data.coatKey && this.coatPresets && this.coatPresets[data.coatKey]) {
          this.dog.coat = this.coatPresets[data.coatKey];
        }
        if (data.collarColor) this.dog.collarColor = data.collarColor;
        if (data.name) this.dog.name = data.name;
      }

      this.dog.x = 220;
      this.dog.y = 102;
      this.dog.angle = Math.PI / 2;
      try {
        this.dog.draw(ctx);
      } catch (e) {
        console.warn('Home stage dog draw failed:', e);
      }

      this.dog.x = saved.x;
      this.dog.y = saved.y;
      this.dog.angle = saved.angle;
      this.dog.coat = saved.coat;
      this.dog.collarColor = saved.collarColor;
      this.dog.name = saved.name;
    }
  }

  persistProfile() {
    if (typeof localStorage === 'undefined') return;
    try {
      const profileToSave = {
        name: this.owner.name,
        skinTone: this.owner.skinTone,
        hairStyle: this.owner.hairStyle,
        hairColor: this.owner.hairColor,
        jacketColor: this.owner.jacketColor,
        pantsColor: this.owner.pantsColor,
        accessory: this.owner.accessory || 'NONE',
        coatKey: this.dogSlot ? this.dogSlot.coatKey : 'CHOCOLATE_TAN',
        collarColor: this.dogSlot ? this.dogSlot.collarColor : '#0d9488',
        dogName: this.dogSlot ? this.dogSlot.name : 'Ziggy',
        dogSlot: this.dogSlot,
        personality: this.dogSlot ? this.dogSlot.personality : { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 }
      };
      localStorage.setItem('clifton_walker_profile', JSON.stringify(profileToSave));
    } catch (e) {
      console.warn('Could not save walker profile to localStorage:', e);
    }
  }

  broadcastProfile() {
    if (!this.net || typeof this.net.setLocalMeta !== 'function') return;
    const personality = this.dogSlot ? this.dogSlot.personality : { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
    const extraMeta = {
      hairStyle: this.owner.hairStyle,
      hairColor: this.owner.hairColor,
      pantsColor: this.owner.pantsColor,
      accessory: this.owner.accessory || 'NONE',
      skinTone: this.owner.skinTone,
      collarColor: this.dogSlot ? this.dogSlot.collarColor : '#0d9488',
      dogName: this.dogSlot ? this.dogSlot.name : 'Ziggy',
      personality
    };
    this.net.setLocalMeta({
      name: this.owner.name,
      jacketColor: this.owner.jacketColor,
      coatName: this.dog && this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan Cocker Spaniel',
      ...extraMeta
    });
    if (typeof this.net.broadcast === 'function' && this.net.peerId) {
      this.net.broadcast(Protocol.createHello(
        this.net.peerId,
        this.owner.name,
        this.owner.jacketColor,
        this.dog && this.dog.coat ? this.dog.coat.name : 'Chocolate & Tan Cocker Spaniel',
        extraMeta
      ));
    }
  }

  loadSavedProfile() {
    if (typeof localStorage === 'undefined') return;
    try {
      const savedStr = localStorage.getItem('clifton_walker_profile');
      if (!savedStr) {
        // First-time launch: no dog yet, lock the Home modal open
        if (this.dog) {
          if (!this.dog.personality) {
            this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
          }
        }
        this.dogSlot = null;
        this.isHomeLocked = true;
        this.renderDogSlot();
        this.updateModalActiveSelections();
        this.openModal();
        this.updateCloseButtonState();
        this.renderHomeStage();
        return;
      }
      const saved = JSON.parse(savedStr);
      if (!saved || typeof saved !== 'object') {
        if (this.dog && !this.dog.personality) {
          this.dog.personality = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
        }
        this.dogSlot = null;
        this.isHomeLocked = true;
        this.renderDogSlot();
        this.updateModalActiveSelections();
        this.openModal();
        this.updateCloseButtonState();
        this.renderHomeStage();
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
      this.owner.accessory = saved.accessory || 'NONE';

      // 2. Dog companion attributes (with fallback defaults)
      const personalityDefaults = { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 };
      const loadedPersonality = saved.personality && typeof saved.personality === 'object'
        ? {
            playfulness: parseInt(saved.personality.playfulness, 10) || personalityDefaults.playfulness,
            shyness: parseInt(saved.personality.shyness, 10) || personalityDefaults.shyness,
            barkyness: parseInt(saved.personality.barkyness, 10) || personalityDefaults.barkyness,
            obedience: parseInt(saved.personality.obedience, 10) || personalityDefaults.obedience
          }
        : { ...personalityDefaults };

      const savedCoatKey = saved.coatKey || 'CHOCOLATE_TAN';
      const savedCollar = saved.collarColor || '#0d9488';
      const savedDogName = saved.dogName || 'Ziggy';

      if (this.coatPresets && this.coatPresets[savedCoatKey]) {
        this.dog.coat = this.coatPresets[savedCoatKey];
      }
      this.dog.collarColor = savedCollar;
      this.dog.name = savedDogName;

      if (typeof this.dog.setPersonality === 'function') {
        this.dog.setPersonality(loadedPersonality);
      } else {
        this.dog.personality = loadedPersonality;
      }

      // Populate single-slot kennel
      this.dogSlot = {
        name: savedDogName,
        coatKey: savedCoatKey,
        collarColor: savedCollar,
        personality: loadedPersonality
      };
      this.isHomeLocked = false;
      this.renderDogSlot();
      this.updateCloseButtonState();

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
          accessory: this.owner.accessory || 'NONE',
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

    // Update accessory buttons
    const accessoryBtns = document.querySelectorAll('.accessory-btn');
    accessoryBtns.forEach(btn => {
      if (btn.getAttribute('data-accessory') === (this.owner.accessory || 'NONE')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update dog coat select (only present in empty-slot form)
    const coatSelect = document.getElementById('cust-dog-coat');
    if (coatSelect && this.dogSlot && this.dogSlot.coatKey) {
      coatSelect.value = this.dogSlot.coatKey;
    }

    // Update personality sliders and badges (only present in empty-slot form)
    const personality = (this.dogSlot && this.dogSlot.personality)
      ? this.dogSlot.personality
      : ((this.dog && this.dog.personality) ? this.dog.personality : { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 });

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
    this.renderDogSlot();
    this.updateCloseButtonState();
    modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
    if (modal.style.display === 'block') {
      this.renderHomeStage();
    }
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
      closeModal.addEventListener('click', () => {
        if (this.isHomeLocked) return;
        modal.style.display = 'none';
      });
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
        this.renderHomeStage();
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

    // Accessory selector buttons
    const accessoryBtns = document.querySelectorAll('.accessory-btn');
    accessoryBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        accessoryBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.owner.accessory = btn.getAttribute('data-accessory');
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

    // Save & Walk button
    if (btnSaveCust && modal) {
      btnSaveCust.addEventListener('click', () => {
        const nameInput = document.getElementById('cust-name');
        if (nameInput && nameInput.value.trim()) {
          this.owner.name = nameInput.value.trim();
        }

        // If no dog yet (locked), auto-adopt from the empty-slot form (one-click Ziggy)
        if (!this.dogSlot) {
          this.adoptDogFromForm();
        }

        this.persistProfile();
        this.broadcastProfile();

        if (!this.isHomeLocked) {
          modal.style.display = 'none';
        }
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

  setZoneTitle(title) {
    const el = document.getElementById('hud-title') || document.querySelector('.hud-title');
    if (el && title) {
      el.textContent = title;
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
      const isCommons = !this.net.roomId ||
        this.net.roomId === 'the-commons' ||
        this.net.roomId === 'clifton-commons' ||
        this.net.roomId === 'the-downs' ||
        this.net.roomId === 'the-woodland' ||
        this.net.roomId === 'the-beach' ||
        this.net.roomId === 'clifton-field' ||
        (Array.isArray(PUBLIC_ZONE_IDS) && PUBLIC_ZONE_IDS.includes(this.net.roomId)) ||
        isPublicZoneId(this.net.roomId);
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
