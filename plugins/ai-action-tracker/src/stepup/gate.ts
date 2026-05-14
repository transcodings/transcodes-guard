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
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadStepupConfig } from "./config.js";
import { createStepupSession, pollStepupSession } from "./session.js";
import { cacheDir, consumeVerified, writeVerified } from "./store.js";

const POLL_INTERVAL_MS = 1_000;
// Stay below Claude Code's default 60s PreToolUse hook timeout so we exit
// cleanly with our own stderr instead of being killed mid-poll.
const POLL_TIMEOUT_MS = 50_000;
// Window during which concurrent hook processes for the same command should
// share a single browser launch. Long enough to absorb same-second races,
// short enough not to swallow an intentional retry.
const BROWSER_LOCK_TTL_MS = 15_000;
const BROWSER_LOCK_FILE = "stepup-browser-lock.json";

function commandFingerprint(command: string): string {
  return createHash("sha256").update(command).digest("hex").slice(0, 16);
}

/**
 * Atomically claim the right to spawn a browser for this command.
 *
 * Returns true if this process is the first to act on `command` within the
 * TTL window — caller should spawn the browser. Returns false if another
 * hook process has already opened a browser for the same command recently;
 * caller should print the URL but skip the spawn.
 *
 * Best-effort: any I/O error falls open (returns true) so the gate never
 * loses MFA visibility because of a broken lock file.
 */
function claimBrowserLaunch(command: string): boolean {
  const lockFile = path.join(cacheDir(), BROWSER_LOCK_FILE);
  const fingerprint = commandFingerprint(command);
  try {
    const raw = readFileSync(lockFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const sameCommand = obj.fingerprint === fingerprint;
      const openedAt =
        typeof obj.openedAt === "number" ? obj.openedAt : 0;
      if (sameCommand && Date.now() - openedAt < BROWSER_LOCK_TTL_MS) {
        return false;
      }
    }
  } catch {
    // No lock or unreadable lock — proceed to claim.
  }
  try {
    mkdirSync(path.dirname(lockFile), { recursive: true });
    writeFileSync(
      lockFile,
      JSON.stringify({ fingerprint, openedAt: Date.now() }),
      { mode: 0o600 },
    );
  } catch {
    // If we cannot persist the lock, fall open: better to open a duplicate
    // browser than to silently skip MFA prompting.
  }
  return true;
}

function openBrowser(url: string): void {
  const opener =
    process.platform === "darwin"
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
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best-effort: if the OS has no opener, the URL in stderr is the fallback.
  }
}

export type GateInput = {
  reason: string;
  command: string;
};

export type GateResult =
  | { allowed: true; sid: string }
  | { allowed: false; reason: "no-token" | "create-failed" | "timeout" | "error"; detail?: string };

function emit(text: string): void {
  process.stderr.write(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the gate. Returns `allowed: true` only when the backend confirms a
 * verified step-up session within the poll window. All other paths (no
 * token, create failure, network error, timeout) fail-safe to `allowed: false`
 * so the hook can fall through to its existing exit-2 block message.
 */
export async function runStepupGate(input: GateInput): Promise<GateResult> {
  if (!process.env.TRANSCODES_TOKEN?.trim()) {
    return { allowed: false, reason: "no-token" };
  }

  let config;
  try {
    config = loadStepupConfig();
  } catch (err) {
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
  } catch (err) {
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

  const launched = claimBrowserLaunch(input.command);
  if (launched) {
    openBrowser(browserUrl);
  }

  const launchLine = launched
    ? "Open in your browser to authenticate (auto-launch attempted):"
    : "Open in your browser to authenticate (another hook already opened a tab — reuse it):";

  emit(
    [
      "",
      "🔐 ai-action-tracker: Step-up MFA required to run this command.",
      "",
      `Reason : ${input.reason}`,
      `Command: ${input.command}`,
      "",
      launchLine,
      `  ${browserUrl}`,
      "",
      `Waiting up to ${POLL_TIMEOUT_MS / 1000}s for verification...`,
      "",
    ].join("\n"),
  );

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let poll;
    try {
      poll = await pollStepupSession(config, sid);
    } catch {
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
