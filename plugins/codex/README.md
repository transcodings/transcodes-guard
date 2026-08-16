# transcodes-guard — Codex CLI plugin

**English** | [한국어](./README.ko.md)

Risky-shell interceptor (`PreToolUse`) and step-up MFA audit MCP server for OpenAI Codex CLI.

Shares the same step-up MFA gate logic as the Claude Code plugin (`@transcodes-guard/core/stepup`, `@transcodes-guard/core/server`); the only Codex-specific surface is the hook adapter and the plugin manifest.

## Prerequisites

- **A Codex CLI build with plugin + hooks support**. Verify the subcommand exists with `codex plugin --help`.
- **Node.js ≥ 20**.

## Installation

### 1. Install the plugin

The repo ships a Codex marketplace catalog at `.agents/plugins/marketplace.json` (pointing at `./plugins/codex`), and `dist/` is committed. `codex plugin marketplace add` accepts a GitHub repo directly (Codex clones it for you), so **no manual clone or build is needed**:

```bash
codex plugin marketplace add transcodings/transcodes-guard   # registers the "bigstrider" marketplace
codex plugin add transcodes-guard@bigstrider                 # installs the plugin
# or open Codex → /plugins and install "transcodes-guard" from the bigstrider marketplace
```

### 2. Trust the hook on first run

The first time the hook is about to fire, Codex prompts a trust review (`/hooks` to inspect manually). Approve once and Codex caches the trust decision. **Do not** use `--dangerously-bypass-hook-trust` — that defeats the gate's authority.

### 3. Save your token

The MCP server and the step-up hook both authenticate against the Transcodes backend using a member MCP JWT. **Recommended** — install the CLI control plane once, then enter the token in the dashboard. It persists in `~/.transcodes/config.json` and every agent session reads it (no env var needed):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
# Windows (PowerShell):
# Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install
```

Sign in with `transcodes login`.

Without a token, the hook still **denies** danger commands but cannot start a step-up session — Codex will surface a reason telling you to provide a token.

## What the plugin does

| Component | Behaviour |
|---|---|
| `PreToolUse` | Two-layer check on Bash (regex patterns + `git ls-files` semantic on `rm -rf`) plus exact-match tool-rules on MCP calls. Denies and triggers a step-up MFA flow when matched. |
| MCP server (`transcodes-guard`) | **Diagnostic / simulation** tools (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`); **step-up lifecycle** tools (`create_stepup_session`, `poll_stepup_session_wait`); **Transcodes admin** tools (member / organization / RBAC / membership / passcode / auth-device / audit / project management). |
| `SessionStart` hook | Injects a carry-over notice if a step-up session survived a session boundary. Static protocol primer lives in [`AGENTS.md`](./AGENTS.md). |
| `UserPromptSubmit` hook | Caches the current prompt by Codex `session_id` + `turn_id` so the next gated tool call can send a short current-turn `tasks` summary. Silent and fail-open. |
| `Stop` hook | No-op — drains stdin and exits silently. Step-up status is backend SSOT, so there is nothing local to reap or remind about; agents recover via the PreToolUse deny + `tc_poll_stepup_session_wait`. |

## `$`-mention: `$transcodes`

A single front door for Persona, gate, Admin API, and SDK workflows. Codex surfaces bundled skills as **`$`-mentions** (not `/`); invoke it or make a matching natural-language request:

```
$transcodes optimize my support Persona
$transcodes gate the google calendar delete tool behind step-up
```

The skill ships in the plugin's `skills/` directory and is declared in `.codex-plugin/plugin.json` (`"skills": "./skills/"`), so `codex plugin add` loads it automatically — no manual copy.

It can create, edit, or Diet a Persona; manage gate rules and step-up state; use the Admin API; or integrate the Transcodes SDK.

## For AI agents

Open source: [transcodes-guard](https://github.com/transcodings/transcodes-guard)

The step-up response protocol the agent must follow on a step-up deny lives in [`AGENTS.md`](./AGENTS.md), which Codex auto-loads into the agent's context every turn. Read it there — it is the single source of truth for the runtime loop.

## Enabling / disabling

Use the **Permission checks** toggle in the local `transcodes` dashboard. When
Off, hooks skip step-up authentication and permission evaluation before any
backend request, so those tool calls are not recorded in Transcodes Log History.

## Environment

Token resolution: the token is read solely from `~/.transcodes/config.json` (via `transcodes login`).

| Variable | Required | Purpose |
|---|---|---|
| `TRANSCODES_BACKEND_URL` | no | Override the default backend (`https://api.transcodesapis.com`). |
| `PLUGIN_ROOT` | host-set | Used by Codex hook commands to locate the plugin root. The MCP server uses `cwd: "."` plus relative paths. `simulate_hook_invocation` can also use this as a fallback when run outside the plugin. |

## Cross-host state sharing

Local step-up state lives under `~/.transcodes/state/` and is **shared across all transcodes-guard plugins** by design — every host talks to the same Transcodes backend, so a verified session in one host carries over to another. Concurrent use is supported but the same-second race on a verified record is a known limitation (the Transcodes backend's sid-replay protection is the authoritative backstop).

## Troubleshooting

- **Hook does not fire.** Check the plugin is installed/enabled, then verify trust with `codex` → `/hooks`.
- **`$transcodes` not available.** Check the plugin is installed/enabled and listed by `codex plugin list`; Codex exposes bundled skills through `/skills` and `$` mentions.
- **`permissionDecision: deny` but no step-up URL.** The hook is blocking without a token — install the CLI (`curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash` or Windows: `Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex`) and run `transcodes login`.
- **`simulate_hook_invocation` reports "CLAUDE_PLUGIN_ROOT (or PLUGIN_ROOT for Codex) must be set".** `PLUGIN_ROOT` is not set — this happens when the MCP server is invoked outside a plugin (e.g. `codex mcp add` with an absolute path). Export `PLUGIN_ROOT` to the plugin directory before invoking.

## License

FSL-1.1-ALv2 (see the repository root).
