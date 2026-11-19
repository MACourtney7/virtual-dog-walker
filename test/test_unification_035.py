#!/usr/bin/env python3
"""Tests for unification-035: HomeHungerAnimator / HomeSanctuary care loop.

Covers:
  REQ-1: HomeHungerAnimator.start()/stop() do not throw
         "TypeError: Illegal invocation" even when window.setInterval /
         window.clearInterval strictly enforce this === window.
  REQ-2: HomeHungerAnimator.tick() rotates round-robin across
         playHungryAnimation, playNeedGroomingAnimation and
         playNeedRestAnimation when all 3 needs are due.
  REQ-3: HomeSanctuary.playGroomingAnimation()/playSleepingAnimation() set
         pose === 'camera' and dog.state === 'sit', and updateDog(dt) calls
         resumeRoaming() (pose === 'auto') when groomTimer / sleepTimer expires.
  REQ-4: #btn-action-groom and #btn-action-rest share #btn-action-feed's
         button class (home-action-btn / btn-action).
  REQ-5: Completing Groom and Rest invokes showToast with completion messages
         ("loved the groom! ❤️" / "well rested! ❤️").
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


# Shared inline DOM shim. Uses a unique prefix so it never collides with
# scenario identifiers. Mirrors the shim used by test_care_loop_ui.py.
DOM_SHIM = """
const u035Shim = (() => {
  const elements = new Map();
  function makeEl(id) {
    const listeners = {};
    const el = {
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
      width: 320,
      height: 240,
      parentElement: { clientWidth: 320, clientHeight: 240 },
      getBoundingClientRect: () => ({ width: 320, height: 240 }),
      getContext: () => makeCtx2d(),
      _listeners: listeners
    };
    return el;
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
    getElementById(id) {
      if (elements.has(id)) return elements.get(id);
      return findInTree(body, id);
    },
    registerElement(id) {
      if (!elements.has(id)) {
        const el = makeEl(id);
        if (String(id).includes('canvas')) {
          el.tagName = 'CANVAS';
          el.width = 1280;
          el.height = 720;
          el.getContext = () => makeCtx2d();
        }
        elements.set(id, el);
      }
      return elements.get(id);
    },
    createElement(tag) {
      const el = makeEl('created-' + tag);
      el.tagName = String(tag).toUpperCase();
      return el;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  function makeCtx2d() {
    const base = {
      canvas: { width: 1280, height: 720 },
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createPattern: () => ({}),
      getImageData: () => ({ data: [] }),
      putImageData: () => {},
      setTransform: () => {},
      resetTransform: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      setLineDash: () => {},
      getLineDash: () => []
    };
    return new Proxy(base, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string') return () => {};
        return undefined;
      },
      set(target, prop, value) { target[prop] = value; return true; }
    });
  }
  const window = Object.assign(globalThis, {
    document,
    location: { search: '' },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(fn) { return setTimeout(() => fn(Date.now()), 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() }
  });
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
  return { document, window, elements, makeEl };
})();
"""


@unittest.skipUnless(node_available(), "node is required for these tests")
class TestUnification035(unittest.TestCase):
    # ------------------------------------------------------------------
    # REQ-1: start()/stop() must not throw "Illegal invocation".
    # ------------------------------------------------------------------
    def test_req1_no_illegal_invocation(self):
        script = DOM_SHIM + """
        // Strict globalThis: setInterval/clearInterval enforce this === globalThis.
        globalThis.window = globalThis;
        globalThis.setInterval = function strictSetInterval(fn, ms) {
          if (this !== globalThis) throw new TypeError('Illegal invocation');
          return 1;
        };
        globalThis.clearInterval = function strictClearInterval(id) {
          if (this !== globalThis) throw new TypeError('Illegal invocation');
          return undefined;
        };

        const u035Mod = await import(%s);
        const u035AnimatorClass = u035Mod.HomeHungerAnimator || globalThis.HomeHungerAnimator;
        if (!u035AnimatorClass) {
          console.log(JSON.stringify({ error: 'HomeHungerAnimator missing' }));
        } else {
          const u035Dog = {
            x: 0, y: 0, state: 'idle',
            playHungryAnimation() { return true; },
            playNeedGroomingAnimation() { return true; },
            playNeedRestAnimation() { return true; }
          };
          const u035Store = {
            getHunger: () => ({ isHungry: false }),
            getGrooming: () => ({ needsGrooming: false }),
            getTiredness: () => ({ isTired: false })
          };
          const u035Errors = [];

          // Case A: no custom timer fns passed.
          try {
            const a = new u035AnimatorClass({ dog: u035Dog, dogStateStore: u035Store, now: () => 0 });
            a.start();
            a.stop();
          } catch (e) {
            u035Errors.push('A: ' + String(e && e.message ? e.message : e));
          }

          // Case B: globalThis.setInterval/clearInterval passed explicitly.
          try {
            const b = new u035AnimatorClass({
              dog: u035Dog,
              dogStateStore: u035Store,
              now: () => 0,
              setIntervalFn: globalThis.setInterval,
              clearIntervalFn: globalThis.clearInterval
            });
            b.start();
            b.stop();
          } catch (e) {
            u035Errors.push('B: ' + String(e && e.message ? e.message : e));
          }

          console.log(JSON.stringify({ errors: u035Errors }));
        }
        """ % file_url("src/ui/home_hunger_animator.js")
        payload = run_node(script)
        self.assertNotIn("error", payload, "HomeHungerAnimator not exported")
        self.assertEqual(payload["errors"], [],
                         "start()/stop() threw: %r" % payload["errors"])

    # ------------------------------------------------------------------
    # REQ-2: tick() rotates round-robin across all 3 need animations.
    # ------------------------------------------------------------------
    def test_req2_round_robin_rotation(self):
        script = DOM_SHIM + """
        const u035Mod = await import(%s);
        const u035AnimatorClass = u035Mod.HomeHungerAnimator || globalThis.HomeHungerAnimator;
        if (!u035AnimatorClass) {
          console.log(JSON.stringify({ error: 'HomeHungerAnimator missing' }));
        } else {
          const u035Calls = [];
          const u035Dog = {
            x: 0, y: 0, state: 'idle',
            playHungryAnimation() { u035Calls.push('hungry'); return true; },
            playNeedGroomingAnimation() { u035Calls.push('groom'); return true; },
            playNeedRestAnimation() { u035Calls.push('rest'); return true; }
          };
          const u035Store = {
            getHunger: () => ({ isHungry: true }),
            getGrooming: () => ({ needsGrooming: true }),
            getTiredness: () => ({ isTired: true })
          };
          let u035Now = 0;
          const u035Animator = new u035AnimatorClass({
            dog: u035Dog,
            dogStateStore: u035Store,
            animationIntervalMs: 0,
            now: () => u035Now
          });
          u035Now = 1000; u035Animator.tick(1000);
          u035Now = 2000; u035Animator.tick(2000);
          u035Now = 3000; u035Animator.tick(3000);
          const u035Uniq = Array.from(new Set(u035Calls));
          console.log(JSON.stringify({ calls: u035Calls, uniq: u035Uniq }));
        }
        """ % file_url("src/ui/home_hunger_animator.js")
        payload = run_node(script)
        self.assertNotIn("error", payload, "HomeHungerAnimator not exported")
        uniq = set(payload["uniq"])
        self.assertIn("hungry", uniq, "round-robin missed hungry: %s" % payload["calls"])
        self.assertIn("groom", uniq, "round-robin missed groom: %s" % payload["calls"])
        self.assertIn("rest", uniq, "round-robin missed rest: %s" % payload["calls"])

    # ------------------------------------------------------------------
    # REQ-3: grooming/sleeping set pose='camera' + dog.state='sit';
    #        updateDog(dt) resumes roaming (pose='auto') on timer expiry.
    # ------------------------------------------------------------------
    def test_req3_groom_sleep_pose_and_resume(self):
        script = DOM_SHIM + """
        u035Shim.document.registerElement('home-field-canvas');
        await import(%s);
        const u035Sanctuary = globalThis.HomeSanctuary;
        if (!u035Sanctuary) {
          console.log(JSON.stringify({ error: 'HomeSanctuary missing' }));
        } else {
          const u035Result = {
            groomPose: null, groomState: null, groomResumePose: null,
            sleepPose: null, sleepState: null, sleepResumePose: null
          };
          try {
            u035Sanctuary.mount(
              u035Shim.document.getElementById('home-field-canvas'),
              { id: 'dog-1', name: 'Ziggy' }
            );
            const u035Hooks = u035Sanctuary.__testHooks;
            const u035Dog = u035Hooks.getDog();

            // Grooming
            u035Sanctuary.playGroomingAnimation();
            u035Result.groomPose = u035Hooks.getPose();
            u035Result.groomState = u035Dog.state;
            // Expire the groom timer and drive updateDog.
            u035Dog.groomTimer = 0.001;
            u035Hooks.updateDog(1000);
            u035Result.groomResumePose = u035Hooks.getPose();

            // Sleeping
            u035Sanctuary.playSleepingAnimation();
            u035Result.sleepPose = u035Hooks.getPose();
            u035Result.sleepState = u035Dog.state;
            u035Dog.sleepTimer = 0.001;
            u035Hooks.updateDog(1000);
            u035Result.sleepResumePose = u035Hooks.getPose();
          } finally {
            try { u035Sanctuary.unmount(); } catch (_e) { /* ignore */ }
          }
          console.log(JSON.stringify(u035Result));
        }
        """ % file_url("src/ui/home_sanctuary.js")
        payload = run_node(script)
        self.assertNotIn("error", payload, "HomeSanctuary not exported")
        self.assertEqual(payload["groomPose"], "camera")
        self.assertEqual(payload["groomState"], "sit")
        self.assertEqual(payload["groomResumePose"], "auto")
        self.assertEqual(payload["sleepPose"], "camera")
        self.assertEqual(payload["sleepState"], "sit")
        self.assertEqual(payload["sleepResumePose"], "auto")

    # ------------------------------------------------------------------
    # REQ-4: groom/rest buttons share the feed button's class.
    # ------------------------------------------------------------------
    def test_req4_button_classes_shared(self):
        script = DOM_SHIM + """
        u035Shim.document.registerElement('home-field-canvas');
        const u035MockStore = {
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
          groom: () => {},
          rest: () => {},
          needsGrooming: () => true,
          isTired: () => true
        };
        globalThis.__vdwDogStateStore = u035MockStore;
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
        const u035Result = { feed: null, groom: null, rest: null, groomText: null, restText: null };
        try {
          globalThis.HomeFeeding.mount({ dogStateStore: u035MockStore });
          const u035Feed = u035Shim.document.getElementById('btn-action-feed');
          const u035Groom = u035Shim.document.getElementById('btn-action-groom');
          const u035Rest = u035Shim.document.getElementById('btn-action-rest');
          u035Result.feed = u035Feed ? u035Feed.className : null;
          u035Result.groom = u035Groom ? u035Groom.className : null;
          u035Result.rest = u035Rest ? u035Rest.className : null;
          u035Result.groomText = u035Groom ? u035Groom.textContent : null;
          u035Result.restText = u035Rest ? u035Rest.textContent : null;
        } finally {
          try { globalThis.HomeFeeding.unmount(); } catch (_e) { /* ignore */ }
        }
        console.log(JSON.stringify(u035Result));
        """ % file_url("src/ui/home_feeding.js")
        payload = run_node(script)
        self.assertIsNotNone(payload["feed"], "#btn-action-feed missing")
        self.assertIsNotNone(payload["groom"], "#btn-action-groom missing")
        self.assertIsNotNone(payload["rest"], "#btn-action-rest missing")

        # Base className parity with the feed button. The cosmetic `is-needed`
        # readiness token (REQ-1, unification-036) is intentionally excluded
        # from the comparison so buttons remain always-clickable while still
        # sharing the same base button class.
        def _base_class(cls):
            tokens = [t for t in (cls or "").split() if t != "is-needed"]
            return " ".join(tokens)

        self.assertEqual(_base_class(payload["groom"]), _base_class(payload["feed"]),
                         "groom base className %r != feed base className %r"
                         % (payload["groom"], payload["feed"]))
        self.assertEqual(_base_class(payload["rest"]), _base_class(payload["feed"]),
                         "rest base className %r != feed base className %r"
                         % (payload["rest"], payload["feed"]))

        # Exact textContent parity.
        self.assertEqual(payload["groomText"], "🫧 Groom",
                         "groom textContent: %r" % payload["groomText"])
        self.assertEqual(payload["restText"], "💤 Rest",
                         "rest textContent: %r" % payload["restText"])

    # ------------------------------------------------------------------
    # REQ-5: Groom/Rest completion invokes showToast with completion text
    #        via the onComplete callback (NOT immediately on click).
    # ------------------------------------------------------------------
    def test_req5_completion_toasts(self):
        script = DOM_SHIM + """
        u035Shim.document.registerElement('home-field-canvas');
        const u035Toasts = [];
        const u035Captured = { groom: null, rest: null };
        const u035MockStore = {
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
          groom: () => {},
          rest: () => {},
          needsGrooming: () => true,
          isTired: () => true
        };
        globalThis.__vdwDogStateStore = u035MockStore;
        globalThis.HomeSanctuary = {
          getDogSlot: () => ({ id: 'dog-1', name: 'Ziggy' }),
          getCompanionDog: () => null,
          setDogPose: () => {},
          setDogState: () => {},
          // Capture the onComplete callback so the test can fire it later.
          // Accept both (opts) and (dogOrOpts, maybeOpts) call signatures.
          playGroomingAnimation: (dogOrOpts, maybeOpts) => {
            const opts = (maybeOpts && typeof maybeOpts === 'object') ? maybeOpts : dogOrOpts;
            u035Captured.groom = opts && opts.onComplete;
            return true;
          },
          playSleepingAnimation: (dogOrOpts, maybeOpts) => {
            const opts = (maybeOpts && typeof maybeOpts === 'object') ? maybeOpts : dogOrOpts;
            u035Captured.rest = opts && opts.onComplete;
            return true;
          },
          playNeedMetReaction: () => {},
          toast: (msg) => { u035Toasts.push(String(msg)); }
        };
        window.HomeSanctuary = globalThis.HomeSanctuary;
        await import(%s);
        const u035Result = { toastsBefore: [], toastsAfter: [] };
        try {
          globalThis.HomeFeeding.mount({ dogStateStore: u035MockStore });
          const u035Groom = u035Shim.document.getElementById('btn-action-groom');
          const u035Rest = u035Shim.document.getElementById('btn-action-rest');
          if (u035Groom) u035Groom.click();
          if (u035Rest) u035Rest.click();
          u035Result.toastsBefore = u035Toasts.slice();
          // Fire the captured completion callbacks.
          if (typeof u035Captured.groom === 'function') u035Captured.groom();
          if (typeof u035Captured.rest === 'function') u035Captured.rest();
          u035Result.toastsAfter = u035Toasts.slice();
        } finally {
          try { globalThis.HomeFeeding.unmount(); } catch (_e) { /* ignore */ }
        }
        console.log(JSON.stringify(u035Result));
        """ % file_url("src/ui/home_feeding.js")
        payload = run_node(script)
        self.assertEqual(payload["toastsBefore"], [],
                         "toast emitted before onComplete: %r" % payload["toastsBefore"])
        self.assertEqual(len(payload["toastsAfter"]), 2,
                         "expected exactly 2 completion toasts (1 per action): %r"
                         % payload["toastsAfter"])
        joined = " | ".join(payload["toastsAfter"])
        self.assertRegex(joined, r"loved the groom",
                         "missing groom completion toast: %r" % payload["toastsAfter"])
        self.assertRegex(joined, r"well rested",
                         "missing rest completion toast: %r" % payload["toastsAfter"])


if __name__ == "__main__":
    unittest.main()
