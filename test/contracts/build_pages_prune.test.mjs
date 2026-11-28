import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PRUNE_SCRIPT = path.join(REPO_ROOT, "scripts", "prune_dist.sh");
const BUILD_PAGES_SCRIPT = path.join(REPO_ROOT, "scripts", "build_pages.sh");

function createPruneFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-dist-"));
  const nestedDir = path.join(tmpDir, "nested dir", "deeper");
  fs.mkdirSync(nestedDir, { recursive: true });

  const prunedFiles = [
    path.join(tmpDir, "top-level.d.ts"),
    path.join(tmpDir, "tool.py"),
    path.join(tmpDir, "README.md"),
    path.join(tmpDir, "scratch.rs"),
    path.join(tmpDir, "Cargo.toml"),
    path.join(tmpDir, "Cargo.lock"),
    path.join(nestedDir, "types.d.ts"),
    path.join(nestedDir, "helper.py"),
    path.join(nestedDir, "notes.md"),
    path.join(nestedDir, "lib.rs"),
  ];
  const keptFiles = [
    path.join(tmpDir, "index.html"),
    path.join(tmpDir, "main.js"),
    path.join(tmpDir, "style.css"),
    path.join(nestedDir, "module.js"),
    path.join(nestedDir, "core_bg.wasm"),
  ];

  for (const file of [...prunedFiles, ...keptFiles]) {
    fs.writeFileSync(file, "content\n");
  }

  return { tmpDir, prunedFiles, keptFiles };
}

test("prune_dist.sh recursively removes non-runtime files and keeps runtime files", () => {
  const { tmpDir, prunedFiles, keptFiles } = createPruneFixture();
  try {
    execFileSync("bash", [PRUNE_SCRIPT, tmpDir], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    });

    for (const file of prunedFiles) {
      assert.equal(
        fs.existsSync(file),
        false,
        `${path.relative(tmpDir, file)} should have been pruned`,
      );
    }
    for (const file of keptFiles) {
      assert.equal(
        fs.existsSync(file),
        true,
        `${path.relative(tmpDir, file)} should have been preserved`,
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("build_pages.sh prunes $DIST_DIR after copying src", () => {
  const contents = fs.readFileSync(BUILD_PAGES_SCRIPT, "utf8");

  const copySrcIndex = contents.indexOf(
    'cp -r "${PROJECT_ROOT}/src" "${DIST_DIR}/"',
  );
  assert.notEqual(
    copySrcIndex,
    -1,
    'build_pages.sh should copy src into dist with `cp -r "${PROJECT_ROOT}/src" "${DIST_DIR}/"`',
  );

  const pruneRegex =
    /"\$\{PROJECT_ROOT\}\/scripts\/prune_dist\.sh"\s+"\$\{DIST_DIR\}"/;
  const pruneMatch = pruneRegex.exec(contents);
  assert.ok(
    pruneMatch,
    'build_pages.sh should invoke scripts/prune_dist.sh with "${DIST_DIR}"',
  );
  assert.ok(
    pruneMatch.index > copySrcIndex,
    "prune_dist.sh must be invoked after copying src into dist",
  );
});
