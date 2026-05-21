/**
 * Read the verified record, run the handler with the sid, then consume
 * both the verified and pending records.
 *
 * Used by tool handlers protected by a tool-rule. The PreToolUse hook only
 * confirms a verified record exists and emits explicit allow — the actual
 * consume must happen here because the sid is needed for the backend's
 * `X-Step-Up-Session-Id` header before being discarded.
 *
 * Missing verified record → throws (loud surface, not silent corruption).
 * Consume runs in `finally` so a backend failure cannot leave the record
 * reusable.
 */
import { clearPending } from "../stepup/pending.js";
import { consumeVerified, readVerified } from "../stepup/store.js";
export async function withStepupVerifiedSid(toolName, fn) {
    const verified = readVerified();
    if (!verified) {
        throw new Error(`step-up verified record missing for ${toolName} — the PreToolUse hook should have populated it before this handler was invoked`);
    }
    try {
        return await fn(verified.sid);
    }
    finally {
        consumeVerified();
        clearPending();
    }
}
//# sourceMappingURL=stepup-helper.js.map