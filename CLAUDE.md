# transcodes-guard (monorepo)

Risky-shell interceptor + step-up MFA audit MCP server, shipped as plugins for **Claude Code**, **OpenAI Codex CLI**, **Google Antigravity 2.0**, and **Cursor IDE**. All four share one MCP server core and one gate via npm workspaces — a new host means a new adapter + a thin plugin shell, never a duplicated gate.

The gate intercepts a risky Bash command (or a protected MCP tool call) in the PreToolUse hook and forces a WebAuthn step-up against the Transcodes backend before the command runs.

## Essential commands

```bash
npm install            # workspace hoist (packages/* + plugins/* + private-packages/*)
npm run build:plugin   # turbo: build packages, then bundle plugins (tsup) — regenerates committed dist/
npm run dev:stdio      # tsx stdio transport (Claude Code plugin) for Inspector / external MCP clients
npm run dev:http       # tsx Streamable HTTP transport, port 3000 /mcp
npm run dev:hook       # run the PreToolUse hook once from stdin JSON
npm run inspect        # MCP Inspector UI against the stdio server
npm run check          # biome check --write (lint + format + organize-imports)
npm run format         # biome format --write (format only)
npm run type-check     # turbo run type-check — tsc --noEmit across every package
```

After any source change, run `npm run build:plugin` and commit the regenerated `dist/`. CI fails on `dist/` drift across **six** locations (`packages/*/dist/` + `private-packages/*/dist/` + each of the four `plugins/*/dist/`) and on the **23** hook smoke tests (claude-code 9 + codex 3 + antigravity 5 + cursor 6).

Lefthook is installed automatically on `npm install` (postinstall). It runs biome format+check on staged files at `pre-commit` and `npm run type-check` at `pre-push`. CI also runs `biome check --reporter=github` and a publish-surface gate that asserts every `private-packages/*` member stays marked `"private": true`.

## Architecture

Source of truth = `packages/*/src/` + `private-packages/*/src/` (host-agnostic) + `plugins/*/hooks/` (host-thin entries). Every `dist/` is a committed build artifact — never hand-edit it.

```
packages/                            PUBLIC, host-agnostic workspace libraries
  plugin-paths/      data/cache dir resolution        → .claude/rules/plugin-paths.md
  danger-patterns/   Bash regex pattern registry      → .claude/rules/danger-patterns.md
  mcp-server-core/   createServer() shell + danger-pattern tools/resources → .claude/rules/mcp-server.md
  hook-adapters/     per-host stdin/stdout JSON contract → .claude/rules/hooks.md
  cli/               @bigstrider/transcodes-cli — human control plane (kill-switch, tokens, dashboard)

private-packages/                    PRIVATE business logic (Transcodes backend coupling)
  stepup-core/             step-up MFA gate + evaluate() + token/backend client → .claude/rules/stepup-gate.md
  transcodes-mcp-tools/    member/org/RBAC/membership/passcode/auth-device/audit/meta/project/JWK MCP tools
  danger-rules/            MCP tool-rule registry (toolName ↔ stepupAction/Resource policy mapping)

plugins/                             per-host deploy units (thin manifest + entry points)
  claude-code-ai-action-tracker/     marketplace plugin; 4 hooks; stdio + http transports
  codex-ai-action-tracker/           Codex CLI plugin; 4 hooks; stdio
  antigravity-ai-action-tracker/     Antigravity plugin; 3 hooks (PreInvocation merges 2 events)
  cursor-ai-action-tracker/          Cursor plugin; flat wire format; install.sh
```

Public packages may import `@transcodes-guard-private/*` during phase 1 (warned by biome's `noRestrictedImports`). Phase 2 will introduce a DI interface so the public side can build standalone, and the warn will be promoted to an error. Background and target end-state: `docs/research/public-private-split.md` + `docs/research/public-private-mapping.md`.

Build, dist sync, and packaging → `.claude/rules/plugin-build.md`. Release and distribution → `.claude/rules/release-dist.md`.

### The `transcodes` CLI (`packages/cli/`)

`@bigstrider/transcodes-cli` is a workspace member (`packages/cli/`, bin `transcodes`) and the human's control plane for the gate. It is **excluded from the `transcodes-guard` brand rename** — it keeps its `@bigstrider/transcodes-cli` name and `transcodes` bin — but it consumes the shared `@transcodes-guard/*` packages like the plugins do. It owns the shared `~/.transcodes/` directory:

- `~/.transcodes/config.json` — the `enabled` kill-switch flag (CLI-owned; hooks read it). Absent/corrupt = enabled.
- `~/.transcodes/state/` — consolidated local plugin state.
- Commands: `transcodes enable | disable | status | tokens | set | reset`, plus the no-arg GUI dashboard.

The plugins/hooks **read** what the CLI manages (config, step-up tokens) — they do not reimplement token storage or the toggle. Path resolution is centralized in `@transcodes-guard/plugin-paths`; enable/disable semantics in `.claude/rules/stepup-gate.md`. The CLI version is independent of the plugin version train; each plugin declares compatibility via an optional `peerDependencies` range (`@bigstrider/transcodes-cli`, `>=0.3.0 <0.4.0`).

## Must

- Add MCP capabilities **only** in `createServer()` (`packages/mcp-server-core/src/server.ts`); plugin `src/*.ts` are thin transport wrappers. Validate every tool input with `zod` — LLM arguments are untrusted.
- Keep all gate / evaluate / message-formatting logic in `private-packages/stepup-core/`. Host divergence lives **only** in `packages/hook-adapters/`. Never inline gate logic into a plugin hook.
- New Transcodes-backend MCP tools go in `private-packages/transcodes-mcp-tools/` and are wired into `createServer()` via the package's `register*Tools` exports. New tool-rule policy entries go in `private-packages/danger-rules/src/data/tool-rules.json`. Never re-add backend-coupled code under `packages/`.
- Run `npm run build:plugin` and commit all six `dist/` locations in the same change (5 public + 3 private).
- Resolve persist/cache paths only via `@transcodes-guard/plugin-paths` (`dataDir()` / `cacheDir()`) — never hardcode `~/.claude/...` or join `os.homedir()` directly.
- The step-up gate's enable/disable is **asymmetric**: enabling is safe for an agent, disabling requires a human. Read `.claude/rules/stepup-gate.md` before changing anything in that path.

## Never

- Use the deprecated positional `server.tool(...)` API or the SSE transport. Use `registerTool` / `registerResource` / `registerPrompt` and Streamable HTTP `/mcp`.
- Write to stdout under stdio (`console.log`, `process.stdout.write`) — it corrupts JSON-RPC framing. Log via `console.error`.
- Mutate state inside a Resource handler. Side effects belong in Tools.
- Duplicate the MCP server or the gate per plugin. One `createServer()`, one gate, host-specific adapters only.
- Drop `"private": true` from any `private-packages/*/package.json`. The publish-surface CI gate fails the build if you do.

## See also

- Design intent (why split transports, why Streamable HTTP, auth gap) → `docs/architecture.md`
- Add a capability step-by-step → `docs/adding-capabilities.md`
- Manual hook install (no plugin) → `docs/hook-installation.md`
- Multi-host distribution research + deploy plan → `docs/research/multi-host-plugin-distribution.md`
- User-facing install/usage (Korean) → `README.md`
