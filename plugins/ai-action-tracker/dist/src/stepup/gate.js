/**
 * Step-up MFA gate for the PreToolUse hook.
 *
 * Drives the create → poll loop synchronously from the (short-lived) hook
 * process: opens a step-up session against the Transcodes backend, writes
 * the browser URL to stderr, polls until verified or timeout, and reports
 * success/failure to the caller. On success the verified record is written
 * to the cross-platform store and immediately consumed — per the design,
 * every danger command requires a fresh MFA.
 */
import { loadStepupConfig } from "./config.js";
import { createStepupSession, pollStepupSession } from "./session.js";
import { consumeVerified, writeVerified } from "./store.js";
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 60_000;
function emit(text) {
    process.stderr.write(text);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Run the gate. Returns `allowed: true` only when the backend confirms a
 * verified step-up session within the poll window. All other paths (no
 * token, create failure, network error, timeout) fail-safe to `allowed: false`
 * so the hook can fall through to its existing exit-2 block message.
 */
export async function runStepupGate(input) {
    if (!process.env.TRANSCODES_TOKEN?.trim()) {
        return { allowed: false, reason: "no-token" };
    }
    let config;
    try {
        config = loadStepupConfig();
    }
    catch (err) {
        return {
            allowed: false,
            reason: "error",
            detail: err instanceof Error ? err.message : String(err),
        };
    }
    let created;
    try {
        created = await createStepupSession(config, {
            comment: `Confirm danger command: ${input.reason}`,
            action: "bash_exec",
            resource: "ai-action-tracker:pre-tool-use",
        });
    }
    catch (err) {
        return {
            allowed: false,
            reason: "create-failed",
            detail: err instanceof Error ? err.message : String(err),
        };
    }
    if (!created.envelope.ok || !created.sid || !created.browserUrl) {
        return {
            allowed: false,
            reason: "create-failed",
            detail: `backend rejected create_stepup_session (status ${created.envelope.status})`,
        };
    }
    const { sid, browserUrl } = created;
    emit([
        "",
        "🔐 ai-action-tracker: Step-up MFA required to run this command.",
        "",
        `Reason : ${input.reason}`,
        `Command: ${input.command}`,
        "",
        `Open in your browser to authenticate:`,
        `  ${browserUrl}`,
        "",
        `Waiting up to ${POLL_TIMEOUT_MS / 1000}s for verification...`,
        "",
    ].join("\n"));
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        let poll;
        try {
            poll = await pollStepupSession(config, sid);
        }
        catch {
            continue;
        }
        if (poll.status === "verified") {
            writeVerified({ sid, verifiedAt: Date.now() });
            consumeVerified();
            emit("\n✅ ai-action-tracker: Step-up verified — running command.\n\n");
            return { allowed: true, sid };
        }
    }
    return { allowed: false, reason: "timeout" };
}
//# sourceMappingURL=gate.js.map