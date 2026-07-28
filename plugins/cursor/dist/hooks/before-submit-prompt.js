#!/usr/bin/env node
import "../chunk-FVBB2UTV.js";

// hooks/before-submit-prompt.ts
import { readFileSync } from "fs";
function emitContinue() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}
try {
  readFileSync(0, "utf8");
} catch {
}
emitContinue();
