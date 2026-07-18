/**
 * Recovery passcode MCP tool — ported from transcodes-mcp-server's
 * `src/tools/passcode.ts`.
 *
 * Protected: declares its step-up coordinate via `stepUp`; enforcement is
 * backend-owned (StepUpSessionGuard + coordinate verified cache).
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
export declare const passcodeToolDefinitions: readonly GuardToolDefinition[];
