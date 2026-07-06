#!/usr/bin/env node
import {
  claudeCodeAdapter
} from "../chunk-VGLNVTHM.js";
import {
  getGateBackend
} from "../chunk-T5T6C5RV.js";

// hooks/user-prompt-submit.ts
import { readFileSync } from "fs";
function main() {
  const raw = readFileSync(0, "utf8");
  try {
    claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    process.exit(0);
  }
  const backend = getGateBackend();
  backend.sweepLatches();
  backend.rotatePromptGroup();
  process.exit(0);
}
try {
  main();
} catch (err) {
  process.stderr.write(
    `transcodes-guard user-prompt-submit hook error: ${err}
`
  );
  process.exit(0);
}
