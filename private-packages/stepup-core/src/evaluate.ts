/**
 * Host-agnostic PreToolUse gate decision.
 *
 * Extracted from the original `plugins/ai-action-tracker/hooks/pre-tool-use.ts`
 * so every host's hook entrypoint can be a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision
 * shape drives Claude Code, Codex, and (later) Cursor/Antigravity.
 *
 * Fail policy:
 *  - Before a danger pattern match (stdin parse, classify, pattern load) →
 *    return `{ kind: "pass" }` (fail-open). Callers exit 0 with no JSON.
 *  - After a danger pattern match (verified read, step-up create) →
 *    surface as a `deny-*` decision so callers can fail-safe.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  findFirstMatch,
  loadMergedPatterns,
} from '@transcodes-guard/danger-patterns';
import {
  findFirstToolRule,
  loadMergedToolRules,
  type MergedToolRule,
} from '@transcodes-guard-private/danger-rules';
import { type RequestResult, requestStepup } from './gate.js';
import type { PendingState } from './pending.js';
import { readVerified } from './store.js';
import { isTrackerEnabled, resolveToken } from './token-store.js';

export interface ToolCallInput {
  toolName: string;
  toolInput: unknown;
  cwd: string;
}

export interface BlockResult {
  /** One-line danger summary surfaced in reason/systemMessage. */
  reason: string;
  /** Optional per-target detail (e.g. git-tracked file samples). */
  details?: string[];
  /** Command / tool-call summary used in stderr logs and the pending file. */
  command: string;
}

export type GateDecision =
  | { kind: 'pass' }
  | { kind: 'allow'; block: BlockResult; consumeHere: boolean }
  | { kind: 'deny-no-token'; block: BlockResult }
  | {
      kind: 'deny-stepup-failure';
      block: BlockResult;
      failure: Extract<RequestResult, { ok: false }>;
    }
  | {
      kind: 'deny-stepup-pending';
      block: BlockResult;
      sid: string;
      browserUrl: string;
      browserLaunched: boolean;
      pending: PendingState;
    };

function checkPatternMatch(command: string): BlockResult | null {
  const hit = findFirstMatch(command, loadMergedPatterns());
  if (!hit) return null;
  const { source, id, reason } = hit.matched;
  return {
    reason: `matched ${source} pattern \`${id}\` — ${reason}`,
    command,
  };
}

function extractRmTargets(command: string): string[] | null {
  const tokens = command.trim().split(/\s+/);
  const rmIdx = tokens.indexOf('rm');
  if (rmIdx === -1) return null;

  let i = rmIdx + 1;
  let recursive = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '--') {
      i++;
      break;
    }
    if (t.startsWith('-') && /^-[a-zA-Z]+$/.test(t)) {
      if (/[rR]/.test(t)) recursive = true;
      i++;
      continue;
    }
    break;
  }
  if (!recursive) return null;

  const targets = tokens.slice(i).filter((t) => !t.startsWith('-'));
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
  if (/[*?{[]/.test(target)) return null;

  const abs = path.resolve(cwd, target);

  let toplevel: string;
  try {
    toplevel = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return null;
  }

  const rel = path.relative(toplevel, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  let tracked: string[];
  try {
    const out = execFileSync(
      'git',
      ['-C', toplevel, 'ls-files', '--', rel || '.'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    tracked = out.split('\n').filter(Boolean);
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

function checkRmGitTracked(command: string, cwd: string): BlockResult | null {
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
          : '';
      return `${h.target} — ${h.trackedCount} tracked file(s): ${h.samples.join(', ')}${more}`;
    }),
    command,
  };
}

/** Serialize MCP tool_input for the `block.command` summary. Capped at 200 chars. */
function stringifyToolInput(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    if (s === undefined) return '[unserializable]';
    return s.length > 200 ? s.slice(0, 197) + '...' : s;
  } catch {
    return '[unserializable]';
  }
}

type Classified =
  | { kind: 'bash'; command: string; cwd: string }
  | {
      kind: 'mcp';
      toolName: string;
      toolInput: unknown;
      rule: MergedToolRule;
    };

function classifyToolCall(input: ToolCallInput): Classified | null {
  // Host-specific shell tool names map to the same internal `bash` kind.
  // Claude Code / Codex use "Bash"; Antigravity 2.0 uses "run_command";
  // Cursor uses "Shell" (per cursor.com/docs/agent/hooks matchers). The
  // antigravity adapter rewrites `args.CommandLine` → `args.command`
  // before the classifier sees it, so the body below is host-neutral.
  if (
    input.toolName === 'Bash' ||
    input.toolName === 'run_command' ||
    input.toolName === 'Shell'
  ) {
    const cmd = (input.toolInput as { command?: unknown } | undefined)?.command;
    if (typeof cmd !== 'string') return null;
    return { kind: 'bash', command: cmd, cwd: input.cwd };
  }
  const rules = loadMergedToolRules();
  const match = findFirstToolRule(input.toolName, rules);
  if (!match) return null;
  return {
    kind: 'mcp',
    toolName: input.toolName,
    toolInput: input.toolInput,
    rule: match.matched,
  };
}

/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here:
 *  - `requestStepup` creates a backend session and may launch a browser.
 *  - `readVerified` reads from disk.
 *
 * Side effects intentionally NOT performed here (caller's responsibility):
 *  - `writePending(decision.pending)` — caller must call this AFTER
 *    emitting the deny JSON so a throw in writePending cannot suppress
 *    the deny on stdout (CLAUDE.md fail-safe rule).
 *  - `consumeVerified` + `clearPending` on allow — caller decides based on
 *    `decision.consumeHere`.
 */
export async function evaluatePreToolUse(
  input: ToolCallInput,
): Promise<GateDecision> {
  if (!isTrackerEnabled()) {
    return { kind: 'pass' };
  }

  let classified: Classified | null;
  try {
    classified = classifyToolCall(input);
  } catch {
    return { kind: 'pass' };
  }
  if (!classified) return { kind: 'pass' };

  const block: BlockResult | null =
    classified.kind === 'bash'
      ? (checkPatternMatch(classified.command) ??
        checkRmGitTracked(classified.command, classified.cwd))
      : {
          reason: `matched ${classified.rule.source} tool-rule \`${classified.rule.id}\` — ${classified.rule.reason}`,
          command: `${classified.toolName} ${stringifyToolInput(classified.toolInput)}`,
        };

  if (!block) return { kind: 'pass' };

  if (readVerified()) {
    const consumeHere =
      classified.kind === 'bash' || classified.rule.consume_in_hook === true;
    return { kind: 'allow', block, consumeHere };
  }

  if (!resolveToken().token) {
    return { kind: 'deny-no-token', block };
  }

  const gateInput =
    classified.kind === 'bash'
      ? {
          reason: block.reason,
          action: 'bash_exec',
          resource: 'transcodes-guard:pre-tool-use',
          fingerprintKey: classified.command,
          comment: `Confirm danger command: ${block.reason}`,
        }
      : {
          reason: block.reason,
          action: classified.rule.stepupAction,
          resource: classified.rule.stepupResource,
          fingerprintKey: `${classified.toolName}:${JSON.stringify(classified.toolInput)}`,
          comment: `Confirm ${classified.rule.id}: ${classified.rule.reason}`,
        };

  const req = await requestStepup(gateInput);
  if (!req.ok) {
    return { kind: 'deny-stepup-failure', block, failure: req };
  }

  const pending: PendingState = {
    sid: req.sid,
    command: block.command,
    reason: block.reason,
    browserUrl: req.browserUrl,
    createdAt: Date.now(),
    expiresAt: req.expiresAt,
    status: 'pending',
  };

  return {
    kind: 'deny-stepup-pending',
    block,
    sid: req.sid,
    browserUrl: req.browserUrl,
    browserLaunched: req.launched,
    pending,
  };
}
