const NOT_INSTALLED = 'transcodes-guard: gate backend not installed';
function notInstalled() {
    throw new Error(NOT_INSTALLED);
}
export const denyByDefaultBackend = {
    // hook path — inert no-ops / empty reads
    async evaluatePreToolUse() {
        return { kind: 'pass' };
    },
    writePending() { },
    consumeVerified() { },
    clearPending() { },
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
    sweepStepup() { },
    hasToken() {
        return false;
    },
    async sendGateDecisionAudit() { },
    async refreshPolicyBundle() {
        return 'skipped';
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
    writeVerified() { },
    markVerified() { },
    assertRbacCoordinate() {
        return notInstalled();
    },
    isRbacCoordinateError(_e) {
        return false;
    },
    loadMergedToolRules() {
        return [];
    },
    loadEffectivePatterns() {
        return [];
    },
    findFirstToolRule() {
        return null;
    },
    addToolRule() {
        return notInstalled();
    },
    updateToolRule() {
        return notInstalled();
    },
    removeToolRule() {
        return notInstalled();
    },
    isToolRuleValidationError(_e) {
        return false;
    },
    // no-op: a public-only server simply registers no backend tools.
    registerBackendTools(_server) { },
};
//# sourceMappingURL=noop.js.map