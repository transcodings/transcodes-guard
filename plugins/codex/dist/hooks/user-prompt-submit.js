#!/usr/bin/env node
import {
  capturePrompt,
  codexAdapter
} from "../chunk-TJRHK5GF.js";

// hooks/user-prompt-submit.ts
import { readFileSync } from "fs";
try {
  const input = codexAdapter.parseUserPromptSubmitStdin(
    readFileSync(0, "utf8")
  );
  capturePrompt({
    host: "codex",
    sessionId: input.sessionId,
    promptId: input.promptId,
    prompt: input.prompt
  });
} catch {
}
process.exit(0);
