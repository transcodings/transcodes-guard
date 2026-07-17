/**
 * Member directory MCP tools — ported from transcodes-mcp-server's
 * `src/tools/members.ts`.
 *
 * Read tools (`get_member`, `list_members_paginated`, `list_member_devices`,
 * `get_member_suspension`) are plain backend calls. Protected tools declare
 * their step-up coordinate via `stepUp`; the registration loop wraps `run`
 * in `execProtectedTool` so the backend can validate the verified sid.
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
export declare const memberToolDefinitions: readonly GuardToolDefinition[];
