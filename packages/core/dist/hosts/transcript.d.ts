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
/**
 * Tail the last `maxBytes` of a JSONL file and parse each line. Best-effort:
 * malformed lines and read errors are swallowed (returns empty array).
 * Reading the tail rather than the whole file keeps the cost flat as
 * transcripts grow into the megabytes.
 */
export declare function tailJsonlLines(filePath: string, maxBytes?: number): unknown[];
/** Flatten and bound one current prompt for the evaluate `tasks` field. */
export declare function summarizePrompt(text: string): string | undefined;
/** Most recent human-authored instruction, without the host session title. */
export declare function latestUserPromptFromTranscript(transcriptPath: string | undefined): string | undefined;
/**
 * Summarize a prompt captured by a hook while retaining the transcript title
 * that has always been part of the audit-facing `tasks` context.
 */
export declare function summarizePromptWithTitle(transcriptPath: string | undefined, prompt: string): string | undefined;
export declare function summarizeTasks(transcriptPath: string | undefined): string | undefined;
