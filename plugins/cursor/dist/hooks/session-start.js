#!/usr/bin/env node
import {
  cursorAdapter
} from "../chunk-YZ5XJGSG.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-7BO7MLBP.js";

// hooks/session-start.ts
async function main() {
  const backend = getGateBackend();
  backend.rotatePromptSid();
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
