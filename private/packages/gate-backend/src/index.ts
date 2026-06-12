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
  addUserToolRule,
  findFirstToolRule,
  getUserToolRulesPath,
  removeUserToolRule,
  ToolRuleValidationError,
  updateUserToolRule,
} from '@transcodes-guard-private/danger-rules';
import {
  clearPending,
  consumeVerified,
  createStepupSession,
  evaluatePreToolUse,
  findPendingBySid,
  firstActivePending,
  firstInFlightFpPending,
  inspectStepupState,
  isExpired,
  loadEffectiveToolRules,
  loadStepupConfig,
  markVerified,
  pollStepupSession,
  pollStepupSessionWait,
  readPending,
  readVerified,
  refreshPolicyBundleIfConfigured,
  resolveToken,
  sendGateDecisionAudit,
  sweepStepup,
  writePending,
  writeVerified,
} from '@transcodes-guard-private/stepup-core';
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
} from '@transcodes-guard-private/transcodes-mcp-tools';

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
  sendGateDecisionAudit,
  refreshPolicyBundle: async () => {
    await refreshPolicyBundleIfConfigured();
  },

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

  // server path: tool-rule registry — the effective set includes the cached
  // org policy bundle layer (G3): baseline → bundle → user.
  loadMergedToolRules: loadEffectiveToolRules,
  findFirstToolRule,
  addUserToolRule,
  updateUserToolRule,
  removeUserToolRule,
  getUserToolRulesPath,
  isToolRuleValidationError: (e): e is Error =>
    e instanceof ToolRuleValidationError,

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
