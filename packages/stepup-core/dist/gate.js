/**
 * Step-up MFA request for the PreToolUse hook.
 *
 * Creates a step-up session against the Transcodes backend, opens the
 * browser to the WebAuthn URL, and returns sid + URL for the caller to
 * surface to the agent. Polling is intentionally NOT performed here — the
 * hook process emits a v2 deny JSON and exits 0 so the agent can drive
 * the wait via the `poll_stepup_session_wait` MCP tool (one blocking call
 * instead of a 60-iteration manual loop) and retry the same Bash command.
 * The retry hits a verified record in the cross-platform store and the
 * fast path emits an explicit allow JSON.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cacheDir, migrateLegacyFile } from "@ai-action-tracker/plugin-paths";
import { loadStepupConfig } from "./config.js";
import { createStepupSession } from "./session.js";
import { resolveToken } from "./token-store.js";
// Window during which concurrent hook processes for the same command should
// share a single browser launch. Long enough to absorb same-second races,
// short enough not to swallow an intentional retry.
const BROWSER_LOCK_TTL_MS = 15_000;
const BROWSER_LOCK_FILE = "stepup-browser-lock.json";
function fingerprintOf(key) {
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
/**
 * Atomically claim the right to spawn a browser for this request.
 *
 * Returns true if this process is the first to act on `fingerprintKey`
 * within the TTL window — caller should spawn the browser. Returns false
 * if another hook process has already opened a browser for the same key
 * recently; caller should print the URL but skip the spawn.
 *
 * Best-effort: any I/O error falls open (returns true) so the gate never
 * loses MFA visibility because of a broken lock file.
 */
function claimBrowserLaunch(fingerprintKey) {
    migrateLegacyFile(BROWSER_LOCK_FILE, "cache");
    const lockFile = path.join(cacheDir(), BROWSER_LOCK_FILE);
    const fingerprint = fingerprintOf(fingerprintKey);
    try {
        const raw = readFileSync(lockFile, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const obj = parsed;
            const sameCommand = obj.fingerprint === fingerprint;
            const openedAt = typeof obj.openedAt === "number" ? obj.openedAt : 0;
            if (sameCommand && Date.now() - openedAt < BROWSER_LOCK_TTL_MS) {
                return false;
            }
        }
    }
    catch {
        // No lock or unreadable lock — proceed to claim.
    }
    try {
        mkdirSync(path.dirname(lockFile), { recursive: true });
        writeFileSync(lockFile, JSON.stringify({ fingerprint, openedAt: Date.now() }), { mode: 0o600 });
    }
    catch {
        // If we cannot persist the lock, fall open: better to open a duplicate
        // browser than to silently skip MFA prompting.
    }
    return true;
}
function openBrowser(url) {
    const opener = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
            ? "cmd"
            : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    try {
        const child = spawn(opener, args, {
            stdio: "ignore",
            detached: true,
        });
        child.on("error", () => { });
        child.unref();
    }
    catch {
        // Best-effort: if the OS has no opener, the URL in stderr is the fallback.
    }
}
/**
 * Create a step-up session and launch the browser. Returns sid + URL on
 * success so the hook can hand them to the agent. Does not poll — the
 * agent is responsible for calling `poll_stepup_session` and retrying.
 */
export async function requestStepup(input) {
    if (!resolveToken().token) {
        return { ok: false, reason: "no-token" };
    }
    let config;
    try {
        config = loadStepupConfig();
    }
    catch (err) {
        return {
            ok: false,
            reason: "error",
            detail: err instanceof Error ? err.message : String(err),
        };
    }
    let created;
    try {
        created = await createStepupSession(config, {
            comment: input.comment ?? `Confirm ${input.reason}`,
            action: input.action,
            resource: input.resource,
        });
    }
    catch (err) {
        return {
            ok: false,
            reason: "create-failed",
            detail: err instanceof Error ? err.message : String(err),
        };
    }
    if (!created.envelope.ok || !created.sid || !created.browserUrl) {
        return {
            ok: false,
            reason: "create-failed",
            detail: `backend rejected create_stepup_session (status ${created.envelope.status})`,
        };
    }
    const launched = claimBrowserLaunch(input.fingerprintKey);
    if (launched) {
        openBrowser(created.browserUrl);
    }
    return {
        ok: true,
        sid: created.sid,
        browserUrl: created.browserUrl,
        expiresAt: created.expiresAt,
        launched,
    };
}
//# sourceMappingURL=gate.js.map