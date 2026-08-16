# transcodes-guard — Claude Code plugin

**English** | [한국어](./README.ko.md)

Risky-shell interceptor (`PreToolUse`) and step-up MFA audit MCP server for Claude Code.

When the agent is about to run a risky Bash command (or a protected MCP tool call), `PreToolUse` intercepts it and forces a WebAuthn step-up against the Transcodes backend **before** the command runs. The shared gate logic lives in `@transcodes-guard/core/stepup` + `@transcodes-guard/core/server`; the only Claude-Code-specific surface is the hook adapter and the plugin manifest.

## Prerequisites

- **Claude Code** with plugin support.
- **Node.js ≥ 20** on `PATH` (hooks and the MCP server run as `node` subprocesses).
- A **member MCP JWT** for step-up — save via the CLI (`curl …/install.sh | bash` or Windows `Set-ExecutionPolicy Bypass -Scope Process -Force; irm …/install.ps1 | iex`, then `transcodes`; see [Save your token](#2-save-your-token)).

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
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
# Windows (PowerShell):
# Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install
```

Sign in with `transcodes login`.

Without a token, the hook still **denies** danger commands but cannot start a step-up session — the deny reason will say to provide a token.

## What the plugin does

| Component | Behaviour |
|---|---|
| `PreToolUse` (matcher `Bash\|mcp__.*`) | Two-layer check on Bash (regex danger patterns + a `git ls-files` semantic check on `rm -rf`) plus exact-match tool-rules on MCP calls. Denies and starts a step-up MFA flow when matched. |
| MCP server (`transcodes-guard`) | **Diagnostic / simulation** tools (`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`); **step-up lifecycle** tools (`create_stepup_session`, `poll_stepup_session_wait`); **Transcodes admin** tools (member / organization / RBAC / membership / passcode / auth-device / audit / project management). |
| `SessionStart` hook | Injects the step-up protocol primer (so the agent knows how to react to a deny) plus a carry-over notice if a step-up session survived a restart. Pure additive context — never blocks. |
| `UserPromptSubmit` hook | Caches the current prompt locally so the next gated tool call can send a short, current-turn `tasks` summary. Silent and fail-open. |
| `Stop` hook | No-op — drains stdin and exits silently. Step-up status is backend SSOT, so there is nothing local to reap or remind about; agents recover via the PreToolUse deny + `tc_poll_stepup_session_wait`. |

## Skill: `/transcodes-guard:transcodes`

A single front door for Persona, gate, Admin API, and SDK workflows. Invoke the canonical plugin Skill name below; `/transcodes` is also available when it does not conflict with another Skill:

```
/transcodes-guard:transcodes optimize my support Persona
/transcodes-guard:transcodes gate the google calendar delete tool behind step-up
```

Claude Code discovers it from `skills/transcodes/SKILL.md` and may also activate it from a matching natural-language request. The MCP prompt remains available as `/mcp__transcodes-guard__transcodes`.

## Transports

Claude Code is the only host that ships **both** transports:

- **stdio** — `node ${CLAUDE_PLUGIN_ROOT}/dist/src/stdio.js` (what the plugin manifest uses).
- **Streamable HTTP** — `POST /mcp`, listening on `PORT` (default `3000`). Start it with `npm run dev:http` for use from external MCP clients / the Inspector.

## For AI agents

Open source: [transcodes-guard](https://github.com/transcodings/transcodes-guard)

When a step-up deny fires with a reason mentioning **Step-up MFA**, the command was **blocked and did NOT run**. Claude Code auto-injects this protocol at `SessionStart`; drive the loop deterministically — do not wait for user confirmation before calling the wait tool:

1. Tell the user (one short line) to complete WebAuthn in the auto-opened browser tab (use the URL from the deny message if it did not open).
2. Immediately call the MCP tool **`tc_poll_stepup_session_wait`** with the provided `sid`. It waits up to ~5 min (session TTL) until verified or timeout — one call replaces manual polling. (The single-shot `tc_poll_stepup_session` is for diagnostics only.)
3. On **`outcome: "verified"`**, retry the **same** Bash/MCP call — the hook detects the verified state locally and allows it. On **`outcome: "timeout"`**, **`rejected`**, or **`not_found`**, tell the user (one short line) this command did not run; **skip the blocked command**; **continue other work**. Do NOT re-poll, reopen auth tabs, or retry the SAME blocked command unless the user explicitly asks to authenticate again. Do not invent an alternate command that works around the blocked action.

Never assume the blocked command ran. Never invent an alternative command. Always resume from the pending `sid` the hook reported. Use `tc_inspect_stepup_state` for a read-only snapshot when unsure.

## Enabling / disabling

Use the **Permission checks** toggle in the local `transcodes` dashboard. When
Off, hooks skip step-up authentication and permission evaluation before any
backend request, so those tool calls are not recorded in Transcodes Log History.

## Environment

Token resolution: the token is read solely from `~/.transcodes/config.json` (via `transcodes login`).

| Variable | Required | Purpose |
|---|---|---|
| `TRANSCODES_BACKEND_URL` | no | Override the default backend (`https://api.transcodesapis.com`). |
| `CLAUDE_PLUGIN_ROOT` | host-set | Set by Claude Code; locates hook binaries and is used by `simulate_hook_invocation`. |

## Cross-host state sharing

Local step-up state lives under `~/.transcodes/state/` and is **shared across all transcodes-guard plugins** by design — every host talks to the same Transcodes backend, so a verified session in one host carries over to another. Concurrent use is supported; the same-second race on a verified record is a known limitation, with the backend's sid-replay protection as the authoritative backstop.

## Known limits

- Bash matching runs against the full command string with no shell-quoting awareness, so unusual quoting can cause a false positive; the regex layer can also be bypassed by an equivalent command the patterns don't cover.
- The `rm -rf` git-semantic check is cwd-dependent and is skipped outside a git working tree, so `simulate_command` is not a full oracle for it — use `simulate_hook_invocation` for the full-fidelity check.

## License

FSL-1.1-ALv2 (see the repository root).
