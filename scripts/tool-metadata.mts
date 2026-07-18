/**
 * Metadata bridge between the tool definition data (the single source of
 * truth) and the codegen pipeline.
 *
 * Imports the definition arrays from BOTH packages and exposes plain
 * metadata rows + renderers for every generated artifact:
 *   - TOOL CATALOG section (scripts/router-body.mjs → command/skill files)
 *   - packages/core/src/patterns/guard-tool-names.generated.ts
 *   - cli/src/tool-catalog.generated.ts
 *
 * Runs under tsx (`node --import tsx scripts/generate-router-files.mjs`).
 * Core definition modules are imported by RELATIVE path so tsx compiles the
 * sources directly; gate-backend definition modules resolve their
 * `@transcodes-guard/core/*` value imports against the built core dist, so
 * `prebuild:plugin` (and the CI codegen check) builds core first. Handlers
 * are never invoked — only data properties are read. The gate-backend
 * relative import below is a sanctioned codegen seam (exempted in the CI
 * firewall backstop).
 */
import { denyByDefaultBackend } from '../packages/core/src/contract/noop.js';
import {
  type GuardToolDefinition,
  TOOL_CATEGORY_ORDER,
} from '../packages/core/src/contract/tool-def.js';
import { coreToolDefinitions } from '../packages/core/src/server/tool-definitions.js';
import { backendToolDefinitions } from '../packages/gate-backend/src/mcp-tools/definitions.js';

export const ALL_TOOL_DEFINITIONS: readonly GuardToolDefinition[] = [
  // Registration order: core first (createServer), then the backend set.
  ...coreToolDefinitions(denyByDefaultBackend),
  ...backendToolDefinitions,
];

// ── Validation — fail the codegen loudly on inconsistent definitions ──────
{
  const seen = new Set<string>();
  for (const def of ALL_TOOL_DEFINITIONS) {
    if (!def.name.startsWith('tc_')) {
      throw new Error(`tool name must be tc_-prefixed: ${def.name}`);
    }
    if (seen.has(def.name)) {
      throw new Error(`duplicate tool definition: ${def.name}`);
    }
    seen.add(def.name);
    if (!(TOOL_CATEGORY_ORDER as readonly string[]).includes(def.category)) {
      throw new Error(`unknown category '${def.category}' on ${def.name}`);
    }
  }
  for (const def of backendToolDefinitions) {
    if (def.meta) {
      throw new Error(
        `meta (step-up infrastructure) tools live only in core definitions: ${def.name}`,
      );
    }
  }
}

/**
 * Wording must match the `registerResource` descriptions in
 * packages/core/src/server/server.ts verbatim — resources stay imperative
 * there, and this list feeds the generated host docs.
 */
export const MCP_RESOURCES = [
  {
    uri: 'version://info',
    description:
      'Returns the running plugin version. Use this to confirm which build is currently loaded after an update.',
  },
] as const;

export interface CatalogRow {
  name: string;
  description: string;
  category: string;
  access: string;
  stepUpProtected: boolean;
  mutating: boolean;
}

/** Bare-name catalog rows for the TOOL CATALOG docs section. */
export const MCP_TOOLS: readonly CatalogRow[] = ALL_TOOL_DEFINITIONS.map(
  (def) => ({
    name: def.name.slice('tc_'.length),
    description: def.summary,
    category: def.category,
    access: def.access,
    stepUpProtected: def.stepUpProtected,
    mutating: def.mutating,
  }),
);

function toolTag(tool: CatalogRow): string {
  if (tool.access === 'console-only') return ' [console-only]';
  if (tool.stepUpProtected) return ' [mutating · step-up protected]';
  if (tool.mutating) return ' [mutating]';
  return ' [read-only]';
}

/** Render the TOOL CATALOG appendix appended to every /transcodes command body. */
export function renderToolCatalogSection(
  tools: readonly CatalogRow[],
  resources: typeof MCP_RESOURCES,
): string {
  const byCategory = new Map<string, CatalogRow[]>();
  for (const tool of tools) {
    const list = byCategory.get(tool.category) ?? [];
    list.push(tool);
    byCategory.set(tool.category, list);
  }

  const lines = [
    '',
    `TOOL CATALOG — all ${tools.length} MCP tools + ${resources.length} resources on transcodes-guard. Match the user request to a workflow MENU item above OR to an exact tool/resource below, then call it by its exact name.`,
    '',
    'Resources (read by URI, not tools):',
  ];
  for (const resource of resources) {
    lines.push(`- \`${resource.uri}\` — ${resource.description}`);
  }

  let index = 1;
  for (const category of TOOL_CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (!items?.length) continue;
    lines.push('', `${category} (${items.length}):`);
    for (const tool of items) {
      lines.push(
        `${index}) \`${tool.name}\` — ${tool.description}${toolTag(tool)}`,
      );
      index += 1;
    }
  }

  return lines.join('\n');
}

/**
 * Drift check for hand-written menu prose: every backticked token that looks
 * like a tool name (lowercase with an underscore) must be a registered bare
 * or tc_-prefixed name. Catches a menu entry outliving a renamed tool.
 */
export function assertBacktickedToolNames(text: string): void {
  const bare = new Set<string>(MCP_TOOLS.map((t) => t.name));
  const registered = new Set<string>(ALL_TOOL_DEFINITIONS.map((d) => d.name));
  const unknown = new Set<string>();
  for (const [, token] of text.matchAll(/`([^`]+)`/g)) {
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(token)) continue;
    if (bare.has(token) || registered.has(token)) continue;
    unknown.add(token);
  }
  if (unknown.size > 0) {
    throw new Error(
      `menu prose names unregistered tools: ${[...unknown].sort().join(', ')}`,
    );
  }
}

// ── Generated-source renderers ────────────────────────────────────────────

// biome 포맷과 일치하는 문자열 리터럴: 기본 단일 인용, 이스케이프가 줄어들면
// 이중 인용을 선택한다(biome quoteStyle single의 실제 동작).
const q = (s: string): string => {
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  const singles = (esc.match(/'/g) ?? []).length;
  const doubles = (esc.match(/"/g) ?? []).length;
  if (singles > doubles) return `"${esc.replace(/"/g, '\\"')}"`;
  return `'${esc.replace(/'/g, "\\'")}'`;
};

// biome처럼 80열을 넘는 속성 값을 다음 줄로 내린다(문자열은 쪼개지 않음).
function prop(indent: string, key: string, value: string): string {
  const oneLine = `${indent}${key}: ${value},`;
  if (oneLine.length <= 80) return oneLine;
  return `${indent}${key}:\n${indent}  ${value},`;
}

const GENERATED_HEADER = `// AUTO-GENERATED by scripts/generate-router-files.mjs — do not edit by hand.
// Canonical source: the tool definition data
// (packages/core/src/server/tool-definitions.ts +
// packages/gate-backend/src/mcp-tools/*.ts).
// Regenerated on every \`npm run build:plugin\`.
`;

/** packages/core/src/patterns/guard-tool-names.generated.ts */
export function renderGuardToolNamesTs(): string {
  const names = ALL_TOOL_DEFINITIONS.map((d) => d.name).sort();
  const metaNames = ALL_TOOL_DEFINITIONS.filter((d) => d.meta)
    .map((d) => d.name)
    .sort();

  const lines: string[] = [];
  lines.push(GENERATED_HEADER);
  lines.push(
    '/** Every registered built-in transcodes-guard MCP tool name (bare form). */',
  );
  lines.push('export const GUARD_TOOL_NAMES: ReadonlySet<string> = new Set([');
  for (const name of names) lines.push(`  ${q(name)},`);
  lines.push(']);');
  lines.push('');
  lines.push('/**');
  lines.push(
    ' * Step-up infrastructure (meta) tools — systemically required for the',
  );
  lines.push(
    ' * step-up recovery loop. Must mirror the backend `guard.meta-tools.ts`',
  );
  lines.push(
    ' * exactly; the drift alarm is packages/core/test/meta-tool-names.test.ts.',
  );
  lines.push(' */');
  lines.push(
    'export const GUARD_META_TOOL_NAMES: ReadonlySet<string> = new Set([',
  );
  for (const name of metaNames) lines.push(`  ${q(name)},`);
  lines.push(']);');
  lines.push('');
  return lines.join('\n');
}

/** cli/src/tool-catalog.generated.ts */
export function renderCliCatalogTs(): string {
  // Stable-sort by TOOL_CATEGORY_ORDER so consumers that render the array
  // in order (buildAdminToolsPayload) show sections in display order.
  const sorted = [...ALL_TOOL_DEFINITIONS].sort(
    (a, b) =>
      (TOOL_CATEGORY_ORDER as readonly string[]).indexOf(a.category) -
      (TOOL_CATEGORY_ORDER as readonly string[]).indexOf(b.category),
  );
  const lines: string[] = [];
  lines.push(GENERATED_HEADER);
  lines.push(`import type { AdminToolEntry } from './tool-catalog.js';`);
  lines.push('');
  lines.push('/** All Transcodes Admin MCP tools, grouped for display. */');
  lines.push('export const TRANSCODES_ADMIN_TOOLS: AdminToolEntry[] = [');
  for (const def of sorted) {
    lines.push('  {');
    lines.push(prop('    ', 'name', q(def.name.slice('tc_'.length))));
    lines.push(prop('    ', 'title', q(def.title)));
    lines.push(prop('    ', 'description', q(def.summary)));
    lines.push(prop('    ', 'category', q(def.category)));
    lines.push(prop('    ', 'access', q(def.access)));
    lines.push(prop('    ', 'stepUpProtected', String(def.stepUpProtected)));
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}
