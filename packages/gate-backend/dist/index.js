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
import { findFirstToolRule, ToolRuleValidationError, } from '@transcodes-guard/danger-patterns';
import { addToolRule, clearPending, consumeVerified, createStepupSession, evaluatePreToolUse, findPendingBySid, firstActivePending, firstInFlightFpPending, inspectStepupState, isExpired, loadEffectivePatterns, loadEffectiveToolRules, loadStepupConfig, markVerified, pollStepupSession, pollStepupSessionWait, readPending, readVerified, refreshPolicyBundleIfConfigured, removeToolRule, resolveToken, sendGateDecisionAudit, sweepStepup, updateToolRule, writePending, writeVerified, } from '@transcodes-guard/stepup-core';
import { assertRbacCoordinate, RbacCoordinateError, registerAuditTools, registerAuthDeviceTools, registerJwkTools, registerMembershipTools, registerMemberTools, registerMetaTools, registerOrganizationTools, registerPasscodeTools, registerProjectTools, registerRbacTools, } from '@transcodes-guard/transcodes-mcp-tools';
export const transcodesGateBackend = {
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
    // SessionStart / MCP startup and the `refresh_rules` tool are explicit
    // refresh points: bypass the TTL so a just-edited dashboard/CLI rule is
    // reflected immediately, not up to POLICY_BUNDLE_TTL_MS later. The same
    // force-refresh primitive the `transcodes policy refresh` CLI uses. The
    // PreToolUse hot path never calls this (cache-only — design invariant 2),
    // so the TTL still applies there. Returns the outcome for the tool to report.
    refreshPolicyBundle: () => refreshPolicyBundleIfConfigured({ force: true }),
    // server path: step-up session — config loaded internally
    createStepupSession: (args) => createStepupSession(loadStepupConfig(), args),
    pollStepupSession: (sid) => pollStepupSession(loadStepupConfig(), sid),
    pollStepupSessionWait: (sid, options) => pollStepupSessionWait(loadStepupConfig(), sid, options),
    inspectStepupState,
    findPendingBySid,
    writeVerified,
    markVerified,
    // server path: RBAC coordinate — config loaded internally, error wrapped
    assertRbacCoordinate: (resource, action) => assertRbacCoordinate(loadStepupConfig(), resource, action),
    isRbacCoordinateError: (e) => e instanceof RbacCoordinateError,
    // server path: tool-rule registry — the effective set includes the cached
    // org policy bundle layer (G3): baseline → bundle → user.
    loadMergedToolRules: loadEffectiveToolRules,
    loadEffectivePatterns,
    findFirstToolRule,
    addToolRule,
    updateToolRule,
    removeToolRule,
    isToolRuleValidationError: (e) => e instanceof ToolRuleValidationError,
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
//# sourceMappingURL=index.js.map