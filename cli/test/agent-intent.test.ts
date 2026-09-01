import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyIntent,
  extractName,
  runAgentChat,
  suggestPersonaName,
} from '../src/commands/transcodes/agent.js';

const agentSource = readFileSync(
  fileURLToPath(new URL('../src/commands/transcodes/agent.ts', import.meta.url)),
  'utf8',
);

test('classifies persona chat intents', () => {
  assert.equal(classifyIntent('페르소나 목록'), 'list');
  assert.equal(classifyIntent('list personas'), 'list');
  assert.equal(classifyIntent('원격 페르소나 목록'), 'remotes');
  assert.equal(classifyIntent('list remote personas'), 'remotes');
  assert.equal(classifyIntent('리서처 페르소나를 만들어줘'), 'create');
  assert.equal(
    classifyIntent('리서처 페르소나 만들어서 Cursor에 적용해줘'),
    'create',
  );
  assert.equal(classifyIntent('create a persona'), 'create');
  assert.equal(classifyIntent('현재 프로젝트에 적용해줘'), 'apply');
  assert.equal(classifyIntent('apply this persona'), 'apply');
  assert.equal(classifyIntent('이 페르소나 삭제'), 'delete');
  assert.equal(
    classifyIntent('rename persona create to fullstack-developer'),
    'rename',
  );
  assert.equal(classifyIntent(''), 'menu');
});

test('extracts the requested Persona name instead of the word named', () => {
  assert.equal(
    extractName('create a marketer persona named ai-growth-marketer'),
    'ai-growth-marketer',
  );
  assert.equal(extractName('apply persona fullstack'), 'fullstack');
  assert.equal(extractName('fullstack 라는 페르소나'), 'fullstack');
});

test('rename request becomes an executable confirmation', async () => {
  const result = await runAgentChat({
    message: 'rename persona create to fullstack-developer',
    locale: 'ko',
    personaId: 'create',
  });
  assert.equal(result.events[0]?.type, 'confirm');
  if (result.events[0]?.type !== 'confirm') return;
  assert.deepEqual(result.events[0].details, {
    current: 'create',
    next: 'fullstack-developer',
  });
});

test('multiple Persona file changes become one executable confirmation', async () => {
  const result = await runAgentChat({
    message: JSON.stringify({
      operations: [
        {
          op: 'save',
          persona: 'fullstack',
          kind: 'rule',
          name: 'request-scope',
          content: '# Must\n- Stay in scope.\n',
        },
        {
          op: 'save',
          persona: 'fullstack',
          kind: 'skill',
          name: 'nextjs-nestjs',
          file: 'SKILL.md',
          content: '# Steps\n1. Implement and verify.\n',
        },
      ],
    }),
    locale: 'ko',
  });
  assert.equal(result.events[0]?.type, 'confirm');
  if (result.events[0]?.type !== 'confirm') return;
  assert.deepEqual(result.events[0].details, {
    persona: 'fullstack',
    changes: '2',
  });
});

test('create no longer asks work with a single None chip', () => {
  assert.doesNotMatch(agentSource, /ask\(session,\s*'work'/);
});

test('suggestPersonaName keeps a typed id and drops a leading no', () => {
  assert.equal(suggestPersonaName('ai-growth-marketer'), 'ai-growth-marketer');
  assert.equal(
    suggestPersonaName('아니 ai-growth-marketer'),
    'ai-growth-marketer',
  );
  assert.equal(
    suggestPersonaName('아니요, ai-growth-marketer'),
    'ai-growth-marketer',
  );
  assert.equal(suggestPersonaName('no researcher'), 'researcher');
  assert.equal(suggestPersonaName('Researcher'), 'Researcher');
  assert.equal(suggestPersonaName('아니'), '');
  assert.notEqual(suggestPersonaName('아니 ai-growth-marketer')[0], '-');
});
