#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — danger command interceptor.
 *
 * Two-layer check on Bash tool invocations:
 *
 *   1. Regex patterns (`danger-patterns.json`) — catches absolute paths,
 *      `$HOME`, `dd`, `mkfs`, `curl|bash`, fork bombs, force-pushes, etc.
 *   2. Git semantic check on `rm -rf <target>` — resolves each target
 *      relative to the session `cwd` and blocks if any target contains
 *      files tracked by git, regardless of whether the target was given
 *      as an absolute or a relative path. This catches the relative-path
 *      gap that pure regex misses (e.g. `rm -rf src`).
 *
 * On danger match: runs the Step-up MFA gate (`src/stepup/gate.ts`) —
 * opens a Transcodes step-up session, prints the browser URL to stderr,
 * polls the backend for up to 60s, and only exits 0 if the backend
 * reports `verified`. Otherwise emits the BLOCKED message and exits 2.
 *
 * Fail policy is asymmetric:
 *  - Before a danger match (JSON parse, pattern load): **fail-open** —
 *    a buggy guard must not brick the workflow.
 *  - After a danger match (step-up create/poll/network): **fail-safe** —
 *    if we cannot prove the user authorised the command, we block it.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { findFirstMatch, loadMergedPatterns, } from "../src/danger-patterns.js";
import { runStepupGate } from "../src/stepup/gate.js";
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
}
function checkPatternMatch(command) {
    const hit = findFirstMatch(command, loadMergedPatterns());
    if (!hit)
        return null;
    const { source, id, reason } = hit.matched;
    return {
        reason: `matched ${source} pattern \`${id}\` — ${reason}`,
        command,
    };
}
/**
 * Extract removal targets from a recursive `rm` invocation.
 *
 * Returns null if the command is not `rm -r…` style. Limitations:
 * does not handle shell quoting, variable expansion, command
 * substitution, or chained commands — treats the command as a
 * whitespace-separated token list.
 */
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
    // Skip targets containing glob metacharacters — the regex layer handles
    // those (e.g. `rm -rf *` matches the `rm-rf-broad` pattern).
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
    };
}
function emitBlock(result, gate) {
    const lines = [
        "",
        "⛔ ai-action-tracker: BLOCKED dangerous command",
        "",
        `Reason: ${result.reason}`,
    ];
    if (result.details && result.details.length > 0) {
        lines.push("");
        lines.push("Affected:");
        for (const d of result.details)
            lines.push(`  - ${d}`);
    }
    lines.push("");
    lines.push(`Command: ${result.command}`);
    lines.push("");
    if (!gate) {
        lines.push("This command was intercepted before execution. Set TRANSCODES_TOKEN " +
            "to enable the Step-up MFA gate, or run the command outside Claude Code.");
    }
    else if (gate.allowed) {
        // Should not happen — emitBlock is only called when allowed is false.
        lines.push("Step-up reported allowed; nothing to block.");
    }
    else {
        switch (gate.reason) {
            case "no-token":
                lines.push("Step-up MFA gate is not configured (TRANSCODES_TOKEN missing). " +
                    "Set the token to allow on-demand authentication next time.");
                break;
            case "timeout":
                lines.push("Step-up MFA was requested but not completed in time. " +
                    "Re-run the command and finish the browser flow to proceed.");
                break;
            case "create-failed":
                lines.push(`Step-up MFA session could not be started${gate.detail ? ` (${gate.detail})` : ""}.`);
                break;
            case "error":
                lines.push(`Step-up MFA gate errored${gate.detail ? ` (${gate.detail})` : ""}.`);
                break;
        }
    }
    lines.push("");
    process.stderr.write(lines.join("\n"));
}
async function main() {
    const raw = await readStdin();
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        process.exit(0);
    }
    if (payload.tool_name !== "Bash")
        process.exit(0);
    const command = payload.tool_input?.command;
    if (typeof command !== "string")
        process.exit(0);
    const cwd = payload.cwd ?? process.cwd();
    const block = checkPatternMatch(command) ?? checkRmGitTracked(command, cwd);
    if (block) {
        // Once a danger match exists, the policy flips to fail-safe: any
        // failure in the step-up flow results in a block, never a pass-through.
        const gate = await runStepupGate({
            reason: block.reason,
            command: block.command,
        });
        if (gate.allowed) {
            process.exit(0);
        }
        emitBlock(block, gate);
        process.exit(2);
    }
    process.exit(0);
}
main().catch((err) => {
    process.stderr.write(`ai-action-tracker hook error: ${err}\n`);
    process.exit(0);
});
//# sourceMappingURL=pre-tool-use.js.map