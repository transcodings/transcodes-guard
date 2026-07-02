/**
 * Host-agnostic PreToolUse gate decision.
 *
 * Extracted from the original `plugins/ai-action-tracker/hooks/pre-tool-use.ts`
 * so every host's hook entrypoint can be a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision
 * shape drives Claude Code, Codex, Cursor, and Antigravity.
 *
 * Guard v3: Bash + external mcp__* → POST /guard/evaluate. Built-in
 * transcodes-guard MCP skips the hook (execProtectedTool handler backstop).
 *
 * Fail policy:
 *  - Before classify (stdin parse) → return `{ kind: "proceed-ungated" }`
 *    (fail-open). Callers exit 0 with no JSON.
 *  - After classify (bash or external mcp__*) → POST /guard/evaluate.
 *    Fail-closed: backend unreachable → permission 2 (step-up). Verified
 *    read / step-up create failures surface as `deny-*` decisions.
 */
import {
  DEFAULT_RBAC_RESOURCE,
  isTranscodesGuardWireToolName,
  type RbacAction,
} from '@transcodes-guard/danger-patterns';
import { loadStepupConfig } from './config.js';
import {
  fingerprintOf,
  launchStepupBrowser,
  type RequestResult,
} from './gate.js';
import { clearPending, type PendingState } from './pending.js';
import { evaluateAction } from './rbac-check.js';
import { pollStepupSession } from './session.js';
import { consumeVerified, readVerified } from './store.js';
import { resolveToken } from './token-store.js';

export interface ToolCallInput {
  toolName: string;
  toolInput: unknown;
  cwd: string;
}

export interface BlockResult {
  /** One-line summary surfaced in reason/systemMessage. */
  reason: string;
  /** Optional extra detail surfaced in reason/systemMessage. */
  details?: string[];
  /** Command / tool-call summary used in stderr logs and the pending file. */
  command: string;
  /** Synthetic audit id. Feeds decision audit (H2). */
  ruleId: string;
  /** RBAC placeholder until `/guard/evaluate` returns the classified coordinate. */
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
      /** Backend `/guard/evaluate` classification + matrix explanation. */
      reasoning?: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.PROCEED_BY_VERIFICATION;
      block: BlockResult;
      /** True → the hook consumes the FP-keyed verified record on allow.
       * Guard v3 hook path (bash + external MCP) always sets true. Built-in
       * transcodes-guard MCP never reaches this function. */
      consumeHere: boolean;
      /** Command fingerprint of the verified record to consume (FP-keyed store). */
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
      reasoning?: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
      block: BlockResult;
      failure: Extract<RequestResult, { ok: false }>;
      reasoning?: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
      block: BlockResult;
      sid: string;
      browserUrl: string;
      browserLaunched: boolean;
      pending: PendingState;
      reasoning?: string;
    };

const GUARD_EVALUATE_RULE_ID = 'guard-evaluate';

type Classified =
  | { kind: 'bash'; command: string; cwd: string }
  | { kind: 'tool'; toolName: string; toolInput: unknown };

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
  // Gate EVERYTHING else through POST /guard/evaluate — external MCP tools AND
  // host built-in tools (Read / Grep / Edit / Write / ...). The backend
  // classifier maps the raw tool_input onto (resource, action); the RBAC matrix
  // then decides 0/1/2, so a read still passes when its cell is 1.
  //
  // The ONE exception is the built-in transcodes-guard MCP itself: gating it
  // would trap the step-up recovery tools (poll_stepup_session_wait, ...) in
  // their own gate → step-up could never complete. Those are re-checked by the
  // execProtectedTool handler backstop instead.
  if (isTranscodesGuardWireToolName(input.toolName)) return null;
  return {
    kind: 'tool',
    toolName: input.toolName,
    toolInput: input.toolInput,
  };
}

/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here:
 *  - `POST /v1/guard/evaluate` (via `evaluateAction`).
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
    // fail-open: classify must not brick the workflow.
    return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };
  }
  if (!classified) return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };

  // block.command + fpKey: bash → command text; MCP → wire name + capped tool_input JSON.
  let blockCommand: string;
  let fpKey: string;
  if (classified.kind === 'bash') {
    blockCommand = classified.command;
    fpKey = classified.command;
  } else {
    let toolInputSummary: string;
    try {
      const s = JSON.stringify(classified.toolInput);
      toolInputSummary =
        s === undefined
          ? '[unserializable]'
          : s.length > 200
            ? `${s.slice(0, 197)}...`
            : s;
    } catch {
      toolInputSummary = '[unserializable]';
    }
    blockCommand = `${classified.toolName} ${toolInputSummary}`;
    fpKey = `${classified.toolName}:${JSON.stringify(classified.toolInput)}`;
  }
  const block: BlockResult = {
    reason: 'POST /guard/evaluate',
    command: blockCommand,
    ruleId: GUARD_EVALUATE_RULE_ID,
    stepupResource: DEFAULT_RBAC_RESOURCE,
    stepupAction: 'update',
  };
  const fp = fingerprintOf(fpKey);

  // Verified fast-path: skip /evaluate when this command already passed step-up.
  const verified = readVerified(fp);
  if (verified) {
    if ((await recheckVerifiedSid(verified.sid)) === 'trust') {
      return {
        kind: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
        block,
        consumeHere: true,
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

  // Guard v3: POST /guard/evaluate classifies + matrix + (level 2) step-up.
  let verdict = null;
  try {
    verdict = await evaluateAction(loadStepupConfig(), {
      toolName: input.toolName,
      toolInput: input.toolInput,
      cwd: input.cwd,
      comment:
        classified.kind === 'bash'
          ? `Confirm shell command: ${block.command}`
          : `Confirm tool call: ${classified.toolName}`,
    });
  } catch {
    verdict = null;
  }

  // Fail-closed: null verdict → treat as permission 2 (step-up required).
  const permission = verdict?.permission ?? 2;
  const resource = verdict?.resource ?? block.stepupResource;
  const action = verdict?.action ?? block.stepupAction;
  const backendReasoning = verdict?.reasoning?.trim() || undefined;

  if (permission === 0) {
    return {
      kind: GATE_DECISION_KIND.BLOCK_BY_POLICY,
      block,
      resource,
      action,
      reasoning: backendReasoning,
    };
  }
  if (permission === 1) {
    return {
      kind: GATE_DECISION_KIND.PROCEED_BY_POLICY,
      block,
      resource,
      action,
      reasoning: backendReasoning,
    };
  }

  // Level 2 — backend created the session; open MFA URL (deduped per fingerprint).
  if (!verdict?.sid || !verdict.url) {
    return {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      block,
      failure: { ok: false, reason: 'create-failed' },
      reasoning: backendReasoning,
    };
  }
  const browserLaunched = launchStepupBrowser(fpKey, verdict.url);
  const pending: PendingState = {
    sid: verdict.sid,
    command: block.command,
    reason: block.reason,
    browserUrl: verdict.url,
    createdAt: Date.now(),
    expiresAt: verdict.expires_at ?? undefined,
    status: 'pending',
    fp,
  };
  return {
    kind: GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED,
    block,
    sid: verdict.sid,
    browserUrl: verdict.url,
    browserLaunched,
    pending,
    reasoning: backendReasoning,
  };
}
