/**
 * Gate backend bootstrap.
 *
 * Imported right after host.js by the transport entry. Registers the concrete
 * backend so getGateBackend() (in mcp-server-core) resolves to the real
 * implementation instead of denyByDefaultBackend. tsup's noExternal inlines
 * the private adapter into the published bundle, so the npm package is fully
 * self-contained (no node_modules at runtime).
 */

import { setGateBackend } from '@transcodes-guard/core/contract';
import { transcodesGateBackend } from '@transcodes-guard/gate-backend';

setGateBackend(transcodesGateBackend);
