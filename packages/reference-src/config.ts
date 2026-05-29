/**
 * Configuration loader.
 * Reads values from environment variables set in the MCP client config
 * (Cursor / Claude Desktop mcp.json → `env` block).
 *
 * End users only need to set `TRANSCODES_TOKEN`. `TRANSCODES_BACKEND_URL` is an
 * SDK internal that falls back to `DEFAULT_BACKEND_URL` in `src/constants.ts`;
 * set it only when overriding (e.g. pointing at localhost in dev). The tool
 * name → API path map is a library-internal contract and is not configurable
 * at runtime.
 *
 * CI WARNING — 빌드 시점에 이 파일의 `process.env.TRANSCODES_BACKEND_URL`
 * 참조를 리터럴 값으로 치환하지 말 것. 치환하면 runtime env override 가 무력화됨.
 * 회귀 방지 가드: `scripts/verify-dist.js` (positive check — the identifier
 * must survive in compiled dist).
 * 배경: THT-260.
 */
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_ENDPOINT_MAP,
} from './constants.ts';
import { parseMemberAccessToken } from './token.ts';

/** Verified step-up state (kept in session memory only). */
export type VerifiedStepup = {
  sid: string;
  verifiedAt: number;
};

/** Step-up validity window (ms) — must match the backend TTL. */
export const STEPUP_TTL_MS = 10 * 60 * 1_000;

export type ProxyConfig = {
  backendUrl: string;
  apiBaseV1: string;
  /** Member MCP JWT (TRANSCODES_TOKEN). Sent on every request as `x-transcodes-token`. */
  token: string;
  /** JWT organizationId claim */
  organizationId: string;
  /** JWT projectId claim — fixed at issue time and not overridden at runtime. */
  projectId: string;
  /** JWT memberId claim — default member for step-up and get_my_profile. */
  memberId: string;
  /** Set after poll_stepup_session reports verified. */
  verifiedStepup?: VerifiedStepup;
  /** Tool name → path after `/v1`. Always derived from DEFAULT_ENDPOINT_MAP. */
  endpointMap: Map<string, string>;
};

/** Assembles ProxyConfig from process.env. dotenv is loaded earlier in index.ts. */
export function loadConfig(): ProxyConfig {
  const rawUrl =
    process.env.TRANSCODES_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
  const backendUrl = rawUrl.replace(/\/$/, '');

  try {
    new URL(backendUrl);
  } catch {
    throw new Error(`TRANSCODES_BACKEND_URL is not a valid URL: ${backendUrl}`);
  }

  const apiBaseV1 = `${backendUrl}/v1`;

  const tokenRaw = process.env.TRANSCODES_TOKEN?.trim() ?? '';
  if (!tokenRaw) {
    throw new Error('TRANSCODES_TOKEN is required (member MCP JWT)');
  }

  let token: string;
  let organizationId: string;
  let projectId: string;
  let memberId: string;
  try {
    const parsed = parseMemberAccessToken(tokenRaw);
    token = parsed.raw;
    organizationId = parsed.claims.organizationId;
    projectId = parsed.claims.projectId;
    memberId = parsed.claims.memberId;
    for (const w of parsed.warnings) {
      process.stderr.write(
        `[transcodes-mcp-server] WARN TRANSCODES_TOKEN: ${w}\n`
      );
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`TRANSCODES_TOKEN: ${detail}`);
  }

  const endpointMap = new Map<string, string>(
    Object.entries(DEFAULT_ENDPOINT_MAP)
  );

  return {
    backendUrl,
    apiBaseV1,
    token,
    organizationId,
    projectId,
    memberId,
    endpointMap,
  };
}
