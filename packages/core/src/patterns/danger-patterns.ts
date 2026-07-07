// System rules are embedded at build time (static import → bundler inlines the
// JSON). This is mandatory because plugins ship as tsup bundles where a runtime
// `import.meta.url`-relative read would resolve to the bundle's location, not
// this package's data/ dir.
import systemPatternsData from './data/danger-patterns.json' with {
  type: 'json',
};
import {
  coerceRbacAction,
  coerceRbacResource,
  type RbacAction,
} from './rbac.js';

export interface DangerPattern {
  id: string;
  regex: string;
  reason: string;
  stepupResource?: string;
  stepupAction?: RbacAction;
}

export interface DangerConfig {
  patterns: DangerPattern[];
}

/** Immutable built-in baseline, or project bash rule from the signed bundle. */
export type PatternSource = 'system' | 'bundle';

export interface MergedPattern extends DangerPattern {
  source: PatternSource;
  stepupResource: string;
  stepupAction: RbacAction;
}

export interface MatchResult {
  matched: MergedPattern;
}

export function loadSystemPatterns(): DangerConfig {
  return { patterns: [...(systemPatternsData as DangerConfig).patterns] };
}

/** Built-in system patterns only — project bash rules come from the policy bundle. */
export function loadMergedPatterns(): MergedPattern[] {
  return loadSystemPatterns().patterns.map((p) => ({
    ...p,
    stepupResource: coerceRbacResource(p.stepupResource),
    stepupAction: coerceRbacAction(p.stepupAction),
    source: 'system' as const,
  }));
}

export function findFirstMatch(
  command: string,
  patterns: MergedPattern[],
): MatchResult | null {
  for (const p of patterns) {
    try {
      if (new RegExp(p.regex).test(command)) return { matched: p };
    } catch {
      // Skip invalid regex — bundle rules are validated on write.
    }
  }
  return null;
}
