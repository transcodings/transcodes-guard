---
paths:
  - "packages/stepup-core/src/**/*.ts"
---

# Step-up MFA Gate Rules

Active when editing `packages/stepup-core/src/**/*.ts` — the single source of truth for the step-up MFA gate. This is the only place that talks to the Transcodes backend. New sensitive features must consume this gate, never reimplement it.

## Layering (do not invert)

`jwt.ts` → `config.ts` → `client.ts` → `session.ts` (pure) → `gate.ts` (entry) / `inspector.ts` (read-only) → `evaluate.ts` (top-level) / `messages.ts` (user-facing strings). Shared cross-process state is `pending.ts`; the single-shot verified record is `store.ts`.

`evaluatePreToolUse()` in `evaluate.ts` is the one function all four plugins call. Keep host divergence out of here — it belongs in `packages/hook-adapters/`.

## Asymmetric fail policy (security core)

`evaluatePreToolUse` flips its failure mode at the danger-match boundary:

- **Before a danger match** (stdin parse, classify, pattern load) → **fail-open**: return `{ kind: "pass" }`. The hook exits 0 with no JSON. A crash here must never block a safe command.
- **After a danger match** → **fail-safe**: return a `deny-*` decision. The hook emits `permissionDecision: "deny"`. A crash here must never silently allow a risky command.

## Kill-switch and enable/disable asymmetry

Global enable/disable lives in `~/.transcodes/config.json` `enabled` flag (CLI-owned; the one fixed path the CLI process and all four host hooks share). **Absent or corrupt = enabled (true)** — the gate must never fail silent-off. `isTrackerEnabled()` at the top of `evaluatePreToolUse` returns `{ kind: "pass" }` when disabled, neutralizing both Bash and protected-MCP blocking at one point. SessionStart primers guard on it separately.

Disabling weakens protection, so only a **human out-of-band action** may do it; an agent must not switch off its own guardrails:

- MCP `set_tracker_enabled` accepts `enabled=true` only and rejects `false` (`get_tracker_status` is read-only).
- An agent's `transcodes disable` shell attempt is blocked by the `tracker-self-disable` system pattern (see `.claude/rules/danger-patterns.md`).
- Only a human typing `transcodes disable` in a real terminal (no hook) turns it off.
- **Known limit**: the GUI dashboard's `POST /api/settings` can also disable, and that path is not gated (localhost HTTP cannot identify the caller). The broad `tracker-dashboard-launch` pattern that used to block agent-launched dashboards was **removed** (it false-matched the word `transcodes` everywhere). Full coverage needs a WebAuthn gate on the toggle itself (unimplemented).

Enabling is protection-strengthening, so an agent doing it is safe → MCP and CLI both allowed.

## Hook orchestra and shared state

Four coordinating events (Claude Code / Codex have all four; Antigravity merges SessionStart + UserPromptSubmit into PreInvocation, so three):

- **PreToolUse** — block a risky Bash / protected MCP call.
- **SessionStart** — emit the step-up protocol primer.
- **UserPromptSubmit** — detect the user's "auth done" signal.
- **Stop** — remind about a dangling pending; reap orphans.

All coordinate through one shared file `cacheDir()/stepup-pending.json`. **Do not add a new hook for step-up** — reuse this orchestra.

## Consume semantics (diverges by rule, not by kind)

The `consume_in_hook` field on a rule decides who consumes the single-shot verified record:

- **Bash** — always consumed in the hook (no follow-up handler).
- **MCP system rule** (`consume_in_hook=false`, default) — the tool handler consumes via `withStepupVerifiedSid`, passing the sid to the backend `X-Step-Up-Session-Id` header.
- **MCP user rule** (`consume_in_hook=true`, default for `add_tool_rule`) — consumed in the hook (single-shot guarantee).

**Stop orphan reap**: a `verified.json` still present at turn end cannot be "in flight" — Stop silently runs `consumeVerified()` + `clearPending()` as a backstop for a deferred consume whose handler threw before `withStepupVerifiedSid`, and to suppress false dangling reminders.

**Known race**: `verified.json` is a single file with no inter-process lock. Two parallel system-rule hooks can both pass `readVerified()` and fire two backend calls with the same sid. The authoritative backstop is the backend's sid-replay rejection — no client-side fix. If a tool can't tolerate it, re-register its rule with `consume_in_hook=true`.

## Fast-path must emit explicit allow

When a verified record is consumed, the PreToolUse hook must emit explicit `permissionDecision: "allow"` JSON. `exit 0` alone drops into the host's default permission flow, where a `settings.json` deny rule or a built-in safety pattern can override the step-up verification. Explicit allow makes the gate the authoritative source.

## Diagnostics

Prefer the MCP diagnostic tools over wrapping `cat`/`ls`: `inspect_stepup_state` (read-only structural snapshot with server-computed `age_ms` / `expired` / `ttl_ms`) and `simulate_hook_invocation` (spawns the real hook binary as a subprocess — **not a dry run**: it can consume a verified record or open a browser tab).
