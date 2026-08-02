import { type HostName } from '../paths/index.js';
type CacheHost = HostName | 'unknown';
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
/** Capture a prompt without ever throwing into the host hook. */
export declare function capturePrompt(input: CapturePromptInput): void;
/** Resolve current-turn context from cache first, then the existing transcript. */
export declare function resolvePromptContext(input: ResolvePromptContextInput): PromptContextResult;
export {};
