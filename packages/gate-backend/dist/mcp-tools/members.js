import { loadStepupConfig } from '@transcodes-guard/core/stepup';
import { z } from 'zod';
import { defineBackendTool, defineProtectedBackendTool, textResult, } from './define.js';
import { req, reqEnvelope } from './transcodes-client.js';
const MEMBER_SUSPENSION_API_NOTE = 'Exact path after /v1: /auth/member/revocation (singular member, NOT members). ' +
    'GET=query only; POST=suspend body; DELETE=unsuspend body. No PUT, PATCH, or /member/suspend.';
export const memberToolDefinitions = [
    defineBackendTool({
        name: 'tc_get_member',
        title: 'Get member',
        description: 'Get one member profile. Pass `member_id` OR `email` — at least one is required (never omit both). Use for support lookups and auth debugging.',
        summary: 'Get one member profile by member_id or email.',
        category: 'Members',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            member_id: z.string().optional(),
            email: z.string().optional(),
        },
        handler: async ({ member_id, email }) => {
            const config = loadStepupConfig();
            const text = await req(config, {
                method: 'GET',
                query: {
                    project_id: config.projectId,
                    member_id,
                    email,
                },
            }, 'get_member');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_list_members_paginated',
        title: 'List members (paginated)',
        description: 'Paginated member list without search. Fast for large directories; use sort_by/order.',
        summary: 'Paginated member list with sort options.',
        category: 'Members',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            page: z.number().optional(),
            limit: z.number().optional(),
            sort_by: z.enum(['created_at', 'updated_at']).optional(),
            order: z.enum(['asc', 'desc']).optional(),
        },
        handler: async ({ page, limit, sort_by, order }) => {
            const config = loadStepupConfig();
            const text = await req(config, {
                method: 'GET',
                query: {
                    project_id: config.projectId,
                    page,
                    limit,
                    sort_by,
                    order,
                },
            }, 'list_members_paginated');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_list_member_devices',
        title: 'List member devices',
        description: 'Summary of passkeys, authenticators, and TOTP devices for a member. Labels and last-used timestamps. Use to audit MFA surface.',
        summary: 'Passkeys, authenticators, and TOTP devices for a member.',
        category: 'Members',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            member_id: z.string(),
        },
        handler: async ({ member_id }) => {
            const config = loadStepupConfig();
            const text = await req(config, {
                method: 'GET',
                query: { project_id: config.projectId, member_id },
            }, 'list_member_devices');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_get_member_suspension',
        title: 'Get member suspension status',
        description: 'Check whether a member is currently suspended and when it was applied. Returns { revoked_at: ISO date string } if suspended, or { revoked_at: null } if active. Read-only. ' +
            MEMBER_SUSPENSION_API_NOTE,
        summary: 'Check whether a member is currently suspended.',
        category: 'Members',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            member_id: z.string(),
        },
        handler: async ({ member_id }) => {
            const config = loadStepupConfig();
            const text = await req(config, {
                method: 'GET',
                query: { project_id: config.projectId, member_id },
            }, 'get_member_suspension');
            return textResult(text);
        },
    }),
    defineProtectedBackendTool({
        name: 'tc_retire_member',
        title: 'Retire member (permanent)',
        description: 'PERMANENTLY delete a member from the project (kill switch — irreversible). ' +
            'Use only when the user wants to fully delete / remove a member; for a temporary block use suspend_member. ' +
            'Verified action — step-up MFA enforced by the backend StepUpSessionGuard on the API call. ' +
            'Body: { member_id } — project_id comes from TRANSCODES_TOKEN.',
        summary: 'Permanently delete a member — irreversible kill switch.',
        category: 'Members',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: true,
        stepUp: {
            action: 'delete',
            resource: 'system',
        },
        inputSchema: {
            body: z.object({ member_id: z.string() }),
        },
        run: (config, { body }) => reqEnvelope(config, {
            method: 'DELETE',
            body: { ...body, project_id: config.projectId },
        }, 'retire_member'),
    }),
    defineProtectedBackendTool({
        name: 'tc_suspend_member',
        title: 'Suspend member (reversible)',
        description: 'Temporarily SUSPEND a member: blocks login and invalidates active sessions. Reversible via unsuspend_member. ' +
            'Verified action — step-up MFA enforced by the backend StepUpSessionGuard on the API call. ' +
            MEMBER_SUSPENSION_API_NOTE,
        summary: 'Temporarily suspend a member; blocks login and invalidates sessions.',
        category: 'Members',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: true,
        stepUp: {
            action: 'update',
            resource: 'system',
        },
        inputSchema: {
            body: z.object({ member_id: z.string() }),
        },
        run: (config, { body }) => reqEnvelope(config, {
            method: 'POST',
            body: { ...body, project_id: config.projectId },
        }, 'suspend_member'),
    }),
    defineProtectedBackendTool({
        name: 'tc_unsuspend_member',
        title: 'Unsuspend member',
        description: "Lift a member's suspension and restore their ability to log in and create sessions. Use only on members previously suspended. " +
            'Verified action — step-up MFA enforced by the backend StepUpSessionGuard on the API call. ' +
            MEMBER_SUSPENSION_API_NOTE,
        summary: 'Lift a member suspension and restore login ability.',
        category: 'Members',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: true,
        stepUp: {
            action: 'update',
            resource: 'system',
        },
        inputSchema: {
            body: z.object({ member_id: z.string() }),
        },
        run: (config, { body }) => reqEnvelope(config, {
            method: 'DELETE',
            body: { ...body, project_id: config.projectId },
        }, 'unsuspend_member'),
    }),
    defineProtectedBackendTool({
        name: 'tc_create_member',
        title: 'Create member',
        description: 'Create a member (CreateMemberDto). member_id/name may be auto-generated. Use for onboarding or manual provisioning. ' +
            'RBAC-gated by the backend StepUpSessionGuard (0=block, 1=allow, 2=step-up MFA). ' +
            'Auth: TRANSCODES_TOKEN sent as x-transcodes-token (not in body).',
        summary: 'Create a member for onboarding or manual provisioning.',
        category: 'Members',
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
                email: z.string(),
                name: z.string().optional(),
                role: z.string().optional(),
                metadata: z.record(z.string(), z.unknown()).optional(),
            }),
        },
        run: (config, { body }) => reqEnvelope(config, {
            method: 'POST',
            body: { ...body, project_id: config.projectId },
        }, 'create_member'),
    }),
    defineProtectedBackendTool({
        name: 'tc_update_member',
        title: 'Update member',
        description: 'Update member PROFILE fields — name, email, metadata (UpdateMemberDto, flat shape). ' +
            'RBAC-gated by the backend StepUpSessionGuard (0=block, 1=allow, 2=step-up MFA). ' +
            'member_id is required — supply the target member explicitly (it may differ from the caller). ' +
            "To REASSIGN a member's ROLE, use `update_member_role` instead: it validates the role exists " +
            '(this tool writes `role` straight through with no validation). Prefer omitting `role` here.',
        summary: 'Update member profile fields (name, email, metadata). Use update_member_role to change a role.',
        category: 'Members',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: false,
        stepUp: {
            action: 'update',
            resource: 'system',
        },
        inputSchema: {
            body: z.object({
                member_id: z.string(),
                name: z.string().optional(),
                email: z.string().optional(),
                role: z.string().optional(),
                metadata: z.record(z.string(), z.unknown()).optional(),
            }),
        },
        run: (config, { body }) => reqEnvelope(config, {
            method: 'PUT',
            body: { ...body, project_id: config.projectId },
        }, 'update_member'),
    }),
];
//# sourceMappingURL=members.js.map