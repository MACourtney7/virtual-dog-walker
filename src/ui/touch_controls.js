// Touch Controls - Mobile Virtual Analog Joystick & Action Buttons

export class TouchControls {
  constructor(callbacks = {}) {
    this.callbacks = {
      onMove: callbacks.onMove || null,
      onThrow: callbacks.onThrow || null,
      onLeash: callbacks.onLeash || null,
      onPet: callbacks.onPet || null,
      onChat: callbacks.onChat || null,
      onWhistle: callbacks.onWhistle || null
    };

    this.joystickTouchId = null;
    this.joystickCenter = { x: 0, y: 0 };
    this.maxRadius = 50; // max displacement in pixels
    this.deadzone = 0.10; // 10% deadzone threshold
    this.joystickVector = {
      vx: 0,
      vy: 0,
      angle: 0,
      active: false,
      distance: 0
    };

    this.overlay = null;
    this.joystickZone = null;
    this.joystickBase = null;
    this.joystickKnob = null;
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

    // 1. Virtual Joystick (Bottom Left)
    this.joystickZone = document.createElement('div');
    this.joystickZone.id = 'touch-joystick-zone';

    this.joystickBase = document.createElement('div');
    this.joystickBase.id = 'joystick-base';

    this.joystickKnob = document.createElement('div');
    this.joystickKnob.id = 'joystick-knob';

    this.joystickBase.appendChild(this.joystickKnob);
    this.joystickZone.appendChild(this.joystickBase);
    this.overlay.appendChild(this.joystickZone);

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
    if (!this.joystickZone) return;

    // Joystick Touch Handling
    const handleJoystickStart = (touch) => {
      this.joystickTouchId = touch.identifier;
      const rect = this.joystickBase.getBoundingClientRect();
      this.joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      this.updateJoystickPosition(touch.clientX, touch.clientY);
    };

    const handleJoystickMove = (touch) => {
      this.updateJoystickPosition(touch.clientX, touch.clientY);
    };

    const handleJoystickEnd = () => {
      this.joystickTouchId = null;
      this.resetJoystick();
    };

    this.joystickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.joystickTouchId !== null) return;
      const touch = e.changedTouches[0];
      if (touch) handleJoystickStart(touch);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (this.joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.joystickTouchId) {
          e.preventDefault();
          handleJoystickMove(touch);
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      if (this.joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.joystickTouchId) {
          handleJoystickEnd();
          break;
        }
      }
    });

    window.addEventListener('touchcancel', (e) => {
      if (this.joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.joystickTouchId) {
          handleJoystickEnd();
          break;
        }
      }
    });

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
        this.vibrate(25);
        if (typeof callback === 'function') {
          callback();
        }
      };

      btn.addEventListener('touchstart', trigger, { passive: false });
      btn.addEventListener('click', (e) => {
        // Prevent duplicate trigger if touch fired
        if (e.detail === 0) return;
        trigger(e);
      });
    };

    bindButton('btn-touch-throw', () => this.callbacks.onThrow?.());
    bindButton('btn-touch-whistle', () => this.callbacks.onWhistle?.());
    bindButton('btn-touch-leash', () => this.callbacks.onLeash?.());
    bindButton('btn-touch-pet', () => this.callbacks.onPet?.());
    bindButton('btn-touch-chat', () => this.callbacks.onChat?.());
  }

  updateJoystickPosition(clientX, clientY) {
    const dx = clientX - this.joystickCenter.x;
    const dy = clientY - this.joystickCenter.y;
    const rawDist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    const clampedDist = Math.min(rawDist, this.maxRadius);
    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;

    if (this.joystickKnob) {
      this.joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    }

    const ratio = clampedDist / this.maxRadius;
    if (ratio < this.deadzone) {
      this.joystickVector = {
        vx: 0,
        vy: 0,
        angle: 0,
        active: false,
        distance: 0
      };
    } else {
      const normalizedIntensity = (ratio - this.deadzone) / (1.0 - this.deadzone);
      this.joystickVector = {
        vx: Math.cos(angle) * normalizedIntensity,
        vy: Math.sin(angle) * normalizedIntensity,
        angle: angle,
        active: true,
        distance: clampedDist
      };
    }

    if (typeof this.callbacks.onMove === 'function') {
      this.callbacks.onMove(this.joystickVector);
    }
  }

  resetJoystick() {
    if (this.joystickKnob) {
      this.joystickKnob.style.transform = 'translate(0px, 0px)';
    }

    this.joystickVector = {
      vx: 0,
      vy: 0,
      angle: 0,
      active: false,
      distance: 0
    };

    if (typeof this.callbacks.onMove === 'function') {
      this.callbacks.onMove(this.joystickVector);
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
    return this.joystickVector;
  }

  destroy() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }
}
