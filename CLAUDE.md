# transcodes-guard (monorepo)

Risky-shell interceptor + step-up MFA audit MCP server, shipped as plugins for **Claude Code**, **OpenAI Codex CLI**, **Google Antigravity 2.0**, and **Cursor IDE**. All four share one MCP server core and one gate via npm workspaces — a new host is a new adapter + a thin plugin shell, never a duplicated gate. The gate intercepts a risky Bash command (or a protected MCP tool call) in the PreToolUse hook and forces a WebAuthn step-up against the Transcodes backend before the command runs.

Commands live in `package.json` scripts (`build:plugin`, `dev:*`, `check`, `type-check`, …). The non-obvious constraints around them are in the rules files below — read those, not a copy here.

## Must

- **`dist/` is a committed artifact, but you don't have to rebuild it on feature branches.** Bundles run from a git clone with no `node_modules`, and freshness is guaranteed at release (`release.yml` rebuilds + commits on the Release PR). Mid-cycle stale `dist/` on `dev` is harmless — hosts install from a release tag. Rebuild (`npm run build:plugin`) only when you want to verify locally. → [.claude/rules/build-and-entries.md](.claude/rules/build-and-entries.md)
- **Add MCP capabilities only in `createServer()`** (`packages/core/src/server/server.ts`); plugin `src/*.ts` are thin transport wrappers. → [.claude/rules/mcp-and-hosts.md](.claude/rules/mcp-and-hosts.md)
- **Keep all gate/evaluate/message-formatting logic in `packages/core/src/stepup/`.** Host divergence lives only in `packages/core/src/hosts/`. → [.claude/rules/gate-security-model.md](.claude/rules/gate-security-model.md), [.claude/rules/mcp-and-hosts.md](.claude/rules/mcp-and-hosts.md)
- **Reach backend-coupled code only through `getGateBackend()`** (`@transcodes-guard/core/contract`), never by importing `gate-backend`. → [.claude/rules/boundary-and-seams.md](.claude/rules/boundary-and-seams.md)
- **Resolve persist/cache paths only via `@transcodes-guard/core/paths`** (`dataDir()`/`cacheDir()`). `~/.transcodes/` is owned by the CLI; plugin state lives in `~/.transcodes/state/`. → [.claude/rules/policy-and-state.md](.claude/rules/policy-and-state.md)
- **New backend MCP tools** go in `packages/gate-backend/src/mcp-tools/` (wired via `GateBackend.registerBackendTools()`); **new tool-rule policy** goes in `packages/core/src/patterns/data/tool-rules.json`. → [.claude/rules/policy-and-state.md](.claude/rules/policy-and-state.md)
- **The step-up enable/disable is asymmetric**: enabling is safe for an agent, disabling requires a human (the human-only control plane is the `transcodes` CLI). → [.claude/rules/gate-security-model.md](.claude/rules/gate-security-model.md)

## Never

- **Import `@transcodes-guard/gate-backend` outside the seams (`plugins/*/backend.ts`, `mcp/src/backend.ts`)** — biome + the CI firewall backstop fail the build. → [.claude/rules/boundary-and-seams.md](.claude/rules/boundary-and-seams.md)
- **Drop `"private": true` from any `packages/*/package.json`** — the publish-surface CI gate fails the build (only `plugins/*` and `cli` publish). → [.claude/rules/release-branch-model.md](.claude/rules/release-branch-model.md)
- **`exit 2` from a hook** — a deny travels in the JSON body with `exit(0)` on every host. → [.claude/rules/mcp-and-hosts.md](.claude/rules/mcp-and-hosts.md)
- **Duplicate the MCP server or the gate per plugin.** One `createServer()`, one gate, host-specific adapters only.

## Architecture

`packages/*/src/` (host-agnostic libraries + backend-coupled logic) + `plugins/*/hooks/` (host-thin entries) are the source of truth; every `dist/` is a committed build artifact — never hand-edit it. The package and plugin lists are in the workspace globs of `package.json`; what each one does is documented in the rule file that governs it. The `transcodes` CLI (`cli/`, `@bigstrider/transcodes-cli`) is the human's control plane and owns the shared `~/.transcodes/` directory.

There are exactly **two** `packages/*`, and the boundary between them is the one the build actually enforces (biome import firewall, `private:true` publish gate). Everything else is a directory, not a package:

| Package | Subpath / dir | What it is |
|---|---|---|
| **`@transcodes-guard/core`** (public) | `contract/` | The DI interface the public side (hooks + `server/`) compiles against. Backend injected at runtime via `setGateBackend()`. Import as `@transcodes-guard/core/contract`. |
| | `stepup/` | The gate/evaluate logic. (`@transcodes-guard/core/stepup`) |
| | `server/` | The single `createServer()` MCP surface. (`@transcodes-guard/core/server`) |
| | `patterns/` | Shared danger-pattern/tool-rule registry + system rule JSON. (`@transcodes-guard/core/patterns`) |
| | `hosts/` | Per-host stdin/stdout wire adapters — the only place host divergence lives. (`@transcodes-guard/core/hosts`) |
| | `paths/` | Host-agnostic state-path resolution (`dataDir()`/`cacheDir()` — every host resolves to `~/.transcodes/state/`). (`@transcodes-guard/core/paths`) |
| **`@transcodes-guard/gate-backend`** (private) | `src/` + `src/mcp-tools/` | The concrete `GateBackend` + the Transcodes-API MCP tools it registers. Reachable only across the seam (`getGateBackend()`); importing `gate-backend` directly is a biome error. Separate package because the firewall needs a bannable import spec and `build:cdn` bundles it alone. |

The public-core ↔ `gate-backend` split is the firewall's whole reason to exist (see [[boundary-and-seams]]) and must never be merged. Directory boundaries inside `core/src/` are convention (reviewed, not build-enforced) — keep cross-domain imports pointed at each domain's `index.js` barrel.

## Rules index

- **[boundary-and-seams](.claude/rules/boundary-and-seams.md)** — the gate-backend import firewall, the contract re-export surface, the load-bearing entry import order (always-on)
- **[gate-security-model](.claude/rules/gate-security-model.md)** — asymmetric fail policy, fail-closed RBAC, no-side-effects-before-stdout, bundle integrity
- **[stepup-consume](.claude/rules/stepup-consume.md)** — single-shot verified-record lifecycle: who consumes, which store file, when to trust
- **[mcp-and-hosts](.claude/rules/mcp-and-hosts.md)** — capability registration, non-dry-run MCP tools, per-host wire-format divergence
- **[policy-and-state](.claude/rules/policy-and-state.md)** — rule registry semantics, consolidated `~/.transcodes/state/` ownership
- **[build-and-entries](.claude/rules/build-and-entries.md)** — committed-dist discipline, non-reproducible bundles, tsup inlining, per-host entry layout
- **[release-branch-model](.claude/rules/release-branch-model.md)** — `dev`/`prod` promotion, version train (CLI excluded), per-host deploy divergence

## See also

- User-facing install/usage → `README.md` (English), `README.ko.md` (Korean)
