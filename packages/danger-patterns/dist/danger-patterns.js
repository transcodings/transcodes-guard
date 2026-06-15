import { coerceRbacAction, coerceRbacResource, } from './rbac.js';
// System rules are embedded at build time (static import → bundler inlines the
// JSON). This is mandatory because plugins ship as tsup bundles where a runtime
// `import.meta.url`-relative read would resolve to the bundle's location, not
// this package's data/ dir.
import systemPatternsData from './data/danger-patterns.json' with {
    type: 'json'
};
export function loadSystemPatterns() {
    return { patterns: [...systemPatternsData.patterns] };
}
/** Built-in system patterns only — project bash rules come from the policy bundle. */
export function loadMergedPatterns() {
    return loadSystemPatterns().patterns.map((p) => ({
        ...p,
        stepupResource: coerceRbacResource(p.stepupResource),
        stepupAction: coerceRbacAction(p.stepupAction),
        source: 'system',
    }));
}
export function findFirstMatch(command, patterns) {
    for (const p of patterns) {
        try {
            if (new RegExp(p.regex).test(command))
                return { matched: p };
        }
        catch {
            // Skip invalid regex — bundle rules are validated on write.
        }
    }
    return null;
}
//# sourceMappingURL=danger-patterns.js.map