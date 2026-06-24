# Gate Decision — Kind Rename & Audit Scope Redesign

Status: **Draft** (planning only; no `.claude/rules/` changes)
Date: 2026-06-25
Scope: `packages/stepup-core/src/evaluate.ts`, `packages/gate-contract/src/types.ts`, `packages/gate-contract/src/messages.ts`, `packages/stepup-core/src/decision-audit.ts`, `plugins/*/hooks/pre-tool-use.ts`, `packages/hook-adapters/src/*.ts`, `packages/stepup-core/test/decision-audit.test.ts`

## 1. Background & motivation

### 1.1 The naming problem

`GateDecision` is a discriminated union keyed by `kind`. The current 6 kinds are named after *what the gate did* (a verdict action), but several names are misleading or ambiguous when read against actual code behavior:

- `pass` is overloaded — it is produced at 4 distinct sites (`evaluate.ts:332, 334, 350, 410`) with two semantically opposite meanings: "the gate did not engage" (3 sites) vs "the gate engaged and RBAC actively granted the action" (`:410`, RBAC level 1).
- `allow` is indistinguishable from `pass` to a reader — both mean "the command runs." The real distinction is *why* it runs: `allow` consumes a step-up verification record, `pass` does not.
- `deny-no-token` conflates with the `no-token` reason buried inside `deny-stepup-failure` (`gate.ts:141`).
- `deny-stepup-failure` reads as "WebAuthn authentication failed," but the code only fires it when *session creation* fails (`createStepupSession`). The user-facing authentication failure (rejected/timeout) lives in poll-tool outcomes, not in `GateDecision` at all.

### 1.2 The audit-scope problem

The current audit filter (`decisionAuditEventOf`) records **every non-`pass` decision** (5 of 6 kinds). This is over-broad against the audit log's stated purpose (PRD §6): the audit log is the *compensating control for publishing policy data* — i.e. a visibility tool for step-up MFA events, not a trace of every gate verdict.

Step-up-irrelevant decisions (policy-only allow/deny, no-token, gate-not-engaged) carry no MFA forensic value and dilute the signal. The redesign narrows audit to the two moments that matter.

## 2. Kind rename (approved)

Prefix scheme (3): `proceed-` (passes through, consumes no token) / `verified-` (passes through by consuming a step-up verification) / `block-` (denied). The suffix encodes the *audit-relevant rationale*.

| Current kind | New kind | Audit | Notes |
|---|---|---|---|
| `pass` (3 gate-uninvolved sites) | `proceed-ungated` | ❌ | gate did not engage |
| `pass` (`:410`, RBAC level 1) | `proceed-by-policy` | ❌ | RBAC actively granted, no step-up |
| `allow` | `proceed-by-verification` | ✅ | step-up verification consumed |
| `deny-no-token` | `block-no-token` | ❌ | gate inert (no token) |
| `deny-rbac-denied` | `block-by-policy` | ❌ | RBAC level 0, step-up cannot help |
| `deny-stepup-failure` | `block-stepup-create-failed` | ✅ (partial) | session creation failed — see §3 |
| `deny-stepup-pending` | `block-stepup-challenged` | ❌ | step-up triggered, awaiting poll |

### 2.1 Sub-branches each kind absorbs

The rename is a flat 7-kind union, but each kind internally covers finer branches. These branches are **not** promoted to kinds — they are rationale context. Documenting them prevents future re-conflation:

- **`proceed-ungated`** — classifier exception (fail-open, `:332`) / non-shell or unmatched (`:334`) / matched-but-not-dangerous (`:350`).
- **`proceed-by-policy`** — RBAC level 1 (`:410`). Single branch.
- **`proceed-by-verification`** — `consumeHere=false` (MCP system rule, GLOBAL store, handler revalidates sid) **or** `consumeHere=true` with `recheckVerifiedSid === 'trust'` (Bash/user rule, FP-keyed). The `recheck` helper itself returns `'trust'` in 3 sub-cases (no token / backend-verified / network-fallback) and `'reauth'` on backend non-verified or 404 (which falls through to a fresh step-up rather than producing this kind). All branches are semantically "authorized by step-up" → uniformly audited.
- **`block-no-token`** — token unresolved (`:378`). Single branch.
- **`block-by-policy`** — RBAC level 0 (`:405`). Single branch.
- **`block-stepup-create-failed`** — `failure.reason ∈ {'no-token', 'create-failed', 'error'}`. See §3 for the audit split.
- **`block-stepup-challenged`** — `browserLaunched=true` (first launch, deduped) or `false` (already launched / launch unavailable). `PendingState.status` is always `'pending'` at creation; `'verified'` only appears post-poll and is not a `GateDecision` branch.

## 3. Audit scope (approved) — narrowed to 2 events

### 3.1 Principle

> The audit log records only step-up MFA *outcomes*: an action authorized by step-up, and a step-up session explicitly refused by the backend. Step-up-irrelevant verdicts (gate uninvolved, policy-only allow/deny, no-token, step-up challenged-but-unfinished) are not audited.

Rationale: the audit log is the MFA compensating control (PRD §6). MFA-uninvolved decisions are outside that control's scope. The "step-up was triggered" event (`block-stepup-challenged`) is an *attempt*, not an *outcome* — its forensic value is low and it is high-volume, so it is excluded to keep the signal sharp.

### 3.2 Recorded events (exhaustive)

| # | Kind | Branch filter | Audit meaning |
|---|---|---|---|
| 1 | `proceed-by-verification` | (all branches) | step-up authorized the action |
| 2 | `block-stepup-create-failed` | `failure.reason === 'create-failed'` **only** | backend explicitly refused step-up session creation |

### 3.3 Excluded events (rationale)

| Kind | Why excluded |
|---|---|
| `proceed-ungated` | gate did not engage — no MFA event |
| `proceed-by-policy` | RBAC granted without step-up — no MFA event |
| `block-no-token` | gate inert (no token) — not an MFA outcome, and technically unrecordable (no token ⇒ `sendGateDecisionAudit` is a silent no-op) |
| `block-by-policy` | RBAC level 0 — step-up cannot help, no MFA event |
| `block-stepup-challenged` | step-up triggered but unfinished — an *attempt*, not an *outcome*; high-volume, low signal |
| `block-stepup-create-failed` w/ `reason='no-token'` | token race — semantically identical to `block-no-token` (excluded). Recording would double-log the same event under two kinds. |
| `block-stepup-create-failed` w/ `reason='error'` | `loadStepupConfig` failed — local config error, not a backend refusal. No backend-side forensic value. |

### 3.4 `block-stepup-create-failed` branch filter (narrow interpretation)

The approved scope records `block-stepup-create-failed` **only when `failure.reason === 'create-failed'`**. This corresponds to:
- `createStepupSession` throwing (`gate.ts:164`), or
- backend returning `ok:false` / empty `sid` / empty `browserUrl` (`gate.ts:172`) — the *explicit backend refusal*.

The other two `RequestResult` failure reasons are excluded:
- `'no-token'` (`gate.ts:141`) — token race; excluded (§3.3).
- `'error'` (`gate.ts:149`) — `loadStepupConfig` failure; local config error, not a backend refusal; excluded (§3.3).

The audit filter therefore becomes a **kind + reason** conjunction, not a kind-only check.

### 3.5 Out of scope (explicit)

User-side authentication failures (WebAuthn rejected / timeout / cancel) occur *after* `block-stepup-challenged` is emitted, during poll-tool execution. They surface as `WaitStepupResult.outcome ∈ {'verified','rejected','timeout'}` (`types.ts:131`) and are **not** represented in `GateDecision` at all. Recording them would require a separate audit hook in the poll-tool path. This is a future task, **not** part of this redesign.

## 4. Implementation plan

### 4.1 Lockstep rename (one commit)

`GateDecision` is a hand-mirrored discriminated union across the import firewall (`gate-contract` mirrors `stepup-core`). All sites must change in one commit; the drift alarm (`gate-backend/src/index.ts:63-65`) intentionally stays unmaintained so a missed mirror site becomes a compile error.

1. **`packages/stepup-core/src/evaluate.ts`** — union (`:60-96`) + 9 production sites (`:332, 334, 350, 369, 378, 405, 410, 426, 442`).
2. **`packages/gate-contract/src/types.ts`** — mirrored union (`:70-96`). Manual sync; do **not** auto-generate.
3. **`packages/gate-contract/src/messages.ts:194-208`** — `switch (decision.kind)` + each `Extract<>` formatter signature.
4. **`packages/stepup-core/src/decision-audit.ts`** — `decisionAuditEventOf` filter + `DecisionAuditEvent.decision` type (see §4.2).
5. **`packages/hook-adapters/src/*.ts`** — `kind === 'allow'` literal comparisons **outside** the switch (claude-code.ts:66, cursor.ts:48, antigravity.ts:292). ⚠️ Compiler will not catch these — `rg` is mandatory.
6. **`plugins/{claude-code,codex,cursor,antigravity}/hooks/pre-tool-use.ts`** — `switch` cases (5 each × 4 hosts = 20 case labels).
7. **`packages/stepup-core/test/decision-audit.test.ts`** — hardcoded kind literals + `Exclude<..., 'pass'>`/`=== 'pass'` guards.
8. **`packages/gate-backend/src/index.ts:63-65`** — leave the drift alarm untouched (it will fire correctly once mirrors are updated).

### 4.2 Audit filter change (same commit)

`decisionAuditEventOf` currently returns `null` only for `pass`. It must return `null` for **5 of 7 kinds**, and apply a branch filter to the 6th:

```ts
// target shape (illustrative — final code in evaluate.ts/decision-audit.ts)
export function decisionAuditEventOf(
  decision: GateDecision,
): DecisionAuditEvent | null {
  switch (decision.kind) {
    case 'proceed-by-verification':
      return { /* ... existing allow mapping ... */ };
    case 'block-stepup-create-failed':
      if (decision.failure.reason !== 'create-failed') return null;  // narrow
      return { /* ... */ };
    default:
      return null;  // proceed-ungated, proceed-by-policy, block-no-token,
                    // block-by-policy, block-stepup-challenged
  }
}
```

`DecisionAuditEvent.decision` narrows from `Exclude<GateDecision['kind'], 'pass'>` to the 2 recorded kinds.

### 4.3 Audit call consolidation (same commit or follow-up)

Each host hook currently calls `await backend.sendGateDecisionAudit(decision)` in 5 switch branches (20 call sites total). Since `sendGateDecisionAudit` internally calls `decisionAuditEventOf` (which now filters to 2 kinds), the call can be hoisted to a **single site per host** after the switch (before `process.exit(0)`), eliminating the 5× duplication. `block-stepup-challenged`'s `writePending` side-effect must remain *before* the audit call (fail-safe order: deny JSON on stdout → disk write → audit). Consolidation is behavior-preserving because the filter already gates recording.

### 4.4 Wire-format caution

`decision-audit.ts` sends `event.decision` (the kind literal) as `metadata.decision` in the `POST /v1/audit/logs` body. Renaming kinds changes this wire value. **Before merging**, confirm with the backend (`transcode-backend-nestjs-v1`, `src/audit/`) that:
- the `metadata.decision` field is free-form / not validated against an enum, or
- the backend enum is updated in lockstep.

This is the one cross-repo coordination point. If the backend validates, a wire-safe variant (separate stable wire enum mapped at the boundary) must precede the rename.

## 5. Decision log

- 2026-06-25: 7-kind rename approved (incl. `pass` split into `proceed-ungated` / `proceed-by-policy`).
- 2026-06-25: audit scope narrowed to 2 events — `proceed-by-verification` (all branches) + `block-stepup-create-failed` (`reason === 'create-failed'` only). `block-stepup-challenged` explicitly excluded as an attempt, not an outcome.
- 2026-06-25: `block-stepup-create-failed` narrow interpretation confirmed — only backend explicit refusal (`'create-failed'`); `'no-token'` and `'error'` excluded.
- 2026-06-25: poll-tool authentication-failure audit deferred (separate future task, out of scope here).
