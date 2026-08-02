# transcodes-guard — Google Antigravity 2.0 plugin (Beta)

**English** | [한국어](./README.ko.md)

> ⚠️ **Beta** — the Antigravity plugin is still in beta and may crash or misbehave; the install flow and APIs may change. For production use, prefer the **Claude Code** or **Codex** plugins, the stable supported hosts.

Risky-shell interceptor (gate hook) and audit MCP server for Google Antigravity 2.0. Supports the desktop app (Antigravity 2.0) and the `agy` CLI.

Shares the same step-up MFA gate logic as the Claude Code and Codex plugins (`@transcodes-guard/core/stepup`, `@transcodes-guard/core/server`); the Antigravity-specific surface is a native hook adapter (`antigravityAdapter`) that speaks Antigravity's gate / PreInvocation / Stop wire format (top-level `decision`, nested `toolCall.name`/`toolCall.args` stdin, no `hookSpecificOutput` wrapper). The codex plugin's claudeCodeAdapter delegation pattern does **not** apply here.

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

The installer copies into `~/.gemini/config/plugins/transcodes-guard` (shared by desktop and `agy` CLI) and rewrites `__PLUGIN_DIR__` in `hooks.json` / `mcp_config.json` to absolute paths. Re-run the same one-liner to update in place. Only the `transcodes-guard` plugin directory is touched — other plugins under `~/.gemini/config/plugins/` are preserved. Does **not** wipe `~/.transcodes/` (token, step-up state, policy cache).

On global install, when `~/.gemini/antigravity-cli/settings.json` already exists, the installer also sets gate-friendly **agy CLI** preferences (`toolPermission` → `request-review`, removes broad `command(*)` / `mcp(*)` / `unsandboxed(*)` allow entries). See [CLI vs Desktop settings](#cli-vs-desktop-settings).

> **Do not use** `agy plugin install https://github.com/transcodings/transcodes-guard` — it registers **both** Antigravity and Claude Code adapters in `import_manifest.json` (wire-format mismatch). `install.mjs` removes duplicate `source: "claude-code"` rows only; it does not synthesize new manifest entries.

If **`agy plugin list` still shows transcodes-guard twice** (`antigravity` + `claude-code`), re-run the one-liner above. If the duplicate persists, run `agy plugin uninstall transcodes-guard` and install again.

**Contributors / workspace-only:** clone the repo and run `node plugins/antigravity/install.mjs --local`.

### Save your token

The MCP server and the step-up hook both authenticate against the Transcodes backend using a member MCP JWT. **Recommended** — install the CLI control plane once, then enter the token in the dashboard. It persists in `~/.transcodes/config.json` and every agent session reads it (no env var needed, survives across hosts):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
# Windows (PowerShell):
# irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install
```

Sign in with `transcodes login`.

Without a token, the hook still **denies** danger commands but cannot start a step-up session — Antigravity will surface a reason telling you to provide a token.

### CLI vs Desktop settings

Antigravity has **two separate permission surfaces**. `install.mjs` auto-fixes only the **agy CLI** JSON file when it already exists.

| Surface | Location | What install.mjs does |
|---|---|---|
| **agy CLI** | `~/.gemini/antigravity-cli/settings.json` | When present: `toolPermission: "always-proceed"` → `"request-review"`; removes `command(*)`, `mcp(*)`, `unsandboxed(*)` from `permissions.allow`; warns on remaining `command`/`mcp`/`unsandboxed` allows and on `proceed-in-sandbox`. |
| **Desktop app** | Settings → Advanced → Terminal (UI) | **Not modified.** Terminal Command Auto Execution (Off / Auto / **Turbo**) and Allow/Deny lists live in the desktop UI — no stable on-disk path in this repo yet. Avoid **Turbo** unless your Deny list is tight. |

**Not fixable by install:** `agy --dangerously-skip-permissions` (session flag — do not use with transcodes-guard). Gate hooks are wired in the plugin bundle (`hooks.json` matcher); file-edit tools outside the matcher stay ungated until you widen the matcher.

Edit CLI settings interactively with `/config` or `/permissions` inside `agy`. Official docs: [CLI settings](https://antigravity.google/docs/cli/settings), [permissions](https://antigravity.google/docs/cli/permissions).

## What the plugin does

| Component | Behaviour |
|---|---|
| Gate hook (matcher: `run_command\|mcp_.*\|call_mcp_tool`) | Two-layer check on shell commands (regex patterns + `git ls-files` semantic on `rm -rf`) plus exact-match tool-rules on MCP calls. Denies and triggers a step-up MFA flow when matched. |
| MCP server (`transcodes-guard`) | **Diagnostic / simulation** tools (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`); **step-up lifecycle** tools (`create_stepup_session`, `poll_stepup_session_wait`); **Transcodes admin** tools (member / organization / RBAC / membership / passcode / auth-device / audit / project management). |
| `PreInvocation` hook | Plays two roles because Antigravity has no SessionStart / UserPromptSubmit. On 0-indexed `invocationNum=0` it injects the static step-up primer; it also caches the latest transcript user prompt for current-turn `tasks`, with a bounded first-invocation retry for transcript lag. |
| `Stop` hook | No-op — drains stdin and exits silently. Step-up status is backend SSOT, so there is nothing local to reap or remind about; agents recover via the pre-tool-use deny + `tc_poll_stepup_session_wait`. |
| `rules/STEPUP.md` | Static step-up MFA protocol primer that Antigravity auto-loads into every conversation. |

## Supported surfaces (1차 출시)

- ✅ **Antigravity 2.0 desktop app** — the global installer copies the plugin into `~/.gemini/config/plugins/transcodes-guard`, which Antigravity auto-loads.
- ✅ **Antigravity CLI (`agy`)** — shares the same `~/.gemini/config/plugins/transcodes-guard` directory as the desktop app (since CLI v1.0). `agy plugin list` should then show `transcodes-guard`.
- ❌ **Managed Agents in Gemini API** — cloud-hosted, no access to the user's browser for WebAuthn. Not supported in 1차 출시.
- ❌ **Scheduled Tasks (`schedule` tool)** — hook firing behavior under cron-style invocation is undocumented. Not supported in 1차 출시.
- ❌ **Antigravity SDK (Python)** — separate language and packaging channel (`pip install google-antigravity`); out of this monorepo's scope.

## Tool matcher scope

The hook matcher is `run_command|mcp_.*|call_mcp_tool`, so it gates shell execution (`run_command`) **and** MCP tool calls (`mcp_*`). The `call_mcp_tool` arm catches lazy-loaded MCP calls that Antigravity dispatches through a generic wrapper — the adapter unwraps the real tool name from `args.ToolName` so tool-rules still match. File-edit tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`) are **not** gated. To extend coverage, widen the matcher regex in `hooks.json` and register the matching tool rules in `packages/core/src/patterns/`.

## Slash command: `/transcodes`

A single "front door" for managing the gate's own rules. Type `/transcodes` followed by a plain-language request and the agent routes it to the right guard workflow, asking for any missing detail:

```
/transcodes gate the google calendar delete tool behind step-up
/transcodes list the current rules
/transcodes is "git push --force" blocked?
```

The installer copies the plugin's `skills/` directory into place; Antigravity auto-converts `skills/transcodes/SKILL.md` into the `/transcodes` slash command in the TUI. It routes to: gate an MCP tool (`add_tool_rule`), block a Bash command (`add_user_pattern`), change a rule (`update_*`), list rules, check blocking (`simulate_*`), inspect step-up state, or integrate/install the Transcodes SDK into a frontend (`get_integration_guide`).

## For AI agents

Open source: [transcodes-guard](https://github.com/transcodings/transcodes-guard)

The step-up response protocol the agent must follow on a step-up deny lives in [`rules/STEPUP.md`](./rules/STEPUP.md), which Antigravity auto-loads into the agent's working context (it scans every plugin's `rules/` directory). Read it there — it is the single source of truth for the runtime loop.

## Enabling / disabling

Use the **Permission checks** toggle in the local `transcodes` dashboard. When
Off, hooks skip step-up authentication and permission evaluation before any
backend request, so those tool calls are not recorded in Transcodes Log History.

## Environment

Token resolution: the token is read solely from `~/.transcodes/config.json` (via `transcodes login`).

| Variable | Required | Purpose |
|---|---|---|
| `TRANSCODES_BACKEND_URL` | no | Override the default backend (`https://api.transcodesapis.com`). |

## Cross-host state sharing

Local step-up state lives under `~/.transcodes/state/` and is **shared across all transcodes-guard plugins** by design — every host talks to the same Transcodes backend, so a verified session in one host carries over to another. Concurrent use is supported but the same-second race on a verified record is a known limitation (the Transcodes backend's sid-replay protection is the authoritative backstop).

## Known limits

- **CLI vs desktop** — `install.mjs` adjusts `~/.gemini/antigravity-cli/settings.json` only. Desktop Turbo/Allow list is manual. Whether `always-proceed` / Turbo skips **gate** hooks (not just UI prompts) is not fully e2e-validated in this repo.
- **Subagent state sharing** is best-effort. A subagent's gate hook may receive a distinct `conversationId`; the shared state file is still the arbitration point, with backend sid-replay as backstop.
- **Stop hook UX** with `decision: "continue"` (which prevents turn termination — the verb is inverted relative to Claude Code's `decision: "block"`) is pending broader e2e validation.

## Troubleshooting

- **Hook doesn't fire (agy CLI).** Re-run `install.mjs`. Check `~/.gemini/antigravity-cli/settings.json` — installer sets `request-review` and removes broad allows when the file exists. Do not use `--dangerously-skip-permissions`. Confirm `node` is in `PATH`.
- **Hook doesn't fire (desktop).** Confirm plugin exists under `~/.gemini/config/plugins/transcodes-guard/`. Review Settings → Advanced → Terminal — Turbo auto-runs most commands. Matcher only covers `run_command|mcp_.*|call_mcp_tool`.
- **`decision: deny` but no step-up URL.** No Transcodes token — install CLI and run `transcodes login`.

## License

FSL-1.1-ALv2 (see the repository root).
