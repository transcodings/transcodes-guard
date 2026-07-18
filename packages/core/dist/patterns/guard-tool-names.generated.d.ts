/** Every registered built-in transcodes-guard MCP tool name (bare form). */
export declare const GUARD_TOOL_NAMES: ReadonlySet<string>;
/**
 * Step-up infrastructure (meta) tools — systemically required for the
 * step-up recovery loop. Must mirror the backend `guard.meta-tools.ts`
 * exactly; the drift alarm is packages/core/test/meta-tool-names.test.ts.
 */
export declare const GUARD_META_TOOL_NAMES: ReadonlySet<string>;
