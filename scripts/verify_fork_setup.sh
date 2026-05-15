#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Checking Rust core compiles..."
cargo build --manifest-path "${ROOT_DIR}/rust-core/Cargo.toml" >/dev/null

echo "Checking built-in module exists..."
test -f "${ROOT_DIR}/overlays/vscode/extensions/skippr-workbench/src/extension.ts"
test -f "${ROOT_DIR}/overlays/vscode/extensions/skippr-data-agent/src/extension.ts"
test -f "${ROOT_DIR}/config/product.overrides.json"

echo "Checking overlay script syntax..."
node --check "${ROOT_DIR}/scripts/apply_skippr_overlay.mjs"

echo "Fork scaffolding verification passed."
