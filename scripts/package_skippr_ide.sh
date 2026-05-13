#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <platform> <arch>"
  echo "Platforms: darwin | linux | win32"
  echo "Arch: darwin(x64|arm64) linux(x64|arm64|armhf) win32(x64|arm64)"
  exit 1
fi

PLATFORM="$1"
ARCH="$2"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE_DIR="${ROOT_DIR}/vscode"
ARTIFACTS_DIR="${ROOT_DIR}/artifacts"
# shellcheck source=./lib/vscode_env.sh
. "${ROOT_DIR}/scripts/lib/vscode_env.sh"

if [ ! -d "${VSCODE_DIR}" ]; then
  echo "Missing vscode checkout. Run npm run bootstrap:fork first."
  exit 1
fi

ensure_vscode_node "${VSCODE_DIR}"
ensure_vscode_dependencies "${VSCODE_DIR}"
ensure_skippr_workbench_dependencies "${VSCODE_DIR}"

echo "Compiling Rust core..."
cargo build --manifest-path "${ROOT_DIR}/rust-core/Cargo.toml"

echo "Compiling built-in skippr-workbench..."
(cd "${VSCODE_DIR}/extensions/skippr-workbench" && npm run compile)

cd "${VSCODE_DIR}"
mkdir -p "${ARTIFACTS_DIR}"

echo "Preparing core build outputs..."
npm run gulp core-ci

case "${PLATFORM}-${ARCH}" in
  darwin-x64|darwin-arm64)
    npm run gulp "vscode-darwin-${ARCH}-min-ci"
    APP_DIR="${ROOT_DIR}/VSCode-darwin-${ARCH}"
    OUTPUT="${ARTIFACTS_DIR}/skippr-ide-darwin-${ARCH}.zip"
    rm -f "${OUTPUT}"
    (cd "${ROOT_DIR}" && tar -a -c -f "${OUTPUT}" "VSCode-darwin-${ARCH}")
    ;;
  linux-x64|linux-arm64|linux-armhf)
    npm run gulp "vscode-linux-${ARCH}-min-ci"
    APP_DIR="${ROOT_DIR}/VSCode-linux-${ARCH}"
    OUTPUT="${ARTIFACTS_DIR}/skippr-ide-linux-${ARCH}.tar.gz"
    rm -f "${OUTPUT}"
    tar -czf "${OUTPUT}" -C "${ROOT_DIR}" "VSCode-linux-${ARCH}"
    ;;
  win32-x64|win32-arm64)
    npm run gulp "vscode-win32-${ARCH}-min-ci"
    APP_DIR="${ROOT_DIR}/VSCode-win32-${ARCH}"
    OUTPUT="${ARTIFACTS_DIR}/skippr-ide-win32-${ARCH}.zip"
    rm -f "${OUTPUT}"
    (cd "${ROOT_DIR}" && tar -a -c -f "${OUTPUT}" "VSCode-win32-${ARCH}")
    ;;
  *)
    echo "Unsupported target: ${PLATFORM}-${ARCH}"
    exit 1
    ;;
esac

if [ ! -d "${APP_DIR}" ]; then
  echo "Expected build output not found: ${APP_DIR}"
  exit 1
fi

echo "Packaged artifact: ${OUTPUT}"
