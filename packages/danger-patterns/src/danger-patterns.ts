import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
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
import {
  type RbacAction,
  coerceRbacAction,
  coerceRbacResource,
  isRbacAction,
} from "./rbac.js";

export interface DangerPattern {
  id: string;
  regex: string;
  reason: string;
  /** RBAC resource key (e.g. "system"), validated against the live backend at
   * add time. Feeds `createStepupSession({ resource })`. Optional on disk for
   * back-compat; coerced to a default in `loadMergedPatterns`. */
  stepupResource?: string;
  /** RBAC CRUD action (create/read/update/delete). Feeds
   * `createStepupSession({ action })`. Optional on disk for back-compat. */
  stepupAction?: RbacAction;
}

export interface DangerConfig {
  patterns: DangerPattern[];
}

export type PatternSource = "system" | "user";

export interface MergedPattern extends DangerPattern {
  source: PatternSource;
  /** Always resolved (coerced from defaults) for the gate. */
  stepupResource: string;
  stepupAction: RbacAction;
}

const USER_PATTERNS_FILE = "user-patterns.json";

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
  migrateLegacyFile(USER_PATTERNS_FILE, "data");
  try {
    const raw = readFileSync(getUserPatternsPath(), "utf8");
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
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function userPatternsFileExists(): boolean {
  return existsSync(getUserPatternsPath());
}

export function loadMergedPatterns(): MergedPattern[] {
  const system = loadSystemPatterns().patterns.map((p) => ({
    ...p,
    stepupResource: coerceRbacResource(p.stepupResource),
    stepupAction: coerceRbacAction(p.stepupAction),
    source: "system" as const,
  }));
  const user = loadUserPatterns().patterns.map((p) => ({
    ...p,
    stepupResource: coerceRbacResource(p.stepupResource),
    stepupAction: coerceRbacAction(p.stepupAction),
    source: "user" as const,
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
  /** Must be a CRUD action (create/read/update/delete). */
  stepupAction: string;
  /** RBAC resource key. Backend existence is validated by the caller (MCP
   * handler) before this runs — this layer only enforces non-empty. */
  stepupResource: string;
}

function isReservedId(id: string, systemIds: Set<string>): boolean {
  return systemIds.has(id);
}

// Heuristic guard: a command pattern matches a Bash COMMAND STRING via regex.
// An MCP tool name (e.g. `mcp__github__delete_repository` or `github:delete_page`)
// pasted in as a "regex" is a mis-bucketed tool rule — it would never fire here
// because the hook only regex-matches Bash command strings, not tool_names.
// Reject it deterministically and redirect to `add_tool_rule`.
function detectMcpToolName(regex: string): boolean {
  // Explicit MCP namespace marker — unambiguous across hosts.
  if (/mcp__[A-Za-z0-9]/.test(regex)) return true;
  // Bare `<server>__<tool>` / `<server>:<tool>` identifier with no regex
  // metacharacters or whitespace (i.e. someone pasted a tool name verbatim).
  if (/^[A-Za-z0-9_-]+(?:__|:)[A-Za-z0-9_.:-]+$/.test(regex)) return true;
  return false;
}

export function validateNewPattern(input: PatternInput): DangerPattern {
  const { id, regex, reason, stepupAction, stepupResource } = input;

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

  if (detectMcpToolName(regex)) {
    throw new PatternValidationError(
      `"${regex}" looks like an MCP tool name, not a Bash command pattern. ` +
        `Bash Command only match Bash command strings via regex; they never ` +
        `match MCP tool calls. Use add_tool_rule (exact tool_name match) instead.`,
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
    throw new PatternValidationError("reason must not be empty");
  }

  const trimmedAction = stepupAction.trim();
  if (!isRbacAction(trimmedAction)) {
    throw new PatternValidationError(
      `stepupAction must be one of create|read|update|delete (got: "${stepupAction}")`,
    );
  }

  const trimmedResource = stepupResource.trim();
  if (!trimmedResource) {
    throw new PatternValidationError("stepupResource must not be empty");
  }

  return {
    id,
    regex,
    reason: trimmedReason,
    stepupAction: trimmedAction,
    stepupResource: trimmedResource,
  };
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
  changes: {
    regex?: string;
    reason?: string;
    stepupAction?: string;
    stepupResource?: string;
  },
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
    throw new PatternValidationError(
      `no user pattern with id "${id}"`,
    );
  }

  const merged: PatternInput = {
    id,
    regex: changes.regex ?? existing.regex,
    reason: changes.reason ?? existing.reason,
    // Coerce legacy rows missing the RBAC fields so an unrelated edit doesn't
    // fail validation.
    stepupAction: changes.stepupAction ?? coerceRbacAction(existing.stepupAction),
    stepupResource:
      changes.stepupResource ?? coerceRbacResource(existing.stepupResource),
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
