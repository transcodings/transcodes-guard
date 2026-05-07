# ai-action-tracker-mcp

Model Context Protocol(MCP) 서버 스캐폴드. 단일 `createServer()` 정의를 stdio(로컬)와 Streamable HTTP `/mcp`(원격) 두 전송으로 노출.

## Essential Commands

```bash
npm install
npm run dev:stdio   # tsx, stdio transport (로컬 클라이언트용)
npm run dev:http    # tsx, port 3000 /mcp (원격 테스트)
npm run build       # tsc → dist/
npm run inspect     # MCP Inspector UI로 도구·리소스 직접 호출
```

No lint, test, or CI scripts yet — `tsc`(빌드 통과)가 사실상 유일한 정합성 체크.

## Layout

```
src/
  server.ts   # createServer() — 모든 capability(tool/resource/prompt)의 단일 정의처
  stdio.ts    # 로컬 진입점. 셰뱅 + npx 배포 가능.
  http.ts     # 원격 진입점. 단일 /mcp, stateless.
docs/
  architecture.md         # 설계 의도. 비자명한 변경 전 필독.
  adding-capabilities.md  # 새 도구/리소스/프롬프트 추가 절차.
  research/               # 외부 리서치 자료 보관.
.claude/rules/
  mcp-server.md           # src/**/*.ts 작업 시 자동 로딩되는 룰.
```

## Must

- Add capabilities **only** by editing `createServer()` in `src/server.ts`. Never duplicate registrations in `stdio.ts` or `http.ts`.
- Validate every tool input with `zod`. LLM-supplied arguments are untrusted by default.
- Log via `console.error` (stderr). `console.log` to stdout corrupts JSON-RPC framing in stdio mode and the client will silently disconnect.
- Run `npm run build` before claiming work complete. No tests exist; `tsc` is the contract.
- After capability changes, verify with `npm run inspect` — the Inspector renders new tools immediately.

## Never

- Use the deprecated positional `server.tool(name, desc, schema, cb)` API. Use `server.registerTool(name, { title, description, inputSchema }, cb)` (and the matching `register*` variants for resource and prompt).
- Use the deprecated SSE transport (`/sse` + `/messages`). Streamable HTTP `/mcp` is the only modern target.
- Deploy `http.ts` to a non-loopback host without authentication. The current scaffold has none — see `docs/architecture.md` (Authentication 섹션) before any production exposure.
- Mutate state inside a Resource handler. Resources are read-only context; side effects belong in Tools.

## See Also

- 설계 의도 (왜 transport 분리, 왜 Streamable HTTP, 인증 미비점) → [`docs/architecture.md`](./docs/architecture.md)
- 능력 추가 step-by-step → [`docs/adding-capabilities.md`](./docs/adding-capabilities.md)
- 배포 플랫폼 비교 리서치 → [`docs/research/mcp-server-creation-and-deployment.md`](./docs/research/mcp-server-creation-and-deployment.md)
- 외부 사용자용 문서 → [`README.md`](./README.md)
- 공식 MCP 빌드 가이드 → <https://modelcontextprotocol.io/docs/develop/build-server>
