#!/usr/bin/env node
import {
  codexAdapter,
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-TRF7QBKZ.js";

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
