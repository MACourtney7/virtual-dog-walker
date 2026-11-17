#!/usr/bin/env python3
"""Tests for the care-loop UI (emotes, animations, action bar wiring).

Every case launches a fresh `node --input-type=module -e "..."` subprocess so
that top-level identifiers never collide across scenarios.
"""
import json
import os
import shutil
import subprocess
import textwrap
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def node_available():
    return shutil.which("node") is not None


def run_node(script_body: str) -> dict:
    """Run a fresh node ESM process and parse its JSON stdout."""
    body = textwrap.dedent(script_body)
    result = subprocess.run(
        ["node", "--input-type=module", "-e", body],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=15,
    )
    if result.returncode != 0:
        raise AssertionError(
            "node script failed:\nSTDOUT:\n%s\nSTDERR:\n%s"
            % (result.stdout, result.stderr)
        )
    out = result.stdout.strip()
    if not out:
        raise AssertionError("node script produced no output; stderr:\n%s" % result.stderr)
    last_line = out.splitlines()[-1]
    return json.loads(last_line)


def file_url(rel_path: str) -> str:
    return json.dumps("file://" + os.path.join(REPO_ROOT, rel_path))


# Shared inline DOM shim, injected at the top of each script. Uses a unique
# prefix so it never collides with scenario identifiers.
DOM_SHIM = """
const careLoopShim = (() => {
  const elements = new Map();
  function makeButton(id) {
    const listeners = {};
    const btn = {
      id,
      tagName: 'BUTTON',
      type: 'button',
      className: '',
      textContent: '',
      disabled: false,
      style: {},
      attributes: {},
      children: [],
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(evt, fn) {
        (listeners[evt] = listeners[evt] || []).push(fn);
      },
      removeEventListener(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter((f) => f !== fn);
      },
      click() {
        (listeners['click'] || []).forEach((fn) => fn({ type: 'click', target: this }));
      },
      contains() { return true; },
      _listeners: listeners
    };
    return btn;
  }
  const body = {
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    contains(el) { return true; }
  };
  function findInTree(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    const kids = node.children || [];
    for (const child of kids) {
      const found = findInTree(child, id);
      if (found) return found;
    }
    return null;
  }
  const document = {
    body,
    // NOTE: getElementById does NOT auto-create elements. Callers that need
    // an element must create it via createElement + appendChild, or the test
    // must pre-register it. This mirrors real DOM semantics. It DOES search
    // the registered elements map and the body's child tree (by el.id) so
    // dynamically created + appended elements are discoverable.
    getElementById(id) {
      if (elements.has(id)) return elements.get(id);
      return findInTree(body, id);
    },
    registerElement(id) {
      if (!elements.has(id)) elements.set(id, makeButton(id));
      return elements.get(id);
    },
    createElement(tag) {
      const el = makeButton('created-' + tag);
      el.tagName = String(tag).toUpperCase();
      return el;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  const window = {
    document,
    location: { search: '' },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(fn) { return setTimeout(() => fn(Date.now()), 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() }
  };
  globalThis.window = window;
  globalThis.document = document;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  globalThis.localStorage = {
    _data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  };
  return { document, window, elements, makeButton };
})();
"""


def register_canvas_shim() -> str:
    """Pre-register the home-field-canvas so HomeFeeding sees a canvas."""
    return """
careLoopShim.document.registerElement('home-field-canvas');
"""


def fake_ctx_shim() -> str:
    return """
const careLoopFakeCtx = new Proxy({}, {
  get(target, prop) {
    if (prop === 'canvas') return { width: 1280, height: 720 };
    if (prop === 'measureText') return () => ({ width: 10 });
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    if (prop === 'getImageData') return () => ({ data: [] });
    if (typeof prop === 'string' && prop in target) return target[prop];
    return () => {};
  },
  set(target, prop, value) { target[prop] = value; return true; }
});
"""


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestCareLoopUI(unittest.TestCase):
    def test_build_dog_entity_has_draw_emote(self):
        # Import + mount the REAL home_sanctuary.js (which pulls in
        # companion_dog.js), trigger the hungry animation, and verify the
        # sanctuary dog carries the hungry emote and that rendering does not
        # throw a TypeError.
        script = DOM_SHIM + fake_ctx_shim() + """
        await import(%s);
        await import(%s);
        const careLoopSanctuary = globalThis.HomeSanctuary;
        careLoopShim.document.registerElement('home-field-canvas');
        let careLoopThrew = null;
        let careLoopEmote = null;
        let careLoopHasDrawEmote = false;
        try {
          careLoopSanctuary.mount(
            careLoopShim.document.getElementById('home-field-canvas'),
            { id: 'dog-1', name: 'Ziggy' }
          );
          careLoopSanctuary.playNeedHungryAnimation();
          const careLoopDog = careLoopSanctuary.getDog();
          careLoopEmote = careLoopDog ? careLoopDog.emoteBubble : null;
          careLoopHasDrawEmote = typeof careLoopDog.drawEmote === 'function';
          // Exercise the real render path against a fake 2D context.
          careLoopSanctuary.__testHooks.render();
        } catch (e) {
          careLoopThrew = String(e && e.message ? e.message : e);
        } finally {
          try { careLoopSanctuary.unmount(); } catch (_e) { /* ignore */ }
        }
        console.log(JSON.stringify({
          threw: careLoopThrew,
          emoteBubble: careLoopEmote,
          hasDrawEmote: careLoopHasDrawEmote
        }));
        """ % (file_url("src/entities/companion_dog.js"), file_url("src/ui/home_sanctuary.js"))
        payload = run_node(script)
        self.assertIsNone(payload["threw"], "render threw: %s" % payload["threw"])
        self.assertEqual(payload["emoteBubble"], "🍖")
        self.assertTrue(payload["hasDrawEmote"])

    def test_draw_does_not_throw(self):
        # Exercise CompanionDog.prototype.draw directly against a minimal
        # entity literal (per brief item 2). This proves draw() is defensive
        # about missing fields and does not require a full CompanionDog.
        script = DOM_SHIM + fake_ctx_shim() + """
        const careLoopDrawModule = await import(%s);
        const careLoopMinimalEntity = {
          x: 10,
          y: 10,
          scale: 1,
          emoteBubble: '🍖',
          emoteTimer: 2
        };
        let careLoopDrawThrew = null;
        try {
          careLoopDrawModule.CompanionDog.prototype.draw.call(
            careLoopMinimalEntity,
            careLoopFakeCtx
          );
        } catch (e) {
          careLoopDrawThrew = String(e && e.message ? e.message : e);
        }
        console.log(JSON.stringify({ threw: careLoopDrawThrew }));
        """ % file_url("src/entities/companion_dog.js")
        payload = run_node(script)
        self.assertIsNone(payload["threw"], "draw() threw: %s" % payload["threw"])

    def test_hungry_animation_sets_emote(self):
        script = DOM_SHIM + """
        const careLoopHungryModule = await import(%s);
        const careLoopHungryDog = careLoopHungryModule.buildDogEntity
          ? careLoopHungryModule.buildDogEntity()
          : new careLoopHungryModule.CompanionDog();
        if (typeof careLoopHungryDog.playHungryAnimation === 'function') {
          careLoopHungryDog.playHungryAnimation();
        } else if (typeof careLoopHungryDog.playNeedHungryAnimation === 'function') {
          careLoopHungryDog.playNeedHungryAnimation();
        }
        console.log(JSON.stringify({
          emoteBubble: careLoopHungryDog.emoteBubble,
          emoteTimer: careLoopHungryDog.emoteTimer
        }));
        """ % file_url("src/entities/companion_dog.js")
        payload = run_node(script)
        self.assertEqual(payload["emoteBubble"], "🍖")
        self.assertGreater(payload["emoteTimer"], 0)

    def test_need_met_reaction_heart(self):
        script = DOM_SHIM + """
        const careLoopHeartModule = await import(%s);
        const careLoopHeartDog = careLoopHeartModule.buildDogEntity
          ? careLoopHeartModule.buildDogEntity()
          : new careLoopHeartModule.CompanionDog();
        careLoopHeartDog.playNeedMetReaction();
        console.log(JSON.stringify({ emoteBubble: careLoopHeartDog.emoteBubble }));
        """ % file_url("src/entities/companion_dog.js")
        payload = run_node(script)
        self.assertEqual(payload["emoteBubble"], "❤️")

    def test_grooming_animation_bubble_and_flag(self):
        script = DOM_SHIM + """
        const careLoopGroomModule = await import(%s);
        const careLoopGroomDog = careLoopGroomModule.buildDogEntity
          ? careLoopGroomModule.buildDogEntity()
          : new careLoopGroomModule.CompanionDog();
        careLoopGroomDog.playGroomingAnimation();
        console.log(JSON.stringify({
          emoteBubble: careLoopGroomDog.emoteBubble,
          beingGroomed: careLoopGroomDog.beingGroomed
        }));
        """ % file_url("src/entities/companion_dog.js")
        payload = run_node(script)
        self.assertEqual(payload["emoteBubble"], "🫧")
        self.assertTrue(payload["beingGroomed"])

    def test_sleeping_animation_flag(self):
        script = DOM_SHIM + """
        const careLoopSleepModule = await import(%s);
        const careLoopSleepDog = careLoopSleepModule.buildDogEntity
          ? careLoopSleepModule.buildDogEntity()
          : new careLoopSleepModule.CompanionDog();
        careLoopSleepDog.playSleepingAnimation();
        console.log(JSON.stringify({
          sleeping: careLoopSleepDog.sleeping,
          pose: careLoopSleepDog.pose
        }));
        """ % file_url("src/entities/companion_dog.js")
        payload = run_node(script)
        self.assertTrue(payload["sleeping"])
        self.assertEqual(payload["pose"], "sleeping")

    def test_emote_timer_decrements_on_camera(self):
        script = DOM_SHIM + """
        const careLoopTimerModule = await import(%s);
        const careLoopTimerDog = careLoopTimerModule.buildDogEntity
          ? careLoopTimerModule.buildDogEntity()
          : new careLoopTimerModule.CompanionDog();
        careLoopTimerDog.pose = 'camera';
        careLoopTimerDog.emoteTimer = 500;
        if (typeof careLoopTimerDog.update === 'function') {
          careLoopTimerDog.update(200);
        } else if (typeof careLoopTimerDog.updateDog === 'function') {
          careLoopTimerDog.updateDog(200);
        }
        console.log(JSON.stringify({ emoteTimer: careLoopTimerDog.emoteTimer }));
        """ % file_url("src/entities/companion_dog.js")
        payload = run_node(script)
        self.assertEqual(payload["emoteTimer"], 300)

    def test_action_bar_buttons_wired(self):
        # HomeFeeding must CREATE #btn-action-groom and #btn-action-rest
        # itself (the shim no longer auto-creates elements on getElementById).
        script = DOM_SHIM + register_canvas_shim() + """
        const careLoopStoreCalls = { groom: 0, rest: 0 };
        const careLoopSanctuaryCalls = {
          playGroomingAnimation: 0,
          playSleepingAnimation: 0,
          playNeedMetReaction: 0
        };
        const careLoopMockStore = {
          getSnapshot: () => ({
            version: 1,
            needs: {
              hunger: { lastFedAt: Date.now(), durationMs: 60000 },
              grooming: { lastGroomedAt: null, durationMs: 60000 },
              tiredness: { lastRestedAt: null, durationMs: 60000 }
            }
          }),
          subscribe: () => () => {},
          feed: () => {},
          groom: () => { careLoopStoreCalls.groom += 1; },
          rest: () => { careLoopStoreCalls.rest += 1; },
          needsGrooming: () => true,
          isTired: () => true
        };
        globalThis.__vdwDogStateStore = careLoopMockStore;
        globalThis.HomeSanctuary = {
          getDogSlot: () => ({ id: 'dog-1', name: 'Ziggy' }),
          getCompanionDog: () => null,
          setDogPose: () => {},
          setDogState: () => {},
          playGroomingAnimation: () => { careLoopSanctuaryCalls.playGroomingAnimation += 1; },
          playSleepingAnimation: () => { careLoopSanctuaryCalls.playSleepingAnimation += 1; },
          playNeedMetReaction: () => { careLoopSanctuaryCalls.playNeedMetReaction += 1; },
          toast: () => {}
        };
        window.HomeSanctuary = globalThis.HomeSanctuary;
        await import(%s);
        let careLoopGroomExists = false;
        let careLoopRestExists = false;
        try {
          globalThis.HomeFeeding.mount({ dogStateStore: careLoopMockStore });
          const careLoopGroomBtn = careLoopShim.document.getElementById('btn-action-groom');
          const careLoopRestBtn = careLoopShim.document.getElementById('btn-action-rest');
          careLoopGroomExists = !!careLoopGroomBtn;
          careLoopRestExists = !!careLoopRestBtn;
          if (careLoopGroomBtn) careLoopGroomBtn.click();
          if (careLoopRestBtn) careLoopRestBtn.click();
        } finally {
          try { globalThis.HomeFeeding.unmount(); } catch (_e) { /* ignore */ }
        }
        console.log(JSON.stringify({
          groomExists: careLoopGroomExists,
          restExists: careLoopRestExists,
          storeCalls: careLoopStoreCalls,
          sanctuaryCalls: careLoopSanctuaryCalls
        }));
        """ % file_url("src/ui/home_feeding.js")
        payload = run_node(script)
        self.assertTrue(payload["groomExists"], "#btn-action-groom missing")
        self.assertTrue(payload["restExists"], "#btn-action-rest missing")
        self.assertEqual(payload["storeCalls"]["groom"], 1)
        self.assertEqual(payload["storeCalls"]["rest"], 1)
        self.assertEqual(payload["sanctuaryCalls"]["playGroomingAnimation"], 1)
        self.assertEqual(payload["sanctuaryCalls"]["playSleepingAnimation"], 1)
        self.assertGreaterEqual(payload["sanctuaryCalls"]["playNeedMetReaction"], 2)

    def test_action_bar_buttons_reenable_when_timers_expire(self):
        # Groom/rest buttons must start disabled when the store reports the
        # need is not yet due, then re-enable once the store flips to true.
        script = DOM_SHIM + register_canvas_shim() + """
        const careLoopReenableState = { needsGrooming: false, isTired: false };
        const careLoopReenableStore = {
          getSnapshot: () => ({
            version: 1,
            needs: {
              hunger: { lastFedAt: Date.now(), durationMs: 60000 },
              grooming: { lastGroomedAt: Date.now(), durationMs: 60000 },
              tiredness: { lastRestedAt: Date.now(), durationMs: 60000 }
            }
          }),
          subscribe: () => () => {},
          feed: () => {},
          groom: () => {},
          rest: () => {},
          needsGrooming: () => careLoopReenableState.needsGrooming,
          isTired: () => careLoopReenableState.isTired
        };
        globalThis.__vdwDogStateStore = careLoopReenableStore;
        globalThis.HomeSanctuary = {
          getDogSlot: () => ({ id: 'dog-1', name: 'Ziggy' }),
          getCompanionDog: () => null,
          setDogPose: () => {},
          setDogState: () => {},
          playGroomingAnimation: () => {},
          playSleepingAnimation: () => {},
          playNeedMetReaction: () => {},
          toast: () => {}
        };
        window.HomeSanctuary = globalThis.HomeSanctuary;
        await import(%s);
        let careLoopInitiallyDisabled = { groom: false, rest: false };
        let careLoopAfterEnabled = { groom: true, rest: true };
        try {
          globalThis.HomeFeeding.mount({ dogStateStore: careLoopReenableStore });
          const careLoopReGroomBtn = careLoopShim.document.getElementById('btn-action-groom');
          const careLoopReRestBtn = careLoopShim.document.getElementById('btn-action-rest');
          careLoopInitiallyDisabled = {
            groom: !!(careLoopReGroomBtn && careLoopReGroomBtn.disabled),
            rest: !!(careLoopReRestBtn && careLoopReRestBtn.disabled)
          };
          // Flip the store to "due" and force a refresh.
          careLoopReenableState.needsGrooming = true;
          careLoopReenableState.isTired = true;
          if (typeof globalThis.HomeFeeding.refreshButtonStates === 'function') {
            globalThis.HomeFeeding.refreshButtonStates();
          } else if (globalThis.HomeFeeding.__testHooks &&
                     typeof globalThis.HomeFeeding.__testHooks.refreshButtonStates === 'function') {
            globalThis.HomeFeeding.__testHooks.refreshButtonStates();
          }
          careLoopAfterEnabled = {
            groom: !!(careLoopReGroomBtn && careLoopReGroomBtn.disabled),
            rest: !!(careLoopReRestBtn && careLoopReRestBtn.disabled)
          };
        } finally {
          try { globalThis.HomeFeeding.unmount(); } catch (_e) { /* ignore */ }
        }
        console.log(JSON.stringify({
          initiallyDisabled: careLoopInitiallyDisabled,
          afterEnabled: careLoopAfterEnabled
        }));
        """ % file_url("src/ui/home_feeding.js")
        payload = run_node(script)
        self.assertTrue(payload["initiallyDisabled"]["groom"], "groom should start disabled")
        self.assertTrue(payload["initiallyDisabled"]["rest"], "rest should start disabled")
        self.assertFalse(payload["afterEnabled"]["groom"], "groom should re-enable")
        self.assertFalse(payload["afterEnabled"]["rest"], "rest should re-enable")

    def test_sanctuary_play_need_hungry_animation_sets_emote(self):
        # Direct sanctuary-level assertion: playNeedHungryAnimation() must set
        # the dog's emote bubble to the hungry emote.
        script = DOM_SHIM + """
        const careLoopHungrySanctuaryModule = await import(%s);
        const careLoopHungrySanctuary = careLoopHungrySanctuaryModule.default
          || careLoopHungrySanctuaryModule.HomeSanctuary
          || globalThis.HomeSanctuary;
        careLoopShim.document.registerElement('home-field-canvas');
        let careLoopHungryEmote = null;
        try {
          careLoopHungrySanctuary.mount(careLoopShim.document.getElementById('home-field-canvas'), {
            id: 'dog-1',
            name: 'Ziggy'
          });
          careLoopHungrySanctuary.playNeedHungryAnimation();
          const careLoopHungryDog = careLoopHungrySanctuary.getDog();
          careLoopHungryEmote = careLoopHungryDog ? careLoopHungryDog.emoteBubble : null;
        } finally {
          try { careLoopHungrySanctuary.unmount(); } catch (_e) { /* ignore */ }
        }
        console.log(JSON.stringify({ emoteBubble: careLoopHungryEmote }));
        """ % file_url("src/ui/home_sanctuary.js")
        payload = run_node(script)
        self.assertEqual(payload["emoteBubble"], "🍖")

    def test_animator_tick_triggers_need_emotes(self):
        # Drive the REAL HomeHungerAnimator.tick() (not CompanionDog.update).
        script = DOM_SHIM + """
        const careLoopAnimModule = await import(%s);
        const careLoopAnimCalls = { hungry: 0, grooming: 0, tired: 0 };
        const careLoopAnimDog = {
          setHunger: () => {},
          setGrooming: () => {},
          setTiredness: () => {},
          playHungryAnimation: () => { careLoopAnimCalls.hungry += 1; },
          playNeedGroomingAnimation: () => { careLoopAnimCalls.grooming += 1; },
          playNeedRestAnimation: () => { careLoopAnimCalls.tired += 1; },
          getEmoteTimer: () => 0
        };
        const careLoopAnimStore = {
          getHunger: () => ({ isHungry: true }),
          getGrooming: () => ({ needsGrooming: false }),
          getTiredness: () => ({ isTired: false })
        };
        const careLoopAnimator = new careLoopAnimModule.HomeHungerAnimator({
          dogStateStore: careLoopAnimStore,
          dog: careLoopAnimDog,
          animationIntervalMs: 1000,
          now: () => 5000
        });
        careLoopAnimator.tick(5000);
        console.log(JSON.stringify({ calls: careLoopAnimCalls }));
        """ % file_url("src/ui/home_hunger_animator.js")
        payload = run_node(script)
        self.assertGreaterEqual(
            payload["calls"]["hungry"], 1,
            "HomeHungerAnimator.tick should trigger hungry emote when isHungry is true",
        )

    def test_animator_tick_triggers_grooming_and_tired(self):
        # Grooming takes priority over tiredness when both are due.
        script = DOM_SHIM + """
        const careLoopGroomAnimModule = await import(%s);
        const careLoopGroomCalls = { hungry: 0, grooming: 0, tired: 0 };
        const careLoopGroomDog = {
          setHunger: () => {},
          setGrooming: () => {},
          setTiredness: () => {},
          playHungryAnimation: () => { careLoopGroomCalls.hungry += 1; },
          playNeedGroomingAnimation: () => { careLoopGroomCalls.grooming += 1; },
          playNeedRestAnimation: () => { careLoopGroomCalls.tired += 1; },
          getEmoteTimer: () => 0
        };
        const careLoopGroomStore = {
          getHunger: () => ({ isHungry: false }),
          getGrooming: () => ({ needsGrooming: true }),
          getTiredness: () => ({ isTired: true })
        };
        const careLoopGroomAnimator = new careLoopGroomAnimModule.HomeHungerAnimator({
          dogStateStore: careLoopGroomStore,
          dog: careLoopGroomDog,
          animationIntervalMs: 1000,
          now: () => 5000
        });
        careLoopGroomAnimator.tick(5000);
        console.log(JSON.stringify({ calls: careLoopGroomCalls }));
        """ % file_url("src/ui/home_hunger_animator.js")
        payload = run_node(script)
        self.assertEqual(payload["calls"]["grooming"], 1)
        self.assertEqual(payload["calls"]["tired"], 0)
        self.assertEqual(payload["calls"]["hungry"], 0)

    def test_animator_respects_active_emote(self):
        # A dog with an active emote must not be interrupted.
        script = DOM_SHIM + """
        const careLoopEmoteAnimModule = await import(%s);
        const careLoopEmoteCalls = { hungry: 0 };
        const careLoopEmoteDog = {
          setHunger: () => {},
          playHungryAnimation: () => { careLoopEmoteCalls.hungry += 1; },
          getEmoteTimer: () => 1.5
        };
        const careLoopEmoteStore = {
          getHunger: () => ({ isHungry: true })
        };
        const careLoopEmoteAnimator = new careLoopEmoteAnimModule.HomeHungerAnimator({
          dogStateStore: careLoopEmoteStore,
          dog: careLoopEmoteDog,
          animationIntervalMs: 1000,
          now: () => 5000
        });
        careLoopEmoteAnimator.tick(5000);
        console.log(JSON.stringify({ calls: careLoopEmoteCalls }));
        """ % file_url("src/ui/home_hunger_animator.js")
        payload = run_node(script)
        self.assertEqual(payload["calls"]["hungry"], 0)

    def test_sanctuary_update_dog_camera_emote_and_care_timers(self):
        # Exercise the REAL HomeSanctuary.updateDog(dt) via __testHooks.
        script = DOM_SHIM + """
        const careLoopSanctuaryModule = await import(%s);
        const careLoopSanctuary = careLoopSanctuaryModule.default
          || careLoopSanctuaryModule.HomeSanctuary
          || globalThis.HomeSanctuary;
        // Mount against a registered canvas so the dog is created.
        careLoopShim.document.registerElement('home-field-canvas');
        let careLoopHasGetDog = false;
        let careLoopEmoteAfter = null;
        let careLoopGroomBefore = 0;
        let careLoopGroomAfter = 0;
        let careLoopSleepBefore = 0;
        let careLoopSleepAfter = 0;
        let careLoopStillGroomed = false;
        let careLoopStillSleeping = false;
        try {
          careLoopSanctuary.mount(careLoopShim.document.getElementById('home-field-canvas'), {
            id: 'dog-1',
            name: 'Ziggy'
          });
          const careLoopHooks = careLoopSanctuary.__testHooks;
          const careLoopDog = careLoopHooks.getDog();
          careLoopHasGetDog = typeof careLoopSanctuary.getDog === 'function';

          // Camera pose: emoteTimer must decrement.
          careLoopSanctuary.setDogPose('camera');
          careLoopDog.emoteTimer = 2.0;
          careLoopHooks.updateDog(500); // 500ms -> 0.5s
          careLoopEmoteAfter = careLoopDog.emoteTimer;

          // Grooming + sleeping must survive a playNeedMetReaction() call.
          careLoopSanctuary.playGroomingAnimation();
          careLoopSanctuary.playSleepingAnimation();
          careLoopGroomBefore = careLoopDog.groomTimer;
          careLoopSleepBefore = careLoopDog.sleepTimer;
          careLoopSanctuary.playNeedMetReaction();
          careLoopGroomAfter = careLoopDog.groomTimer;
          careLoopSleepAfter = careLoopDog.sleepTimer;
          careLoopStillGroomed = careLoopDog.beingGroomed;
          careLoopStillSleeping = careLoopDog.sleeping;
        } finally {
          try { careLoopSanctuary.unmount(); } catch (_e) { /* ignore */ }
        }

        console.log(JSON.stringify({
          hasGetDog: careLoopHasGetDog,
          emoteAfter: careLoopEmoteAfter,
          groomBefore: careLoopGroomBefore,
          groomAfter: careLoopGroomAfter,
          sleepBefore: careLoopSleepBefore,
          sleepAfter: careLoopSleepAfter,
          stillGroomed: careLoopStillGroomed,
          stillSleeping: careLoopStillSleeping
        }));
        """ % file_url("src/ui/home_sanctuary.js")
        payload = run_node(script)
        self.assertTrue(payload["hasGetDog"], "HomeSanctuary.getDog() missing")
        self.assertAlmostEqual(payload["emoteAfter"], 1.5, places=3)
        self.assertGreater(payload["groomBefore"], 0)
        self.assertGreater(payload["sleepBefore"], 0)
        # playNeedMetReaction must not shorten grooming/sleeping timers.
        self.assertGreaterEqual(payload["groomAfter"], payload["groomBefore"])
        self.assertGreaterEqual(payload["sleepAfter"], payload["sleepBefore"])
        self.assertTrue(payload["stillGroomed"])
        self.assertTrue(payload["stillSleeping"])

    def test_feed_button_triggers_need_met_reaction(self):
        # Feeding via #btn-action-feed must trigger the ❤️ need-met reaction.
        script = DOM_SHIM + register_canvas_shim() + """
        const careLoopFeedCalls = { feed: 0, needMet: 0 };
        const careLoopFeedStore = {
          getSnapshot: () => ({
            version: 1,
            needs: {
              hunger: { lastFedAt: Date.now(), durationMs: 60000 },
              grooming: { lastGroomedAt: null, durationMs: 60000 },
              tiredness: { lastRestedAt: null, durationMs: 60000 }
            }
          }),
          subscribe: () => () => {},
          feed: () => { careLoopFeedCalls.feed += 1; },
          groom: () => {},
          rest: () => {},
          needsGrooming: () => false,
          isTired: () => false
        };
        globalThis.__vdwDogStateStore = careLoopFeedStore;
        globalThis.HomeSanctuary = {
          getDogSlot: () => ({ id: 'dog-1', name: 'Ziggy' }),
          getCompanionDog: () => null,
          setDogPose: () => {},
          setDogState: () => {},
          playGroomingAnimation: () => {},
          playSleepingAnimation: () => {},
          playNeedMetReaction: () => { careLoopFeedCalls.needMet += 1; },
          toast: () => {}
        };
        window.HomeSanctuary = globalThis.HomeSanctuary;
        await import(%s);
        let careLoopFeedExists = false;
        try {
          globalThis.HomeFeeding.mount({ dogStateStore: careLoopFeedStore });
          const careLoopFeedBtn = careLoopShim.document.getElementById('btn-action-feed');
          careLoopFeedExists = !!careLoopFeedBtn;
          if (careLoopFeedBtn) careLoopFeedBtn.click();
        } finally {
          try { globalThis.HomeFeeding.unmount(); } catch (_e) { /* ignore */ }
        }
        console.log(JSON.stringify({
          feedExists: careLoopFeedExists,
          calls: careLoopFeedCalls
        }));
        """ % file_url("src/ui/home_feeding.js")
        payload = run_node(script)
        self.assertTrue(payload["feedExists"], "#btn-action-feed missing")
        self.assertEqual(payload["calls"]["feed"], 1)
        self.assertGreaterEqual(payload["calls"]["needMet"], 1)

    def test_animator_tick_triggers_tiredness_only(self):
        # When not hungry and not needing grooming, a tired dog must trigger
        # playNeedRestAnimation().
        script = DOM_SHIM + """
        const careLoopTiredModule = await import(%s);
        const careLoopTiredCalls = { hungry: 0, grooming: 0, tired: 0 };
        const careLoopTiredDog = {
          setHunger: () => {},
          setGrooming: () => {},
          setTiredness: () => {},
          playHungryAnimation: () => { careLoopTiredCalls.hungry += 1; },
          playNeedGroomingAnimation: () => { careLoopTiredCalls.grooming += 1; },
          playNeedRestAnimation: () => { careLoopTiredCalls.tired += 1; },
          getEmoteTimer: () => 0
        };
        const careLoopTiredStore = {
          getHunger: () => ({ isHungry: false }),
          getGrooming: () => ({ needsGrooming: false }),
          getTiredness: () => ({ isTired: true })
        };
        const careLoopTiredAnimator = new careLoopTiredModule.HomeHungerAnimator({
          dogStateStore: careLoopTiredStore,
          dog: careLoopTiredDog,
          animationIntervalMs: 1000,
          now: () => 5000
        });
        careLoopTiredAnimator.tick(5000);
        console.log(JSON.stringify({ calls: careLoopTiredCalls }));
        """ % file_url("src/ui/home_hunger_animator.js")
        payload = run_node(script)
        self.assertEqual(payload["calls"]["tired"], 1)
        self.assertEqual(payload["calls"]["hungry"], 0)
        self.assertEqual(payload["calls"]["grooming"], 0)


if __name__ == "__main__":
    unittest.main()
