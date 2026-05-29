import type { ProxyTool } from './tool-utils.ts';
import { parse, req, requireStepup } from './tool-utils.ts';

// Member tools split by intent:
//   retire_member      — DELETE /v1/auth/member             (PERMANENT delete, kill switch)
//   suspend_member     — POST   /v1/auth/member/revocation  (temporary block)
//   unsuspend_member   — DELETE /v1/auth/member/revocation  (lift the block)
//   get_member_suspension — GET /v1/auth/member/revocation  (status check)

/**
 * AuthController member suspension — the path MUST use the singular **member** segment.
 * Wrong examples: /auth/members/revocation, /members/revocation, /member/suspend, PUT/PATCH.
 */
const MEMBER_SUSPENSION_API_NOTE =
  'Exact path after /v1: /auth/member/revocation (singular member, NOT members). ' +
  'GET=query only; POST=suspend body; DELETE=unsuspend body. No PUT, PATCH, or /member/suspend.';

/** Members — maps to AuthController member routes */
export const membersTools: ProxyTool[] = [
  {
    name: 'get_member',
    description:
      'Get one member profile. Pass `member_id` OR `email` — at least one is required (never omit both). Use for support lookups and auth debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: {
          type: 'string',
          description: 'Member public id. Provide this OR email, not neither.',
        },
        email: {
          type: 'string',
          description: 'Member email. Provide this OR member_id, not neither.',
        },
      },
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'GET',
          query: {
            project_id: config.projectId,
            member_id: parse.str(a, 'member_id'),
            email: parse.str(a, 'email'),
          },
        },
        'get_member'
      ),
  },
  {
    name: 'list_members_paginated',
    description:
      'Paginated member list without search. Fast for large directories; use sort_by/order.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number' },
        limit: { type: 'number' },
        sort_by: { type: 'string', enum: ['created_at', 'updated_at'] },
        order: { type: 'string', enum: ['asc', 'desc'] },
      },
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'GET',
          query: {
            project_id: config.projectId,
            page: parse.num(a, 'page'),
            limit: parse.num(a, 'limit'),
            sort_by: parse.str(a, 'sort_by'),
            order: parse.str(a, 'order'),
          },
        },
        'list_members_paginated'
      ),
  },
  {
    name: 'list_member_devices',
    description:
      'Summary of passkeys, authenticators, and TOTP devices for a member. Labels and last-used timestamps. Use to audit MFA surface.',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string' },
      },
      required: ['member_id'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'GET',
          query: {
            project_id: config.projectId,
            member_id: String(a.member_id),
          },
        },
        'list_member_devices'
      ),
  },
  {
    name: 'create_member',
    description:
      'Create a member (CreateMemberDto). member_id/name may be auto-generated. Use for onboarding or manual provisioning. ' +
      'Auth: TRANSCODES_TOKEN sent as x-transcodes-token (not in body).',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description:
            'CreateMemberDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here).',
          properties: {
            email: { type: 'string', description: 'Member email address' },
            name: {
              type: 'string',
              description: 'Display name (optional, max 100 chars)',
            },
            role: {
              type: 'string',
              description: 'Role name to assign (optional, max 50 chars)',
            },
            metadata: {
              type: 'object',
              description: 'Arbitrary key-value metadata (optional)',
              additionalProperties: true,
            },
          },
          required: ['email'],
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
        'create_member'
      ),
  },
  {
    name: 'update_member',
    description:
      'Update member fields (UpdateMemberDto, flat shape). ' +
      'Auth: TRANSCODES_TOKEN sent as x-transcodes-token (not in body). ' +
      'member_id is required — supply the target member explicitly (it may differ from the caller).',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description:
            'UpdateMemberDto fields (project_id is set from TRANSCODES_TOKEN by the server, not passed here).',
          properties: {
            member_id: {
              type: 'string',
              description: 'Member public id to update',
            },
            name: {
              type: 'string',
              description: 'Display name (max 100 chars)',
            },
            email: { type: 'string', description: 'Email address' },
            role: {
              type: 'string',
              description: 'Role name (max 50 chars)',
            },
            metadata: {
              type: 'object',
              description: 'Arbitrary key-value metadata',
              additionalProperties: true,
            },
          },
          required: ['member_id'],
        },
      },
      required: ['body'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'PUT',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'update_member'
      ),
  },
  {
    name: 'retire_member',
    description:
      'PERMANENTLY delete a member from the project (kill switch — irreversible). ' +
      'Use only when the user wants to fully delete / remove / get rid of a member. ' +
      'For a temporary block use suspend_member instead. ' +
      'Verified action — requires step-up MFA. Body: { member_id } — project_id comes from TRANSCODES_TOKEN. ' +
      'Exact path after /v1: DELETE /auth/member (singular member, NOT /auth/members or /auth/member/revocation).',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'project_id is set from TRANSCODES_TOKEN by the server.',
          properties: {
            member_id: {
              type: 'string',
              description: 'Member public id to permanently remove',
            },
          },
          required: ['member_id'],
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
          method: 'DELETE',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'retire_member'
      );
      config.verifiedStepup = undefined;
      return result;
    },
  },
  {
    name: 'get_member_suspension',
    description:
      'Check whether a member is currently suspended and when the suspension was applied. ' +
      'Returns { revoked_at: ISO date string } if suspended, or { revoked_at: null } if active. ' +
      'This is a status check only — it does NOT modify anything. ' +
      MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string' },
      },
      required: ['member_id'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'GET',
          query: {
            project_id: config.projectId,
            member_id: String(a.member_id),
          },
        },
        'get_member_suspension'
      ),
  },
  {
    name: 'suspend_member',
    description:
      'Temporarily SUSPEND a member: blocks login and invalidates all active sessions immediately. ' +
      'The member can be restored later via unsuspend_member — this is REVERSIBLE (not a delete). ' +
      'For permanent removal use retire_member instead. ' +
      'Verified action — requires step-up MFA. Body: { member_id } — project_id comes from TRANSCODES_TOKEN. POST only. ' +
      MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'project_id is set from TRANSCODES_TOKEN by the server.',
          properties: {
            member_id: {
              type: 'string',
              description: 'Member public id to suspend',
            },
          },
          required: ['member_id'],
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
          method: 'POST',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'suspend_member'
      );
      config.verifiedStepup = undefined;
      return result;
    },
  },
  {
    name: 'unsuspend_member',
    description:
      "Lift a member's suspension and restore their ability to log in and create sessions. " +
      'Use only on members previously suspended via suspend_member. ' +
      'Verified action — requires step-up MFA. Body: { member_id } — project_id comes from TRANSCODES_TOKEN. ' +
      MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'project_id is set from TRANSCODES_TOKEN by the server.',
          properties: {
            member_id: {
              type: 'string',
              description: 'Member public id to unsuspend',
            },
          },
          required: ['member_id'],
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
          method: 'DELETE',
          body: { ...parse.record(a.body), project_id: config.projectId },
        },
        'unsuspend_member'
      );
      config.verifiedStepup = undefined;
      return result;
    },
  },
];
