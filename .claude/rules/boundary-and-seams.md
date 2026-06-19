---
description: The gate-backend import firewall, the mirrored-contract drift alarm, and the load-bearing entry import order. Always relevant.
---

# Import boundary & seams

The single hardest-to-infer constraint in this repo: the concrete gate backend is quarantined behind a typed seam, and the quarantine is enforced by the build, not by convention.

## The import firewall

- `@transcodes-guard/gate-backend` may be imported **only** by `plugins/*/backend.ts`. Every other importer is a biome `noRestrictedImports` **error** — `biome check` runs without `--write` in CI, so any violation fails the build. The seam files are the sole `overrides` exemption (`biome.json`).
- Everything else reaches the backend through `getGateBackend()` (from `@transcodes-guard/gate-contract`). When no backend is registered it returns `denyByDefaultBackend` (`gate-contract/src/noop.ts`): its **hook** methods no-op/pass, but its **server-call** methods *throw* `gate backend not installed`. This is deliberate — a backend-less build type-checks and is provably never shipped as functional.

## The mirrored-contract drift alarm

- `gate-contract/src/types.ts` **re-declares** (mirrors) the backend's structural shapes by hand rather than importing them — the import firewall is about not pulling in `gate-backend`, not about avoiding every cross-package type. (It does import a couple of pure value-vocabulary types like `MergedPattern`/`RbacAction` from `danger-patterns`.) Do **not** "fix" the mirrored shapes by importing the backend's versions across the seam — the duplication is intentional.
- The drift detector is the `transcodesGateBackend: GateBackend` annotation in `gate-backend/src/index.ts`. TypeScript structural typing makes *that* package fail to build if a private shape drifts from the mirrored contract. Editing one side without the other is the intended alarm. Keep both sides in sync by hand.

## Config-less interface

`GateBackend`'s server-path methods (`createStepupSession`, `assertRbacCoordinate`, `pollStepupSession`, …) take only domain args and load `StepupConfig` **internally** inside `gate-backend`, so the backend-coupled `StepupConfig` never crosses to the public side. Backend error classes are hidden behind `is*Error(e)` predicates (`isRbacCoordinateError`, `isToolRuleValidationError`) — exporting a class for `instanceof` would leak it. Do **not** add a `StepupConfig` parameter or export an error class on this interface.

## Load-bearing entry import order

Every plugin hook and transport entry must begin with these two static imports, **in this order, before any `@transcodes-guard/*` import**:

```ts
import '../host.js';     // claims TRANSCODES_GUARD_HOST as a side effect
import '../backend.js';  // calls setGateBackend() so getGateBackend() resolves real
```

Why the order matters: the `hook-adapters` barrel re-exports all four adapters, so whichever module sets `TRANSCODES_GUARD_HOST` last would clobber the others — `host.ts` must win first. Adapter files themselves must **never** set `TRANSCODES_GUARD_HOST`; host identity is claimed only by each plugin's `host.ts`.
