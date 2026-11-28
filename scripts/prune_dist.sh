#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <dist-dir>" >&2
    exit 1
fi

DIST_DIR="$1"

if [[ ! -d "${DIST_DIR}" ]]; then
    echo "Error: dist directory does not exist: ${DIST_DIR}" >&2
    exit 1
fi

echo "Pruning non-runtime files from ${DIST_DIR}..."
find "${DIST_DIR}" -type f \( \
    -name "*.py" -o \
    -name "*.md" -o \
    -name "*.rs" -o \
    -name "Cargo.toml" -o \
    -name "Cargo.lock" -o \
    -name "*.d.ts" \
\) -delete

find "${DIST_DIR}" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

echo "✅ Prune complete"
