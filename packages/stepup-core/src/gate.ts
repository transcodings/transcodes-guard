/**
 * Browser launcher for the step-up flow.
 *
 * Guard v3 removed the local browser-lock file and command fingerprinting:
 * dedup is driven by the latch `sid` (`step-up-session` SSOT) plus the local
 * per-coordinate latch file (`latch.ts`). All that remains here is the OS-level
 * that remains here is the OS-level "open this URL" primitive; the gate decides
 * whether to call it.
 *
 * Polling is intentionally NOT performed here — the hook process emits a deny
 * JSON and exits 0 so the agent drives the wait via `poll_stepup_session_wait`
 * and retries the same tool call. On retry the backend reports the session
 * verified and the gate allows (permission → allow).
 */
import { spawn } from 'node:child_process';

/** Best-effort open of a URL in the user's default browser. Never throws. */
export function openBrowser(url: string): void {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(opener, args, {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Best-effort: if the OS has no opener, the URL in stderr is the fallback.
  }
}
