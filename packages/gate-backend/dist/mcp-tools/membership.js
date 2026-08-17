import { loadStepupConfig } from '@transcodes-guard/core/stepup';
import { z } from 'zod';
import { defineBackendTool, textResult } from './define.js';
import { req } from './transcodes-client.js';
export const membershipToolDefinitions = [
    defineBackendTool({
        name: 'tc_membership_plans',
        title: 'Membership plans',
        description: 'Returns the full list of available Transcodes membership plans (free, standard, business, enterprise) including price, currency, billing interval, and Stripe product metadata. ' +
            'This is a public endpoint — no authentication required. ' +
            'Use this tool to display plan options to users or to look up the price_id needed for membership_create_checkout_session.',
        summary: 'List available Transcodes membership plans and Stripe metadata.',
        category: 'Membership',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {},
        handler: async () => {
            const config = loadStepupConfig();
            const text = await req(config, { method: 'GET' }, 'membership_plans');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_membership_plans_limits',
        title: 'Membership plan limits',
        description: 'Returns the resource limits per plan tier. ' +
            'Product features are unlimited on every plan. ' +
            'The first 2 accepted organization members are free. ' +
            'From the 3rd member, billing is per member at price_per_seat (Standard: $9 / member / month; 3 members = $9). ' +
            'A card is required before inviting a teammate. ' +
            'Use this to build pricing comparison UI or explain seat billing.',
        summary: 'Resource limits enforced per plan tier.',
        category: 'Membership',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {},
        handler: async () => {
            const config = loadStepupConfig();
            const text = await req(config, { method: 'GET' }, 'membership_plans_limits');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_membership_customer_status_by_project',
        title: 'Customer status by project',
        description: 'Returns the active subscription status of the organization that owns the project in TRANSCODES_TOKEN (pid claim). ' +
            'SkipAuth — GET /v1/membership/customer/status/project?project_id=... ' +
            'Useful when the SDK Toolkit only carries a project context.',
        summary: 'Subscription status for the organization owning the token project.',
        category: 'Membership',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {},
        handler: async () => {
            const config = loadStepupConfig();
            const text = await req(config, { method: 'GET', query: { project_id: config.projectId } }, 'membership_customer_status_by_project');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_membership_customer_status_by_organization',
        title: 'Customer status by organization',
        description: 'Returns the active subscription status for the organization in TRANSCODES_TOKEN (oid claim). ' +
            'SkipAuth — GET /v1/membership/customer/status/organization?organization_id=... ' +
            'Preferred when the caller already knows the organization (avoids the project → organization lookup).',
        summary: 'Subscription status for the token organization.',
        category: 'Membership',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {},
        handler: async () => {
            const config = loadStepupConfig();
            const text = await req(config, { method: 'GET', query: { organization_id: config.organizationId } }, 'membership_customer_status_by_organization');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_membership_create_checkout_session',
        title: 'Create checkout session',
        description: 'MCP checkout: POST /v1/membership/mcp/session — creates a Stripe Checkout session for the organization bound to the MAT (x-transcodes-token) and returns a one-time redirect URL. ' +
            'Use for plan upgrade or first purchase (e.g. free → standard). ' +
            'Body: price_id from membership_plans; optional mode: "subscription" (default) | "payment" | "setup". ' +
            'Organization is resolved server-side from the authenticated principal — do not pass organization_id in the body. ' +
            'The returned URL expires after a short window — redirect the user immediately after receiving it.',
        summary: 'Create a Stripe Checkout session for plan upgrade or purchase.',
        category: 'Membership',
        access: 'api',
        mutating: true,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            body: z.object({
                price_id: z.string(),
                mode: z.enum(['subscription', 'payment', 'setup']).optional(),
            }),
        },
        handler: async ({ body }) => {
            const config = loadStepupConfig();
            const text = await req(config, { method: 'POST', body }, 'membership_create_checkout_session');
            return textResult(text);
        },
    }),
];
//# sourceMappingURL=membership.js.map