/**
 * Gate backend bootstrap.
 *
 * Imported right after host.js by every hook + transport entry. Registers the
 * concrete backend so getGateBackend() (in mcp-server-core + the hooks)
 * resolves to the real implementation. tsup's noExternal inlines the private
 * adapter into each entry bundle.
 */

import { transcodesGateBackend } from '@transcodes-guard/gate-backend';
import { setGateBackend } from '@transcodes-guard/gate-contract';

setGateBackend(transcodesGateBackend);
