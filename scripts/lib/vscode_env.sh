#!/usr/bin/env bash
set -euo pipefail

linux_gssapi_headers_present() {
  [ -f /usr/include/gssapi/gssapi.h ] || [ -f /usr/include/gssapi/gssapi_ext.h ]
}

ensure_posix_shell() {
  case "$(uname -s)" in
    Linux|Darwin) ;;
    *) return 0 ;;
  esac

  if [ -x /bin/sh ]; then
    return 0
  fi

  local bash_path
  bash_path="$(command -v bash || true)"
  if [ -z "${bash_path}" ]; then
    echo "Missing /bin/sh and bash; install bash before running VS Code npm install."
    return 1
  fi

  echo "Creating /bin/sh symlink required by VS Code npm postinstall..."
  sudo ln -sf "${bash_path}" /bin/sh
}

ensure_unix_npm_script_shell() {
  case "$(uname -s)" in
    Linux|Darwin) ;;
    *) return 0 ;;
  esac

  if [ -n "${npm_config_script_shell:-}" ]; then
    return 0
  fi

  local bash_path
  bash_path="$(command -v bash || true)"
  if [ -z "${bash_path}" ]; then
    echo "Missing bash; npm lifecycle scripts need a shell."
    return 1
  fi

  export npm_config_script_shell="bash"
}

configure_vscode_postinstall() {
  export VSCODE_NPM_INSTALL_CONCURRENCY="${VSCODE_NPM_INSTALL_CONCURRENCY:-1}"
}

ensure_windows_npm_script_shell() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) return 0 ;;
  esac

  if [ -n "${npm_config_script_shell:-}" ]; then
    return 0
  fi

  if ! command -v bash >/dev/null 2>&1; then
    echo "Missing bash; npm lifecycle scripts need bash on Depot Windows."
    return 1
  fi

  export npm_config_script_shell="bash"
}

configure_windows_native_builds() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) return 0 ;;
  esac

  export npm_config_foreground_scripts="${npm_config_foreground_scripts:-true}"
}

ensure_linux_build_dependencies() {
  if [ "$(uname -s)" != "Linux" ]; then
    return 0
  fi

  if linux_gssapi_headers_present; then
    return 0
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Missing GSSAPI headers (gssapi/gssapi.h). Install krb5 development packages for your distro."
    return 1
  fi

  echo "Installing Linux build dependencies required by vscode npm install..."
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libx11-dev \
    libx11-xcb-dev \
    libxkbfile-dev \
    libnotify-bin \
    libkrb5-dev \
    libgbm1 \
    libgtk-3-0
}

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
  ensure_posix_shell
  ensure_unix_npm_script_shell
  configure_vscode_postinstall
  ensure_windows_npm_script_shell
  configure_windows_native_builds
  ensure_linux_build_dependencies
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
