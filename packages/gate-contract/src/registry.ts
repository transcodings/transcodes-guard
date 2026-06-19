/**
 * Process-global GateBackend registry.
 *
 * The single seam between public and private. At plugin bootstrap, each
 * plugin's `backend.ts` calls `setGateBackend(transcodesGateBackend)` before
 * any hook or transport entry runs its logic. Every public consumer
 * (mcp-server-core, hooks) reads via `getGateBackend()`.
 */
import type { GateBackend } from './backend.js';
import { denyByDefaultBackend } from './noop.js';

let current: GateBackend | null = null;

export function setGateBackend(backend: GateBackend): void {
  current = backend;
}

export function getGateBackend(): GateBackend {
  return current ?? denyByDefaultBackend;
}

export function isGateBackendInstalled(): boolean {
  return current !== null;
}
