#!/usr/bin/env bash
set -euo pipefail

TARGET_ID="${1:-unknown}"
UNAME="$(uname -s 2>/dev/null || echo unknown)"

log() {
  printf '[depot-bootstrap] %s\n' "$*"
}

show_command() {
  local name="$1"
  if command -v "${name}" >/dev/null 2>&1; then
    log "${name}: $(command -v "${name}")"
  else
    log "${name}: not found"
  fi
}

ensure_unix_shell() {
  case "${UNAME}" in
    Linux|Darwin) ;;
    *) return 0 ;;
  esac

  if [ -x /bin/sh ]; then
    return 0
  fi

  local bash_path
  bash_path="$(command -v bash || true)"
  if [ -z "${bash_path}" ]; then
    log "missing /bin/sh and bash; VS Code npm postinstall requires a POSIX shell"
    return 1
  fi

  log "creating /bin/sh -> ${bash_path}"
  sudo ln -sf "${bash_path}" /bin/sh
}

ensure_unix_npm_script_shell() {
  case "${UNAME}" in
    Linux|Darwin) ;;
    *) return 0 ;;
  esac

  local bash_path
  bash_path="$(command -v bash || true)"
  if [ -z "${bash_path}" ]; then
    log "missing bash; npm lifecycle scripts need a shell"
    return 1
  fi

  log "using ${bash_path} as npm script shell"
  export npm_config_script_shell="${bash_path}"
  npm config set script-shell "${bash_path}"
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'npm_config_script_shell=%s\n' "${bash_path}" >> "${GITHUB_ENV}"
  fi
}

ensure_windows_shell() {
  case "${UNAME}" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) return 0 ;;
  esac

  if [ -x /c/Windows/System32/cmd.exe ] || [ -x /C/Windows/System32/cmd.exe ]; then
    log "cmd.exe: present"
    return 0
  fi

  if ! command -v bash >/dev/null 2>&1; then
    log "missing cmd.exe and bash; npm lifecycle scripts need a shell"
    return 1
  fi

  log "cmd.exe missing; using bash as npm script shell"
  export npm_config_script_shell="bash"
  npm config set script-shell bash
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'npm_config_script_shell=bash\n' >> "${GITHUB_ENV}"
  fi
}

configure_windows_native_builds() {
  case "${UNAME}" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) return 0 ;;
  esac

  log "using foreground npm scripts to avoid concurrent MSBuild file locks"
  export npm_config_foreground_scripts="true"
  npm config set foreground-scripts true
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'npm_config_foreground_scripts=true\n' >> "${GITHUB_ENV}"
  fi
}

install_linux_dependencies() {
  case "${UNAME}" in
    Linux) ;;
    *) return 0 ;;
  esac

  if ! command -v apt-get >/dev/null 2>&1; then
    log "apt-get not found; skipping Linux package install"
    return 0
  fi

  log "installing Linux dependencies for VS Code native modules"
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

show_diagnostics() {
  log "target: ${TARGET_ID}"
  log "uname: ${UNAME}"
  log "whoami: $(whoami 2>/dev/null || true)"
  log "pwd: $(pwd)"
  log "PATH: ${PATH}"
  show_command bash
  show_command sh
  show_command node
  show_command npm

  if command -v node >/dev/null 2>&1; then
    log "node version: $(node -v)"
    log "node execPath: $(node -p 'process.execPath')"
  fi

  if command -v npm >/dev/null 2>&1; then
    log "npm version: $(npm -v)"
    log "npm script-shell: $(npm config get script-shell || true)"
  fi
}

ensure_unix_shell
ensure_unix_npm_script_shell
ensure_windows_shell
configure_windows_native_builds
install_linux_dependencies
show_diagnostics
