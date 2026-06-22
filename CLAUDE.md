# transcodes-guard (monorepo)

Risky-shell interceptor + step-up MFA audit MCP server, shipped as plugins for **Claude Code**, **OpenAI Codex CLI**, **Google Antigravity 2.0**, and **Cursor IDE**. All four share one MCP server core and one gate via npm workspaces — a new host is a new adapter + a thin plugin shell, never a duplicated gate. The gate intercepts a risky Bash command (or a protected MCP tool call) in the PreToolUse hook and forces a WebAuthn step-up against the Transcodes backend before the command runs.

Commands live in `package.json` scripts (`build:plugin`, `dev:*`, `check`, `type-check`, …). The non-obvious constraints around them are in the rules files below — read those, not a copy here.

## Must

- **`dist/` is a committed artifact, but you don't have to rebuild it on feature branches.** Bundles run from a git clone with no `node_modules`, and freshness is guaranteed at release (`release.yml` rebuilds + commits on the Release PR). Mid-cycle stale `dist/` on `main` is harmless — hosts install from a release tag. Rebuild (`npm run build:plugin`) only when you want to verify locally. → [.claude/rules/build-and-entries.md](.claude/rules/build-and-entries.md)
- **Add MCP capabilities only in `createServer()`** (`packages/mcp-server-core/src/server.ts`); plugin `src/*.ts` are thin transport wrappers. → [.claude/rules/mcp-and-hosts.md](.claude/rules/mcp-and-hosts.md)
- **Keep all gate/evaluate/message-formatting logic in `packages/stepup-core/`.** Host divergence lives only in `packages/hook-adapters/`. → [.claude/rules/gate-security-model.md](.claude/rules/gate-security-model.md), [.claude/rules/mcp-and-hosts.md](.claude/rules/mcp-and-hosts.md)
- **Reach backend-coupled code only through `getGateBackend()`** (`@transcodes-guard/gate-contract`), never by importing `gate-backend`. → [.claude/rules/boundary-and-seams.md](.claude/rules/boundary-and-seams.md)
- **Resolve persist/cache paths only via `@transcodes-guard/plugin-paths`** (`dataDir()`/`cacheDir()`). `~/.transcodes/` is owned by the CLI; plugin state lives in `~/.transcodes/state/`. → [.claude/rules/policy-and-state.md](.claude/rules/policy-and-state.md)
- **New backend MCP tools** go in `packages/transcodes-mcp-tools/` (wired via `GateBackend.registerBackendTools()`); **new tool-rule policy** goes in `packages/danger-patterns/src/data/tool-rules.json`. → [.claude/rules/policy-and-state.md](.claude/rules/policy-and-state.md)
- **The step-up enable/disable is asymmetric**: enabling is safe for an agent, disabling requires a human (the human-only control plane is the `transcodes` CLI). → [.claude/rules/gate-security-model.md](.claude/rules/gate-security-model.md)

## Never

- **Import `@transcodes-guard/gate-backend` outside `plugins/*/backend.ts`** — biome fails the build. → [.claude/rules/boundary-and-seams.md](.claude/rules/boundary-and-seams.md)
- **Drop `"private": true` from any `packages/*/package.json`** — the publish-surface CI gate fails the build (only `plugins/*` and `cli` publish). → [.claude/rules/release-branch-model.md](.claude/rules/release-branch-model.md)
- **`exit 2` from a hook** — a deny travels in the JSON body with `exit(0)` on every host. → [.claude/rules/mcp-and-hosts.md](.claude/rules/mcp-and-hosts.md)
- **Duplicate the MCP server or the gate per plugin.** One `createServer()`, one gate, host-specific adapters only.

## Architecture

`packages/*/src/` (host-agnostic libraries + backend-coupled logic) + `plugins/*/hooks/` (host-thin entries) are the source of truth; every `dist/` is a committed build artifact — never hand-edit it. The package and plugin lists are in the workspace globs of `package.json`; what each one does is documented in the rule file that governs it. The `transcodes` CLI (`cli/`, `@bigstrider/transcodes-cli`) is the human's control plane and owns the shared `~/.transcodes/` directory.

The eight `packages/*` are not eight loose domains — they sit in **four layers**, and the layer boundaries are enforced by the build (biome import firewall, `private:true` publish gate), not by convention. Read a package's role from its layer, not its name:

| Layer | Packages | What it is |
|---|---|---|
| **Public DI contract** | `gate-contract` | The interface the public side (hooks + `mcp-server-core`) compiles against. Backend injected at runtime via `setGateBackend()`. |
| **Private backend** | `gate-backend`, `transcodes-mcp-tools` | The concrete `GateBackend` (`gate-backend` composes the others) + the Transcodes-API MCP tools it registers. Reachable only across the seam (`getGateBackend()`); importing `gate-backend` directly is a biome error. |
| **Host-agnostic core** | `stepup-core`, `mcp-server-core`, `danger-patterns` | The gate logic, the `createServer()` MCP surface, and the shared danger-pattern/tool-rule registry. No host or backend coupling. |
| **Host adapters** | `hook-adapters`, `plugin-paths` | Per-host stdin/stdout wire formats and per-host path resolution — the only place host divergence lives. |

The `gate-contract` ↔ `gate-backend` split is the firewall's whole reason to exist (see [[boundary-and-seams]]) and must never be merged; the count is load-bearing, not incidental.

## Rules index

- **[boundary-and-seams](.claude/rules/boundary-and-seams.md)** — the gate-backend import firewall, the mirrored-contract drift alarm, the load-bearing entry import order (always-on)
- **[gate-security-model](.claude/rules/gate-security-model.md)** — asymmetric fail policy, fail-closed RBAC, no-side-effects-before-stdout, bundle integrity
- **[stepup-consume](.claude/rules/stepup-consume.md)** — single-shot verified-record lifecycle: who consumes, which store file, when to trust
- **[mcp-and-hosts](.claude/rules/mcp-and-hosts.md)** — capability registration, non-dry-run MCP tools, per-host wire-format divergence
- **[policy-and-state](.claude/rules/policy-and-state.md)** — rule registry semantics, consolidated `~/.transcodes/state/` ownership
- **[build-and-entries](.claude/rules/build-and-entries.md)** — committed-dist discipline, non-reproducible bundles, tsup inlining, per-host entry layout
- **[release-branch-model](.claude/rules/release-branch-model.md)** — `main`/`prod` promotion, version train (CLI excluded), per-host deploy divergence

## See also

- User-facing install/usage → `README.md` (English), `README.ko.md` (Korean)
