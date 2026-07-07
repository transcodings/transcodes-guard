/**
 * RBAC + optional step-up sid for protected MCP tool handlers.
 * Hook is first line; this re-checks on handler run (stdio/curl bypass backstop).
 * Matrix: 0=block, 1=pass (no sid), 2=step-up (verified sid required).
 *
 * Guard v3: the "verified" signal is no longer an on-disk record. The poll
 * tools mark a backend-verified sid in the server's in-memory verified set
 * (`verified-memory.ts`); this backstop consumes it single-shot via
 * `claimStepupVerified()`. Same long-lived MCP server process, so the mark →
 * claim handoff never crosses a process boundary.
 */
import { loadMergedToolRules, ruleAppliesToHost, TRANSCODES_GUARD_TOOL_PREFIX, toolNameMatchesRule, } from '@transcodes-guard/core/patterns';
import { checkRbacPermission, claimStepupVerified, loadStepupConfig, } from '@transcodes-guard/core/stepup';
const RBAC_TTL_MS = 5 * 60_000;
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
    return rules.find((r) => {
        if (!ruleAppliesToHost(r))
            return false;
        if (r.name === toolName)
            return true;
        if (toolName.startsWith('mcp__') ||
            toolName.includes(TRANSCODES_GUARD_TOOL_PREFIX)) {
            return toolNameMatchesRule(toolName, r);
        }
        return false;
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
        // Level 1 = allowed without step-up: the backend guard resolves RBAC itself
        // and requires no sid. Level 2 requires a backend-verified sid, consumed
        // single-shot from the in-memory verified set.
        if (level === 1) {
            return {
                isError: false,
                content: [{ type: 'text', text: await run(undefined) }],
            };
        }
        const sid = claimStepupVerified();
        if (!sid)
            return stepupRequiredResult(toolName, rule);
        return {
            isError: false,
            content: [{ type: 'text', text: await run(sid) }],
        };
    }
    const sid = claimStepupVerified();
    if (!sid) {
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
    return {
        isError: false,
        content: [{ type: 'text', text: await run(sid) }],
    };
}
//# sourceMappingURL=stepup-helper.js.map