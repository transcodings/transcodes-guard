#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — bridge user → agent for step-up.
 *
 * When the user types something like "완료", "done", or "auth passed" while
 * a pending step-up session is in flight, this hook injects a context block
 * naming the sid + next action so the agent knows which session to poll.
 */
import "../host.js";
import { readFileSync } from "node:fs";
import { claudeCodeAdapter } from "@transcodes-guard/hook-adapters";
import {
  isExpired,
  readPending,
  type PendingState,
} from "@transcodes-guard/stepup-core";

// Loose matcher — false positives only matter when a pending record exists,
// in which case the worst case is one unnecessary poll call.
const COMPLETION_PATTERN =
  /완료|성공|끝났|마쳤|됐어|통과|done|finished|verified|authenticated|authori[sz]ed|complete|passed|success/i;

function buildContext(prompt: string, pending: PendingState): string | null {
  if (!COMPLETION_PATTERN.test(prompt)) return null;
  const statusNote =
    pending.status === "verified"
      ? "already verified — just retry the original command."
      : "still pending — call poll_stepup_session_wait now to block until verified.";
  return [
    "transcodes-guard: user appears to report step-up MFA completion.",
    "",
    `Pending session sid : ${pending.sid}`,
    `Status              : ${pending.status} (${statusNote})`,
    `Original command    : ${pending.command}`,
    "",
    "Next action:",
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original Bash command above.',
  ].join("\n");
}

function main(): void {
  const raw = readFileSync(0, "utf8");

  let parsed;
  try {
    parsed = claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    process.exit(0);
  }

  if (!parsed.prompt) process.exit(0);

  const pending = readPending();
  if (!pending || isExpired(pending)) process.exit(0);

  const additionalContext = buildContext(parsed.prompt, pending);
  if (!additionalContext) process.exit(0);

  process.stdout.write(
    claudeCodeAdapter.emitUserPromptSubmitContext(additionalContext),
  );
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(
    `transcodes-guard user-prompt-submit hook error: ${err}\n`,
  );
  process.exit(0);
}
