/**
 * Process-global GateBackend registry.
 *
 * The single seam between public and private. At plugin bootstrap, each
 * plugin's `backend.ts` calls `setGateBackend(transcodesGateBackend)` before
 * any hook or transport entry runs its logic. Every public consumer
 * (mcp-server-core, hooks) reads via `getGateBackend()`.
 */
import type { GateBackend } from './backend.js';
export declare function setGateBackend(backend: GateBackend): void;
export declare function getGateBackend(): GateBackend;
export declare function isGateBackendInstalled(): boolean;
