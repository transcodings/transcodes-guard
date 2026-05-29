# @bigstrider/transcodes-cli

Token manager for the **ai-action-tracker** plugins (Claude Code / Codex / Cursor / Antigravity).

The plugins and their hooks authenticate to the Transcodes backend with a member MCP JWT. This CLI is the safe way to store that token: you paste it into your terminal, **never into the agent chat** (which would leak it into the transcript).

## Install

```bash
# no install needed
npx @bigstrider/transcodes-cli login <token>

# or global
npm install -g @bigstrider/transcodes-cli
transcodes login <token>
```

Works the same on macOS, Linux, and Windows (Node ≥ 20).

## Commands

| Command | What it does |
|---------|--------------|
| `transcodes login <token>` | Validates the JWT and saves it to `~/.transcodes/config.json` (dir `0700`, file `0600`). |
| `transcodes logout` | Deletes the saved token. |
| `transcodes status` | Shows the active token source (env vs file) and its expiry. |
| `transcodes help` | Usage. |

## Token precedence

The plugins resolve the token in this order (see `@ai-action-tracker/stepup-core` `resolveToken()`):

1. `TRANSCODES_TOKEN` environment variable — overrides everything (CI / power users)
2. `~/.transcodes/config.json` — written by this CLI
3. none → the hook fail-safes (blocks danger commands, cannot start step-up)

## Notes

- **Windows security**: the `0600` mode is a POSIX concept and is largely ignored on Windows. The file still lives under your user profile (`C:\Users\<you>\.transcodes\`) and is user-scoped by default. A hardware-backed OS keychain is tracked in `docs/prd/0005-token-auth-device-flow.md`.
- The token never passes through the agent chat — this CLI writes the file directly.
