/**
 * Project MCP tool — ported from transcodes-mcp-server's `src/tools/project.ts`.
 *
 * Only `get_project` is carried over (read-only). Console-only configuration
 * tools (`project_pwa_auth_console`) are intentionally not exposed in this
 * plugin. The project is fixed by the TRANSCODES_TOKEN pid claim, never a
 * tool argument, so tenancy cannot be bypassed.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadStepupConfig } from '@transcodes-guard/stepup-core';
import { blockedResult, req } from './transcodes-client.js';

const DEFAULT_CDN_BASE_URL = 'https://cdn.transcodes.link';
const ASSET_CHECK_TIMEOUT_MS = 5_000;

const textResult = (text: string, isError = false) => ({
  isError,
  content: [{ type: 'text' as const, text }],
});

type AssetStatus = 'available' | 'missing' | 'unreachable';
type PwaAssetsState =
  | 'configured'
  | 'not_configured_or_missing'
  | 'partial'
  | 'unreachable';

type FetchLike = typeof fetch;

const PROJECT_ASSETS = [
  ['auth_sdk', 'authentication', 'webworker.js'],
  ['pwa_manifest', 'installable_pwa', 'manifest.json'],
  ['pwa_service_worker', 'installable_pwa', 'sw.js'],
] as const;

const MSG_PROJECT_PWA_AUTH_CONSOLE =
  'PWA and authentication configuration (manifest, service worker, widget, branding, WebAuthn, related origins, token expiry, etc.) must be performed in the Transcodes console. ' +
  'Changes to these settings require the project SDK to be rebuilt and redeployed — a process that the console handles automatically. ' +
  'Modifying them directly via API without going through the console build pipeline will leave the deployed SDK out of sync with your configuration. ' +
  'This MCP tool does not call the API.';

// CDN 기준 URL을 env/입력값에서 한 번만 정규화한다.
function resolveCdnBaseUrl() {
  const value =
    process.env.TRANSCODES_CDN_BASE_URL?.trim() || DEFAULT_CDN_BASE_URL;
  try {
    return new URL(value).href.replace(/\/$/, '');
  } catch {
    throw new Error(`CDN base URL is not valid: ${value}`);
  }
}

// 각 HTTP 시도마다 독립 timeout을 부여해 fallback GET이 즉시 abort되지 않게 한다.
async function fetchWithTimeout(
  fetcher: FetchLike,
  url: string,
  method: 'HEAD' | 'GET',
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_CHECK_TIMEOUT_MS);
  try {
    return await fetcher(url, { method, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 단일 CDN asset을 확인하고 404는 "없음", 그 외 실패는 "불명확"으로 접는다.
async function probeAsset(url: string, fetcher: FetchLike) {
  try {
    let response = await fetchWithTimeout(fetcher, url, 'HEAD');
    if (response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(fetcher, url, 'GET');
    }
    const status: AssetStatus = response.ok
      ? 'available'
      : response.status === 404
        ? 'missing'
        : 'unreachable';
    return { status, http_status: response.status, ok: response.ok };
  } catch (err) {
    return {
      status: 'unreachable' as const,
      http_status: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// 프로젝트 CDN asset 결과를 auth SDK와 PWA 자산 상태로 나눠 보고한다.
export async function checkProjectAssets(
  projectId: string,
  fetcher: FetchLike = fetch,
) {
  const baseUrl = resolveCdnBaseUrl();
  const assets = await Promise.all(
    PROJECT_ASSETS.map(async ([kind, requiredFor, file]) => {
      const url = `${baseUrl}/${encodeURIComponent(projectId)}/${file}`;
      return {
        kind,
        required_for: requiredFor,
        file,
        url,
        ...(await probeAsset(url, fetcher)),
      };
    }),
  );
  const auth = assets.find((asset) => asset.kind === 'auth_sdk');
  const pwaAssets = assets.filter(
    (asset) => asset.required_for === 'installable_pwa',
  );
  const pwaState: PwaAssetsState = pwaAssets.some(
    (asset) => asset.status === 'unreachable',
  )
    ? 'unreachable'
    : pwaAssets.every((asset) => asset.status === 'available')
      ? 'configured'
      : pwaAssets.every((asset) => asset.status === 'missing')
        ? 'not_configured_or_missing'
        : 'partial';
  const authOk = auth?.status === 'available';
  return {
    ok: authOk,
    project_id: projectId,
    cdn_base_url: baseUrl,
    summary: {
      auth_sdk: auth?.status ?? 'unreachable',
      auth_sdk_ok: authOk,
      pwa_assets: pwaState,
    },
    assets,
    diagnostics: [
      authOk
        ? 'Authentication SDK webworker.js is available. Missing PWA assets do not block authentication-only setup.'
        : 'Authentication SDK webworker.js is not available. Check project ID, CDN base URL, and Console SDK build state.',
      pwaState === 'configured'
        ? 'PWA/Web App Kit assets are available.'
        : pwaState === 'unreachable'
          ? 'PWA/Web App Kit asset state is unclear because one or more assets could not be checked.'
          : 'PWA/Web App Kit assets are missing or partial. Treat this separately from auth SDK availability.',
    ],
  };
}

export function registerProjectTools(server: McpServer): void {
  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        'Fetch the active project (fixed by TRANSCODES_TOKEN pid claim). ' +
        'Returns all information about the project — including toolkit, pwa, domain_url, title, description, and created/updated timestamps. ' +
        'No arguments — project is determined by the token.',
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        { method: 'GET' },
        'get_project',
        `/${config.projectId}`,
      );
      return textResult(text);
    },
  );

  server.registerTool(
    'check_project_assets',
    {
      title: 'Check project CDN assets',
      description:
        'Read-only CDN asset diagnostic for the active project. ' +
        'Separates Authentication-only SDK availability (`webworker.js`) from installable PWA/Web App Kit assets (`manifest.json`, `sw.js`) so PWA 404s are not mistaken for auth failures. ' +
        'Use when webworker/manifest/sw.js status, CDN setup, auth-only install, or PWA installability is unclear.',
      inputSchema: {},
    },
    async () => {
      try {
        const config = loadStepupConfig();
        const report = await checkProjectAssets(config.projectId);
        return textResult(JSON.stringify(report, null, 2), !report.ok);
      } catch (err) {
        return textResult(
          JSON.stringify(
            {
              ok: false,
              message: `Could not check project assets: ${err instanceof Error ? err.message : String(err)}`,
            },
            null,
            2,
          ),
          true,
        );
      }
    },
  );

  server.registerTool(
    'project_pwa_auth_console',
    {
      title: 'PWA / auth config (console-only)',
      description:
        'Blocked: PWA and authentication configuration (manifest, service worker, branding, WebAuthn, related origins, token expiry, etc.) must be done in the Transcodes console. ' +
        'These settings trigger an SDK rebuild and redeployment — a pipeline the console manages automatically. ' +
        'Applying changes directly via API skips that pipeline and leaves the live SDK out of sync with the new configuration.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_PROJECT_PWA_AUTH_CONSOLE),
  );
}
