/**
 * Tool-rule registry — MCP-call counterpart of danger-patterns.
 *
 * `danger-patterns.ts` matches Bash command strings via regex; this module
 * matches PreToolUse payloads where `tool_name` identifies an MCP tool that
 * must trigger step-up MFA. Two-layer source (system + user) and the
 * load/validate/CRUD surface mirror danger-patterns.ts deliberately so the
 * mental model is single.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
const USER_TOOL_RULES_PATH = path.join(os.homedir(), ".claude", "ai-action-tracker", "user-tool-rules.json");
const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
export function getUserToolRulesPath() {
    return USER_TOOL_RULES_PATH;
}
export function loadSystemToolRules() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.join(here, "..", "hooks", "tool-rules.json"),
        path.join(here, "..", "..", "hooks", "tool-rules.json"),
    ];
    for (const p of candidates) {
        try {
            return JSON.parse(readFileSync(p, "utf8"));
        }
        catch {
            // try next
        }
    }
    throw new Error(`tool-rules.json not found (tried: ${candidates.join(", ")})`);
}
export function loadUserToolRules() {
    try {
        return JSON.parse(readFileSync(USER_TOOL_RULES_PATH, "utf8"));
    }
    catch {
        return { rules: [] };
    }
}
export function saveUserToolRules(config) {
    mkdirSync(path.dirname(USER_TOOL_RULES_PATH), { recursive: true });
    writeFileSync(USER_TOOL_RULES_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}
export function userToolRulesFileExists() {
    return existsSync(USER_TOOL_RULES_PATH);
}
export function loadMergedToolRules() {
    const system = loadSystemToolRules().rules.map((r) => ({
        ...r,
        source: "system",
    }));
    const user = loadUserToolRules().rules.map((r) => ({
        ...r,
        source: "user",
    }));
    return [...system, ...user];
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
export function validateNewToolRule(input) {
    const { id, toolName, reason, stepupAction, stepupResource } = input;
    if (!ID_REGEX.test(id)) {
        throw new ToolRuleValidationError(`id must match /^[a-z0-9][a-z0-9-]*$/ (got: "${id}")`);
    }
    const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
    if (systemIds.has(id)) {
        throw new ToolRuleValidationError(`id "${id}" is reserved by a system tool-rule and cannot be overridden`);
    }
    const trimmedToolName = toolName.trim();
    if (!trimmedToolName) {
        throw new ToolRuleValidationError("toolName must not be empty");
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
        throw new ToolRuleValidationError("reason must not be empty");
    }
    const trimmedAction = stepupAction.trim();
    if (!trimmedAction) {
        throw new ToolRuleValidationError("stepupAction must not be empty");
    }
    const trimmedResource = stepupResource.trim();
    if (!trimmedResource) {
        throw new ToolRuleValidationError("stepupResource must not be empty");
    }
    return {
        id,
        toolName: trimmedToolName,
        reason: trimmedReason,
        stepupAction: trimmedAction,
        stepupResource: trimmedResource,
    };
}
export function addUserToolRule(input) {
    const rule = validateNewToolRule(input);
    const current = loadUserToolRules();
    if (current.rules.some((r) => r.id === rule.id)) {
        throw new ToolRuleValidationError(`id "${rule.id}" already exists in user tool-rules; use update instead`);
    }
    current.rules.push(rule);
    saveUserToolRules(current);
    return rule;
}
export function updateUserToolRule(id, changes) {
    const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
    if (systemIds.has(id)) {
        throw new ToolRuleValidationError(`id "${id}" is a system tool-rule and cannot be modified`);
    }
    const current = loadUserToolRules();
    const existing = current.rules.find((r) => r.id === id);
    if (!existing) {
        throw new ToolRuleValidationError(`no user tool-rule with id "${id}"`);
    }
    const merged = {
        id,
        toolName: changes.toolName ?? existing.toolName,
        reason: changes.reason ?? existing.reason,
        stepupAction: changes.stepupAction ?? existing.stepupAction,
        stepupResource: changes.stepupResource ?? existing.stepupResource,
    };
    const validated = validateNewToolRule(merged);
    const idx = current.rules.findIndex((r) => r.id === id);
    current.rules[idx] = validated;
    saveUserToolRules(current);
    return validated;
}
export function removeUserToolRule(id) {
    const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
    if (systemIds.has(id)) {
        throw new ToolRuleValidationError(`id "${id}" is a system tool-rule and cannot be removed`);
    }
    const current = loadUserToolRules();
    const idx = current.rules.findIndex((r) => r.id === id);
    if (idx === -1) {
        throw new ToolRuleValidationError(`no user tool-rule with id "${id}"`);
    }
    current.rules.splice(idx, 1);
    saveUserToolRules(current);
}
//# sourceMappingURL=tool-rules.js.map