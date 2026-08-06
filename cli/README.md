# `@bigstrider/transcodes-cli`

Human control plane for [transcodes-guard](https://github.com/transcodings/transcodes-guard).
Installs host plugins, signs you in with a browser (`transcodes login`), and
runs a small local dashboard. Plugins/hooks read the credential from
`~/.transcodes/config.json`.

Permission checks default to **off**. Open the dashboard's **Permission** tab
and enable them explicitly; disabling them makes hooks skip backend evaluation.

## Install

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash

# Windows — standard (non-Administrator) PowerShell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex
```

Or: `npm install -g @bigstrider/transcodes-cli` (Node ≥ 20).

## Commands

| Command | What it does |
|---------|--------------|
| `transcodes` | Opens the local dashboard in the background (default port 3847; `--port N` / `--no-open`). |
| `transcodes stop` | Stops the background dashboard daemon. |
| `transcodes login` | Browser sign-in; saves the issued member credential as active. |
| `transcodes logout` | Removes the local credential (`reset` is an alias). |
| `transcodes status` | Shows whether a local credential is active and its expiry. |
| `transcodes console` | Opens auth settings (passkeys, TOTP) for the signed-in member. |
| `transcodes install` | Guided plugin install, then open the dashboard (sign in there). |
| `transcodes update` | Update installed plugins and this CLI. |
| `transcodes persona` | Create, inspect, edit, and delete local Persona bundles. |
| `transcodes version` | Prints the installed npm version. |
| `transcodes sync init` | Create `.transcodes/` SoT (rules + skills) in the current project. |
| `transcodes sync generate` | Generate Claude / Codex / Cursor / Antigravity configs from `.transcodes/`. |
| `transcodes sync add` | Scaffold a rule or skill under `.transcodes/`. |
| `transcodes help` | Full command list. |

Command descriptions are defined once in `cli/src/commands/` (SSOT) and shared with the dashboard CLI tab.

### Persona automation

Persona sources are stored under `~/.transcodes/personas/<name>/`. The
`/transcodes` command (or `$transcodes` in Codex) can interview the user and
drive these JSON-friendly commands:

```bash
transcodes persona list
transcodes persona create developer
transcodes persona read --persona developer --kind agent
transcodes persona save --persona developer --kind agent --content-file /tmp/instruction.md
transcodes persona save --persona developer --kind rule --name security --content-file /tmp/security.md
transcodes persona deploy --persona developer --project "/path/to/project" --targets claude,cursor --yes
transcodes persona deploy --persona developer --global --yes
```

Run `transcodes persona help` for the complete command list.
`persona save` stores Markdown as provided. The `/transcodes` agent workflow
must follow its authoring and token rules before saving, but the CLI
intentionally does not validate or block the content.
`persona deploy` needs either an existing project folder plus target apps, or
`--global` to apply globally on this device. Global application makes the
Persona available in every project and session for the selected installed
Claude, ChatGPT (Codex), and Antigravity apps (hosts whose rulesync rules
support `--global`). Cursor is project-only for Persona apply. Use global when
the user does not know which project or wants the Persona everywhere. CLI
deploy always requires `--yes` after the user confirms overwrite; without it
the command refuses. The dashboard Persona Apply flow uses its own
confirmation modal instead.
The dashboard Persona panel remains available for manual review and Apply.

### Project rules / skills sync

Keep a single source of truth under `.transcodes/`, then generate per-tool files:

```bash
cd /path/to/your-project
transcodes sync init
# edit .transcodes/agents/agents.md, .transcodes/rules/*.md, .transcodes/skills/*/SKILL.md
transcodes sync generate -f rules,skills --simulate-skills
# omit -t → auto-detect installed Claude / Cursor / Codex / Antigravity (+ agentsmd)
# or pin: -t claudecode,cursor,agentsmd
```

`transcodes sync` is a first-class CLI command under `cli/src/commands/transcodes/`
(same style as `login` / `install`). The generate engine is
`cli/src/commands/sync/`. Host-app detection for default targets is in
`cli/src/commands/transcodes/host-apps.ts`.

### Dashboard

```bash
npx @bigstrider/transcodes-cli
# stop later:
npx @bigstrider/transcodes-cli stop
```

Starts a localhost server (127.0.0.1 only) as a **background daemon**, opens
your browser, and returns the shell immediately. Pid/log live under
`~/.transcodes/state/dashboard.pid` and `dashboard.log`.

Options:

- `--port N` — prefer a specific port (default `3847`; increments if busy)
- `--no-open` — do not open the browser automatically

## Credential store

Plugins resolve the credential from a single source (`resolveToken()`):

1. `~/.transcodes/config.json` — written by `transcodes login`
2. none → the hook fail-safes (blocks danger commands, cannot start step-up)
