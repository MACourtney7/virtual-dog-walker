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

    clean = re.sub(r"^\s*import\s+.*?;?\s*$", "", feeding_src, flags=re.M)
    clean = re.sub(r"\bexport\s+(default\s+)?", "", clean)

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
const setTimeout = (fn) => 0;
const clearTimeout = () => {{}};
const localStorage = (() => {{
  let store = {{}};
  return {{
    getItem(k) {{ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }},
    setItem(k, v) {{ store[k] = String(v); }},
    removeItem(k) {{ delete store[k]; }},
    clear() {{ store = {{}}; }}
  }};
}})();

// ---- Load real module ----
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
