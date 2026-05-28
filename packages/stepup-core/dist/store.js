/**
 * Cross-process verified-stepup state file.
 *
 * Single-shot policy: every danger command requires a fresh MFA. The hook
 * writes a record on verify, the consumer (the hook itself, immediately
 * after) deletes it. TTL (`STEPUP_TTL_MS`) is enforced on read as a
 * defence against stale files left behind by abnormal exits.
 *
 * Storage location is host-aware (see @ai-action-tracker/plugin-paths):
 *   claude-code + CLAUDE_PLUGIN_DATA set → $CLAUDE_PLUGIN_DATA/
 *   any other host or env unset          → ~/.cache/ai-action-tracker/
 *
 * A one-shot migration moves the legacy file the first time readVerified()
 * runs after the upgrade.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cacheDir as pluginCacheDir, dataDir, migrateLegacyFile, } from "@ai-action-tracker/plugin-paths";
import { STEPUP_TTL_MS } from "./config.js";
/**
 * OS-appropriate cache directory, re-exported for backwards compatibility.
 * New code in this package should call dataDir() directly.
 */
export function cacheDir() {
    return pluginCacheDir();
}
const FILE_NAME = "stepup-verified.json";
function storePath() {
    return path.join(dataDir(), FILE_NAME);
}
export function readVerified() {
    migrateLegacyFile(FILE_NAME, "cache");
    const file = storePath();
    let raw;
    try {
        raw = readFileSync(file, "utf8");
    }
    catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        consumeVerified();
        return null;
    }
    if (parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)) {
        consumeVerified();
        return null;
    }
    const obj = parsed;
    const sid = typeof obj.sid === "string" ? obj.sid : null;
    const verifiedAt = typeof obj.verifiedAt === "number" ? obj.verifiedAt : null;
    if (!sid || verifiedAt === null) {
        consumeVerified();
        return null;
    }
    const ageMs = Date.now() - verifiedAt;
    if (ageMs > STEPUP_TTL_MS) {
        // Signal the silent consume so agents/users notice that a previously
        // verified session lapsed mid-flow. Without this line the deny
        // appears identical to a never-verified deny and root-cause analysis
        // requires reading timestamps off disk.
        process.stderr.write(`ai-action-tracker: verified record EXPIRED (sid=${sid}, age=${ageMs}ms, ttl=${STEPUP_TTL_MS}ms) — starting a new step-up.\n`);
        consumeVerified();
        return null;
    }
    return { sid, verifiedAt };
}
export function writeVerified(v) {
    const file = storePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
}
export function consumeVerified() {
    try {
        rmSync(storePath(), { force: true });
    }
    catch {
        // best-effort cleanup
    }
}
//# sourceMappingURL=store.js.map