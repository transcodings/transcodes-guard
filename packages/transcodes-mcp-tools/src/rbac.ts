/**
 * RBAC MCP tools — ported from transcodes-mcp-server's `src/tools/rbac.ts`.
 * Scope is intentionally narrow: only the step-up-protected mutations
 * (`retire_role`, `set_role_permissions`, `update_member_role`,
 * `retire_resource`) plus the read tools needed to investigate them
 * (`get_roles`, `get_resources`, `check_rbac_permission`).
 *
 * Protected handlers thread the verified sid via `withStepupVerifiedSid`;
 * the in-memory `requireStepup` pattern is gone — the PreToolUse hook
 * now enforces via `hooks/tool-rules.json`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadStepupConfig } from '@transcodes-guard/stepup-core';
import { z } from 'zod';
import { execProtectedTool } from './stepup-helper.js';
import { req } from './transcodes-client.js';

const textResult = (text: string, isError = false) => ({
  isError,
  content: [{ type: 'text' as const, text }],
});

const PROJECT_ID_GUIDANCE =
  'project_id in the body must be the TRANSCODES_TOKEN project id (pid claim); it is not configurable per tool call.';

const PermissionLevel = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const ResourcePermissions = z.object({
  create: PermissionLevel.optional(),
  read: PermissionLevel.optional(),
  update: PermissionLevel.optional(),
  delete: PermissionLevel.optional(),
});

export function registerRbacTools(server: McpServer): void {
  server.registerTool(
    'get_roles',
    {
      title: 'Get roles',
      description:
        'List all roles and permission matrix for a project. Use when you need RBAC data for console parity or to know which roles can be assigned.',
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        { method: 'GET', query: { project_id: config.projectId } },
        'get_roles',
      );
      return textResult(text);
    },
  );

  server.registerTool(
    'get_resources',
    {
      title: 'Get resources',
      description:
        'List RBAC resource keys for a project. Use before editing roles or building permission UI.',
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        { method: 'GET', query: { project_id: config.projectId } },
        'get_resources',
      );
      return textResult(text);
    },
  );

  server.registerTool(
    'check_rbac_permission',
    {
      title: 'Check RBAC permission',
      description:
        'Simulate whether a member may access a resource+action (SkipAuth). Returns denied/allowed; if allowed, may include stepUpRequired. Use for guard/debugging before routing.',
      inputSchema: {
        body: z.object({
          member_id: z.string(),
          resource: z.string(),
          action: z.enum(['create', 'read', 'update', 'delete']),
        }),
      },
    },
    async ({ body }) => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        {
          method: 'POST',
          body: { ...body, project_id: config.projectId },
        },
        'check_rbac_permission',
      );
      return textResult(text);
    },
  );

  server.registerTool(
    'retire_role',
    {
      title: 'Retire role',
      description:
        'Retire a role from the project. Use when the user wants to remove, drop, or discard a role. ' +
        'Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-role`). ' +
        'Body { project_id } is injected from TRANSCODES_TOKEN by the server.',
      inputSchema: {
        role_id: z.string(),
      },
    },
    async ({ role_id }) => {
      const config = loadStepupConfig();
      return execProtectedTool('retire_role', (sid) =>
        req(
          config,
          {
            method: 'DELETE',
            body: { project_id: config.projectId },
            stepUpSid: sid,
          },
          'retire_role',
          `/${encodeURIComponent(role_id)}`,
        ),
      );
    },
  );

  server.registerTool(
    'set_role_permissions',
    {
      title: 'Set role permissions',
      description:
        'Set per-resource permission matrix for a role. 0=deny, 1=allow, 2=allow+step-up. ' +
        'Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-set-role-permissions`).',
      inputSchema: {
        role_id: z.string(),
        body: z.object({
          permissions: z.record(z.string(), ResourcePermissions),
        }),
      },
    },
    async ({ role_id, body }) => {
      const config = loadStepupConfig();
      return execProtectedTool('set_role_permissions', (sid) =>
        req(
          config,
          {
            method: 'PUT',
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
          },
          'set_role_permissions',
          `/${encodeURIComponent(role_id)}/permissions`,
        ),
      );
    },
  );

  server.registerTool(
    'update_member_role',
    {
      title: 'Update member role',
      description:
        "Change a member's assigned role (UpdateMemberRoleDto). " +
        'Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-update-member-role`).',
      inputSchema: {
        body: z.object({
          member_id: z.string(),
          role: z.string(),
        }),
      },
    },
    async ({ body }) => {
      const config = loadStepupConfig();
      return execProtectedTool('update_member_role', (sid) =>
        req(
          config,
          {
            method: 'PUT',
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
          },
          'update_member_role',
        ),
      );
    },
  );

  server.registerTool(
    'retire_resource',
    {
      title: 'Retire resource',
      description:
        'Retire a resource key from the project. Use when the user wants to remove, drop, or discard a resource. ' +
        'Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-resource`). ' +
        'Path: resource_key. Query: project_id. No JSON body.',
      inputSchema: {
        resource_key: z.string(),
      },
    },
    async ({ resource_key }) => {
      const config = loadStepupConfig();
      return execProtectedTool('retire_resource', (sid) =>
        req(
          config,
          {
            method: 'DELETE',
            query: { project_id: config.projectId },
            omitBody: true,
            stepUpSid: sid,
          },
          'retire_resource',
          `/${encodeURIComponent(resource_key)}`,
        ),
      );
    },
  );

  server.registerTool(
    'create_role',
    {
      title: 'Create role',
      description:
        'Create a new role (CreateRoleDto). Use before set_role_permissions to fill per-resource access. ' +
        'RBAC-gated via tool-rule `tc-create-role` (0=block, 1=allow, 2=step-up MFA). ' +
        PROJECT_ID_GUIDANCE,
      inputSchema: {
        body: z.object({
          name: z.string(),
          description: z.string().optional(),
        }),
      },
    },
    async ({ body }) => {
      const config = loadStepupConfig();
      return execProtectedTool('create_role', (sid) =>
        req(
          config,
          {
            method: 'POST',
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
          },
          'create_role',
        ),
      );
    },
  );

  server.registerTool(
    'update_role',
    {
      title: 'Update role',
      description:
        'Update role metadata (UpdateRoleDto). ' +
        'RBAC-gated via tool-rule `tc-update-role` (0=block, 1=allow, 2=step-up MFA). ' +
        PROJECT_ID_GUIDANCE,
      inputSchema: {
        role_id: z.string(),
        body: z.object({
          description: z.string().optional(),
        }),
      },
    },
    async ({ role_id, body }) => {
      const config = loadStepupConfig();
      return execProtectedTool('update_role', (sid) =>
        req(
          config,
          {
            method: 'PUT',
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
          },
          'update_role',
          `/${encodeURIComponent(role_id)}`,
        ),
      );
    },
  );

  server.registerTool(
    'create_resource',
    {
      title: 'Create resource',
      description:
        'Add a new resource key (CreateResourceDto). New resources default to deny (0) for all roles. ' +
        'RBAC-gated via tool-rule `tc-create-resource` (0=block, 1=allow, 2=step-up MFA). ' +
        PROJECT_ID_GUIDANCE,
      inputSchema: {
        body: z.object({
          key: z.string(),
          name: z.string(),
          description: z.string().optional(),
        }),
      },
    },
    async ({ body }) => {
      const config = loadStepupConfig();
      return execProtectedTool('create_resource', (sid) =>
        req(
          config,
          {
            method: 'POST',
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
          },
          'create_resource',
        ),
      );
    },
  );

  server.registerTool(
    'update_resource',
    {
      title: 'Update resource',
      description:
        'Update resource label/description (UpdateResourceDto). Key stays the same. ' +
        'RBAC-gated via tool-rule `tc-update-resource` (0=block, 1=allow, 2=step-up MFA). ' +
        PROJECT_ID_GUIDANCE,
      inputSchema: {
        resource_key: z.string(),
        body: z.object({
          description: z.string().optional(),
        }),
      },
    },
    async ({ resource_key, body }) => {
      const config = loadStepupConfig();
      return execProtectedTool('update_resource', (sid) =>
        req(
          config,
          {
            method: 'PATCH',
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
          },
          'update_resource',
          `/${encodeURIComponent(resource_key)}`,
        ),
      );
    },
  );
}
