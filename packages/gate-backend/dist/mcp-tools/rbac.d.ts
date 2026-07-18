/**
 * RBAC MCP tools — ported from transcodes-mcp-server's `src/tools/rbac.ts`.
 * Scope is intentionally narrow: only the step-up-protected mutations
 * (`retire_role`, `set_role_permissions`, `update_member_role`,
 * `retire_resource`) plus the read tools needed to investigate them
 * (`get_roles`, `get_resources`, `check_rbac_permission`).
 *
 * Protected tools declare their step-up coordinate via `stepUp`; the
 * registration loop wraps `run` in the 403 → STEP_UP_REQUIRED translation
 * (enforcement is backend-owned).
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
export declare const rbacToolDefinitions: readonly GuardToolDefinition[];
