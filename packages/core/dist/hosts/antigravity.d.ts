import type { HookAdapter } from './types.js';
/**
 * The Korean+English keyword set the agent should recognize as "user
 * reports step-up done". Host-agnostic — shared by every host's
 * user-prompt hook (Claude Code / Codex UserPromptSubmit, Cursor
 * beforeSubmitPrompt) and the Antigravity transcript scan below.
 */
export declare const COMPLETION_PATTERN: RegExp;
/**
 * Inspect the tail of an Antigravity `transcript.jsonl` and return the
 * content of the most recent user-originated message if it matches the
 * completion pattern. Returns null if no recent user message matches or
 * if the file cannot be read.
 *
 * Antigravity's transcript line schema isn't fully spec'd, so this is
 * best-effort: accepts any object with a string `content` / `text` /
 * `message` field plus a role-like field equal to `"user"` /
 * `"user_message"`. Other shapes are skipped silently. If antigravity
 * changes the schema, the detection silently degrades to "no match"
 * rather than throwing.
 */
export declare function detectUserDoneFromTranscript(transcriptPath: string | undefined, pattern?: RegExp): string | null;
export declare const antigravityAdapter: HookAdapter;
