#!/usr/bin/env node
import "../chunk-HTJCUYZU.js";

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
