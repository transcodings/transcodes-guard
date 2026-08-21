import assert from 'node:assert/strict';
import test from 'node:test';

import { TRANSCODES_ROUTER_BODY } from '../src/server/router-body.js';

test('Persona optimization offer keeps its safety contract', () => {
  for (const clause of [
    'Offer optimization once only if you see a concrete duplicate, conflict, ambiguous instruction, outdated platform rule, or clearly unnecessary context.',
    'Do not offer for a simple list/read request that did not ask for review, any deploy/share/other execution-only request, or an already concise asset.',
    'If the user declines, continue the requested workflow and do not offer again in that same workflow.',
    'If the user accepts, switch to the existing PERSONA DIET workflow below',
    'Before acceptance, do not draft, write, delete, save, or deploy any optimization change.',
  ]) {
    assert.ok(TRANSCODES_ROUTER_BODY.includes(clause), clause);
  }
});
