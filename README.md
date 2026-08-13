# transcodes-guard

**English** | [한국어](./README.ko.md)

<p align="center">
  <a href="https://transcodes.io"><img src="https://img.shields.io/badge/Website-transcodes.io-7B61FF?style=flat" alt="transcodes.io" /></a>
  <a href="https://x.com/hellotranscodes"><img src="https://img.shields.io/badge/Follow-%40hellotranscodes-000000?style=flat&logo=x&logoColor=white" alt="Follow on X" /></a>
  <a href="https://discord.gg/YA4y3WdBr"><img src="https://img.shields.io/badge/Join-Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Join Discord" /></a>
  <a href="https://www.youtube.com/@hellotranscodes"><img src="https://img.shields.io/badge/Subscribe-YouTube-FF0000?style=flat&logo=youtube&logoColor=white" alt="Subscribe on YouTube" /></a>
</p>

<p align="center">
  <a href="#claude-code"><img src="https://img.shields.io/badge/supports-Claude_Code-CC785C?style=flat&logo=anthropic&logoColor=white" alt="Claude Code" /></a>
  <a href="#cursor-beta"><img src="https://img.shields.io/badge/supports-Cursor-000000?style=flat&logo=cursor&logoColor=white" alt="Cursor" /></a>
  <a href="#antigravity"><img src="https://img.shields.io/badge/supports-Antigravity-4285F4?style=flat&logo=google&logoColor=white" alt="Antigravity" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/supports-ChatGPT-412991?style=flat&logo=openai&logoColor=white" alt="ChatGPT (Codex)" /></a>
</p>

## Intro

`transcodes-guard` is a host-hook + MCP-server gate that intercepts risky shell commands (and protected MCP tool calls) from AI coding agents _right before execution_ and forces a Transcodes Step-up MFA (WebAuthn) challenge against the Transcodes backend. Only verified commands run.

It is one git repo with one shared core (npm workspaces) and four host plugins — Claude Code, Codex, Cursor, and Antigravity — each installed via its native mechanism. **Claude Code, Codex, and Antigravity are stable and supported; Cursor is still in beta** (may crash or misbehave). The plugins are not distributed via npm; only the `transcodes` CLI is. The repo, product, and plugins are all named `transcodes-guard`.

Node.js >= 20 is required for all hosts.

## Installation

Do this **in order**. Without a token the plugin can still DENY danger commands, but it cannot open a step-up session.

### Quickstart — `transcodes install` (recommended)

The fastest path is the guided installer — host plugins, then dashboard in one flow.
Node is optional for this step: the bootstrap script installs an LTS if missing.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
```

```powershell
# Windows — standard (non-Administrator) PowerShell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install
```

Already have Node ≥ 20? `npm install -g @bigstrider/transcodes-cli` installs the **CLI command only**. Run `transcodes install` afterward to add host plugins.

What `transcodes install` does:

1. **Prerequisites** — checks for **Node.js LTS (>= 20)** and installs it if missing.
2. **Pick platforms** — arrow-key checklist for Claude Code / ChatGPT (Codex) / Cursor / Antigravity.
   - `↑`/`↓` move · `space` select · `a` all/none · `enter` install selection · `Next Step →` continue · `q` quit
   - Already-installed hosts show `[Installed ✓]`. Selecting them again updates in place.
   - For each selected host it ensures the host CLI (`claude` / `codex` / `cursor-agent` / `agy`) — installing the vendor one-liner when needed — then installs the plugin (Claude/Codex via native host CLIs; Cursor/Antigravity via a temporary repo clone).
3. **Finish** — only when every selected plugin install succeeds, open the local dashboard (`transcodes`). Any failed install exits non-zero and does not report setup complete.
4. **Sign in when needed** — use the dashboard or `transcodes login`. Sign-in is required for Guard/Admin API actions and organization Persona sharing, but local Persona authoring works signed out.

Non-interactive: `transcodes install --all` or `transcodes install claude codex cursor antigravity`.

After plugin installation, start a **new AI app chat or CLI session**, then review and trust the plugin hooks when prompted. Open the Transcodes Skill and choose a first task: standardize repeat work with a Persona, Rules, and Skills, or protect sensitive work with Guard and step-up approval. Sign in only when the selected task needs organization or Guard access.

### Update — `transcodes update`

Refresh whatever is already installed (detected host plugins + this CLI from npm):

```bash
transcodes update
```

- Detects installed plugins and re-runs each host’s install path in place (same as Cursor/Antigravity one-liners / Claude·Codex marketplace install).
- Then runs `npm install -g @bigstrider/transcodes-cli@latest`.

Useful flags: `--cli-only`, `--plugins-only`, `--all` (update every platform even if not detected), or list platforms: `transcodes update claude cursor`.

### Manual install

Prefer to do each step by hand? Follow §1–§3 below. The guided installer above is optional.

### 1. Install the CLI

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash
```

```powershell
# Windows — standard (non-Administrator) PowerShell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex
```

Then: `transcodes` — opens the local dashboard (default port 3847; if busy it tries the next free port, and frees the range once if all are taken).

Fallback if you already have Node ≥ 20: `npm install -g @bigstrider/transcodes-cli` or `npx @bigstrider/transcodes-cli`. These install/run the CLI only; continue with `transcodes install` for host plugins.

### 2. Create a project in Transcodes Console and save the token

1. In the [Transcodes Console](https://app.transcodes.io), create a project, set up an auth cluster and member, then issue an access token (member MCP JWT / MAT) from the member detail page. The dashboard **Getting Started** guide (**Quick Demo** + **Steps**) walks through what to do after install.
2. In the dashboard **Tokens** tab, paste the token, set a required label (e.g. `transcodes-{project}-{env}`), and **Save**. Or click **Console** / run `transcodes console` to sign in and register a passkey/biometrics for step-up.

The token is stored at `~/.transcodes/config.json` and shared by every host plugin. Sign in with `transcodes login`.

### 3. Install a host plugin

#### Claude Code

Claude Code is the primary host. The marketplace **is** this repo. Install from the terminal (non-interactive CLI — requires Claude Code >= 1.0.33):

```bash
claude plugin marketplace add transcodings/transcodes-guard
claude plugin install transcodes-guard@bigstrider --scope user
```

Or, inside a Claude Code session:

```
/plugin marketplace add transcodings/transcodes-guard
/plugin install transcodes-guard@bigstrider
```

`dist/` is committed, so it installs immediately from clone — no build step needed. Disable it with the native `/plugin disable transcodes-guard`.

For team auto-registration, add this to your project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": [
    { "source": "github", "repo": "transcodings/transcodes-guard" }
  ],
  "enabledPlugins": ["transcodes-guard@bigstrider"]
}
```

##### How to write prompt

Type `/transcodes`, press **Tab** to select **transcodes-guard**, then type your request.

```text
/transcodes <your prompt>
```

Example:

```text
/transcodes make transcodes google calendar event custom rule
```

#### Codex

Prerequisites: a Codex CLI build with plugin + hooks support (`codex plugin --help` should work), Node >= 20. Complete [§1](#1-install-the-cli)–[§2](#2-create-a-project-in-transcodes-console-and-save-the-token) first.

**Step 1 — install via the Codex marketplace.** The repo ships `.agents/plugins/marketplace.json`, a Codex catalog pointing at `./plugins/codex`. `codex plugin marketplace add` accepts a GitHub repo directly (Codex clones it for you), and `dist/` is committed, so no manual clone or build is needed:

```bash
codex plugin marketplace add transcodings/transcodes-guard   # registers the "bigstrider" marketplace
codex plugin add transcodes-guard@bigstrider                 # installs the plugin
# or in Codex: /plugins → install "transcodes-guard" from the bigstrider marketplace
```

Codex resolves `.agents/plugins/marketplace.json` ahead of the legacy `.claude-plugin/marketplace.json`, so it always installs the Codex plugin (`./plugins/codex`), not the Claude one.

**Step 2 — first run.** Codex prompts a one-time hook trust review (`/hooks` to inspect). Approve it once. Do **not** use `--dangerously-bypass-hook-trust`.

##### How to write prompt

Type `$transcodes`, press **Tab** to select **transcodes-guard**, then type your request.

```text
$transcodes <your prompt>
```

Example:

```text
$transcodes make transcodes google calendar event custom rule
```

#### Antigravity

Prerequisites: **Node >= 20**, **Google Antigravity 2.0** (desktop app or the `agy` CLI), and a saved token from [§2](#2-create-a-project-in-transcodes-console-and-save-the-token). Install the Antigravity CLI if you do not have it yet:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Then run **one line** — no manual `cd`, no `npm install`, no build step (`dist/` is committed):

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/antigravity/install.mjs && rm -rf /tmp/tg-install
```

The bundled installer copies the Antigravity plugin into `~/.gemini/config/plugins/transcodes-guard` (shared by the desktop app and `agy` CLI since CLI v1.0) and rewrites the `__PLUGIN_DIR__` placeholder in `hooks.json` / `mcp_config.json` to that directory's absolute path. Antigravity exposes no plugin-root path variable, so absolute paths must be injected at install time. Only the `transcodes-guard` plugin directory is updated — other plugins under `~/.gemini/config/plugins/` are preserved. Does **not** wipe `~/.transcodes/` (token, step-up state, policy cache).

Re-run the same one-liner to update in place.

##### How to write prompt

Type `/transcodes`, press **Tab** to select **transcodes-guard**, then type your request.

```text
/transcodes <your prompt>
```

Example:

```text
/transcodes make transcodes google calendar event custom rule
```

> **Do not use** `agy plugin install https://github.com/transcodings/transcodes-guard`. That command treats this repo as a bulk multi-plugin catalog and installs **both** the Antigravity and Claude Code adapters into Antigravity (wire-format mismatch), and it skips the `__PLUGIN_DIR__` path rewrite — hooks and MCP then fail at runtime. Use the one-liner above instead.
>
> **Contributors / workspace-only install:** clone the repo and run `node plugins/antigravity/install.mjs --local` (copies into `<cwd>/.agents/plugins/transcodes-guard`).

> Note: Antigravity's hook matcher is `run_command|mcp_.*|call_mcp_tool`, gating shell execution **and** MCP tool calls — including lazy-loaded calls that Antigravity routes through a generic `call_mcp_tool` wrapper (the adapter unwraps the real tool name from `args.ToolName`). File-edit tools (`write_to_file`, …) are not gated.

#### Cursor (Beta)

> ⚠️ **Beta** — the Cursor plugin is still in beta and may crash or misbehave; the install flow and APIs may change. For production use, prefer the **Claude Code** or **Codex** plugins.

Prerequisites: **Node >= 20**, Cursor **desktop** with Hooks enabled (Settings → Hooks), and a saved token from [§2](#2-create-a-project-in-transcodes-console-and-save-the-token). Cloud agents do not run `beforeShellExecution` / `beforeMCPExecution` hooks as of 2026-05.

Then run **one line** — no manual `cd`, no `npm install`, no build step (`dist/` is committed):

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/cursor/install.mjs && rm -rf /tmp/tg-install
```

The installer copies the plugin into `~/.cursor/plugins/local/transcodes-guard`, rewrites `${CURSOR_PLUGIN_ROOT}` in hook/MCP configs to absolute paths, merges transcodes-guard entries into `~/.cursor/hooks.json` (other hooks preserved), and upserts `mcpServers.transcodes-guard` in `~/.cursor/mcp.json` (other MCP servers preserved). Re-run the same one-liner to update in place. Does **not** wipe `~/.transcodes/` (token, step-up state, policy cache).

**First run:** approve the one-time hook trust review (command palette → **Cursor: Review Hooks**).

**CLI Agent note:** if `~/.cursor/cli-config.json` has `"approvalMode": "unrestricted"` (Run Everything) or pre-approved Shell/MCP allowlist entries, Cursor may execute tools without calling gate hooks. Use `"approvalMode": "allowlist"` and remove allowlist entries you want the gate to intercept.

> **Contributors / workspace-only install:** clone the repo and run `node plugins/cursor/install.mjs --local` (copies into `<cwd>/.cursor/plugins/transcodes-guard` and wires `<cwd>/.cursor/hooks.json`).

> **Optional — Team Marketplace:** Teams/Enterprise admins can import `https://github.com/transcodings/transcodes-guard` as a team marketplace and assign the plugin as Required/Optional. Marketplace install alone does not always register user-level hooks; still run `install.mjs` above for reliable gate wiring.

##### How to write prompt

Type `/transcodes`, press **Tab** to select **transcodes-guard**, then type your request.

```text
/transcodes <your prompt>
```

Example:

```text
/transcodes make transcodes google calendar event custom rule
```

## Key features

### Step-up auth

The core gate. The flow:

1. An agent tries a Bash command (or a protected MCP tool call).
2. The gate hook detects a danger pattern (regex + an `rm -rf` git-tracked semantic check) or a protected tool → it DENIES and surfaces a WebAuthn step-up URL.
3. The user completes WebAuthn in the browser → the agent confirms via the MCP tool `poll_stepup_session_wait` (a server-side long-poll).
4. With a verified record, **re-running the same command** passes the hook. It is single-shot — the next danger command challenges again.

**Asymmetric fail policy** (the security core): _before_ a danger match (stdin parse, classify, pattern load) the gate is FAIL-OPEN — a crash never blocks a safe command. _After_ a danger match it is FAIL-SAFE — a crash never silently allows a risky command. Blocking is fail-safe.

Diagnostics MCP tools:

- `inspect_stepup_state` — read-only snapshot with `age_ms` / `expired` / `ttl_ms`.
- `simulate_command`
- `simulate_hook_invocation` — spawns the **real** hook binary (not a dry run; it can consume a verified record or open a browser).

A token (the member MCP JWT) is required for step-up to actually start — complete [§1](#1-install-the-cli)–[§2](#2-create-a-project-in-transcodes-console-and-save-the-token) before relying on the gate.

### tool_rules (protected MCP tools)

An exact/glob `toolName` match against a tool-rule registry triggers a step-up on sensitive MCP tool calls (e.g. member retirement, role/permission changes, passcode issuance). Two tiers:

- **SYSTEM rules** — Transcodes-specific protected-tool → `stepupAction` / `stepupResource` policy mappings, shipped as policy data (the tool list is policy surface, kept private). System rule ids are reserved and cannot be overridden.
- **USER rules** — added at runtime via the MCP tool `add_tool_rule` (writes through the backend API; `type:'mcp'`). They default to `consume_in_hook=true` (single-shot, consumed in the hook).

No rebuild is needed to add a user rule.

### user_patterns (custom Bash patterns)

Bash danger detection is a regex match against the full command string. Two tiers:

- **SYSTEM patterns** — generic risky shell: `rm -rf` against an absolute path / HOME, bare-glob `rm -rf`, `dd of=/dev/...`, `mkfs`, `curl ... | bash`, fork bomb, recursive `chmod` on HOME, protected-branch force-push. Embedded at build time. Plus a `rm -rf <relative path>` **semantic** check: it resolves the target against cwd and blocks if it contains git-tracked files (catching what regex misses).
- **USER patterns** — added at runtime via the MCP tool `add_user_pattern` (writes through the backend API; `type:'bash'`, with the regex in the rule's `name`). There is **no** local `user-patterns.json` authoring file — authoring is backend-API only.

Matching runs each compiled regex against the full command string (comments, quoted args, and heredocs all match; there is no token extraction) — first match wins, system before user.

Known limits (briefly): shell quoting is not understood (`echo "rm -rf /"` can match → a possible false positive); regex bypass is partially possible (this is the first line of defense); the semantic check is skipped in non-git directories.

### What the gate sends

On a gated call the hook makes exactly one outbound request — `POST /guard/evaluate` — and it carries:

- the host's hook payload verbatim (tool name and arguments) plus the working directory;
- the host's own identifiers for the session, the turn, and the tool call, and the model driving the agent;
- **`tasks`** — a one-line summary of the current user prompt, clipped to 300 characters. The prompt hook's current-turn cache is preferred; the host transcript is a best-effort fallback and may add the host's session title.

The transcript file and raw cache files never leave the machine; only that summary does. Note what this implies: **an excerpt of your prompts is transmitted on every gated call**, so treat chat prompts the way you treat anything else you send to the backend — secrets pasted into a prompt can travel with it. To join prompt and tool events, the client keeps at most four raw prompts per session for 24 hours (32 KiB each, 256 session files globally) in the host's `PLUGIN_DATA`/`CLAUDE_PLUGIN_DATA` directory, or `~/.transcodes/cache/prompts` for source/dev runs. The directory is mode `0700`, files are `0600`, and session ids are hashed into filenames. This telemetry cache is separate from trusted gate state; `inspect_stepup_state` still reports the latter only.

## Community & Support

- **Discord:** For questions and support, reach out on **[Discord](https://discord.gg/YA4y3WdBr)**.
- **Twitter / X:** For questions and updates, contact us on **[X (@hellotranscodes)](https://x.com/hellotranscodes)**.
- **YouTube:** Watch tutorials and announcements on **[YouTube (@hellotranscodes)](https://www.youtube.com/@hellotranscodes)**.
- **Feedback & Support:** Create a **[GitHub Issue](https://github.com/transcodings/transcodes-guard/issues)**.

## License

Functional Source License, Version 1.1, ALv2 Future License (`FSL-1.1-ALv2`) — converts to Apache 2.0 after 2 years. See [./LICENSE.md](./LICENSE.md).
