---
paths:
  - "plugins/ai-action-tracker/src/**/*.ts"
---

# MCP Server Source Rules

Active when editing `plugins/ai-action-tracker/src/**/*.ts`. Pair with the project-wide `CLAUDE.md`.

## Capability Authoring

All capabilities live in `createServer()` in `plugins/ai-action-tracker/src/server.ts`. Use the modern `register*` APIs — the positional-argument forms (`server.tool(name, desc, schema, cb)`) are deprecated in SDK v1 and will be removed.

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

`plugins/ai-action-tracker/src/stdio.ts` and `plugins/ai-action-tracker/src/http.ts` should only:

1. Import `createServer()`.
2. Construct a transport instance.
3. Call `server.connect(transport)`.
4. Handle process lifecycle (errors, signals).

If a feature requires editing both transport files, the feature probably belongs in `server.ts` instead.

## HTTP Transport Specifics (`plugins/ai-action-tracker/src/http.ts`)

- Endpoint is `/mcp` only. POST and GET both routed to the same transport handler.
- Stateless mode (`sessionIdGenerator: undefined`) is the default. Opt into stateful sessions only when a feature genuinely requires multi-step state.
- Create a fresh `McpServer` + transport per request when stateless. Reusing a single connected server across requests can leak state across clients.
- Authentication is currently absent. Auth code is welcome here — but the auth check itself must fail-closed (reject by default).

## SDK Version Migrations

When `plugins/ai-action-tracker/package.json` updates `@modelcontextprotocol/sdk`:

1. Run `npm run build:plugin` and read every TypeScript warning, including deprecation notices.
2. Run `npm run inspect` and exercise each registered capability — SDK changes sometimes alter wire formats silently.
3. Bump the plugin's `version` in both `plugins/ai-action-tracker/package.json` and the `McpServer({ version })` call in `plugins/ai-action-tracker/src/server.ts`.

## Self-verification Before "Done"

- `npm run build:plugin` passes (no errors, no new deprecation warnings introduced) **and** `plugins/ai-action-tracker/dist/` is committed in the same change. CI (`git diff --exit-code -- plugins/ai-action-tracker/dist/`) fails if source and dist drift apart.
- New or changed capabilities visible and callable in `npm run inspect`.
- No `console.log` introduced anywhere reachable from the stdio entry point.
- Tool `description` strings answer "what does this do" and "when should the model call it" in one or two sentences.
