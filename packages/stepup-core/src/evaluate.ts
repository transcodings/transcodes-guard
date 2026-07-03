/**
 * Host-agnostic PreToolUse gate decision (Guard v3, backend-as-SSOT).
 *
 * Every host's hook entrypoint is a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision shape
 * drives Claude Code, Codex, Cursor, and Antigravity.
 *
 * Guard v3 grouping: every host tool call (except built-in transcodes-guard
 * MCP) → `POST /guard/evaluate` with the raw hook stdin JSON as `payload` and a
 * client-minted per-prompt `sid`. The backend is the single source of truth for
 * step-up status; the client keeps NO on-disk verified/pending records — only a
 * per-coordinate latch (`latch.ts`) that dedupes the browser launch across the
 * N concurrent tool calls of one prompt.
 *
 * Fail policy:
 *  - Before classify (stdin parse) → `proceed-ungated` (fail-open); the caller
 *    exits 0 with no JSON.
 *  - After classify, no token → `block-no-token` (fail-closed).
 *  - After classify, backend unreachable / unparseable → permission 2
 *    (step-up); a null verdict without a session becomes
 *    `block-stepup-create-failed`.
 */
import {
  DEFAULT_RBAC_RESOURCE,
  isTranscodesGuardWireToolName,
  type RbacAction,
} from '@transcodes-guard/danger-patterns';
import { loadStepupConfig } from './config.js';
import { openBrowser } from './gate.js';
import { clearLatch, hasLatch, writeLatch } from './latch.js';
import { evaluateAction } from './rbac-check.js';
import { resolvePromptSid } from './sid.js';
import { resolveToken } from './token-store.js';

export interface ToolCallInput {
  toolName: string;
  toolInput: unknown;
  /** Original hook stdin JSON — sent verbatim as POST /guard/evaluate payload. */
  rawPayload?: unknown;
  cwd: string;
  hookEventName?: string;
}

export interface BlockResult {
  /** One-line summary surfaced in reason/systemMessage. */
  reason: string;
  /** Optional extra detail surfaced in reason/systemMessage. */
  details?: string[];
  /** Command / tool-call summary used in stderr logs. */
  command: string;
  /** Synthetic audit id. Feeds decision audit (H2). */
  ruleId: string;
  /** RBAC placeholder until `/guard/evaluate` returns the classified coordinate. */
  stepupResource: string;
  stepupAction: RbacAction;
}

/** The `ok: false` shape returned when a step-up session cannot be created. */
export type StepupFailure = {
  ok: false;
  reason: 'no-token' | 'create-failed' | 'error';
  detail?: string;
};

/**
 * Runtime + type-level kind constants for `GateDecision`. Source of truth for
 * the discriminated union below and every `switch`/comparison across the
 * codebase. Mirrored in `gate-contract/src/types.ts` (import firewall — the two
 * copies must stay in lockstep; the `gate-backend` drift alarm catches a missed
 * sync).
 */
export const GATE_DECISION_KIND = {
  PROCEED_UNGATED: 'proceed-ungated',
  PROCEED_BY_POLICY: 'proceed-by-policy',
  BLOCK_NO_TOKEN: 'block-no-token',
  BLOCK_BY_POLICY: 'block-by-policy',
  BLOCK_STEPUP_CREATE_FAILED: 'block-stepup-create-failed',
  BLOCK_STEPUP_CHALLENGED: 'block-stepup-challenged',
  /** Terminal: user declined MFA for this grouped challenge — do not poll/retry. */
  BLOCK_STEPUP_REJECTED: 'block-stepup-rejected',
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
      failure: StepupFailure;
      reasoning?: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
      block: BlockResult;
      /** Backend-minted auth session id (tc_stepup_…) for poll + retry. */
      sid: string;
      browserUrl: string;
      browserLaunched: boolean;
      /** Classified coordinate (also the local latch key). */
      resource: string;
      action: string;
      reasoning?: string;
    }
  | {
      /** Terminal: grouped challenge was rejected — stop polling, do not retry. */
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED;
      block: BlockResult;
      resource: string;
      action: string;
      reasoning?: string;
    };

const GUARD_EVALUATE_RULE_ID = 'guard-evaluate';

type Classified = { summary: string };

function resolvePayload(input: ToolCallInput): unknown {
  return (
    input.rawPayload ?? {
      tool_name: input.toolName,
      tool_input: input.toolInput,
      cwd: input.cwd,
    }
  );
}

function shellCommand(toolInput: unknown): string | undefined {
  const cmd = (toolInput as { command?: unknown } | null)?.command;
  return typeof cmd === 'string' ? cmd : undefined;
}

function wireToolName(input: ToolCallInput): string | undefined {
  return input.toolName !== 'Unknown' ? input.toolName : undefined;
}

function summarizePayload(payload: unknown): string {
  try {
    const s = JSON.stringify(payload);
    if (s === undefined) return '[unserializable]';
    return s.length > 200 ? `${s.slice(0, 197)}...` : s;
  } catch {
    return '[unserializable]';
  }
}

function classifyToolCall(input: ToolCallInput): Classified | null {
  const name = wireToolName(input);
  if (name && isTranscodesGuardWireToolName(name)) return null;

  const payload = resolvePayload(input);
  const cmd = shellCommand(input.toolInput);
  const label = name ?? 'tool';
  const blob = summarizePayload(payload);
  const summary = cmd ?? `${label} ${blob}`;

  return { summary };
}

/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here (all crash-safe / never throw into the caller):
 *  - `POST /v1/guard/evaluate` (via `evaluateAction`).
 *  - resolve/mint the per-prompt grouping sid (`resolvePromptSid`).
 *  - on a step-up challenge: open the browser once per coordinate + write the
 *    latch. The stdout deny is emitted by the caller AFTER this returns, so a
 *    latch write cannot suppress the deny — and the latch write already swallows
 *    every error.
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

  const block: BlockResult = {
    reason: 'POST /guard/evaluate',
    command: classified.summary,
    ruleId: GUARD_EVALUATE_RULE_ID,
    stepupResource: DEFAULT_RBAC_RESOURCE,
    stepupAction: 'update',
  };

  if (!resolveToken().token) {
    return { kind: GATE_DECISION_KIND.BLOCK_NO_TOKEN, block };
  }

  const sid = resolvePromptSid();

  // Guard v3: POST /guard/evaluate classifies + matrix + (level 2) grouped
  // step-up keyed on sid. Fail-closed on any error → permission 2.
  let verdict = null;
  try {
    verdict = await evaluateAction(loadStepupConfig(), {
      payload: resolvePayload(input),
      toolName: wireToolName(input),
      cwd: input.cwd,
      comment: `Confirm tool call: ${block.command}`,
      sid,
    });
  } catch {
    verdict = null;
  }

  const permission = verdict?.permission ?? 2;
  const resource = verdict?.resource ?? block.stepupResource;
  const action = verdict?.action ?? block.stepupAction;
  const backendReasoning = verdict?.reasoning?.trim() || undefined;

  if (permission === 0) {
    // Hard RBAC deny — never a challenge, so any stale latch for this
    // coordinate is orphaned; clear it.
    clearLatch(sid, resource, action);
    return {
      kind: GATE_DECISION_KIND.BLOCK_BY_POLICY,
      block,
      resource,
      action,
      reasoning: backendReasoning,
    };
  }
  if (permission === 1) {
    // Allowed — either the role permits it outright, or a grouped step-up for
    // this coordinate was already verified (backend grant). Self-heal: drop the
    // latch so a later distinct challenge in this prompt can relaunch.
    clearLatch(sid, resource, action);
    return {
      kind: GATE_DECISION_KIND.PROCEED_BY_POLICY,
      block,
      resource,
      action,
      reasoning: backendReasoning,
    };
  }

  // Level 2 — the backend created (or reused) the grouped session.
  if (!verdict?.sid || !verdict.url) {
    return {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      block,
      failure: { ok: false, reason: 'create-failed' },
      reasoning: backendReasoning,
    };
  }

  // ── Terminal: rejected — stop immediately (no poll loop, no retry nag) ───
  if (verdict.status === 'rejected') {
    clearLatch(sid, resource, action);
    return {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED,
      block,
      resource,
      action,
      reasoning: backendReasoning,
    };
  }

  // ── Self-heal: stale latch when backend says NOT an in-flight pending ───
  //
  // pending + verified are "continue work" paths (poll or retry). Only drop a
  // latch when the backend is starting fresh (exist:false → prior cache gone /
  // not-found) so a new browser tab can open.
  const reused = verdict.exist === true;
  const pending =
    verdict.status === 'pending' ||
    verdict.status === null ||
    verdict.status === undefined;
  if (hasLatch(sid, resource, action) && !(reused && pending)) {
    clearLatch(sid, resource, action);
  }

  // pending → open browser once, write latch, tell agent to poll.
  let browserLaunched = false;
  if (pending && !reused) {
    openBrowser(verdict.url);
    browserLaunched = true;
  }
  if (pending) {
    writeLatch(sid, resource, action, verdict.sid);
  }

  return {
    kind: GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED,
    block,
    sid: verdict.sid,
    browserUrl: verdict.url,
    browserLaunched,
    resource,
    action,
    reasoning: backendReasoning,
  };
}
