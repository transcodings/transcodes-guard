/**
 * Host-agnostic PreToolUse gate decision.
 *
 * Extracted from the original `plugins/ai-action-tracker/hooks/pre-tool-use.ts`
 * so every host's hook entrypoint can be a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision
 * shape drives Claude Code, Codex, and (later) Cursor/Antigravity.
 *
 * Fail policy:
 *  - Before a danger pattern match (stdin parse, classify, pattern load) →
 *    return `{ kind: "pass" }` (fail-open). Callers exit 0 with no JSON.
 *  - After a danger pattern match (verified read, step-up create) →
 *    surface as a `deny-*` decision so callers can fail-safe.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { DEFAULT_RBAC_RESOURCE, findFirstMatch, findFirstToolRule, loadMergedPatterns, loadMergedToolRules, } from "@transcodes-guard/danger-patterns";
import { loadStepupConfig } from "./config.js";
import { fingerprintOf, requestStepup } from "./gate.js";
import { clearPending } from "./pending.js";
import { checkRbacPermission } from "./rbac-check.js";
import { pollStepupSession } from "./session.js";
import { consumeVerified, readVerified } from "./store.js";
import { resolveToken, } from "./token-store.js";
function checkPatternMatch(command) {
    const hit = findFirstMatch(command, loadMergedPatterns());
    if (!hit)
        return null;
    const { source, id, reason, stepupResource, stepupAction } = hit.matched;
    return {
        reason: `matched ${source} pattern \`${id}\` — ${reason}`,
        command,
        stepupResource,
        stepupAction,
    };
}
function extractRmTargets(command) {
    const tokens = command.trim().split(/\s+/);
    const rmIdx = tokens.indexOf("rm");
    if (rmIdx === -1)
        return null;
    let i = rmIdx + 1;
    let recursive = false;
    while (i < tokens.length) {
        const t = tokens[i];
        if (t === "--") {
            i++;
            break;
        }
        if (t.startsWith("-") && /^-[a-zA-Z]+$/.test(t)) {
            if (/[rR]/.test(t))
                recursive = true;
            i++;
            continue;
        }
        break;
    }
    if (!recursive)
        return null;
    const targets = tokens.slice(i).filter((t) => !t.startsWith("-"));
    return targets.length > 0 ? targets : null;
}
function checkTargetGitTracked(target, cwd) {
    if (/[*?{[]/.test(target))
        return null;
    const abs = path.resolve(cwd, target);
    let toplevel;
    try {
        toplevel = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    }
    catch {
        return null;
    }
    const rel = path.relative(toplevel, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel))
        return null;
    let tracked;
    try {
        const out = execFileSync("git", ["-C", toplevel, "ls-files", "--", rel || "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        tracked = out.split("\n").filter(Boolean);
    }
    catch {
        return null;
    }
    if (tracked.length === 0)
        return null;
    return {
        target,
        trackedCount: tracked.length,
        samples: tracked.slice(0, 3),
    };
}
function checkRmGitTracked(command, cwd) {
    const targets = extractRmTargets(command);
    if (!targets)
        return null;
    const hits = [];
    for (const target of targets) {
        const check = checkTargetGitTracked(target, cwd);
        if (check)
            hits.push(check);
    }
    if (hits.length === 0)
        return null;
    const totalFiles = hits.reduce((a, h) => a + h.trackedCount, 0);
    return {
        reason: `rm -rf would delete ${totalFiles} file(s) tracked in git`,
        details: hits.map((h) => {
            const more = h.trackedCount > h.samples.length
                ? `, +${h.trackedCount - h.samples.length} more`
                : "";
            return `${h.target} — ${h.trackedCount} tracked file(s): ${h.samples.join(", ")}${more}`;
        }),
        command,
        stepupResource: DEFAULT_RBAC_RESOURCE,
        stepupAction: "delete",
    };
}
/** Serialize MCP tool_input for the `block.command` summary. Capped at 200 chars. */
function stringifyToolInput(input) {
    try {
        const s = JSON.stringify(input);
        if (s === undefined)
            return "[unserializable]";
        return s.length > 200 ? s.slice(0, 197) + "..." : s;
    }
    catch {
        return "[unserializable]";
    }
}
/**
 * C-plan (backend-as-truth): re-confirm a locally-cached verified record with
 * the backend before the fast-path trusts it.
 *
 * Without this, the fast-path allows on the mere presence of
 * `stepup-verified.<fp>.json`, so a process that fabricates that file with a
 * made-up sid bypasses MFA. The sid the file carries was issued by the backend
 * (the poll tool wrote it), so re-polling it is a forgery test: a fabricated
 * sid was never issued → backend answers "not verified" → we force a fresh
 * step-up.
 *
 * Called only on the FP path (Bash + user rules); the MCP system path relies
 * on its handler's X-Step-Up-Session-Id backend backstop instead.
 *
 * Decisions:
 *   - no token / config load fails → "trust": step-up is inert without a token
 *     and we cannot poll. Preserves pre-C-plan behaviour (and keeps the
 *     token-less CI fast-path tests green).
 *   - backend authoritative (2xx) + status "verified" → "trust".
 *   - backend authoritative (2xx non-verified, or 404 unknown sid) → "reauth":
 *     the record is forged, expired, or revoked at the backend.
 *   - cannot confirm (network failure status 0, 5xx, 401/403) → "trust":
 *     availability fallback. A transient blip must not lock out a user who
 *     legitimately authenticated; the realistic forgery threat (a rogue local
 *     process) does not control backend reachability. Note `request()` reports
 *     network failures as an envelope with `status: 0` rather than throwing.
 */
async function recheckVerifiedSid(sid) {
    if (!resolveToken().token)
        return "trust";
    let config;
    try {
        config = loadStepupConfig();
    }
    catch {
        return "trust";
    }
    try {
        const { envelope, status } = await pollStepupSession(config, sid);
        if (status === "verified")
            return "trust";
        // Authoritative "not verified": reachable 2xx with a non-verified status,
        // or 404 meaning the backend never issued this sid (fabricated).
        if (envelope.ok || envelope.status === 404)
            return "reauth";
        // status 0 (network) / 5xx / 401 / 403 → cannot confirm → availability.
        return "trust";
    }
    catch {
        return "trust";
    }
}
function classifyToolCall(input) {
    // Host-specific shell tool names map to the same internal `bash` kind.
    // Claude Code / Codex use "Bash"; Antigravity 2.0 uses "run_command";
    // Cursor uses "Shell" (per cursor.com/docs/agent/hooks matchers). The
    // antigravity adapter rewrites `args.CommandLine` → `args.command`
    // before the classifier sees it, so the body below is host-neutral.
    if (input.toolName === "Bash" ||
        input.toolName === "run_command" ||
        input.toolName === "Shell") {
        const cmd = input.toolInput?.command;
        if (typeof cmd !== "string")
            return null;
        return { kind: "bash", command: cmd, cwd: input.cwd };
    }
    const rules = loadMergedToolRules();
    const match = findFirstToolRule(input.toolName, rules);
    if (!match)
        return null;
    return {
        kind: "mcp",
        toolName: input.toolName,
        toolInput: input.toolInput,
        rule: match.matched,
    };
}
/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here:
 *  - `requestStepup` creates a backend session and may launch a browser.
 *  - `readVerified` reads from disk.
 *
 * Side effects intentionally NOT performed here (caller's responsibility):
 *  - `writePending(decision.pending)` — caller must call this AFTER
 *    emitting the deny JSON so a throw in writePending cannot suppress
 *    the deny on stdout (CLAUDE.md fail-safe rule).
 *  - `consumeVerified` + `clearPending` on allow — caller decides based on
 *    `decision.consumeHere`.
 */
export async function evaluatePreToolUse(input) {
    let classified;
    try {
        classified = classifyToolCall(input);
    }
    catch {
        return { kind: "pass" };
    }
    if (!classified)
        return { kind: "pass" };
    const block = classified.kind === "bash"
        ? (checkPatternMatch(classified.command) ??
            checkRmGitTracked(classified.command, classified.cwd))
        : {
            reason: `matched ${classified.rule.source} tool-rule \`${classified.rule.id}\` — ${classified.rule.reason}`,
            command: `${classified.toolName} ${stringifyToolInput(classified.toolInput)}`,
            stepupResource: classified.rule.stepupResource,
            stepupAction: classified.rule.stepupAction,
        };
    if (!block)
        return { kind: "pass" };
    // consume_in_hook decides the storage flavour:
    //   true  (Bash + user tool-rules) → FP-KEYED store, content-addressed by
    //          this command's fingerprint, so parallel sub-agents never pick up
    //          one another's verified record.
    //   false (MCP system rules)       → GLOBAL store; the tool handler consumes
    //          later via withStepupVerifiedSid and cannot recompute the fp.
    const consumeHere = classified.kind === "bash" || classified.rule.consume_in_hook === true;
    const fingerprintKey = classified.kind === "bash"
        ? classified.command
        : `${classified.toolName}:${JSON.stringify(classified.toolInput)}`;
    const fp = consumeHere ? fingerprintOf(fingerprintKey) : undefined;
    const verified = readVerified(fp);
    if (verified) {
        // Only the FP path (Bash + user rules) needs the backend re-check: it has
        // no other backstop, so a forged local record would otherwise pass. The
        // MCP system (GLOBAL) path skips it — its handler re-validates the sid via
        // the X-Step-Up-Session-Id header, so a forged record there just yields a
        // failed backend call, not an unauthorized action.
        if (!consumeHere || (await recheckVerifiedSid(verified.sid)) === "trust") {
            return { kind: "allow", block, consumeHere, fp };
        }
        // Backend says this record is no longer (or never was) verified — discard
        // the stale/forged record and fall through to a fresh step-up below.
        consumeVerified(fp);
        clearPending(fp);
    }
    if (!resolveToken().token) {
        return { kind: "deny-no-token", block };
    }
    // The matched rule only maps this command/tool onto an RBAC coordinate; the
    // backend permission matrix is the authority for the decision. The coordinate
    // is already resolved on `block` (both producers fill it), so ask the matrix
    // directly: 0=deny, 1=allow (no step-up), 2=allow+step-up.
    const { stepupResource: resource, stepupAction: action } = block;
    // Fail-closed: any failure to determine the level (network/parse/config) is
    // treated as step-up required (2) — never silently allowed.
    let level = 2;
    try {
        const config = loadStepupConfig();
        level = (await checkRbacPermission(config, resource, action)) ?? 2;
    }
    catch {
        level = 2;
    }
    if (level === 0) {
        return { kind: "deny-rbac-denied", block, resource, action };
    }
    if (level === 1) {
        // RBAC grants this without step-up → let the command through. The local
        // rule is a classifier, not an independent floor.
        return { kind: "pass" };
    }
    const gateInput = {
        reason: block.reason,
        action,
        resource,
        fingerprintKey,
        comment: classified.kind === "bash"
            ? `Confirm danger command: ${block.reason}`
            : `Confirm ${classified.rule.id}: ${classified.rule.reason}`,
    };
    const req = await requestStepup(gateInput);
    if (!req.ok) {
        return { kind: "deny-stepup-failure", block, failure: req };
    }
    const pending = {
        sid: req.sid,
        command: block.command,
        reason: block.reason,
        browserUrl: req.browserUrl,
        createdAt: Date.now(),
        expiresAt: req.expiresAt,
        status: "pending",
        // FP-KEYED record for the hook-consume path; GLOBAL (no fp) otherwise.
        ...(fp ? { fp } : {}),
    };
    return {
        kind: "deny-stepup-pending",
        block,
        sid: req.sid,
        browserUrl: req.browserUrl,
        browserLaunched: req.launched,
        pending,
    };
}
//# sourceMappingURL=evaluate.js.map