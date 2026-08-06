/**
 * Local web dashboard — session (login), onboarding guide, read-only permissions.
 *
 * Binds to 127.0.0.1 only. Auth is browser `transcodes login`
 * (one active credential per machine).
 * Permission edits are console-only.
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { TRANSCODES_GUARD_REPO_URL } from '@transcodes-guard/core/contract';
import {
  clearTokenFile,
  fetchMemberProfile,
  isGuardEnabled,
  loadStepupConfig,
  openConsoleSession,
  parseMemberAccessToken,
  readTokenFromFile,
  readTokenRecords,
  request,
  resolveToken,
  type StepupConfig,
  setGuardEnabled,
  transcodesConfigFile,
} from '@transcodes-guard/core/stepup';
import { renderCliCommandsHtml } from '../index.js';
import { createFeatureScaffold } from '../sync/lib/feature-scaffold.js';
import { getGlobalPersonaSyncTargets } from './host-apps.js';
import { beginCliLogin } from './login.js';
import { LOGO_DATA_URI } from './logo.js';
import {
  createPersona,
  defaultPersonaRoot,
  deletePersona,
  deletePersonaFile,
  deployPersona,
  listPersona,
  type PersonaKind,
  pickProjectFolder,
  readLastRoot,
  readPersonaFile,
  resolvePersonaRoot,
  revealPersonaFolder,
  savePersonaFile,
} from './persona.js';
import { fetchRbacSnapshot, loadRbacConfig } from './rbac-api.js';
import { CLI_VERSION } from './version.js';

export const DEFAULT_DASHBOARD_PORT = 3847;
export const DASHBOARD_HOST = '127.0.0.1';
/** How many consecutive ports to try (preferred … preferred+N-1). */
export const DASHBOARD_PORT_ATTEMPTS = 10;

const DEFAULT_PORT = DEFAULT_DASHBOARD_PORT;
const HOST = DASHBOARD_HOST;
const PORT_ATTEMPTS = DASHBOARD_PORT_ATTEMPTS;
/** Value of `X-Transcodes-Dashboard` on /health — used by ensure/stop. */
const DASHBOARD_HEALTH_MARKER = 'transcodes-dashboard';
/** Temporary Mux playback id for the Guide onboarding video. */
const GUIDELINE_MUX_PLAYBACK_ID = 'ETcWgVp84mIFIIAYYyZrjZ4DQRddp1flBOwGm6smmOs';

/** PWA icon bytes (same 512×512 PNG as the header logo). */
const PWA_ICON_PNG = Buffer.from(
  LOGO_DATA_URI.replace(/^data:image\/png;base64,/, ''),
  'base64',
);

const PWA_MANIFEST = JSON.stringify({
  name: 'Transcodes CLI Dashboard',
  short_name: 'Transcodes',
  description:
    'Local Transcodes CLI dashboard — profile, guide, and permissions.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f4f4f6',
  theme_color: '#16161a',
  icons: [
    {
      src: '/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icon-512.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
  ],
});

/**
 * PWA service worker: network-first while the CLI is up; when the local
 * server is stopped, show a cached offline page instead of Chrome's
 * "This site can't be reached".
 */
const PWA_SERVICE_WORKER = `/* Transcodes dashboard PWA */
const CACHE = 'transcodes-dashboard-offline-v4';
const OFFLINE_URL = '/offline';
const OFFLINE_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#16161a" />
  <title>Transcodes — CLI Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f4f4f6;
      color: #16161a;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: #fff;
      border-radius: 24px;
      padding: 36px 36px 32px;
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.04), 0 12px 40px rgba(16, 16, 26, 0.06);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .lede {
      margin: 0 0 20px;
      font-size: 15px;
      line-height: 1.5;
      color: #8a8a94;
    }
    .tabs {
      display: flex;
      gap: 4px;
      padding: 4px;
      margin-bottom: 20px;
      background: #f4f4f6;
      border-radius: 12px;
    }
    .tab {
      flex: 1;
      border: none;
      border-radius: 9px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 600;
      color: #8a8a94;
      background: transparent;
      cursor: pointer;
    }
    .tab[aria-selected="true"] {
      color: #16161a;
      background: #fff;
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.08);
    }
    .panel[hidden] { display: none !important; }
    ol {
      margin: 0;
      padding-left: 20px;
      font-size: 14px;
      line-height: 1.6;
      color: #5a5a64;
    }
    li + li { margin-top: 8px; }
    kbd {
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      color: #16161a;
      background: #f4f4f6;
      border: 1px solid #e2e2e8;
      border-bottom-width: 2px;
      border-radius: 6px;
      padding: 1px 6px;
    }
    .cmd {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 6px;
      background: #16161a;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .cmd code {
      flex: 1;
      min-width: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: #fff;
      white-space: nowrap;
      overflow-x: auto;
    }
    .copy {
      flex-shrink: 0;
      border: none;
      border-radius: 7px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 600;
      color: #16161a;
      background: #fff;
      cursor: pointer;
    }
    .copy:hover { opacity: 0.88; }
    .note {
      margin: 20px 0 0;
      padding-top: 18px;
      border-top: 1px solid #ececf0;
    }
    .note-title {
      margin: 0 0 6px;
      font-size: 13px;
      font-weight: 700;
      color: #16161a;
    }
    .note-lede {
      margin: 0 0 10px;
      font-size: 13px;
      line-height: 1.55;
      color: #8a8a94;
    }
    .note-hint {
      margin: 10px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: #8a8a94;
    }
    .note code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: #16161a;
      background: #f4f4f6;
      border-radius: 6px;
      padding: 2px 6px;
    }
    .actions {
      margin-top: 22px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .refresh {
      border: none;
      border-radius: 10px;
      padding: 11px 18px;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      background: #16161a;
      cursor: pointer;
    }
    .refresh:hover { opacity: 0.92; }
    .status { font-size: 13px; color: #8a8a94; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Control panel is offline</h1>
    <p class="lede">Transcodes isn't running on this computer. Start it from a terminal, then come back here.</p>

    <div class="tabs" role="tablist" aria-label="Operating system">
      <button type="button" class="tab" role="tab" id="tab-unix" aria-controls="panel-unix" aria-selected="true" data-tab="unix">macOS / Linux</button>
      <button type="button" class="tab" role="tab" id="tab-windows" aria-controls="panel-windows" aria-selected="false" data-tab="windows">Windows</button>
    </div>

    <div class="panel" id="panel-unix" role="tabpanel" aria-labelledby="tab-unix">
      <ol>
        <li>Open Terminal — macOS: press <kbd>⌘</kbd> + <kbd>Space</kbd>, type <strong>Terminal</strong>, press <kbd>Enter</kbd>. Linux: press <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd>.</li>
        <li>
          Type this and press <kbd>Enter</kbd>:
          <span class="cmd"><code>transcodes</code><button type="button" class="copy" data-copy="transcodes">Copy</button></span>
        </li>
        <li>Leave the terminal open, then click <strong>Refresh</strong> below.</li>
      </ol>
      <div class="note">
        <p class="note-title">Says “command not found”?</p>
        <p class="note-lede">Install first — the script sets up Node.js if needed and runs <code>npm install -g @bigstrider/transcodes-cli</code>. When it finishes, run <code>transcodes</code> and refresh.</p>
        <span class="cmd"><code>curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash &amp;&amp; transcodes install</code><button type="button" class="copy" data-copy="curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash &amp;&amp; transcodes install">Copy</button></span>
        <p class="note-hint">Already have Node.js 20+? You can also run <code>npm install -g @bigstrider/transcodes-cli</code>.</p>
      </div>
    </div>

    <div class="panel" id="panel-windows" role="tabpanel" aria-labelledby="tab-windows" hidden>
      <ol>
        <li>Open PowerShell — press <kbd>Win</kbd> + <kbd>R</kbd>, type <strong>powershell</strong>, press <kbd>Enter</kbd>.</li>
        <li>
          Type this and press <kbd>Enter</kbd>:
          <span class="cmd"><code>transcodes</code><button type="button" class="copy" data-copy="transcodes">Copy</button></span>
        </li>
        <li>Leave the window open, then click <strong>Refresh</strong> below.</li>
      </ol>
      <div class="note">
        <p class="note-title">Says “command not found”?</p>
        <p class="note-lede">Install first — the script sets up Node.js if needed and runs <code>npm install -g @bigstrider/transcodes-cli</code>. When it finishes, run <code>transcodes</code> and refresh.</p>
        <span class="cmd"><code>Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install</code><button type="button" class="copy" data-copy="Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install">Copy</button></span>
        <p class="note-hint">Already have Node.js 20+? You can also run <code>npm install -g @bigstrider/transcodes-cli</code>.</p>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="refresh" onclick="location.reload()">Refresh</button>
      <span class="status" id="status">Checking every few seconds…</span>
    </div>
  </div>
  <script>
    function selectTab(name) {
      document.querySelectorAll(".tab").forEach(function (tab) {
        var on = tab.getAttribute("data-tab") === name;
        tab.setAttribute("aria-selected", on ? "true" : "false");
      });
      document.getElementById("panel-unix").hidden = name !== "unix";
      document.getElementById("panel-windows").hidden = name !== "windows";
    }

    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        selectTab(tab.getAttribute("data-tab"));
      });
    });

    selectTab((navigator.userAgent || "").indexOf("Win") !== -1 ? "windows" : "unix");

    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".copy");
      if (!btn) return;
      navigator.clipboard.writeText(btn.getAttribute("data-copy")).then(function () {
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = "Copy"; }, 1500);
      });
    });

    setInterval(function () {
      fetch("/health", { cache: "no-store" })
        .then(function (res) { if (res.ok) location.reload(); })
        .catch(function () {});
    }, 3000);
  </script>
</body>
</html>\`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.put(
        OFFLINE_URL,
        new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request).catch(async () => {
      const wantsHtml =
        request.mode === 'navigate' ||
        (request.headers.get('accept') || '').includes('text/html');
      if (!wantsHtml) {
        return new Response('', { status: 503, statusText: 'Offline' });
      }
      const cached = await caches.match(OFFLINE_URL);
      return (
        cached ||
        new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      );
    })
  );
});
`;
/**
 * Console org base — app deep-links:
 * - permissions: `/{oid}/project/{pid}?tab=permissions`
 * - webhooks:    `/{oid}/project/{pid}/settings?tab=webhooks`
 */
const APP_ORG_URL = 'https://app.transcodes.io/en/org';
/** Fallback when no MCP token / organization id is available. */
const APP_HOME_URL = 'https://app.transcodes.io';

const execFileAsync = promisify(execFile);

type TokenEntry = {
  /** Short fingerprint — used as the client-side id so full JWTs need not be
   *  echoed to the browser for select/delete. */
  id: string;
  label?: string;
  projectId?: string;
  organizationId?: string;
  expiresAt?: string;
  warnings?: string[];
  active: boolean;
};

type ActiveMemberInfo = {
  memberId?: string;
  projectId?: string;
  organizationId?: string;
  label?: string;
  name?: string;
  email?: string;
  role?: string;
  organizationName?: string;
  projectName?: string;
};

function payloadRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = (data as { payload?: unknown }).payload;
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
  return first as Record<string, unknown>;
}

async function fetchWorkspaceNames(
  config: StepupConfig,
): Promise<{ organizationName?: string; projectName?: string }> {
  const [orgEnv, projectEnv] = await Promise.all([
    request(config, {
      method: 'GET',
      path: `/organization/${encodeURIComponent(config.organizationId)}`,
    }),
    request(config, {
      method: 'GET',
      path: `/project/${encodeURIComponent(config.projectId)}`,
    }),
  ]);

  const organizationName = (() => {
    if (!orgEnv.ok) return undefined;
    const rec = payloadRecord(orgEnv.data);
    const name = typeof rec?.name === 'string' ? rec.name.trim() : '';
    return name || undefined;
  })();

  const projectName = (() => {
    if (!projectEnv.ok) return undefined;
    const rec = payloadRecord(projectEnv.data);
    const title = typeof rec?.title === 'string' ? rec.title.trim() : '';
    return title || undefined;
  })();

  return {
    ...(organizationName ? { organizationName } : {}),
    ...(projectName ? { projectName } : {}),
  };
}

type StatusPayload = {
  configPath: string;
  guardEnabled: boolean;
  tokens: TokenEntry[];
  activeMember: ActiveMemberInfo | null;
};

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function buildTokenEntries(): TokenEntry[] {
  const records = readTokenRecords();
  const active = readTokenFromFile();

  return records.map(({ token, label }) => {
    const entry: TokenEntry = {
      id: fingerprint(token),
      active: token === active,
    };
    if (label) entry.label = label;
    try {
      const parsed = parseMemberAccessToken(token);
      entry.projectId = parsed.claims.projectId;
      entry.organizationId = parsed.claims.organizationId;
      entry.expiresAt = new Date(parsed.claims.exp * 1000).toISOString();
      if (parsed.warnings.length > 0) entry.warnings = [...parsed.warnings];
    } catch (err) {
      entry.warnings = [err instanceof Error ? err.message : String(err)];
    }
    return entry;
  });
}

async function buildActiveMemberInfo(): Promise<ActiveMemberInfo | null> {
  const { token, source } = resolveToken();
  if (source === 'none' || !token) return null;

  let claims: ReturnType<typeof parseMemberAccessToken>['claims'];
  try {
    claims = parseMemberAccessToken(token).claims;
  } catch {
    return null;
  }

  const records = readTokenRecords();
  const active = readTokenFromFile();
  const label = records.find((r) => r.token === active)?.label;

  const base: ActiveMemberInfo = {
    memberId: claims.memberId,
    projectId: claims.projectId,
    organizationId: claims.organizationId,
    ...(label ? { label } : {}),
  };

  try {
    const config = loadStepupConfig();
    const [profile, workspace] = await Promise.all([
      fetchMemberProfile(config),
      fetchWorkspaceNames(config),
    ]);
    return {
      ...base,
      ...(profile ?? {}),
      ...workspace,
    };
  } catch {
    // Profile fetch is best-effort — JWT claims still populate the header.
  }

  return base;
}

async function buildStatus(): Promise<StatusPayload> {
  return {
    configPath: transcodesConfigFile(),
    guardEnabled: isGuardEnabled(),
    tokens: buildTokenEntries(),
    activeMember: await buildActiveMemberInfo(),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(JSON.stringify(body));
}

/** Max JSON body the dashboard accepts — persona markdown stays well under it. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (raw === '') {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        resolve(
          parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : {},
        );
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

const PERSONA_KINDS: readonly PersonaKind[] = ['agent', 'rule', 'skill'];

function parsePersonaKind(value: unknown): PersonaKind {
  if (
    typeof value === 'string' &&
    (PERSONA_KINDS as readonly string[]).includes(value)
  ) {
    return value as PersonaKind;
  }
  throw new Error(`Unknown persona kind: ${String(value)}`);
}

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcodes — CLI Dashboard</title>
  <meta name="theme-color" content="#16161a" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Transcodes" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" type="image/png" href="/icon-512.png" />
  <link rel="apple-touch-icon" href="/icon-512.png" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    :root {
      --bg: #f4f4f6;
      --card: #ffffff;
      --line: #ececf0;
      --ink: #16161a;
      --muted: #8a8a94;
      --accent: #5b54e6;
      --accent-soft: #eeedfb;
      --card-max: 894px;
      --text-2xs: 13px;
      --text-xs: 14px;
      --text-sm: 15px;
      --text-base: 16px;
      --text-md: 17px;
      --text-lg: 19px;
      --text-xl: 24px;
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: var(--text-base);
      line-height: 1.5;
      background: var(--bg);
      color: var(--ink);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 32px;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 100%;
      max-width: var(--card-max);
      background: var(--card);
      border-radius: 24px;
      padding: 40px 44px;
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.04), 0 12px 40px rgba(16, 16, 26, 0.06);
    }
    .header {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line);
    }
    .header-top {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header-top-actions {
      margin-left: auto;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-install-pwa {
      position: relative;
      z-index: 0;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 14px;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--ink);
      background: #fff;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      animation: install-pulse 2.4s ease-out infinite;
    }
    .btn-install-pwa::after {
      content: "";
      position: absolute;
      inset: -1px;
      border-radius: inherit;
      border: 1px solid rgba(91, 84, 230, 0.28);
      opacity: 0;
      pointer-events: none;
      z-index: -1;
      animation: install-pulse-ring 2.4s ease-out infinite;
    }
    .btn-install-pwa svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .btn-install-pwa:hover:not(:disabled) {
      border-color: #dcdce2;
      background: var(--accent-soft);
      color: var(--accent);
      animation-play-state: paused;
    }
    .btn-install-pwa:hover:not(:disabled)::after {
      animation-play-state: paused;
    }
    .btn-install-pwa:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      animation: none;
    }
    .btn-install-pwa:disabled::after {
      animation: none;
      opacity: 0;
    }
    @keyframes install-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(91, 84, 230, 0.18);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(91, 84, 230, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(91, 84, 230, 0);
      }
    }
    @keyframes install-pulse-ring {
      0% {
        transform: scale(1);
        opacity: 0.5;
      }
      70% {
        transform: scale(1.1);
        opacity: 0;
      }
      100% {
        transform: scale(1.1);
        opacity: 0;
      }
    }
    .btn-commands-open {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: #fff;
      color: var(--ink);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .btn-commands-open svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .btn-commands-open:hover {
      border-color: #dcdce2;
      background: var(--accent-soft);
      color: var(--accent);
    }
    .commands-modal {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .commands-modal[hidden] { display: none; }
    .commands-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgb(20 20 28 / 45%);
    }
    .commands-modal-panel {
      position: relative;
      z-index: 1;
      width: min(100%, 520px);
      max-height: min(85vh, 720px);
      overflow: auto;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 24px 64px rgb(20 20 28 / 18%);
      padding: 22px 20px 20px;
    }
    .commands-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .commands-modal-title {
      margin: 0;
      font-size: var(--text-lg);
      font-weight: 700;
      color: var(--ink);
      line-height: 1.3;
    }
    .commands-modal-close {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .commands-modal-close:hover {
      background: #f4f4f6;
      color: var(--ink);
    }
    .commands-modal-close svg {
      width: 18px;
      height: 18px;
    }
    .commands-modal .section-sub { margin-bottom: 14px; }
    .deploy-confirm-panel {
      width: min(100%, 460px);
      padding: 28px;
      overflow: visible;
    }
    .deploy-confirm-title {
      margin: 0;
      color: var(--ink);
      font-size: var(--text-lg);
      font-weight: 700;
      line-height: 1.35;
    }
    .deploy-confirm-copy {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: var(--text-sm);
      line-height: 1.55;
    }
    .deploy-confirm-copy strong { color: var(--ink); }
    .deploy-confirm-target {
      margin-top: 18px;
      padding: 13px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fafafd;
    }
    .deploy-confirm-target-label {
      display: block;
      margin-bottom: 5px;
      color: var(--muted);
      font-size: var(--text-2xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .deploy-confirm-target code {
      display: block;
      overflow-wrap: anywhere;
      color: var(--ink);
      font-size: var(--text-xs);
      line-height: 1.5;
    }
    .deploy-confirm-note {
      display: flex;
      gap: 8px;
      margin: 14px 0 0;
      color: var(--muted);
      font-size: var(--text-xs);
      line-height: 1.45;
    }
    .deploy-confirm-note svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .deploy-confirm-global {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-top: 16px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      cursor: pointer;
      color: var(--ink);
      font-size: var(--text-sm);
      line-height: 1.45;
      font-weight: 600;
    }
    .deploy-confirm-global input {
      margin-top: 2px;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .deploy-confirm-global-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .deploy-confirm-global-text small {
      color: var(--muted);
      font-size: var(--text-xs);
      font-weight: 500;
      line-height: 1.4;
    }
    .deploy-confirm-global-warn {
      color: #9a3412;
      background: #fff7ed;
      border: 1px solid #fdba74;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .deploy-confirm-global-warn[hidden],
    .deploy-confirm-note[hidden] {
      display: none !important;
    }
    .deploy-confirm-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 18px;
    }
    .deploy-confirm-actions button {
      min-height: 42px;
      border-radius: 10px;
      font-size: var(--text-sm);
      font-weight: 700;
      cursor: pointer;
    }
    .deploy-confirm-cancel {
      border: 1px solid var(--line);
      color: var(--ink);
      background: #fff;
    }
    .deploy-confirm-cancel:hover { background: #f7f7f9; }
    .deploy-confirm-submit {
      border: 1px solid var(--accent);
      color: #fff;
      background: var(--accent);
    }
    .deploy-confirm-submit:hover { opacity: 0.9; }
    .avatar {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      flex-shrink: 0;
      object-fit: contain;
      background: #f4f4f6;
      padding: 8px;
      display: block;
    }
    .header-logo-link {
      flex-shrink: 0;
      border-radius: 14px;
      line-height: 0;
      transition: opacity 0.15s ease, box-shadow 0.15s ease;
    }
    .header-logo-link:hover {
      opacity: 0.88;
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .header h1 {
      margin: 0;
      font-size: var(--text-xl);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header-title-link {
      color: inherit;
      text-decoration: none;
      transition: color 0.15s ease;
    }
    .header-title-link:hover {
      color: var(--accent);
    }
    .header-title-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 12px;
    }
    .header-tagline {
      margin: 6px 0 0;
      font-size: var(--text-sm);
      color: var(--muted);
    }
    .header-body { flex: 1; min-width: 0; }
    [hidden] { display: none !important; }
    .header-token-empty {
      margin: 0;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid #f5c6cb;
      background: #fdf0f0;
      color: #c0392f;
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.45;
    }
    .header-token-empty-title { margin: 0; }
    .header-token-empty-cmds {
      margin: 10px 0 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .header-token-empty-cmds code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-2xs);
      font-weight: 600;
      color: var(--accent);
      background: #fff;
      border: 1px solid #f5c6cb;
      padding: 3px 9px;
      border-radius: 7px;
    }
    .header-profile {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 12px;
    }
    .header-profile-info { min-width: 0; flex: 1; }
    .header-profile-btn {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      text-align: left;
      cursor: pointer;
      border-radius: 8px;
    }
    .header-profile-btn:hover .header-profile-name { color: var(--accent); }
    .header-profile-btn:hover .header-profile-chevron { color: var(--accent); }
    .header-profile-name {
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
      line-height: 1.35;
    }
    .header-profile-meta {
      margin-top: 4px;
      font-size: var(--text-xs);
      color: var(--muted);
      line-height: 1.45;
      word-break: break-word;
    }
    .header-profile-meta-line + .header-profile-meta-line { margin-top: 2px; }
    .header-profile-meta code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-2xs);
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line);
      padding: 1px 6px;
      border-radius: 6px;
    }
    .header-profile-chevron {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      color: var(--muted);
    }
    .profile-card {
      border-radius: 16px;
      border: 1px solid var(--line);
      background: var(--card);
      box-shadow: 0 1px 2px rgba(16, 16, 24, 0.04);
      overflow: hidden;
    }
    .profile-identity {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--line);
    }
    .profile-avatar {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: var(--text-base);
      font-weight: 700;
      text-transform: uppercase;
    }
    .profile-identity-body { min-width: 0; }
    .profile-identity-name {
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
      line-height: 1.35;
      word-break: break-all;
    }
    .profile-identity-sub {
      margin-top: 2px;
      font-size: var(--text-xs);
      color: var(--muted);
      line-height: 1.4;
    }
    .profile-fields { padding: 4px 20px; }
    .profile-field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
    }
    .profile-field:last-child { border-bottom: none; }
    .profile-field .k {
      flex-shrink: 0;
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--muted);
    }
    .profile-field .v {
      min-width: 0;
      font-size: var(--text-xs);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: var(--ink);
      text-align: right;
      word-break: break-all;
    }
    .profile-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 20px;
      border-top: 1px solid var(--line);
      background: #fbfbfc;
    }
    .profile-console-note {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--muted);
      line-height: 1.5;
    }
    .profile-actions-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .profile-actions-hint {
      margin: 0;
      font-size: var(--text-2xs);
      color: var(--muted);
    }
    .profile-actions-buttons { display: flex; gap: 8px; }
    .profile-empty {
      padding: 18px 20px;
      border-radius: 16px;
      border: 1px dashed var(--line);
      background: #fbfbfc;
      color: var(--muted);
      font-size: var(--text-sm);
      line-height: 1.45;
    }
    .btn-manage-auth,
    .btn-session-login {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      border-radius: 10px;
      padding: 10px 16px;
      font-size: var(--text-sm);
      font-weight: 600;
      color: #fff;
      background: var(--accent);
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    .btn-session-logout {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      border: none;
      border-radius: 8px;
      padding: 10px 10px;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--muted);
      background: transparent;
      cursor: pointer;
      transition: color 0.15s ease;
    }
    .btn-manage-auth svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    .btn-manage-auth:hover:not(:disabled),
    .btn-session-login:hover:not(:disabled) { opacity: 0.92; }
    .btn-session-logout:hover:not(:disabled) { color: var(--ink); }
    .btn-manage-auth:disabled,
    .btn-session-login:disabled,
    .btn-session-logout:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .header-action-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }
    .btn-manage-tokens {
      margin-left: auto;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      border-radius: 10px;
      padding: 10px 16px;
      font-size: var(--text-sm);
      font-weight: 600;
      color: #fff;
      background: var(--accent);
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    .btn-manage-tokens svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    .btn-manage-tokens:hover { opacity: 0.92; }
    .header-profile-actions {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .header-profile-cli-hint {
      margin: 0;
      font-size: var(--text-2xs);
      color: var(--muted);
      text-align: right;
      white-space: nowrap;
    }
    .cli-cmd,
    .header-profile-cli-hint code,
    .cli-map-row code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 6px;
      font-size: var(--text-2xs);
      font-weight: 600;
      border: none;
    }
    .header-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: var(--text-2xs);
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.2;
      color: var(--muted);
    }
    .header-status[data-online="false"] {
      color: #c0392f;
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
      box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.22);
    }
    .header-status[data-online="false"] .status-dot { display: none; }
    .status-offline-icon {
      display: none;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      color: #ef4444;
    }
    .header-status[data-online="false"] .status-offline-icon { display: block; }
    .tabs {
      display: flex;
      gap: 4px;
      margin-top: 22px;
      padding: 4px;
      background: #f4f4f6;
      border-radius: 13px;
    }
    .tab {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 14px;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--muted);
      background: transparent;
      border: none;
      border-radius: 9px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .tab-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    .tab:hover { color: var(--ink); }
    .tab.active {
      background: #fff;
      color: var(--ink);
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.08);
    }
    .panel { display: none; padding-top: 26px; }
    .panel.active { display: block; }
    .section-title {
      font-size: var(--text-lg);
      font-weight: 700;
      margin: 0 0 4px;
      letter-spacing: -0.01em;
    }
    .section-title--spaced {
      margin: 26px 0 4px;
    }
    .section-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 4px;
    }
    .section-title-row .section-title { margin: 0; }
    .section-title-row .guide-video-toggle { flex-shrink: 0; }
    .section-sub {
      font-size: var(--text-base);
      color: var(--muted);
      margin: 0 0 16px;
    }
    .section-sub a {
      color: var(--accent);
      font-weight: 600;
      text-decoration: none;
    }
    .section-sub a:hover { text-decoration: underline; }
    .cli-map-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 16px;
      font-size: var(--text-2xs);
      font-weight: 400;
      color: var(--muted);
    }
    .cli-map-row .cli-map-label {
      font-size: var(--text-sm);
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .cli-map-row .cli-map-label--title {
      font-size: var(--text-lg);
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.01em;
    }
    .cli-map-row .cli-map-label--danger {
      font-size: var(--text-sm);
      font-weight: 700;
      color: #c0392f;
    }
    .cli-map-row .cli-map-label--ink { color: var(--ink); }
    .cli-map-row--list {
      margin: 26px 0 10px;
    }
    .cli-map-row--section {
      margin: 0 0 4px;
    }
    .cli-map-row--danger {
      margin: 0;
    }
    textarea {
      width: 100%;
      min-height: 92px;
      padding: 14px 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-sm);
      line-height: 1.5;
      color: var(--ink);
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    textarea:focus {
      background: #fff;
      border-color: var(--accent);
      box-shadow: 0 0 0 4px rgba(91, 84, 230, 0.12);
    }
    textarea::placeholder { color: #b9b9c2; }
    .label-input {
      width: 100%;
      margin-top: 12px;
      padding: 12px 16px;
      font-size: var(--text-sm);
      color: var(--ink);
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .label-input:focus {
      background: #fff;
      border-color: var(--accent);
      box-shadow: 0 0 0 4px rgba(91, 84, 230, 0.12);
    }
    .label-input::placeholder { color: #b9b9c2; }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 18px;
    }
    .actions button {
      flex: 1;
      padding: 13px 18px;
      font-size: var(--text-md);
      font-weight: 600;
      border-radius: 14px;
      border: none;
      cursor: pointer;
      transition: background 0.15s, opacity 0.15s, transform 0.05s;
    }
    .actions button:active:not(:disabled) { transform: translateY(1px); }
    .actions button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #4a43d4; }
    .btn-secondary {
      background: #f4f4f6;
      color: #5a5a64;
    }
    .btn-secondary:hover:not(:disabled) { background: #ececf0; }
    .btn-inline-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      font-size: var(--text-2xs);
      font-weight: 600;
      color: var(--accent);
      background: var(--accent-soft);
      border: none;
      border-radius: 9px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn-inline-action:hover:not(:disabled) { background: #e3e1f7; }
    .btn-inline-action:disabled { opacity: 0.55; cursor: default; }
    .danger-zone {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 28px;
      padding: 18px 20px;
      border: 1px solid #f0d9d6;
      border-radius: 16px;
      background: #fdf6f5;
    }
    .danger-zone-desc {
      margin: 4px 0 0;
      font-size: var(--text-2xs);
      color: #8a8a94;
      line-height: 1.5;
    }
    .btn-danger {
      padding: 11px 22px;
      font-size: var(--text-sm);
      font-weight: 700;
      color: #fff;
      background: #c0392f;
      border: none;
      border-radius: 11px;
      cursor: pointer;
      transition: background 0.15s ease;
      white-space: nowrap;
    }
    .btn-danger:hover:not(:disabled) { background: #a52f26; }
    .btn-danger:disabled { opacity: 0.55; cursor: default; }
    .rbac-token-warning {
      margin: 0 0 18px;
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.5;
      color: #c0392f;
    }
    .guard-toggle-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin: 0 0 18px;
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--card);
    }
    .guard-toggle-title {
      margin: 0;
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
    }
    .guard-toggle-desc {
      margin: 4px 0 0;
      font-size: var(--text-2xs);
      line-height: 1.5;
      color: var(--muted);
    }
    .guard-switch {
      position: relative;
      display: inline-flex;
      flex: 0 0 auto;
      width: 48px;
      height: 28px;
      cursor: pointer;
    }
    .guard-switch input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
    .guard-switch-track {
      width: 100%;
      height: 100%;
      border-radius: 999px;
      background: #c8c8d0;
      transition: background 0.18s ease;
    }
    .guard-switch-track::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
      transition: transform 0.18s ease;
    }
    .guard-switch input:checked + .guard-switch-track {
      background: var(--accent);
    }
    .guard-switch input:checked + .guard-switch-track::after {
      transform: translateX(20px);
    }
    .guard-switch input:focus-visible + .guard-switch-track {
      outline: 3px solid rgba(91, 84, 230, 0.22);
      outline-offset: 2px;
    }
    .guard-switch input:disabled + .guard-switch-track {
      opacity: 0.55;
      cursor: wait;
    }
    .sub-tabs {
      margin-top: 0;
      margin-bottom: 22px;
    }
    .rbac-pane { display: none; }
    .rbac-pane.active { display: block; }
    .persona-registry {
      margin: 0 0 22px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--card);
    }
    .persona-registry-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .persona-root-help {
      margin: 0 0 12px;
      font-size: var(--text-2xs);
      line-height: 1.45;
      color: var(--muted);
    }
    .persona-registry-title {
      margin: 0;
      flex-shrink: 0;
      font-size: var(--text-xs);
      font-weight: 700;
      color: var(--ink);
    }
    .persona-root-input {
      flex: 1;
      min-width: 140px;
      margin: 0;
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--text-2xs);
    }
    .persona-root-hint {
      margin: 0 0 12px;
      font-size: var(--text-2xs);
      line-height: 1.45;
      color: var(--muted);
    }
    .persona-root-hint.error { color: #c0392f; }
    .persona-save-error {
      margin: 0 0 12px;
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.45;
      color: #c0392f;
    }
    .persona-save-error[hidden] { display: none !important; }
    .persona-deploy-error {
      margin: 12px 0 0;
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.45;
      color: #c0392f;
    }
    .persona-deploy-error[hidden] { display: none !important; }
    .persona-bundle-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0;
    }
    .persona-bundle-list {
      flex: 1;
      min-width: 160px;
    }
    .persona-bundle-row .persona-new-name {
      margin: 0;
      flex: 1;
      min-width: 160px;
    }
    .persona-workspace {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .persona-registry-body {
      min-width: 0;
    }
    .persona-editor-panel {
      min-width: 0;
    }
    .persona-editor-panel .sub-tabs {
      margin-bottom: 14px;
    }
    .persona-registry-actions {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }
    .persona-targets {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }
    .persona-targets-label {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: var(--text-2xs);
      font-weight: 700;
    }
    .persona-target-list {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .persona-target {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 28px;
      padding: 4px 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfbfc;
      color: var(--muted);
      font-size: var(--text-2xs);
      font-weight: 600;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s, color 0.15s;
      user-select: none;
    }
    .persona-target:has(input:checked) {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .persona-target-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      display: block;
    }
    .persona-target input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    @media (max-width: 600px) {
      .persona-target-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .persona-group + .persona-group { margin-top: 14px; }
    .persona-group-label {
      margin: 0 0 6px;
      font-size: var(--text-2xs);
      font-weight: 700;
      color: var(--muted);
    }
    .persona-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .persona-item {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fbfbfc;
      color: var(--ink);
      font-size: var(--text-2xs);
      font-weight: 600;
      overflow: hidden;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .persona-item-open {
      padding: 7px 10px 7px 12px;
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .persona-item:hover {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .persona-item.active {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    .persona-item-x {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 100%;
      min-height: 34px;
      padding: 0;
      border: none;
      border-left: 1px solid transparent;
      background: transparent;
      color: inherit;
      font-size: 20px;
      font-weight: 500;
      line-height: 1;
      opacity: 0.7;
      cursor: pointer;
    }
    .persona-item-x:hover {
      opacity: 1;
      background: rgba(192, 57, 47, 0.12);
      color: #c0392f;
    }
    .persona-item.active .persona-item-x:hover {
      background: rgba(255, 255, 255, 0.22);
      color: #fff;
    }
    .persona-empty {
      margin: 0;
      font-size: var(--text-2xs);
      color: var(--muted);
    }
    .persona-picker {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }
    .persona-template-row {
      margin: 0 0 12px;
    }
    .persona-template-select {
      width: 100%;
      margin: 0;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      padding-right: 40px;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23222228' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 14px center;
      background-size: 14px;
    }
    .persona-select,
    .persona-new-name {
      margin: 0;
      flex: 1;
      min-width: 180px;
      font-size: var(--text-xs);
    }
    .persona-select {
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      padding-right: 36px;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23222228' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 14px center;
      background-size: 14px;
    }
    .persona-about {
      margin: 0 0 14px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fbfbfc;
      font-size: var(--text-xs);
      line-height: 1.6;
      color: var(--muted);
    }
    .persona-about strong { color: var(--ink); }
    .persona-agent-callout {
      display: flex;
      gap: 12px;
      margin: 18px 0;
      padding: 16px;
      border: 1px solid rgba(91, 84, 230, 0.2);
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(91, 84, 230, 0.08), rgba(91, 84, 230, 0.03));
    }
    .persona-agent-callout-icon {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      color: var(--accent);
    }
    .persona-agent-callout-title {
      margin: 0 0 4px;
      color: var(--ink);
      font-size: var(--text-sm);
      font-weight: 700;
    }
    .persona-agent-callout-copy {
      margin: 0;
      color: var(--muted);
      font-size: var(--text-xs);
      line-height: 1.65;
    }
    .persona-agent-callout-copy + .persona-agent-callout-copy {
      margin-top: 6px;
    }
    .persona-agent-callout-copy strong { color: var(--ink); }
    .persona-agent-callout-copy code.cli-cmd { white-space: nowrap; }
    #panel-persona .guide-help { margin: 0 0 14px; }
    #panel-persona .guide-help-line { font-size: var(--text-xs); }
    .persona-path {
      margin: 0 0 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--text-2xs);
      color: var(--muted);
      word-break: break-all;
    }
    .persona-content-stats {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px 12px;
      margin: 0 2px 8px;
      font-size: var(--text-2xs);
      color: var(--muted);
    }
    .persona-content-count {
      color: var(--ink);
      font-weight: 700;
    }
    .persona-content-status {
      font-weight: 650;
    }
    .persona-editor {
      display: block;
      width: 100%;
      min-height: 340px;
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fbfbfc;
      color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--text-2xs);
      line-height: 1.65;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .persona-editor:focus {
      background: #fff;
      border-color: var(--accent);
      box-shadow: 0 0 0 4px rgba(91, 84, 230, 0.12);
    }
    .persona-actions { margin-top: 16px; }
    .persona-log-wrap {
      position: relative;
      margin-top: 12px;
    }
    .persona-log-wrap[hidden] { display: none !important; }
    .persona-log-close {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 1;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: rgb(255 255 255 / 10%);
      color: #c8c8d2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .persona-log-close:hover {
      background: rgb(255 255 255 / 18%);
      color: #fff;
    }
    .persona-log-close svg {
      width: 14px;
      height: 14px;
    }
    .persona-log {
      margin: 0;
      padding: 14px 36px 14px 16px;
      max-height: 220px;
      overflow: auto;
      border: 1px solid #2a2a32;
      border-radius: 14px;
      background: #16161a;
      color: #e7e7ee;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--text-2xs);
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .rbac-add-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 18px;
    }
    .rbac-add-row .label-input { flex: 1; min-width: 140px; margin: 0; }
    .rbac-add-row .btn-primary { flex-shrink: 0; }
    .rbac-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fbfbfc;
    }
    .rbac-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    .rbac-table th,
    .rbac-table td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
    }
    .rbac-table th {
      font-size: var(--text-2xs);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      background: #fff;
    }
    .rbac-table tr:last-child td { border-bottom: none; }
    .rbac-table code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-xs);
      background: #fff;
      border: 1px solid var(--line);
      padding: 2px 8px;
      border-radius: 6px;
    }
    .matrix-table th:not(:first-child),
    .matrix-table td:not(:first-child) { text-align: center; width: 72px; }
    .perm-cell {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      font-size: 20px;
      line-height: 1;
      border: none;
      background: transparent;
      font-weight: 400;
    }
    .perm-cell-0 { color: #9ca3af; }
    .perm-cell-1 { color: #2e7d32; }
    .perm-cell-2 { color: #ed6c02; }
    .role-picker {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 18px;
    }
    .role-chip {
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 999px;
      padding: 8px 14px;
      font-size: var(--text-sm);
      font-weight: 600;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .role-chip.active {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .matrix-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .btn-link-danger {
      border: none;
      background: transparent;
      color: #c0392f;
      font-size: var(--text-xs);
      font-weight: 600;
      cursor: pointer;
      padding: 4px 8px;
    }
    .btn-link-danger:hover { text-decoration: underline; }
    .list-label {
      margin: 26px 0 10px;
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
      letter-spacing: 0.01em;
    }
    .token-list { display: flex; flex-direction: column; gap: 10px; }
    .token-empty {
      padding: 16px 18px;
      background: #fbfbfc;
      border: 1px dashed var(--line);
      border-radius: 16px;
      font-size: var(--text-sm);
      color: var(--muted);
      text-align: center;
    }
    .token-row {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 16px;
      transition: border-color 0.15s, background 0.15s;
    }
    .token-row.active {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .token-top { display: flex; align-items: center; gap: 14px; }
    .radio {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid #d0d0d8;
      flex-shrink: 0;
      position: relative;
      transition: border-color 0.15s;
    }
    .token-row.active .radio { border-color: var(--accent); }
    .token-row.active .radio::after {
      content: "";
      position: absolute;
      inset: 3px;
      border-radius: 50%;
      background: var(--accent);
    }
    .token-info { flex: 1; min-width: 0; line-height: 1.45; }
    .token-info .label {
      font-size: var(--text-base);
      font-weight: 700;
      color: var(--ink);
      margin-bottom: 4px;
    }
    .token-info .field { font-size: var(--text-sm); color: #4a4a52; }
    .token-info .field .k { color: var(--muted); }
    .token-info .field code {
      font-size: var(--text-xs);
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line);
      padding: 1px 7px;
      border-radius: 6px;
    }
    .token-row.active .token-info .field code { background: #fff; }
    .token-info .warn { font-size: var(--text-xs); color: #c0392f; margin-top: 2px; }
    .token-info .tool-desc {
      font-size: var(--text-sm);
      color: #5a5a64;
      margin: 6px 0 8px;
      line-height: 1.45;
    }
    .rbac-legend {
      margin: 0 0 16px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid #e8e0ff;
      background: linear-gradient(180deg, #faf8ff 0%, #fff 100%);
    }
    .rbac-legend-title {
      margin: 0 0 10px;
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
    }
    .rbac-legend-levels {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
    }
    .rbac-legend-levels li {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: var(--text-xs);
      color: #5a5a64;
      line-height: 1.4;
    }
    .perm-cell-readonly { cursor: default; pointer-events: none; }
    .perm-legend-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      font-size: 18px;
      line-height: 1;
      flex-shrink: 0;
    }
    .perm-legend-0 { color: #9ca3af; }
    .perm-legend-1 { color: #2e7d32; }
    .perm-legend-2 { color: #ed6c02; }
    .field-status {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 10px;
    }
    .status-chip {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-xs);
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 6px;
      border: 1px solid;
      text-transform: lowercase;
      line-height: inherit;
      vertical-align: baseline;
    }
    .status-chip-active {
      color: #166534;
      border-color: #86efac;
      background: #f0fdf4;
    }
    .status-chip-inactive {
      color: #9f1239;
      border-color: #fda4af;
      background: #fff1f2;
    }
    .status-hint {
      font-size: var(--text-2xs);
      color: var(--muted);
      line-height: 1.45;
    }
    .admin-tools-count {
      font-size: var(--text-sm);
      color: var(--muted);
      margin: 0 0 14px;
    }
    .token-actions {
      display: flex;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }
    .token-row.active .token-actions { border-top-color: rgba(91, 84, 230, 0.18); }
    .token-actions button {
      flex: 1;
      padding: 9px 12px;
      font-size: var(--text-xs);
      font-weight: 600;
      letter-spacing: 0.03em;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #fff;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
    }
    .btn-set { color: var(--accent); }
    .btn-set:hover:not(:disabled) { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-set:disabled { opacity: 0.45; cursor: default; }
    .btn-del { color: #c0392f; }
    .btn-del:hover { background: #c0392f; color: #fff; border-color: #c0392f; }
    .btn-edit, .btn-cancel { color: #5a5a64; }
    .btn-edit:hover, .btn-cancel:hover { background: #ececf0; color: var(--ink); border-color: #dcdce2; }
    .label-edit {
      width: 100%;
      padding: 9px 12px;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--accent);
      border-radius: 9px;
      outline: none;
      box-shadow: 0 0 0 4px rgba(91, 84, 230, 0.12);
    }
    .pattern-edit-regex {
      margin-top: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-xs);
      font-weight: 500;
    }
    .policy-token-warning {
      margin: 0 0 18px;
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.5;
      color: #c0392f;
    }
    .sub-tabs {
      margin-top: 0;
      margin-bottom: 22px;
    }
    .policy-pane { display: none; }
    .policy-pane.active { display: block; }
    .usage {
      margin: 0 0 20px;
      padding: 16px 18px;
      background: var(--accent-soft);
      border: 1px solid rgba(91, 84, 230, 0.18);
      border-radius: 14px;
    }
    .usage-title {
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--accent);
      margin: 0 0 10px;
      letter-spacing: -0.01em;
    }
    .usage-steps {
      margin: 0;
      padding-left: 18px;
      font-size: var(--text-sm);
      color: #4a4a52;
      line-height: 1.6;
    }
    .usage-steps li { margin-bottom: 6px; }
    .usage-steps li:last-child { margin-bottom: 0; }
    .usage-steps code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-2xs);
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line);
      padding: 1px 6px;
      border-radius: 6px;
    }
    .usage-prompt {
      margin-top: 10px;
      padding: 10px 12px;
      background: #fff;
      border: 1px dashed rgba(91, 84, 230, 0.35);
      border-radius: 10px;
      font-size: var(--text-sm);
      color: var(--ink);
      line-height: 1.5;
    }
    .usage-prompt .q { color: var(--muted); font-style: italic; }
    .usage-example {
      display: inline-block;
      margin: 6px 0;
      padding: 4px 8px;
      background: rgba(91, 84, 230, 0.10);
      border-radius: 6px;
      color: var(--accent, #5b54e6);
      font-weight: 600;
    }
    .cmd-list { display: flex; flex-direction: column; gap: 10px; }
    .cmd {
      padding: 14px 16px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .cmd code {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-sm);
      color: var(--accent);
      background: var(--accent-soft);
      padding: 3px 9px;
      border-radius: 7px;
    }
    .cmd .cmd-desc {
      display: block;
      margin-top: 8px;
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.5;
    }
    .guide-list { display: flex; flex-direction: column; gap: 10px; }
    .guide-item {
      padding: 14px 16px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .guide-item .guide-tab {
      font-size: var(--text-base);
      font-weight: 700;
      color: var(--ink);
      margin-bottom: 6px;
    }
    .guide-item .guide-desc {
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.5;
      margin: 0;
    }
    .guide-video-wrap {
      margin: 0;
    }
    .guide-video-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid rgba(91, 84, 230, 0.35);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--accent);
      background: var(--accent-soft);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .guide-video-toggle:hover {
      background: #e3e1f7;
      border-color: rgba(91, 84, 230, 0.5);
    }
    /* Hide = secondary once the video is already open */
    .guide-video-toggle[aria-expanded="true"] {
      color: var(--ink);
      border-color: #16161a;
      background: #fff;
    }
    .guide-video-toggle[aria-expanded="true"]:hover {
      background: #f4f4f6;
      border-color: #16161a;
    }
    .guide-video {
      margin: 0 0 22px;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid var(--line);
      background: #000;
      aspect-ratio: 16 / 9;
      box-shadow: 0 8px 28px rgba(22, 22, 26, 0.08);
    }
    .guide-video[hidden] { display: none !important; }
    .guide-video mux-player {
      width: 100%;
      height: 100%;
      display: block;
      --media-accent-color: #5b54e6;
      --controls-backdrop-color: transparent;
      --media-control-background: transparent;
      --media-control-hover-background: rgb(0 0 0 / 25%);
    }
    /* Letterbox only — do not touch video or controls backdrop in normal view */
    .guide-video mux-player:fullscreen,
    .guide-video mux-player:-webkit-full-screen {
      --media-background-color: #f4f4f6;
      background: #f4f4f6;
    }
    .guide-steps {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .guide-groups {
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .guide-group-label {
      margin: 0 0 10px;
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
      letter-spacing: 0.01em;
    }
    a.guide-group-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      color: var(--ink);
    }
    a.guide-group-label:hover {
      color: var(--accent);
    }
    a.guide-group-label:hover .guide-group-link-icon {
      color: var(--accent);
    }
    .guide-group-link-icon {
      display: inline-flex;
      align-items: center;
      color: var(--muted);
      line-height: 0;
      transition: color 0.15s ease;
    }
    .guide-group--panel .guide-group-label { color: var(--accent); }
    .guide-group--agent .guide-group-label { color: #5a5a64; }
    .guide-step {
      display: flex;
      gap: 14px;
      padding: 14px 16px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .guide-step--accordion {
      display: block;
      padding: 0;
      overflow: hidden;
    }
    .guide-step-summary {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .guide-step-summary::-webkit-details-marker { display: none; }
    .guide-step-summary::marker { content: ''; }
    .guide-step-summary:hover { background: #f7f7f9; }
    .guide-step--accordion[open] .guide-step-summary {
      border-bottom: 1px solid var(--line);
    }
    .guide-step-chevron {
      margin-left: auto;
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      color: var(--muted);
      transition: transform 0.15s ease;
    }
    .guide-step--accordion[open] .guide-step-chevron {
      transform: rotate(180deg);
    }
    .guide-step-num {
      flex: 0 0 28px;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: var(--text-sm);
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .guide-step-body { min-width: 0; }
    .guide-step--accordion > .guide-step-body {
      padding: 12px 16px 14px 58px;
    }
    .guide-step-title {
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
      margin: 0 0 4px;
    }
    .guide-step-heading {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
    }
    .guide-step-summary .guide-step-title { margin: 0; }
    .guide-step-time {
      border: none;
      background: none;
      padding: 0;
      margin: 0;
      font-size: var(--text-xs);
      font-weight: 700;
      color: var(--accent);
      cursor: pointer;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }
    .guide-step-time:hover { text-decoration: underline; }
    .guide-step-desc {
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.5;
      margin: 0;
    }
    .guide-step-desc a,
    .guide-console-link {
      color: var(--accent);
      font-weight: 600;
      text-decoration: underline;
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      cursor: pointer;
    }
    .guide-step-desc a:hover,
    .guide-console-link:hover { opacity: 0.88; }
    .guide-step-desc code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-2xs);
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line);
      padding: 1px 6px;
      border-radius: 6px;
    }
    .guide-step-desc code.cli-cmd {
      color: var(--accent);
      background: var(--accent-soft);
      border: none;
      padding: 2px 8px;
      font-weight: 600;
    }
    .guide-step-opensource {
      margin: 10px 0 0;
    }
    .guide-opensource-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: var(--text-sm);
      color: var(--ink);
      text-decoration: none;
      font-weight: 500;
      line-height: 1.5;
    }
    .guide-opensource-link:hover .guide-opensource-accent {
      text-decoration: underline;
    }
    .guide-opensource-icon {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      color: var(--ink);
    }
    .guide-opensource-accent {
      color: var(--accent);
      font-weight: 600;
    }
    .guide-step-desc-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 12px;
    }
    .guide-step .toast {
      margin-top: 10px;
    }
    .guide-help {
      margin: 0 0 18px;
      padding: 0;
      background: var(--accent-soft);
      border: 1px solid rgba(91, 84, 230, 0.18);
      border-radius: 14px;
      overflow: hidden;
    }
    .guide-help-accordion { margin: 0; }
    .guide-help-summary {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .guide-help-summary::-webkit-details-marker { display: none; }
    .guide-help-summary::marker { content: ''; }
    .guide-help-summary:hover { background: rgba(91, 84, 230, 0.06); }
    .guide-help-summary .guide-help-heading {
      margin: 0;
      flex: 1;
      min-width: 0;
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
    }
    .guide-help-chevron {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      color: var(--muted);
      transition: transform 0.15s ease;
    }
    .guide-help-accordion[open] .guide-help-chevron {
      transform: rotate(180deg);
    }
    .guide-help-body {
      padding: 0 18px 16px;
      border-top: 1px solid rgba(91, 84, 230, 0.12);
    }
    .guide-help-line {
      margin: 12px 0 0;
      font-size: var(--text-sm);
      color: #4a4a52;
      line-height: 1.6;
    }
    .guide-help-line + .guide-help-line { margin-top: 6px; }
    .guide-help-line a {
      color: var(--accent);
      font-weight: 600;
      text-decoration: none;
    }
    .guide-help-line a:hover { text-decoration: underline; }
    .guide-help-line code.cli-cmd { white-space: nowrap; }
    .guide-help-heading {
      margin: 14px 0 0;
      font-size: var(--text-sm);
      font-weight: 600;
      color: #4a4a52;
      line-height: 1.6;
    }
    .guide-help-body > .guide-help-heading:first-child { margin-top: 12px; }
    .guide-help-list {
      margin: 6px 0 0;
      padding-left: 18px;
      font-size: var(--text-sm);
      color: #4a4a52;
      line-height: 1.55;
    }
    .guide-help-list li + li { margin-top: 4px; }
    .guide-help-list strong {
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-xs);
    }
    .guide-prefix-note {
      margin: 0 0 14px;
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.6;
    }
    .guide-prefix-note code.cli-cmd { white-space: nowrap; }
    .guide-help-examples {
      margin: 10px 0 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .guide-cmd-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .guide-cmd-hosts {
      font-size: var(--text-2xs);
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .guide-classify-list {
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .guide-classify-list li {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.5;
    }
    .guide-classify-prompt { color: var(--ink); }
    .guide-classify-arrow { color: var(--muted); }
    .guide-classify-note {
      margin: 10px 0 0;
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.55;
    }
    .guide-help-examples code.cli-cmd {
      display: block;
      width: fit-content;
      max-width: 100%;
      white-space: normal;
      word-break: break-word;
    }
    .guide-footer {
      margin: 20px 0 0;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    .guide-footer-line {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.6;
      word-break: break-word;
    }
    .guide-footer-line + .guide-footer-line { margin-top: 4px; }
    .guide-footer-line a {
      color: var(--accent);
      font-weight: 600;
      text-decoration: none;
    }
    .guide-footer-line a:hover { text-decoration: underline; }
    .toast-host {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
      max-width: min(360px, calc(100vw - 32px));
      pointer-events: none;
    }
    .toast-item {
      pointer-events: auto;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: var(--text-sm);
      font-weight: 500;
      line-height: 1.4;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
      opacity: 0;
      transform: translateX(12px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      word-break: break-word;
    }
    .toast-item.show {
      opacity: 1;
      transform: translateX(0);
    }
    .toast-item--success {
      background: #effaf2;
      color: #1a7f45;
      border: none;
    }
    .toast-item--error {
      background: #fdf0f0;
      color: #c0392f;
      border: none;
    }
    .toast {
      margin-top: 14px;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: var(--text-sm);
      font-weight: 500;
      display: none;
    }
    .toast.show { display: block; }
    .toast.success { background: #effaf2; color: #1a7f45; }
    .toast.error { background: #fdf0f0; color: #c0392f; }
    .hint {
      margin: 18px 0 0;
      font-size: var(--text-sm);
      color: var(--muted);
      text-align: center;
      line-height: 1.6;
    }
    .hint code {
      font-size: var(--text-2xs);
      background: #f4f4f6;
      padding: 2px 7px;
      border-radius: 6px;
      color: #8a8a94;
    }
    .dashboard-footer {
      width: 100%;
      max-width: var(--card-max);
      margin: 18px 0 0;
      padding: 0 8px 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
      font-size: var(--text-2xs);
      color: var(--muted);
      text-align: center;
      line-height: 1.6;
    }
    .dashboard-footer a {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--accent);
      font-weight: 600;
      text-decoration: none;
    }
    .dashboard-footer a:hover { text-decoration: underline; }
    .dashboard-footer-github-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }
  </style>
  <script type="module" src="https://cdn.jsdelivr.net/npm/@mux/mux-player"></script>
</head>
<body>
  <div id="toast-host" class="toast-host" aria-live="polite" aria-relevant="additions"></div>
  <div class="card">
    <div class="header">
      <div class="header-top">
        <a class="header-logo-link" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer" aria-label="Open Transcodes app">
          <img class="avatar" src="${LOGO_DATA_URI}" alt="Transcodes" />
        </a>
        <div class="header-body">
          <div class="header-title-row">
            <h1><a class="header-title-link" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer">Transcodes</a> CLI Dashboard</h1>
            <span class="header-status" id="header-network-status" data-online="true" aria-live="polite">
              <span class="status-dot" aria-hidden="true"></span>
              <svg class="status-offline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/></svg>
              <span class="status-label">Connected</span>
            </span>
          </div>
        </div>
        <div class="header-top-actions">
          <button type="button" class="btn-install-pwa" id="header-install-btn" hidden aria-label="Install Transcodes CLI Dashboard">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Install
          </button>
          <button type="button" class="btn-commands-open" id="header-commands-btn" aria-label="Open terminal commands" aria-haspopup="dialog" aria-controls="commands-modal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
          </button>
        </div>
      </div>
      <div class="header-profile" id="header-session">
        <div class="header-profile-info" id="header-signed-out">
          <div class="header-profile-name">Not signed in</div>
          <div class="header-profile-meta">Sign in with your browser to connect to Transcodes</div>
        </div>
        <button type="button" class="header-profile-btn" id="header-profile-btn" hidden aria-label="Open Profile">
          <div class="header-profile-info">
            <div class="header-profile-name" id="header-profile-name"></div>
            <div class="header-profile-meta" id="header-profile-meta"></div>
          </div>
          <svg class="header-profile-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
        <div class="header-profile-actions" id="header-login-actions">
          <div class="header-action-row">
            <button type="button" class="btn-session-login" id="header-login-btn" aria-label="Sign in with Transcodes">
              Login
            </button>
          </div>
          <p class="header-profile-cli-hint"><code>transcodes login</code></p>
        </div>
      </div>
    </div>
    <div class="tabs">
      <button type="button" class="tab active" data-tab="guideline">
        <svg class="tab-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" /></svg>
        Guide
      </button>
      <button type="button" class="tab" data-tab="persona">
        <svg class="tab-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" /></svg>
        Persona
      </button>
      <button type="button" class="tab" data-tab="tokens">
        <svg class="tab-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
        Profile
      </button>
      <button type="button" class="tab" data-tab="rbac">
        <svg class="tab-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>
        Permission
      </button>
    </div>

    <div class="panel active" id="panel-guideline">
      <div class="section-title-row">
        <p class="section-title">Getting started</p>
        <button type="button" class="guide-video-toggle" id="guide-video-toggle" aria-expanded="false" aria-controls="guide-video">
          Watch intro video
        </button>
      </div>
      <p class="section-sub">Set up Transcodes from this panel — no terminal required. New here? Start with the video.</p>
      <div class="guide-video-wrap">
        <div class="guide-video" id="guide-video" hidden>
          <mux-player
            id="guide-mux-player"
            playback-id="${GUIDELINE_MUX_PLAYBACK_ID}"
            stream-type="on-demand"
            accent-color="#5b54e6"
            primary-color="#ffffff"
            metadata-video-title="Transcodes getting started"
          ></mux-player>
        </div>
      </div>
      <p class="section-title section-title--spaced">Steps</p>
      <p class="guide-prefix-note">Start your message with <code class="cli-cmd">/transcodes</code> in Claude, Cursor, or Antigravity — use <code class="cli-cmd">$transcodes</code> in ChatGPT (Codex).</p>
      <div class="guide-groups">
        <section class="guide-group guide-group--panel">
          <ol class="guide-steps">
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">0</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">Define AI Agent Persona</span>
                    <button type="button" class="guide-step-time" data-seek="25" aria-label="Jump to video at 0:25">0:25</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Just like giving a new hire an onboarding team manual (company, job descriptions, team rule, tech specs), providing your AI with a strict persona—an employee profile combining <code class="cli-cmd">instruction</code>, <code class="cli-cmd">rules</code>, and <code class="cli-cmd">skills</code>—will drastically improve its output. It reduces wasted tokens, improves the quality and consistency of the output you want, and reduces hallucinations.</p> <br />
                  <p class="guide-step-desc">Quickest path: ask your AI agent with <code class="cli-cmd">/transcodes create a persona</code> in Claude, Cursor, or Antigravity — or <code class="cli-cmd">$transcodes create a persona</code> in ChatGPT (Codex). To apply an existing Persona, type <code class="cli-cmd">/transcodes apply a persona</code> or <code class="cli-cmd">$transcodes apply a persona</code>. If you do not specify a project path, it uses This device (Global) by default so the Persona is available in every project and session for the selected apps. Or open the <button type="button" class="guide-console-link" data-open-tab="persona">Persona</button> tab to create, review, and apply manually.</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">1</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">After signing in, add biometrics or passkeys</span>
                    <button type="button" class="guide-step-time" data-seek="220" aria-label="Jump to video at 3:40">3:40</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">After signing in, open the <strong>Profile</strong> tab and click <button type="button" class="guide-console-link" data-console-open>Console</button> (or run <code class="cli-cmd">transcodes console</code>), then add biometrics or passkeys — used when Transcodes asks for an extra security check</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">2</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">Set permissions in the Transcodes app</span>
                    <button type="button" class="guide-step-time" data-seek="260" aria-label="Jump to video at 4:20">4:20</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Decide who can do what — resources, actions, and roles — in the <a href="${APP_ORG_URL}" data-app-tab="permissions" target="_blank" rel="noopener noreferrer">Transcodes app</a>. You can review those permissions (view only) in this panel's <strong>Permission</strong> tab</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">3</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">(Demo) Open your AI app and try a security check</span>
                    <button type="button" class="guide-step-time" data-seek="290" aria-label="Jump to video at 4:50">4:50</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Open Claude, Cursor, Antigravity, or ChatGPT. If the app is already open, restart it so your latest sign-in is picked up.</p>
                  <p class="guide-step-desc">Ask the AI to run a protected action — you should be asked to confirm with a passkey or biometrics</p>
                  <div class="guide-help-examples">
                    <div class="guide-cmd-row">
                      <span class="guide-cmd-hosts">Claude · Cursor · Antigravity</span>
                      <code class="cli-cmd">/transcodes open step-up authentication for testing</code>
                    </div>
                    <div class="guide-cmd-row">
                      <span class="guide-cmd-hosts">ChatGPT (Codex)</span>
                      <code class="cli-cmd">$transcodes open step-up authentication for testing</code>
                    </div>
                  </div>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">4</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">Ask the AI to do something</span>
                    <button type="button" class="guide-step-time" data-seek="355" aria-label="Jump to video at 5:55">5:55</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">When you ask the AI to act, Transcodes checks your permissions: <strong>blocked</strong>, <strong>allowed</strong>, or <strong>needs extra confirmation</strong> (passkey / biometrics).</p>
                  <ul class="guide-classify-list">
                    <li><span class="guide-classify-prompt">"Create a Google Calendar event"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">google:create</code></li>
                    <li><span class="guide-classify-prompt">"Change James's role in Transcodes"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">transcodes:update</code></li>
                    <li><span class="guide-classify-prompt">"Delete files on my computer"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">system:delete</code></li>
                  </ul>
                  <p class="guide-classify-note">If there's no matching resource, Transcodes uses <code class="cli-cmd">system</code> — e.g. without a <code>google</code> resource, that calendar request becomes <code class="cli-cmd">system:create</code>.</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">5</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">Get notifications on channels</span>
                    <button type="button" class="guide-step-time" data-seek="396" aria-label="Jump to video at 6:36">6:36</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">If you want to get notifications, open <a href="${APP_ORG_URL}/settings" data-app-tab="webhooks" target="_blank" rel="noopener noreferrer">Transcodes Settings</a>, connect channels. (More channels coming soon.)</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">6</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">View activity histories / security log</span>
                    <button type="button" class="guide-step-time" data-seek="420" aria-label="Jump to video at 7:00">7:00</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Ask the AI for an activity histories / security log report — Transcodes applies your permissions and shows what happened</p>
                  <p class="guide-step-desc">Every action is recorded: blocked, allowed, or confirmed with an extra security check.</p>
                  <div class="guide-help-examples">
                    <div class="guide-cmd-row">
                      <span class="guide-cmd-hosts">Claude · Cursor · Antigravity</span>
                      <code class="cli-cmd">/transcodes show audit logs report</code>
                    </div>
                    <div class="guide-cmd-row">
                      <span class="guide-cmd-hosts">ChatGPT (Codex)</span>
                      <code class="cli-cmd">$transcodes show audit logs report</code>
                    </div>
                  </div>
                </div>
              </details>
            </li>
          </ol>
        </section>
      </div>
      <div class="guide-footer">
        <p class="guide-footer-line">Questions or trouble setting up? <a href="https://www.transcodes.io/booking" target="_blank" rel="noopener noreferrer">https://www.transcodes.io/booking</a></p>
        <p class="guide-footer-line">Full documentation: <a href="https://www.transcodes.io/docs" target="_blank" rel="noopener noreferrer">https://www.transcodes.io/docs</a></p>
      </div>
    </div>

    <div class="panel" id="panel-tokens">
      <p class="cli-map-row cli-map-row--section">
        <span class="cli-map-label cli-map-label--title">Profile</span>
        <code>transcodes login</code>
      </p>
      <p class="section-sub">Your sign-in on this computer. To switch organization, log out and sign in again.</p>
      <div id="profile-empty" class="profile-empty" hidden>
        Not signed in — use <strong>Login</strong> in the header (or run <code>transcodes login</code>).
      </div>
      <div id="profile-card" class="profile-card" hidden>
        <div class="profile-identity">
          <div class="profile-avatar" id="profile-avatar" aria-hidden="true"></div>
          <div class="profile-identity-body">
            <div class="profile-identity-name" id="profile-email"></div>
            <div class="profile-identity-sub" id="profile-workspace"></div>
          </div>
        </div>
        <div class="profile-fields">
          <div class="profile-field" id="profile-row-org-name" hidden>
            <span class="k">Organization</span>
            <span class="v" id="profile-org-name"></span>
          </div>
          <div class="profile-field" id="profile-row-org-id" hidden>
            <span class="k">Organization ID</span>
            <span class="v" id="profile-org-id"></span>
          </div>
          <div class="profile-field" id="profile-row-project-name" hidden>
            <span class="k">Project</span>
            <span class="v" id="profile-project-name"></span>
          </div>
          <div class="profile-field" id="profile-row-project-id" hidden>
            <span class="k">Project ID</span>
            <span class="v" id="profile-project-id"></span>
          </div>
        </div>
        <div class="profile-actions">
          <p class="profile-console-note">Register a passkey, hardware security key, or OTP in <strong>Console</strong> so you can confirm risky actions when Transcodes asks for an extra security check.</p>
          <div class="profile-actions-row">
            <p class="profile-actions-hint"><code>transcodes console</code> · <code>transcodes logout</code></p>
            <div class="profile-actions-buttons">
              <button type="button" class="btn-manage-auth" id="manage-auth-btn" data-console-open aria-label="Open Transcodes security settings">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33" />
                </svg>
                Console
              </button>
              <button type="button" class="btn-session-logout" id="header-logout-btn" aria-label="Sign out on this computer">
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
      <p class="hint">Read the <strong>Guide</strong> tab first if you're new.<br />Stop this panel in the background with <code>transcodes stop</code>.</p>
    </div>

    <div class="panel" id="panel-persona">
      <p class="section-title">Persona</p>
      <div class="guide-help">
        <details class="guide-help-accordion">
          <summary class="guide-help-summary">
            <span class="guide-help-heading">What is a Persona?</span>
            <svg class="guide-help-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="guide-help-body">
            <p class="guide-help-line">Think of a Persona as an onboarding manual that helps an AI agent understand its role, follow your workflow, and produce more reliable results. By defining one, you can reduce token usage, minimize hallucinations, and significantly boost productivity.</p>
            <p class="guide-help-line"><strong>Instruction</strong> (<code class="cli-cmd">AGENTS.md</code>, <code class="cli-cmd">CLAUDE.md</code>) is the job description and company orientation: the agent's role, team, organization, and service.</p>
            <p class="guide-help-line"><strong>Rules</strong> (<code class="cli-cmd">rule.md</code>) are workplace policies and guardrails (Must / Never). Create one focused Rule file per policy topic — for example security, quality, or design-system. Do not put step-by-step workflows in Rules.</p>
            <p class="guide-help-line"><strong>Skills</strong> (<code class="cli-cmd">SKILL.md</code>) are task playbooks: how to perform one specific workflow and what the output should look like. Create one Skill file per workflow — for example research, PRD writing, or design-to-code. Do not put standing policies in Skills.</p>
            <p class="guide-help-line">Keep Rules and Skills separate so each file has one clear job. Or create and edit a Persona manually below. Select a Persona and project folder, then apply the complete onboarding kit.</p>
          </div>
        </details>
      </div>
      <div class="persona-agent-callout">
        <svg class="persona-agent-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.2 3.4a5.8 5.8 0 0 1-3.4 3.4L4 11l3.4 1.2a5.8 5.8 0 0 1 3.4 3.4L12 19l1.2-3.4a5.8 5.8 0 0 1 3.4-3.4L20 11l-3.4-1.2a5.8 5.8 0 0 1-3.4-3.4L12 3Z"/><path d="m19 3-.4 1.1a1.8 1.8 0 0 1-1.1 1.1l-1.1.4 1.1.4a1.8 1.8 0 0 1 1.1 1.1L19 8.2l.4-1.1A1.8 1.8 0 0 1 20.5 6l1.1-.4-1.1-.4a1.8 1.8 0 0 1-1.1-1.1L19 3Z"/></svg>
        <div>
          <p class="persona-agent-callout-title">Create with your AI agent</p>
          <p class="persona-agent-callout-copy">Type <code class="cli-cmd">/transcodes create a persona</code> in Claude, Cursor, or Antigravity — or <code class="cli-cmd">$transcodes create a persona</code> in ChatGPT (Codex). To apply an existing Persona, type <code class="cli-cmd">/transcodes apply a persona</code> or <code class="cli-cmd">$transcodes apply a persona</code>. If you do not specify a project path, it uses This device (Global) by default so the Persona is available in every project and session for the selected apps. Application always runs after your confirmation.</p>
        </div>
      </div>

      <div class="persona-registry">
        <div class="persona-registry-head">
          <input type="text" id="persona-root-input" class="label-input persona-root-input" placeholder="Project folder path" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Project folder path" />
          <button type="button" class="btn-inline-action" id="persona-change-btn" title="Choose a project folder">
            Change Directory
          </button>
          <button type="button" class="btn-inline-action" id="persona-open-btn" title="Open this project folder">
            Open
          </button>
        </div>
        <p class="persona-root-help">
          To deploy globally, choose the option in the Apply confirmation dialog
        </p>
        <div class="persona-bundle-row">
          <ul id="persona-bundle-list" class="persona-list persona-bundle-list" aria-label="Personas"></ul>
          <input type="text" id="persona-bundle-name" class="label-input persona-new-name" placeholder="persona-name" spellcheck="false" autocapitalize="off" autocomplete="off" hidden />
          <button type="button" class="btn-inline-action" id="persona-bundle-new-btn">New Persona</button>
          <button type="button" class="btn-inline-action" id="persona-bundle-cancel-btn" hidden>Cancel</button>
          <button type="button" class="btn-inline-action" id="persona-bundle-create-btn" hidden>Create</button>
        </div>
        <p class="persona-root-hint" id="persona-root-hint"></p>
        <div class="persona-workspace">
          <div class="persona-registry-body" id="persona-registry-body" hidden></div>
          <div class="persona-editor-panel">
            <div class="tabs sub-tabs" role="tablist" aria-label="Persona section">
              <button type="button" class="tab active" data-persona="agent" role="tab">Instruction</button>
              <button type="button" class="tab" data-persona="rule" role="tab">Rule</button>
              <button type="button" class="tab" data-persona="skill" role="tab">Skill</button>
            </div>

            <p class="persona-about" id="persona-about"></p>

            <div class="persona-picker" id="persona-picker" hidden>
              <select id="persona-name-select" class="label-input persona-select" aria-label="Select a file"></select>
              <input type="text" id="persona-new-name" class="label-input persona-new-name" placeholder="Please type a new rule title" spellcheck="false" autocapitalize="off" autocomplete="off" hidden />
            </div>
            <p class="persona-save-error" id="persona-save-error" hidden></p>

            <p class="persona-path" id="persona-path"></p>
            <div class="persona-template-row" id="persona-template-row" hidden>
              <select id="persona-template-select" class="label-input persona-template-select" aria-label="Choose a template">
                <option value="">Choose a template…</option>
                <option value="general">General</option>
              </select>
            </div>
            <div class="persona-content-stats" id="persona-content-stats" aria-live="polite">
              <span class="persona-content-count" id="persona-content-count">≈ 0 tokens · 0 words</span>
              <span class="persona-content-status" id="persona-content-status"></span>
            </div>
            <textarea id="persona-editor" class="persona-editor" spellcheck="false" placeholder="Loading…"></textarea>

            <div class="actions persona-actions">
              <button type="button" class="btn-primary" id="persona-save-btn">Save</button>
              <button type="button" class="btn-danger" id="persona-delete-btn" hidden>Delete</button>
            </div>
            <p class="hint"><strong>Save</strong> updates the selected Persona only. Use <strong>Apply</strong> below to apply that Persona's Instruction, Rules, and Skills to the selected project.</p>
          </div>
        </div>
        <div class="persona-targets">
          <p class="persona-targets-label">Apply to</p>
          <div class="persona-target-list" id="persona-target-list">
            <label class="persona-target">
              <input type="checkbox" name="persona-target" value="claudecode" data-target-label="Claude" checked />
              <svg class="persona-target-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#D97757" stroke-width="2.6" stroke-linecap="round"><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5M5.3 5.3l3.5 3.5M15.2 15.2l3.5 3.5M18.7 5.3l-3.5 3.5M8.8 15.2l-3.5 3.5"/></svg>
              <span>Claude</span>
            </label>
            <label class="persona-target">
              <input type="checkbox" name="persona-target" value="cursor" data-target-label="Cursor" checked />
              <svg class="persona-target-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M5.1 3.2 19 11.15c.85.48.72 1.72-.2 2l-5.35 1.85-1.85 5.35c-.28.9-1.55 1-2 .15L5.1 5.55c-.4-.78.28-1.65 1.1-1.35Z"/></svg>
              <span>Cursor</span>
            </label>
            <label class="persona-target">
              <input type="checkbox" name="persona-target" value="codexcli" data-target-label="ChatGPT" checked />
              <svg class="persona-target-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.096 5.98 5.98 0 0 0 .511 4.911 6.046 6.046 0 0 0 6.511 2.9A5.985 5.985 0 0 0 13.02 23.4a6.065 6.065 0 0 0 5.269-2.9 5.985 5.985 0 0 0 3.998-2.9 6.046 6.046 0 0 0-.748-7.097zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.041l.142-.08 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494zm-9.661-4.125a4.471 4.471 0 0 1-.535-3.014l.142.085 4.783 2.758a.771.771 0 0 0 .781 0l5.843-3.368v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.499 4.499 0 0 1-6.141-1.646zM2.341 7.896a4.485 4.485 0 0 1 2.365-1.972V11.6a.766.766 0 0 0 .388.676l5.814 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.413 3.856L13.006 8.37l2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.104v-5.677a.79.79 0 0 0-.407-.667zm2.011-3.023-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.499 4.499 0 0 1 6.68 4.66zM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.074a4.499 4.499 0 0 1 7.376-3.454l-.142.081L8.704 5.459a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
              <span>ChatGPT</span>
            </label>
            <label class="persona-target">
              <input type="checkbox" name="persona-target" value="antigravity-ide" data-target-label="Antigravity (Google)" checked />
              <svg class="persona-target-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62Z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"/></svg>
              <span>Antigravity</span>
            </label>
          </div>
        </div>
        <p class="persona-deploy-error" id="persona-deploy-error" hidden></p>
        <div class="actions persona-registry-actions">
          <button type="button" class="btn-primary" id="persona-deploy-btn" title="Apply the selected Persona to this folder">
            Apply
          </button>
        </div>
        <div class="persona-log-wrap" id="persona-log-wrap" hidden>
          <button type="button" class="persona-log-close" id="persona-log-close" aria-label="Close apply log">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
          <pre class="persona-log" id="persona-log"></pre>
        </div>
      </div>
    </div>

    <div class="panel" id="panel-rbac">
      <p id="rbac-token-warning" class="rbac-token-warning" hidden>Sign in first (Login in the header, or open Profile)</p>
      <div class="guide-help">
        <details class="guide-help-accordion">
          <summary class="guide-help-summary">
            <span class="guide-help-heading">How it works</span>
            <svg class="guide-help-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="guide-help-body">
            <p class="guide-help-line">When you ask an AI app to do something, Transcodes checks your permissions: <strong>blocked</strong>, <strong>allowed</strong>, or <strong>needs extra confirmation</strong> (passkey / biometrics).</p>
            <p class="guide-help-line"><strong>When Permission checks are Off:</strong> step-up authentication and permission evaluation are skipped, and tool calls are not recorded in Transcodes Log History.</p>
            <p class="guide-help-line"><strong>Resources</strong> are matched by name and description. If nothing matches, Transcodes uses <code class="cli-cmd">system</code>. Write a clear description of what each resource covers so matching works well.</p>
            <p class="guide-help-heading">Action types</p>
            <ul class="guide-help-list">
              <li><strong>WRITE</strong> — make something new (or send / post / upload)</li>
              <li><strong>READ</strong> — look at information without changing it</li>
              <li><strong>EDIT</strong> — change something that already exists</li>
              <li><strong>DELETE</strong> — remove something (or other hard-to-undo changes)</li>
            </ul>
            <p class="guide-help-heading">Examples</p>
            <ul class="guide-classify-list">
              <li><span class="guide-classify-prompt">"Create a Google Calendar event"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">google:create</code> <span class="guide-classify-arrow">if <code>google</code> is set up</span> · otherwise <code class="cli-cmd">system:create</code></li>
              <li><span class="guide-classify-prompt">"Post a message to #eng on Slack"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">slack:create</code> <span class="guide-classify-arrow">if <code>slack</code> is set up</span> · otherwise <code class="cli-cmd">system:create</code></li>
              <li><span class="guide-classify-prompt">"Change James's role in Transcodes"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">transcodes:update</code></li>
              <li><span class="guide-classify-prompt">"Remove a Transcodes member"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">transcodes:delete</code></li>
              <li><span class="guide-classify-prompt">"Push this branch to GitHub"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">github:update</code> <span class="guide-classify-arrow">if <code>github</code> is set up</span> · otherwise <code class="cli-cmd">system:update</code></li>
              <li><span class="guide-classify-prompt">"Delete files on my computer"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">system:delete</code></li>
              <li><span class="guide-classify-prompt">"Show my .env file" / "read my SSH key"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">system:update</code></li>
            </ul>
            <p class="guide-classify-note">Only resources you've set up are matched by name. If there's no <code>google</code> / <code>slack</code> / <code>github</code> resource, that request uses <code class="cli-cmd">system</code> instead.</p>
          </div>
        </details>
      </div>
      <div class="guard-toggle-card">
        <div>
          <p class="guard-toggle-title">Permission checks</p>
          <p class="guard-toggle-desc" id="guard-toggle-desc">Loading guard status…</p>
        </div>
        <label class="guard-switch" title="Off skips step-up authentication, permission checks, and Transcodes Log History">
          <input type="checkbox" id="guard-enabled-toggle" aria-label="Enable Transcodes permission checks" />
          <span class="guard-switch-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="rbac-legend">
        <p class="rbac-legend-title">What the symbols mean</p>
        <ul class="rbac-legend-levels">
          <li><span class="perm-legend-icon perm-legend-0" aria-hidden="true">○</span> No access — the action does not run</li>
          <li><span class="perm-legend-icon perm-legend-1" aria-hidden="true">●</span> Allowed — runs right away</li>
          <li><span class="perm-legend-icon perm-legend-2" aria-hidden="true">◉</span> Extra confirmation — passkey or biometrics required first</li>
        </ul>
      </div>
      <div class="tabs sub-tabs" role="tablist" aria-label="Permission section">
        <button type="button" class="tab active" data-rbac="resources" role="tab">Resources</button>
        <button type="button" class="tab" data-rbac="roles" role="tab">Roles</button>
      </div>
      <div class="rbac-pane active" id="rbac-pane-resources">
        <p class="section-sub">View resources covered by your permissions. <a href="${APP_ORG_URL}" data-app-tab="permissions" target="_blank" rel="noopener noreferrer">Edit Permissions / Access Policy</a></p>
        <div class="rbac-table-wrap">
          <table class="rbac-table" id="resources-table">
            <thead><tr><th>Resource</th><th>Description</th></tr></thead>
            <tbody id="resources-tbody"></tbody>
          </table>
        </div>
      </div>
      <div class="rbac-pane" id="rbac-pane-roles">
        <p class="section-sub">Pick a role to see what it can do · <a href="${APP_ORG_URL}" data-app-tab="permissions" target="_blank" rel="noopener noreferrer">Edit Permissions / Access Policy</a></p>
        <div class="role-picker" id="role-picker"></div>
        <div id="matrix-wrap" hidden>
          <p class="list-label" id="matrix-role-label"></p>
          <div class="rbac-table-wrap">
            <table class="rbac-table matrix-table" id="matrix-table">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>WRITE</th>
                  <th>READ</th>
                  <th>EDIT</th>
                  <th>DELETE</th>
                </tr>
              </thead>
              <tbody id="matrix-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
      <div id="rbac-toast" class="toast"></div>
    </div>
  </div>

  <div class="commands-modal" id="commands-modal" hidden>
    <div class="commands-modal-backdrop" data-commands-close tabindex="-1" aria-hidden="true"></div>
    <div class="commands-modal-panel" role="dialog" aria-modal="true" aria-labelledby="commands-modal-title">
      <div class="commands-modal-header">
        <h2 class="commands-modal-title" id="commands-modal-title">Commands</h2>
        <button type="button" class="commands-modal-close" data-commands-close aria-label="Close commands">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <p class="section-sub">Optional terminal commands — this panel covers the same actions with buttons</p>
      <div class="cmd-list">
        ${renderCliCommandsHtml()}
      </div>
    </div>
  </div>

  <div class="commands-modal" id="deploy-confirm-modal" hidden>
    <div class="commands-modal-backdrop" data-deploy-confirm="cancel" tabindex="-1" aria-hidden="true"></div>
    <div class="commands-modal-panel deploy-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="deploy-confirm-title" aria-describedby="deploy-confirm-description">
      <h2 class="deploy-confirm-title" id="deploy-confirm-title">Apply Persona?</h2>
      <p class="deploy-confirm-copy" id="deploy-confirm-description">
        Persona <strong id="deploy-confirm-persona"></strong> will be applied to <strong id="deploy-confirm-targets"></strong>.
      </p>
      <div class="deploy-confirm-target" id="deploy-confirm-target-wrap">
        <span class="deploy-confirm-target-label" id="deploy-confirm-target-label">Target directory</span>
        <code id="deploy-confirm-root"></code>
      </div>
      <p class="deploy-confirm-note" id="deploy-confirm-project-note">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
        Existing generated agent files in this directory will be replaced
      </p>
      <label class="deploy-confirm-global" for="deploy-confirm-global">
        <input type="checkbox" id="deploy-confirm-global" />
        <span class="deploy-confirm-global-text">
          <span>Deploy globally on this device</span>
          <small>Writes user-scope config under your home directory (Claude, ChatGPT, Antigravity)</small>
        </span>
      </label>
      <p class="deploy-confirm-note deploy-confirm-global-warn" id="deploy-confirm-global-warn" hidden>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
        <span id="deploy-confirm-global-warn-text">Global apply replaces user-scope agent files under your home directory for every project and session. Cursor is project-only and will be skipped</span>
      </p>
      <div class="deploy-confirm-actions">
        <button type="button" class="deploy-confirm-cancel" data-deploy-confirm="cancel">Cancel</button>
        <button type="button" class="deploy-confirm-submit" data-deploy-confirm="confirm" id="deploy-confirm-submit">Apply Persona</button>
      </div>
    </div>
  </div>

  <p class="dashboard-footer">
    Ver ${CLI_VERSION} <code class="cli-cmd">transcodes version</code>
    <span aria-hidden="true">·</span>
    <a href="${TRANSCODES_GUARD_REPO_URL}" target="_blank" rel="noopener noreferrer">
      <svg class="dashboard-footer-github-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
      GitHub
    </a>
  </p>
  <script>
    const toastHost = document.getElementById("toast-host");

    function showToast(msg, kind) {
      const host = toastHost || document.getElementById("toast-host");
      if (!host || !msg) return;
      const el = document.createElement("div");
      el.className = "toast-item toast-item--" + (kind || "success");
      el.setAttribute("role", kind === "error" ? "alert" : "status");
      el.textContent = String(msg);
      host.appendChild(el);
      requestAnimationFrame(() => {
        el.classList.add("show");
      });
      setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 200);
      }, 4000);
    }

    const profileEmptyEl = document.getElementById("profile-empty");
    const profileCardEl = document.getElementById("profile-card");
    const profileEmailEl = document.getElementById("profile-email");
    const profileAvatarEl = document.getElementById("profile-avatar");
    const profileWorkspaceEl = document.getElementById("profile-workspace");
    const headerSignedOutEl = document.getElementById("header-signed-out");
    const headerProfileBtn = document.getElementById("header-profile-btn");
    const headerProfileNameEl = document.getElementById("header-profile-name");
    const headerProfileMetaEl = document.getElementById("header-profile-meta");
    const headerLoginActionsEl = document.getElementById("header-login-actions");
    const headerLoginBtn = document.getElementById("header-login-btn");
    const headerLogoutBtn = document.getElementById("header-logout-btn");
    const headerInstallBtn = document.getElementById("header-install-btn");
    const headerCommandsBtn = document.getElementById("header-commands-btn");
    const commandsModal = document.getElementById("commands-modal");
    const deployConfirmModal = document.getElementById("deploy-confirm-modal");
    const deployConfirmPersona = document.getElementById("deploy-confirm-persona");
    const deployConfirmTargets = document.getElementById("deploy-confirm-targets");
    const deployConfirmRoot = document.getElementById("deploy-confirm-root");
    const deployConfirmGlobal = document.getElementById("deploy-confirm-global");
    const deployConfirmGlobalWarn = document.getElementById("deploy-confirm-global-warn");
    const deployConfirmTargetLabel = document.getElementById("deploy-confirm-target-label");
    const deployConfirmProjectNote = document.getElementById("deploy-confirm-project-note");
    const deployConfirmSubmit = document.getElementById("deploy-confirm-submit");
    const headerNetworkStatus = document.getElementById("header-network-status");
    const headerNetworkLabel = headerNetworkStatus
      ? headerNetworkStatus.querySelector(".status-label")
      : null;
    const APP_ORG_URL = ${JSON.stringify(APP_ORG_URL)};
    const APP_HOME_URL = ${JSON.stringify(APP_HOME_URL)};
    const USER_HOME = ${JSON.stringify(os.homedir())};
    const GLOBAL_PERSONA_TARGETS = ${JSON.stringify(
      getGlobalPersonaSyncTargets(),
    )};

    let lastStatus = { guardEnabled: false, tokens: [], activeMember: null };
    let deployConfirmResolve = null;
    let deployConfirmContext = { root: "", targetEntries: [] };
    let deferredInstallPrompt = null;
    const PWA_INSTALLED_KEY = "transcodes-pwa-installed";

    function syncNetworkStatus() {
      if (!headerNetworkStatus || !headerNetworkLabel) return;
      const online = navigator.onLine !== false;
      headerNetworkStatus.dataset.online = online ? "true" : "false";
      headerNetworkLabel.textContent = online ? "Connected" : "No network";
      headerNetworkStatus.setAttribute(
        "aria-label",
        online ? "Network connected" : "No network connection"
      );
    }
    window.addEventListener("online", syncNetworkStatus);
    window.addEventListener("offline", syncNetworkStatus);
    syncNetworkStatus();

    function isStandalonePwa() {
      return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
      );
    }

    function markPwaInstalled() {
      try {
        localStorage.setItem(PWA_INSTALLED_KEY, "1");
      } catch {}
    }

    function clearPwaInstalledMark() {
      try {
        localStorage.removeItem(PWA_INSTALLED_KEY);
      } catch {}
    }

    function syncInstallButton() {
      if (!headerInstallBtn) return;
      // Only show when the browser can actually install (beforeinstallprompt).
      // Already-installed apps (including browser tabs with "Open in app")
      // never fire that event, so the button stays hidden.
      if (isStandalonePwa() || !deferredInstallPrompt) {
        headerInstallBtn.hidden = true;
        return;
      }
      headerInstallBtn.hidden = false;
    }

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      clearPwaInstalledMark();
      syncInstallButton();
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      markPwaInstalled();
      syncInstallButton();
    });

    if (headerInstallBtn) {
      headerInstallBtn.addEventListener("click", async () => {
        if (!deferredInstallPrompt) {
          showToast(
            "Run transcodes, then refresh this page to install.",
            "error"
          );
          syncInstallButton();
          return;
        }
        headerInstallBtn.disabled = true;
        try {
          deferredInstallPrompt.prompt();
          const choice = await deferredInstallPrompt.userChoice;
          deferredInstallPrompt = null;
          if (choice && choice.outcome === "accepted") {
            markPwaInstalled();
            showToast("App installed", "success");
          } else {
            showToast("Install cancelled", "error");
          }
        } catch {
          showToast(
            "Run transcodes, then refresh this page to install.",
            "error"
          );
        } finally {
          headerInstallBtn.disabled = false;
          syncInstallButton();
        }
      });
    }

    if (isStandalonePwa()) markPwaInstalled();
    syncInstallButton();

    function hasSavedTokens(s) {
      return Array.isArray(s.tokens) && s.tokens.length > 0;
    }

    // URL ?tab= ↔ internal panel ids (guideline / persona / tokens / rbac)
    const TAB_URL_TO_INTERNAL = {
      guide: "guideline",
      guideline: "guideline",
      persona: "persona",
      profile: "tokens",
      tokens: "tokens",
      permission: "rbac",
      rbac: "rbac",
    };
    const TAB_INTERNAL_TO_URL = {
      guideline: "guide",
      persona: "persona",
      tokens: "profile",
      rbac: "permission",
    };

    function resolveInternalTab(name) {
      if (!name) return "guideline";
      const key = String(name).toLowerCase();
      if (TAB_INTERNAL_TO_URL[key]) return key;
      return TAB_URL_TO_INTERNAL[key] || "guideline";
    }

    function tabFromUrl() {
      return resolveInternalTab(
        new URLSearchParams(location.search).get("tab")
      );
    }

    function syncTabUrl(internalName, replace) {
      const urlTab = TAB_INTERNAL_TO_URL[internalName] || "guide";
      const url = new URL(location.href);
      if (urlTab === "guide") url.searchParams.delete("tab");
      else url.searchParams.set("tab", urlTab);
      const next = url.pathname + url.search + url.hash;
      const current = location.pathname + location.search + location.hash;
      if (next === current) return;
      if (replace) history.replaceState({ tab: internalName }, "", next);
      else history.pushState({ tab: internalName }, "", next);
    }

    function openTab(name, opts) {
      const options = opts || {};
      const tab = resolveInternalTab(name);
      document.querySelectorAll(".card > .tabs > .tab[data-tab]").forEach((t) =>
        t.classList.toggle("active", t.getAttribute("data-tab") === tab));
      document.querySelectorAll(".card > .panel").forEach((p) =>
        p.classList.toggle("active", p.id === "panel-" + tab));
      if (!options.skipUrl) syncTabUrl(tab, !!options.replaceUrl);
      if (tab === "rbac") loadRbac();
      if (tab === "persona") initPersona();
    }

    function appProjectBase(organizationId, projectId) {
      return (
        APP_ORG_URL +
        "/" +
        encodeURIComponent(organizationId) +
        "/project/" +
        encodeURIComponent(projectId)
      );
    }

    // permissions → .../project/{pid}?tab=permissions
    function appPermissionsUrl(organizationId, projectId) {
      return appProjectBase(organizationId, projectId) + "?tab=permissions";
    }

    // webhooks → .../project/{pid}/settings?tab=webhooks
    function appWebhooksSettingsUrl(organizationId, projectId) {
      return (
        appProjectBase(organizationId, projectId) + "/settings?tab=webhooks"
      );
    }

    // members → .../project/{pid}?tab=members (Manage Tokens)
    function appMembersUrl(organizationId, projectId) {
      return appProjectBase(organizationId, projectId) + "?tab=members";
    }

    function appDeepLinkHref(tab, organizationId, projectId) {
      if (tab === "webhooks" || tab === "settings") {
        return appWebhooksSettingsUrl(organizationId, projectId);
      }
      if (tab === "members") {
        return appMembersUrl(organizationId, projectId);
      }
      // permissions (default for data-app-tab="permissions")
      return appPermissionsUrl(organizationId, projectId);
    }

    function updateAppDeepLinks(s) {
      const oid = s && s.activeMember && s.activeMember.organizationId;
      const pid = s && s.activeMember && s.activeMember.projectId;
      document.querySelectorAll("[data-app-tab]").forEach((a) => {
        const tab = a.getAttribute("data-app-tab");
        if (oid && pid && tab) {
          a.href = appDeepLinkHref(tab, oid, pid);
        } else if (oid) {
          a.href = APP_ORG_URL + "/" + encodeURIComponent(oid);
        } else {
          a.href = APP_ORG_URL;
        }
      });
    }

    function updateSessionHeader(s) {
      const signedIn = hasSavedTokens(s);
      headerSignedOutEl.hidden = !!signedIn;
      headerLoginActionsEl.hidden = !!signedIn;
      headerProfileBtn.hidden = !signedIn;

      if (signedIn) {
        const am = s.activeMember || {};
        const activeTok =
          (s.tokens || []).find((t) => t.active) || (s.tokens || [])[0] || {};
        headerProfileNameEl.textContent = am.email || "Signed in";

        const workspace = [
          am.organizationName || am.organizationId || activeTok.organizationId,
          am.projectName || am.projectId || activeTok.projectId,
        ]
          .filter(Boolean)
          .map((part) => esc(part))
          .join(" · ");
        headerProfileMetaEl.innerHTML = workspace
          ? '<div class="header-profile-meta-line">' + workspace + "</div>"
          : '<div class="header-profile-meta-line">Signed in on this computer</div>';
      }

      updateAppDeepLinks(s);
    }

    async function openConsole() {
      const consoleBtns = document.querySelectorAll("[data-console-open]");
      consoleBtns.forEach((btn) => { btn.disabled = true; });
      try {
        const res = await fetch("/api/console/open", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not open security settings");
        if (data.browserUrl) window.open(data.browserUrl, "_blank", "noopener,noreferrer");
        showToast("Opening security settings in your browser", "success");
      } catch (e) {
        showToast(e.message || "Could not open security settings", "error");
      } finally {
        consoleBtns.forEach((btn) => { btn.disabled = false; });
      }
    }

    let loginAttemptId = 0;

    async function watchLogin(attemptId) {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (attemptId !== loginAttemptId) return;
        try {
          await refresh();
          if (hasSavedTokens(lastStatus)) {
            showToast("Login complete", "success");
            return;
          }
        } catch (_) {
          // The dashboard may briefly restart; keep checking this attempt.
        }
      }
    }

    async function openLogin() {
      const attemptId = ++loginAttemptId;
      headerLoginBtn.disabled = true;
      showToast("Complete sign-in in your browser…", "success");
      try {
        const res = await fetch("/api/login", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed");
        showToast("Login opened in your browser", "success");
        void watchLogin(attemptId);
      } catch (e) {
        showToast(e.message || "Login failed", "error");
      } finally {
        headerLoginBtn.disabled = false;
      }
    }

    async function openLogout() {
      if (!confirm("Sign out on this computer?")) {
        return;
      }
      headerLogoutBtn.disabled = true;
      try {
        const res = await fetch("/api/logout", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Logout failed");
        showToast("Signed out", "success");
        await refresh();
      } catch (e) {
        showToast(e.message || "Logout failed", "error");
      } finally {
        headerLogoutBtn.disabled = false;
      }
    }

    const guideVideoToggle = document.getElementById("guide-video-toggle");
    const guideVideo = document.getElementById("guide-video");
    const guideMuxPlayer = document.getElementById("guide-mux-player");

    function setGuideVideoOpen(open) {
      if (!guideVideoToggle || !guideVideo) return;
      guideVideoToggle.setAttribute("aria-expanded", String(open));
      guideVideo.hidden = !open;
      guideVideoToggle.textContent = open
        ? "Hide Intro Video"
        : "Watch Intro Video";
    }

    function seekGuideVideo(seconds) {
      if (!guideVideo || !guideMuxPlayer) return;
      setGuideVideoOpen(true);
      guideVideo.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const apply = () => {
        try {
          guideMuxPlayer.currentTime = seconds;
          const playResult = guideMuxPlayer.play && guideMuxPlayer.play();
          if (playResult && typeof playResult.catch === "function") {
            playResult.catch(() => {});
          }
        } catch (_) {}
      };
      apply();
      guideMuxPlayer.addEventListener("loadedmetadata", apply, { once: true });
      // Mux may still be booting — retry shortly so the seek sticks.
      setTimeout(apply, 250);
      setTimeout(apply, 800);
    }

    if (guideVideoToggle && guideVideo) {
      guideVideoToggle.addEventListener("click", () => {
        const open = guideVideoToggle.getAttribute("aria-expanded") === "true";
        setGuideVideoOpen(!open);
      });
    }

    document.querySelectorAll(".guide-step-time").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const seconds = Number(btn.getAttribute("data-seek"));
        if (!Number.isFinite(seconds)) return;
        seekGuideVideo(seconds);
      });
    });

    document.querySelectorAll(".card > .tabs > .tab[data-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        openTab(tab.getAttribute("data-tab"));
      });
    });
    document.querySelectorAll("[data-open-tab]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTab(btn.getAttribute("data-open-tab"));
      });
    });
    window.addEventListener("popstate", () => {
      openTab(tabFromUrl(), { skipUrl: true });
    });

    function openCommandsModal() {
      if (!commandsModal) return;
      commandsModal.hidden = false;
      document.body.style.overflow = "hidden";
      const closeBtn = commandsModal.querySelector(".commands-modal-close");
      if (closeBtn) closeBtn.focus();
    }

    function closeCommandsModal() {
      if (!commandsModal || commandsModal.hidden) return;
      commandsModal.hidden = true;
      document.body.style.overflow = "";
      if (headerCommandsBtn) headerCommandsBtn.focus();
    }

    function closeDeployConfirm(confirmed) {
      if (!deployConfirmModal || deployConfirmModal.hidden) return;
      deployConfirmModal.hidden = true;
      document.body.style.overflow = "";
      if (deployConfirmResolve) {
        const resolve = deployConfirmResolve;
        deployConfirmResolve = null;
        resolve(
          confirmed
            ? { global: !!(deployConfirmGlobal && deployConfirmGlobal.checked) }
            : null
        );
      }
      if (personaDeployBtn) personaDeployBtn.focus();
    }

    function syncDeployConfirmGlobalUi() {
      const global = !!(deployConfirmGlobal && deployConfirmGlobal.checked);
      const entries = deployConfirmContext.targetEntries || [];
      const visible = global
        ? entries.filter((entry) => GLOBAL_PERSONA_TARGETS.includes(entry.target))
        : entries;
      if (deployConfirmTargets) {
        deployConfirmTargets.textContent = visible.length
          ? visible.map((entry) => entry.label).join(", ")
          : global
            ? "none (select Claude, ChatGPT, or Antigravity)"
            : "";
      }
      if (deployConfirmRoot) {
        deployConfirmRoot.textContent = global ? USER_HOME : deployConfirmContext.root;
      }
      if (deployConfirmTargetLabel) {
        deployConfirmTargetLabel.textContent = global
          ? "Home directory"
          : "Target directory";
      }
      if (deployConfirmGlobalWarn) deployConfirmGlobalWarn.hidden = !global;
      if (deployConfirmProjectNote) deployConfirmProjectNote.hidden = global;
      if (deployConfirmSubmit) {
        deployConfirmSubmit.textContent = global ? "Apply Global" : "Apply Persona";
      }
    }

    function confirmPersonaDeploy(persona, root, targetEntries) {
      if (!deployConfirmModal) return Promise.resolve(null);
      deployConfirmContext = { root: root, targetEntries: targetEntries || [] };
      deployConfirmPersona.textContent = "“" + persona + "”";
      if (deployConfirmGlobal) deployConfirmGlobal.checked = false;
      syncDeployConfirmGlobalUi();
      deployConfirmModal.hidden = false;
      document.body.style.overflow = "hidden";
      if (deployConfirmSubmit) deployConfirmSubmit.focus();
      return new Promise((resolve) => {
        deployConfirmResolve = resolve;
      });
    }

    if (headerCommandsBtn) {
      headerCommandsBtn.addEventListener("click", () => { openCommandsModal(); });
    }
    if (commandsModal) {
      commandsModal.querySelectorAll("[data-commands-close]").forEach((el) => {
        el.addEventListener("click", () => { closeCommandsModal(); });
      });
    }
    if (deployConfirmModal) {
      deployConfirmModal.querySelectorAll("[data-deploy-confirm]").forEach((el) => {
        el.addEventListener("click", () => {
          closeDeployConfirm(el.getAttribute("data-deploy-confirm") === "confirm");
        });
      });
    }
    if (deployConfirmGlobal) {
      deployConfirmGlobal.addEventListener("change", () => {
        syncDeployConfirmGlobalUi();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (deployConfirmModal && !deployConfirmModal.hidden) {
        closeDeployConfirm(false);
        return;
      }
      closeCommandsModal();
    });

    headerProfileBtn.addEventListener("click", () => {
      openTab("tokens");
    });

    document.querySelectorAll("#panel-rbac .tab[data-rbac]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.getAttribute("data-rbac");
        document.querySelectorAll("#panel-rbac .tab[data-rbac]").forEach((t) =>
          t.classList.toggle("active", t === tab));
        document.querySelectorAll("#panel-rbac .rbac-pane").forEach((p) =>
          p.classList.toggle("active", p.id === "rbac-pane-" + name));
      });
    });

    // ---- Persona (.transcodes SSOT editor) ----------------------------------
    const personaRootInput = document.getElementById("persona-root-input");
    const personaRootHint = document.getElementById("persona-root-hint");
    const personaChangeBtn = document.getElementById("persona-change-btn");
    const personaOpenBtn = document.getElementById("persona-open-btn");
    const personaDeployBtn = document.getElementById("persona-deploy-btn");
    const personaDeployError = document.getElementById("persona-deploy-error");
    const personaTargetInputs = Array.from(
      document.querySelectorAll('input[name="persona-target"]')
    );
    const personaBundleList = document.getElementById("persona-bundle-list");
    const personaBundleName = document.getElementById("persona-bundle-name");
    const personaBundleNewBtn = document.getElementById("persona-bundle-new-btn");
    const personaBundleCancelBtn = document.getElementById("persona-bundle-cancel-btn");
    const personaBundleCreateBtn = document.getElementById("persona-bundle-create-btn");
    const personaPicker = document.getElementById("persona-picker");
    const personaSelect = document.getElementById("persona-name-select");
    const personaNewName = document.getElementById("persona-new-name");
    const personaSaveError = document.getElementById("persona-save-error");
    const personaRegistryBody = document.getElementById("persona-registry-body");
    const personaAbout = document.getElementById("persona-about");
    const personaPathEl = document.getElementById("persona-path");
    const personaTemplateRow = document.getElementById("persona-template-row");
    const personaTemplateSelect = document.getElementById("persona-template-select");
    const personaContentCount = document.getElementById("persona-content-count");
    const personaContentStatus = document.getElementById("persona-content-status");
    const personaEditor = document.getElementById("persona-editor");
    const personaSaveBtn = document.getElementById("persona-save-btn");
    const personaDeleteBtn = document.getElementById("persona-delete-btn");
    const personaLogWrap = document.getElementById("persona-log-wrap");
    const personaLog = document.getElementById("persona-log");
    const personaLogClose = document.getElementById("persona-log-close");

    function hidePersonaLog() {
      if (personaLogWrap) personaLogWrap.hidden = true;
      if (personaLog) personaLog.textContent = "";
    }

    function showPersonaLog(text) {
      if (!personaLogWrap || !personaLog) return;
      personaLog.textContent = text || "";
      personaLogWrap.hidden = false;
      personaLogWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function clearPersonaSaveError() {
      if (!personaSaveError) return;
      personaSaveError.hidden = true;
      personaSaveError.textContent = "";
    }

    function showPersonaSaveError(msg) {
      if (personaSaveError) {
        personaSaveError.textContent = msg;
        personaSaveError.hidden = false;
      }
      showToast(msg, "error");
    }

    function isCreatingPersonaEntry() {
      return (
        personaState.kind !== "agent" &&
        personaNewName &&
        !personaNewName.hidden
      );
    }

    function syncPersonaDeleteButton() {
      if (!personaDeleteBtn) return;
      const existing =
        personaState.kind === "agent"
          ? !!(
              personaState.listing &&
              personaState.listing.agent &&
              personaState.listing.agent.exists
            )
          : personaEntries(personaState.kind).some(
              (entry) => entry.name === personaState.name
            );
      personaDeleteBtn.hidden = !existing || isCreatingPersonaEntry();
      personaDeleteBtn.textContent =
        personaState.kind === "agent"
          ? "Delete Instruction"
          : personaState.kind === "skill"
            ? "Delete Skill"
            : "Delete Rule";
    }

    const NEW_OPTION = "__new__";
    const personaState = {
      root: "",
      persona: "",
      kind: "agent",
      name: "",
      listing: null,
      loaded: false,
    };

    function personaEntries(kind) {
      if (!personaState.listing) return [];
      return kind === "rule"
        ? personaState.listing.rules || []
        : personaState.listing.skills || [];
    }

    function setPersonaHint(msg, isError) {
      if (isError) {
        // Errors are toast-only — never show red inline text under the buttons.
        if (msg) showToast(msg, "error");
        if (personaRootHint) {
          personaRootHint.textContent = "";
          personaRootHint.classList.remove("error");
        }
        return;
      }
      if (!personaRootHint) return;
      personaRootHint.textContent = msg || "";
      personaRootHint.classList.remove("error");
    }

    function clearPersonaDeployError() {
      if (!personaDeployError) return;
      personaDeployError.hidden = true;
      personaDeployError.textContent = "";
    }

    function showPersonaDeployError(msg) {
      clearPersonaDeployError();
      if (msg) showToast(msg, "error");
    }

    function personaDeployReady(listing) {
      return !!(listing && listing.initialized);
    }

    function selectedPersonaTargets() {
      return personaTargetInputs
        .filter((input) => input.checked)
        .map((input) => ({
          target: input.value,
          label: input.getAttribute("data-target-label") || input.value,
        }));
    }

    function personaBusy(busy) {
      [
        personaSaveBtn,
        personaDeleteBtn,
        personaChangeBtn,
        personaOpenBtn,
        personaDeployBtn,
        personaBundleNewBtn,
        personaBundleCancelBtn,
        personaBundleCreateBtn,
      ].forEach((b) => {
        b.disabled = busy;
      });
      personaBundleList.querySelectorAll("button").forEach((b) => {
        b.disabled = busy;
      });
      personaRootInput.disabled = busy;
    }

    function personaItemHtml(kind, name) {
      const on =
        personaState.kind === kind &&
        (kind === "agent" || personaState.name === name);
      return (
        '<li class="persona-item' + (on ? " active" : "") + '">' +
        '<button type="button" class="persona-item-open" data-open-kind="' +
        kind +
        '" data-open-name="' +
        esc(name) +
        '">' +
        esc(name) +
        "</button>" +
        '<button type="button" class="persona-item-x" data-delete-kind="' +
        kind +
        '" data-delete-name="' +
        esc(name) +
        '" aria-label="Remove ' +
        esc(name) +
        '">×</button>' +
        "</li>"
      );
    }

    function personaGroupHtml(label, items) {
      return (
        '<div class="persona-group"><p class="persona-group-label">' +
        label +
        "</p>" +
        (items.length > 0
          ? '<ul class="persona-list">' + items.join("") + "</ul>"
          : '<p class="persona-empty">None yet</p>') +
        "</div>"
      );
    }

    function renderPersonaBundles() {
      const personas =
        personaState.listing && personaState.listing.personas
          ? personaState.listing.personas
          : [];
      personaBundleList.innerHTML = personas
        .map(
          (name) =>
            '<li class="persona-item' +
            (name === personaState.persona ? " active" : "") +
            '">' +
            '<button type="button" class="persona-item-open" data-open-persona="' +
            esc(name) +
            '">' +
            esc(name) +
            "</button>" +
            '<button type="button" class="persona-item-x" data-delete-persona="' +
            esc(name) +
            '" aria-label="Remove Persona ' +
            esc(name) +
            '">×</button></li>'
        )
        .join("");
      personaBundleList.querySelectorAll("[data-open-persona]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          personaState.persona = btn.getAttribute("data-open-persona");
          personaState.name = "";
          showPersonaNewName(false);
          await refreshPersona(personaRootInput.value.trim());
        });
      });
      personaBundleList.querySelectorAll("[data-delete-persona]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          deletePersonaBundle(btn.getAttribute("data-delete-persona"));
        });
      });
    }

    function renderPersonaRegistry() {
      const listing = personaState.listing;
      if (!listing) {
        personaRegistryBody.innerHTML =
          '<p class="persona-empty">Select a Persona to see its Instruction, Rules, and Skills.</p>';
        return;
      }

      const agentItems = listing.agent.exists
        ? [personaItemHtml("agent", "agents.md")]
        : [];
      const ruleItems = (listing.rules || []).map((e) =>
        personaItemHtml("rule", e.name));
      const skillItems = (listing.skills || []).map((e) =>
        personaItemHtml("skill", e.name));

      personaRegistryBody.innerHTML =
        personaGroupHtml("Instruction", agentItems) +
        personaGroupHtml("Rule", ruleItems) +
        personaGroupHtml("Skill", skillItems);

      personaRegistryBody.querySelectorAll("[data-open-kind]").forEach((btn) => {
        btn.addEventListener("click", () =>
          openPersonaEntry(
            btn.getAttribute("data-open-kind"),
            btn.getAttribute("data-open-name")
          ));
      });
      personaRegistryBody.querySelectorAll("[data-delete-kind]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          deletePersonaEntry(
            btn.getAttribute("data-delete-kind"),
            btn.getAttribute("data-delete-name")
          );
        });
      });
    }

    async function deletePersonaEntry(kind, name) {
      const label = kind === "agent" ? "Instruction (agents.md)" : name;
      const ok = window.confirm(
        "Remove " + label + " from Persona “" + personaState.persona + "”?\\n\\nThis cannot be undone."
      );
      if (!ok) return;

      personaBusy(true);
      try {
        await personaFetch("/api/persona/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
            persona: personaState.persona,
            kind,
            name: kind === "agent" ? "" : name,
          }),
        });
        if (
          personaState.kind === kind &&
          (kind === "agent" || personaState.name === name)
        ) {
          personaState.name = "";
          setPersonaEditorContent("");
          personaPathEl.textContent = "";
        }
        showToast("Removed " + (kind === "agent" ? "agents.md" : name), "success");
        await loadPersonaListing(personaRootInput.value.trim());
        renderPersonaPicker();
        renderPersonaRegistry();
        if (personaState.kind === kind) {
          try { await loadPersonaFile(); } catch (_) { /* ignore */ }
        }
      } catch (e) {
        showToast(e.message || "Could not remove", "error");
      } finally {
        personaBusy(false);
      }
    }

    async function openPersonaEntry(kind, name) {
      selectPersonaTab(kind);
      personaState.name = kind === "agent" ? "" : name;
      showPersonaNewName(false);
      renderPersonaPicker();
      if (kind !== "agent") personaSelect.value = name;
      try {
        await loadPersonaFile();
        renderPersonaRegistry();
      } catch (e) {
        setPersonaHint(e.message || "Could not read that file", true);
      }
    }

    const PERSONA_ABOUT = {
      agent:
        "<strong>Instruction (<code class='cli-cmd'>AGENTS.md</code>, <code class='cli-cmd'>CLAUDE.md</code>) — the agent's identity and project background.</strong> " +
        "Keep always-loaded guidance focused: 500–1,500 tokens; above 2,000, move conditional policy into separate Rule files and procedures into separate Skill files.",
      rule:
        "<strong>Rule (<code class='cli-cmd'>rule.md</code>) — one focused policy file (Must / Never).</strong> " +
        "Keep 100–500 tokens. One policy topic per file — split unrelated Must/Never groups into separate Rules. Do not put workflows or step-by-step procedures here.",
      skill:
        "<strong>Skill (<code class='cli-cmd'>SKILL.md</code>) — one focused workflow file.</strong> " +
        "Use 500–2,000 tokens for Prerequisites, Steps, templates, and done criteria. One workflow per file — split distinct workflows into separate Skills. Do not put standing policies or Must/Never rules here.",
    };

    const PERSONA_CONTENT_BUDGETS = {
      agent: "500–1,500 tokens",
      rule: "100–500 tokens",
      skill: "500–2,000 tokens",
    };

    function approximatePersonaTokens(text) {
      let asianCharacters = 0;
      const characters = Array.from(text);
      characters.forEach((character) => {
        const code = character.codePointAt(0);
        if (
          (code >= 0x3040 && code <= 0x30ff) ||
          (code >= 0x3400 && code <= 0x9fff) ||
          (code >= 0xac00 && code <= 0xd7af) ||
          (code >= 0x1100 && code <= 0x11ff) ||
          (code >= 0x3130 && code <= 0x318f)
        ) {
          asianCharacters += 1;
        }
      });
      const otherCharacters = characters.length - asianCharacters;
      return Math.ceil(asianCharacters * 1.5 + otherCharacters / 4);
    }

    function updatePersonaContentStats() {
      if (!personaContentCount || !personaContentStatus || !personaEditor) return;
      const text = personaEditor.value || "";
      const words = text.trim() ? text.trim().split(/\\s+/).length : 0;
      const tokens = text.trim() ? approximatePersonaTokens(text) : 0;
      const budget = PERSONA_CONTENT_BUDGETS[personaState.kind];
      personaContentCount.textContent =
        "≈ " + tokens.toLocaleString() + " tokens · " + words.toLocaleString() + " words";
      personaContentStatus.textContent = "Best Length: " + budget;
    }

    function setPersonaEditorContent(content) {
      personaEditor.value = content || "";
      updatePersonaContentStats();
    }

    function selectPersonaTab(kind) {
      personaState.kind = kind;
      document.querySelectorAll("#panel-persona .tab[data-persona]").forEach((t) =>
        t.classList.toggle("active", t.getAttribute("data-persona") === kind));
      personaAbout.innerHTML = PERSONA_ABOUT[kind] || "";
      personaTemplateRow.hidden = true;
      personaTemplateSelect.value = "";
      updatePersonaContentStats();
      syncPersonaDeleteButton();
    }

    function renderPersonaPicker() {
      const kind = personaState.kind;
      personaPicker.hidden = kind === "agent";
      if (kind === "agent") {
        syncPersonaDeleteButton();
        return;
      }

      const entries = personaEntries(kind);
      personaSelect.innerHTML =
        entries
          .map((e) => '<option value="' + esc(e.name) + '">' + esc(e.name) + "</option>")
          .join("") +
        '<option value="' + NEW_OPTION + '">＋ New ' + kind + "…</option>";

      if (personaState.name && entries.some((e) => e.name === personaState.name)) {
        personaSelect.value = personaState.name;
      } else if (entries.length > 0) {
        personaState.name = entries[0].name;
        personaSelect.value = personaState.name;
      } else {
        personaSelect.value = NEW_OPTION;
        showPersonaNewName(true);
      }
      syncPersonaDeleteButton();
    }

    function showPersonaNewName(show) {
      personaNewName.hidden = !show;
      personaTemplateRow.hidden = !show || personaState.kind === "agent";
      if (!show) personaTemplateSelect.value = "";
      clearPersonaSaveError();
      if (show) {
        renderPersonaTemplateOptions();
        const kindLabel = personaState.kind === "skill" ? "skill" : "rule";
        personaNewName.placeholder = "Please type a new " + kindLabel + " title";
        personaNewName.value = "";
        personaNewName.focus();
      }
      syncPersonaDeleteButton();
    }

    async function personaFetch(url, options) {
      const res = await fetch(url, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    async function loadPersonaListing(root, persona) {
      const target = root || personaRootInput.value.trim();
      const listing = await personaFetch(
        "/api/persona?root=" +
          encodeURIComponent(target) +
          "&persona=" +
          encodeURIComponent(persona || personaState.persona)
      );
      personaState.root = listing.root;
      personaState.persona = listing.persona;
      personaState.listing = listing;
      personaRootInput.value = listing.root;
      renderPersonaBundles();
      clearPersonaDeployError();
      setPersonaHint(
        listing.initialized
          ? listing.rules.length + " rule(s) · " + listing.skills.length + " skill(s)"
          : "Empty Persona — add an Instruction, Rule, or Skill.",
        false
      );
      return listing;
    }

    async function loadPersonaFile() {
      personaTemplateSelect.value = "";
      if (!personaState.persona) {
        setPersonaEditorContent("");
        personaPathEl.textContent = "Create a Persona first";
        return;
      }
      if (personaState.kind !== "agent" && !personaState.name) {
        setPersonaEditorContent("");
        personaPathEl.textContent = "Pick or name a file first";
        return;
      }
      const params =
        "root=" + encodeURIComponent(personaRootInput.value.trim() || personaState.root) +
        "&persona=" + encodeURIComponent(personaState.persona) +
        "&kind=" + encodeURIComponent(personaState.kind) +
        "&name=" + encodeURIComponent(personaState.name || "");
      const file = await personaFetch("/api/persona/file?" + params);
      setPersonaEditorContent(file.content);
      personaEditor.scrollTop = 0;
      personaPathEl.textContent =
        file.relativePath + (file.exists ? "" : "  (new file)");
    }

    function renderPersonaTemplateOptions() {
      if (!personaTemplateSelect) return;
      const prev = personaTemplateSelect.value;
      personaTemplateSelect.innerHTML =
        '<option value="">Choose a template…</option>' +
        '<option value="general">General</option>';
      if (
        prev &&
        [...personaTemplateSelect.options].some((o) => o.value === prev)
      ) {
        personaTemplateSelect.value = prev;
      }
    }

    async function applyPersonaTemplate() {
      const template = personaTemplateSelect.value;
      if (!template || personaState.kind === "agent") return;
      const name =
        personaNewName && !personaNewName.hidden
          ? personaNewName.value.trim()
          : personaState.name;
      personaTemplateSelect.disabled = true;
      try {
        const params =
          "kind=" + encodeURIComponent(personaState.kind) +
          "&template=" + encodeURIComponent(template) +
          "&name=" + encodeURIComponent(name || "general");
        const data = await personaFetch("/api/persona/template?" + params);
        setPersonaEditorContent(data.content);
        personaEditor.scrollTop = 0;
        clearPersonaSaveError();
        personaEditor.focus();
        showToast("Template loaded", "success");
      } catch (e) {
        showPersonaSaveError(e.message || "Could not load the template");
        personaTemplateSelect.value = "";
      } finally {
        personaTemplateSelect.disabled = false;
      }
    }

    async function refreshPersona(root) {
      personaBusy(true);
      try {
        await loadPersonaListing(root);
        renderPersonaPicker();
        await loadPersonaFile();
        renderPersonaRegistry();
      } catch (e) {
        setPersonaHint(e.message || "Could not read that folder", true);
        personaState.listing = null;
        renderPersonaRegistry();
        setPersonaEditorContent("");
        personaPathEl.textContent = "";
      } finally {
        personaBusy(false);
      }
    }

    async function initPersona() {
      if (personaState.loaded) return;
      personaState.loaded = true;
      selectPersonaTab(personaState.kind);
      try {
        const data = await personaFetch("/api/persona/root");
        personaRootInput.value = data.root || "";
      } catch (e) {
        setPersonaHint(e.message || "Could not resolve the folder", true);
      }
      await refreshPersona();
    }

    function applyPersonaListing(data, toastMsg) {
      personaState.root = data.root;
      personaState.persona = data.persona;
      personaState.name = "";
      personaRootInput.value = data.root;
      personaState.listing = data;
      renderPersonaBundles();
      renderPersonaPicker();
      clearPersonaDeployError();
      setPersonaHint(
        data.initialized
          ? data.rules.length + " rule(s) · " + data.skills.length + " skill(s)"
          : "Empty Persona — add an Instruction, Rule, or Skill.",
        false
      );
      if (toastMsg) showToast(toastMsg, "success");
    }

    personaChangeBtn.addEventListener("click", async () => {
      personaBusy(true);
      try {
        const data = await personaFetch("/api/persona/change", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim(),
            persona: personaState.persona,
          }),
        });
        if (data.cancelled) return;
        applyPersonaListing(data);
        await loadPersonaFile();
        renderPersonaRegistry();
      } catch (e) {
        setPersonaHint(e.message || "Could not choose the folder", true);
      } finally {
        personaBusy(false);
      }
    });

    personaOpenBtn.addEventListener("click", async () => {
      personaBusy(true);
      try {
        await personaFetch("/api/persona/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
          }),
        });
      } catch (e) {
        setPersonaHint(e.message || "Could not open the directory", true);
      } finally {
        personaBusy(false);
      }
    });

    function applyTypedPersonaRoot() {
      const next = personaRootInput.value.trim();
      if (!next || next === personaState.root) return;
      personaState.name = "";
      refreshPersona(next);
    }

    personaRootInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      applyTypedPersonaRoot();
    });
    personaRootInput.addEventListener("change", () => {
      applyTypedPersonaRoot();
    });

    function showNewPersona(show) {
      personaBundleName.hidden = !show;
      personaBundleCancelBtn.hidden = !show;
      personaBundleCreateBtn.hidden = !show;
      personaBundleNewBtn.hidden = show;
      personaBundleList.hidden = show;
      if (show) {
        personaBundleName.value = "";
        personaBundleName.focus();
      }
    }

    async function deletePersonaBundle(name) {
      const ok = window.confirm(
        "Remove Persona “" + name + "” and all of its Instruction, Rules, and Skills?\\n\\nThis cannot be undone."
      );
      if (!ok) return;

      personaBusy(true);
      try {
        const data = await personaFetch("/api/persona/delete-persona", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
            persona: name,
          }),
        });
        applyPersonaListing(data, "Removed Persona “" + name + "”");
        await loadPersonaFile();
        renderPersonaRegistry();
      } catch (e) {
        showToast(e.message || "Could not remove Persona", "error");
      } finally {
        personaBusy(false);
      }
    }

    async function createPersonaBundle() {
      const name = personaBundleName.value.trim();
      if (!name) {
        showToast("Enter a Persona name.", "error");
        personaBundleName.focus();
        return;
      }
      personaBusy(true);
      try {
        const data = await personaFetch("/api/persona/create-persona", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
            persona: name,
          }),
        });
        showNewPersona(false);
        applyPersonaListing(data, "Created Persona “" + data.persona + "”");
        renderPersonaRegistry();
        await loadPersonaFile();
      } catch (e) {
        showToast(e.message || "Could not create Persona", "error");
      } finally {
        personaBusy(false);
      }
    }

    personaBundleNewBtn.addEventListener("click", () => showNewPersona(true));
    personaBundleCancelBtn.addEventListener("click", () => showNewPersona(false));
    personaBundleCreateBtn.addEventListener("click", createPersonaBundle);
    personaBundleName.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        showNewPersona(false);
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      createPersonaBundle();
    });

    document.querySelectorAll("#panel-persona .tab[data-persona]").forEach((tab) => {
      tab.addEventListener("click", async () => {
        selectPersonaTab(tab.getAttribute("data-persona"));
        personaState.name = "";
        showPersonaNewName(false);
        hidePersonaLog();
        renderPersonaPicker();
        try {
          await loadPersonaFile();
          renderPersonaRegistry();
        } catch (e) {
          setPersonaHint(e.message || "Could not read that file", true);
        }
      });
    });

    personaSelect.addEventListener("change", async () => {
      if (personaSelect.value === NEW_OPTION) {
        personaState.name = "";
        setPersonaEditorContent("");
        personaPathEl.textContent =
          "Enter a title and content, then click Save to create";
        showPersonaNewName(true);
        return;
      }
      showPersonaNewName(false);
      personaState.name = personaSelect.value;
      try {
        await loadPersonaFile();
      } catch (e) {
        setPersonaHint(e.message || "Could not read that file", true);
      }
    });

    personaNewName.addEventListener("input", () => {
      clearPersonaSaveError();
    });
    personaEditor.addEventListener("input", () => {
      updatePersonaContentStats();
      if (isCreatingPersonaEntry()) clearPersonaSaveError();
    });
    personaTemplateSelect.addEventListener("change", () => {
      applyPersonaTemplate();
    });

    async function savePersona() {
      clearPersonaSaveError();
      const creating = isCreatingPersonaEntry();
      const kindLabel = personaState.kind === "skill" ? "skill" : "rule";
      let name = personaState.name;

      if (creating) {
        name = personaNewName.value.trim();
        if (!name) {
          showPersonaSaveError("Enter a name for the new " + kindLabel + ".");
          personaNewName.focus();
          return;
        }
        if (!personaEditor.value.trim()) {
          showPersonaSaveError("Enter content for the new " + kindLabel + ".");
          personaEditor.focus();
          return;
        }
        personaState.name = name;
      } else if (personaState.kind !== "agent" && !name) {
        showPersonaSaveError("Name the " + kindLabel + " first.");
        return;
      } else if (!personaEditor.value.trim()) {
        showPersonaSaveError("Content cannot be empty.");
        personaEditor.focus();
        return;
      }

      personaBusy(true);
      try {
        const data = await personaFetch("/api/persona/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
            persona: personaState.persona,
            kind: personaState.kind,
            name,
            content: personaEditor.value,
          }),
        });
        if (creating) showPersonaNewName(false);
        personaPathEl.textContent = data.saved.relativePath;
        const savedLabel =
          personaState.kind === "agent"
            ? "Instruction"
            : name || (personaState.kind === "skill" ? "skill" : "rule");
        showToast(
          (creating ? "Created " : "Saved ") + savedLabel + " successfully",
          "success"
        );
        await loadPersonaListing(
          personaRootInput.value.trim(),
          personaState.persona
        );
        renderPersonaPicker();
        renderPersonaRegistry();
        if (personaState.kind !== "agent") {
          personaSelect.value = name;
        }
      } catch (e) {
        if (creating) {
          personaNewName.hidden = false;
          personaNewName.value = name;
        }
        showPersonaSaveError(e.message || "Something went wrong");
      } finally {
        personaBusy(false);
      }
    }

    async function deployAllPersona() {
      const root = personaRootInput.value.trim() || personaState.root;
      const listing = personaState.listing;
      const selectedTargets = selectedPersonaTargets();
      if (selectedTargets.length === 0) {
        showPersonaDeployError("Select at least one app to apply this Persona.");
        return;
      }
      if (!personaDeployReady(listing)) {
        showPersonaDeployError(
          "Add an Instruction, Rule, or Skill before applying this Persona."
        );
        return;
      }
      clearPersonaDeployError();

      const confirm = await confirmPersonaDeploy(
        personaState.persona,
        root,
        selectedTargets
      );
      if (!confirm) return;

      const global = confirm.global === true;
      const deployTargets = global
        ? selectedTargets.filter((entry) =>
            GLOBAL_PERSONA_TARGETS.includes(entry.target)
          )
        : selectedTargets;
      if (deployTargets.length === 0) {
        showPersonaDeployError(
          global
            ? "Global apply supports Claude, ChatGPT, and Antigravity only. Select at least one of those apps."
            : "Select at least one app to apply this Persona."
        );
        return;
      }

      personaBusy(true);
      hidePersonaLog();
      try {
        const data = await personaFetch("/api/persona/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: global ? USER_HOME : root,
            persona: personaState.persona,
            kind: personaState.kind,
            name: personaState.name,
            content: personaEditor.value,
            targets: deployTargets.map((entry) => entry.target),
            global: global,
          }),
        });
        showPersonaLog((data.deploy && data.deploy.output) || "Applied.");
        await loadPersonaListing(root, personaState.persona);
        renderPersonaPicker();
        renderPersonaRegistry();
        showToast(
          (global ? "Applied globally “" : "Applied Persona “") +
            personaState.persona +
            "”",
          "success"
        );
      } catch (e) {
        showPersonaLog(e.message || "Apply failed");
        showToast(e.message || "Apply failed", "error");
      } finally {
        personaBusy(false);
      }
    }

    personaSaveBtn.addEventListener("click", () => savePersona());
    personaDeleteBtn.addEventListener("click", () => {
      if (personaDeleteBtn.hidden) return;
      deletePersonaEntry(personaState.kind, personaState.name);
    });
    personaDeployBtn.addEventListener("click", () => deployAllPersona());
    personaTargetInputs.forEach((input) => {
      input.addEventListener("change", () => { clearPersonaDeployError(); });
    });
    if (personaLogClose) {
      personaLogClose.addEventListener("click", () => { hidePersonaLog(); });
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }

    function renderSessionCard(s) {
      const signedIn = hasSavedTokens(s);
      profileEmptyEl.hidden = !!signedIn;
      profileCardEl.hidden = !signedIn;

      if (signedIn) {
        const am = s.activeMember || {};
        const activeTok =
          (s.tokens || []).find((t) => t.active) || (s.tokens || [])[0] || {};
        const email = am.email || "Signed in";
        profileEmailEl.textContent = email;
        profileAvatarEl.textContent = email.charAt(0);
        profileWorkspaceEl.textContent =
          [am.organizationName, am.projectName].filter(Boolean).join(" · ") ||
          "Signed in on this computer";

        setProfileRow("org-name", am.organizationName);
        setProfileRow("org-id", am.organizationId || activeTok.organizationId);
        setProfileRow("project-name", am.projectName);
        setProfileRow("project-id", am.projectId || activeTok.projectId);
      }

      updateSessionHeader(s);
    }

    // Rows without a value are removed rather than rendered as a placeholder.
    function setProfileRow(key, value) {
      const row = document.getElementById("profile-row-" + key);
      const valueEl = document.getElementById("profile-" + key);
      if (!row || !valueEl) return;
      if (value) {
        valueEl.textContent = value;
        row.hidden = false;
      } else {
        valueEl.textContent = "";
        row.hidden = true;
      }
    }

    async function refresh() {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) throw new Error("Could not refresh status");
        lastStatus = await res.json();
        renderSessionCard(lastStatus);
        renderGuardStatus(lastStatus);
      } catch (e) {
        showToast(e.message || "Could not refresh status", "error");
      }
    }

    document.querySelectorAll("[data-console-open]").forEach((btn) => {
      btn.addEventListener("click", () => { openConsole(); });
    });
    headerLoginBtn.addEventListener("click", () => { openLogin(); });
    headerLogoutBtn.addEventListener("click", () => { openLogout(); });

    const rbacTokenWarningEl = document.getElementById("rbac-token-warning");
    const guardEnabledToggleEl = document.getElementById("guard-enabled-toggle");
    const guardToggleDescEl = document.getElementById("guard-toggle-desc");
    const resourcesTbody = document.getElementById("resources-tbody");
    const rolePickerEl = document.getElementById("role-picker");
    const matrixWrapEl = document.getElementById("matrix-wrap");
    const matrixRoleLabelEl = document.getElementById("matrix-role-label");
    const matrixTbodyEl = document.getElementById("matrix-tbody");

    let rbacSnapshot = { resources: [], roles: [] };
    let selectedRoleId = null;

    function renderGuardStatus(s) {
      const enabled = s.guardEnabled === true;
      const signedIn = hasSavedTokens(s);
      guardEnabledToggleEl.checked = enabled;
      if (!signedIn) {
        guardToggleDescEl.textContent = enabled
          ? "Enabled — sign in to start evaluating tool calls."
          : "Off — Permission checks are skipped; tool calls are not recorded in Transcodes Log History";
        return;
      }
      guardToggleDescEl.textContent = enabled
        ? "Active — tool calls are evaluated against your permissions."
        : "Off — Permission checks are skipped; tool calls are not recorded in Transcodes Log History";
    }

    guardEnabledToggleEl.addEventListener("change", async () => {
      const enabled = guardEnabledToggleEl.checked;
      guardEnabledToggleEl.disabled = true;
      try {
        const res = await fetch("/api/guard-enabled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update guard");
        lastStatus = data;
        renderGuardStatus(lastStatus);
        showToast(
          enabled
            ? "Permission checks enabled"
            : "Permission checks, step-up authentication, and Log History disabled",
          "success"
        );
      } catch (e) {
        guardEnabledToggleEl.checked = !enabled;
        showToast(e.message || "Failed to update guard", "error");
      } finally {
        guardEnabledToggleEl.disabled = false;
      }
    });

    function showRbacToast(msg, kind) {
      showToast(msg, kind || "success");
    }

    function permCellClass(level) {
      return "perm-cell perm-cell-" + level;
    }

    function permSymbol(level) {
      if (level === 1) return "●";
      if (level === 2) return "◉";
      return "○";
    }

    function renderResources() {
      const rows = rbacSnapshot.resources || [];
      if (rows.length === 0) {
        resourcesTbody.innerHTML =
          '<tr><td colspan="2" style="color:var(--muted);text-align:center;">No resources yet — add them in the Transcodes app</td></tr>';
        return;
      }
      resourcesTbody.innerHTML = rows.map((r) =>
        "<tr>" +
        "<td><code>" + esc(r.key) + "</code></td>" +
        "<td>" + esc(r.description || "—") + "</td>" +
        "</tr>"
      ).join("");
    }

    function renderRolePicker() {
      const roles = rbacSnapshot.roles || [];
      if (roles.length === 0) {
        rolePickerEl.innerHTML = '<span style="color:var(--muted);font-size:var(--text-sm);">No roles yet</span>';
        matrixWrapEl.hidden = true;
        selectedRoleId = null;
        return;
      }
      rolePickerEl.innerHTML = roles.map((r) =>
        '<button type="button" class="role-chip' +
        (r.id === selectedRoleId ? " active" : "") +
        '" data-role-id="' + esc(r.id) + '">' + esc(r.name) + "</button>"
      ).join("");
      if (!selectedRoleId && roles[0]) {
        selectRole(roles[0].id);
      }
    }

    function selectRole(roleId) {
      selectedRoleId = roleId;
      const role = (rbacSnapshot.roles || []).find((r) => r.id === roleId);
      if (!role) {
        matrixWrapEl.hidden = true;
        return;
      }
      matrixRoleLabelEl.textContent = "Access for — " + role.name;
      renderMatrix(role.permissions || {});
      renderRolePicker();
      matrixWrapEl.hidden = false;
    }

    function matrixCell(resourceKey, action, permissions) {
      const row = permissions[resourceKey] || {};
      const level = row[action] ?? 0;
      return (
        '<td><span class="' + permCellClass(level) + ' perm-cell-readonly" aria-label="Access level ' + level + '">' +
        permSymbol(level) +
        "</span></td>"
      );
    }

    function renderMatrix(permissions) {
      const resources = rbacSnapshot.resources || [];
      if (resources.length === 0) {
        matrixTbodyEl.innerHTML =
          '<tr><td colspan="5" style="color:var(--muted);text-align:center;">No resources set up yet</td></tr>';
        return;
      }
      matrixTbodyEl.innerHTML = resources.map((r) =>
        "<tr>" +
        "<td><code>" + esc(r.key) + "</code></td>" +
        matrixCell(r.key, "create", permissions) +
        matrixCell(r.key, "read", permissions) +
        matrixCell(r.key, "update", permissions) +
        matrixCell(r.key, "delete", permissions) +
        "</tr>"
      ).join("");
    }

    async function loadRbac() {
      rbacTokenWarningEl.hidden = hasSavedTokens(lastStatus);
      if (!hasSavedTokens(lastStatus)) return;
      try {
        const res = await fetch("/api/rbac");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load permissions");
        rbacSnapshot = data;
        renderResources();
        renderRolePicker();
        if (selectedRoleId) selectRole(selectedRoleId);
      } catch (e) {
        showRbacToast(e.message || "Failed to load permissions", "error");
      }
    }

    rolePickerEl.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-role-id");
      if (id) selectRole(id);
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    openTab(tabFromUrl(), { replaceUrl: true });
    refresh();
  </script>
</body>
</html>`;
}

let dashboardLoginController: AbortController | undefined;

export function openDashboardBrowser(url: string): void {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(opener, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // URL is printed if the browser does not open.
  }
}

/**
 * Persona tab endpoints — read/write a chosen `.transcodes/` SoT (default
 * `~/.transcodes`) and deploy with `transcodes sync generate`.
 */
async function handlePersonaRoute(params: {
  res: ServerResponse;
  req: IncomingMessage;
  method: string;
  url: string;
  query: URLSearchParams;
}): Promise<void> {
  const { res, req, method, url, query } = params;

  try {
    if (method === 'GET' && url === '/api/persona/root') {
      const remembered = await readLastRoot();
      // Prefer home (Claude/Cursor/Antigravity config root) over a remembered
      // `.transcodes` path so the input shows the host root, not the SoT folder.
      const preferred =
        remembered && path.basename(remembered) !== '.transcodes'
          ? remembered
          : defaultPersonaRoot();
      const resolved = await resolvePersonaRoot(preferred);
      sendJson(res, 200, resolved);
      return;
    }

    if (method === 'GET' && url === '/api/persona') {
      sendJson(
        res,
        200,
        await listPersona(
          query.get('root') ?? undefined,
          query.get('persona') ?? undefined,
        ),
      );
      return;
    }

    if (method === 'POST' && url === '/api/persona/create-persona') {
      const body = await readJsonBody(req);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Persona name is required.');
      }
      const persona = await createPersona(body.persona);
      const root =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      sendJson(res, 200, {
        ok: true,
        ...(await listPersona(root, persona)),
      });
      return;
    }

    if (method === 'POST' && url === '/api/persona/delete-persona') {
      const body = await readJsonBody(req);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Persona name is required.');
      }
      await deletePersona(body.persona);
      const root =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      sendJson(res, 200, {
        ok: true,
        ...(await listPersona(root)),
      });
      return;
    }

    if (method === 'GET' && url === '/api/persona/file') {
      const persona = query.get('persona');
      if (!persona?.trim()) {
        throw new Error('Select a Persona first.');
      }
      sendJson(
        res,
        200,
        await readPersonaFile({
          root: query.get('root') ?? undefined,
          persona,
          kind: parsePersonaKind(query.get('kind')),
          name: query.get('name') ?? '',
        }),
      );
      return;
    }

    if (method === 'GET' && url === '/api/persona/template') {
      const kind = parsePersonaKind(query.get('kind'));
      if (kind === 'agent') {
        throw new Error('Templates are available for Rules and Skills.');
      }
      const template = query.get('template') || 'general';
      if (template !== 'general') {
        throw new Error('Unknown template. Only "general" is supported.');
      }
      const scaffold = createFeatureScaffold({
        feature: kind,
        name: query.get('name')?.trim() || 'general',
        template,
      });
      sendJson(res, 200, {
        ok: true,
        template,
        content: scaffold.content,
      });
      return;
    }

    if (method === 'POST' && url === '/api/persona/open') {
      const body = await readJsonBody(req);
      const root =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      sendJson(res, 200, {
        ok: true,
        opened: await revealPersonaFolder(root),
      });
      return;
    }

    if (method === 'POST' && url === '/api/persona/change') {
      const body = await readJsonBody(req);
      const start =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      const picked = await pickProjectFolder(start);
      if (!picked) {
        sendJson(res, 200, { cancelled: true });
        return;
      }
      const listing = await listPersona(
        picked,
        typeof body.persona === 'string' ? body.persona : undefined,
      );
      sendJson(res, 200, {
        cancelled: false,
        ...listing,
      });
      return;
    }

    if (method === 'POST' && url === '/api/persona/deploy') {
      const body = await readJsonBody(req);
      const root =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      const kind = parsePersonaKind(body.kind);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Select a Persona first.');
      }
      const persona = body.persona;
      const name = typeof body.name === 'string' ? body.name : '';
      const content = typeof body.content === 'string' ? body.content : '';
      const global = body.global === true;
      const supportedTargets = new Set([
        'claudecode',
        'cursor',
        'codexcli',
        'antigravity-ide',
      ]);
      const globalTargets = new Set<string>(getGlobalPersonaSyncTargets());
      let targets = Array.isArray(body.targets)
        ? body.targets.filter(
            (target): target is string =>
              typeof target === 'string' && supportedTargets.has(target),
          )
        : [];
      if (global) {
        targets = targets.filter((target) => globalTargets.has(target));
      }
      if (targets.length === 0) {
        throw new Error(
          global
            ? 'Global apply supports Claude, ChatGPT, and Antigravity only. Select at least one of those apps.'
            : 'Select at least one app to apply this Persona.',
        );
      }
      // Persona source always lives under ~/.transcodes. `root` is only the
      // deploy output folder (project path, or home when global).
      const deployRoot = global ? os.homedir() : root;

      // Deploy All includes the editor's current contents. Without this step,
      // a new template shown in the editor exists only in the browser and
      // generate has no source file to deploy.
      if (kind === 'agent' || name.trim()) {
        await savePersonaFile({
          root,
          persona,
          kind,
          name,
          content,
        });
      }
      const deployed = await deployPersona({
        root: deployRoot,
        persona,
        targets,
        global,
      });
      sendJson(res, deployed.ok ? 200 : 400, {
        ok: deployed.ok,
        deploy: deployed,
        ...(deployed.ok
          ? {}
          : { error: deployed.output || 'transcodes sync generate failed' }),
      });
      return;
    }

    if (
      method === 'POST' &&
      (url === '/api/persona/save' || url === '/api/persona/create')
    ) {
      const body = await readJsonBody(req);
      const kind = parsePersonaKind(body.kind);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Select a Persona first.');
      }
      const persona = body.persona;
      const root =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      const saved = await savePersonaFile({
        root,
        persona,
        kind,
        name: typeof body.name === 'string' ? body.name : '',
        content: typeof body.content === 'string' ? body.content : '',
      });

      if (url === '/api/persona/save') {
        sendJson(res, 200, { ok: true, saved });
        return;
      }

      const deployed = await deployPersona({ root, persona });
      sendJson(res, deployed.ok ? 200 : 400, {
        ok: deployed.ok,
        saved,
        deploy: deployed,
        ...(deployed.ok
          ? {}
          : { error: deployed.output || 'transcodes sync generate failed' }),
      });
      return;
    }

    if (method === 'POST' && url === '/api/persona/delete') {
      const body = await readJsonBody(req);
      const kind = parsePersonaKind(body.kind);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Select a Persona first.');
      }
      const persona = body.persona;
      const root =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      const removed = await deletePersonaFile({
        root,
        persona,
        kind,
        name: typeof body.name === 'string' ? body.name : '',
      });
      sendJson(res, 200, { ok: true, removed });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function listen(port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const rawUrl = req.url ?? '/';
      const parsedUrl = new URL(rawUrl, `http://${HOST}`);
      const pathname = parsedUrl.pathname;
      const query = parsedUrl.searchParams;
      const url = pathname;
      const method = req.method ?? 'GET';

      // DNS-rebinding guard: a malicious page on another origin can point its
      // DNS at 127.0.0.1 and have the victim's browser POST to this server,
      // but the Host header still carries the attacker's domain. Only accept
      // requests addressed to the loopback names we bind to.
      const hostName = (req.headers.host ?? '').split(':')[0];
      if (hostName !== '127.0.0.1' && hostName !== 'localhost') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden host');
        return;
      }

      try {
        if (method === 'GET' && url === '/health') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'close',
            'X-Transcodes-Dashboard': DASHBOARD_HEALTH_MARKER,
          });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (method === 'GET' && (url === '/' || url === '/index.html')) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'close',
          });
          res.end(dashboardHtml());
          return;
        }

        if (method === 'GET' && url === '/manifest.webmanifest') {
          res.writeHead(200, {
            'Content-Type': 'application/manifest+json; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'close',
          });
          res.end(PWA_MANIFEST);
          return;
        }

        if (method === 'GET' && url === '/sw.js') {
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
            'Service-Worker-Allowed': '/',
            Connection: 'close',
          });
          res.end(PWA_SERVICE_WORKER);
          return;
        }

        if (method === 'GET' && url === '/icon-512.png') {
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
            Connection: 'close',
            'Content-Length': PWA_ICON_PNG.length,
          });
          res.end(PWA_ICON_PNG);
          return;
        }

        if (method === 'GET' && url === '/api/status') {
          sendJson(res, 200, await buildStatus());
          return;
        }

        if (method === 'POST' && url === '/api/guard-enabled') {
          const body = await readJsonBody(req);
          if (typeof body.enabled !== 'boolean') {
            sendJson(res, 400, { error: 'enabled must be a boolean' });
            return;
          }
          setGuardEnabled(body.enabled);
          sendJson(res, 200, await buildStatus());
          return;
        }

        if (method === 'POST' && url === '/api/console/open') {
          const result = await openConsoleSession({ openBrowser: false });
          if (!result.ok) {
            sendJson(res, 400, {
              error:
                result.reason === 'no-token'
                  ? 'Not signed in — use Login first'
                  : (result.detail ?? result.reason),
            });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            sid: result.sid,
            browserUrl: result.browserUrl,
            expiresAt: result.expiresAt,
          });
          return;
        }

        if (method === 'POST' && url === '/api/login') {
          try {
            dashboardLoginController?.abort();
            const controller = new AbortController();
            dashboardLoginController = controller;
            const login = await beginCliLogin({
              quiet: true,
              open: true,
              signal: controller.signal,
            });
            void login.completion
              .catch(() => {
                // Closing the auth tab or letting the session expire is harmless.
              })
              .finally(() => {
                if (dashboardLoginController === controller) {
                  dashboardLoginController = undefined;
                }
              });
            sendJson(res, 202, { ok: true, pending: true });
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }

        if (method === 'POST' && url === '/api/logout') {
          clearTokenFile();
          sendJson(res, 200, { ok: true, ...(await buildStatus()) });
          return;
        }

        if (method === 'GET' && url === '/api/rbac') {
          try {
            const config = loadRbacConfig();
            const snapshot = await fetchRbacSnapshot(config);
            sendJson(res, 200, snapshot);
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }

        if (url.startsWith('/api/persona')) {
          await handlePersonaRoute({ res, method, url, query, req });
          return;
        }

        sendJson(res, 404, { error: 'not found' });
      } catch (err) {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    server.on('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

/** Collect PIDs listening on any port in [from, to] (best-effort). */
async function pidsListeningOnPorts(
  from: number,
  to: number,
): Promise<number[]> {
  const pids = new Set<number>();
  if (process.platform === 'win32') {
    for (let port = from; port <= to; port++) {
      try {
        const { stdout } = await execFileAsync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
          ],
          { timeout: 5000 },
        );
        for (const line of stdout.split(/\r?\n/)) {
          const pid = Number(line.trim());
          if (Number.isInteger(pid) && pid > 0) pids.add(pid);
        }
      } catch {
        // port free or PowerShell unavailable
      }
    }
    return [...pids];
  }

  for (let port = from; port <= to; port++) {
    try {
      const { stdout } = await execFileAsync(
        'lsof',
        ['-ti', `tcp:${port}`, '-sTCP:LISTEN'],
        { timeout: 5000 },
      );
      for (const token of stdout.trim().split(/\s+/)) {
        const pid = Number(token);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    } catch {
      // port free or lsof unavailable
    }
  }
  return [...pids];
}

/**
 * Kill listeners on [from, to] once so a stuck previous dashboard can be
 * replaced. Best-effort — never throws.
 */
async function freePortRange(from: number, to: number): Promise<void> {
  process.stdout.write(`Freeing ports ${from}–${to} …\n`);
  const pids = await pidsListeningOnPorts(from, to);
  if (pids.length === 0) {
    process.stdout.write('  (no listeners found)\n');
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
      process.stdout.write(`  killed pid ${pid}\n`);
    } catch {
      // already gone / permission denied
    }
  }
}

/** Try preferred … preferred+PORT_ATTEMPTS-1; returns bound server + port. */
async function tryBindPortRange(
  preferred: number,
): Promise<{ server: ReturnType<typeof createServer>; port: number } | null> {
  let port = preferred;
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    try {
      const server = await listen(port);
      return { server, port };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }
  return null;
}

/**
 * Bind the dashboard HTTP server (daemon use). Does not open a browser and
 * does not wait for Ctrl+C — caller owns process lifetime / pid file.
 */
export async function serveDashboardHttp(options: {
  port?: number;
}): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const preferred = options.port ?? DEFAULT_PORT;
  const last = preferred + PORT_ATTEMPTS - 1;

  let bound = await tryBindPortRange(preferred);
  if (!bound) {
    await freePortRange(preferred, last);
    bound = await tryBindPortRange(preferred);
  }

  if (!bound) {
    throw new Error(
      `could not find a free port in ${preferred}-${last} (all in use).\n` +
        '  Stop a previous dashboard with:  transcodes stop\n' +
        `    macOS/Linux:  lsof -ti tcp:${preferred}-${last} | xargs kill -9\n` +
        '  Or choose another port:  transcodes --port <N>',
    );
  }

  return bound;
}
