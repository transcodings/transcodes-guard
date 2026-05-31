#!/usr/bin/env node
import {
  cursorAdapter
} from "../chunk-J6QNXIGR.js";
import {
  clearPending,
  consumeVerified,
  isExpired,
  readPending,
  readVerified
} from "../chunk-2IJSD757.js";

// hooks/before-submit-prompt.ts
import { readFileSync } from "fs";
var COMPLETION_PATTERN = /완료|성공|끝났|마쳤|됐어|통과|done|finished|verified|authenticated|authori[sz]ed|complete|passed|success/i;
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
  const pending = readPending();
  if (!pending || isExpired(pending)) emitContinue();
  if (readVerified()) {
    consumeVerified();
    clearPending();
  }
  emitContinue();
}
try {
  main();
} catch (err) {
  process.stderr.write(
    `ai-action-tracker before-submit-prompt hook error: ${err}
`
  );
  emitContinue();
}
