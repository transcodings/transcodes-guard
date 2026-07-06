/**
 * The concrete GateBackend.
 *
 * Binds the three private packages to the public `GateBackend` interface. The
 * `transcodesGateBackend: GateBackend` annotation makes the TypeScript compiler
 * enforce that the private function signatures structurally match the contract
 * — if a private shape drifts from gate-contract's mirrored types, THIS build
 * fails, which is the intended drift alarm.
 *
 * Config-less contract methods (createStepupSession, assertRbacCoordinate, ...)
 * load the StepupConfig here so the config type never escapes to the public
 * side. Error classes are wrapped in `is*Error` predicates for the same reason.
 */

import type { GateBackend } from '@transcodes-guard/core/contract';
import {
  clearLatchBySid,
  createStepupSession,
  evaluatePreToolUse,
  inspectStepupState,
  loadStepupConfig,
  markStepupVerified,
  pollStepupSession,
  pollStepupSessionWait,
  resolveToken,
  rotatePromptGroup,
  sendGateDecisionAudit,
  sweepLatches,
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
    rotatePromptGroup();
  },
  sweepLatches,
  hasToken: () => Boolean(resolveToken().token),
  sendGateDecisionAudit,

  // server path: step-up session — config loaded internally
  createStepupSession: (args) => createStepupSession(loadStepupConfig(), args),
  pollStepupSession: (sid) => pollStepupSession(loadStepupConfig(), sid),
  pollStepupSessionWait: (sid, options) =>
    pollStepupSessionWait(loadStepupConfig(), sid, options),
  inspectStepupState,
  markStepupVerified,
  clearLatchBySid,

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
