#!/usr/bin/env node
import {
  capturePrompt,
  claudeCodeAdapter
} from "../chunk-RJNHUWZW.js";

// hooks/user-prompt-submit.ts
import { readFileSync } from "fs";
try {
  const input = claudeCodeAdapter.parseUserPromptSubmitStdin(
    readFileSync(0, "utf8")
  );
  capturePrompt({
    host: "claude",
    sessionId: input.sessionId,
    promptId: input.promptId,
    prompt: input.prompt
  });
} catch {
}
process.exit(0);
