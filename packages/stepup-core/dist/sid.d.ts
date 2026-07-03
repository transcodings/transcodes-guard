/** Mint a fresh grouping sid and persist it (prompt-submit / session-start). */
export declare function rotatePromptSid(now?: number): string;
/** Current grouping sid; lazily mints (TTL bucket) when absent or expired. */
export declare function resolvePromptSid(now?: number): string;
/** Read-only peek at the current sid (no mint). Null when absent/expired. */
export declare function peekPromptSid(now?: number): string | null;
