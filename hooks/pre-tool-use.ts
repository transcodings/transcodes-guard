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
 * On block: writes a structured warning to stderr explaining the reason
 * and exits with code 2. Claude Code feeds stderr back to the LLM and
 * surfaces it in the chat transcript.
 *
 * Failures (malformed input, missing config, hook bugs) fail-open
 * (exit 0) so a buggy guard cannot brick the user's workflow.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface PreToolUsePayload {
  tool_name: string;
  tool_input: { command?: string; [k: string]: unknown };
  cwd?: string;
}

interface DangerPattern {
  id: string;
  regex: string;
  reason: string;
}

interface DangerConfig {
  patterns: DangerPattern[];
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

function loadPatterns(): DangerConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "danger-patterns.json"),
    path.join(here, "..", "..", "hooks", "danger-patterns.json"),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as DangerConfig;
    } catch {
      // try next
    }
  }
  throw new Error(
    `danger-patterns.json not found near ${here} (tried: ${candidates.join(", ")})`,
  );
}

function checkPatternMatch(
  command: string,
  config: DangerConfig,
): BlockResult | null {
  for (const { id, regex, reason } of config.patterns) {
    if (new RegExp(regex).test(command)) {
      return {
        reason: `matched pattern \`${id}\` — ${reason}`,
        command,
      };
    }
  }
  return null;
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

function emitBlock(result: BlockResult): void {
  const lines: string[] = [
    "",
    "⛔ ai-action-tracker: BLOCKED dangerous command",
    "",
    `Reason: ${result.reason}`,
  ];
  if (result.details && result.details.length > 0) {
    lines.push("");
    lines.push("Affected:");
    for (const d of result.details) lines.push(`  - ${d}`);
  }
  lines.push("");
  lines.push(`Command: ${result.command}`);
  lines.push("");
  lines.push(
    "This command was intercepted before execution. Run it outside " +
      "Claude Code if intentional, or wait for the additional " +
      "authentication step (not yet wired up).",
  );
  lines.push("");
  process.stderr.write(lines.join("\n"));
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
  const config = loadPatterns();

  const block =
    checkPatternMatch(command, config) ?? checkRmGitTracked(command, cwd);

  if (block) {
    emitBlock(block);
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ai-action-tracker hook error: ${err}\n`);
  process.exit(0);
});
