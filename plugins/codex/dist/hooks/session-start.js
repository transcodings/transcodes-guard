#!/usr/bin/env node
import {
  codexAdapter
} from "../chunk-DABWMHTT.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-F63K2CSZ.js";

// hooks/session-start.ts
async function main() {
  const backend = getGateBackend();
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
