/**
 * Browser launcher for the step-up flow.
 *
 * Guard v3 removed every local dedup mechanism — browser-lock file, command
 * fingerprint, per-coordinate latch (t3). Every pending challenge opens a tab
 * (t8): the backend's coordinate claim (SET NX) dedupes the session, not the
 * tab, so concurrent hooks all open the same auth URL and authenticate once.
 * All that remains here is the OS-level "open this URL" primitive; the gate
 * decides whether to call it.
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
