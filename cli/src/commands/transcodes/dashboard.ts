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
import {
  HttpError,
  hasJsonContentType,
  isAllowedRequestOrigin,
  statusForError,
} from './dashboard-csrf.js';
import { getGlobalPersonaSyncTargets } from './host-apps.js';
import { beginCliLogin } from './login.js';
import { LOGO_DATA_URI } from './logo.js';
import { PWA_MANIFEST } from './manifest.js';
import {
  createPersona,
  createSkillFolder,
  defaultPersonaRoot,
  deletePersona,
  deletePersonaFile,
  deleteSkillPath,
  deployPersona,
  listPersona,
  listPersonaIds,
  MAX_PERSONA_FILE_BYTES,
  type PersonaKind,
  pickProjectFolder,
  readLastRoot,
  readPersonaAsset,
  readPersonaFile,
  resolvePersonaRoot,
  revealPersonaFolder,
  savePersonaFile,
} from './persona.js';
import {
  fetchPersonaList,
  loadPersonaConfig,
  PersonaApiError,
} from './persona-api.js';
import {
  clearPersonaSyncRevision,
  computePersonaContentHash,
  pullPersonaSync,
  pushPersonaSync,
  readPersonaSyncRevisions,
} from './persona-sync.js';
import {
  findPersonaTemplate,
  personaTemplateSummaries,
} from './persona-templates.js';
import { PWA_SERVICE_WORKER } from './pwa.js';
import { fetchRbacSnapshot, loadRbacConfig } from './rbac-api.js';
import { CLI_VERSION, getCliVersionStatus } from './version.js';

export const DEFAULT_DASHBOARD_PORT = 3847;
export const DASHBOARD_HOST = '127.0.0.1';
/** How many consecutive ports to try (preferred … preferred+N-1). */
export const DASHBOARD_PORT_ATTEMPTS = 10;

const DEFAULT_PORT = DEFAULT_DASHBOARD_PORT;
const HOST = DASHBOARD_HOST;
const PORT_ATTEMPTS = DASHBOARD_PORT_ATTEMPTS;
/** Value of `X-Transcodes-Dashboard` on /health — used by ensure/stop. */
const DASHBOARD_HEALTH_MARKER = 'transcodes-dashboard';
/** Mux playback id for the Guide onboarding video. */
const GUIDELINE_MUX_PLAYBACK_ID =
  'jjIn7CoaEiUXDkrOsewUBB6yd6LsEWQbSvPmvoon01CM';
/** PWA icon bytes (same 512×512 PNG as the header logo). */
const PWA_ICON_PNG = Buffer.from(
  LOGO_DATA_URI.replace(/^data:image\/png;base64,/, ''),
  'base64',
);

/**
 * Console org base — app deep-links:
 * - permissions: `/{oid}/project/{pid}?tab=permissions`
 * - webhooks:    `/{oid}/project/{pid}/settings?tab=webhooks`
 * - personas:    `/{oid}/access?section=personas`
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

const PLAN_NAMES = ['free', 'standard', 'enterprise'] as const;
type PlanName = (typeof PLAN_NAMES)[number];

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
  /** Organization billing plan from membership status. */
  plan?: PlanName;
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

function normalizePlanName(name: string): PlanName {
  const lower = name.toLowerCase().trim();
  if (lower === 'free' || lower === 'standard' || lower === 'enterprise') {
    return lower;
  }
  if (lower === 'pro' || lower === 'business') return 'enterprise';
  return 'free';
}

async function fetchOrganizationPlan(
  config: StepupConfig,
): Promise<PlanName | undefined> {
  const env = await request(config, {
    method: 'GET',
    path: '/membership/customer/status/organization',
    query: { organization_id: config.organizationId },
  });
  if (!env.ok) return undefined;
  const rec = payloadRecord(env.data);
  if (!rec) return undefined;
  const meta = rec.metadata;
  const metaName =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).name
      : undefined;
  const raw =
    typeof metaName === 'string' && metaName.trim()
      ? metaName
      : typeof rec.name === 'string'
        ? rec.name
        : '';
  if (!raw.trim()) return undefined;
  return normalizePlanName(raw);
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
    const [profile, workspace, plan] = await Promise.all([
      fetchMemberProfile(config),
      fetchWorkspaceNames(config),
      fetchOrganizationPlan(config),
    ]);
    return {
      ...base,
      ...(profile ?? {}),
      ...workspace,
      ...(plan ? { plan } : {}),
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

/** Fits one 5 MB file as JSON plus path metadata. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!hasJsonContentType(req)) {
      req.resume(); // drain so the socket can be reused
      reject(new HttpError(415, 'Content-Type must be application/json'));
      return;
    }

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

const ICON_PROFILE =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>';
const ICON_PERMISSION =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>';
const ICON_PERSONA =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" /></svg>';
const ICON_BOLT =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg>';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char,
  );
}

/** The Templates grid is static, so it is rendered once with the page. */
function personaTemplateCardsHtml(): string {
  return personaTemplateSummaries()
    .map((template) => {
      const id = escapeHtml(template.id);
      const contents = [...template.rules, ...template.skills];
      const counts = [
        `${template.rules.length} ${
          template.rules.length === 1 ? 'Rule' : 'Rules'
        }`,
        `${template.skills.length} ${
          template.skills.length === 1 ? 'Skill' : 'Skills'
        }`,
      ];
      const contentsHtml = contents.length
        ? `<p class="persona-template-files">${contents
            .map((name) => `<code>${escapeHtml(name)}</code>`)
            .join('')}</p>`
        : '<p class="persona-template-files persona-template-files--empty">Instruction only — nothing else to trim away</p>';
      return `
            <article class="persona-template-card" data-template-card="${id}">
              <div class="persona-template-card-head">
                <h3 class="persona-template-card-title">${escapeHtml(
                  template.title,
                )}</h3>
                <div class="persona-template-tags">${counts
                  .map(
                    (count) =>
                      `<span class="persona-template-tag">${escapeHtml(
                        count,
                      )}</span>`,
                  )
                  .join('')}</div>
              </div>
              <p class="persona-template-card-summary">${escapeHtml(
                template.summary,
              )}</p>
              ${contentsHtml}
              <div class="persona-template-card-foot">
                <button type="button" class="btn-action persona-template-btn" data-template-open="${id}">Create Persona</button>
              </div>
              <form class="persona-template-form" data-template-form="${id}" hidden>
                <label class="persona-template-form-label" for="persona-template-name-${id}">Persona name</label>
                <input type="text" class="label-input persona-template-name" id="persona-template-name-${id}" value="${escapeHtml(
                  template.suggestedName,
                )}" placeholder="persona-name" spellcheck="false" autocapitalize="off" autocomplete="off" />
                <div class="persona-template-form-actions">
                  <button type="button" class="btn-inline-action persona-template-cancel-btn" data-template-cancel="${id}">Cancel</button>
                  <button type="submit" class="btn-action persona-template-btn">Create Persona</button>
                </div>
              </form>
            </article>`;
    })
    .join('');
}

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcodes — CLI Panel</title>
  <meta name="theme-color" content="#111827" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Transcodes" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" type="image/png" href="/icon-512.png" />
  <link rel="apple-touch-icon" href="/icon-512.png" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    :root {
      --bg: #F9FAFB;
      --card: #ffffff;
      --line: #E5E7EB;
      --ink: #111827;
      --muted: #6B7280;
      --accent: #111827;
      --accent-hover: #1F2937;
      --accent-soft: #F3F4F6;
      --accent-soft-hover: #E5E7EB;
      --highlight: #5b54e6;
      --highlight-hover: #4a43d4;
      --highlight-soft: #eeedfb;
      --action: var(--highlight);
      --action-hover: var(--highlight-hover);
      --action-soft: var(--highlight-soft);
      --card-max: 894px;
      --text-3xs: 11px;
      --text-2xs: 13px;
      --text-xs: 14px;
      --text-sm: 15px;
      --text-base: 16px;
      --text-md: 17px;
      --text-lg: 19px;
      --text-xl: 24px;
    }
    html { height: 100%; }
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
      border: 1px solid rgba(17, 24, 39, 0.28);
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
        box-shadow: 0 0 0 0 rgba(17, 24, 39, 0.18);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(17, 24, 39, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(17, 24, 39, 0);
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
      width: min(100%, 520px);
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
    .deploy-confirm-apps {
      margin-top: 18px;
    }
    .deploy-confirm-target-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .deploy-confirm-target-list .persona-target {
      min-height: 38px;
    }
    .deploy-confirm-target {
      margin-top: 18px;
      padding: 13px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #F9FAFB;
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
      border: 1px solid var(--action);
      color: #fff;
      background: var(--action);
    }
    .deploy-confirm-submit:hover { opacity: 0.9; }
    .deploy-confirm-submit:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .action-confirm-panel {
      width: min(100%, 460px);
    }
    .action-confirm-warning {
      margin: 16px 0 0;
      padding: 11px 13px;
      border-radius: 10px;
      background: #f7f7f9;
      color: var(--muted);
      font-size: var(--text-xs);
      line-height: 1.45;
    }
    .action-confirm-submit.is-danger {
      border-color: #c0392f;
      background: #c0392f;
    }
    .action-confirm-submit.is-danger:hover {
      background: #a52f26;
      opacity: 1;
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
      justify-content: flex-end;
      gap: 16px;
      padding: 12px 14px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 12px;
    }
    .header-profile-info { min-width: 0; }
    .header-profile-btn {
      flex: 0 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
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
    .header-profile-meta-line {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
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
      flex-wrap: wrap;
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
    .profile-identity-body {
      flex: 1;
      min-width: 180px;
    }
    .profile-identity-name {
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ink);
      line-height: 1.35;
      word-break: break-all;
    }
    .profile-identity-sub {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
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
    .profile-actions-hint {
      margin: 0;
      font-size: var(--text-2xs);
      color: var(--muted);
    }
    .profile-actions-buttons {
      flex-shrink: 0;
      display: flex;
      gap: 8px;
      margin-left: auto;
    }
    .panel-page-head { margin: 0 0 20px; }
    .panel-page-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-page-title {
      margin: 0;
      color: var(--ink);
      font-size: var(--text-lg);
      font-weight: 700;
      line-height: 1.3;
    }
    .panel-page-title-row .tab-beta {
      font-size: 12px;
      padding: 2px 6px;
    }
    .panel-page-description {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: var(--text-2xs);
      line-height: 1.6;
      max-width: 660px;
    }
    .profile-empty[hidden],
    .rbac-signin[hidden],
    .rbac-signed-in[hidden] { display: none !important; }
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
      background: var(--action);
      cursor: pointer;
      transition: background 0.15s ease, opacity 0.15s ease;
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
    .btn-session-login:hover:not(:disabled) { background: var(--action-hover); }
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
    .cli-cmd,
    .cli-map-row code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--highlight-soft);
      color: var(--highlight);
      padding: 2px 8px;
      border-radius: 6px;
      font-size: var(--text-2xs);
      font-weight: 600;
      border: none;
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
    .tab-beta {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      margin-left: 2px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--highlight-soft);
      color: var(--highlight);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
      line-height: 1.4;
    }
    .tab:hover { color: var(--ink); }
    .tab.active {
      background: #fff;
      color: var(--ink);
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.08);
    }
    .persona-nav-group {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .persona-nav-group > .tab {
      width: 100%;
    }
    .persona-nav-chevron {
      width: 15px;
      height: 15px;
      margin-left: auto;
      flex-shrink: 0;
      transition: transform 0.15s ease;
    }
    .persona-nav-toggle[aria-expanded="true"] .persona-nav-chevron {
      transform: rotate(180deg);
    }
    .persona-nav-submenu {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
      padding: 4px 2px 0;
    }
    .persona-nav-submenu[hidden] { display: none !important; }
    .persona-nav-item {
      min-width: 0;
      padding: 8px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: var(--text-2xs);
      font-weight: 650;
      cursor: pointer;
    }
    .persona-nav-item:hover { color: var(--ink); }
    .persona-nav-item.active {
      background: #fff;
      color: var(--accent);
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
      color: var(--highlight);
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
      box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.12);
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
      box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.12);
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
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-action { background: var(--action); color: #fff; }
    .btn-action:hover:not(:disabled) { background: var(--action-hover); }
    .btn-save {
      background: var(--accent-soft);
      color: #9CA3AF;
    }
    .btn-save:not(:disabled) {
      background: var(--accent);
      color: #fff;
    }
    .btn-save:hover:not(:disabled) { background: var(--accent-hover); }
    .actions .btn-save:disabled {
      opacity: 1;
      cursor: default;
    }
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
      color: var(--highlight);
      background: var(--highlight-soft);
      border: none;
      border-radius: 9px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn-inline-action:hover:not(:disabled) { background: #e3e1f7; }
    .btn-inline-action:disabled { opacity: 0.55; cursor: default; }
    a.btn-inline-action { text-decoration: underline; }
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
    .rbac-signin { margin: 0; }
    .panel-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 240px;
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
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
      outline: 3px solid rgba(17, 24, 39, 0.22);
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
    .persona-local-view[hidden],
    .persona-templates-view[hidden],
    .persona-remote-view[hidden] {
      display: none !important;
    }
    .persona-registry-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .persona-deploy-btn {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 84px;
      padding: 0 18px;
      border: none;
      border-radius: 9px;
      font-size: var(--text-2xs);
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s ease, opacity 0.15s ease;
    }
    .persona-deploy-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    /* Every control on the header row shares one height so the strip reads as a single bar. */
    .persona-registry-head .persona-root-input,
    .persona-registry-head .btn-inline-action,
    .persona-registry-head .persona-deploy-btn,
    .persona-library-panel .persona-bundle-select,
    .persona-library-panel .persona-new-name,
    .persona-library-panel .persona-group-add,
    .persona-library-panel .persona-bundle-delete-btn,
    .persona-library-panel .btn-inline-action {
      height: 34px;
      min-height: 34px;
    }
    .persona-library-panel .persona-group-add {
      margin-left: 0;
      width: 34px;
      padding: 0;
    }
    .persona-library-panel .persona-bundle-delete-btn {
      width: 34px;
    }
    .persona-registry-head .btn-inline-action {
      padding: 0 14px;
    }
    .persona-registry-meta {
      display: grid;
      gap: 6px;
      margin: 0 0 12px;
    }
    .persona-root-help {
      margin: 0;
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
    .persona-root-hint:empty { display: none; }
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
    .persona-local-remote-status {
      margin: 0 0 14px;
      padding: 12px;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      background: #F9FAFB;
      color: var(--muted);
    }
    .persona-local-remote-status:empty { display: none; }
    .persona-sync-warning {
      margin: 8px 0 0;
      color: #c0392f;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.45;
    }
    .persona-sync-warning[hidden] { display: none !important; }
    .persona-remote-view,
    .persona-templates-view {
      min-width: 0;
      padding: 26px 28px 32px;
    }
    .persona-templates-head {
      margin-bottom: 22px;
    }
    .persona-agent-callout--workspace.persona-templates-help {
      margin: 20px 0 18px;
    }
    .persona-templates-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .persona-template-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
      padding: 20px 22px 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
    }
    .persona-template-card-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }
    .persona-template-card-title {
      margin: 0;
      color: var(--ink);
      font-size: var(--text-sm);
      font-weight: 720;
      line-height: 1.35;
    }
    .persona-template-tags {
      display: flex;
      flex: 0 0 auto;
      gap: 4px;
    }
    .persona-template-tag {
      padding: 3px 7px;
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
    }
    .persona-template-card-summary {
      margin: 0;
      color: var(--muted);
      font-size: var(--text-2xs);
      line-height: 1.6;
    }
    .persona-template-files {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 0;
    }
    .persona-template-files code {
      padding: 3px 7px;
      border-radius: 6px;
      background: #f4f4f6;
      color: #5a5a64;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
    }
    .persona-template-files--empty {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }
    .persona-template-card-foot {
      margin-top: auto;
      padding-top: 6px;
    }
    .persona-template-btn {
      flex: 1;
      width: 100%;
      padding: 11px 18px;
      border: none;
      border-radius: 10px;
      font-size: var(--text-2xs);
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s ease, opacity 0.15s ease;
    }
    .persona-template-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .persona-template-card-foot[hidden],
    .persona-template-form[hidden] { display: none !important; }
    .persona-template-form {
      margin-top: auto;
      padding-top: 6px;
    }
    .persona-template-form-label {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }
    .persona-template-form .persona-template-name {
      margin-top: 6px;
      padding: 9px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--text-2xs);
      border-radius: 10px;
    }
    .persona-template-form-actions {
      display: flex;
      align-items: stretch;
      gap: 8px;
      margin-top: 10px;
    }
    .persona-template-cancel-btn {
      flex: 0 0 auto;
      justify-content: center;
      padding: 11px 16px;
    }
    /* The shell never narrows past 1100px, so two columns is the floor. */
    @media (max-width: 1400px) {
      .persona-templates-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .persona-remote-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 20px;
    }
    .persona-remote-head-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      flex: 0 0 auto;
    }
    .persona-remote-title {
      margin: 0;
      color: var(--ink);
      font-size: var(--text-lg);
      line-height: 1.3;
    }
    .persona-remote-description,
    .persona-remote-notice {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: var(--text-2xs);
      line-height: 1.6;
    }
    .persona-remote-description { max-width: 660px; }
    .persona-sync-actions-card {
      margin: 0 0 18px;
    }
    .persona-sync-actions-card[hidden] { display: none !important; }
    .persona-sync-actions-card .persona-agent-callout-body {
      padding: 0 16px 16px 50px;
      text-align: left;
    }
    .persona-sync-actions-help {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--muted);
      font-size: var(--text-2xs);
      line-height: 1.55;
      text-align: left;
    }
    .persona-sync-actions-help li + li { margin-top: 6px; }
    .persona-sync-actions-help strong {
      color: var(--ink);
      font-weight: 700;
    }
    .persona-remote-notice {
      margin: 0 0 14px;
    }
    .persona-remote-notice[data-tone="warn"] {
      margin: 0 0 18px;
      padding: 18px 20px;
      border-radius: 16px;
      border: 1px dashed var(--line);
      background: #fbfbfc;
      color: #c0392f;
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.45;
    }
    .persona-remote-notice:empty { display: none; }
    .signin-pitch-card {
      grid-column: 1 / -1;
      width: 100%;
      margin: 0;
      padding: 36px 38px 34px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, #FFFFFF 0%, #F3F4F6 100%);
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .signin-pitch-head {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }
    .signin-pitch-icon {
      width: 46px;
      height: 46px;
      border-radius: 13px;
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .signin-pitch-icon svg {
      width: 24px;
      height: 24px;
      overflow: visible;
    }
    .signin-pitch-title {
      margin: 0;
      font-size: var(--text-lg);
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.2px;
    }
    .signin-pitch-sub {
      margin: 0;
      color: var(--muted);
      font-size: var(--text-xs);
      line-height: 1.65;
    }
    .signin-pitch-features {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .signin-pitch-feature {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 13px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 9px;
    }
    .signin-pitch-feature svg {
      width: 21px;
      height: 21px;
      color: var(--accent);
    }
    .signin-pitch-feature-title {
      margin: 0;
      font-size: var(--text-xs);
      font-weight: 700;
      color: var(--ink);
    }
    .signin-pitch-feature-desc {
      margin: 0;
      font-size: var(--text-2xs);
      color: var(--muted);
      line-height: 1.55;
    }
    .signin-pitch-cta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .signin-pitch-btn {
      padding: 12px 28px;
      font-size: var(--text-sm);
    }
    .signin-pitch-hint {
      margin: 0;
      font-size: var(--text-2xs);
      color: var(--muted);
    }
    @media (max-width: 900px) {
      .signin-pitch-features { grid-template-columns: 1fr; }
      .signin-pitch-card { padding: 28px 26px; }
    }
    .persona-remote-refresh-icon {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
    }
    .persona-remote-list {
      display: flex;
      flex-direction: column;
      gap: 28px;
    }
    .persona-sync-group-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }
    .persona-sync-group-title {
      margin: 0;
      color: var(--ink);
      font-size: var(--text-lg);
      font-weight: 720;
      letter-spacing: 0.01em;
      line-height: 1.3;
    }
    .persona-sync-current-toggle {
      padding: 0;
      border: none;
      background: none;
      color: var(--highlight);
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
    }
    .persona-sync-current-toggle:hover { text-decoration: underline; }
    .persona-sync-current-summary {
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .persona-sync-current-summary[hidden],
    .persona-sync-rows[hidden] { display: none !important; }
    .persona-sync-row,
    .persona-sync-head {
      display: grid;
      grid-template-columns: minmax(140px, 1.1fr) 64px 64px minmax(100px, 0.55fr) minmax(150px, 1fr) minmax(92px, max-content);
      align-items: center;
      gap: 10px 16px;
      min-width: 0;
      padding: 12px 0;
      border-bottom: 1px solid #eeeef2;
    }
    .persona-sync-head {
      padding-top: 4px;
      padding-bottom: 8px;
    }
    .persona-sync-head .persona-sync-row-name,
    .persona-sync-head .persona-sync-row-ver,
    .persona-sync-head .persona-sync-row-status,
    .persona-sync-head .persona-sync-row-updated {
      color: #8a8a94;
      font-size: 11px;
      font-weight: 720;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .persona-sync-row-name {
      margin: 0;
      overflow: hidden;
      color: var(--ink);
      font-size: 14px;
      font-weight: 720;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .persona-sync-row-ver {
      margin: 0;
      color: var(--ink);
      font-size: 14px;
      font-weight: 720;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.01em;
      text-align: center;
    }
    .persona-sync-row-status {
      margin: 0;
      color: var(--ink);
      font-size: 12px;
      font-weight: 650;
      line-height: 1.35;
      text-align: center;
    }
    .persona-sync-row-updated {
      margin: 0;
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .persona-sync-row-action {
      display: flex;
      flex-direction: column;
      justify-self: end;
      align-items: stretch;
      gap: 6px;
      min-width: 92px;
      min-height: 28px;
    }
    .persona-sync-row-action .btn-inline-action {
      width: 100%;
      justify-content: center;
    }
    .persona-sync-row[data-state="current"] .persona-sync-row-name,
    .persona-sync-row[data-state="current"] .persona-sync-row-ver {
      color: var(--muted);
      font-weight: 600;
    }
    .persona-remote-meta {
      margin: 11px 0 14px;
      min-height: 17px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }
    .persona-remote-empty {
      grid-column: 1 / -1;
      margin: 0;
      padding: 30px 18px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      color: var(--muted);
      font-size: var(--text-2xs);
      text-align: center;
    }
    .persona-bundle-help {
      margin: -2px 0 10px;
      font-size: var(--text-3xs);
      line-height: 1.45;
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
      color: var(--muted);
    }
    .persona-bundle-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1 1 240px;
      min-width: 0;
      margin: 0;
    }
    .persona-bundle-select {
      flex: 1;
      min-width: 0;
      margin: 0;
      padding: 8px 36px 8px 12px;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      background-color: #fff;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23222228' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      background-size: 14px;
      font-size: var(--text-2xs);
    }
    .persona-bundle-delete-btn {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--muted);
      cursor: pointer;
    }
    .persona-bundle-delete-btn svg {
      display: block;
      width: 18px;
      height: 18px;
    }
    .persona-bundle-delete-btn:hover:not(:disabled) {
      border-color: #e2b5b1;
      background: #fdf6f5;
      color: #c0392f;
    }
    .persona-bundle-delete-btn:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .persona-bundle-row .persona-new-name {
      margin: 0;
      flex: 1;
      min-width: 0;
      padding: 8px 12px;
      font-size: var(--text-2xs);
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
    .persona-child-tree {
      padding: 0;
    }
    .persona-group {
      position: relative;
      padding: 0;
    }
    .persona-group + .persona-group { margin-top: 16px; }
    .persona-bundle-card {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
    }
    .persona-bundle-card-head {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      margin: 0;
      padding: 9px 11px;
      border-bottom: 1px solid var(--line);
      border-radius: 11px 11px 0 0;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: var(--text-2xs);
      font-weight: 750;
    }
    .persona-bundle-card-head svg {
      flex: 0 0 auto;
      width: 15px;
      height: 15px;
      margin-top: 2px;
    }
    .persona-bundle-card-titles {
      min-width: 0;
      flex: 1;
    }
    .persona-bundle-card-name {
      display: block;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .persona-bundle-remote-ver {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.35;
    }
    .persona-bundle-remote-ver[hidden] { display: none; }
    .persona-bundle-card .persona-child-tree {
      padding: 12px 11px;
    }
    .persona-group-label {
      margin: 0 0 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--text-2xs);
      font-weight: 700;
      color: var(--muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .persona-library-title {
      letter-spacing: 0;
      text-transform: none;
    }
    .persona-group-add {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      min-height: 34px;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--muted);
      letter-spacing: 0;
      text-transform: none;
      cursor: pointer;
    }
    .persona-group-add svg {
      display: block;
      width: 18px;
      height: 18px;
      stroke: var(--muted);
    }
    .persona-group-add:hover {
      border-color: #c8c8d0;
      background: #f7f7f9;
      color: var(--muted);
    }
    .persona-group-help {
      position: static;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 24px;
      height: 34px;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: help;
    }
    .persona-group-label > span + .persona-group-help {
      margin-left: auto;
    }
    .persona-group-help svg {
      display: block;
      width: 17px;
      height: 17px;
    }
    .persona-group-help:hover,
    .persona-group-help:focus-visible {
      color: var(--ink);
      outline: none;
    }
    .persona-group-tooltip {
      position: fixed;
      z-index: 1000;
      box-sizing: border-box;
      width: 230px;
      max-width: calc(100vw - 24px);
      padding: 9px 10px;
      border: 1px solid #303038;
      border-radius: 8px;
      background: #222228;
      box-shadow: 0 8px 24px rgba(20, 20, 26, 0.18);
      color: #fff;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.45;
      pointer-events: none;
      text-align: left;
      text-transform: none;
      white-space: normal;
    }
    .persona-child-tree .persona-item {
      border-radius: 8px;
      background: #fff;
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
      min-height: 34px;
      padding: 6px 10px 6px 12px;
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
      background: #fff;
      color: var(--accent);
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
      opacity: 0.7;
      cursor: pointer;
    }
    .persona-item-x svg {
      display: block;
      width: 18px;
      height: 18px;
    }
    .persona-item-x:hover {
      opacity: 1;
      background: rgba(192, 57, 47, 0.12);
      color: #c0392f;
    }
    .persona-item.active .persona-item-x:hover {
      background: rgba(192, 57, 47, 0.12);
      color: #c0392f;
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
      margin-bottom: 16px;
    }
    .persona-picker[hidden] { display: none !important; }
    .persona-template-row {
      margin: 0 0 16px;
    }
    .persona-template-row[hidden] { display: none !important; }
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
    .persona-new-name {
      margin: 0;
      flex: 1;
      min-width: 180px;
      font-size: var(--text-xs);
    }
    .persona-agent-callout {
      display: flex;
      gap: 12px;
      margin: 18px 0;
      padding: 16px;
      border: 1px solid rgba(91, 84, 230, 0.28);
      border-radius: 14px;
      background: var(--highlight-soft);
    }
    .persona-agent-callout--workspace {
      display: block;
      overflow: hidden;
      margin: 0 0 18px;
      padding: 0;
    }
    .persona-agent-callout--toolbar {
      position: relative;
      overflow: visible;
      margin: 0 0 0 auto;
      flex: 0 0 auto;
    }
    .persona-agent-callout--toolbar .persona-agent-callout-summary {
      padding: 7px 12px;
      gap: 8px;
    }
    .persona-agent-callout--toolbar .persona-agent-callout-icon {
      width: 16px;
      height: 16px;
    }
    .persona-agent-callout--toolbar .persona-agent-callout-title {
      margin: 0;
      font-size: var(--text-2xs);
      white-space: nowrap;
    }
    .persona-agent-callout--toolbar .persona-agent-callout-chevron {
      width: 14px;
      height: 14px;
    }
    .persona-agent-callout--toolbar .persona-agent-callout-body {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 35;
      width: min(440px, calc(100vw - 48px));
      padding: 12px 14px;
      border: 1px solid rgba(91, 84, 230, 0.28);
      border-radius: 14px;
      background: var(--highlight-soft);
      box-shadow: 0 12px 32px rgba(24, 24, 35, 0.14);
    }
    .persona-agent-callout-summary {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      cursor: pointer;
      list-style: none;
    }
    .persona-agent-callout-summary::-webkit-details-marker { display: none; }
    .persona-agent-callout-summary .persona-agent-callout-title {
      flex: 1;
      margin: 0;
    }
    .persona-agent-callout-chevron {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      color: var(--muted);
      transition: transform 160ms ease;
    }
    .persona-agent-callout--workspace[open] .persona-agent-callout-chevron {
      transform: rotate(180deg);
    }
    .persona-agent-callout-body {
      padding: 0 16px 16px 50px;
    }
    .persona-agent-callout-icon {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      color: var(--highlight);
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
    .persona-file-picker {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 2px 10px;
    }
    .persona-file-picker[hidden] { display: none !important; }
    .persona-file-picker.is-open { z-index: 40; }
    .persona-file-backdrop {
      position: fixed;
      inset: 0;
      z-index: 39;
      background: transparent;
    }
    .persona-file-backdrop[hidden] { display: none !important; }
    .persona-file-btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #f6f6f9;
      color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--text-2xs);
      font-weight: 700;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .persona-file-btn:hover { border-color: #d4d4de; background: #f0f0f4; }
    .persona-file-btn[aria-expanded="true"] { border-color: var(--accent); }
    .persona-file-chevron {
      width: 14px;
      height: 14px;
      flex: 0 0 auto;
      color: var(--muted);
      transition: transform 0.15s ease;
    }
    .persona-file-btn[aria-expanded="true"] .persona-file-chevron {
      transform: rotate(180deg);
    }
    .persona-file-count {
      color: var(--muted);
      font-size: var(--text-2xs);
      font-weight: 600;
    }
    .persona-file-menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 40;
      min-width: 240px;
      max-height: 320px;
      overflow-y: auto;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 12px 32px rgba(24, 24, 35, 0.14);
    }
    .persona-file-menu[hidden] { display: none !important; }
    .persona-file-group {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 6px 4px 2px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .persona-file-group > svg { width: 15px; height: 15px; flex: 0 0 auto; }
    .persona-file-item {
      display: block;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--text-2xs);
      text-align: left;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .persona-file-item:hover { background: #f4f4f7; }
    .persona-file-item.active {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 700;
    }
    .persona-file-item.nested { padding-left: 26px; }
    .persona-file-add {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      margin-left: auto;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .persona-file-add:hover { background: #ececf2; color: var(--accent); }
    .persona-file-row {
      display: flex;
      align-items: center;
      gap: 2px;
      width: 100%;
      min-width: 0;
    }
    .persona-file-row .persona-file-item {
      flex: 1 1 0;
      min-width: 0;
      width: auto;
    }
    .persona-file-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      min-width: 20px;
      flex: 0 0 20px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .persona-file-remove:hover {
      background: rgba(192, 57, 47, 0.12);
      color: #c0392f;
    }
    .persona-file-remove svg,
    .persona-file-add svg {
      width: 15px;
      height: 15px;
      flex: 0 0 auto;
    }
    .persona-file-new {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 4px 4px 26px;
    }
    .persona-file-new.root { padding-left: 4px; }
    .persona-file-new input {
      flex: 1;
      min-width: 0;
      padding: 5px 8px;
      border: 1px solid var(--accent);
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--text-2xs);
      outline: none;
    }
    .persona-file-new-confirm {
      flex: 0 0 auto;
      padding: 5px 10px;
      border: none;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      font-size: var(--text-2xs);
      font-weight: 600;
      cursor: pointer;
    }
    .persona-file-new-confirm:hover { filter: brightness(1.08); }
    .persona-file-menu-footer {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--line);
    }
    .persona-file-new-folder-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: var(--text-2xs);
      /* Same weight as the folder group headers above. */
      font-weight: 700;
      text-align: left;
      cursor: pointer;
    }
    .persona-file-new-folder-btn:hover { background: #f4f4f7; color: var(--accent); }
    .persona-file-new-folder-btn svg { width: 14px; height: 14px; flex: 0 0 auto; }
    .persona-content-stats {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      margin: 0 2px 10px;
      font-size: var(--text-2xs);
      color: var(--muted);
    }
    .persona-content-metrics {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px 12px;
    }
    .persona-content-heading {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .persona-content-file {
      color: var(--accent);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .persona-content-heading .persona-content-file {
      flex: 1;
      min-width: 0;
    }
    .persona-content-count {
      color: var(--ink);
      font-weight: 700;
    }
    .persona-content-status {
      font-weight: 650;
    }
    .persona-md-preview {
      display: none;
      flex: 1;
      min-height: 400px;
      overflow: auto;
      padding: 28px 32px 56px;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.7;
    }
    .persona-code-editor.is-preview .persona-md-preview { display: block; }
    .persona-code-editor.is-preview .persona-code-editor-host,
    .persona-code-editor.is-preview .persona-editor { display: none !important; }
    .persona-md-preview > :first-child { margin-top: 0; }
    .persona-md-preview > :last-child { margin-bottom: 0; }
    .persona-md-preview h1,
    .persona-md-preview h2,
    .persona-md-preview h3,
    .persona-md-preview h4 {
      margin: 1.4em 0 0.45em;
      color: var(--ink);
      font-weight: 750;
      letter-spacing: -0.02em;
      line-height: 1.25;
    }
    .persona-md-preview h1 { font-size: 28px; }
    .persona-md-preview h2 {
      font-size: 22px;
      padding-bottom: 8px;
      border-bottom: 1px solid #ececf1;
    }
    .persona-md-preview h3 { font-size: 18px; }
    .persona-md-preview h4 { font-size: 16px; }
    .persona-md-preview p { margin: 0 0 0.9em; }
    .persona-md-preview ul,
    .persona-md-preview ol {
      margin: 0 0 0.9em;
      padding-left: 1.35em;
    }
    .persona-md-preview li { margin: 0.2em 0; }
    .persona-md-preview li::marker { color: #8b8b96; }
    .persona-md-preview strong { font-weight: 750; }
    .persona-md-preview em { color: #3f3f48; }
    .persona-md-preview hr {
      margin: 1.6em 0;
      border: none;
      border-top: 1px solid #ececf1;
    }
    .persona-md-preview blockquote {
      margin: 0 0 0.9em;
      padding: 2px 0 2px 14px;
      border-left: 3px solid #cfcadf;
      color: #4a4a52;
    }
    .persona-md-preview a { color: var(--highlight); }
    .persona-md-preview code {
      padding: 0.12em 0.38em;
      border-radius: 6px;
      background: #f3f2fb;
      color: #3d3878;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.86em;
    }
    .persona-md-preview pre {
      margin: 0 0 1em;
      padding: 14px 16px;
      overflow: auto;
      border: 1px solid #ececf1;
      border-radius: 12px;
      background: #f8f8fb;
    }
    .persona-md-preview pre code {
      padding: 0;
      background: transparent;
      color: inherit;
      font-size: 13px;
      line-height: 1.6;
    }
    .persona-md-preview table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 1.2em;
      font-size: 14px;
    }
    .persona-md-preview th,
    .persona-md-preview td {
      padding: 10px 12px;
      border-bottom: 1px solid #ececf1;
      text-align: left;
      vertical-align: top;
    }
    .persona-md-preview thead th {
      background: #f6efe8;
      font-weight: 750;
    }
    .persona-md-preview tbody td:first-child { font-weight: 750; }
    .persona-md-mermaid {
      margin: 0 0 1.2em;
      overflow-x: auto;
    }
    .persona-md-mermaid svg { display: block; max-width: 100%; height: auto; }
    .persona-md-preview img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 0 0 1.2em;
      border: 1px solid #ececf1;
      border-radius: 12px;
      background: #fff;
    }
    .persona-md-preview.is-code {
      padding: 22px 24px 40px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.65;
    }
    .persona-md-preview.is-code pre {
      margin: 0;
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
    }
    .persona-md-preview.is-code pre code {
      font-size: inherit;
    }
    .persona-md-frontmatter {
      margin: 0 0 1.4em;
      padding: 12px 14px;
      border: 1px solid #ececf1;
      border-radius: 12px;
      background: #fafafc;
    }
    .persona-md-frontmatter dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 14px;
      margin: 0;
    }
    .persona-md-frontmatter dt {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .persona-md-frontmatter dd {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
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
      box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.12);
    }
    .persona-code-editor {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .persona-code-editor:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.12);
    }
    .persona-code-editor-host { display: none; }
    .persona-code-editor.is-ready .persona-code-editor-host { display: block; }
    .persona-code-editor.is-ready .persona-editor { display: none; }
    .persona-code-editor .persona-editor {
      min-height: 400px;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
    .persona-code-editor .cm-editor {
      min-height: 400px;
      color: #24242b;
      background: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: var(--text-2xs);
      line-height: 1.65;
    }
    .persona-code-editor .cm-editor.cm-focused { outline: none; }
    .persona-code-editor .cm-scroller {
      min-height: 400px;
      overflow: auto;
    }
    .persona-code-editor .cm-content {
      padding: 14px 0 80px;
      caret-color: var(--accent);
    }
    .persona-code-editor .cm-line { padding: 0 18px 0 10px; }
    .persona-code-editor .cm-gutters {
      border-right: 1px solid #ececf1;
      background: #F9FAFB;
      color: #aaaab4;
    }
    .persona-code-editor .cm-lineNumbers .cm-gutterElement {
      min-width: 40px;
      padding: 0 10px 0 6px;
    }
    .persona-code-editor .cm-activeLine,
    .persona-code-editor .cm-activeLineGutter {
      background: #f4f3ff;
    }
    .persona-code-editor .cm-selectionBackground {
      background: #dedcff !important;
    }
    .persona-code-editor .cm-cursor {
      border-left-color: var(--accent);
    }
    .persona-actions { margin-top: 16px; }
    .persona-actions .btn-edit {
      background: var(--accent);
      color: #fff;
    }
    .persona-actions .btn-edit:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    .persona-actions .btn-danger {
      color: #c0392f;
      background: transparent;
    }
    .persona-actions .btn-danger:hover:not(:disabled) {
      background: #fdf6f5;
    }
    .persona-editor-panel .hint { margin-top: 16px; }
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
      border: 1px solid var(--line);
      background: #fff;
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
    .token-row.active .token-actions { border-top-color: rgba(17, 24, 39, 0.18); }
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
      box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.12);
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
      border: 1px solid rgba(17, 24, 39, 0.18);
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
      border: 1px dashed rgba(17, 24, 39, 0.35);
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
      background: rgba(17, 24, 39, 0.10);
      border-radius: 6px;
      color: var(--accent, #111827);
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
    .guide-group--panel .guide-group-label { color: var(--highlight); }
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
      color: var(--highlight);
      cursor: pointer;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
      position: relative;
      z-index: 2;
      pointer-events: auto;
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
      color: var(--highlight);
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
      color: var(--highlight);
      background: var(--highlight-soft);
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
    .guide-topic-list {
      display: grid;
      gap: 12px;
    }
    .guide-topic {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
      overflow: hidden;
    }
    .guide-topic-summary {
      min-height: 60px;
      padding: 15px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      list-style: none;
      color: var(--ink);
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .guide-topic-summary::-webkit-details-marker { display: none; }
    .guide-topic-summary::marker { content: ''; }
    .guide-topic-summary:hover { background: #f8f8fa; }
    .guide-topic[open] > .guide-topic-summary {
      border-bottom: 1px solid var(--line);
      background: var(--accent-soft);
    }
    .guide-topic-heading {
      flex: 1;
      min-width: 0;
    }
    .guide-topic-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--text-base);
      font-weight: 750;
      line-height: 1.35;
    }
    .guide-topic-subtitle {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: var(--text-xs);
      font-weight: 450;
      line-height: 1.45;
    }
    .guide-topic-chevron {
      flex-shrink: 0;
      width: 17px;
      height: 17px;
      color: var(--muted);
      transition: transform 0.18s ease;
    }
    .guide-topic[open] > .guide-topic-summary .guide-topic-chevron {
      transform: rotate(180deg);
    }
    .guide-topic-body {
      padding: 18px;
    }
    .guide-topic-body > .guide-help-body {
      padding: 0;
      border-top: none;
    }
    .guide-topic-toolbar {
      margin-bottom: 14px;
    }
    .guide-topic-toolbar .section-sub,
    .guide-topic-toolbar .guide-prefix-note {
      margin: 0;
    }
    .guide-video-wrap { margin: 0; }
    .guide-video-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid rgba(17, 24, 39, 0.35);
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
      background: #E5E7EB;
      border-color: rgba(17, 24, 39, 0.5);
    }
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
      --media-accent-color: #111827;
      --controls-backdrop-color: transparent;
      --media-control-background: transparent;
      --media-control-hover-background: rgb(0 0 0 / 25%);
    }
    .guide-video mux-player:fullscreen,
    .guide-video mux-player:-webkit-full-screen {
      --media-background-color: #f4f4f6;
      background: #f4f4f6;
    }
    .guide-topic-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .guide-step .toast {
      margin-top: 10px;
    }
    .guide-help-body {
      padding: 0 18px 16px;
      border-top: 1px solid rgba(17, 24, 39, 0.12);
    }
    .guide-help-line {
      margin: 12px 0 0;
      font-size: var(--text-sm);
      color: #4a4a52;
      line-height: 1.6;
    }
    .guide-help-line + .guide-help-line { margin-top: 6px; }
    .guide-help-line a {
      color: var(--highlight);
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
    .guide-start-cmd {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0 0;
    }
    .guide-start-copy {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font-size: var(--text-xs);
      font-weight: 600;
      cursor: pointer;
    }
    .guide-start-copy:hover { background: #f4f4f6; }
    .guide-start-copy svg {
      width: 14px;
      height: 14px;
    }
    .guide-start-alt {
      margin: 10px 0 0;
      font-size: var(--text-xs);
      color: var(--muted);
      line-height: 1.5;
    }
    .guide-start-note {
      margin: 14px 0 0;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--ink);
      line-height: 1.5;
    }
    .guide-start-steps {
      margin: 8px 0 0;
      padding: 0 0 0 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .guide-start-steps li {
      font-size: var(--text-sm);
      color: var(--ink);
      line-height: 1.6;
    }
    .guide-fork {
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .guide-fork li {
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.5;
    }
    .guide-fork strong { color: var(--ink); }
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
      color: var(--highlight);
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
    .sidebar-version {
      margin-top: auto;
      padding: 18px 13px 0;
      border-top: 1px solid var(--line);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
      font-size: var(--text-2xs);
      color: var(--muted);
      line-height: 1.6;
    }
    .sidebar-version code.cli-cmd {
      font-size: 11px;
      white-space: nowrap;
    }

    /* Desktop application shell: persistent navigation + wide workspace. */
    @media (min-width: 0px) {
      :root {
        --card-max: 1480px;
        --sidebar-width: 220px;
      }
      body {
        height: 100vh;
        align-items: stretch;
        padding: 24px;
        overflow: hidden;
      }
      .card {
        min-width: 1100px;
        max-width: var(--card-max);
        height: 100%;
        min-height: 0;
        margin: 0 auto;
        padding: 0;
        display: grid;
        grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
        border: 1px solid var(--line);
        border-radius: 22px;
        overflow: hidden;
      }
      .header {
        grid-column: 2;
        grid-row: 1;
        flex-direction: row;
        align-items: center;
        gap: 24px;
        padding: 18px 28px;
        background: #fff;
      }
      .header-top {
        flex: 1;
        min-width: 0;
      }
      .header-profile {
        width: auto;
        max-width: min(360px, 38%);
        flex-shrink: 0;
        padding: 0 0 0 20px;
        border: none;
        border-left: 1px solid var(--line);
        border-radius: 0;
        background: transparent;
      }
      .card > .tabs {
        grid-column: 1;
        grid-row: 1 / span 2;
        min-width: 0;
        margin: 0;
        padding: 28px 18px;
        flex-direction: column;
        gap: 6px;
        border-right: 1px solid var(--line);
        border-radius: 0;
        background: #F9FAFB;
      }
      .card > .tabs > .sidebar-divider {
        height: 1px;
        margin: 8px 4px;
        background: var(--line);
        flex-shrink: 0;
      }
      .card > .tabs > .tab,
      .card > .tabs > .persona-nav-group > .tab {
        flex: none;
        width: 100%;
        justify-content: flex-start;
        gap: 11px;
        padding: 11px 24px 11px 13px;
        border-radius: 11px;
        text-align: left;
      }
      .card > .tabs > .tab.active,
      .card > .tabs > .persona-nav-group > .tab.active {
        color: var(--ink);
        background: var(--accent-soft);
        box-shadow: none;
      }
      .card > .tabs > .tab .tab-beta {
        margin-right: 6px;
      }
      .card > .tabs > .persona-nav-group {
        flex: none;
        width: 100%;
      }
      .card > .tabs .persona-nav-submenu {
        grid-template-columns: 1fr;
        margin: 3px 0 2px 22px;
        padding: 4px 0 4px 10px;
      }
      .card > .tabs .persona-nav-item {
        padding: 8px 12px;
        text-align: left;
      }
      .card > .tabs .persona-nav-item.active {
        background: transparent;
        box-shadow: none;
      }
      .card > .panel {
        grid-column: 2;
        grid-row: 2;
        width: calc(100% - 68px);
        max-width: 1160px;
        min-width: 0;
        margin: 0 auto;
        padding: 30px 0 40px;
        overflow-y: auto;
      }
      .card > #panel-guideline {
        scrollbar-width: none;
      }
      .card > #panel-guideline::-webkit-scrollbar {
        display: none;
      }
      .card > #panel-persona {
        width: 100%;
        max-width: none;
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
      .card > #panel-rbac {
        width: 100%;
        max-width: none;
        margin: 0;
        padding: 30px 36px 40px;
        overflow-y: auto;
      }
      #panel-rbac .panel-page-head,
      #panel-rbac .rbac-signin,
      #panel-rbac .rbac-signed-in {
        width: 100%;
        max-width: 1160px;
        margin-left: auto;
        margin-right: auto;
      }

      /* Persona adds a file/library column inside the main content column. */
      #panel-persona .persona-registry {
        min-height: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: none;
        border-radius: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #panel-persona .persona-local-view {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        grid-template-rows: auto auto auto minmax(0, 1fr) auto;
        overflow: hidden;
      }
      #panel-persona .persona-registry-head {
        grid-column: 2;
        grid-row: 1;
        margin: 0;
        padding: 20px 24px 0;
        display: flex;
        align-items: center;
        flex-wrap: nowrap;
        gap: 8px;
      }
      #panel-persona .persona-registry-meta {
        grid-column: 2;
        grid-row: 2;
        margin: 0;
        padding: 8px 24px 16px;
        border-bottom: 1px solid var(--line);
      }
      #panel-persona .persona-library-panel {
        grid-column: 1;
        grid-row: 1 / span 5;
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
        padding: 22px 20px 24px;
        border-right: 1px solid var(--line);
        background: #fff;
        overflow: hidden;
      }
      #panel-persona .persona-remote-view,
      #panel-persona .persona-templates-view {
        flex: 1;
        width: 100%;
        max-width: none;
        min-height: 0;
        margin: 0;
        padding: 30px 36px 40px;
        overflow-y: auto;
      }
      #panel-persona .persona-remote-head,
      #panel-persona .persona-remote-notice,
      #panel-persona .persona-sync-actions-card,
      #panel-persona .persona-remote-list,
      #panel-persona .persona-templates-head,
      #panel-persona .persona-templates-grid {
        width: 100%;
        max-width: 1160px;
        margin-left: auto;
        margin-right: auto;
      }
      #panel-persona .persona-bundle-row {
        width: 100%;
        flex: none;
        min-width: 0;
        margin: 0 0 16px;
        padding: 0 0 16px;
        border-bottom: 1px solid var(--line);
      }
      #panel-persona #persona-bundle-new-btn {
        margin-left: 0;
      }
      #panel-persona .persona-bundle-row:has(.persona-new-name:not([hidden])) {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      #panel-persona .persona-bundle-row .persona-new-name:not([hidden]) {
        grid-column: 1 / -1;
      }
      #panel-persona #persona-bundle-cancel-btn:not([hidden]),
      #panel-persona #persona-bundle-create-btn:not([hidden]) {
        width: 100%;
        justify-content: center;
      }
      #panel-persona .persona-root-hint {
        margin: 0;
        padding: 0 0 12px;
      }
      #panel-persona .persona-workspace {
        display: contents;
      }
      #panel-persona .persona-registry-body {
        flex: 1;
        width: 100%;
        min-height: 0;
        min-width: 0;
        margin: 0;
        padding: 0;
        border-top: none;
        overflow-x: hidden;
        overflow-y: auto;
        scrollbar-width: none;
      }
      #panel-persona .persona-registry-body::-webkit-scrollbar {
        display: none;
      }
      #panel-persona .persona-editor-panel {
        grid-column: 2;
        grid-row: 4;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        min-width: 0;
        padding: 20px 24px 24px;
      }
      #panel-persona .persona-code-editor {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: 0;
      }
      #panel-persona .persona-md-preview {
        flex: 1;
        min-height: 0;
      }
      #panel-persona .persona-code-editor-host {
        flex: 1;
        min-height: 0;
      }
      #panel-persona .persona-code-editor.is-ready .persona-code-editor-host {
        display: flex;
      }
      #panel-persona .persona-code-editor .cm-editor {
        flex: 1;
        height: 100%;
        min-height: 0;
      }
      #panel-persona .persona-code-editor .cm-scroller {
        min-height: 0;
      }
      #panel-persona .persona-code-editor .persona-editor {
        flex: 1;
        height: 100%;
        min-height: 0;
        resize: none;
      }
      #panel-persona .persona-actions {
        flex: none;
        margin-top: 16px;
      }
      #panel-persona .persona-deploy-error {
        grid-column: 2;
        grid-row: 3;
        margin: 0;
        padding: 0 24px 16px;
      }
      #panel-persona .persona-log-wrap {
        grid-column: 2;
        grid-row: 5;
        margin: 0 24px 24px;
      }
      #panel-persona .persona-item {
        width: 100%;
        display: flex;
      }
      #panel-persona .persona-item-open {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #panel-persona .persona-editor {
        min-height: 400px;
      }
    }

    @media (max-width: 1220px) {
      #panel-persona .persona-local-view {
        grid-template-columns: 240px minmax(0, 1fr);
      }
      #panel-persona .persona-target-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

  </style>
  <script type="module">
    import { basicSetup, EditorView } from "https://esm.sh/codemirror@6";
    import { markdown } from "https://esm.sh/@codemirror/lang-markdown@6";

    window.addEventListener("DOMContentLoaded", () => {
      const shell = document.getElementById("persona-code-editor");
      const host = document.getElementById("persona-code-editor-host");
      const textarea = document.getElementById("persona-editor");
      if (!shell || !host || !textarea) return;

      let applyingExternalValue = false;
      const view = new EditorView({
        doc: textarea.value || "",
        parent: host,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || applyingExternalValue) return;
            textarea.value = update.state.doc.toString();
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
          }),
        ],
      });

      window.personaCodeEditor = {
        setValue(value) {
          const next = String(value || "");
          if (view.state.doc.toString() === next) return;
          applyingExternalValue = true;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next },
          });
          applyingExternalValue = false;
        },
        focus() {
          view.focus();
        },
        scrollToTop() {
          view.scrollDOM.scrollTop = 0;
        },
      };
      shell.classList.add("is-ready");
    });
  </script>
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
            <h1><a class="header-title-link" href="https://app.transcodes.io/" target="_blank" rel="noopener noreferrer">Transcodes</a> CLI Panel</h1>
          </div>
        </div>
        <div class="header-top-actions">
          <button type="button" class="btn-install-pwa" id="header-install-btn" hidden aria-label="Install Transcodes CLI Panel">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Install
          </button>
          <button type="button" class="btn-commands-open" id="header-commands-btn" aria-label="Open terminal commands" aria-haspopup="dialog" aria-controls="commands-modal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
          </button>
        </div>
      </div>
      <div class="header-profile is-signed-out" id="header-session">
        <button type="button" class="header-profile-btn" id="header-profile-btn" hidden aria-label="Open Profile">
          <div class="header-profile-info">
            <div class="header-profile-name" id="header-profile-name"></div>
            <div class="header-profile-meta" id="header-profile-meta"></div>
          </div>
          <svg class="header-profile-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
        <div class="header-profile-actions" id="header-login-actions" hidden>
          <div class="header-action-row">
            <button type="button" class="btn-session-login" id="header-login-btn" aria-label="Sign in with Transcodes">
              Login
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="tabs">
      <button type="button" class="tab active" data-tab="guideline">
        <svg class="tab-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" /></svg>
        Guide
      </button>
      <div class="persona-nav-group">
        <button type="button" class="tab persona-nav-toggle" id="persona-nav-toggle" data-tab="persona" aria-expanded="false" aria-controls="persona-nav-submenu">
          ${ICON_PERSONA.replace('<svg ', '<svg class="tab-icon" ')}
          <span>Persona</span>
          <svg class="persona-nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="persona-nav-submenu" id="persona-nav-submenu" hidden>
          <button type="button" class="persona-nav-item" id="persona-templates-tab">Templates</button>
          <button type="button" class="persona-nav-item active" id="persona-local-tab" aria-current="page">My Personas</button>
          <button type="button" class="persona-nav-item" id="persona-remote-tab">Organization</button>
        </div>
      </div>
      <button type="button" class="tab" data-tab="tokens">
        ${ICON_PROFILE.replace('<svg ', '<svg class="tab-icon" ')}
        Profile
      </button>
      <div class="sidebar-divider" aria-hidden="true"></div>
      <button type="button" class="tab" data-tab="rbac">
        ${ICON_PERMISSION.replace('<svg ', '<svg class="tab-icon" ')}
        Permission
      </button>
      <div class="sidebar-version">
        <span>Ver ${CLI_VERSION}</span>
        <code class="cli-cmd" id="cli-version-cmd">transcodes version</code>
      </div>
    </div>

    <div class="panel active" id="panel-guideline">
      <div class="guide-topic-list">
        <details class="guide-topic" name="guide-topic" open>
          <summary class="guide-topic-summary">
            <span class="guide-topic-heading">
              <span class="guide-topic-title">Getting Started</span>
              <span class="guide-topic-subtitle">Create, edit, apply, and share your Personas</span>
            </span>
            <svg class="guide-topic-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="guide-topic-body">
            <div class="section-title-row guide-topic-toolbar">
              <p class="guide-prefix-note">Claude, Cursor, and Antigravity (Google) use <code class="cli-cmd">/</code>. ChatGPT uses <code class="cli-cmd">$</code>.</p>
              <button type="button" class="guide-video-toggle" id="guide-video-toggle" aria-expanded="false" aria-controls="guide-video">
                Watch intro video
              </button>
            </div>
            <div class="guide-video-wrap">
              <div class="guide-video" id="guide-video" hidden>
                <mux-player
                  id="guide-mux-player"
                  playback-id="${GUIDELINE_MUX_PLAYBACK_ID}"
                  stream-type="on-demand"
                  preload="auto"
                  accent-color="#111827"
                  primary-color="#ffffff"
                  metadata-video-title="Transcodes getting started"
                ></mux-player>
              </div>
            </div>
      <div class="guide-groups">
        <section class="guide-group guide-group--panel">
          <ol class="guide-steps">
            <li>
              <details class="guide-step guide-step--accordion" open>
                <summary class="guide-step-summary">
                  <span class="guide-step-num">1</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">Create a Persona</span>
                    <button type="button" class="guide-step-time" data-seek="0" aria-label="Jump to video at 0:00">0:00</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Paste this into your AI and answer the questions. Your agent handles the rest.</p>
                  <div class="guide-start-cmd">
                    <code class="cli-cmd">create a persona using transcodes skill</code>
                    <button type="button" class="guide-start-copy" data-copy-cmd="create a persona using transcodes skill">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3A2.25 2.25 0 0 0 8.25 4.5v.75m7.416-1.362A2.251 2.251 0 0 1 15.75 5.25v.75m-7.5 0h7.5m-7.5 0H6.75A2.25 2.25 0 0 0 4.5 7.5v10.5A2.25 2.25 0 0 0 6.75 20.25h10.5A2.25 2.25 0 0 0 19.5 18V7.5a2.25 2.25 0 0 0-2.25-2.25H15.75" /></svg>
                      <span data-copy-label>Copy</span>
                    </button>
                  </div>
                  <p class="guide-start-note">If nothing happens:</p>
                  <ol class="guide-start-steps">
                    <li>Type <code class="cli-cmd">/transcodes</code></li>
                    <li>Pick <strong>transcodes</strong> from the plugin list</li>
                    <li>Keep typing in the same message: <code class="cli-cmd">create a persona using transcodes skill</code></li>
                  </ol>
                  <p class="guide-start-alt">ChatGPT: use <code class="cli-cmd">$</code> instead of <code class="cli-cmd">/</code>.</p>
                  <p class="guide-start-alt">Or start from a preset in <button type="button" class="guide-console-link" data-open-tab="persona" data-persona-view="templates">Templates</button>.</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">2</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">Review and edit it</span>
                    <button type="button" class="guide-step-time" data-seek="40" aria-label="Jump to video at 0:40">0:40</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">When the Persona exists, review its <strong>Instruction</strong>, <strong>Rules</strong>, and <strong>Skills</strong> in the <button type="button" class="guide-console-link" data-open-tab="persona">Persona</button> tab. Or ask your AI with <code class="cli-cmd">/transcodes update this persona</code>.</p>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">3</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">Apply it</span>
                    <button type="button" class="guide-step-time" data-seek="60" aria-label="Jump to video at 1:00">1:00</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">When you want it in your AI apps, ask <code class="cli-cmd">/transcodes apply a persona</code>.</p>
                  <ul class="guide-fork">
                    <li>If you pick a project folder → that project only</li>
                    <li>If you don't → this whole computer</li>
                  </ul>
                </div>
              </details>
            </li>
            <li>
              <details class="guide-step guide-step--accordion">
                <summary class="guide-step-summary">
                  <span class="guide-step-num">4</span>
                  <span class="guide-step-heading">
                    <span class="guide-step-title">Back up and share</span>
                    <button type="button" class="guide-step-time" data-seek="168" aria-label="Jump to video at 2:48">2:48</button>
                  </span>
                  <svg class="guide-step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="guide-step-body">
                  <p class="guide-step-desc">Sign in and upload your Personas from <button type="button" class="guide-console-link" data-open-tab="persona" data-persona-view="remote">Organization</button>. Or ask your AI with <code class="cli-cmd">/transcodes upload this persona to my organization</code>.</p>
                  <ul class="guide-fork">
                    <li>Keeps a backup, so nothing is lost if this device is reset</li>
                    <li>Lets your team work from the same Persona version</li>
                  </ul>
                </div>
              </details>
            </li>
          </ol>
        </section>
      </div>
      <div class="guide-footer">
        <p class="guide-footer-line">Channel: <a href="https://www.youtube.com/@hellotranscodes" target="_blank" rel="noopener noreferrer">https://www.youtube.com/@hellotranscodes</a></p>
        <p class="guide-footer-line">Questions or trouble setting up? <a href="https://www.transcodes.io/booking" target="_blank" rel="noopener noreferrer">https://www.transcodes.io/booking</a></p>
        <p class="guide-footer-line">Full documentation: <a href="https://www.transcodes.io/docs" target="_blank" rel="noopener noreferrer">https://www.transcodes.io/docs</a></p>
      </div>
          </div>
        </details>

        <details class="guide-topic" name="guide-topic">
          <summary class="guide-topic-summary">
            <span class="guide-topic-heading">
              <span class="guide-topic-title">Persona</span>
              <span class="guide-topic-subtitle">Teach AI agents their role, policies, and repeatable workflows</span>
            </span>
            <svg class="guide-topic-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="guide-topic-body">
            <div class="guide-help-body">
              <p class="guide-help-line">Think of a Persona as an onboarding manual that helps an AI agent understand its role, follow your workflow, and produce more reliable results. By defining one, you can reduce token usage, minimize hallucinations, and significantly boost productivity.</p>
              <p class="guide-help-line"><strong>Instruction</strong> (<code class="cli-cmd">AGENTS.md</code>, <code class="cli-cmd">CLAUDE.md</code>) is the job description and company orientation: the agent's role, team, organization, and service.</p>
              <p class="guide-help-line"><strong>Rules</strong> (<code class="cli-cmd">rule.md</code>) are workplace policies and guardrails (Must / Never). Create one focused Rule file per policy topic — for example security, quality, or design-system. Do not put step-by-step workflows in Rules.</p>
              <p class="guide-help-line"><strong>Skills</strong> (<code class="cli-cmd">SKILL.md</code>) are task playbooks: how to perform one specific workflow and what the output should look like. Create one Skill file per workflow — for example research, PRD writing, or design-to-code. Do not put standing policies in Skills.</p>
              <p class="guide-help-line">Keep Rules and Skills separate so each file has one clear job. Select a Persona and project folder, then apply the complete onboarding kit.</p>
            </div>
            <div class="persona-agent-callout">
              ${ICON_PERSONA.replace(
                '<svg ',
                '<svg class="persona-agent-callout-icon" ',
              )}
              <div>
                <p class="persona-agent-callout-title">Create/Update Personas with AI</p>
                <p class="persona-agent-callout-copy">Your AI can handle every Persona action in this panel. Use <code class="cli-cmd">/transcodes</code> in Claude, Cursor, or Antigravity — or <code class="cli-cmd">$transcodes</code> in ChatGPT (Codex) — and ask it to create, edit, update, apply, sync, upload, or download Personas. Just describe what you want, such as <code class="cli-cmd">/transcodes create a persona</code>, <code class="cli-cmd">/transcodes apply this persona</code>, or <code class="cli-cmd">/transcodes upload this persona to my organization</code>. If you pick a project folder it applies there; if you don't, it applies to this whole computer.</p>
              </div>
            </div>
            <div class="guide-topic-actions">
              <button type="button" class="btn-inline-action" data-open-tab="persona">Open Persona</button>
              <a class="btn-inline-action" href="${APP_ORG_URL}" data-app-tab="personas" target="_blank" rel="noopener noreferrer">View Personas</a>
            </div>
          </div>
        </details>

        <details class="guide-topic" name="guide-topic">
          <summary class="guide-topic-summary">
            <span class="guide-topic-heading">
              <span class="guide-topic-title">Profile</span>
              <span class="guide-topic-subtitle">Manage this device's sign-in and methods for confirming risky actions</span>
            </span>
            <svg class="guide-topic-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="guide-topic-body">
            <div class="guide-help-body">
              <p class="guide-help-line"><strong>Profile</strong> shows the Transcodes account, organization, and project currently connected to this computer.</p>
              <p class="guide-help-line">Use <code class="cli-cmd">transcodes login</code> to sign in and <code class="cli-cmd">transcodes logout</code> to remove the local session. To switch organizations, log out and sign in again.</p>
              <p class="guide-help-line">Register a passkey, hardware security key, or OTP in <strong>Console</strong> so you can confirm risky actions when Transcodes asks for an extra security check.</p>
            </div>
            <div class="guide-topic-actions">
              <button type="button" class="btn-inline-action" data-open-tab="tokens">Open Profile</button>
              <button type="button" class="btn-inline-action" data-console-open>Open Console</button>
            </div>
          </div>
        </details>

        <details class="guide-topic" name="guide-topic">
          <summary class="guide-topic-summary">
            <span class="guide-topic-heading">
              <span class="guide-topic-title">Permission <span class="tab-beta">Upcoming</span></span>
              <span class="guide-topic-subtitle">Understand resources, actions, access levels, and extra confirmation</span>
            </span>
            <svg class="guide-topic-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="guide-topic-body">
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
                <li><span class="guide-classify-prompt">"Push this branch to GitHub"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">github:update</code> <span class="guide-classify-arrow">if <code>github</code> is set up</span> · otherwise <code class="cli-cmd">system:update</code></li>
                <li><span class="guide-classify-prompt">"Delete files on my computer"</span> <span class="guide-classify-arrow">→</span> <code class="cli-cmd">system:delete</code></li>
              </ul>
            </div>
            <div class="guide-topic-actions">
              <button type="button" class="btn-inline-action" data-open-tab="rbac">Open Permission</button>
              <a class="btn-inline-action" href="${APP_ORG_URL}" data-app-tab="permissions" target="_blank" rel="noopener noreferrer">Edit Access Policy</a>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div class="panel" id="panel-tokens">
      <div class="panel-page-head">
        <h2 class="panel-page-title">Profile</h2>
        <p class="panel-page-description">Manage this account and usage history on this device.</p>
      </div>
      <div id="profile-empty" class="profile-empty"><p class="panel-loading">Loading</p></div>
      <div id="profile-card" class="profile-card" hidden>
        <div class="profile-identity">
          <div class="profile-avatar" id="profile-avatar" aria-hidden="true"></div>
          <div class="profile-identity-body">
            <div class="profile-identity-name" id="profile-email"></div>
            <div class="profile-identity-sub" id="profile-workspace"></div>
          </div>
          <div class="profile-actions-buttons">
            <!--
            <button type="button" class="btn-manage-auth" id="manage-auth-btn" data-console-open aria-label="Open Transcodes security settings">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33" />
              </svg>
              Console
            </button>
            -->
            <button type="button" class="btn-session-logout" id="header-logout-btn" aria-label="Sign out on this computer">
              Logout
            </button>
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
          <p class="profile-console-note">Register a passkey, hardware security key, or OTP in <strong>Console</strong> so you can confirm risky actions when Transcodes asks for an extra security check. Read the <strong>Guide</strong> tab first if you're new.</p>
          <p class="profile-actions-hint"><code>transcodes console</code> · <code>transcodes logout</code> · <code>transcodes stop</code></p>
        </div>
      </div>
    </div>

    <div class="panel" id="panel-persona">
      <div class="persona-registry">
        <div class="persona-local-view" id="persona-local-view">
          <div class="persona-registry-head">
          <input type="text" id="persona-root-input" class="label-input persona-root-input" placeholder="Project folder path" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Project folder path" />
          <button type="button" class="btn-inline-action" id="persona-change-btn" title="Choose a project folder">
            Change Directory
          </button>
          <button type="button" class="btn-inline-action" id="persona-open-btn" title="Open this project folder">
            Open
          </button>
          <button type="button" class="btn-action persona-deploy-btn" id="persona-deploy-btn" title="Apply the selected Persona to this folder">
            Apply
          </button>
          </div>
          <div class="persona-registry-meta">
          <p class="persona-root-help">Set a project folder path, then use <strong>Apply</strong> to apply the selected Persona to the project folder</p>
          </div>
          <aside class="persona-library-panel" aria-label="Local Persona files">
          <p class="persona-group-label persona-library-title">My Personas</p>
          <p class="persona-bundle-help">Only Personas on this device are listed here</p>
          <div class="persona-bundle-row">
            <select id="persona-bundle-select" class="label-input persona-bundle-select" aria-label="My Personas"></select>
            <button type="button" class="persona-group-add" id="persona-bundle-new-btn" aria-label="Add Persona" title="Add Persona">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button type="button" class="persona-bundle-delete-btn" id="persona-bundle-delete-btn" aria-label="Delete selected Persona" title="Delete selected Persona">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
            </button>
            <input type="text" id="persona-bundle-name" class="label-input persona-new-name" placeholder="persona-name" spellcheck="false" autocapitalize="off" autocomplete="off" hidden />
            <button type="button" class="btn-inline-action" id="persona-bundle-cancel-btn" hidden>Cancel</button>
            <button type="button" class="btn-inline-action" id="persona-bundle-create-btn" hidden>Create</button>
          </div>
          <div class="persona-local-remote-status" id="persona-local-remote-status" role="status" aria-live="polite"></div>
          <p class="persona-sync-warning" id="persona-sync-warning" hidden>Sign in to update or download organization Personas. Editing and Apply still work without signing in.</p>
          <p class="persona-root-hint" id="persona-root-hint"></p>
          <div class="persona-registry-body" id="persona-registry-body"></div>
          </aside>
          <div class="persona-workspace">
          <div class="persona-editor-panel">
            <div class="persona-picker" id="persona-picker" hidden>
              <input type="text" id="persona-new-name" class="label-input persona-new-name" placeholder="Please type a new rule title" spellcheck="false" autocapitalize="off" autocomplete="off" hidden />
            </div>
            <p class="persona-save-error" id="persona-save-error" hidden></p>

            <div class="persona-template-row" id="persona-template-row" hidden>
              <select id="persona-template-select" class="label-input persona-template-select" aria-label="Choose a template">
                <option value="">Choose a template…</option>
                <option value="general">General</option>
              </select>
            </div>
            <div class="persona-file-picker" id="persona-file-picker" hidden>
              <button type="button" class="persona-file-btn" id="persona-file-btn" aria-haspopup="true" aria-expanded="false">
                <span class="persona-file-current" id="persona-file-current">SKILL.md</span>
                <svg class="persona-file-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <span class="persona-file-count" id="persona-file-count"></span>
              <div class="persona-file-backdrop" id="persona-file-backdrop" hidden></div>
              <div class="persona-file-menu" id="persona-file-menu" role="listbox" aria-label="Skill files" hidden></div>
            </div>
            <div class="persona-content-stats" id="persona-content-stats" aria-live="polite">
              <div class="persona-content-heading">
              <span class="persona-content-file" id="persona-content-file">agents.md</span>
              <details class="persona-agent-callout persona-agent-callout--workspace persona-agent-callout--toolbar">
                <summary class="persona-agent-callout-summary">
                  ${ICON_PERSONA.replace(
                    '<svg ',
                    '<svg class="persona-agent-callout-icon" ',
                  )}
                  <p class="persona-agent-callout-title">Create/Update Personas with AI</p>
                  <svg class="persona-agent-callout-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <div class="persona-agent-callout-body">
                  <p class="persona-agent-callout-copy">Your AI can handle every Persona action in this panel. Use <code class="cli-cmd">/transcodes</code> in Claude, Cursor, or Antigravity — or <code class="cli-cmd">$transcodes</code> in ChatGPT (Codex) — and ask it to create, edit, update, apply, sync, upload, or download Personas. Just describe what you want, such as <code class="cli-cmd">/transcodes create a persona</code>, <code class="cli-cmd">/transcodes apply this persona</code>, or <code class="cli-cmd">/transcodes upload this persona to my organization</code>. If you pick a project folder it applies there; if you don't, it applies to this whole computer.</p>
                </div>
              </details>
              </div>
              <div class="persona-content-metrics">
                <span class="persona-content-count" id="persona-content-count">≈ 0 tokens · 0 words</span>
                <span class="persona-content-status" id="persona-content-status"></span>
              </div>
            </div>
            <div class="persona-code-editor is-preview" id="persona-code-editor">
              <article class="persona-md-preview" id="persona-md-preview" aria-label="Markdown preview"></article>
              <div class="persona-code-editor-host" id="persona-code-editor-host"></div>
              <textarea id="persona-editor" class="persona-editor" spellcheck="false" placeholder="Loading…"></textarea>
            </div>

            <div class="actions persona-actions">
              <button type="button" class="btn-edit" id="persona-edit-btn">Edit</button>
              <button type="button" class="btn-save" id="persona-save-btn" disabled hidden>Save</button>
              <button type="button" class="btn-secondary" id="persona-cancel-btn" hidden>Cancel</button>
              <button type="button" class="btn-danger" id="persona-delete-btn" hidden>Delete</button>
            </div>
          </div>
          </div>
          <p class="persona-deploy-error" id="persona-deploy-error" hidden></p>
          <div class="persona-log-wrap" id="persona-log-wrap" hidden>
          <button type="button" class="persona-log-close" id="persona-log-close" aria-label="Close apply log">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
          <pre class="persona-log" id="persona-log"></pre>
          </div>
        </div>
        <section class="persona-templates-view" id="persona-templates-view" hidden>
          <div class="persona-templates-head">
            <h2 class="persona-remote-title">Templates</h2>
            <details class="persona-agent-callout persona-agent-callout--workspace persona-templates-help">
              <summary class="persona-agent-callout-summary">
                ${ICON_PERSONA.replace(
                  '<svg ',
                  '<svg class="persona-agent-callout-icon" ',
                )}
                <p class="persona-agent-callout-title">How To Use These Templates</p>
                <svg class="persona-agent-callout-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </summary>
              <div class="persona-agent-callout-body">
                <p class="persona-agent-callout-copy"><strong>1. Create a Persona.</strong> Choose one of the six templates, click <strong>Create Persona</strong>, and enter a name. The template creates a complete starting structure with an Instruction, Rules, and Skills.</p>
                <p class="persona-agent-callout-copy"><strong>2. Customize it for your project.</strong> Open the new Persona in <strong>My Personas</strong> and edit its role, project context, standards, policies, and workflows yourself.</p>
                <p class="persona-agent-callout-copy"><strong>3. Or ask your AI agent to customize it.</strong> Tell your agent what the project does and what should change — for example, <code class="cli-cmd">/transcodes update this persona for my project</code>. Your agent can review and edit the Instruction, Rules, and Skills for you.</p>
              </div>
            </details>
          </div>
          <div class="persona-templates-grid">${personaTemplateCardsHtml()}</div>
        </section>
        <section class="persona-remote-view" id="persona-remote-view" hidden>
          <div class="persona-remote-head">
            <div>
              <h2 class="persona-remote-title">Organization</h2>
              <p class="persona-remote-description" id="persona-remote-description">Download or publish only the Personas that are out of date</p>
            </div>
            <div class="persona-remote-head-actions">
              <a class="btn-inline-action" href="${APP_ORG_URL}" data-app-tab="personas" target="_blank" rel="noopener noreferrer">View Personas</a>
              <button type="button" class="btn-inline-action" id="persona-remote-refresh-btn">
                <svg class="persona-remote-refresh-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Refresh
              </button>
            </div>
          </div>
          <details class="persona-agent-callout persona-agent-callout--workspace persona-sync-actions-card" id="persona-sync-actions-card" hidden>
            <summary class="persona-agent-callout-summary">
              ${ICON_BOLT.replace(
                '<svg ',
                '<svg class="persona-agent-callout-icon" ',
              )}
              <p class="persona-agent-callout-title">What Each Action Does</p>
              <svg class="persona-agent-callout-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </summary>
            <div class="persona-agent-callout-body">
              <ul class="persona-sync-actions-help">
                <li><strong>Remote</strong> — The version number in your organization. Dash(-) means it has not been published yet</li>
                <li><strong>Local</strong> — The version number saved on this device. Dash(-) means this Persona is not on this computer yet</li>
                <li><strong>Download</strong> — Get your team's latest version. We save your work first before changing it</li>
                <li><strong>Download · backup</strong> — Get your team's latest version. We save your changes first so nothing is lost</li>
                <li><strong>Upload</strong> — Make your current local work the team's latest version</li>
                <li><strong>Publish</strong> — Share this with your team for the very first time</li>
                <li><strong>Roll Back</strong> — Undo your changes and go back to the latest version you had. We save your work first</li>
              </ul>
            </div>
          </details>
          <p class="persona-remote-notice" id="persona-remote-notice" role="status" aria-live="polite"></p>
          <div class="persona-remote-list" id="persona-remote-list"></div>
        </section>
      </div>
    </div>

    <div class="panel" id="panel-rbac">
      <div class="panel-page-head">
        <div class="panel-page-title-row">
          <h2 class="panel-page-title">Permission</h2>
          <span class="tab-beta">Upcoming</span>
        </div>
        <p class="panel-page-description">Decide what your AI can do and when it needs your approval.</p>
      </div>
      <div id="rbac-signin" class="rbac-signin"><p class="panel-loading">Loading</p></div>
      <div id="rbac-signed-in" class="rbac-signed-in" hidden>
      <div class="guard-toggle-card">
        <div>
          <p class="guard-toggle-title">Activate Step-up Authentication</p>
          <p class="guard-toggle-desc" id="guard-toggle-desc">Loading guard status…</p>
        </div>
        <label class="guard-switch" title="When on, Transcodes checks each AI action against the permissions you set and asks you to verify before it runs">
          <input type="checkbox" id="guard-enabled-toggle" aria-label="Enable Transcodes permission checks" />
          <span class="guard-switch-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="rbac-legend">
        <p class="rbac-legend-title">Permission Status</p>
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

  <div class="commands-modal" id="action-confirm-modal" hidden>
    <div class="commands-modal-backdrop" data-action-confirm="cancel" tabindex="-1" aria-hidden="true"></div>
    <div class="commands-modal-panel deploy-confirm-panel action-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="action-confirm-title" aria-describedby="action-confirm-description">
      <h2 class="deploy-confirm-title" id="action-confirm-title">Confirm action</h2>
      <p class="deploy-confirm-copy" id="action-confirm-description"></p>
      <p class="action-confirm-warning" id="action-confirm-warning" hidden></p>
      <div class="deploy-confirm-actions">
        <button type="button" class="deploy-confirm-cancel" data-action-confirm="cancel">Cancel</button>
        <button type="button" class="deploy-confirm-submit action-confirm-submit" data-action-confirm="confirm" id="action-confirm-submit">Confirm</button>
      </div>
    </div>
  </div>

  <div class="commands-modal" id="deploy-confirm-modal" hidden>
    <div class="commands-modal-backdrop" data-deploy-confirm="cancel" tabindex="-1" aria-hidden="true"></div>
    <div class="commands-modal-panel deploy-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="deploy-confirm-title" aria-describedby="deploy-confirm-description">
      <h2 class="deploy-confirm-title" id="deploy-confirm-title">Apply Persona?</h2>
      <p class="deploy-confirm-copy" id="deploy-confirm-description">
        Current edits will be saved first. Persona <strong id="deploy-confirm-persona"></strong> will then be applied to <strong id="deploy-confirm-targets"></strong>.
      </p>
      <div class="deploy-confirm-apps">
        <span class="deploy-confirm-target-label">Apply to</span>
        <div class="persona-target-list deploy-confirm-target-list" id="persona-target-list">
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

    document.querySelectorAll("[data-copy-cmd]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const text = btn.getAttribute("data-copy-cmd");
        if (!text) return;
        const label = btn.querySelector("[data-copy-label]");
        try {
          await navigator.clipboard.writeText(text);
          if (label) label.textContent = "Copied";
          showToast("Copied", "success");
          setTimeout(() => {
            if (label) label.textContent = "Copy";
          }, 2000);
        } catch {
          showToast("Could not copy", "error");
        }
      });
    });

    const profileEmptyEl = document.getElementById("profile-empty");
    const profileCardEl = document.getElementById("profile-card");
    const profileEmailEl = document.getElementById("profile-email");
    const profileAvatarEl = document.getElementById("profile-avatar");
    const profileWorkspaceEl = document.getElementById("profile-workspace");
    const headerSessionEl = document.getElementById("header-session");
    const headerProfileBtn = document.getElementById("header-profile-btn");
    const headerProfileNameEl = document.getElementById("header-profile-name");
    const headerProfileMetaEl = document.getElementById("header-profile-meta");
    const headerLoginActionsEl = document.getElementById("header-login-actions");
    const headerLoginBtn = document.getElementById("header-login-btn");
    const headerLogoutBtn = document.getElementById("header-logout-btn");
    const headerInstallBtn = document.getElementById("header-install-btn");
    const headerCommandsBtn = document.getElementById("header-commands-btn");
    const commandsModal = document.getElementById("commands-modal");
    const actionConfirmModal = document.getElementById("action-confirm-modal");
    const actionConfirmTitle = document.getElementById("action-confirm-title");
    const actionConfirmDescription = document.getElementById("action-confirm-description");
    const actionConfirmWarning = document.getElementById("action-confirm-warning");
    const actionConfirmSubmit = document.getElementById("action-confirm-submit");
    const deployConfirmModal = document.getElementById("deploy-confirm-modal");
    const deployConfirmPersona = document.getElementById("deploy-confirm-persona");
    const deployConfirmTargets = document.getElementById("deploy-confirm-targets");
    const deployConfirmRoot = document.getElementById("deploy-confirm-root");
    const deployConfirmGlobal = document.getElementById("deploy-confirm-global");
    const deployConfirmGlobalWarn = document.getElementById("deploy-confirm-global-warn");
    const deployConfirmTargetLabel = document.getElementById("deploy-confirm-target-label");
    const deployConfirmProjectNote = document.getElementById("deploy-confirm-project-note");
    const deployConfirmSubmit = document.getElementById("deploy-confirm-submit");
    const APP_ORG_URL = ${JSON.stringify(APP_ORG_URL)};
    const APP_HOME_URL = ${JSON.stringify(APP_HOME_URL)};
    const USER_HOME = ${JSON.stringify(os.homedir())};
    const GLOBAL_PERSONA_TARGETS = ${JSON.stringify(
      getGlobalPersonaSyncTargets(),
    )};

    let lastStatus = { guardEnabled: false, tokens: [], activeMember: null };
    let sessionReady = false;
    let actionConfirmResolve = null;
    let actionConfirmReturnFocus = null;
    let deployConfirmResolve = null;
    let deployConfirmContext = { root: "" };
    let deferredInstallPrompt = null;
    const PWA_INSTALLED_KEY = "transcodes-pwa-installed";

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

    function authViewState() {
      if (!sessionReady) return "loading";
      return hasSavedTokens(lastStatus) ? "signed-in" : "signed-out";
    }

    function panelLoadingHtml() {
      return '<p class="panel-loading">Loading</p>';
    }

    // Path /guide | /persona?tab=my | /persona?tab=team | /permission | /profile
    // Legacy /persona/organization and ?tab=guide|persona|profile|permission still work.
    const TAB_URL_TO_INTERNAL = {
      guide: "guideline",
      guideline: "guideline",
      persona: "persona",
      profile: "tokens",
      tokens: "tokens",
      permission: "rbac",
      rbac: "rbac",
    };
    const TAB_INTERNAL_TO_PATH = {
      guideline: "/guide",
      persona: "/persona",
      tokens: "/profile",
      rbac: "/permission",
    };
    const PERSONA_TEAM_TABS = { team: true, organization: true, remote: true };
    const PERSONA_MY_TABS = { my: true, personal: true, local: true };
    const PERSONA_TEMPLATE_TABS = { templates: true, template: true };
    const personaNavToggle = document.getElementById("persona-nav-toggle");
    const personaNavSubmenu = document.getElementById("persona-nav-submenu");

    function resolveInternalTab(name) {
      if (!name) return "guideline";
      const key = String(name).toLowerCase();
      if (TAB_INTERNAL_TO_PATH[key]) return key;
      return TAB_URL_TO_INTERNAL[key] || "guideline";
    }

    function normalizePathname(pathname) {
      let trimmed = String(pathname || "/");
      while (trimmed.length > 1 && trimmed.endsWith("/")) {
        trimmed = trimmed.slice(0, -1);
      }
      return trimmed || "/";
    }

    function personaViewFromParam(value) {
      const key = String(value || "").toLowerCase();
      if (PERSONA_TEAM_TABS[key]) return "remote";
      if (PERSONA_TEMPLATE_TABS[key]) return "templates";
      if (PERSONA_MY_TABS[key]) return "local";
      return "";
    }

    function routeFromUrl() {
      const path = normalizePathname(location.pathname).toLowerCase();
      const segments = path === "/" ? [] : path.slice(1).split("/");
      const page = segments[0] || "";
      const sub = segments[1] || "";
      const tabParam = new URLSearchParams(location.search).get("tab");
      const personaView =
        personaViewFromParam(tabParam) ||
        personaViewFromParam(sub) ||
        "local";

      if (page === "persona" || page === "personas") {
        return { tab: "persona", personaView };
      }
      if (tabParam === "my" || tabParam === "team" || tabParam === "templates") {
        return { tab: "persona", personaView };
      }
      if (page && TAB_URL_TO_INTERNAL[page]) {
        return { tab: TAB_URL_TO_INTERNAL[page], personaView: "local" };
      }
      if (tabParam) {
        const tab = resolveInternalTab(tabParam);
        return { tab, personaView: "local" };
      }
      return { tab: "guideline", personaView: "local" };
    }

    function pathForRoute(internalName) {
      return TAB_INTERNAL_TO_PATH[internalName] || "/guide";
    }

    function syncRouteUrl(internalName, personaView, replace) {
      const url = new URL(location.href);
      url.pathname = pathForRoute(internalName);
      if (internalName === "persona") {
        url.searchParams.set(
          "tab",
          personaView === "remote"
            ? "team"
            : personaView === "templates"
              ? "templates"
              : "my"
        );
      } else {
        url.searchParams.delete("tab");
      }
      const next = url.pathname + url.search + url.hash;
      const current = location.pathname + location.search + location.hash;
      if (next === current) return;
      const state = { tab: internalName, personaView: personaView || "local" };
      if (replace) history.replaceState(state, "", next);
      else history.pushState(state, "", next);
    }

    function openTab(name, opts) {
      const options = opts || {};
      const tab = resolveInternalTab(name);
      document.querySelectorAll(".card > .tabs .tab[data-tab]").forEach((t) =>
        t.classList.toggle("active", t.getAttribute("data-tab") === tab));
      const personaOpen = tab === "persona";
      personaNavSubmenu.hidden = !personaOpen;
      personaNavToggle.setAttribute("aria-expanded", String(personaOpen));
      document.querySelectorAll(".card > .panel").forEach((p) =>
        p.classList.toggle("active", p.id === "panel-" + tab));
      if (tab === "persona") {
        const view = options.personaView || personaState.view || "local";
        setPersonaView(view, { skipUrl: true });
        // Wait for the local selection before matching it to Remote revisions.
        void initPersona().then(() => renderPersonaSyncState());
      }
      if (!options.skipUrl) {
        syncRouteUrl(
          tab,
          tab === "persona"
            ? (options.personaView || personaState.view || "local")
            : undefined,
          !!options.replaceUrl
        );
      }
      if (tab === "rbac") loadRbac();
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

    // personas → .../org/{oid}/access?section=personas
    function appPersonasUrl(organizationId) {
      return (
        APP_ORG_URL +
        "/" +
        encodeURIComponent(organizationId) +
        "/access?section=personas"
      );
    }

    function appDeepLinkHref(tab, organizationId, projectId) {
      if (tab === "personas") {
        return appPersonasUrl(organizationId);
      }
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
        if (tab === "personas" && oid) {
          a.href = appPersonasUrl(oid);
        } else if (oid && pid && tab) {
          a.href = appDeepLinkHref(tab, oid, pid);
        } else if (oid) {
          a.href = APP_ORG_URL + "/" + encodeURIComponent(oid);
        } else {
          a.href = APP_ORG_URL;
        }
      });
    }

    function updateSessionHeader(s) {
      if (!sessionReady) {
        headerLoginActionsEl.hidden = true;
        headerProfileBtn.hidden = true;
        headerSessionEl.classList.add("is-signed-out");
        return;
      }
      const signedIn = hasSavedTokens(s);
      headerLoginActionsEl.hidden = !!signedIn;
      headerProfileBtn.hidden = !signedIn;
      headerSessionEl.classList.toggle("is-signed-out", !signedIn);

      if (signedIn) {
        const am = s.activeMember || {};
        const activeTok =
          (s.tokens || []).find((t) => t.active) || (s.tokens || [])[0] || {};
        headerProfileNameEl.textContent = am.email || "Signed in";
        const organization =
          am.organizationName || am.organizationId || activeTok.organizationId;
        headerProfileMetaEl.innerHTML =
          '<div class="header-profile-meta-line">' +
          (organization ? esc(organization) : "Signed in on this computer") +
          "</div>";
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
      const confirmed = await confirmAction({
        title: "Sign out?",
        description: "You will be signed out of Transcodes on this computer",
        confirmLabel: "Sign Out",
      });
      if (!confirmed) {
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
        ? "Hide intro video"
        : "Watch intro video";
    }

    let guideSeekToken = 0;

    function seekGuideVideo(seconds) {
      if (!guideVideo || !guideMuxPlayer) return;
      const wasHidden = guideVideo.hidden;
      setGuideVideoOpen(true);
      if (wasHidden) {
        guideVideo.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      const player = guideMuxPlayer;
      const token = ++guideSeekToken;
      const apply = () => {
        if (token !== guideSeekToken) return;
        try {
          player.currentTime = seconds;
          if (player.paused) {
            const playResult = player.play && player.play();
            if (playResult && typeof playResult.catch === "function") {
              playResult.catch(() => {});
            }
          }
        } catch (_) {}
      };
      // readyState >= 1 means metadata is loaded and currentTime will stick.
      if (typeof player.readyState === "number" && player.readyState >= 1) {
        apply();
        return;
      }
      const onReady = () => {
        player.removeEventListener("loadedmetadata", onReady);
        player.removeEventListener("canplay", onReady);
        apply();
      };
      player.addEventListener("loadedmetadata", onReady, { once: true });
      player.addEventListener("canplay", onReady, { once: true });
      setTimeout(onReady, 500);
    }

    if (guideVideoToggle && guideVideo) {
      guideVideoToggle.addEventListener("click", () => {
        const open = guideVideoToggle.getAttribute("aria-expanded") === "true";
        setGuideVideoOpen(!open);
      });
    }

    // Capture before <summary> toggles the accordion. A bubbling click
    // on a button inside <summary> is swallowed in some browsers.
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target.closest(".guide-step-time");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const seconds = Number(btn.getAttribute("data-seek"));
        if (!Number.isFinite(seconds)) return;
        seekGuideVideo(seconds);
      },
      true,
    );

    document.querySelectorAll(".card > .tabs .tab[data-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (
          tab.getAttribute("data-tab") === "persona" &&
          tab.classList.contains("active") &&
          !personaNavSubmenu.hidden
        ) {
          personaNavSubmenu.hidden = true;
          personaNavToggle.setAttribute("aria-expanded", "false");
          return;
        }
        openTab(tab.getAttribute("data-tab"));
      });
    });
    document.querySelectorAll("[data-open-tab]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const personaView = btn.getAttribute("data-persona-view");
        openTab(btn.getAttribute("data-open-tab"), {
          ...(personaView ? { personaView } : {}),
        });
      });
    });
    window.addEventListener("popstate", () => {
      const route = routeFromUrl();
      openTab(route.tab, { skipUrl: true, personaView: route.personaView });
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

    function closeActionConfirm(confirmed) {
      if (!actionConfirmModal || actionConfirmModal.hidden) return;
      actionConfirmModal.hidden = true;
      document.body.style.overflow = "";
      if (actionConfirmResolve) {
        const resolve = actionConfirmResolve;
        actionConfirmResolve = null;
        resolve(confirmed);
      }
      if (actionConfirmReturnFocus && document.contains(actionConfirmReturnFocus)) {
        actionConfirmReturnFocus.focus();
      }
      actionConfirmReturnFocus = null;
    }

    function confirmAction(options) {
      if (!actionConfirmModal) return Promise.resolve(false);
      const config = options || {};
      actionConfirmTitle.textContent = config.title || "Confirm action";
      actionConfirmDescription.textContent = config.description || "";
      actionConfirmSubmit.textContent = config.confirmLabel || "Confirm";
      actionConfirmSubmit.classList.toggle("is-danger", config.danger === true);
      if (actionConfirmWarning) {
        actionConfirmWarning.textContent = config.warning || "";
        actionConfirmWarning.hidden = !config.warning;
      }
      actionConfirmReturnFocus = document.activeElement;
      actionConfirmModal.hidden = false;
      document.body.style.overflow = "hidden";
      actionConfirmSubmit.focus();
      return new Promise((resolve) => {
        actionConfirmResolve = resolve;
      });
    }

    function closeDeployConfirm(confirmed) {
      if (!deployConfirmModal || deployConfirmModal.hidden) return;
      const global = !!(deployConfirmGlobal && deployConfirmGlobal.checked);
      const targetEntries = selectedPersonaTargets();
      const applicableTargets = global
        ? targetEntries.filter((entry) =>
            GLOBAL_PERSONA_TARGETS.includes(entry.target)
          )
        : targetEntries;
      if (confirmed && applicableTargets.length === 0) {
        syncDeployConfirmGlobalUi();
        return;
      }
      deployConfirmModal.hidden = true;
      document.body.style.overflow = "";
      if (deployConfirmResolve) {
        const resolve = deployConfirmResolve;
        deployConfirmResolve = null;
        resolve(
          confirmed
            ? { global: global, targetEntries: targetEntries }
            : null
        );
      }
      if (personaDeployBtn) personaDeployBtn.focus();
    }

    function syncDeployConfirmGlobalUi() {
      const global = !!(deployConfirmGlobal && deployConfirmGlobal.checked);
      const entries = selectedPersonaTargets();
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
        deployConfirmSubmit.disabled = visible.length === 0;
      }
    }

    function confirmPersonaDeploy(persona, root) {
      if (!deployConfirmModal) return Promise.resolve(null);
      deployConfirmContext = { root: root };
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
    if (actionConfirmModal) {
      actionConfirmModal.querySelectorAll("[data-action-confirm]").forEach((el) => {
        el.addEventListener("click", () => {
          closeActionConfirm(el.getAttribute("data-action-confirm") === "confirm");
        });
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
      if (actionConfirmModal && !actionConfirmModal.hidden) {
        closeActionConfirm(false);
        return;
      }
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
    const personaLocalTab = document.getElementById("persona-local-tab");
    const personaTemplatesTab = document.getElementById("persona-templates-tab");
    const personaRemoteTab = document.getElementById("persona-remote-tab");
    const personaLocalView = document.getElementById("persona-local-view");
    const personaTemplatesView = document.getElementById("persona-templates-view");
    const personaRemoteView = document.getElementById("persona-remote-view");
    const personaLocalRemoteStatus = document.getElementById("persona-local-remote-status");
    const personaRemoteRefreshBtn = document.getElementById("persona-remote-refresh-btn");
    const personaRemoteDescription = document.getElementById("persona-remote-description");
    const personaRemoteNotice = document.getElementById("persona-remote-notice");
    const personaRemoteList = document.getElementById("persona-remote-list");
    const personaSyncActionsCard = document.getElementById(
      "persona-sync-actions-card"
    );
    const personaSyncWarning = document.getElementById("persona-sync-warning");
    const personaTargetInputs = Array.from(
      document.querySelectorAll('input[name="persona-target"]')
    );
    const personaBundleSelect = document.getElementById("persona-bundle-select");
    const personaBundleName = document.getElementById("persona-bundle-name");
    const personaBundleNewBtn = document.getElementById("persona-bundle-new-btn");
    const personaBundleDeleteBtn = document.getElementById("persona-bundle-delete-btn");
    const personaBundleCancelBtn = document.getElementById("persona-bundle-cancel-btn");
    const personaBundleCreateBtn = document.getElementById("persona-bundle-create-btn");
    const personaPicker = document.getElementById("persona-picker");
    const personaNewName = document.getElementById("persona-new-name");
    const personaSaveError = document.getElementById("persona-save-error");
    const personaRegistryBody = document.getElementById("persona-registry-body");
    const personaTemplateRow = document.getElementById("persona-template-row");
    const personaTemplateSelect = document.getElementById("persona-template-select");
    const personaContentFile = document.getElementById("persona-content-file");
    const personaContentCount = document.getElementById("persona-content-count");
    const personaContentStatus = document.getElementById("persona-content-status");
    const personaEditor = document.getElementById("persona-editor");
    const personaMdPreview = document.getElementById("persona-md-preview");
    const personaEditBtn = document.getElementById("persona-edit-btn");
    const personaSaveBtn = document.getElementById("persona-save-btn");
    const personaCancelBtn = document.getElementById("persona-cancel-btn");
    const personaDeleteBtn = document.getElementById("persona-delete-btn");
    const personaFilePicker = document.getElementById("persona-file-picker");
    const personaFileBtn = document.getElementById("persona-file-btn");
    const personaFileCurrent = document.getElementById("persona-file-current");
    const personaFileCount = document.getElementById("persona-file-count");
    const personaFileMenu = document.getElementById("persona-file-menu");
    const personaFileBackdrop = document.getElementById("persona-file-backdrop");
    const personaLogWrap = document.getElementById("persona-log-wrap");
    const personaLog = document.getElementById("persona-log");
    const personaLogClose = document.getElementById("persona-log-close");
    const personaGroupTooltip = document.createElement("div");
    personaGroupTooltip.id = "persona-group-tooltip";
    personaGroupTooltip.className = "persona-group-tooltip";
    personaGroupTooltip.setAttribute("role", "tooltip");
    personaGroupTooltip.hidden = true;
    document.body.appendChild(personaGroupTooltip);

    function hidePersonaGroupTooltip() {
      personaGroupTooltip.hidden = true;
    }

    function showPersonaGroupTooltip(button) {
      const text = button.getAttribute("data-tooltip") || "";
      if (!text) return;
      personaGroupTooltip.textContent = text;
      personaGroupTooltip.hidden = false;

      const anchor = button.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const width = personaGroupTooltip.offsetWidth;
      const height = personaGroupTooltip.offsetHeight;
      let left = anchor.right + gap;
      if (left + width > window.innerWidth - margin) {
        left = anchor.left - gap - width;
      }
      left = Math.max(
        margin,
        Math.min(left, window.innerWidth - margin - width)
      );
      const centeredTop = anchor.top + (anchor.height - height) / 2;
      const top = Math.max(
        margin,
        Math.min(centeredTop, window.innerHeight - margin - height)
      );
      personaGroupTooltip.style.left = left + "px";
      personaGroupTooltip.style.top = top + "px";
    }

    function bindPersonaGroupHelp() {
      personaRegistryBody
        .querySelectorAll(".persona-group-help")
        .forEach((button) => {
          button.setAttribute("aria-describedby", personaGroupTooltip.id);
          button.addEventListener("mouseenter", () =>
            showPersonaGroupTooltip(button)
          );
          button.addEventListener("mouseleave", hidePersonaGroupTooltip);
          button.addEventListener("focus", () =>
            showPersonaGroupTooltip(button)
          );
          button.addEventListener("blur", hidePersonaGroupTooltip);
        });
    }

    window.addEventListener("resize", hidePersonaGroupTooltip);
    window.addEventListener("scroll", hidePersonaGroupTooltip, true);

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

    function canPersonaPreview() {
      return !isCreatingPersonaEntry();
    }

    function isPersonaEditing() {
      return personaState.editorView === "source" && canPersonaPreview();
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
      const editing = isPersonaEditing();
      personaDeleteBtn.hidden = !existing || isCreatingPersonaEntry() || editing;
      personaDeleteBtn.textContent = "Delete";
      if (personaCancelBtn) personaCancelBtn.hidden = !editing;
    }

    const personaState = {
      root: "",
      persona: "",
      kind: "agent",
      name: "",
      // Skill-root-relative path of the file open in the editor. Only
      // meaningful while kind === "skill"; SKILL.md is the mandatory default.
      file: "SKILL.md",
      editorView: "preview",
      listing: null,
      loaded: false,
      initializing: false,
      savedContent: "",
      busy: false,
      view: "local",
      remotePersonas: [],
      // persona_id → { revision, synced_at, content_hash } for what this
      // device last pushed or pulled.
      syncedRevisions: {},
      // persona_id → current bundle hash on disk. Compared against the
      // synced content_hash to tell "edited here" apart from "behind".
      localHashes: {},
      // persona_id → local hash error. A broken bundle must never be treated
      // as absent or safe to overwrite.
      localHashErrors: {},
      remoteLoading: false,
      remoteLoadSequence: 0,
      currentExpanded: false,
    };

    function syncPersonaEditState() {
      personaSaveBtn.disabled = personaState.busy;
    }

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
      personaState.busy = busy;
      [
        personaEditBtn,
        personaCancelBtn,
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
      personaBundleSelect.disabled = busy || !personaState.persona;
      personaBundleDeleteBtn.disabled = busy || !personaState.persona;
      personaRootInput.disabled = busy;
      syncPersonaEditState();
      // Organization actions are gated separately so signed-out state wins.
      renderPersonaSyncButtons();
    }

    function renderPersonaSyncButtons() {
      const signedIn = hasSavedTokens(lastStatus);
      personaSyncWarning.hidden = true;
      personaRemoteRefreshBtn.disabled =
        !signedIn || personaState.busy || personaState.remoteLoading;
      personaRemoteView
        .querySelectorAll(
          "[data-remote-sync], [data-remote-upload], [data-remote-rollback]"
        )
        .forEach((button) => {
          button.disabled =
            !signedIn || personaState.busy || personaState.remoteLoading;
        });
    }

    function formatPersonaRelativeTime(value) {
      const when = new Date(value);
      if (isNaN(when)) return "";
      const seconds = Math.max(
        0,
        Math.floor((Date.now() - when.getTime()) / 1000)
      );
      if (seconds < 60) return "just now";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + "m ago";
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + "h ago";
      const days = Math.floor(hours / 24);
      if (days < 30) return days + "d ago";
      return when.toLocaleDateString();
    }

    function describeRemotePersona(remote) {
      const parts = [];
      const who = remote.updated_by_name || remote.updated_by_email;
      if (who) parts.push(who);
      if (remote.updated_at) {
        const relative = formatPersonaRelativeTime(remote.updated_at);
        if (relative) parts.push(relative);
      }
      if (parts.length === 0) return "Organization copy";
      return parts.join(" · ");
    }

    /**
     * Classify one Persona from three facts: the organization revision, the
     * revision this device last synced, and whether the local bundle changed
     * since that sync (current hash vs synced content_hash). Five states, one
     * action each:
     *
     *   org newer  + unedited  → behind    → Get from remote
     *   org same   + edited    → edited    → Update remote
     *   org newer  + edited    → conflict  → Get from remote (backs up local)
     *   org same   + unedited  → current   → nothing to do
     *   no org copy            → local-only → Publish to remote
     *   no local copy          → remote-only → Get from remote
     *
     * The synced revision stays null when the Persona was never pushed or
     * pulled here — 0 would read as a real "revision zero". Both copies
     * existing without a sync record is treated as a conflict: a download
     * would overwrite files whose history is unknown, so it must back up.
     */
    function personaSyncStatus(personaId) {
      const remote =
        personaState.remotePersonas.find(
          (entry) => entry.persona_id === personaId
        ) || null;
      const org =
        remote && typeof remote.revision === "number" ? remote.revision : null;
      const entry = personaState.syncedRevisions[personaId];
      const synced =
        entry && typeof entry.revision === "number" ? entry.revision : null;
      if (personaState.localHashErrors[personaId]) {
        return {
          state: "unknown",
          label: "UNAVAILABLE",
          local: synced,
          org,
          remote,
          action: null,
        };
      }
      const currentHash = personaState.localHashes[personaId] || null;
      if (org === null) {
        return {
          state: "local-only",
          label: "",
          local: null,
          org: null,
          remote: null,
          action: "share",
        };
      }
      if (currentHash === null) {
        return {
          state: "remote-only",
          label: "REMOTE ONLY",
          local: null,
          org,
          remote,
          action: "get",
        };
      }
      const syncedHash =
        entry && typeof entry.content_hash === "string"
          ? entry.content_hash
          : null;
      if (synced === null || syncedHash === null) {
        // No baseline to compare against — either this machine never synced,
        // or it synced before content hashes existed. Local edits cannot be
        // ruled out, so the only offered action downloads with a backup;
        // that download also records the missing baseline.
        return {
          state: "conflict",
          label: synced === null ? "CONFLICT" : "STATUS UNKNOWN",
          local: synced,
          org,
          remote,
          action: "get-backup",
        };
      }
      const edited = currentHash !== syncedHash;
      const behind = org > synced;
      if (org < synced) {
        return {
          state: "conflict",
          label: "CONFLICT",
          local: synced,
          org,
          remote,
          action: "get-backup",
        };
      }
      if (behind && edited) {
        return {
          state: "conflict",
          label: "CONFLICT",
          local: synced,
          org,
          remote,
          action: "get-backup",
        };
      }
      if (behind) {
        return {
          state: "behind",
          label: "UPDATE REQUIRED",
          local: synced,
          org,
          remote,
          action: "get",
        };
      }
      if (edited) {
        return {
          state: "edited",
          label: "EDITED",
          local: synced,
          org,
          remote,
          action: "share",
        };
      }
      return {
        state: "current",
        label: "LATEST",
        local: synced,
        org,
        remote,
        action: null,
      };
    }

    function personaBundleVersionText() {
      if (!hasSavedTokens(lastStatus) || !personaState.persona) return "";
      const status = personaSyncStatus(personaState.persona);
      const current = status.local === null ? "—" : "v" + status.local;
      const remote = status.org === null ? "—" : "v" + status.org;
      return "Current " + current + " · Remote " + remote;
    }

    function renderPersonaBundleRemoteVersion() {
      const el = document.getElementById("persona-bundle-remote-ver");
      if (!el) return;
      const text = personaBundleVersionText();
      el.textContent = text;
      el.hidden = !text;
    }

    function renderLocalRemoteStatus() {
      personaLocalRemoteStatus.textContent = "";
      personaLocalRemoteStatus.removeAttribute("data-state");
      personaLocalRemoteStatus.removeAttribute("title");
      renderPersonaBundleRemoteVersion();
    }

    /**
     * Short reason for the attention list. The version arrow already shows
     * direction (this device → remote); this line only names the situation.
     */
    function personaSyncReason(status) {
      switch (status.state) {
        case "local-only":
          return "Not published";
        case "remote-only":
          return "Remote only";
        case "edited":
          return "Edited";
        case "behind":
          return "Remote newer";
        case "conflict":
          return "Conflict";
        case "current":
          return "Up to date";
        case "unknown":
          return "Could not check";
        default:
          return "";
      }
    }

    function personaSyncActionHtml(personaId, status) {
      if (status.action === "get") {
        return (
          '<button type="button" class="btn-inline-action persona-remote-sync-btn" data-remote-sync="' +
          esc(personaId) +
          '" title="Download the remote organization version to this device">Download</button>'
        );
      }
      if (status.action === "get-backup") {
        return (
          '<button type="button" class="btn-inline-action persona-remote-sync-btn" data-remote-sync="' +
          esc(personaId) +
          '" title="Your local changes are backed up before the remote version overwrites this device">Download · backup</button>'
        );
      }
      if (status.action === "share") {
        const upload =
          '<button type="button" class="btn-inline-action persona-remote-sync-btn" data-remote-upload="' +
          esc(personaId) +
          '" title="' +
          (status.state === "local-only"
            ? "Upload this Persona from this device to remote"
            : "Replace the remote organization version with this device\\u2019s copy") +
          '">' +
          (status.state === "local-only" ? "Publish" : "Upload") +
          "</button>";
        if (status.state !== "edited") return upload;
        return (
          upload +
          '<button type="button" class="btn-inline-action persona-remote-sync-btn" data-remote-rollback="' +
          esc(personaId) +
          '" title="Discard local edits and restore the remote version">Roll Back</button>'
        );
      }
      return "";
    }

    function personaSyncHeadHtml() {
      return (
        '<div class="persona-sync-head" role="row">' +
        '<p class="persona-sync-row-name">Persona</p>' +
        '<p class="persona-sync-row-ver">Remote</p>' +
        '<p class="persona-sync-row-ver">Local</p>' +
        '<p class="persona-sync-row-status">Status</p>' +
        '<p class="persona-sync-row-updated">Updated</p>' +
        '<div class="persona-sync-row-action"></div></div>'
      );
    }

    function personaSyncRowHtml(personaId, withActions) {
      const status = personaSyncStatus(personaId);
      const local = status.local === null ? "—" : String(status.local);
      const remote = status.org === null ? "—" : String(status.org);
      const action = withActions ? personaSyncActionHtml(personaId, status) : "";
      const updated = status.remote
        ? describeRemotePersona(status.remote)
        : "—";
      return (
        '<div class="persona-sync-row" data-state="' +
        esc(status.state) +
        '">' +
        '<p class="persona-sync-row-name">' +
        esc(personaId) +
        "</p>" +
        '<p class="persona-sync-row-ver">' +
        esc(remote) +
        "</p>" +
        '<p class="persona-sync-row-ver">' +
        esc(local) +
        "</p>" +
        '<p class="persona-sync-row-status">' +
        esc(personaSyncReason(status)) +
        "</p>" +
        '<p class="persona-sync-row-updated">' +
        esc(updated) +
        "</p>" +
        '<div class="persona-sync-row-action">' +
        action +
        "</div></div>"
      );
    }

    function personaSyncGroupsHtml(ids, signedIn) {
      const attention = [];
      const current = [];
      ids.forEach((personaId) => {
        if (personaSyncStatus(personaId).state === "current") {
          current.push(personaId);
        } else {
          attention.push(personaId);
        }
      });
      let html =
        '<section class="persona-sync-group">' +
        '<div class="persona-sync-group-head"><h3 class="persona-sync-group-title">NEEDS ATTENTION (' +
        attention.length +
        ")</h3></div>";
      if (attention.length) {
        html +=
          '<div class="persona-sync-rows">' +
          personaSyncHeadHtml() +
          attention
            .map((personaId) => personaSyncRowHtml(personaId, signedIn))
            .join("") +
          "</div>";
      }
      html += "</section>";
      if (current.length) {
        const expanded = !!personaState.currentExpanded;
        html +=
          '<section class="persona-sync-group is-current">' +
          '<div class="persona-sync-group-head"><h3 class="persona-sync-group-title">UP TO DATE (' +
          current.length +
          ')</h3><button type="button" class="persona-sync-current-toggle" id="persona-sync-current-toggle" aria-expanded="' +
          (expanded ? "true" : "false") +
          '">' +
          (expanded ? "Collapse" : "Expand") +
          "</button></div>" +
          '<p class="persona-sync-current-summary"' +
          (expanded ? " hidden" : "") +
          ">" +
          current.map((personaId) => esc(personaId)).join(" · ") +
          "</p>" +
          '<div class="persona-sync-rows" id="persona-sync-current-rows"' +
          (expanded ? "" : " hidden") +
          ">" +
          personaSyncHeadHtml() +
          current
            .map((personaId) => personaSyncRowHtml(personaId, false))
            .join("") +
          "</div></section>";
      }
      return html;
    }

    function bindRemotePersonaActions() {
      personaRemoteView
        .querySelectorAll("[data-remote-sync]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            pullPersona(button.getAttribute("data-remote-sync"));
          });
        });
      personaRemoteView
        .querySelectorAll("[data-remote-upload]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            pushPersona(button.getAttribute("data-remote-upload"));
          });
        });
      personaRemoteView
        .querySelectorAll("[data-remote-rollback]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            pullPersona(button.getAttribute("data-remote-rollback"), {
              rollback: true,
            });
          });
        });
      const toggle = document.getElementById("persona-sync-current-toggle");
      if (toggle) {
        toggle.addEventListener("click", () => {
          personaState.currentExpanded = !personaState.currentExpanded;
          renderRemotePersonas();
        });
      }
    }

    function signInPitchCardHtml(opts) {
      const feature = (icon, title, desc) =>
        '<div class="signin-pitch-feature">' +
        icon +
        '<p class="signin-pitch-feature-title">' + title + "</p>" +
        '<p class="signin-pitch-feature-desc">' + desc + "</p>" +
        "</div>";
      const cta = opts.hideCta
        ? ""
        : '<div class="signin-pitch-cta">' +
          '<button type="button" class="btn-session-login signin-pitch-btn" data-open-login>Login</button>' +
          '<p class="signin-pitch-hint">Sign-in opens in your browser \u2014 it takes about 30 seconds.</p>' +
          "</div>";
      return (
        '<div class="signin-pitch-card">' +
        '<div class="signin-pitch-head">' +
        '<div class="signin-pitch-icon">' + opts.icon + "</div>" +
        '<p class="signin-pitch-title">' + opts.title + "</p>" +
        '<p class="signin-pitch-sub">' + opts.sub + "</p>" +
        "</div>" +
        '<div class="signin-pitch-features">' +
        opts.features.map((item) => feature(item.icon, item.title, item.desc)).join("") +
        "</div>" +
        cta +
        "</div>"
      );
    }

    const signInPitchIcons = {
      sparkles: ${JSON.stringify(ICON_PERSONA)},
      down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>',
      up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>',
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>',
      user: ${JSON.stringify(ICON_PROFILE)},
      key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" /></svg>',
      fingerprint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33" /></svg>',
      shield: ${JSON.stringify(ICON_PERMISSION)},
      list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>',
      lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>',
      clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18A2.25 2.25 0 0 0 20.25 16.5V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" /></svg>',
    };

    function personaSignInCardHtml() {
      return signInPitchCardHtml({
        icon: signInPitchIcons.sparkles,
        title: "Sign in to sync your Personas",
        sub: "Set up a Persona once, publish it, and every teammate runs the exact same version \u2014 no more copy-pasting configs between machines or setups drifting apart.",
        features: [
          {
            icon: signInPitchIcons.down,
            title: "Get the latest",
            desc: "Pull Personas your teammates already built and refined \u2014 ready to apply in one click.",
          },
          {
            icon: signInPitchIcons.up,
            title: "Publish yours",
            desc: "Push Personas from this device so everyone works from one version.",
          },
          {
            icon: signInPitchIcons.clock,
            title: "Upload backup",
            desc: "Upload a copy to your organization so your Personas stay safe if this device is lost or reset.",
          },
        ],
      });
    }

    function profileSignInCardHtml() {
      return signInPitchCardHtml({
        icon: signInPitchIcons.user,
        title: "Sign in to manage your account",
        sub: "See which Transcodes account this computer is using, add a passkey, and review the session on this device.",
        features: [
          {
            icon: signInPitchIcons.user,
            title: "Your account",
            desc: "Email, organization, and project connected to this computer \u2014 in one place.",
          },
          {
            icon: signInPitchIcons.key,
            title: "Passkey",
            desc: "Register a passkey or biometrics so Transcodes can ask you to confirm risky work.",
          },
          {
            icon: signInPitchIcons.clock,
            title: "This device",
            desc: "See the session on this computer and sign out when you are done.",
          },
        ],
      });
    }

    function permissionSignInCardHtml() {
      return signInPitchCardHtml({
        icon: signInPitchIcons.shield,
        title: "Set AI limits. Require human approval. Keep records",
        sub: "Control what your AI can do \u2014 coming soon",
        hideCta: true,
        features: [
          {
            icon: signInPitchIcons.lock,
            title: "Set limits",
            desc: "Decide which actions run immediately, and which ones are blocked.",
          },
          {
            icon: signInPitchIcons.fingerprint,
            title: "Confirm with your finger",
            desc: "Risky work only runs after a fingerprint or face check.",
          },
          {
            icon: signInPitchIcons.clipboard,
            title: "Keep a record",
            desc: "See when something was approved or blocked.",
          },
        ],
      });
    }

    function renderRemotePersonas() {
      const localPersonas =
        personaState.listing && personaState.listing.personas
          ? personaState.listing.personas
          : [];
      const signedIn = hasSavedTokens(lastStatus);
      if (personaSyncActionsCard) personaSyncActionsCard.hidden = !signedIn;

      // Union of both sides, organization order first so shared Personas
      // keep a stable position, then local-only ones.
      const remoteIds = personaState.remotePersonas.map(
        (remote) => remote.persona_id
      );
      const ids = remoteIds.concat(
        localPersonas.filter((persona) => remoteIds.indexOf(persona) === -1)
      );

      if (authViewState() === "loading") {
        personaRemoteList.innerHTML = panelLoadingHtml();
        personaRemoteList.hidden = false;
        return;
      }

      if (!signedIn) {
        // Signed-out is not an error — it is the moment a solo user first
        // meets organization sharing, so pitch the value instead of warning
        // in red.
        if (personaRemoteDescription) {
          personaRemoteDescription.textContent =
            "Set up once. Every device and every teammate runs the same versions of Persona";
        }
        personaRemoteNotice.textContent = "";
        personaRemoteNotice.removeAttribute("data-tone");
        personaRemoteList.innerHTML = personaSignInCardHtml();
        personaRemoteList.hidden = false;
        renderPersonaSyncButtons();
        return;
      }

      if (personaRemoteDescription) {
        personaRemoteDescription.textContent =
          "Download or publish only the Personas that are out of date";
      }
      personaRemoteList.hidden = false;
      personaRemoteNotice.removeAttribute("data-tone");

      personaRemoteList.innerHTML =
        ids.length === 0
          ? '<p class="persona-remote-empty">No Personas yet — create one in My Personas, or wait for a teammate to publish one.</p>'
          : personaSyncGroupsHtml(ids, signedIn);

      bindRemotePersonaActions();
      renderPersonaSyncButtons();
    }

    async function loadRemotePersonas() {
      const requestId = ++personaState.remoteLoadSequence;
      renderPersonaSyncButtons();
      if (authViewState() !== "signed-in") {
        personaState.remotePersonas = [];
        personaState.syncedRevisions = {};
        personaState.localHashes = {};
        personaState.localHashErrors = {};
        personaState.remoteLoading = false;
        renderLocalRemoteStatus();
        renderRemotePersonas();
        return;
      }
      personaState.remoteLoading = true;
      renderPersonaSyncButtons();
      personaRemoteNotice.textContent = "Loading Personas…";
      personaRemoteNotice.removeAttribute("data-tone");
      try {
        const data = await personaFetch("/api/persona/remote");
        if (requestId !== personaState.remoteLoadSequence) return;
        personaState.remotePersonas = Array.isArray(data.personas)
          ? data.personas
          : [];
        personaState.syncedRevisions =
          data.synced && typeof data.synced === "object" ? data.synced : {};
        personaState.localHashes =
          data.local_hashes && typeof data.local_hashes === "object"
            ? data.local_hashes
            : {};
        personaState.localHashErrors =
          data.local_hash_errors && typeof data.local_hash_errors === "object"
            ? data.local_hash_errors
            : {};
        personaRemoteNotice.textContent = "";
        personaRemoteNotice.removeAttribute("data-tone");
        renderLocalRemoteStatus();
        renderRemotePersonas();
      } catch (e) {
        if (requestId !== personaState.remoteLoadSequence) return;
        personaRemoteNotice.textContent =
          "Could not load organization Personas · " +
          (e.message || "Request failed");
        personaRemoteNotice.dataset.tone = "warn";
        // Without the organization side, no state can be classified safely —
        // show local Personas without actions until the next refresh works.
        personaLocalRemoteStatus.textContent =
          "Organization status unavailable · Refresh to try again";
        personaLocalRemoteStatus.dataset.state = "unknown";
        const localPersonas =
          personaState.listing && personaState.listing.personas
            ? personaState.listing.personas
            : [];
        personaRemoteList.innerHTML = localPersonas
          .map(
            (personaId) =>
              '<div class="persona-sync-row" data-state="unknown">' +
              '<p class="persona-sync-row-name">' +
              esc(personaId) +
              '</p><p class="persona-sync-row-ver">—</p>' +
              '<p class="persona-sync-row-ver">—</p>' +
              '<p class="persona-sync-row-status">Unavailable</p>' +
              '<p class="persona-sync-row-updated">—</p>' +
              '<div class="persona-sync-row-action"></div></div>'
          )
          .join("");
      } finally {
        if (requestId === personaState.remoteLoadSequence) {
          personaState.remoteLoading = false;
          renderPersonaSyncButtons();
        }
      }
    }

    async function renderPersonaSyncState() {
      await loadRemotePersonas();
    }

    function setPersonaView(view, opts) {
      const options = opts || {};
      const next =
        view === "remote" || view === "templates" ? view : "local";
      personaState.view = next;
      const tabs = [
        [personaLocalTab, personaLocalView, "local"],
        [personaTemplatesTab, personaTemplatesView, "templates"],
        [personaRemoteTab, personaRemoteView, "remote"],
      ];
      tabs.forEach(([tab, panel, name]) => {
        const on = name === next;
        panel.hidden = !on;
        tab.classList.toggle("active", on);
        if (on) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
      });
      if (next === "templates") resetPersonaTemplateForms();
      if (next === "remote") void loadRemotePersonas();
      if (!options.skipUrl) {
        syncRouteUrl("persona", personaState.view, !!options.replaceUrl);
      }
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
        '" aria-label="Delete ' +
        esc(name) +
        '" title="Delete ' +
        esc(name) +
        '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"></path></svg></button>' +
        "</li>"
      );
    }

    function personaGroupHtml(label, items, kind) {
      const addButton =
        kind !== "agent" || items.length === 0
          ? '<button type="button" class="persona-group-add" data-add-kind="' +
            kind +
            '" aria-label="Add ' +
            label +
            '" title="Add ' +
            label +
            '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>'
          : "";
      const helpButton =
        '<button type="button" class="persona-group-help" aria-label="About ' +
        label +
        '" data-tooltip="' +
        esc(PERSONA_GROUP_HELP[kind] || "") +
        '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"></path></svg></button>';
      return (
        '<div class="persona-group"><p class="persona-group-label"><span>' +
        label +
        "</span>" +
        addButton +
        helpButton +
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
      personaBundleSelect.innerHTML = personas
        .map(
          (name) =>
            '<option value="' + esc(name) + '">' + esc(name) + "</option>"
        )
        .join("");
      if (personaState.persona) {
        personaBundleSelect.value = personaState.persona;
      }
    }

    function renderPersonaRegistry() {
      hidePersonaGroupTooltip();
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

      const bundleName = listing.persona || personaState.persona;
      const remoteVer = personaBundleVersionText();
      const bundleHead = bundleName
        ? '<div class="persona-bundle-card-head">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"></path></svg>' +
          '<div class="persona-bundle-card-titles">' +
          '<span class="persona-bundle-card-name">' +
          esc(bundleName) +
          "</span>" +
          '<span class="persona-bundle-remote-ver" id="persona-bundle-remote-ver"' +
          (remoteVer ? "" : " hidden") +
          ">" +
          esc(remoteVer) +
          "</span></div></div>"
        : "";

      personaRegistryBody.innerHTML =
        '<div class="persona-bundle-card">' +
        bundleHead +
        '<div class="persona-child-tree">' +
        personaGroupHtml("Instruction", agentItems, "agent") +
        personaGroupHtml("Rule", ruleItems, "rule") +
        personaGroupHtml("Skill", skillItems, "skill") +
        "</div></div>";
      bindPersonaGroupHelp();

      personaRegistryBody.querySelectorAll("[data-add-kind]").forEach((btn) => {
        btn.addEventListener("click", () =>
          beginPersonaEntry(btn.getAttribute("data-add-kind")));
      });
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
      const deletingOpenEntry =
        kind === personaState.kind &&
        (kind === "agent" || name === personaState.name);
      if (
        !deletingOpenEntry &&
        !(await confirmDiscardPersonaChanges("delete another file"))
      ) {
        return;
      }
      const kindLabel =
        kind === "agent" ? "Instruction" : kind === "skill" ? "Skill" : "Rule";
      const fileLabel = kind === "agent" ? "agents.md" : name;
      const ok = await confirmAction({
        title: "Delete " + kindLabel + "?",
        description:
          "“" + fileLabel + "” will be permanently deleted from Persona “" +
          personaState.persona + "”",
        warning: "This action cannot be undone",
        confirmLabel: "Delete",
        danger: true,
      });
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
        }
        showToast("Removed " + (kind === "agent" ? "agents.md" : name), "success");
        await loadPersonaListing(personaRootInput.value.trim());
        syncPersonaEntryForm();
        renderPersonaRegistry();
        if (personaState.kind === kind) {
          try { await loadPersonaFile(); } catch (_) { /* ignore */ }
        }
        if (hasSavedTokens(lastStatus)) await loadRemotePersonas();
      } catch (e) {
        showToast(e.message || "Could not remove", "error");
      } finally {
        personaBusy(false);
      }
    }

    async function openPersonaEntry(kind, name) {
      if (!(await confirmDiscardPersonaChanges("the selected file"))) return;
      personaState.name = kind === "agent" ? "" : name;
      personaState.file = "SKILL.md";
      selectPersonaKind(kind);
      showPersonaNewName(false);
      try {
        await loadPersonaFile();
        renderPersonaRegistry();
      } catch (e) {
        setPersonaHint(e.message || "Could not read that file", true);
      }
    }

    async function beginPersonaEntry(kind) {
      if (!(await confirmDiscardPersonaChanges("a new file"))) return;
      personaState.name = "";
      personaState.file = "SKILL.md";
      selectPersonaKind(kind);
      showPersonaNewName(false);
      hidePersonaLog();

      if (kind !== "agent") {
        setPersonaEditorContent("");
        showPersonaNewName(true);
        renderPersonaRegistry();
        return;
      }

      try {
        await loadPersonaFile();
        renderPersonaRegistry();
      } catch (e) {
        setPersonaHint(e.message || "Could not prepare that file", true);
      }
    }

    const PERSONA_GROUP_HELP = {
      agent:
        "Instruction (AGENTS.md / CLAUDE.md) defines the agent's identity and project background. Keep always-loaded guidance focused at 500–1,500 tokens; move conditional policies to Rules and procedures to Skills.",
      rule:
        "Rule is one focused policy file (Must / Never). Keep it at 100–500 tokens, split unrelated policies, and do not put workflows or step-by-step procedures here.",
      skill:
        "Skill is one focused workflow file. Use 500–2,000 tokens for prerequisites, steps, templates, and done criteria; split distinct workflows and keep standing policies in Rules.",
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

    function currentPersonaFileLabel() {
      if (personaState.kind === "agent") return "agents.md";
      if (personaState.kind === "rule") {
        return personaState.name ? personaState.name + ".md" : "New rule";
      }
      return personaState.name
        ? personaState.name + "/" + (personaState.file || "SKILL.md")
        : "New skill";
    }

    function updatePersonaContentStats() {
      if (
        !personaContentFile ||
        !personaContentCount ||
        !personaContentStatus ||
        !personaEditor
      ) return;
      const text = personaEditor.value || "";
      const words = text.trim() ? text.trim().split(/\\s+/).length : 0;
      const tokens = text.trim() ? approximatePersonaTokens(text) : 0;
      const budget = PERSONA_CONTENT_BUDGETS[personaState.kind];
      personaContentFile.textContent = currentPersonaFileLabel();
      personaContentCount.textContent =
        "≈ " + tokens.toLocaleString() + " tokens · " + words.toLocaleString() + " words";
      // Token budgets are calibrated for instruction files, not for a Skill's
      // companion scripts or reference docs.
      const companionFileOpen =
        personaState.kind === "skill" && personaState.file !== "SKILL.md";
      personaContentStatus.textContent = companionFileOpen
        ? ""
        : "Best Length: " + budget;
    }

    function currentSkillEntry() {
      const listing = personaState.listing;
      if (!listing || !listing.skills) return null;
      return (
        listing.skills.find((skill) => skill.name === personaState.name) ||
        null
      );
    }

    function currentSkillFiles() {
      const entry = currentSkillEntry();
      if (!entry || !Array.isArray(entry.files) || entry.files.length === 0) {
        return ["SKILL.md"];
      }
      return entry.files;
    }

    function currentSkillDirs() {
      const entry = currentSkillEntry();
      return entry && Array.isArray(entry.dirs) ? entry.dirs : [];
    }

    function addSkillFileToListing(file) {
      const entry = currentSkillEntry();
      if (!entry) return;
      if (!Array.isArray(entry.files)) entry.files = ["SKILL.md"];
      if (entry.files.indexOf(file) === -1) entry.files.push(file);
      // Same order the server uses: SKILL.md, root files, folder contents.
      entry.files.sort((a, b) => {
        if (a === "SKILL.md") return -1;
        if (b === "SKILL.md") return 1;
        const aNested = a.indexOf("/") !== -1;
        const bNested = b.indexOf("/") !== -1;
        if (aNested !== bNested) return aNested ? 1 : -1;
        return a.localeCompare(b);
      });
    }

    function addSkillDirToListing(dir) {
      const entry = currentSkillEntry();
      if (!entry) return;
      if (!Array.isArray(entry.dirs)) entry.dirs = [];
      if (entry.dirs.indexOf(dir) === -1) entry.dirs.push(dir);
      entry.dirs.sort();
    }

    function removeSkillPathFromListing(targetPath, isDir) {
      const entry = currentSkillEntry();
      if (!entry) return;
      if (Array.isArray(entry.files)) {
        entry.files = entry.files.filter((file) =>
          isDir
            ? file !== targetPath && file.indexOf(targetPath + "/") !== 0
            : file !== targetPath
        );
      }
      if (isDir && Array.isArray(entry.dirs)) {
        entry.dirs = entry.dirs.filter(
          (dir) =>
            dir !== targetPath && dir.indexOf(targetPath + "/") !== 0
        );
      }
    }

    // Pending "new file" / "new folder" input inside the file menu.
    let personaFileDraft = null;

    function closePersonaFileMenu() {
      if (!personaFileMenu || !personaFileBtn) return;
      personaFileDraft = null;
      personaFileMenu.hidden = true;
      if (personaFileBackdrop) personaFileBackdrop.hidden = true;
      if (personaFilePicker) personaFilePicker.classList.remove("is-open");
      personaFileBtn.setAttribute("aria-expanded", "false");
    }

    const PERSONA_FILE_TRASH_ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"></path></svg>';

    function personaFileRemoveHtml(target, isDir) {
      const label = isDir ? target + "/" : target;
      return (
        '<button type="button" class="persona-file-remove" data-remove-' +
        (isDir ? "dir" : "file") +
        '="' +
        esc(target) +
        '" title="Delete ' +
        esc(label) +
        '" aria-label="Delete ' +
        esc(label) +
        '">' +
        PERSONA_FILE_TRASH_ICON +
        "</button>"
      );
    }

    function personaFileMenuItemHtml(file, label, nested) {
      const item =
        '<button type="button" class="persona-file-item' +
        (nested ? " nested" : "") +
        (file === personaState.file ? " active" : "") +
        '" role="option" data-skill-file="' +
        esc(file) +
        '" title="' +
        esc(file) +
        '">' +
        esc(label) +
        "</button>";
      if (file === "SKILL.md") return item;
      return (
        '<div class="persona-file-row">' +
        item +
        personaFileRemoveHtml(file, false) +
        "</div>"
      );
    }

    function personaFileNewInputHtml(root) {
      const folderDraft = personaFileDraft && personaFileDraft.type === "folder";
      return (
        '<div class="persona-file-new' +
        (root ? " root" : "") +
        '">' +
        '<input type="text" id="persona-file-new-input" placeholder="' +
        (folderDraft ? "folder-name" : "file-name.md") +
        '" autocomplete="off" spellcheck="false" aria-label="' +
        (folderDraft ? "New folder name" : "New file name") +
        '">' +
        '<button type="button" class="persona-file-new-confirm" id="persona-file-new-confirm">Add</button>' +
        "</div>"
      );
    }

    function renderPersonaFilePicker() {
      if (!personaFilePicker) return;
      const visible =
        personaState.kind === "skill" &&
        !!personaState.name &&
        !isCreatingPersonaEntry();
      personaFilePicker.hidden = !visible;
      if (!visible) {
        closePersonaFileMenu();
        return;
      }

      const files = currentSkillFiles();
      personaFileCurrent.textContent = personaState.file;
      personaFileCount.textContent =
        files.length + (files.length === 1 ? " file" : " files");

      // Root files first (SKILL.md is always first), then one group per
      // top-level folder, mirroring the on-disk layout. Folders come from
      // both file paths and the dirs listing, so empty folders show too.
      const rootFiles = files.filter((file) => file.indexOf("/") === -1);
      const folders = [];
      files.forEach((file) => {
        const slash = file.indexOf("/");
        if (slash === -1) return;
        const folder = file.slice(0, slash);
        if (folders.indexOf(folder) === -1) folders.push(folder);
      });
      currentSkillDirs().forEach((dir) => {
        const folder = dir.split("/")[0];
        if (folders.indexOf(folder) === -1) folders.push(folder);
      });
      folders.sort();

      let html = rootFiles
        .map((file) => personaFileMenuItemHtml(file, file, false))
        .join("");
      folders.forEach((folder) => {
        html +=
          '<div class="persona-file-group">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"></path></svg>' +
          esc(folder) +
          "/" +
          '<button type="button" class="persona-file-add" data-add-dir="' +
          esc(folder) +
          '" title="New file in ' +
          esc(folder) +
          '/" aria-label="New file in ' +
          esc(folder) +
          '/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>' +
          personaFileRemoveHtml(folder, true) +
          "</div>" +
          (personaFileDraft &&
          personaFileDraft.type === "file" &&
          personaFileDraft.dir === folder
            ? personaFileNewInputHtml(false)
            : "") +
          files
            .filter((file) => file.indexOf(folder + "/") === 0)
            .map((file) =>
              personaFileMenuItemHtml(
                file,
                file.slice(folder.length + 1),
                true
              ))
            .join("");
      });
      html +=
        '<div class="persona-file-menu-footer">' +
        (personaFileDraft && personaFileDraft.type === "folder"
          ? personaFileNewInputHtml(true)
          : '<button type="button" class="persona-file-new-folder-btn" id="persona-file-new-folder">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"></path></svg>' +
            "New folder</button>") +
        "</div>";
      personaFileMenu.innerHTML = html;

      personaFileMenu
        .querySelectorAll("[data-skill-file]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            openSkillFile(button.getAttribute("data-skill-file"));
          });
        });
      personaFileMenu.querySelectorAll("[data-add-dir]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          personaFileDraft = {
            type: "file",
            dir: button.getAttribute("data-add-dir"),
          };
          renderPersonaFilePicker();
          focusPersonaFileDraftInput();
        });
      });
      personaFileMenu.querySelectorAll("[data-remove-file]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteSkillPathFromMenu(button.getAttribute("data-remove-file"), false);
        });
      });
      personaFileMenu.querySelectorAll("[data-remove-dir]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteSkillPathFromMenu(button.getAttribute("data-remove-dir"), true);
        });
      });
      const newFolderBtn = personaFileMenu.querySelector(
        "#persona-file-new-folder"
      );
      if (newFolderBtn) {
        newFolderBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          personaFileDraft = { type: "folder" };
          renderPersonaFilePicker();
          focusPersonaFileDraftInput();
        });
      }
      const draftInput = personaFileMenu.querySelector(
        "#persona-file-new-input"
      );
      if (draftInput) {
        draftInput.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            submitPersonaFileDraft(draftInput.value);
          } else if (event.key === "Escape") {
            personaFileDraft = null;
            renderPersonaFilePicker();
          }
        });
        draftInput.addEventListener("click", (event) =>
          event.stopPropagation()
        );
      }
      const draftConfirm = personaFileMenu.querySelector(
        "#persona-file-new-confirm"
      );
      if (draftConfirm) {
        draftConfirm.addEventListener("click", (event) => {
          event.stopPropagation();
          const input = personaFileMenu.querySelector(
            "#persona-file-new-input"
          );
          submitPersonaFileDraft(input ? input.value : "");
        });
      }
    }

    function focusPersonaFileDraftInput() {
      const input = personaFileMenu.querySelector("#persona-file-new-input");
      if (input) input.focus();
    }

    function keepPersonaFileMenuOpen() {
      if (!personaFileMenu || !personaFileBtn) return;
      personaFileMenu.hidden = false;
      if (personaFileBackdrop) personaFileBackdrop.hidden = false;
      if (personaFilePicker) personaFilePicker.classList.add("is-open");
      personaFileBtn.setAttribute("aria-expanded", "true");
    }

    function isInsidePersonaFileMenu(event) {
      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const nodes = path.length
        ? path
        : [event.target, event.target && event.target.parentElement];
      return (
        nodes.indexOf(personaFileBtn) !== -1 ||
        nodes.indexOf(personaFileMenu) !== -1
      );
    }

    async function deleteSkillPathFromMenu(targetPath, isDir) {
      if (!targetPath || targetPath === "SKILL.md") return;
      const label = isDir ? targetPath + "/" : targetPath;
      const ok = await confirmAction({
        title: isDir ? "Delete folder?" : "Delete file?",
        description:
          "“" + label + "” will be permanently deleted from this Skill",
        warning: "This action cannot be undone",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) {
        keepPersonaFileMenuOpen();
        return;
      }
      try {
        await personaFetch("/api/persona/delete-skill-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
            persona: personaState.persona,
            name: personaState.name,
            path: targetPath,
          }),
        });
        removeSkillPathFromListing(targetPath, isDir);
        const openFile = personaState.file;
        const lostOpen = isDir
          ? openFile === targetPath ||
            openFile.indexOf(targetPath + "/") === 0
          : openFile === targetPath;
        if (lostOpen) {
          personaState.file = "SKILL.md";
          await loadPersonaFile();
        }
        renderPersonaFilePicker();
        keepPersonaFileMenuOpen();
      } catch (e) {
        showToast(e.message || "Could not delete", "error");
        keepPersonaFileMenuOpen();
      }
    }

    async function submitPersonaFileDraft(value) {
      if (!personaFileDraft) return;
      const draft = personaFileDraft;
      const name = (value || "").trim();
      if (!name) return;
      const rootParam =
        personaRootInput.value.trim() || personaState.root;

      if (draft.type === "folder") {
        try {
          await personaFetch("/api/persona/create-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              root: rootParam,
              persona: personaState.persona,
              name: personaState.name,
              dir: name,
            }),
          });
          addSkillDirToListing(name);
          personaFileDraft = null;
          renderPersonaFilePicker();
        } catch (e) {
          showToast(e.message || "Could not create the folder", "error");
        }
        return;
      }

      const file = draft.dir ? draft.dir + "/" + name : name;
      if (currentSkillFiles().indexOf(file) !== -1) {
        showToast("“" + file + "” already exists", "error");
        return;
      }
      try {
        await personaFetch("/api/persona/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: rootParam,
            persona: personaState.persona,
            kind: "skill",
            name: personaState.name,
            file: file,
            content: "",
          }),
        });
        addSkillFileToListing(file);
        personaFileDraft = null;
        renderPersonaFilePicker();
        await openSkillFile(file);
      } catch (e) {
        showToast(e.message || "Could not create the file", "error");
      }
    }

    async function openSkillFile(file) {
      closePersonaFileMenu();
      if (!file || file === personaState.file) return;
      if (!(await confirmDiscardPersonaChanges("open another file"))) return;
      const params =
        "root=" + encodeURIComponent(personaRootInput.value.trim() || personaState.root) +
        "&persona=" + encodeURIComponent(personaState.persona) +
        "&kind=skill" +
        "&name=" + encodeURIComponent(personaState.name || "") +
        "&file=" + encodeURIComponent(file);
      try {
        const data = await personaFetch("/api/persona/file?" + params);
        if (data.binary) {
          showToast("“" + file + "” is a binary file and can’t be edited here", "error");
          // personaState.file never moved, but the menu already closed against
          // the clicked entry — re-render so the picker shows the file the
          // editor is actually holding.
          renderPersonaFilePicker();
          return;
        }
        personaState.file = file;
        setPersonaEditorContent(data.content);
        scrollPersonaEditorToTop();
      } catch (e) {
        showToast(e.message || "Could not open that file", "error");
        renderPersonaFilePicker();
      }
    }

    if (personaFileBtn) {
      personaFileBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const expanded = personaFileBtn.getAttribute("aria-expanded") === "true";
        if (expanded) {
          closePersonaFileMenu();
        } else {
          renderPersonaFilePicker();
          keepPersonaFileMenuOpen();
        }
      });
      if (personaFileBackdrop) {
        personaFileBackdrop.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          closePersonaFileMenu();
        });
      }
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (personaFileMenu.hidden) return;
          if (isInsidePersonaFileMenu(event)) return;
          closePersonaFileMenu();
        },
        true,
      );
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closePersonaFileMenu();
      });
    }

    function isPersonaMarkdownFile() {
      return /\\.md$/i.test(currentPersonaFileLabel());
    }

    function escapePersonaHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function splitPersonaFrontmatter(text) {
      const source = String(text || "");
      const match = source.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)/);
      if (!match) return { fields: [], body: source };
      const fields = match[1].split(/\\r?\\n/).flatMap((line) => {
        const idx = line.indexOf(":");
        if (idx === -1) return [];
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        return key ? [{ key, value }] : [];
      });
      return { fields, body: source.slice(match[0].length) };
    }

    let personaMarkdownToHtml = null;
    let personaMermaid = null;
    async function ensurePersonaMarkdownRenderer() {
      if (personaMarkdownToHtml) return personaMarkdownToHtml;
      const [{ marked }, purifyMod] = await Promise.all([
        import("https://esm.sh/marked@15.0.12"),
        import("https://esm.sh/dompurify@3.2.6"),
      ]);
      const DOMPurify = purifyMod.default || window.DOMPurify;
      personaMarkdownToHtml = (src) =>
        DOMPurify.sanitize(marked.parse(src, { gfm: true }));
      return personaMarkdownToHtml;
    }

    async function ensurePersonaMermaid() {
      if (personaMermaid) return personaMermaid;
      const mermaidMod = await import("https://esm.sh/mermaid@11.6.0");
      const mermaid = mermaidMod.default || mermaidMod;
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
      });
      personaMermaid = mermaid;
      return personaMermaid;
    }

    async function renderPersonaMermaidDiagrams() {
      if (!personaMdPreview) return;
      const blocks = personaMdPreview.querySelectorAll("pre code.language-mermaid");
      if (!blocks.length) return;
      let mermaid;
      try {
        mermaid = await ensurePersonaMermaid();
      } catch {
        return;
      }
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        const pre = block.closest("pre");
        const code = block.textContent || "";
        const host = document.createElement("div");
        host.className = "persona-md-mermaid";
        try {
          const rendered = await mermaid.render(
            "persona-mermaid-" + i + "-" + Date.now(),
            code,
          );
          host.innerHTML = rendered.svg;
        } catch {
          host.innerHTML =
            "<pre><code>" + escapePersonaHtml(code) + "</code></pre>";
        }
        if (pre) pre.replaceWith(host);
      }
    }

    async function renderPersonaMarkdownPreview() {
      if (!personaMdPreview) return;
      const source = personaEditor.value || "";
      personaMdPreview.classList.toggle("is-code", !isPersonaMarkdownFile());
      if (!isPersonaMarkdownFile()) {
        personaMdPreview.innerHTML =
          "<pre><code>" + escapePersonaHtml(source) + "</code></pre>";
        return;
      }
      const { fields, body } = splitPersonaFrontmatter(source);
      const frontmatterHtml = fields.length
        ? '<div class="persona-md-frontmatter"><dl>' +
          fields
            .map(
              (field) =>
                "<dt>" +
                escapePersonaHtml(field.key) +
                "</dt><dd>" +
                escapePersonaHtml(field.value) +
                "</dd>",
            )
            .join("") +
          "</dl></div>"
        : "";
      try {
        const toHtml = await ensurePersonaMarkdownRenderer();
        personaMdPreview.innerHTML = frontmatterHtml + toHtml(body);
        rewritePersonaPreviewImages();
        await renderPersonaMermaidDiagrams();
      } catch {
        personaMdPreview.innerHTML =
          frontmatterHtml +
          "<pre><code>" +
          escapePersonaHtml(body) +
          "</code></pre>";
      }
    }

    function rewritePersonaPreviewImages() {
      if (!personaMdPreview) return;
      const images = personaMdPreview.querySelectorAll("img");
      images.forEach((img) => {
        const src = img.getAttribute("src") || "";
        if (!src || /^(https?:|data:|blob:|\\/api\\/)/i.test(src)) return;
        const file = src.replace(/^\\.\\//, "").replace(/^\\/+/, "");
        if (!file) return;
        img.src =
          "/api/persona/asset?root=" +
          encodeURIComponent(personaRootInput.value.trim() || personaState.root) +
          "&persona=" +
          encodeURIComponent(personaState.persona) +
          "&name=" +
          encodeURIComponent(personaState.name || "") +
          "&file=" +
          encodeURIComponent(file);
      });
    }

    function setPersonaEditorView(view) {
      const previewable = canPersonaPreview();
      const next = previewable && view === "preview" ? "preview" : "source";
      personaState.editorView = next;
      if (personaEditBtn) {
        personaEditBtn.hidden = !previewable || next === "source";
        personaEditBtn.disabled = personaState.busy;
      }
      if (personaSaveBtn) {
        personaSaveBtn.hidden = previewable && next === "preview";
      }
      const editorShell = document.getElementById("persona-code-editor");
      if (editorShell) editorShell.classList.toggle("is-preview", next === "preview");
      if (next === "preview") renderPersonaMarkdownPreview();
      syncPersonaDeleteButton();
    }

    function setPersonaEditorContent(content, saved = true) {
      personaEditor.value = content || "";
      if (window.personaCodeEditor) {
        window.personaCodeEditor.setValue(personaEditor.value);
      }
      if (saved) personaState.savedContent = personaEditor.value;
      updatePersonaContentStats();
      renderPersonaFilePicker();
      setPersonaEditorView(canPersonaPreview() ? "preview" : "source");
      syncPersonaEditState();
    }

    async function confirmDiscardPersonaChanges(destination) {
      if (personaEditor.value === personaState.savedContent) return true;
      const editedLabel =
        personaState.kind === "skill" && personaState.file !== "SKILL.md"
          ? personaState.name + "/" + personaState.file
          : personaState.name || "agents.md";
      return confirmAction({
        title: "Discard unsaved changes?",
        description:
          "Your edits to “" +
          editedLabel +
          "” have not been saved" +
          (destination ? ". Continue to " + destination + "?" : "."),
        warning: "Unsaved editor content will be lost",
        confirmLabel: "Discard changes",
        danger: true,
      });
    }

    function focusPersonaEditor() {
      if (window.personaCodeEditor) {
        window.personaCodeEditor.focus();
        return;
      }
      personaEditor.focus();
    }

    function scrollPersonaEditorToTop() {
      personaEditor.scrollTop = 0;
      if (window.personaCodeEditor) {
        window.personaCodeEditor.scrollToTop();
      }
    }

    function selectPersonaKind(kind) {
      personaState.kind = kind;
      personaTemplateRow.hidden = true;
      personaTemplateSelect.value = "";
      updatePersonaContentStats();
      syncPersonaDeleteButton();
    }

    function syncPersonaEntryForm() {
      showPersonaNewName(false);
      syncPersonaDeleteButton();
    }

    function showPersonaNewName(show) {
      personaPicker.hidden = !show;
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
      if (!res.ok) {
        const error = new Error(data.error || "Request failed");
        error.status = res.status;
        error.errorCode = data.errorCode;
        error.saved = data.saved === true;
        error.file = data.file;
        throw error;
      }
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
      setPersonaHint("", false);
      renderLocalRemoteStatus();
      return listing;
    }

    async function loadPersonaFile() {
      personaTemplateSelect.value = "";
      if (!personaState.persona) {
        setPersonaEditorContent("");
        return;
      }
      if (personaState.kind !== "agent" && !personaState.name) {
        setPersonaEditorContent("");
        return;
      }
      const params =
        "root=" + encodeURIComponent(personaRootInput.value.trim() || personaState.root) +
        "&persona=" + encodeURIComponent(personaState.persona) +
        "&kind=" + encodeURIComponent(personaState.kind) +
        "&name=" + encodeURIComponent(personaState.name || "") +
        (personaState.kind === "skill"
          ? "&file=" + encodeURIComponent(personaState.file || "SKILL.md")
          : "");
      const file = await personaFetch("/api/persona/file?" + params);
      setPersonaEditorContent(file.content);
      scrollPersonaEditorToTop();
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
        setPersonaEditorContent(data.content, false);
        scrollPersonaEditorToTop();
        clearPersonaSaveError();
        focusPersonaEditor();
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
        syncPersonaEntryForm();
        await loadPersonaFile();
        renderPersonaRegistry();
        return true;
      } catch (e) {
        setPersonaHint(e.message || "Could not read that folder", true);
        personaState.listing = null;
        renderPersonaRegistry();
        setPersonaEditorContent("");
        return false;
      } finally {
        personaBusy(false);
      }
    }

    async function initPersona() {
      if (personaState.loaded || personaState.initializing) return;
      personaState.initializing = true;
      selectPersonaKind(personaState.kind);
      try {
        try {
          const data = await personaFetch("/api/persona/root");
          personaRootInput.value = data.root || "";
        } catch (e) {
          setPersonaHint(e.message || "Could not resolve the folder", true);
        }
        personaState.loaded = await refreshPersona();
      } finally {
        personaState.initializing = false;
      }
    }

    function applyPersonaListing(data, toastMsg) {
      personaState.root = data.root;
      personaState.persona = data.persona;
      personaState.name = "";
      personaState.file = "SKILL.md";
      personaRootInput.value = data.root;
      personaState.listing = data;
      renderPersonaBundles();
      syncPersonaEntryForm();
      clearPersonaDeployError();
      setPersonaHint("", false);
      renderLocalRemoteStatus();
      if (toastMsg) showToast(toastMsg, "success");
    }

    personaChangeBtn.addEventListener("click", async () => {
      if (!(await confirmDiscardPersonaChanges("another project folder"))) return;
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

    async function applyTypedPersonaRoot() {
      const next = personaRootInput.value.trim();
      if (!next || next === personaState.root) return;
      if (!(await confirmDiscardPersonaChanges("another project folder"))) {
        personaRootInput.value = personaState.root;
        return;
      }
      personaState.name = "";
      await refreshPersona(next);
    }

    personaRootInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      void applyTypedPersonaRoot();
    });
    personaRootInput.addEventListener("change", () => {
      void applyTypedPersonaRoot();
    });

    function showNewPersona(show) {
      personaBundleName.hidden = !show;
      personaBundleCancelBtn.hidden = !show;
      personaBundleCreateBtn.hidden = !show;
      personaBundleNewBtn.hidden = show;
      personaBundleSelect.hidden = show;
      personaBundleDeleteBtn.hidden = show;
      if (show) {
        personaBundleName.value = "";
        personaBundleName.focus();
      }
    }

    async function deletePersonaBundle(name) {
      const ok = await confirmAction({
        title: "Delete Persona?",
        description:
          "Persona “" + name +
          "” and all of its Instruction, Rules, and Skills will be permanently deleted",
        warning: "This action cannot be undone",
        confirmLabel: "Delete",
        danger: true,
      });
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
        await renderPersonaSyncState();
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
      if (!(await confirmDiscardPersonaChanges("the new Persona"))) return;
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
        selectPersonaKind("agent");
        applyPersonaListing(data, "Created Persona “" + data.persona + "”");
        renderPersonaRegistry();
        await loadPersonaFile();
        await renderPersonaSyncState();
      } catch (e) {
        showToast(e.message || "Could not create Persona", "error");
      } finally {
        personaBusy(false);
      }
    }

    // Queried on demand so setPersonaView can call this during boot routing,
    // before the persona element consts further down have initialized.
    function personaTemplateCards() {
      return Array.from(document.querySelectorAll("[data-template-card]"));
    }

    function resetPersonaTemplateForms() {
      personaTemplateCards().forEach((card) => {
        card.querySelector("[data-template-form]").hidden = true;
        card.querySelector(".persona-template-card-foot").hidden = false;
      });
    }

    function openPersonaTemplateForm(card) {
      resetPersonaTemplateForms();
      card.querySelector(".persona-template-card-foot").hidden = true;
      const form = card.querySelector("[data-template-form]");
      form.hidden = false;
      const input = form.querySelector(".persona-template-name");
      input.focus();
      input.select();
    }

    function personaTemplatesBusy(busy) {
      personaTemplateCards().forEach((card) => {
        card.querySelectorAll("button, input").forEach((control) => {
          control.disabled = busy;
        });
      });
    }

    async function createPersonaFromTemplate(template, name) {
      const persona = (name || "").trim();
      if (!persona) {
        showToast("Enter a Persona name.", "error");
        return;
      }
      if (!(await confirmDiscardPersonaChanges("the new Persona"))) return;
      personaTemplatesBusy(true);
      personaBusy(true);
      try {
        const data = await personaFetch("/api/persona/create-from-template", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
            persona,
            template,
          }),
        });
        selectPersonaKind("agent");
        applyPersonaListing(data, "Created Persona “" + data.persona + "”");
        renderPersonaRegistry();
        await loadPersonaFile();
        await renderPersonaSyncState();
        // Land in the editor so the new bundle can be reviewed right away.
        setPersonaView("local");
      } catch (e) {
        showToast(e.message || "Could not create Persona", "error");
      } finally {
        personaBusy(false);
        personaTemplatesBusy(false);
      }
    }

    personaTemplateCards().forEach((card) => {
      const template = card.getAttribute("data-template-card");
      const form = card.querySelector("[data-template-form]");
      const input = form.querySelector(".persona-template-name");
      card
        .querySelector("[data-template-open]")
        .addEventListener("click", () => openPersonaTemplateForm(card));
      card
        .querySelector("[data-template-cancel]")
        .addEventListener("click", () => resetPersonaTemplateForms());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") resetPersonaTemplateForms();
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        void createPersonaFromTemplate(template, input.value);
      });
    });

    personaBundleNewBtn.addEventListener("click", () => showNewPersona(true));
    personaBundleCancelBtn.addEventListener("click", () => showNewPersona(false));
    personaBundleCreateBtn.addEventListener("click", createPersonaBundle);
    personaLocalTab.addEventListener("click", () => setPersonaView("local"));
    personaTemplatesTab.addEventListener("click", () =>
      setPersonaView("templates")
    );
    personaRemoteTab.addEventListener("click", () => setPersonaView("remote"));
    personaRemoteRefreshBtn.addEventListener("click", () => {
      void loadRemotePersonas();
    });
    personaBundleDeleteBtn.addEventListener("click", () => {
      if (personaState.persona) deletePersonaBundle(personaState.persona);
    });
    personaBundleSelect.addEventListener("change", async () => {
      const persona = personaBundleSelect.value;
      if (!persona || persona === personaState.persona) return;
      if (!(await confirmDiscardPersonaChanges("another Persona"))) {
        personaBundleSelect.value = personaState.persona;
        return;
      }
      personaState.persona = persona;
      personaState.name = "";
      selectPersonaKind("agent");
      showPersonaNewName(false);
      await refreshPersona(personaRootInput.value.trim());
      await renderPersonaSyncState();
    });
    personaBundleName.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        showNewPersona(false);
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      createPersonaBundle();
    });

    personaNewName.addEventListener("input", () => {
      clearPersonaSaveError();
    });
    if (personaEditBtn) {
      personaEditBtn.addEventListener("click", () => {
        setPersonaEditorView("source");
        focusPersonaEditor();
      });
    }
    personaEditor.addEventListener("input", () => {
      updatePersonaContentStats();
      syncPersonaEditState();
      if (personaState.editorView === "preview") renderPersonaMarkdownPreview();
      if (isCreatingPersonaEntry()) clearPersonaSaveError();
    });
    window.addEventListener("beforeunload", (event) => {
      if (personaEditor.value === personaState.savedContent) return;
      event.preventDefault();
      event.returnValue = "";
    });
    personaTemplateSelect.addEventListener("change", () => {
      applyPersonaTemplate();
    });

    async function savePersona() {
      clearPersonaSaveError();
      const creating = isCreatingPersonaEntry();
      const kindLabel = personaState.kind === "skill" ? "skill" : "rule";
      const content = personaEditor.value;
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
          focusPersonaEditor();
          return;
        }
        personaState.name = name;
      } else if (personaState.kind !== "agent" && !name) {
        showPersonaSaveError("Name the " + kindLabel + " first.");
        return;
      } else if (!personaEditor.value.trim()) {
        showPersonaSaveError("Content cannot be empty.");
        focusPersonaEditor();
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
            file:
              personaState.kind === "skill" && !creating
                ? personaState.file
                : undefined,
            content,
          }),
        });
        if (creating) showPersonaNewName(false);
        const savedLabel =
          personaState.kind === "agent"
            ? "Instruction"
            : personaState.kind === "skill" &&
                !creating &&
                personaState.file !== "SKILL.md"
              ? name + "/" + personaState.file
              : name || (personaState.kind === "skill" ? "skill" : "rule");
        showToast(
          (creating ? "Created " : "Saved ") + savedLabel + " successfully",
          "success"
        );
        await loadPersonaListing(
          personaRootInput.value.trim(),
          personaState.persona
        );
        syncPersonaEntryForm();
        renderPersonaRegistry();
        setPersonaEditorContent(
          data.saved && typeof data.saved.content === "string"
            ? data.saved.content
            : content
        );
        if (hasSavedTokens(lastStatus)) await loadRemotePersonas();
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
      if (!personaDeployReady(listing)) {
        showPersonaDeployError(
          "Add an Instruction, Rule, or Skill before applying this Persona."
        );
        return;
      }
      clearPersonaDeployError();
      const content = personaEditor.value;
      if (!content.trim()) {
        showPersonaDeployError(
          "Content cannot be empty. Save or select another file before applying."
        );
        focusPersonaEditor();
        return;
      }

      const confirm = await confirmPersonaDeploy(
        personaState.persona,
        root
      );
      if (!confirm) return;

      const selectedTargets = confirm.targetEntries || [];
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
            file:
              personaState.kind === "skill" ? personaState.file : undefined,
            content,
            targets: deployTargets.map((entry) => entry.target),
            global: global,
          }),
        });
        showPersonaLog((data.deploy && data.deploy.output) || "Applied.");
        await loadPersonaListing(root, personaState.persona);
        syncPersonaEntryForm();
        renderPersonaRegistry();
        setPersonaEditorContent(
          data.file && typeof data.file.content === "string"
            ? data.file.content
            : content
        );
        if (hasSavedTokens(lastStatus)) await loadRemotePersonas();
        showToast(
          (global ? "Applied globally “" : "Applied Persona “") +
            personaState.persona +
            "”",
          "success"
        );
      } catch (e) {
        if (e.saved) {
          setPersonaEditorContent(
            e.file && typeof e.file.content === "string"
              ? e.file.content
              : content
          );
          if (hasSavedTokens(lastStatus)) await loadRemotePersonas();
        }
        showPersonaLog(e.message || "Apply failed");
        showToast(e.message || "Apply failed", "error");
      } finally {
        personaBusy(false);
      }
    }

    async function pushPersona(personaInput) {
      const persona = personaInput || personaState.persona;
      if (!persona) {
        showToast("Select a Persona first", "error");
        return;
      }
      // Organization owns every upload entry point. If this card represents
      // the Persona currently open in Personal, include its editor contents
      // even when Save was not clicked yet.
      const isOpen = persona === personaState.persona;
      const isFirstPublish =
        personaSyncStatus(persona).state === "local-only";
      const hasUnsavedChanges =
        isOpen && personaEditor.value !== personaState.savedContent;
      const content = isOpen ? personaEditor.value : "";
      if (hasUnsavedChanges && !content.trim()) {
        showToast(
          "Unsaved content is empty. Save valid content before updating.",
          "error"
        );
        focusPersonaEditor();
        return;
      }
      // The agent prompt requires a confirmation before either sync action;
      // the dashboard is a third entry point and needs the same gate.
      const ok = window.confirm(
        (isFirstPublish ? "Publish “" : "Update “") +
          persona +
          (isFirstPublish
            ? "” to your organization?"
            : "” in your organization?") +
          "\\n\\nThis device\\u2019s version will become the latest organization version." +
          (hasUnsavedChanges
            ? "\\n\\nYour open editor changes will be saved and included."
            : "")
      );
      if (!ok) return;

      // Only the Persona open in the editor has unsaved contents to flush;
      // uploading any other one must push what is already on disk.
      // Filled on a 409 and shown after the finally block, so the busy state
      // and the list are already settled by the time the dialog opens.
      let conflictPrompt = null;
      personaBusy(true);
      try {
        // Send the editor contents so the route can flush them to disk
        // before hashing, the same way Apply does.
        const data = await personaFetch("/api/persona/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
            persona,
            kind: isOpen ? personaState.kind : "agent",
            name: isOpen ? personaState.name : "",
            file:
              isOpen && personaState.kind === "skill"
                ? personaState.file
                : undefined,
            content,
          }),
        });
        const push = data.push;
        if (!push) throw new Error("Push returned no result");
        // The route skips the disk write when the editor is empty, so the
        // unsaved marker may only clear when it says the write happened.
        if (data.saved) {
          setPersonaEditorContent(
            data.file && typeof data.file.content === "string"
              ? data.file.content
              : content
          );
        }
        let message =
          (isFirstPublish ? "Published “" : "Updated “") +
          persona +
          "” · version " +
          push.revision +
          " · " +
          push.uploaded +
          " uploaded, " +
          push.skipped +
          " unchanged";
        // Say so rather than let the editor and the shared copy disagree in
        // silence: an empty editor is never written, so what went up is
        // whatever the file already held.
        if (isOpen && !data.saved && content.trim() === "") {
          message += " · editor was empty, so the file on disk was pushed as is";
        }
        showToast(message, "success");
      } catch (e) {
        if (e.saved) {
          setPersonaEditorContent(
            e.file && typeof e.file.content === "string"
              ? e.file.content
              : content
          );
        }
        // A revision mismatch means someone shared a newer version while this
        // device worked from an older one. Overwriting the server copy is
        // never offered — the only way forward is to get the latest, with
        // local edits backed up first, so neither side loses work silently.
        if (
          e.errorCode === "PERSONA_REVISION_MISMATCH" ||
          e.errorCode === "PERSONA_MANIFEST_CONFLICT"
        ) {
          const remote = personaState.remotePersonas.find(
            (entry) => entry.persona_id === persona
          );
          const entry = personaState.syncedRevisions[persona];
          const who =
            remote && (remote.updated_by_name || remote.updated_by_email);
          conflictPrompt =
            "Can\\u2019t update “" +
            persona +
            "”.\\n\\n" +
            (remote
              ? (who ? who : "A teammate") +
                " published v" +
                remote.revision +
                ".\\n"
              : "A teammate published a newer version.\\n") +
            (entry && typeof entry.revision === "number"
              ? "You worked from v" + entry.revision + ".\\n"
              : "") +
            "\\nGet the latest now? Your local changes will be backed up first.";
        } else {
          showToast(e.message || "Update failed", "error");
        }
      } finally {
        try {
          await loadRemotePersonas();
        } finally {
          personaBusy(false);
        }
      }
      if (conflictPrompt && window.confirm(conflictPrompt)) {
        await pullPersona(persona, { skipConfirm: true });
      }
    }

    async function pullPersona(personaInput, options) {
      const persona = personaInput || personaState.persona;
      if (!persona) {
        showToast("Select a Persona first", "error");
        return;
      }
      const samePersona = persona === personaState.persona;
      const hasUnsavedChanges =
        samePersona && personaEditor.value !== personaState.savedContent;
      const draftName =
        samePersona && personaState.kind !== "agent"
          ? personaState.name ||
            (isCreatingPersonaEntry() ? personaNewName.value.trim() : "")
          : "";
      if (
        hasUnsavedChanges &&
        personaState.kind !== "agent" &&
        !draftName
      ) {
        showPersonaSaveError(
          "Name the draft before getting the organization version."
        );
        personaNewName.focus();
        return;
      }
      // Pull overwrites files, so it gets the same gate as Share — unless the
      // caller already asked (the share-conflict dialog is itself a confirm).
      const skipConfirm = options && options.skipConfirm;
      const rollback = options && options.rollback;
      const ok =
        skipConfirm ||
        window.confirm(
          rollback
            ? "Discard local edits on “" +
              persona +
              "” and restore the remote version?\\n\\nLocal changes are backed up first."
            : "Get your organization's latest “" + persona + "” onto this device?\\n\\nLocal files whose contents differ will be overwritten — they are backed up first, including anything unsaved in the editor. Local files the organization copy does not have are kept."
        );
      if (!ok) return;

      // applyPersonaListing() clears the selected name because its other
      // callers switch Persona, where keeping it would be wrong. Pull only
      // refreshes the Persona already open, so the file the user was editing
      // has to be restored — otherwise the picker falls back to the first
      // entry and the editor silently jumps to a different file.
      const openKind = samePersona ? personaState.kind : "agent";
      const openName = samePersona
        ? personaState.kind === "agent"
          ? ""
          : draftName
        : "";
      // applyPersonaListing() resets the open file too, so a companion has to
      // be carried across the same way the name is. Without this the editor
      // reloads SKILL.md and the user reads it as their edit having vanished.
      const openFile = samePersona ? personaState.file : "SKILL.md";
      // The open file travels with the contents. Without it the route falls
      // back to SKILL.md, so preserving an edited companion would overwrite
      // the Skill's own SKILL.md and lose both files at once.
      const preserve =
        samePersona && personaEditor.value !== personaState.savedContent
          ? {
              kind: personaState.kind,
              name: draftName,
              file:
                personaState.kind === "skill" ? personaState.file : undefined,
              content: personaEditor.value,
            }
          : null;
      personaBusy(true);
      try {
        const data = await personaFetch("/api/persona/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: personaRootInput.value.trim() || personaState.root,
            persona,
            preserve,
          }),
        });
        const pull = data.pull;
        if (!pull) throw new Error("Pull returned no result");
        if (samePersona) {
          applyPersonaListing(data);
          selectPersonaKind(openKind);
          if (openKind === "agent") {
            personaState.name = "";
          } else {
            const entries = personaEntries(openKind);
            personaState.name = entries.some((entry) => entry.name === openName)
              ? openName
              : entries.length > 0
                ? entries[0].name
                : "";
          }
          // After the name, because the file list is looked up by it. The pull
          // may have removed the file, in which case SKILL.md is the only
          // honest place to land.
          if (openKind === "skill" && personaState.name === openName) {
            personaState.file =
              currentSkillFiles().indexOf(openFile) !== -1
                ? openFile
                : "SKILL.md";
          }
          syncPersonaEntryForm();
          await loadPersonaFile();
          renderPersonaRegistry();
        } else {
          // Getting another card must not switch the Personal editor or
          // discard its draft. Refresh only the bundle selector/listing.
          await loadPersonaListing(
            personaRootInput.value.trim() || personaState.root,
            personaState.persona
          );
          renderPersonaRegistry();
        }
        const downloaded = (pull.downloaded || []).length;
        let message =
          "Got “" +
          pull.persona +
          "” · version " +
          pull.revision +
          " · " +
          (downloaded === 0
            ? "already up to date"
            : downloaded + (downloaded === 1 ? " file" : " files") + " updated");
        // Pull never deletes; files outside the manifest are reported only.
        const localOnly = (pull.local_only || []).length;
        if (localOnly > 0) {
          message +=
            " · " +
            localOnly +
            (localOnly === 1 ? " local file" : " local files") +
            " kept (not published yet)";
        }
        if (pull.backup_dir) {
          message += " · previous local files backed up to " + pull.backup_dir;
        }
        showToast(message, "success");
      } catch (e) {
        if (e.saved && samePersona) {
          setPersonaEditorContent(
            e.file && typeof e.file.content === "string"
              ? e.file.content
              : personaEditor.value
          );
        }
        showToast(e.message || "Get from remote failed", "error");
      } finally {
        try {
          await loadRemotePersonas();
        } finally {
          personaBusy(false);
        }
      }
    }

    personaSaveBtn.addEventListener("click", () => savePersona());
    if (personaCancelBtn) {
      personaCancelBtn.addEventListener("click", async () => {
        if (personaCancelBtn.hidden) return;
        if (!(await confirmDiscardPersonaChanges("leave edit mode"))) return;
        setPersonaEditorContent(personaState.savedContent, true);
      });
    }
    personaDeleteBtn.addEventListener("click", () => {
      if (personaDeleteBtn.hidden) return;
      deletePersonaEntry(personaState.kind, personaState.name);
    });
    personaDeployBtn.addEventListener("click", () => deployAllPersona());
    personaTargetInputs.forEach((input) => {
      input.addEventListener("change", () => {
        clearPersonaDeployError();
        syncDeployConfirmGlobalUi();
      });
    });
    if (personaLogClose) {
      personaLogClose.addEventListener("click", () => { hidePersonaLog(); });
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }

    function renderSessionCard(s) {
      const state = authViewState();
      if (state === "loading") {
        profileEmptyEl.innerHTML = panelLoadingHtml();
        profileEmptyEl.hidden = false;
        profileCardEl.hidden = true;
        updateSessionHeader(s);
        return;
      }
      if (state === "signed-out") {
        profileEmptyEl.innerHTML = profileSignInCardHtml();
        profileEmptyEl.hidden = false;
        profileCardEl.hidden = true;
        updateSessionHeader(s);
        return;
      }
      const signedIn = hasSavedTokens(s);
      profileEmptyEl.hidden = true;
      profileCardEl.hidden = false;

      if (signedIn) {
        const am = s.activeMember || {};
        const activeTok =
          (s.tokens || []).find((t) => t.active) || (s.tokens || [])[0] || {};
        const email = am.email || "Signed in";
        profileEmailEl.textContent = email;
        profileAvatarEl.textContent = email.charAt(0);
        profileWorkspaceEl.textContent = am.name || "";

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
        const wasSignedIn = hasSavedTokens(lastStatus);
        const res = await fetch("/api/status");
        if (!res.ok) throw new Error("Could not refresh status");
        lastStatus = await res.json();
        sessionReady = true;
        const signedIn = hasSavedTokens(lastStatus);
        renderSessionCard(lastStatus);
        renderGuardStatus(lastStatus);
        renderRbacAuthGate();
        if (
          signedIn &&
          !wasSignedIn &&
          document.getElementById("panel-rbac").classList.contains("active")
        ) {
          void loadRbac();
        }
        // Login and logout both land here, so Push/Pull follow the session
        // without either flow having to remember to update them.
        void renderPersonaSyncState();
      } catch (e) {
        sessionReady = true;
        renderSessionCard(lastStatus);
        renderRbacAuthGate();
        void renderPersonaSyncState();
        showToast(e.message || "Could not refresh status", "error");
      }
    }

    document.querySelectorAll("[data-console-open]").forEach((btn) => {
      btn.addEventListener("click", () => { openConsole(); });
    });
    function renderRbacAuthGate() {
      const rbacSignInEl = document.getElementById("rbac-signin");
      const rbacSignedInEl = document.getElementById("rbac-signed-in");
      if (!rbacSignInEl || !rbacSignedInEl) return;
      rbacSignInEl.innerHTML = permissionSignInCardHtml();
      rbacSignInEl.hidden = false;
      rbacSignedInEl.hidden = true;
    }

    headerLoginBtn.addEventListener("click", () => { openLogin(); });
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-open-login]")) {
        openLogin();
      }
    });
    headerLogoutBtn.addEventListener("click", () => { openLogout(); });

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
      const offCopy =
        "Off — the AI runs every action without checking your permissions, and nothing is recorded in Transcodes Log History";
      if (!signedIn) {
        guardToggleDescEl.textContent = enabled
          ? "On — sign in so Transcodes can check each AI action against your permissions before it runs"
          : offCopy;
        return;
      }
      guardToggleDescEl.textContent = enabled
        ? "On — before the AI acts, Transcodes checks the action against the permissions you set, then blocks it, allows it, or asks you to verify with a passkey or biometrics"
        : offCopy;
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
      renderRbacAuthGate();
      if (authViewState() !== "signed-in") return;
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

    const initialRoute = routeFromUrl();
    openTab(initialRoute.tab, {
      replaceUrl: true,
      personaView: initialRoute.personaView,
    });
    renderRbacAuthGate();
    renderSessionCard(lastStatus);
    refresh();
    void refreshCliVersionHint();

    async function refreshCliVersionHint() {
      try {
        const res = await fetch("/api/cli-version");
        if (!res.ok) return;
        const data = await res.json();
        const cmd = document.getElementById("cli-version-cmd");
        if (!cmd || !data.updateAvailable) return;
        cmd.textContent = "Require Update";
        if (data.latest) {
          cmd.title = "A newer CLI is on npm (" + data.latest + ")";
        }
      } catch {
        // Keep "transcodes version" — npm was unreachable.
      }
    }
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

    if (method === 'POST' && url === '/api/persona/create-from-template') {
      const body = await readJsonBody(req);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Persona name is required.');
      }
      if (typeof body.template !== 'string' || !body.template.trim()) {
        throw new Error('Template is required.');
      }
      const template = findPersonaTemplate(body.template);
      if (!template) {
        throw new Error(`Unknown template "${body.template}".`);
      }
      const root =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      const persona = await createPersona(body.persona);
      // A half-written bundle is worse than none: drop it and report the cause.
      try {
        await savePersonaFile({
          root,
          persona,
          kind: 'agent',
          content: template.instruction,
        });
        for (const entry of template.rules) {
          await savePersonaFile({
            root,
            persona,
            kind: 'rule',
            name: entry.name,
            content: entry.content,
          });
        }
        for (const entry of template.skills) {
          await savePersonaFile({
            root,
            persona,
            kind: 'skill',
            name: entry.name,
            content: entry.content,
          });
        }
      } catch (error) {
        await deletePersona(persona).catch(() => {});
        throw error;
      }
      sendJson(res, 200, {
        ok: true,
        template: template.id,
        ...(await listPersona(root, persona)),
      });
      return;
    }

    if (method === 'POST' && url === '/api/persona/delete-persona') {
      const body = await readJsonBody(req);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Persona name is required.');
      }
      const deletedPersona = await deletePersona(body.persona);
      await clearPersonaSyncRevision(deletedPersona);
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

    if (method === 'GET' && url === '/api/persona/asset') {
      const persona = query.get('persona');
      if (!persona?.trim()) {
        throw new Error('Select a Persona first.');
      }
      const asset = await readPersonaAsset({
        root: query.get('root') ?? undefined,
        persona,
        name: query.get('name') ?? '',
        file: query.get('file') ?? '',
      });
      res.writeHead(200, {
        'Content-Type': asset.contentType,
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      res.end(asset.bytes);
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
          file: query.get('file') ?? undefined,
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
      if (!content.trim()) {
        throw new Error(
          'Content cannot be empty. Save or select another file before applying.',
        );
      }
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
      if (kind !== 'agent' && !name.trim()) {
        throw new Error('Select a Rule or Skill before applying.');
      }
      const savedFile = await savePersonaFile({
        root,
        persona,
        kind,
        name,
        file: typeof body.file === 'string' ? body.file : undefined,
        content,
      });
      const deployed = await deployPersona({
        root: deployRoot,
        persona,
        targets,
        global,
      });
      sendJson(res, deployed.ok ? 200 : 400, {
        ok: deployed.ok,
        saved: true,
        file: savedFile,
        deploy: deployed,
        ...(deployed.ok
          ? {}
          : { error: deployed.output || 'transcodes sync generate failed' }),
      });
      return;
    }

    if (method === 'GET' && url === '/api/persona/remote') {
      // Metadata only — no manifest fetch, so opening the tab never spends a
      // presigned-URL round trip. Differences surface in the push/pull result.
      // `synced` is what this machine last pushed or pulled; `local_hashes`
      // is the bundle hash right now. Together they classify each Persona
      // (behind / edited here / conflict / current) without a network call.
      const localHashes: Record<string, string> = {};
      const localHashErrors: Record<string, string> = {};
      await Promise.all(
        (await listPersonaIds()).map(async (persona) => {
          try {
            const hash = await computePersonaContentHash(persona);
            if (hash) localHashes[persona] = hash;
          } catch (error) {
            localHashErrors[persona] =
              error instanceof Error ? error.message : String(error);
          }
        }),
      );
      sendJson(res, 200, {
        personas: await fetchPersonaList(loadPersonaConfig()),
        synced: await readPersonaSyncRevisions(),
        local_hashes: localHashes,
        local_hash_errors: localHashErrors,
      });
      return;
    }

    if (method === 'POST' && url === '/api/persona/push') {
      const body = await readJsonBody(req);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Select a Persona first.');
      }
      const persona = body.persona;
      const kind = parsePersonaKind(body.kind);
      const name = typeof body.name === 'string' ? body.name : '';
      const content = typeof body.content === 'string' ? body.content : '';
      // Same reason as deploy: pushPersonaSync hashes the files on disk, so
      // editor contents that were never saved would not be uploaded.
      // Empty content is never flushed: push fails far more often than deploy
      // (a 409 is routine), and truncating the file on the way to a failure
      // would contradict the "local files were not modified" guidance.
      // Stays a boolean: the error path below compares it with `=== true`, so
      // a truthy string would be dropped and a completed write reported as if
      // it never happened.
      const saved =
        content.trim() !== '' && (kind === 'agent' || name.trim() !== '');
      let savedFile: Awaited<ReturnType<typeof savePersonaFile>> | undefined;
      if (saved) {
        savedFile = await savePersonaFile({
          root:
            typeof body.root === 'string' && body.root.trim()
              ? body.root
              : undefined,
          persona,
          kind,
          name,
          file: typeof body.file === 'string' ? body.file : undefined,
          content,
        });
      }
      // `saved` travels back so the browser does not have to reproduce the
      // condition above: only the route knows whether the editor contents
      // reached the disk, and clearing the unsaved-changes marker when they
      // did not would claim a write that never happened.
      try {
        sendJson(res, 200, {
          ok: true,
          saved,
          file: savedFile,
          push: await pushPersonaSync(persona),
        });
      } catch (error) {
        if (error && typeof error === 'object') {
          Object.assign(error, { saved, file: savedFile });
        }
        throw error;
      }
      return;
    }

    if (method === 'POST' && url === '/api/persona/pull') {
      const body = await readJsonBody(req);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Select a Persona first.');
      }
      let preserved = false;
      let preservedFile:
        | Awaited<ReturnType<typeof savePersonaFile>>
        | undefined;
      if (
        body.preserve &&
        typeof body.preserve === 'object' &&
        !Array.isArray(body.preserve)
      ) {
        const preserve = body.preserve as Record<string, unknown>;
        if (typeof preserve.content !== 'string') {
          throw new Error('Unsaved Persona content was invalid.');
        }
        preservedFile = await savePersonaFile({
          root:
            typeof body.root === 'string' && body.root.trim()
              ? body.root
              : undefined,
          persona: body.persona,
          kind: parsePersonaKind(preserve.kind),
          name: typeof preserve.name === 'string' ? preserve.name : '',
          // Skills are folder bundles, so the editor may hold a companion
          // rather than SKILL.md — which is where an absent `file` would put
          // these bytes, destroying the Skill's own instructions.
          file: typeof preserve.file === 'string' ? preserve.file : undefined,
          content: preserve.content,
        });
        preserved = true;
      }
      let pull: Awaited<ReturnType<typeof pullPersonaSync>>;
      try {
        pull = await pullPersonaSync(body.persona);
      } catch (error) {
        if (error && typeof error === 'object') {
          Object.assign(error, {
            saved: preserved,
            file: preservedFile,
          });
        }
        throw error;
      }
      const root =
        typeof body.root === 'string' && body.root.trim()
          ? body.root
          : undefined;
      // Re-read the listing so the editor shows the pulled bytes.
      sendJson(res, 200, {
        ok: true,
        preserved,
        pull,
        ...(await listPersona(root, pull.persona)),
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
      const content = typeof body.content === 'string' ? body.content : '';
      if (Buffer.byteLength(content, 'utf8') > MAX_PERSONA_FILE_BYTES) {
        throw new HttpError(413, 'Files larger than 5 MB cannot be added.');
      }
      const saved = await savePersonaFile({
        root,
        persona,
        kind,
        name: typeof body.name === 'string' ? body.name : '',
        file: typeof body.file === 'string' ? body.file : undefined,
        content,
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

    if (method === 'POST' && url === '/api/persona/create-folder') {
      const body = await readJsonBody(req);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Select a Persona first.');
      }
      if (typeof body.dir !== 'string' || !body.dir.trim()) {
        throw new Error('Folder name is required.');
      }
      const created = await createSkillFolder({
        root:
          typeof body.root === 'string' && body.root.trim()
            ? body.root
            : undefined,
        persona: body.persona,
        name: typeof body.name === 'string' ? body.name : '',
        dir: body.dir,
      });
      sendJson(res, 200, { ok: true, created });
      return;
    }

    if (method === 'POST' && url === '/api/persona/delete-skill-path') {
      const body = await readJsonBody(req);
      if (typeof body.persona !== 'string' || !body.persona.trim()) {
        throw new Error('Select a Persona first.');
      }
      if (typeof body.path !== 'string' || !body.path.trim()) {
        throw new Error('File or folder path is required.');
      }
      const removed = await deleteSkillPath({
        root:
          typeof body.root === 'string' && body.root.trim()
            ? body.root
            : undefined,
        persona: body.persona,
        name: typeof body.name === 'string' ? body.name : '',
        path: body.path,
      });
      sendJson(res, 200, { ok: true, removed });
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
    const saved =
      err && typeof err === 'object' && 'saved' in err
        ? (err as { saved?: unknown }).saved === true
        : false;
    const status =
      err instanceof PersonaApiError ? err.status : statusForError(err, 400);
    sendJson(res, status, {
      error: err instanceof Error ? err.message : String(err),
      ...(err instanceof PersonaApiError && err.errorCode
        ? { errorCode: err.errorCode }
        : {}),
      ...(saved ? { saved: true } : {}),
      ...(err && typeof err === 'object' && 'file' in err
        ? { file: (err as { file?: unknown }).file }
        : {}),
    });
  }
}

const DASHBOARD_PAGE_PATHS = new Set([
  '/',
  '/index.html',
  '/guide',
  '/guideline',
  '/persona',
  '/persona/my',
  '/persona/personal',
  '/persona/local',
  '/persona/team',
  '/persona/organization',
  '/persona/remote',
  '/permission',
  '/rbac',
  '/profile',
  '/tokens',
]);

function isDashboardPagePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return DASHBOARD_PAGE_PATHS.has(normalized);
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

      // CSRF guard: see isAllowedRequestOrigin. GET is untouched — port
      // discovery hits GET /health and the offline page polls it every 3s.
      if (
        !isAllowedRequestOrigin({
          method,
          secFetchSite: req.headers['sec-fetch-site'] as string | undefined,
          origin: req.headers.origin,
        })
      ) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden origin');
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

        if (method === 'GET' && isDashboardPagePath(url)) {
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

        if (method === 'GET' && url === '/api/cli-version') {
          sendJson(res, 200, await getCliVersionStatus());
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
        sendJson(res, statusForError(err, 500), {
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
