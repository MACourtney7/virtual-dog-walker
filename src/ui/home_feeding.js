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

  // Resolve the display name for care-action toasts, mirroring the feed path.
  function resolveDogName() {
    var dogSlot = null;
    if (root.HomeSanctuary && typeof root.HomeSanctuary.getDogSlot === 'function') {
      try { dogSlot = root.HomeSanctuary.getDogSlot(); } catch (e) { /* ignore */ }
    }
    var dog = resolveCompanionDog();
    return (dogSlot && dogSlot.name) || (dog && dog.name) || 'Ziggy';
  }

  // Commit groom side effects exactly once per token.
  function commitGroom(token) {
    if (token === committedGroomToken) return false;
    committedGroomToken = token;
    var store = resolveDogStateStore();
    if (store && typeof store.groom === 'function') {
      try { store.groom(); } catch (e) { /* ignore */ }
    }
    var dogName = resolveDogName();
    var onComplete = function () {
      showToast(dogName + ' loved the groom! ❤️');
    };
    // Prefer the options.onComplete contract; fall back to the setter-based
    // contract (setGroomCompleteHandler) when the sanctuary exposes it.
    var wired = false;
    if (root.HomeSanctuary && typeof root.HomeSanctuary.playGroomingAnimation === 'function') {
      try {
        var res = root.HomeSanctuary.playGroomingAnimation(resolveCompanionDog(), { onComplete: onComplete });
        wired = res !== false;
      } catch (e) { /* fall through */ }
    }
    if (!wired) {
      var handlerRegistered = false;
      if (root.HomeSanctuary && typeof root.HomeSanctuary.setGroomCompleteHandler === 'function') {
        try {
          root.HomeSanctuary.setGroomCompleteHandler(onComplete);
          handlerRegistered = true;
        } catch (e) { /* ignore */ }
      }
      invokeSanctuaryOrDog('playGroomingAnimation');
      // Only toast immediately when nothing else will fire onComplete.
      if (!handlerRegistered) {
        showToast(dogName + ' loved the groom! ❤️');
      }
    }
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
    var dogName = resolveDogName();
    var onComplete = function () {
      showToast(dogName + ' feels well rested! ❤️');
    };
    var wired = false;
    if (root.HomeSanctuary && typeof root.HomeSanctuary.playSleepingAnimation === 'function') {
      try {
        var res = root.HomeSanctuary.playSleepingAnimation(resolveCompanionDog(), { onComplete: onComplete });
        wired = res !== false;
      } catch (e) { /* fall through */ }
    }
    if (!wired) {
      var handlerRegistered = false;
      if (root.HomeSanctuary && typeof root.HomeSanctuary.setRestCompleteHandler === 'function') {
        try {
          root.HomeSanctuary.setRestCompleteHandler(onComplete);
          handlerRegistered = true;
        } catch (e) { /* ignore */ }
      }
      invokeSanctuaryOrDog('playSleepingAnimation');
      // Only toast immediately when nothing else will fire onComplete.
      if (!handlerRegistered) {
        showToast(dogName + ' feels well rested! ❤️');
      }
    }
    playNeedMetReaction();
    return true;
  }

  function showToast(message) {
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

  // Backwards-compatible alias.
  var emitToast = showToast;

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

  // Shared className so Feed / Groom / Rest render identically (REQ-4).
  var ACTION_BUTTON_CLASS = 'btn-action btn-action-feed';

  // Resolve the className Groom/Rest should adopt so they always match Feed's
  // exact className. Prefers a pre-existing #btn-action-feed's className.
  function resolveSharedButtonClass() {
    var existing = document.getElementById('btn-action-feed');
    if (existing && typeof existing.className === 'string' && existing.className) {
      return existing.className;
    }
    return ACTION_BUTTON_CLASS;
  }

  // Minimal shared button factory: guarantees identical className across all
  // three care-action buttons while preserving each button's unique id.
  // When `preserveExisting` is true, an already-present button keeps its
  // existing className and textContent untouched.
  function renderActionButton(id, label, onClick, preserveExisting) {
    var bar = ensureActionBar();
    var btn = document.getElementById(id);
    var existed = Boolean(btn);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = id;
      btn.type = 'button';
      bar.appendChild(btn);
    }
    if (!(preserveExisting && existed)) {
      // Sync the label so newly created buttons get the correct text.
      btn.textContent = label;
      // Enforce the shared className on newly created buttons.
      btn.className = ACTION_BUTTON_CLASS;
    }
    if (!btn.__homeFeedingBound) {
      btn.addEventListener('click', onClick);
      btn.__homeFeedingBound = true;
    }
    return btn;
  }

  function ensureFeedButton() {
    // Preserve a pre-existing Feed button's className/textContent.
    feedBtnEl = renderActionButton('btn-action-feed', '🍖 Feed', onFeedClick, true);
    return feedBtnEl;
  }

  function ensureGroomButton() {
    groomBtnEl = renderActionButton('btn-action-groom', '🫧 Groom', onGroomClick, false);
    // Always match Feed's exact className.
    if (groomBtnEl) groomBtnEl.className = resolveSharedButtonClass();
    return groomBtnEl;
  }

  function ensureRestButton() {
    restBtnEl = renderActionButton('btn-action-rest', '💤 Rest', onRestClick, false);
    // Always match Feed's exact className.
    if (restBtnEl) restBtnEl.className = resolveSharedButtonClass();
    return restBtnEl;
  }

  // Care buttons are ALWAYS clickable (REQ-1). We never set `disabled` or
  // `aria-disabled="true"` on Feed/Groom/Rest; readiness is conveyed purely
  // via a cosmetic `is-needed` class so clicks are never blocked.
  function setButtonNeeded(btn, needed) {
    if (!btn) return;
    // Defensive: ensure the button is never left disabled by prior state.
    btn.disabled = false;
    btn.setAttribute('aria-disabled', 'false');
    if (btn.classList && typeof btn.classList.toggle === 'function') {
      btn.classList.toggle('is-needed', !!needed);
    } else if (typeof btn.className === 'string') {
      var has = (' ' + btn.className + ' ').indexOf(' is-needed ') !== -1;
      if (needed && !has) {
        btn.className = (btn.className + ' is-needed').trim();
      } else if (!needed && has) {
        btn.className = (' ' + btn.className + ' ')
          .replace(' is-needed ', ' ')
          .trim();
      }
    }
  }

  // Resolve whether the dog currently needs a given care kind.
  // Returns false when the store is unavailable (treat as "not needed").
  function isCareNeeded(kind) {
    var store = resolveDogStateStore();
    if (!store) return false;
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
      /* ignore */
    }
    return false;
  }

  // Refresh the cosmetic readiness classes. Never disables any button.
  function updateDisabledState() {
    var noDog = getDogSlot() === null || !getCanvas();
    setButtonNeeded(feedBtnEl, !noDog && isCareNeeded('feed'));
    setButtonNeeded(groomBtnEl, !noDog && isCareNeeded('groom'));
    setButtonNeeded(restBtnEl, !noDog && isCareNeeded('rest'));
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
            showToast(toast);

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
    routeCareAction('feed', function () {
      runFeed({ dogName: name, dogId: id });
    });
  }

  // Route a care click through HomeSanctuary.onCareAction when available so
  // the sanctuary owns the "needed vs. rejection" decision and the visual
  // refusal animation. Falls back to the local readiness check otherwise.
  function routeCareAction(kind, runRoutine) {
    var sanctuary = root.HomeSanctuary;
    if (sanctuary && typeof sanctuary.onCareAction === 'function') {
      var accepted = false;
      try {
        accepted = sanctuary.onCareAction(kind);
      } catch (e) {
        accepted = false;
      }
      if (accepted) {
        runRoutine();
      }
      updateDisabledState();
      return accepted;
    }

    // Fallback: local readiness check + rejection animation.
    if (isCareNeeded(kind)) {
      runRoutine();
      updateDisabledState();
      return true;
    }
    if (sanctuary && typeof sanctuary.playRejection === 'function') {
      try { sanctuary.playRejection(); } catch (e) { /* ignore */ }
    }
    updateDisabledState();
    return false;
  }

  function onGroomClick() {
    routeCareAction('groom', function () {
      groomToken += 1;
      commitGroom(groomToken);
    });
  }

  function onRestClick() {
    routeCareAction('rest', function () {
      restToken += 1;
      commitRest(restToken);
    });
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
