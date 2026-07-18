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

import {
  type GateBackend,
  registerToolDefinitions,
} from '@transcodes-guard/core/contract';
import {
  createStepupSession,
  evaluatePreToolUse,
  inspectStepupState,
  loadStepupConfig,
  pollStepupByCoordinate,
  pollStepupSession,
  pollStepupSessionWait,
  resolveToken,
} from '@transcodes-guard/core/stepup';
import {
  assertRbacCoordinate,
  backendToolDefinitions,
  RbacCoordinateError,
  wrapProtectedTool,
} from './mcp-tools/index.js';

export const transcodesGateBackend: GateBackend = {
  // hook path — direct bindings
  evaluatePreToolUse,
  hasToken: () => Boolean(resolveToken().token),

  // server path: step-up session — config loaded internally
  createStepupSession: (args) => createStepupSession(loadStepupConfig(), args),
  pollStepupSession: (sid) => pollStepupSession(loadStepupConfig(), sid),
  pollStepupByCoordinate: (coordinate) =>
    pollStepupByCoordinate(loadStepupConfig(), coordinate),
  pollStepupSessionWait: (target, options) =>
    pollStepupSessionWait(loadStepupConfig(), target, options),
  inspectStepupState,

  // server path: RBAC coordinate — config loaded internally, error wrapped
  assertRbacCoordinate: (resource, action) =>
    assertRbacCoordinate(loadStepupConfig(), resource, action),
  isRbacCoordinateError: (e): e is Error => e instanceof RbacCoordinateError,

  // server path: backend-coupled MCP tools — one generic loop over the
  // definition data; stepUp-declaring definitions are wrapped in the
  // 403 → STEP_UP_REQUIRED translation by wrapProtectedTool.
  registerBackendTools: (server) =>
    registerToolDefinitions(server, backendToolDefinitions, wrapProtectedTool),
};
