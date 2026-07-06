import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MAX_STOP_REMINDERS, STEPUP_TTL_MS } from '../src/config.js';
import {
  hasLatch,
  incrementLatchRemindedCount,
  listLatches,
  readLatchRecord,
  readSinglePendingLatchSid,
  writeLatch,
} from '../src/latch.js';
import { peekPromptGroup, rotatePromptGroup } from '../src/sid.js';

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

  it('reaps latch files missing sid', () => {
    const group = 's_test';
    const file = path.join(
      home,
      '.transcodes',
      'state',
      'step-up.s_test.shell.execute.json',
    );
    writeFileSync(
      file,
      JSON.stringify({
        group,
        resource: 'shell',
        action: 'execute',
        createdAt: Date.now(),
      }),
    );
    assert.equal(hasLatch(group, 'shell', 'execute'), false);
    assert.equal(readLatchRecord(group, 'shell', 'execute'), null);
  });

  it('hasLatch reaps expired files and returns false', () => {
    const group = 's_test';
    writeLatch(
      group,
      'shell',
      'execute',
      'tc_stepup_x',
      Date.now() - STEPUP_TTL_MS - 1,
    );
    assert.equal(hasLatch(group, 'shell', 'execute'), false);
    assert.equal(readLatchRecord(group, 'shell', 'execute'), null);
  });

  it('stop cap via listLatches + peekPromptGroup', () => {
    const group = rotatePromptGroup();
    writeLatch(group, 'shell', 'execute', 'tc_stepup_cap');

    for (let i = 0; i < MAX_STOP_REMINDERS; i++) {
      const promptGroup = peekPromptGroup();
      const pending = listLatches().find(
        (l) => promptGroup && !l.expired && l.group === promptGroup,
      );
      assert.ok(pending);
      const rec = readLatchRecord(
        pending.group,
        pending.resource,
        pending.action,
      );
      assert.ok(rec);
      assert.ok((rec.remindedCount ?? 0) < MAX_STOP_REMINDERS);
      incrementLatchRemindedCount(rec.group, rec.resource, rec.action);
    }

    const promptGroup = peekPromptGroup();
    const pending = listLatches().find(
      (l) => promptGroup && !l.expired && l.group === promptGroup,
    );
    assert.ok(pending);
    const rec = readLatchRecord(
      pending.group,
      pending.resource,
      pending.action,
    );
    assert.ok(rec);
    assert.equal(rec.remindedCount, MAX_STOP_REMINDERS);
  });

  it('readSinglePendingLatchSid returns sid when exactly one latch exists', () => {
    const group = 's_single';
    writeLatch(group, 'gmail', 'read', 'tc_stepup_only');

    assert.equal(readSinglePendingLatchSid(group), 'tc_stepup_only');
  });

  it('readSinglePendingLatchSid returns undefined when multiple latches share a group', () => {
    const group = 's_multi';
    writeLatch(group, 'gmail', 'read', 'tc_stepup_a');
    writeLatch(group, 'gmail', 'send', 'tc_stepup_b');

    assert.equal(readSinglePendingLatchSid(group), undefined);
  });

  it('readSinglePendingLatchSid ignores latches from other groups', () => {
    const group = 's_mine';
    writeLatch(group, 'shell', 'execute', 'tc_stepup_mine');
    writeLatch('s_other', 'shell', 'execute', 'tc_stepup_other');

    assert.equal(readSinglePendingLatchSid(group), 'tc_stepup_mine');
    assert.equal(readSinglePendingLatchSid('s_other'), 'tc_stepup_other');
  });
});
