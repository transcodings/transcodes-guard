/**
 * Step-up MFA configuration loader.
 *
 * Adapted from transcodes-mcp-server/src/config.ts — narrowed to only the
 * fields needed for the create/poll step-up endpoints. Endpoint maps,
 * organizationId, and the verified-state cache live elsewhere (constants
 * are baked into the session module; verified state lives in store.ts).
 */
import { parseMemberAccessToken } from './jwt.js';
import { resolveToken } from './token-store.js';
/**
 * Backend default. Cloud unless `environment=dev` (set in repo-root `.env.local`,
 * loaded by `dev:*` scripts via `scripts/load-dev-env.cjs` + dotenv). Shipped
 * plugin bundles never load an env file, so they always resolve to cloud.
 * An explicit `TRANSCODES_BACKEND_URL` overrides either way (see loadStepupConfig).
 */
export const DEFAULT_BACKEND_URL = process.env.environment === 'dev'
    ? 'http://localhost:3500'
    : 'https://api.transcodesapis.com';
/** Step-up validity window. Mirrors the backend TTL used by transcodes. */
export const STEPUP_TTL_MS = 10 * 60 * 1_000;
/**
 * MCP-only time-based exemption window. Once a single MCP step-up verifies,
 * every MCP tool call passes without re-prompting for this long, counted from
 * the first verification (fixed, non-sliding). Bash is unaffected — it stays
 * single-shot per command. Kept shorter than STEPUP_TTL_MS (the backend
 * session TTL) so a grant always lapses before the underlying sid does.
 */
export const MCP_GRANT_TTL_MS = 5 * 60 * 1_000;
/**
 * Build StepupConfig from the environment + token store. The token is
 * resolved solely from ~/.transcodes/config.json (see token-store.ts).
 * Throws when no token is found or it is invalid. Callers in fail-safe
 * contexts (the hook) should catch and treat the throw as "step-up
 * unavailable → block".
 */
export function loadStepupConfig() {
    const rawUrl = process.env.TRANSCODES_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
    const backendUrl = rawUrl.replace(/\/$/, '');
    try {
        new URL(backendUrl);
    }
    catch {
        throw new Error(`TRANSCODES_BACKEND_URL is not a valid URL: ${backendUrl}`);
    }
    const { token: tokenRaw } = resolveToken();
    if (!tokenRaw) {
        throw new Error('No Transcodes token found. Install the CLI ' +
            '(`npm install -g @bigstrider/transcodes-cli`), run `transcodes` to open ' +
            'the dashboard, and paste a token from the Transcodes console (member ' +
            'detail page, https://app.transcodes.io). Non-interactive: ' +
            '`transcodes set <token> -l <label>`.');
    }
    const parsed = parseMemberAccessToken(tokenRaw);
    for (const w of parsed.warnings) {
        process.stderr.write(`[transcodes-guard] WARN token: ${w}\n`);
    }
    return {
        backendUrl,
        apiBaseV1: `${backendUrl}/v1`,
        token: parsed.raw,
        organizationId: parsed.claims.organizationId,
        projectId: parsed.claims.projectId,
        memberId: parsed.claims.memberId,
    };
}
//# sourceMappingURL=config.js.map