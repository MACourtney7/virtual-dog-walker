#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ZERO_PROTOCOL_DIR="${PROJECT_ROOT}/../zero_protocol"
OUT_DIR="${PROJECT_ROOT}/src/wasm"

echo "=== Building zero_mesh WebAssembly Package ==="
echo "Building crate from ${ZERO_PROTOCOL_DIR}/crates/zero_mesh..."

cargo build --manifest-path "${ZERO_PROTOCOL_DIR}/crates/zero_mesh/Cargo.toml" --target wasm32-unknown-unknown --release

WASM_TARGET="${ZERO_PROTOCOL_DIR}/target/wasm32-unknown-unknown/release/zero_mesh.wasm"

if [[ ! -f "${WASM_TARGET}" ]]; then
    echo "Error: ${WASM_TARGET} not found after build!" >&2
    exit 1
fi

mkdir -p "${OUT_DIR}"

if command -v wasm-bindgen >/dev/null 2>&1; then
    echo "Running wasm-bindgen --target web..."
    wasm-bindgen --target web --out-dir "${OUT_DIR}" "${WASM_TARGET}"
else
    echo "Error: wasm-bindgen CLI not found in PATH." >&2
    exit 1
fi

echo "✅ zero_mesh Wasm bundle built into ${OUT_DIR}"

