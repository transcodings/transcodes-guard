#!/usr/bin/env node
import {
  claudeCodeAdapter
} from "../chunk-7X2GUVN6.js";
import {
  formatNoTokenSessionNotice,
  formatStepupProtocolPrimer,
  getGateBackend
} from "../chunk-BHC2EHBQ.js";

// src/version.ts
var PLUGIN_VERSION = "0.39.0";

// hooks/session-start.ts
var PROTOCOL_PRIMER = formatStepupProtocolPrimer();
async function main() {
  process.stderr.write(`[transcodes-guard] v${PLUGIN_VERSION}
`);
  const backend = getGateBackend();
  backend.sweepLatches();
  backend.rotatePromptSid();
  const tokenNotice = backend.hasToken() ? null : formatNoTokenSessionNotice();
  const versionLine = `transcodes-guard v${PLUGIN_VERSION}`;
  const additionalContext = [versionLine, PROTOCOL_PRIMER, tokenNotice].filter((s) => Boolean(s)).join("\n");
  process.stdout.write(
    claudeCodeAdapter.emitSessionStartContext(additionalContext)
  );
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}
`);
  process.exit(0);
});
