---
description: The danger-pattern / tool-rule registry semantics and the consolidated ~/.transcodes state ownership. Replaces the now-stale plugin-paths doc.
paths:
  - "packages/core/src/patterns/**"
  - "packages/core/src/paths/**"
---

# Policy registry & state ownership

## Rule registry (`core/src/patterns`)

- **Embed system rule JSON via static import** with `with { type: 'json' }` (`./data/danger-patterns.json`, `./data/tool-rules.json`, `./data/builtin-exempt/*.json`) — never read it at runtime, and keep the JSON under `src/patterns/data/` (the build copies it to `dist/patterns/data/`).
- **`builtin-exempt/{claude,codex,cursor,antigravity}.json` is an allowlist with hard entry criteria** (t2): grade ① conversation/plan + ② workspace-read tools only; exact case-sensitive names — no regex/prefix/case-fold, no `mcp__` prefix, no shell metacharacters, `reason` required; exec/write wire names (`Bash`, `Shell`, `exec_command`, `apply_patch`, `parallel`, `write_stdin`, `run_command`, `call_mcp_tool`, `terminal*`) must never appear. The lists are compiled into the dist bundle and never merged with runtime state — runtime extension is impossible by design. Invariants are pinned by `packages/core/test/builtin-exempt.test.ts`; every entry is exercised end-to-end by e2e scenario A1.
- **System rule ids are reserved**: `validateNewToolRule` throws if a remote/bundle rule reuses a system id. Yet the merge layer (`loadMergedToolRules`) keys by id and lets a later (bundle) layer **replace** an earlier (system) rule of the same id. These coexist because authoring goes through `validateNewToolRule` (blocks reuse) while the bundle merge does **not** re-validate.
- **Bash regex matches the FULL command string** (`new RegExp(p.regex).test(command)`) — no token/argument extraction. Comments, quoted args, and heredocs all match. A pattern keyed on a bare word that also appears as a repo identifier (the repo dir, the `transcodes-guard` package name, or the `transcodes` CLI) false-positives pervasively — anchor on command-start.
- **Invalid regex is silently swallowed** (`try/catch {}`) and the rule is skipped, not thrown. Bundle rules are assumed pre-validated on write, so a corrupt cached rule degrades to no-match.
- **Bash-type rules** are forced to `matcher:'regex'`, require both `action` and `resource`, and put the regex in the **`name`** field (no separate pattern field). **MCP-type rules** reject a `name` containing shell metacharacters `[\s|&;<>$*()`\/]`. There is **no local user-patterns.json** authoring surface — remote bash/MCP rules are written through backend APIs (`add_user_pattern` / `add_tool_rule`).
- Rule `id` must match `/^[a-z0-9][a-z0-9-]*$/` — enforced in `validateNewToolRule`, *not* in the schema/types.
- Missing RBAC fields **coerce to defaults** rather than erroring: `DEFAULT_RBAC_RESOURCE='system'`, `DEFAULT_RBAC_ACTION='update'` (`coerceRbacAction`/`coerceRbacResource` backfill legacy records).
- `consume_in_hook` is **dead policy** (t3): nothing reads it. It stays in the rule shape so existing bundle rules and backend verdicts still parse, but there is no local verified record left for either side to consume — the backend owns verified state and the handler backstop claims an in-memory sid instead. Do not branch on it, and do not restore the removed `mcpConsumesInHook` source-default helper. See [[gate-security-model]].

## State ownership (`core/src/paths`)

> Path resolution is fully centralized here. Never join `os.homedir()` or hardcode `~/.claude/...` anywhere outside this directory — with two deliberate exceptions: `core/src/stepup/token-store.ts` reads the CLI-owned `~/.transcodes/config.json` directly (read-only, documented in its header), and the standalone `plugins/*/install.mjs` scripts resolve host config dirs (they run from a bare clone with no workspace imports).

- **All plugin-managed local state resolves to one fixed path: `~/.transcodes/state/`, regardless of host.** `dataDir()` and `cacheDir()` are currently **identical** (both return `stateDir()`). `detectHost()` and `CLAUDE_PLUGIN_DATA` no longer affect path resolution — they survive only as migration-source / host-identity. *(This supersedes any older description of `CLAUDE_PLUGIN_DATA` isolation or a `~/.claude` fallback.)*
- **`~/.transcodes/` is owned by the external CLI** (`@bigstrider/transcodes-cli`): `config.json` (token + enable flag, dir `0700` / file `0600`) is CLI-written; hooks/MCP only **read** it. Plugin files go one level down in `~/.transcodes/state/` (via `dataDir()`/`cacheDir()`) and must never land in the `~/.transcodes/` root.
- The long-lived member token lives in `~/.transcodes/config.json`, **not** the cache dir — so it survives cache cleanup and is discoverable by the MCP server plus four hook subprocesses that don't inherit a GUI host's shell env. `resolveToken` reads strictly file → `null`: the CLI-written `~/.transcodes/config.json` is the single source of truth (there is no `TRANSCODES_TOKEN` env path). Adding a token requires a mandatory label; readers never throw on a malformed file (return `null`/empty).
- `migrateLegacyFile` is **fail-open**: every IO error is swallowed and the `kind` arg (`'data'|'cache'`) is *ignored* (both consolidate into `state`). Call it at the **first read** entry point of any new persistent file; it renames the migrated source to `<name>.bak` for idempotent re-runs.
