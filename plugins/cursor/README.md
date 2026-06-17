# transcodes-guard — Cursor IDE plugin

Risky-shell interceptor (`beforeShellExecution` / `beforeMCPExecution`) and audit MCP server for Cursor.

Shares the same step-up MFA gate logic as the Claude Code / Codex / Antigravity plugins (`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`); the only Cursor-specific surface is the hook adapter (`cursorAdapter`) and the install layout below. Cursor has no `plugin.json` concept (Marketplace bundle spec is non-public), so installation is GitHub release tarball + `install.sh`.

## Prerequisites

- **Cursor 0.46+** with the Hooks feature enabled (verify in Settings → Hooks).
- **Node.js ≥ 20** in `PATH`.
- Cursor desktop app — `beforeMCPExecution`, `stop`, `sessionStart`, `beforeSubmitPrompt` are not wired in Cursor Cloud Agents as of 2026-05.

## Installation

### Project scope (per-workspace)

```bash
git clone https://github.com/transcodings/transcodes-guard.git
cd transcodes-guard
npm install
npm run build:plugin

# In your target workspace:
cd /path/to/your/project
/path/to/transcodes-guard/plugins/cursor/install.sh
```

Writes `<project>/.cursor/hooks.json` and `<project>/.cursor/mcp.json` with absolute paths to the plugin's `dist/`.

### User scope (all workspaces)

```bash
/path/to/transcodes-guard/plugins/cursor/install.sh --user
```

Writes `~/.cursor/hooks.json` and `~/.cursor/mcp.json`. Useful if you want the gate active in every Cursor workspace.

### Trust the hooks on first run

Cursor prompts a one-time trust review the first time a hook fires. Approve once and Cursor caches the decision. Inspect at any time via the command palette → "Cursor: Review Hooks".

### `TRANSCODES_TOKEN`

The MCP server and the step-up hook authenticate against the Transcodes backend using a member MCP JWT:

```bash
export TRANSCODES_TOKEN="$(read-your-token-here)"
```

Set this in the shell that launches Cursor (or in your shell rc). If missing, the hook still **denies** danger commands but cannot start a step-up session.

## What the plugin does

| Hook event | Behaviour |
|---|---|
| `beforeShellExecution` | Two-layer check on Shell commands (regex patterns + `git ls-files` semantic on `rm -rf`). Denies with `{ permission: "deny", user_message, agent_message }` and triggers step-up MFA when matched. |
| `beforeMCPExecution` | Exact-match against `~/.claude/ai-action-tracker/user-tool-rules.json` + system tool-rules for our own MCP tools. Matcher targets `MCP:plugin_ai-action-tracker_*`. |
| `sessionStart` | Surfaces carry-over step-up state from a prior session via `additional_context`. |
| `beforeSubmitPrompt` | Detects user "auth done" prompts (`완료` / `done` / …). Cursor has no `additional_context` channel for this event, so the hook performs `consumeVerified` + `clearPending` as side effects and emits `{ continue: true }`. |
| `stop` | Reminds the model of dangling step-up sessions via `followup_message`; silently reaps orphan verified/pending records. |

The MCP server itself (registered as `transcodes-guard` in `mcp.json`) exposes the same diagnostic + audit + Transcodes-admin tools as the other plugins.

## Enabling / disabling

There is no runtime kill-switch. To turn protection off, disable or uninstall the plugin via the host's native mechanism (e.g. Cursor: remove from `hooks.json` / `mcp.json`; Claude Code: `/plugin disable transcodes-guard`).

## Wire-format quirks vs Claude Code

Cursor's hook contract differs from Claude Code in two ways the adapter encapsulates:

1. **Flat PreToolUse output** — `{ permission, user_message?, agent_message?, updated_input? }` instead of `hookSpecificOutput.permissionDecision`.
2. **Stop uses `followup_message`** — same semantic as Claude Code's `{ decision: "block", reason }`, different key name.

Neither affects gate logic; both live entirely in `packages/hook-adapters/src/cursor.ts`.

## Cross-host state sharing

State files (`~/.cache/ai-action-tracker/stepup-{verified,pending,browser-lock}.json` on Linux) are **shared with the other plugins** — a step-up verified in Claude Code carries over to Cursor and vice versa. The same-second race on `verified.json` is a known limitation (Transcodes backend's sid-replay protection is the authoritative backstop).

## Known limits / unverified slots

These four items were not validated against a live Cursor build before release. File an issue if your environment exposes a different shape:

1. **Exact `tool_name` values** — Cursor docs document the matcher names (`Shell`, MCP tool prefix) but not the literal stdin `tool_name` strings. The classifier accepts `Shell`, `Bash`, `run_command` to be safe.
2. **`beforeMCPExecution` matcher syntax** — `MCP:plugin_ai-action-tracker_*` is our best read of the docs; verify against a live event payload.
3. **`stop.followup_message` UX** — if Cursor doesn't render the reminder visibly to the model, switch the hook to silent reap by editing `hooks/stop.ts` to skip the `cursorAdapter.emitStop` call.
4. **`__TRANSCODES_GUARD_ROOT__` substitution** — `install.sh` rewrites the placeholder to an absolute path. If you hand-edit `.cursor/hooks.json` later, keep the absolute path (Cursor does not expand `$CURSOR_PROJECT_DIR` inside `command` strings).

## Troubleshooting

- **Hook doesn't fire.** Open Settings → Hooks. Ensure the path in `.cursor/hooks.json` is absolute and `node` is in Cursor's `PATH` (Cursor inherits your login shell env on macOS only if launched from a terminal).
- **`permission: deny` but no step-up URL.** Hook is denying without a token — set `TRANSCODES_TOKEN` and restart Cursor.
- **MCP tool calls hang.** Check `~/.cursor/mcp.json` was written and `dist/src/stdio.js` exists. Cursor logs MCP failures to the Output panel.
