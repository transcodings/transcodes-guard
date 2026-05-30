---
paths:
  - "plugins/*-ai-action-tracker/hooks/**/*.ts"
  - "packages/stepup-core/src/{evaluate,messages}.ts"
  - "packages/hook-adapters/src/**/*.ts"
---

# Hook Source Rules

Active when editing any plugin's `hooks/**/*.ts`, the shared `packages/stepup-core/src/{evaluate,messages}.ts`, or the host adapters under `packages/hook-adapters/`. Pair with the project-wide `CLAUDE.md` and `docs/architecture.md` §5 (hook orchestra).

## Where logic lives

```
plugins/<host>-ai-action-tracker/hooks/pre-tool-use.ts   ← thin entrypoint (~80 lines)
  └─ calls @ai-action-tracker/hook-adapters {host}Adapter for stdin parse + stdout emit
  └─ calls @ai-action-tracker/stepup-core evaluatePreToolUse for the actual gate decision
  └─ calls @ai-action-tracker/stepup-core format*{Reason,SystemMessage} for user-facing text
  └─ calls @ai-action-tracker/stepup-core {writePending, consumeVerified, clearPending}
     for the post-emit side effects (in the right order — see "asymmetric fail policy" below)
```

When changing hook behaviour, identify which layer truly owns the change:

| Change type | Edit |
|---|---|
| New wire-format field for a host | `packages/hook-adapters/src/<host>.ts` |
| Host stdin field renaming / new host | `packages/hook-adapters/src/<host>.ts` + new module |
| New decision shape / gate branch | `packages/stepup-core/src/evaluate.ts` (`GateDecision` union) |
| User-facing reason or systemMessage wording | `packages/stepup-core/src/messages.ts` |
| Triggering a different hook event entirely | `plugins/<host>-ai-action-tracker/hooks/<event>.ts` |

Plugin hook entrypoints should rarely change once the thin-entrypoint pattern is in place.

## Output channels are per-hook (Claude Code reference; Codex mirrors)

Claude Code's hook validator accepts a different JSON shape for each hook type. Mixing them silently rejects the payload. Codex adopted the same contract verbatim — the adapter currently emits identical bytes; new host adapters may diverge.

| Hook | Required stdout JSON |
|------|----------------------|
| `PreToolUse` | `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" \| "allow", permissionDecisionReason }, systemMessage? }` |
| `SessionStart` | `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }` |
| `UserPromptSubmit` | `{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }` |
| `Stop` | `{ decision: "block", reason }` — **top-level**, no `hookSpecificOutput` wrapper. Stop is excluded from the `hookEventName` enum, so wrapping rejects the payload as "Invalid input". |

Exit code is `0` everywhere — even on deny, because the decision lives in the JSON. Never use `exit 2` in hook code; that is the legacy stderr-text contract.

stderr is for human-readable 1-line summaries only (e.g. `STEPUP-PENDING sid=…` — `formatStderrTag` in `stepup-core/messages.ts`). Never log JSON or multi-line context to stderr — it shows up in the user's terminal verbatim.

## PreToolUse: asymmetric fail policy (lives in `evaluate.ts`)

`evaluatePreToolUse` enforces:

- **Before** a danger pattern match (stdin parse, classify, pattern load) → **fail-open**: returns `{ kind: "pass" }`. The hook then exits 0 with no JSON.
- **After** a danger pattern match (step-up create, browser launch, pending file write) → **fail-safe**: returns one of the `deny-*` decisions. The hook emits `permissionDecision: "deny"` JSON and exits 0.

In the hook entrypoint, **emit the deny JSON *before* any post-match work that can throw**. Order is load-bearing — if `writePending` throws, the deny must already be on stdout. The thin-entrypoint template demonstrates the order:

```ts
case "deny-stepup-pending":
  process.stdout.write(adapter.emitPreToolUse({ kind: "deny", reason, systemMessage }));
  try { writePending(decision.pending); } catch (err) { /* deny still emitted */ }
  process.stderr.write(`${formatStderrTag(decision)}\n`);
  process.exit(0);
```

## PreToolUse: fast-path MUST emit explicit allow

When `evaluatePreToolUse` returns `{ kind: "allow", ... }`, the hook MUST emit:

```ts
adapter.emitPreToolUse({ kind: "allow", reason: formatAllowReason(decision) })
```

`exit 0` alone is **not enough** — it falls through to Claude Code's default permission flow, which will check `settings.json permissions.deny` and built-in safety patterns and may still block. The explicit allow JSON is what makes the step-up gate an authority source rather than an extra safety net.

After emit, call `consumeVerified()` + `clearPending()` when `decision.consumeHere` is true (single-shot policy) and `exit 0`. The hook should never decide `consumeHere` itself — it's set by `evaluatePreToolUse` based on the rule's `consume_in_hook` field (Bash always true; MCP system rules false; MCP user rules default true).

## Hook orchestra: coordinate via the shared pending file

The four hooks per plugin cannot talk to each other or to the MCP server directly. They share state through a single file managed by `packages/stepup-core/src/pending.ts`:

- **PreToolUse** writes pending on first danger match; clears pending on fast-path consume.
- **SessionStart** reads pending to inject a carry-over context block on session resume.
- **UserPromptSubmit** reads pending to detect user "auth done" messages while a session is in flight.
- **Stop** reads pending to remind the model if the loop was left dangling.

Do not introduce a fifth hook for step-up. Extend one of the four or consume the gate via `packages/stepup-core/src/gate.ts` from a new MCP tool instead.

## Cross-plugin state coordination

Cache and data directories are resolved by `@ai-action-tracker/plugin-paths`. Claude Code receives a per-plugin `$CLAUDE_PLUGIN_DATA` directory (`~/.claude/plugins/data/<plugin-id>/`) and isolates state there; Codex, Antigravity, and Cursor share the legacy `~/.cache/ai-action-tracker/` because they expose no equivalent env var. A user who runs Claude Code and Codex side-by-side will therefore NOT see verified/pending records bleed across — Claude Code is now isolated. The other three still bleed across each other by design (same Transcodes backend).

Known limit: when two non-claude-code hosts fire concurrent hooks with system-rule MCP tools, both can read the same verified record and pass it to two different backend calls with the same `X-Step-Up-Session-Id`. Authoritative backstop is the backend's sid-replay rejection. No client-side fix planned.

## Recommended MCP tool to surface in deny/reminder text

Always recommend `poll_stepup_session_wait` (server-side long-polling, one call replaces 60 manual polls). The legacy single-shot `poll_stepup_session` exists for diagnostics; do not embed it in user-facing protocol instructions. These strings live in `packages/stepup-core/src/messages.ts` so they update once per host.

## Two-layer Bash check (lives in `evaluate.ts`)

1. Regex layer (`packages/danger-patterns/data/danger-patterns.json` system + per-host user file resolved by `dataDir()` — see `@ai-action-tracker/plugin-paths`) — fast, decidable on the command string alone.
2. `rm -rf` semantic layer — resolves each target relative to the session `cwd`, runs `git ls-files`, and blocks if any target contains tracked files. Catches relative paths like `rm -rf src` that the regex misses.

When adding a new check, decide which layer fits. Add to the regex layer for shape-recognisable danger (edit `packages/danger-patterns/data/danger-patterns.json`); add a new semantic check inside `evaluate.ts` only if the danger depends on filesystem state.

## Adding a new host

1. Implement `packages/hook-adapters/src/<host>.ts` against the `HookAdapter` interface (`parsePreToolUseStdin`, `emitPreToolUse`, …). Delegate to `claudeCodeAdapter` for any sub-method that produces identical wire format.
2. Re-export `<host>Adapter` from `packages/hook-adapters/src/index.ts`.
3. Create `plugins/<host>-ai-action-tracker/` with the manifest layout matching this host's hook discovery convention (`plugin.json`, `hooks/hooks.json`, `.mcp.json`, etc.) and thin entry hooks copied from `plugins/claude-code-ai-action-tracker/hooks/` with the adapter import swapped to `<host>Adapter`.
4. Wire the plugin into root `package.json` workspaces (already covered by the `plugins/*` glob) and add at least three CI smoke tests covering deny / allow / Stop.

The gate logic (`evaluatePreToolUse` + formatters) does not change.

## Self-verification Before "Done"

- `npm run build:plugin` passes and all four dist locations (`packages/*/dist/`, `plugins/claude-code-ai-action-tracker/dist/`, `plugins/codex-ai-action-tracker/dist/`, `plugins/antigravity-ai-action-tracker/dist/`) are committed in the same change. CI (`git diff --exit-code`) fails on any drift.
- CI hook smoke tests still pass: claude-code 7 scenarios + codex 3 scenarios. At minimum verify locally:
  - `rm -rf /` produces stdout JSON with `"permissionDecision":"deny"` (both plugins).
  - `ls` produces empty stdout and exit 0 (both plugins).
  - Stop with empty state produces empty stdout (both plugins).
- Diagnostic verification via the MCP tool `simulate_hook_invocation` — spawns the actual hook binary with a controlled payload and returns the structured diff. Prefer this over wrapping `cat ~/.cache/.../stepup-*.json` or piping the hook manually.
