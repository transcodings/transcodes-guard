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
  DEFAULT_RBAC_RESOURCE,
  findFirstMatch,
  findFirstToolRule,
  type MergedToolRule,
  mcpConsumesInHook,
  type RbacAction,
} from '@transcodes-guard/danger-patterns';
import { loadStepupConfig } from './config.js';
import { fingerprintOf, type RequestResult, requestStepup } from './gate.js';
import { clearPending, type PendingState } from './pending.js';
import {
  loadEffectivePatterns,
  loadEffectiveToolRules,
} from './policy-bundle.js';
import { checkRbacPermission, type RbacLevel } from './rbac-check.js';
import { pollStepupSession } from './session.js';
import { consumeVerified, readVerified } from './store.js';
import { resolveToken } from './token-store.js';

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
  /** Id of the matched pattern/tool-rule (or a synthetic id for built-in
   * semantic checks). Feeds the decision audit (H2) — never the raw command. */
  ruleId: string;
  /** RBAC step-up coordinate of the matched rule. Always resolved by the
   * producer (pattern/tool-rule are coerced on load; the git-tracked check
   * hard-codes system/delete) so the gate can consult the matrix directly. */
  stepupResource: string;
  stepupAction: RbacAction;
}

/**
 * Runtime + type-level kind constants for `GateDecision`. Source of truth for
 * the discriminated union below and for every `switch`/comparison across the
 * codebase. Mirrored in `gate-contract/src/types.ts` (import firewall — the
 * two copies must stay in lockstep; the `gate-backend` drift alarm catches a
 * missed sync).
 */
export const GATE_DECISION_KIND = {
  PROCEED_UNGATED: 'proceed-ungated',
  PROCEED_BY_POLICY: 'proceed-by-policy',
  PROCEED_BY_VERIFICATION: 'proceed-by-verification',
  BLOCK_NO_TOKEN: 'block-no-token',
  BLOCK_BY_POLICY: 'block-by-policy',
  BLOCK_STEPUP_CREATE_FAILED: 'block-stepup-create-failed',
  BLOCK_STEPUP_CHALLENGED: 'block-stepup-challenged',
} as const;

export type GateDecision =
  | { kind: typeof GATE_DECISION_KIND.PROCEED_UNGATED }
  | {
      kind: typeof GATE_DECISION_KIND.PROCEED_BY_POLICY;
      block: BlockResult;
      resource: string;
      action: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.PROCEED_BY_VERIFICATION;
      block: BlockResult;
      /** True → the hook itself consumes the verified record (Bash + user
       * tool-rules). False → consume is deferred to the tool handler
       * (`withStepupVerifiedSid`) for MCP system rules. */
      consumeHere: boolean;
      /** Command fingerprint of the verified record to consume. Present
       * (and meaningful) only when `consumeHere` is true — that path uses
       * the FP-KEYED store. Omitted for the deferred MCP system path
       * (GLOBAL store). */
      fp?: string;
    }
  | { kind: typeof GATE_DECISION_KIND.BLOCK_NO_TOKEN; block: BlockResult }
  | {
      /** RBAC matrix returned permission 0 (deny) for this resource+action.
       * Step-up cannot help — the member's role has no access. Hard block. */
      kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
      block: BlockResult;
      resource: string;
      action: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
      block: BlockResult;
      failure: Extract<RequestResult, { ok: false }>;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
      block: BlockResult;
      sid: string;
      browserUrl: string;
      browserLaunched: boolean;
      pending: PendingState;
    };

function checkPatternMatch(command: string): BlockResult | null {
  const hit = findFirstMatch(command, loadEffectivePatterns());
  if (!hit) return null;
  const { source, id, reason, stepupResource, stepupAction } = hit.matched;
  return {
    reason: `matched ${source} pattern \`${id}\` — ${reason}`,
    command,
    ruleId: id,
    stepupResource,
    stepupAction,
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
      return `${h.target} — ${h.trackedCount} tracked file(s): ${h.samples.join(
        ', ',
      )}${more}`;
    }),
    command,
    ruleId: 'rm-git-tracked',
    stepupResource: DEFAULT_RBAC_RESOURCE,
    stepupAction: 'delete',
  };
}

/** Serialize MCP tool_input for the `block.command` summary. Capped at 200 chars. */
function stringifyToolInput(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    if (s === undefined) return '[unserializable]';
    return s.length > 200 ? `${s.slice(0, 197)}...` : s;
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

/**
 * C-plan (backend-as-truth): re-confirm a locally-cached verified record with
 * the backend before the fast-path trusts it.
 *
 * Without this, the fast-path allows on the mere presence of
 * `stepup-verified.<fp>.json`, so a process that fabricates that file with a
 * made-up sid bypasses MFA. The sid the file carries was issued by the backend
 * (the poll tool wrote it), so re-polling it is a forgery test: a fabricated
 * sid was never issued → backend answers "not verified" → we force a fresh
 * step-up.
 *
 * Called only on the FP path (Bash + user rules); the MCP system path relies
 * on its handler's X-Step-Up-Session-Id backend backstop instead.
 *
 * Decisions:
 *   - no token / config load fails → "trust": step-up is inert without a token
 *     and we cannot poll. Preserves pre-C-plan behaviour (and keeps the
 *     token-less CI fast-path tests green).
 *   - backend authoritative (2xx) + status "verified" → "trust".
 *   - backend authoritative (2xx non-verified, or 404 unknown sid) → "reauth":
 *     the record is forged, expired, or revoked at the backend.
 *   - cannot confirm (network failure status 0, 5xx, 401/403) → "trust":
 *     availability fallback. A transient blip must not lock out a user who
 *     legitimately authenticated; the realistic forgery threat (a rogue local
 *     process) does not control backend reachability. Note `request()` reports
 *     network failures as an envelope with `status: 0` rather than throwing.
 */
async function recheckVerifiedSid(sid: string): Promise<'trust' | 'reauth'> {
  if (!resolveToken().token) return 'trust';
  let config;
  try {
    config = loadStepupConfig();
  } catch {
    return 'trust';
  }
  try {
    const { envelope, status } = await pollStepupSession(config, sid);
    if (status === 'verified') return 'trust';
    // Authoritative "not verified": reachable 2xx with a non-verified status,
    // or 404 meaning the backend never issued this sid (fabricated).
    if (envelope.ok || envelope.status === 404) return 'reauth';
    // status 0 (network) / 5xx / 401 / 403 → cannot confirm → availability.
    return 'trust';
  } catch {
    return 'trust';
  }
}

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
  // G3: baseline → cached org bundle → user rules. Cache-only read — the
  // PreToolUse critical path stays network-free.
  const rules = loadEffectiveToolRules();
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
  let classified: Classified | null;
  try {
    classified = classifyToolCall(input);
  } catch {
    return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };
  }
  if (!classified) return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };

  const block: BlockResult | null =
    classified.kind === 'bash'
      ? (checkPatternMatch(classified.command) ??
        checkRmGitTracked(classified.command, classified.cwd))
      : {
          reason: `matched ${classified.rule.source} tool-rule \`${classified.rule.id}\` — ${classified.rule.description}`,
          command: `${classified.toolName} ${stringifyToolInput(
            classified.toolInput,
          )}`,
          ruleId: classified.rule.id,
          stepupResource: classified.rule.resource ?? DEFAULT_RBAC_RESOURCE,
          stepupAction: classified.rule.action ?? 'update',
        };

  if (!block) return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };

  // Consume semantics (see stepup-gate.md):
  //   Bash + bundle MCP rules → FP-keyed verified file, hook consumes on allow.
  //   System MCP rules → GLOBAL verified; handler passes sid to the backend.
  const consumeHere =
    classified.kind === 'bash' ||
    (classified.kind === 'mcp' && mcpConsumesInHook(classified.rule));
  const fingerprintKey =
    classified.kind === 'bash'
      ? classified.command
      : `${classified.toolName}:${JSON.stringify(classified.toolInput)}`;
  const fp = consumeHere ? fingerprintOf(fingerprintKey) : undefined;

  const verified = readVerified(fp);
  if (verified) {
    // FP-keyed path (Bash + bundle MCP rules) needs backend re-check. GLOBAL
    // path (system MCP rules) skips it — handler re-validates sid via header.
    if (!consumeHere || (await recheckVerifiedSid(verified.sid)) === 'trust') {
      return {
        kind: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
        block,
        consumeHere,
        fp,
      };
    }
    // Backend says this record is no longer (or never was) verified — discard
    // the stale/forged record and fall through to a fresh step-up below.
    consumeVerified(fp);
    clearPending(fp);
  }

  if (!resolveToken().token) {
    return { kind: GATE_DECISION_KIND.BLOCK_NO_TOKEN, block };
  }

  // The matched rule only maps this command/tool onto an RBAC coordinate; the
  // backend permission matrix is the authority for the decision. The coordinate
  // is already resolved on `block` (both producers fill it), so ask the matrix
  // directly: 0=deny, 1=allow (no step-up), 2=allow+step-up.
  const { stepupResource: resource, stepupAction: action } = block;

  const hasRbacCoord =
    classified.kind === 'bash' ||
    (classified.rule.action !== undefined &&
      classified.rule.resource !== undefined);

  // Fail-closed: any failure to determine the level (network/parse/config) is
  // treated as step-up required (2) — never silently allowed.
  let level: RbacLevel = 2;
  if (hasRbacCoord) {
    try {
      const config = loadStepupConfig();
      level = (await checkRbacPermission(config, resource, action)) ?? 2;
    } catch {
      level = 2;
    }
  }

  if (level === 0) {
    return {
      kind: GATE_DECISION_KIND.BLOCK_BY_POLICY,
      block,
      resource,
      action,
    };
  }
  if (level === 1) {
    // RBAC grants this without step-up → let the command through. The local
    // rule is a classifier, not an independent floor.
    return {
      kind: GATE_DECISION_KIND.PROCEED_BY_POLICY,
      block,
      resource,
      action,
    };
  }

  const gateInput = {
    reason: block.reason,
    action,
    resource,
    fingerprintKey,
    comment:
      classified.kind === 'bash'
        ? `Confirm danger command: ${block.reason}`
        : `Confirm ${classified.rule.id}: ${classified.rule.label}`,
  };

  const req = await requestStepup(gateInput);
  if (!req.ok) {
    return {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      block,
      failure: req,
    };
  }

  const pending: PendingState = {
    sid: req.sid,
    command: block.command,
    reason: block.reason,
    browserUrl: req.browserUrl,
    createdAt: Date.now(),
    expiresAt: req.expiresAt,
    status: 'pending',
    // FP-KEYED record for the hook-consume path; GLOBAL (no fp) otherwise.
    ...(fp ? { fp } : {}),
  };

  return {
    kind: GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED,
    block,
    sid: req.sid,
    browserUrl: req.browserUrl,
    browserLaunched: req.launched,
    pending,
  };
}
