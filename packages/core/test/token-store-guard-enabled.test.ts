import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  clearTokenFile,
  isGuardEnabled,
  setGuardEnabled,
  transcodesConfigFile,
  writeTokenToFile,
} from '../src/stepup/token-store.js';

test('guard activation defaults off and persists independently of tokens', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'transcodes-guard-toggle-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;

  try {
    assert.equal(isGuardEnabled(), false);

    setGuardEnabled(true);
    assert.equal(isGuardEnabled(), true);

    writeTokenToFile('header.payload.signature', 'test');
    assert.equal(isGuardEnabled(), true);

    setGuardEnabled(false);
    clearTokenFile();

    assert.equal(isGuardEnabled(), false);
    const config = JSON.parse(
      readFileSync(transcodesConfigFile(), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(config.guard_enabled, false);
    assert.equal(config.token, undefined);
    assert.equal(config.token_list, undefined);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
