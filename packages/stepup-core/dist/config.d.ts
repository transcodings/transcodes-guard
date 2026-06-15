/** Backend default — matches transcodes-mcp-server constants. Override with TRANSCODES_BACKEND_URL. */
export declare const DEFAULT_BACKEND_URL = "http://localhost:3500";
/** Step-up validity window. Mirrors the backend TTL used by transcodes. */
export declare const STEPUP_TTL_MS: number;
export type StepupConfig = {
    backendUrl: string;
    apiBaseV1: string;
    /** Member MCP JWT, sent as `x-transcodes-token`. */
    token: string;
    organizationId: string;
    projectId: string;
    memberId: string;
};
/**
 * Build StepupConfig from the environment + token store. The token is
 * resolved with the precedence env → ~/.transcodes/config.json → none
 * (see token-store.ts). Throws when no token is found or it is invalid.
 * Callers in fail-safe contexts (the hook) should catch and treat the
 * throw as "step-up unavailable → block".
 */
export declare function loadStepupConfig(): StepupConfig;
