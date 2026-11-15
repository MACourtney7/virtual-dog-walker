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
  var liveDogEntity = null; // optional real CompanionDog instance
  var pose = 'auto'; // 'auto' | 'camera'
  var stateTimer = 0;
  var forcedState = null; // when set via setDogState, holds until cleared

  var grassBlades = [];
  var noiseSeed = 1337;

  var particles = [];
  var particleFrame = 0;

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

  // Known breed coat keys mapped to a primary / dark / secondary color trio.
  var COAT_KEY_COLORS = {
    CHOCOLATE_TAN: { primary: '#3e2723', dark: '#2b1712', secondary: '#d7ccc8' },
    GOLDEN: { primary: '#eab308', dark: '#ca8a04', secondary: '#fef08a' },
    BLACK_LAB: { primary: '#1e293b', dark: '#0f172a', secondary: '#475569' },
    BEAGLE: { primary: '#b45309', dark: '#78350f', secondary: '#ffffff' },
    DALMATIAN: { primary: '#f8fafc', dark: '#0f172a', secondary: '#0f172a' }
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

  function drawField() {
    if (!ctx) return;

    // Base turf fill.
    ctx.fillStyle = GRASS_BASE;
    ctx.fillRect(0, 0, fieldWidth, fieldHeight);

    // Diagonal mown meadow stripes (alternating GRASS_MOWN bands).
    ctx.save();
    var stripeWidth = 46;
    var span = fieldWidth + fieldHeight;
    for (var s = -fieldHeight; s < span; s += stripeWidth * 2) {
      // Solid mown-turf band.
      ctx.fillStyle = GRASS_MOWN;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(s + stripeWidth, 0);
      ctx.lineTo(s + stripeWidth - fieldHeight, fieldHeight);
      ctx.lineTo(s - fieldHeight, fieldHeight);
      ctx.closePath();
      ctx.fill();

      // Soft overlay stripe for depth.
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

    // Procedural grass variation patches (light + dark).
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (var i = 0; i < 90; i++) {
      var px = seededRandom() * fieldWidth;
      var py = seededRandom() * fieldHeight;
      var r = 8 + seededRandom() * 22;
      ctx.fillStyle = seededRandom() > 0.5 ? GRASS_LIGHT : GRASS_DARK;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Subtle blade flecks.
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
    if (global.CompanionDog && typeof global.CompanionDog === 'function') {
      return global.CompanionDog;
    }
    if (typeof CompanionDog !== 'undefined' && typeof CompanionDog === 'function') {
      return CompanionDog;
    }
    return null;
  }

  // Build a lightweight entity shaped like a CompanionDog for articulated drawing.
  // `coat` is populated as an object (bodyColor/tanColor/bibColor) so that
  // CompanionDog.prototype.draw can consume it without throwing.
  function buildDogEntity() {
    var coatObj = {
      bodyColor: dog.coatColor || dog.coat || DEFAULT_COAT,
      tanColor: dog.coatSecondary || dog.coatDark || DEFAULT_COAT_DARK,
      bibColor: dog.coatSecondary || '#f5f0e6',
      darkColor: dog.coatColorDark || dog.coatDark || DEFAULT_COAT_DARK
    };
    var entity = {
      x: dog.x,
      y: dog.y,
      angle: pose === 'camera' ? Math.PI / 2 : dog.facing,
      tailAngle: 0,
      legPhase: dog.bob,
      gaitMode: dog.state === 'wander' ? 'walk' : 'idle',
      gaitPhase: dog.bob,
      isSitting: dog.state === 'sit',
      isSniffing: dog.state === 'sniff',
      coat: coatObj,
      coatColor: dog.coatColor,
      coatColorDark: dog.coatColorDark,
      coatDark: dog.coatDark,
      collarColor: dog.collar,
      name: dog.name,
      state: dog.state
    };
    return entity;
  }

  // Build a render-only adapter that copies visual properties from a live
  // CompanionDog entity WITHOUT mutating it. The live entity is treated as
  // strictly read-only.
  function buildRenderAdapter(live) {
    var coatObj = live.coat && typeof live.coat === 'object'
      ? live.coat
      : {
          bodyColor: live.coatColor || live.coat || DEFAULT_COAT,
          tanColor: live.coatColorDark || live.coatDark || DEFAULT_COAT_DARK,
          bibColor: '#f5f0e6',
          darkColor: live.coatColorDark || live.coatDark || DEFAULT_COAT_DARK
        };
    return {
      x: dog.x,
      y: dog.y,
      angle: pose === 'camera' ? Math.PI / 2 : dog.facing,
      tailAngle: live.tailAngle || 0,
      legPhase: dog.bob,
      gaitMode: dog.state === 'wander' ? 'walk' : 'idle',
      gaitPhase: dog.bob,
      isSitting: dog.state === 'sit',
      isSniffing: dog.state === 'sniff',
      coat: coatObj,
      coatColor: live.coatColor || dog.coatColor,
      coatColorDark: live.coatColorDark || dog.coatColorDark,
      coatDark: live.coatDark || dog.coatDark,
      collarColor: live.collarColor || dog.collar,
      name: live.name || dog.name,
      state: dog.state
    };
  }

  // Draw the articulated top-down canine body (CompanionDog-style).
  function drawArticulatedDog(entity) {
    var coatObj = entity.coat && typeof entity.coat === 'object' ? entity.coat : null;
    var coat = entity.coatColor || (coatObj && coatObj.bodyColor) ||
      (typeof entity.coat === 'string' ? entity.coat : null) || DEFAULT_COAT;
    var coatDark = entity.coatColorDark || entity.coatDark ||
      (coatObj && (coatObj.darkColor || coatObj.tanColor)) || DEFAULT_COAT_DARK;
    var collar = entity.collarColor || entity.collar || DEFAULT_COLLAR;
    var angle = entity.angle;
    var R = DOG_RADIUS;

    ctx.save();
    ctx.translate(entity.x, entity.y);

    // Shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, R * 0.85, R * 1.05, R * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(angle);

    // Legs (articulated paws with leg cycling while walking).
    var legSwing = Math.sin(entity.legPhase || 0) * (entity.isSitting ? 0 : 3);
    ctx.fillStyle = coatDark;
    var legPositions = entity.isSitting
      ? [[-R * 0.5, R * 0.55], [R * 0.5, R * 0.55]]
      : [[-R * 0.55, R * 0.5 + legSwing], [R * 0.55, R * 0.5 - legSwing],
         [-R * 0.55, -R * 0.5 - legSwing], [R * 0.55, -R * 0.5 + legSwing]];
    for (var l = 0; l < legPositions.length; l++) {
      ctx.beginPath();
      ctx.ellipse(legPositions[l][0], legPositions[l][1], R * 0.22, R * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Torso.
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.7, R * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // Darker back patch.
    ctx.fillStyle = coatDark;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.15, R * 0.5, R * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Collar.
    ctx.strokeStyle = collar;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, R * 0.55, R * 0.5, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();

    // Tail — wags during wander/wag.
    var tailWag = Math.sin((entity.legPhase || 0) * 1.6) * 0.6;
    ctx.strokeStyle = coatDark;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.9);
    ctx.lineTo(Math.sin(tailWag) * R * 0.6, -R * 1.5);
    ctx.stroke();

    // Head — drops toward ground when sniffing.
    var headY = entity.isSniffing ? R * 0.95 : R * 0.85;
    var headR = R * 0.55;

    // Floppy ears.
    ctx.fillStyle = coatDark;
    ctx.beginPath();
    ctx.ellipse(-headR * 0.85, headY, headR * 0.35, headR * 0.6, 0.3, 0, Math.PI * 2);
    ctx.ellipse(headR * 0.85, headY, headR * 0.35, headR * 0.6, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Head.
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Snout.
    ctx.fillStyle = coatDark;
    ctx.beginPath();
    ctx.ellipse(0, headY + headR * 0.55, headR * 0.4, headR * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes.
    ctx.fillStyle = '#1f1f1f';
    ctx.beginPath();
    ctx.arc(-headR * 0.35, headY - headR * 0.1, 1.8, 0, Math.PI * 2);
    ctx.arc(headR * 0.35, headY - headR * 0.1, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Nose.
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(0, headY + headR * 0.7, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Name tag (drawn unrotated above the dog).
    if (entity.name) {
      ctx.save();
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillText(entity.name, entity.x, entity.y - R * 1.7);
      ctx.restore();
    }
  }

  function drawFoodBowl() {
    if (!ctx || !dog) return;
    var bx = dog.x;
    var by = dog.y + 16;

    // Bowl body.
    ctx.save();
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

  function drawDog() {
    if (!ctx || !dog) return;

    // Prefer a real CompanionDog entity when available, but never mutate it:
    // build a render-only adapter that copies visual properties.
    var entity = liveDogEntity ? buildRenderAdapter(liveDogEntity) : buildDogEntity();

    var CompanionDogClass = getCompanionDogClass();
    if (CompanionDogClass && typeof CompanionDogClass.prototype.draw === 'function') {
      try {
        CompanionDogClass.prototype.draw.call(entity, ctx);
      } catch (e) {
        drawArticulatedDog(entity);
      }
    } else {
      drawArticulatedDog(entity);
    }

    // Food bowl during bowl/eating phases.
    if (isBowlVisible()) {
      drawFoodBowl();
    }
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

    // Pin the CSS layout box so DPR scaling never expands the DOM element.
    canvas.style.width = fieldWidth + 'px';
    canvas.style.height = fieldHeight + 'px';

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

  function mount(canvasEl, explicitDogSlot, liveDog) {
    if (mounted) return;

    var el = canvasEl || (global.document && global.document.getElementById(CANVAS_ID));
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

    var slot = explicitDogSlot;
    if (slot === undefined) {
      slot = readProfile();
    }
    activeDogSlot = slot || null;

    // Accept an explicit live CompanionDog entity, else a globally published one.
    liveDogEntity = liveDog || global.__vdwLiveDog || null;

    var appearance = resolveAppearance(activeDogSlot);
    dog = createDog(appearance);
    if (activeDogSlot) {
      dog.name = activeDogSlot.name || 'Ziggy';
      dog.id = activeDogSlot.id || 'dog-1';
    }
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
    activeDogSlot = null;
    liveDogEntity = null;
    forcedState = null;
    grassBlades = [];
    particles = [];
    particleFrame = 0;
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
      coatColorDark: dog.coatColorDark
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

  function getFieldSize() {
    return { width: fieldWidth, height: fieldHeight };
  }

  // Clear any state-driven bowl rendering (called by HomeFeeding on completion).
  function clearBowl() {
    if (dog && dog.state === 'eating') {
      dog.state = 'wander';
    }
    forcedState = null;
  }

  var HomeSanctuary = {
    mount: mount,
    unmount: unmount,
    getDogSlot: getDogSlot,
    getCompanionDog: getCompanionDog,
    setDogPose: setDogPose,
    setDogState: setDogState,
    resumeRoaming: resumeRoaming,
    getFieldSize: getFieldSize,
    clearBowl: clearBowl,
    __testHooks: {
      getParticles: function () { return particles; },
      spawnParticles: spawnParticles,
      getForcedState: function () { return forcedState; },
      getPose: function () { return pose; },
      updateDog: function (dt) { updateDog(dt); },
      render: function () { render(); },
      setWanderTarget: function (x, y) {
        if (!dog) return;
        dog.targetX = x;
        dog.targetY = y;
      }
    }
  };

  global.HomeSanctuary = HomeSanctuary;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HomeSanctuary;
  }
})(typeof window !== 'undefined' ? window : this);
