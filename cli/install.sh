#!/usr/bin/env bash
#
# Transcodes CLI bootstrap installer — macOS / Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
#
# That chained form must always work. The second command runs in the *calling*
# shell, which never sees PATH changes made in here — so when Node comes from
# nvm, npm's global bin is a directory the caller has never had on PATH and a
# bare `transcodes` would die with "command not found". `link_cli` therefore
# installs a launcher into a directory the caller already searches, with an
# absolute Node path baked in (a plain symlink is not enough: the package's
# `#!/usr/bin/env node` shebang would need `node` on the caller's PATH too).
#
# `| bash -s -- install` is also supported and runs the guided setup in this
# script's own shell.
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
INSTALL_SH_URL="https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh"
MIN_NODE_MAJOR=20
NVM_VERSION="v0.40.3"
# PATH as inherited from the calling shell. Anything this script prepends (nvm)
# is invisible to that shell, so this is what decides whether a chained
# `transcodes install` can work.
CALLER_PATH="${PATH}"
# Marks launchers we wrote, so re-runs can overwrite ours without warning.
SHIM_MARKER="# transcodes-cli-launcher"
SHIM_PATH=""

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

# Is $1 a directory the calling shell already searches?
caller_path_has() {
  case ":${CALLER_PATH}:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

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

# --- 4. make `transcodes` reachable from the calling shell --------------------

# Follow symlinks to the package's real entry file. macOS has no `readlink -f`.
resolve_target() {
  local target="$1" link dir depth=0
  while [ -L "$target" ] && [ "$depth" -lt 20 ]; do
    link="$(readlink "$target")"
    case "$link" in
      /*) target="$link" ;;
      *)
        dir="$(cd -P "$(dirname "$target")" 2>/dev/null && pwd)" || return 1
        target="${dir}/${link}"
        ;;
    esac
    depth=$((depth + 1))
  done
  # Collapse any `..` left by relative npm bin links.
  dir="$(cd -P "$(dirname "$target")" 2>/dev/null && pwd)" || return 1
  printf '%s\n' "${dir}/$(basename "$target")"
}

# Directories the caller's shell already searches, best first. Only these can
# make a chained `transcodes install` work.
shim_dir() {
  local d
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    caller_path_has "$d" || continue
    case "$d" in
      # System-owned (SIP-protected on macOS); never write here.
      /bin | /sbin | /usr/bin | /usr/sbin) continue ;;
      # Version-scoped, so a launcher here vanishes on the next node upgrade.
      "${NVM_DIR:-$HOME/.nvm}"/*) continue ;;
    esac
    [ -d "$d" ] || mkdir -p "$d" 2>/dev/null || continue
    [ -w "$d" ] || continue
    printf '%s\n' "$d"
    return 0
  done <<EOF
/opt/homebrew/bin
/usr/local/bin
${HOME}/.local/bin
${HOME}/bin
$(printf '%s' "$CALLER_PATH" | tr ':' '\n')
EOF
  return 1
}

link_cli() {
  local npm_bin entry node_bin node_dir dir dest
  npm_bin="$(command -v transcodes)" || return 1

  # Already on the caller's PATH (e.g. Homebrew Node) — nothing to do.
  if caller_path_has "$(dirname "$npm_bin")"; then
    return 0
  fi

  step "Linking transcodes onto your PATH"
  entry="$(resolve_target "$npm_bin")" || { warn "could not resolve the installed CLI path"; return 1; }
  # Deliberately *not* resolved: `/opt/homebrew/bin/node` survives a
  # `brew upgrade node`, while the Cellar path it points at does not.
  node_bin="$(command -v node)"
  node_dir="$(dirname "$node_bin")"

  if ! dir="$(shim_dir)"; then
    warn "no writable directory on your PATH — falling back to manual instructions."
    return 1
  fi
  dest="${dir}/transcodes"

  if [ -e "$dest" ] && ! grep -qF "$SHIM_MARKER" "$dest" 2>/dev/null; then
    warn "replacing an older transcodes at ${dest}"
  fi

  # The launcher hardcodes Node because the caller's shell may have no node at
  # all, and prepends Node's bin dir so the CLI can shell out to npm/npx/git.
  cat > "$dest" <<EOF
#!/bin/sh
${SHIM_MARKER} — written by the transcodes installer. Safe to delete.
REINSTALL="curl -fsSL ${INSTALL_SH_URL} | bash"

NODE="${node_bin}"
if [ ! -x "\$NODE" ]; then
  # Node moved (version upgrade / nvm cleanup) — look for any usable one.
  NODE="\$(command -v node 2>/dev/null || true)"
fi
if [ -z "\$NODE" ]; then
  for candidate in "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node; do
    [ -x "\$candidate" ] && NODE="\$candidate"
  done
fi
if [ -z "\$NODE" ]; then
  echo "transcodes: Node.js not found. Reinstall with:" >&2
  echo "  \$REINSTALL" >&2
  exit 127
fi
if [ ! -f "${entry}" ]; then
  echo "transcodes: the CLI is no longer installed at" >&2
  echo "  ${entry}" >&2
  echo "Reinstall with:  \$REINSTALL" >&2
  exit 127
fi

# Exported so the CLI can shell out to npm/npx/git during setup.
PATH="${node_dir}:\$PATH"
export PATH
exec "\$NODE" "${entry}" "\$@"
EOF
  chmod 755 "$dest" || { warn "could not make ${dest} executable"; return 1; }

  SHIM_PATH="$dest"
  say "  ✓ ${dest}"
  return 0
}

# Can the shell that invoked this script run `transcodes`?
caller_can_run() {
  local bin
  bin="$(command -v transcodes 2>/dev/null)" || return 1
  caller_path_has "$(dirname "$bin")" && return 0
  [ -n "$SHIM_PATH" ] && [ -x "$SHIM_PATH" ] && return 0
  return 1
}

# --- 5. verify PATH ----------------------------------------------------------
verify() {
  step "Verifying"
  hash -r 2>/dev/null || true

  if ! have transcodes; then
    prefix="$(npm prefix -g 2>/dev/null || echo '')"
    say "  ! transcodes was installed but is not on your PATH yet."
    [ -n "$prefix" ] && say "    Add this to your shell profile:  export PATH=\"${prefix}/bin:\$PATH\""
    say "    Then open a new terminal and run:  transcodes install"
    return 0
  fi

  bin_dir="$(dirname "$(command -v transcodes)")"
  say "  ✓ transcodes $(transcodes version 2>/dev/null || echo '')"

  # Guided setup runs next in this same shell, so PATH advice is irrelevant.
  [ "${1:-0}" -eq 1 ] && return 0
  say ""

  # Only reachable if `link_cli` could not find a writable directory on the
  # caller's PATH, so a chained `transcodes install` would fail here.
  if ! caller_can_run; then
    say "${BOLD}Installed, but your current terminal cannot see it yet.${RESET}"
    say "  ${DIM}${bin_dir}${RESET} is not on this shell's PATH."
    say ""
    say "  Run the setup with:"
    say "    ${DIM}${bin_dir}/transcodes install${RESET}"
    say ""
    say "  To keep it for good, add this to your shell profile:"
    say "    ${DIM}export PATH=\"${bin_dir}:\$PATH\"${RESET}"
    return 0
  fi

  say "${BOLD}Done.${RESET} Next:"
  say "  ${DIM}transcodes install${RESET}   set up the guard plugin + your token"
  say "  ${DIM}transcodes${RESET}           open the local dashboard"
}

run_guided_install() {
  step "Running transcodes install"
  if have transcodes; then
    # Same shell as ensure_node (nvm sourced) so PATH is correct.
    exec transcodes install "$@"
  fi
  die "transcodes is not on PATH — open a new terminal and run: transcodes install"
}

usage() {
  say "Usage: install.sh [install]"
  say ""
  say "  (no args)   install Node/Git if needed, then the transcodes CLI"
  say "  install     also run the guided setup in this shell"
  say ""
  say "Piped forms (both work):"
  say "  curl -fsSL ${INSTALL_SH_URL} | bash && transcodes install"
  say "  curl -fsSL ${INSTALL_SH_URL} | bash -s -- install"
}

main() {
  local run_install=0
  local -a passthrough=()
  for arg in "$@"; do
    case "$arg" in
      install|--install) run_install=1 ;;
      -h|--help) usage; return 0 ;;
      *) passthrough+=("$arg") ;;
    esac
  done

  say "${BOLD}Transcodes CLI installer${RESET}"
  ensure_node
  ensure_git
  install_cli
  link_cli || true
  verify "$run_install"
  if [ "$run_install" -eq 1 ]; then
    run_guided_install "${passthrough[@]}"
  fi
}

main "$@"
