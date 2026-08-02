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
export declare function summarizeTasks(transcriptPath: string | undefined): string | undefined;
