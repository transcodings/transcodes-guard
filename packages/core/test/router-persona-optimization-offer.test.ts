import assert from 'node:assert/strict';
import test from 'node:test';

import { TRANSCODES_ROUTER_BODY } from '../src/server/router-body.js';

test('Persona optimization offer keeps its safety contract', () => {
  for (const clause of [
    'REVIEW — require both the exact saved Persona name and review scope',
    'before any command, tool call, or file read',
    'Do not run `transcodes persona list`, inspect deployed/project/global agent files, or infer a Persona from the active/applied configuration',
    '두 값을 묻는 선택형 질문만 한 뒤 멈춘다.',
    'Only after the user explicitly supplies both, run `transcodes persona list --persona <name>`',
    'during REVIEW or EDIT, use only the Persona, Rule, and Skill content already read',
    'During CREATE, evaluate only after the initial Persona save and before APPLY OR DEPLOY',
    'Offer optimization once only if you see a concrete duplicate, conflict, ambiguous instruction, outdated platform rule, or clearly unnecessary context.',
    'Do not offer for a simple list/read request that did not ask for review, any deploy/share/other execution-only request, or an already concise asset.',
    'Do not inspect extra files solely to find a reason to offer.',
    'If the user declines, continue the requested workflow and do not offer again in that same workflow.',
    'If the user accepts, switch to the existing PERSONA DIET workflow below',
    'Before acceptance, do not draft, write, delete, save, or deploy any optimization change.',
  ]) {
    assert.ok(TRANSCODES_ROUTER_BODY.includes(clause), clause);
  }
});
