/**
 * Process-global GateBackend registry.
 *
 * The single seam between public and private. At plugin bootstrap, each
 * plugin's `backend.ts` calls `setGateBackend(transcodesGateBackend)` before
 * any hook or transport entry runs its logic. Every public consumer
 * (mcp-server-core, hooks) reads via `getGateBackend()`.
 *
 * Phase 3 (CDN, docs/prd/phase3/): the only thing that changes is *who* calls
 * setGateBackend — the loader fetches the obfuscated backend bundle and
 * injects it. The getGateBackend() call sites do not move.
 */
import type { GateBackend } from './backend.js';
export declare function setGateBackend(backend: GateBackend): void;
export declare function getGateBackend(): GateBackend;
export declare function isGateBackendInstalled(): boolean;
