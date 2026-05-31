import { readFileSync, writeFileSync, mkdirSync, existsSync, } from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { dataDir, migrateLegacyFile } from "@transcodes-guard/plugin-paths";
// System rules are embedded at build time (static import → bundler inlines the
// JSON). This is mandatory because plugins ship as tsup bundles where a runtime
// `import.meta.url`-relative read would resolve to the bundle's location, not
// this package's data/ dir. The JSON lives under src/data/ so it stays within
// tsconfig `rootDir`; the package build copies it to dist/data/ so esbuild can
// inline it when bundling the compiled dist.
import systemPatternsData from "./data/danger-patterns.json" with { type: "json" };
const USER_PATTERNS_FILE = "user-patterns.json";
const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
export function getUserPatternsPath() {
    return path.join(dataDir(), USER_PATTERNS_FILE);
}
export function loadSystemPatterns() {
    // Embedded at build time — see the static import above. Return a fresh shape
    // each call so no caller can mutate the shared embedded array.
    return { patterns: [...systemPatternsData.patterns] };
}
export function loadUserPatterns() {
    migrateLegacyFile(USER_PATTERNS_FILE, "data");
    try {
        const raw = readFileSync(getUserPatternsPath(), "utf8");
        // JSONC parse: tolerates // and /* */ comments + trailing commas, so a
        // user may temporarily disable a pattern by commenting out its line.
        // Comments are NOT preserved on MCP-tool write (full rewrite via
        // JSON.stringify) — only meaningful for hand-edited files.
        const parsed = parseJsonc(raw);
        if (parsed && Array.isArray(parsed.patterns)) {
            return parsed;
        }
        return { patterns: [] };
    }
    catch {
        return { patterns: [] };
    }
}
export function saveUserPatterns(config) {
    const file = getUserPatternsPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
}
export function userPatternsFileExists() {
    return existsSync(getUserPatternsPath());
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