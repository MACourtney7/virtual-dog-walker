#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ZERO_PROTOCOL_DIR="${PROJECT_ROOT}/../zero_protocol"
OUT_DIR_MESH="${PROJECT_ROOT}/src/wasm"
OUT_DIR_CORE="${PROJECT_ROOT}/src/wasm_core"

echo "=== Building zero_mesh WebAssembly Package ==="
echo "Building crate from ${ZERO_PROTOCOL_DIR}/crates/zero_mesh..."
cargo build --manifest-path "${ZERO_PROTOCOL_DIR}/crates/zero_mesh/Cargo.toml" --target wasm32-unknown-unknown --release

WASM_TARGET_MESH="${ZERO_PROTOCOL_DIR}/target/wasm32-unknown-unknown/release/zero_mesh.wasm"
if [[ ! -f "${WASM_TARGET_MESH}" ]]; then
    echo "Error: ${WASM_TARGET_MESH} not found after build!" >&2
    exit 1
fi

mkdir -p "${OUT_DIR_MESH}"
if command -v wasm-bindgen >/dev/null 2>&1; then
    echo "Running wasm-bindgen for zero_mesh..."
    wasm-bindgen --target web --out-dir "${OUT_DIR_MESH}" "${WASM_TARGET_MESH}"
else
    echo "Error: wasm-bindgen CLI not found in PATH." >&2
    exit 1
fi
echo "✅ zero_mesh Wasm bundle built into ${OUT_DIR_MESH}"

echo "=== Building dog_walker_core WebAssembly Package ==="
echo "Building crate from ${PROJECT_ROOT}/crates/dog_walker_core..."
cargo build --manifest-path "${PROJECT_ROOT}/crates/dog_walker_core/Cargo.toml" --target wasm32-unknown-unknown --release

WASM_TARGET_CORE="${PROJECT_ROOT}/target/wasm32-unknown-unknown/release/dog_walker_core.wasm"
if [[ ! -f "${WASM_TARGET_CORE}" ]]; then
    echo "Error: ${WASM_TARGET_CORE} not found after build!" >&2
    exit 1
fi

mkdir -p "${OUT_DIR_CORE}"
if command -v wasm-bindgen >/dev/null 2>&1; then
    echo "Running wasm-bindgen for dog_walker_core..."
    wasm-bindgen --target web --out-dir "${OUT_DIR_CORE}" "${WASM_TARGET_CORE}"
else
    echo "Error: wasm-bindgen CLI not found in PATH." >&2
    exit 1
fi
echo "✅ dog_walker_core Wasm bundle built into ${OUT_DIR_CORE}"
