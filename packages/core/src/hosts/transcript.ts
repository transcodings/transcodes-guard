/**
 * Host transcript reading — the one place that knows what each host writes
 * into its JSONL transcript.
 *
 * All four hosts hand the hook a transcript path (`transcript_path`, or
 * `transcriptPath` on Antigravity), but none of them ever specified the file's
 * contents to us. So every reader here is best-effort by construction: an
 * unreadable file, an unknown record shape, or a format change upstream
 * degrades to "no summary", never to a throw. The hook runs before every tool
 * call, and a summary is worth strictly less than the gate it rides on.
 *
 * The transcript itself never leaves the machine — only the short summary
 * built here goes on the wire.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';

/**
 * Tail the last `maxBytes` of a JSONL file and parse each line. Best-effort:
 * malformed lines and read errors are swallowed (returns empty array).
 * Reading the tail rather than the whole file keeps the cost flat as
 * transcripts grow into the megabytes.
 */
export function tailJsonlLines(filePath: string, maxBytes = 32_768): unknown[] {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return [];
  }
  if (size === 0) return [];

  const readSize = Math.min(size, maxBytes);
  const buf = Buffer.alloc(readSize);

  try {
    const fd = openSync(filePath, 'r');
    try {
      readSync(fd, buf, 0, readSize, size - readSize);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }

  const text = buf.toString('utf8');
  const lines = text.split('\n').filter((line) => line.length > 0);
  // If we started mid-line (size > readSize), drop the partial first line.
  if (size > readSize && lines.length > 1) lines.shift();

  const out: unknown[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // malformed line — ignore
    }
  }
  return out;
}

/** Longest each half of the summary may run before being ellipsized. */
const MAX_PART_CHARS = 300;

function readString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

/** Flatten to a single line and ellipsize — `tasks` is a one-line summary. */
function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_PART_CHARS
    ? flat
    : `${flat.slice(0, MAX_PART_CHARS - 1)}…`;
}

/**
 * Human-authored text of a chat message record.
 *
 * Claude Code files tool results under `type: "user"` records too, so a naive
 * "last user message" would summarize tool output instead of the person's
 * instruction. Only `text` blocks count; `tool_result` blocks are skipped.
 */
function messageText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return readString(content);
  if (!Array.isArray(content)) return undefined;

  const text = content
    .map((block) => {
      if (!block || typeof block !== 'object') return undefined;
      const b = block as { type?: unknown; text?: unknown };
      return b.type === 'text' ? readString(b.text) : undefined;
    })
    .filter((part): part is string => part !== undefined)
    .join('\n');
  return readString(text);
}

/**
 * Summarize what the agent was working on when it made this call, as
 * `"<session title> · <latest instruction>"`.
 *
 * The front half is the host's own session summary and the back half the most
 * recent instruction, so a long session that drifted off its original topic
 * still reports what is happening right now. Either half may be missing; the
 * summary degrades to whichever survives, and to nothing at all when neither
 * does.
 *
 * No model is called. Every host that has a summary already wrote one, and the
 * hook runs on every tool call — an LLM round-trip here is not on the table.
 */
export function summarizeTasks(
  transcriptPath: string | undefined,
): string | undefined {
  if (!transcriptPath) return undefined;

  let title: string | undefined;
  let prompt: string | undefined;

  // Records are scanned oldest-to-newest so the last of each kind wins.
  for (const record of tailJsonlLines(transcriptPath)) {
    if (!record || typeof record !== 'object') continue;
    const r = record as Record<string, unknown>;

    // Claude Code writes both halves as dedicated records.
    if (r.type === 'ai-title') {
      title = readString(r.aiTitle) ?? title;
      continue;
    }
    if (r.type === 'last-prompt') {
      prompt = readString(r.lastPrompt) ?? prompt;
      continue;
    }

    // Codex wraps the user's message in an event envelope.
    if (r.type === 'event_msg') {
      const payload = r.payload as Record<string, unknown> | undefined;
      if (payload?.type === 'user_message') {
        prompt = readString(payload.message) ?? prompt;
      }
      continue;
    }

    // Anything else: a user-authored record carrying plain text. This is the
    // path for hosts whose record schema we have not measured, and for Claude
    // Code subagent transcripts, which carry no title records at all.
    const role =
      readString(r.role) ??
      readString((r.message as { role?: unknown } | undefined)?.role) ??
      readString(r.type);
    if (role === 'user' || role === 'user_message') {
      prompt =
        messageText(r.message) ??
        readString(r.content) ??
        readString(r.text) ??
        readString(r.message) ??
        prompt;
    }
  }

  const parts = [title, prompt].filter(
    (part): part is string => part !== undefined,
  );
  return parts.length ? parts.map(clip).join(' · ') : undefined;
}
