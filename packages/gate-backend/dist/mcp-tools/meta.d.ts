/**
 * Meta / identity MCP tools — ported from transcodes-mcp-server's
 * `src/tools/proxy.ts` (the non-tunnel subset) and `instructions.ts`.
 *
 * Local tools (`get_current_*_id`) read claims off the parsed token with no
 * backend call. `get_my_profile` and `get_console_url` proxy a single read.
 * `get_integration_guide` fetches the public llms.txt guide via builtin
 * fetch (no axios dependency). Tunnel tools are intentionally omitted —
 * plugins ship their own HTTP transport entry (`src/http.ts`).
 *
 * NOTE: `meta: false` here means "not a step-up infrastructure tool" — the
 * category name 'Meta & Identity' is unrelated to the meta skip set.
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
export declare const metaToolDefinitions: readonly GuardToolDefinition[];
