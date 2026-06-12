/**
 * Tool-rule registry — MCP-call counterpart of danger-patterns.
 *
 * `danger-patterns.ts` matches Bash command strings via regex; this module
 * matches PreToolUse payloads where `tool_name` identifies an MCP tool that
 * must trigger step-up MFA.
 *
 * Phase 3 v2: rules are organization/project policy managed in the Transcodes
 * backend (Unit G). This module owns the **read/merge + validation** surface
 * only — the built-in system baseline merged with the cached project bundle.
 * Writes go to the backend (`@transcodes-guard-private/stepup-core`
 * `addToolRule`/`updateToolRule`/`removeToolRule`), never to a local file.
 */
import { coerceRbacAction, coerceRbacResource, isRbacAction, } from '@transcodes-guard/danger-patterns';
// System rules embedded at build time — see the matching note in
// danger-patterns.ts (bundlers inline this; a runtime path read breaks once the
// plugin is bundled by tsup).
import systemToolRulesData from './data/tool-rules.json' with { type: 'json' };
const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
export function loadSystemToolRules() {
    // Embedded at build time — see the static import above. Fresh shape per call
    // so callers cannot mutate the shared embedded array.
    return { rules: [...systemToolRulesData.rules] };
}
/**
 * Layered merge (Phase3 v2 G3): built-in baseline → org/project policy bundle.
 * Same `id` in a later layer replaces the earlier rule (the replacement keeps
 * the original position so precedence inside a layer stays stable). The
 * per-user local layer was retired — rules are now centrally managed backend
 * policy applied uniformly to every human/AI agent in the project.
 *
 * `bundleRules` is the cached project bundle's `rules` array. Callers without a
 * bundle (no token / no cache) pass nothing and get the baseline only —
 * fail-closed matrix row 3.
 */
export function loadMergedToolRules(bundleRules = []) {
    // Coerce action/resource on load so the gate always sees a valid RBAC
    // coordinate even for rows written before these fields existed.
    const coerce = (r) => ({
        ...r,
        stepupAction: coerceRbacAction(r.stepupAction),
        stepupResource: coerceRbacResource(r.stepupResource),
    });
    const merged = new Map();
    for (const r of loadSystemToolRules().rules) {
        merged.set(r.id, {
            ...coerce(r),
            consume_in_hook: r.consume_in_hook ?? false,
            source: 'system',
        });
    }
    for (const r of bundleRules) {
        merged.set(r.id, {
            ...coerce(r),
            // Bundle rules are org/project policy — like system rules, the verified
            // record is consumed by the tool handler (which needs the sid), not the
            // hook, unless the rule says otherwise.
            consume_in_hook: r.consume_in_hook ?? false,
            source: 'bundle',
        });
    }
    return [...merged.values()];
}
export function findFirstToolRule(toolName, rules) {
    for (const r of rules) {
        if (r.toolName === toolName)
            return { matched: r };
    }
    return null;
}
export class ToolRuleValidationError extends Error {
}
// Heuristic guard: a tool rule matches a tool_name exactly. A Bash COMMAND
// STRING (e.g. "rm -rf /", "git push") pasted in as a toolName is a mis-bucketed
// command pattern — it would never fire here because the hook matches tool rules
// against tool_name, not Bash commands. A valid MCP tool name is a single
// identifier (alnum + `_` `.` `:` `-`, with `__`/`:` namespacing). Anything with
// whitespace or shell metacharacters is a command, not a tool name.
function detectShellCommand(toolName) {
    return /[\s|&;<>$*()`\\/]/.test(toolName);
}
/**
 * Client-side validation shared by the backend write flows (fail fast before a
 * network round-trip; the backend re-validates). Enforces the id/toolName/
 * action/resource shape and reserves the system rule ids.
 */
export function validateNewToolRule(input) {
    const { id, toolName, reason, stepupAction, stepupResource, consume_in_hook, } = input;
    if (!ID_REGEX.test(id)) {
        throw new ToolRuleValidationError(`id must match /^[a-z0-9][a-z0-9-]*$/ (got: "${id}")`);
    }
    const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
    if (systemIds.has(id)) {
        throw new ToolRuleValidationError(`id "${id}" is reserved by a system tool-rule and cannot be overridden`);
    }
    const trimmedToolName = toolName.trim();
    if (!trimmedToolName) {
        throw new ToolRuleValidationError('toolName must not be empty');
    }
    if (detectShellCommand(trimmedToolName)) {
        throw new ToolRuleValidationError(`"${trimmedToolName}" looks like a Bash command, not an MCP tool name. ` +
            'Tool rules match a tool_name exactly (e.g. mcp__github__delete_repository); ' +
            'they never match Bash commands. Use add_user_pattern (regex) instead.');
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
        throw new ToolRuleValidationError('reason must not be empty');
    }
    const trimmedAction = stepupAction.trim();
    if (!isRbacAction(trimmedAction)) {
        throw new ToolRuleValidationError(`stepupAction must be one of create|read|update|delete (got: "${stepupAction}")`);
    }
    const trimmedResource = stepupResource.trim();
    if (!trimmedResource) {
        throw new ToolRuleValidationError('stepupResource must not be empty');
    }
    return {
        id,
        toolName: trimmedToolName,
        reason: trimmedReason,
        stepupAction: trimmedAction,
        stepupResource: trimmedResource,
        ...(consume_in_hook === undefined ? {} : { consume_in_hook }),
    };
}
/** Resolve a partial change set against an existing rule into a full validated
 * rule (PUT body). System rules are immutable. */
export function mergeToolRuleChanges(existing, changes) {
    return validateNewToolRule({
        id: existing.id,
        toolName: changes.toolName ?? existing.toolName,
        reason: changes.reason ?? existing.reason,
        // Coerce existing values that predate the CRUD constraint so an unrelated
        // edit (e.g. reason only) of a legacy rule doesn't fail validation.
        stepupAction: changes.stepupAction ?? coerceRbacAction(existing.stepupAction),
        stepupResource: changes.stepupResource ?? coerceRbacResource(existing.stepupResource),
        consume_in_hook: changes.consume_in_hook ?? existing.consume_in_hook,
    });
}
/** The system rule ids — reserved and immutable. */
export function systemToolRuleIds() {
    return new Set(loadSystemToolRules().rules.map((r) => r.id));
}
//# sourceMappingURL=tool-rules.js.map