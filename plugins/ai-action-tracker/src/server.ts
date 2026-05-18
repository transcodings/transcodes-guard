import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addUserPattern,
  findFirstMatch,
  getUserPatternsPath,
  loadMergedPatterns,
  PatternValidationError,
  removeUserPattern,
  updateUserPattern,
  type MergedPattern,
} from "./danger-patterns.js";
import { loadStepupConfig } from "./stepup/config.js";
import { markVerified } from "./stepup/pending.js";
import {
  createStepupSession,
  pollStepupSession,
  pollStepupSessionWait,
} from "./stepup/session.js";
import { writeVerified } from "./stepup/store.js";

function formatPatternsMarkdown(patterns: MergedPattern[]): string {
  const lines: string[] = [
    "# Blocked Bash command patterns",
    "",
    `${patterns.length} pattern(s) intercept Bash invocations before execution.`,
    `User patterns live at \`${getUserPatternsPath()}\` and are editable through the \`add_user_pattern\`/\`update_user_pattern\`/\`remove_user_pattern\` tools. System patterns are immutable.`,
    "",
    "| source | id | reason | regex |",
    "| ------ | -- | ------ | ----- |",
  ];
  for (const { source, id, reason, regex } of patterns) {
    lines.push(`| ${source} | \`${id}\` | ${reason} | \`${regex}\` |`);
  }
  return lines.join("\n");
}

function textResult(text: string, isError = false) {
  return {
    isError,
    content: [{ type: "text" as const, text }],
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "ai-action-tracker-mcp",
    version: "0.1.0",
  });

  server.registerResource(
    "danger-patterns",
    "danger-patterns://list",
    {
      title: "Blocked Bash patterns",
      description:
        "Regex patterns the PreToolUse hook uses to block dangerous Bash commands. Merges immutable system patterns (hooks/danger-patterns.json) with user patterns (~/.claude/ai-action-tracker/user-patterns.json), read fresh at every request.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: formatPatternsMarkdown(loadMergedPatterns()),
        },
      ],
    }),
  );

  server.registerTool(
    "simulate_command",
    {
      title: "Simulate command against block patterns",
      description:
        "Check whether a specific Bash command would be blocked by the PreToolUse hook's regex layer. Call this whenever the user mentions a concrete command and asks if it is dangerous, safe, blocked, intercepted, allowed, or whether the hook/danger-patterns would catch it — including Korean phrasings like '이 명령 차단될까', '이거 hook에 걸려?', 'rm -rf src 실행해도 돼?', '미리 검사해줘'. Runs against the union of system and user patterns. Does NOT simulate the second-layer `rm -rf` git-tracked check (cwd-dependent), so the hook may still block commands this tool reports as allowed.",
      inputSchema: { command: z.string().min(1) },
    },
    async ({ command }) => {
      const patterns = loadMergedPatterns();
      const hit = findFirstMatch(command, patterns);
      if (!hit) {
        return textResult(
          `ALLOWED by regex layer (${patterns.length} pattern(s) checked).\nNote: hook may still block via the rm -rf git-tracked semantic check.`,
        );
      }
      const m = hit.matched;
      return textResult(
        `BLOCKED by ${m.source} pattern \`${m.id}\`\nreason: ${m.reason}\nregex: ${m.regex}`,
      );
    },
  );

  server.registerTool(
    "add_user_pattern",
    {
      title: "Add user danger pattern",
      description:
        "Register a new user-owned block pattern that the PreToolUse hook will enforce. Call when the user asks to add/register/block a new pattern, ban a command, or extend danger-patterns — e.g. '패턴 추가해줘', 'sudo 막아줘', '이런 명령도 차단되게 해줘'. id must be unique across both system and user patterns; regex must compile. Persisted to ~/.claude/ai-action-tracker/user-patterns.json and effective on the next hook invocation.",
      inputSchema: {
        id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric + hyphen"),
        regex: z.string().min(1),
        reason: z.string().min(1),
      },
    },
    async (input) => {
      try {
        const saved = addUserPattern(input);
        return textResult(
          `Added user pattern \`${saved.id}\`.\nregex: ${saved.regex}\nreason: ${saved.reason}`,
        );
      } catch (e) {
        if (e instanceof PatternValidationError) {
          return textResult(`Rejected: ${e.message}`, true);
        }
        throw e;
      }
    },
  );

  server.registerTool(
    "update_user_pattern",
    {
      title: "Update user danger pattern",
      description:
        "Modify regex or reason of an existing user pattern. Call when the user asks to edit/change/수정 a pattern by id — e.g. 'no-sudo 패턴 reason 바꿔줘', 'regex 수정해줘'. System patterns cannot be modified; attempts are rejected. Pass only the fields you want to change.",
      inputSchema: {
        id: z.string().min(1),
        regex: z.string().min(1).optional(),
        reason: z.string().min(1).optional(),
      },
    },
    async ({ id, regex, reason }) => {
      if (regex === undefined && reason === undefined) {
        return textResult(
          "Rejected: provide at least one of `regex` or `reason` to update.",
          true,
        );
      }
      try {
        const saved = updateUserPattern(id, { regex, reason });
        return textResult(
          `Updated user pattern \`${saved.id}\`.\nregex: ${saved.regex}\nreason: ${saved.reason}`,
        );
      } catch (e) {
        if (e instanceof PatternValidationError) {
          return textResult(`Rejected: ${e.message}`, true);
        }
        throw e;
      }
    },
  );

  server.registerTool(
    "remove_user_pattern",
    {
      title: "Remove user danger pattern",
      description:
        "Delete an existing user pattern by id. Call when the user asks to remove/삭제/제거/취소 a pattern — e.g. 'no-sudo 패턴 삭제해줘', '내가 추가한 거 빼줘'. System patterns cannot be removed; attempts are rejected.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      try {
        removeUserPattern(id);
        return textResult(`Removed user pattern \`${id}\`.`);
      } catch (e) {
        if (e instanceof PatternValidationError) {
          return textResult(`Rejected: ${e.message}`, true);
        }
        throw e;
      }
    },
  );

  server.registerTool(
    "create_stepup_session",
    {
      title: "Create Step-up MFA Session",
      description:
        "Open a Transcodes step-up MFA session. Returns sid and the browser URL " +
        "the user must visit to complete WebAuthn. The same flow is used by the " +
        "PreToolUse hook when a danger command is detected.",
      inputSchema: {
        comment: z
          .string()
          .min(1)
          .describe(
            "One short sentence shown on the step-up screen explaining the reason.",
          ),
        action: z
          .string()
          .optional()
          .describe("Action identifier for the audit log."),
        resource: z
          .string()
          .optional()
          .describe("Protected resource identifier for the audit log."),
        member_id: z
          .string()
          .optional()
          .describe(
            "Member public id to authenticate. Defaults to the mid claim in TRANSCODES_TOKEN.",
          ),
      },
    },
    async ({ comment, action, resource, member_id }) => {
      const config = loadStepupConfig();
      const result = await createStepupSession(config, {
        comment,
        action,
        resource,
        member_id,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: result.envelope.ok,
                status: result.envelope.status,
                sid: result.sid,
                browser_url: result.browserUrl,
                expires_at: result.expiresAt,
                raw: result.envelope.data,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "poll_stepup_session",
    {
      title: "Poll Step-up MFA Session",
      description:
        "Single GET against the step-up backend. Returns status 'pending' or " +
        "'verified'. On verified the result is cached cross-platform so a " +
        "subsequent danger command in the hook can pass without re-prompting. " +
        "Prefer `poll_stepup_session_wait` for the deny-recovery loop — it " +
        "blocks until verified in one call instead of requiring 60 manual " +
        "iterations.",
      inputSchema: {
        sid: z
          .string()
          .min(1)
          .describe("Session id returned from create_stepup_session."),
      },
    },
    async ({ sid }) => {
      const config = loadStepupConfig();
      const result = await pollStepupSession(config, sid);
      if (result.status === "verified") {
        writeVerified({ sid, verifiedAt: Date.now() });
        markVerified(sid);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: result.envelope.ok,
                status: result.envelope.status,
                step_status: result.status,
                raw: result.envelope.data,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "poll_stepup_session_wait",
    {
      title: "Wait for Step-up MFA Session",
      description:
        "Block until the step-up session reaches `verified` or the wait window " +
        "elapses (default 60s, polling every 1s). Use this — NOT the single-shot " +
        "`poll_stepup_session` — as the next action after a PreToolUse deny " +
        "carrying a step-up sid. One call replaces the 60-iteration polling " +
        "loop. On `outcome: \"verified\"` retry the original Bash command; on " +
        "`outcome: \"timeout\"` ask the user to complete WebAuthn and call this " +
        "tool again. Do NOT ask the user to confirm completion before calling " +
        "this tool — it waits on the user's behalf.",
      inputSchema: {
        sid: z
          .string()
          .min(1)
          .describe("Session id returned from create_stepup_session."),
        max_wait_ms: z
          .number()
          .int()
          .positive()
          .max(300_000)
          .optional()
          .describe("Maximum time to wait in ms. Defaults to 60_000."),
        interval_ms: z
          .number()
          .int()
          .positive()
          .max(10_000)
          .optional()
          .describe("Polling interval in ms. Defaults to 1_000."),
      },
    },
    async ({ sid, max_wait_ms, interval_ms }) => {
      const config = loadStepupConfig();
      const result = await pollStepupSessionWait(config, sid, {
        maxWaitMs: max_wait_ms,
        intervalMs: interval_ms,
      });
      if (result.outcome === "verified") {
        writeVerified({ sid, verifiedAt: Date.now() });
        markVerified(sid);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: result.envelope.ok,
                outcome: result.outcome,
                attempts: result.attempts,
                elapsed_ms: result.elapsedMs,
                raw: result.envelope.data,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Echoes the given message back to the caller.",
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: `Echo: ${message}` }],
    }),
  );

  server.registerPrompt(
    "greeting",
    {
      title: "Greeting",
      description: "Generate a greeting addressed to the given name.",
      argsSchema: { name: z.string() },
    },
    ({ name }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Hello ${name}!` },
        },
      ],
    }),
  );

  return server;
}
