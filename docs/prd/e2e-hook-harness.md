# E2E Hook Harness — Codify the Mock-Backend Gate Verification

Status: **Draft**
Date: 2026-07-03
Scope: new top-level `e2e/` directory, `package.json` scripts, `.github/workflows/ci.yml`

## 1. Background & motivation

### 1.1 What exists

Two verification layers cover the gate today, with a gap between them:

- **Unit tests** (`packages/stepup-core/test/*.test.ts`) call
  `evaluatePreToolUse()` in-process with a mock HTTP server. High fidelity on
  gate *logic*, zero fidelity on the *deploy unit* — they never execute the
  committed `dist/` bundles hosts actually run.
- **CI smoke tests** (20 inline steps in `ci.yml`) pipe static JSON into the
  compiled hooks. They run the real deploy unit but cover only single-shot,
  backend-less paths: no `/guard/evaluate` verdict, no verified fast-path, no
  Stop-loop iteration, and assertions are `grep` one-liners inside YAML.

### 1.2 What the PR #154 verification proved

The hotfix verification (2026-07-03, ad-hoc scripts in a session scratchpad)
drove the compiled `plugins/claude-code/dist/hooks/{pre-tool-use,stop}.js`
against a scripted mock backend and covered what neither layer can:

- challenge → verified-record write → retry → **explicit
  `permissionDecision:"allow"`** (the contract that defends against host
  settings deny rules — `.claude/rules/mcp-and-hosts.md`);
- cross-tool fingerprint isolation (a verified record for tool A must not
  unlock tool B) — the exact class of the v0.32.0 security regression;
- Stop-reminder cap across four sequential hook processes (file-persisted
  `remindedCount`);
- fail-closed probes (unreachable backend, garbage stdin) at the process
  boundary.

It also hit real pitfalls worth encoding, not re-discovering: a stale mock
process on a fixed port silently served a stale contract (EADDRINUSE →
wrong-shape poll response → false FAIL), and the browser-launch side effect
must be suppressed by pre-claiming the fingerprint lock — there is no env
kill-switch, deliberately.

### 1.3 Goal

Promote that ad-hoc harness into a committed, CI-run e2e suite whose subject
is the **committed dist bundles** — the actual deploy unit per
`.claude/rules/build-and-entries.md`.

## 2. Design

### 2.1 Location: top-level `e2e/`, not a workspace package

`e2e/` sits outside `packages/*` and `plugins/*` globs:

- it must never be publishable or importable (the publish-surface CI gate and
  the four-layer packages architecture stay untouched);
- it needs no build — files run under `node --test` with `tsx` (already a
  transitive dev tool; add to root `devDependencies` if not).
- it depends on nothing from the workspace at runtime: it spawns dist
  bundles as child processes and speaks HTTP + filesystem.

```
e2e/
  harness/
    mock-backend.ts    # scriptable backend double
    hook-runner.ts     # spawn a dist hook with stdin/env, capture stdout/stderr/exit
    state.ts           # temp HOME, fake JWT, state-file readers, browser-lock pre-claim
    wire.ts            # per-host stdout assertions (hookSpecificOutput vs flat vs continue)
  scenarios/
    gate-claude-code.test.ts
    gate-codex.test.ts
    gate-cursor.test.ts
    gate-antigravity.test.ts
    stop-loop.test.ts
    fastpath.test.ts
```

### 2.2 Harness contracts

**`mock-backend.ts`** — one instance per test, **ephemeral port**
(`listen(0)`), returned URL injected via `TRANSCODES_BACKEND_URL`. Never a
fixed port (the EADDRINUSE/stale-contract incident is the reason). API:

```ts
const be = await mockBackend({
  evaluate: (req) => verdict({ permission: 2 }),      // or a per-call queue
  poll:     (sid) => ({ status: 'verified' }),
});
be.requests   // recorded [{method, path, body}] for payload assertions
await be.close();
```

Payload assertions matter as much as verdicts: the raw-payload contract
(`payload` + optional `tool_name` in the POST body) is only observable here.

**`hook-runner.ts`** — `runHook(hostDistEntry, stdin, env)` →
`{ stdout, stderr, exitCode }`. Always captures stderr separately (the
2>/dev/null in the ad-hoc harness hid diagnostic lines during triage).

**`state.ts`** — `withTempHome(async (home) => ...)` creates and removes an
isolated `$HOME`; helpers: `writeFakeToken()`, `claimBrowserLock(fpKey)`
(computes `fingerprintOf` locally — sha256 first 16 hex — and pre-claims so
`launchStepupBrowser` never spawns), `readPending(fp)`, `readVerified(fp)`,
`simulatePollToolWrites(sid, fp)` (verified record + pending status flip, the
same writes `poll_stepup_session_wait` performs).

**`wire.ts`** — per-host decision parsing so scenarios assert semantics, not
strings: `expectDeny(host, stdout)`, `expectExplicitAllow(host, stdout)`,
`expectSilentPass(stdout)` (empty stdout — which is *only* legal for
`proceed-ungated`), `expectStopBlock(host, stdout)`. Encodes the divergences
from `.claude/rules/mcp-and-hosts.md` (Cursor flat output, Antigravity
`decision:"continue"` inversion) exactly once.

### 2.3 Scenario matrix (initial set = the PR #154 session, generalized)

| # | Scenario | Asserts |
|---|---|---|
| E1 | meta tool (each name in the exemption list) | silent pass, zero state files, zero backend requests |
| E2 | two tools, session-constant payload prefix | 2 denies, 2 distinct FP-keyed pendings, `command` leads with tool name |
| E3 | full step-up loop: challenge → poll writes → same-call retry | **explicit allow JSON**, state fully consumed, Stop silent after |
| E4 | cross-tool isolation: verified(A) then call B | B re-challenged, A's record intact |
| E5 | Stop loop | 3 blocks with tool-neutral wording, 4th silent; fresh pending resets the cap |
| E6 | fail-closed probes | unreachable backend → deny (create-failed); garbage stdin → deny; no crash |
| E7 | raw-payload contract | recorded POST body carries the verbatim hook stdin as `payload` + `tool_name` |
| E8 | in-flight pending reuse (F3) | second identical challenge re-issues the same sid, no second backend session |

Rows E1–E8 run per host where the wire format applies; host-specific stdin
fixtures live next to each `gate-<host>.test.ts` (Antigravity's
`CommandLine`/`call_mcp_tool` unwrap, Cursor's top-level `command` form).

### 2.4 What the harness must NOT do

- No production env flags for testability (`TRANSCODES_GUARD_TEST_TRUST` is
  used only where CI smokes already use it; the fast-path scenarios mock the
  poll recheck instead — higher fidelity, no trust bypass).
- No imports from `packages/*/src` — the moment it imports gate code
  in-process it degrades into a second unit-test suite. The only allowed
  duplication is `fingerprintOf` (3 lines, pinned by E2's disk-filename
  assertion — if the algorithm drifts, the test fails loudly).
- No byte-level dist assertions (bundles are non-reproducible by design).

## 3. CI & scripts

- `npm run test:e2e` → `node --import tsx --test e2e/scenarios/`. Local runs
  require a prior `npm run build:plugin` (documented in the script's echo);
  CI already rebuilds dist fresh before the smoke steps, so the e2e job step
  slots directly after `build:plugin`, before the inline smokes.
- Phase 1 keeps all 20 inline smokes. Phase 3 deletes only those that became
  strict subsets of an e2e scenario (tracked per smoke in the removal PR);
  the gitignore-existence guard and the regex-block smoke stay in YAML — they
  guard the build, not gate behavior.

## 4. Phases

| Phase | Deliverable | Verify |
|---|---|---|
| P1 | harness + `gate-claude-code` + `fastpath` + `stop-loop` (E1–E8, claude-code only) | suite red on v0.32.0 dist (`git checkout 4e3c954 -- plugins/*/dist` locally), green on current dev |
| P2 | codex / cursor / antigravity scenario files + `wire.ts` divergence coverage | 4-host matrix green in CI |
| P3 | CI wiring + inline-smoke dedup + CONTRIBUTING note | ci.yml smoke count reduced; no coverage regression (each removed smoke mapped to a scenario) |

P1's verify step is the acceptance test for the whole effort: the suite must
*fail* against the known-bad build it was designed to catch.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Harness drift vs real host wire changes | `wire.ts` is the single mirror of `.claude/rules/mcp-and-hosts.md`; smoke tests remain as an independent check until P3 |
| Flakiness from process/port lifecycle | ephemeral ports, per-test server lifecycle, temp HOME per test, no shared fixed resources (all direct lessons from the ad-hoc run) |
| Accidental real-backend calls | `state.ts` refuses to run scenarios unless `TRANSCODES_BACKEND_URL` is set to the harness's own mock (guard assert in `runHook`) |
| dist staleness confusion locally | `test:e2e` script prints the dist mtime vs HEAD and warns when older than the last source commit |
