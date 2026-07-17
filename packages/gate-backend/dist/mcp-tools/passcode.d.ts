/**
 * Recovery passcode MCP tool — ported from transcodes-mcp-server's
 * `src/tools/passcode.ts`.
 *
 * Step-up enforcement is via the PreToolUse hook (tool-rule
 * `tc-passcode-create`); the registration loop threads the verified sid.
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
export declare const passcodeToolDefinitions: readonly GuardToolDefinition[];
