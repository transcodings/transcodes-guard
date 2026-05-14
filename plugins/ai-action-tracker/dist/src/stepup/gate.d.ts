export type GateInput = {
    reason: string;
    command: string;
};
export type GateResult = {
    allowed: true;
    sid: string;
} | {
    allowed: false;
    reason: "no-token" | "create-failed" | "timeout" | "error";
    detail?: string;
};
/**
 * Run the gate. Returns `allowed: true` only when the backend confirms a
 * verified step-up session within the poll window. All other paths (no
 * token, create failure, network error, timeout) fail-safe to `allowed: false`
 * so the hook can fall through to its existing exit-2 block message.
 */
export declare function runStepupGate(input: GateInput): Promise<GateResult>;
