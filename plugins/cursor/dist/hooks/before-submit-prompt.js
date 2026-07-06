#!/usr/bin/env node
import {
  cursorAdapter
} from "../chunk-HBUNYIXG.js";
import {
  getGateBackend
} from "../chunk-PBSP22UQ.js";

// hooks/before-submit-prompt.ts
import { readFileSync } from "fs";
function emitContinue() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}
function main() {
  const raw = readFileSync(0, "utf8");
  try {
    cursorAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    emitContinue();
  }
  getGateBackend().sweepLatches();
  getGateBackend().rotatePromptGroup();
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
