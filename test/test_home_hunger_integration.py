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
"""


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestHomeFeedingDogStateStore(unittest.TestCase):
    def test_feed_click_resets_hunger_timer(self):
        script = DOM_SHIM + r"""
import { DogStateStore } from './src/state/dog_state_store.js';

// Seed a store that is already hungry.
const store = new DogStateStore({ storage: null, now: () => 0 });
store.feed(0);
const before = store.getHunger(200000);

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
const after = store.getHunger(200000);

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
        self.assertEqual(data["afterLastFedAt"], 200000)
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

HomeFeeding.unmount();

console.log(JSON.stringify({
  hasBar: !!bar,
  hasBtn: !!btn,
  clickListenerCount: clickListeners.length,
  storeResolved: HomeFeeding.getDogStateStore() === store
}));
"""
        data = run_node(script)
        self.assertTrue(data["hasBar"])
        self.assertTrue(data["hasBtn"])
        # Exactly one click listener bound despite double mount.
        self.assertEqual(data["clickListenerCount"], 1)
        self.assertTrue(data["storeResolved"])


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

const store = new DogStateStore({ storage: null, now: () => 0 });
store.feed(0);
globalThis.__vdwDogStateStore = store;

const canvas = globalThis.__domShim.makeEl('canvas');
canvas.id = 'home-field-canvas';
globalThis.__domShim.elements.set('home-field-canvas', canvas);

await import('./src/ui/home_sanctuary.js');
const HomeSanctuary = globalThis.HomeSanctuary;
HomeSanctuary.mount(canvas, { id: 'dog-1', name: 'Ziggy' });

const hooks = HomeSanctuary.__testHooks;
const dogBefore = hooks.getDog();
const hungryBefore = dogBefore ? dogBefore.isHungry : null;

// Feeding resets the timer; the subscription should clear the hungry flag.
store.feed(200000);
const dogAfter = hooks.getDog();
const hungryAfter = dogAfter ? dogAfter.isHungry : null;

HomeSanctuary.unmount();

console.log(JSON.stringify({ hungryBefore, hungryAfter }));
"""
        data = run_node(script)
        self.assertTrue(data["hungryBefore"])
        self.assertFalse(data["hungryAfter"])


if __name__ == "__main__":
    unittest.main()
