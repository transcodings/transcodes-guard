# transcodes-guard (monorepo)

Risky-shell interceptor + step-up MFA audit MCP server, shipped as plugins for **Claude Code**, **OpenAI Codex CLI**, **Google Antigravity 2.0**, and **Cursor IDE**. All four share one MCP server core and one gate via npm workspaces — a new host means a new adapter + a thin plugin shell, never a duplicated gate.

The gate intercepts a risky Bash command (or a protected MCP tool call) in the PreToolUse hook and forces a WebAuthn step-up against the Transcodes backend before the command runs.

## Essential commands

```bash
npm install            # workspace hoist (packages/* + plugins/*)
npm run build:plugin   # turbo: build packages, then bundle plugins (tsup) — regenerates committed dist/
npm run dev:stdio      # tsx stdio transport (Claude Code plugin) for Inspector / external MCP clients
npm run dev:http       # tsx Streamable HTTP transport, port 3000 /mcp
npm run dev:hook       # run the PreToolUse hook once from stdin JSON
npm run inspect        # MCP Inspector UI against the stdio server
```

After any source change, run `npm run build:plugin` and commit the regenerated `dist/`. CI fails on `dist/` drift across **five** locations (`packages/*/dist/` + each of the four `plugins/*/dist/`) and on the **23** hook smoke tests (claude-code 9 + codex 3 + antigravity 5 + cursor 6).

## Architecture

Source of truth = `packages/*/src/` (host-agnostic) + `plugins/*/hooks/` (host-thin entries). Every `dist/` is a committed build artifact — never hand-edit it.

```
packages/                            host-agnostic workspace libraries
  plugin-paths/      data/cache dir resolution        → .claude/rules/plugin-paths.md
  stepup-core/       step-up MFA gate + evaluate()     → .claude/rules/stepup-gate.md
  danger-patterns/   regex patterns + tool-rule registry → .claude/rules/danger-patterns.md
  mcp-server-core/   createServer() — all capabilities  → .claude/rules/mcp-server.md
  hook-adapters/     per-host stdin/stdout JSON contract → .claude/rules/hooks.md
  cli/               @bigstrider/transcodes-cli — human control plane (kill-switch, tokens, dashboard)
plugins/                             per-host deploy units (thin manifest + entry points)
  claude-code-ai-action-tracker/     marketplace plugin; 4 hooks; stdio + http transports
  codex-ai-action-tracker/           Codex CLI plugin; 4 hooks; stdio
  antigravity-ai-action-tracker/     Antigravity plugin; 3 hooks (PreInvocation merges 2 events)
  cursor-ai-action-tracker/          Cursor plugin; flat wire format; install.sh
```

Build, dist sync, and packaging → `.claude/rules/plugin-build.md`. Release and distribution → `.claude/rules/release-dist.md`.

### The `transcodes` CLI (`packages/cli/`)

`@bigstrider/transcodes-cli` is a workspace member (`packages/cli/`, bin `transcodes`) and the human's control plane for the gate. It is **excluded from the `transcodes-guard` brand rename** — it keeps its `@bigstrider/transcodes-cli` name and `transcodes` bin — but it consumes the shared `@transcodes-guard/*` packages like the plugins do. It owns the shared `~/.transcodes/` directory:

- `~/.transcodes/config.json` — the `enabled` kill-switch flag (CLI-owned; hooks read it). Absent/corrupt = enabled.
- `~/.transcodes/state/` — consolidated local plugin state.
- Commands: `transcodes enable | disable | status | tokens | set | reset`, plus the no-arg GUI dashboard.

The plugins/hooks **read** what the CLI manages (config, step-up tokens) — they do not reimplement token storage or the toggle. Path resolution is centralized in `@transcodes-guard/plugin-paths`; enable/disable semantics in `.claude/rules/stepup-gate.md`. The CLI version is independent of the plugin version train; each plugin declares compatibility via an optional `peerDependencies` range (`@bigstrider/transcodes-cli`, `>=0.3.0 <0.4.0`).

## Must

- Add MCP capabilities **only** in `createServer()` (`packages/mcp-server-core/src/server.ts`); plugin `src/*.ts` are thin transport wrappers. Validate every tool input with `zod` — LLM arguments are untrusted.
- Keep all gate / evaluate / message-formatting logic in `packages/stepup-core/`. Host divergence lives **only** in `packages/hook-adapters/`. Never inline gate logic into a plugin hook.
- Run `npm run build:plugin` and commit all five `dist/` locations in the same change.
- Resolve persist/cache paths only via `@transcodes-guard/plugin-paths` (`dataDir()` / `cacheDir()`) — never hardcode `~/.claude/...` or join `os.homedir()` directly.
- The step-up gate's enable/disable is **asymmetric**: enabling is safe for an agent, disabling requires a human. Read `.claude/rules/stepup-gate.md` before changing anything in that path.

## Never

- Use the deprecated positional `server.tool(...)` API or the SSE transport. Use `registerTool` / `registerResource` / `registerPrompt` and Streamable HTTP `/mcp`.
- Write to stdout under stdio (`console.log`, `process.stdout.write`) — it corrupts JSON-RPC framing. Log via `console.error`.
- Mutate state inside a Resource handler. Side effects belong in Tools.
- Duplicate the MCP server or the gate per plugin. One `createServer()`, one gate, host-specific adapters only.

## See also

- Design intent (why split transports, why Streamable HTTP, auth gap) → `docs/architecture.md`
- Add a capability step-by-step → `docs/adding-capabilities.md`
- Manual hook install (no plugin) → `docs/hook-installation.md`
- Multi-host distribution research + deploy plan → `docs/research/multi-host-plugin-distribution.md`
- User-facing install/usage (Korean) → `README.md`
