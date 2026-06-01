import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir, migrateLegacyFile } from '@transcodes-guard/plugin-paths';
import { parse as parseJsonc } from 'jsonc-parser';
// System rules are embedded at build time (static import → bundler inlines the
// JSON). This is mandatory because plugins ship as tsup bundles where a runtime
// `import.meta.url`-relative read would resolve to the bundle's location, not
// this package's data/ dir. The JSON lives under src/data/ so it stays within
// tsconfig `rootDir`; the package build copies it to dist/data/ so esbuild can
// inline it when bundling the compiled dist.
import systemPatternsData from './data/danger-patterns.json' with {
  type: 'json',
};

export interface DangerPattern {
  id: string;
  regex: string;
  reason: string;
}

export interface DangerConfig {
  patterns: DangerPattern[];
}

export type PatternSource = 'system' | 'user';

export interface MergedPattern extends DangerPattern {
  source: PatternSource;
}

const USER_PATTERNS_FILE = 'user-patterns.json';

const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export function getUserPatternsPath(): string {
  return path.join(dataDir(), USER_PATTERNS_FILE);
}

export function loadSystemPatterns(): DangerConfig {
  // Embedded at build time — see the static import above. Return a fresh shape
  // each call so no caller can mutate the shared embedded array.
  return { patterns: [...(systemPatternsData as DangerConfig).patterns] };
}

export function loadUserPatterns(): DangerConfig {
  migrateLegacyFile(USER_PATTERNS_FILE, 'data');
  try {
    const raw = readFileSync(getUserPatternsPath(), 'utf8');
    // JSONC parse: tolerates // and /* */ comments + trailing commas, so a
    // user may temporarily disable a pattern by commenting out its line.
    // Comments are NOT preserved on MCP-tool write (full rewrite via
    // JSON.stringify) — only meaningful for hand-edited files.
    const parsed = parseJsonc(raw) as DangerConfig | undefined;
    if (parsed && Array.isArray(parsed.patterns)) {
      return parsed;
    }
    return { patterns: [] };
  } catch {
    return { patterns: [] };
  }
}

export function saveUserPatterns(config: DangerConfig): void {
  const file = getUserPatternsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function userPatternsFileExists(): boolean {
  return existsSync(getUserPatternsPath());
}

export function loadMergedPatterns(): MergedPattern[] {
  const system = loadSystemPatterns().patterns.map((p) => ({
    ...p,
    source: 'system' as const,
  }));
  const user = loadUserPatterns().patterns.map((p) => ({
    ...p,
    source: 'user' as const,
  }));
  return [...system, ...user];
}

export interface MatchResult {
  matched: MergedPattern;
}

export function findFirstMatch(
  command: string,
  patterns: MergedPattern[],
): MatchResult | null {
  for (const p of patterns) {
    try {
      if (new RegExp(p.regex).test(command)) return { matched: p };
    } catch {
      // Skip patterns with invalid regex. User patterns are validated on
      // write, so this only protects against a manually corrupted file.
    }
  }
  return null;
}

export class PatternValidationError extends Error {}

export interface PatternInput {
  id: string;
  regex: string;
  reason: string;
}

function isReservedId(id: string, systemIds: Set<string>): boolean {
  return systemIds.has(id);
}

export function validateNewPattern(input: PatternInput): DangerPattern {
  const { id, regex, reason } = input;

  if (!ID_REGEX.test(id)) {
    throw new PatternValidationError(
      `id must match /^[a-z0-9][a-z0-9-]*$/ (got: "${id}")`,
    );
  }

  const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
  if (isReservedId(id, systemIds)) {
    throw new PatternValidationError(
      `id "${id}" is reserved by a system pattern and cannot be overridden`,
    );
  }

  try {
    new RegExp(regex);
  } catch (e) {
    throw new PatternValidationError(
      `regex does not compile: ${(e as Error).message}`,
    );
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new PatternValidationError('reason must not be empty');
  }

  return { id, regex, reason: trimmedReason };
}

export function addUserPattern(input: PatternInput): DangerPattern {
  const pattern = validateNewPattern(input);
  const current = loadUserPatterns();
  if (current.patterns.some((p) => p.id === pattern.id)) {
    throw new PatternValidationError(
      `id "${pattern.id}" already exists in user patterns; use update instead`,
    );
  }
  current.patterns.push(pattern);
  saveUserPatterns(current);
  return pattern;
}

export function updateUserPattern(
  id: string,
  changes: { regex?: string; reason?: string },
): DangerPattern {
  const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
  if (systemIds.has(id)) {
    throw new PatternValidationError(
      `id "${id}" is a system pattern and cannot be modified`,
    );
  }

  const current = loadUserPatterns();
  const existing = current.patterns.find((p) => p.id === id);
  if (!existing) {
    throw new PatternValidationError(`no user pattern with id "${id}"`);
  }

  const merged: PatternInput = {
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

export function removeUserPattern(id: string): void {
  const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
  if (systemIds.has(id)) {
    throw new PatternValidationError(
      `id "${id}" is a system pattern and cannot be removed`,
    );
  }
  const current = loadUserPatterns();
  const idx = current.patterns.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw new PatternValidationError(`no user pattern with id "${id}"`);
  }
  current.patterns.splice(idx, 1);
  saveUserPatterns(current);
}
