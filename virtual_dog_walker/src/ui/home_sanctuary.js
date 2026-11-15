/**
 * Home Sanctuary — grass field canvas + autonomous free-roaming companion dog.
 *
 * Exposes `window.HomeSanctuary` with a small, idempotent public API.
 * The module owns the `#home-field-canvas` element and drives a requestAnimationFrame
 * loop that renders a soft green lawn and a wandering dog.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var CANVAS_ID = 'home-field-canvas';
  var SANCTUARY_ID = 'home-view-sanctuary';

  var STATES = ['wander', 'sniff', 'sit', 'wag', 'eating'];
  var AUTONOMOUS_STATES = ['wander', 'sniff', 'sit', 'wag'];

  var FIELD_PADDING = 28; // soft padding from canvas edges (px)
  var DOG_RADIUS = 14;

  var WANDER_SPEED = 42; // px / second
  var ARRIVE_EPSILON = 4;

  // Minimum / maximum time (ms) spent in a non-wander state before returning to wander.
  var STATE_MIN_MS = 900;
  var STATE_MAX_MS = 2600;

  // Default appearance fallbacks (used when no profile data is available).
  var DEFAULT_COAT = '#c98a4b';
  var DEFAULT_COAT_DARK = '#a86f38';
  var DEFAULT_COLLAR = '#d94f4f';

  // ---------------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------------

  var canvas = null;
  var ctx = null;
  var rafId = null;
  var lastTimestamp = 0;
  var mounted = false;

  var fieldWidth = 0;
  var fieldHeight = 0;

  var dog = null;
  var pose = 'auto'; // 'auto' | 'camera'
  var stateTimer = 0;
  var forcedState = null; // when set via setDogState, holds until cleared

  var grassBlades = [];
  var noiseSeed = 1337;

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // Deterministic pseudo-random for grass placement so the lawn is stable.
  function seededRandom() {
    noiseSeed = (noiseSeed * 9301 + 49297) % 233280;
    return noiseSeed / 233280;
  }

  function safeParse(json) {
    try {
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Profile / appearance resolution
  // ---------------------------------------------------------------------------

  function readProfile() {
    if (typeof global.localStorage === 'undefined') return null;

    var keys = [
      'vdw.activeProfile',
      'vdw.profile',
      'activeProfile',
      'dogProfile',
      'vdw.profiles'
    ];

    for (var i = 0; i < keys.length; i++) {
      var raw = null;
      try {
        raw = global.localStorage.getItem(keys[i]);
      } catch (err) {
        raw = null;
      }
      if (!raw) continue;

      var parsed = safeParse(raw);
      if (!parsed) continue;

      // Some keys may store an array of profiles; pick the active one if possible.
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) continue;
        var activeId = null;
        try {
          activeId = global.localStorage.getItem('vdw.activeProfileId');
        } catch (err) {
          activeId = null;
        }
        if (activeId) {
          for (var j = 0; j < parsed.length; j++) {
            if (parsed[j] && String(parsed[j].id) === String(activeId)) {
              return parsed[j];
            }
          }
        }
        return parsed[0];
      }

      if (typeof parsed === 'object') {
        return parsed;
      }
    }

    return null;
  }

  function resolveAppearance(profile) {
    var appearance = {
      coat: DEFAULT_COAT,
      coatDark: DEFAULT_COAT_DARK,
      collar: DEFAULT_COLLAR,
      name: 'Companion',
      id: 'companion'
    };

    if (!profile || typeof profile !== 'object') return appearance;

    if (profile.id != null) appearance.id = String(profile.id);
    if (profile.name) appearance.name = String(profile.name);

    var coat =
      profile.coat ||
      profile.coatColor ||
      profile.color ||
      (profile.appearance && (profile.appearance.coat || profile.appearance.color));
    if (coat) appearance.coat = String(coat);

    var coatDark =
      profile.coatDark ||
      profile.coatSecondary ||
      (profile.appearance && (profile.appearance.coatDark || profile.appearance.coatSecondary));
    if (coatDark) appearance.coatDark = String(coatDark);

    var collar =
      profile.collar ||
      profile.collarColor ||
      (profile.appearance && (profile.appearance.collar || profile.appearance.collarColor));
    if (collar) appearance.collar = String(collar);

    return appearance;
  }

  // ---------------------------------------------------------------------------
  // Dog model
  // ---------------------------------------------------------------------------

  function createDog(appearance) {
    return {
      id: appearance.id,
      name: appearance.name,
      coat: appearance.coat,
      coatDark: appearance.coatDark,
      collar: appearance.collar,
      x: fieldWidth / 2,
      y: fieldHeight / 2,
      facing: Math.PI / 2, // radians; PI/2 = facing down toward camera
      state: 'wander',
      targetX: fieldWidth / 2,
      targetY: fieldHeight / 2,
      bob: 0
    };
  }

  function pickWanderTarget() {
    var minX = FIELD_PADDING;
    var maxX = Math.max(FIELD_PADDING, fieldWidth - FIELD_PADDING);
    var minY = FIELD_PADDING;
    var maxY = Math.max(FIELD_PADDING, fieldHeight - FIELD_PADDING);

    dog.targetX = rand(minX, maxX);
    dog.targetY = rand(minY, maxY);
  }

  function enterState(nextState) {
    if (STATES.indexOf(nextState) === -1) return;
    dog.state = nextState;

    if (nextState === 'wander') {
      pickWanderTarget();
      stateTimer = 0;
    } else {
      stateTimer = rand(STATE_MIN_MS, STATE_MAX_MS);
    }
  }

  function chooseNextAutonomousState() {
    // Weighted: mostly wander, occasionally idle behaviours.
    var roll = Math.random();
    if (roll < 0.55) return 'wander';
    if (roll < 0.72) return 'sniff';
    if (roll < 0.88) return 'sit';
    return 'wag';
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  function updateDog(dt) {
    if (!dog) return;

    // Camera pose: dog faces the viewer and stays put.
    if (pose === 'camera') {
      dog.facing = Math.PI / 2;
      dog.bob += dt * 0.004;
      return;
    }

    if (forcedState) {
      dog.state = forcedState;
    }

    if (dog.state === 'wander') {
      var dx = dog.targetX - dog.x;
      var dy = dog.targetY - dog.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < ARRIVE_EPSILON) {
        if (!forcedState) {
          enterState(chooseNextAutonomousState());
        } else {
          pickWanderTarget();
        }
      } else {
        var step = WANDER_SPEED * dt;
        var nx = dx / dist;
        var ny = dy / dist;
        dog.x += nx * step;
        dog.y += ny * step;
        dog.facing = Math.atan2(ny, nx);
        dog.bob += dt * 0.012;
      }
    } else {
      // Idle states: count down, then return to wander.
      dog.bob += dt * 0.006;
      if (!forcedState) {
        stateTimer -= dt;
        if (stateTimer <= 0) {
          enterState('wander');
        }
      }
    }

    // Soft clamp within field boundaries.
    dog.x = clamp(dog.x, FIELD_PADDING, Math.max(FIELD_PADDING, fieldWidth - FIELD_PADDING));
    dog.y = clamp(dog.y, FIELD_PADDING, Math.max(FIELD_PADDING, fieldHeight - FIELD_PADDING));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function buildGrass() {
    grassBlades = [];
    noiseSeed = 1337;
    var count = Math.max(40, Math.floor((fieldWidth * fieldHeight) / 2600));
    for (var i = 0; i < count; i++) {
      grassBlades.push({
        x: seededRandom() * fieldWidth,
        y: seededRandom() * fieldHeight,
        h: 3 + seededRandom() * 5,
        lean: (seededRandom() - 0.5) * 3,
        tone: seededRandom() > 0.5 ? '#7fbf5a' : '#6aa84f'
      });
    }
  }

  function drawField() {
    if (!ctx) return;

    // Base lawn gradient (hue 100–140).
    var grad = ctx.createLinearGradient(0, 0, 0, fieldHeight);
    grad.addColorStop(0, '#a8d98a'); // light green
    grad.addColorStop(1, '#7cb85c'); // deeper green
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, fieldWidth, fieldHeight);

    // Subtle dither / noise patches for texture.
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (var i = 0; i < 120; i++) {
      var px = seededRandom() * fieldWidth;
      var py = seededRandom() * fieldHeight;
      var r = 6 + seededRandom() * 18;
      ctx.fillStyle = seededRandom() > 0.5 ? '#5f9e45' : '#c3e6a8';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Grass blades.
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (var b = 0; b < grassBlades.length; b++) {
      var blade = grassBlades[b];
      ctx.strokeStyle = blade.tone;
      ctx.beginPath();
      ctx.moveTo(blade.x, blade.y);
      ctx.lineTo(blade.x + blade.lean, blade.y - blade.h);
      ctx.stroke();
    }
  }

  function drawDog() {
    if (!ctx || !dog) return;

    var bob = Math.sin(dog.bob) * 1.5;
    var cx = dog.x;
    var cy = dog.y + bob;

    ctx.save();
    ctx.translate(cx, cy);

    // Shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, DOG_RADIUS * 0.9, DOG_RADIUS * 0.9, DOG_RADIUS * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body.
    ctx.fillStyle = dog.coat;
    ctx.beginPath();
    ctx.ellipse(0, 0, DOG_RADIUS, DOG_RADIUS * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Darker back patch.
    ctx.fillStyle = dog.coatDark;
    ctx.beginPath();
    ctx.ellipse(0, -DOG_RADIUS * 0.25, DOG_RADIUS * 0.7, DOG_RADIUS * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Collar.
    ctx.strokeStyle = dog.collar;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, DOG_RADIUS * 0.15, DOG_RADIUS * 0.55, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // Head — position depends on facing.
    var headAngle = pose === 'camera' ? Math.PI / 2 : dog.facing;
    var hx = Math.cos(headAngle) * DOG_RADIUS * 0.85;
    var hy = Math.sin(headAngle) * DOG_RADIUS * 0.85;

    ctx.fillStyle = dog.coat;
    ctx.beginPath();
    ctx.arc(hx, hy, DOG_RADIUS * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Ears.
    ctx.fillStyle = dog.coatDark;
    ctx.beginPath();
    ctx.arc(hx - DOG_RADIUS * 0.3, hy - DOG_RADIUS * 0.35, DOG_RADIUS * 0.22, 0, Math.PI * 2);
    ctx.arc(hx + DOG_RADIUS * 0.3, hy - DOG_RADIUS * 0.35, DOG_RADIUS * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // Eyes.
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.arc(hx - DOG_RADIUS * 0.18, hy - DOG_RADIUS * 0.05, 1.6, 0, Math.PI * 2);
    ctx.arc(hx + DOG_RADIUS * 0.18, hy - DOG_RADIUS * 0.05, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Nose.
    ctx.fillStyle = '#1f1f1f';
    ctx.beginPath();
    ctx.arc(hx, hy + DOG_RADIUS * 0.22, 2, 0, Math.PI * 2);
    ctx.fill();

    // Tail — wags faster in 'wag' state.
    var wagSpeed = dog.state === 'wag' ? 0.02 : 0.006;
    var tailAngle = Math.sin(dog.bob * (wagSpeed / 0.006)) * 0.5;
    ctx.strokeStyle = dog.coatDark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-Math.cos(headAngle) * DOG_RADIUS * 0.8, -Math.sin(headAngle) * DOG_RADIUS * 0.8);
    ctx.lineTo(
      -Math.cos(headAngle) * DOG_RADIUS * 1.4 + Math.sin(tailAngle) * 6,
      -Math.sin(headAngle) * DOG_RADIUS * 1.4 - Math.cos(tailAngle) * 6
    );
    ctx.stroke();

    ctx.restore();
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, fieldWidth, fieldHeight);
    drawField();
    drawDog();
  }

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------

  function frame(timestamp) {
    if (!mounted) return;

    if (!lastTimestamp) lastTimestamp = timestamp;
    var dt = Math.min(timestamp - lastTimestamp, 100); // clamp to avoid huge jumps
    lastTimestamp = timestamp;

    updateDog(dt);
    render();

    rafId = global.requestAnimationFrame(frame);
  }

  function startLoop() {
    if (rafId != null) return;
    lastTimestamp = 0;
    rafId = global.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId != null) {
      global.cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastTimestamp = 0;
  }

  // ---------------------------------------------------------------------------
  // Sizing
  // ---------------------------------------------------------------------------

  function resizeCanvas() {
    if (!canvas) return;

    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var cssWidth = (rect && rect.width) || canvas.clientWidth || canvas.width || 320;
    var cssHeight = (rect && rect.height) || canvas.clientHeight || canvas.height || 240;

    var dpr = global.devicePixelRatio || 1;

    fieldWidth = Math.max(1, Math.round(cssWidth));
    fieldHeight = Math.max(1, Math.round(cssHeight));

    canvas.width = Math.round(fieldWidth * dpr);
    canvas.height = Math.round(fieldHeight * dpr);

    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    buildGrass();

    if (dog) {
      dog.x = clamp(dog.x, FIELD_PADDING, Math.max(FIELD_PADDING, fieldWidth - FIELD_PADDING));
      dog.y = clamp(dog.y, FIELD_PADDING, Math.max(FIELD_PADDING, fieldHeight - FIELD_PADDING));
      pickWanderTarget();
    }
  }

  var resizeHandler = null;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function mount() {
    if (mounted) return;

    var el = global.document && global.document.getElementById(CANVAS_ID);
    if (!el) {
      // Graceful no-op when the canvas is not present.
      return;
    }

    canvas = el;
    ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) {
      canvas = null;
      return;
    }

    resizeCanvas();

    var appearance = resolveAppearance(readProfile());
    dog = createDog(appearance);
    pose = 'auto';
    forcedState = null;
    enterState('wander');

    mounted = true;

    resizeHandler = function () {
      resizeCanvas();
    };
    if (global.addEventListener) {
      global.addEventListener('resize', resizeHandler);
    }

    startLoop();
  }

  function unmount() {
    if (!mounted) return;

    mounted = false;
    stopLoop();

    if (resizeHandler && global.removeEventListener) {
      global.removeEventListener('resize', resizeHandler);
    }
    resizeHandler = null;

    if (ctx) {
      ctx.clearRect(0, 0, fieldWidth, fieldHeight);
    }

    canvas = null;
    ctx = null;
    dog = null;
    forcedState = null;
    grassBlades = [];
  }

  function getCompanionDog() {
    if (!dog) {
      return {
        id: 'companion',
        name: 'Companion',
        x: 0,
        y: 0,
        facing: Math.PI / 2,
        state: 'wander'
      };
    }
    return {
      id: dog.id,
      name: dog.name,
      x: dog.x,
      y: dog.y,
      facing: dog.facing,
      state: dog.state
    };
  }

  function setDogPose(nextPose) {
    if (nextPose !== 'camera' && nextPose !== 'auto') return;
    pose = nextPose;
    if (dog && nextPose === 'camera') {
      dog.facing = Math.PI / 2;
    }
  }

  function setDogState(nextState) {
    if (STATES.indexOf(nextState) === -1) return;
    if (!dog) return;

    forcedState = nextState;
    enterState(nextState);
  }

  function getFieldSize() {
    return { width: fieldWidth, height: fieldHeight };
  }

  var HomeSanctuary = {
    mount: mount,
    unmount: unmount,
    getCompanionDog: getCompanionDog,
    setDogPose: setDogPose,
    setDogState: setDogState,
    getFieldSize: getFieldSize
  };

  global.HomeSanctuary = HomeSanctuary;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HomeSanctuary;
  }
})(typeof window !== 'undefined' ? window : this);
