import type { ProxyTool } from './tool-utils.ts';
import {
  PROJECT_ID_GUIDANCE,
  parse,
  req,
  requireStepup,
} from './tool-utils.ts';

// retire_role: DELETE …/role/:role_id + body { project_id }. retire_resource: DELETE …/resources/:key + ?project_id (no body). Call after step-up.
// Body `project_id` is always injected from `config.projectId` (TRANSCODES_TOKEN pid claim).

/** RBAC — maps to RoleController */
export const rbacTools: ProxyTool[] = [
  {
    name: 'get_roles',
    description:
      'List all roles and permission matrix for a project. Use when you need RBAC data for console parity or to know which roles can be assigned.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_a, config) =>
      req(
        config,
        { method: 'GET', query: { project_id: config.projectId } },
        'get_roles',
      ),
  },
  {
    name: 'create_role',
    description:
      'Create a new role (CreateRoleDto). Use before set_role_permissions to fill per-resource access.',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'CreateRoleDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here). ' + PROJECT_ID_GUIDANCE,
          properties: {
            name: { type: 'string', description: 'Role name (lowercase alphanumeric + hyphens, 2-50 chars)' },
            description: { type: 'string', description: 'Role description (optional, max 500 chars)' },
          },
          required: ['name'],
        },
      },
      required: ['body'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'POST',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'create_role',
      ),
  },
  {
    name: 'update_role',
    description: 'Update role metadata and step-up policy (UpdateRoleDto).',
    inputSchema: {
      type: 'object',
      properties: {
        role_id: { type: 'string' },
        body: {
          type: 'object',
          description: 'UpdateRoleDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here). ' + PROJECT_ID_GUIDANCE,
          properties: {
            description: { type: 'string', description: 'Role description (max 500 chars)' },
          },
        },
      },
      required: ['role_id', 'body'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'PUT',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'update_role',
        `/${String(a.role_id)}`,
      ),
  },
  {
    name: 'retire_role',
    description:
      'Retire a role from the project. Use when the user wants to remove, drop, or discard a role. ' +
      'Verified action — requires step-up MFA. ' +
      'Body { project_id } is injected from TRANSCODES_TOKEN by the server.',
    inputSchema: {
      type: 'object',
      properties: {
        role_id: { type: 'string' },
      },
      required: ['role_id'],
    },
    handler: async (a, config) => {
      const blocked = requireStepup(config);
      if (blocked) return blocked;
      const result = await req(
        config,
        { method: 'DELETE', body: { project_id: config.projectId } },
        'retire_role',
        `/${String(a.role_id)}`,
      );
      config.verifiedStepup = undefined;
      return result;
    },
  },
  {
    name: 'set_role_permissions',
    description:
      'Set per-resource permission matrix for a role. 0=deny, 1=allow, 2=allow+step-up. ' +
      'Verified action — requires step-up MFA.',
    inputSchema: {
      type: 'object',
      properties: {
        role_id: { type: 'string' },
        body: {
          type: 'object',
          description: 'UpdateRolePermissionsDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here). ' + PROJECT_ID_GUIDANCE,
          properties: {
            permissions: {
              type: 'object',
              description: 'Resource-key → { create, read, update, delete } map. Each action value: 0=deny, 1=allow, 2=allow+step-up',
              additionalProperties: {
                type: 'object',
                properties: {
                  create: { type: 'number', enum: [0, 1, 2] },
                  read: { type: 'number', enum: [0, 1, 2] },
                  update: { type: 'number', enum: [0, 1, 2] },
                  delete: { type: 'number', enum: [0, 1, 2] },
                },
              },
            },
          },
          required: ['permissions'],
        },
      },
      required: ['role_id', 'body'],
    },
    handler: async (a, config) => {
      const blocked = requireStepup(config);
      if (blocked) return blocked;
      const result = await req(
        config,
        {
          method: 'PUT',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'set_role_permissions',
        `/${String(a.role_id)}/permissions`,
      );
      config.verifiedStepup = undefined;
      return result;
    },
  },
  {
    name: 'update_member_role',
    description:
      "Change a member's assigned role (UpdateMemberRoleDto). " +
      'Verified action — requires step-up MFA.',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'UpdateMemberRoleDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here). ' + PROJECT_ID_GUIDANCE,
          properties: {
            member_id: { type: 'string', description: 'Member public id' },
            role: { type: 'string', description: 'Role name to assign (lowercase alphanumeric + hyphens)' },
          },
          required: ['member_id', 'role'],
        },
      },
      required: ['body'],
    },
    handler: async (a, config) => {
      const blocked = requireStepup(config);
      if (blocked) return blocked;
      const result = await req(
        config,
        {
          method: 'PUT',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'update_member_role',
      );
      config.verifiedStepup = undefined;
      return result;
    },
  },
  {
    name: 'check_rbac_permission',
    description:
      'Simulate whether a member may access a resource+action (SkipAuth). Returns denied/allowed; if allowed, may include stepUpRequired. Use for guard/debugging before routing.',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'CheckRbacPermissionDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here). ' + PROJECT_ID_GUIDANCE,
          properties: {
            member_id: { type: 'string', description: 'Member public id' },
            resource: { type: 'string', description: 'Resource key to check' },
            action: { type: 'string', enum: ['create', 'read', 'update', 'delete'], description: 'CRUD action to check' },
          },
          required: ['member_id', 'resource', 'action'],
        },
      },
      required: ['body'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'POST',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'check_rbac_permission',
      ),
  },
  {
    name: 'get_resources',
    description:
      'List RBAC resource keys for a project. Use before editing roles or building permission UI.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_a, config) =>
      req(
        config,
        { method: 'GET', query: { project_id: config.projectId } },
        'get_resources',
      ),
  },
  {
    name: 'create_resource',
    description:
      'Add a new resource key (CreateResourceDto). New resources default to deny (0) for all roles.',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'CreateResourceDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here). ' + PROJECT_ID_GUIDANCE,
          properties: {
            key: { type: 'string', description: 'Resource key (lowercase alphanumeric + hyphens, max 50 chars)' },
            name: { type: 'string', description: 'Display name (max 100 chars)' },
            description: { type: 'string', description: 'Resource description (optional, max 500 chars)' },
          },
          required: ['key', 'name'],
        },
      },
      required: ['body'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'POST',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'create_resource',
      ),
  },
  {
    name: 'update_resource',
    description:
      'Update resource label/description (UpdateResourceDto). Key stays the same.',
    inputSchema: {
      type: 'object',
      properties: {
        resource_key: { type: 'string' },
        body: {
          type: 'object',
          description: 'UpdateResourceDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here). ' + PROJECT_ID_GUIDANCE,
          properties: {
            description: { type: 'string', description: 'Resource description (max 500 chars)' },
          },
        },
      },
      required: ['resource_key', 'body'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'PATCH',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'update_resource',
        `/${encodeURIComponent(String(a.resource_key))}`,
      ),
  },
  {
    name: 'retire_resource',
    description:
      'Retire a resource key from the project. Use when the user wants to remove, drop, or discard a resource. ' +
      'Verified action — requires step-up MFA. Path: resource_key. Query: project_id. No JSON body.',
    inputSchema: {
      type: 'object',
      properties: {
        resource_key: { type: 'string' },
      },
      required: ['resource_key'],
    },
    handler: async (a, config) => {
      const blocked = requireStepup(config);
      if (blocked) return blocked;
      const result = await req(
        config,
        {
          method: 'DELETE',
          query: { project_id: config.projectId },
          omitBody: true,
        },
        'retire_resource',
        `/${encodeURIComponent(String(a.resource_key))}`,
      );
      config.verifiedStepup = undefined;
      return result;
    },
  },
];
