#!/bin/sh
# Convenience wrapper around the project's Python test runner.
set -e
cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

# Self-heal missing submodule checkouts (e.g. in freshly created git worktrees).
if [ ! -f "$ROOT_DIR/zero_protocol/Cargo.toml" ]; then
  echo "Submodules not populated; running git submodule update --init --recursive..."
  (cd "$ROOT_DIR" && git submodule update --init --recursive)
fi

exec python3 test/run_tests.py
