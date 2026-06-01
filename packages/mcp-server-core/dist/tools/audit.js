import { z } from "zod";
import { loadStepupConfig } from "@transcodes-guard-private/stepup-core";
import { req } from "./transcodes-client.js";
const textResult = (text, isError = false) => ({
    isError,
    content: [{ type: "text", text }],
});
export function registerAuditTools(server) {
    server.registerTool("get_security_logs", {
        title: "Get security logs",
        description: "List project audit logs with pagination and filters. Use for security investigations, login/admin activity review, compliance. Returns tag, severity, IP, user_agent, member_id, metadata. Filter by `tag`; `start_date`/`end_date` are ISO 8601 range filters.",
        inputSchema: {
            page: z.number().optional(),
            limit: z.number().optional(),
            tag: z.string().optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
        },
    }, async ({ page, limit, tag, start_date, end_date }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: "GET",
            query: {
                project_id: config.projectId,
                page,
                limit,
                tag,
                start_date,
                end_date,
            },
        }, "get_security_logs");
        return textResult(text);
    });
}
//# sourceMappingURL=audit.js.map