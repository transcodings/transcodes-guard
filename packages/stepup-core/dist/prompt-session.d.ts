/** Window after which a bucket auto-rotates even without a new prompt. */
export declare const PROMPT_SESSION_TTL_MS: number;
export type PromptSession = {
    id: string;
    createdAt: number;
};
/**
 * The active bucket id, minting a fresh one when missing or older than
 * PROMPT_SESSION_TTL_MS. Called by the PreToolUse gate to tag `/guard/evaluate`.
 */
export declare function getPromptSessionId(now?: number): string;
/**
 * Start a new bucket unconditionally (new user prompt = new grouping window).
 * Returns the new id. Called by the UserPromptSubmit hook.
 */
export declare function rotatePromptSession(now?: number): string;
/** Explicit lock: drop the bucket so the next command starts a fresh window. */
export declare function clearPromptSession(): void;
