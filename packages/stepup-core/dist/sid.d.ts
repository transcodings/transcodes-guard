/** Mint a fresh grouping id and persist it (prompt-submit / session-start). */
export declare function rotatePromptGroup(now?: number): string;
/** Current grouping id; lazily mints (TTL bucket) when absent or expired. */
export declare function resolvePromptGroup(now?: number): string;
/** Read-only peek at the current group (no mint). Null when absent/expired. */
export declare function peekPromptGroup(now?: number): string | null;
