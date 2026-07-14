/**
 * A6 — Stop hooks are pure no-ops on every host (Guard v3, 0.50.0: Stop MFA
 * reminders and latch reaping removed — t1 §6). The committed stop.js must
 * drain stdin and exit 0 with NO stdout, for well-formed and garbage input
 * alike. The old "3-block cap + reminder" assertions are gone with the
 * feature. (Cursor's before-submit-prompt.js is a different hook — not Stop,
 * out of scope here.)
 */
import { describe, test } from 'node:test';
import { runHook } from '../harness/hook-runner.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

const STOP_STDINS: Array<[label: string, stdin: string]> = [
  ['well-formed', JSON.stringify({ session_id: 'e2e-session', hook_event_name: 'Stop' })],
  ['empty', ''],
  ['garbage', 'not json at all'],
];

for (const host of ALL_HOSTS) {
  const spec = wire[host];

  describe(`A6 Stop no-op [${host}]`, () => {
    for (const [label, stdin] of STOP_STDINS) {
      test(`${label} stdin → silent exit 0`, async (t) => {
        const world = makeWorld();
        t.after(() => world.dispose());
        world.writeToken();

        const res = await runHook({
          host,
          hook: 'stop',
          stdin,
          env: world.env('http://127.0.0.1:9'), // any backend call would fail loudly anyway
          cwd: world.home,
        });

        spec.assertStopNoop(res);
      });
    }
  });
}
