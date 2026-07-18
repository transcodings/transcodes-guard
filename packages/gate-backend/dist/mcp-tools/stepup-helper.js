import { loadStepupConfig } from '@transcodes-guard/core/stepup';
// step-up이 필요한 상황을 에이전트가 바로 재시도 흐름으로 이어갈 수 있게 구조화한다.
function stepupRequiredResult(def, backendMessage) {
    return {
        isError: true,
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    ok: false,
                    blocked: true,
                    code: 'STEP_UP_REQUIRED',
                    message: backendMessage ??
                        'Step-up MFA is required before running this protected MCP tool.',
                    tool: def.name,
                    resource: def.stepUp.resource,
                    action: def.stepUp.action,
                    next_actions: [
                        `Call tc_create_stepup_session with resource "${def.stepUp.resource}" and action "${def.stepUp.action}", then have the user complete WebAuthn in the opened browser window.`,
                        'Call tc_poll_stepup_session_wait with the same resource and action until it reports verified.',
                        `When verified, retry ${def.name} with the same arguments.`,
                    ],
                }, null, 2),
            },
        ],
    };
}
/** Backend envelope fields the translation needs (`req()` JSON output). */
function parseEnvelope(text) {
    try {
        const parsed = JSON.parse(text);
        return parsed !== null && typeof parsed === 'object'
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function extractBackendMessage(data) {
    if (!data || typeof data !== 'object')
        return undefined;
    const message = data.message;
    return typeof message === 'string' && message.length > 0
        ? message
        : undefined;
}
// 정의 데이터의 stepUp 선언을 403 번역 래핑으로 이행하는 등록 루프 어댑터.
// config를 먼저 로드하는 순서는 전환 전 핸들러 형태(핸들러 선두 loadStepupConfig)를 보존한다.
export function wrapProtectedTool(def) {
    return async (args) => {
        const config = loadStepupConfig();
        const text = await def.run(config, args);
        const envelope = parseEnvelope(text);
        if (envelope?.status === 403) {
            return stepupRequiredResult(def, extractBackendMessage(envelope.data));
        }
        return { isError: false, content: [{ type: 'text', text }] };
    };
}
//# sourceMappingURL=stepup-helper.js.map