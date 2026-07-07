/**
 * The concrete GateBackend.
 *
 * Binds `core/stepup` + the local `src/mcp-tools/` to the public `GateBackend` interface. The
 * `transcodesGateBackend: GateBackend` annotation makes the TypeScript compiler
 * enforce that the private function signatures structurally match the contract
 * — if a private shape drifts from core/contract's mirrored types, THIS build
 * fails, which is the intended drift alarm.
 *
 * Config-less contract methods (createStepupSession, assertRbacCoordinate, ...)
 * load the StepupConfig here so the config type never escapes to the public
 * side. Error classes are wrapped in `is*Error` predicates for the same reason.
 */
import type { GateBackend } from '@transcodes-guard/core/contract';
export declare const transcodesGateBackend: GateBackend;
