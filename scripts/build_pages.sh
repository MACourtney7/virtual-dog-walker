#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${PROJECT_ROOT}/dist"

echo "=== Building Cloudflare Pages Distribution ==="

echo "Syncing ZeroChatWidget from zero_chat..."
ZERO_CHAT_DIR="${PROJECT_ROOT}/../zero_chat"
if [[ -f "${ZERO_CHAT_DIR}/zero_client/widget/zero_chat_widget.js" && -f "${ZERO_CHAT_DIR}/zero_client/widget/zero_chat_widget.css" ]]; then
    mkdir -p "${PROJECT_ROOT}/src/ui"
    cp "${ZERO_CHAT_DIR}/zero_client/widget/zero_chat_widget.js" "${PROJECT_ROOT}/src/ui/zero_chat_widget.js"
    cp "${ZERO_CHAT_DIR}/zero_client/widget/zero_chat_widget.css" "${PROJECT_ROOT}/src/ui/zero_chat_widget.css"
    echo "✅ ZeroChatWidget synced to src/ui/"
fi

bash "${SCRIPT_DIR}/build_wasm.sh"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

echo "Copying static runtime assets..."
cp "${PROJECT_ROOT}/index.html" "${DIST_DIR}/"
cp -r "${PROJECT_ROOT}/src" "${DIST_DIR}/"

# Prune non-runtime files that might exist inside src/
find "${DIST_DIR}" -type f \( -name "*.py" -o -name "*.md" -o -name "*.rs" -o -name "Cargo.toml" -o -name "Cargo.lock" \) -delete
find "${DIST_DIR}" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

echo "✅ Distribution built successfully in ${DIST_DIR}"
