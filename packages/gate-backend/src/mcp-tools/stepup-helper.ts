/**
 * Backend-403 → structured recovery translation for protected MCP tool
 * handlers.
 *
 * Enforcement is backend-owned: `StepUpSessionGuard` resolves RBAC and
 * accepts step-up via the coordinate verified cache
 * (`stepup:{project}:{member}:{resource}:{action}`), so the handler sends no
 * step-up header and re-checks nothing. The wrapper's only job is recovery
 * guidance, branched on the guard's machine-readable `errorCode`:
 *
 * - `STEP_UP_REQUIRED` (or absent — legacy backend) → the coordinate is
 *   unlockable: guide create → WebAuthn → poll → retry.
 * - `RBAC_DENIED` → permission level 0: step-up cannot unlock it, so guide
 *   the agent NOT to start an auth ceremony.
 * - `RBAC_UNRESOLVED` → the backend could not resolve the RBAC level
 *   (transient/misconfiguration): guide a plain retry, not auth.
 */
import type {
  ProtectedToolDefinition,
  ToolTextResult,
} from '@transcodes-guard/core/contract';
import {
  type Envelope,
  extractFailureMessage,
  loadStepupConfig,
} from '@transcodes-guard/core/stepup';

function textResult(body: Record<string, unknown>): ToolTextResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
  };
}

// step-up이 필요한 상황을 에이전트가 바로 재시도 흐름으로 이어갈 수 있게 구조화한다.
function stepupRequiredResult(
  def: ProtectedToolDefinition,
  backendMessage: string | undefined,
): ToolTextResult {
  return textResult({
    ok: false,
    blocked: true,
    code: 'STEP_UP_REQUIRED',
    message:
      backendMessage ??
      'Step-up MFA is required before running this protected MCP tool.',
    tool: def.name,
    resource: def.stepUp.resource,
    action: def.stepUp.action,
    next_actions: [
      `Call tc_create_stepup_session with resource "${def.stepUp.resource}", action "${def.stepUp.action}", and a one-sentence summary of what the user is confirming, then have the user complete WebAuthn in the opened browser window.`,
      'Call tc_poll_stepup_session_wait with the same resource and action until it reports verified.',
      `When verified, retry ${def.name} with the same arguments.`,
    ],
  });
}

// 권한 0 하드 거부 — step-up으로 풀리지 않으므로 인증 루프로 안내하지 않는다.
function rbacDeniedResult(
  def: ProtectedToolDefinition,
  backendMessage: string | undefined,
): ToolTextResult {
  return textResult({
    ok: false,
    blocked: true,
    code: 'RBAC_DENIED',
    message:
      backendMessage ??
      `This action is denied by the project's RBAC policy (${def.stepUp.resource}/${def.stepUp.action} = 0).`,
    tool: def.name,
    resource: def.stepUp.resource,
    action: def.stepUp.action,
    next_actions: [
      'Do not start a step-up session — step-up MFA only unlocks level-2 actions and cannot elevate a level-0 deny.',
      `If this action should be allowed, ask a project admin to raise the RBAC level for ${def.stepUp.resource}/${def.stepUp.action}.`,
    ],
  });
}

// RBAC 등급 조회 실패 — 일시 장애/설정 문제이므로 인증이 아니라 재시도를 안내한다.
function rbacUnresolvedResult(
  def: ProtectedToolDefinition,
  backendMessage: string | undefined,
): ToolTextResult {
  return textResult({
    ok: false,
    blocked: true,
    code: 'RBAC_UNRESOLVED',
    message:
      backendMessage ??
      'The backend could not resolve the RBAC permission for this action.',
    tool: def.name,
    resource: def.stepUp.resource,
    action: def.stepUp.action,
    next_actions: [
      `Retry ${def.name} once after a short wait — this is a backend lookup failure, not a missing step-up.`,
      'If it persists, report the backend message above to the project operator.',
    ],
  });
}

/** Machine-readable 403 discriminant set by the backend `StepUpSessionGuard`. */
function extractErrorCode(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const errorCode = (data as { errorCode?: unknown }).errorCode;
  return typeof errorCode === 'string' && errorCode.length > 0
    ? errorCode
    : undefined;
}

// 정의 데이터의 stepUp 선언을 403 번역 래핑으로 이행하는 등록 루프 어댑터.
// config를 먼저 로드하는 순서는 전환 전 핸들러 형태(핸들러 선두 loadStepupConfig)를 보존한다.
export function wrapProtectedTool(
  def: ProtectedToolDefinition,
): (args: never) => Promise<ToolTextResult> {
  return async (args) => {
    const config = loadStepupConfig();
    const envelope: Envelope = await def.run(config, args);
    if (envelope.status === 403) {
      const message = extractFailureMessage(envelope.data);
      switch (extractErrorCode(envelope.data)) {
        case 'RBAC_DENIED':
          return rbacDeniedResult(def, message);
        case 'RBAC_UNRESOLVED':
          return rbacUnresolvedResult(def, message);
        default:
          // STEP_UP_REQUIRED, or a legacy backend that sends no errorCode —
          // step-up guidance is the recoverable default either way.
          return stepupRequiredResult(def, message);
      }
    }
    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
    };
  };
}
