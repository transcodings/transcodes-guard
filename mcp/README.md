# `@bigstrider/transcodes-mcp`

**English** | [한국어](./README.ko.md)

The Transcodes Guard step-up MFA audit **MCP server**, to be published as a standalone npm package. It exposes the same MCP core (`createServer()`) shared by the four host plugins (Claude Code / Codex / Antigravity / Cursor) over a stdio transport, so once released you can connect it directly to **Claude Desktop / claude.ai connectors** or any MCP client — no plugin install required.

This is a thin transport adapter package, modeled on `cli/`.

> **Not yet published.** The standalone package is pending release; the commands below describe how to connect it once it ships. Until then, use one of the four host plugins.

## Connecting

### Claude Desktop / Claude Code (stdio)

Run it straight from `npx`. Add this to your MCP configuration:

```json
{
  "mcpServers": {
    "transcodes-guard": {
      "command": "npx",
      "args": ["-y", "@bigstrider/transcodes-mcp"]
    }
  }
}
```

For the Claude Code CLI:

```bash
claude mcp add transcodes-guard -- npx -y @bigstrider/transcodes-mcp
```

### Running directly

```bash
npx -y @bigstrider/transcodes-mcp
# or, after a global install
transcodes-mcp
```

It speaks MCP over stdio (standard input/output). Once ready, it prints `transcodes-guard-mcp: stdio transport ready` to stderr.

## How it works

- This is a **full-backend** build: it bundles the backend gate tools (step-up session create/poll, RBAC coordinate checks, and more), so no separate backend install is needed.
- Enabling step-up is safe for an agent to call, but **disabling it is human-only** — the human control plane is `@bigstrider/transcodes-cli`.

## Versioning

It ships on the **same version train** as the four plugins (release-please keeps them in sync). Only the CLI (`@bigstrider/transcodes-cli`) is independent of the train.

## Publishing

For the maintainer's manual release steps, see `PUBLISHING.md` (it is not included in the npm package).
