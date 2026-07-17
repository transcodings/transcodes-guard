/**
 * Definition-site helpers for gate-backend tool definitions.
 *
 * Deliberately local (not re-used from `@transcodes-guard/core/contract`'s
 * `defineTool`): the codegen pipeline imports the definition modules with tsx
 * BEFORE any build runs, so a runtime import of a freshly added core export
 * would resolve against the committed (possibly stale) core `dist/` and
 * crash the generator. Type-only imports are erased at runtime, which keeps
 * the definition modules loadable against any committed dist.
 *
 * `meta` is pinned to `false` here — meta (step-up infrastructure) tools
 * exist only in core's definitions; a backend tool can never be meta.
 */
import type { PlainToolDefinition, ProtectedToolDefinition, ToolTextResult } from '@transcodes-guard/core/contract';
import type { StepupConfig } from '@transcodes-guard/core/stepup';
import type { objectOutputType, ZodRawShape, ZodTypeAny } from 'zod';
export declare function defineBackendTool<S extends ZodRawShape>(def: Omit<PlainToolDefinition, 'inputSchema' | 'handler' | 'meta'> & {
    meta: false;
    inputSchema: S;
    handler: (args: objectOutputType<S, ZodTypeAny>) => Promise<ToolTextResult>;
}): PlainToolDefinition;
export declare function defineProtectedBackendTool<S extends ZodRawShape>(def: Omit<ProtectedToolDefinition, 'inputSchema' | 'run' | 'meta'> & {
    meta: false;
    inputSchema: S;
    run: (config: StepupConfig, args: objectOutputType<S, ZodTypeAny>, sid: string | undefined) => Promise<string>;
}): ProtectedToolDefinition;
/** Shared text-content result shape for backend tool handlers. */
export declare function textResult(text: string, isError?: boolean): ToolTextResult;
