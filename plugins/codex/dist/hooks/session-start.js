#!/usr/bin/env node
import {
  codexAdapter
} from "../chunk-3G5C2IBD.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-4MPWDLFB.js";

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
