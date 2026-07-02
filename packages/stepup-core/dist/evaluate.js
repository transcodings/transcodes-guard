/**
 * Host-agnostic PreToolUse gate decision.
 *
 * Extracted from the original `plugins/ai-action-tracker/hooks/pre-tool-use.ts`
 * so every host's hook entrypoint can be a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision
 * shape drives Claude Code, Codex, Cursor, and Antigravity.
 *
 * Guard v3: every host tool call (except built-in transcodes-guard MCP) →
 * POST /guard/evaluate with the raw hook stdin JSON as `payload`.
 *
 * Fail policy:
 *  - Before classify (stdin parse) → return `{ kind: "proceed-ungated" }`
 *    (fail-open). Callers exit 0 with no JSON.
 *  - After classify → POST /guard/evaluate. Fail-closed: backend unreachable
 *    → permission 2 (step-up).
 */
import { DEFAULT_RBAC_RESOURCE, isTranscodesGuardWireToolName, } from '@transcodes-guard/danger-patterns';
import { loadStepupConfig } from './config.js';
import { fingerprintOf, launchStepupBrowser, } from './gate.js';
import { clearPending, readPending } from './pending.js';
import { evaluateAction } from './rbac-check.js';
import { pollStepupSession } from './session.js';
import { isExpiredAt } from './stepup-files.js';
import { claimVerified } from './store.js';
import { resolveToken } from './token-store.js';
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
};
const GUARD_EVALUATE_RULE_ID = 'guard-evaluate';
function readString(v) {
    return typeof v === 'string' ? v : undefined;
}
function resolvePayload(input) {
    if (input.rawPayload !== undefined)
        return input.rawPayload;
    return {
        tool_name: input.toolName,
        tool_input: input.toolInput,
        cwd: input.cwd,
    };
}
function extractShellCommand(input) {
    const fromInput = input.toolInput
        ?.command;
    if (typeof fromInput === 'string')
        return fromInput;
    const payload = input.rawPayload;
    if (payload === null || typeof payload !== 'object')
        return undefined;
    const p = payload;
    if (typeof p.command === 'string')
        return p.command;
    const toolInput = p.tool_input;
    if (toolInput !== null && typeof toolInput === 'object') {
        const cmd = toolInput.command;
        if (typeof cmd === 'string')
            return cmd;
    }
    const toolCall = p.toolCall;
    if (toolCall !== null && typeof toolCall === 'object') {
        const args = toolCall.args;
        if (args !== null && typeof args === 'object') {
            const a = args;
            if (typeof a.command === 'string')
                return a.command;
            if (typeof a.CommandLine === 'string')
                return a.CommandLine;
        }
    }
    return undefined;
}
function extractWireToolNames(input) {
    const names = [];
    if (input.toolName && input.toolName !== 'Unknown')
        names.push(input.toolName);
    const payload = input.rawPayload;
    if (payload !== null && typeof payload === 'object') {
        const p = payload;
        const direct = readString(p.tool_name) ??
            readString(p.toolName) ??
            readString(p.name);
        if (direct)
            names.push(direct);
        const toolCall = p.toolCall;
        if (toolCall !== null && typeof toolCall === 'object') {
            const nested = readString(toolCall.name);
            if (nested)
                names.push(nested);
        }
    }
    return names;
}
function shouldSkipGate(input) {
    return extractWireToolNames(input).some(isTranscodesGuardWireToolName);
}
function summarizePayload(payload) {
    try {
        const s = JSON.stringify(payload);
        if (s === undefined)
            return '[unserializable]';
        return s.length > 200 ? `${s.slice(0, 197)}...` : s;
    }
    catch {
        return '[unserializable]';
    }
}
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
 *   - no token → "reauth" (fail-closed, F2): the forgery test cannot run, so
 *     the record is NOT trusted — the caller falls through to BLOCK_NO_TOKEN
 *     like every other token-less path. Token-less CI fast-path smokes opt
 *     back in with TRANSCODES_GUARD_TEST_TRUST=1 (stderr-warned; never set in
 *     a real install).
 *   - config load fails (token present) → "trust": we cannot build a request,
 *     availability fallback as below.
 *   - backend authoritative (2xx) + status "verified" → "trust".
 *   - backend authoritative (2xx non-verified, or 404 unknown sid) → "reauth":
 *     the record is forged, expired, or revoked at the backend.
 *   - cannot confirm (network failure status 0, 5xx, 401/403) → "trust":
 *     availability fallback. A transient blip must not lock out a user who
 *     legitimately authenticated; the realistic forgery threat (a rogue local
 *     process) does not control backend reachability. Note `request()` reports
 *     network failures as an envelope with `status: 0` rather than throwing.
 */
async function recheckVerifiedSid(sid) {
    if (!resolveToken().token) {
        // F2: without a token the forgery re-poll cannot run, so trusting the
        // local record would let a fabricated stepup-verified file bypass MFA.
        // Fail closed; only the explicit test flag restores the old behaviour.
        if (process.env.TRANSCODES_GUARD_TEST_TRUST === '1') {
            process.stderr.write('transcodes-guard: WARNING — TRANSCODES_GUARD_TEST_TRUST=1 trusts ' +
                'the local verified record WITHOUT a backend recheck. Test/CI use ' +
                'only; never set this in a real install.\n');
            return 'trust';
        }
        return 'reauth';
    }
    let config;
    try {
        config = loadStepupConfig();
    }
    catch {
        return 'trust';
    }
    try {
        const { envelope, status } = await pollStepupSession(config, sid);
        if (status === 'verified')
            return 'trust';
        // Authoritative "not verified": reachable 2xx with a non-verified status,
        // or 404 meaning the backend never issued this sid (fabricated).
        if (envelope.ok || envelope.status === 404)
            return 'reauth';
        // status 0 (network) / 5xx / 401 / 403 → cannot confirm → availability.
        return 'trust';
    }
    catch {
        return 'trust';
    }
}
function classifyToolCall(input) {
    if (shouldSkipGate(input))
        return null;
    const payload = resolvePayload(input);
    const shellCommand = extractShellCommand(input);
    const wireNames = extractWireToolNames(input);
    const label = wireNames[0] ?? readString(input.hookEventName) ?? 'tool';
    const fingerprintKey = shellCommand ?? summarizePayload(payload);
    const summary = shellCommand
        ? shellCommand
        : `${label} ${summarizePayload(payload)}`;
    return { kind: 'tool', summary, fingerprintKey };
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
export async function evaluatePreToolUse(input) {
    let classified;
    try {
        classified = classifyToolCall(input);
    }
    catch {
        // fail-open: classify must not brick the workflow.
        return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };
    }
    if (!classified)
        return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };
    const blockCommand = classified.summary;
    const fpKey = classified.fingerprintKey;
    const block = {
        reason: 'POST /guard/evaluate',
        command: blockCommand,
        ruleId: GUARD_EVALUATE_RULE_ID,
        stepupResource: DEFAULT_RBAC_RESOURCE,
        stepupAction: 'update',
    };
    const fp = fingerprintOf(fpKey);
    // Verified fast-path: skip /evaluate when this command already passed step-up.
    // claimVerified atomically renames the record away first, so exactly one of N
    // concurrent hooks for the same command wins — the losers get null and fall
    // through to a fresh step-up rather than all consuming one MFA (F1).
    const verified = claimVerified(fp);
    if (verified) {
        if ((await recheckVerifiedSid(verified.sid)) === 'trust') {
            // The record was already removed by the claim; the caller no longer needs
            // to consume it, but still clears the paired pending record.
            // consumeHere forwards the backend's consume_in_hook verdict captured in
            // the paired pending at challenge time (F5). Absent — legacy record or
            // pending already gone — defaults to hook-consume (true).
            return {
                kind: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
                block,
                consumeHere: readPending(fp)?.consumeInHook ?? true,
                fp,
            };
        }
        // The record is not trusted — either the backend says it is no longer (or
        // never was) verified, or there is no token to ask it (F2 fail-closed). The
        // claim already discarded it; just clear the paired pending and fall through.
        clearPending(fp);
    }
    if (!resolveToken().token) {
        return { kind: GATE_DECISION_KIND.BLOCK_NO_TOKEN, block };
    }
    // Re-issue an in-flight challenge instead of creating a second session (F3).
    // If this exact command already opened a still-valid step-up, minting a new
    // sid would overwrite the pending record (last-writer-wins). The user might
    // then verify the FIRST tab, whose sid the poll tool can no longer map back
    // to this fp — the verified record lands in the GLOBAL store and the Bash
    // retry never hits the fast path. Same dedup philosophy as the browser lock.
    const existingPending = readPending(fp);
    if (existingPending &&
        existingPending.status === 'pending' &&
        !isExpiredAt(existingPending.createdAt, existingPending.expiresAt, Date.now())) {
        const browserLaunched = launchStepupBrowser(fpKey, existingPending.browserUrl);
        return {
            kind: GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED,
            block,
            sid: existingPending.sid,
            browserUrl: existingPending.browserUrl,
            browserLaunched,
            pending: existingPending,
        };
    }
    // Guard v3: POST /guard/evaluate classifies + matrix + (level 2) step-up.
    let verdict = null;
    try {
        verdict = await evaluateAction(loadStepupConfig(), {
            payload: resolvePayload(input),
            toolName: extractWireToolNames(input)[0],
            cwd: input.cwd,
            comment: `Confirm tool call: ${block.command}`,
        });
    }
    catch {
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
    const pending = {
        sid: verdict.sid,
        command: block.command,
        reason: block.reason,
        browserUrl: verdict.url,
        createdAt: Date.now(),
        expiresAt: verdict.expires_at ?? undefined,
        status: 'pending',
        fp,
        consumeInHook: verdict.consume_in_hook,
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
//# sourceMappingURL=evaluate.js.map