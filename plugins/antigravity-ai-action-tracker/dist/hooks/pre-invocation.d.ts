#!/usr/bin/env node
/**
 * Antigravity 2.0 PreInvocation hook — SessionStart + UserPromptSubmit fusion.
 *
 * Antigravity has no SessionStart or UserPromptSubmit hook events
 * (PreToolUse / PostToolUse / PreInvocation / PostInvocation / Stop is the
 * complete event list per antigravity.google/docs/hooks). PreInvocation
 * fires before every model call, and this entry uses it for both roles:
 *
 *  - **SessionStart-equivalent** (`invocationNum <= 1` — first model call,
 *    with a defensive fallback when the field is missing/non-numeric so a
 *    malformed payload still receives the primer; the primer is purely
 *    informational, so over-firing is harmless): inject a static step-up
 *    MFA primer + any carry-over pending state from a previous turn. The
 *    static primer rendered here duplicates what `rules/STEPUP.md` contains
 *    so the agent has the protocol in context immediately, even if
 *    Antigravity hasn't yet processed the rules file.
 *
 *  - **UserPromptSubmit-equivalent** (every invocation): tail the host's
 *    `transcript.jsonl` for the most recent user message. If it matches
 *    the completion pattern (`완료`, `done`, `verified`, …) AND a step-up
 *    session is live, inject a notice surfacing the pending `sid` so the
 *    agent can call `poll_stepup_session_wait`.
 *
 * Both injections land in the same `injectSteps` array, emitted via
 * antigravityAdapter.emitPreInvocation. Empty array → empty `{}` payload.
 */
import "../host.js";
