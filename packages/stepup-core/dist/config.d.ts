/**
 * Backend default. Cloud unless `environment=dev` (set in repo-root `.env.local`,
 * loaded by `dev:*` scripts via `scripts/load-dev-env.cjs` + dotenv). Shipped
 * plugin bundles never load an env file, so they always resolve to cloud.
 * An explicit `TRANSCODES_BACKEND_URL` overrides either way (see loadStepupConfig).
 */
export declare const DEFAULT_BACKEND_URL: string;
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
