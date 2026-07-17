/**
 * Aggregate of every gate-backend tool definition, in registration order
 * (preserves the pre-t5 `registerBackendTools` call sequence).
 *
 * Imported by `registerBackendTools()` for registration and by the codegen
 * pipeline (`scripts/tool-metadata.mts`) for metadata — handlers are never
 * invoked at codegen time.
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
import { auditToolDefinitions } from './audit.js';
import { authDeviceToolDefinitions } from './auth-devices.js';
import { jwkToolDefinitions } from './jwk.js';
import { memberToolDefinitions } from './members.js';
import { membershipToolDefinitions } from './membership.js';
import { metaToolDefinitions } from './meta.js';
import { organizationToolDefinitions } from './organization.js';
import { passcodeToolDefinitions } from './passcode.js';
import { projectToolDefinitions } from './project.js';
import { rbacToolDefinitions } from './rbac.js';

export const backendToolDefinitions: readonly GuardToolDefinition[] = [
  ...memberToolDefinitions,
  ...rbacToolDefinitions,
  ...passcodeToolDefinitions,
  ...projectToolDefinitions,
  ...auditToolDefinitions,
  ...authDeviceToolDefinitions,
  ...membershipToolDefinitions,
  ...metaToolDefinitions,
  ...organizationToolDefinitions,
  ...jwkToolDefinitions,
];
