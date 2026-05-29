/**
 * Tool-name → backend path map + thin request wrapper for the ported
 * step-up-protected toolset.
 *
 * Adapted from transcodes-mcp-server/src/constants.ts (endpoint map) and
 * src/tools/tool-utils.ts (`req` helper). Step-up enforcement is NOT here
 * — the PreToolUse hook gates protected calls via `hooks/tool-rules.json`
 * before this layer runs, and tool handlers thread the verified sid
 * through `withStepupVerifiedSid` so `request()` can attach the
 * `X-Step-Up-Session-Id` header.
 */
import { type HttpRequestInput as RequestInput, type StepupConfig } from "@ai-action-tracker/stepup-core";
export type ReqInput = Omit<RequestInput, "path">;
/**
 * Resolve the tool's base path from ENDPOINT_MAP + optional `pathSuffix`
 * and call the backend. Returns a JSON-stringified envelope so the model
 * sees a stable shape regardless of HTTP outcome (success, 4xx, network
 * error). Mirrors transcodes-mcp-server's `req()` output contract.
 */
export declare function req(config: StepupConfig, input: ReqInput, toolName: string, pathSuffix?: string): Promise<string>;
/**
 * Result for console-only tools that intentionally do NOT call the backend.
 * They exist purely for discoverability + routing: the agent learns the
 * capability exists and that it must be performed in the Transcodes console.
 * Ported from transcodes-mcp-server/src/tools/tool-utils.ts `blocked`.
 */
export declare function blockedResult(message: string): {
    content: {
        type: "text";
        text: string;
    }[];
};
/** Arg-parse helpers — kept thin since zod already validates each schema. */
export declare const parse: {
    record(v: unknown): Record<string, unknown>;
};
