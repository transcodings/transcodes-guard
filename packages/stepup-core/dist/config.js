/**
 * Step-up MFA configuration loader.
 *
 * Adapted from transcodes-mcp-server/src/config.ts — narrowed to only the
 * fields needed for the create/poll step-up endpoints. Endpoint maps,
 * organizationId, and the verified-state cache live elsewhere (constants
 * are baked into the session module; verified state lives in store.ts).
 */
import { parseMemberAccessToken } from "./jwt.js";
import { resolveToken } from "./token-store.js";
/** Backend default — matches transcodes-mcp-server constants. Override with TRANSCODES_BACKEND_URL. */
export const DEFAULT_BACKEND_URL = "https://api.transcodesapis.com";
/** Step-up validity window. Mirrors the backend TTL used by transcodes. */
export const STEPUP_TTL_MS = 10 * 60 * 1_000;
/**
 * Build StepupConfig from the environment + token store. The token is
 * resolved with the precedence env → ~/.transcodes/config.json → none
 * (see token-store.ts). Throws when no token is found or it is invalid.
 * Callers in fail-safe contexts (the hook) should catch and treat the
 * throw as "step-up unavailable → block".
 */
export function loadStepupConfig() {
    const rawUrl = process.env.TRANSCODES_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
    const backendUrl = rawUrl.replace(/\/$/, "");
    try {
        new URL(backendUrl);
    }
    catch {
        throw new Error(`TRANSCODES_BACKEND_URL is not a valid URL: ${backendUrl}`);
    }
    const { token: tokenRaw } = resolveToken();
    if (!tokenRaw) {
        throw new Error("No Transcodes token found. Get a token from the Transcodes console " +
            "(member detail page, https://app.transcodes.io), then run " +
            "`transcodes login <token>` in a terminal — or set the " +
            "TRANSCODES_TOKEN environment variable.");
    }
    const parsed = parseMemberAccessToken(tokenRaw);
    for (const w of parsed.warnings) {
        process.stderr.write(`[ai-action-tracker] WARN TRANSCODES_TOKEN: ${w}\n`);
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