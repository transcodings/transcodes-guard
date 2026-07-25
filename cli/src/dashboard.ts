/**
 * Local web dashboard — token config, onboarding guideline, read-only RBAC view.
 *
 * Binds to 127.0.0.1 only. Saves tokens via the same writeTokenToFile as
 * `transcodes set` / `reset`. RBAC create/update/delete is console-only.
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { promisify } from 'node:util';
import { TRANSCODES_GUARD_REPO_URL } from '@transcodes-guard/core/contract';
import {
  clearTokenFile,
  fetchMemberProfile,
  loadStepupConfig,
  openConsoleSession,
  parseMemberAccessToken,
  readTokenFromFile,
  readTokenList,
  readTokenRecords,
  removeTokenFromFile,
  resolveToken,
  setActiveToken,
  setTokenLabel,
  transcodesConfigFile,
  writeTokenToFile,
} from '@transcodes-guard/core/stepup';
import { renderCliCommandsHtml } from './commands.js';
import { LOGO_DATA_URI } from './logo.js';
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
/** Temporary Mux playback id for the Guideline onboarding video. */
const GUIDELINE_MUX_PLAYBACK_ID =
  'h1vOCPmFDA02fGhcout01FZWD4lpKNTzLFk7vybxvrc3M';
/**
 * Console org base — deep-links append
 * `/{organizationId}/project/{projectId}/{members|permissions|logs|settings}`.
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
};

type StatusPayload = {
  configPath: string;
  tokens: TokenEntry[];
  activeMember: ActiveMemberInfo | null;
};

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
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
    const profile = await fetchMemberProfile(config);
    if (profile) {
      return { ...base, ...profile };
    }
  } catch {
    // Profile fetch is best-effort — JWT claims still populate the header.
  }

  return base;
}

async function buildStatus(): Promise<StatusPayload> {
  return {
    configPath: transcodesConfigFile(),
    tokens: buildTokenEntries(),
    activeMember: await buildActiveMemberInfo(),
  };
}

/** Find a stored token by its fingerprint id. */
function tokenById(id: string): string | undefined {
  return readTokenList().find((t) => fingerprint(t) === id);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(JSON.stringify(body));
}

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcodes — CLI Panel</title>
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
      --card-max: 780px;
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
    .header-profile-info { min-width: 0; }
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
    .header-profile-meta code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-2xs);
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line);
      padding: 1px 6px;
      border-radius: 6px;
    }
    .btn-manage-auth {
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
      transition: opacity 0.15s ease, transform 0.15s ease;
    }
    .btn-manage-auth svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    .btn-manage-auth:hover:not(:disabled) { opacity: 0.92; }
    .btn-manage-auth:disabled {
      opacity: 0.55;
      cursor: not-allowed;
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
      gap: 8px;
      font-size: var(--text-2xs);
      font-weight: 600;
      color: var(--muted);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
      box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.22);
    }
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
    .sub-tabs {
      margin-top: 0;
      margin-bottom: 22px;
    }
    .rbac-pane { display: none; }
    .rbac-pane.active { display: block; }
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
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--ink);
      background: #fff;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .guide-video-toggle:hover {
      background: #f7f7f9;
      border-color: #d8d8de;
    }
    .guide-video-toggle[aria-expanded="true"] {
      color: var(--accent);
      border-color: rgba(91, 84, 230, 0.35);
      background: var(--accent-soft);
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
    .guide-step-summary .guide-step-title { margin: 0; flex: 1; min-width: 0; }
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
      color: #b9b9c2;
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
  <div class="card">
    <div class="header">
      <div class="header-top">
        <a class="header-logo-link" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer" aria-label="Open Transcodes console">
          <img class="avatar" src="${LOGO_DATA_URI}" alt="Transcodes" />
        </a>
        <div class="header-body">
          <div class="header-title-row">
            <h1><a class="header-title-link" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer">Transcodes</a> CLI Panel</h1>
            <span class="header-status">
              <span class="status-dot" aria-hidden="true"></span>
              Connected
            </span>
          </div>
          <p class="header-tagline">Manage credentials and view RBAC from one panel — no CLI typing required</p>
        </div>
      </div>
      <div id="header-token-empty" class="header-token-empty" hidden>
        <p class="header-token-empty-title">No Transcodes CLI authorization found</p>
        <p class="header-token-empty-title">Sign in with Google and choose an organization:</p>
        <div class="header-token-empty-cmds">
          <code>transcodes login</code>
        </div>
      </div>
      <div class="header-profile" id="header-profile" hidden>
        <div class="header-profile-info">
          <div class="header-profile-name" id="header-profile-name"></div>
          <div class="header-profile-meta" id="header-profile-meta"></div>
        </div>
        <div class="header-profile-actions">
          <button type="button" class="btn-manage-auth" id="manage-auth-btn" data-console-open aria-label="Open Transcodes console">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33" />
            </svg>
            Console
          </button>
          <p class="header-profile-cli-hint"><code>transcodes console</code></p>
        </div>
      </div>
    </div>
    <div class="tabs">
      <button type="button" class="tab active" data-tab="guideline">Guideline</button>
      <button type="button" class="tab" data-tab="tokens">Tokens</button>
      <button type="button" class="tab" data-tab="rbac">RBAC</button>
      <button type="button" class="tab" data-tab="cli">CLI Commands</button>
    </div>

    <div class="panel active" id="panel-guideline">
      <div class="section-title-row">
        <p class="section-title">Getting Started</p>
        <button type="button" class="guide-video-toggle" id="guide-video-toggle" aria-expanded="false" aria-controls="guide-video">
          Watch Intro Video
        </button>
      </div>
      <p class="section-sub">Transcodes CLI Dashboard,Set it up visually — no terminal required. New to Transcodes? Watch the video.</p>
      <div class="guide-video-wrap">
        <div class="guide-video" id="guide-video" hidden>
          <mux-player
            playback-id="${GUIDELINE_MUX_PLAYBACK_ID}"
            stream-type="on-demand"
            accent-color="#5b54e6"
            primary-color="#ffffff"
            metadata-video-title="Transcodes CLI onboarding"
          ></mux-player>
        </div>
      </div>
      <p class="section-title section-title--spaced">Quick Demo</p>
      <p class="guide-prefix-note">Try the quick demo to see how Transcodes works</p>
      <p class="guide-prefix-note">Prefix prompts with <code class="cli-cmd">/transcodes</code> on Claude, Cursor, and Antigravity — use <code class="cli-cmd">$transcodes</code> on ChatGPT (Codex).</p>
      <div class="guide-groups">
        <section class="guide-group guide-group--panel">
          <ol class="guide-steps">
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">1</span>
                  <span class="guide-step-title">Open your CLI or desktop app (Claude, Cursor, Antigravity, ChatGPT)</span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">If it's already running, restart it so the latest plugin and token are loaded</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">2</span>
                  <span class="guide-step-title">Trigger a step-up test</span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Ask the agent to run a protected action — it should prompt for step-up authentication</p>
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
          </ol>
        </section>
      </div>

      <p class="section-title section-title--spaced">Steps</p>
      <div class="guide-groups">
        <section class="guide-group guide-group--panel">
          <ol class="guide-steps">
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">1</span>
                  <span class="guide-step-title">Configure RBAC in the Transcodes app</span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Set up resources, actions, and roles in the <a href="${APP_ORG_URL}" data-app-tab="rbac" target="_blank" rel="noopener noreferrer">Transcodes app</a>. You can review the resulting RBAC permissions read-only in this CLI panel's RBAC tab</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">2</span>
                  <span class="guide-step-title">Register a passkey or biometrics</span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Click the <button type="button" class="guide-console-link" data-console-open>Console</button> button (or run <code class="cli-cmd">transcodes console</code> in your terminal), sign in, then register a passkey or biometrics — these are used for step-up authentication</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">3</span>
                  <span class="guide-step-title">Open your CLI or desktop app (Claude, Cursor, Antigravity, ChatGPT)</span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">If it's already running, restart it so the latest plugin and token are loaded</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">4</span>
                  <span class="guide-step-title">Run an action from the agent</span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Try an action in your CLI or desktop app. Transcodes classifies each prompt into a <code>resource:action</code> pair, then applies the permission matrix — <strong>0 deny</strong> · <strong>1 allow (pass)</strong> · <strong>2 step-up MFA</strong>.</p>
                  <ul class="guide-classify-list">
                    <li><span class="guide-classify-prompt">"Create a Google Calendar event"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">google:create</code></li>
                    <li><span class="guide-classify-prompt">"Change James's role in Transcodes"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">transcodes:update</code></li>
                    <li><span class="guide-classify-prompt">"Delete files on my computer"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">system:delete</code></li>
                  </ul>
                  <p class="guide-classify-note">No matching resource? It falls back to <code class="cli-cmd">system</code> automatically — e.g. if there's no <code>google</code> resource, "Create a Google Calendar event" becomes <code class="cli-cmd">system:create</code>.</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">5</span>
                  <span class="guide-step-title">Pull the audit log report</span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Ask the agent for a member audit / security log report — Transcodes maps the prompt to the right resource and enforces RBAC</p>
                  <p class="guide-step-desc">Every action is logged — whether it was 0 deny, 1 allow, or 2 step-up MFA.</p>
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
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">6</span>
                  <span class="guide-step-title">Receive step-up links and notifications on Slack or Discord</span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Want step-up links delivered to Slack or Discord? Go to <a href="${APP_ORG_URL}" data-app-tab="settings" target="_blank" rel="noopener noreferrer">Transcodes Settings</a> and set up a webhook. (More channels coming soon.)</p>
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
        <span class="cli-map-label cli-map-label--title">MCP Access Token</span>
        <code>transcodes set &lt;token&gt; -l &lt;label&gt;</code>
        <button type="button" class="btn-manage-tokens" id="manage-tokens-btn" aria-label="Open Transcodes members page">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
          </svg>
          Manage Tokens
        </button>
      </p>
      <p class="section-sub">Browser login is recommended: <code>transcodes login</code>. Manual token entry remains available for scripts and recovery.</p>
      <textarea id="token" placeholder="eyJhbGciOi…" spellcheck="false" autocomplete="off"></textarea>
      <input type="text" id="label" class="label-input" placeholder="Label (required) — e.g. transcodes-{project_name}-{env}" autocomplete="off" required />
      <div class="actions">
        <button type="button" class="btn-primary" id="save">Save</button>
        <button type="button" class="btn-secondary" id="clear">Clear</button>
      </div>
      <div id="toast" class="toast"></div>
      <p class="cli-map-row cli-map-row--list">
        <span class="cli-map-label">Saved tokens</span>
        <code>transcodes tokens</code>
      </p>
      <div class="token-list" id="token-list"></div>
      <div class="danger-zone">
        <div class="danger-zone-text">
          <p class="cli-map-row cli-map-row--danger">
            <span class="cli-map-label cli-map-label--danger">Reset all tokens</span>
            <code>transcodes reset</code>
          </p>
          <p class="danger-zone-desc">Remove every saved token from this machine</p>
        </div>
        <button type="button" class="btn-danger" id="reset-all">Reset all</button>
      </div>
      <p class="hint">Please read the Guideline tab to learn how to use Transcodes CLI.<br />Stop the background dashboard with <code>transcodes stop</code>.</p>
    </div>

    <div class="panel" id="panel-cli">
      <p class="section-title">CLI Commands</p>
      <p class="section-sub">Run these from your terminal — the dashboard wraps the same actions</p>
      <div class="cmd-list">
        ${renderCliCommandsHtml()}
      </div>
      <p class="hint">Please read the Guideline tab first if you are new to Transcodes CLI.</p>
    </div>

    <div class="panel" id="panel-rbac">
      <p id="rbac-token-warning" class="rbac-token-warning" hidden>Save a Transcodes token(MAT) first</p>
      <div class="guide-help">
        <details class="guide-help-accordion">
          <summary class="guide-help-summary">
            <span class="guide-help-heading">How it works</span>
            <svg class="guide-help-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="guide-help-body">
            <p class="guide-help-line">Try an action in your CLI or desktop app. Transcodes classifies each prompt into a <code class="cli-cmd">resource:action</code> pair, then applies the permission matrix — <strong>0 deny</strong> · <strong>1 allow (pass)</strong> · <strong>2 step-up MFA</strong>.</p>
            <p class="guide-help-line">Resources are matched by <strong>name</strong> and <strong>description</strong>. If nothing matches, it falls back to <code class="cli-cmd">system</code>. Write a concrete description (what the resource covers — e.g. tools, domains, verbs) so the classifier can match accurately. When integrating with your own back office, you can pass <code>resource</code> and <code>action</code> as params to control permissions directly.</p>
            <p class="guide-help-heading">Action Classification</p>
            <ul class="guide-help-list">
              <li><strong>read</strong> — inspect data without changing it (list, get, query, cat, grep, status, describe)</li>
              <li><strong>update</strong> — modify existing data (edit, patch, set, rename, move, config change)</li>
              <li><strong>delete</strong> — remove or destroy data (rm, drop, truncate, purge). Also used for destructive / irreversible mutations (force-push, reset --hard, DROP/TRUNCATE, prod overwrite)</li>
              <li><strong>create</strong> — any other state-changing action (new records, sends, posts, uploads, installs)</li>
            </ul>
            <p class="guide-help-heading">Examples</p>
            <ul class="guide-classify-list">
              <li><span class="guide-classify-prompt">"Create a Google Calendar event"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">google:create</code> <span class="guide-classify-arrow">if <code>google</code> is registered</span> · otherwise <code class="cli-cmd">system:create</code></li>
              <li><span class="guide-classify-prompt">"Post a message to #eng on Slack"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">slack:create</code> <span class="guide-classify-arrow">if <code>slack</code> is registered</span> · otherwise <code class="cli-cmd">system:create</code></li>
              <li><span class="guide-classify-prompt">"Change James's role in Transcodes"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">transcodes:update</code></li>
              <li><span class="guide-classify-prompt">"Retire a Transcodes member"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">transcodes:delete</code></li>
              <li><span class="guide-classify-prompt">"Push this branch to GitHub"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">github:update</code> <span class="guide-classify-arrow">if <code>github</code> is registered</span> · otherwise <code class="cli-cmd">system:update</code></li>
              <li><span class="guide-classify-prompt">"Delete files on my computer"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">system:delete</code></li>
              <li><span class="guide-classify-prompt">"Bash/Shell cat .env" / "read ~/.ssh/id_rsa"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">system:update</code></li>
            </ul>
            <p class="guide-classify-note">Registered resources only. Name/description must match — if the project has no <code>google</code> / <code>slack</code> / <code>github</code> resource, that prompt is classified under <code class="cli-cmd">system</code> instead.</p>
          </div>
        </details>
      </div>
      <div class="rbac-legend">
        <p class="rbac-legend-title">Permission matrix</p>
        <ul class="rbac-legend-levels">
          <li><span class="perm-legend-icon perm-legend-0" aria-hidden="true">○</span> No permission — action does not run</li>
          <li><span class="perm-legend-icon perm-legend-1" aria-hidden="true">●</span> Permission granted — runs immediately, no step-up MFA</li>
          <li><span class="perm-legend-icon perm-legend-2" aria-hidden="true">◉</span> Permission with step-up verification — step-up MFA required before the action runs</li>
        </ul>
      </div>
      <div class="tabs sub-tabs" role="tablist" aria-label="RBAC section">
        <button type="button" class="tab active" data-rbac="resources" role="tab">Resources</button>
        <button type="button" class="tab" data-rbac="roles" role="tab">Roles</button>
      </div>
      <div class="rbac-pane active" id="rbac-pane-resources">
        <p class="section-sub">Configure resources, roles, and permissions. <a href="${APP_ORG_URL}" data-app-tab="rbac" target="_blank" rel="noopener noreferrer">Edit RBAC Permissions</a></p>
        <div class="rbac-table-wrap">
          <table class="rbac-table" id="resources-table">
            <thead><tr><th>Resource</th><th>Description</th></tr></thead>
            <tbody id="resources-tbody"></tbody>
          </table>
        </div>
      </div>
      <div class="rbac-pane" id="rbac-pane-roles">
        <p class="section-sub">Select a role to view its permission matrix · <a href="${APP_ORG_URL}" data-app-tab="rbac" target="_blank" rel="noopener noreferrer">Edit RBAC Permissions</a></p>
        <div class="role-picker" id="role-picker"></div>
        <div id="matrix-wrap" hidden>
          <p class="list-label" id="matrix-role-label"></p>
          <div class="rbac-table-wrap">
            <table class="rbac-table matrix-table" id="matrix-table">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Create</th>
                  <th>Read</th>
                  <th>Update</th>
                  <th>Delete</th>
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

  <p class="dashboard-footer">
    Ver ${CLI_VERSION} <code class="cli-cmd">transcodes version</code>
    <span aria-hidden="true">·</span>
    <a href="${TRANSCODES_GUARD_REPO_URL}" target="_blank" rel="noopener noreferrer">
      <svg class="dashboard-footer-github-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
      GitHub
    </a>
  </p>
  <script>
    const tokenEl = document.getElementById("token");
    const labelEl = document.getElementById("label");
    const toastEl = document.getElementById("toast");
    const listEl = document.getElementById("token-list");
    const saveBtn = document.getElementById("save");
    const clearBtn = document.getElementById("clear");
    const headerTokenEmptyEl = document.getElementById("header-token-empty");
    const headerProfileEl = document.getElementById("header-profile");
    const headerProfileNameEl = document.getElementById("header-profile-name");
    const headerProfileMetaEl = document.getElementById("header-profile-meta");
    const APP_ORG_URL = ${JSON.stringify(APP_ORG_URL)};
    const APP_HOME_URL = ${JSON.stringify(APP_HOME_URL)};

    let lastStatus = { tokens: [], activeMember: null };
    let editingId = null;

    function hasSavedTokens(s) {
      return Array.isArray(s.tokens) && s.tokens.length > 0;
    }

    function appTabToSegment(tab) {
      if (tab === "rbac") return "permissions";
      if (tab === "settings" || tab === "logs" || tab === "members") return tab;
      return "members";
    }

    function appWorkspaceUrl(organizationId, projectId, tab) {
      return (
        APP_ORG_URL +
        "/" +
        encodeURIComponent(organizationId) +
        "/project/" +
        encodeURIComponent(projectId) +
        "/" +
        encodeURIComponent(appTabToSegment(tab))
      );
    }

    function updateAppDeepLinks(s) {
      const oid = s && s.activeMember && s.activeMember.organizationId;
      const pid = s && s.activeMember && s.activeMember.projectId;
      document.querySelectorAll("[data-app-tab]").forEach((a) => {
        const tab = a.getAttribute("data-app-tab");
        if (oid && pid && tab) {
          a.href = appWorkspaceUrl(oid, pid, tab);
        } else if (oid) {
          a.href = APP_ORG_URL + "/" + encodeURIComponent(oid);
        } else {
          a.href = APP_ORG_URL;
        }
      });
    }

    function updateTokenEmptyState() {
      const empty = !hasSavedTokens(lastStatus);
      headerTokenEmptyEl.hidden = !empty;
      if (empty) {
        headerProfileEl.hidden = true;
        updateAppDeepLinks(lastStatus);
        return;
      }
      renderHeaderProfile(lastStatus);
      updateAppDeepLinks(lastStatus);
    }

    async function openConsole() {
      const consoleBtns = document.querySelectorAll("[data-console-open]");
      consoleBtns.forEach((btn) => { btn.disabled = true; });
      try {
        const res = await fetch("/api/console/open", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not open auth settings");
        if (data.browserUrl) window.open(data.browserUrl, "_blank", "noopener,noreferrer");
        showToast("Opening auth settings in your browser", "success");
      } catch (e) {
        showToast(e.message || "Failed to open auth settings", "error");
      } finally {
        consoleBtns.forEach((btn) => { btn.disabled = false; });
      }
    }

    function openManageTokens() {
      const member = lastStatus && lastStatus.activeMember;
      const oid = member && member.organizationId;
      const pid = member && member.projectId;
      const url =
        oid && pid
          ? appWorkspaceUrl(oid, pid, "members")
          : oid
            ? APP_ORG_URL + "/" + encodeURIComponent(oid)
            : APP_HOME_URL;
      window.open(url, "_blank", "noopener,noreferrer");
    }

    const guideVideoToggle = document.getElementById("guide-video-toggle");
    const guideVideo = document.getElementById("guide-video");
    if (guideVideoToggle && guideVideo) {
      guideVideoToggle.addEventListener("click", () => {
        const open = guideVideoToggle.getAttribute("aria-expanded") === "true";
        const next = !open;
        guideVideoToggle.setAttribute("aria-expanded", String(next));
        guideVideo.hidden = !next;
        guideVideoToggle.textContent = next
          ? "Hide Intro Video"
          : "Watch Intro Video";
      });
    }

    document.querySelectorAll(".tab[data-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.getAttribute("data-tab");
        document.querySelectorAll(".tab[data-tab]").forEach((t) =>
          t.classList.toggle("active", t === tab));
        document.querySelectorAll(".panel").forEach((p) =>
          p.classList.toggle("active", p.id === "panel-" + name));
        if (name === "rbac") loadRbac();
      });
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

    function showToast(msg, kind) {
      toastEl.textContent = msg;
      toastEl.className = "toast show " + (kind || "success");
      setTimeout(() => toastEl.classList.remove("show"), 4000);
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }

    function renderHeaderProfile(s) {
      if (!hasSavedTokens(s)) {
        headerProfileEl.hidden = true;
        return;
      }
      const am = s.activeMember;
      if (!am || !am.projectId) {
        headerProfileEl.hidden = true;
        return;
      }
      headerProfileEl.hidden = false;
      const displayName =
        am.name || am.email || am.label || am.memberId || "Member";
      headerProfileNameEl.textContent = displayName;
      const metaParts = [];
      if (am.role) metaParts.push(esc(am.role));
      if (am.email && am.name) metaParts.push(esc(am.email));
      if (am.label && am.label !== displayName) metaParts.push(esc(am.label));
      metaParts.push('Project <code>' + esc(am.projectId) + "</code>");
      headerProfileMetaEl.innerHTML = metaParts.join(" · ");
    }

    function renderTokens(s) {
      if (!s.tokens || s.tokens.length === 0) {
        listEl.innerHTML = '<div class="token-empty">No tokens saved yet — paste one above and press Save</div>';
        updateTokenEmptyState();
        return;
      }

      listEl.innerHTML = s.tokens.map((t) => {
        const editing = t.id === editingId;
        const project = t.projectId
          ? '<div class="field"><span class="k">Project Id</span> <code>' + esc(t.projectId) + '</code></div>'
          : '';
        const org = t.organizationId
          ? '<div class="field"><span class="k">Organization Id</span> <code>' + esc(t.organizationId) + '</code></div>'
          : '';
        const warn = t.warnings && t.warnings.length
          ? '<div class="warn">' + esc(t.warnings.join("; ")) + '</div>'
          : '';
        const labelBlock = editing
          ? '<input type="text" class="label-edit" data-edit-input="' + t.id + '" value="' + esc(t.label || "") + '" placeholder="Label" />'
          : (t.label ? '<div class="label">' + esc(t.label) + '</div>' : '');
        const actions = editing
          ? '<button type="button" class="btn-set" data-save-label="' + t.id + '">SAVE</button>' +
            '<button type="button" class="btn-cancel" data-cancel-edit="1">CANCEL</button>'
          : '<button type="button" class="btn-edit" data-edit="' + t.id + '">EDIT</button>' +
            '<button type="button" class="btn-set" data-set="' + t.id + '"' + (t.active ? " disabled" : "") + '>' +
              (t.active ? "DEFAULT" : "SET DEFAULT") +
            '</button>' +
            '<button type="button" class="btn-del" data-del="' + t.id + '">DELETE</button>';
        return (
          '<div class="token-row' + (t.active ? " active" : "") + '" data-id="' + t.id + '">' +
            '<div class="token-top">' +
              '<span class="radio"></span>' +
              '<div class="token-info">' + labelBlock + org + project + warn + '</div>' +
            '</div>' +
            '<div class="token-actions">' + actions + '</div>' +
          '</div>'
        );
      }).join("");

      if (editingId) {
        const el = listEl.querySelector('[data-edit-input="' + editingId + '"]');
        if (el) { el.focus(); el.select(); }
      }
      updateTokenEmptyState();
    }

    async function refresh() {
      const res = await fetch("/api/status");
      lastStatus = await res.json();
      updateTokenEmptyState();
      renderTokens(lastStatus);
    }

    document.querySelectorAll("[data-console-open]").forEach((btn) => {
      btn.addEventListener("click", () => { openConsole(); });
    });

    const manageTokensBtn = document.getElementById("manage-tokens-btn");
    if (manageTokensBtn) {
      manageTokensBtn.addEventListener("click", () => { openManageTokens(); });
    }

    async function saveLabel(id) {
      const input = listEl.querySelector('[data-edit-input="' + id + '"]');
      const label = input ? input.value.trim() : "";
      if (!label) {
        showToast("Label cannot be empty", "error");
        return;
      }
      try {
        const res = await fetch("/api/label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, label }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Rename failed");
        editingId = null;
        showToast("Label updated", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Rename failed", "error");
      }
    }

    async function setDefault(id) {
      try {
        const res = await fetch("/api/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Set default failed");
        showToast("Default token updated", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Set default failed", "error");
      }
    }

    async function removeToken(id) {
      if (!confirm("Delete this token from the saved list?")) return;
      try {
        const res = await fetch("/api/token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Delete failed");
        showToast("Token deleted", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Delete failed", "error");
      }
    }

    listEl.addEventListener("click", (e) => {
      const editId = e.target.getAttribute("data-edit");
      if (editId) { editingId = editId; renderTokens(lastStatus); return; }
      const saveId = e.target.getAttribute("data-save-label");
      if (saveId) { saveLabel(saveId); return; }
      if (e.target.getAttribute("data-cancel-edit")) {
        editingId = null; renderTokens(lastStatus); return;
      }
      const setId = e.target.getAttribute("data-set");
      if (setId) { setDefault(setId); return; }
      const delId = e.target.getAttribute("data-del");
      if (delId) { removeToken(delId); return; }
    });

    listEl.addEventListener("keydown", (e) => {
      const input = e.target.closest(".label-edit");
      if (!input) return;
      if (e.key === "Enter") { e.preventDefault(); saveLabel(editingId); }
      else if (e.key === "Escape") { editingId = null; renderTokens(lastStatus); }
    });

    saveBtn.addEventListener("click", async () => {
      const token = tokenEl.value.trim();
      const label = labelEl.value.trim();
      if (!token) {
        showToast("Paste a token first", "error");
        return;
      }
      if (!label) {
        showToast("Add a label first", "error");
        labelEl.focus();
        return;
      }
      saveBtn.disabled = true;
      try {
        const res = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, label }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        tokenEl.value = "";
        labelEl.value = "";
        showToast("Token saved", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Save failed", "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    clearBtn.addEventListener("click", () => {
      tokenEl.value = "";
      labelEl.value = "";
      tokenEl.focus();
    });

    const resetAllBtn = document.getElementById("reset-all");
    resetAllBtn.addEventListener("click", async () => {
      const count = (lastStatus.tokens || []).length;
      if (count === 0) {
        showToast("No tokens to reset", "error");
        return;
      }
      if (!confirm("Remove ALL " + count + " saved token(s)? This cannot be undone.")) return;
      resetAllBtn.disabled = true;
      try {
        const res = await fetch("/api/tokens", { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Reset failed");
        showToast("All tokens removed", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Reset failed", "error");
      } finally {
        resetAllBtn.disabled = false;
      }
    });

    const rbacTokenWarningEl = document.getElementById("rbac-token-warning");
    const rbacToastEl = document.getElementById("rbac-toast");
    const resourcesTbody = document.getElementById("resources-tbody");
    const rolePickerEl = document.getElementById("role-picker");
    const matrixWrapEl = document.getElementById("matrix-wrap");
    const matrixRoleLabelEl = document.getElementById("matrix-role-label");
    const matrixTbodyEl = document.getElementById("matrix-tbody");

    let rbacSnapshot = { resources: [], roles: [] };
    let selectedRoleId = null;

    function showRbacToast(msg, kind) {
      rbacToastEl.textContent = msg;
      rbacToastEl.className = "toast show " + (kind || "success");
      setTimeout(() => rbacToastEl.classList.remove("show"), 5000);
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
          '<tr><td colspan="2" style="color:var(--muted);text-align:center;">No resources yet — add them in the Transcodes Console</td></tr>';
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
      matrixRoleLabelEl.textContent = "PERMISSION MATRIX — " + role.name;
      renderMatrix(role.permissions || {});
      renderRolePicker();
      matrixWrapEl.hidden = false;
    }

    function matrixCell(resourceKey, action, permissions) {
      const row = permissions[resourceKey] || {};
      const level = row[action] ?? 0;
      return (
        '<td><span class="' + permCellClass(level) + ' perm-cell-readonly" aria-label="Permission level ' + level + '">' +
        permSymbol(level) +
        "</span></td>"
      );
    }

    function renderMatrix(permissions) {
      const resources = rbacSnapshot.resources || [];
      if (resources.length === 0) {
        matrixTbodyEl.innerHTML =
          '<tr><td colspan="5" style="color:var(--muted);text-align:center;">No resources configured yet</td></tr>';
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
        if (!res.ok) throw new Error(data.error || "Failed to load RBAC");
        rbacSnapshot = data;
        renderResources();
        renderRolePicker();
        if (selectedRoleId) selectRole(selectedRoleId);
      } catch (e) {
        showRbacToast(e.message || "Failed to load RBAC", "error");
      }
    }

    rolePickerEl.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-role-id");
      if (id) selectRole(id);
    });

    refresh();
  </script>
</body>
</html>`;
}

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

function listen(port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = req.url ?? '/';
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

        if (method === 'GET' && url === '/api/status') {
          sendJson(res, 200, await buildStatus());
          return;
        }

        if (method === 'POST' && url === '/api/console/open') {
          const result = await openConsoleSession({ openBrowser: false });
          if (!result.ok) {
            sendJson(res, 400, {
              error:
                result.reason === 'no-token'
                  ? 'No active token — save a token first'
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

        if (method === 'POST' && url === '/api/token') {
          const body = (await readJsonBody(req)) as {
            token?: unknown;
            label?: unknown;
          };
          const token = typeof body.token === 'string' ? body.token.trim() : '';
          const label = typeof body.label === 'string' ? body.label.trim() : '';
          if (!token) {
            sendJson(res, 400, { error: 'token is required' });
            return;
          }
          if (!label) {
            sendJson(res, 400, { error: 'label is required' });
            return;
          }
          try {
            parseMemberAccessToken(token);
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }
          writeTokenToFile(token, label);
          sendJson(res, 200, { ok: true, ...(await buildStatus()) });
          return;
        }

        if (method === 'POST' && url === '/api/label') {
          const body = (await readJsonBody(req)) as {
            id?: unknown;
            label?: unknown;
          };
          const id = typeof body.id === 'string' ? body.id : '';
          const label = typeof body.label === 'string' ? body.label.trim() : '';
          const token = id ? tokenById(id) : undefined;
          if (!token) {
            sendJson(res, 404, { error: 'token not found' });
            return;
          }
          if (!label) {
            sendJson(res, 400, { error: 'label is required' });
            return;
          }
          setTokenLabel(token, label);
          sendJson(res, 200, { ok: true, ...(await buildStatus()) });
          return;
        }

        if (method === 'POST' && url === '/api/select') {
          const body = (await readJsonBody(req)) as { id?: unknown };
          const id = typeof body.id === 'string' ? body.id : '';
          const token = id ? tokenById(id) : undefined;
          if (!token) {
            sendJson(res, 404, { error: 'token not found' });
            return;
          }
          setActiveToken(token);
          sendJson(res, 200, { ok: true, ...(await buildStatus()) });
          return;
        }

        if (method === 'DELETE' && url === '/api/token') {
          const body = (await readJsonBody(req)) as { id?: unknown };
          const id = typeof body.id === 'string' ? body.id : '';
          const token = id ? tokenById(id) : undefined;
          if (!token) {
            sendJson(res, 404, { error: 'token not found' });
            return;
          }
          removeTokenFromFile(token);
          sendJson(res, 200, { ok: true, ...(await buildStatus()) });
          return;
        }

        if (method === 'DELETE' && url === '/api/tokens') {
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
