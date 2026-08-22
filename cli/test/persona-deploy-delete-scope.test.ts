/**
 * p7 — deploy's deletion scope.
 *
 * `sync generate --delete` treats every existing output this run did not
 * produce as an orphan and removes it, file-wise and whole-directory-wise. Two
 * scopes, two answers: under a project root that is recoverable through git,
 * so deploy keeps it; under the user's home it is not, so global deploy must
 * not pass the flag at all.
 *
 * These run the built CLI (`cli/dist/index.js`) against a sandbox HOME, which
 * is the only way to observe the behaviour — `deployPersona` spawns the CLI
 * rather than calling the sync engine in-process. Run `npm run build -w
 * @bigstrider/transcodes-cli` first.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

/** A sandbox HOME holding one deployable Persona plus hand-written host files. */
async function makeSandbox(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'p7-deploy-'));
  // Global deploy derives its target set from the host config roots present in
  // HOME and refuses outright when none exist, so every test needs these.
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await mkdir(path.join(home, '.gemini'), { recursive: true });
  const persona = path.join(home, '.transcodes', 'personas', 'testp');
  await mkdir(path.join(persona, 'instruction'), { recursive: true });
  await mkdir(path.join(persona, 'rules'), { recursive: true });
  await mkdir(path.join(persona, 'skills', 'research'), { recursive: true });
  await writeFile(
    path.join(persona, 'instruction', 'agents.md'),
    '---\nname: testp\n---\n\nYou are a test persona.\n',
  );
  await writeFile(
    path.join(persona, 'rules', 'tone.md'),
    '---\nroot: false\ntargets: ["*"]\ndescription: tone\nglobs: ["**/*"]\n---\n\nBe concise.\n',
  );
  await writeFile(
    path.join(persona, 'skills', 'research', 'SKILL.md'),
    '---\nname: research\ndescription: research skill\n---\n\nSteps.\n',
  );
  return home;
}

/** Hand-written files a user could have created, in both delete units. */
async function seedHandWritten(root: string): Promise<void> {
  await mkdir(path.join(root, '.claude', 'rules'), { recursive: true });
  await mkdir(path.join(root, '.claude', 'skills', 'my-skill'), {
    recursive: true,
  });
  await writeFile(path.join(root, '.claude', 'rules', 'my-rule.md'), '# mine\n');
  await writeFile(
    path.join(root, '.claude', 'skills', 'my-skill', 'SKILL.md'),
    '# mine\n',
  );
}

async function deploy(home: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [CLI, 'persona', 'deploy', '--persona', 'testp', ...args],
    { cwd: home, env: { ...process.env, HOME: home } },
  );
  return JSON.parse(stdout).output as string;
}

test('global deploy never deletes: hand-written home files are out of scope', async (t) => {
  const home = await makeSandbox();
  t.after(() => rm(home, { recursive: true, force: true }));
  await seedHandWritten(home);

  const output = await deploy(home, ['--global', '--dry-run']);

  assert.doesNotMatch(
    output,
    /Would delete/,
    'global deploy must not plan any deletion under the home directory',
  );
  // The Persona still deploys — this is scoped deletion, not a disabled deploy.
  assert.match(output, /Would write/);
});

test('project deploy still deletes orphans, by file and by directory', async (t) => {
  const home = await makeSandbox();
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'proj');
  await mkdir(project, { recursive: true });
  await seedHandWritten(project);

  const output = await deploy(home, [
    '--project',
    project,
    '--targets',
    'claude',
    '--dry-run',
  ]);

  assert.match(output, /Would delete: .*my-rule\.md/);
  assert.match(output, /Would delete directory: .*my-skill/);
});

test('--dry-run writes nothing and needs no --yes', async (t) => {
  const home = await makeSandbox();
  t.after(() => rm(home, { recursive: true, force: true }));

  // No --yes: the confirmation gate must not refuse a run that cannot write.
  const output = await deploy(home, ['--global', '--dry-run']);

  assert.match(output, /\[DRY RUN\]/);
  await assert.rejects(
    () => import('node:fs/promises').then((fs) => fs.stat(path.join(home, '.claude', 'CLAUDE.md'))),
    'dry-run must not create any output file',
  );
});

test('deploy injects the exact Persona name into completion attribution', async (t) => {
  const home = await makeSandbox();
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'proj');
  await mkdir(project, { recursive: true });

  await deploy(home, [
    '--project',
    project,
    '--targets',
    'chatgpt',
    '--yes',
  ]);

  const instruction = await readFile(path.join(project, 'AGENTS.md'), 'utf8');
  assert.match(instruction, /active Transcodes Persona is `testp`/);
  assert.match(instruction, /^## Transcodes Rule: `tone`$/m);
  assert.match(instruction, /short, friendly Transcodes note/);
  assert.match(
    instruction,
    /I completed this using the \*\*<exact Persona name>\*\*/,
  );
  assert.match(
    instruction,
    /No Transcodes assets were applied to this task/,
  );
  assert.equal(
    instruction.match(/short, friendly Transcodes note/g)?.length,
    1,
  );
});
