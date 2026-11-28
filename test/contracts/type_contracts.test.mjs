/**
 * Contract tests for the TypeScript configuration and declaration surface.
 *
 * Run with: node --test test/contracts/type_contracts.test.mjs
 *
 * These tests are read-only: they never write files, mutate the repository,
 * require network access, or depend on a bundler.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Project root resolved from this test file, not the current working dir. */
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const ROOT_TSCONFIG = path.join(PROJECT_ROOT, "tsconfig.json");
const PACKAGE_JSON = path.join(PROJECT_ROOT, "package.json");

/** Track configs that must extend the root config. */
const TRACK_CONFIGS = [
  "tsconfig.engine.json",
  "tsconfig.entities.json",
  "tsconfig.net-systems.json",
  "tsconfig.world.json",
  "tsconfig.ui-entry.json",
  "tsconfig.zero-chat-widget.json",
];

/** Shared declaration scopes every track config must include. */
const SHARED_DECLARATION_INCLUDES = [
  "src/types/**/*.d.ts",
  "src/wasm/**/*.d.ts",
  "src/wasm_core/**/*.d.ts",
];

/**
 * Exact `include` arrays each track config must declare. These mirror the
 * actual `tsconfig.*.json` files and are asserted with `deepEqual` so that
 * accidental additions or removals are caught.
 */
const TRACK_INCLUDES = {
  "tsconfig.engine.json": [
    "src/engine/**/*.js",
    "src/types/**/*.d.ts",
    "src/wasm/**/*.d.ts",
    "src/wasm_core/**/*.d.ts",
  ],
  "tsconfig.entities.json": [
    "src/entities/**/*.js",
    "src/types/**/*.d.ts",
    "src/wasm/**/*.d.ts",
    "src/wasm_core/**/*.d.ts",
  ],
  "tsconfig.net-systems.json": [
    "src/net/**/*.js",
    "src/systems/**/*.js",
    "src/types/**/*.d.ts",
    "src/wasm/**/*.d.ts",
    "src/wasm_core/**/*.d.ts",
  ],
  "tsconfig.world.json": [
    "src/world/**/*.js",
    "src/types/**/*.d.ts",
    "src/wasm/**/*.d.ts",
    "src/wasm_core/**/*.d.ts",
  ],
  "tsconfig.ui-entry.json": [
    "src/ui/**/*.js",
    "src/main.js",
    "src/types/**/*.d.ts",
    "src/wasm/**/*.d.ts",
    "src/wasm_core/**/*.d.ts",
  ],
  "tsconfig.zero-chat-widget.json": [
    "../zero_chat/zero_client/widget/zero_chat_widget.js",
    "src/types/**/*.d.ts",
    "src/wasm/**/*.d.ts",
    "src/wasm_core/**/*.d.ts",
  ],
};

/** Compiler options locked by the root config that tracks must not override. */
const LOCKED_COMPILER_OPTIONS = [
  "allowJs",
  "checkJs",
  "noEmit",
  "strict",
  "strictNullChecks",
  "target",
  "module",
  "moduleResolution",
  "lib",
  "forceConsistentCasingInFileNames",
  "skipLibCheck",
];

/** Bundlers that must not appear as dependencies. */
const FORBIDDEN_BUNDLERS = [
  "vite",
  "esbuild",
  "webpack",
  "rollup",
  "babel",
  "parcel",
  "snowpack",
];

/**
 * Read and parse a JSON file, stripping comments and trailing commas so that
 * tsconfig-style JSONC files parse cleanly.
 *
 * @param {string} filePath
 * @returns {any}
 */
function readJsonc(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { config, error } = ts.parseConfigFileTextToJson(filePath, raw);
  assert.equal(error, undefined, `Failed to parse ${filePath}`);
  return config;
}

/**
 * Recursively collect files under `dir` matching `predicate`.
 *
 * @param {string} dir
 * @param {(name: string) => boolean} predicate
 * @returns {string[]}
 */
function walk(dir, predicate) {
  /** @type {string[]} */
  const results = [];
  if (!fs.existsSync(dir)) {
    return results;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

test("required root and track config files exist", () => {
  assert.ok(fs.existsSync(ROOT_TSCONFIG), "tsconfig.json must exist");
  assert.ok(fs.existsSync(PACKAGE_JSON), "package.json must exist");
  for (const track of TRACK_CONFIGS) {
    const full = path.join(PROJECT_ROOT, track);
    assert.ok(fs.existsSync(full), `${track} must exist`);
  }
});

test("root config contains locked compiler options", () => {
  const config = readJsonc(ROOT_TSCONFIG);
  const options = config.compilerOptions ?? {};

  assert.equal(options.allowJs, true, "allowJs must be true");
  assert.equal(options.checkJs, true, "checkJs must be true");
  assert.equal(options.noEmit, true, "noEmit must be true");
  assert.equal(options.strict, false, "strict must be false");
  assert.equal(
    options.strictNullChecks,
    true,
    "strictNullChecks must be true",
  );
  assert.equal(options.target, "ES2022", 'target must be "ES2022"');
  assert.equal(options.module, "ESNext", 'module must be "ESNext"');
  assert.equal(
    options.moduleResolution,
    "Bundler",
    'moduleResolution must be "Bundler"',
  );
  assert.equal(
    options.forceConsistentCasingInFileNames,
    true,
    "forceConsistentCasingInFileNames must be true",
  );
  assert.equal(options.skipLibCheck, false, "skipLibCheck must be false");

  assert.ok(Array.isArray(options.lib), "lib must be an array");
  for (const required of [
    "ES2022",
    "ESNext.Disposable",
    "DOM",
    "DOM.Iterable",
  ]) {
    assert.ok(
      options.lib.includes(required),
      `lib must include "${required}"`,
    );
  }
});

test("root config excludes build and vendor directories", () => {
  const config = readJsonc(ROOT_TSCONFIG);
  const exclude = config.exclude ?? [];
  assert.ok(Array.isArray(exclude), "exclude must be an array");
  for (const required of ["dist", "node_modules", "target", "crates"]) {
    assert.ok(
      exclude.includes(required),
      `exclude must include "${required}"`,
    );
  }
});

test("root include is limited to declaration scopes", () => {
  const config = readJsonc(ROOT_TSCONFIG);
  const include = config.include ?? [];
  assert.ok(Array.isArray(include), "include must be an array");

  const expected = [
    "src/types/**/*.d.ts",
    "src/wasm/**/*.d.ts",
    "src/wasm_core/**/*.d.ts",
  ];
  assert.deepEqual(
    [...include].sort(),
    [...expected].sort(),
    "include must be limited to the declaration scopes",
  );
});

test("every track config extends root and has expected includes", () => {
  for (const track of TRACK_CONFIGS) {
    const full = path.join(PROJECT_ROOT, track);
    const config = readJsonc(full);

    assert.equal(
      config.extends,
      "./tsconfig.json",
      `${track} must extend "./tsconfig.json"`,
    );

    const include = config.include ?? [];
    assert.ok(Array.isArray(include), `${track} include must be an array`);

    assert.deepEqual(
      include,
      TRACK_INCLUDES[track],
      `${track} include must exactly match the expected list`,
    );

    for (const pattern of SHARED_DECLARATION_INCLUDES) {
      assert.ok(
        include.includes(pattern),
        `${track} include must contain shared declaration scope "${pattern}"`,
      );
    }
  }
});

test("track configs do not override locked root compiler options", () => {
  for (const track of TRACK_CONFIGS) {
    const full = path.join(PROJECT_ROOT, track);
    const config = readJsonc(full);
    const options = config.compilerOptions ?? {};

    for (const key of LOCKED_COMPILER_OPTIONS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(options, key),
        false,
        `${track} must not override locked compiler option "${key}"`,
      );
    }
  }
});

test("shared .d.ts files compile under the root config with zero diagnostics", () => {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    ROOT_TSCONFIG,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          "\n",
        );
        assert.fail(`Unrecoverable config diagnostic: ${message}`);
      },
    },
  );

  assert.ok(parsed, "root config must parse");
  assert.deepEqual(
    parsed.errors,
    [],
    "root config must parse without errors",
  );

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);
  const formatted = diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );
    if (diagnostic.file && typeof diagnostic.start === "number") {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
      );
      return `${diagnostic.file.fileName}:${line + 1}:${character + 1} ${message}`;
    }
    return message;
  });

  assert.deepEqual(
    formatted,
    [],
    `Declaration files must compile cleanly:\n${formatted.join("\n")}`,
  );
});

test("no .ts application source files exist under src/", () => {
  const srcDir = path.join(PROJECT_ROOT, "src");
  const tsFiles = walk(
    srcDir,
    (name) =>
      (name.endsWith(".ts") && !name.endsWith(".d.ts")) ||
      name.endsWith(".tsx") ||
      name.endsWith(".mts") ||
      name.endsWith(".cts"),
  );
  assert.deepEqual(
    tsFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    [],
    "Only .d.ts declaration files are allowed under src/",
  );
});

test("package-lock.json exists and pins typescript and oxlint", () => {
  const lockPath = path.join(PROJECT_ROOT, "package-lock.json");
  assert.ok(fs.existsSync(lockPath), "package-lock.json must exist");

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.ok(
    typeof lock.lockfileVersion === "number" &&
      lock.lockfileVersion >= 2,
    "package-lock.json lockfileVersion must be >= 2",
  );

  const packages = lock.packages ?? {};
  assert.ok(
    Object.prototype.hasOwnProperty.call(
      packages,
      "node_modules/typescript",
    ),
    "package-lock.json must contain a resolved entry for typescript",
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(packages, "node_modules/oxlint"),
    "package-lock.json must contain a resolved entry for oxlint",
  );
});

test("package.json declares no bundler dependencies", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  for (const bundler of FORBIDDEN_BUNDLERS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(deps, bundler),
      false,
      `package.json must not depend on "${bundler}"`,
    );
  }
});
