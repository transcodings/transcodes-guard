import { loadStepupConfig } from '@transcodes-guard-private/stepup-core';
import { z } from 'zod';
import { req } from './transcodes-client.js';
const textResult = (text, isError = false) => ({
    isError,
    content: [{ type: 'text', text }],
});
export function registerMembershipTools(server) {
    server.registerTool('membership_plans', {
        title: 'Membership plans',
        description: 'Returns the full list of available Transcodes membership plans (free, standard, business, enterprise) including price, currency, billing interval, and Stripe product metadata. ' +
            'This is a public endpoint — no authentication required. ' +
            'Use this tool to display plan options to users or to look up the price_id needed for membership_create_checkout_session.',
        inputSchema: {},
    }, async () => {
        const config = loadStepupConfig();
        const text = await req(config, { method: 'GET' }, 'membership_plans');
        return textResult(text);
    });
    server.registerTool('membership_plans_limits', {
        title: 'Membership plan limits',
        description: 'Returns the resource limits enforced per plan tier. ' +
            'Each plan entry includes: projects (max projects allowed), roles, resources, members (max members per project), and price (monthly USD, null = contact for pricing). ' +
            'Free tier: 1 project / 2 roles / 2 resources / 2 members. ' +
            'Standard: 5 projects / unlimited roles & resources / 10 members. ' +
            'Business & Enterprise: unlimited everything. ' +
            'Use this to build pricing comparison UI or to warn users when they are approaching a limit.',
        inputSchema: {},
    }, async () => {
        const config = loadStepupConfig();
        const text = await req(config, { method: 'GET' }, 'membership_plans_limits');
        return textResult(text);
    });
    server.registerTool('membership_customer_status_by_project', {
        title: 'Customer status by project',
        description: 'Returns the active subscription status of the organization that owns the project in TRANSCODES_TOKEN (pid claim). ' +
            'SkipAuth — GET /v1/membership/customer/status/project?project_id=... ' +
            'Useful when the SDK Toolkit only carries a project context.',
        inputSchema: {},
    }, async () => {
        const config = loadStepupConfig();
        const text = await req(config, { method: 'GET', query: { project_id: config.projectId } }, 'membership_customer_status_by_project');
        return textResult(text);
    });
    server.registerTool('membership_customer_status_by_organization', {
        title: 'Customer status by organization',
        description: 'Returns the active subscription status for the organization in TRANSCODES_TOKEN (oid claim). ' +
            'SkipAuth — GET /v1/membership/customer/status/organization?organization_id=... ' +
            'Preferred when the caller already knows the organization (avoids the project → organization lookup).',
        inputSchema: {},
    }, async () => {
        const config = loadStepupConfig();
        const text = await req(config, { method: 'GET', query: { organization_id: config.organizationId } }, 'membership_customer_status_by_organization');
        return textResult(text);
    });
    server.registerTool('membership_create_checkout_session', {
        title: 'Create checkout session',
        description: 'MCP checkout: POST /v1/membership/mcp/session — creates a Stripe Checkout session for the organization bound to the MAT (x-transcodes-token) and returns a one-time redirect URL. ' +
            'Use for plan upgrade or first purchase (e.g. free → standard). ' +
            'Body: price_id from membership_plans; optional mode: "subscription" (default) | "payment" | "setup". ' +
            'Organization is resolved server-side from the authenticated principal — do not pass organization_id in the body. ' +
            'The returned URL expires after a short window — redirect the user immediately after receiving it.',
        inputSchema: {
            body: z.object({
                price_id: z.string(),
                mode: z.enum(['subscription', 'payment', 'setup']).optional(),
            }),
        },
    }, async ({ body }) => {
        const config = loadStepupConfig();
        const text = await req(config, { method: 'POST', body }, 'membership_create_checkout_session');
        return textResult(text);
    });
}
//# sourceMappingURL=membership.js.map