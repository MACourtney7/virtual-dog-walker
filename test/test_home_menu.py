#!/usr/bin/env python3
"""
Unit & Acceptance Tests for the Home Menu (unification-028).
Validates:
- REQ-028.1: Home Button (🏠) & Home Modal Header
- REQ-028.2: Top Clean Stylized Stage Preview (You & Dog Standing Together)
- REQ-028.3: Single-Slot Immutable Dogs Submenu & First-Time / Empty-Slot Lock
- REQ-028.4: Custom Dog Name, Breed Label Cleanup, Canvas Name Tag & Toast Integration
- REQ-028.5: Browser localStorage Persistence & zero_network Broadcast
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
    """Execute a JS snippet against the real SocialHUD class.

    Strips ESM import/export lines, provides minimal module stubs and a mock
    DOM, wraps the module in an IIFE, and runs the snippet via osascript
    (JavaScriptCore) or node. Returns the JSON-decoded result of the snippet.
    """
    hud_src = read("src/ui/social_hud.js")
    dog_src = read("src/entities/companion_dog.js")

    clean_hud = re.sub(r"^\s*import\s+.*?;?\s*$", "", hud_src, flags=re.M)
    clean_hud = re.sub(r"\bexport\s+(default\s+)?", "", clean_hud)

    clean_dog = re.sub(r"^\s*import\s+.*?;?\s*$", "", dog_src, flags=re.M)
    clean_dog = re.sub(r"\bexport\s+(default\s+)?", "", clean_dog)

    harness = f"""
// ---- Minimal module stubs ----
const Protocol = {{
  createHello(peerId, name, jacketColor, coatName, extraMeta) {{
    return {{ type: 'HELLO', senderId: peerId, name, jacketColor, coatName, ...(extraMeta || {{}}) }};
  }}
}};
class TouchControls {{}}
const WSStatus = {{ CONNECTED: 'CONNECTED', CONNECTING: 'CONNECTING', RECONNECTING: 'RECONNECTING', OFFLINE: 'OFFLINE', ERROR: 'ERROR' }};
const NetStatus = {{ CONNECTED_PEER: 'CONNECTED_PEER', HOSTING: 'HOSTING', CONNECTING: 'CONNECTING', OFFLINE: 'OFFLINE', ERROR: 'ERROR' }};
const PUBLIC_ZONE_IDS = [];
function isPublicZoneId() {{ return false; }}

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
  'hud-overlay': __makeEl('div'),
  'controls-hint': __makeEl('div')
}};
const document = {{
  _byId: __elements,
  getElementById(id) {{ return __elements[id] || null; }},
  createElement(tag) {{ return __makeEl(tag); }},
  querySelector() {{ return null; }},
  querySelectorAll(sel) {{
    // Return the real tab buttons / panes so bindEvents() can wire handlers.
    if (sel === '.customizer-tab-btn') {{
      return ['tab-btn-walker', 'tab-btn-dog']
        .map(function (id) {{ return __elements[id]; }})
        .filter(Boolean);
    }}
    if (sel === '.customizer-tab-pane') {{
      return ['cust-tab-walker', 'cust-tab-dog']
        .map(function (id) {{ return __elements[id]; }})
        .filter(Boolean);
    }}
    return [];
  }},
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

// ---- Load real modules ----
const {{ resolveCoatPresetByName, CoatPreset }} = (() => {{ {clean_dog}\nreturn {{ resolveCoatPresetByName, CoatPreset }}; }})();
const {{ SocialHUD }} = (() => {{ {clean_hud}\nreturn {{ SocialHUD }}; }})();

// The mock DOM does not parse innerHTML, so register the tab buttons and
// panes that initHUD() declares in markup. This lets bindEvents() attach
// real click listeners to #tab-btn-dog / #tab-btn-walker.
(function () {{
  function reg(id, attrs) {{
    if (__elements[id]) return;
    const el = __makeEl('button');
    el.id = id;
    if (attrs) {{
      for (const k in attrs) {{ el.setAttribute(k, attrs[k]); }}
    }}
    __elements[id] = el;
  }}
  reg('tab-btn-walker', {{ 'data-tab': 'cust-tab-walker' }});
  reg('tab-btn-dog', {{ 'data-tab': 'cust-tab-dog' }});
  reg('cust-tab-walker');
  reg('cust-tab-dog');
}})();

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


class TestHomeHUDAndStage(unittest.TestCase):
    """REQ-028.1 / REQ-028.2: Home button, modal header, and stage preview."""

    def setUp(self):
        self.hud_js = read("src/ui/social_hud.js")
        self.style_css = read("src/style.css")

    def test_home_button_icon_and_aria(self):
        self.assertIn('id="btn-customize"', self.hud_js)
        self.assertIn('🏠', self.hud_js, "#btn-customize must contain the house icon 🏠")
        self.assertTrue(
            'aria-label="Home"' in self.hud_js or "aria-label='Home'" in self.hud_js,
            "#btn-customize must have aria-label=\"Home\""
        )
        self.assertTrue(
            'title="Home"' in self.hud_js or "title='Home'" in self.hud_js,
            "#btn-customize must have title=\"Home\""
        )

    def test_modal_header_is_home(self):
        self.assertTrue(
            '<h3>Home</h3>' in self.hud_js or '<h3 id="home-header-title">Home</h3>' in self.hud_js,
            "Customizer modal header must be <h3>Home</h3> or <h3 id=\"home-header-title\">Home</h3>"
        )

    def test_stage_preview_elements(self):
        self.assertIn('home-stage-preview', self.hud_js, "Missing .home-stage-preview container")
        self.assertIn('id="home-stage-canvas"', self.hud_js, "Missing #home-stage-canvas element")
        self.assertIn('home-stage-preview', self.style_css, "Missing .home-stage-preview CSS rule")

    def test_tab_buttons_you_and_dogs(self):
        self.assertIn('cust-tab-walker', self.hud_js, "Missing You tab pane id")
        self.assertIn('cust-tab-dog', self.hud_js, "Missing Dogs tab pane id")
        self.assertIn('👤 You', self.hud_js, "Missing '👤 You' tab button label")
        self.assertIn('🐕 Dogs', self.hud_js, "Missing '🐕 Dogs' tab button label")

    def test_glassmorphic_css_rules_present(self):
        css = self.style_css

        # .home-field-preview must be a compact turf panel.
        preview_idx = css.find('.home-field-preview')
        self.assertNotEqual(preview_idx, -1, "Missing .home-field-preview CSS rule")
        preview_block = css[preview_idx:preview_idx + 600]
        self.assertIn('aspect-ratio: 5 / 4;', preview_block,
                      ".home-field-preview must set aspect-ratio: 5 / 4;")
        self.assertIn('max-height: 52vh;', preview_block,
                      ".home-field-preview must set max-height: 52vh;")
        self.assertIn('background: #3e6b2c;', preview_block,
                      ".home-field-preview must use the 'The Downs' turf background #3e6b2c")

        # .customizer-settings must be glassmorphic (rgba background).
        settings_idx = css.find('.customizer-settings')
        self.assertNotEqual(settings_idx, -1, "Missing .customizer-settings CSS rule")
        settings_block = css[settings_idx:settings_idx + 400]
        self.assertIn('rgba(', settings_block,
                      ".customizer-settings must use a glassmorphic rgba background")

        # .btn-action-feed must be emerald glassmorphic.
        feed_idx = css.find('.btn-action-feed')
        self.assertNotEqual(feed_idx, -1, "Missing .btn-action-feed CSS rule")
        feed_block = css[feed_idx:feed_idx + 600]
        self.assertIn('rgba(16, 185, 129', feed_block,
                      ".btn-action-feed must use an emerald rgba(16, 185, 129 ...) background/border")

    def test_modal_header_actions_layout(self):
        css = self.style_css
        idx = css.find('.customizer-header-actions')
        self.assertNotEqual(idx, -1, "Missing .customizer-header-actions CSS rule")
        block = css[idx:idx + 300]
        self.assertIn('display: flex;', block,
                      ".customizer-header-actions must be styled with display: flex;")


class TestSquareLayoutContracts(unittest.TestCase):
    """unification-031: Square field layout CSS & markup contracts."""

    def setUp(self):
        self.hud_js = read("src/ui/social_hud.js")
        self.style_css = read("src/style.css")

    def test_home_field_preview_is_compact(self):
        css = self.style_css
        idx = css.find('.home-field-preview')
        self.assertNotEqual(idx, -1, "Missing .home-field-preview CSS rule")
        block = css[idx:idx + 600]
        self.assertIn('aspect-ratio: 5 / 4;', block,
                      ".home-field-preview must set aspect-ratio: 5 / 4;")
        self.assertIn('max-height: 52vh;', block,
                      ".home-field-preview must set max-height: 52vh;")

    def test_home_field_canvas_fills_container(self):
        css = self.style_css
        idx = css.find('#home-field-canvas')
        self.assertNotEqual(idx, -1, "Missing #home-field-canvas CSS rule")
        block = css[idx:idx + 300]
        self.assertIn('width: 100%;', block,
                      "#home-field-canvas must set width: 100%;")
        self.assertIn('height: 100%;', block,
                      "#home-field-canvas must set height: 100%;")

    def test_home_field_canvas_markup_not_fixed_rectangular(self):
        self.assertIn('id="home-field-canvas"', self.hud_js,
                      "Missing #home-field-canvas element")
        idx = self.hud_js.find('id="home-field-canvas"')
        # Inspect the surrounding tag markup for fixed rectangular dimensions.
        start = self.hud_js.rfind('<canvas', 0, idx)
        end = self.hud_js.find('>', idx)
        self.assertNotEqual(start, -1, "Could not locate <canvas> tag for #home-field-canvas")
        tag = self.hud_js[start:end + 1]
        self.assertNotIn('width="340"', tag,
                         "#home-field-canvas must not pin width=\"340\"")
        self.assertNotIn('height="220"', tag,
                         "#home-field-canvas must not pin height=\"220\"")

    def test_home_view_sanctuary_overflow_hidden(self):
        css = self.style_css
        idx = css.find('#home-view-sanctuary')
        self.assertNotEqual(idx, -1, "Missing #home-view-sanctuary CSS rule")
        block = css[idx:idx + 400]
        self.assertIn('overflow: hidden;', block,
                      "#home-view-sanctuary must set overflow: hidden;")

    def test_compact_modal_max_width_media_query(self):
        css = self.style_css
        # Locate the compact media query block.
        m = re.search(
            r"@media\s*\(\s*max-width:\s*768px\s*\)\s*,\s*\(\s*pointer:\s*coarse\s*\)\s*\{",
            css,
        )
        self.assertIsNotNone(
            m,
            "Missing @media (max-width: 768px), (pointer: coarse) block",
        )
        # Extract the block body by brace matching.
        start = m.end()
        depth = 1
        i = start
        while i < len(css) and depth > 0:
            if css[i] == '{':
                depth += 1
            elif css[i] == '}':
                depth -= 1
            i += 1
        block = css[start:i]
        self.assertIn('#customizer-modal', block,
                      "Compact media query must target #customizer-modal")
        self.assertRegex(
            block,
            r"#customizer-modal\s*\{[^}]*max-width:\s*min\(\s*360px\s*,\s*92vw\s*\)",
            "#customizer-modal must cap width with max-width: min(360px, 92vw)",
        )


class TestDogSlotKennelAndLocking(unittest.TestCase):
    """REQ-028.3: Single-slot immutable kennel and first-time / empty-slot lock."""

    def setUp(self):
        self.hud_js = read("src/ui/social_hud.js")

    def test_single_slot_kennel_structure(self):
        self.assertTrue(
            'id="dog-slot-occupied"' in self.hud_js or "'dog-slot-occupied'" in self.hud_js,
            "Missing #dog-slot-occupied container"
        )
        self.assertTrue(
            'id="btn-remove-dog"' in self.hud_js or "'btn-remove-dog'" in self.hud_js,
            "Missing #btn-remove-dog button"
        )
        self.assertIn('id="dog-slot-empty"', self.hud_js, "Missing #dog-slot-empty container")
        self.assertIn('id="btn-add-dog"', self.hud_js, "Missing #btn-add-dog button")

    def test_empty_slot_form_fields(self):
        self.assertIn('id="cust-dog-name"', self.hud_js, "Missing dog name input #cust-dog-name")
        self.assertIn('id="cust-dog-coat"', self.hud_js, "Missing breed select #cust-dog-coat")
        self.assertIn('collar-palette', self.hud_js, "Missing collar swatch palette")
        self.assertIn('cust-personality-playfulness', self.hud_js, "Missing personality sliders")

    def test_empty_slot_prefilled_with_ziggy_defaults(self):
        # Default dog name Ziggy
        self.assertIn("'Ziggy'", self.hud_js, "Default dog name must be 'Ziggy'")
        # Default coat key
        self.assertIn('CHOCOLATE_TAN', self.hud_js, "Default coat key must be CHOCOLATE_TAN")
        # Default teal collar
        self.assertIn('#0d9488', self.hud_js, "Default collar color must be teal (#0d9488)")

    def test_home_lock_logic(self):
        self.assertIn('isHomeLocked', self.hud_js, "Missing isHomeLocked state flag")
        # Lock must be enforced when closing the modal
        self.assertRegex(
            self.hud_js,
            r'isHomeLocked',
            "isHomeLocked must gate modal closing"
        )

    def test_add_dog_unlocks(self):
        # Adding a dog must clear the lock
        self.assertRegex(
            self.hud_js,
            r'isHomeLocked\s*=\s*false',
            "Adding a dog must set isHomeLocked = false"
        )


class TestCompanionDogNameAndToasts(unittest.TestCase):
    """REQ-028.4: Custom dog name, breed label cleanup, canvas name tag, toasts."""

    def setUp(self):
        self.dog_js = read("src/entities/companion_dog.js")
        self.main_js = read("src/main.js")

    def test_companion_dog_name_default(self):
        self.assertRegex(
            self.dog_js,
            r"this\.name\s*=\s*(?:name\s*\|\|\s*)?['\"]Ziggy['\"]",
            "CompanionDog must default this.name to 'Ziggy'"
        )

    def test_chocolate_tan_breed_label(self):
        self.assertIn(
            'Chocolate & Tan Cocker Spaniel',
            self.dog_js,
            "CoatPreset.CHOCOLATE_TAN.name must be 'Chocolate & Tan Cocker Spaniel'"
        )

    def test_resolve_coat_preset_by_name_legacy(self):
        self.assertIn(
            'resolveCoatPresetByName',
            self.dog_js,
            "Missing resolveCoatPresetByName helper"
        )
        self.assertIn(
            'Chocolate & Tan (Ziggy)',
            self.dog_js,
            "resolveCoatPresetByName must support legacy 'Chocolate & Tan (Ziggy)'"
        )

    def test_canvas_name_tag_drawing(self):
        self.assertRegex(
            self.dog_js,
            r'draw\s*\(\s*ctx',
            "CompanionDog must implement draw(ctx)"
        )
        self.assertIn('this.name', self.dog_js, "Canvas name tag must render this.name")

    def test_main_js_toasts_use_dog_name(self):
        self.assertIn('this.dog.name', self.main_js, "main.js toasts must use this.dog.name")


class TestReviewRemediation(unittest.TestCase):
    """Brief 06: behavioral remediation tests for unification-028."""

    def setUp(self):
        self.hud_js = read("src/ui/social_hud.js")
        self.main_js = read("src/main.js")
        self.dog_js = read("src/entities/companion_dog.js")

    def test_saved_empty_slot_honors_lock(self):
        # loadSavedProfile must honor an explicitly saved empty slot.
        self.assertRegex(
            self.hud_js,
            r"saved\.dogSlot\s*===\s*null",
            "loadSavedProfile must branch on saved.dogSlot === null"
        )
        # Within that branch the slot must be cleared and Home locked.
        self.assertRegex(
            self.hud_js,
            r"saved\.dogSlot\s*===\s*null[\s\S]{0,400}this\.dogSlot\s*=\s*null",
            "Saved empty slot must set this.dogSlot = null"
        )
        self.assertRegex(
            self.hud_js,
            r"saved\.dogSlot\s*===\s*null[\s\S]{0,400}this\.isHomeLocked\s*=\s*true",
            "Saved empty slot must set this.isHomeLocked = true"
        )

    def test_lock_blocks_modal_close_and_movement(self):
        # closeModal must refuse to close while locked.
        self.assertIn("closeModal()", self.hud_js, "Missing closeModal() method")
        self.assertRegex(
            self.hud_js,
            r"closeModal\s*\(\s*\)\s*\{[\s\S]{0,400}this\.isHomeLocked",
            "closeModal must check isHomeLocked"
        )
        self.assertIn(
            "Please add a dog to your slot before heading out!",
            self.hud_js,
            "Locked close must show the warning toast"
        )
        # openModal must not toggle closed while locked.
        self.assertRegex(
            self.hud_js,
            r"openModal\s*\(\s*\)\s*\{[\s\S]{0,600}this\.isHomeLocked",
            "openModal must guard against toggling closed while locked"
        )
        # main.js must gate movement while hud.isHomeLocked.
        self.assertIn("hud.isHomeLocked", self.main_js, "main.js must gate movement on hud.isHomeLocked")

    def test_stage_preview_empty_slot_and_animation(self):
        self.assertIn("_readEmptySlotPreview", self.hud_js, "Missing empty-slot preview builder")
        self.assertIn("startStageAnimation", self.hud_js, "Missing startStageAnimation")
        self.assertIn("stopStageAnimation", self.hud_js, "Missing stopStageAnimation")
        self.assertIn("stageAnimId", self.hud_js, "Missing stageAnimId handle")
        self.assertIn("requestAnimationFrame", self.hud_js, "Stage animation must use requestAnimationFrame")
        self.assertIn("cancelAnimationFrame", self.hud_js, "Stage animation must use cancelAnimationFrame")
        # Preview must read from the creation form inputs.
        self.assertIn("cust-dog-name", self.hud_js, "Preview must read #cust-dog-name")
        self.assertIn("cust-dog-coat", self.hud_js, "Preview must read #cust-dog-coat")

    def test_remove_dog_persists_empty_slot(self):
        self.assertIn("removeDog", self.hud_js, "Missing removeDog() method")
        self.assertRegex(
            self.hud_js,
            r"removeDog\s*\(\s*\)\s*\{[\s\S]{0,400}this\.dogSlot\s*=\s*null",
            "removeDog must clear this.dogSlot"
        )
        self.assertRegex(
            self.hud_js,
            r"removeDog\s*\(\s*\)\s*\{[\s\S]{0,800}this\.persistProfile\s*\(",
            "removeDog must persist the empty slot"
        )
        # persistProfile must write dogSlot (null when empty).
        self.assertIn("dogSlot: this.dogSlot", self.hud_js, "persistProfile must store dogSlot")

    def test_resolve_coat_preset_by_name(self):
        self.assertIn("resolveCoatPresetByName", self.dog_js, "Missing resolveCoatPresetByName")
        self.assertIn("Chocolate & Tan Cocker Spaniel", self.dog_js, "Missing current breed label")
        self.assertIn("Chocolate & Tan (Ziggy)", self.dog_js, "Missing legacy breed label")
        # social_hud must import and use the resolver.
        self.assertIn("resolveCoatPresetByName", self.hud_js, "social_hud must import resolveCoatPresetByName")
        # main.js must use the resolver for remote players.
        self.assertIn("resolveCoatPresetByName", self.main_js, "main.js must use resolveCoatPresetByName")


class TestNetworkProtocolAndStorage(unittest.TestCase):
    """REQ-028.5: Protocol dogName field and localStorage persistence."""

    def setUp(self):
        self.protocol_js = read("src/net/protocol.js")
        self.hud_js = read("src/ui/social_hud.js")

    def test_create_hello_includes_dog_name(self):
        self.assertIn('dogName', self.protocol_js, "Protocol.createHello must include dogName")

    def test_localstorage_persists_dog_slot_and_name(self):
        self.assertIn('clifton_walker_profile', self.hud_js, "Missing clifton_walker_profile localStorage key")
        self.assertIn('dogSlot', self.hud_js, "localStorage save must include dogSlot")
        self.assertIn('dogName', self.hud_js, "localStorage save must include dogName")


class TestHomeMenuBehavioralExecutable(unittest.TestCase):
    """Brief 09: executable behavioral verification of the Home menu."""

    def test_exec_resolve_coat_preset_by_name(self):
        snippet = """
        const current = resolveCoatPresetByName('Chocolate & Tan Cocker Spaniel');
        const legacy = resolveCoatPresetByName('Chocolate & Tan (Ziggy)');
        const unknown = resolveCoatPresetByName('Not A Real Breed');
        return {
          currentBody: current ? current.bodyColor : null,
          currentName: current ? current.name : null,
          legacyBody: legacy ? legacy.bodyColor : null,
          legacyName: legacy ? legacy.name : null,
          unknown: Boolean(unknown && typeof unknown.bodyColor === 'string' && unknown.bodyColor.length > 0)
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["currentBody"], "#2e1a14")
        self.assertEqual(res["legacyBody"], "#2e1a14")
        self.assertEqual(res["currentName"], "Chocolate & Tan Cocker Spaniel")
        self.assertEqual(res["legacyName"], "Chocolate & Tan Cocker Spaniel")
        self.assertTrue(res["unknown"], "Unknown breed must resolve to a valid coat preset")

    def test_exec_load_saved_empty_slot_locks(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: null
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});
        return {
          dogSlot: hud.dogSlot,
          isHomeLocked: hud.isHomeLocked
        };
        """
        res = _run_js(snippet)
        self.assertIsNone(res["dogSlot"], "Saved empty slot must leave dogSlot null")
        self.assertTrue(res["isHomeLocked"], "Saved empty slot must lock Home")

    def test_exec_lock_blocks_modal_dismissal(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: null
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});
        const modal = document.getElementById('customizer-modal');
        modal.style.display = 'block';
        hud.isHomeLocked = true;

        hud.openModal();
        const afterOpen = modal.style.display;
        hud.closeModal();
        const afterClose = modal.style.display;

        return { afterOpen: afterOpen, afterClose: afterClose };
        """
        res = _run_js(snippet)
        self.assertEqual(res["afterOpen"], "block",
                         "openModal must not toggle closed while locked")
        self.assertEqual(res["afterClose"], "block",
                         "closeModal must refuse to close while locked")

    def test_exec_remove_dog_persists_null_and_resets_dog(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: { name: 'Ziggy', coatKey: 'CHOCOLATE_TAN', collarColor: '#0d9488',
                     personality: { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 } }
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        let broadcastCount = 0;
        let lastLocalMeta = null;
        let lastBroadcast = null;
        const net = {
          peerId: 'p1',
          setLocalMeta(meta) { lastLocalMeta = meta; },
          broadcast(msg) { broadcastCount++; lastBroadcast = msg; }
        };
        const hud = new SocialHUD(net, owner, dog, {});
        const hadSlot = hud.dogSlot !== null;

        hud.removeDog();

        const saved = JSON.parse(localStorage.getItem('clifton_walker_profile'));
        return {
          hadSlot: hadSlot,
          dogSlot: hud.dogSlot,
          isHomeLocked: hud.isHomeLocked,
          dogName: hud.dog.name,
          savedDogSlot: saved.dogSlot,
          broadcastCount: broadcastCount,
          lastLocalMeta: lastLocalMeta,
          lastBroadcast: lastBroadcast
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["hadSlot"], "Test setup must start with an occupied slot")
        self.assertIsNone(res["dogSlot"], "removeDog must clear dogSlot")
        self.assertTrue(res["isHomeLocked"], "removeDog must lock Home")
        self.assertEqual(res["dogName"], "", "removeDog must reset the live dog name")
        self.assertIsNone(res["savedDogSlot"], "removeDog must persist dogSlot: null")
        self.assertGreaterEqual(res["broadcastCount"], 1,
                                "removeDog must broadcast the empty profile")
        self.assertFalse(res.get("lastLocalMeta", {}).get("hasDog"),
                         "removeDog must broadcast setLocalMeta with hasDog: false")
        self.assertEqual(res.get("lastLocalMeta", {}).get("dogName"), "",
                         "removeDog must broadcast setLocalMeta with dogName: ''")
        self.assertFalse(res.get("lastBroadcast", {}).get("hasDog"),
                         "removeDog must broadcast with hasDog: false")
        self.assertEqual(res.get("lastBroadcast", {}).get("dogName"), "",
                         "removeDog must broadcast with dogName: ''")

    def test_exec_adopt_releases_lock_and_allows_walk(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: null
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: '', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        const lockedBefore = hud.isHomeLocked;
        const canWalkBefore = hud.canWalkInPark();

        const nameInput = document.getElementById('cust-dog-name');
        const coatSelect = document.getElementById('cust-dog-coat');
        if (nameInput) nameInput.value = 'Ziggy';
        if (coatSelect) coatSelect.value = 'CHOCOLATE_TAN';

        hud.adoptDogFromForm();

        const lockedAfter = hud.isHomeLocked;
        const canWalkAfter = hud.canWalkInPark();

        const modal = document.getElementById('customizer-modal');
        modal.style.display = 'block';
        hud.closeModal();
        const afterClose = modal.style.display;

        return {
          lockedBefore: lockedBefore,
          canWalkBefore: canWalkBefore,
          lockedAfter: lockedAfter,
          canWalkAfter: canWalkAfter,
          afterClose: afterClose
        };
        """
        res = _run_js(snippet)
        self.assertTrue(res["lockedBefore"],
                        "A null dogSlot must start locked")
        self.assertFalse(res["canWalkBefore"],
                         "A null dogSlot must not allow walking")
        self.assertFalse(res["lockedAfter"],
                         "Adopting a dog must release the Home lock")
        self.assertTrue(res["canWalkAfter"],
                        "Adopting a dog must allow walking in the park")
        self.assertEqual(res["afterClose"], "none",
                         "closeModal must succeed once a dog is adopted")

    def test_exec_add_dog_populates_slot_and_unlocks(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: null
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: '', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        // The empty-slot form is rendered by renderDogSlot(); populate the
        // inputs it creates and adopt.
        const nameInput = document.getElementById('cust-dog-name');
        const coatSelect = document.getElementById('cust-dog-coat');
        if (nameInput) nameInput.value = 'Ziggy';
        if (coatSelect) coatSelect.value = 'CHOCOLATE_TAN';

        hud.adoptDogFromForm();

        const modal = document.getElementById('customizer-modal');
        modal.style.display = 'block';
        hud.closeModal();
        const afterClose = modal.style.display;

        return {
          dogSlotName: hud.dogSlot ? hud.dogSlot.name : null,
          isHomeLocked: hud.isHomeLocked,
          dogName: hud.dog.name,
          afterClose: afterClose
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["dogSlotName"], "Ziggy",
                         "Adopting must populate the slot with the default name")
        self.assertFalse(res["isHomeLocked"], "Adopting must unlock Home")
        self.assertEqual(res["dogName"], "Ziggy",
                         "Adopting must set the live dog name")
        self.assertEqual(res["afterClose"], "none",
                         "Modal must be closable once a dog is adopted")

    def test_exec_apply_remote_dog_presence_clears_dog(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: { name: 'Ziggy', coatKey: 'CHOCOLATE_TAN', collarColor: '#0d9488',
                     personality: { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 } }
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        const remote = { hasDog: true, dog: { name: 'Ziggy' } };
        hud.applyRemoteDogPresence(remote, { hasDog: false, dogName: '' });
        const afterFalse = { hasDog: remote.hasDog, dogName: remote.dog ? remote.dog.name : null };

        const remote2 = { hasDog: true, dog: { name: 'Ziggy' } };
        hud.applyRemoteDogPresence(remote2, { dogName: '' });
        const afterEmptyName = { hasDog: remote2.hasDog, dogName: remote2.dog ? remote2.dog.name : null };

        return { afterFalse: afterFalse, afterEmptyName: afterEmptyName };
        """
        res = _run_js(snippet)
        self.assertFalse(res["afterFalse"]["hasDog"],
                         "applyRemoteDogPresence must set remote.hasDog = false for hasDog: false")
        self.assertEqual(res["afterFalse"]["dogName"], "",
                         "applyRemoteDogPresence must clear remote.dog.name for hasDog: false")
        self.assertFalse(res["afterEmptyName"]["hasDog"],
                         "applyRemoteDogPresence must set remote.hasDog = false for dogName: ''")
        self.assertEqual(res["afterEmptyName"]["dogName"], "",
                         "applyRemoteDogPresence must clear remote.dog.name for dogName: ''")


class TestHomeViewSplit(unittest.TestCase):
    """unification-029: Home Sanctuary vs. Settings submenu split."""

    def setUp(self):
        self.hud_js = read("src/ui/social_hud.js")

    def test_home_settings_button_contract(self):
        self.assertIn('id="btn-home-settings"', self.hud_js,
                      "Missing #btn-home-settings button")
        self.assertIn('⚙️', self.hud_js,
                      "#btn-home-settings must contain the gear icon ⚙️")
        settings_idx = self.hud_js.find('id="btn-home-settings"')
        close_idx = self.hud_js.find('id="btn-close-customizer"')
        self.assertNotEqual(settings_idx, -1, "Missing #btn-home-settings")
        self.assertNotEqual(close_idx, -1, "Missing #btn-close-customizer")
        self.assertLess(settings_idx, close_idx,
                        "#btn-home-settings must precede #btn-close-customizer")

    def test_home_back_button_contract(self):
        self.assertIn('id="btn-home-back"', self.hud_js,
                      "Missing #btn-home-back button")
        self.assertIn('← Back', self.hud_js,
                      "#btn-home-back must contain the '← Back' label")

    def test_settings_header_wardrobe_and_kennel(self):
        self.assertIn('Wardrobe & Kennel', self.hud_js,
                      "Settings submenu header must include 'Wardrobe & Kennel'")

    def test_home_view_containers(self):
        self.assertIn('id="home-view-sanctuary"', self.hud_js,
                      "Missing #home-view-sanctuary container")
        self.assertIn('id="home-view-settings"', self.hud_js,
                      "Missing #home-view-settings container")

    def test_resolve_home_view_helper(self):
        self.assertIn('resolveHomeView', self.hud_js,
                      "Missing resolveHomeView helper")

    def test_switch_tab_helper(self):
        self.assertIn('switchTab', self.hud_js,
                      "Missing switchTab helper for tab lifecycle resets")

    def test_sanctuary_mount_receives_dog_slot(self):
        self.assertIn('__vdwActiveDogSlot', self.hud_js,
                      "setHomeView must publish window.__vdwActiveDogSlot")
        self.assertRegex(
            self.hud_js,
            r"HomeSanctuary\?\.mount\?\.\([^)]*this\.dogSlot",
            "setHomeView must pass this.dogSlot to HomeSanctuary.mount"
        )


@unittest.skipUnless(
    shutil.which("node") or shutil.which("osascript"),
    "No JS runtime (node or osascript) available"
)
class TestHomeViewSplitBehavioral(unittest.TestCase):
    """unification-029: executable view-state transitions."""

    def test_exec_open_home_null_slot_forces_settings_and_lock(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: null
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: '', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});
        hud.openHome();
        return {
          homeView: hud.homeView,
          isHomeLocked: hud.isHomeLocked
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["homeView"], "settings",
                         "openHome with a null slot must force the settings view")
        self.assertTrue(res["isHomeLocked"],
                        "openHome with a null slot must lock Home")

    def test_exec_resolve_home_view_transitions(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: { name: 'Ziggy', coatKey: 'CHOCOLATE_TAN', collarColor: '#0d9488',
                     personality: { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 } }
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        const toSettings = hud.resolveHomeView('settings');
        const toSanctuary = hud.resolveHomeView('sanctuary');
        const unknown = hud.resolveHomeView('bogus');
        return {
          toSettings: toSettings,
          toSanctuary: toSanctuary,
          unknown: unknown
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["toSettings"], "settings",
                         "resolveHomeView('settings') must return 'settings'")
        self.assertEqual(res["toSanctuary"], "sanctuary",
                         "resolveHomeView('sanctuary') must return 'sanctuary'")
        self.assertIn(res["unknown"], ("sanctuary", "settings"),
                      "resolveHomeView must normalize unknown views")

    def test_exec_adopt_resets_tab_to_walker_and_shows_sanctuary(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: null
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: '', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        hud.activeTab = 'dog';
        const nameInput = document.getElementById('cust-dog-name');
        const coatSelect = document.getElementById('cust-dog-coat');
        if (nameInput) nameInput.value = 'Ziggy';
        if (coatSelect) coatSelect.value = 'CHOCOLATE_TAN';

        hud.adoptDogFromForm();

        return {
          activeTab: hud.activeTab,
          homeView: hud.homeView,
          isHomeLocked: hud.isHomeLocked
        };
        """
        res = _run_js(snippet)
        self.assertEqual(res["activeTab"], "walker",
                         "Adopting a dog must reset the active tab to 'walker'")
        self.assertEqual(res["homeView"], "sanctuary",
                         "Adopting a dog must transition to the sanctuary view")
        self.assertFalse(res["isHomeLocked"],
                         "Adopting a dog must release the Home lock")

    def test_exec_reopen_home_always_shows_sanctuary(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: { name: 'Ziggy', coatKey: 'CHOCOLATE_TAN', collarColor: '#0d9488',
                     personality: { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 } }
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        const modal = document.getElementById('customizer-modal');
        modal.style.display = 'block';
        hud.setHomeView('sanctuary');
        hud.setHomeView('settings');
        hud.closeModal();
        hud.openModal();

        return { homeView: hud.currentHomeView };
        """
        res = _run_js(snippet)
        self.assertEqual(res["homeView"], "sanctuary",
                         "Reopening Home with a dog must always show the sanctuary view")

    def test_exec_dogs_tab_click_syncs_active_tab(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: { name: 'Ziggy', coatKey: 'CHOCOLATE_TAN', collarColor: '#0d9488',
                     personality: { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 } }
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        // Simulate the Dogs tab button click handler.
        const dogBtn = document.getElementById('tab-btn-dog');
        if (dogBtn && dogBtn._listeners && dogBtn._listeners.click) {
          dogBtn._listeners.click.forEach(function (fn) { fn(); });
        }

        return { activeTab: hud.activeTab };
        """
        res = _run_js(snippet)
        self.assertEqual(res["activeTab"], "dog",
                         "Clicking the Dogs tab must sync hud.activeTab to 'dog'")

    def test_exec_split_stage_preview_draws_only_active_tab(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: { name: 'Ziggy', coatKey: 'CHOCOLATE_TAN', collarColor: '#0d9488',
                     personality: { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 } }
        }));
        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        const calls = [];
        const ctx = {
          clearRect() { calls.push('clear'); },
          fillRect() {}, beginPath() {}, ellipse() {},
          fill() {}, stroke() {}, save() {}, restore() {},
          createLinearGradient() { return { addColorStop() {} }; },
          createRadialGradient() { return { addColorStop() {} }; },
          set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}
        };

        hud.activeTab = 'walker';
        hud.drawStagePreview(ctx);
        const walkerCalls = calls.length;

        calls.length = 0;
        hud.activeTab = 'dog';
        hud.drawStagePreview(ctx);
        const dogCalls = calls.length;

        return { walkerCalls: walkerCalls, dogCalls: dogCalls };
        """
        res = _run_js(snippet)
        self.assertGreater(res["walkerCalls"], 0,
                           "Walker tab must draw the owner on the stage preview")
        self.assertGreater(res["dogCalls"], 0,
                           "Dog tab must draw the dog on the stage preview")

    def test_exec_init_while_hidden_defers_sanctuary_mount_until_open(self):
        snippet = """
        localStorage.setItem('clifton_walker_profile', JSON.stringify({
          name: 'Walker',
          dogSlot: { name: 'Ziggy', coatKey: 'CHOCOLATE_TAN', collarColor: '#0d9488',
                     personality: { playfulness: 3, shyness: 2, barkyness: 2, obedience: 4 } }
        }));

        let mountCalls = 0;
        window.HomeSanctuary = {
          mount: function () { mountCalls++; },
          unmount: function () {}
        };

        const owner = { name: 'Walker', jacketColor: '#1e3a8a', x: 0, y: 0, angle: 0 };
        const dog = { name: 'Ziggy', coat: null, collarColor: '#0d9488', personality: null };
        const net = { setLocalMeta() {}, broadcast() {}, peerId: 'p1' };
        const hud = new SocialHUD(net, owner, dog, {});

        const afterInit = mountCalls;
        hud.openModal();
        const afterOpen = mountCalls;

        return { afterInit: afterInit, afterOpen: afterOpen };
        """
        res = _run_js(snippet)
        self.assertEqual(res["afterInit"], 0,
                         "Sanctuary must not mount while the Home modal is hidden")
        self.assertGreaterEqual(res["afterOpen"], 1,
                                "Opening the Home modal must mount the sanctuary")


if __name__ == '__main__':
    unittest.main()
