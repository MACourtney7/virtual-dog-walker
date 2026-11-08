// Touch Controls - Discrete Pace Controls & Action Buttons

export class TouchControls {
  constructor(callbacks = {}) {
    this.callbacks = {
      onPaceDown: callbacks.onPaceDown || null,
      onPaceUp: callbacks.onPaceUp || null,
      onThrow: callbacks.onThrow || null,
      onLeash: callbacks.onLeash || null,
      onPet: callbacks.onPet || null,
      onChat: callbacks.onChat || null,
      onWhistle: callbacks.onWhistle || null,
      onPickup: callbacks.onPickup || null,
      onDispose: callbacks.onDispose || null
    };

    this.contextualAction = null;
    this.currentGait = 'STAND';
    this._lastTriggerAt = 0;

    this.overlay = null;
    this.pacePad = null;
    this.gaitBadge = null;
    this.actionPad = null;

    this.initDOM();
    this.bindEvents();
  }

  static isTouchDevice() {
    return (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    );
  }

  initDOM() {
    const container = document.getElementById('game-container') || document.body;

    // Outer Overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'touch-controls-overlay';

    // 1. Discrete Pace Controls (Bottom Left)
    this.pacePad = document.createElement('div');
    this.pacePad.id = 'touch-pace-pad';
    this.pacePad.style.cssText = [
      'position: fixed',
      'left: 16px',
      'bottom: 24px',
      'display: flex',
      'align-items: center',
      'gap: 10px',
      'z-index: 1000',
      'touch-action: manipulation',
      'user-select: none',
      '-webkit-user-select: none',
      'pointer-events: auto'
    ].join(';');
    this.pacePad.innerHTML = `
      <button class="touch-pace-btn" id="btn-touch-pace-down" aria-label="Decrease Pace" style="width:52px;height:52px;border-radius:50%;border:none;background:rgba(15,23,42,0.85);color:#f8fafc;font-size:24px;font-weight:700;touch-action:manipulation;user-select:none;-webkit-user-select:none;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.35);">−</button>
      <div class="touch-gait-badge" id="touch-gait-badge" style="min-width:64px;padding:6px 10px;border-radius:14px;background:rgba(15,23,42,0.85);color:#fde047;font:600 13px system-ui,-apple-system,sans-serif;text-align:center;letter-spacing:0.5px;touch-action:manipulation;user-select:none;-webkit-user-select:none;">STAND</div>
      <button class="touch-pace-btn" id="btn-touch-pace-up" aria-label="Increase Pace" style="width:52px;height:52px;border-radius:50%;border:none;background:rgba(15,23,42,0.85);color:#f8fafc;font-size:24px;font-weight:700;touch-action:manipulation;user-select:none;-webkit-user-select:none;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.35);">+</button>
    `;
    this.overlay.appendChild(this.pacePad);
    this.gaitBadge = this.pacePad.querySelector('#touch-gait-badge');

    // 2. Action Pad (Bottom Right)
    this.actionPad = document.createElement('div');
    this.actionPad.id = 'touch-action-pad';

    this.actionPad.innerHTML = `
      <button class="touch-action-btn" id="btn-touch-throw" aria-label="Throw Ball">🎾</button>
      <button class="touch-action-btn" id="btn-touch-whistle" aria-label="Whistle / Recall Dog">📯</button>
      <button class="touch-action-btn" id="btn-touch-pet" aria-label="Pet Dog">❤️</button>
      <button class="touch-action-btn" id="btn-touch-leash" aria-label="Toggle Leash">🦮</button>
      <button class="touch-action-btn" id="btn-touch-chat" aria-label="Chat">💬</button>
    `;

    this.overlay.appendChild(this.actionPad);
    container.appendChild(this.overlay);

    // Initial display toggle based on touch capability
    if (!TouchControls.isTouchDevice()) {
      this.overlay.style.display = 'none';
    }
  }

  bindEvents() {
    // Action Buttons
    const bindButton = (id, callback) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      const trigger = (e) => {
        if (btn.classList.contains('is-disabled') || btn.hasAttribute('disabled')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();

        // Debounce: touchstart + pointerdown + click can all fire for a single
        // physical press. Ignore duplicate triggers within 200ms.
        const now = Date.now();
        if (now - this._lastTriggerAt < 200) {
          return;
        }
        this._lastTriggerAt = now;

        this.vibrate(25);
        if (typeof callback === 'function') {
          callback();
        }
      };

      btn.addEventListener('touchstart', trigger, { passive: false });
      btn.addEventListener('pointerdown', (e) => {
        // Pointer events fire for both mouse and touch; skip if touch already handled
        if (e.pointerType === 'touch') return;
        trigger(e);
      });
      btn.addEventListener('click', (e) => {
        // Prevent duplicate trigger if touch/pointer fired
        if (e.detail === 0) return;
        trigger(e);
      });
    };

    bindButton('btn-touch-pace-down', () => this.callbacks.onPaceDown?.());
    bindButton('btn-touch-pace-up', () => this.callbacks.onPaceUp?.());
    bindButton('btn-touch-throw', () => this.callbacks.onThrow?.());
    bindButton('btn-touch-whistle', () => this.callbacks.onWhistle?.());
    bindButton('btn-touch-leash', () => this.callbacks.onLeash?.());
    bindButton('btn-touch-pet', () => {
      if (this.contextualAction === 'pickup') {
        if (typeof this.callbacks.onPickup === 'function') {
          this.callbacks.onPickup();
        } else {
          this.callbacks.onPet?.();
        }
      } else if (this.contextualAction === 'dispose') {
        if (typeof this.callbacks.onDispose === 'function') {
          this.callbacks.onDispose();
        } else {
          this.callbacks.onPet?.();
        }
      } else {
        this.callbacks.onPet?.();
      }
    });
    bindButton('btn-touch-chat', () => this.callbacks.onChat?.());
  }

  setCurrentGait(gait) {
    this.currentGait = gait || 'STAND';
    if (this.gaitBadge) {
      this.gaitBadge.textContent = this.currentGait;
    }
  }

  vibrate(duration = 25) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(duration);
      }
    } catch (_) {
      // Haptic vibration silently ignored if restricted
    }
  }

  setLeashed(isLeashed) {
    const btn = document.getElementById('btn-touch-leash');
    if (!btn) return;

    if (isLeashed) {
      btn.textContent = '🦮';
      btn.classList.remove('off-leash');
      btn.setAttribute('aria-label', 'Toggle Leash (Currently On)');
    } else {
      btn.textContent = '🐕';
      btn.classList.add('off-leash');
      btn.setAttribute('aria-label', 'Toggle Leash (Currently Off)');
    }
  }

  setContextualAction(action) {
    if (this.contextualAction === action) return;
    this.contextualAction = action;

    const btn = document.getElementById('btn-touch-pet');
    if (!btn) return;

    btn.classList.remove('contextual-pickup', 'contextual-dispose');

    if (action === 'pickup') {
      btn.textContent = '💩';
      btn.setAttribute('aria-label', 'Pick up dog waste');
      btn.classList.add('contextual-pickup');
    } else if (action === 'dispose') {
      btn.textContent = '🗑️';
      btn.setAttribute('aria-label', 'Dispose waste in bin');
      btn.classList.add('contextual-dispose');
    } else {
      btn.textContent = '❤️';
      btn.setAttribute('aria-label', 'Pet Dog');
    }
  }

  setThrowEnabled(enabled) {
    const btn = document.getElementById('btn-touch-throw');
    if (!btn) return;

    if (enabled) {
      btn.classList.remove('is-disabled');
      btn.style.opacity = '';
      btn.style.filter = '';
      btn.style.pointerEvents = '';
      btn.removeAttribute('disabled');
      btn.setAttribute('aria-disabled', 'false');
    } else {
      btn.classList.add('is-disabled');
      btn.style.opacity = '0.45';
      btn.style.filter = 'grayscale(80%)';
      btn.style.pointerEvents = 'none';
      btn.setAttribute('disabled', 'true');
      btn.setAttribute('aria-disabled', 'true');
    }
  }

  getVector() {
    return { vx: 0, vy: 0, angle: 0, active: false, distance: 0 };
  }

  destroy() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }
}
