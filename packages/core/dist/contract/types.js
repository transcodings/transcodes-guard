/**
 * Runtime + type-level kind constants for `GateDecision`. Source of truth
 * for the discriminated union below. Mirrored in `../stepup/evaluate.ts`
 * (transitional duplication, same package — the two copies must stay in
 * lockstep; the `gate-backend` drift alarm catches a missed sync).
 */
export const GATE_DECISION_KIND = {
    PROCEED_UNGATED: 'proceed-ungated',
    PROCEED_BY_POLICY: 'proceed-by-policy',
    BLOCK_NO_TOKEN: 'block-no-token',
    BLOCK_BY_POLICY: 'block-by-policy',
    BLOCK_STEPUP_CREATE_FAILED: 'block-stepup-create-failed',
    BLOCK_STEPUP_CHALLENGED: 'block-stepup-challenged',
    BLOCK_STEPUP_REJECTED: 'block-stepup-rejected',
};
//# sourceMappingURL=types.js.map