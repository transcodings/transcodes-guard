#!/usr/bin/env node
import {
  cursorAdapter
} from "../chunk-YZ5XJGSG.js";
import {
  getGateBackend
} from "../chunk-YTHLJ2QR.js";

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
  getGateBackend().rotatePromptSid();
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
