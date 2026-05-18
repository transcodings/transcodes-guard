#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — danger command interceptor.
 *
 * Two-layer check on Bash tool invocations:
 *
 *   1. Regex patterns (`danger-patterns.json`) — catches absolute paths,
 *      `$HOME`, `dd`, `mkfs`, `curl|bash`, fork bombs, force-pushes, etc.
 *   2. Git semantic check on `rm -rf <target>` — resolves each target
 *      relative to the session `cwd` and blocks if any target contains
 *      files tracked by git, regardless of whether the target was given
 *      as an absolute or a relative path. This catches the relative-path
 *      gap that pure regex misses (e.g. `rm -rf src`).
 *
 * On danger match: agent-driven step-up MFA loop.
 *   a. If the cross-platform store already holds a verified record (a
 *      previous step-up that has not been consumed yet), consume it and
 *      exit 0 — the command runs.
 *   b. Otherwise call `requestStepup`: create a Transcodes step-up
 *      session, auto-launch the browser to the WebAuthn URL, write the
 *      pending state file for the secondary hooks, and emit a v2 hook
 *      response that denies the call with `permissionDecision: "deny"`
 *      plus a `systemMessage` that names the URL + sid and instructs
 *      the agent to poll via the `poll_stepup_session` MCP tool and
 *      retry the same Bash command. The retry hits branch (a) and
 *      falls through.
 *
 * Output channel choice: v2 stdout JSON with `permissionDecision`
 * supersedes the exit 2 + stderr text variant. The structured form
 * gets injected into model context as a first-class signal instead of
 * being parsed out of an "error" stream. exit code stays 0 in both
 * allow and deny paths.
 *
 * Why the hook does not poll: every connected agent (any user, any
 * session) needs visibility into the step-up flow as it happens. A 50 s
 * blocking poll inside the hook leaves the agent unable to relay
 * status to the user. Splitting into "create + handoff" (this hook)
 * and "poll" (MCP tool, agent-driven) makes the flow observable
 * everywhere.
 *
 * Fail policy is asymmetric:
 *  - Before a danger match (JSON parse, pattern load): **fail-open** —
 *    a buggy guard must not brick the workflow.
 *  - After a danger match (step-up create/network): **fail-safe** —
 *    if we cannot prove the user authorised the command, we deny.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  findFirstMatch,
  loadMergedPatterns,
} from "../src/danger-patterns.js";
import { requestStepup, type RequestResult } from "../src/stepup/gate.js";
import { clearPending, writePending } from "../src/stepup/pending.js";
import { consumeVerified, readVerified } from "../src/stepup/store.js";

interface PreToolUsePayload {
  tool_name: string;
  tool_input: { command?: string; [k: string]: unknown };
  cwd?: string;
}

interface BlockResult {
  reason: string;
  details?: string[];
  command: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function checkPatternMatch(command: string): BlockResult | null {
  const hit = findFirstMatch(command, loadMergedPatterns());
  if (!hit) return null;
  const { source, id, reason } = hit.matched;
  return {
    reason: `matched ${source} pattern \`${id}\` — ${reason}`,
    command,
  };
}

/**
 * Extract removal targets from a recursive `rm` invocation.
 *
 * Returns null if the command is not `rm -r…` style. Limitations:
 * does not handle shell quoting, variable expansion, command
 * substitution, or chained commands — treats the command as a
 * whitespace-separated token list.
 */
function extractRmTargets(command: string): string[] | null {
  const tokens = command.trim().split(/\s+/);
  const rmIdx = tokens.indexOf("rm");
  if (rmIdx === -1) return null;

  let i = rmIdx + 1;
  let recursive = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") {
      i++;
      break;
    }
    if (t.startsWith("-") && /^-[a-zA-Z]+$/.test(t)) {
      if (/[rR]/.test(t)) recursive = true;
      i++;
      continue;
    }
    break;
  }
  if (!recursive) return null;

  const targets = tokens.slice(i).filter((t) => !t.startsWith("-"));
  return targets.length > 0 ? targets : null;
}

interface TargetCheck {
  target: string;
  trackedCount: number;
  samples: string[];
}

function checkTargetGitTracked(
  target: string,
  cwd: string,
): TargetCheck | null {
  // Skip targets containing glob metacharacters — the regex layer handles
  // those (e.g. `rm -rf *` matches the `rm-rf-broad` pattern).
  if (/[*?{[]/.test(target)) return null;

  const abs = path.resolve(cwd, target);

  let toplevel: string;
  try {
    toplevel = execFileSync(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }

  const rel = path.relative(toplevel, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

  let tracked: string[];
  try {
    const out = execFileSync(
      "git",
      ["-C", toplevel, "ls-files", "--", rel || "."],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    tracked = out.split("\n").filter(Boolean);
  } catch {
    return null;
  }

  if (tracked.length === 0) return null;
  return {
    target,
    trackedCount: tracked.length,
    samples: tracked.slice(0, 3),
  };
}

function checkRmGitTracked(
  command: string,
  cwd: string,
): BlockResult | null {
  const targets = extractRmTargets(command);
  if (!targets) return null;

  const hits: TargetCheck[] = [];
  for (const target of targets) {
    const check = checkTargetGitTracked(target, cwd);
    if (check) hits.push(check);
  }
  if (hits.length === 0) return null;

  const totalFiles = hits.reduce((a, h) => a + h.trackedCount, 0);
  return {
    reason: `rm -rf would delete ${totalFiles} file(s) tracked in git`,
    details: hits.map((h) => {
      const more =
        h.trackedCount > h.samples.length
          ? `, +${h.trackedCount - h.samples.length} more`
          : "";
      return `${h.target} — ${h.trackedCount} tracked file(s): ${h.samples.join(", ")}${more}`;
    }),
    command,
  };
}

type DenyOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny";
    permissionDecisionReason: string;
  };
  systemMessage: string;
};

function emitDeny(output: DenyOutput, stderrSummary: string): void {
  process.stdout.write(JSON.stringify(output));
  process.stderr.write(`${stderrSummary}\n`);
}

function blockedSummary(result: BlockResult): string {
  return [
    "⛔ BLOCKED — Bash was NOT executed.",
    "",
    `Reason : ${result.reason}`,
    ...(result.details && result.details.length > 0
      ? ["", "Affected:", ...result.details.map((d) => `  - ${d}`)]
      : []),
    `Command: ${result.command}`,
  ].join("\n");
}

function emitNoStepup(result: BlockResult): void {
  const reason =
    `Bash blocked by ai-action-tracker: ${result.reason}. ` +
    "Step-up MFA gate is not configured (TRANSCODES_TOKEN missing). " +
    "Tell the user to set TRANSCODES_TOKEN to enable on-demand authentication, " +
    "or run the command outside Claude Code.";
  emitDeny(
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
      systemMessage:
        `${blockedSummary(result)}\n\n` +
        "Step-up MFA gate is not configured (TRANSCODES_TOKEN missing). " +
        "Ask the user to set the token, then retry.",
    },
    `ai-action-tracker: BLOCKED (no token) — ${result.command}`,
  );
}

function emitStepupFailure(
  result: BlockResult,
  failure: Extract<RequestResult, { ok: false }>,
): void {
  const failureDetail =
    failure.reason === "no-token"
      ? "TRANSCODES_TOKEN is missing — step-up MFA gate is unavailable."
      : failure.reason === "create-failed"
        ? `Step-up MFA session could not be started${failure.detail ? ` (${failure.detail})` : ""}.`
        : `Step-up MFA gate errored${failure.detail ? ` (${failure.detail})` : ""}.`;
  emitDeny(
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Bash blocked by ai-action-tracker: ${result.reason}. ${failureDetail} ` +
          "Report the failure to the user; do not retry until step-up is available.",
      },
      systemMessage: `${blockedSummary(result)}\n\n${failureDetail}`,
    },
    `ai-action-tracker: BLOCKED (stepup-failure) — ${result.command}`,
  );
}

function emitStepupPending(
  result: BlockResult,
  req: Extract<RequestResult, { ok: true }>,
): void {
  const launchLine = req.launched
    ? "A browser tab has been opened automatically:"
    : "A concurrent hook process already opened a tab — reuse it:";
  const systemMessage = [
    "🔐 BLOCKED — Step-up MFA required. This Bash command was NOT executed.",
    "",
    `Reason : ${result.reason}`,
    `Command: ${result.command}`,
    "",
    launchLine,
    `  ${req.browserUrl}`,
    "",
    `Session id: ${req.sid}`,
    "",
    "Agent — drive the step-up loop:",
    "  1. Tell the user to complete the WebAuthn flow in the opened tab " +
      "(paste the URL above if it did not open).",
    `  2. Call the MCP tool \`poll_stepup_session\` with sid="${req.sid}" ` +
      'until step_status === "verified" (poll every ~1s, give up after ~60s).',
    "  3. Retry the SAME Bash command — the hook detects the verified state " +
      "and allows it.",
  ].join("\n");
  emitDeny(
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Step-up MFA pending. sid=${req.sid}. Open ${req.browserUrl}, ` +
          "complete WebAuthn, call poll_stepup_session until verified, " +
          "then retry the same Bash command.",
      },
      systemMessage,
    },
    `ai-action-tracker: STEPUP-PENDING sid=${req.sid} — ${result.command}`,
  );
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: PreToolUsePayload;
  try {
    payload = JSON.parse(raw) as PreToolUsePayload;
  } catch {
    process.exit(0);
  }

  if (payload.tool_name !== "Bash") process.exit(0);
  const command = payload.tool_input?.command;
  if (typeof command !== "string") process.exit(0);

  const cwd = payload.cwd ?? process.cwd();

  const block =
    checkPatternMatch(command) ?? checkRmGitTracked(command, cwd);

  if (!block) process.exit(0);

  // Fast path: a previous step-up was verified and the record is still in
  // the cross-platform store. Consume both records (single-shot policy)
  // and allow.
  if (readVerified()) {
    consumeVerified();
    clearPending();
    process.exit(0);
  }

  // No verified record — request a step-up session and hand off to the
  // agent. The agent polls via the MCP tool, then retries this same Bash
  // command which will hit the fast path above.
  if (!process.env.TRANSCODES_TOKEN?.trim()) {
    emitNoStepup(block);
    process.exit(0);
  }

  const req = await requestStepup({
    reason: block.reason,
    command: block.command,
  });
  if (!req.ok) {
    emitStepupFailure(block, req);
    process.exit(0);
  }
  writePending({
    sid: req.sid,
    command: block.command,
    reason: block.reason,
    browserUrl: req.browserUrl,
    createdAt: Date.now(),
    expiresAt: req.expiresAt,
    status: "pending",
  });
  emitStepupPending(block, req);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ai-action-tracker hook error: ${err}\n`);
  process.exit(0);
});
