# transcodes-guard — Cursor IDE plugin (Beta)

**English** | [한국어](./README.ko.md)

> ⚠️ **Beta** — the Cursor plugin is still in beta and may crash or misbehave; the install flow and APIs may change. For production use, prefer the **Claude Code** or **Codex** plugins, the stable supported hosts.

Risky-shell interceptor (`beforeShellExecution` / `beforeMCPExecution`) and audit MCP server for Cursor.

Shares the same step-up MFA gate logic as the Claude Code / Codex / Antigravity plugins (`@transcodes-guard/core/stepup`, `@transcodes-guard/core/server`); the only Cursor-specific surface is the hook adapter (`cursorAdapter`). `dist/` is committed — no build step at install time.

## Prerequisites

- **Cursor 0.46+** with the Hooks feature enabled (verify in Settings → Hooks).
- **Node.js ≥ 20** in `PATH`.
- Cursor **desktop** app — `beforeMCPExecution`, `stop`, `sessionStart`, `beforeSubmitPrompt` are not wired in Cursor Cloud Agents as of 2026-05.

## Installation

Run **one line** — no manual `cd`, no `npm install`, no build step:

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/cursor/install.mjs && rm -rf /tmp/tg-install
```

The installer:

1. Copies the plugin into `~/.cursor/plugins/local/transcodes-guard`
2. Rewrites `${CURSOR_PLUGIN_ROOT}` in hook/MCP configs to absolute paths
3. Registers `~/.cursor/hooks.json` — **merges** transcodes-guard hook entries only (other hooks preserved; stale transcodes-guard entries matched by script path are replaced)
4. Upserts `mcpServers.transcodes-guard` in `~/.cursor/mcp.json` (other MCP servers preserved)
5. Applies gate-friendly Cursor CLI settings when the config file exists — global: `~/.cursor/cli-config.json`; `--local`: `<cwd>/.cursor/cli.json` (see [CLI Agent settings](#cli-agent-settings))

Re-run the same one-liner to update in place.

**Contributors / workspace-only:** clone the repo and run `node plugins/cursor/install.mjs --local` (copies into `<cwd>/.cursor/plugins/transcodes-guard` and wires `<cwd>/.cursor/hooks.json`).

> **Do not rely on Marketplace install alone.** Cursor Marketplace / `/add-plugin` reads `.cursor-plugin/plugin.json` but does not always register user-level hooks for every Agent execution path (CLI `unrestricted` mode, allowlist bypass, Cloud Agent). Always run `install.mjs` for reliable gate wiring.
>
> **Optional — Teams / Enterprise:** an admin may import `https://github.com/transcodings/transcodes-guard` as a team marketplace and assign the plugin as Required/Optional — still run `install.mjs` on each developer machine afterward.

### Trust the hooks on first run

Cursor prompts a one-time trust review the first time a hook fires. Approve once and Cursor caches the decision. Inspect at any time via the command palette → **Cursor: Review Hooks**.

### Save your token

The MCP server and the step-up hook authenticate against the Transcodes backend using a member MCP JWT. **Recommended** — install the CLI control plane once, then enter the token in the dashboard. It persists in `~/.transcodes/config.json` and every agent session reads it (no env var needed):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
# Windows (PowerShell):
# Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install
```

Sign in with `transcodes login`.

If neither is set, the hook still **denies** danger commands but cannot start a step-up session.

### CLI Agent settings

Cursor may execute tools **without** calling `beforeShellExecution` / `beforeMCPExecution` when:

- `"approvalMode": "unrestricted"` (Run Everything), or
- Shell/MCP entries under `permissions.allow` pre-approve matching commands.

**`install.mjs` auto-applies** (when the config file already exists):

| Setting | Action |
|---|---|
| `approvalMode: "unrestricted"` | Set to `"allowlist"` |
| Broad allow entries | Remove `Shell(*)`, `Shell(**)`, `Mcp(*)`, `Mcp(*:*)` |

**Not auto-removed:** narrow entries such as `Shell(ls)` — they still bypass hooks for those commands. The installer prints a warning listing any remaining Shell/Mcp allow entries; delete ones you want the gate to intercept.

Config file path: `~/.cursor/cli-config.json` (global install) or `.cursor/cli.json` (`--local`).

## What the plugin does

| Hook event | Behaviour |
|---|---|
| `beforeShellExecution` | Two-layer check on Shell commands (regex patterns + `git ls-files` semantic on `rm -rf`). Denies with `{ permission: "deny", user_message, agent_message }` and triggers step-up MFA when matched. |
| `beforeMCPExecution` | Exact-match tool-rules (system + policy-bundle) against MCP tool calls. Served by the same hook binary as `beforeShellExecution`; the classifier accepts the `Shell` tool name alongside `Bash` / `run_command`. |
| `sessionStart` | Emits `{ additional_context }` when no MCP token is configured. |
| `beforeSubmitPrompt` | Caches the current prompt locally for the next gated tool call, then emits the mandatory `{ continue: true }`. Cache failure never blocks submission. |
| `stop` | No-op — drains stdin and exits silently. Step-up status is backend SSOT, so there is nothing local to reap or remind about; agents recover via the PreToolUse deny + `tc_poll_stepup_session_wait`. |

The two gate hooks (`beforeShellExecution` / `beforeMCPExecution`) are declared `failClosed: true`. Cursor's default is fail-open — a hook crash, timeout, or invalid JSON would let the action through — so the gate explicitly blocks the action when the hook itself fails, matching Cursor's recommendation for security-critical hooks. The lifecycle hooks (`sessionStart` / `beforeSubmitPrompt` / `stop`) stay fail-open: they observe rather than block, so a failure must never interrupt normal work.

The MCP server itself (registered as `transcodes-guard` in `mcp.json`) exposes the same tools as the other plugins: **diagnostic / simulation** (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), **step-up lifecycle** (`create_stepup_session`, `poll_stepup_session_wait`), and **Transcodes admin** (member / organization / RBAC / membership / passcode / auth-device / audit / project management).

## Slash command: `/transcodes`

A single "front door" for managing the gate's own rules. Type `/transcodes` followed by a plain-language request and the agent routes it to the right guard workflow, asking for any missing detail:

```
/transcodes gate the google calendar delete tool behind step-up
/transcodes list the current rules
/transcodes is "git push --force" blocked?
```

It lives in the plugin's `.cursor/commands/` directory, which `plugin.json` declares (`"commands": "./.cursor/commands/"`); `install.mjs` copies it into `~/.cursor/commands/`. It shows up when you type `/` in the Agent input. It routes to: gate an MCP tool (`add_tool_rule`), block a Bash command (`add_user_pattern`), change a rule (`update_*`), list rules, check blocking (`simulate_*`), inspect step-up state, or integrate/install the Transcodes SDK into a frontend (`get_integration_guide`).

## For AI agents

Open source: [transcodes-guard](https://github.com/transcodings/transcodes-guard)

When a `beforeShellExecution` / `beforeMCPExecution` hook denies with a reason mentioning **Step-up MFA**, the command was **blocked and did NOT run**. The deny message itself carries these step-up instructions (the `sessionStart` hook only surfaces carry-over state, not the protocol). Drive the loop deterministically — do not wait for user confirmation before calling the wait tool:

1. Tell the user (one short line) to complete WebAuthn in the auto-opened browser tab (use the URL from the deny message if it did not open).
2. Immediately call the MCP tool **`tc_poll_stepup_session_wait`** with the provided `sid`. It waits up to ~5 min (session TTL) until verified or timeout.
3. On **`outcome: "verified"`**, retry the **original blocked command** — the hook detects the verified state locally and allows it. On **`outcome: "timeout"`**, **`rejected`**, or **`not_found`**, tell the user (one short line) this command did not run; **skip the blocked command**; **continue other work**. Do NOT re-poll, reopen auth tabs, or retry the SAME blocked command unless the user explicitly asks to authenticate again. Do not invent an alternate command that works around the blocked action.

Never assume the blocked command ran. Never invent an alternative. Always resume from the pending `sid`. Use `tc_inspect_stepup_state` for a read-only snapshot. On Cursor, `beforeSubmitPrompt` has no context channel and does not ack step-up completion — rely on `tc_poll_stepup_session_wait`, not a user "done" message.

## Enabling / disabling

Use the **Permission checks** toggle in the local `transcodes` dashboard. When
Off, hooks skip step-up authentication and permission evaluation before any
backend request, so those tool calls are not recorded in Transcodes Log History.

## Wire-format quirks vs Claude Code

Cursor's hook contract differs from Claude Code in ways the adapter encapsulates (`packages/core/src/hosts/cursor.ts`):

1. **Flat gate output** — `beforeShellExecution` / `beforeMCPExecution` share `dist/hooks/pre-tool-use.js`, which writes `{ permission: "allow"|"deny", user_message?, agent_message?, updated_input? }` to stdout and exits `0`. Not Claude Code's `hookSpecificOutput.permissionDecision` and not exit code `2`.
2. **Stop uses `followup_message`** — same semantic as Claude Code's `{ decision: "block", reason }`, different key name.
3. **Event names vs script filenames** — Cursor events use camelCase (`beforeSubmitPrompt`, `sessionStart`); hook scripts use kebab-case files. This is not Claude Code's `user-prompt-submit` naming.

| Cursor hook event | Script (`dist/hooks/`) |
|---|---|
| `beforeShellExecution`, `beforeMCPExecution` | `pre-tool-use.js` |
| `sessionStart` | `session-start.js` |
| `beforeSubmitPrompt` | `before-submit-prompt.js` |
| `stop` | `stop.js` |

Template: `.cursor/hooks.json`. `install.mjs` replaces `${CURSOR_PLUGIN_ROOT}` with the installed plugin path.

## Cross-host state sharing

Local step-up state lives under `~/.transcodes/state/` and is **shared across all transcodes-guard plugins** — a step-up verified in Claude Code carries over to Cursor and vice versa. The same-second race on a verified record is a known limitation (the Transcodes backend's sid-replay protection is the authoritative backstop).

## Known limits

**Gate coverage**

- Only `beforeShellExecution` and `beforeMCPExecution` are gated. Built-in file-edit and other tools outside those events are not intercepted.
- Cloud Agents do not run the lifecycle hooks listed in [Prerequisites](#prerequisites).
- Narrow `permissions.allow` Shell/Mcp entries still bypass hooks even after `install.mjs` runs.

**Live Cursor e2e (file an issue if your build differs)**

1. **Exact stdin `tool_name` strings** — docs name matchers (`Shell`, MCP prefixes) loosely. The classifier accepts `Shell`, `Bash`, `run_command` defensively.
2. **`beforeMCPExecution` payload shape** — capture a live MCP hook payload before authoring tight tool-rules.
3. **`stop.followup_message` UX** — if reminders are invisible to the model, edit `hooks/stop.ts` to skip `cursorAdapter.emitStop` for silent reap only.

## Troubleshooting

- **Hook doesn't fire.** Run `install.mjs` (creates/merges `~/.cursor/hooks.json` and fixes `cli-config.json` when present). Settings → Hooks → trust transcodes-guard. Re-check `~/.cursor/cli-config.json`: installer sets `allowlist` and removes broad allows, but narrow Shell/Mcp allows still bypass hooks. Test with the **local IDE Agent**, not Cloud Agent. Ensure `node` is in Cursor's `PATH`.
- **`permission: deny` but no step-up URL.** Hook is denying without a token — install the CLI (`curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash` or Windows: `Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex`) and run `transcodes login`.
- **MCP tool calls hang.** Check `~/.cursor/mcp.json` includes `transcodes-guard` and `~/.cursor/plugins/local/transcodes-guard/dist/src/stdio.js` exists. Cursor logs MCP failures to the Output panel.

## License

FSL-1.1-ALv2 (see the repository root).
