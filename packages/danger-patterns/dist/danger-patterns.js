import { readFileSync, writeFileSync, mkdirSync, existsSync, } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
const USER_PATTERNS_PATH = path.join(os.homedir(), ".claude", "ai-action-tracker", "user-patterns.json");
const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
export function getUserPatternsPath() {
    return USER_PATTERNS_PATH;
}
export function loadSystemPatterns() {
    // Package-local resolution: data/ is a sibling of dist/, so from the
    // built file under dist/ we walk up one level and into data/.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dataPath = path.join(here, "..", "data", "danger-patterns.json");
    try {
        return JSON.parse(readFileSync(dataPath, "utf8"));
    }
    catch (err) {
        throw new Error(`danger-patterns.json not found at ${dataPath}: ${err.message}`);
    }
}
export function loadUserPatterns() {
    try {
        return JSON.parse(readFileSync(USER_PATTERNS_PATH, "utf8"));
    }
    catch {
        return { patterns: [] };
    }
}
export function saveUserPatterns(config) {
    mkdirSync(path.dirname(USER_PATTERNS_PATH), { recursive: true });
    writeFileSync(USER_PATTERNS_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}
export function userPatternsFileExists() {
    return existsSync(USER_PATTERNS_PATH);
}
export function loadMergedPatterns() {
    const system = loadSystemPatterns().patterns.map((p) => ({
        ...p,
        source: "system",
    }));
    const user = loadUserPatterns().patterns.map((p) => ({
        ...p,
        source: "user",
    }));
    return [...system, ...user];
}
export function findFirstMatch(command, patterns) {
    for (const p of patterns) {
        try {
            if (new RegExp(p.regex).test(command))
                return { matched: p };
        }
        catch {
            // Skip patterns with invalid regex. User patterns are validated on
            // write, so this only protects against a manually corrupted file.
        }
    }
    return null;
}
export class PatternValidationError extends Error {
}
function isReservedId(id, systemIds) {
    return systemIds.has(id);
}
export function validateNewPattern(input) {
    const { id, regex, reason } = input;
    if (!ID_REGEX.test(id)) {
        throw new PatternValidationError(`id must match /^[a-z0-9][a-z0-9-]*$/ (got: "${id}")`);
    }
    const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
    if (isReservedId(id, systemIds)) {
        throw new PatternValidationError(`id "${id}" is reserved by a system pattern and cannot be overridden`);
    }
    try {
        new RegExp(regex);
    }
    catch (e) {
        throw new PatternValidationError(`regex does not compile: ${e.message}`);
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length === 0) {
        throw new PatternValidationError("reason must not be empty");
    }
    return { id, regex, reason: trimmedReason };
}
export function addUserPattern(input) {
    const pattern = validateNewPattern(input);
    const current = loadUserPatterns();
    if (current.patterns.some((p) => p.id === pattern.id)) {
        throw new PatternValidationError(`id "${pattern.id}" already exists in user patterns; use update instead`);
    }
    current.patterns.push(pattern);
    saveUserPatterns(current);
    return pattern;
}
export function updateUserPattern(id, changes) {
    const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
    if (systemIds.has(id)) {
        throw new PatternValidationError(`id "${id}" is a system pattern and cannot be modified`);
    }
    const current = loadUserPatterns();
    const existing = current.patterns.find((p) => p.id === id);
    if (!existing) {
        throw new PatternValidationError(`no user pattern with id "${id}"`);
    }
    const merged = {
        id,
        regex: changes.regex ?? existing.regex,
        reason: changes.reason ?? existing.reason,
    };
    // Re-validate the full pattern (regex compile, reason non-empty).
    // id check is redundant but cheap and keeps a single validation path.
    const validated = validateNewPattern(merged);
    const idx = current.patterns.findIndex((p) => p.id === id);
    current.patterns[idx] = validated;
    saveUserPatterns(current);
    return validated;
}
export function removeUserPattern(id) {
    const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
    if (systemIds.has(id)) {
        throw new PatternValidationError(`id "${id}" is a system pattern and cannot be removed`);
    }
    const current = loadUserPatterns();
    const idx = current.patterns.findIndex((p) => p.id === id);
    if (idx === -1) {
        throw new PatternValidationError(`no user pattern with id "${id}"`);
    }
    current.patterns.splice(idx, 1);
    saveUserPatterns(current);
}
//# sourceMappingURL=danger-patterns.js.map