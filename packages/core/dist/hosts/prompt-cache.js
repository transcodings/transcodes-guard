/**
 * Privacy-bounded, fail-soft cache of the latest user prompts.
 *
 * The cache exists only to join a host's prompt event to its later tool event.
 * Session identifiers are hashed into filenames and never stored in the file;
 * callers receive only a short `tasks` summary, never the raw cache envelope.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, } from 'node:fs';
import path from 'node:path';
import { detectHost, promptCacheDir } from '../paths/index.js';
import { summarizePromptWithTitle, summarizeTasks } from './transcript.js';
const CACHE_VERSION = 1;
const MAX_TURNS = 4;
const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_SESSIONS = 256;
// JSON escaping can expand a UTF-8 prompt by up to six times (for example,
// control characters become `\\u00XX`). Keep the read limit large enough for
// every value accepted by boundedUtf8(), otherwise a valid write can poison
// its own cache until TTL expiry.
const MAX_CACHE_FILE_BYTES = MAX_TURNS * MAX_PROMPT_BYTES * 6 + 8 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;
const DIAGNOSTICS_ENV = 'TRANSCODES_GUARD_PROMPT_DIAGNOSTICS';
/**
 * Store a fixed-size digest rather than a host-provided opaque turn id. Apart
 * from avoiding needless persistence of that identifier, this prevents an
 * oversized payload field from consuming the bounded cache-file budget.
 */
function cachePromptId(promptId) {
    const normalized = promptId?.trim();
    return normalized
        ? createHash('sha256').update(normalized).digest('hex')
        : undefined;
}
function currentHost(host) {
    return host ?? detectHost() ?? 'unknown';
}
function cacheFileName(host, sessionId) {
    const digest = createHash('sha256')
        .update(host)
        .update('\0')
        .update(sessionId)
        .digest('hex');
    return `${digest}.json`;
}
function boundedUtf8(text) {
    const normalized = text.trim();
    if (Buffer.byteLength(normalized, 'utf8') <= MAX_PROMPT_BYTES) {
        return normalized;
    }
    let low = 0;
    let high = normalized.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(normalized.slice(0, mid), 'utf8') <= MAX_PROMPT_BYTES) {
            low = mid;
        }
        else {
            high = mid - 1;
        }
    }
    return normalized.slice(0, low);
}
function safeRoot(create) {
    const root = promptCacheDir();
    if (!existsSync(root)) {
        if (!create)
            return undefined;
        mkdirSync(root, { recursive: true, mode: 0o700 });
    }
    const stat = lstatSync(root);
    if (stat.isSymbolicLink() || !stat.isDirectory())
        return undefined;
    chmodSync(root, 0o700);
    return root;
}
function readCache(filePath) {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size > MAX_CACHE_FILE_BYTES) {
        throw new Error('unsafe prompt cache file');
    }
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) {
        throw new Error('unsupported prompt cache file');
    }
    const entries = parsed.entries.filter((entry) => {
        if (!entry || typeof entry !== 'object')
            return false;
        const candidate = entry;
        return (typeof candidate.prompt === 'string' &&
            typeof candidate.capturedAt === 'number' &&
            Number.isFinite(candidate.capturedAt) &&
            (candidate.promptId === undefined ||
                typeof candidate.promptId === 'string'));
    });
    return { version: CACHE_VERSION, entries };
}
function writeCache(filePath, cache) {
    const root = path.dirname(filePath);
    const tempPath = path.join(root, `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    let fd;
    try {
        const serialized = JSON.stringify(cache);
        if (Buffer.byteLength(serialized, 'utf8') > MAX_CACHE_FILE_BYTES) {
            throw new Error('prompt cache exceeds its size limit');
        }
        fd = openSync(tempPath, 'wx', 0o600);
        writeFileSync(fd, serialized, 'utf8');
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        chmodSync(tempPath, 0o600);
        renameSync(tempPath, filePath);
        chmodSync(filePath, 0o600);
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
        try {
            if (existsSync(tempPath))
                unlinkSync(tempPath);
        }
        catch {
            // The cache is best effort; a stale temp file is harmless and prunable.
        }
    }
}
function prune(root, now) {
    const survivors = [];
    for (const name of readdirSync(root)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name))
            continue;
        const filePath = path.join(root, name);
        try {
            const stat = lstatSync(filePath);
            if (stat.isSymbolicLink() || !stat.isFile())
                continue;
            if (now - stat.mtimeMs > TTL_MS) {
                unlinkSync(filePath);
            }
            else {
                survivors.push({ path: filePath, mtimeMs: stat.mtimeMs });
            }
        }
        catch {
            // Concurrent hook activity and unreadable files are safe to ignore.
        }
    }
    survivors.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const stale of survivors.slice(MAX_SESSIONS)) {
        try {
            unlinkSync(stale.path);
        }
        catch {
            // Best-effort bound; never fail a host hook for cleanup.
        }
    }
}
/** Capture a prompt without ever throwing into the host hook. */
export function capturePrompt(input) {
    try {
        capturePromptUnsafe(input);
    }
    catch {
        // Prompt telemetry is never allowed to block a host lifecycle hook.
    }
}
function freshEntries(filePath, now) {
    if (!existsSync(filePath))
        return [];
    return readCache(filePath).entries.filter((entry) => now - entry.capturedAt <= TTL_MS);
}
function appendEntry(entries, entry, forceRefresh) {
    const next = entry.promptId
        ? entries.filter((candidate) => candidate.promptId !== entry.promptId)
        : entries;
    const isDuplicate = !entry.promptId && next.at(-1)?.prompt === entry.prompt && !forceRefresh;
    return isDuplicate ? undefined : [...next, entry].slice(-MAX_TURNS);
}
function capturePromptUnsafe(input) {
    const sessionId = input.sessionId?.trim();
    const promptId = cachePromptId(input.promptId);
    const prompt = boundedUtf8(input.prompt ?? '');
    if (!sessionId || !prompt)
        return;
    const host = currentHost(input.host);
    const now = input.capturedAt ?? Date.now();
    const root = safeRoot(true);
    if (!root)
        return;
    const filePath = path.join(root, cacheFileName(host, sessionId));
    const entries = appendEntry(freshEntries(filePath, now), {
        promptId,
        prompt,
        capturedAt: now,
    }, input.forceRefresh ?? false);
    if (entries)
        writeCache(filePath, { version: CACHE_VERSION, entries });
    prune(root, now);
}
function emitDiagnostic(host, source) {
    if (process.env[DIAGNOSTICS_ENV] !== '1')
        return;
    try {
        process.stderr.write(`${JSON.stringify({ component: 'prompt-context', host, source })}\n`);
    }
    catch {
        // Diagnostics are optional and carry no user/session identifiers.
    }
}
/** Resolve current-turn context from cache first, then the existing transcript. */
export function resolvePromptContext(input) {
    const host = currentHost(input.host);
    const now = input.now ?? Date.now();
    const tasks = readCachedTasks(input, host, now);
    if (tasks) {
        const result = { tasks, source: 'prompt_hook' };
        emitDiagnostic(host, result.source);
        return result;
    }
    const transcriptTasks = summarizeTasks(input.transcriptPath);
    const result = transcriptTasks
        ? { tasks: transcriptTasks, source: 'transcript' }
        : { source: 'absent' };
    emitDiagnostic(host, result.source);
    return result;
}
function readCachedTasks(input, host, now) {
    try {
        const sessionId = input.sessionId?.trim();
        const root = safeRoot(false);
        if (!sessionId || !root)
            return undefined;
        const filePath = path.join(root, cacheFileName(host, sessionId));
        const fresh = freshEntries(filePath, now);
        const promptId = cachePromptId(input.promptId);
        // A cache entry is safe only when both hook events carry the same opaque
        // turn id. In particular Antigravity has no such id; choosing its latest
        // session entry can attach a previous user turn to the current tool call.
        if (!promptId)
            return undefined;
        const entry = fresh.find((candidate) => candidate.promptId === promptId);
        prune(root, now);
        return entry
            ? summarizePromptWithTitle(input.transcriptPath, entry.prompt)
            : undefined;
    }
    catch {
        // Corrupt/unreadable cache falls through to the established transcript path.
        return undefined;
    }
}
//# sourceMappingURL=prompt-cache.js.map