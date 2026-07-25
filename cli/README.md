# @bigstrider/transcodes-cli

Token manager for the **transcodes-guard** plugins (Claude Code / Codex / Cursor / Antigravity).

The plugins and their hooks authenticate to the Transcodes backend with a member MCP JWT. This CLI is the safe way to store that token: you paste it into your terminal, **never into the agent chat** (which would leak it into the transcript).

## Install

One line — no need to have `npm` (or even Node) already. The script installs
an LTS Node if it is missing, then puts `transcodes` on your PATH.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install
```

> Windows: if script execution is blocked by policy, prefix it once (this only
> affects the current session):
>
> ```powershell
> Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex
> ```

Already have Node ≥ 20? The plain npm route still works everywhere:

```bash
# no install needed — opens the dashboard
npx @bigstrider/transcodes-cli

# or global
npm install -g @bigstrider/transcodes-cli
transcodes
```

Node ≥ 20 is required (the CLI and the guard hooks both run on Node); the
bootstrap scripts above install it for you if needed.

## Commands

| Command | What it does |
|---------|--------------|
| `transcodes` | Opens the local dashboard in the background (restarts daemon from this CLI binary; default port 3847; `--port N` / `--no-open`). Shell returns immediately. |
| `transcodes stop` | Stops the background dashboard daemon. |
| `transcodes set <token> -l <label>` | Validates the JWT and saves it (label required) to `~/.transcodes/config.json` (dir `0700`, file `0600`), making it active. |
| `transcodes tokens` | Lists all saved tokens; the active one is marked with `*`. |
| `transcodes status` | Shows the active token source and its expiry. |
| `transcodes console` | Opens auth settings (passkeys, TOTP) for the active token in your browser. |
| `transcodes reset` | Deletes all saved tokens. |
| `transcodes policy refresh` | Force-refreshes the org policy bundle cache (same as MCP `refresh_rules`). |
| `transcodes version` | Prints the installed `@bigstrider/transcodes-cli` npm version (also `--version`, `-V`). |
| `transcodes help` | Shows the full command list and usage. |

Command descriptions are defined once in `cli/src/commands.ts` (SSOT) and shared with the dashboard CLI tab.

### Dashboard

```bash
npx @bigstrider/transcodes-cli
# stop later:
npx @bigstrider/transcodes-cli stop
```

Starts a small localhost server (127.0.0.1 only) as a **background daemon**, opens your browser, and returns the shell immediately. Each `transcodes` run restarts the daemon from the CLI binary you just invoked (so a local `npm run build` is picked up). Stop it with `transcodes stop`.

Multiple tokens are kept in `~/.transcodes/config.json` under `token_list`, each with a label; the active one is stored as `token`. Pid/log live under `~/.transcodes/state/dashboard.pid` and `dashboard.log`.

Options:

- `--port N` — prefer a specific port (default `3847`; increments if busy)
- `--no-open` — do not open the browser automatically

## Token precedence

The plugins resolve the token from a single source (see `@transcodes-guard/core/stepup` `resolveToken()`):

1. `~/.transcodes/config.json` — written by this CLI, the only source of truth
2. none → the hook fail-safes (blocks danger commands, cannot start step-up)

## Notes

- **Windows security**: the `0600` mode is a POSIX concept and is largely ignored on Windows. The file still lives under your user profile (`C:\Users\<you>\.transcodes\`) and is user-scoped by default. A hardware-backed OS keychain is not yet implemented.
- The token never passes through the agent chat — this CLI writes the file directly.
