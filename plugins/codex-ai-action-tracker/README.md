# ai-action-tracker — Codex CLI plugin

Risky-bash interceptor (`PreToolUse` hook) and audit MCP server for OpenAI Codex CLI.

Shares the same step-up MFA gate logic as the Claude Code plugin (`@ai-action-tracker/stepup-core`, `@ai-action-tracker/mcp-server-core`); the only Codex-specific surface is the hook adapter and the plugin manifest.

## Prerequisites

- **Codex CLI v0.114.0+** (Hooks went GA around v0.130). Verify with `codex --version`.
- **Node.js ≥ 20**.

## Installation

### 1. Enable the hooks feature in `~/.codex/config.toml`

```toml
[features]
codex_hooks = true
```

Without this flag Codex silently ignores `plugin.json`'s `hooks` field — the gate would never run.

### 2. Install the plugin

Either:

```bash
# Marketplace (preferred once published)
codex plugin install ai-action-tracker

# Or local clone (for development / pre-release)
git clone https://github.com/transcodings/ai-action-tracker-mcp.git
codex plugin install file://$PWD/ai-action-tracker-mcp/plugins/codex-ai-action-tracker
```

### 3. Trust the hook on first run

The first time the hook is about to fire, Codex prompts a trust review (`/hooks` to inspect manually). Approve once and Codex caches the trust decision. **Do not** use `--dangerously-bypass-hook-trust` — that defeats the gate's authority.

### 4. Export `TRANSCODES_TOKEN`

The MCP server and the step-up hook both authenticate against the Transcodes backend using a member MCP JWT:

```bash
export TRANSCODES_TOKEN="$(read-your-token-here)"
```

If the variable is missing, the hook still **denies** danger commands but cannot start a step-up session — Codex will surface a "set TRANSCODES_TOKEN" reason.

## What the plugin does

| Component | Behaviour |
|---|---|
| `PreToolUse` hook | Two-layer check on Bash (regex patterns + `git ls-files` semantic on `rm -rf`) plus exact-match tool-rules on MCP calls. Denies and triggers a step-up MFA flow when matched. |
| MCP server (`ai-action-tracker`) | Diagnostic + audit tools (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), Transcodes admin tools (`retire_member`, `set_role_permissions`, `passcode_create`, …), step-up session lifecycle tools (`create_stepup_session`, `poll_stepup_session_wait`). |
| `SessionStart` hook | Injects a carry-over notice if a step-up session survived a session boundary. Static protocol primer lives in [`AGENTS.md`](./AGENTS.md). |
| `UserPromptSubmit` hook | Detects user "auth done" prompts (`"완료"`, `"done"`, …) and surfaces the pending `sid` so the agent can poll. |
| `Stop` hook | Catches dangling step-up loops; silently reaps orphan verified/pending records. |

## Enabling / disabling

Codex has no single command that unloads hooks and the MCP server together, so use the runtime kill-switch — it works the same across every host:

```
transcodes disable     # gate OFF — Bash + MCP tool calls pass without step-up
transcodes enable      # gate ON
transcodes status      # show gate state + token
```

Disabling is intentionally a human, out-of-band action — an agent must not be able to switch off its own guardrails. So the MCP tool `set_tracker_enabled` can only **re-enable** the gate (it refuses `enabled=false`), and an agent that tries to run `transcodes disable` via the shell is itself step-up-gated by the `tracker-self-disable` pattern. `get_tracker_status` is read-only. The flag lives in `~/.transcodes/config.json`; a missing flag means enabled.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `TRANSCODES_TOKEN` | yes (for step-up to work) | Member MCP JWT used as `x-transcodes-token`. |
| `TRANSCODES_BACKEND_URL` | no | Override the default backend (`https://api.transcodesapis.com`). |
| `CLAUDE_PLUGIN_ROOT` / `PLUGIN_ROOT` | host-set | Codex sets `PLUGIN_ROOT`; the plugin also accepts the Claude Code alias `CLAUDE_PLUGIN_ROOT`. Used by `simulate_hook_invocation` to locate the hook binary. |

## Cross-host state sharing

The plugin's local state files (`~/.cache/ai-action-tracker/stepup-{verified,pending,browser-lock}.json` on Linux; equivalent OS paths on macOS / Windows) are **shared with the Claude Code plugin** by design — both plugins talk to the same Transcodes backend and a verified session in one host carries over to the other. Concurrent use of both plugins is supported but the same-second race on `verified.json` is a known limitation (the Transcodes backend's sid-replay protection is the authoritative backstop).

## Troubleshooting

- **Hook does not fire.** Check `~/.codex/config.toml` has `[features] codex_hooks = true`, then verify trust with `codex` → `/hooks`.
- **`permissionDecision: deny` but no step-up URL.** The hook is blocking without a token — set `TRANSCODES_TOKEN`.
- **`simulate_hook_invocation` reports "CLAUDE_PLUGIN_ROOT must be set".** Codex sets `PLUGIN_ROOT` in plugin scope, but if you invoked the MCP server outside of a plugin (e.g. `codex mcp add` with an absolute path), neither is set. Export `PLUGIN_ROOT` to the plugin directory before invoking.
