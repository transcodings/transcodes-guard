# transcodes-guard — Google Antigravity 2.0 plugin (Beta)

**English** | [한국어](./README.ko.md)

> ⚠️ **Beta** — the Antigravity plugin is still in beta and may crash or misbehave; the install flow and APIs may change. For production use, prefer the **Claude Code** or **Codex** plugins, the stable supported hosts.

Risky-shell interceptor (`PreToolUse` hook) and audit MCP server for Google Antigravity 2.0. Supports the desktop app (Antigravity 2.0) and the `agy` CLI.

Shares the same step-up MFA gate logic as the Claude Code and Codex plugins (`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`); the Antigravity-specific surface is a native hook adapter (`antigravityAdapter`) that speaks Antigravity's PreToolUse / PreInvocation / Stop wire format (top-level `decision`, nested `toolCall.name`/`toolCall.args` stdin, no `hookSpecificOutput` wrapper). The codex plugin's claudeCodeAdapter delegation pattern does **not** apply here.

## Prerequisites

- **Google Antigravity 2.0** (desktop app or `agy` CLI from `~/.local/bin/agy`).
- **Node.js ≥ 20**.

## Installation

Prerequisites: **Node.js ≥ 20** and **Google Antigravity 2.0** (desktop app or `agy` CLI). Install the CLI if needed:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Then run **one line** (no `cd`, no `npm install`, no build — `dist/` is committed):

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/antigravity/install.mjs && rm -rf /tmp/tg-install
```

The installer copies into `~/.gemini/config/plugins/transcodes-guard` (shared by desktop and `agy` CLI) and rewrites `__PLUGIN_DIR__` in `hooks.json` / `mcp_config.json` to absolute paths. Re-run the same one-liner to update.

> **Do not use** `agy plugin install https://github.com/transcodings/transcodes-guard` — it installs multiple host plugins from this monorepo and skips path rewriting.

**Contributors / workspace-only:** clone the repo and run `node plugins/antigravity/install.mjs --local`.

### Save your token

The MCP server and the step-up hook both authenticate against the Transcodes backend using a member MCP JWT. **Recommended** — install the CLI control plane once, then enter the token in the dashboard. It persists in `~/.transcodes/config.json` and every agent session reads it (no env var needed, survives across hosts):

```bash
npm install -g @bigstrider/transcodes-cli
transcodes   # opens the local dashboard — URL is printed in the terminal (default port 3847; `--port N` to override)
```

Non-interactive alternative (same store): `transcodes set <token> -l <label>`.

Without a token, the hook still **denies** danger commands but cannot start a step-up session — Antigravity will surface a reason telling you to provide a token.

## What the plugin does

| Component | Behaviour |
|---|---|
| `PreToolUse` hook (matcher: `run_command\|mcp_.*\|call_mcp_tool`) | Two-layer check on shell commands (regex patterns + `git ls-files` semantic on `rm -rf`) plus exact-match tool-rules on MCP calls. Denies and triggers a step-up MFA flow when matched. |
| MCP server (`transcodes-guard`) | **Diagnostic / simulation** tools (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`); **step-up lifecycle** tools (`create_stepup_session`, `poll_stepup_session_wait`); **Transcodes admin** tools (member / organization / RBAC / membership / passcode / auth-device / audit / project management). |
| `PreInvocation` hook | Plays two roles (Antigravity has no SessionStart / UserPromptSubmit). On `invocationNum=1` injects a static step-up MFA primer + any carry-over pending state. On any invocation, tails `transcript.jsonl` for the most recent user message and, if it matches the completion pattern, surfaces the pending `sid` so the agent can poll. |
| `Stop` hook | Catches dangling step-up loops by injecting a reminder via `{ decision: "continue", reason }` (Antigravity re-enters the execution loop with the reason as a system message). Silently reaps orphan verified/pending records when state is clean. |
| `rules/STEPUP.md` | Static step-up MFA protocol primer that Antigravity auto-loads into every conversation. |

## Supported surfaces (1차 출시)

- ✅ **Antigravity 2.0 desktop app** — the global installer copies the plugin into `~/.gemini/config/plugins/transcodes-guard`, which Antigravity auto-loads.
- ✅ **Antigravity CLI (`agy`)** — shares the same `~/.gemini/config/plugins/transcodes-guard` directory as the desktop app (since CLI v1.0). `agy plugin list` should then show `transcodes-guard`.
- ❌ **Managed Agents in Gemini API** — cloud-hosted, no access to the user's browser for WebAuthn. Not supported in 1차 출시.
- ❌ **Scheduled Tasks (`schedule` tool)** — hook firing behavior under cron-style invocation is undocumented. Not supported in 1차 출시.
- ❌ **Antigravity SDK (Python)** — separate language and packaging channel (`pip install google-antigravity`); out of this monorepo's scope.

## Tool matcher scope

The PreToolUse hook matcher is `run_command|mcp_.*|call_mcp_tool`, so it gates shell execution (`run_command`) **and** MCP tool calls (`mcp_*`). The `call_mcp_tool` arm catches lazy-loaded MCP calls that Antigravity dispatches through a generic wrapper — the adapter unwraps the real tool name from `args.ToolName` so tool-rules still match. File-edit tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`) are **not** gated. To extend coverage, widen the matcher regex in `hooks.json` and register the matching tool rules in `packages/danger-patterns/`.

## Slash command: `/transcodes`

A single "front door" for managing the gate's own rules. Type `/transcodes` followed by a plain-language request and the agent routes it to the right guard workflow, asking for any missing detail:

```
/transcodes gate the google calendar delete tool behind step-up
/transcodes list the current rules
/transcodes is "git push --force" blocked?
```

The installer copies the plugin's `skills/` directory into place; Antigravity auto-converts `skills/transcodes/SKILL.md` into the `/transcodes` slash command in the TUI. It routes to: gate an MCP tool (`add_tool_rule`), block a Bash command (`add_user_pattern`), change a rule (`update_*`), list rules, check blocking (`simulate_*`), inspect step-up state, or integrate/install the Transcodes SDK into a frontend (`get_integration_guide`).

## For AI agents

The step-up response protocol the agent must follow on a `PreToolUse` deny (tell the user to complete WebAuthn → call `poll_stepup_session_wait` with the `sid` → retry the same call on `verified`) lives in [`rules/STEPUP.md`](./rules/STEPUP.md), which Antigravity auto-loads into the agent's working context (it scans every plugin's `rules/` directory). Read it there — it is the single source of truth for the runtime loop.

## Enabling / disabling

There is no runtime kill-switch. To turn protection off, disable or uninstall the plugin via Antigravity's native mechanism (`agy plugin uninstall` or equivalent). Enabling the gate is safe for an agent; disabling it is a human-only action.

## Environment

Token resolution: the token is read solely from `~/.transcodes/config.json` (via the `transcodes` dashboard or `transcodes set`).

| Variable | Required | Purpose |
|---|---|---|
| `TRANSCODES_BACKEND_URL` | no | Override the default backend (`https://api.transcodesapis.com`). |

## Cross-host state sharing

Local step-up state lives under `~/.transcodes/state/` and is **shared across all transcodes-guard plugins** by design — every host talks to the same Transcodes backend, so a verified session in one host carries over to another. Concurrent use is supported but the same-second race on a verified record is a known limitation (the Transcodes backend's sid-replay protection is the authoritative backstop).

## Known limits

- **Subagent state sharing** is best-effort. A subagent's PreToolUse hook may receive a distinct `conversationId`; the shared state file is still the arbitration point, with backend sid-replay as backstop.
- **Stop hook UX** with `decision: "continue"` (which prevents turn termination — the verb is inverted relative to Claude Code's `decision: "block"`) is pending broader e2e validation.
