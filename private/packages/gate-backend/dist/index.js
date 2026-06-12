import { findFirstToolRule, ToolRuleValidationError, } from '@transcodes-guard-private/danger-rules';
import { addToolRule, clearPending, consumeVerified, createStepupSession, evaluatePreToolUse, findPendingBySid, firstActivePending, firstInFlightFpPending, inspectStepupState, isExpired, loadEffectiveToolRules, loadStepupConfig, markVerified, pollStepupSession, pollStepupSessionWait, readPending, readVerified, refreshPolicyBundleIfConfigured, removeToolRule, resolveToken, sendGateDecisionAudit, sweepStepup, updateToolRule, writePending, writeVerified, } from '@transcodes-guard-private/stepup-core';
import { assertRbacCoordinate, RbacCoordinateError, registerAuditTools, registerAuthDeviceTools, registerJwkTools, registerMembershipTools, registerMemberTools, registerMetaTools, registerOrganizationTools, registerPasscodeTools, registerProjectTools, registerRbacTools, } from '@transcodes-guard-private/transcodes-mcp-tools';
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
    refreshPolicyBundle: async () => {
        await refreshPolicyBundleIfConfigured();
    },
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