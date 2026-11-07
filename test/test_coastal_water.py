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
applyCoastalShallowWaterInteraction(owner, dog, particleSystem, 0.016, 0);
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
applyCoastalShallowWaterInteraction(owner, dog, particleSystem, 1.0, 0);
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
applyCoastalShallowWaterInteraction(owner, dog, particleSystem, 0.016, 0);
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
  applyCoastalShallowWaterInteraction(owner, dog, particleSystem, 1.0, 0);
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
applyCoastalShallowWaterInteraction(owner, dog, particleSystem, 1.0, 0);
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
applyCoastalShallowWaterInteraction(owner, dog, particleSystem, 1.0, 0.9);
console.log(JSON.stringify({ calls, zoomies: dog.zoomiesLevel }));
""")
        self.assertEqual(out["calls"], [])
        self.assertEqual(out["zoomies"], 12)


if __name__ == "__main__":
    unittest.main(verbosity=2)
