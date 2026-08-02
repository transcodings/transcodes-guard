/**
 * Privacy-bounded, fail-soft cache of the latest user prompts.
 *
 * The cache exists only to join a host's prompt event to its later tool event.
 * Session identifiers are hashed into filenames and never stored in the file;
 * callers receive only a short `tasks` summary, never the raw cache envelope.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { detectHost, type HostName, promptCacheDir } from '../paths/index.js';
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

type CacheHost = HostName | 'unknown';

interface PromptEntry {
  promptId?: string | undefined;
  prompt: string;
  capturedAt: number;
}

interface PromptCacheFile {
  version: 1;
  entries: PromptEntry[];
}

export interface CapturePromptInput {
  sessionId?: string | undefined;
  promptId?: string | undefined;
  prompt?: string | undefined;
  host?: CacheHost | undefined;
  capturedAt?: number | undefined;
  /** Refresh an identical latest prompt, used for a new Antigravity turn. */
  forceRefresh?: boolean | undefined;
}

export type PromptContextSource = 'prompt_hook' | 'transcript' | 'absent';

export interface PromptContextResult {
  tasks?: string | undefined;
  source: PromptContextSource;
}

export interface ResolvePromptContextInput {
  sessionId?: string | undefined;
  promptId?: string | undefined;
  transcriptPath?: string | undefined;
  host?: CacheHost | undefined;
  now?: number | undefined;
}

function currentHost(host?: CacheHost): CacheHost {
  return host ?? detectHost() ?? 'unknown';
}

function cacheFileName(host: CacheHost, sessionId: string): string {
  const digest = createHash('sha256')
    .update(host)
    .update('\0')
    .update(sessionId)
    .digest('hex');
  return `${digest}.json`;
}

function boundedUtf8(text: string): string {
  const normalized = text.trim();
  if (Buffer.byteLength(normalized, 'utf8') <= MAX_PROMPT_BYTES) {
    return normalized;
  }
  let low = 0;
  let high = normalized.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (
      Buffer.byteLength(normalized.slice(0, mid), 'utf8') <= MAX_PROMPT_BYTES
    ) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return normalized.slice(0, low);
}

function safeRoot(create: boolean): string | undefined {
  const root = promptCacheDir();
  if (!existsSync(root)) {
    if (!create) return undefined;
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return undefined;
  chmodSync(root, 0o700);
  return root;
}

function readCache(filePath: string): PromptCacheFile {
  const stat = lstatSync(filePath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size > MAX_CACHE_FILE_BYTES
  ) {
    throw new Error('unsafe prompt cache file');
  }
  const parsed = JSON.parse(
    readFileSync(filePath, 'utf8'),
  ) as Partial<PromptCacheFile>;
  if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) {
    throw new Error('unsupported prompt cache file');
  }
  const entries = parsed.entries.filter((entry): entry is PromptEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Partial<PromptEntry>;
    return (
      typeof candidate.prompt === 'string' &&
      typeof candidate.capturedAt === 'number' &&
      Number.isFinite(candidate.capturedAt) &&
      (candidate.promptId === undefined ||
        typeof candidate.promptId === 'string')
    );
  });
  return { version: CACHE_VERSION, entries };
}

function writeCache(filePath: string, cache: PromptCacheFile): void {
  const root = path.dirname(filePath);
  const tempPath = path.join(
    root,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  let fd: number | undefined;
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
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // The cache is best effort; a stale temp file is harmless and prunable.
    }
  }
}

function prune(root: string, now: number): void {
  const survivors: Array<{ path: string; mtimeMs: number }> = [];
  for (const name of readdirSync(root)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const filePath = path.join(root, name);
    try {
      const stat = lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      if (now - stat.mtimeMs > TTL_MS) {
        unlinkSync(filePath);
      } else {
        survivors.push({ path: filePath, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Concurrent hook activity and unreadable files are safe to ignore.
    }
  }
  survivors.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const stale of survivors.slice(MAX_SESSIONS)) {
    try {
      unlinkSync(stale.path);
    } catch {
      // Best-effort bound; never fail a host hook for cleanup.
    }
  }
}

/** Capture a prompt without ever throwing into the host hook. */
export function capturePrompt(input: CapturePromptInput): void {
  try {
    capturePromptUnsafe(input);
  } catch {
    // Prompt telemetry is never allowed to block a host lifecycle hook.
  }
}

function freshEntries(filePath: string, now: number): PromptEntry[] {
  if (!existsSync(filePath)) return [];
  return readCache(filePath).entries.filter(
    (entry) => now - entry.capturedAt <= TTL_MS,
  );
}

function appendEntry(
  entries: PromptEntry[],
  entry: PromptEntry,
  forceRefresh: boolean,
): PromptEntry[] | undefined {
  const next = entry.promptId
    ? entries.filter((candidate) => candidate.promptId !== entry.promptId)
    : entries;
  const isDuplicate =
    !entry.promptId && next.at(-1)?.prompt === entry.prompt && !forceRefresh;
  return isDuplicate ? undefined : [...next, entry].slice(-MAX_TURNS);
}

function capturePromptUnsafe(input: CapturePromptInput): void {
  const sessionId = input.sessionId?.trim();
  const prompt = boundedUtf8(input.prompt ?? '');
  if (!sessionId || !prompt) return;

  const host = currentHost(input.host);
  const now = input.capturedAt ?? Date.now();
  const root = safeRoot(true);
  if (!root) return;
  const filePath = path.join(root, cacheFileName(host, sessionId));
  const entries = appendEntry(
    freshEntries(filePath, now),
    {
      promptId: input.promptId?.trim() || undefined,
      prompt,
      capturedAt: now,
    },
    input.forceRefresh ?? false,
  );
  if (entries) writeCache(filePath, { version: CACHE_VERSION, entries });
  prune(root, now);
}

function emitDiagnostic(host: CacheHost, source: PromptContextSource): void {
  if (process.env[DIAGNOSTICS_ENV] !== '1') return;
  try {
    process.stderr.write(
      `${JSON.stringify({ component: 'prompt-context', host, source })}\n`,
    );
  } catch {
    // Diagnostics are optional and carry no user/session identifiers.
  }
}

/** Resolve current-turn context from cache first, then the existing transcript. */
export function resolvePromptContext(
  input: ResolvePromptContextInput,
): PromptContextResult {
  const host = currentHost(input.host);
  const now = input.now ?? Date.now();
  const tasks = readCachedTasks(input, host, now);
  if (tasks) {
    const result = { tasks, source: 'prompt_hook' as const };
    emitDiagnostic(host, result.source);
    return result;
  }

  const transcriptTasks = summarizeTasks(input.transcriptPath);
  const result: PromptContextResult = transcriptTasks
    ? { tasks: transcriptTasks, source: 'transcript' }
    : { source: 'absent' };
  emitDiagnostic(host, result.source);
  return result;
}

function readCachedTasks(
  input: ResolvePromptContextInput,
  host: CacheHost,
  now: number,
): string | undefined {
  try {
    const sessionId = input.sessionId?.trim();
    const root = safeRoot(false);
    if (!sessionId || !root) return undefined;
    const filePath = path.join(root, cacheFileName(host, sessionId));
    const fresh = freshEntries(filePath, now);
    const promptId = input.promptId?.trim();
    // A cache entry is safe only when both hook events carry the same opaque
    // turn id. In particular Antigravity has no such id; choosing its latest
    // session entry can attach a previous user turn to the current tool call.
    if (!promptId) return undefined;
    const entry = fresh.find((candidate) => candidate.promptId === promptId);
    prune(root, now);
    return entry
      ? summarizePromptWithTitle(input.transcriptPath, entry.prompt)
      : undefined;
  } catch {
    // Corrupt/unreadable cache falls through to the established transcript path.
    return undefined;
  }
}
