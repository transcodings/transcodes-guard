// Transcodes slim fork: only Claude / Codex / Cursor / Antigravity.
// Per-feature tool-target tuples; `ALL_TOOL_TARGETS` is their union (tool-targets.ts).

export const rulesProcessorToolTargetTuple = [
  'agentsmd',
  'antigravity-cli',
  'antigravity-ide',
  'antigravity-plugin',
  'claudecode',
  'codexcli',
  'cursor',
] as const;

export const skillsProcessorToolTargetTuple = [
  'agentsmd',
  'agentsskills',
  'antigravity-cli',
  'antigravity-ide',
  'antigravity-plugin',
  'claudecode',
  'claudecode-plugin',
  'codexcli',
  'cursor',
] as const;

// Removed features keep empty tuples so accidental imports fail loudly at the enum level.
export const ignoreProcessorToolTargetTuple = [] as const;
export const mcpProcessorToolTargetTuple = [] as const;
export const commandsProcessorToolTargetTuple = [] as const;
export const subagentsProcessorToolTargetTuple = [] as const;
export const hooksProcessorToolTargetTuple = [] as const;
export const permissionsProcessorToolTargetTuple = [] as const;
export const checksProcessorToolTargetTuple = [] as const;

export const ALL_TOOL_TARGET_TUPLES = [
  rulesProcessorToolTargetTuple,
  skillsProcessorToolTargetTuple,
] as const;
