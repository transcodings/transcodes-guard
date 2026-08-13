import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
// This is a process-level contract test; build the CLI before running it.
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

test('a failed host install is not reported as setup complete', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'transcodes-install-'));
  const bin = path.join(home, 'bin');
  await mkdir(bin);
  t.after(() => rm(home, { recursive: true, force: true }));

  const fakeHost = path.join(
    bin,
    process.platform === 'win32' ? 'claude.cmd' : 'claude',
  );
  await writeFile(
    fakeHost,
    process.platform === 'win32' ? '@exit /b 7\r\n' : '#!/bin/sh\nexit 7\n',
  );
  if (process.platform !== 'win32') await chmod(fakeHost, 0o755);

  try {
    await execFileAsync(
      process.execPath,
      [CLI, 'install', 'claude'],
      {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        },
      },
    );
    assert.fail('install must exit non-zero when the host installer fails');
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stderr?: string;
      stdout?: string;
    };
    const output = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
    assert.equal(failure.code, 1);
    assert.match(output, /Setup incomplete\./);
    assert.doesNotMatch(output, /Plugin installation complete\./);
    await assert.rejects(access(path.join(home, '.transcodes/state/dashboard.pid')));
  }
});
