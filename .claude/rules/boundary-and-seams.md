---
description: The gate-backend import firewall, the contract re-export surface, and the load-bearing entry import order. Always relevant.
---

# Import boundary & seams

The single hardest-to-infer constraint in this repo: the concrete gate backend is quarantined behind a typed seam, and the quarantine is enforced by the build, not by convention.

## The import firewall

- `@transcodes-guard/gate-backend` may be imported **only** by the backend seams: `plugins/*/backend.ts` and `mcp/src/backend.ts` (the standalone npm MCP server is its own host, so it bootstraps the backend the same way a plugin does). Every other importer is a biome `noRestrictedImports` **error** — `biome check` runs without `--write` in CI, so any violation fails the build. biome matches only the literal specifier, so a CI grep step ("Firewall backstop" in `ci.yml`) additionally denies subpath/relative imports (`…/gate-backend/…`) outside the seams. The seam files are the sole `overrides` exemption (`biome.json`). One additional **codegen seam** is grep-exempted: `scripts/tool-metadata.mts` imports the gate-backend tool definition arrays at build time to derive the generated artifacts — metadata only, never bundled, handlers never invoked.
- Everything else reaches the backend through `getGateBackend()` (from `@transcodes-guard/core/contract`). When no backend is registered it returns `denyByDefaultBackend` (`core/src/contract/noop.ts`): its **hook** methods no-op/pass, but its **server-call** methods *throw* `gate backend not installed`. This is deliberate — a backend-less build type-checks and is provably never shipped as functional.

## The contract re-export surface

- `core/src/contract/` owns the `GateBackend` interface, the registry/noop, and the messages formatters; the wire types in `contract/types.ts` are **re-exports** from the owning domains (`../stepup/index.js`, `../patterns/index.js`). Consumers keep importing from `@transcodes-guard/core/contract` — the import spec is stable — and now share the domains' single declarations, including the **runtime** `GATE_DECISION_KIND` object (hook `switch`es and `evaluate.ts` branch on the same constant). The hand-mirrored declarations and the "drift alarm" framing were retired when the #175 consolidation put source and mirror in one package.
- Only **contract-only types** (no domain original, e.g. `PolicyBundleRefreshOutcome`) are declared directly in `types.ts`, each with a comment saying why it lives there.
- Direction is one-way: contract → domains. **`stepup/` and `patterns/` must never import from `contract/`** — that would open a cycle through the re-exports. (Convention, reviewed not build-enforced.)
- The `transcodesGateBackend: GateBackend` annotation in `packages/gate-backend/src/index.ts` stays as an ordinary implements-the-contract type check: a signature drift in the private implementation still fails that build.

## Config-less interface

`GateBackend`'s server-path methods (`createStepupSession`, `assertRbacCoordinate`, `pollStepupSession`, …) take only domain args and load `StepupConfig` **internally** inside `gate-backend`, so the backend-coupled `StepupConfig` never crosses to the public side. Backend error classes are hidden behind `is*Error(e)` predicates (`isRbacCoordinateError`, `isToolRuleValidationError`) — exporting a class for `instanceof` would leak it. Do **not** add a `StepupConfig` parameter or export an error class on this interface.

## Load-bearing entry import order

Every plugin hook and transport entry must begin with these two static imports, **in this order, before any `@transcodes-guard/*` import**:

```ts
import '../host.js';     // claims TRANSCODES_GUARD_HOST as a side effect
import '../backend.js';  // calls setGateBackend() so getGateBackend() resolves real
```

Why the order matters: the `core/hosts` barrel re-exports all four adapters, so whichever module sets `TRANSCODES_GUARD_HOST` last would clobber the others — `host.ts` must win first. Adapter files themselves must **never** set `TRANSCODES_GUARD_HOST`; host identity is claimed only by each plugin's `host.ts`.
