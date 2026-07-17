/**
 * JWK backup (console-only) — ported from transcodes-mcp-server's
 * `src/tools/jwk.ts`. Not callable via API; registered for discoverability
 * so the agent routes the user to the console. Pair with `get_console_url`
 * for the protected console link.
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
export declare const jwkToolDefinitions: readonly GuardToolDefinition[];
