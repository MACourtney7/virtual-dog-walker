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
        setTransform() {{}}, translate() {{}}, rotate() {{}}, scale() {{}},
        arc() {{}}, moveTo() {{}}, lineTo() {{}}, closePath() {{}}, rect() {{}},
        fillText() {{}}, strokeText() {{}}, measureText() {{ return {{ width: 0 }}; }},
        createLinearGradient() {{ return {{ addColorStop() {{}} }}; }},
        createRadialGradient() {{ return {{ addColorStop() {{}} }}; }},
        set fillStyle(v) {{}}, set strokeStyle(v) {{}}, set lineWidth(v) {{}},
        set lineCap(v) {{}}, set lineJoin(v) {{}}, set globalAlpha(v) {{}},
        set font(v) {{}}, set textAlign(v) {{}}, set textBaseline(v) {{}}
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
const requestAnimationFrame = (fn) => 0;
const cancelAnimationFrame = () => {{}};
const window = {{
  location: {{ search: '' }},
  requestAnimationFrame: requestAnimationFrame,
  cancelAnimationFrame: cancelAnimationFrame,
  document: document,
  devicePixelRatio: 1,
  addEventListener: function () {{}},
  removeEventListener: function () {{}}
}};
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
window.localStorage = localStorage;

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

    def test_gitignore_includes_aider(self):
        gitignore = read(".gitignore")
        self.assertIn(".aider", gitignore,
                      ".gitignore must ignore .aider* files")

    def test_hud_bridges_window_show_toast(self):
        self.assertIn('window.showToast', self.hud_js,
                      "SocialHUD must bridge window.showToast")

    def test_downs_grass_palette_constants(self):
        for color in ("#3e6b2c", "#335824", "#4c8237", "#5da347"):
            self.assertIn(color, self.sanctuary_js,
                          f"Missing 'The Downs' turf palette constant {color}")

    def test_canvas_style_dimensions_pinned(self):
        self.assertIn('canvas.style.width', self.sanctuary_js,
                      "Canvas CSS width must be pinned via canvas.style.width")
        self.assertIn('canvas.style.height', self.sanctuary_js,
                      "Canvas CSS height must be pinned via canvas.style.height")

    def test_food_bowl_rendering(self):
        self.assertIn('drawFoodBowl', self.sanctuary_js,
                      "Missing drawFoodBowl renderer")
        self.assertIn('kibbles', self.sanctuary_js,
                      "Food bowl must render kibbles")

    def test_bowl_visible_in_bowl_and_eating(self):
        self.assertIn("isBowlVisible", self.sanctuary_js,
                      "HomeSanctuary must define isBowlVisible()")
        self.assertRegex(
            self.sanctuary_js,
            r"forcedState\s*===\s*'eating'\s*\|\|\s*forcedState\s*===\s*'bowl'",
            "Bowl visibility must include both 'eating' and 'bowl' forced states"
        )

    def test_grass_mown_used_in_draw_field(self):
        self.assertIn("GRASS_MOWN", self.sanctuary_js,
                      "HomeSanctuary must define GRASS_MOWN")
        self.assertRegex(
            self.sanctuary_js,
            r"ctx\.fillStyle\s*=\s*GRASS_MOWN",
            "drawField must actively use GRASS_MOWN for turf shading"
        )

    def test_live_dog_entity_not_mutated_static(self):
        # The old mutation pattern must be gone.
        self.assertNotIn("entity.x = dog.x", self.sanctuary_js,
                         "drawDog must not mutate the live entity's x")
        self.assertNotIn("entity.y = dog.y", self.sanctuary_js,
                         "drawDog must not mutate the live entity's y")

    def test_feeding_ssr_safe_root(self):
        self.assertIn("var root = typeof window !== 'undefined'",
                      self.feeding_js,
                      "home_feeding.js must define an SSR-safe root reference")
        # No bare `window.HomeSanctuary` / `window.HomeFeeding` references.
        self.assertNotIn("window.HomeSanctuary", self.feeding_js,
                         "home_feeding.js must not reference bare window.HomeSanctuary")
        self.assertNotIn("window.HomeFeeding", self.feeding_js,
                         "home_feeding.js must not reference bare window.HomeFeeding")


class TestSquareLayoutAndOffLeashStatic(unittest.TestCase):
    """unification-031: Seamless grass & dedicated off-leash dog contracts."""

    def setUp(self):
        self.sanctuary_js = read("src/ui/home_sanctuary.js")

    def test_resize_canvas_is_dynamic(self):
        self.assertIn("resizeCanvas", self.sanctuary_js,
                      "HomeSanctuary must define resizeCanvas()")
        idx = self.sanctuary_js.find("resizeCanvas")
        self.assertNotEqual(idx, -1, "Missing resizeCanvas()")
        # resizeCanvas must not pin fixed inline pixel styles.
        block = self.sanctuary_js[idx:idx + 1200]
        self.assertNotIn("canvas.style.width = '340px'", block,
                         "resizeCanvas must not pin a fixed 340px inline width")
        self.assertNotIn("canvas.style.height = '220px'", block,
                         "resizeCanvas must not pin a fixed 220px inline height")

    def test_draw_field_fills_full_canvas(self):
        self.assertIn("drawField", self.sanctuary_js,
                      "HomeSanctuary must define drawField()")
        self.assertRegex(
            self.sanctuary_js,
            r"fillRect\s*\(\s*0\s*,\s*0\s*,\s*fieldWidth\s*,\s*fieldHeight\s*\)",
            "drawField must fill (0, 0, fieldWidth, fieldHeight)"
        )
        self.assertIn("#3e6b2c", self.sanctuary_js,
                      "drawField must use the 'The Downs' turf base #3e6b2c")

    def test_sanctuary_dog_is_off_leash(self):
        self.assertIn("isLeashed", self.sanctuary_js,
                      "Sanctuary dog must declare isLeashed")
        self.assertRegex(
            self.sanctuary_js,
            r"isLeashed\s*[:=]\s*false",
            "Sanctuary dog must set isLeashed = false"
        )
        self.assertRegex(
            self.sanctuary_js,
            r"leash\s*[:=]\s*null",
            "Sanctuary dog must set leash = null"
        )

    def test_no_leash_rendering(self):
        # No red leash stroke should be drawn in the sanctuary.
        self.assertNotRegex(
            self.sanctuary_js,
            r"strokeStyle\s*=\s*['\"]#(?:ff0000|f00|dc2626|ef4444)['\"]",
            "HomeSanctuary must not render a red leash stroke"
        )
        self.assertNotIn("drawLeash", self.sanctuary_js,
                         "HomeSanctuary must not define a drawLeash renderer")

    def test_mount_creates_autonomous_entity_without_live_dog(self):
        self.assertIn("mount", self.sanctuary_js,
                      "HomeSanctuary must expose mount()")
        # mount must not require window.__vdwLiveDog.
        self.assertNotIn("__vdwLiveDog", self.sanctuary_js,
                         "HomeSanctuary must not depend on window.__vdwLiveDog")


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

    def test_exec_mount_unmount_remount_preserves_action_bar_in_sanctuary(self):
        snippet = """
        // Build the sanctuary DOM structure the way SocialHUD does.
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);
        const bar = document.createElement('div');
        bar.id = 'home-action-bar';
        sanctuary.appendChild(bar);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        HomeFeeding.mount();
        HomeFeeding.unmount();
        window.HomeSanctuary.unmount();

        const barAfterUnmount = document.getElementById('home-action-bar');
        const stillChild = sanctuary.children.indexOf(barAfterUnmount) >= 0;

        window.HomeSanctuary.mount(canvas, slot);
        HomeFeeding.mount();
        const barAfterRemount = document.getElementById('home-action-bar');
        const stillChildRemount = sanctuary.children.indexOf(barAfterRemount) >= 0;
        const feedBtn = document.getElementById('btn-action-feed');

        return {
          stillChild: stillChild,
          stillChildRemount: stillChildRemount,
          sameBar: barAfterUnmount === barAfterRemount,
          hasFeedBtn: Boolean(feedBtn)
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["stillChild"],
                        "#home-action-bar must remain a child of #home-view-sanctuary after unmount")
        self.assertTrue(res["stillChildRemount"],
                        "#home-action-bar must remain a child of #home-view-sanctuary after remount")
        self.assertTrue(res["sameBar"],
                        "unmount/remount must reuse the same #home-action-bar element")
        self.assertTrue(res["hasFeedBtn"],
                        "Remount must re-create #btn-action-feed inside the preserved bar")

    def test_exec_real_profile_identity_used_in_feed_and_toast(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: { name: 'Barnaby', coatKey: 'GOLDEN', collarColor: '#dc2626' }
        }));

        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);
        const bar = document.createElement('div');
        bar.id = 'home-action-bar';
        sanctuary.appendChild(bar);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const toasts = [];
        window.showToast = function (msg) { toasts.push(msg); };

        window.HomeSanctuary.mount();
        HomeFeeding.mount();

        const slot = window.HomeSanctuary.getDogSlot();
        const companion = window.HomeSanctuary.getCompanionDog();

        const feedBtn = document.getElementById('btn-action-feed');
        if (feedBtn && feedBtn._listeners && feedBtn._listeners.click) {
          feedBtn._listeners.click.forEach(function (fn) { fn(); });
        }
        __flushTimers();

        const raw = localStorage.getItem('virtual_dog_walker.last_feed_at');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

        return {
          slotName: slot ? slot.name : null,
          companionName: companion ? companion.name : null,
          toasts: toasts,
          persistedDogId: parsed ? parsed.dogId : null,
          hasAt: parsed ? typeof parsed.at === 'string' : false
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["slotName"], "Barnaby",
                         "HomeSanctuary.getDogSlot() must expose the real profile dog")
        self.assertEqual(res["companionName"], "Barnaby",
                         "Companion dog must use the real profile name")
        self.assertTrue(any("Barnaby loved the meal! ❤️" in t for t in res["toasts"]),
                        "Feed toast must use the real dog name 'Barnaby'")
        self.assertIsNotNone(res["persistedDogId"],
                             "last_feed_at must persist a dogId")
        self.assertTrue(res["hasAt"], "last_feed_at must include an ISO 'at' field")

    def test_exec_feed_disabled_when_dog_slot_is_null(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: null
        }));

        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);
        const bar = document.createElement('div');
        bar.id = 'home-action-bar';
        sanctuary.appendChild(bar);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        window.HomeSanctuary.mount();
        HomeFeeding.mount();

        const feedBtn = document.getElementById('btn-action-feed');
        return {
          slot: window.HomeSanctuary.getDogSlot(),
          disabled: feedBtn ? feedBtn.disabled : null,
          ariaDisabled: feedBtn ? feedBtn.getAttribute('aria-disabled') : null
        };
        """
        res = _run_js(snippet)
        self.assertIsNone(res["slot"],
                          "A null dogSlot must yield a null HomeSanctuary slot")
        self.assertTrue(res["disabled"],
                        "#btn-action-feed must be disabled when dogSlot is null")
        self.assertEqual(res["ariaDisabled"], "true",
                         "#btn-action-feed must set aria-disabled='true' when dogSlot is null")

    def test_exec_update_dog_moves_at_plausible_speed(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        const hooks = window.HomeSanctuary.__testHooks;

        // Force a wander target far from the dog's current position.
        const before = window.HomeSanctuary.getCompanionDog();
        hooks.setWanderTarget(before.x + 200, before.y);
        hooks.updateDog(1000); // one second
        const after = window.HomeSanctuary.getCompanionDog();

        return {
          dx: Math.abs(after.x - before.x),
          dy: Math.abs(after.y - before.y)
        };
        """
        res = _run_js(snippet)
        # WANDER_SPEED is 42 px/s; one second of motion must be ~42px, not 42000px.
        self.assertGreater(res["dx"], 0, "Dog must move toward its wander target")
        self.assertLess(res["dx"], 100,
                        "Dog must move at px/second speed (dt/1000), not px/millisecond")

    def test_exec_golden_coat_key_maps_to_golden_color(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'GOLDEN' };
        window.HomeSanctuary.mount(canvas, slot);
        const dog = window.HomeSanctuary.getCompanionDog();
        return { coatColor: dog.coatColor, coatColorDark: dog.coatColorDark };
        """
        res = _run_js(snippet)
        self.assertEqual(res["coatColor"], "#eab308",
                         "GOLDEN coatKey must map to the golden primary color")
        self.assertEqual(res["coatColorDark"], "#ca8a04",
                         "GOLDEN coatKey must map to the golden dark color")

    def test_exec_mount_draws_downs_turf(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        // Instrument the 2D context to record fillStyle assignments.
        const fills = [];
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          return new Proxy(ctx, {
            set(target, prop, value) {
              if (prop === 'fillStyle') { fills.push(value); }
              target[prop] = value;
              return true;
            }
          });
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.__testHooks.render();

        return { fills: fills };
        """
        res = _run_js(snippet)
        self.assertIn("#3e6b2c", res["fills"],
                      "render() must fill the field with the 'The Downs' turf base #3e6b2c")

    def test_exec_camera_pose_orientation_faces_down(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        // Instrument ctx.rotate so we can observe the effective rotation
        // applied by drawArticulatedDog during render().
        const rotations = [];
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          const originalRotate = ctx.rotate.bind(ctx);
          ctx.rotate = function (angle) {
            rotations.push(angle);
            return originalRotate(angle);
          };
          return ctx;
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.setDogPose('camera');
        const dog = window.HomeSanctuary.getCompanionDog();

        rotations.length = 0;
        window.HomeSanctuary.__testHooks.render();

        return {
          facing: dog.facing,
          expected: Math.PI / 2,
          rotations: rotations
        };
        """
        res = _run_js(snippet)
        self.assertAlmostEqual(res["facing"], res["expected"], places=6,
                               msg="Camera pose must face down (angle = Math.PI / 2)")
        self.assertTrue(len(res["rotations"]) > 0,
                        "render() must rotate the dog body via ctx.rotate")
        # drawArticulatedDog rotates by (angle - PI/2); with angle = PI/2 the
        # effective rotation must be 0 so the head points down at +Y.
        self.assertAlmostEqual(res["rotations"][0], res["expected"], places=6,
                               msg="Camera pose must rotate by Math.PI / 2 (head faces +Y)")

    def test_exec_live_dog_entity_not_mutated(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const live = {
          x: 999, y: 888, angle: 0.123, legPhase: 0,
          isSitting: false, isSniffing: false,
          coat: { bodyColor: '#111111', tanColor: '#222222', bibColor: '#333333' },
          collarColor: '#444444', name: 'LiveDog'
        };
        const snapshot = JSON.stringify(live);

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot, live);

        // Force a full render pass (drawDog -> buildRenderAdapter) through the
        // public test hook path.
        const hooks = window.HomeSanctuary.__testHooks;
        hooks.updateDog(16);
        hooks.render();
        return {
          before: snapshot,
          after: JSON.stringify(live),
          x: live.x,
          y: live.y,
          angle: live.angle
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["before"], res["after"],
                         "liveDogEntity must not be mutated during rendering")
        self.assertEqual(res["x"], 999, "liveDogEntity.x must remain unchanged")
        self.assertEqual(res["y"], 888, "liveDogEntity.y must remain unchanged")
        self.assertAlmostEqual(res["angle"], 0.123, places=6,
                               msg="liveDogEntity.angle must remain unchanged")

    def test_exec_bowl_visible_in_bowl_and_eating_states(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);

        window.HomeSanctuary.setDogState('bowl');
        const bowlForced = window.HomeSanctuary.__testHooks.getForcedState();

        window.HomeSanctuary.setDogState('eating');
        const eatingForced = window.HomeSanctuary.__testHooks.getForcedState();

        return { bowlForced: bowlForced, eatingForced: eatingForced };
        """
        res = _run_js(snippet)
        self.assertEqual(res["bowlForced"], "bowl",
                         "setDogState('bowl') must set forcedState to 'bowl'")
        self.assertEqual(res["eatingForced"], "eating",
                         "setDogState('eating') must set forcedState to 'eating'")

    def test_exec_clear_bowl_resets_bowl_and_eating_state(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);

        window.HomeSanctuary.setDogState('bowl');
        const forcedBefore = window.HomeSanctuary.__testHooks.getForcedState();
        window.HomeSanctuary.clearBowl();
        const forcedAfter = window.HomeSanctuary.__testHooks.getForcedState();
        const dogAfter = window.HomeSanctuary.getCompanionDog();

        window.HomeSanctuary.setDogState('eating');
        window.HomeSanctuary.clearBowl();
        const forcedAfterEating = window.HomeSanctuary.__testHooks.getForcedState();
        const dogAfterEating = window.HomeSanctuary.getCompanionDog();

        return {
          forcedBefore: forcedBefore,
          forcedAfter: forcedAfter,
          dogStateAfter: dogAfter.state,
          forcedAfterEating: forcedAfterEating,
          dogStateAfterEating: dogAfterEating.state
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["forcedBefore"], "bowl",
                         "setDogState('bowl') must set forcedState to 'bowl'")
        self.assertIsNone(res["forcedAfter"],
                          "clearBowl() must clear forcedState from 'bowl'")
        self.assertNotIn(res["dogStateAfter"], ("bowl", "eating"),
                         "clearBowl() must reset the dog out of bowl/eating state")
        self.assertIsNone(res["forcedAfterEating"],
                          "clearBowl() must clear forcedState from 'eating'")
        self.assertNotIn(res["dogStateAfterEating"], ("bowl", "eating"),
                         "clearBowl() must reset the dog out of eating state")

    def test_exec_draw_uses_self_contained_entity_not_live_dog(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        let liveDrawCalled = false;
        const live = {
          x: 10, y: 10, angle: 0, legPhase: 0,
          isSitting: false, isSniffing: false,
          coat: { bodyColor: '#111111', tanColor: '#222222', bibColor: '#333333' },
          collarColor: '#444444', name: 'LiveDog',
          draw: function (ctx) { liveDrawCalled = true; }
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot, live);
        window.HomeSanctuary.__testHooks.render();

        return { liveDrawCalled: liveDrawCalled };
        """
        res = _run_js(snippet)
        self.assertFalse(res["liveDrawCalled"],
                         "drawDog must not delegate to a passed-in live dog's draw method")

    def test_home_feeding_no_dom_bowl_created(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);
        const bar = document.createElement('div');
        bar.id = 'home-action-bar';
        sanctuary.appendChild(bar);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        HomeFeeding.mount();

        HomeFeeding.__testHooks.runFeed({ dogName: 'Ziggy', dogId: 'dog-1' });
        __flushTimers();

        const byId = document.getElementById('home-food-bowl');
        const byClass = document.querySelector('.home-food-bowl');
        return {
          byId: Boolean(byId),
          byClass: Boolean(byClass)
        };
        """
        res = _run_js(snippet)
        self.assertFalse(res["byId"],
                         "home_feeding must not inject a #home-food-bowl DOM element")
        self.assertFalse(res["byClass"],
                         "home_feeding must not inject a .home-food-bowl DOM element")

    def test_exec_mount_creates_off_leash_dog_from_slot(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        // Ensure no live dog is present.
        window.__vdwLiveDog = undefined;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        const dog = window.HomeSanctuary.getCompanionDog();

        return {
          hasDog: Boolean(dog),
          name: dog ? dog.name : null,
          isLeashed: dog ? dog.isLeashed : null,
          leash: dog ? dog.leash : 'MISSING'
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["hasDog"],
                        "mount(canvas, slot) must create an autonomous dog entity")
        self.assertEqual(res["name"], "Ziggy",
                         "Autonomous dog must use the slot name")
        self.assertFalse(res["isLeashed"],
                         "Sanctuary dog must be off-leash (isLeashed === false)")
        self.assertIsNone(res["leash"],
                          "Sanctuary dog must have leash === null")

    def test_exec_mount_with_leashed_world_dog_remains_off_leash(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        // A leashed world dog present on the global scope must be ignored.
        window.__vdwLiveDog = { isLeashed: true, leash: { x: 50, y: 50 }, name: 'WorldDog' };

        const slot = { id: 'dog-1', name: 'SanctuaryZiggy', coatKey: 'GOLDEN', collar: '#ff0000' };
        window.HomeSanctuary.mount(canvas, slot);
        const dog = window.HomeSanctuary.getCompanionDog();

        return {
          isSame: dog === window.__vdwLiveDog,
          isLeashed: dog.isLeashed,
          leash: dog.leash,
          name: dog.name,
          coatKey: dog.coatKey,
          collar: dog.collar,
          worldIsLeashed: window.__vdwLiveDog.isLeashed
        };
        """
        res = _run_js(snippet)
        self.assertFalse(res["isSame"],
                         "Sanctuary dog must not be the world dog entity")
        self.assertFalse(res["isLeashed"],
                         "Sanctuary dog must be off-leash")
        self.assertIsNone(res["leash"],
                          "Sanctuary dog must have leash === null")
        self.assertEqual(res["name"], "SanctuaryZiggy",
                         "Sanctuary dog must use the slot name")
        self.assertEqual(res["coatKey"], "GOLDEN",
                         "Sanctuary dog must expose the slot coatKey")
        self.assertEqual(res["collar"], "#ff0000",
                         "Sanctuary dog must expose the slot collar")
        self.assertTrue(res["worldIsLeashed"],
                        "The world dog must remain unmodified (still leashed)")

    def test_social_hud_mounts_sanctuary_without_world_dog(self):
        hud_js = read("src/ui/social_hud.js")
        self.assertRegex(
            hud_js,
            r"HomeSanctuary\?\.mount\?\.\(\s*canvas\s*,\s*this\.dogSlot\s*\)",
            "social_hud must call HomeSanctuary.mount(canvas, this.dogSlot)"
        )
        self.assertNotRegex(
            hud_js,
            r"HomeSanctuary\?\.mount\?\.\([^)]*this\.dog\b",
            "social_hud must not pass this.dog to HomeSanctuary.mount"
        )

    def test_exec_resize_canvas_backing_store_and_transform(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 2;

        const transforms = [];
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          const originalSetTransform = ctx.setTransform.bind(ctx);
          ctx.setTransform = function (a, b, c, d, e, f) {
            transforms.push([a, b, c, d, e, f]);
            return originalSetTransform(a, b, c, d, e, f);
          };
          return ctx;
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);

        return {
          width: canvas.width,
          height: canvas.height,
          transforms: transforms
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["width"], 800,
                         "DPR=2 with a 400px container must set canvas.width = 800")
        self.assertEqual(res["height"], 800,
                         "DPR=2 with a 400px container must set canvas.height = 800")
        self.assertTrue(
            any(t == [2, 0, 0, 2, 0, 0] for t in res["transforms"]),
            "resizeCanvas must call ctx.setTransform(2, 0, 0, 2, 0, 0) at DPR=2"
        )

    def test_exec_draw_field_full_canvas_coverage(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const fills = [];
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          const originalFillRect = ctx.fillRect.bind(ctx);
          let currentFill = null;
          return new Proxy(ctx, {
            set(target, prop, value) {
              if (prop === 'fillStyle') { currentFill = value; }
              target[prop] = value;
              return true;
            },
            get(target, prop) {
              if (prop === 'fillRect') {
                return function (x, y, w, h) {
                  fills.push({ x: x, y: y, w: w, h: h, fill: currentFill });
                  return originalFillRect(x, y, w, h);
                };
              }
              const v = target[prop];
              return typeof v === 'function' ? v.bind(target) : v;
            }
          });
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.__testHooks.render();

        return { fills: fills };
        """
        res = _run_js(snippet)
        self.assertTrue(
            any(f["x"] == 0 and f["y"] == 0 and f["w"] == 400 and f["h"] == 400
                and f["fill"] == "#3e6b2c" for f in res["fills"]),
            "drawField must fill (0, 0, 400, 400) with the turf base #3e6b2c"
        )

    def test_exec_mount_with_leashed_world_dog_remains_off_leash(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        // A leashed world dog present on the global scope must be ignored.
        window.__vdwLiveDog = { isLeashed: true, leash: { x: 50, y: 50 }, name: 'WorldDog' };

        const slot = { id: 'dog-1', name: 'SanctuaryZiggy', coatKey: 'GOLDEN', collar: '#ff0000' };
        window.HomeSanctuary.mount(canvas, slot);
        const dog = window.HomeSanctuary.getCompanionDog();

        return {
          isSame: dog === window.__vdwLiveDog,
          isLeashed: dog.isLeashed,
          leash: dog.leash,
          name: dog.name,
          coatKey: dog.coatKey,
          collar: dog.collar,
          worldIsLeashed: window.__vdwLiveDog.isLeashed
        };
        """
        res = _run_js(snippet)
        self.assertFalse(res["isSame"],
                         "Sanctuary dog must not be the world dog entity")
        self.assertFalse(res["isLeashed"],
                         "Sanctuary dog must be off-leash")
        self.assertIsNone(res["leash"],
                          "Sanctuary dog must have leash === null")
        self.assertEqual(res["name"], "SanctuaryZiggy",
                         "Sanctuary dog must use the slot name")
        self.assertEqual(res["coatKey"], "GOLDEN",
                         "Sanctuary dog must expose the slot coatKey")
        self.assertEqual(res["collar"], "#ff0000",
                         "Sanctuary dog must expose the slot collar")
        self.assertTrue(res["worldIsLeashed"],
                        "The world dog must remain unmodified (still leashed)")

    def test_social_hud_mounts_sanctuary_without_world_dog(self):
        hud_js = read("src/ui/social_hud.js")
        self.assertRegex(
            hud_js,
            r"HomeSanctuary\?\.mount\?\.\(\s*canvas\s*,\s*this\.dogSlot\s*\)",
            "social_hud must call HomeSanctuary.mount(canvas, this.dogSlot)"
        )
        self.assertNotRegex(
            hud_js,
            r"HomeSanctuary\?\.mount\?\.\([^)]*this\.dog\b",
            "social_hud must not pass this.dog to HomeSanctuary.mount"
        )

    def test_exec_resize_canvas_backing_store_and_transform(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 2;

        const transforms = [];
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          const originalSetTransform = ctx.setTransform.bind(ctx);
          ctx.setTransform = function (a, b, c, d, e, f) {
            transforms.push([a, b, c, d, e, f]);
            return originalSetTransform(a, b, c, d, e, f);
          };
          return ctx;
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);

        return {
          width: canvas.width,
          height: canvas.height,
          transforms: transforms
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["width"], 800,
                         "DPR=2 with a 400px container must set canvas.width = 800")
        self.assertEqual(res["height"], 800,
                         "DPR=2 with a 400px container must set canvas.height = 800")
        self.assertTrue(
            any(t == [2, 0, 0, 2, 0, 0] for t in res["transforms"]),
            "resizeCanvas must call ctx.setTransform(2, 0, 0, 2, 0, 0) at DPR=2"
        )

    def test_exec_draw_field_full_canvas_coverage(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const fills = [];
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          const originalFillRect = ctx.fillRect.bind(ctx);
          let currentFill = null;
          return new Proxy(ctx, {
            set(target, prop, value) {
              if (prop === 'fillStyle') { currentFill = value; }
              target[prop] = value;
              return true;
            },
            get(target, prop) {
              if (prop === 'fillRect') {
                return function (x, y, w, h) {
                  fills.push({ x: x, y: y, w: w, h: h, fill: currentFill });
                  return originalFillRect(x, y, w, h);
                };
              }
              const v = target[prop];
              return typeof v === 'function' ? v.bind(target) : v;
            }
          });
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.__testHooks.render();

        return { fills: fills };
        """
        res = _run_js(snippet)
        self.assertTrue(
            any(f["x"] == 0 and f["y"] == 0 and f["w"] == 400 and f["h"] == 400
                and f["fill"] == "#3e6b2c" for f in res["fills"]),
            "drawField must fill (0, 0, 400, 400) with the turf base #3e6b2c"
        )

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


@unittest.skipUnless(
    shutil.which("node") or shutil.which("osascript"),
    "No JS runtime (node or osascript) available"
)
class TestCompactLayoutAndZoomBehavioral(unittest.TestCase):
    """unification-032: canvas resize, entity contract, and zoom scale."""

    def test_exec_hidden_mount_then_visible_remount_resizes_canvas(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 0;
        sanctuary.clientHeight = 0;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 2;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        const hiddenWidth = canvas.width;
        const hiddenHeight = canvas.height;

        // Simulate the modal becoming visible.
        sanctuary.clientWidth = 500;
        sanctuary.clientHeight = 400;
        window.HomeSanctuary.mount(canvas, slot);

        return {
          hiddenWidth: hiddenWidth,
          hiddenHeight: hiddenHeight,
          width: canvas.width,
          height: canvas.height,
          styleWidth: canvas.style.width,
          styleHeight: canvas.style.height
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["width"], 1000,
                         "Visible remount at DPR=2 with 500px parent must set canvas.width = 1000")
        self.assertEqual(res["height"], 800,
                         "Visible remount at DPR=2 with 400px parent must set canvas.height = 800")
        self.assertEqual(res["styleWidth"], "100%",
                         "Canvas CSS width must remain 100%")
        self.assertEqual(res["styleHeight"], "100%",
                         "Canvas CSS height must remain 100%")

    def test_exec_frame_auto_resizes_on_visible_dimension_change(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 2;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        const initialWidth = canvas.width;
        const initialHeight = canvas.height;

        // Resize the parent and drive one frame tick.
        sanctuary.clientWidth = 300;
        sanctuary.clientHeight = 250;
        window.HomeSanctuary.__testHooks.frame();

        return {
          initialWidth: initialWidth,
          initialHeight: initialHeight,
          width: canvas.width,
          height: canvas.height
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["initialWidth"], 800,
                         "Initial mount at DPR=2 with 400px parent must set canvas.width = 800")
        self.assertEqual(res["initialHeight"], 800,
                         "Initial mount at DPR=2 with 400px parent must set canvas.height = 800")
        self.assertEqual(res["width"], 600,
                         "frame() must resize canvas.width to 300 * 2 = 600")
        self.assertEqual(res["height"], 500,
                         "frame() must resize canvas.height to 250 * 2 = 500")

    def test_exec_build_dog_entity_contract(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        let captured = null;
        window.CompanionDog = {
          prototype: {
            draw: function (ctx) { captured = this; }
          }
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.__testHooks.render();

        if (!captured) {
          return { captured: false };
        }

        const coat = captured.coat || {};
        return {
          captured: true,
          hasLeftEar: Boolean(captured.leftEar && typeof captured.leftEar.angle === 'number'),
          hasRightEar: Boolean(captured.rightEar && typeof captured.rightEar.angle === 'number'),
          heartsIsArray: Array.isArray(captured.hearts),
          emoteBubble: captured.emoteBubble === null ? 'null' : typeof captured.emoteBubble,
          hasStick: captured.hasStick,
          isBarking: captured.isBarking,
          owner: captured.owner === null ? 'null' : typeof captured.owner,
          isLeashed: captured.isLeashed,
          leash: captured.leash === null ? 'null' : typeof captured.leash,
          gaitMode: captured.gaitMode,
          coatKeys: {
            bodyColor: typeof coat.bodyColor,
            bodyShade: typeof coat.bodyShade,
            tanColor: typeof coat.tanColor,
            tanHighlight: typeof coat.tanHighlight,
            earRoot: typeof coat.earRoot,
            earHighlight: typeof coat.earHighlight,
            noseColor: typeof coat.noseColor,
            bibColor: typeof coat.bibColor,
            hasEyePatch: typeof coat.hasEyePatch
          }
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["captured"],
                        "Home Sanctuary must render via CompanionDog.prototype.draw")
        self.assertTrue(res["hasLeftEar"], "Entity must expose leftEar.angle")
        self.assertTrue(res["hasRightEar"], "Entity must expose rightEar.angle")
        self.assertTrue(res["heartsIsArray"], "Entity must expose a hearts array")
        self.assertEqual(res["emoteBubble"], "null",
                         "Entity must set emoteBubble === null")
        self.assertFalse(res["hasStick"], "Entity must set hasStick === false")
        self.assertFalse(res["isBarking"], "Entity must set isBarking === false")
        self.assertEqual(res["owner"], "null", "Entity must set owner === null")
        self.assertFalse(res["isLeashed"], "Entity must set isLeashed === false")
        self.assertEqual(res["leash"], "null", "Entity must set leash === null")
        self.assertIn(res["gaitMode"], ("WALK", "IDLE"),
                      "Entity gaitMode must be 'WALK' or 'IDLE'")
        for key, kind in res["coatKeys"].items():
            if key == "hasEyePatch":
                self.assertEqual(kind, "boolean",
                                 f"coat.{key} must be a boolean")
            else:
                self.assertEqual(kind, "string",
                                 f"coat.{key} must be a string")

    def test_exec_build_dog_entity_all_breeds_complete_palette(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const captured = [];
        window.CompanionDog = {
          prototype: {
            draw: function (ctx) { captured.push(this); }
          }
        };

        const breeds = ['CHOCOLATE_TAN', 'GOLDEN', 'BLACK_LAB', 'JACK_RUSSELL', 'RED_SETTER', 'BEAGLE', 'DALMATIAN'];
        const results = [];
        for (let i = 0; i < breeds.length; i++) {
          const slot = { id: 'dog-' + i, name: 'Dog' + i, coatKey: breeds[i] };
          window.HomeSanctuary.mount(canvas, slot);
          window.HomeSanctuary.__testHooks.render();
        }

        for (let i = 0; i < captured.length; i++) {
          const c = captured[i];
          const coat = c.coat || {};
          results.push({
            bodyColorValue: coat.bodyColor,
            bodyColor: typeof coat.bodyColor === 'string' && coat.bodyColor.length > 0,
            bodyShade: typeof coat.bodyShade === 'string' && coat.bodyShade.length > 0,
            tanColor: typeof coat.tanColor === 'string' && coat.tanColor.length > 0,
            tanHighlight: typeof coat.tanHighlight === 'string' && coat.tanHighlight.length > 0,
            earRoot: typeof coat.earRoot === 'string' && coat.earRoot.length > 0,
            earHighlight: typeof coat.earHighlight === 'string' && coat.earHighlight.length > 0,
            noseColor: typeof coat.noseColor === 'string' && coat.noseColor.length > 0,
            bibColor: typeof coat.bibColor === 'string' && coat.bibColor.length > 0,
            hasEyePatch: typeof coat.hasEyePatch === 'boolean'
          });
        }
        return { count: captured.length, results: results };
        """
        res = _run_js(snippet)
        self.assertGreater(res["count"], 0,
                           "At least one breed must render through CompanionDog.draw")
        for i, r in enumerate(res["results"]):
            for key, ok in r.items():
                if key == "bodyColorValue":
                    continue
                self.assertTrue(ok, f"Breed #{i} coat.{key} must be populated")
        self.assertEqual(
            len(set(r["bodyColorValue"] for r in res["results"][:5])), 5,
            "All 5 core breeds must have distinct body colors"
        )

    def test_exec_sanctuary_zoom_scale_applied(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const scales = [];
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          const originalScale = ctx.scale.bind(ctx);
          ctx.scale = function (sx, sy) {
            scales.push([sx, sy]);
            return originalScale(sx, sy);
          };
          return ctx;
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.__testHooks.render();

        return { scales: scales };
        """
        res = _run_js(snippet)
        self.assertTrue(
            any(abs(s[0] - 0.72) < 1e-6 and abs(s[1] - 0.72) < 1e-6
                for s in res["scales"]),
            "render() must apply ctx.scale(0.72, 0.72) around dog rendering",
        )

    def test_exec_fallback_without_companion_dog(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        // Ensure the CompanionDog global is absent so the fallback path runs.
        window.CompanionDog = undefined;

        const calls = { fillText: 0, ellipse: 0, arc: 0 };
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          const origFillText = ctx.fillText ? ctx.fillText.bind(ctx) : null;
          const origEllipse = ctx.ellipse ? ctx.ellipse.bind(ctx) : null;
          const origArc = ctx.arc ? ctx.arc.bind(ctx) : null;
          if (origFillText) {
            ctx.fillText = function () { calls.fillText++; return origFillText.apply(null, arguments); };
          }
          if (origEllipse) {
            ctx.ellipse = function () { calls.ellipse++; return origEllipse.apply(null, arguments); };
          }
          if (origArc) {
            ctx.arc = function () { calls.arc++; return origArc.apply(null, arguments); };
          }
          return ctx;
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        let threw = false;
        try {
          window.HomeSanctuary.__testHooks.render();
        } catch (e) {
          threw = true;
        }
        return {
          threw: threw,
          fillText: calls.fillText,
          ellipse: calls.ellipse,
          arc: calls.arc
        };
        """
        res = _run_js(snippet)
        self.assertFalse(res["threw"],
                         "Fallback render must not throw without CompanionDog")
        self.assertGreater(res["fillText"], 0,
                           "Fallback must draw the dog name tag via fillText")
        self.assertTrue(res["ellipse"] > 0 or res["arc"] > 0,
                        "Fallback must draw rounded body shapes via ellipse/arc")

    def test_exec_remount_preserves_dog_position_and_state(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 320;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.setDogState('sit');
        const before = window.HomeSanctuary.getCompanionDog();
        const beforeX = before.x;
        const beforeY = before.y;

        window.HomeSanctuary.mount(canvas, {
          id: 'dog-1', name: 'Renamed', coatKey: 'GOLDEN', collar: '#123456'
        });
        const after = window.HomeSanctuary.getCompanionDog();

        return {
          state: after.state,
          name: after.name,
          collar: after.collar,
          x: after.x,
          y: after.y,
          beforeX: beforeX,
          beforeY: beforeY
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["state"], "sit",
                         "Remount must preserve the dog's forced state")
        self.assertEqual(res["name"], "Renamed",
                         "Remount must apply the new slot name")
        self.assertEqual(res["collar"], "#123456",
                         "Remount must apply the new slot collar")
        self.assertEqual(res["x"], res["beforeX"],
                         "Remount must preserve the dog's x position")
        self.assertEqual(res["y"], res["beforeY"],
                         "Remount must preserve the dog's y position")

    def test_exec_draw_error_logged_once_per_mount_and_fallback_used(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        let warnCount = 0;
        const originalWarn = console.warn;
        console.warn = function () { warnCount++; };

        window.CompanionDog = {
          prototype: {
            draw: function () { throw new Error('draw failure'); }
          }
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.__testHooks.render();
        window.HomeSanctuary.__testHooks.render();
        const warnCountAfterTwo = warnCount;

        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.__testHooks.render();
        const warnCountAfterRemount = warnCount;

        console.warn = originalWarn;

        return {
          warnCountAfterTwo: warnCountAfterTwo,
          warnCountAfterRemount: warnCountAfterRemount
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["warnCountAfterTwo"], 1,
                         "Draw errors must be logged only once per mount")
        self.assertEqual(res["warnCountAfterRemount"], 2,
                         "A remount must reset the draw-error log guard")

    def test_exec_food_bowl_zoom_scale_applied(self):
        snippet = """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const scales = [];
        const originalGetContext = canvas.getContext;
        canvas.getContext = function () {
          const ctx = originalGetContext.call(canvas, '2d');
          if (!ctx) return ctx;
          const originalScale = ctx.scale.bind(ctx);
          ctx.scale = function (sx, sy) {
            scales.push([sx, sy]);
            return originalScale(sx, sy);
          };
          return ctx;
        };

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        window.HomeSanctuary.setDogState('eating');
        window.HomeSanctuary.__testHooks.render();

        return { scales: scales };
        """
        res = _run_js(snippet)
        zoomCount = sum(
            1 for s in res["scales"]
            if abs(s[0] - 0.72) < 1e-6 and abs(s[1] - 0.72) < 1e-6
        )
        self.assertGreaterEqual(
            zoomCount, 2,
            "render() must apply ctx.scale(0.72, 0.72) for both the dog and the food bowl",
        )

    def test_companion_dog_exposes_window_globals(self):
        dog_js = read("src/entities/companion_dog.js")
        self.assertIn("window.CompanionDog = CompanionDog", dog_js,
                      "companion_dog.js must expose window.CompanionDog")
        self.assertIn("window.CoatPreset = CoatPreset", dog_js,
                      "companion_dog.js must expose window.CoatPreset")
        self.assertIn("window.DogState = DogState", dog_js,
                      "companion_dog.js must expose window.DogState")


@unittest.skipUnless(
    shutil.which("node") or shutil.which("osascript"),
    "No JS runtime (node or osascript) available"
)
class TestCareActionsAndRejection(unittest.TestCase):
    """unification-036: always-clickable care buttons & rejection animation."""

    def _mount_snippet(self, body):
        return """
        const sanctuary = document.createElement('div');
        sanctuary.id = 'home-view-sanctuary';
        sanctuary.clientWidth = 400;
        sanctuary.clientHeight = 400;
        document.body.appendChild(sanctuary);
        const canvas = document.createElement('canvas');
        canvas.id = 'home-field-canvas';
        canvas.parentElement = sanctuary;
        sanctuary.appendChild(canvas);

        window.requestAnimationFrame = function () { return 0; };
        window.cancelAnimationFrame = function () {};
        window.devicePixelRatio = 1;

        const slot = { id: 'dog-1', name: 'Ziggy', coatKey: 'CHOCOLATE_TAN' };
        window.HomeSanctuary.mount(canvas, slot);
        const hooks = window.HomeSanctuary.__testHooks;
        """ + body

    def test_all_care_buttons_always_clickable(self):
        snippet = self._mount_snippet("""
        // The public API must expose a single care handler and never disable
        // the buttons via the sanctuary module.
        const api = window.HomeSanctuary;
        return {
          hasOnCareAction: typeof api.onCareAction === 'function',
          hasPlayRejection: typeof api.playRejection === 'function',
          hasClearRejection: typeof api.clearRejection === 'function',
          hasIsCareReady: typeof api.isCareReady === 'function',
          rejectionMs: api.REJECTION_ANIM_MS
        };
        """)
        res = _run_js(snippet)
        self.assertTrue(res["hasOnCareAction"],
                        "HomeSanctuary must expose onCareAction(kind)")
        self.assertTrue(res["hasPlayRejection"],
                        "HomeSanctuary must expose playRejection()")
        self.assertTrue(res["hasClearRejection"],
                        "HomeSanctuary must expose clearRejection()")
        self.assertTrue(res["hasIsCareReady"],
                        "HomeSanctuary must expose isCareReady(kind)")
        self.assertEqual(res["rejectionMs"], 500,
                         "REJECTION_ANIM_MS must be 500")

    def test_reject_feed_when_not_hungry_sets_rejection_flag(self):
        snippet = self._mount_snippet("""
        const dog = hooks.getDog();
        dog.isHungry = false;
        const accepted = window.HomeSanctuary.onCareAction('feed');
        return {
          accepted: accepted,
          rejectionActive: dog.rejectionActive,
          hasEndsAt: typeof dog.rejectionEndsAt === 'number' && dog.rejectionEndsAt > 0,
          hookActive: hooks.isRejectionActive()
        };
        """)
        res = _run_js(snippet)
        self.assertFalse(res["accepted"],
                         "Rejected feed must return false")
        self.assertTrue(res["rejectionActive"],
                        "Rejected feed must set homeDog.rejectionActive = true")
        self.assertTrue(res["hasEndsAt"],
                        "Rejected feed must set homeDog.rejectionEndsAt")
        self.assertTrue(res["hookActive"],
                        "Rejection state must be observable via test hooks")

    def test_reject_does_not_change_need_timers(self):
        snippet = self._mount_snippet("""
        const dog = hooks.getDog();
        dog.isHungry = false;
        dog.needsGrooming = false;
        dog.isTired = false;
        const before = {
          state: dog.state,
          groomTimer: dog.groomTimer || 0,
          sleepTimer: dog.sleepTimer || 0,
          emoteBubble: dog.emoteBubble || null
        };
        window.HomeSanctuary.onCareAction('feed');
        window.HomeSanctuary.onCareAction('groom');
        window.HomeSanctuary.onCareAction('rest');
        const after = {
          state: dog.state,
          groomTimer: dog.groomTimer || 0,
          sleepTimer: dog.sleepTimer || 0,
          emoteBubble: dog.emoteBubble || null
        };
        return { before: before, after: after };
        """)
        res = _run_js(snippet)
        self.assertEqual(res["before"], res["after"],
                         "Rejected care actions must not mutate care timers/needs")

    def test_ready_feed_runs_routine_and_clears_rejection(self):
        snippet = self._mount_snippet("""
        const dog = hooks.getDog();
        // Seed a stale rejection, then feed while hungry.
        dog.isHungry = true;
        window.HomeSanctuary.playRejection();
        const beforeActive = dog.rejectionActive;
        const accepted = window.HomeSanctuary.onCareAction('feed');
        return {
          beforeActive: beforeActive,
          accepted: accepted,
          rejectionActive: dog.rejectionActive,
          rejectionEndsAt: dog.rejectionEndsAt,
          emoteBubble: dog.emoteBubble
        };
        """)
        res = _run_js(snippet)
        self.assertTrue(res["beforeActive"],
                        "playRejection must set rejectionActive before feed")
        self.assertTrue(res["accepted"],
                        "Ready feed must be accepted")
        self.assertFalse(res["rejectionActive"],
                         "Ready feed must clear rejectionActive")
        self.assertEqual(res["rejectionEndsAt"], 0,
                         "Ready feed must clear rejectionEndsAt")
        self.assertEqual(res["emoteBubble"], "❤️",
                         "Ready feed must run the existing feed reaction")

    def test_care_buttons_never_disabled_when_timers_nonzero(self):
        snippet = self._mount_snippet("""
        // Store reports all needs as NOT due (timers non-zero).
        const store = {
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
          isHungry: () => false,
          needsGrooming: () => false,
          isTired: () => false
        };
        window.__vdwDogStateStore = store;
        window.HomeFeeding.mount({ dogStateStore: store });
        const feed = document.getElementById('btn-action-feed');
        const groom = document.getElementById('btn-action-groom');
        const rest = document.getElementById('btn-action-rest');
        const read = (el) => el ? {
          disabled: el.disabled,
          ariaDisabled: el.getAttribute('aria-disabled'),
          pointerEvents: el.style ? el.style.pointerEvents : null
        } : null;
        const result = { feed: read(feed), groom: read(groom), rest: read(rest) };
        window.HomeFeeding.unmount();
        return result;
        """)
        res = _run_js(snippet)
        for name in ("feed", "groom", "rest"):
            btn = res[name]
            self.assertIsNotNone(btn, "#btn-action-%s missing" % name)
            self.assertFalse(btn["disabled"],
                             "#btn-action-%s must never be disabled" % name)
            self.assertNotEqual(btn["ariaDisabled"], "true",
                                "#btn-action-%s must not set aria-disabled=true" % name)
            self.assertNotEqual(btn["pointerEvents"], "none",
                                "#btn-action-%s must not set pointer-events: none" % name)

    def test_rejection_click_does_not_mutate_timers_or_score(self):
        snippet = self._mount_snippet("""
        const calls = { feed: 0, groom: 0, rest: 0 };
        const store = {
          getSnapshot: () => ({
            version: 1,
            needs: {
              hunger: { lastFedAt: Date.now(), durationMs: 60000 },
              grooming: { lastGroomedAt: Date.now(), durationMs: 60000 },
              tiredness: { lastRestedAt: Date.now(), durationMs: 60000 }
            }
          }),
          subscribe: () => () => {},
          feed: () => { calls.feed++; },
          groom: () => { calls.groom++; },
          rest: () => { calls.rest++; },
          isHungry: () => false,
          needsGrooming: () => false,
          isTired: () => false
        };
        window.__vdwDogStateStore = store;
        window.HomeFeeding.mount({ dogStateStore: store });
        const dog = hooks.getDog();
        const before = {
          state: dog.state,
          groomTimer: dog.groomTimer || 0,
          sleepTimer: dog.sleepTimer || 0,
          emoteBubble: dog.emoteBubble || null
        };
        const feed = document.getElementById('btn-action-feed');
        const groom = document.getElementById('btn-action-groom');
        const rest = document.getElementById('btn-action-rest');
        if (feed) feed.click();
        if (groom) groom.click();
        if (rest) rest.click();
        const after = {
          state: dog.state,
          groomTimer: dog.groomTimer || 0,
          sleepTimer: dog.sleepTimer || 0,
          emoteBubble: dog.emoteBubble || null
        };
        const rejectionActive = hooks.isRejectionActive();
        window.HomeFeeding.unmount();
        return {
          before: before,
          after: after,
          calls: calls,
          rejectionActive: rejectionActive
        };
        """)
        res = _run_js(snippet)
        self.assertEqual(res["before"], res["after"],
                         "Rejected care clicks must not mutate dog state/timers")
        self.assertEqual(res["calls"], {"feed": 0, "groom": 0, "rest": 0},
                         "Rejected care clicks must not call store feed/groom/rest")
        self.assertTrue(res["rejectionActive"],
                        "Rejected care click must trigger the rejection animation")

    def test_ready_click_runs_care_routine(self):
        snippet = self._mount_snippet("""
        const calls = { feed: 0, groom: 0, rest: 0 };
        const store = {
          getSnapshot: () => ({
            version: 1,
            needs: {
              hunger: { lastFedAt: null, durationMs: 60000 },
              grooming: { lastGroomedAt: null, durationMs: 60000 },
              tiredness: { lastRestedAt: null, durationMs: 60000 }
            }
          }),
          subscribe: () => () => {},
          feed: () => { calls.feed++; },
          groom: () => { calls.groom++; },
          rest: () => { calls.rest++; },
          isHungry: () => true,
          needsGrooming: () => true,
          isTired: () => true
        };
        window.__vdwDogStateStore = store;
        window.HomeFeeding.mount({ dogStateStore: store });
        const dog = hooks.getDog();
        dog.isHungry = true;
        dog.needsGrooming = true;
        dog.isTired = true;
        const groom = document.getElementById('btn-action-groom');
        const rest = document.getElementById('btn-action-rest');
        if (groom) groom.click();
        if (rest) rest.click();
        const result = {
          calls: calls,
          groomTimer: dog.groomTimer || 0,
          sleepTimer: dog.sleepTimer || 0,
          rejectionActive: hooks.isRejectionActive()
        };
        window.HomeFeeding.unmount();
        return result;
        """)
        res = _run_js(snippet)
        self.assertEqual(res["calls"]["groom"], 1,
                         "Ready groom click must call store.groom() once")
        self.assertEqual(res["calls"]["rest"], 1,
                         "Ready rest click must call store.rest() once")
        self.assertGreater(res["groomTimer"], 0,
                           "Ready groom click must start the grooming timer")
        self.assertGreater(res["sleepTimer"], 0,
                           "Ready rest click must start the sleeping timer")
        self.assertFalse(res["rejectionActive"],
                         "Ready care click must not trigger rejection")

    def test_rejection_restarts_on_repeat_click(self):
        snippet = self._mount_snippet("""
        const dog = hooks.getDog();
        dog.isHungry = false;
        window.HomeSanctuary.onCareAction('feed');
        const firstEndsAt = dog.rejectionEndsAt;
        const firstFrame = hooks.getRejectionFrame();
        // Advance the frame counter, then re-click to restart.
        hooks.updateRejection();
        hooks.updateRejection();
        const midFrame = hooks.getRejectionFrame();
        window.HomeSanctuary.onCareAction('feed');
        const secondEndsAt = dog.rejectionEndsAt;
        const secondFrame = hooks.getRejectionFrame();
        return {
          firstEndsAt: firstEndsAt,
          secondEndsAt: secondEndsAt,
          firstFrame: firstFrame,
          midFrame: midFrame,
          secondFrame: secondFrame,
          active: dog.rejectionActive
        };
        """)
        res = _run_js(snippet)
        self.assertTrue(res["active"],
                        "Rejection must remain active after a repeat click")
        self.assertGreaterEqual(res["secondEndsAt"], res["firstEndsAt"],
                                "Repeat click must restart the rejection window")
        self.assertEqual(res["secondFrame"], 0,
                         "Repeat click must reset the animation frame counter")
        self.assertGreater(res["midFrame"], res["firstFrame"],
                           "updateRejection must advance the frame counter")

    def test_accepted_feed_mutates_store(self):
        snippet = self._mount_snippet("""
        const calls = { feed: 0, groom: 0, rest: 0 };
        const store = {
          getSnapshot: () => ({
            version: 1,
            needs: {
              hunger: { lastFedAt: null, durationMs: 60000 },
              grooming: { lastGroomedAt: null, durationMs: 60000 },
              tiredness: { lastRestedAt: null, durationMs: 60000 }
            }
          }),
          subscribe: () => () => {},
          feed: () => { calls.feed++; },
          groom: () => { calls.groom++; },
          rest: () => { calls.rest++; },
          isHungry: () => true,
          needsGrooming: () => true,
          isTired: () => true
        };
        window.__vdwDogStateStore = store;
        const dog = hooks.getDog();
        dog.isHungry = true;
        const accepted = window.HomeSanctuary.onCareAction('feed');
        return { accepted: accepted, calls: calls };
        """)
        res = _run_js(snippet)
        self.assertTrue(res["accepted"],
                        "Accepted feed must return true")
        self.assertEqual(res["calls"]["feed"], 1,
                         "Accepted feed must invoke store.feed() to reset the hunger timer")

    def test_rejection_produces_visual_offset(self):
        snippet = self._mount_snippet("""
        const dog = hooks.getDog();
        dog.isHungry = false;
        window.HomeSanctuary.playRejection();
        // Advance the rejection tick so the visual offset is computed.
        hooks.updateRejection();
        // Capture the rendered entity's position via a CompanionDog spy.
        let captured = null;
        window.CompanionDog = {
          prototype: {
            draw: function () { captured = this; }
          }
        };
        hooks.render();
        const baseX = dog.x;
        const baseY = dog.y;
        return {
          active: hooks.isRejectionActive(),
          captured: Boolean(captured),
          dx: captured ? (captured.x - baseX) : 0,
          dy: captured ? (captured.y - baseY) : 0
        };
        """)
        res = _run_js(snippet)
        self.assertTrue(res["active"],
                        "Rejection must remain active immediately after playRejection")
        self.assertTrue(res["captured"],
                        "render() must draw the dog via CompanionDog.prototype.draw")
        # The hop-back offset must move the rendered dog off its base position.
        self.assertTrue(abs(res["dy"]) > 0 or abs(res["dx"]) > 0,
                        "Rejection must apply a visible offset to the rendered dog")


if __name__ == '__main__':
    unittest.main()
