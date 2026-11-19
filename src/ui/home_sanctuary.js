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

  var STATES = ['wander', 'sniff', 'sit', 'wag', 'eating', 'bowl'];
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

  // "The Downs" turf palette (mirrors src/world/field.js).
  var GRASS_BASE = '#3e6b2c';
  var GRASS_DARK = '#335824';
  var GRASS_LIGHT = '#4c8237';
  var GRASS_MOWN = '#447831';
  var BLADE_COLOR = '#5da347';
  var MOWN_STRIPE = 'rgba(76, 130, 55, 0.14)';
  var TURF_VARIATION = 'rgba(52, 98, 42, 0.06)';
  var SANCTUARY_ZOOM = 0.72;

  // Rejection animation duration (ms) for care actions the dog doesn't need.
  var REJECTION_ANIM_MS = 500;

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
  var activeDogSlot = null;
  var pose = 'auto'; // 'auto' | 'camera'
  var stateTimer = 0;
  var forcedState = null; // when set via setDogState, holds until cleared

  var grassBlades = [];
  var noiseSeed = 1337;

  var particles = [];
  var particleFrame = 0;

  // Rejection animation state (head-shake + hop-back when a care is not needed).
  var rejectionActive = false;
  var rejectionEndsAt = 0;
  var rejectionFrame = 0;
  var rejectionStartedAt = 0;
  // Visual offset applied to the rendered dog during a rejection.
  var rejectionOffsetX = 0;
  var rejectionOffsetY = 0;
  var rejectionHeadShake = 0;

  // Care-action completion hooks (groom / rest). Invoked after the timer
  // completes, the timer id is cleared, and resumeRoaming() has run.
  var groomCompleteHandler = null;
  var restCompleteHandler = null;

  // Hunger integration state.
  var hungerStore = null;
  var hungerAnimator = null;
  var hungerUnsubscribe = null;
  var hungerIntervalId = null;
  var hungerIntegrationActive = false;

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

    // Primary source of truth: the SocialHUD-persisted walker profile.
    var rawProfile = null;
    try {
      rawProfile = global.localStorage.getItem('clifton_walker_profile');
    } catch (err) {
      rawProfile = null;
    }
    if (rawProfile) {
      var profile = safeParse(rawProfile);
      if (profile && typeof profile === 'object') {
        // An explicitly empty kennel means there is no companion dog.
        if (profile.dogSlot === null) return null;

        if (profile.dogSlot && typeof profile.dogSlot === 'object') {
          var slot = profile.dogSlot;
          return {
            id: slot.id || 'dog-1',
            name: slot.name || profile.dogName || 'Ziggy',
            coatKey: slot.coatKey || profile.coatKey,
            collar: slot.collarColor || profile.collarColor
          };
        }

        if (profile.dogName) {
          return {
            id: 'dog-1',
            name: profile.dogName,
            coatKey: profile.coatKey,
            collar: profile.collarColor
          };
        }
      }
    }

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

  // Known breed coat keys mapped to the full CompanionDog palette so the
  // authentic renderer can consume them without missing fields.
  var COAT_KEY_COLORS = {
    CHOCOLATE_TAN: {
      primary: '#2e1a14',
      dark: '#22130e',
      secondary: '#d89b54',
      bodyColor: '#2e1a14',
      bodyShade: '#22130e',
      tanColor: '#d89b54',
      tanHighlight: '#e2aa68',
      earRoot: '#2e1a14',
      earHighlight: '#9e5528',
      noseColor: '#5e372e',
      bibColor: '#f4efe6',
      hasEyePatch: false
    },
    GOLDEN: {
      primary: '#eab308',
      dark: '#ca8a04',
      secondary: '#fef08a',
      bodyColor: '#d4a373',
      bodyShade: '#b8824f',
      tanColor: '#faedcd',
      tanHighlight: '#fefae0',
      earRoot: '#c58b54',
      earHighlight: '#e0a96d',
      noseColor: '#3d261d',
      bibColor: '#fffdfa',
      hasEyePatch: false
    },
    BEAGLE: {
      primary: '#8b5a2b',
      dark: '#5c3a1a',
      secondary: '#f5f0e6',
      bodyColor: '#8b5a2b',
      bodyShade: '#5c3a1a',
      tanColor: '#f5f0e6',
      tanHighlight: '#fffdfa',
      earRoot: '#5c3a1a',
      earHighlight: '#8b5a2b',
      noseColor: '#1e293b',
      bibColor: '#ffffff',
      hasEyePatch: false
    },
    DALMATIAN: {
      primary: '#f8fafc',
      dark: '#e2e8f0',
      secondary: '#1e293b',
      bodyColor: '#f8fafc',
      bodyShade: '#e2e8f0',
      tanColor: '#1e293b',
      tanHighlight: '#334155',
      earRoot: '#1e293b',
      earHighlight: '#334155',
      noseColor: '#0f172a',
      bibColor: '#ffffff',
      hasEyePatch: true
    },
    BLACK_LAB: {
      primary: '#1e2022',
      dark: '#374151',
      secondary: '#4b5563',
      bodyColor: '#1e2022',
      bodyShade: '#374151',
      tanColor: '#4b5563',
      tanHighlight: '#6b7280',
      earRoot: '#1e2022',
      earHighlight: '#374151',
      noseColor: '#090a0f',
      bibColor: '#f1f5f9',
      hasEyePatch: false
    },
    JACK_RUSSELL: {
      primary: '#f8fafc',
      dark: '#e2e8f0',
      secondary: '#b45309',
      bodyColor: '#f8fafc',
      bodyShade: '#e2e8f0',
      tanColor: '#b45309',
      tanHighlight: '#d97706',
      earRoot: '#b45309',
      earHighlight: '#92400e',
      noseColor: '#1e293b',
      bibColor: '#ffffff',
      hasEyePatch: true
    },
    RED_SETTER: {
      primary: '#7c2d12',
      dark: '#991b1b',
      secondary: '#b45309',
      bodyColor: '#7c2d12',
      bodyShade: '#991b1b',
      tanColor: '#b45309',
      tanHighlight: '#d97706',
      earRoot: '#7c2d12',
      earHighlight: '#991b1b',
      noseColor: '#27100b',
      bibColor: '#fef2f2',
      hasEyePatch: false
    }
  };

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
    if (profile.coatKey) appearance.coatKey = String(profile.coatKey);

    // Breed coat-key mapping takes precedence so breed choices render
    // accurately regardless of any stale explicit color fields.
    var mapped = appearance.coatKey ? COAT_KEY_COLORS[appearance.coatKey] : null;
    if (mapped) {
      appearance.coat = mapped.primary;
      appearance.coatDark = mapped.dark;
      appearance.coatSecondary = mapped.secondary;
      appearance.palette = mapped;
    }

    var coat =
      profile.coat ||
      profile.coatColor ||
      profile.color ||
      (profile.appearance && (profile.appearance.coat || profile.appearance.color));
    if (coat && !mapped) appearance.coat = String(coat);

    var coatDark =
      profile.coatDark ||
      profile.coatSecondary ||
      (profile.appearance && (profile.appearance.coatDark || profile.appearance.coatSecondary));
    if (coatDark && !mapped) appearance.coatDark = String(coatDark);

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
      coatColor: appearance.coat,
      coatColorDark: appearance.coatDark,
      coatSecondary: appearance.coatSecondary,
      coatKey: appearance.coatKey,
      palette: appearance.palette || null,
      collar: appearance.collar,
      x: fieldWidth / 2,
      y: fieldHeight / 2,
      facing: Math.PI / 2, // radians; PI/2 = facing down toward camera
      state: 'wander',
      targetX: fieldWidth / 2,
      targetY: fieldHeight / 2,
      bob: 0,
      // Emote / care animation state.
      emoteBubble: null,
      emoteTimer: 0,
      beingGroomed: false,
      groomTimer: 0,
      sleeping: false,
      sleepTimer: 0,
      // The sanctuary dog is always off-leash and fully self-contained.
      isLeashed: false,
      leash: null,
      leashActive: false
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

    var dtSec = dt / 1000;

    // Emote countdown (dt is in ms; emoteTimer is in seconds).
    if (dog.emoteTimer > 0) {
      dog.emoteTimer = Math.max(0, dog.emoteTimer - dtSec);
      if (dog.emoteTimer <= 0) {
        dog.emoteBubble = null;
      }
    }

    // Grooming countdown — independent of the emote bubble.
    if (dog.groomTimer > 0) {
      dog.groomTimer = Math.max(0, dog.groomTimer - dtSec);
      if (dog.groomTimer <= 0) {
        dog.groomTimer = 0;
        dog.beingGroomed = false;
        if (!dog.sleeping && !forcedState && dog.state === 'sit') {
          dog.state = 'idle';
        }
        // Only restore roaming if rest is not still running.
        if (!(dog.sleepTimer > 0)) {
          resumeRoaming();
        }
        var groomCb = groomCompleteHandler;
        groomCompleteHandler = null;
        if (typeof groomCb === 'function') {
          try { groomCb(); } catch (e) { /* ignore */ }
        }
      }
    }

    // Sleeping countdown — independent of the emote bubble.
    if (dog.sleepTimer > 0) {
      dog.sleepTimer = Math.max(0, dog.sleepTimer - dtSec);
      if (dog.sleepTimer <= 0) {
        dog.sleepTimer = 0;
        dog.sleeping = false;
        if (!dog.beingGroomed && !forcedState && dog.state === 'sit') {
          dog.state = 'idle';
        }
        // Only restore roaming if grooming is not still running.
        if (!(dog.groomTimer > 0)) {
          resumeRoaming();
        }
        var restCb = restCompleteHandler;
        restCompleteHandler = null;
        if (typeof restCb === 'function') {
          try { restCb(); } catch (e) { /* ignore */ }
        }
      }
    }

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
        // dt is in milliseconds; WANDER_SPEED is px/second.
        var step = WANDER_SPEED * (dt / 1000);
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
        tone: seededRandom() > 0.5 ? BLADE_COLOR : GRASS_LIGHT
      });
    }
  }

  // Deterministic hash for stable turf placement (no per-frame randomness).
  function turfHash(gx, gy) {
    var v = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
    return v - Math.floor(v);
  }

  function drawField() {
    if (!ctx) return;

    // 1. Base turf fill.
    ctx.fillStyle = GRASS_BASE;
    ctx.fillRect(0, 0, fieldWidth, fieldHeight);

    // 2. Subtle diagonal mown stripes.
    ctx.save();
    var stripeWidth = 46;
    var span = fieldWidth + fieldHeight;
    for (var s = -fieldHeight; s < span; s += stripeWidth * 2) {
      ctx.fillStyle = GRASS_MOWN;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(s + stripeWidth, 0);
      ctx.lineTo(s + stripeWidth - fieldHeight, fieldHeight);
      ctx.lineTo(s - fieldHeight, fieldHeight);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = MOWN_STRIPE;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(s + stripeWidth, 0);
      ctx.lineTo(s + stripeWidth * 2, 0);
      ctx.lineTo(s + stripeWidth * 2 - fieldHeight, fieldHeight);
      ctx.lineTo(s + stripeWidth - fieldHeight, fieldHeight);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 3. Deterministic grid-based turf ellipses (light / dark / variation).
    var cell = 34;
    var cols = Math.ceil(fieldWidth / cell) + 1;
    var rows = Math.ceil(fieldHeight / cell) + 1;
    ctx.save();
    for (var gy = 0; gy < rows; gy++) {
      for (var gx = 0; gx < cols; gx++) {
        var h = turfHash(gx, gy);
        var px = gx * cell + (h - 0.5) * cell * 0.6;
        var py = gy * cell + (turfHash(gy, gx) - 0.5) * cell * 0.6;
        var rx = 6 + h * 10;
        var ry = 4 + h * 7;

        // Base patch tone.
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = h > 0.5 ? GRASS_LIGHT : GRASS_DARK;
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, h * Math.PI, 0, Math.PI * 2);
        ctx.fill();

        // Subtle variation overlay.
        ctx.globalAlpha = 1;
        ctx.fillStyle = TURF_VARIATION;
        ctx.beginPath();
        ctx.ellipse(px, py, rx * 1.4, ry * 1.4, h * Math.PI, 0, Math.PI * 2);
        ctx.fill();

        // 5. Paired short blade ticks on a subset of patches.
        if (h > 0.62) {
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = BLADE_COLOR;
          ctx.lineWidth = 1.1;
          ctx.lineCap = 'round';
          var bx = px + (turfHash(gx + 7, gy + 3) - 0.5) * 8;
          var by = py + (turfHash(gx + 3, gy + 7) - 0.5) * 8;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - 1.5, by - 4);
          ctx.moveTo(bx + 2, by);
          ctx.lineTo(bx + 3.5, by - 3.5);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    // 6. Existing grass blade flecks (deterministic, built once per resize).
    ctx.save();
    ctx.globalAlpha = 0.9;
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
    ctx.restore();

    // Soft inner vignette darkening the perimeter.
    var vignette = ctx.createRadialGradient(
      fieldWidth / 2, fieldHeight / 2, Math.min(fieldWidth, fieldHeight) * 0.35,
      fieldWidth / 2, fieldHeight / 2, Math.max(fieldWidth, fieldHeight) * 0.75
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, fieldWidth, fieldHeight);
  }

  // Resolve a CompanionDog constructor from the global/module scope, if present.
  function getCompanionDogClass() {
    if (global.CompanionDog && (typeof global.CompanionDog === 'function' || (global.CompanionDog.prototype && typeof global.CompanionDog.prototype.draw === 'function'))) {
      return global.CompanionDog;
    }
    if (typeof CompanionDog !== 'undefined' && (typeof CompanionDog === 'function' || (CompanionDog.prototype && typeof CompanionDog.prototype.draw === 'function'))) {
      return CompanionDog;
    }
    return null;
  }

  // Build a lightweight entity shaped like a CompanionDog for articulated drawing.
  // `coat` is populated with the full palette so CompanionDog.prototype.draw
  // can consume it without throwing for every supported breed.
  function buildDogEntity() {
    var palette = dog.palette || null;
    var bodyColor = (palette && palette.bodyColor) || dog.coatColor || dog.coat || DEFAULT_COAT;
    var bodyShade = (palette && palette.bodyShade) || dog.coatColorDark || dog.coatDark || DEFAULT_COAT_DARK;
    var tanColor = (palette && palette.tanColor) || dog.coatSecondary || dog.coatDark || DEFAULT_COAT_DARK;
    var tanHighlight = (palette && palette.tanHighlight) || tanColor;
    var earRoot = (palette && palette.earRoot) || bodyColor;
    var earHighlight = (palette && palette.earHighlight) || tanHighlight;
    var noseColor = (palette && palette.noseColor) || '#1e293b';
    var bibColor = (palette && palette.bibColor) || '#f5f0e6';
    var hasEyePatch = Boolean(palette && palette.hasEyePatch);

    var coatObj = {
      bodyColor: bodyColor,
      bodyShade: bodyShade,
      tanColor: tanColor,
      tanHighlight: tanHighlight,
      earRoot: earRoot,
      earHighlight: earHighlight,
      noseColor: noseColor,
      bibColor: bibColor,
      hasEyePatch: hasEyePatch,
      darkColor: bodyShade
    };

    var CompanionDogClass = getCompanionDogClass();

    // When the real CompanionDog class is available, build the entity on its
    // prototype so every prototype method (drawEmote, etc.) resolves naturally.
    var entity = CompanionDogClass
      ? Object.create(CompanionDogClass.prototype)
      : {};

    Object.assign(entity, {
      // Identity / state
      id: dog.id,
      name: dog.name,
      state: dog.state,
      x: dog.x,
      y: dog.y,
      angle: pose === 'camera' ? Math.PI / 2 : dog.facing,
      facing: dog.facing,

      // Emote / care animation state
      emoteBubble: dog.emoteBubble || null,
      emoteTimer: dog.emoteTimer || 0,
      beingGroomed: Boolean(dog.beingGroomed),
      groomTimer: dog.groomTimer || 0,
      sleeping: Boolean(dog.sleeping),
      sleepTimer: dog.sleepTimer || 0,

      // Coat palette (both flat fields and nested object)
      coat: coatObj,
      coatColor: bodyColor,
      coatColorDark: bodyShade,
      coatDark: bodyShade,
      coatSecondary: tanColor,
      coatKey: dog.coatKey,
      collarColor: dog.collar,

      // Renderer-required fields
      leftEar: { angle: 0, vel: 0 },
      rightEar: { angle: 0, vel: 0 },
      hearts: [],
      hasStick: false,
      isBarking: false,
      barkWaveAlpha: 0,
      barkWaveRadius: 0,
      owner: null,
      isLeashed: false,
      leash: null,
      leashTaut: false,
      leashTension: 0,
      leashSagPx: 0,
      leashVibrationPx: 0,
      isPullingLeash: false,
      gaitMode: dog.state === 'wander' ? 'WALK' : 'IDLE',
      gaitPhase: dog.bob,
      legPhase: dog.bob,
      tailAngle: 0,
      noseTwitch: 0,
      isSitting: dog.state === 'sit',
      isSniffing: dog.state === 'sniff',
      radius: DOG_RADIUS
    });
    return entity;
  }

  // Draw the articulated top-down canine body mirroring CompanionDog geometry.
  // Head is oriented along +X (matching CompanionDog.prototype.draw).
  function drawArticulatedDog(entity) {
    var coatObj = entity.coat && typeof entity.coat === 'object' ? entity.coat : null;
    var bodyColor = entity.coatColor || (coatObj && coatObj.bodyColor) ||
      (typeof entity.coat === 'string' ? entity.coat : null) || DEFAULT_COAT;
    var bodyShade = entity.coatColorDark || entity.coatDark ||
      (coatObj && (coatObj.bodyShade || coatObj.darkColor)) || DEFAULT_COAT_DARK;
    var tanColor = (coatObj && coatObj.tanColor) || entity.coatSecondary || bodyShade;
    var tanHighlight = (coatObj && coatObj.tanHighlight) || tanColor;
    var earRoot = (coatObj && coatObj.earRoot) || bodyColor;
    var earHighlight = (coatObj && coatObj.earHighlight) || tanHighlight;
    var noseColor = (coatObj && coatObj.noseColor) || '#1e293b';
    var bibColor = (coatObj && coatObj.bibColor) || '#f4efe6';
    var hasEyePatch = Boolean(coatObj && coatObj.hasEyePatch);
    var collar = entity.collarColor || entity.collar || DEFAULT_COLLAR;
    var angle = entity.angle;
    var tailAngle = entity.tailAngle || 0;

    ctx.save();

    // 1. Soft ground shadow (unrotated).
    ctx.fillStyle = 'rgba(20, 35, 15, 0.32)';
    ctx.beginPath();
    ctx.ellipse(entity.x, entity.y + 7, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Oriented body — head along +X.
    ctx.translate(entity.x, entity.y);
    ctx.rotate(angle);

    // Paws.
    ctx.fillStyle = hasEyePatch ? '#f1f5f9' : tanColor;
    ctx.fillRect(-10, -9, 5, 4);
    ctx.fillRect(-10, 5, 5, 4);
    ctx.fillRect(8, -9, 5, 4);
    ctx.fillRect(8, 5, 5, 4);

    // Feathered wagging tail.
    ctx.save();
    ctx.translate(-14, 0);
    ctx.rotate(tailAngle);
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(-5, 0, 7.5, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tanHighlight;
    ctx.beginPath();
    ctx.ellipse(-9.5, 0, 4.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-13, 0, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Torso.
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 13, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dorsal sheen.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.ellipse(-2, -2, 10, 4.5, -0.05, 0, Math.PI * 2);
    ctx.fill();

    // Chest bib.
    ctx.fillStyle = bibColor;
    ctx.beginPath();
    ctx.ellipse(5, 0, 4.2, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Collar band.
    ctx.fillStyle = collar;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(5.5, -6.5, 3.0, 13, 1.5);
    } else {
      ctx.rect(5.5, -6.5, 3.0, 13);
    }
    ctx.fill();

    // Gold charm tag.
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(8.5, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(8.0, -0.6, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Head.
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(11, 0, 7.8, 6.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye patch (Jack Russell).
    if (hasEyePatch) {
      ctx.fillStyle = tanColor;
      ctx.beginPath();
      ctx.ellipse(12, -3.2, 3.8, 3.2, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Muzzle.
    ctx.fillStyle = tanColor;
    ctx.beginPath();
    ctx.ellipse(16, 0, 4.8, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Snout highlight.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(15.5, -1.0, 2.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose.
    ctx.fillStyle = noseColor;
    ctx.beginPath();
    ctx.ellipse(19.2, 0, 1.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(18.8, -0.6, 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Eyes.
    ctx.fillStyle = '#261b12';
    ctx.beginPath();
    ctx.arc(12, -3.2, 1.6, 0, Math.PI * 2);
    ctx.arc(12, 3.2, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c6933a';
    ctx.beginPath();
    ctx.arc(12.1, -3.2, 1.2, 0, Math.PI * 2);
    ctx.arc(12.1, 3.2, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(12.2, -3.2, 0.8, 0, Math.PI * 2);
    ctx.arc(12.2, 3.2, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(11.7, -3.6, 0.55, 0, Math.PI * 2);
    ctx.arc(11.7, 2.8, 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Floppy ears.
    var leftEarAngle = (entity.leftEar && entity.leftEar.angle) || 0;
    var rightEarAngle = (entity.rightEar && entity.rightEar.angle) || 0;

    ctx.save();
    ctx.translate(9, -6);
    ctx.rotate(leftEarAngle);
    ctx.fillStyle = earRoot;
    ctx.beginPath();
    ctx.ellipse(-1, -4, 4.6, 8.2, -Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = earHighlight;
    ctx.beginPath();
    ctx.ellipse(-1, -5.5, 3.2, 5.5, -Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(9, 6);
    ctx.rotate(rightEarAngle);
    ctx.fillStyle = earRoot;
    ctx.beginPath();
    ctx.ellipse(-1, 4, 4.6, 8.2, Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = earHighlight;
    ctx.beginPath();
    ctx.ellipse(-1, 5.5, 3.2, 5.5, Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore(); // Restore orientation transform

    // 3. Dark rounded pill name badge below the dog.
    if (entity.name) {
      ctx.save();
      ctx.font = '600 11px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var textWidth = ctx.measureText(entity.name).width;
      var pillW = textWidth + 12;
      var pillH = 16;
      var pillX = entity.x - pillW / 2;
      var pillY = entity.y + 18;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(pillX, pillY, pillW, pillH, 8);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.fillText(entity.name, entity.x, pillY + pillH / 2);
      ctx.restore();
    }
  }

  function drawFoodBowl() {
    if (!ctx || !dog) return;
    var bx = dog.x;
    var by = dog.y + 18;

    // Bowl body (zoomed around its own anchor).
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(SANCTUARY_ZOOM, SANCTUARY_ZOOM);
    ctx.translate(-bx, -by);
    ctx.fillStyle = '#e8e2d6';
    ctx.beginPath();
    ctx.ellipse(bx, by, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rim.
    ctx.strokeStyle = '#b8b0a0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(bx, by, 16, 8, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Interior depth shadow.
    ctx.fillStyle = '#c9c1b0';
    ctx.beginPath();
    ctx.ellipse(bx, by, 12, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Kibbles.
    ctx.fillStyle = '#8a5a2b';
    var kibbles = [[-5, -1], [0, 1], [5, -1], [-2, 2], [3, 2]];
    for (var k = 0; k < kibbles.length; k++) {
      ctx.beginPath();
      ctx.arc(bx + kibbles[k][0], by + kibbles[k][1], 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  var drawErrorLogged = false;

  function drawDog() {
    if (!ctx || !dog) return;

    // The sanctuary dog is fully self-contained: build a clean visual entity
    // from the sanctuary's own state. No world dog entity is ever consulted,
    // so there is zero prototype or world-state leakage.
    var entity = buildDogEntity();

    // Apply the visual rejection offset (head shake + hop-back) so a refused
    // care action produces an actual on-canvas refusal motion.
    if (rejectionActive) {
      entity.x = dog.x + rejectionOffsetX;
      entity.y = dog.y + rejectionOffsetY;
      entity.angle = (entity.angle || 0) + rejectionHeadShake;
    }

    // Zoom around the dog's own anchor so the field stays full-size.
    ctx.save();
    ctx.translate(dog.x, dog.y);
    ctx.scale(SANCTUARY_ZOOM, SANCTUARY_ZOOM);
    ctx.translate(-dog.x, -dog.y);

    var CompanionDogClass = getCompanionDogClass();
    var drawFn = (CompanionDogClass && CompanionDogClass.prototype &&
      typeof CompanionDogClass.prototype.draw === 'function')
      ? CompanionDogClass.prototype.draw
      : null;

    var drew = false;
    if (drawFn) {
      try {
        drawFn.call(entity, ctx);
        drew = true;
      } catch (e) {
        if (!drawErrorLogged) {
          drawErrorLogged = true;
          var consoleRef = (global && global.console) || (typeof console !== 'undefined' ? console : null);
          if (consoleRef && typeof consoleRef.warn === 'function') {
            consoleRef.warn('[HomeSanctuary] CompanionDog.draw failed, using fallback:', e);
          }
        }
      }
    }
    if (!drew) {
      drawArticulatedDog(entity);
    }

    ctx.restore();

    // Grooming bubbles orbiting the dog.
    if (dog.beingGroomed) {
      drawGroomingBubbles();
    }

    // Sleeping breathing pulse + floating Z cue.
    if (dog.sleeping) {
      drawSleepingCue();
    }

    // Food bowl during bowl/eating phases.
    if (isBowlVisible()) {
      drawFoodBowl();
    }
  }

  // Animated soap / sparkle bubbles orbiting the dog while being groomed.
  function drawGroomingBubbles() {
    if (!ctx || !dog) return;
    var t = (dog.bob || 0) * 0.5;
    var count = 6;
    ctx.save();
    for (var i = 0; i < count; i++) {
      var phase = t + (i / count) * Math.PI * 2;
      var orbitR = 22 + Math.sin(phase * 1.7) * 4;
      var bx = dog.x + Math.cos(phase) * orbitR;
      var by = dog.y - 6 + Math.sin(phase) * orbitR * 0.55;
      var r = 3 + (i % 3) * 1.2;

      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(phase * 2);
      ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.stroke();

      // Sparkle highlight.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(bx - r * 0.35, by - r * 0.35, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Gentle breathing pulse + floating Z cue while the dog sleeps.
  function drawSleepingCue() {
    if (!ctx || !dog) return;
    var t = (dog.bob || 0) * 0.5;
    var pulse = 1 + 0.06 * Math.sin(t * 2);

    ctx.save();

    // Breathing halo.
    ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 2);
    ctx.fillStyle = 'rgba(148, 197, 255, 0.9)';
    ctx.beginPath();
    ctx.ellipse(dog.x, dog.y, 22 * pulse, 12 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Floating Z cue.
    var zPhase = (t * 0.6) % 1;
    var zY = dog.y - 26 - zPhase * 18;
    ctx.globalAlpha = 1 - zPhase;
    ctx.fillStyle = '#e0f2fe';
    ctx.font = 'bold 14px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Z', dog.x + 10, zY);
    ctx.font = 'bold 10px Outfit, sans-serif';
    ctx.fillText('z', dog.x + 18, zY - 8);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // Bowl is visible during both the 'bowl' and 'eating' phases.
  function isBowlVisible() {
    if (forcedState === 'eating' || forcedState === 'bowl') return true;
    if (dog && (dog.state === 'eating' || dog.state === 'bowl')) return true;
    return false;
  }

  function spawnParticles() {
    if (!dog) return;
    particleFrame++;
    if (particleFrame % 10 !== 0) return;

    if (Math.random() < 0.5) {
      particles.push({
        x: dog.x + (Math.random() - 0.5) * 30,
        y: dog.y - 10,
        vy: -0.8 - Math.random() * 0.5,
        alpha: 1.0,
        type: 'heart',
        text: '❤️',
        size: 14
      });
    } else {
      particles.push({
        x: dog.x + (Math.random() - 0.5) * 20,
        y: dog.y + 15,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -0.5 - Math.random() * 0.5,
        alpha: 1.0,
        type: 'crumb',
        color: '#b45309',
        radius: 2.5
      });
    }
  }

  function updateAndDrawParticles() {
    if (!ctx) return;
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += (p.vx || 0);
      p.y += p.vy;
      p.alpha -= 0.015;

      if (p.alpha <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = p.alpha;
      if (p.type === 'heart') {
        ctx.font = (p.size || 14) + 'px sans-serif';
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.type === 'crumb') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1.0;
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, fieldWidth, fieldHeight);
    drawField();
    drawDog();

    if (isBowlVisible()) {
      spawnParticles();
    }
    updateAndDrawParticles();
  }

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------

  function frame(timestamp) {
    if (!mounted) return;

    // Self-heal hidden 0x0 initial mounts: if the parent is now visible and
    // its dimensions differ from the currently measured field, resize.
    if (canvas && canvas.parentElement) {
      var pw = canvas.parentElement.clientWidth;
      var ph = canvas.parentElement.clientHeight;
      if (pw > 0 && ph > 0 && (pw !== fieldWidth || ph !== fieldHeight)) {
        resizeCanvas();
      }
    }

    if (!lastTimestamp) lastTimestamp = timestamp;
    var dt = Math.min(timestamp - lastTimestamp, 100); // clamp to avoid huge jumps
    lastTimestamp = timestamp;

    updateRejection();
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

    // Prefer the parent container's layout box so the canvas fills it
    // seamlessly; fall back to the canvas's own measured size.
    var parent = canvas.parentElement || null;
    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var cssWidth =
      (parent && parent.clientWidth) ||
      (rect && rect.width) ||
      canvas.clientWidth ||
      canvas.width ||
      320;
    var cssHeight =
      (parent && parent.clientHeight) ||
      (rect && rect.height) ||
      canvas.clientHeight ||
      canvas.height ||
      240;

    var dpr = global.devicePixelRatio || 1;

    fieldWidth = Math.max(1, Math.round(cssWidth));
    fieldHeight = Math.max(1, Math.round(cssHeight));

    // Backing store in device pixels; drawing coordinates stay in CSS pixels.
    canvas.width = Math.round(fieldWidth * dpr);
    canvas.height = Math.round(fieldHeight * dpr);

    // Fill the container seamlessly; never pin fixed pixel dimensions.
    canvas.style.width = '100%';
    canvas.style.height = '100%';

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

  function mount(canvasEl, explicitDogSlot) {
    var el = canvasEl || (global.document && global.document.getElementById(CANVAS_ID));
    if (!el) {
      // Graceful no-op when the canvas is not present.
      return;
    }

    // Idempotent + self-healing: re-mounting with a new canvas or slot
    // refreshes the internal state instead of bailing out early.
    var canvasChanged = (canvas !== el);
    canvas = el;
    ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) {
      canvas = null;
      return;
    }

    // Reset the one-shot draw-error log on every mount.
    drawErrorLogged = false;

    // Resolve the slot: explicit override wins, otherwise re-read the profile
    // only when we don't already have one (preserves prior mount state).
    var slot;
    if (explicitDogSlot !== undefined) {
      slot = explicitDogSlot;
    } else if (activeDogSlot === null || canvasChanged || !dog) {
      slot = readProfile();
    } else {
      slot = activeDogSlot;
    }
    activeDogSlot = slot || null;

    // Refresh the dog from the active slot (appearance may have changed).
    var appearance = resolveAppearance(activeDogSlot);

    var wasMounted = mounted;
    var prevW = fieldWidth;
    var prevH = fieldHeight;

    if (wasMounted && dog) {
      // Re-mount: update appearance in place, preserving live state.
      dog.id = (activeDogSlot && activeDogSlot.id) || appearance.id;
      dog.name = (activeDogSlot && activeDogSlot.name) || appearance.name;
      dog.coat = appearance.coat;
      dog.coatDark = appearance.coatDark;
      dog.coatColor = appearance.coat;
      dog.coatColorDark = appearance.coatDark;
      dog.coatSecondary = appearance.coatSecondary;
      dog.coatKey = appearance.coatKey;
      dog.collar = appearance.collar;
      dog.palette = appearance.palette || null;
      dog.isLeashed = false;
      dog.leash = null;
      dog.leashActive = false;
    } else {
      dog = createDog(appearance);
      if (activeDogSlot) {
        dog.name = activeDogSlot.name || 'Ziggy';
        dog.id = activeDogSlot.id || 'dog-1';
      }
      pose = 'auto';
      forcedState = null;
      enterState('wander');
    }

    // Resize after the visible container is available.
    resizeCanvas();

    // If we were previously mounted at a degenerate (0x0) size and the field
    // is now usable, recenter the dog so it isn't stuck in a corner.
    if (wasMounted && dog &&
        (prevW <= FIELD_PADDING * 2 || prevH <= FIELD_PADDING * 2) &&
        fieldWidth > FIELD_PADDING * 2 && fieldHeight > FIELD_PADDING * 2) {
      dog.x = fieldWidth / 2;
      dog.y = fieldHeight / 2;
      pickWanderTarget();
    }

    if (!mounted) {
      mounted = true;

      resizeHandler = function () {
        resizeCanvas();
      };
      if (global.addEventListener) {
        global.addEventListener('resize', resizeHandler);
      }

      startLoop();
    }

    // Wire hunger integration (idempotent).
    startHungerIntegration();
  }

  function unmount() {
    if (!mounted) return;

    mounted = false;
    stopLoop();
    stopHungerIntegration();

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
    activeDogSlot = null;
    forcedState = null;
    grassBlades = [];
    particles = [];
    particleFrame = 0;
    drawErrorLogged = false;
  }

  function getDogSlot() {
    return activeDogSlot;
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
      state: dog.state,
      coatColor: dog.coatColor,
      coatColorDark: dog.coatColorDark,
      coatKey: dog.coatKey,
      collar: dog.collar,
      isLeashed: dog.isLeashed,
      leash: dog.leash,
      isHungry: Boolean(dog.isHungry),
      hunger: dog.hunger || null,
      setHunger: dogSetHunger,
      playHungryAnimation: dogPlayHungryAnimation,
      playFeedReaction: dogPlayFeedReaction,
      playNeedHungryAnimation: playNeedHungryAnimation,
      playNeedGroomingAnimation: playNeedGroomingAnimation,
      playGroomingAnimation: playGroomingAnimation,
      playNeedRestAnimation: playNeedRestAnimation,
      playSleepingAnimation: playSleepingAnimation,
      playNeedMetReaction: playNeedMetReaction
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
    if (!dog) return;

    if (nextState === 'wander' || nextState === null) {
      forcedState = null;
      dog.state = 'wander';
      pickWanderTarget();
      stateTimer = 0;
      return;
    }

    if (STATES.indexOf(nextState) === -1) return;

    forcedState = nextState;
    enterState(nextState);
  }

  function resumeRoaming() {
    pose = 'auto';
    forcedState = null;
    if (dog) {
      dog.state = 'wander';
      stateTimer = 0;
      pickWanderTarget();
    }
  }

  // ---------------------------------------------------------------------------
  // Care actions & rejection animation
  // ---------------------------------------------------------------------------

  function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  // Resolve whether the dog currently needs a given care kind.
  // Single source of truth: prefer the shared DogStateStore methods
  // (isHungry / needsGrooming / isTired) so this never diverges from
  // home_feeding.isCareNeeded(). Falls back to the dog entity getters.
  function isCareReady(kind) {
    var store = resolveHungerStore();
    if (store) {
      try {
        if (kind === 'feed' && typeof store.isHungry === 'function') {
          return Boolean(store.isHungry());
        }
        if (kind === 'groom' && typeof store.needsGrooming === 'function') {
          return Boolean(store.needsGrooming());
        }
        if (kind === 'rest' && typeof store.isTired === 'function') {
          return Boolean(store.isTired());
        }
      } catch (e) {
        /* fall through to entity getters */
      }
    }

    var entity = (typeof getDog === 'function') ? getDog() : dog;
    if (kind === 'feed') {
      if (entity && typeof entity.isHungry === 'boolean') return entity.isHungry;
      return Boolean(dog && dog.isHungry);
    }
    if (kind === 'groom') {
      if (entity && typeof entity.needsGrooming === 'boolean') return entity.needsGrooming;
      return Boolean(dog && dog.needsGrooming);
    }
    if (kind === 'rest') {
      if (entity && typeof entity.isTired === 'boolean') return entity.isTired;
      return Boolean(dog && dog.isTired);
    }
    return false;
  }

  // Clear the rejection animation state and remove the visual class.
  function clearRejection() {
    rejectionActive = false;
    rejectionEndsAt = 0;
    rejectionFrame = 0;
    rejectionStartedAt = 0;
    rejectionOffsetX = 0;
    rejectionOffsetY = 0;
    rejectionHeadShake = 0;
    if (dog) {
      dog.rejectionActive = false;
      dog.rejectionEndsAt = 0;
      dog.rejectionFrame = 0;
    }
  }

  // Play the short head-shake + hop-back rejection animation.
  // Restarts cleanly when re-entered (resets the animation frame counter).
  function playRejection() {
    rejectionActive = true;
    rejectionStartedAt = nowMs();
    rejectionEndsAt = rejectionStartedAt + REJECTION_ANIM_MS;
    rejectionFrame = 0;
    rejectionOffsetX = 0;
    rejectionOffsetY = 0;
    rejectionHeadShake = 0;
    if (dog) {
      dog.rejectionActive = true;
      dog.rejectionEndsAt = rejectionEndsAt;
      dog.rejectionFrame = 0;
    }
    return true;
  }

  // Compute the current visual rejection offset (head shake + hop-back).
  // Returns { dx, dy, shake } in CSS pixels / radians.
  function computeRejectionOffset() {
    if (!rejectionActive) return { dx: 0, dy: 0, shake: 0 };
    var elapsed = nowMs() - rejectionStartedAt;
    var t = clamp(elapsed / REJECTION_ANIM_MS, 0, 1);
    // Ease-out envelope so the motion settles before clearing.
    var envelope = 1 - t;
    // Head shake: fast sine oscillation, damped over the window.
    var shake = Math.sin(t * Math.PI * 6) * 0.35 * envelope;
    // Hop-back: small backward offset that returns to origin.
    var hop = Math.sin(t * Math.PI) * 6 * envelope;
    return { dx: 0, dy: -hop, shake: shake };
  }

  // Tick the rejection animation; clears it once the duration elapses.
  function updateRejection() {
    if (!rejectionActive) return;
    rejectionFrame++;
    if (dog) dog.rejectionFrame = rejectionFrame;
    var offset = computeRejectionOffset();
    rejectionOffsetX = offset.dx;
    rejectionOffsetY = offset.dy;
    rejectionHeadShake = offset.shake;
    if (nowMs() >= rejectionEndsAt) {
      clearRejection();
    }
  }

  // Single entry point for all care button clicks.
  // Routes to the existing care routine when the dog needs the care, otherwise
  // plays the rejection animation without mutating any care timers/needs.
  function onCareAction(kind) {
    if (kind !== 'feed' && kind !== 'groom' && kind !== 'rest') return false;

    if (!isCareReady(kind)) {
      playRejection();
      return false;
    }

    // Ready: clear any lingering rejection and run the existing routine.
    clearRejection();

    if (kind === 'feed') {
      if (typeof dogPlayFeedReaction === 'function') dogPlayFeedReaction();
      return true;
    }
    if (kind === 'groom') {
      // Invoke the routine, but always report explicit acceptance.
      playGroomingAnimation();
      return true;
    }
    if (kind === 'rest') {
      // Invoke the routine, but always report explicit acceptance.
      playSleepingAnimation();
      return true;
    }
    return false;
  }

  function getFieldSize() {
    return { width: fieldWidth, height: fieldHeight };
  }

  // ---------------------------------------------------------------------------
  // Hunger integration
  // ---------------------------------------------------------------------------

  function resolveHungerStore() {
    if (hungerStore) return hungerStore;
    if (global.__vdwDogStateStore) {
      hungerStore = global.__vdwDogStateStore;
      return hungerStore;
    }
    try {
      if (typeof DogStateStore === 'function') {
        hungerStore = new DogStateStore();
        // Publish so HomeFeeding shares the exact same instance.
        global.__vdwDogStateStore = hungerStore;
        return hungerStore;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  // Apply a hunger snapshot to the sanctuary dog so renderers can react.
  function applyHungerToDog(hungerInfo) {
    if (!dog) return;
    dog.hunger = hungerInfo || null;
    dog.isHungry = Boolean(hungerInfo && hungerInfo.isHungry);
  }

  // Dog-facing hooks consumed by HomeHungerAnimator.
  function dogSetHunger(hungerInfo) {
    applyHungerToDog(hungerInfo);
    return Boolean(dog && dog.isHungry);
  }

  function dogPlayHungryAnimation() {
    if (!dog) return false;
    // Brief wag/whine flourish; does not permanently override roaming.
    if (!forcedState) {
      dog.state = 'wag';
      stateTimer = Math.max(stateTimer, STATE_MIN_MS);
    }
    dog.emoteBubble = '🍖';
    dog.emoteTimer = 2.0;
    dog.bob += 0.5;
    return true;
  }

  // Dog-facing hook invoked once when a feed completes.
  function dogPlayFeedReaction() {
    if (!dog) return false;
    // Happy wag flourish; does not permanently override roaming.
    if (!forcedState) {
      dog.state = 'wag';
      stateTimer = Math.max(stateTimer, STATE_MIN_MS);
    }
    dog.emoteBubble = '❤️';
    dog.emoteTimer = 2.2;
    dog.bob += 0.5;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Sanctuary care animation hooks
  // ---------------------------------------------------------------------------

  function playNeedHungryAnimation() {
    return dogPlayHungryAnimation();
  }

  function playNeedGroomingAnimation() {
    if (!dog) return false;
    dog.emoteBubble = '🫧';
    dog.emoteTimer = 2.0;
    return true;
  }

  // Shared care-action pose: face the camera and sit, mirroring feeding.
  function applyCarePose() {
    if (!dog) return;
    pose = 'camera';
    dog.pose = 'camera';
    dog.facing = Math.PI / 2;
    dog.state = 'sit';
  }

  // Normalise the flexible (options) / (dogArg, options) call contract.
  // Returns { opts, dogArg } where dogArg is only set when a distinct
  // non-options object was passed as the first argument.
  function normalizeCareArgs(arg1, arg2) {
    var opts = {};
    var dogArg = null;
    if (arg1 && typeof arg1 === 'object' && typeof arg1.onComplete === 'function') {
      opts = arg1;
    } else {
      if (arg1 && typeof arg1 === 'object' && arg1 !== dog) {
        dogArg = arg1;
      }
      if (arg2 && typeof arg2 === 'object') {
        opts = arg2;
      }
    }
    return { opts: opts, dogArg: dogArg };
  }

  function playGroomingAnimation(arg1, arg2) {
    // Backwards-compatible: playGroomingAnimation(dog) or (dog, { onComplete })
    // and forward-compatible: playGroomingAnimation({ onComplete }).
    var normalized = normalizeCareArgs(arg1, arg2);
    var opts = normalized.opts;
    var dogArg = normalized.dogArg;
    if (!dog) return false;
    applyCarePose();
    dog.beingGroomed = true;
    dog.groomTimer = 3.0;
    dog.emoteBubble = '🧼';
    dog.emoteTimer = 3.0;
    dog.bob += 0.5;
    // Only overwrite the registered handler when an explicit callback is given.
    if (typeof opts.onComplete === 'function') {
      groomCompleteHandler = opts.onComplete;
    }
    // Mirror state onto an externally supplied dog-like object.
    if (dogArg && typeof dogArg === 'object') {
      dogArg.beingGroomed = true;
      dogArg.groomTimer = 3.0;
      dogArg.emoteBubble = '🧼';
      dogArg.emoteTimer = 3.0;
    }
    return true;
  }

  function playNeedRestAnimation() {
    if (!dog) return false;
    dog.emoteBubble = '💤';
    dog.emoteTimer = 2.0;
    return true;
  }

  function playSleepingAnimation(arg1, arg2) {
    // Backwards-compatible: playSleepingAnimation(dog) or (dog, { onComplete })
    // and forward-compatible: playSleepingAnimation({ onComplete }).
    var normalized = normalizeCareArgs(arg1, arg2);
    var opts = normalized.opts;
    var dogArg = normalized.dogArg;
    if (!dog) return false;
    applyCarePose();
    dog.sleeping = true;
    dog.sleepTimer = 4.0;
    dog.emoteBubble = '💤';
    dog.emoteTimer = 4.0;
    // Only overwrite the registered handler when an explicit callback is given.
    if (typeof opts.onComplete === 'function') {
      restCompleteHandler = opts.onComplete;
    }
    // Mirror state onto an externally supplied dog-like object.
    if (dogArg && typeof dogArg === 'object') {
      dogArg.sleeping = true;
      dogArg.sleepTimer = 4.0;
      dogArg.emoteBubble = '💤';
      dogArg.emoteTimer = 4.0;
    }
    return true;
  }

  function playNeedMetReaction() {
    if (!dog) return false;
    // Only refresh the emote bubble; never shorten grooming/sleeping timers.
    dog.emoteBubble = '❤️';
    dog.emoteTimer = 2.2;
    return true;
  }

  function startHungerIntegration() {
    if (hungerIntegrationActive) return;
    var store = resolveHungerStore();
    if (!store) return;

    hungerIntegrationActive = true;

    // Initial sync.
    try {
      if (typeof store.getHunger === 'function') {
        applyHungerToDog(store.getHunger());
      }
    } catch (e) {
      /* ignore */
    }

    // Subscribe to store updates so the dog reflects feed events.
    if (typeof store.subscribe === 'function') {
      try {
        hungerUnsubscribe = store.subscribe(function () {
          try {
            applyHungerToDog(store.getHunger());
          } catch (e) {
            /* ignore */
          }
        });
      } catch (e) {
        hungerUnsubscribe = null;
      }
    }

    // Periodic hungry animation via HomeHungerAnimator (5000ms default).
    var AnimatorClass = (typeof HomeHungerAnimator === 'function')
      ? HomeHungerAnimator
      : (global.HomeHungerAnimator || null);
    if (AnimatorClass) {
      try {
        hungerAnimator = new AnimatorClass({
          dogStateStore: store,
          dog: {
            setHunger: dogSetHunger,
            playHungryAnimation: dogPlayHungryAnimation,
            playNeedGroomingAnimation: playNeedGroomingAnimation,
            playNeedRestAnimation: playNeedRestAnimation,
            getEmoteTimer: function () { return dog ? dog.emoteTimer : 0; },
            setGroomingState: function (info) {
              if (!dog) return false;
              dog.grooming = info || null;
              dog.needsGrooming = Boolean(info && info.needsGrooming);
              return true;
            },
            setTirednessState: function (info) {
              if (!dog) return false;
              dog.tiredness = info || null;
              dog.isTired = Boolean(info && info.isTired);
              return true;
            }
          }
        });
        if (typeof hungerAnimator.start === 'function') {
          hungerAnimator.start();
        } else if (typeof hungerAnimator.tick === 'function') {
          hungerIntervalId = global.setInterval(function () {
            try { hungerAnimator.tick(); } catch (e) { /* ignore */ }
          }, 1000);
        }
      } catch (e) {
        hungerAnimator = null;
      }
    }
  }

  function stopHungerIntegration() {
    if (hungerIntervalId != null) {
      try { global.clearInterval(hungerIntervalId); } catch (e) { /* ignore */ }
      hungerIntervalId = null;
    }
    if (hungerAnimator && typeof hungerAnimator.stop === 'function') {
      try { hungerAnimator.stop(); } catch (e) { /* ignore */ }
    }
    hungerAnimator = null;
    if (typeof hungerUnsubscribe === 'function') {
      try { hungerUnsubscribe(); } catch (e) { /* ignore */ }
    }
    hungerUnsubscribe = null;
    hungerIntegrationActive = false;
  }

  // Clear any state-driven bowl rendering (called by HomeFeeding on completion).
  function clearBowl() {
    if (dog && (dog.state === 'eating' || dog.state === 'bowl')) {
      dog.state = 'wander';
    }
    forcedState = null;
  }

  var HomeSanctuary = {
    mount: mount,
    unmount: unmount,
    getDogSlot: getDogSlot,
    getDog: function () { return dog; },
    getCompanionDog: getCompanionDog,
    setDogPose: setDogPose,
    setDogState: setDogState,
    resumeRoaming: resumeRoaming,
    getFieldSize: getFieldSize,
    clearBowl: clearBowl,
    onCareAction: onCareAction,
    playRejection: playRejection,
    clearRejection: clearRejection,
    isCareReady: isCareReady,
    REJECTION_ANIM_MS: REJECTION_ANIM_MS,
    playNeedHungryAnimation: playNeedHungryAnimation,
    playNeedGroomingAnimation: playNeedGroomingAnimation,
    playGroomingAnimation: playGroomingAnimation,
    playNeedRestAnimation: playNeedRestAnimation,
    playSleepingAnimation: playSleepingAnimation,
    playNeedMetReaction: playNeedMetReaction,
    setGroomCompleteHandler: function (fn) {
      groomCompleteHandler = typeof fn === 'function' ? fn : null;
    },
    setRestCompleteHandler: function (fn) {
      restCompleteHandler = typeof fn === 'function' ? fn : null;
    },
    __testHooks: {
      frame: function (ts) { frame(ts || 0); },
      getParticles: function () { return particles; },
      spawnParticles: spawnParticles,
      getForcedState: function () { return forcedState; },
      getPose: function () { return pose; },
      updateDog: function (dt) { updateDog(dt); },
      render: function () { render(); },
      getDog: function () { return dog; },
      isHungerIntegrationActive: function () { return hungerIntegrationActive; },
      hasHungerSubscription: function () { return typeof hungerUnsubscribe === 'function'; },
      getHungerAnimator: function () { return hungerAnimator; },
      setHunger: dogSetHunger,
      playHungryAnimation: dogPlayHungryAnimation,
      setWanderTarget: function (x, y) {
        if (!dog) return;
        dog.targetX = x;
        dog.targetY = y;
      },
      onCareAction: onCareAction,
      playRejection: playRejection,
      clearRejection: clearRejection,
      updateRejection: updateRejection,
      isCareReady: isCareReady,
      isRejectionActive: function () { return rejectionActive; },
      getRejectionEndsAt: function () { return rejectionEndsAt; },
      getRejectionFrame: function () { return rejectionFrame; },
      REJECTION_ANIM_MS: REJECTION_ANIM_MS
    }
  };

  global.HomeSanctuary = HomeSanctuary;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HomeSanctuary;
  }
})(typeof window !== 'undefined' ? window : this);
