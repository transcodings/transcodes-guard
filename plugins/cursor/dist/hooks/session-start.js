#!/usr/bin/env node
import {
  cursorAdapter
} from "../chunk-P2JI7X56.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-QZGRZKG2.js";

// hooks/session-start.ts
async function main() {
  const backend = getGateBackend();
  const tokenNotice = backend.hasToken() ? null : formatNoTokenSessionNotice();
  if (tokenNotice) {
    process.stdout.write(cursorAdapter.emitSessionStartContext(tokenNotice));
  }
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}
`);
  process.exit(0);
});
