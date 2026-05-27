---
paths:
  - "packages/mcp-server-core/src/**/*.ts"
  - "plugins/*/src/**/*.ts"
---

# MCP Server Source Rules

Active when editing `packages/mcp-server-core/src/**/*.ts` (the shared MCP server) or `plugins/*/src/**/*.ts` (the transport entry points each plugin owns). Pair with the project-wide `CLAUDE.md`.

## Capability Authoring

All capabilities live in `createServer()` in `packages/mcp-server-core/src/server.ts`. Use the modern `register*` APIs — the positional-argument forms (`server.tool(name, desc, schema, cb)`) are deprecated in SDK v1 and will be removed.

```ts
// Tool — model-invoked side effect
server.registerTool(
  "name",
  {
    title: "Human-friendly title",
    description: "Concise. The LLM reads this to decide when to call.",
    inputSchema: { /* zod validators per arg */ },
  },
  async (args) => ({ content: [{ type: "text", text: "..." }] }),
);

// Resource — read-only context
server.registerResource(
  "name",
  "scheme://path",
  { title: "...", description: "...", mimeType: "text/plain" },
  async (uri) => ({ contents: [{ uri: uri.href, text: "..." }] }),
);

// Prompt — user-invoked template
server.registerPrompt(
  "name",
  { title: "...", description: "...", argsSchema: { /* zod */ } },
  (args) => ({ messages: [/* ... */] }),
);
```

## Capability Type Decision

| Need | Use |
|------|-----|
| Model causes a side effect (API call, write, compute) | **Tool** |
| Model reads context data (file, query result, status) | **Resource** |
| User invokes a structured template (slash-command-like) | **Prompt** |

Misclassifying breaks client UX. Resources must never mutate state — even logging counters or refreshing caches belongs in a Tool wrapper.

## Logging Discipline (stdio mode)

The stdio transport uses stdin/stdout for JSON-RPC. Anything written to stdout that is not a JSON-RPC frame breaks the client and it disconnects silently.

- Use `console.error(...)` for human-readable logs (stderr is safe).
- For structured logs, emit one JSON object per line on stderr: `console.error(JSON.stringify({ level: "info", msg: "..." }))`.
- Never use `console.log`, `console.info`, `console.debug`, or `process.stdout.write` from any code path that may run under stdio.

## Transport Files Are Thin

Each plugin owns its own `src/stdio.ts` (and the Claude Code plugin additionally owns `src/http.ts`). They should only:

1. Import `createServer` from `@ai-action-tracker/mcp-server-core`.
2. Construct a transport instance.
3. Call `server.connect(transport)`.
4. Handle process lifecycle (errors, signals).

If a feature requires editing both transport files, the feature probably belongs in `packages/mcp-server-core/src/server.ts` instead. Both plugins must remain interchangeable at the gate-logic level.

## HTTP Transport Specifics (`plugins/claude-code-ai-action-tracker/src/http.ts`)

- Endpoint is `/mcp` only. POST and GET both routed to the same transport handler.
- Stateless mode (`sessionIdGenerator: undefined`) is the default. Opt into stateful sessions only when a feature genuinely requires multi-step state.
- Create a fresh `McpServer` + transport per request when stateless. Reusing a single connected server across requests can leak state across clients.
- Authentication is currently absent. Auth code is welcome here — but the auth check itself must fail-closed (reject by default).
- The Codex plugin intentionally does **not** ship an HTTP transport — Codex's MCP integration is stdio-only. If Codex grows HTTP support, mirror the file rather than moving it into the package.

## SDK Version Migrations

When `packages/mcp-server-core/package.json` updates `@modelcontextprotocol/sdk`:

1. Run `npm run build:plugin` and read every TypeScript warning, including deprecation notices.
2. Run `npm run inspect` and exercise each registered capability — SDK changes sometimes alter wire formats silently.
3. Bump the package's `version` in `packages/mcp-server-core/package.json` and the `McpServer({ version })` call in `packages/mcp-server-core/src/server.ts`. The plugin manifests (`plugins/*/.claude-plugin/plugin.json` and `plugins/*/plugin.json`) carry their own `version` for the marketplace and need to be bumped separately when their published surface changes.

## Hook Subprocess Path Resolution

`simulate_hook_invocation` spawns the actual hook binary. It resolves the path from environment variables:

```ts
const pluginRoot =
  process.env.CLAUDE_PLUGIN_ROOT?.trim() ||
  process.env.PLUGIN_ROOT?.trim();
if (!pluginRoot) {
  return textResult("Rejected: CLAUDE_PLUGIN_ROOT (or PLUGIN_ROOT for Codex) must be set …", true);
}
```

- Claude Code sets `CLAUDE_PLUGIN_ROOT` automatically when the plugin runs.
- Codex sets `PLUGIN_ROOT` and accepts `CLAUDE_PLUGIN_ROOT` as an alias.
- Dev mode (no env): the tool returns a clear rejection rather than silently resolving to a wrong directory. Set the env var explicitly when running `npm run dev:stdio` and exercising `simulate_hook_invocation`.

## Self-verification Before "Done"

- `npm run build:plugin` passes (no errors, no new deprecation warnings introduced) **and** all four dist locations are committed in the same change: `packages/*/dist/`, `plugins/claude-code-ai-action-tracker/dist/`, `plugins/codex-ai-action-tracker/dist/`, `plugins/antigravity-ai-action-tracker/dist/`. CI (`git diff --exit-code`) fails on any drift.
- New or changed capabilities visible and callable in `npm run inspect`.
- No `console.log` introduced anywhere reachable from the stdio entry point.
- Tool `description` strings answer "what does this do" and "when should the model call it" in one or two sentences.
