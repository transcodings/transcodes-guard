# Hook-Exempt Meta Tools — Move the Exemption List from Code to Registry Data

Status: **Draft**
Date: 2026-07-03
Scope: `packages/danger-patterns/src/data/`, `packages/danger-patterns/src/`, `packages/stepup-core/src/evaluate.ts`, `packages/stepup-core/test/`

## 1. Background & motivation

### 1.1 Where the list lives today

Hotfix PR #154 fixed the v0.32.0 regression where a host-internal meta tool
(`ToolSearch`) reached `POST /guard/evaluate`, fell through to step-up
(permission 2, the backend classifier has no mapping for it), and deadlocked
the Stop-reminder loop. The fix added a hardcoded exemption set in
`packages/stepup-core/src/evaluate.ts`:

```ts
const HOST_META_TOOL_NAMES = new Set([
  'ToolSearch',
  'TodoWrite',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
]);
```

### 1.2 Why that placement is wrong long-term

- **Hosts grow meta tools faster than we ship gate logic.** Every new
  harness-internal tool (Claude Code alone has added several per quarter)
  reproduces the ToolSearch incident until a code change lands. With the Stop
  cap the blast radius is now bounded (1 deny + ≤3 reminders + 1 browser
  tab), but it is still a false step-up per call site.
- **Tool policy has a designated home.** CLAUDE.md routes tool-rule policy to
  `packages/danger-patterns/src/data/` — the classifier consuming the list
  (`evaluate.ts`) already imports its sibling predicate
  `isTranscodesGuardWireToolName` from `danger-patterns`. The exemption list
  is the same species of data: a name-keyed policy statement about wire tool
  names.
- **Updating data is cheaper to review than updating control flow.** A
  one-line JSON diff with a mandatory `reason` field is auditable at a
  glance; edits inside `classifyToolCall` are not.

### 1.3 Constraint

The backend classifier cannot be changed on our schedule (premise of this
PRD). Everything below is plugin-side only.

## 2. Goals / non-goals

**Goals**

- G1. Adding/removing an exempt meta tool is a data-only change (JSON +
  release), no gate-logic edit.
- G2. The exemption list is system-owned and **cannot be extended at
  runtime** — not by remote rules, not by bundle merge layers, not by local
  files.
- G3. Every entry carries a machine-checkable audit trail (`reason`,
  side-effect criteria) enforced by tests.

**Non-goals**

- Backend classifier mappings for host built-ins (separate backend work).
- Changing the `.*` PreToolUse matcher or any gate semantics — exempt names
  return `proceed-ungated` exactly as the hardcoded set does today.
- The `transcodes stepup clear` CLI escape command (separate PRD).
- Per-host exemption divergence (see §5 Open questions).

## 3. Design

### 3.1 New data file (not a `tool-rules.json` rule type)

`packages/danger-patterns/src/data/hook-exempt-tools.json`:

```json
{
  "$comment": "Host-internal meta tools exempt from the PreToolUse gate. Criteria: the tool must have NO filesystem, network, or shell reach — it only mutates the harness's own conversation state. Exact-match names only.",
  "tools": [
    { "name": "ToolSearch",       "reason": "loads deferred tool schemas; conversation-state only" },
    { "name": "TodoWrite",        "reason": "harness task list; conversation-state only" },
    { "name": "AskUserQuestion",  "reason": "renders a local question prompt; conversation-state only" },
    { "name": "EnterPlanMode",    "reason": "harness mode toggle; conversation-state only" },
    { "name": "ExitPlanMode",     "reason": "harness mode toggle; conversation-state only" }
  ]
}
```

Why a **separate file** instead of a new `type` in `tool-rules.json`:

- The rule registry's semantics point the *opposite* direction — rules add
  step-up requirements, and the merge layer (`loadMergedToolRules`) lets
  bundle/remote layers replace system rules by id. An exemption that could be
  injected or replaced through the merge path would be a gate bypass primitive
  (violates G2). A static file that never enters the merge pipeline cannot be.
- Registry consumers (handler backstop, RBAC coordinate validation) iterate
  rules expecting `action`/`resource`; exemptions have neither.

### 3.2 Loading & API

Per the registry rule: **static import** with `with { type: 'json' }`, never
a runtime read. New export from `danger-patterns` (same module as
`isTranscodesGuardWireToolName`, `packages/danger-patterns/src/tool-rules.ts`):

```ts
export function isHookExemptToolName(toolName: string): boolean;
```

- Exact string match only. No regex, no prefix, no case folding.
- `evaluate.ts` replaces the `HOST_META_TOOL_NAMES` set with this predicate;
  the check stays in the same position in `classifyToolCall` (after the
  transcodes-guard wire-name check, before shell/summary classification).

### 3.3 Safety invariants (enforced by unit test, not convention)

A `danger-patterns` test asserts for every entry:

1. `name` does **not** start with `mcp__` — MCP tools arrive namespaced and
   must never be exemptible (host built-in names cannot be spoofed by MCP
   servers; that property is what makes a client-side exemption safe).
2. `name` contains no shell metacharacters and no whitespace (mirrors the
   MCP-rule name validation).
3. `reason` is present and non-empty.
4. No duplicate names.

A `stepup-core` test (extends `gate-metatool-fingerprint.test.ts`) asserts
every listed name yields `proceed-ungated` end-to-end through
`evaluatePreToolUse` with no token and no backend.

### 3.4 Review gate

The JSON file gets a `CODEOWNERS`-equivalent note in its `$comment` and the
PR template rule: an addition must state why the tool meets the
no-filesystem/network/shell criterion. (We deliberately do not automate this
judgment — the automated tests catch shape errors, humans catch semantics.)

## 4. Migration & rollout

1. Add `hook-exempt-tools.json` + loader + `isHookExemptToolName` export +
   invariant tests (danger-patterns).
2. Swap `evaluate.ts` to the predicate; delete `HOST_META_TOOL_NAMES`; keep
   the explanatory comment, now pointing at the JSON file.
3. Extend the stepup-core regression test to iterate the data file.
4. Normal version train (release-please); no state migration, no backend
   coordination. Ships in the next minor.

Rollback: revert to the inline set — the predicate's call site is one line.

## 5. Open questions

- **Per-host names.** Codex/Cursor/Antigravity meta-tool vocabularies are
  not yet surveyed. The schema deliberately omits a `host` field until a
  concrete cross-host name collision (same name, side-effectful on another
  host) is observed; adding a field later is backward-compatible, removing
  one is not.
- **Backend echo.** When backend changes become feasible, the same list
  should be registered as permission-1 mappings server-side, at which point
  this file becomes a latency optimization instead of a correctness patch.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Fail-open creep — list quietly grows to include side-effectful tools | mandatory `reason`, review-gate criterion, invariant tests, list is diff-visible data |
| A host ships a side-effectful tool reusing a listed name | names are host-builtin namespace (not MCP-reachable); §5 host survey before broadening |
| Merge-layer injection reintroduced by future refactor | exemptions live outside `tool-rules.json` and outside `loadMergedToolRules` by construction; test 1 in §3.3 pins the `mcp__` exclusion |
