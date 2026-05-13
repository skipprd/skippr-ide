#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE_DIR="${ROOT_DIR}/vscode"
# shellcheck source=./lib/vscode_env.sh
. "${ROOT_DIR}/scripts/lib/vscode_env.sh"

if [ ! -d "${VSCODE_DIR}" ]; then
  echo "Missing vscode checkout. Run ./scripts/bootstrap_vscode_fork.sh first."
  exit 1
fi

ensure_vscode_node "${VSCODE_DIR}"

echo "Compiling Rust core..."
cargo build --manifest-path "${ROOT_DIR}/rust-core/Cargo.toml"

echo "Installing JS dependencies..."
cd "${VSCODE_DIR}"
npm install

echo "Compiling built-in skippr workbench module..."
cd "${VSCODE_DIR}/extensions/skippr-workbench"
npm install
npm run compile

echo "Building Skippr IDE distribution..."
cd "${VSCODE_DIR}"
npm run compile

echo "Build complete."
echo "Use npm run package:<platform>:<arch> to produce distributable archives."
