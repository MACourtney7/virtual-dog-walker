/**
 * Home Feeding Care Action & State Machine
 *
 * Owns #home-action-bar and #btn-action-feed. Orchestrates a deterministic
 * feeding state machine (facing -> bowl -> eating -> complete) and persists
 * the last feed timestamp to localStorage.
 *
 * Exposes HomeFeeding on the module root (window in browsers).
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
  var groomBtnEl = null;
  var restBtnEl = null;
  var storeUnsubscribe = null;
  // Periodic refresh so groom/rest buttons re-enable when timers expire.
  var refreshIntervalId = null;
  var REFRESH_INTERVAL_MS = 1000;
  // Per-action dedup tokens so each action's side effects run at most once.
  var groomToken = 0;
  var committedGroomToken = -1;
  var restToken = 0;
  var committedRestToken = -1;
  var lastFeedAt = null;
  var pendingResolve = null;
  var dogStateStore = null;
  // Per-feed token: guarantees store.feed() and playFeedReaction() run at
  // most once per feed action, even if multiple completion paths fire.
  var feedToken = 0;
  var committedFeedToken = -1;
  // Optional injected dog adapter (used by tests / alternate hosts).
  var injectedDog = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function now() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  // Resolve the shared DogStateStore. Prefer an explicitly injected store,
  // then a globally published one, then lazily construct a fresh instance.
  function resolveDogStateStore() {
    if (dogStateStore) return dogStateStore;
    if (root.__vdwDogStateStore) {
      dogStateStore = root.__vdwDogStateStore;
      return dogStateStore;
    }
    try {
      if (typeof DogStateStore === 'function') {
        dogStateStore = new DogStateStore();
        // Publish so HomeSanctuary shares the exact same instance.
        root.__vdwDogStateStore = dogStateStore;
        return dogStateStore;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function getDogStateStore() {
    return resolveDogStateStore();
  }

  function setDogStateStore(store) {
    dogStateStore = store || null;
    if (dogStateStore) {
      root.__vdwDogStateStore = dogStateStore;
    }
    return dogStateStore;
  }

  // Reset the hunger timer on the shared store (if available).
  function resetHungerTimer() {
    var store = resolveDogStateStore();
    if (!store || typeof store.feed !== 'function') return;
    try {
      // Call with no args so DogStateStore uses its own epoch clock
      // (Date.now() or an injected test clock), not performance.now().
      store.feed();
    } catch (e) {
      /* ignore */
    }
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

  // Resolve the companion dog, preferring an explicitly injected adapter so
  // callers (and tests) can supply a stable object.
  function resolveCompanionDog() {
    if (injectedDog) return injectedDog;
    if (root.HomeSanctuary && typeof root.HomeSanctuary.getCompanionDog === 'function') {
      try { return root.HomeSanctuary.getCompanionDog(); } catch (e) { return null; }
    }
    return null;
  }

  // Invoke the companion dog's feed reaction exactly once, if available.
  function triggerFeedReaction() {
    var dog = resolveCompanionDog();
    if (dog && typeof dog.playFeedReaction === 'function') {
      try { dog.playFeedReaction(); } catch (e) { /* ignore */ }
    }
  }

  // Invoke a named method on HomeSanctuary, then fall back to the companion
  // dog. Best-effort: never throws.
  function invokeSanctuaryOrDog(methodName) {
    if (root.HomeSanctuary && typeof root.HomeSanctuary[methodName] === 'function') {
      try { root.HomeSanctuary[methodName](); return true; } catch (e) { /* fall through */ }
    }
    var dog = resolveCompanionDog();
    if (dog && typeof dog[methodName] === 'function') {
      try { dog[methodName](); return true; } catch (e) { /* ignore */ }
    }
    return false;
  }

  // Play the "need met" heart reaction (sanctuary first, then dog).
  function playNeedMetReaction() {
    if (invokeSanctuaryOrDog('playNeedMetReaction')) return true;
    // Fall back to the feed reaction as a heart emote.
    return invokeSanctuaryOrDog('playFeedReaction');
  }

  // Commit the side effects of a feed exactly once per feed token.
  function commitFeed(token, dogId) {
    if (token === committedFeedToken) return false;
    committedFeedToken = token;
    persistFeed(dogId);
    resetHungerTimer();
    triggerFeedReaction();
    playNeedMetReaction();
    return true;
  }

  // Commit groom side effects exactly once per token.
  function commitGroom(token) {
    if (token === committedGroomToken) return false;
    committedGroomToken = token;
    var store = resolveDogStateStore();
    if (store && typeof store.groom === 'function') {
      try { store.groom(); } catch (e) { /* ignore */ }
    }
    invokeSanctuaryOrDog('playGroomingAnimation');
    playNeedMetReaction();
    return true;
  }

  // Commit rest side effects exactly once per token.
  function commitRest(token) {
    if (token === committedRestToken) return false;
    committedRestToken = token;
    var store = resolveDogStateStore();
    if (store && typeof store.rest === 'function') {
      try { store.rest(); } catch (e) { /* ignore */ }
    }
    invokeSanctuaryOrDog('playSleepingAnimation');
    playNeedMetReaction();
    return true;
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

  function ensureGroomButton() {
    var bar = ensureActionBar();
    groomBtnEl = document.getElementById('btn-action-groom');
    if (!groomBtnEl) {
      groomBtnEl = document.createElement('button');
      groomBtnEl.id = 'btn-action-groom';
      groomBtnEl.type = 'button';
      groomBtnEl.className = 'btn-action btn-action-groom';
      groomBtnEl.textContent = 'Groom';
      bar.appendChild(groomBtnEl);
    }
    if (!groomBtnEl.__homeFeedingBound) {
      groomBtnEl.addEventListener('click', onGroomClick);
      groomBtnEl.__homeFeedingBound = true;
    }
    return groomBtnEl;
  }

  function ensureRestButton() {
    var bar = ensureActionBar();
    restBtnEl = document.getElementById('btn-action-rest');
    if (!restBtnEl) {
      restBtnEl = document.createElement('button');
      restBtnEl.id = 'btn-action-rest';
      restBtnEl.type = 'button';
      restBtnEl.className = 'btn-action btn-action-rest';
      restBtnEl.textContent = 'Rest';
      bar.appendChild(restBtnEl);
    }
    if (!restBtnEl.__homeFeedingBound) {
      restBtnEl.addEventListener('click', onRestClick);
      restBtnEl.__homeFeedingBound = true;
    }
    return restBtnEl;
  }

  function setButtonDisabled(btn, disabled) {
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  function updateDisabledState() {
    var noDog = getDogSlot() === null || !getCanvas();
    setButtonDisabled(feedBtnEl, noDog);

    var store = resolveDogStateStore();
    var groomDisabled = noDog;
    var restDisabled = noDog;
    if (store) {
      if (typeof store.needsGrooming === 'function') {
        try { groomDisabled = noDog || !store.needsGrooming(); } catch (e) { /* ignore */ }
      }
      if (typeof store.isTired === 'function') {
        try { restDisabled = noDog || !store.isTired(); } catch (e) { /* ignore */ }
      }
    }
    setButtonDisabled(groomBtnEl, groomDisabled);
    setButtonDisabled(restBtnEl, restDisabled);
  }

  // Subscribe to the store so button readiness refreshes on state changes.
  function subscribeToStore() {
    if (storeUnsubscribe) return;
    var store = resolveDogStateStore();
    if (!store || typeof store.subscribe !== 'function') return;
    try {
      var unsub = store.subscribe(function () { updateDisabledState(); });
      if (typeof unsub === 'function') {
        storeUnsubscribe = unsub;
      } else {
        storeUnsubscribe = function () {};
      }
    } catch (e) {
      /* ignore */
    }
  }

  function unsubscribeFromStore() {
    if (storeUnsubscribe) {
      try { storeUnsubscribe(); } catch (e) { /* ignore */ }
      storeUnsubscribe = null;
    }
  }

  // Re-evaluate button readiness. Called on store changes and on a periodic
  // interval so groom/rest re-enable as soon as their timers expire.
  function refreshButtonStates() {
    updateDisabledState();
  }

  function startRefreshInterval() {
    if (refreshIntervalId !== null) return;
    if (typeof setInterval !== 'function') return;
    refreshIntervalId = setInterval(refreshButtonStates, REFRESH_INTERVAL_MS);
  }

  function stopRefreshInterval() {
    if (refreshIntervalId !== null) {
      try { clearInterval(refreshIntervalId); } catch (e) { /* ignore */ }
      refreshIntervalId = null;
    }
  }

  // The food bowl is rendered natively on the canvas by
  // HomeSanctuary.drawFoodBowl(); no DOM element is ever injected.
  function showBowl() {
    // No-op: bowl rendering is owned by HomeSanctuary.
  }

  function clearBowl() {
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
      feedToken += 1;
      var token = feedToken;

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

            commitFeed(token, dogId);

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
    var dog = resolveCompanionDog();
    var name = (dogSlot && dogSlot.name) || (dog && dog.name) || 'Ziggy';
    var id = (dogSlot && (dogSlot.id || dogSlot.dogId)) || (dog && dog.id) || 'dog-1';
    runFeed({ dogName: name, dogId: id });
  }

  function onGroomClick() {
    if (groomBtnEl && groomBtnEl.disabled) return;
    groomToken += 1;
    commitGroom(groomToken);
    updateDisabledState();
  }

  function onRestClick() {
    if (restBtnEl && restBtnEl.disabled) return;
    restToken += 1;
    commitRest(restToken);
    updateDisabledState();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function mount(opts) {
    opts = opts || {};
    if (opts.dogStateStore) {
      setDogStateStore(opts.dogStateStore);
    } else {
      resolveDogStateStore();
    }
    if (opts.dog) {
      injectedDog = opts.dog;
    }
    if (mounted) {
      updateDisabledState();
      return;
    }
    mounted = true;
    lastFeedAt = readLastFeedAt();
    ensureActionBar();
    ensureFeedButton();
    ensureGroomButton();
    ensureRestButton();
    subscribeToStore();
    updateDisabledState();
    startRefreshInterval();
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
    unsubscribeFromStore();
    stopRefreshInterval();
    if (feedBtnEl && feedBtnEl.__homeFeedingBound) {
      feedBtnEl.removeEventListener('click', onFeedClick);
      feedBtnEl.__homeFeedingBound = false;
    }
    if (groomBtnEl && groomBtnEl.__homeFeedingBound) {
      groomBtnEl.removeEventListener('click', onGroomClick);
      groomBtnEl.__homeFeedingBound = false;
    }
    if (restBtnEl && restBtnEl.__homeFeedingBound) {
      restBtnEl.removeEventListener('click', onRestClick);
      restBtnEl.__homeFeedingBound = false;
    }
    // Preserve the #home-action-bar container in the DOM; only clear its
    // children so a subsequent mount() can re-populate it in place.
    if (actionBarEl) {
      actionBarEl.innerHTML = '';
    }
    feedBtnEl = null;
    groomBtnEl = null;
    restBtnEl = null;
    actionBarEl = null;
    injectedDog = null;
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
      feedToken += 1;
      var token = feedToken;
      commitFeed(token, dogId);
      var persistedValue = lastFeedAt;
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
    onGroomClick: onGroomClick,
    onRestClick: onRestClick,
    commitGroom: commitGroom,
    commitRest: commitRest,
    updateDisabledState: updateDisabledState,
    refreshButtonStates: refreshButtonStates,
    startRefreshInterval: startRefreshInterval,
    stopRefreshInterval: stopRefreshInterval,
    getRefreshIntervalId: function () {
      return refreshIntervalId;
    },
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
    getDogStateStore: getDogStateStore,
    setDogStateStore: setDogStateStore,
    __testHooks: __testHooks
  };
})();
