import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
function loadDangerPatterns() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.join(here, "..", "hooks", "danger-patterns.json"),
        path.join(here, "..", "..", "hooks", "danger-patterns.json"),
    ];
    for (const p of candidates) {
        try {
            return JSON.parse(readFileSync(p, "utf8"));
        }
        catch {
            // try next
        }
    }
    throw new Error(`danger-patterns.json not found (tried: ${candidates.join(", ")})`);
}
function formatPatternsMarkdown(config) {
    const lines = [
        "# Blocked Bash command patterns",
        "",
        `${config.patterns.length} pattern(s) intercept Bash invocations before execution.`,
        "Source: `hooks/danger-patterns.json` (re-read at every hook run).",
        "",
        "| id | reason | regex |",
        "| -- | ------ | ----- |",
    ];
    for (const { id, reason, regex } of config.patterns) {
        lines.push(`| \`${id}\` | ${reason} | \`${regex}\` |`);
    }
    return lines.join("\n");
}
export function createServer() {
    const server = new McpServer({
        name: "ai-action-tracker-mcp",
        version: "0.1.0",
    });
    server.registerResource("danger-patterns", "danger-patterns://list", {
        title: "Blocked Bash patterns",
        description: "Regex patterns the PreToolUse hook uses to block dangerous Bash commands. Read from hooks/danger-patterns.json at request time so edits are reflected immediately.",
        mimeType: "text/markdown",
    }, async (uri) => ({
        contents: [
            {
                uri: uri.href,
                mimeType: "text/markdown",
                text: formatPatternsMarkdown(loadDangerPatterns()),
            },
        ],
    }));
    server.registerTool("echo", {
        title: "Echo",
        description: "Echoes the given message back to the caller.",
        inputSchema: { message: z.string() },
    }, async ({ message }) => ({
        content: [{ type: "text", text: `Echo: ${message}` }],
    }));
    server.registerPrompt("greeting", {
        title: "Greeting",
        description: "Generate a greeting addressed to the given name.",
        argsSchema: { name: z.string() },
    }, ({ name }) => ({
        messages: [
            {
                role: "user",
                content: { type: "text", text: `Hello ${name}!` },
            },
        ],
    }));
    return server;
}
//# sourceMappingURL=server.js.map