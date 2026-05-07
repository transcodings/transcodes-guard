#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — danger command interceptor.
 *
 * Reads a PreToolUse JSON payload from stdin. If `tool_name` is `Bash`
 * and `tool_input.command` matches any pattern in `danger-patterns.json`,
 * writes a warning to stderr and exits with code 2 — Claude Code's
 * blocking exit code, which prevents the tool call and feeds stderr
 * back to the LLM and the chat transcript. All other inputs exit 0.
 *
 * Failures (malformed input, missing config, hook bugs) fail-open
 * (exit 0) so a buggy guard cannot brick the user's workflow.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface PreToolUsePayload {
  tool_name: string;
  tool_input: { command?: string; [k: string]: unknown };
}

interface DangerPattern {
  id: string;
  regex: string;
  reason: string;
}

interface DangerConfig {
  patterns: DangerPattern[];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function loadPatterns(): DangerConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Two layouts must work:
  //   - tsx dev:        hooks/pre-tool-use.ts   → ./danger-patterns.json
  //   - built/installed: dist/hooks/...js       → ../../hooks/danger-patterns.json
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

  const { patterns } = loadPatterns();
  for (const { id, regex, reason } of patterns) {
    if (new RegExp(regex).test(command)) {
      process.stderr.write(
        `\n⛔ ai-action-tracker: BLOCKED dangerous command\n` +
          `   Pattern: ${id} — ${reason}\n` +
          `   Command: ${command}\n` +
          `\nThis command was intercepted before execution. ` +
          `If you genuinely intend to run it, run it outside Claude Code or ` +
          `complete the additional authentication step (not yet wired up).\n`,
      );
      process.exit(2);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ai-action-tracker hook error: ${err}\n`);
  process.exit(0);
});
