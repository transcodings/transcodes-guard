---
description: How the single-shot verified step-up record is keyed, stored, consumed, and re-validated. Wiring any of this wrong silently breaks single-shot or double-consumes.
paths:
  - "packages/stepup-core/**"
---

# Step-up verified-record lifecycle

The verified record is single-use. Three independent things decide its fate: **who** consumes it, **which file** holds it, and **whether** a locally-present record is even trusted.

## Who consumes — keyed by rule, not by tool kind

`mcpConsumesInHook(rule)` (not the tool type) drives `decision.consumeHere`. Its default is keyed strictly on `rule.source` (`tool-rules.ts`): an explicit `consume_in_hook` on the rule wins; otherwise it returns `true` only when `rule.source === 'bundle'` (the `add_tool_rule` / policy-bundle source — there is no separate `'user'`/`'project'` source value). So:

- **Bash** → always hook-consumed.
- **MCP `source: 'bundle'` rule** (default `consume_in_hook = true`) → hook-consumed via the **FP-keyed** file.
- **MCP system rule** (default `consume_in_hook = false`) → consumed later by the tool handler. `execProtectedTool()` (`transcodes-mcp-tools/src/stepup-helper.ts`) reads the GLOBAL verified record, runs the per-tool callback with the sid, and consumes it in `finally`. The sid reaches the backend as the `X-Step-Up-Session-Id` header, attached via `TranscodesRequestInput.stepUpSid` in `client.ts`.

Get `consumeHere`/`fp` wrong and you silently break single-shot or double-consume.

## Which file — two store flavours, strict fp convention

- `fp === undefined` → the **GLOBAL** file (`stepup-*.json`). MCP system path. Its only parallel-reuse backstop is backend sid-replay rejection.
- `fp` = a **16-hex** string → the **FP-keyed** file (`stepup-*.<fp>.json`). Bash + bundle MCP rules. A per-command pass token that prevents cross-sub-agent contamination.

`fp` must be `fingerprintOf()` = `sha256` sliced to the first 16 hex chars of the command/tool key, where the key is the `command` (Bash) or `` `${toolName}:${JSON.stringify(toolInput)}` `` (MCP). It must match across gate → poll → retry. Use the wrong flavour or compute the key differently and the retry can never find the record.

## Whether to trust — FP fast-path re-polls the backend

On the FP-keyed fast path a locally-present `stepup-verified.<fp>.json` is **not** trusted on its own — `recheckVerifiedSid` re-polls the backend (a forgery test against a fabricated file). The verdict is asymmetric:

- backend says 2xx-non-verified, or 404 → **`reauth`** (force fresh step-up).
- network `status 0` / 5xx / 401 / 403 → **`trust`** (availability fallback — a rogue local process does not control backend reachability).

The GLOBAL/system path **skips** this recheck and relies on the handler's `X-Step-Up-Session-Id` backstop instead.

## No polling inside the hook

`requestStepup` creates the session, launches a browser (deduped via an atomic 15s fingerprint lock — `BROWSER_LOCK_TTL_MS`, `claimBrowserLaunch` — so concurrent same-command hooks share one tab), then the hook emits a deny JSON and exits 0. The **agent** drives the wait via the `poll_stepup_session_wait` MCP tool and retries the same command. Cadence/timeout live server-side so the agent cannot shorten or skip the loop.
