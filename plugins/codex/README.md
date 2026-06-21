# transcodes-guard — Codex CLI plugin

**English** | [한국어](./README.ko.md)

Risky-bash interceptor (`PreToolUse` hook) and audit MCP server for OpenAI Codex CLI.

Shares the same step-up MFA gate logic as the Claude Code plugin (`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`); the only Codex-specific surface is the hook adapter and the plugin manifest.

## Prerequisites

- **A Codex CLI build with plugin + hooks support** (the `codex plugin` subcommands and the `codex_hooks` feature flag). Verify the subcommand exists with `codex plugin --help`.
- **Node.js ≥ 20**.

## Installation

### 1. Enable the hooks feature in `~/.codex/config.toml`

```toml
[features]
codex_hooks = true
```

Without this flag Codex silently ignores `plugin.json`'s `hooks` field — the gate would never run.

### 2. Install the plugin

The plugin manifest lives at `plugins/codex/.codex-plugin/plugin.json`, and the repo ships a Codex marketplace catalog at `.codex-plugin/marketplace.json` (a `local` source pointing at `../plugins/codex`). Clone the repo, build the committed `dist/`, register the catalog, then install the plugin:

```bash
git clone https://github.com/transcodings/transcodes-guard.git
cd transcodes-guard
npm install && npm run build:plugin

codex plugin marketplace add ./.codex-plugin   # registers the "bigstrider" marketplace
codex plugin add transcodes-guard@bigstrider   # installs the plugin
# or open Codex → /plugins and install "transcodes-guard" from the bigstrider marketplace
```

### 3. Trust the hook on first run

The first time the hook is about to fire, Codex prompts a trust review (`/hooks` to inspect manually). Approve once and Codex caches the trust decision. **Do not** use `--dangerously-bypass-hook-trust` — that defeats the gate's authority.

### 4. Save your token

The MCP server and the step-up hook both authenticate against the Transcodes backend using a member MCP JWT. **Recommended** — install the CLI control plane once, then enter the token in the dashboard. It persists in `~/.transcodes/config.json` and every agent session reads it (no env var needed):

```bash
npm install -g @bigstrider/transcodes-cli
transcodes   # opens the local dashboard — URL is printed in the terminal (default port 3847; `--port N` to override)
```

Non-interactive alternative (same store): `transcodes set <token> -l <label>`.

For CI or one-off overrides only, export the `TRANSCODES_TOKEN` environment variable — it **takes precedence** over the saved file:

```bash
export TRANSCODES_TOKEN="$(read-your-token-here)"
```

If neither is set, the hook still **denies** danger commands but cannot start a step-up session — Codex will surface a reason telling you to provide a token.

## What the plugin does

| Component | Behaviour |
|---|---|
| `PreToolUse` hook | Two-layer check on Bash (regex patterns + `git ls-files` semantic on `rm -rf`) plus exact-match tool-rules on MCP calls. Denies and triggers a step-up MFA flow when matched. |
| MCP server (`transcodes-guard`) | **Diagnostic / simulation** tools (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`); **step-up lifecycle** tools (`create_stepup_session`, `poll_stepup_session_wait`); **Transcodes admin** tools (member / organization / RBAC / membership / passcode / auth-device / audit / project management). |
| `SessionStart` hook | Injects a carry-over notice if a step-up session survived a session boundary. Static protocol primer lives in [`AGENTS.md`](./AGENTS.md). |
| `UserPromptSubmit` hook | Detects user "auth done" prompts (`"완료"`, `"done"`, …) and surfaces the pending `sid` so the agent can poll. |
| `Stop` hook | Catches dangling step-up loops; silently reaps orphan verified/pending records. |

## Slash command: `$transcodes`

A single "front door" for managing the gate's own rules. Codex surfaces bundled skills as **`$`-mentions** (not `/`), so invoke it as `$transcodes` followed by a plain-language request; the agent routes it to the right guard workflow, asking for any missing detail:

```
$transcodes gate the google calendar delete tool behind step-up
$transcodes list the current rules
$transcodes is "git push --force" blocked?
```

The skill ships in the plugin's `skills/` directory and is declared in `.codex-plugin/plugin.json` (`"skills": "./skills/"`), so `codex plugin add` loads it automatically — no manual copy. It requires the skills feature flag in `~/.codex/config.toml`:

```toml
[features]
skills = true
```

It routes to: gate an MCP tool (`add_tool_rule`), block a Bash command (`add_user_pattern`), change a rule (`update_*`), list rules, check blocking (`simulate_*`), inspect step-up state, or integrate/install the Transcodes SDK into a frontend (`get_integration_guide`).

## For AI agents

The step-up response protocol the agent must follow on a `PreToolUse` deny (tell the user to complete WebAuthn → call `poll_stepup_session_wait` with the `sid` → retry the same call on `verified`) lives in [`AGENTS.md`](./AGENTS.md), which Codex auto-loads into the agent's context every turn. Read it there — it is the single source of truth for the runtime loop.

## Enabling / disabling

There is no runtime kill-switch. To turn protection off, disable or uninstall the plugin via the host's native mechanism (Codex: remove from `config.toml` hooks / marketplace entry). Enabling the gate is safe for an agent; disabling it is a human-only action.

## Environment

Token resolution: the recommended store is `~/.transcodes/config.json` (via `transcodes` dashboard or `transcodes set`). When `TRANSCODES_TOKEN` is set, it **overrides** the saved file — use for CI or one-off overrides only.

| Variable | Required | Purpose |
|---|---|---|
| `TRANSCODES_TOKEN` | CI/override only (overrides saved file) | Member MCP JWT used as `x-transcodes-token`. Omit when using CLI storage. |
| `TRANSCODES_BACKEND_URL` | no | Override the default backend (`https://api.transcodesapis.com`). |
| `CLAUDE_PLUGIN_ROOT` | host-set | The Codex hook/MCP manifests resolve every command path against `${CLAUDE_PLUGIN_ROOT}`. The `simulate_hook_invocation` MCP tool additionally accepts `PLUGIN_ROOT` as a fallback when locating the hook binary. |

## Cross-host state sharing

Local step-up state lives under `~/.transcodes/state/` and is **shared across all transcodes-guard plugins** by design — every host talks to the same Transcodes backend, so a verified session in one host carries over to another. Concurrent use is supported but the same-second race on a verified record is a known limitation (the Transcodes backend's sid-replay protection is the authoritative backstop).

## Troubleshooting

- **Hook does not fire.** Check `~/.codex/config.toml` has `[features] codex_hooks = true`, then verify trust with `codex` → `/hooks`.
- **`permissionDecision: deny` but no step-up URL.** The hook is blocking without a token — install the CLI (`npm install -g @bigstrider/transcodes-cli`) and run `transcodes` to save a token in the dashboard (or `transcodes set <token> -l <label>`). For CI only, export `TRANSCODES_TOKEN`.
- **`simulate_hook_invocation` reports "CLAUDE_PLUGIN_ROOT must be set".** Neither `CLAUDE_PLUGIN_ROOT` nor `PLUGIN_ROOT` is set — this happens when the MCP server is invoked outside a plugin (e.g. `codex mcp add` with an absolute path). Export `PLUGIN_ROOT` to the plugin directory before invoking.

## License

FSL-1.1-ALv2 (see the repository root).
