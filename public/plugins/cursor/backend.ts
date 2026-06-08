/**
 * Gate backend bootstrap — phase 1 (bundled).
 *
 * Imported right after host.js by every hook + transport entry. Registers the
 * concrete backend so getGateBackend() (in mcp-server-core + the hooks)
 * resolves to the real implementation. tsup's noExternal inlines the private
 * adapter into each entry bundle.
 *
 * Phase 2 (CDN): replace the static import below with the loader that fetches
 * the obfuscated backend bundle from CloudFront, verifies it, and calls
 * setGateBackend — the getGateBackend() call sites do not change.
 */
import { setGateBackend } from '@transcodes-guard/gate-contract';
import { transcodesGateBackend } from '@transcodes-guard-private/gate-backend';

setGateBackend(transcodesGateBackend);
