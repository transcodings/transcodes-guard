/**
 * Step-up MFA configuration loader.
 *
 * Adapted from transcodes-mcp-server/src/config.ts — narrowed to only the
 * fields needed for the create/poll step-up endpoints. Endpoint maps,
 * organizationId, and the verified-state cache live elsewhere (constants
 * are baked into the session module; verified state lives in store.ts).
 */
import { parseMemberAccessToken } from "./jwt.js";

/** Backend default — matches transcodes-mcp-server constants. Override with TRANSCODES_BACKEND_URL. */
export const DEFAULT_BACKEND_URL = "https://api.transcodesapis.com";

/** Step-up validity window. Mirrors the backend TTL used by transcodes. */
export const STEPUP_TTL_MS = 10 * 60 * 1_000;

export type StepupConfig = {
  backendUrl: string;
  apiBaseV1: string;
  /** Member MCP JWT, sent as `x-transcodes-token`. */
  token: string;
  projectId: string;
  memberId: string;
};

/**
 * Build StepupConfig from process.env. Throws when TRANSCODES_TOKEN is
 * missing or invalid. Callers in fail-safe contexts (the hook) should
 * catch and treat the throw as "step-up unavailable → block".
 */
export function loadStepupConfig(): StepupConfig {
  const rawUrl =
    process.env.TRANSCODES_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
  const backendUrl = rawUrl.replace(/\/$/, "");

  try {
    new URL(backendUrl);
  } catch {
    throw new Error(`TRANSCODES_BACKEND_URL is not a valid URL: ${backendUrl}`);
  }

  const tokenRaw = process.env.TRANSCODES_TOKEN?.trim() ?? "";
  if (!tokenRaw) {
    throw new Error("TRANSCODES_TOKEN is required (member MCP JWT)");
  }

  const parsed = parseMemberAccessToken(tokenRaw);
  for (const w of parsed.warnings) {
    process.stderr.write(
      `[ai-action-tracker] WARN TRANSCODES_TOKEN: ${w}\n`,
    );
  }

  return {
    backendUrl,
    apiBaseV1: `${backendUrl}/v1`,
    token: parsed.raw,
    projectId: parsed.claims.projectId,
    memberId: parsed.claims.memberId,
  };
}
