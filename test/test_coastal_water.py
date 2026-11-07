#!/usr/bin/env python3
"""Automated tests for coastal shallow-water interactions and particle emitters.

Covers:
  - ParticleSystem.emit (valid config, invalid inputs)
  - ParticleSystem.emitWaterSplash (default count, custom count, NaN guard)
  - applyCoastalShallowWaterInteraction (owner/dog shallow water, fallbacks,
    broken particle systems, non-shallow conditions, random suppression)

Tests are deterministic, isolated, and require no DOM/canvas/network.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PARTICLES_JS = os.path.join(REPO_ROOT, "src", "systems", "particles.js")
COASTAL_JS = os.path.join(REPO_ROOT, "src", "systems", "coastalWater.js")


def _node_available():
    return shutil.which("node") is not None


def _run_node_module(script_body):
    """Run an ES module script via node and return parsed JSON stdout."""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".mjs", delete=False, dir=REPO_ROOT
    ) as f:
        f.write(script_body)
        script_path = f.name
    try:
        result = subprocess.run(
            ["node", script_path],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=60,
        )
        if result.returncode != 0:
            raise AssertionError(
                f"node exited {result.returncode}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        out = result.stdout.strip()
        lines = [ln for ln in out.splitlines() if ln.strip()]
        if not lines:
            raise AssertionError(f"node produced no output. STDERR:\n{result.stderr}")
        return json.loads(lines[-1])
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass


def _particles_import():
    rel = os.path.relpath(PARTICLES_JS, REPO_ROOT).replace(os.sep, "/")
    return f"import {{ ParticleSystem }} from './{rel}';"


def _coastal_import():
    rel = os.path.relpath(COASTAL_JS, REPO_ROOT).replace(os.sep, "/")
    return f"import {{ applyCoastalShallowWaterInteraction }} from './{rel}';"


@unittest.skipUnless(_node_available(), "node is required for JS-driven tests")
class TestParticleEmit(unittest.TestCase):
    def test_emit_valid_config_creates_particle(self):
        script = f"""
{_particles_import()}
const ps = new ParticleSystem();
const p = ps.emit({{ x: 10, y: 20, vx: 1, vy: -2, color: '#abcdef', size: 3, life: 0.5, gravity: 100 }});
const out = {{
  count: ps.particles.length,
  hasParticle: !!p,
  x: p && p.x,
  y: p && p.y,
  vx: p && p.vx,
  vy: p && p.vy,
  color: p && p.color,
  radius: p && p.radius,
  life: p && p.life,
  gravity: p && p.gravity,
}};
console.log(JSON.stringify(out));
"""
        out = _run_node_module(script)
        self.assertEqual(out["count"], 1)
        self.assertTrue(out["hasParticle"])
        self.assertEqual(out["x"], 10)
        self.assertEqual(out["y"], 20)
        self.assertEqual(out["vx"], 1)
        self.assertEqual(out["vy"], -2)
        self.assertEqual(out["color"], "#abcdef")
        self.assertEqual(out["radius"], 3)
        self.assertAlmostEqual(out["life"], 0.5, places=5)
        self.assertEqual(out["gravity"], 100)

    def test_emit_invalid_inputs_do_not_throw(self):
        script = f"""
{_particles_import()}
const ps = new ParticleSystem();
const results = [];
try {{ ps.emit(undefined); results.push('undefined-ok'); }} catch (e) {{ results.push('undefined-throw:' + e.message); }}
try {{ ps.emit(null); results.push('null-ok'); }} catch (e) {{ results.push('null-throw:' + e.message); }}
try {{
  const p = ps.emit({{ x: 'nope', y: NaN, vx: 'bad', vy: undefined, size: 'x', life: -1, gravity: 'g' }});
  results.push('invalid-ok');
  results.push('count:' + ps.particles.length);
  results.push('hasParticle:' + (!!p));
}} catch (e) {{
  results.push('invalid-throw:' + e.message);
}}
console.log(JSON.stringify({{ results }}));
"""
        out = _run_node_module(script)
        self.assertIn("undefined-ok", out["results"])
        self.assertIn("null-ok", out["results"])
        self.assertIn("invalid-ok", out["results"])
        self.assertIn("count:1", out["results"])
        self.assertIn("hasParticle:true", out["results"])


@unittest.skipUnless(_node_available(), "node is required for JS-driven tests")
class TestEmitWaterSplash(unittest.TestCase):
    def test_default_count(self):
        script = f"""
{_particles_import()}
const ps = new ParticleSystem();
const n = ps.emitWaterSplash(100, 200);
console.log(JSON.stringify({{ returned: n, count: ps.particles.length }}));
"""
        out = _run_node_module(script)
        self.assertEqual(out["returned"], 6)
        self.assertEqual(out["count"], 6)

    def test_custom_count_and_properties(self):
        script = f"""
{_particles_import()}
const ps = new ParticleSystem();
const n = ps.emitWaterSplash(50, 60, 20);
const allowed = new Set([
  'rgba(240, 253, 250, 0.8)',
  'rgba(56, 189, 248, 0.7)',
  'rgba(255, 255, 255, 0.9)'
]);
let allColorsOk = true;
let allUpward = true;
let allGravityOk = true;
for (const p of ps.particles) {{
  if (!allowed.has(p.color)) allColorsOk = false;
  if (!(p.vy < 0)) allUpward = false;
  if (p.gravity !== 260) allGravityOk = false;
}}
console.log(JSON.stringify({{
  returned: n,
  count: ps.particles.length,
  allColorsOk,
  allUpward,
  allGravityOk
}}));
"""
        out = _run_node_module(script)
        self.assertEqual(out["returned"], 20)
        self.assertEqual(out["count"], 20)
        self.assertTrue(out["allColorsOk"])
        self.assertTrue(out["allUpward"])
        self.assertTrue(out["allGravityOk"])

    def test_nan_returns_zero(self):
        script = f"""
{_particles_import()}
const ps = new ParticleSystem();
let threw = false;
let n = null;
try {{ n = ps.emitWaterSplash(NaN, 100); }} catch (e) {{ threw = true; }}
console.log(JSON.stringify({{ threw, returned: n, count: ps.particles.length }}));
"""
        out = _run_node_module(script)
        self.assertFalse(out["threw"])
        self.assertEqual(out["returned"], 0)
        self.assertEqual(out["count"], 0)


@unittest.skipUnless(_node_available(), "node is required for JS-driven tests")
class TestCoastalShallowWaterInteraction(unittest.TestCase):
    def _run(self, body):
        script = f"""
{_coastal_import()}
{body}
"""
        return _run_node_module(script)

    def test_owner_shallow_water_emits_splash(self):
        out = self._run("""
const calls = [];
const particleSystem = {
  emitWaterSplash(x, y) { calls.push([x, y]); }
};
const owner = { x: 300, y: 1900 };
const dog = { x: 0, y: 0, zoomiesLevel: 0 };
applyCoastalShallowWaterInteraction({ owner, dog, particleSystem, dt: 0.016, randomValue: 0 });
console.log(JSON.stringify({ calls, zoomies: dog.zoomiesLevel }));
""")
        self.assertEqual(out["calls"], [[300, 1900]])
        self.assertEqual(out["zoomies"], 0)

    def test_dog_shallow_water_emits_splash_and_sets_zoomies(self):
        out = self._run("""
const calls = [];
const particleSystem = {
  emitWaterSplash(x, y) { calls.push([x, y]); }
};
const owner = { x: 0, y: 0 };
const dog = { x: 500, y: 1900, zoomiesLevel: 0 };
applyCoastalShallowWaterInteraction({ owner, dog, particleSystem, dt: 1.0, randomValue: 0 });
console.log(JSON.stringify({ calls, zoomies: dog.zoomiesLevel }));
""")
        self.assertEqual(out["calls"], [[500, 1900]])
        self.assertEqual(out["zoomies"], 12)

    def test_fallback_to_emit_when_emitWaterSplash_missing(self):
        out = self._run("""
const calls = [];
const particleSystem = {
  emit(cfg) { calls.push(cfg); }
};
const owner = { x: 100, y: 1900 };
const dog = { x: 0, y: 0, zoomiesLevel: 0 };
applyCoastalShallowWaterInteraction({ owner, dog, particleSystem, dt: 0.016, randomValue: 0 });
console.log(JSON.stringify({ calls }));
""")
        self.assertGreaterEqual(len(out["calls"]), 1)
        cfg = out["calls"][0]
        self.assertEqual(cfg["x"], 100)
        self.assertEqual(cfg["y"], 1900)

    def test_broken_particle_system_does_not_throw(self):
        out = self._run("""
const particleSystem = {
  emitWaterSplash() { throw new Error('boom'); }
};
const owner = { x: 0, y: 0 };
const dog = { x: 500, y: 1900, zoomiesLevel: 0 };
let threw = false;
try {
  applyCoastalShallowWaterInteraction({ owner, dog, particleSystem, dt: 1.0, randomValue: 0 });
} catch (e) {
  threw = true;
}
console.log(JSON.stringify({ threw, zoomies: dog.zoomiesLevel }));
""")
        self.assertFalse(out["threw"])
        self.assertEqual(out["zoomies"], 12)

    def test_non_shallow_no_emission_no_zoomies(self):
        out = self._run("""
const calls = [];
const particleSystem = {
  emitWaterSplash(x, y) { calls.push([x, y]); },
  emit(cfg) { calls.push(cfg); }
};
const owner = { x: 100, y: 1000 };
const dog = { x: 500, y: 1000, zoomiesLevel: 0 };
applyCoastalShallowWaterInteraction({ owner, dog, particleSystem, dt: 1.0, randomValue: 0 });
console.log(JSON.stringify({ calls, zoomies: dog.zoomiesLevel }));
""")
        self.assertEqual(out["calls"], [])
        self.assertEqual(out["zoomies"], 0)

    def test_random_suppression_still_increments_zoomies(self):
        out = self._run("""
const calls = [];
const particleSystem = {
  emitWaterSplash(x, y) { calls.push([x, y]); },
  emit(cfg) { calls.push(cfg); }
};
const owner = { x: 0, y: 0 };
const dog = { x: 500, y: 1900, zoomiesLevel: 0 };
applyCoastalShallowWaterInteraction({ owner, dog, particleSystem, dt: 1.0, randomValue: 0.9 });
console.log(JSON.stringify({ calls, zoomies: dog.zoomiesLevel }));
""")
        self.assertEqual(out["calls"], [])
        self.assertEqual(out["zoomies"], 12)

    def test_positional_arguments_supported(self):
        out = self._run("""
const calls = [];
const particleSystem = {
  emitWaterSplash(x, y) { calls.push([x, y]); }
};
const owner = { x: 0, y: 0 };
const dog = { x: 500, y: 1900, zoomiesLevel: 0 };
applyCoastalShallowWaterInteraction(owner, dog, particleSystem, 1.0, 0);
console.log(JSON.stringify({ calls, zoomies: dog.zoomiesLevel }));
""")
        self.assertEqual(out["calls"], [[500, 1900]])
        self.assertEqual(out["zoomies"], 12)

    def test_null_and_undefined_inputs_do_not_throw(self):
        out = self._run("""
const results = [];
try {
  const r = applyCoastalShallowWaterInteraction(null);
  results.push({ input: 'null', r });
} catch (e) {
  results.push({ input: 'null', threw: e.message });
}
try {
  const r = applyCoastalShallowWaterInteraction(undefined);
  results.push({ input: 'undefined', r });
} catch (e) {
  results.push({ input: 'undefined', threw: e.message });
}
try {
  const r = applyCoastalShallowWaterInteraction(42);
  results.push({ input: 'number', r });
} catch (e) {
  results.push({ input: 'number', threw: e.message });
}
console.log(JSON.stringify({ results }));
""")
        for entry in out["results"]:
            self.assertNotIn("threw", entry, f"threw for input {entry.get('input')}")
            self.assertEqual(entry["r"], {
                "emitted": False,
                "usedFallback": False,
                "zoomiesIncremented": False,
            })


class TestCoastalWaterStaticContract(unittest.TestCase):
    """Static source-level contract checks that do not require Node.js."""

    def _read(self, path):
        self.assertTrue(os.path.exists(path), f"File {path} does not exist")
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_particles_declares_emit_and_emit_water_splash(self):
        src = self._read(PARTICLES_JS)
        self.assertIn("emit(config)", src)
        self.assertIn("emitWaterSplash(x, y, count = 6)", src)

    def test_coastal_exports_apply_interaction(self):
        src = self._read(COASTAL_JS)
        self.assertIn("export function applyCoastalShallowWaterInteraction", src)

    def test_main_imports_and_uses_coastal_interaction(self):
        main_js = os.path.join(REPO_ROOT, "src", "main.js")
        src = self._read(main_js)
        self.assertIn("applyCoastalShallowWaterInteraction", src)
        # The raw unhandled particleSystem.emit(...) call in the coastal block
        # must be gone (replaced by the shared helper).
        self.assertNotIn("this.field.particleSystem.emit({", src)


class TestCoastalShallowWaterAlgorithm(unittest.TestCase):
    """Python reference simulation of applyCoastalShallowWaterInteraction."""

    SHALLOW_Y = 1820
    ZOOMIES_PER_SEC = 12
    ZOOMIES_MAX = 100
    SPLASH_CHANCE = 0.25

    def _simulate(self, owner, dog, dt, rand_value):
        """Mirror the JS helper's decision logic.

        Returns (splash_coords_or_None, zoomies_level).
        """
        zoomies = dog.get("zoomiesLevel", 0)
        owner_shallow = owner["y"] > self.SHALLOW_Y
        dog_shallow = dog["y"] > self.SHALLOW_Y

        splash = None
        if owner_shallow or dog_shallow:
            if rand_value < self.SPLASH_CHANCE:
                if dog_shallow:
                    splash = (dog["x"], dog["y"])
                else:
                    splash = (owner["x"], owner["y"])
            if dog_shallow:
                zoomies = min(self.ZOOMIES_MAX, zoomies + self.ZOOMIES_PER_SEC * dt)
        return splash, zoomies

    def test_shallow_detection_threshold(self):
        # Exactly at threshold is NOT shallow (strict >).
        splash, zoomies = self._simulate(
            {"x": 0, "y": self.SHALLOW_Y},
            {"x": 0, "y": self.SHALLOW_Y, "zoomiesLevel": 0},
            1.0,
            0.0,
        )
        self.assertIsNone(splash)
        self.assertEqual(zoomies, 0)

        # Just past threshold is shallow.
        splash, zoomies = self._simulate(
            {"x": 10, "y": self.SHALLOW_Y + 1},
            {"x": 0, "y": 0, "zoomiesLevel": 0},
            1.0,
            0.0,
        )
        self.assertEqual(splash, (10, self.SHALLOW_Y + 1))
        self.assertEqual(zoomies, 0)

    def test_zoomies_increment_and_clamp(self):
        _, zoomies = self._simulate(
            {"x": 0, "y": 0},
            {"x": 0, "y": self.SHALLOW_Y + 10, "zoomiesLevel": 0},
            1.0,
            0.9,
        )
        self.assertEqual(zoomies, 12)

        _, zoomies = self._simulate(
            {"x": 0, "y": 0},
            {"x": 0, "y": self.SHALLOW_Y + 10, "zoomiesLevel": 95},
            1.0,
            0.9,
        )
        self.assertEqual(zoomies, 100)

    def test_coordinate_selection_prefers_dog(self):
        splash, _ = self._simulate(
            {"x": 100, "y": self.SHALLOW_Y + 5},
            {"x": 500, "y": self.SHALLOW_Y + 5, "zoomiesLevel": 0},
            1.0,
            0.0,
        )
        self.assertEqual(splash, (500, self.SHALLOW_Y + 5))

    def test_random_suppression_threshold(self):
        # Below threshold -> splash emitted.
        splash, _ = self._simulate(
            {"x": 1, "y": self.SHALLOW_Y + 1},
            {"x": 0, "y": 0, "zoomiesLevel": 0},
            1.0,
            0.24,
        )
        self.assertIsNotNone(splash)

        # At/above threshold -> suppressed.
        splash, _ = self._simulate(
            {"x": 1, "y": self.SHALLOW_Y + 1},
            {"x": 0, "y": 0, "zoomiesLevel": 0},
            1.0,
            0.25,
        )
        self.assertIsNone(splash)


if __name__ == "__main__":
    unittest.main(verbosity=2)
