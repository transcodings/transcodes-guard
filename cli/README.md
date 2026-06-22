# @bigstrider/transcodes-cli

Token manager for the **transcodes-guard** plugins (Claude Code / Codex / Cursor / Antigravity).

The plugins and their hooks authenticate to the Transcodes backend with a member MCP JWT. This CLI is the safe way to store that token: you paste it into your terminal, **never into the agent chat** (which would leak it into the transcript).

## Install

```bash
# no install needed — opens the dashboard
npx @bigstrider/transcodes-cli

# or global
npm install -g @bigstrider/transcodes-cli
transcodes
```

Works the same on macOS, Linux, and Windows (Node ≥ 20).

## Commands

| Command | What it does |
|---------|--------------|
| `transcodes` | Opens the local dashboard (URL printed in the terminal; default port 3847, increments if busy) to paste, save, switch, label, or delete tokens (accepts `--port N` / `--no-open`). |
| `transcodes set <token> -l <label>` | Validates the JWT and saves it (label required) to `~/.transcodes/config.json` (dir `0700`, file `0600`), making it active. |
| `transcodes tokens` | Lists all saved tokens; the active one is marked with `*`. |
| `transcodes status` | Shows the active token source (env vs file) and its expiry. |
| `transcodes reset` | Deletes all saved tokens. |
| `transcodes policy refresh` | Force-refreshes the org policy bundle cache (same as MCP `refresh_rules`). |
| `transcodes help` | Shows the full command list and usage. |

Command descriptions are defined once in `cli/src/commands.ts` (SSOT) and shared with the dashboard CLI tab.

### Dashboard

```bash
npx @bigstrider/transcodes-cli
```

Starts a small localhost server (127.0.0.1 only), opens your browser, and lets you save, switch, rename, or delete tokens without pasting them on the command line. Multiple tokens are kept in `~/.transcodes/config.json` under `token_list`, each with a label; the active one is stored as `token`.

Options:

- `--port N` — bind to a specific port (default `3847`; increments if busy)
- `--no-open` — do not open the browser automatically

## Token precedence

The plugins resolve the token in this order (see `@transcodes-guard/stepup-core` `resolveToken()`):

1. `~/.transcodes/config.json` — written by this CLI, the source of truth
2. `TRANSCODES_TOKEN` environment variable — fallback for config-less envs (CI / power users)
3. none → the hook fail-safes (blocks danger commands, cannot start step-up)

## Notes

- **Windows security**: the `0600` mode is a POSIX concept and is largely ignored on Windows. The file still lives under your user profile (`C:\Users\<you>\.transcodes\`) and is user-scoped by default. A hardware-backed OS keychain is not yet implemented.
- The token never passes through the agent chat — this CLI writes the file directly.
