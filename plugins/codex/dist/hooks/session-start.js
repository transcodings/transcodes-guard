#!/usr/bin/env node
import {
  codexAdapter
} from "../chunk-DABWMHTT.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-XVZRJDV6.js";

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
