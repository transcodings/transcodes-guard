import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLI_VERSION,
  getCliVersionStatus,
  isNpmVersionNewer,
  resetCliVersionCache,
} from '../src/commands/transcodes/version.js';

test('isNpmVersionNewer compares major.minor.patch', () => {
  assert.equal(isNpmVersionNewer('0.16.2', '0.16.1'), true);
  assert.equal(isNpmVersionNewer('0.16.1', '0.16.1'), false);
  assert.equal(isNpmVersionNewer('0.16.0', '0.16.1'), false);
  assert.equal(isNpmVersionNewer('0.17.0', '0.16.9'), true);
  assert.equal(isNpmVersionNewer('1.0.0', '0.99.0'), true);
  assert.equal(isNpmVersionNewer('not-a-version', '0.16.1'), false);
});

test('getCliVersionStatus reports an update when npm latest is newer', async () => {
  resetCliVersionCache();
  const status = await getCliVersionStatus({
    fetchImpl: async () =>
      new Response(JSON.stringify({ version: '99.0.0' }), { status: 200 }),
  });
  assert.equal(status.current, CLI_VERSION);
  assert.equal(status.latest, '99.0.0');
  assert.equal(status.updateAvailable, true);
});

test('getCliVersionStatus stays quiet when npm is unreachable', async () => {
  resetCliVersionCache();
  const status = await getCliVersionStatus({
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(status.current, CLI_VERSION);
  assert.equal(status.latest, null);
  assert.equal(status.updateAvailable, false);
});

test('getCliVersionStatus reuses the in-process cache', async () => {
  resetCliVersionCache();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ version: '99.0.0' }), { status: 200 });
  };
  const first = await getCliVersionStatus({ fetchImpl, now: () => 1_000 });
  const second = await getCliVersionStatus({ fetchImpl, now: () => 2_000 });
  assert.equal(first.latest, '99.0.0');
  assert.equal(second.latest, '99.0.0');
  assert.equal(calls, 1);
});
