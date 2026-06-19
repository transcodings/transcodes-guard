import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = '/Users/gsong/Projects/ai-action-tracker-mcp';
const home = mkdtempSync(join(tmpdir(), 'hook-verify-'));
const env = { ...process.env, HOME: home };
delete env.TRANSCODES_TOKEN;

function runHook(script, stdin) {
  const result = spawnSync(
    'node',
    [join(repo, script)],
    { input: stdin, encoding: 'utf8', env },
  );
  return {
    exit: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

const cases = [
  {
    name: 'cursor-deny',
    script: 'plugins/cursor/dist/hooks/pre-tool-use.js',
    stdin: JSON.stringify({
      tool_name: 'Shell',
      tool_input: { command: 'rm -rf /' },
      cwd: repo,
    }),
    expect: (out) => out.includes('"permission":"deny"'),
  },
  {
    name: 'cursor-safe',
    script: 'plugins/cursor/dist/hooks/pre-tool-use.js',
    stdin: JSON.stringify({
      tool_name: 'Shell',
      tool_input: { command: 'ls' },
      cwd: repo,
    }),
    expect: (out) => !out.includes('"permission":"deny"'),
  },
  {
    name: 'antigravity-deny',
    script: 'plugins/antigravity/dist/hooks/pre-tool-use.js',
    stdin: JSON.stringify({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'rm -rf /', Cwd: repo },
      },
      stepIdx: 0,
      conversationId: 'ag-test',
      workspacePaths: [repo],
    }),
    expect: (out) => out.includes('"decision":"deny"'),
  },
  {
    name: 'antigravity-safe',
    script: 'plugins/antigravity/dist/hooks/pre-tool-use.js',
    stdin: JSON.stringify({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'ls', Cwd: repo },
      },
      stepIdx: 0,
      conversationId: 'ag-test',
      workspacePaths: [repo],
    }),
    expect: (out) => !out.includes('"decision":"deny"'),
  },
];

let failed = 0;
for (const testCase of cases) {
  const result = runHook(testCase.script, testCase.stdin);
  const ok = result.exit === 0 && testCase.expect(result.stdout);
  console.log(JSON.stringify({
    test: testCase.name,
    pass: ok,
    exit: result.exit,
    stdout: result.stdout,
    stderr: result.stderr,
  }));
  if (!ok) failed += 1;
}

process.exit(failed === 0 ? 0 : 1);
