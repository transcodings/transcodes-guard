/**
 * Local web dashboard for token configuration — Serena-style localhost UI.
 *
 * Binds to 127.0.0.1 only. Saves via the same writeTokenToFile / clearTokenFile
 * as `transcodes set` / `reset`.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  coerceRbacResource,
  DEFAULT_RBAC_ACTION,
  DEFAULT_RBAC_RESOURCE,
  type MergedPattern,
  type RbacAction,
  type ToolRuleChanges,
  ToolRuleValidationError,
} from '@transcodes-guard/danger-patterns';
import {
  clearTokenFile,
  listGuardRules,
  loadEffectivePatterns,
  loadEffectiveToolRules,
  loadStepupConfig,
  parseMemberAccessToken,
  readCachedPolicyBundle,
  readTokenFromFile,
  readTokenList,
  readTokenRecords,
  refreshPolicyBundle,
  removeTokenFromFile,
  setActiveToken,
  setTokenLabel,
  transcodesConfigFile,
  updateToolRule,
  writeTokenToFile,
} from '@transcodes-guard/stepup-core';
import { renderCliCommandsHtml } from './commands.js';
import { LOGO_DATA_URI } from './logo.js';
import { buildAdminToolsPayload } from './tool-catalog.js';

const DEFAULT_PORT = 3847;
const HOST = '127.0.0.1';
/** Temporary Mux playback id for the Guideline onboarding video. */
const GUIDELINE_MUX_PLAYBACK_ID =
  'kGqw1lDd4stSZmYsswFuw02EeFnCtBwgGj6HCJxIb4Vc';

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

type StatusPayload = {
  configPath: string;
  envOverridesFile: boolean;
  tokens: TokenEntry[];
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

function buildStatus(): StatusPayload {
  const configPath = transcodesConfigFile();
  const records = readTokenRecords();
  const active = readTokenFromFile();
  const envOverridesFile = Boolean(
    process.env.TRANSCODES_TOKEN?.trim() && active,
  );

  const tokens: TokenEntry[] = records.map(({ token, label }) => {
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

  return { configPath, envOverridesFile, tokens };
}

/** Find a stored token by its fingerprint id. */
function tokenById(id: string): string | undefined {
  return readTokenList().find((t) => fingerprint(t) === id);
}

type DashboardProjectRule = {
  id: string;
  type: 'mcp' | 'bash';
  label: string;
  description: string;
  name: string;
  matcher: string;
  action?: string;
  resource?: string;
  status?: 'active' | 'inactive';
  provider?: string;
};

type ProjectRulesPayload = {
  project: DashboardProjectRule[];
  system: MergedPattern[];
  error?: string;
};

function guardRecordToDashboardRule(
  r: Awaited<ReturnType<typeof listGuardRules>>[number],
): DashboardProjectRule {
  return {
    id: r.id,
    type: r.type,
    label: r.label,
    description: r.description,
    name: r.name,
    matcher: r.matcher,
    status: r.status,
    ...(r.action !== undefined ? { action: r.action } : {}),
    ...(r.resource !== undefined
      ? { resource: coerceRbacResource(r.resource) }
      : {}),
    ...(r.provider !== undefined ? { provider: r.provider } : {}),
  };
}

/** Project rules from cache-only fallback. */
function buildProjectRulesFromCache(): ProjectRulesPayload {
  const system = loadEffectivePatterns().filter((p) => p.source === 'system');
  const mcp = loadEffectiveToolRules()
    .filter((r) => r.source === 'bundle')
    .map(
      (r): DashboardProjectRule => ({
        id: r.id,
        type: 'mcp',
        label: r.label,
        description: r.description,
        name: r.name,
        matcher: r.matcher,
        ...(r.action !== undefined ? { action: r.action } : {}),
        ...(r.resource !== undefined ? { resource: r.resource } : {}),
        ...(r.provider !== undefined ? { provider: r.provider } : {}),
      }),
    );
  const bash = loadEffectivePatterns()
    .filter((p) => p.source === 'bundle')
    .map(
      (p): DashboardProjectRule => ({
        id: p.id,
        type: 'bash',
        label: p.id,
        description: p.reason,
        name: p.regex,
        matcher: 'regex',
        action: p.stepupAction,
        resource: p.stepupResource,
      }),
    );
  return { project: [...mcp, ...bash], system };
}

/** Fetch project guard rules (MCP + bash) from the backend, refresh bundle cache. */
async function fetchProjectRulesFromBackend(): Promise<ProjectRulesPayload> {
  const fallback = buildProjectRulesFromCache();
  try {
    const config = loadStepupConfig();
    await refreshPolicyBundle(config, { force: true });
    const rules = await listGuardRules();
    return {
      project: rules.map(guardRecordToDashboardRule),
      system: fallback.system,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...fallback, error: message };
  }
}

async function findProjectRule(
  id: string,
): Promise<DashboardProjectRule | undefined> {
  try {
    const rules = await listGuardRules();
    const found = rules.find((r) => r.id === id);
    return found ? guardRecordToDashboardRule(found) : undefined;
  } catch {
    return buildProjectRulesFromCache().project.find((r) => r.id === id);
  }
}

/** Display-only CRUD hint for catalog tools not in tool-rules.json. */
function inferCatalogRbacAction(toolName: string): RbacAction {
  if (toolName.startsWith('get_') || toolName.startsWith('list_'))
    return 'read';
  if (toolName.startsWith('create_') || toolName.endsWith('_create'))
    return 'create';
  if (toolName.startsWith('retire_') || toolName.startsWith('remove_'))
    return 'delete';
  return DEFAULT_RBAC_ACTION;
}

/** Admin MCP catalog enriched with RBAC coordinates from tool-rules (when gated). */
function buildAdminToolsPayloadEnriched() {
  const payload = buildAdminToolsPayload();
  const ruleByName = new Map(loadEffectiveToolRules().map((r) => [r.name, r]));
  const tools = payload.tools.map((t) => {
    const rule = ruleByName.get(t.mcpToolName);
    return {
      ...t,
      rbacGated: !!rule,
      rbacResource: rule?.resource ?? DEFAULT_RBAC_RESOURCE,
      rbacAction: rule?.action ?? inferCatalogRbacAction(t.name),
    };
  });
  tools.sort((a, b) => {
    if (a.rbacGated !== b.rbacGated) return a.rbacGated ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return { ...payload, tools };
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
  <title>Transcodes — Token</title>
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
      align-items: flex-start;
      justify-content: center;
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
      align-items: center;
      gap: 16px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line);
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
    .section-sub {
      font-size: var(--text-base);
      color: var(--muted);
      margin: 0 0 16px;
    }
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
    .cli-map-row code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 6px;
      font-size: var(--text-2xs);
      font-weight: 600;
    }
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
    .policy-refresh-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 18px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fbfbfc;
    }
    .policy-refresh-bar .cli-map-row { margin: 0; flex: 1; min-width: 0; }
    .list-label {
      margin: 26px 0 10px;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--muted);
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
    .tool-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .tool-badge {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #fff;
      color: #5a5a64;
    }
    .tool-badge.rbac-gated { color: #8a3ffc; border-color: #d4b8ff; background: #f6f0ff; }
    .rbac-legend {
      margin: 0 0 16px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid #e8e0ff;
      background: linear-gradient(180deg, #faf8ff 0%, #fff 100%);
    }
    .rbac-legend-title {
      margin: 0 0 6px;
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
    }
    .rbac-legend-desc {
      margin: 0 0 10px;
      font-size: var(--text-xs);
      color: #5a5a64;
      line-height: 1.5;
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
    .perm-chip {
      flex-shrink: 0;
      min-width: 92px;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 999px;
      text-align: center;
      border: 1px solid var(--line);
      background: #fff;
    }
    .perm-chip-0 { color: #9a3412; border-color: #fdba74; background: #fff7ed; }
    .perm-chip-1 { color: #166534; border-color: #86efac; background: #f0fdf4; }
    .perm-chip-2 { color: #7c3aed; border-color: #d8b4fe; background: #faf5ff; }
    .field-k-rbac { color: #8a3ffc; font-weight: 600; }
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
    .guide-video {
      margin: 0 0 22px;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid var(--line);
      background: #000;
      aspect-ratio: 16 / 9;
      box-shadow: 0 8px 28px rgba(22, 22, 26, 0.08);
    }
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
    .guide-step-title {
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
      margin: 0 0 4px;
    }
    .guide-step-desc {
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.5;
      margin: 0;
    }
    .guide-step-desc code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-2xs);
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line);
      padding: 1px 6px;
      border-radius: 6px;
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
      padding: 16px 18px;
      background: var(--accent-soft);
      border: 1px solid rgba(91, 84, 230, 0.18);
      border-radius: 14px;
    }
    .guide-help-line {
      margin: 0;
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
  </style>
  <script type="module" src="https://cdn.jsdelivr.net/npm/@mux/mux-player"></script>
</head>
<body>
  <div class="card">
    <div class="header">
      <a class="header-logo-link" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer" aria-label="Open Transcodes console">
        <img class="avatar" src="${LOGO_DATA_URI}" alt="Transcodes" />
      </a>
      <div>
        <div class="header-title-row">
          <h1><a class="header-title-link" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer">Transcodes</a> CLI Panel</h1>
          <span class="header-status">
            <span class="status-dot" aria-hidden="true"></span>
            Connected
          </span>
        </div>
        <p class="header-tagline">Manage credentials and rules from one panel — no CLI typing required</p>
      </div>
    </div>
    <div class="tabs">
      <button type="button" class="tab active" data-tab="guideline">Guideline</button>
      <button type="button" class="tab" data-tab="tokens">Tokens</button>
      <button type="button" class="tab" data-tab="rules">Rules</button>
      <button type="button" class="tab" data-tab="cli">CLI Commands</button>
    </div>

    <div class="panel active" id="panel-guideline">
      <p class="section-title">Getting Started</p>
      <p class="section-sub">New to Transcodes? Watch the walkthrough, then follow the steps below</p>
      <div class="guide-help">
        <p class="guide-help-line">Questions or trouble setting up? <a href="https://www.transcodes.io/booking" target="_blank" rel="noopener noreferrer">Book a schedule with us →</a></p>
        <p class="guide-help-line">Full documentation: <a href="https://www.transcodes.io/docs" target="_blank" rel="noopener noreferrer">https://www.transcodes.io/docs</a></p>
      </div>
      <div class="guide-video">
        <mux-player
          playback-id="${GUIDELINE_MUX_PLAYBACK_ID}"
          stream-type="on-demand"
          accent-color="#5b54e6"
          primary-color="#ffffff"
          metadata-video-title="Transcodes CLI onboarding"
        ></mux-player>
      </div>
      <p class="list-label">Quick setup</p>
      <div class="guide-groups">
        <section class="guide-group guide-group--console">
          <a class="guide-group-label" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer">Transcodes Console<span class="guide-group-link-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span></a>
          <ol class="guide-steps">
            <li class="guide-step">
              <span class="guide-step-num">1</span>
              <div class="guide-step-body">
                <p class="guide-step-title">Create a project</p>
                <p class="guide-step-desc">Create a new project for your app</p>
              </div>
            </li>
            <li class="guide-step">
              <span class="guide-step-num">2</span>
              <div class="guide-step-body">
                <p class="guide-step-title">Create an authentication cluster</p>
                <p class="guide-step-desc">Add an authentication cluster to define how members sign in and authenticate</p>
              </div>
            </li>
            <li class="guide-step">
              <span class="guide-step-num">3</span>
              <div class="guide-step-body">
                <p class="guide-step-title">Add a member</p>
                <p class="guide-step-desc">Invite or add a member so they can be issued an access token</p>
              </div>
            </li>
            <li class="guide-step">
              <span class="guide-step-num">4</span>
              <div class="guide-step-body">
                <p class="guide-step-title">Issue an access token</p>
                <p class="guide-step-desc">Open the member detail page and issue a Member Access Token (MAT) for the agent</p>
              </div>
            </li>
          </ol>
        </section>

        <section class="guide-group guide-group--panel">
          <p class="guide-group-label">This CLI panel</p>
          <ol class="guide-steps">
            <li class="guide-step">
              <span class="guide-step-num">5</span>
              <div class="guide-step-body">
                <p class="guide-step-title">Save the token</p>
                <p class="guide-step-desc">Paste the token in the Tokens tab with a label (e.g. <code>transcodes-myapp-dev</code>) — the plugin reads it from <code>{{HOME_DIR}}/.transcodes/config.json</code></p>
              </div>
            </li>
          </ol>
        </section>

        <section class="guide-group guide-group--agent">
          <p class="guide-group-label">LLM agent (Claude, Cursor, Codex, Antigravity)</p>
          <ol class="guide-steps">
            <li class="guide-step">
              <span class="guide-step-num">6</span>
              <div class="guide-step-body">
                <p class="guide-step-title">Ask your local agent to add a custom rule</p>
                <p class="guide-step-desc">Use <code>add_tool_rule</code> or <code>add_user_pattern</code> — on first registration, rules are <code>inactive</code> and not applied to MCP</p>
              </div>
            </li>
          </ol>
        </section>

        <section class="guide-group guide-group--console">
          <a class="guide-group-label" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer">Transcodes Console<span class="guide-group-link-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span></a>
          <ol class="guide-steps">
            <li class="guide-step">
              <span class="guide-step-num">7</span>
              <div class="guide-step-body">
                <p class="guide-step-title">Approve the rule</p>
                <p class="guide-step-desc">Switch the rule to <code>active</code> — only then is it enforced on MCP</p>
              </div>
            </li>
          </ol>
        </section>

        <section class="guide-group guide-group--panel">
          <p class="guide-group-label">This CLI panel</p>
          <ol class="guide-steps">
            <li class="guide-step">
              <span class="guide-step-num">8</span>
              <div class="guide-step-body">
                <p class="guide-step-title">Refresh active rules locally</p>
                <p class="guide-step-desc guide-step-desc-row">
                  Run terminal <code>transcodes policy refresh</code> or
                  <button type="button" class="btn-inline-action" id="guide-policy-refresh">Refresh</button>
                </p>
                <div id="guide-toast" class="toast"></div>
              </div>
            </li>
          </ol>
        </section>
      </div>
    </div>

    <div class="panel" id="panel-tokens">
      <p class="cli-map-row cli-map-row--section">
        <span class="cli-map-label cli-map-label--title">MCP Access Token</span>
        <code>transcodes set &lt;token&gt; -l &lt;label&gt;</code>
      </p>
      <p class="section-sub">Paste the token from your Transcodes console member detail page</p>
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
      <p class="hint">Saved to <code>{{HOME_DIR}}/.transcodes/config.json</code><br />Press Ctrl+C in the terminal to stop</p>
    </div>

    <div class="panel" id="panel-cli">
      <p class="section-title">CLI Commands</p>
      <p class="section-sub">Run these from your terminal — the dashboard wraps the same actions</p>
      <div class="cmd-list">
        ${renderCliCommandsHtml()}
      </div>
    </div>

    <div class="panel" id="panel-rules">
      <p id="policy-token-warning" class="policy-token-warning" hidden>transcodes를 로컬 에이전트에서 이용하기 위해선 토큰이 하나 이상 등록이 되어야 합니다</p>
      <div class="tabs sub-tabs" role="tablist" aria-label="Rule type">
        <button type="button" class="tab active" data-policy="project" role="tab">Project</button>
        <button type="button" class="tab" data-policy="admin" role="tab">Transcodes</button>
      </div>
      <div class="policy-pane active" id="policy-pane-project">
        <p class="section-title">Custom Project Step-up Rules</p>
        <p class="section-sub">When an active rule matches an agent action, Transcodes step-up authentication is triggered. Rules are registered only from your local agent; activating and deleting them is done in the Transcodes web console</p>
        <div class="usage">
          <p class="usage-title">How rules work</p>
          <ol class="usage-steps">
            <li><strong>Register from the local agent only</strong> Ask your agent to call <code>add_tool_rule</code> (MCP tool, full wire name in <code>name</code>) or <code>add_user_pattern</code> (Bash regex, verified with <code>simulate_command</code>). The console cannot create rules</li>
            <li><strong>New rules are inactive</strong> A registered rule has no effect until you switch it to <code>active</code> in the Transcodes web console — only then is it enforced</li>
            <li><strong>Deleting is web-console-only</strong> Neither the agent nor this dashboard can delete rules; remove them in the Transcodes web console</li>
            <li><strong>Bash pairs with MCP only when bypassable</strong> A Bash rule is registered alongside an MCP tool rule only when the same action can be invoked through a CLI (e.g. <code>gh</code>, <code>git</code>, <code>curl</code>); otherwise just the MCP rule is created</li>
          </ol>
          <div class="usage-prompt">
            <span class="q">Just say this to your agent in plain language →</span><br />
            <strong class="usage-example">"Create a transcodes custom rule for adding a Google Calendar event"</strong><br />
            <span class="q">→ the agent registers it as <code>inactive</code>; activate it in the Transcodes web console to start enforcing</span>
          </div>
        </div>
        <div class="policy-refresh-bar">
          <p class="cli-map-row">
            <span class="cli-map-label cli-map-label--ink">Refresh Custom Project Rules</span>
            <code>transcodes policy refresh</code>
          </p>
          <button type="button" class="btn-inline-action" id="policy-refresh">Refresh</button>
        </div>
        <div id="rules-toast" class="toast"></div>
        <p class="list-label">Your Project MCP Rules</p>
        <div class="token-list" id="project-rules-list"></div>
        <p class="list-label">System bash patterns (read-only)</p>
        <div class="token-list" id="system-patterns-list"></div>
      </div>

      <div class="policy-pane" id="policy-pane-admin">
        <p class="section-title">Transcodes MCP Rules</p>
        <p class="section-sub">Backend API tools exposed via MCP — agents call these through the transcodes-guard plugin. Read-only reference for system tool-rules.</p>
        <div class="rbac-legend">
          <p class="rbac-legend-title">Role permission check</p>
          <p class="rbac-legend-desc">Tools with the <strong>Role permission check</strong> badge are gated: your role in Transcodes console (<strong>Roles</strong> tab) decides block / allow / step-up MFA at call time. Other tools run with your MCP token only — no RBAC coordinate is shown because none applies.</p>
          <ul class="rbac-legend-levels">
            <li><span class="perm-chip perm-chip-0">0 · Block</span> Denied — the tool does not run</li>
            <li><span class="perm-chip perm-chip-1">1 · Allow</span> Runs immediately — no step-up MFA</li>
            <li><span class="perm-chip perm-chip-2">2 · Step-up</span> Step-up MFA required before the tool runs</li>
          </ul>
        </div>
        <p class="admin-tools-count" id="admin-tools-count"></p>
        <div class="token-list" id="admin-tools-list"></div>
      </div>
    </div>
  </div>
  <script>
    const tokenEl = document.getElementById("token");
    const labelEl = document.getElementById("label");
    const toastEl = document.getElementById("toast");
    const listEl = document.getElementById("token-list");
    const saveBtn = document.getElementById("save");
    const clearBtn = document.getElementById("clear");
    const policyTokenWarningEl = document.getElementById("policy-token-warning");

    function updatePolicyTokenWarning() {
      const empty = !lastStatus.tokens || lastStatus.tokens.length === 0;
      policyTokenWarningEl.hidden = !empty;
    }

    document.querySelectorAll(".tab[data-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.getAttribute("data-tab");
        document.querySelectorAll(".tab[data-tab]").forEach((t) =>
          t.classList.toggle("active", t === tab));
        document.querySelectorAll(".panel").forEach((p) =>
          p.classList.toggle("active", p.id === "panel-" + name));
        if (name === "rules") {
          updatePolicyTokenWarning();
          loadProjectRules();
          loadAdminTools();
        }
      });
    });

    document.querySelectorAll("#panel-rules .tab[data-policy]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.getAttribute("data-policy");
        document.querySelectorAll("#panel-rules .tab[data-policy]").forEach((t) =>
          t.classList.toggle("active", t === tab));
        document.querySelectorAll("#panel-rules .policy-pane").forEach((p) =>
          p.classList.toggle("active", p.id === "policy-pane-" + name));
        if (name === "project") loadProjectRules();
        if (name === "admin") loadAdminTools();
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

    let lastStatus = { tokens: [] };
    let editingId = null;

    function renderTokens(s) {
      if (!s.tokens || s.tokens.length === 0) {
        listEl.innerHTML = '<div class="token-empty">No tokens saved yet — paste one above and press Save</div>';
        updatePolicyTokenWarning();
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
      updatePolicyTokenWarning();
    }

    async function refresh() {
      const res = await fetch("/api/status");
      lastStatus = await res.json();
      renderTokens(lastStatus);
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

    const rulesToastEl = document.getElementById("rules-toast");
    const projectRulesListEl = document.getElementById("project-rules-list");
    const systemPatternsListEl = document.getElementById("system-patterns-list");
    const adminToolsListEl = document.getElementById("admin-tools-list");
    const adminToolsCountEl = document.getElementById("admin-tools-count");

    function showRulesToast(msg, kind) {
      rulesToastEl.textContent = msg;
      rulesToastEl.className = "toast show " + (kind || "success");
      setTimeout(() => rulesToastEl.classList.remove("show"), 4000);
    }

    let lastProjectRules = { project: [], system: [] };
    let ruleEditingId = null;

    function systemPatternRow(p) {
      return (
        '<div class="token-row">' +
          '<div class="token-top">' +
            '<div class="token-info">' +
              (p.reason ? '<div class="label">' + esc(p.reason) + '</div>' : '') +
              '<div class="field"><span class="k">id</span> <code>' + esc(p.id) + '</code></div>' +
              '<div class="field"><span class="k">pattern</span> <code>' + esc(p.regex) + '</code></div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    function ruleStatusField(status) {
      if (!status) return "";
      const chipClass =
        status === "active"
          ? "status-chip-active"
          : status === "inactive"
            ? "status-chip-inactive"
            : "";
      const chip = chipClass
        ? '<span class="status-chip ' + chipClass + '">' + esc(status) + "</span>"
        : "<code>" + esc(status) + "</code>";
      const hint =
        status === "inactive"
          ? '<span class="status-hint">Activate in the console to take effect on MCP</span>'
          : "";
      return (
        '<div class="field field-status">' +
          '<span class="k">status</span> ' +
          chip +
          hint +
        "</div>"
      );
    }

    function ruleResourceActionField(r) {
      const resource = r.resource || "—";
      const action = r.action || "—";
      return (
        '<div class="field">' +
          '<span class="k">resource / action</span> ' +
          "<code>" + esc(resource) + "</code> / <code>" + esc(action) + "</code>" +
        "</div>"
      );
    }

    function projectRuleRow(r) {
      const editing = r.id === ruleEditingId;
      const idField = '<div class="field"><span class="k">id</span> <code>' + esc(r.id) + '</code></div>';
      const typeField = '<div class="field"><span class="k">type</span> <code>' + esc(r.type) + '</code></div>';
      const labelField = r.label
        ? '<div class="field"><span class="k">label</span> ' + esc(r.label) + '</div>'
        : '';

      if (editing) {
        return (
          '<div class="token-row active" data-id="' + esc(r.id) + '">' +
            '<div class="token-info">' +
              typeField +
              '<input type="text" class="label-edit rule-edit-description" ' +
                'data-edit-description="' + esc(r.id) + '" value="' + esc(r.description || "") +
                '" placeholder="Description" />' +
              '<input type="hidden" class="rule-edit-name" data-edit-name="' + esc(r.id) +
                '" value="' + esc(r.name) + '" />' +
              idField + labelField +
            '</div>' +
            '<div class="token-actions">' +
              '<button type="button" class="btn-set" data-save-rule="' + esc(r.id) + '">SAVE</button>' +
              '<button type="button" class="btn-cancel" data-cancel-rule="1">CANCEL</button>' +
            '</div>' +
          '</div>'
        );
      }

      const description = r.description
        ? '<div class="label">' + esc(r.description) + '</div>'
        : '';
      const status = ruleStatusField(r.status);
      const resourceAction = ruleResourceActionField(r);
      const matcher =
        '<div class="field"><span class="k">matcher</span> <code>' + esc(r.matcher || (r.type === 'bash' ? 'regex' : 'exact')) + '</code></div>';
      return (
        '<div class="token-row">' +
          '<div class="token-top">' +
            '<div class="token-info">' + description + status + resourceAction + typeField + idField + labelField + matcher + '</div>' +
          '</div>' +
          '<div class="token-actions">' +
            '<button type="button" class="btn-edit" data-edit-rule="' + esc(r.id) + '">EDIT</button>' +
          '</div>' +
        '</div>'
      );
    }

    function renderProjectRules(s) {
      lastProjectRules = s;
      if (s.error && (!s.project || !s.project.length)) {
        projectRulesListEl.innerHTML =
          '<div class="token-empty">' + esc(s.error) + '</div>';
      } else {
        projectRulesListEl.innerHTML =
          s.project && s.project.length
            ? s.project.map((r) => projectRuleRow(r)).join("")
            : '<div class="token-empty">No project rules yet — ask your agent to add one</div>';
      }
      systemPatternsListEl.innerHTML = (s.system || [])
        .map((p) => systemPatternRow(p))
        .join("");
      if (ruleEditingId) {
        const el = projectRulesListEl.querySelector(
          '[data-edit-description="' + ruleEditingId + '"]');
        if (el) { el.focus(); el.select(); }
      }
    }

    async function loadProjectRules() {
      const res = await fetch("/api/project-rules");
      renderProjectRules(await res.json());
    }

    const guideToastEl = document.getElementById("guide-toast");
    function showGuideToast(msg, kind) {
      guideToastEl.textContent = msg;
      guideToastEl.className = "toast show " + (kind || "success");
      setTimeout(() => guideToastEl.classList.remove("show"), 4000);
    }

    async function runPolicyRefresh(btn, showToastFn) {
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Refreshing…";
      try {
        const res = await fetch("/api/policy/refresh", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Refresh failed");
        const detail = data.revision != null
          ? " (revision " + data.revision + ", " + data.rules + " rules)"
          : "";
        showToastFn(
          (data.outcome === "not-modified" ? "Policy already current" : "Policy bundle refreshed") + detail,
          "success");
        loadProjectRules();
      } catch (e) {
        showToastFn(e.message || "Refresh failed", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    }

    const policyRefreshBtn = document.getElementById("policy-refresh");
    policyRefreshBtn.addEventListener("click", () => runPolicyRefresh(policyRefreshBtn, showRulesToast));
    document.getElementById("guide-policy-refresh").addEventListener(
      "click",
      () => runPolicyRefresh(document.getElementById("guide-policy-refresh"), showGuideToast));

    function findEditingRule(id) {
      return (lastProjectRules.project || []).find((r) => r.id === id);
    }

    async function saveRuleEdit(id) {
      const rule = findEditingRule(id);
      if (!rule) return;
      const descriptionEl = projectRulesListEl.querySelector(
        '[data-edit-description="' + id + '"]');
      const nameEl = projectRulesListEl.querySelector(
        '[data-edit-name="' + id + '"]');
      const description = descriptionEl ? descriptionEl.value.trim() : "";
      const name = nameEl ? nameEl.value.trim() : "";
      if (!name) { showRulesToast("name/pattern cannot be empty", "error"); return; }
      if (!description) { showRulesToast("description cannot be empty", "error"); return; }
      try {
        const res = await fetch("/api/project-rules/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, type: rule.type, name, description }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Update failed");
        ruleEditingId = null;
        showRulesToast("Rule updated", "success");
        renderProjectRules(data);
      } catch (e) {
        showRulesToast(e.message || "Update failed", "error");
      }
    }

    projectRulesListEl.addEventListener("click", async (e) => {
      const editId = e.target.getAttribute("data-edit-rule");
      if (editId) { ruleEditingId = editId; renderProjectRules(lastProjectRules); return; }
      const saveId = e.target.getAttribute("data-save-rule");
      if (saveId) { saveRuleEdit(saveId); return; }
      if (e.target.getAttribute("data-cancel-rule")) {
        ruleEditingId = null; renderProjectRules(lastProjectRules); return;
      }
    });

    projectRulesListEl.addEventListener("keydown", (e) => {
      const input = e.target.closest(".rule-edit-description, .rule-edit-name");
      if (!input || !ruleEditingId) return;
      if (e.key === "Enter") { e.preventDefault(); saveRuleEdit(ruleEditingId); }
      else if (e.key === "Escape") { ruleEditingId = null; renderProjectRules(lastProjectRules); }
    });

    function adminToolRow(t) {
      const badgeHtml = t.rbacGated
        ? '<div class="tool-badges"><span class="tool-badge rbac-gated" title="Outcome follows your role matrix: 0 block, 1 allow, 2 step-up MFA">Role permission check</span></div>'
        : '';
      const rbacFields = t.rbacGated
        ? '<div class="field"><span class="k field-k-rbac">Resource / Action</span> : ' +
          '<code>' + esc(t.rbacResource || 'system') + '</code> / <code>' +
          esc(t.rbacAction || 'update') + '</code></div>'
        : '';
      return (
        '<div class="token-row">' +
          '<div class="token-top">' +
            '<div class="token-info">' +
              '<div class="label">' + esc(t.title) + '</div>' +
              badgeHtml +
              '<p class="tool-desc">' + esc(t.description) + '</p>' +
              rbacFields +
              '<div class="field"><span class="k">name</span> <code>' + esc(t.mcpToolName) + '</code></div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    function renderAdminTools(payload) {
      adminToolsCountEl.textContent = payload.total + " tools registered";
      adminToolsListEl.innerHTML = (payload.tools || [])
        .map((t) => adminToolRow(t))
        .join("");
    }

    async function loadAdminTools() {
      const res = await fetch("/api/admin-tools");
      renderAdminTools(await res.json());
    }

    refresh();
  </script>
</body>
</html>`;
}

function openBrowser(url: string): void {
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
          sendJson(res, 200, buildStatus());
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
          sendJson(res, 200, { ok: true, ...buildStatus() });
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
          sendJson(res, 200, { ok: true, ...buildStatus() });
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
          sendJson(res, 200, { ok: true, ...buildStatus() });
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
          sendJson(res, 200, { ok: true, ...buildStatus() });
          return;
        }

        if (method === 'DELETE' && url === '/api/tokens') {
          clearTokenFile();
          sendJson(res, 200, { ok: true, ...buildStatus() });
          return;
        }

        if (method === 'POST' && url === '/api/policy/refresh') {
          let config: ReturnType<typeof loadStepupConfig>;
          try {
            config = loadStepupConfig();
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }
          const outcome = await refreshPolicyBundle(config, { force: true });
          if (outcome === 'failed') {
            sendJson(res, 502, {
              error:
                'policy bundle refresh failed — previous cache (if any) kept',
            });
            return;
          }
          const cached = readCachedPolicyBundle(config.projectId);
          sendJson(res, 200, {
            ok: true,
            outcome,
            revision: cached?.bundle.revision,
            rules: cached?.bundle.rules.length,
          });
          return;
        }

        if (method === 'GET' && url === '/api/project-rules') {
          sendJson(res, 200, await fetchProjectRulesFromBackend());
          return;
        }

        if (method === 'POST' && url === '/api/project-rules/update') {
          const body = (await readJsonBody(req)) as {
            id?: unknown;
            type?: unknown;
            name?: unknown;
            description?: unknown;
          };
          const id = typeof body.id === 'string' ? body.id : '';
          const type =
            body.type === 'bash' || body.type === 'mcp' ? body.type : undefined;
          const name =
            typeof body.name === 'string' ? body.name.trim() : undefined;
          const description =
            typeof body.description === 'string'
              ? body.description.trim()
              : undefined;
          if (!id) {
            sendJson(res, 400, { error: 'id is required' });
            return;
          }
          if (!type) {
            sendJson(res, 400, { error: 'type must be "mcp" or "bash"' });
            return;
          }
          if (name === undefined && description === undefined) {
            sendJson(res, 400, {
              error: 'provide at least one of name or description',
            });
            return;
          }
          const existing = await findProjectRule(id);
          if (!existing || existing.type !== type) {
            sendJson(res, 400, {
              error: `no project ${type} rule with id "${id}"`,
            });
            return;
          }
          try {
            const changes: ToolRuleChanges = { type };
            if (description !== undefined) {
              changes.description = description;
              if (type === 'bash') {
                changes.label = description;
              }
            }
            if (name !== undefined) {
              changes.name = name;
              if (type === 'bash') {
                changes.matcher = 'regex';
              }
            }
            const saved = await updateToolRule(id, changes);
            sendJson(res, 200, {
              ok: true,
              saved,
              ...(await fetchProjectRulesFromBackend()),
            });
          } catch (err) {
            if (err instanceof ToolRuleValidationError) {
              sendJson(res, 400, { error: err.message });
              return;
            }
            throw err;
          }
          return;
        }

        if (method === 'GET' && url === '/api/admin-tools') {
          sendJson(res, 200, buildAdminToolsPayloadEnriched());
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

/** Wait for Ctrl+C / SIGTERM; force-exit on a second signal or after a timeout. */
function waitForDashboardShutdown(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  return new Promise((resolve) => {
    let shuttingDown = false;
    let forceTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (forceTimer) clearTimeout(forceTimer);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    const forceExit = () => {
      cleanup();
      process.stderr.write('\nForce stopping dashboard.\n');
      process.exit(0);
    };

    const onSignal = () => {
      if (shuttingDown) {
        forceExit();
        return;
      }
      shuttingDown = true;
      process.stderr.write('\nStopping dashboard…\n');

      forceTimer = setTimeout(forceExit, 1500);
      forceTimer.unref();

      // Idle keep-alive tabs can otherwise leave close() pending forever.
      server.closeAllConnections?.();
      server.close((err) => {
        if (err) {
          process.stderr.write(
            `Shutdown error: ${
              err instanceof Error ? err.message : String(err)
            }\n`,
          );
        }
        finish();
      });
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}

export async function runDashboard(options: {
  port?: number;
  open?: boolean;
}): Promise<void> {
  const preferred = options.port ?? DEFAULT_PORT;
  let server: ReturnType<typeof createServer> | undefined;
  let port = preferred;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      server = await listen(port);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }

  if (!server) {
    const last = preferred + 9;
    throw new Error(
      `could not find a free port in ${preferred}-${last} (all in use).\n` +
        '  A previous dashboard is probably still running.\n' +
        '  Tip: Ctrl+Z only suspends the process (port stays taken) — run `kill %1` or `fg` then Ctrl+C.\n' +
        '  Free the ports and retry:\n' +
        `    macOS/Linux:  lsof -ti tcp:${preferred}-${last} | xargs kill -9\n` +
        `    any platform: npx kill-port ${preferred} ${
          preferred + 1
        }  # repeat per port\n` +
        '  Or choose another port:  transcodes --port <N>',
    );
  }

  const url = `http://${HOST}:${port}/`;
  process.stdout.write(
    `Transcodes dashboard running at ${url}\n` +
      `  Config file: ${transcodesConfigFile()}\n` +
      '  Press Ctrl+C to stop\n',
  );

  if (options.open !== false) {
    openBrowser(url);
  }

  await waitForDashboardShutdown(server);
}
