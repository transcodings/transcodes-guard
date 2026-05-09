# ai-action-tracker-mcp

Model Context Protocol(MCP) 서버 스캐폴드. 단일 `createServer()` 정의를 stdio(로컬)와 Streamable HTTP `/mcp`(원격) 두 전송으로 노출.

## Essential Commands

```bash
npm install
npm run dev:stdio   # tsx, stdio transport (로컬 클라이언트용)
npm run dev:http    # tsx, port 3000 /mcp (원격 테스트)
npm run dev:hook    # tsx, PreToolUse hook (stdin JSON으로 단발 실행)
npm run build       # tsc → dist/
npm run inspect     # MCP Inspector UI로 도구·리소스 직접 호출
```

No lint, test, or CI scripts yet — `tsc`(빌드 통과)가 사실상 유일한 정합성 체크.

## Layout

```
src/                       # MCP 서버 소스 — 단일 진실원천
  server.ts                #   createServer() — 모든 capability의 단일 정의처
  stdio.ts                 #   로컬 진입점. 셰뱅 + npx 배포 가능.
  http.ts                  #   원격 진입점. 단일 /mcp, stateless.
hooks/                     # PreToolUse hook 소스 — 단일 진실원천
  pre-tool-use.ts          #   위험 Bash 명령 차단 진입점.
  danger-patterns.json     #   차단 정규식 목록. 런타임 read이므로 재빌드 불필요.
.claude-plugin/
  marketplace.json         # Marketplace 카탈로그 (이 리포가 곧 marketplace).
plugins/
  ai-action-tracker/       # 배포 단위 plugin 패키지 — 빌드 산출물 + 매니페스트만
    .claude-plugin/plugin.json
    .mcp.json              #   MCP 서버 등록 (${CLAUDE_PLUGIN_ROOT})
    hooks/hooks.json       #   PreToolUse 매니페스트
    dist/                  #   build:plugin 산출물 (수동 편집 금지)
docs/
  architecture.md          #   설계 의도. 비자명한 변경 전 필독.
  adding-capabilities.md   #   새 도구/리소스/프롬프트 추가 절차.
  hook-installation.md     #   plugin 미사용 시 수동 hook 등록 절차.
  research/                #   외부 리서치 자료 (plugin 변환 전략 포함).
.claude/rules/
  mcp-server.md            #   src/**/*.ts 작업 시 자동 로딩되는 룰.
```

**구조 정책 (2026-05-09 — 정리안 3):** 코드는 루트 `src/`, `hooks/`가 단일 진실원천. `plugins/ai-action-tracker/` 트리는 `npm run build:plugin`이 동기화하는 **빌드 산출물 + 매니페스트만** 보유 — 수동 편집 금지. 향후 정리안 2(모노리포 정렬)로 source를 plugin 폴더 안으로 이동할 계획 있음.

## Must

- Add capabilities **only** by editing `createServer()` in `src/server.ts`. Never duplicate registrations in `stdio.ts` or `http.ts`.
- Validate every tool input with `zod`. LLM-supplied arguments are untrusted by default.
- Log via `console.error` (stderr). `console.log` to stdout corrupts JSON-RPC framing in stdio mode and the client will silently disconnect.
- Run `npm run build` before claiming work complete. No tests exist; `tsc` is the contract.
- After capability changes, verify with `npm run inspect` — the Inspector renders new tools immediately.
- The PreToolUse hook (`hooks/pre-tool-use.ts`) must **fail-open** on internal errors (exit 0). A buggy hook should never brick the user's workflow. This is the opposite of the HTTP auth rule and intentional — see `docs/hook-installation.md`.
- Hook output: stderr only, never stdout. Exit codes: `0` allow, `2` block (fed back to Claude). Exit `1` does NOT block — never use it for policy enforcement.
- Plugin 패키지 갱신 시 `npm run build:plugin`을 거쳐 `plugins/ai-action-tracker/dist/`를 동기화. plugin 트리 안의 `dist/` 또는 매니페스트 외 파일을 직접 편집하지 말 것 — 다음 빌드에서 덮어쓰여진다.

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
- Hook 설치 절차 → [`docs/hook-installation.md`](./docs/hook-installation.md)
- 공식 MCP 빌드 가이드 → <https://modelcontextprotocol.io/docs/develop/build-server>
- 공식 Claude Code hooks 문서 → <https://code.claude.com/docs/en/hooks>
