import { z } from "zod";
import { loadStepupConfig } from "@transcodes-guard/stepup-core";
import { req } from "./transcodes-client.js";
import { withStepupVerifiedSid } from "./stepup-helper.js";
const textResult = (text, isError = false) => ({
    isError,
    content: [{ type: "text", text }],
});
export function registerPasscodeTools(server) {
    server.registerTool("passcode_create", {
        title: "Create recovery passcode",
        description: "Create a recovery passcode (CreatePasscodeDto in body). " +
            "Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-passcode-create`). " +
            "Use for onboarding, support, or admin provisioning.",
        inputSchema: {
            body: z.object({ member_id: z.string() }),
        },
    }, async ({ body }) => {
        const config = loadStepupConfig();
        const text = await withStepupVerifiedSid("passcode_create", (sid) => req(config, {
            method: "POST",
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
        }, "passcode_create"));
        return textResult(text);
    });
}
//# sourceMappingURL=passcode.js.map