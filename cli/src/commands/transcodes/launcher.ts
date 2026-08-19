/**
 * Stable launcher at ~/.transcodes/bin/transcodes.
 *
 * AI hosts started from the Dock inherit launchd's PATH and never see
 * Homebrew/nvm bins. A bare `transcodes` then dies with "command not found"
 * and the skill tells the user to reinstall. This file is an absolute path
 * the host skills fall back to — it does not need to be on PATH.
 *
 * Mirrors the launcher body in `cli/install.sh`, which runs before any Node
 * exists; this one covers `npm i -g` upgrades that never re-run that script.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_INSTALL_HINT_UNIX } from '@transcodes-guard/core/contract';
import { transcodesDir } from '@transcodes-guard/core/paths';

const MARKER = 'transcodes-cli-launcher';

export function launcherDir(): string {
  return path.join(transcodesDir(), 'bin');
}

export function launcherPath(): string {
  const name = process.platform === 'win32' ? 'transcodes.cmd' : 'transcodes';
  return path.join(launcherDir(), name);
}

/**
 * Entry file of the CLI that is running right now, but only when it comes from
 * an installed package. A source checkout must never be baked in: the launcher
 * outlives the shell that wrote it, and pointing every AI host at a developer's
 * `cli/dist/index.js` would silently pin them to that working tree.
 */
function installedEntry(): string | null {
  const candidates: string[] = [];
  const argv = process.argv[1];
  if (argv) {
    try {
      candidates.push(fs.realpathSync(argv));
    } catch {
      candidates.push(argv);
    }
  }
  try {
    candidates.push(fileURLToPath(import.meta.url));
  } catch {
    // argv[1] is enough when import.meta.url is unavailable.
  }

  return (
    candidates.find(
      (p) =>
        /\.(js|mjs|cjs)$/.test(p) &&
        p.split(path.sep).includes('node_modules') &&
        fs.existsSync(p),
    ) ?? null
  );
}

/**
 * Node candidates, in the order the launcher should try them.
 *
 * `process.execPath` is version-scoped on Homebrew (`…/Cellar/node@20/20.19.4`)
 * and inside nvm, so it dies on the next upgrade. The unversioned locations and
 * the nvm glob are the recovery path — the same fallback chain `install.sh`
 * bakes in.
 */
function nodeFallbacks(): string[] {
  const nvmRoot =
    process.env.NVM_DIR?.trim() || path.join(os.homedir(), '.nvm');
  return [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    path.join(nvmRoot, 'versions/node/*/bin/node'),
  ];
}

function unixBody(entry: string): string {
  const [brew, local, nvmGlob] = nodeFallbacks();
  return `#!/bin/sh
# ${MARKER} — written by the transcodes installer. Safe to delete.
# Absolute paths on purpose: AI hosts run this from a shell with a minimal PATH.
ENTRY="${entry}"

for candidate in "${process.execPath}" "$(command -v node 2>/dev/null)" "${brew}" "${local}" ${nvmGlob}; do
  if [ -x "$candidate" ]; then
    NODE="$candidate"
    break
  fi
done

if [ -z "$NODE" ] || [ ! -f "$ENTRY" ]; then
  echo "transcodes: Node.js or the CLI is missing here. Reinstall with:" >&2
  echo "  ${CLI_INSTALL_HINT_UNIX}" >&2
  exit 127
fi

# Exported so the CLI can shell out to npm/npx/git.
PATH="$(dirname "$NODE"):$PATH"
export PATH
exec "$NODE" "$ENTRY" "$@"
`;
}

function windowsBody(entry: string): string {
  const nodeDir = path.dirname(process.execPath);
  return `@echo off
rem ${MARKER} - written by the transcodes installer. Safe to delete.
set "PATH=${nodeDir};%PATH%"
"${process.execPath}" "${entry}" %*
exit /b %errorlevel%
`;
}

/**
 * Write or refresh the stable launcher. Returns its path, or null when the CLI
 * is not running from an installed package (source checkout / unknown entry).
 * Never throws: the launcher is a convenience, not a prerequisite.
 */
export function writeLauncher(): string | null {
  const entry = installedEntry();
  if (!entry) return null;

  const dest = launcherPath();
  const body =
    process.platform === 'win32' ? windowsBody(entry) : unixBody(entry);

  try {
    if (fs.readFileSync(dest, 'utf8') === body) return dest;
  } catch {
    // Missing or unreadable — fall through and write it.
  }

  try {
    // 0700 on the product home: `config.json` (the member token) lives here and
    // token-store.ts creates this directory with the same mode.
    fs.mkdirSync(transcodesDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(launcherDir(), { recursive: true });
    fs.writeFileSync(dest, body, 'utf8');
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    return dest;
  } catch {
    return null;
  }
}
