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

# ─── Helper: ensure a line exists in a shell rc file ────────────────────────
# Usage: ensure_in_rc "export PATH=..."
# Writes to .bashrc / .zshrc / fish config depending on the user's shell.
ensure_in_rc() {
  local line="$1"
  local user_shell rc_file

  user_shell="$(basename "${SHELL:-/bin/bash}")"
  case "$user_shell" in
    zsh)  rc_file="$HOME/.zshrc" ;;
    fish) rc_file="$HOME/.config/fish/config.fish" ;;
    *)    rc_file="$HOME/.bashrc" ;;
  esac

  # Create the rc file if it doesn't exist
  if [ ! -f "$rc_file" ]; then
    touch "$rc_file"
  fi

  # Only append if the line is not already present
  if ! grep -qF "$line" "$rc_file" 2>/dev/null; then
    printf '\n# Added by ClawControl installer\n%s\n' "$line" >> "$rc_file"
    info "Added to ${rc_file}: ${line}"
  fi
}

# ─── Helper: detect the user's shell rc file path ──────────────────────────
get_shell_rc() {
  local user_shell
  user_shell="$(basename "${SHELL:-/bin/bash}")"
  case "$user_shell" in
    zsh)  echo "$HOME/.zshrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)    echo "$HOME/.bashrc" ;;
  esac
}

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

# ─── Install system dependencies ───────────────────────────────────────────
step "Checking system dependencies"

# Tools required by the rest of this script and by Bun/nvm installers:
#   curl   – downloading installers (already needed to run this script)
#   unzip  – Bun installer extracts its binary with unzip on Linux
#   git    – nvm and general tooling
#   tar    – nvm Node.js install
REQUIRED_CMDS=(curl unzip git tar)

missing=()
for cmd in "${REQUIRED_CMDS[@]}"; do
  if ! command -v "$cmd" &>/dev/null; then
    missing+=("$cmd")
  fi
done

if [ ${#missing[@]} -eq 0 ]; then
  success "All dependencies found (${REQUIRED_CMDS[*]})"
else
  warn "Missing: ${missing[*]}"

  # ── Detect system package manager and install ──
  install_pkgs() {
    if command -v apt-get &>/dev/null; then
      info "Installing via apt-get..."
      sudo apt-get update -qq
      sudo apt-get install -y -qq "$@"
    elif command -v dnf &>/dev/null; then
      info "Installing via dnf..."
      sudo dnf install -y -q "$@"
    elif command -v yum &>/dev/null; then
      info "Installing via yum..."
      sudo yum install -y -q "$@"
    elif command -v pacman &>/dev/null; then
      info "Installing via pacman..."
      sudo pacman -Sy --noconfirm "$@"
    elif command -v zypper &>/dev/null; then
      info "Installing via zypper..."
      sudo zypper install -y "$@"
    elif command -v apk &>/dev/null; then
      info "Installing via apk..."
      sudo apk add --no-cache "$@"
    elif command -v brew &>/dev/null; then
      info "Installing via Homebrew..."
      brew install "$@"
    else
      error "Could not detect a package manager. Please install these manually: ${missing[*]}"
      exit 1
    fi
  }

  if [ "$OS_NAME" = "macOS" ]; then
    # macOS: curl, unzip, tar, git are all pre-installed in most setups.
    # If anything is truly missing, try Homebrew.
    if command -v brew &>/dev/null; then
      info "Installing missing tools via Homebrew..."
      brew install "${missing[@]}"
    else
      # Install Xcode Command Line Tools (provides git, tar, etc.)
      if [[ " ${missing[*]} " =~ " git " ]]; then
        info "Installing Xcode Command Line Tools (provides git)..."
        xcode-select --install 2>/dev/null || true
        warn "If prompted, accept the Xcode CLI Tools dialog, then re-run this script."
        exit 1
      fi
      error "Could not auto-install: ${missing[*]}. Please install Homebrew (https://brew.sh) and re-run."
      exit 1
    fi
  else
    install_pkgs "${missing[@]}"
  fi

  # Verify everything was installed
  still_missing=()
  for cmd in "${missing[@]}"; do
    if ! command -v "$cmd" &>/dev/null; then
      still_missing+=("$cmd")
    fi
  done

  if [ ${#still_missing[@]} -ne 0 ]; then
    error "Failed to install: ${still_missing[*]}. Please install them manually and re-run."
    exit 1
  fi

  success "Installed ${missing[*]}"
fi

# ─── Check Bun ──────────────────────────────────────────────────────────────
step "Checking Bun runtime"

# Always ensure ~/.bun/bin is on PATH for this session (even if bun was
# installed in a previous run but the shell profile hasn't been sourced yet)
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if command -v bun &>/dev/null; then
  BUN_VERSION="$(bun --version)"
  success "Bun v${BUN_VERSION} found"
else
  warn "Bun is required but was not found."
  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash

  # Re-export in case the installer changed BUN_INSTALL
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

# Ensure ~/.bun/bin is in the shell rc file (Bun's installer is unreliable
# about doing this, especially when piped via curl)
ensure_in_rc 'export BUN_INSTALL="$HOME/.bun"'
ensure_in_rc 'export PATH="$BUN_INSTALL/bin:$PATH"'

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

# Resolve the actual binary path — Bun global bin is always $BUN_INSTALL/bin
CLAWCONTROL_BIN="$BUN_INSTALL/bin/clawcontrol"

if [ -x "$CLAWCONTROL_BIN" ]; then
  success "ClawControl installed successfully!"
elif command -v clawcontrol &>/dev/null; then
  CLAWCONTROL_BIN="$(command -v clawcontrol)"
  success "ClawControl installed successfully!"
else
  # Last resort: search common global bin locations
  for candidate in "$HOME/.bun/bin/clawcontrol" "$HOME/.local/bin/clawcontrol" "/usr/local/bin/clawcontrol"; do
    if [ -x "$candidate" ]; then
      CLAWCONTROL_BIN="$candidate"
      break
    fi
  done

  if [ -x "${CLAWCONTROL_BIN:-}" ]; then
    success "ClawControl installed successfully!"
  else
    warn "ClawControl was installed but the binary could not be located."
    warn "Try opening a new terminal and running: clawcontrol"
    printf "\n"
    exit 0
  fi
fi

# ─── Done ───────────────────────────────────────────────────────────────────
printf "\n"
printf "${GREEN}${BOLD}  ──────────────────────────────────────────${RESET}\n"
printf "${GREEN}${BOLD}  ClawControl is ready!${RESET}\n"
printf "${GREEN}${BOLD}  ──────────────────────────────────────────${RESET}\n"
printf "\n"

SHELL_RC="$(get_shell_rc)"

# Ask the user if they want to launch ClawControl right now.
# We read from /dev/tty because stdin is the piped script when using curl|bash.
printf "  Would you like to launch ${BOLD}ClawControl${RESET} now? ${CYAN}[Y/n]${RESET} "
if [ -t 0 ]; then
  read -r REPLY
else
  read -r REPLY < /dev/tty 2>/dev/null || REPLY="n"
fi

case "${REPLY:-Y}" in
  [nN]*)
    printf "\n"
    printf "  To make ${BOLD}clawcontrol${RESET} available everywhere, reload your shell:\n"
    printf "\n"
    printf "    ${CYAN}exec \$SHELL${RESET}\n"
    printf "    ${CYAN}clawcontrol${RESET}\n"
    printf "\n"
    printf "  Or run it right now with the full path:\n"
    printf "\n"
    printf "    ${CYAN}${CLAWCONTROL_BIN}${RESET}\n"
    ;;
  *)
    printf "\n"
    info "Launching ClawControl..."
    printf "\n"
    # Run using the resolved full path — bypasses PATH entirely so it works
    # even before the user has reloaded their shell.
    "$CLAWCONTROL_BIN"

    printf "\n"
    printf "  ${DIM}To use ${BOLD}clawcontrol${RESET}${DIM} by name in this terminal, reload your shell:${RESET}\n"
    printf "\n"
    printf "    ${CYAN}exec \$SHELL${RESET}\n"
    ;;
esac

printf "\n"
printf "  Type ${BOLD}/new${RESET} to create your first deployment.\n"
printf "\n"
printf "${DIM}  Docs: https://openclaw.ai  •  Issues: https://github.com/ipenywis/clawcontrol/issues${RESET}\n"
printf "\n"
