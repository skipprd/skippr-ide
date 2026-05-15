#!/usr/bin/env bash
set -euo pipefail

ensure_vscode_node() {
  local vscode_dir="$1"
  local required
  required="$(tr -d '[:space:]' < "${vscode_dir}/.nvmrc")"
  local current
  current="$(node -v | sed 's/^v//')"

  if [ "${current}" = "${required}" ]; then
    return 0
  fi

  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    # nvm rejects shells where npm_config_prefix is set globally.
    unset npm_config_prefix
    # shellcheck disable=SC1090
    . "${HOME}/.nvm/nvm.sh"
    nvm install "${required}" >/dev/null
    nvm use "${required}" >/dev/null
    return 0
  fi

  echo "Node ${required} is required by vscode/.nvmrc, current is ${current}."
  echo "Install nvm or switch Node before running this script."
  return 1
}

ensure_vscode_dependencies() {
  local vscode_dir="$1"
  if [ ! -d "${vscode_dir}/node_modules" ]; then
    (cd "${vscode_dir}" && npm install)
  fi
  if [ ! -d "${vscode_dir}/build/node_modules" ]; then
    (cd "${vscode_dir}/build" && npm install)
  fi
  if [ ! -d "${vscode_dir}/extensions/node_modules" ]; then
    (cd "${vscode_dir}/extensions" && npm install)
  fi
}

ensure_skippr_workbench_dependencies() {
  local vscode_dir="$1"
  local ext_dir="${vscode_dir}/extensions/skippr-workbench"
  if [ ! -d "${ext_dir}" ]; then
    echo "Missing built-in skippr-workbench extension. Run npm run apply:overlay first."
    return 1
  fi
  if [ ! -d "${ext_dir}/node_modules" ]; then
    (cd "${ext_dir}" && npm install)
  fi
}

ensure_skippr_data_agent_dependencies() {
  local vscode_dir="$1"
  local ext_dir="${vscode_dir}/extensions/skippr-data-agent"
  if [ ! -d "${ext_dir}" ]; then
    echo "Missing built-in skippr-data-agent extension. Run npm run apply:overlay first."
    return 1
  fi
  if [ ! -d "${ext_dir}/node_modules" ]; then
    (cd "${ext_dir}" && npm install)
  fi
}
