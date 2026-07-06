#!/usr/bin/env node
import {
  codexAdapter
} from "../chunk-DRZMA5IG.js";
import {
  getGateBackend
} from "../chunk-LDK3QK7Q.js";

// hooks/user-prompt-submit.ts
import { readFileSync } from "fs";
function main() {
  const raw = readFileSync(0, "utf8");
  try {
    codexAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    process.exit(0);
  }
  const backend = getGateBackend();
  backend.sweepLatches();
  backend.rotatePromptSid();
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
