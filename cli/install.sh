#!/usr/bin/env bash
#
# Transcodes CLI bootstrap installer — macOS / Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash
#
# Then run guided setup (plugins + token dashboard):
#
#   curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
#
# Ensures Node.js >= 20 and Git exist (installing via nvm/brew/apt when needed),
# then installs `@bigstrider/transcodes-cli` globally so the `transcodes`
# command is on PATH. Plugin marketplace install needs Git; the CLI and guard
# hooks need Node.
#
# Mirror of the bootstrap logic in `cli/src/commands/transcodes/install.ts`
# (`ensureNode` / `ensureGit`), except this runs *before* any Node is present.

set -euo pipefail

PKG="@bigstrider/transcodes-cli"
MIN_NODE_MAJOR=20
NVM_VERSION="v0.40.3"

# --- tiny output helpers -----------------------------------------------------
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"; RESET="$(printf '\033[0m')"
else
  BOLD=""; DIM=""; RESET=""
fi
say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { printf '\nInstall failed: %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

node_major() {
  have node || { echo 0; return; }
  # `node -v` prints e.g. v22.11.0 -> 22
  node -v 2>/dev/null | sed -E 's/^v?([0-9]+).*/\1/' | grep -E '^[0-9]+$' || echo 0
}

# --- 0. download tool --------------------------------------------------------
require_curl() {
  have curl && return 0
  die "curl is required to bootstrap Node (install curl, then re-run this script)."
}

# --- 1. ensure Node >= 20 ----------------------------------------------------
ensure_node() {
  step "Checking Node.js (need >= ${MIN_NODE_MAJOR})"
  if [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ]; then
    say "  ✓ Node.js $(node -v) already installed"
    return 0
  fi

  require_curl
  say "  Node.js not found (or too old) — installing an LTS…"

  # Prefer Homebrew on macOS when available (keeps it on the user's usual PATH).
  if [ "$(uname -s)" = "Darwin" ] && have brew; then
    brew install node || warn "brew install node failed, falling back to nvm"
  fi

  # nvm — either an existing install or the official bootstrap.
  if [ "$(node_major)" -lt "$MIN_NODE_MAJOR" ]; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
      say "  Installing nvm ${NVM_VERSION}…"
      curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash \
        || die "could not download nvm (check your network / proxy)"
    fi
    # shellcheck disable=SC1090
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    nvm install --lts >/dev/null 2>&1 || nvm install --lts
    nvm use --lts >/dev/null 2>&1 || true
    nvm alias default 'lts/*' >/dev/null 2>&1 || true
  fi

  if [ "$(node_major)" -lt "$MIN_NODE_MAJOR" ]; then
    die "Node.js ${MIN_NODE_MAJOR}+ is required. Install it from https://nodejs.org and re-run this script."
  fi
  say "  ✓ Node.js $(node -v) ready"
}

# --- 2. ensure Git (marketplace clone) ---------------------------------------
ensure_git() {
  step "Checking Git"
  if have git; then
    say "  ✓ $(git --version 2>/dev/null || echo git) already installed"
    return 0
  fi

  say "  Git not found — installing (required for plugin marketplace)…"

  if [ "$(uname -s)" = "Darwin" ] && have brew; then
    brew install git || warn "brew install git failed"
  elif have apt-get; then
    if have sudo; then
      sudo apt-get update -y && sudo apt-get install -y git \
        || warn "apt-get install git failed"
    else
      apt-get update -y && apt-get install -y git \
        || warn "apt-get install git failed (try with sudo)"
    fi
  elif have dnf; then
    if have sudo; then sudo dnf install -y git || warn "dnf install git failed"
    else dnf install -y git || warn "dnf install git failed"
    fi
  elif have yum; then
    if have sudo; then sudo yum install -y git || warn "yum install git failed"
    else yum install -y git || warn "yum install git failed"
    fi
  elif have pacman; then
    if have sudo; then sudo pacman -Sy --noconfirm git || warn "pacman install git failed"
    else pacman -Sy --noconfirm git || warn "pacman install git failed"
    fi
  fi

  hash -r 2>/dev/null || true
  if have git; then
    say "  ✓ $(git --version 2>/dev/null || echo git) ready"
    return 0
  fi

  die "Git is required for plugin install. Install it from https://git-scm.com then re-run this script."
}

# --- 3. install the CLI ------------------------------------------------------
install_cli() {
  step "Installing ${PKG}"
  have npm || die "npm is missing even though Node is installed — reopen your terminal and retry."
  if ! npm install -g "$PKG"; then
    warn "global install failed (likely a permissions issue on the npm prefix)."
    warn "Try:  npm config set prefix \"\$HOME/.npm-global\"  then re-run this script,"
    warn "or:   sudo npm install -g ${PKG}"
    die "npm install -g failed"
  fi
}

# --- 4. verify PATH ----------------------------------------------------------
verify() {
  step "Verifying"
  hash -r 2>/dev/null || true
  if have transcodes; then
    say "  ✓ transcodes $(transcodes version 2>/dev/null || echo '')"
    say ""
    say "${BOLD}Done.${RESET} Next:"
    say "  ${DIM}transcodes install${RESET}   set up the guard plugin + your token"
    say "  ${DIM}transcodes${RESET}           open the local dashboard"
  else
    prefix="$(npm prefix -g 2>/dev/null || echo '')"
    say "  ! transcodes was installed but is not on your PATH yet."
    [ -n "$prefix" ] && say "    Add this to your shell profile:  export PATH=\"${prefix}/bin:\$PATH\""
    say "    Then open a new terminal and run:  transcodes install"
  fi
}

run_guided_install() {
  step "Running transcodes install"
  if have transcodes; then
    # Same shell as ensure_node (nvm sourced) so PATH is correct.
    exec transcodes install "$@"
  fi
  die "transcodes is not on PATH — open a new terminal and run: transcodes install"
}

main() {
  local run_install=0
  local -a passthrough=()
  for arg in "$@"; do
    case "$arg" in
      install|--install) run_install=1 ;;
      *) passthrough+=("$arg") ;;
    esac
  done

  say "${BOLD}Transcodes CLI installer${RESET}"
  ensure_node
  ensure_git
  install_cli
  verify
  if [ "$run_install" -eq 1 ]; then
    run_guided_install "${passthrough[@]}"
  fi
}

main "$@"
