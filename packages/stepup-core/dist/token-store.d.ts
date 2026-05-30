/** `~/.transcodes` — same resolution on macOS/Linux/Windows via os.homedir(). */
export declare function transcodesConfigDir(): string;
/** `~/.transcodes/config.json`. */
export declare function transcodesConfigFile(): string;
/**
 * Read the token from `~/.transcodes/config.json`. Returns null when the
 * file is absent, unreadable, malformed, or holds no non-empty token. Never
 * throws — a broken config file must not brick the hook (fail-open before a
 * danger match, fail-safe after — see evaluate.ts).
 */
export declare function readTokenFromFile(): string | null;
/**
 * Persist the token to `~/.transcodes/config.json` (dir 0700, file 0600).
 * Used by the CLI, never by a hook. Throws on I/O failure so the CLI can
 * report the problem to the user.
 */
export declare function writeTokenToFile(token: string): void;
/** Delete `~/.transcodes/config.json` (CLI `logout`). Best-effort. */
export declare function clearTokenFile(): void;
export type TokenSource = "env" | "file" | "none";
export type ResolvedToken = {
    token: string | null;
    source: TokenSource;
};
/**
 * Resolve the active token following the documented precedence
 * (env → file → none). Returns the source too so callers (e.g. a CLI
 * `status` command) can show where the token came from.
 */
export declare function resolveToken(): ResolvedToken;
