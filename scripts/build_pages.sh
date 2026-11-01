#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${PROJECT_ROOT}/dist"

echo "=== Building Cloudflare Pages Distribution ==="

bash "${SCRIPT_DIR}/build_wasm.sh"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

echo "Copying static assets..."
cp "${PROJECT_ROOT}/index.html" "${DIST_DIR}/"
cp -r "${PROJECT_ROOT}/src" "${DIST_DIR}/"
if [[ -f "${PROJECT_ROOT}/package.json" ]]; then
    cp "${PROJECT_ROOT}/package.json" "${DIST_DIR}/"
fi
if [[ -f "${PROJECT_ROOT}/wrangler.jsonc" ]]; then
    cp "${PROJECT_ROOT}/wrangler.jsonc" "${DIST_DIR}/"
fi

echo "✅ Distribution built successfully in ${DIST_DIR}"

