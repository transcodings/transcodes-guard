/**
 * Deny-by-default backend used when no real backend has been injected.
 *
 * Purpose: let the public side (mcp-server-core + hooks) type-check and build
 * standalone — with the private packages absent — by giving `getGateBackend()`
 * a non-null fallback. This is NOT a shipped artifact: every real plugin/CLI
 * bundle calls `setGateBackend(transcodesGateBackend)` at bootstrap, so this
 * stub is only ever reached in a public-only build that is never distributed.
 *
 * Behaviour:
 *  - hook `evaluatePreToolUse` returns `pass`: without the private classifier we
 *    cannot identify danger, and this build is not shipped, so failing open is
 *    acceptable here. The real fail-safe (deny on classifier/backend error)
 *    lives inside the injected backend's evaluate.
 *  - server call-shaped methods throw, so a public-only server that somehow ran
 *    would surface "backend not installed" rather than silently misbehave.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GateBackend } from './backend.js';

const NOT_INSTALLED = 'transcodes-guard: gate backend not installed';

function notInstalled(): never {
  throw new Error(NOT_INSTALLED);
}

export const denyByDefaultBackend: GateBackend = {
  // hook path — inert no-ops / empty reads
  async evaluatePreToolUse() {
    return { kind: 'pass' };
  },
  writePending() {},
  consumeVerified() {},
  clearPending() {},
  firstActivePending() {
    return null;
  },
  firstInFlightFpPending() {
    return null;
  },
  readPending() {
    return null;
  },
  readVerified() {
    return null;
  },
  isExpired() {
    return true;
  },
  sweepStepup() {},
  hasToken() {
    return false;
  },

  // server path — call-shaped methods throw
  createStepupSession() {
    return notInstalled();
  },
  pollStepupSession() {
    return notInstalled();
  },
  pollStepupSessionWait() {
    return notInstalled();
  },
  inspectStepupState() {
    return notInstalled();
  },
  findPendingBySid() {
    return null;
  },
  writeVerified() {},
  markVerified() {},
  assertRbacCoordinate() {
    return notInstalled();
  },
  isRbacCoordinateError(_e: unknown): _e is Error {
    return false;
  },
  loadMergedToolRules() {
    return [];
  },
  findFirstToolRule() {
    return null;
  },
  addUserToolRule() {
    return notInstalled();
  },
  updateUserToolRule() {
    return notInstalled();
  },
  removeUserToolRule() {
    return notInstalled();
  },
  getUserToolRulesPath() {
    return '';
  },
  isToolRuleValidationError(_e: unknown): _e is Error {
    return false;
  },
  // no-op: a public-only server simply registers no backend tools.
  registerBackendTools(_server: McpServer) {},
};
