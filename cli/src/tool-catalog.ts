/**
 * Read-only catalog of every MCP tool registered in createServer().
 * Used only by the transcodes CLI dashboard.
 *
 * The entry list itself is a generated artifact
 * (`./tool-catalog.generated.ts`, derived from the tool definition data by
 * `scripts/generate-router-files.mjs`); this module keeps the types and the
 * payload helpers. Regenerate with `npm run prebuild:plugin`.
 */
export type AdminToolAccess = 'api' | 'console-only' | 'gate';

export type AdminToolEntry = {
  /** Short registerTool name (e.g. get_member). */
  name: string;
  /** Human title from registerTool metadata. */
  title: string;
  /** One-line summary for dashboard cards. */
  description: string;
  category: string;
  access: AdminToolAccess;
  /** PreToolUse step-up enforced via the derived system tool-rules. */
  stepUpProtected: boolean;
};

/** Claude/Codex wire host marker (plugin + server key). */
export const TRANSCODES_MCP_PREFIX = 'tc_';

export function mcpWireName(toolName: string): string {
  return `${TRANSCODES_MCP_PREFIX}${toolName}`;
}

export { TRANSCODES_ADMIN_TOOLS } from './tool-catalog.generated.js';

import { TRANSCODES_ADMIN_TOOLS } from './tool-catalog.generated.js';

export type AdminToolsPayload = {
  prefix: string;
  total: number;
  tools: Array<AdminToolEntry & { mcpToolName: string }>;
};

export function buildAdminToolsPayload(): AdminToolsPayload {
  const tools = TRANSCODES_ADMIN_TOOLS.filter((t) => t.access === 'api').map(
    (t) => ({
      ...t,
      mcpToolName: mcpWireName(t.name),
    }),
  );
  return {
    prefix: TRANSCODES_MCP_PREFIX,
    total: tools.length,
    tools,
  };
}
