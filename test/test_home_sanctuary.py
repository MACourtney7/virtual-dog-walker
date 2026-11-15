#!/usr/bin/env python3
"""
Unit & Acceptance Tests for the Home Sanctuary (unification-029).
Validates:
- Static contracts: #home-field-canvas, #home-action-bar, #btn-action-feed,
  wander states, localStorage key prefix, and toast copy.
- Behavioral contracts: HomeFeeding.__testHooks.simulateFeed, last_feed_at
  JSON format, and feeding debounce.
"""

import json
import os
import re
import shutil
import subprocess
import unittest


def read(rel_path):
    base = os.path.dirname(__file__)
    full = os.path.join(base, "..", rel_path)
    with open(full, "r", encoding="utf-8") as f:
        return f.read()


def _run_js(snippet):
    """Execute a JS snippet against the real HomeFeeding class.

    Strips ESM import/export lines, provides minimal module stubs and a mock
    DOM, wraps the module in an IIFE, and runs the snippet via osascript
    (JavaScriptCore) or node. Returns the JSON-decoded result of the snippet.
    """
    feeding_src = read("src/ui/home_feeding.js")
    sanctuary_src = read("src/ui/home_sanctuary.js")

    clean = re.sub(r"^\s*import\s+.*?;?\s*$", "", feeding_src, flags=re.M)
    clean = re.sub(r"\bexport\s+(default\s+)?", "", clean)

    sanctuary_clean = re.sub(r"^\s*import\s+.*?;?\s*$", "", sanctuary_src, flags=re.M)
    sanctuary_clean = re.sub(r"\bexport\s+(default\s+)?", "", sanctuary_clean)

    harness = f"""
// ---- Mock DOM ----
function __makeEl(tag) {{
  const el = {{
    tagName: (tag || 'div').toUpperCase(),
    id: '',
    className: '',
    style: {{}},
    innerHTML: '',
    textContent: '',
    value: '',
    children: [],
    _listeners: {{}},
    classList: {{
      _set: new Set(),
      add(c) {{ this._set.add(c); }},
      remove(c) {{ this._set.delete(c); }},
      contains(c) {{ return this._set.has(c); }}
    }},
    appendChild(child) {{ this.children.push(child); if (child && child.id) __elements[child.id] = child; return child; }},
    removeChild(child) {{ const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child; }},
    contains(child) {{ return this.children.indexOf(child) >= 0; }},
    addEventListener(evt, fn) {{ (this._listeners[evt] = this._listeners[evt] || []).push(fn); }},
    removeEventListener() {{}},
    querySelector() {{ return null; }},
    querySelectorAll() {{ return []; }},
    getAttribute(name) {{ return this._attrs ? this._attrs[name] : null; }},
    setAttribute(name, val) {{ (this._attrs = this._attrs || {{}})[name] = val; }},
    getContext() {{
      return {{
        clearRect() {{}}, fillRect() {{}}, beginPath() {{}}, ellipse() {{}},
        fill() {{}}, stroke() {{}}, save() {{}}, restore() {{}},
        setTransform() {{}}, translate() {{}}, arc() {{}}, moveTo() {{}}, lineTo() {{}},
        fillText() {{}},
        createLinearGradient() {{ return {{ addColorStop() {{}} }}; }},
        createRadialGradient() {{ return {{ addColorStop() {{}} }}; }},
        set fillStyle(v) {{}}, set strokeStyle(v) {{}}, set lineWidth(v) {{}}
      }};
    }},
    focus() {{}}, blur() {{}}
  }};
  return el;
}}
const __elements = {{
  'game-container': __makeEl('div'),
  'hud-overlay': __makeEl('div')
}};
const document = {{
  _byId: __elements,
  getElementById(id) {{ return __elements[id] || null; }},
  createElement(tag) {{ return __makeEl(tag); }},
  querySelector() {{ return null; }},
  querySelectorAll() {{ return []; }},
  addEventListener() {{}},
  body: __makeEl('body')
}};
const window = {{ location: {{ search: '' }}, requestAnimationFrame: null }};
const requestAnimationFrame = (fn) => 0;
const cancelAnimationFrame = () => {{}};
// Controllable timer queue so tests can fast-forward scheduled callbacks.
const __timerQueue = [];
let __timerSeq = 0;
const setTimeout = (fn, ms) => {{
  const id = ++__timerSeq;
  __timerQueue.push({{ id: id, fn: fn, ms: ms || 0 }});
  return id;
}};
const clearTimeout = (id) => {{
  for (let i = 0; i < __timerQueue.length; i++) {{
    if (__timerQueue[i].id === id) {{ __timerQueue.splice(i, 1); return; }}
  }}
}};
const __flushTimers = () => {{
  let guard = 0;
  while (__timerQueue.length > 0 && guard < 1000) {{
    const t = __timerQueue.shift();
    try {{ t.fn(); }} catch (e) {{}}
    guard++;
  }}
}};
const localStorage = (() => {{
  let store = {{}};
  return {{
    getItem(k) {{ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }},
    setItem(k, v) {{ store[k] = String(v); }},
    removeItem(k) {{ delete store[k]; }},
    clear() {{ store = {{}}; }}
  }};
}})();

// ---- Load real modules ----
// home_sanctuary.js is an IIFE that assigns window.HomeSanctuary.
(() => {{ {sanctuary_clean} }})();
// home_feeding.js is an IIFE that assigns window.HomeFeeding.
(() => {{ {clean} }})();
const HomeFeeding = window.HomeFeeding;

const __res = (() => {{ {snippet} }})();
JSON.stringify(__res);
"""

    if shutil.which("osascript"):
        out = subprocess.check_output(
            ["osascript", "-l", "JavaScript", "-e", harness], text=True
        ).strip()
        return json.loads(out)
    if shutil.which("node"):
        node_script = f"""
{harness}
if (typeof __res !== 'undefined' && __res !== null) {{
    console.log(JSON.stringify(__res));
}}
"""
        out = subprocess.check_output(["node", "-e", node_script], text=True)
        return json.loads(out.strip().splitlines()[-1])
    raise unittest.SkipTest("No JS runtime (osascript or node) available")


class TestHomeSanctuaryStatic(unittest.TestCase):
    """Static contracts for the Home Sanctuary UI."""

    def setUp(self):
        self.hud_js = read("src/ui/social_hud.js")
        self.sanctuary_js = read("src/ui/home_sanctuary.js")
        self.feeding_js = read("src/ui/home_feeding.js")

    def test_home_field_canvas(self):
        self.assertIn('id="home-field-canvas"', self.hud_js,
                      "Missing #home-field-canvas element")

    def test_home_action_bar(self):
        self.assertIn('id="home-action-bar"', self.hud_js,
                      "Missing #home-action-bar container")

    def test_feed_button_contract(self):
        combined = self.feeding_js + self.hud_js
        self.assertTrue(
            'id="btn-action-feed"' in combined or "'btn-action-feed'" in combined or '"btn-action-feed"' in combined,
            "Missing #btn-action-feed button"
        )
        self.assertIn('🍖', combined,
                      "#btn-action-feed must contain the 🍖 icon")
        self.assertIn('Feed', combined,
                      "#btn-action-feed must contain the 'Feed' label")

    def test_wander_states(self):
        for state in ("wander", "sniff", "sit", "wag"):
            self.assertIn(state, self.sanctuary_js,
                          f"Missing wander state '{state}'")

    def test_last_feed_storage_key_prefix(self):
        self.assertIn('virtual_dog_walker.last_feed', self.feeding_js,
                      "Missing localStorage key prefix 'virtual_dog_walker.last_feed'")

    def test_toast_copy(self):
        self.assertIn('loved the meal! ❤️', self.feeding_js,
                      "Toast copy must contain 'loved the meal! ❤️'")

    def test_test_hooks_exposed(self):
        self.assertIn('__testHooks', self.feeding_js,
                      "HomeFeeding must expose __testHooks")
        self.assertIn('simulateFeed', self.feeding_js,
                      "HomeFeeding.__testHooks must expose simulateFeed")

    def test_resume_delay_constant(self):
        self.assertIn('RESUME_DELAY_MS', self.feeding_js,
                      "HomeFeeding must define RESUME_DELAY_MS")

    def test_sanctuary_resume_roaming(self):
        self.assertIn('resumeRoaming', self.sanctuary_js,
                      "HomeSanctuary must expose resumeRoaming")

    def test_sanctuary_spawn_particles(self):
        self.assertIn('spawnParticles', self.sanctuary_js,
                      "HomeSanctuary must expose spawnParticles")

    def test_hud_bridges_window_show_toast(self):
        self.assertIn('window.showToast', self.hud_js,
                      "SocialHUD must bridge window.showToast")


@unittest.skipUnless(
    shutil.which("node") or shutil.which("osascript"),
    "No JS runtime (node or osascript) available"
)
class TestHomeSanctuaryBehavioral(unittest.TestCase):
    """Executable behavioral verification of HomeFeeding."""

    def test_exec_simulate_feed_returns_expected_shape(self):
        snippet = """
        const feeding = HomeFeeding;
        const res = feeding.__testHooks.simulateFeed({ dogName: 'Ziggy' });
        return {
          ate: res.ate,
          toast: res.toast,
          persistedKey: res.persistedKey,
          persistedValue: res.persistedValue
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["ate"], "simulateFeed must report ate: true")
        self.assertIn("loved the meal! ❤️", res["toast"],
                      "simulateFeed toast must contain 'loved the meal! ❤️'")
        self.assertTrue(
            res["persistedKey"].startswith("virtual_dog_walker.last_feed"),
            "simulateFeed must persist under the virtual_dog_walker.last_feed prefix"
        )
        self.assertIsNotNone(res["persistedValue"],
                             "simulateFeed must return a persisted value")

    def test_exec_last_feed_at_json_format(self):
        snippet = """
        const feeding = HomeFeeding;
        feeding.__testHooks.simulateFeed({ dogName: 'Ziggy' });
        const raw = localStorage.getItem('virtual_dog_walker.last_feed_at');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        return { raw: raw, parsed: parsed };
        """
        res = _run_js(snippet)
        self.assertIsNotNone(res["raw"],
                             "Feeding must persist virtual_dog_walker.last_feed_at")
        self.assertIsNotNone(res["parsed"],
                             "last_feed_at must be valid JSON")
        self.assertIsInstance(res["parsed"], dict,
                              "last_feed_at JSON must be an object")

    def test_exec_run_feed_emits_toast_and_resumes_roaming(self):
        snippet = """
        const toasts = [];
        window.showToast = function (msg) { toasts.push(msg); };

        // Provide a HomeSanctuary stub so runFeed can resume roaming.
        let resumed = false;
        let lastPose = null;
        let lastState = null;
        window.HomeSanctuary = {
          getDogSlot: function () { return { id: 'dog-1', name: 'Ziggy' }; },
          getCompanionDog: function () { return { id: 'dog-1', name: 'Ziggy' }; },
          setDogPose: function (p) { lastPose = p; },
          setDogState: function (s) { lastState = s; },
          resumeRoaming: function () { resumed = true; }
        };

        // Drive runFeed through all phases via the controllable timer queue.
        HomeFeeding.__testHooks.runFeed({ dogName: 'Ziggy', dogId: 'dog-1' });
        __flushTimers();

        const raw = localStorage.getItem('virtual_dog_walker.last_feed_at');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

        return {
          toasts: toasts,
          persistedDogId: parsed ? parsed.dogId : null,
          hasAt: parsed ? typeof parsed.at === 'string' : false,
          resumed: resumed,
          lastPose: lastPose,
          lastState: lastState,
          feeding: HomeFeeding.__testHooks.isFeeding(),
          state: HomeFeeding.__testHooks.getState()
        };
        """
        res = _run_js(snippet)
        self.assertTrue(any("Ziggy loved the meal! ❤️" in t for t in res["toasts"]),
                        "runFeed must emit '<DogName> loved the meal! ❤️' toast")
        self.assertEqual(res["persistedDogId"], "dog-1",
                         "last_feed_at must persist dogId 'dog-1'")
        self.assertTrue(res["hasAt"], "last_feed_at must include an ISO 'at' field")
        self.assertTrue(res["resumed"], "runFeed must call resumeRoaming after delay")
        self.assertEqual(res["lastPose"], "auto",
                         "Dog pose must return to 'auto' after resumption")
        self.assertEqual(res["lastState"], "wander",
                         "Dog state must return to 'wander' after resumption")
        self.assertFalse(res["feeding"], "feeding flag must be false after resumption")
        self.assertEqual(res["state"], "idle",
                         "State machine must return to 'idle' after resumption")

    def test_exec_particles_spawn_during_eating(self):
        snippet = """
        // Ensure the canvas exists so mount() succeeds.
        let canvas = document.getElementById('home-field-canvas');
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.id = 'home-field-canvas';
          document.body.appendChild(canvas);
        }
        // Provide a minimal requestAnimationFrame that does not loop.
        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        if (!window.HomeSanctuary || !window.HomeSanctuary.__testHooks) {
          return { available: false };
        }
        window.HomeSanctuary.mount();
        const hooks = window.HomeSanctuary.__testHooks;
        window.HomeSanctuary.setDogState('eating');
        for (let i = 0; i < 40; i++) {
          hooks.spawnParticles();
        }
        const parts = hooks.getParticles();
        const hasHeart = parts.some(function (p) { return p.type === 'heart'; });
        const hasCrumb = parts.some(function (p) { return p.type === 'crumb'; });
        return {
          available: true,
          count: parts.length,
          hasHeart: hasHeart,
          hasCrumb: hasCrumb
        };
        """
        res = _run_js(snippet)
        if not res.get("available"):
            self.skipTest("HomeSanctuary not loaded in harness")
        self.assertGreater(res["count"], 0, "Particles must spawn during eating")
        self.assertTrue(res["hasHeart"] or res["hasCrumb"],
                        "Particles must include heart or crumb types")

    def test_exec_mount_hydrates_last_feed_at(self):
        snippet = """
        const seeded = JSON.stringify({ dogId: 'dog-1', at: '2024-01-01T00:00:00.000Z' });
        localStorage.setItem('virtual_dog_walker.last_feed_at', seeded);
        HomeFeeding.mount();
        const hydrated = HomeFeeding.__testHooks.getLastFeedAt();
        return { hydrated: hydrated, seeded: seeded };
        """
        res = _run_js(snippet)
        self.assertEqual(res["hydrated"], res["seeded"],
                         "mount() must hydrate lastFeedAt from localStorage")

    def test_exec_second_click_while_feeding_ignored(self):
        snippet = """
        const feeding = HomeFeeding;
        const first = feeding.__testHooks.simulateFeed({ dogName: 'Ziggy' });
        const second = feeding.__testHooks.simulateFeed({ dogName: 'Ziggy' });
        return {
          firstAte: first.ate,
          secondAte: second.ate,
          secondIgnored: second.ignored === true || second.ate === false
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["firstAte"], "First feed must be accepted")
        self.assertTrue(res["secondIgnored"],
                        "Second feed while feeding must be ignored")


if __name__ == '__main__':
    unittest.main()
