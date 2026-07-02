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

import type { GateBackend } from '@transcodes-guard/gate-contract';
import {
  clearPending,
  clearPromptSession,
  consumeVerified,
  createStepupSession,
  evaluatePreToolUse,
  findPendingBySid,
  firstActivePending,
  firstInFlightFpPending,
  inspectStepupState,
  isExpired,
  loadStepupConfig,
  markVerified,
  pollStepupSession,
  pollStepupSessionWait,
  readPending,
  readVerified,
  resolveToken,
  rotatePromptSession,
  sendGateDecisionAudit,
  sweepStepup,
  writePending,
  writeVerified,
} from '@transcodes-guard/stepup-core';
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
} from '@transcodes-guard/transcodes-mcp-tools';

export const transcodesGateBackend: GateBackend = {
  // hook path — direct bindings
  evaluatePreToolUse,
  writePending,
  consumeVerified,
  clearPending,
  firstActivePending,
  firstInFlightFpPending,
  readPending,
  readVerified,
  isExpired,
  sweepStepup,
  hasToken: () => Boolean(resolveToken().token),
  rotatePromptSession,
  clearPromptSession,
  sendGateDecisionAudit,

  // server path: step-up session — config loaded internally
  createStepupSession: (args) => createStepupSession(loadStepupConfig(), args),
  pollStepupSession: (sid) => pollStepupSession(loadStepupConfig(), sid),
  pollStepupSessionWait: (sid, options) =>
    pollStepupSessionWait(loadStepupConfig(), sid, options),
  inspectStepupState,
  findPendingBySid,
  writeVerified,
  markVerified,

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
