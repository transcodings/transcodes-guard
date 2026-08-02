import type { ToolTarget } from '../types/tool-targets.js';

/**
 * Resolve the effective output root for a tool.
 *
 * The slim Transcodes fork has no HERMES_HOME / KIMI_CODE_HOME overrides —
 * output roots are used as-is.
 */
export function resolveToolOutputRoot({
  outputRoot,
  toolTarget: _toolTarget,
  global: _global,
}: {
  outputRoot: string;
  toolTarget: ToolTarget;
  global: boolean;
}): string {
  return outputRoot;
}
