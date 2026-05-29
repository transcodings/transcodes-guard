import axios from 'axios';
import type { ProxyTool } from './tool-utils.ts';

const INSTRUCTIONS_URL = 'https://transcodes.io/instructions';

/** Fetches the official Transcodes integration guide (llms.txt). */
export const instructionsTools: ProxyTool[] = [
  {
    name: 'get_integration_guide',
    description:
      'IMPORTANT: You MUST call this tool BEFORE writing ANY Transcodes-related code. ' +
      'Fetches the official Transcodes integration guide (llms.txt) — the single source of truth for all implementation details. ' +
      'Trigger keywords: install, setup, integrate, SDK, PWA, passkey, auth, login, signup, modal, ' +
      'step-up, MFA, JWT, token, audit, webhook, RBAC, role, service worker, manifest, CDN, webworker, ' +
      'sign-in, sign-out, session, member, console, admin, IDP, OTP, TOTP, biometric, WebAuthn. ' +
      'The returned guide contains exact API signatures, code examples, framework setup (React, Next.js, Vue, Vite), ' +
      'CSP rules, JWT verification, and common mistakes. You MUST follow it instead of guessing. ' +
      'Call once per conversation — the result stays in context for follow-up requests.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description:
            'Optional topic filter: "pwa", "passkey", "auth", "sdk-init", "step-up", "jwt", "csp", "events", "audit", etc.',
        },
      },
    },
    handler: async (a) => {
      const response = await axios.get(INSTRUCTIONS_URL, {
        headers: { Accept: 'text/plain' },
        timeout: 15_000,
      });
      const content = String(response.data);
      const topic = typeof a.topic === 'string' ? a.topic.trim() : undefined;

      if (topic) {
        return JSON.stringify({ topic, instructions: content }, null, 2);
      }
      return content;
    },
  },
];
