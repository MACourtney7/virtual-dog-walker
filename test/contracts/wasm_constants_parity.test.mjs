import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WASM_CONSTANTS_PATH = path.join(
  REPO_ROOT,
  "src",
  "engine",
  "wasm_constants.js",
);

const EXPECTED_NAMESPACES = [
  "world",
  "dog",
  "owner",
  "care",
  "ball",
  "npc",
  "collision",
];

function runRustExport() {
  const stdout = execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--bin",
      "export_wasm_constants",
      "--manifest-path",
      "crates/dog_walker_core/Cargo.toml",
      "--",
      "--format",
      "json",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(stdout);
}

function runRustExportJs() {
  return execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--bin",
      "export_wasm_constants",
      "--manifest-path",
      "crates/dog_walker_core/Cargo.toml",
      "--",
      "--format",
      "js",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
}

function describeMismatch(rust, js) {
  const lines = [];
  const rustKeys = Object.keys(rust);
  const jsKeys = Object.keys(js);

  for (const ns of rustKeys) {
    if (!(ns in js)) {
      lines.push(`namespace "${ns}" present in Rust but missing in JS`);
      continue;
    }
    const rustNs = rust[ns] ?? {};
    const jsNs = js[ns] ?? {};
    const allKeys = new Set([...Object.keys(rustNs), ...Object.keys(jsNs)]);
    for (const key of allKeys) {
      const inRust = key in rustNs;
      const inJs = key in jsNs;
      if (inRust && !inJs) {
        lines.push(`[${ns}] key "${key}" present in Rust but missing in JS`);
      } else if (!inRust && inJs) {
        lines.push(`[${ns}] key "${key}" present in JS but missing in Rust`);
      } else if (rustNs[key] !== jsNs[key]) {
        lines.push(
          `[${ns}] key "${key}" differs: Rust=${JSON.stringify(
            rustNs[key],
          )} JS=${JSON.stringify(jsNs[key])}`,
        );
      }
    }
  }
  for (const ns of jsKeys) {
    if (!(ns in rust)) {
      lines.push(`namespace "${ns}" present in JS but missing in Rust`);
    }
  }
  return lines.join("\n");
}

test("WASM_CONSTANTS matches Rust export_wasm_constants output", async () => {
  const rust = runRustExport();
  const { WASM_CONSTANTS } = await import("../../src/engine/wasm_constants.js");

  try {
    assert.deepStrictEqual(rust, WASM_CONSTANTS);
  } catch (err) {
    const detail = describeMismatch(rust, WASM_CONSTANTS);
    assert.fail(
      `WASM constants parity broken between Rust and JS:\n${detail}\n\n${err.message}`,
    );
  }
});

test("WASM_CONSTANTS exposes exactly the expected namespaces", async () => {
  const { WASM_CONSTANTS } = await import("../../src/engine/wasm_constants.js");
  const namespaces = Object.keys(WASM_CONSTANTS).sort();
  assert.deepStrictEqual(namespaces, [...EXPECTED_NAMESPACES].sort());
});

test("WASM_CONSTANTS and its namespaces are frozen", async () => {
  const { WASM_CONSTANTS } = await import("../../src/engine/wasm_constants.js");
  assert.ok(Object.isFrozen(WASM_CONSTANTS), "WASM_CONSTANTS must be frozen");
  for (const ns of EXPECTED_NAMESPACES) {
    assert.ok(
      Object.isFrozen(WASM_CONSTANTS[ns]),
      `namespace "${ns}" must be frozen`,
    );
  }
});

test("committed wasm_constants.js matches fresh exporter output byte-for-byte", () => {
  const fresh = runRustExportJs();
  const committed = fs.readFileSync(WASM_CONSTANTS_PATH, "utf8");

  assert.ok(
    !fresh.endsWith("\n\n"),
    "exporter output must not end with a blank line at EOF",
  );

  if (committed !== fresh) {
    const max = Math.min(committed.length, fresh.length);
    let offset = 0;
    while (offset < max && committed[offset] === fresh[offset]) {
      offset += 1;
    }
    assert.fail(
      `src/engine/wasm_constants.js is stale (first difference at offset ${offset}); ` +
        "regenerate it with scripts/build_wasm.sh",
    );
  }
});
