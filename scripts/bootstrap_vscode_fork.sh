#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE_DIR="${ROOT_DIR}/vscode"
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-https://github.com/microsoft/vscode.git}"
UPSTREAM_REF="${UPSTREAM_REF:-main}"

if [ -d "${VSCODE_DIR}/.git" ]; then
  echo "Updating existing vscode checkout..."
  git -C "${VSCODE_DIR}" fetch origin "${UPSTREAM_REF}" --depth 1
  git -C "${VSCODE_DIR}" checkout "${UPSTREAM_REF}"
  git -C "${VSCODE_DIR}" pull --ff-only origin "${UPSTREAM_REF}"
elif [ -f "${VSCODE_DIR}/package.json" ]; then
  echo "Using vscode tree from repository checkout..."
else
  if [ -e "${VSCODE_DIR}" ]; then
    echo "Removing incomplete vscode directory before clone..."
    rm -rf "${VSCODE_DIR}"
  fi
  echo "Cloning vscode upstream..."
  git clone --depth 1 --branch "${UPSTREAM_REF}" "${UPSTREAM_REMOTE}" "${VSCODE_DIR}"
fi

echo "Applying Skippr overlay..."
node "${ROOT_DIR}/scripts/apply_skippr_overlay.mjs"

echo "Bootstrap complete: ${VSCODE_DIR}"
