import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MAX_STOP_REMINDERS, STEPUP_TTL_MS } from '../src/config.js';
import {
  hasLatch,
  incrementLatchRemindedCount,
  listLatches,
  readLatchRecord,
  writeLatch,
} from '../src/latch.js';
import { peekPromptSid, rotatePromptSid } from '../src/sid.js';

describe('latch TTL + stop reminder cap', () => {
  let home = '';

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'latch-home-'));
    process.env.HOME = home;
    mkdirSync(path.join(home, '.transcodes', 'state'), { recursive: true });
  });

  afterEach(() => {
    delete process.env.HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it('hasLatch reaps expired files and returns false', () => {
    const sid = 's_test';
    writeLatch(
      sid,
      'shell',
      'execute',
      'tc_stepup_x',
      Date.now() - STEPUP_TTL_MS - 1,
    );
    assert.equal(hasLatch(sid, 'shell', 'execute'), false);
    assert.equal(readLatchRecord(sid, 'shell', 'execute'), null);
  });

  it('stop cap via listLatches + peekPromptSid', () => {
    const sid = rotatePromptSid();
    writeLatch(sid, 'shell', 'execute', 'tc_stepup_cap');

    for (let i = 0; i < MAX_STOP_REMINDERS; i++) {
      const promptSid = peekPromptSid();
      const pending = listLatches().find(
        (l) => promptSid && !l.expired && l.sid === promptSid,
      );
      assert.ok(pending);
      const rec = readLatchRecord(
        pending.sid,
        pending.resource,
        pending.action,
      );
      assert.ok(rec);
      assert.ok((rec.remindedCount ?? 0) < MAX_STOP_REMINDERS);
      incrementLatchRemindedCount(rec.sid, rec.resource, rec.action);
    }

    const promptSid = peekPromptSid();
    const pending = listLatches().find(
      (l) => promptSid && !l.expired && l.sid === promptSid,
    );
    assert.ok(pending);
    const rec = readLatchRecord(
      pending.sid,
      pending.resource,
      pending.action,
    );
    assert.ok(rec);
    assert.equal(rec.remindedCount, MAX_STOP_REMINDERS);
  });
});
