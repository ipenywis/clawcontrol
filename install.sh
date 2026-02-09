#!/usr/bin/env bash
set -euo pipefail

# ─── Colors & helpers ───────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

info()    { printf "${BLUE}[info]${RESET}  %s\n" "$*"; }
success() { printf "${GREEN}  ✔${RESET}  %s\n" "$*"; }
warn()    { printf "${YELLOW}[warn]${RESET}  %s\n" "$*"; }
error()   { printf "${RED}[error]${RESET} %s\n" "$*" >&2; }
step()    { printf "\n${BOLD}${CYAN}▸ %s${RESET}\n" "$*"; }

# ─── Banner ─────────────────────────────────────────────────────────────────
printf "${CYAN}${BOLD}"
cat << 'BANNER'

   _____ _                  _____            _             _
  / ____| |                / ____|          | |           | |
 | |    | | __ ___      __| |     ___  _ __ | |_ _ __ ___ | |
 | |    | |/ _` \ \ /\ / /| |    / _ \| '_ \| __| '__/ _ \| |
 | |____| | (_| |\ V  V / | |___| (_) | | | | |_| | | (_) | |
  \_____|_|\__,_| \_/\_/   \_____\___/|_| |_|\__|_|  \___/|_|

BANNER
printf "${RESET}"
printf "${DIM}  Deploy and manage OpenClaw instances — https://openclaw.ai${RESET}\n\n"

# ─── Detect OS & arch ──────────────────────────────────────────────────────
step "Detecting system"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)  OS_NAME="Linux"  ;;
  Darwin*) OS_NAME="macOS"  ;;
  *)       error "Unsupported operating system: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH_NAME="x64"   ;;
  arm64|aarch64)  ARCH_NAME="arm64" ;;
  *)              ARCH_NAME="$ARCH" ;;
esac

success "Detected ${OS_NAME} (${ARCH_NAME})"

# ─── Check Bun ──────────────────────────────────────────────────────────────
step "Checking Bun runtime"

if command -v bun &>/dev/null; then
  BUN_VERSION="$(bun --version)"
  success "Bun v${BUN_VERSION} found"
else
  warn "Bun is required but was not found."
  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash

  # Source the updated profile so bun is available in this session
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if command -v bun &>/dev/null; then
    BUN_VERSION="$(bun --version)"
    success "Bun v${BUN_VERSION} installed"
  else
    error "Bun installation failed. Please install Bun manually: https://bun.sh"
    exit 1
  fi
fi

# ─── Check Node.js ─────────────────────────────────────────────────────────
step "Checking Node.js"

REQUIRED_NODE_MAJOR=20

check_node_version() {
  if ! command -v node &>/dev/null; then
    return 1
  fi
  NODE_VERSION="$(node -v | sed 's/^v//')"
  NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]; then
    return 0
  fi
  return 1
}

if check_node_version; then
  success "Node.js v${NODE_VERSION} found"
else
  warn "Node.js >= ${REQUIRED_NODE_MAJOR} is required but was not found."
  printf "\n"

  # Try to install via nvm
  if command -v nvm &>/dev/null || [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    info "nvm detected — installing Node.js ${REQUIRED_NODE_MAJOR}..."
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    nvm install "$REQUIRED_NODE_MAJOR"
    nvm use "$REQUIRED_NODE_MAJOR"
    success "Node.js $(node -v) installed via nvm"
  else
    info "Installing nvm..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    nvm install "$REQUIRED_NODE_MAJOR"
    nvm use "$REQUIRED_NODE_MAJOR"
    success "Node.js $(node -v) installed via nvm"
  fi
fi

# ─── Install ClawControl ───────────────────────────────────────────────────
step "Installing ClawControl"

# Prefer bun for install since it's already verified above
PKG_INSTALL_CMD="bun add -g clawcontrol"

info "Running: ${PKG_INSTALL_CMD}"
$PKG_INSTALL_CMD

if ! command -v clawcontrol &>/dev/null; then
  warn "clawcontrol was installed but is not in PATH."
  warn "You may need to open a new terminal or add the global bin directory to PATH."
else
  success "ClawControl installed successfully!"
fi

# ─── Done ───────────────────────────────────────────────────────────────────
printf "\n"
printf "${GREEN}${BOLD}  ──────────────────────────────────────────${RESET}\n"
printf "${GREEN}${BOLD}  ClawControl is ready!${RESET}\n"
printf "${GREEN}${BOLD}  ──────────────────────────────────────────${RESET}\n"
printf "\n"
printf "  Get started:\n"
printf "\n"
printf "    ${CYAN}clawcontrol${RESET}\n"
printf "\n"
printf "  Then type ${BOLD}/new${RESET} to create your first deployment.\n"
printf "\n"
printf "${DIM}  Docs: https://openclaw.ai  •  Issues: https://github.com/ipenywis/clawcontrol/issues${RESET}\n"
printf "\n"
