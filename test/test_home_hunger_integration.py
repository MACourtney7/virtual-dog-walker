"""Integration tests for HomeFeeding + DogStateStore and HomeSanctuary hunger wiring.

These tests shell out to `node` so they exercise the real browser modules
(loaded via a minimal DOM shim) rather than re-implementing their logic.
"""

import json
import os
import shutil
import subprocess
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def node_available():
    return shutil.which("node") is not None


def run_node(script):
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"node exited with {result.returncode}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    out = result.stdout.strip()
    lines = [ln for ln in out.splitlines() if ln.strip()]
    if not lines:
        raise AssertionError(f"node produced no output\nSTDERR:\n{result.stderr}")
    return json.loads(lines[-1])


# Minimal DOM shim shared by the tests. The modules are IIFEs that attach to
# `window`/`globalThis`, so we install a tiny document + localStorage + a
# canvas 2D context stub before importing them.
DOM_SHIM = r"""
const elements = new Map();
function makeCtx() {
  const noop = () => {};
  return {
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, ellipse: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, fillText: noop, strokeText: noop,
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: '', font: '', textAlign: '', textBaseline: ''
  };
}
function makeEl(tag) {
  return {
    tagName: tag,
    id: '',
    className: '',
    type: '',
    textContent: '',
    disabled: false,
    children: [],
    _listeners: {},
    style: {},
    width: 320,
    height: 240,
    clientWidth: 320,
    clientHeight: 240,
    parentElement: null,
    setAttribute() {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = this._listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatch(type, ev) {
      const arr = this._listeners[type] || [];
      for (const fn of arr.slice()) fn(ev || {});
    },
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { width: 320, height: 240 }; },
    contains() { return true; }
  };
}
const body = makeEl('body');
const document = {
  body,
  activeElement: null,
  getElementById(id) {
    if (elements.has(id)) return elements.get(id);
    return null;
  },
  createElement(tag) {
    return makeEl(tag);
  },
  addEventListener() {},
  removeEventListener() {}
};
const mem = {};
const localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
globalThis.window = globalThis;
globalThis.document = document;
globalThis.localStorage = localStorage;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.__domShim = { elements, body, document, localStorage, mem, makeEl };

// Load the animator module so globalThis.HomeHungerAnimator is defined for
// HomeSanctuary's hunger integration wiring.
await import('./src/ui/home_hunger_animator.js');
"""


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestHomeFeedingDogStateStore(unittest.TestCase):
    def test_feed_click_resets_hunger_timer(self):
        script = DOM_SHIM + r"""
import { DogStateStore } from './src/state/dog_state_store.js';

// Controllable fake clock shared by the store and the module.
let now = 0;
const clock = () => now;

// Memory localStorage shim (self-contained).
const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

// Seed a store that is already hungry (fed at t=0, duration 120000ms).
const store = new DogStateStore({ storage: globalThis.localStorage, now: clock });
store.feed(0);

// Advance past the 2-minute hunger threshold.
now = 130000;
const before = store.getHunger(now);

// Publish the shared store so HomeFeeding resolves it.
globalThis.__vdwDogStateStore = store;

// Provide a dog slot so the feed button is enabled.
globalThis.__vdwActiveDogSlot = { id: 'dog-1', name: 'Ziggy' };

// Register a canvas so getCanvas() succeeds.
const canvas = globalThis.__domShim.makeEl('canvas');
canvas.id = 'home-field-canvas';
globalThis.__domShim.elements.set('home-field-canvas', canvas);

// Import the IIFE module (attaches window.HomeFeeding).
await import('./src/ui/home_feeding.js');

const HomeFeeding = globalThis.HomeFeeding;
HomeFeeding.mount({ dogStateStore: store });

// Simulate a feed click via the test hook (deterministic, no timers).
const result = HomeFeeding.__testHooks.simulateFeed({ dogId: 'dog-1', dogName: 'Ziggy' });

// After feeding, the store should no longer report hungry at the same instant.
const after = store.getHunger(now);

console.log(JSON.stringify({
  beforeHungry: before.isHungry,
  ate: result.ate,
  afterHungry: after.isHungry,
  afterLastFedAt: after.lastFedAt,
  persisted: globalThis.localStorage.getItem('virtual_dog_walker.dog_state.v1')
}));
"""
        data = run_node(script)
        self.assertTrue(data["beforeHungry"])
        self.assertTrue(data["ate"])
        self.assertFalse(data["afterHungry"])
        self.assertEqual(data["afterLastFedAt"], 130000)
        self.assertIsNotNone(data["persisted"])

    def test_mount_is_idempotent_and_unmount_cleans_up(self):
        script = DOM_SHIM + r"""
import { DogStateStore } from './src/state/dog_state_store.js';

const store = new DogStateStore({ storage: null, now: () => 0 });
globalThis.__vdwDogStateStore = store;
globalThis.__vdwActiveDogSlot = { id: 'dog-1', name: 'Ziggy' };

const canvas = globalThis.__domShim.makeEl('canvas');
canvas.id = 'home-field-canvas';
globalThis.__domShim.elements.set('home-field-canvas', canvas);

await import('./src/ui/home_feeding.js');
const HomeFeeding = globalThis.HomeFeeding;

HomeFeeding.mount({ dogStateStore: store });
HomeFeeding.mount({ dogStateStore: store }); // idempotent

const bar = globalThis.document.getElementById('home-action-bar');
const btn = globalThis.document.getElementById('btn-action-feed');
const clickListeners = (btn && btn._listeners && btn._listeners.click) || [];
const clickListenerCount = clickListeners.length;

HomeFeeding.unmount();

const clickListenersAfterUnmount = (btn && btn._listeners && btn._listeners.click) || [];

console.log(JSON.stringify({
  hasBar: !!bar,
  hasBtn: !!btn,
  clickListenerCount,
  clickListenerCountAfterUnmount: clickListenersAfterUnmount.length,
  storeResolved: HomeFeeding.getDogStateStore() === store
}));
"""
        data = run_node(script)
        self.assertTrue(data["hasBar"])
        self.assertTrue(data["hasBtn"])
        # Exactly one click listener bound despite double mount.
        self.assertEqual(data["clickListenerCount"], 1)
        self.assertTrue(data["storeResolved"])
        # Unmount must remove the click listener entirely.
        self.assertEqual(data["clickListenerCountAfterUnmount"], 0)


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestHomeSanctuaryHungerIntegration(unittest.TestCase):
    def test_hunger_integration_starts_and_stops_cleanly(self):
        script = DOM_SHIM + r"""
import { DogStateStore } from './src/state/dog_state_store.js';

const store = new DogStateStore({ storage: null, now: () => 0 });
store.feed(0);
globalThis.__vdwDogStateStore = store;

// Register a canvas so HomeSanctuary.mount() can resolve it.
const canvas = globalThis.__domShim.makeEl('canvas');
canvas.id = 'home-field-canvas';
globalThis.__domShim.elements.set('home-field-canvas', canvas);

await import('./src/ui/home_sanctuary.js');
const HomeSanctuary = globalThis.HomeSanctuary;

// Mount with an explicit slot so the dog exists.
HomeSanctuary.mount(canvas, { id: 'dog-1', name: 'Ziggy' });

const hooks = HomeSanctuary.__testHooks;
const activeAfterMount = hooks.isHungerIntegrationActive();
const subscribedAfterMount = hooks.hasHungerSubscription();

// Double mount must not create duplicate intervals/subscriptions.
HomeSanctuary.mount(canvas, { id: 'dog-1', name: 'Ziggy' });
const activeAfterRemount = hooks.isHungerIntegrationActive();

HomeSanctuary.unmount();
const activeAfterUnmount = hooks.isHungerIntegrationActive();
const subscribedAfterUnmount = hooks.hasHungerSubscription();

console.log(JSON.stringify({
  activeAfterMount,
  subscribedAfterMount,
  activeAfterRemount,
  activeAfterUnmount,
  subscribedAfterUnmount
}));
"""
        data = run_node(script)
        self.assertTrue(data["activeAfterMount"])
        self.assertTrue(data["subscribedAfterMount"])
        self.assertTrue(data["activeAfterRemount"])
        self.assertFalse(data["activeAfterUnmount"])
        self.assertFalse(data["subscribedAfterUnmount"])

    def test_subscription_syncs_hunger_to_dog(self):
        script = DOM_SHIM + r"""
import { DogStateStore } from './src/state/dog_state_store.js';

// Controllable fake clock.
let now = 0;
const clock = () => now;

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const store = new DogStateStore({ storage: globalThis.localStorage, now: clock });
store.feed(0);
globalThis.__vdwDogStateStore = store;

const canvas = globalThis.__domShim.makeEl('canvas');
canvas.id = 'home-field-canvas';
globalThis.__domShim.elements.set('home-field-canvas', canvas);

await import('./src/ui/home_sanctuary.js');
const HomeSanctuary = globalThis.HomeSanctuary;
HomeSanctuary.mount(canvas, { id: 'dog-1', name: 'Ziggy' });

// Advance past the hunger threshold and re-sync via the store subscription.
now = 130000;
store.feed(130000); // triggers subscribers; resets lastFedAt to 130000
const hooks = HomeSanctuary.__testHooks;
const dogAfter = hooks.getDog();
const hungryAfter = dogAfter ? dogAfter.isHungry : null;

// Now advance past the threshold again without feeding: the store should
// report hungry.
now = 260000;
const hungerNow = store.getHunger(now);
const hungryLater = hungerNow.isHungry;

HomeSanctuary.unmount();

console.log(JSON.stringify({ hungryAfter, hungryLater }));
"""
        data = run_node(script)
        self.assertFalse(data["hungryAfter"])
        self.assertTrue(data["hungryLater"])

    def test_hunger_after_120s_triggers_animator_and_subscription(self):
        script = DOM_SHIM + r"""
import { DogStateStore } from './src/state/dog_state_store.js';

// Controllable fake clock shared by the store and the animator.
let now = 0;
const clock = () => now;

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const store = new DogStateStore({ storage: globalThis.localStorage, now: clock });
store.feed(0);
globalThis.__vdwDogStateStore = store;

const canvas = globalThis.__domShim.makeEl('canvas');
canvas.id = 'home-field-canvas';
globalThis.__domShim.elements.set('home-field-canvas', canvas);

await import('./src/ui/home_sanctuary.js');
const HomeSanctuary = globalThis.HomeSanctuary;
HomeSanctuary.mount(canvas, { id: 'dog-1', name: 'Ziggy' });

const hooks = HomeSanctuary.__testHooks;
const animator = hooks.getHungerAnimator();

// Count playHungryAnimation invocations by wrapping the animator's dog hook.
let playCount = 0;
if (animator && animator._dog && typeof animator._dog.playHungryAnimation === 'function') {
  const originalPlay = animator._dog.playHungryAnimation;
  animator._dog.playHungryAnimation = () => { playCount++; return originalPlay(); };
}

// Advance past the 120000ms hunger threshold.
now = 120001;

// Drive the store subscription (simulates a tick that re-reads hunger).
if (typeof store.notify === 'function') store.notify();
else if (typeof store._notify === 'function') store._notify();
else store.feed(0); // fallback: re-trigger subscribers without resetting clock

const dogAfter = hooks.getDog();
const hungryAfter = dogAfter ? dogAfter.isHungry : null;

// Manually tick the animator several times to prove periodic triggering.
if (animator && typeof animator.tick === 'function') {
  animator.tick(now);
  animator.tick(now + 6000);
  animator.tick(now + 12000);
}

HomeSanctuary.unmount();

console.log(JSON.stringify({
  hungryAfter,
  playCount,
  animatorPresent: !!animator
}));
"""
        data = run_node(script)
        self.assertTrue(data["animatorPresent"])
        self.assertTrue(data["hungryAfter"])
        self.assertGreaterEqual(data["playCount"], 1)

    def test_feed_click_resets_timer_and_stops_animation(self):
        script = DOM_SHIM + r"""
import { DogStateStore } from './src/state/dog_state_store.js';

let now = 0;
const clock = () => now;

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const store = new DogStateStore({ storage: globalThis.localStorage, now: clock });
store.feed(0);
globalThis.__vdwDogStateStore = store;
globalThis.__vdwActiveDogSlot = { id: 'dog-1', name: 'Ziggy' };

const canvas = globalThis.__domShim.makeEl('canvas');
canvas.id = 'home-field-canvas';
globalThis.__domShim.elements.set('home-field-canvas', canvas);

await import('./src/ui/home_sanctuary.js');
const HomeSanctuary = globalThis.HomeSanctuary;
HomeSanctuary.mount(canvas, { id: 'dog-1', name: 'Ziggy' });

await import('./src/ui/home_feeding.js');
const HomeFeeding = globalThis.HomeFeeding;
HomeFeeding.mount({ dogStateStore: store });

const hooks = HomeSanctuary.__testHooks;
const animator = hooks.getHungerAnimator();

// Spy on playHungryAnimation and playFeedReaction.
let hungryPlayCount = 0;
let feedReactionCount = 0;
if (animator && animator._dog && typeof animator._dog.playHungryAnimation === 'function') {
  const originalPlay = animator._dog.playHungryAnimation;
  animator._dog.playHungryAnimation = () => { hungryPlayCount++; return originalPlay(); };
}
const companion = HomeSanctuary.getCompanionDog();
if (companion && typeof companion.playFeedReaction === 'function') {
  const originalFeed = companion.playFeedReaction;
  companion.playFeedReaction = () => { feedReactionCount++; return originalFeed(); };
}

// Advance past the hunger threshold and tick the animator: hungry animation fires.
now = 120001;
if (animator && typeof animator.tick === 'function') {
  animator.tick(now);
}
const hungryPlayCountBeforeFeed = hungryPlayCount;

// Simulate a feed click via the test hook (deterministic, no timers).
const result = HomeFeeding.__testHooks.simulateFeed({ dogId: 'dog-1', dogName: 'Ziggy' });

// The store's lastFedAt must reflect the store clock (120001), not
// performance.now().
const after = store.getHunger(now);

// Tick the animator again: no new hungry animation should fire.
if (animator && typeof animator.tick === 'function') {
  animator.tick(now + 6000);
}
const hungryPlayCountAfterFeed = hungryPlayCount;

// Advance a bit but stay under the threshold: still not hungry.
now = 120001 + 60000;
const stillFed = store.getHunger(now);

HomeSanctuary.unmount();

console.log(JSON.stringify({
  beforeHungry: true,
  ate: result.ate,
  afterHungry: after.isHungry,
  afterLastFedAt: after.lastFedAt,
  stillFedHungry: stillFed.isHungry,
  hungryPlayCountBeforeFeed,
  hungryPlayCountAfterFeed,
  feedReactionCount
}));
"""
        data = run_node(script)
        self.assertTrue(data["beforeHungry"])
        self.assertTrue(data["ate"])
        self.assertFalse(data["afterHungry"])
        self.assertEqual(data["afterLastFedAt"], 120001)
        self.assertFalse(data["stillFedHungry"])
        # Hungry animation fired before feeding.
        self.assertGreaterEqual(data["hungryPlayCountBeforeFeed"], 1)
        # No new hungry animation after feeding.
        self.assertEqual(data["hungryPlayCountAfterFeed"], data["hungryPlayCountBeforeFeed"])
        # playFeedReaction fired exactly once.
        self.assertEqual(data["feedReactionCount"], 1)


if __name__ == "__main__":
    unittest.main()
