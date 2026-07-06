/**
 * Public DI contract for the transcodes-guard step-up gate.
 *
 * Consumed by mcp-server-core and every plugin hook so the public side builds
 * without importing `@transcodes-guard/*`. The real backend is injected
 * at runtime via setGateBackend().
 */
export type { GateBackend } from './backend.js';
export * from './messages.js';
export {
  getGateBackend,
  isGateBackendInstalled,
  setGateBackend,
} from './registry.js';
export * from './types.js';
