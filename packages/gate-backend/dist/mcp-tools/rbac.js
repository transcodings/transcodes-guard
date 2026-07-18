import { loadStepupConfig } from '@transcodes-guard/core/stepup';
import { z } from 'zod';
import { defineBackendTool, defineProtectedBackendTool, textResult, } from './define.js';
import { req, reqEnvelope } from './transcodes-client.js';
const PROJECT_ID_GUIDANCE = 'project_id in the body must be the TRANSCODES_TOKEN project id (pid claim); it is not configurable per tool call.';
const PermissionLevel = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const ResourcePermissions = z.object({
    create: PermissionLevel.optional(),
    read: PermissionLevel.optional(),
    update: PermissionLevel.optional(),
    delete: PermissionLevel.optional(),
});
export const rbacToolDefinitions = [
    defineBackendTool({
        name: 'tc_get_roles',
        title: 'Get roles',
        description: 'List all roles and permission matrix for a project. Use when you need RBAC data for console parity or to know which roles can be assigned.',
        summary: 'List all roles and permission matrix for the project.',
        category: 'RBAC',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {},
        handler: async () => {
            const config = loadStepupConfig();
            const text = await req(config, { method: 'GET', query: { project_id: config.projectId } }, 'get_roles');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_get_resources',
        title: 'Get resources',
        description: 'List RBAC resource keys for a project. Use before editing roles or building permission UI.',
        summary: 'List RBAC resource keys for the project.',
        category: 'RBAC',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {},
        handler: async () => {
            const config = loadStepupConfig();
            const text = await req(config, { method: 'GET', query: { project_id: config.projectId } }, 'get_resources');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_check_rbac_permission',
        title: 'Check RBAC permission',
        description: 'Simulate whether a member may access a resource+action (SkipAuth). Returns denied/allowed; if allowed, may include stepUpRequired. Use for guard/debugging before routing.',
        summary: 'Simulate whether a member may access a resource+action.',
        category: 'RBAC',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            body: z.object({
                member_id: z.string(),
                resource: z.string(),
                action: z.enum(['create', 'read', 'update', 'delete']),
            }),
        },
        handler: async ({ body }) => {
            const config = loadStepupConfig();
            const text = await req(config, {
                method: 'POST',
                body: { ...body, project_id: config.projectId },
            }, 'check_rbac_permission');
            return textResult(text);
        },
    }),
    defineProtectedBackendTool({
        name: 'tc_retire_role',
        title: 'Retire role',
        description: 'Retire a role from the project. Use when the user wants to remove, drop, or discard a role. ' +
            'Verified action — step-up MFA enforced by the backend StepUpSessionGuard on the API call. ' +
            'Body { project_id } is injected from TRANSCODES_TOKEN by the server.',
        summary: 'Permanently retire a role from the project.',
        category: 'RBAC',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: true,
        stepUp: {
            action: 'delete',
            resource: 'system',
        },
        inputSchema: {
            role_id: z.string(),
        },
        run: (config, { role_id }) => reqEnvelope(config, {
            method: 'DELETE',
            body: { project_id: config.projectId },
        }, 'retire_role', `/${encodeURIComponent(role_id)}`),
    }),
    defineProtectedBackendTool({
        name: 'tc_set_role_permissions',
        title: 'Set role permissions',
        description: 'Set per-resource permission matrix for a role. 0=deny, 1=allow, 2=allow+step-up. ' +
            'Requires the caller MAT role to have system/update >= 1; calls at level 0 are denied. ' +
            'If denied, an admin must edit RBAC at https://app.transcodes.io → RBAC → Roles. ' +
            'Verified action — step-up MFA enforced by the backend StepUpSessionGuard on the API call.',
        summary: 'Set per-resource permission matrix for a role (0=deny, 1=allow, 2=step-up). Requires caller system/update >= 1; calls at level 0 are denied.',
        category: 'RBAC',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: true,
        stepUp: {
            action: 'update',
            resource: 'system',
        },
        inputSchema: {
            role_id: z.string(),
            body: z.object({
                permissions: z.record(z.string(), ResourcePermissions),
            }),
        },
        run: (config, { role_id, body }) => reqEnvelope(config, {
            method: 'PUT',
            body: { ...body, project_id: config.projectId },
        }, 'set_role_permissions', `/${encodeURIComponent(role_id)}/permissions`),
    }),
    defineProtectedBackendTool({
        name: 'tc_update_member_role',
        title: 'Update member role',
        description: "Change a member's assigned role (UpdateMemberRoleDto) — the canonical role-reassignment path. " +
            'Validates the target role EXISTS in the project before assigning (unlike `update_member`, which ' +
            "writes `role` unchecked). Use this whenever the user wants to change a member's role. " +
            'Requires the caller MAT role to have system/update >= 1; calls at level 0 are denied. ' +
            'If denied, an admin must edit RBAC at https://app.transcodes.io → RBAC → Roles. ' +
            'Verified action — step-up MFA enforced by the backend StepUpSessionGuard on the API call.',
        summary: "Change a member's assigned role (validates the role exists). Requires caller system/update >= 1; calls at level 0 are denied.",
        category: 'RBAC',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: true,
        stepUp: {
            action: 'update',
            resource: 'system',
        },
        inputSchema: {
            body: z.object({
                member_id: z.string(),
                role: z.string(),
            }),
        },
        run: (config, { body }) => reqEnvelope(config, {
            method: 'PUT',
            body: { ...body, project_id: config.projectId },
        }, 'update_member_role'),
    }),
    defineProtectedBackendTool({
        name: 'tc_retire_resource',
        title: 'Retire resource',
        description: 'Retire a resource key from the project. Use when the user wants to remove, drop, or discard a resource. ' +
            'Verified action — step-up MFA enforced by the backend StepUpSessionGuard on the API call. ' +
            'Path: resource_key. Query: project_id. No JSON body.',
        summary: 'Permanently retire an RBAC resource key.',
        category: 'RBAC',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: true,
        stepUp: {
            action: 'delete',
            resource: 'system',
        },
        inputSchema: {
            resource_key: z.string(),
        },
        run: (config, { resource_key }) => reqEnvelope(config, {
            method: 'DELETE',
            query: { project_id: config.projectId },
            omitBody: true,
        }, 'retire_resource', `/${encodeURIComponent(resource_key)}`),
    }),
    defineProtectedBackendTool({
        name: 'tc_create_role',
        title: 'Create role',
        description: 'Create a new role (CreateRoleDto). Use before set_role_permissions to fill per-resource access. ' +
            'RBAC-gated by the backend StepUpSessionGuard (0=block, 1=allow, 2=step-up MFA). ' +
            PROJECT_ID_GUIDANCE,
        summary: 'Create a new role before setting permissions.',
        category: 'RBAC',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: false,
        stepUp: {
            action: 'create',
            resource: 'system',
        },
        inputSchema: {
            body: z.object({
                name: z.string(),
                description: z.string().optional(),
            }),
        },
        run: (config, { body }) => reqEnvelope(config, {
            method: 'POST',
            body: { ...body, project_id: config.projectId },
        }, 'create_role'),
    }),
    defineProtectedBackendTool({
        name: 'tc_update_role',
        title: 'Update role',
        description: 'Update role metadata (UpdateRoleDto). ' +
            'RBAC-gated by the backend StepUpSessionGuard (0=block, 1=allow, 2=step-up MFA). ' +
            PROJECT_ID_GUIDANCE,
        summary: 'Update role metadata (description).',
        category: 'RBAC',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: false,
        stepUp: {
            action: 'update',
            resource: 'system',
        },
        inputSchema: {
            role_id: z.string(),
            body: z.object({
                description: z.string().optional(),
            }),
        },
        run: (config, { role_id, body }) => reqEnvelope(config, {
            method: 'PUT',
            body: { ...body, project_id: config.projectId },
        }, 'update_role', `/${encodeURIComponent(role_id)}`),
    }),
    defineProtectedBackendTool({
        name: 'tc_create_resource',
        title: 'Create resource',
        description: 'Add a new resource key (CreateResourceDto). Every existing role is initialized with the ' +
            'default permission matrix for the new key: read = allow (1), and create/update/delete = ' +
            'allow + step-up MFA (2). ' +
            'RBAC-gated by the backend StepUpSessionGuard (0=block, 1=allow, 2=step-up MFA). ' +
            PROJECT_ID_GUIDANCE,
        summary: 'Add a new RBAC resource key (every role initialized to read=allow, write=allow+step-up).',
        category: 'RBAC',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: false,
        stepUp: {
            action: 'create',
            resource: 'system',
        },
        inputSchema: {
            body: z.object({
                key: z.string(),
                name: z.string(),
                description: z.string().optional(),
            }),
        },
        run: (config, { body }) => reqEnvelope(config, {
            method: 'POST',
            body: { ...body, project_id: config.projectId },
        }, 'create_resource'),
    }),
    defineProtectedBackendTool({
        name: 'tc_update_resource',
        title: 'Update resource',
        description: 'Update resource label/description (UpdateResourceDto). Key stays the same. ' +
            'RBAC-gated by the backend StepUpSessionGuard (0=block, 1=allow, 2=step-up MFA). ' +
            PROJECT_ID_GUIDANCE,
        summary: 'Update resource label/description.',
        category: 'RBAC',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: false,
        stepUp: {
            action: 'update',
            resource: 'system',
        },
        inputSchema: {
            resource_key: z.string(),
            body: z.object({
                description: z.string().optional(),
            }),
        },
        run: (config, { resource_key, body }) => reqEnvelope(config, {
            method: 'PATCH',
            body: { ...body, project_id: config.projectId },
        }, 'update_resource', `/${encodeURIComponent(resource_key)}`),
    }),
];
//# sourceMappingURL=rbac.js.map