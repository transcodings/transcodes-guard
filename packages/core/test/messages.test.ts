import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  formatBlockByPolicyReason,
  formatBlockByPolicySystemMessage,
  formatStepupProtocolPrimer,
} from '../src/contract/messages.js';
import {
  GATE_DECISION_KIND,
  type GateDecision,
} from '../src/contract/types.js';

it('routes level-0 RBAC changes to App Console, never step-up elevation', () => {
  const decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY }
  > = {
    kind: GATE_DECISION_KIND.BLOCK_BY_POLICY,
    block: {
      reason: 'RBAC denied',
      command: 'slack_send_message',
      ruleId: 'slack-create',
      stepupResource: 'slack',
      stepupAction: 'create',
    },
    resource: 'slack',
    action: 'create',
  };

  const reason = formatBlockByPolicyReason(decision);
  const systemMessage = formatBlockByPolicySystemMessage(decision);
  const primer = formatStepupProtocolPrimer();

  assert.match(reason, /permission level 0 is a hard deny/i);
  assert.match(reason, /only unlocks actions already at level 2/i);
  for (const message of [systemMessage, primer]) {
    assert.match(message, /cannot elevate (?:level )?0 → 2/i);
  }
  for (const message of [reason, systemMessage, primer]) {
    assert.match(message, /https:\/\/app\.transcodes\.io/);
    assert.match(message, /(?:do not use get_console_url|get_console_url cannot edit)/i);
  }
});
