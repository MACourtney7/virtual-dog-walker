/**
 * Home Feeding Care Action & State Machine
 *
 * Owns #home-action-bar and #btn-action-feed. Orchestrates a deterministic
 * feeding state machine (facing -> bowl -> eating -> complete) and persists
 * the last feed timestamp to localStorage.
 *
 * Exposes window.HomeFeeding.
 */
(function () {
  'use strict';

  // SSR / non-browser safe module root.
  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});

  var STORAGE_KEY = 'virtual_dog_walker.last_feed_at';

  // Deterministic phase durations (ms).
  var FACING_MS = 200; // <= 250ms
  var BOWL_MS = 150; // <= 200ms
  var EATING_MS = 3500; // within 3000-4000ms, target 3500ms
  var RESUME_DELAY_MS = 800; // delay before autonomous roaming resumes

  var state = 'idle';
  var mounted = false;
  var feeding = false;
  var lastSimulatedFeedAt = 0;
  var timers = [];
  var actionBarEl = null;
  var feedBtnEl = null;
  var bowlEl = null;
  var lastFeedAt = null;
  var pendingResolve = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function now() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  function clearTimers() {
    for (var i = 0; i < timers.length; i++) {
      clearTimeout(timers[i]);
    }
    timers = [];
  }

  function schedule(fn, ms) {
    var id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function getCanvas() {
    return document.getElementById('home-field-canvas');
  }

  function getDogSlot() {
    if (root.HomeSanctuary && typeof root.HomeSanctuary.getDogSlot === 'function') {
      try {
        return root.HomeSanctuary.getDogSlot();
      } catch (e) {
        return null;
      }
    }

    // Fallback: an explicitly published active slot.
    if (root.__vdwActiveDogSlot !== undefined) {
      return root.__vdwActiveDogSlot;
    }

    // Last resort: read the persisted walker profile. Never assume a dog
    // exists merely because the canvas element is present.
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var raw = localStorage.getItem('clifton_walker_profile');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (parsed.dogSlot === null) return null;
            if (parsed.dogSlot && typeof parsed.dogSlot === 'object') return parsed.dogSlot;
            if (parsed.dogName) return { name: parsed.dogName };
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function setDogPose(pose) {
    if (root.HomeSanctuary && typeof root.HomeSanctuary.setDogPose === 'function') {
      try {
        root.HomeSanctuary.setDogPose(pose);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function setDogState(dogState) {
    if (root.HomeSanctuary && typeof root.HomeSanctuary.setDogState === 'function') {
      try {
        root.HomeSanctuary.setDogState(dogState);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function emitToast(message) {
    if (root.HomeSanctuary && typeof root.HomeSanctuary.toast === 'function') {
      try {
        root.HomeSanctuary.toast(message);
        return;
      } catch (e) {
        /* fall through */
      }
    }
    if (typeof root.showToast === 'function') {
      try {
        root.showToast(message);
        return;
      } catch (e) {
        /* fall through */
      }
    }
    // Last resort: no-op (toast is best-effort).
  }

  function persistFeed(dogId) {
    var value = JSON.stringify({
      dogId: String(dogId || 'dog-1'),
      at: new Date().toISOString()
    });
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem(STORAGE_KEY, value);
      }
    } catch (e) {
      /* storage may be unavailable; ignore */
    }
    lastFeedAt = value;
    return value;
  }

  function readLastFeedAt() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        return localStorage.getItem(STORAGE_KEY);
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  function ensureActionBar() {
    if (actionBarEl && document.body.contains(actionBarEl)) {
      return actionBarEl;
    }
    // Prefer the existing container (e.g. rendered by SocialHUD) so we never
    // detach it from its parent.
    actionBarEl = document.getElementById('home-action-bar');
    if (!actionBarEl) {
      actionBarEl = document.createElement('div');
      actionBarEl.id = 'home-action-bar';
      actionBarEl.className = 'home-action-bar';
      document.body.appendChild(actionBarEl);
    }
    return actionBarEl;
  }

  function ensureFeedButton() {
    var bar = ensureActionBar();
    feedBtnEl = document.getElementById('btn-action-feed');
    if (!feedBtnEl) {
      feedBtnEl = document.createElement('button');
      feedBtnEl.id = 'btn-action-feed';
      // Markup reference: id="btn-action-feed"
      feedBtnEl.type = 'button';
      feedBtnEl.className = 'btn-action btn-action-feed';
      feedBtnEl.textContent = '🍖 Feed';
      bar.appendChild(feedBtnEl);
    }
    if (!feedBtnEl.__homeFeedingBound) {
      feedBtnEl.addEventListener('click', onFeedClick);
      feedBtnEl.__homeFeedingBound = true;
    }
    return feedBtnEl;
  }

  function updateDisabledState() {
    if (!feedBtnEl) return;
    var disabled = getDogSlot() === null || !getCanvas();
    feedBtnEl.disabled = !!disabled;
    feedBtnEl.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  function showBowl() {
    if (bowlEl && document.body.contains(bowlEl)) return bowlEl;
    bowlEl = document.createElement('div');
    bowlEl.id = 'home-food-bowl';
    bowlEl.className = 'home-food-bowl';
    bowlEl.textContent = '🥣';
    bowlEl.setAttribute('aria-hidden', 'true');
    var canvas = getCanvas();
    if (canvas && canvas.parentNode) {
      canvas.parentNode.appendChild(bowlEl);
    } else {
      document.body.appendChild(bowlEl);
    }
    return bowlEl;
  }

  function clearBowl() {
    if (bowlEl && bowlEl.parentNode) {
      bowlEl.parentNode.removeChild(bowlEl);
    }
    bowlEl = null;
    // Notify the sanctuary so any state-driven bowl rendering is cleared too.
    if (root.HomeSanctuary && typeof root.HomeSanctuary.clearBowl === 'function') {
      try { root.HomeSanctuary.clearBowl(); } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------

  function setState(next) {
    state = next;
  }

  function runFeed(opts) {
    opts = opts || {};
    var dogId = opts.dogId || 'dog-1';
    var dogName = opts.dogName || 'Ziggy';

    return new Promise(function (resolve) {
      if (feeding) {
        // Idempotent guard: ignore second click during active feed.
        resolve();
        return;
      }
      feeding = true;
      clearTimers();
      pendingResolve = resolve;

      var start = now();

      // Phase 1: facing (<= 250ms)
      setState('facing');
      setDogPose('camera');

      schedule(function () {
        // Phase 2: bowl (<= 200ms)
        setState('bowl');
        showBowl();

        schedule(function () {
          // Phase 3: eating (3000-4000ms)
          setState('eating');
          setDogState('eating');

          schedule(function () {
            // Phase 4: complete (instant)
            setState('complete');
            clearBowl();

            var toast = dogName + ' loved the meal! ❤️';
            emitToast(toast);

            persistFeed(dogId);

            // Expose duration for test hooks via closure variable.
            runFeed.__lastDuration = Math.round(now() - start);

            // Phase 5: resume autonomous roaming after a short delay.
            schedule(function () {
              setState('idle');
              feeding = false;
              setDogPose('auto');
              setDogState('wander');
              if (root.HomeSanctuary && typeof root.HomeSanctuary.resumeRoaming === 'function') {
                try { root.HomeSanctuary.resumeRoaming(); } catch (e) {}
              }
              updateDisabledState();
              pendingResolve = null;
              resolve();
            }, RESUME_DELAY_MS);
          }, EATING_MS);
        }, BOWL_MS);
      }, FACING_MS);
    });
  }

  function onFeedClick() {
    if (feeding) return;
    var dogSlot = null;
    if (root.HomeSanctuary && typeof root.HomeSanctuary.getDogSlot === 'function') {
      try { dogSlot = root.HomeSanctuary.getDogSlot(); } catch (e) {}
    }
    var dog = null;
    if (root.HomeSanctuary && typeof root.HomeSanctuary.getCompanionDog === 'function') {
      try { dog = root.HomeSanctuary.getCompanionDog(); } catch (e) {}
    }
    var name = (dogSlot && dogSlot.name) || (dog && dog.name) || 'Ziggy';
    var id = (dogSlot && (dogSlot.id || dogSlot.dogId)) || (dog && dog.id) || 'dog-1';
    runFeed({ dogName: name, dogId: id });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function mount() {
    if (mounted) {
      updateDisabledState();
      return;
    }
    mounted = true;
    lastFeedAt = readLastFeedAt();
    ensureActionBar();
    ensureFeedButton();
    updateDisabledState();
  }

  function unmount() {
    mounted = false;
    clearTimers();
    clearBowl();
    feeding = false;
    setState('idle');
    // Resolve any in-flight runFeed promise so callers are never left dangling.
    if (pendingResolve) {
      var r = pendingResolve;
      pendingResolve = null;
      try { r(); } catch (e) { /* ignore */ }
    }
    if (feedBtnEl && feedBtnEl.__homeFeedingBound) {
      feedBtnEl.removeEventListener('click', onFeedClick);
      feedBtnEl.__homeFeedingBound = false;
    }
    // Preserve the #home-action-bar container in the DOM; only clear its
    // children so a subsequent mount() can re-populate it in place.
    if (actionBarEl) {
      actionBarEl.innerHTML = '';
    }
    feedBtnEl = null;
  }

  function feed(opts) {
    return runFeed(opts || {});
  }

  // ---------------------------------------------------------------------------
  // Test hooks
  // ---------------------------------------------------------------------------

  function simulateFeed(opts) {
      opts = opts || {};
      var dogId = opts.dogId || 'dog-1';
      var dogName = opts.dogName || 'Ziggy';

      // Debounce: a second simulated feed within the full feed duration is
      // treated as a click during an active feed and ignored.
      var t = now();
      var fullDuration = FACING_MS + BOWL_MS + EATING_MS;
      if (lastSimulatedFeedAt && (t - lastSimulatedFeedAt) < fullDuration) {
        return {
          ate: false,
          ignored: true,
          toast: null,
          durationMs: 0,
          persistedKey: STORAGE_KEY,
          persistedValue: readLastFeedAt()
        };
      }
      lastSimulatedFeedAt = t;

      var toast = dogName + ' loved the meal! ❤️';
      var persistedValue = persistFeed(dogId);
      var durationMs = fullDuration;

      // Keep state consistent for observers.
      setState('idle');

      return {
        ate: true,
        ignored: false,
        toast: toast,
        durationMs: durationMs,
        persistedKey: STORAGE_KEY,
        persistedValue: persistedValue
      };
  }

  var __testHooks = {
    simulateFeed: simulateFeed,
    runFeed: runFeed,
    onFeedClick: onFeedClick,
    getLastFeedAt: function () {
      return readLastFeedAt();
    },
    getState: function () {
      return state;
    },
    isFeeding: function () {
      return feeding;
    },
    getTimers: function () {
      return timers;
    }
  };

  root.HomeFeeding = {
    mount: mount,
    unmount: unmount,
    feed: feed,
    __testHooks: __testHooks
  };
})();
