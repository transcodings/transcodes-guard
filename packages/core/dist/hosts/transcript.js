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
export function tailJsonlLines(filePath, maxBytes = 32_768) {
    let size;
    try {
        size = statSync(filePath).size;
    }
    catch {
        return [];
    }
    if (size === 0)
        return [];
    const readSize = Math.min(size, maxBytes);
    const buf = Buffer.alloc(readSize);
    try {
        const fd = openSync(filePath, 'r');
        try {
            readSync(fd, buf, 0, readSize, size - readSize);
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
        return [];
    }
    const text = buf.toString('utf8');
    const lines = text.split('\n').filter((line) => line.length > 0);
    // If we started mid-line (size > readSize), drop the partial first line.
    if (size > readSize && lines.length > 1)
        lines.shift();
    const out = [];
    for (const line of lines) {
        try {
            out.push(JSON.parse(line));
        }
        catch {
            // malformed line — ignore
        }
    }
    return out;
}
/** Longest each half of the summary may run before being ellipsized. */
const MAX_PART_CHARS = 300;
function readString(v) {
    if (typeof v !== 'string')
        return undefined;
    const trimmed = v.trim();
    return trimmed ? trimmed : undefined;
}
/** Flatten to a single line and ellipsize — `tasks` is a one-line summary. */
function clip(text) {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length <= MAX_PART_CHARS
        ? flat
        : `${flat.slice(0, MAX_PART_CHARS - 1)}…`;
}
/** Flatten and bound one current prompt for the evaluate `tasks` field. */
export function summarizePrompt(text) {
    const normalized = readString(text);
    return normalized ? clip(normalized) : undefined;
}
/**
 * Human-authored text of a chat message record.
 *
 * Claude Code files tool results under `type: "user"` records too, so a naive
 * "last user message" would summarize tool output instead of the person's
 * instruction. Only `text` blocks count; `tool_result` blocks are skipped.
 */
function messageText(message) {
    if (!message || typeof message !== 'object')
        return undefined;
    const content = message.content;
    if (typeof content === 'string')
        return readString(content);
    if (!Array.isArray(content))
        return undefined;
    const text = content
        .map((block) => {
        if (!block || typeof block !== 'object')
            return undefined;
        const b = block;
        return b.type === 'text' ? readString(b.text) : undefined;
    })
        .filter((part) => part !== undefined)
        .join('\n');
    return readString(text);
}
/**
 * Slash-command invocations reach the transcript as an XML-ish envelope
 * (`<command-name>…`, and the command's own output as `<local-command-stdout>…`)
 * filed under the same `type: "user"` as a real instruction. Summarizing one
 * reports the markup instead of what the person asked for — the same failure
 * `messageText` skips `tool_result` blocks to avoid, in a different record.
 */
const COMMAND_ENVELOPE = /^<(command-(name|message|args)|local-command-std(out|err))>/;
/**
 * Host-injected records (caveats, reminders) also ride under `type: "user"`.
 * Claude Code marks them `isMeta`; they are never a user instruction.
 */
function isMetaRecord(r) {
    return (r.isMeta === true ||
        r.message?.isMeta === true);
}
/** Parse host records with a measured, dedicated schema. */
function knownRecordContext(record) {
    if (record.type === 'ai-title') {
        return { title: readString(record.aiTitle) };
    }
    if (record.type === 'last-prompt') {
        return { prompt: readString(record.lastPrompt) };
    }
    if (record.source === 'USER_EXPLICIT' && record.type === 'USER_INPUT') {
        const content = readString(record.content);
        if (!content)
            return {};
        const request = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(content)?.[1];
        return { prompt: readString(request) ?? content };
    }
    if (record.type !== 'event_msg')
        return undefined;
    const payload = record.payload;
    return payload?.type === 'user_message'
        ? { prompt: readString(payload.message) }
        : {};
}
/** Duck-type a human-authored record for hosts without a measured schema. */
function genericUserPrompt(record) {
    const role = readString(record.role) ??
        readString(record.message?.role) ??
        readString(record.type);
    if (role !== 'user' && role !== 'user_message')
        return undefined;
    if (isMetaRecord(record))
        return undefined;
    const text = messageText(record.message) ??
        readString(record.content) ??
        readString(record.text) ??
        readString(record.message);
    return text && !COMMAND_ENVELOPE.test(text) ? text : undefined;
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
function readTranscriptContext(transcriptPath) {
    if (!transcriptPath)
        return undefined;
    let title;
    let prompt;
    // Records are scanned oldest-to-newest so the last of each kind wins.
    for (const record of tailJsonlLines(transcriptPath)) {
        if (!record || typeof record !== 'object')
            continue;
        const r = record;
        const known = knownRecordContext(r);
        if (known) {
            title = known.title ?? title;
            prompt = known.prompt ?? prompt;
            continue;
        }
        prompt = genericUserPrompt(r) ?? prompt;
    }
    return { title, prompt };
}
/** Most recent human-authored instruction, without the host session title. */
export function latestUserPromptFromTranscript(transcriptPath) {
    return readTranscriptContext(transcriptPath)?.prompt;
}
/**
 * Summarize a prompt captured by a hook while retaining the transcript title
 * that has always been part of the audit-facing `tasks` context.
 */
export function summarizePromptWithTitle(transcriptPath, prompt) {
    const title = readTranscriptContext(transcriptPath)?.title;
    const parts = [title, prompt].filter((part) => readString(part) !== undefined);
    return parts.length ? parts.map(clip).join(' · ') : undefined;
}
export function summarizeTasks(transcriptPath) {
    const context = readTranscriptContext(transcriptPath);
    if (!context)
        return undefined;
    const parts = [context.title, context.prompt].filter((part) => part !== undefined);
    return parts.length ? parts.map(clip).join(' · ') : undefined;
}
//# sourceMappingURL=transcript.js.map