#!/usr/bin/env node
import {
  capturePrompt,
  cursorAdapter
} from "../chunk-DOJRXXHP.js";

// hooks/before-submit-prompt.ts
import { readFileSync } from "fs";
function emitContinue() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}
try {
  const input = cursorAdapter.parseUserPromptSubmitStdin(
    readFileSync(0, "utf8")
  );
  capturePrompt({
    host: "cursor",
    sessionId: input.sessionId,
    promptId: input.promptId,
    prompt: input.prompt
  });
} catch {
}
emitContinue();
