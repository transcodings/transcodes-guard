import { z } from "zod";
import { loadStepupConfig } from "@ai-action-tracker/stepup-core";
import { req } from "./transcodes-client.js";
import { withStepupVerifiedSid } from "./stepup-helper.js";
const textResult = (text, isError = false) => ({
    isError,
    content: [{ type: "text", text }],
});
const MEMBER_SUSPENSION_API_NOTE = "Exact path after /v1: /auth/member/revocation (singular member, NOT members). " +
    "GET=query only; POST=suspend body; DELETE=unsuspend body. No PUT, PATCH, or /member/suspend.";
export function registerMemberTools(server) {
    server.registerTool("get_member", {
        title: "Get member",
        description: "Get one member profile. Pass `member_id` OR `email` — at least one is required (never omit both). Use for support lookups and auth debugging.",
        inputSchema: {
            member_id: z.string().optional(),
            email: z.string().optional(),
        },
    }, async ({ member_id, email }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: "GET",
            query: {
                project_id: config.projectId,
                member_id,
                email,
            },
        }, "get_member");
        return textResult(text);
    });
    server.registerTool("list_members_paginated", {
        title: "List members (paginated)",
        description: "Paginated member list without search. Fast for large directories; use sort_by/order.",
        inputSchema: {
            page: z.number().optional(),
            limit: z.number().optional(),
            sort_by: z.enum(["created_at", "updated_at"]).optional(),
            order: z.enum(["asc", "desc"]).optional(),
        },
    }, async ({ page, limit, sort_by, order }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: "GET",
            query: {
                project_id: config.projectId,
                page,
                limit,
                sort_by,
                order,
            },
        }, "list_members_paginated");
        return textResult(text);
    });
    server.registerTool("list_member_devices", {
        title: "List member devices",
        description: "Summary of passkeys, authenticators, and TOTP devices for a member. Labels and last-used timestamps. Use to audit MFA surface.",
        inputSchema: {
            member_id: z.string(),
        },
    }, async ({ member_id }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: "GET",
            query: { project_id: config.projectId, member_id },
        }, "list_member_devices");
        return textResult(text);
    });
    server.registerTool("get_member_suspension", {
        title: "Get member suspension status",
        description: "Check whether a member is currently suspended and when it was applied. Returns { revoked_at: ISO date string } if suspended, or { revoked_at: null } if active. Read-only. " +
            MEMBER_SUSPENSION_API_NOTE,
        inputSchema: {
            member_id: z.string(),
        },
    }, async ({ member_id }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: "GET",
            query: { project_id: config.projectId, member_id },
        }, "get_member_suspension");
        return textResult(text);
    });
    server.registerTool("retire_member", {
        title: "Retire member (permanent)",
        description: "PERMANENTLY delete a member from the project (kill switch — irreversible). " +
            "Use only when the user wants to fully delete / remove a member; for a temporary block use suspend_member. " +
            "Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-member`). " +
            "Body: { member_id } — project_id comes from TRANSCODES_TOKEN.",
        inputSchema: {
            body: z.object({ member_id: z.string() }),
        },
    }, async ({ body }) => {
        const config = loadStepupConfig();
        const text = await withStepupVerifiedSid("retire_member", (sid) => req(config, {
            method: "DELETE",
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
        }, "retire_member"));
        return textResult(text);
    });
    server.registerTool("suspend_member", {
        title: "Suspend member (reversible)",
        description: "Temporarily SUSPEND a member: blocks login and invalidates active sessions. Reversible via unsuspend_member. " +
            "Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-suspend-member`). " +
            MEMBER_SUSPENSION_API_NOTE,
        inputSchema: {
            body: z.object({ member_id: z.string() }),
        },
    }, async ({ body }) => {
        const config = loadStepupConfig();
        const text = await withStepupVerifiedSid("suspend_member", (sid) => req(config, {
            method: "POST",
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
        }, "suspend_member"));
        return textResult(text);
    });
    server.registerTool("unsuspend_member", {
        title: "Unsuspend member",
        description: "Lift a member's suspension and restore their ability to log in and create sessions. Use only on members previously suspended. " +
            "Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-unsuspend-member`). " +
            MEMBER_SUSPENSION_API_NOTE,
        inputSchema: {
            body: z.object({ member_id: z.string() }),
        },
    }, async ({ body }) => {
        const config = loadStepupConfig();
        const text = await withStepupVerifiedSid("unsuspend_member", (sid) => req(config, {
            method: "DELETE",
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
        }, "unsuspend_member"));
        return textResult(text);
    });
    server.registerTool("create_member", {
        title: "Create member",
        description: "Create a member (CreateMemberDto). member_id/name may be auto-generated. Use for onboarding or manual provisioning. " +
            "Auth: TRANSCODES_TOKEN sent as x-transcodes-token (not in body).",
        inputSchema: {
            body: z.object({
                email: z.string(),
                name: z.string().optional(),
                role: z.string().optional(),
                metadata: z.record(z.string(), z.unknown()).optional(),
            }),
        },
    }, async ({ body }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: "POST",
            body: { ...body, project_id: config.projectId },
        }, "create_member");
        return textResult(text);
    });
    server.registerTool("update_member", {
        title: "Update member",
        description: "Update member fields (UpdateMemberDto, flat shape). " +
            "Auth: TRANSCODES_TOKEN sent as x-transcodes-token (not in body). " +
            "member_id is required — supply the target member explicitly (it may differ from the caller).",
        inputSchema: {
            body: z.object({
                member_id: z.string(),
                name: z.string().optional(),
                email: z.string().optional(),
                role: z.string().optional(),
                metadata: z.record(z.string(), z.unknown()).optional(),
            }),
        },
    }, async ({ body }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: "PUT",
            body: { ...body, project_id: config.projectId },
        }, "update_member");
        return textResult(text);
    });
}
//# sourceMappingURL=members.js.map