/**
 * Data-driven MCP tool definition — the single source every tool-name
 * derivative is generated from (t5).
 *
 * One definition object carries the wire metadata (`name`, `title`,
 * `description`, `inputSchema`, handler) AND the catalog metadata
 * (`summary`, `category`, `access`, `mutating`, `meta`, `stepUpProtected`,
 * optional `stepUp` coordinate). Registration is a generic loop
 * (`registerToolDefinitions`); docs, `GUARD_TOOL_NAMES`, the CLI catalog,
 * and the protected-rule table are all generated from these objects by
 * `scripts/generate-router-files.mjs` — no hand-mirrored name list survives.
 *
 * Generation scripts read ONLY the data properties; `inputSchema`,
 * `handler`, and `run` are never touched outside registration, so importing
 * a definition module has no side effects beyond module load.
 */
import type {
  McpServer,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { objectOutputType, ZodRawShape, ZodTypeAny } from 'zod';
import type { RbacAction } from '../patterns/index.js';
import type { StepupConfig } from '../stepup/index.js';

/** How the tool reaches its capability — mirrors the TOOL CATALOG badges. */
export type ToolAccess = 'api' | 'console-only' | 'gate';

/** Display order for TOOL CATALOG sections (docs + CLI). */
export const TOOL_CATEGORY_ORDER = [
  'Gate & Policies',
  'Meta & Identity',
  'Project',
  'Members',
  'RBAC',
  'Passcode',
  'Auth Devices',
  'Audit',
  'Membership',
  'Platform users',
  'JWK',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORY_ORDER)[number];

/** Text-content MCP tool result — the only shape our handlers produce. */
export interface ToolTextResult {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
}

/**
 * Step-up RBAC coordinate for a protected tool. Enforcement lives on the
 * backend (`StepUpSessionGuard` + coordinate verified cache); the client uses
 * this coordinate only to phrase the `STEP_UP_REQUIRED` recovery guidance
 * when the backend answers 403.
 */
export interface GuardToolStepUp {
  action: RbacAction;
  resource: string;
}

interface GuardToolMetadata {
  /** Canonical registered wire name — always `tc_`-prefixed. */
  name: `tc_${string}`;
  /** Human title passed to `registerTool`. */
  title: string;
  /** Long LLM-facing description passed to `registerTool` (on the wire). */
  description: string;
  /** One-line human summary for the TOOL CATALOG docs + CLI dashboard. */
  summary: string;
  category: ToolCategory;
  access: ToolAccess;
  mutating: boolean;
  /**
   * Step-up infrastructure tool: systemically required for the step-up
   * recovery loop itself (create/poll/inspect). The derived meta set must
   * mirror the backend's `guard.meta-tools.ts` exactly — a drift-alarm test
   * pins the two lists to each other.
   */
  meta: boolean;
  /** Catalog display badge — NOT the same set as `stepUp` (badge ⊂ rules). */
  stepUpProtected: boolean;
}

/**
 * Plain tool: `handler` is registered as-is.
 *
 * Handler args are typed at the definition site via `defineTool`; the stored
 * erased signature uses `never` so heterogeneous definitions fit one array.
 */
export interface PlainToolDefinition extends GuardToolMetadata {
  inputSchema: ZodRawShape;
  stepUp?: undefined;
  handler: (args: never) => Promise<ToolTextResult>;
}

/**
 * Protected tool: the registration loop wraps `run` in the caller-supplied
 * `wrapProtected` (gate-backend's 403 → `STEP_UP_REQUIRED` translation), so
 * declaring `stepUp` IS being wrapped — a definition cannot forget its
 * recovery guidance. Enforcement itself is backend-owned; the handler sends
 * no step-up header. `config` is loaded once by the wrapper, before the
 * handler body runs.
 */
export interface ProtectedToolDefinition extends GuardToolMetadata {
  inputSchema: ZodRawShape;
  stepUp: GuardToolStepUp;
  run: (config: StepupConfig, args: never) => Promise<string>;
}

export type GuardToolDefinition = PlainToolDefinition | ProtectedToolDefinition;

/**
 * Definition-site helper: infers handler arg types from `inputSchema` and
 * returns the erased shape the registration loop and generators consume.
 */
export function defineTool<S extends ZodRawShape>(
  def: GuardToolMetadata & {
    inputSchema: S;
    stepUp?: undefined;
    handler: (args: objectOutputType<S, ZodTypeAny>) => Promise<ToolTextResult>;
  },
): PlainToolDefinition {
  return def as unknown as PlainToolDefinition;
}

/** `defineTool` for step-up-protected tools (gate-backend only). */
export function defineProtectedTool<S extends ZodRawShape>(
  def: GuardToolMetadata & {
    inputSchema: S;
    stepUp: GuardToolStepUp;
    run: (
      config: StepupConfig,
      args: objectOutputType<S, ZodTypeAny>,
    ) => Promise<string>;
  },
): ProtectedToolDefinition {
  return def as unknown as ProtectedToolDefinition;
}

/**
 * Generic registration loop — the single `registerTool` call site per
 * package. Protected definitions require `wrapProtected` (the 403 →
 * `STEP_UP_REQUIRED` translation adapter); registering one without it throws
 * loudly at startup rather than shipping a protected tool with no recovery
 * guidance.
 */
export function registerToolDefinitions(
  server: McpServer,
  defs: readonly GuardToolDefinition[],
  wrapProtected?: (
    def: ProtectedToolDefinition,
  ) => (args: never) => Promise<ToolTextResult>,
): void {
  for (const def of defs) {
    let handler: (args: never) => Promise<ToolTextResult>;
    if (def.stepUp !== undefined) {
      if (wrapProtected === undefined) {
        throw new Error(
          `transcodes-guard: protected tool ${def.name} registered without a wrapProtected adapter`,
        );
      }
      handler = wrapProtected(def);
    } else {
      handler = def.handler;
    }
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
      },
      // Erased `never`-args signature back to the SDK's callback shape — the
      // definition-site generics (defineTool) already checked the real types.
      handler as unknown as ToolCallback<ZodRawShape>,
    );
  }
}
