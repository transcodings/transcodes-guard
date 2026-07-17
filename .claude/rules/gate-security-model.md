---
description: The asymmetric fail policy, fail-closed RBAC, and the availability trade the gate accepts now that the backend is the sole owner of verified state.
paths:
  - 'packages/core/src/stepup/**'
  - 'packages/gate-backend/src/mcp-tools/stepup-helper.ts'
---

# Gate security model

These are security guarantees disguised as ordinary control flow. The _position_ of each `try/catch` and each network call is load-bearing — moving one inverts the gate's default posture. Never flip a catch branch here to fail-open.

## Asymmetric fail policy (the whole model)

In `evaluatePreToolUse` (`core/src/stepup/evaluate.ts`):

- **Before** classify (stdin parse only) → **fail-open**: return `{kind:'proceed-ungated'}`. A crash here must never block a safe command.
- **After** classify (every bash command or external **MCP** `mcp__*` wire name) → **fail-safe** via `POST /guard/evaluate`. Backend unreachable → permission 2 (step-up). A crash after classify must never silently allow a risky command.

The asymmetry is pinned by `evaluate-decision-matrix.test.ts`: unreachable / malformed / non-2xx all land on the step-up side, never on allow.

Note the fail-open branch is narrower than it reads: a garbage stdin does **not** reach it. The adapters normalize an unparseable payload to an `Unknown` tool, which passes classify and gets gated. The pre-classify fail-open exists only for classify itself throwing (verified in t6 A4).

MCP gate scope is not the local tool-rule registry: external `mcp__*` PreToolUse wire names reach `POST /guard/evaluate`. **The skip is an exact-set binary decision (t2)**: built-in transcodes-guard MCP (registered `tc_*` names — `GUARD_TOOL_NAMES` membership, bare or host-namespaced; no substring/prefix heuristics) and the host's static `builtin-exempt/*.json` list (grade ① conversation/plan + ② workspace-read only) skip the hook; everything else is gated. Unknown host → no exemption.

The backend `/guard/evaluate` classifier + RBAC matrix is the authority for resource/action/permission on gated calls.

## Fail-closed RBAC

The backend permission matrix is the authority: `0` = hard deny, `1` = allow without step-up (→ return `pass`), `2` = allow **with** step-up. Computing the level is fail-**closed**: any network/parse/config throw sets `level = 2`, never `1`. (A level-1 answer lets the command through entirely — counterintuitive for a "guard", hence stated.) Mirror handler at `stepup-helper.ts` (`?? 2`); `assertRbacCoordinate` _rejects_ rule creation when resources can't be fetched.

**The client sees three outcomes, not four.** An already-verified coordinate never arrives as "permission 2 + verified": the backend's `sessionRedirectResult` rewrites a reused VERIFIED session to `decision:'allow'` + `permission: 1` before it goes on the wire, so it lands on the plain permission-1 pass. Do **not** add a `status === 'verified'` branch to `evaluate.ts` to "complete" the matrix — it would be dead code guarding a shape the backend does not emit (t3 §6).

## Verified state lives on the backend — the client holds none

`verified` is owned by the backend cache, keyed on the coordinate `stepup:{projectId}:{memberId}:{resource}:{action}` (the sid is the value, not part of the key). The client persists **nothing**: there is no verified/pending record, no fingerprint-keyed store, no atomic claim, no local re-poll. The hook asks `POST /guard/evaluate` and does what the answer says.

This is pinned, not just described: `evaluate-decision-matrix.test.ts` snapshots `~/.transcodes/state/` across a full gate run at every permission level and asserts it stays empty. A client that never writes verified state cannot be tricked into trusting a forged one.

Browser dedupe rides the backend's coordinate claim (SET NX), not a local lock: `exist` on the wire is the tab-open signal. Only the caller that minted the session gets `exist:false` and opens a tab; every other hook — concurrent or a later retry in the same pending window — receives the same reused session (`exist:true`) and relays the URL without opening. One pending session, one tab: an unconditional open would multiply tabs under concurrency and agent retries, the exact side effect the Redis claim exists to prevent.

## Availability trade — accepted, not an oversight

Because there is no local record to fall back on, **backend down = every gated call is denied**. The old "5xx → trust the local record" availability fallback died with the record it trusted.

This is the deliberate consequence of the 07-11 model, not a regression. If someone proposes restoring a fallback, the first question is: *without a local record, what exactly would you trust?*

## No side effects after the deny is on stdout

The hook emits its deny JSON, writes a one-line stderr tag, and exits 0. That is the whole tail — no persistence, no audit call, nothing that could throw between the decision and the host reading it. (Decision-audit moved server-side; `sendGateDecisionAudit` no longer exists on the client. t6 A7 pins the hook's only outbound request as `POST /v1/guard/evaluate`.)

The one network call that must happen **before** stdout is the step-up session create — the auth URL has to be in the deny message. So the rule is inverted from the old "stdout first, side effects after": **a pre-stdout network call must never be able to suppress the deny.** A failure there is caught and degrades to a `create-failed` deny (still a deny), never to a silent pass.

## Handler is the backstop, not defense-in-depth

The PreToolUse hook can be bypassed (stdio/curl), so protected backend tool handlers **re-enforce** the gate at run time via `execProtectedTool()` (`stepup-helper.ts`): tool-rule lookup + `checkRbacPermission`.

Built-in transcodes-guard MCP tools skip the hook entirely, so this handler is their *only* gate. Its verified flag lives in **process memory** (`stepup/verified-memory.ts`), not on disk — `poll_stepup_session*` calls `markStepupVerified(sid)` when the backend reports verified, and `execProtectedTool` consumes it once via `claimStepupVerified()`. Both run inside the same long-lived MCP server process, so the flag never crosses a process boundary.

This does not contradict the "no client verified state" rule above: the map only hands off a sid the **backend already verified**; it never decides verification itself. A server restart clears it (re-authenticate), `STEPUP_TTL_MS` bounds staleness, and each sid grants exactly one protected call.

## Backend URL & network envelope

Default backend URL is resolved at module load: `process.env.environment === 'dev'` → `http://localhost:3500`, else `https://api.transcodesapis.com`; `TRANSCODES_BACKEND_URL` overrides either. Shipped bundles never load an env file (the `dev:*` scripts load `.env.local` via `scripts/load-dev-env.cjs`), so they always resolve to cloud. The HTTP client reports network failure as an envelope `{ok:false, status:0}` rather than throwing — callers branch on `status === 0`.
