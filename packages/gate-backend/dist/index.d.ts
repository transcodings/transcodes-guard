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
import type { GateBackend } from '@transcodes-guard/core/contract';
export declare const transcodesGateBackend: GateBackend;
