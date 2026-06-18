# transcodes-guard — Google Antigravity 2.0 plugin

Risky-shell interceptor (`PreToolUse` hook) and audit MCP server for Google Antigravity 2.0. Supports the desktop app (Antigravity 2.0) and the `agy` CLI.

Shares the same step-up MFA gate logic as the Claude Code and Codex plugins (`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`); the Antigravity-specific surface is a native hook adapter (`antigravityAdapter`) that speaks Antigravity's PreToolUse / PreInvocation / Stop wire format (top-level `decision`, nested `toolCall.name`/`toolCall.args` stdin, no `hookSpecificOutput` wrapper). The codex plugin's claudeCodeAdapter delegation pattern does **not** apply here — see [`docs/research/multi-tool-hook-plugin-support.md`](../../docs/research/multi-tool-hook-plugin-support.md) v3 for the spec-vs-research reconciliation.

## Prerequisites

- **Google Antigravity 2.0** (desktop app or `agy` CLI from `~/.local/bin/agy`).
- **Node.js ≥ 20**.

## Installation

To install the plugin, use the automated installer script which resolves target paths and configures absolute file system paths automatically:

1. **Global** — available to all workspaces (Desktop App/IDE and CLI):
   ```bash
   node plugins/antigravity/install.mjs
   ```
2. **Workspace** — available only inside the workspace folder:
   ```bash
   node plugins/antigravity/install.mjs --local
   ```

On Antigravity CLI: `agy plugin list` should now show `transcodes-guard`.

### Export `TRANSCODES_TOKEN`

The MCP server and the step-up hook both authenticate against the Transcodes backend using a member MCP JWT:

```bash
export TRANSCODES_TOKEN="$(read-your-token-here)"
```

If the variable is missing, the hook still **denies** danger commands but cannot start a step-up session — Antigravity will surface a "set TRANSCODES_TOKEN" reason.

## What the plugin does

| Component | Behaviour |
|---|---|
| `PreToolUse` hook (matcher: `run_command`) | Two-layer check on shell commands (regex patterns + `git ls-files` semantic on `rm -rf`). Denies and triggers a step-up MFA flow when matched. |
| MCP server (`transcodes-guard`) | Diagnostic + audit tools (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), Transcodes admin tools, step-up session lifecycle tools (`create_stepup_session`, `poll_stepup_session_wait`). |
| `PreInvocation` hook | Plays two roles (Antigravity has no SessionStart / UserPromptSubmit). On `invocationNum=1` injects a static step-up MFA primer + any carry-over pending state. On any invocation, tails `transcript.jsonl` for the most recent user message and, if it matches the completion pattern, surfaces the pending `sid` so the agent can poll. |
| `Stop` hook | Catches dangling step-up loops by injecting a reminder via `{ decision: "continue", reason }` (Antigravity re-enters the execution loop with the reason as a system message). Silently reaps orphan verified/pending records when state is clean. |
| `rules/STEPUP.md` | Static step-up MFA protocol primer that Antigravity auto-loads into every conversation. |

## Supported surfaces (1차 출시)

- ✅ **Antigravity 2.0 desktop app** — plugin auto-loads from `~/.gemini/config/plugins/`.
- ✅ **Antigravity CLI (`agy`)** — same plugin directory; staging at `~/.gemini/antigravity-cli/plugins/<name>/` happens automatically when installed via `agy plugin install`.
- ❌ **Managed Agents in Gemini API** — cloud-hosted, no access to the user's browser for WebAuthn. Not supported in 1차 출시.
- ❌ **Scheduled Tasks (`schedule` tool)** — hook firing behavior under cron-style invocation is undocumented. Not supported in 1차 출시.
- ❌ **Antigravity SDK (Python)** — separate language and packaging channel (`pip install google-antigravity`); out of this monorepo's scope.

## Tool matcher scope

The PreToolUse hook gates **only `run_command`** (shell execution). File-edit tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`) and MCP tool calls are **not** gated in 1차 출시. To extend coverage, add the new tool name to the matcher regex in `hooks.json` and, where applicable, register new tool rules in `packages/danger-patterns/`.

## Enabling / disabling

There is no runtime kill-switch. To turn protection off, disable or uninstall the plugin via Antigravity's native mechanism (`agy plugin uninstall` or equivalent).

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `TRANSCODES_TOKEN` | yes (for step-up to work) | Member MCP JWT used as `x-transcodes-token`. |
| `TRANSCODES_BACKEND_URL` | no | Override the default backend (`https://api.transcodesapis.com`). |

## Cross-host state sharing

The plugin's local state files (`~/.cache/ai-action-tracker/stepup-{verified,pending,browser-lock}.json` on Linux; equivalent OS paths on macOS / Windows) are **shared with the Claude Code and Codex plugins** by design — all three talk to the same Transcodes backend and a verified session in one host carries over to the others. Concurrent use of multiple plugins is supported but same-second races on `verified.json` are a known limitation (the Transcodes backend's sid-replay protection is the authoritative backstop).

## Known limits

- **MCP tool naming convention** in Antigravity 2.0 is undocumented — the PreToolUse matcher only covers `run_command` in 1차 출시. See [`docs/research/antigravity-e2e-findings.md`](../../docs/research/antigravity-e2e-findings.md) #1.
- **Subagent state sharing** is best-effort. A subagent's PreToolUse hook may receive a distinct `conversationId`; the shared cache file is still the arbitration point, with backend sid-replay as backstop.
- **Stop hook UX** with `decision: "continue"` is pending validation — see e2e findings doc #4.
- **`${CLAUDE_PLUGIN_ROOT}` equivalent** in Antigravity is unspecified; this plugin currently uses relative paths (`./dist/...`) on the assumption that Antigravity spawns hook commands with the plugin directory as CWD. If this turns out to be wrong, the install instructions above will be updated to absolute paths via an install script. See e2e findings doc #2.
