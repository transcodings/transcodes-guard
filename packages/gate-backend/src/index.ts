/**
 * The concrete GateBackend.
 *
 * Binds `core/stepup` + the local `src/mcp-tools/` to the public `GateBackend` interface. The
 * `transcodesGateBackend: GateBackend` annotation is an ordinary
 * implements-the-contract type check: if a function signature here drifts from
 * the interface, THIS build fails. (It used to double as the "mirrored
 * contract" drift alarm; the hand-mirrored types were retired after the #175
 * consolidation — contract re-exports the domain declarations directly.)
 *
 * Config-less contract methods (createStepupSession, assertRbacCoordinate, ...)
 * load the StepupConfig here so the config type never escapes to the public
 * side. Error classes are wrapped in `is*Error` predicates for the same reason.
 */

import type { GateBackend } from '@transcodes-guard/core/contract';
import {
  createStepupSession,
  evaluatePreToolUse,
  inspectStepupState,
  loadStepupConfig,
  markStepupVerified,
  pollStepupByCoordinate,
  pollStepupSession,
  pollStepupSessionWait,
  resolveToken,
  sendGateDecisionAudit,
} from '@transcodes-guard/core/stepup';
import {
  assertRbacCoordinate,
  RbacCoordinateError,
  registerAuditTools,
  registerAuthDeviceTools,
  registerJwkTools,
  registerMembershipTools,
  registerMemberTools,
  registerMetaTools,
  registerOrganizationTools,
  registerPasscodeTools,
  registerProjectTools,
  registerRbacTools,
} from './mcp-tools/index.js';

export const transcodesGateBackend: GateBackend = {
  // hook path — direct bindings
  evaluatePreToolUse,
  rotatePromptGroup: () => {
    // Prompt grouping removed — backend coordinate key is the reuse SSOT.
  },
  sweepLatches: () => {
    // Local latch removed — no-op for older Stop/prompt hooks.
  },
  hasToken: () => Boolean(resolveToken().token),
  sendGateDecisionAudit,

  // server path: step-up session — config loaded internally
  createStepupSession: (args) => createStepupSession(loadStepupConfig(), args),
  pollStepupSession: (sid) => pollStepupSession(loadStepupConfig(), sid),
  pollStepupByCoordinate: (coordinate) =>
    pollStepupByCoordinate(loadStepupConfig(), coordinate),
  pollStepupSessionWait: (target, options) =>
    pollStepupSessionWait(loadStepupConfig(), target, options),
  inspectStepupState,
  markStepupVerified,
  clearLatchBySid: () => {},

  // server path: RBAC coordinate — config loaded internally, error wrapped
  assertRbacCoordinate: (resource, action) =>
    assertRbacCoordinate(loadStepupConfig(), resource, action),
  isRbacCoordinateError: (e): e is Error => e instanceof RbacCoordinateError,

  // server path: backend-coupled MCP tools
  registerBackendTools: (server) => {
    registerMemberTools(server);
    registerRbacTools(server);
    registerPasscodeTools(server);
    registerProjectTools(server);
    registerAuditTools(server);
    registerAuthDeviceTools(server);
    registerMembershipTools(server);
    registerMetaTools(server);
    registerOrganizationTools(server);
    registerJwkTools(server);
  },
};
