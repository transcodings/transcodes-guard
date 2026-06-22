#!/usr/bin/env node
import {
  COMPLETION_PATTERN,
  cursorAdapter
} from "../chunk-QEUV275V.js";
import {
  getGateBackend
} from "../chunk-NYDRDHZV.js";

// hooks/before-submit-prompt.ts
import { readFileSync } from "fs";
function emitContinue() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}
function main() {
  const raw = readFileSync(0, "utf8");
  let parsed;
  try {
    parsed = cursorAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    emitContinue();
  }
  if (!parsed.prompt) emitContinue();
  if (!COMPLETION_PATTERN.test(parsed.prompt)) emitContinue();
  const backend = getGateBackend();
  const pending = backend.firstActivePending();
  if (!pending) emitContinue();
  if (backend.readVerified(pending.fp)) {
    backend.consumeVerified(pending.fp);
    backend.clearPending(pending.fp);
  }
  emitContinue();
}
try {
  main();
} catch (err) {
  process.stderr.write(
    `transcodes-guard before-submit-prompt hook error: ${err}
`
  );
  emitContinue();
}
