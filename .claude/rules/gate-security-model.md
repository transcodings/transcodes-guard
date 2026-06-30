---
description: The asymmetric fail policy, fail-closed RBAC, and the no-side-effects-before-stdout contract that make up the gate's security posture.
paths:
  - 'packages/stepup-core/**'
  - 'packages/transcodes-mcp-tools/src/stepup-helper.ts'
---

# Gate security model

These are security guarantees disguised as ordinary control flow. The _position_ of each `try/catch` and each network call is load-bearing — moving one inverts the gate's default posture. Never flip a catch branch here to fail-open.

## Asymmetric fail policy (the whole model)

In `evaluatePreToolUse` (`stepup-core/src/evaluate.ts`):

- **Before** classify (stdin parse only) → **fail-open**: return `{kind:'proceed-ungated'}`. A crash here must never block a safe command.
- **After** classify (every bash command or external **MCP** `mcp__*` wire name) → **fail-safe** via `POST /guard/evaluate`. Backend unreachable → permission 2 (step-up). A crash after classify must never silently allow a risky command.

MCP gate scope is no longer the local tool-rule registry: external `mcp__*` PreToolUse wire names reach `POST /guard/evaluate`. **Built-in transcodes-guard MCP** (`mcp__*transcodes-guard*`) skips the hook — `execProtectedTool` in the handler is the backstop (tool-rule + `checkRbacPermission`). User/project tool-rules remain for handler backstop, policy documentation, and optional legacy bundle rules — not for deciding whether the hook runs on external MCP tools.

The backend `/guard/evaluate` classifier + RBAC matrix is the authority for resource/action/permission on gated MCP calls.

## Fail-closed RBAC

The backend permission matrix is the authority: `0` = hard deny, `1` = allow without step-up (→ return `pass`), `2` = allow **with** step-up. Computing the level is fail-**closed**: any network/parse/config throw sets `level = 2`, never `1`. (A level-1 answer lets the command through entirely — counterintuitive for a "guard", hence stated.) Mirror handler at `stepup-helper.ts` (`?? 2`); `assertRbacCoordinate` _rejects_ rule creation when resources can't be fetched.

## No side effects before the deny is on stdout

`evaluatePreToolUse` intentionally performs **no** persistence — the caller does it, in this order:

1. Emit the deny JSON to stdout **first**.
2. _Then_ `writePending(decision.pending)` — so a throw in the disk write can't suppress the deny.
3. On allow, the caller decides `consumeVerified`/`clearPending` from `decision.consumeHere`.

The **fire-and-forget** backend call (`sendGateDecisionAudit`) also runs **only after** stdout. It never rejects. The decision audit uses a sub-second timeout (`DECISION_AUDIT_TIMEOUT_MS = 1000`), no-ops for `pass`/no-token, and **omits the raw command string** (sends only fp/coordinates/ruleId — data minimization).

## Critical path is evaluate-only

The PreToolUse hot path calls `POST /guard/evaluate` for every Bash command and external `mcp__*` wire name. There is no local pattern registry or policy-bundle cache on the hook path. Built-in transcodes-guard MCP skips the hook; `execProtectedTool` uses system `tool-rules.json` + `checkRbacPermission` as the handler backstop.

## Policy-bundle integrity (shared with the backend)

`manifest.sha384` = hex SHA-384 of the **canonical JSON** (recursively key-sorted, compact, no whitespace, `undefined` dropped) of `{schemaVersion, revision, rules}` **without** the manifest field. Verify hash **first**, schema **second** ("verify before activate"). Bump `GUARD_POLICY_BUNDLE_SCHEMA_VERSION` on any bundle shape change. The read path re-checks shape only (not the hash), because integrity was verified at atomic write time.

## Handler is the backstop, not defense-in-depth

The PreToolUse hook can be bypassed (stdio/curl), so protected backend tool handlers **re-enforce** the gate at run time via `execProtectedTool()` (`stepup-helper.ts`). After a successful level-2 run, the verified record is consumed exactly once (`consumeVerified()` + `clearPending()` in `finally`) — step-up is single-use per protected call, not a session.

## Backend URL & network envelope

Default backend URL is resolved at module load: `process.env.environment === 'dev'` → `http://localhost:3500`, else `https://api.transcodesapis.com`; `TRANSCODES_BACKEND_URL` overrides either. Shipped bundles never load an env file (the `dev:*` scripts load `.env.local` via `scripts/load-dev-env.cjs`), so they always resolve to cloud. The HTTP client reports network failure as an envelope `{ok:false, status:0}` rather than throwing — callers branch on `status === 0`.
