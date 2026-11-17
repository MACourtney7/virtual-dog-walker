#!/usr/bin/env python3
"""Tests for the care-loop UI (emotes, animations, action bar wiring).

Every case launches a fresh `node --input-type=module -e "..."` subprocess so
that top-level identifiers never collide across scenarios.
"""
import json
import os
import subprocess
import textwrap
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def run_node(script_body: str) -> dict:
    """Run a fresh node ESM process and parse its JSON stdout."""
    body = textwrap.dedent(script_body)
    result = subprocess.run(
        ["node", "--input-type=module", "-e", body],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
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
  const document = {
    body,
    getElementById(id) {
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


class TestCareLoopUI(unittest.TestCase):
    def test_build_dog_entity_has_draw_emote(self):
        script = DOM_SHIM + """
        const careLoopDogModule = await import(%s);
        const careLoopEntity = careLoopDogModule.buildDogEntity
          ? careLoopDogModule.buildDogEntity()
          : new careLoopDogModule.CompanionDog();
        console.log(JSON.stringify({
          hasDrawEmote: typeof careLoopEntity.drawEmote === 'function'
        }));
        """ % file_url("src/entities/companion_dog.js")
        payload = run_node(script)
        self.assertTrue(payload["hasDrawEmote"])

    def test_draw_does_not_throw(self):
        script = DOM_SHIM + fake_ctx_shim() + """
        const careLoopDrawModule = await import(%s);
        const careLoopDrawEntity = careLoopDrawModule.buildDogEntity
          ? careLoopDrawModule.buildDogEntity()
          : new careLoopDrawModule.CompanionDog();
        careLoopDrawEntity.emoteBubble = '🍖';
        let threw = null;
        try {
          careLoopDrawModule.CompanionDog.prototype.draw.call(careLoopDrawEntity, careLoopFakeCtx);
        } catch (e) {
          threw = String(e && e.message ? e.message : e);
        }
        console.log(JSON.stringify({ threw }));
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
        script = DOM_SHIM + """
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
        // Provide a canvas so buttons are not disabled.
        careLoopShim.document.getElementById('home-field-canvas');
        await import(%s);
        globalThis.HomeFeeding.mount({ dogStateStore: careLoopMockStore });
        const careLoopGroomBtn = careLoopShim.document.getElementById('btn-action-groom');
        const careLoopRestBtn = careLoopShim.document.getElementById('btn-action-rest');
        const careLoopGroomExists = !!careLoopGroomBtn;
        const careLoopRestExists = !!careLoopRestBtn;
        if (careLoopGroomBtn) careLoopGroomBtn.click();
        if (careLoopRestBtn) careLoopRestBtn.click();
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

    def test_animator_tick_triggers_need_emotes(self):
        # Hungry case.
        script = DOM_SHIM + """
        const careLoopAnimModule = await import(%s);
        const careLoopAnimDog = careLoopAnimModule.buildDogEntity
          ? careLoopAnimModule.buildDogEntity()
          : new careLoopAnimModule.CompanionDog();
        const careLoopAnimCalls = { hungry: 0, grooming: 0, tired: 0 };
        careLoopAnimDog.playNeedHungryAnimation = () => { careLoopAnimCalls.hungry += 1; };
        careLoopAnimDog.playGroomingAnimation = () => { careLoopAnimCalls.grooming += 1; };
        careLoopAnimDog.playSleepingAnimation = () => { careLoopAnimCalls.tired += 1; };
        const careLoopAnimStore = {
          getSnapshot: () => ({
            version: 1,
            needs: {
              hunger: { lastFedAt: 0, durationMs: 1 },
              grooming: { lastGroomedAt: Date.now(), durationMs: 60000 },
              tiredness: { lastRestedAt: Date.now(), durationMs: 60000 }
            }
          }),
          subscribe: () => () => {},
          isHungry: () => true,
          needsGrooming: () => false,
          isTired: () => false
        };
        if (typeof careLoopAnimDog.setDogStateStore === 'function') {
          careLoopAnimDog.setDogStateStore(careLoopAnimStore);
        }
        if (typeof careLoopAnimDog.tickNeedEmotes === 'function') {
          careLoopAnimDog.tickNeedEmotes(5000);
        } else if (typeof careLoopAnimDog.updateNeedEmotes === 'function') {
          careLoopAnimDog.updateNeedEmotes(5000);
        } else if (typeof careLoopAnimDog.update === 'function') {
          careLoopAnimDog.update(5000);
        }
        console.log(JSON.stringify({ calls: careLoopAnimCalls }));
        """ % file_url("src/entities/companion_dog.js")
        payload = run_node(script)
        self.assertGreaterEqual(
            payload["calls"]["hungry"], 1,
            "Animator tick should trigger hungry emote when isHungry is true",
        )


if __name__ == "__main__":
    unittest.main()
