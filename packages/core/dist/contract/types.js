/**
 * Shared wire types for the step-up gate DI boundary.
 *
 * contract is a RE-EXPORT surface: the wire types are owned by the domains
 * (`../stepup/`, `../patterns/`) and re-exported here, so consumers keep the
 * stable `@transcodes-guard/core/contract` import spec while sharing the
 * domains' single declarations — including the RUNTIME `GATE_DECISION_KIND`
 * object, so hook `switch`es and `evaluate.ts` branch on the same constant.
 *
 * The hand-mirrored declarations (and the gate-backend "drift alarm" framing)
 * were retired once the #175 consolidation put source and mirror in the same
 * package; the `transcodesGateBackend: GateBackend` annotation in
 * `gate-backend/src/index.ts` remains as an ordinary implements-the-contract
 * type check. Only contract-only types (no domain original) are declared
 * directly in this file.
 */
export { GATE_DECISION_KIND, } from '../stepup/index.js';
//# sourceMappingURL=types.js.map