/**
 * Host-agnostic PreToolUse gate decision (Guard v3, backend-as-SSOT).
 *
 * Every host's hook entrypoint is a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision shape
 * drives Claude Code, Codex, Cursor, and Antigravity.
 *
 * Guard v3: every host tool call (except built-in transcodes-guard MCP and host
 * meta-tool bypass sets below) → `POST /guard/evaluate` with the raw hook stdin
 * JSON as `payload`. Backend reuses MFA via Redis
 * `stepup:{projectId}:{memberId}:{resource}:{action}`. Client opens the browser
 * only when `exist:false` (fresh mint); no local latch / prompt group.
 *
 * Fail policy:
 *  - Before classify (stdin parse) → `proceed-ungated` (fail-open); the caller
 *    exits 0 with no JSON.
 *  - After classify, no token → `block-no-token` (fail-closed).
 *  - After classify, backend unreachable / unparseable → permission 2
 *    (step-up); a failed evaluate without a session becomes
 *    `block-stepup-create-failed`, carrying the HTTP status / backend error
 *    text in `failure.detail` so the deny is diagnosable (issue #189).
 */
import {
  currentHostProvider,
  DEFAULT_RBAC_RESOURCE,
  type GuardProvider,
  isBuiltinExemptToolName,
  isGuardMetaToolName,
  type RbacAction,
} from '../patterns/index.js';
import { loadStepupConfig } from './config.js';
import { openBrowser } from './gate.js';
import { evaluateAction } from './rbac-check.js';
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
  /** Wire tool name (`Bash`, `mcp__…`). Feeds decision audit metadata. */
  toolName?: string | undefined;
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
 * codebase. Re-exported as the contract surface (`../contract/types.ts`) —
 * changing this constant or the union changes the GateBackend contract.
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
      reasoning?: string | undefined;
    }
  | { kind: typeof GATE_DECISION_KIND.BLOCK_NO_TOKEN; block: BlockResult }
  | {
      /** RBAC matrix returned permission 0 (deny) for this resource+action.
       * Step-up cannot help — the member's role has no access. Hard block. */
      kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
      block: BlockResult;
      resource: string;
      action: string;
      reasoning?: string | undefined;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
      block: BlockResult;
      failure: StepupFailure;
      reasoning?: string | undefined;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
      block: BlockResult;
      /** Backend-minted auth session id (tc_stepup_…) for poll + retry. */
      sid: string;
      browserUrl: string;
      browserLaunched: boolean;
      /** Classified coordinate — the backend's reuse key for this challenge. */
      resource: string;
      action: string;
      reasoning?: string | undefined;
    }
  | {
      /** Terminal: grouped challenge was rejected — skip this command; other work may continue. */
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED;
      block: BlockResult;
      resource: string;
      action: string;
      reasoning?: string | undefined;
    };

const GUARD_EVALUATE_RULE_ID = 'guard-evaluate';

export type Classified = { summary: string };

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
  const o = toolInput as { command?: unknown; CommandLine?: unknown } | null;
  if (typeof o?.command === 'string') return o.command;
  if (typeof o?.CommandLine === 'string') return o.CommandLine;
  return undefined;
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

/**
 * The built-in binary decision (toolgate t2, narrowed by t9): a call is
 * skipped iff its wire name is a step-up meta tool (the 4-name recovery
 * loop) or in the host's static builtin-exempt list — everything else,
 * non-meta tc_* tools included, goes to POST /guard/evaluate.
 * Exported for the §3 acceptance-matrix unit tests; production callers go
 * through `evaluatePreToolUse`.
 */
export function classifyToolCall(
  input: ToolCallInput,
  provider: GuardProvider | undefined,
): Classified | null {
  const name = wireToolName(input);
  if (
    name &&
    (isGuardMetaToolName(name) || isBuiltinExemptToolName(provider, name))
  ) {
    return null;
  }

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
 *  - on a fresh step-up challenge (`exist:false`): open the browser once.
 *    Concurrent hooks rely on backend coordinate claim (SET NX) for dedupe —
 *    no local latch / prompt group.
 */
export async function evaluatePreToolUse(
  input: ToolCallInput,
): Promise<GateDecision> {
  let classified: Classified | null;
  try {
    classified = classifyToolCall(input, currentHostProvider());
  } catch {
    // fail-open: classify must not brick the workflow.
    return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };
  }
  if (!classified) return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };

  const block: BlockResult = {
    reason: 'POST /guard/evaluate',
    command: classified.summary,
    toolName: wireToolName(input),
    ruleId: GUARD_EVALUATE_RULE_ID,
    stepupResource: DEFAULT_RBAC_RESOURCE,
    stepupAction: 'update',
  };

  if (!resolveToken().token) {
    return { kind: GATE_DECISION_KIND.BLOCK_NO_TOKEN, block };
  }

  // Guard v3: POST /guard/evaluate classifies + matrix + (level 2) step-up.
  // On failure `verdict` stays null (fail-closed → permission 2) and
  // `failureDetail` records WHY, so the deny message is diagnosable (#189).
  // Reason vocabulary matches console.ts: backend-side failure (refusal,
  // unreachable, malformed) → 'create-failed' (platform ops: guardLog + server log).
  // local client throw → 'error'.
  let verdict = null;
  let failureDetail: string | undefined;
  let failureReason: 'create-failed' | 'error' = 'create-failed';
  try {
    const result = await evaluateAction(loadStepupConfig(), {
      payload: resolvePayload(input),
      toolName: wireToolName(input),
      cwd: input.cwd,
      provider: currentHostProvider(),
    });
    if (result.ok) {
      verdict = result.verdict;
    } else {
      failureDetail =
        result.kind === 'network'
          ? `backend unreachable${result.message ? `: ${result.message}` : ' (network/timeout)'}`
          : result.kind === 'http'
            ? `backend evaluate failed: HTTP ${result.status}${
                result.message ? ` — ${result.message}` : ''
              }`
            : 'malformed backend response';
    }
  } catch (err) {
    verdict = null;
    failureReason = 'error';
    failureDetail = `unexpected client error: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

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

  // Level 2 — backend created or reused the step-up session.
  if (!verdict?.sid || !verdict.url) {
    return {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      block,
      failure: {
        ok: false,
        reason: failureReason,
        detail:
          failureDetail ??
          'backend returned permission=2 without a session (sid/url missing)',
      },
      reasoning: backendReasoning,
    };
  }

  // Reject normally wipes Redis; keep this terminal skip path as a safety.
  if (verdict.status === 'rejected') {
    return {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED,
      block,
      resource,
      action,
      reasoning: backendReasoning,
    };
  }

  const pending =
    verdict.status === 'pending' ||
    verdict.status === null ||
    verdict.status === undefined;

  // `exist` is the backend's tab-open signal (t8 reverted): the coordinate
  // claim (SET NX) hands exactly one caller a fresh mint (exist:false) — that
  // caller opens the tab. Reused pending (exist:true) relays the URL without
  // opening; no local latch / prompt group.
  const reused = verdict.exist === true;
  let browserLaunched = false;
  if (pending && !reused) {
    openBrowser(verdict.url);
    browserLaunched = true;
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
