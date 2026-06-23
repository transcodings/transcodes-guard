# transcodes-guard — Claude Code plugin

**English** | [한국어](./README.ko.md)

Risky-shell interceptor (`PreToolUse` hook) and step-up MFA audit MCP server for Claude Code.

When the agent is about to run a risky Bash command (or a protected MCP tool call), the `PreToolUse` hook intercepts it and forces a WebAuthn step-up against the Transcodes backend **before** the command runs. The shared gate logic lives in `@transcodes-guard/stepup-core` + `@transcodes-guard/mcp-server-core`; the only Claude-Code-specific surface is the hook adapter and the plugin manifest.

## Prerequisites

- **Claude Code** with plugin support.
- **Node.js ≥ 20** on `PATH` (hooks and the MCP server run as `node` subprocesses).
- A **member MCP JWT** for step-up — save via the CLI (`npm install -g @bigstrider/transcodes-cli`, then `transcodes`; see [Save your token](#2-save-your-token)).

## Installation

### 1. Add the marketplace and install

```
/plugin marketplace add transcodings/transcodes-guard
/plugin install transcodes-guard@bigstrider
```

Claude Code sets `${CLAUDE_PLUGIN_ROOT}` at runtime; the manifest (`.claude-plugin/`) and `hooks/hooks.json` resolve every hook and MCP-server path against it, so there is nothing to configure by hand. The four hooks and the MCP server are active immediately after install.

### 2. Save your token

The MCP server and the step-up hook both authenticate against the Transcodes backend with a member MCP JWT. **Recommended** — install the CLI control plane once, then enter the token in the dashboard. It persists in `~/.transcodes/config.json` and every agent session reads it (no env var needed):

```bash
npm install -g @bigstrider/transcodes-cli
transcodes   # opens the local dashboard — URL is printed in the terminal (default port 3847; `--port N` to override)
```

Non-interactive alternative (same store): `transcodes set <token> -l <label>`.

For config-less envs (CI), export the `TRANSCODES_TOKEN` environment variable — it's a **fallback** used only when no token is saved to the file:

```bash
export TRANSCODES_TOKEN="<your-token>"
```

Without either, the hook still **denies** danger commands but cannot start a step-up session — the deny reason will say to provide a token.

## What the plugin does

| Component | Behaviour |
|---|---|
| `PreToolUse` hook (matcher `Bash\|mcp__.*`) | Two-layer check on Bash (regex danger patterns + a `git ls-files` semantic check on `rm -rf`) plus exact-match tool-rules on MCP calls. Denies and starts a step-up MFA flow when matched. |
| MCP server (`transcodes-guard`) | **Diagnostic / simulation** tools (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`); **step-up lifecycle** tools (`create_stepup_session`, `poll_stepup_session_wait`); **Transcodes admin** tools (member / organization / RBAC / membership / passcode / auth-device / audit / project management). |
| `SessionStart` hook | Injects the step-up protocol primer (so the agent knows how to react to a deny) plus a carry-over notice if a step-up session survived a restart. Pure additive context — never blocks. |
| `UserPromptSubmit` hook | Detects user "auth done" prompts (`"완료"`, `"done"`, …) and surfaces the pending `sid` so the agent can resume polling. |
| `Stop` hook | Catches dangling step-up loops; silently reaps orphan verified/pending records. |

## Slash command: `/transcodes`

A single "front door" for managing the gate's own rules. Type `/transcodes` followed by a plain-language request and the agent routes it to the right guard workflow, asking for any missing detail:

```
/transcodes gate the google calendar delete tool behind step-up
/transcodes list the current rules
/transcodes is "git push --force" blocked?
```

Menu it routes to: gate an MCP tool (`add_tool_rule`), block a Bash command (`add_user_pattern`), change a rule (`update_*`), list rules, check whether something is blocked (`simulate_*`), inspect step-up state, or integrate/install the Transcodes SDK into a frontend (`get_integration_guide`). Discovered automatically from the plugin's `commands/` directory (also available as the MCP prompt `/mcp__transcodes-guard__transcodes`).

## Transports

Claude Code is the only host that ships **both** transports:

- **stdio** — `node ${CLAUDE_PLUGIN_ROOT}/dist/src/stdio.js` (what the plugin manifest uses).
- **Streamable HTTP** — `POST /mcp`, listening on `PORT` (default `3000`). Start it with `npm run dev:http` for use from external MCP clients / the Inspector.

## For AI agents

When a `PreToolUse` deny fires with a reason mentioning **Step-up MFA**, the command was **blocked and did NOT run**. Claude Code auto-injects this protocol at `SessionStart`; drive the loop deterministically — do not wait for user confirmation between steps:

1. Tell the user (one short line) to complete WebAuthn in the auto-opened browser tab (use the URL from the deny message if it did not open).
2. Immediately call the MCP tool **`poll_stepup_session_wait`** with the provided `sid`. It blocks until verified or a 60s timeout — one call replaces manual polling. (The single-shot `poll_stepup_session` is for diagnostics only.)
3. On `outcome: "verified"`, retry the **same** Bash/MCP call — the hook detects the verified state locally and allows it. On `outcome: "timeout"`, ask the user to retry WebAuthn, then call the wait tool again. On `outcome: "rejected"`, the user declined step-up — tell them and do **not** retry.

Never assume the blocked command ran. Never invent an alternative command. Always resume from the pending `sid` the hook reported. Use `inspect_stepup_state` for a read-only snapshot when unsure.

## Enabling / disabling

There is no runtime kill-switch in the plugin. To turn protection off, disable or uninstall the plugin via Claude Code's plugin manager. (Enabling the gate is safe for an agent; disabling it is a human-only action — that asymmetry is intentional.)

## Environment

Token resolution: the recommended store is `~/.transcodes/config.json` (via `transcodes` dashboard or `transcodes set`). When `TRANSCODES_TOKEN` is set, it **overrides** the saved file — use for CI or one-off overrides only.

| Variable | Required | Purpose |
|---|---|---|
| `TRANSCODES_TOKEN` | CI/override only (overrides saved file) | Member MCP JWT, sent as `x-transcodes-token`. Omit when using CLI storage. |
| `TRANSCODES_BACKEND_URL` | no | Override the default backend (`https://api.transcodesapis.com`). |
| `CLAUDE_PLUGIN_ROOT` | host-set | Set by Claude Code; locates hook binaries and is used by `simulate_hook_invocation`. |

## Cross-host state sharing

Local step-up state lives under `~/.transcodes/state/` and is **shared across all transcodes-guard plugins** by design — every host talks to the same Transcodes backend, so a verified session in one host carries over to another. Concurrent use is supported; the same-second race on a verified record is a known limitation, with the backend's sid-replay protection as the authoritative backstop.

## Known limits

- Bash matching runs against the full command string with no shell-quoting awareness, so unusual quoting can cause a false positive; the regex layer can also be bypassed by an equivalent command the patterns don't cover.
- The `rm -rf` git-semantic check is cwd-dependent and is skipped outside a git working tree, so `simulate_command` is not a full oracle for it — use `simulate_hook_invocation` for the full-fidelity check.

## License

FSL-1.1-ALv2 (see the repository root).
