import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchRpc } from '../src/commands/transcodes/rpc.js';

test('rpc rejects unknown methods', async () => {
  await assert.rejects(
    () => dispatchRpc({ jsonrpc: '2.0', id: 1, method: 'nope' }),
    /Unknown method/,
  );
});

test('rpc ping answers', async () => {
  assert.deepEqual(await dispatchRpc({ jsonrpc: '2.0', id: 1, method: 'ping' }), {
    ok: true,
  });
});
