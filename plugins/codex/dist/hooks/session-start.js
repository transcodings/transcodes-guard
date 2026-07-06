#!/usr/bin/env node
import {
  codexAdapter
} from "../chunk-WUTG3JB2.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-4V74R4AU.js";

// hooks/session-start.ts
async function main() {
  const backend = getGateBackend();
  backend.sweepLatches();
  backend.rotatePromptGroup();
  const tokenNotice = backend.hasToken() ? null : formatNoTokenSessionNotice();
  if (tokenNotice) {
    process.stdout.write(codexAdapter.emitSessionStartContext(tokenNotice));
  }
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}
`);
  process.exit(0);
});
