# transcodes-guard — Cursor IDE plugin

**English** | [한국어](./README.ko.md)

Risky-shell interceptor (`beforeShellExecution` / `beforeMCPExecution`) and audit MCP server for Cursor.

Shares the same step-up MFA gate logic as the Claude Code / Codex / Antigravity plugins (`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`); the only Cursor-specific surface is the hook adapter (`cursorAdapter`) and the install layout below. Cursor has no `plugin.json` concept (Marketplace bundle spec is non-public), so installation is a source build (`git clone` + `npm run build:plugin`) followed by `install.sh`.

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

Writes `<project>/.cursor/hooks.json` with absolute paths to the plugin's `dist/`. `mcp.json` is **merge-aware**: it is written only if `<project>/.cursor/mcp.json` does not already exist — otherwise `install.sh` refuses to clobber it and prints the `transcodes-guard` entry for you to add manually under `mcpServers` (so your other MCP servers are preserved). If you skip that manual step, the MCP server is never registered.

### User scope (all workspaces)

```bash
/path/to/transcodes-guard/plugins/cursor/install.sh --user
```

Writes `~/.cursor/hooks.json` (and `~/.cursor/mcp.json`, subject to the same merge-aware rule). Useful if you want the gate active in every Cursor workspace. A custom destination is also supported: `install.sh --target /path/to/workspace`.

### Trust the hooks on first run

Cursor prompts a one-time trust review the first time a hook fires. Approve once and Cursor caches the decision. Inspect at any time via the command palette → "Cursor: Review Hooks".

### Save your token

The MCP server and the step-up hook authenticate against the Transcodes backend using a member MCP JWT. **Recommended** — install the CLI control plane once, then enter the token in the dashboard. It persists in `~/.transcodes/config.json` and every agent session reads it (no env var needed):

```bash
npm install -g @bigstrider/transcodes-cli
transcodes   # opens the local dashboard — URL is printed in the terminal (default port 3847; `--port N` to override)
```

Non-interactive alternative (same store): `transcodes set <token> -l <label>`.

If neither is set, the hook still **denies** danger commands but cannot start a step-up session.

## What the plugin does

| Hook event | Behaviour |
|---|---|
| `beforeShellExecution` | Two-layer check on Shell commands (regex patterns + `git ls-files` semantic on `rm -rf`). Denies with `{ permission: "deny", user_message, agent_message }` and triggers step-up MFA when matched. |
| `beforeMCPExecution` | Exact-match tool-rules (system + policy-bundle) against MCP tool calls. Served by the same hook binary as `beforeShellExecution`; the classifier accepts the `Shell` tool name alongside `Bash` / `run_command`. |
| `sessionStart` | Surfaces carry-over step-up state from a prior session via `additional_context`. |
| `beforeSubmitPrompt` | Detects user "auth done" prompts (`완료` / `done` / …). Cursor has no `additional_context` channel for this event, so the hook performs `consumeVerified` + `clearPending` as side effects and emits `{ continue: true }`. |
| `stop` | Reminds the model of dangling step-up sessions via `followup_message`; silently reaps orphan verified/pending records. |

The two gate hooks (`beforeShellExecution` / `beforeMCPExecution`) are declared `failClosed: true`. Cursor's default is fail-open — a hook crash, timeout, or invalid JSON would let the action through — so the gate explicitly blocks the action when the hook itself fails, matching Cursor's recommendation for security-critical hooks. The lifecycle hooks (`sessionStart` / `beforeSubmitPrompt` / `stop`) stay fail-open: they observe rather than block, so a failure must never interrupt normal work.

The MCP server itself (registered as `transcodes-guard` in `mcp.json`) exposes the same tools as the other plugins: **diagnostic / simulation** (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), **step-up lifecycle** (`create_stepup_session`, `poll_stepup_session_wait`), and **Transcodes admin** (member / organization / RBAC / membership / passcode / auth-device / audit / project management).

## Slash command: `/transcodes`

A single "front door" for managing the gate's own rules. Type `/transcodes` followed by a plain-language request and the agent routes it to the right guard workflow, asking for any missing detail:

```
/transcodes gate the google calendar delete tool behind step-up
/transcodes list the current rules
/transcodes is "git push --force" blocked?
```

`install.sh` copies it into `<workspace>/.cursor/commands/transcodes.md`, so it shows up when you type `/` in the Agent input. It routes to: gate an MCP tool (`add_tool_rule`), block a Bash command (`add_user_pattern`), change a rule (`update_*`), list rules, check blocking (`simulate_*`), inspect step-up state, or integrate/install the Transcodes SDK into a frontend (`get_integration_guide`).

## For AI agents

When a `beforeShellExecution` / `beforeMCPExecution` hook denies with a reason mentioning **Step-up MFA**, the command was **blocked and did NOT run**. The deny message itself carries these step-up instructions (the `sessionStart` hook only surfaces carry-over state, not the protocol). Drive the loop deterministically — do not wait for user confirmation between steps:

1. Tell the user (one short line) to complete WebAuthn in the auto-opened browser tab (use the URL from the deny message if it did not open).
2. Immediately call the MCP tool **`poll_stepup_session_wait`** with the provided `sid`. It blocks until verified or a 60s timeout.
3. On `outcome: "verified"`, retry the **original blocked command** — the hook detects the verified state locally and allows it. On `outcome: "timeout"`, ask the user to retry WebAuthn, then call the wait tool again. On `outcome: "rejected"`, the user declined step-up — tell them and do **not** retry.

Never assume the blocked command ran. Never invent an alternative. Always resume from the pending `sid`. Use `inspect_stepup_state` for a read-only snapshot. Note: on Cursor, `beforeSubmitPrompt` has no context channel, so a user "done" message is handled silently — rely on the `poll_stepup_session_wait` loop rather than expecting a prompt-side acknowledgement.

## Enabling / disabling

There is no runtime kill-switch. To turn protection off, disable or uninstall the plugin via the host's native mechanism (e.g. Cursor: remove from `hooks.json` / `mcp.json`; Claude Code: `/plugin disable transcodes-guard`). Enabling the gate is safe for an agent; disabling it is a human-only action.

## Wire-format quirks vs Claude Code

Cursor's hook contract differs from Claude Code in two ways the adapter encapsulates:

1. **Flat PreToolUse output** — `{ permission, user_message?, agent_message?, updated_input? }` instead of `hookSpecificOutput.permissionDecision`.
2. **Stop uses `followup_message`** — same semantic as Claude Code's `{ decision: "block", reason }`, different key name.

Neither affects gate logic; both live entirely in `packages/hook-adapters/src/cursor.ts`.

## Cross-host state sharing

Local step-up state lives under `~/.transcodes/state/` and is **shared across all transcodes-guard plugins** — a step-up verified in Claude Code carries over to Cursor and vice versa. The same-second race on a verified record is a known limitation (the Transcodes backend's sid-replay protection is the authoritative backstop).

## Known limits / unverified slots

These four items were not validated against a live Cursor build before release. File an issue if your environment exposes a different shape:

1. **Exact `tool_name` values** — Cursor docs document the matcher names (`Shell`, MCP tool prefix) but not the literal stdin `tool_name` strings. The classifier accepts `Shell`, `Bash`, `run_command` to be safe.
2. **`beforeMCPExecution` payload shape** — the literal stdin `tool_name` strings Cursor emits for MCP calls are documented loosely; verify against a live event payload before authoring tight tool-rules.
3. **`stop.followup_message` UX** — if Cursor doesn't render the reminder visibly to the model, switch the hook to silent reap by editing `hooks/stop.ts` to skip the `cursorAdapter.emitStop` call.
4. **`__TRANSCODES_GUARD_ROOT__` substitution** — `install.sh` rewrites the placeholder to an absolute path. If you hand-edit `.cursor/hooks.json` later, keep the absolute path (Cursor does not expand `$CURSOR_PROJECT_DIR` inside `command` strings).

## Troubleshooting

- **Hook doesn't fire.** Open Settings → Hooks. Ensure the path in `.cursor/hooks.json` is absolute and `node` is in Cursor's `PATH` (Cursor inherits your login shell env on macOS only if launched from a terminal).
- **`permission: deny` but no step-up URL.** Hook is denying without a token — install the CLI (`npm install -g @bigstrider/transcodes-cli`) and run `transcodes` to save a token in the dashboard (or `transcodes set <token> -l <label>`).
- **MCP tool calls hang.** Check `~/.cursor/mcp.json` was written and `dist/src/stdio.js` exists. Cursor logs MCP failures to the Output panel.
