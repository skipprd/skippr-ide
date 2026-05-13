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
ensure_vscode_dependencies "${VSCODE_DIR}"
ensure_skippr_workbench_dependencies "${VSCODE_DIR}"

echo "Starting Skippr IDE fork in dev mode..."
cd "${VSCODE_DIR}"
npm run watch-client-transpile &
PID_ONE=$!
npm run watch-client &
PID_TWO=$!
npm --prefix extensions/skippr-workbench run watch &
PID_THREE=$!

trap 'kill ${PID_ONE} ${PID_TWO} ${PID_THREE} 2>/dev/null || true' INT TERM EXIT
while true; do
  for pid in "${PID_ONE}" "${PID_TWO}" "${PID_THREE}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      wait "${pid}" || true
      exit 1
    fi
  done
  sleep 1
done
