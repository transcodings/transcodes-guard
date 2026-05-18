export type RequestInput = {
    reason: string;
    command: string;
};
export type RequestResult = {
    ok: true;
    sid: string;
    browserUrl: string;
    expiresAt?: string;
    launched: boolean;
} | {
    ok: false;
    reason: "no-token" | "create-failed" | "error";
    detail?: string;
};
/**
 * Create a step-up session and launch the browser. Returns sid + URL on
 * success so the hook can hand them to the agent. Does not poll — the
 * agent is responsible for calling `poll_stepup_session` and retrying.
 */
export declare function requestStepup(input: RequestInput): Promise<RequestResult>;
