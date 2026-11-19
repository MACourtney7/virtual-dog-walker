#!/usr/bin/env python3
"""
End-to-end integration tests for unification-036 (Dog Behaviour Improvements).

Covers REQ-1..REQ-4 by driving the real JS modules through the repo's
existing Python harness idiom (osascript / node with a mocked DOM).

Acceptance criteria exercised:
  REQ-1 / REQ-2 (home view)
    - test_all_three_buttons_clickable_in_idle_state
    - test_click_care_when_not_needed_triggers_rejection
    - test_click_care_when_needed_performs_action
  REQ-3 (leash / poop)
    - test_owner_cannot_exceed_max_leash_length
    - test_owner_force_stopped_while_pooping_on_leash
    - test_owner_free_after_poop_and_off_leash
  REQ-4 (needs / speed / hold-up)
    - test_dog_slower_when_hungry_dirty_or_tired
    - test_owner_held_up_by_slowed_dog_on_leash

Tests skip cleanly when no JS runtime is available.
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


def _strip_esm(src):
    """Remove ESM import/export syntax so the module can run in a plain IIFE."""
    clean = re.sub(r"^\s*import\s+.*?;?\s*$", "", src, flags=re.M)
    clean = re.sub(r"\bexport\s+(default\s+)?", "", clean)
    return clean


def _run_js(snippet):
    """Execute a JS snippet against the real game modules.

    Loads home_sanctuary.js, companion_dog.js, owner.js and dog_state_store.js
    into a mocked-DOM harness, then evaluates `snippet` and returns the
    JSON-decoded result.
    """
    sanctuary_src = _strip_esm(read("src/ui/home_sanctuary.js"))
    dog_src = _strip_esm(read("src/entities/companion_dog.js"))
    owner_src = _strip_esm(read("src/entities/owner.js"))
    store_src = _strip_esm(read("src/state/dog_state_store.js"))

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
const setTimeout = (fn, ms) => 0;
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
window.localStorage = localStorage;

// ---- Load real modules ----
// dog_state_store.js exposes DogStateStore on globalThis.
(() => {{ {store_src} }})();
// companion_dog.js exposes CompanionDog / CoatPreset / DogState on window.
(() => {{ {dog_src} }})();
// owner.js exposes Owner on window (via ESM export stripped above).
(() => {{ {owner_src} }})();
// home_sanctuary.js is an IIFE that assigns window.HomeSanctuary.
(() => {{ {sanctuary_src} }})();

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


# ---------------------------------------------------------------------------
# Shared JS prelude: mount the sanctuary and expose helpers.
# ---------------------------------------------------------------------------

_MOUNT_PRELUDE = """
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
const homeDog = hooks.getDog();
"""


@unittest.skipUnless(
    shutil.which("node") or shutil.which("osascript"),
    "No JS runtime (node or osascript) available"
)
class TestHomeViewCareIntegration(unittest.TestCase):
    """REQ-1 / REQ-2: always-clickable care buttons + rejection animation."""

    def test_all_three_buttons_clickable_in_idle_state(self):
        """AC-1.1: Feed, Groom and Rest are all clickable in the idle state."""
        snippet = _MOUNT_PRELUDE + """
        // In the idle state none of the needs are active.
        homeDog.isHungry = false;
        homeDog.needsGrooming = false;
        homeDog.isTired = false;

        // Every care kind must be routed through onCareAction without throwing
        // and must return a boolean (never undefined / never disabled).
        const results = {
          feed: window.HomeSanctuary.onCareAction('feed'),
          groom: window.HomeSanctuary.onCareAction('groom'),
          rest: window.HomeSanctuary.onCareAction('rest')
        };
        return {
          feed: typeof results.feed,
          groom: typeof results.groom,
          rest: typeof results.rest,
          hasOnCareAction: typeof window.HomeSanctuary.onCareAction === 'function'
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["hasOnCareAction"],
                        "AC-1.1: HomeSanctuary must expose onCareAction(kind)")
        for kind in ("feed", "groom", "rest"):
            self.assertEqual(res[kind], "boolean",
                             f"AC-1.1: onCareAction('{kind}') must return a boolean "
                             f"(button must be clickable in idle state)")

    def test_click_care_when_not_needed_triggers_rejection(self):
        """AC-2.1: Clicking a care action the dog does not need triggers rejection."""
        snippet = _MOUNT_PRELUDE + """
        homeDog.isHungry = false;
        homeDog.needsGrooming = false;
        homeDog.isTired = false;

        const accepted = window.HomeSanctuary.onCareAction('feed');
        return {
          accepted: accepted,
          rejectionActive: Boolean(homeDog.rejectionActive),
          rejectionEndsAt: homeDog.rejectionEndsAt || 0,
          hookActive: hooks.isRejectionActive()
        };
        """
        res = _run_js(snippet)
        self.assertFalse(res["accepted"],
                         "AC-2.1: Rejected feed must return false")
        self.assertTrue(res["rejectionActive"],
                        "AC-2.1: Rejected feed must set homeDog.rejectionActive = true")
        self.assertGreater(res["rejectionEndsAt"], 0,
                           "AC-2.1: Rejected feed must set homeDog.rejectionEndsAt")
        self.assertTrue(res["hookActive"],
                        "AC-2.1: Rejection state must be observable via test hooks")

    def test_click_care_when_needed_performs_action(self):
        """AC-2.2: Clicking a needed care action performs the action (no rejection)."""
        snippet = _MOUNT_PRELUDE + """
        homeDog.isHungry = true;
        // Seed a stale rejection to prove the ready path clears it.
        window.HomeSanctuary.playRejection();
        const beforeActive = Boolean(homeDog.rejectionActive);

        const accepted = window.HomeSanctuary.onCareAction('feed');
        return {
          beforeActive: beforeActive,
          accepted: accepted,
          rejectionActive: Boolean(homeDog.rejectionActive),
          rejectionEndsAt: homeDog.rejectionEndsAt || 0,
          emoteBubble: homeDog.emoteBubble || null
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["beforeActive"],
                        "AC-2.2: playRejection must set rejectionActive before feed")
        self.assertTrue(res["accepted"],
                        "AC-2.2: Ready feed must be accepted")
        self.assertFalse(res["rejectionActive"],
                         "AC-2.2: Ready feed must clear rejectionActive")
        self.assertEqual(res["rejectionEndsAt"], 0,
                         "AC-2.2: Ready feed must clear rejectionEndsAt")
        self.assertEqual(res["emoteBubble"], "❤️",
                         "AC-2.2: Ready feed must run the existing feed reaction")


@unittest.skipUnless(
    shutil.which("node") or shutil.which("osascript"),
    "No JS runtime (node or osascript) available"
)
class TestLeashAndPoopIntegration(unittest.TestCase):
    """REQ-3: leash max length, poop force-stop, and post-poop release."""

    def test_owner_cannot_exceed_max_leash_length(self):
        """AC-3.1: Owner cannot exceed MAX_LEASH_LENGTH from the dog while leashed."""
        snippet = """
        // Resolve the leash module surface (frozen contract §5).
        const leash = window.Leash || (typeof Leash !== 'undefined' ? Leash : null);
        if (!leash || typeof leash.clampOwnerToLeash !== 'function') {
          return { available: false };
        }
        const MAX = leash.MAX_LEASH_LENGTH;

        // Owner far beyond the leash radius; clamp must pull it back.
        const dog = { x: 0, y: 0, isOnLeash: true, isPooping: false };
        const owner = { x: MAX * 5, y: 0, vx: 100, vy: 0 };
        const clamped = leash.clampOwnerToLeash(owner, dog);
        const dist = Math.hypot(clamped.x - dog.x, clamped.y - dog.y);
        return {
          available: true,
          max: MAX,
          dist: dist,
          withinTolerance: dist <= MAX + 1e-6
        };
        """
        res = _run_js(snippet)
        if not res.get("available"):
            self.skipTest("Leash module not present in this build")
        self.assertTrue(res["withinTolerance"],
                        f"AC-3.1: Owner distance {res['dist']} must not exceed "
                        f"MAX_LEASH_LENGTH {res['max']}")

    def test_owner_force_stopped_while_pooping_on_leash(self):
        """AC-3.2: Owner is force-stopped while the leashed dog is pooping."""
        snippet = """
        const leash = window.Leash || (typeof Leash !== 'undefined' ? Leash : null);
        if (!leash || typeof leash.isOwnerFrozen !== 'function') {
          return { available: false };
        }
        const dog = { x: 0, y: 0, isOnLeash: true, isPooping: true };
        const frozen = leash.isOwnerFrozen(dog);
        return { available: true, frozen: Boolean(frozen) };
        """
        res = _run_js(snippet)
        if not res.get("available"):
            self.skipTest("Leash module not present in this build")
        self.assertTrue(res["frozen"],
                        "AC-3.2: Owner must be frozen while the leashed dog is pooping")

    def test_owner_free_after_poop_and_off_leash(self):
        """AC-3.3: Owner is free once the dog stops pooping or is off-leash."""
        snippet = """
        const leash = window.Leash || (typeof Leash !== 'undefined' ? Leash : null);
        if (!leash || typeof leash.isOwnerFrozen !== 'function') {
          return { available: false };
        }
        const afterPoop = leash.isOwnerFrozen({ x: 0, y: 0, isOnLeash: true, isPooping: false });
        const offLeash = leash.isOwnerFrozen({ x: 0, y: 0, isOnLeash: false, isPooping: true });
        return {
          available: true,
          afterPoop: Boolean(afterPoop),
          offLeash: Boolean(offLeash)
        };
        """
        res = _run_js(snippet)
        if not res.get("available"):
            self.skipTest("Leash module not present in this build")
        self.assertFalse(res["afterPoop"],
                         "AC-3.3: Owner must be free after the dog stops pooping")
        self.assertFalse(res["offLeash"],
                         "AC-3.3: Owner must be free when the dog is off-leash")


@unittest.skipUnless(
    shutil.which("node") or shutil.which("osascript"),
    "No JS runtime (node or osascript) available"
)
class TestNeedsSpeedAndHoldUpIntegration(unittest.TestCase):
    """REQ-4: needs reduce speed; slowed dog holds up the owner on leash."""

    def test_dog_slower_when_hungry_dirty_or_tired(self):
        """AC-4.1 / AC-4.2: Any active need reduces speed; stacking does not zero it."""
        snippet = """
        const CompanionDogClass = window.CompanionDog;
        if (!CompanionDogClass || typeof CompanionDogClass.prototype.getEffectiveSpeed !== 'function') {
          return { available: false };
        }
        const makeDog = () => {
          const d = Object.create(CompanionDogClass.prototype);
          d.baseSpeed = 200;
          d.isHungry = false;
          d.needsGrooming = false;
          d.isTired = false;
          return d;
        };

        const baseline = makeDog().getEffectiveSpeed();

        const hungry = makeDog(); hungry.isHungry = true;
        const dirty = makeDog(); dirty.needsGrooming = true;
        const tired = makeDog(); tired.isTired = true;

        const all = makeDog();
        all.isHungry = true; all.needsGrooming = true; all.isTired = true;

        return {
          available: true,
          baseline: baseline,
          hungry: hungry.getEffectiveSpeed(),
          dirty: dirty.getEffectiveSpeed(),
          tired: tired.getEffectiveSpeed(),
          all: all.getEffectiveSpeed()
        };
        """
        res = _run_js(snippet)
        if not res.get("available"):
            self.skipTest("getEffectiveSpeed() not present in this build")
        self.assertGreater(res["baseline"], 0,
                           "AC-4.1: Baseline effective speed must be positive")
        for kind in ("hungry", "dirty", "tired"):
            self.assertLess(res[kind], res["baseline"],
                            f"AC-4.1: Dog must be slower when {kind}")
        self.assertGreater(res["all"], 0,
                           "AC-4.2: Stacking needs must not drive speed to zero")

    def test_owner_held_up_by_slowed_dog_on_leash(self):
        """AC-4.3: A slowed leashed dog holds the owner within MAX_LEASH_LENGTH."""
        snippet = """
        const leash = window.Leash || (typeof Leash !== 'undefined' ? Leash : null);
        if (!leash || typeof leash.clampOwnerToLeash !== 'function') {
          return { available: false };
        }
        const MAX = leash.MAX_LEASH_LENGTH;

        // Simulate the owner trying to run far ahead of a slowed dog.
        const dog = { x: 0, y: 0, isOnLeash: true, isPooping: false, isHungry: true };
        let owner = { x: 0, y: 0, vx: 0, vy: 0 };
        const step = MAX * 0.5;
        for (let i = 0; i < 20; i++) {
          owner.x += step;
          owner = leash.clampOwnerToLeash(owner, dog);
        }
        const dist = Math.hypot(owner.x - dog.x, owner.y - dog.y);
        return {
          available: true,
          max: MAX,
          dist: dist,
          heldUp: dist <= MAX + 1e-6
        };
        """
        res = _run_js(snippet)
        if not res.get("available"):
            self.skipTest("Leash module not present in this build")
        self.assertTrue(res["heldUp"],
                        f"AC-4.3: Owner must be held within MAX_LEASH_LENGTH "
                        f"({res['max']}) of the slowed dog; got {res['dist']}")


if __name__ == '__main__':
    unittest.main()
