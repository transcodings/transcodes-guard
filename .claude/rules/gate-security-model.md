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

MCP gate scope is not the local tool-rule registry: external `mcp__*` PreToolUse wire names reach `POST /guard/evaluate`. **The skip is an exact-set binary decision (t2, narrowed by t9)**: the step-up meta tools (`GUARD_META_TOOL_NAMES` membership — the 4-name recovery loop, bare or host-namespaced; no substring/prefix heuristics) and the host's static `builtin-exempt/*.json` list (grade ① conversation/plan + ② workspace-read only) skip the hook; everything else is gated — **non-meta built-in `tc_*` names included**, which reach evaluate like any external MCP name (the backend `StepUpSessionGuard` still enforces on the API call as well). Gating a meta tool would make deny-recovery circular. Unknown host → no exemption.

The backend `/guard/evaluate` classifier + RBAC matrix is the authority for resource/action/permission on gated calls.

## Fail-closed RBAC

The backend permission matrix is the authority: `0` = hard deny, `1` = allow without step-up (→ return `pass`), `2` = allow **with** step-up. Computing the level is fail-**closed**: any network/parse/config throw sets `level = 2`, never `1`. (A level-1 answer lets the command through entirely — counterintuitive for a "guard", hence stated.) `assertRbacCoordinate` _rejects_ rule creation when resources can't be fetched. For built-in protected tools the same fail-closed posture lives server-side: `StepUpSessionGuard` 403s on any RBAC/coordinate-lookup failure.

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

## Backend is the sole enforcer — the handler only translates

For built-in transcodes-guard MCP tools there is **no client-side backstop**: the authoritative gate for a protected built-in tool is the backend `StepUpSessionGuard` on the API call itself. (Since t9 the hook additionally gates non-meta built-ins via evaluate — but that is the same backend judging earlier, not a client enforcement point; only the step-up meta tools skip the hook.) It resolves RBAC for the route's declared coordinate and, at level 2, accepts either a verified `X-Step-Up-Session-Id` (legacy path — the plugin never sends one) or a **verified coordinate cache entry** (`stepup:{projectId}:{memberId}:{resource}:{action}` — the same cache the evaluate reuse path reads). stdio/curl hook bypass therefore changes nothing: the enforcement point is behind the API, not in front of it.

The client keeps exactly one job here: `wrapProtectedTool` (`stepup-helper.ts`) runs the handler and, when the backend envelope reports 403, translates it into a structured recovery result carrying the definition's `stepUp` coordinate. The branch is the guard's machine-readable `errorCode`: `STEP_UP_REQUIRED` (or absent) → guide create → WebAuthn → poll → retry; `RBAC_DENIED` (level 0) → guide the agent NOT to start an auth ceremony — step-up cannot elevate a level-0 deny; `RBAC_UNRESOLVED` → guide a plain retry, not auth. The wrapper performs no RBAC lookup, holds no verified memory, and attaches no step-up header, which is what makes the "client holds none" rule above exception-free. The fail-closed posture lives server-side with the enforcement.

A verified coordinate is multi-use within the backend TTL (300s); the semantics match the evaluate path's VERIFIED-reuse → allow rewrite.

## Backend URL & network envelope

Default backend URL is resolved at module load: `process.env.environment === 'dev'` → `http://localhost:3500`, else `https://api.transcodesapis.com`; `TRANSCODES_BACKEND_URL` overrides either. Shipped bundles never load an env file (the `dev:*` scripts load `.env.local` via `scripts/load-dev-env.cjs`), so they always resolve to cloud. The HTTP client reports network failure as an envelope `{ok:false, status:0}` rather than throwing — callers branch on `status === 0`.
