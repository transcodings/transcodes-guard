/**
 * RBAC + optional step-up sid for protected MCP tool handlers.
 * Hook is first line; this re-checks on handler run (stdio/curl bypass backstop).
 * Matrix: 0=block, 1=pass (no sid), 2=step-up (verified sid required).
 */
import { loadMergedToolRules, ruleAppliesToHost, toolNameMatchesRule, } from '@transcodes-guard/danger-patterns';
import { checkRbacPermission, clearMcpInflight, clearPending, consumeVerified, loadStepupConfig, mcpGrantActive, readMcpGrant, readVerified, writeMcpGrant, } from '@transcodes-guard/stepup-core';
const RBAC_TTL_MS = 5 * 60_000;
const SYSTEM_WIRE_PREFIX = 'mcp__plugin_transcodes-guard_transcodes-guard__';
const rbacCache = new Map();
// 동일 멤버/리소스/액션 조합의 RBAC 판정을 짧게 캐시해 반복 호출 비용을 줄인다.
async function getCachedRbacLevel(config, resource, action) {
    const key = `${config.memberId}:${resource}:${action}`;
    const hit = rbacCache.get(key);
    if (hit && Date.now() < hit.exp)
        return hit.level;
    const level = (await checkRbacPermission(config, resource, action)) ?? 2;
    rbacCache.set(key, { level, exp: Date.now() + RBAC_TTL_MS });
    return level;
}
// 로컬 handler 이름과 MCP wire 이름을 모두 시스템 tool-rule 기준으로 해석한다.
export function resolveProtectedToolRule(toolName, rules = loadMergedToolRules()) {
    // host-scoping 가드: provider-scoped 룰은 자기 호스트에서만 적용해야 한다
    // (그렇지 않으면 다른 호스트용 룰이 엉뚱한 호스트의 도구를 막는다).
    if (toolName.startsWith('mcp__')) {
        return rules.find((r) => toolNameMatchesRule(toolName, r) && ruleAppliesToHost(r));
    }
    return rules.find((r) => {
        if (r.source !== 'system' || r.type !== 'mcp' || r.matcher !== 'exact') {
            return false;
        }
        if (!ruleAppliesToHost(r))
            return false;
        if (!r.name.startsWith(SYSTEM_WIRE_PREFIX))
            return false;
        return r.name.slice(SYSTEM_WIRE_PREFIX.length) === toolName;
    });
}
// step-up이 필요한 상황을 에이전트가 바로 재시도 흐름으로 이어갈 수 있게 구조화한다.
function stepupRequiredResult(toolName, rule) {
    return {
        isError: true,
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    ok: false,
                    blocked: true,
                    code: 'STEP_UP_REQUIRED',
                    message: 'Step-up MFA is required before running this protected MCP tool.',
                    tool: toolName,
                    rule: {
                        id: rule.id,
                        resource: rule.resource,
                        action: rule.action,
                    },
                    next_actions: [
                        'Use the host MCP tool path so the PreToolUse hook can create a step-up session.',
                        'Complete WebAuthn in the opened browser window.',
                        `When verification succeeds, retry ${toolName} with the same arguments.`,
                    ],
                }, null, 2),
            },
        ],
    };
}
// 보호된 MCP tool 실행 전 RBAC와 step-up verified record를 최종 방어선으로 재확인한다.
export async function execProtectedTool(toolName, run) {
    const verified = readVerified();
    const rule = resolveProtectedToolRule(toolName);
    if (rule?.action !== undefined && rule.resource !== undefined) {
        let level = 2;
        try {
            const config = loadStepupConfig();
            level = await getCachedRbacLevel(config, rule.resource, rule.action);
        }
        catch {
            level = 2;
        }
        if (level === 0) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `transcodes-guard: BLOCKED (rbac-denied ${rule.resource}/${rule.action}) — ${toolName}`,
                    },
                ],
            };
        }
        // MCP-only 5-minute grant: once any MCP step-up has verified, a live grant
        // lets level-2 calls through without a fresh verified record. RBAC level 0
        // was already hard-denied above, so the grant skips the MFA prompt, never
        // the permission. The grant's own sid is the backstop the backend re-checks.
        const grant = mcpGrantActive() ? readMcpGrant() : null;
        if (level === 2 && !verified && !grant) {
            return stepupRequiredResult(toolName, rule);
        }
        // Level 1 = allowed without step-up: the backend guard resolves RBAC itself
        // and requires no sid, so only level 2 attaches a sid here (the verified
        // record's, or — on the grant fast-path — the grant's vetted sid).
        const sid = level === 2 ? (verified?.sid ?? grant?.sid) : undefined;
        try {
            return {
                isError: false,
                content: [{ type: 'text', text: await run(sid) }],
            };
        }
        finally {
            if (verified) {
                // First MCP verification reaching the handler path → open the shared
                // grant so the next 5 minutes of MCP calls reuse it, then release the
                // in-flight lock. Done before consuming the single-shot record below.
                if (level === 2) {
                    writeMcpGrant(verified.sid);
                    clearMcpInflight();
                }
                consumeVerified();
                clearPending();
            }
        }
    }
    if (!verified) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        blocked: true,
                        code: 'STEP_UP_VERIFIED_RECORD_MISSING',
                        message: 'This protected MCP tool has no verified step-up record and no matching tool-rule was found.',
                        tool: toolName,
                        next_actions: [
                            'Use the IDE MCP tool path so the PreToolUse hook can create a step-up session.',
                            'If this keeps happening, check that the system tool-rule name matches the installed MCP wire name.',
                        ],
                    }, null, 2),
                },
            ],
        };
    }
    try {
        return {
            isError: false,
            content: [{ type: 'text', text: await run(verified.sid) }],
        };
    }
    finally {
        // No tool-rule here means no RBAC coordinate to re-check, so this fallback
        // path is NOT grant-exempted (a grant must never let an unverifiable call
        // through). It still arms the grant off a real verified record so the rest
        // of the 5-minute window's MCP calls benefit.
        writeMcpGrant(verified.sid);
        clearMcpInflight();
        consumeVerified();
        clearPending();
    }
}
//# sourceMappingURL=stepup-helper.js.map