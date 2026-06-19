# transcodes-guard (monorepo)

Risky-shell interceptor + step-up MFA audit MCP server, shipped as plugins for **Claude Code**, **OpenAI Codex CLI**, **Google Antigravity 2.0**, and **Cursor IDE**. All four share one MCP server core and one gate via npm workspaces — a new host means a new adapter + a thin plugin shell, never a duplicated gate.

The gate intercepts a risky Bash command (or a protected MCP tool call) in the PreToolUse hook and forces a WebAuthn step-up against the Transcodes backend before the command runs.

## Essential commands

```bash
npm install            # workspace hoist (packages/* + plugins/* + cli)
npm run build:plugin   # turbo: build packages, then bundle plugins (tsup) — regenerates committed dist/
npm run dev:stdio      # tsx stdio transport (Claude Code plugin) for Inspector / external MCP clients
npm run dev:http       # tsx Streamable HTTP transport, port 3000 /mcp
npm run dev:hook       # run the PreToolUse hook once from stdin JSON
npm run inspect        # MCP Inspector UI against the stdio server
npm run check          # biome check --write (lint + format + organize-imports)
npm run format         # biome format --write (format only)
npm run type-check     # turbo run type-check — tsc --noEmit across every package
```

After any source change, run `npm run build:plugin` and commit every regenerated `dist/` (`packages/*` + `plugins/*`) in the same change. CI verifies plugin dist files exist (gitignore guard; the byte-identity drift gate was removed — bundles are not reproducible across environments) and runs the **23** hook smoke tests (claude-code 9 + codex 3 + antigravity 5 + cursor 6).

Lefthook is installed automatically on `npm install` (postinstall). It runs biome format+check on staged files at `pre-commit` and `npm run type-check` at `pre-push`. CI also runs `biome check --reporter=github` and a publish-surface gate that asserts every `packages/*` member stays marked `"private": true`.

## Architecture

Source of truth = `packages/*/src/` (host-agnostic libraries + backend-coupled business logic) + `plugins/*/hooks/` (host-thin entries). Every `dist/` is a committed build artifact — never hand-edit it.

```
packages/                            workspace libraries, single scope @transcodes-guard/*
  plugin-paths/      data/cache dir resolution        → .claude/rules/plugin-paths.md
  danger-patterns/   Bash regex pattern + MCP tool-rule registry → .claude/rules/danger-patterns.md
  mcp-server-core/   createServer() shell + danger-pattern tools/resources → .claude/rules/mcp-server.md
  hook-adapters/     per-host stdin/stdout JSON contract → .claude/rules/hooks.md
  gate-contract/     GateBackend DI interface + setGateBackend()/getGateBackend() registry
  stepup-core/       step-up MFA gate + evaluate() + token/backend client → .claude/rules/stepup-gate.md
  transcodes-mcp-tools/  member/org/RBAC/membership/passcode/auth-device/audit/meta/project/JWK MCP tools
  gate-backend/      the concrete GateBackend implementation the seams inject (only plugins/*/backend.ts may import it)

cli/                                 @bigstrider/transcodes-cli — human control plane (kill-switch, tokens, dashboard)

plugins/                             per-host deploy units (thin manifest + entry points)
  claude-code/       marketplace plugin; 4 hooks; stdio + http transports
  codex/             Codex CLI plugin; 4 hooks; stdio
  antigravity/       Antigravity plugin; 3 hooks (PreInvocation merges 2 events)
  cursor/            Cursor plugin; flat wire format; install.sh
```

The concrete gate backend (`gate-backend`) may be imported **only** by the plugin seams: each `plugins/*/backend.ts` imports `@transcodes-guard/gate-backend` to call `setGateBackend()`. Every other consumer goes through `getGateBackend()` from `@transcodes-guard/gate-contract`. biome's `noRestrictedImports` enforces this as an **error** (the seam is exempted via biome overrides).

Build, dist sync, and packaging → `.claude/rules/plugin-build.md`. Release and distribution → `.claude/rules/release-dist.md`.

### The `transcodes` CLI (`cli/`)

`@bigstrider/transcodes-cli` is a workspace member (`cli/`, bin `transcodes`) and the human's control plane for the gate. It is **excluded from the `transcodes-guard` brand rename** — it keeps its `@bigstrider/transcodes-cli` name and `transcodes` bin — but it consumes the shared `@transcodes-guard/*` packages like the plugins do. It owns the shared `~/.transcodes/` directory:

- `~/.transcodes/config.json` — token pool written by the CLI; hooks and MCP read via `resolveToken()`.
- `~/.transcodes/state/` — consolidated local plugin state.
- Commands: `transcodes enable | disable | status | tokens | set | reset`, plus the no-arg GUI dashboard.

The plugins/hooks **read** what the CLI manages (config, step-up tokens) — they do not reimplement token storage or the toggle. Path resolution is centralized in `@transcodes-guard/plugin-paths`; enable/disable semantics in `.claude/rules/stepup-gate.md`. The CLI version is independent of the plugin version train; each plugin declares compatibility via an optional `peerDependencies` range (`@bigstrider/transcodes-cli`, `>=0.3.0 <0.4.0`).

## Must

- Add MCP capabilities **only** in `createServer()` (`packages/mcp-server-core/src/server.ts`); plugin `src/*.ts` are thin transport wrappers. Validate every tool input with `zod` — LLM arguments are untrusted.
- Keep all gate / evaluate / message-formatting logic in `packages/stepup-core/`. Host divergence lives **only** in `packages/hook-adapters/`. Never inline gate logic into a plugin hook.
- New Transcodes-backend MCP tools go in `packages/transcodes-mcp-tools/` and are wired in via `GateBackend.registerBackendTools()`. New tool-rule policy entries go in `packages/danger-patterns/src/data/tool-rules.json`. Reach backend-coupled code only through the `getGateBackend()` seam, never by importing `gate-backend` directly.
- Run `npm run build:plugin` and commit every regenerated `dist/` in the same change.
- Resolve persist/cache paths only via `@transcodes-guard/plugin-paths` (`dataDir()` / `cacheDir()`) — never hardcode `~/.claude/...` or join `os.homedir()` directly.
- The step-up gate's enable/disable is **asymmetric**: enabling is safe for an agent, disabling requires a human. Read `.claude/rules/stepup-gate.md` before changing anything in that path.

## Never

- Use the deprecated positional `server.tool(...)` API or the SSE transport. Use `registerTool` / `registerResource` / `registerPrompt` and Streamable HTTP `/mcp`.
- Write to stdout under stdio (`console.log`, `process.stdout.write`) — it corrupts JSON-RPC framing. Log via `console.error`.
- Mutate state inside a Resource handler. Side effects belong in Tools.
- Duplicate the MCP server or the gate per plugin. One `createServer()`, one gate, host-specific adapters only.
- Drop `"private": true` from any `packages/*/package.json`. The publish-surface CI gate fails the build if you do (only `plugins/*` and `cli` are published).
- Import `@transcodes-guard/gate-backend` outside the `plugins/*/backend.ts` seams — biome fails the build (`noRestrictedImports` is an error). Use `getGateBackend()` from `@transcodes-guard/gate-contract` instead.

## See also

- User-facing install/usage (Korean) → `README.md`
