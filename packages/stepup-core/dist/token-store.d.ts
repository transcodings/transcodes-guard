/** `~/.transcodes` — same resolution on macOS/Linux/Windows via os.homedir(). */
export declare function transcodesConfigDir(): string;
/** `~/.transcodes/config.json`. */
export declare function transcodesConfigFile(): string;
/** A saved token plus the optional user-facing label used to identify it. */
export type TokenRecord = {
    token: string;
    label: string | null;
};
/**
 * Read the active token from `~/.transcodes/config.json`. Returns null when
 * the file is absent, unreadable, malformed, or holds no non-empty token.
 * Backward-compatible signature used by `resolveToken()` and the hooks.
 */
export declare function readTokenFromFile(): string | null;
/** All saved tokens in the pool (active token included). Never throws. */
export declare function readTokenList(): string[];
/** All saved token records (token + optional label). Never throws. */
export declare function readTokenRecords(): TokenRecord[];
/**
 * Persist `token` as the active token, adding it to the pool if new
 * (dir 0700, file 0600). Existing tokens in the pool are preserved.
 *
 * A `label` is **mandatory** when adding a new token — every saved token must
 * be identifiable. When re-activating a token already in the pool, the label
 * may be omitted (the stored label is kept) or supplied to rename it. Used by
 * the CLI, never by a hook. Throws on empty token, missing label for a new
 * token, or I/O failure.
 */
export declare function writeTokenToFile(token: string, label?: string): void;
/**
 * Switch the active token to one already in (or newly added to) the pool.
 * Throws on empty token / I/O failure.
 */
export declare function setActiveToken(token: string): void;
/**
 * Rename the label of a token already in the pool, without changing which
 * token is active. Throws when the token is not found or the label is empty.
 */
export declare function setTokenLabel(token: string, label: string): void;
/**
 * Remove a token from the pool. If it was the active token, the first
 * remaining token becomes active (or none). Deletes the file entirely when
 * the pool becomes empty. Deletes the file entirely. Best-effort.
 */
export declare function removeTokenFromFile(token: string): void;
/**
 * Remove all saved tokens (CLI `reset`). Deletes the config file entirely.
 * Best-effort.
 */
export declare function clearTokenFile(): void;
export type TokenSource = 'env' | 'file' | 'none';
export type ResolvedToken = {
    token: string | null;
    source: TokenSource;
};
/**
 * Resolve the active token following the documented precedence
 * (file → env → none). Returns the source too so callers (e.g. a CLI
 * `status` command) can show where the token came from.
 */
export declare function resolveToken(): ResolvedToken;
