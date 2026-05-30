#!/usr/bin/env node
/**
 * Codex CLI Stop hook — dangling step-up reminder + orphan reap.
 *
 * Identical behaviour to the Claude Code variant; differs only in the
 * adapter import. Codex accepts the same top-level `{ decision: "block",
 * reason }` payload as Claude Code for Stop hooks.
 */
import "../host.js";
import { codexAdapter } from "@ai-action-tracker/hook-adapters";
import { clearPending, consumeVerified, isExpired, readPending, readVerified, } from "@ai-action-tracker/stepup-core";
function reminderFor(pending) {
    return [
        "ai-action-tracker: a step-up MFA session is still PENDING. The Bash",
        "command it gated was NOT executed. Resume the loop or report to the",
        "user that authentication is still required.",
        "",
        `Session sid     : ${pending.sid}`,
        `Original command: ${pending.command}`,
        `Browser URL     : ${pending.browserUrl}`,
        "",
        "Next action:",
        `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
        '  - On `outcome: "verified"` retry the exact original Bash command.',
    ].join("\n");
}
async function main() {
    try {
        for await (const _chunk of process.stdin) {
            // discard
        }
    }
    catch {
        // ignore
    }
    const pending = readPending();
    const verified = readVerified();
    if (verified && (!pending || pending.status !== "pending")) {
        consumeVerified();
        if (pending)
            clearPending();
        process.exit(0);
    }
    if (pending && !verified && pending.status === "verified") {
        clearPending();
        process.exit(0);
    }
    if (!pending || isExpired(pending))
        process.exit(0);
    process.stdout.write(codexAdapter.emitStop(reminderFor(pending)));
    process.exit(0);
}
main().catch((err) => {
    process.stderr.write(`ai-action-tracker stop hook error: ${err}\n`);
    process.exit(0);
});
//# sourceMappingURL=stop.js.map