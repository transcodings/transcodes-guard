/**
 * Meta / identity MCP tools — ported from transcodes-mcp-server's
 * `src/tools/proxy.ts` (the non-tunnel subset) and `instructions.ts`.
 *
 * Local tools (`get_current_*_id`) read claims off the parsed token with no
 * backend call. `get_my_profile` and `get_console_url` proxy a single read.
 * `get_integration_guide` fetches the public llms.txt guide via builtin
 * fetch (no axios dependency). Tunnel tools are intentionally omitted —
 * plugins ship their own HTTP transport entry (`src/http.ts`).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  loadStepupConfig,
  openConsoleSession,
} from '@transcodes-guard/stepup-core';
import { z } from 'zod';
import { req } from './transcodes-client.js';

const INSTRUCTIONS_URL = 'https://transcodes.io/instructions';

const textResult = (text: string, isError = false) => ({
  isError,
  content: [{ type: 'text' as const, text }],
});

export function registerMetaTools(server: McpServer): void {
  server.registerTool(
    'get_current_project_id',
    {
      title: 'Get current project id',
      description:
        'Returns the active project ID parsed from TRANSCODES_TOKEN. ' +
        'Call this tool first when you need the project ID instead of asking the user.',
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      return textResult(
        JSON.stringify({ ok: true, project_id: config.projectId }, null, 2),
      );
    },
  );

  server.registerTool(
    'get_current_organization_id',
    {
      title: 'Get current organization id',
      description: 'Returns organizationId from TRANSCODES_TOKEN JWT.',
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      return textResult(
        JSON.stringify(
          { ok: true, organization_id: config.organizationId },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    'get_current_member_id',
    {
      title: 'Get current member id',
      description: 'Returns memberId from TRANSCODES_TOKEN JWT.',
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      return textResult(
        JSON.stringify({ ok: true, member_id: config.memberId }, null, 2),
      );
    },
  );

  server.registerTool(
    'get_my_profile',
    {
      title: 'Get my profile',
      description:
        'Returns the profile of the member identified by TRANSCODES_TOKEN (organizationId, projectId, memberId in config). ' +
        'Use when the user asks "who am I", "show my profile", or "show my member info". ' +
        'No arguments needed.',
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        {
          method: 'GET',
          query: { project_id: config.projectId, member_id: config.memberId },
        },
        'get_member',
      );
      return textResult(text);
    },
  );

  server.registerTool(
    'get_console_url',
    {
      title: 'Get console URL',
      description:
        'Mint a step-up-protected console URL. Console access is gated behind step-up MFA ' +
        '(mode=console) so this tool creates a step-up session and returns the browser URL ' +
        'the user must visit to authenticate (WebAuthn) before reaching the console. ' +
        'Use when the user needs to perform browser-only actions: ' +
        'passkey register/update/revoke, authenticator register/update/revoke, ' +
        'TOTP enroll/update/revoke, OTP flows, JWK backup, or subscription portal (cancel, payment method, invoices). ' +
        'Direct the user to visit the returned browser_url and complete the action there.',
      inputSchema: {},
    },
    async () => {
      const result = await openConsoleSession({
        openBrowser: false,
        comment: 'Open the Transcodes console (browser-only action)',
      });
      if (!result.ok) {
        return textResult(
          JSON.stringify(
            {
              ok: false,
              reason: result.reason,
              detail: result.detail,
              message:
                'Could not mint a console step-up session. Check the token and backend connectivity',
            },
            null,
            2,
          ),
          true,
        );
      }
      return textResult(
        JSON.stringify(
          {
            ok: true,
            sid: result.sid,
            browser_url: result.browserUrl,
            expires_at: result.expiresAt,
            message:
              'Console access is protected by step-up MFA. Direct the user to browser_url to authenticate, then complete the browser-only action.',
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    'get_integration_guide',
    {
      title: 'Get integration guide',
      description:
        'IMPORTANT: You MUST call this tool BEFORE writing ANY Transcodes-related code. ' +
        'Fetches the official Transcodes integration guide (llms.txt) — the single source of truth for all implementation details. ' +
        'Trigger keywords: install, setup, integrate, SDK, PWA, passkey, auth, login, signup, redirect, ' +
        'step-up, MFA, JWT, token, audit, webhook, RBAC, role, service worker, manifest, CDN, webworker, ' +
        'sign-in, sign-out, session, member, console, admin, IDP, OTP, TOTP, biometric, WebAuthn. ' +
        'The returned guide contains exact API signatures, code examples, framework setup (React, Next.js, Vue, Vite), ' +
        'CSP rules, JWT verification, and common mistakes. You MUST follow it instead of guessing. ' +
        'Call once per conversation — the result stays in context for follow-up requests.',
      inputSchema: {
        topic: z.string().optional(),
      },
    },
    async ({ topic }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(INSTRUCTIONS_URL, {
          headers: { Accept: 'text/plain' },
          signal: controller.signal,
        });
        const content = await response.text();
        const trimmed = topic?.trim();
        if (trimmed) {
          return textResult(
            JSON.stringify({ topic: trimmed, instructions: content }, null, 2),
          );
        }
        return textResult(content);
      } catch (err) {
        return textResult(
          `Could not fetch the integration guide: ${
            err instanceof Error ? err.message : String(err)
          }`,
          true,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  );
}
