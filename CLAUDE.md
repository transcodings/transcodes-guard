# ai-action-tracker-mcp — Claude 컨텍스트

이 저장소는 **MCP(Model Context Protocol) 서버 hello-world 스캐폴드**입니다. Claude Desktop, Claude Code, Cursor 등 MCP 호환 클라이언트가 사용할 도구·리소스·프롬프트를 노출합니다.

## 아키텍처

핵심 패턴: **transport와 server 정의를 분리.**

```
src/
  server.ts   # McpServer 인스턴스 — Tool/Resource/Prompt 정의만 보유. transport 무관.
  stdio.ts    # 로컬 진입점. StdioServerTransport로 server.ts를 spawn.
  http.ts     # 원격 진입점. StreamableHTTPServerTransport (단일 /mcp 엔드포인트).
```

`server.ts`의 `createServer()` 팩토리만 수정하면 stdio·HTTP 양쪽에 동시 반영됩니다.

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/server.ts` | 도구/리소스/프롬프트 추가는 여기서 |
| `src/stdio.ts` | 변경 거의 없음. 로깅 추가 시 `console.error`만 |
| `src/http.ts` | 인증, CORS, 헬스체크는 여기서 추가 |
| `package.json` | `bin` 필드가 npx 배포의 핵심 |
| `tsconfig.json` | `module: NodeNext` 필수 (SDK ESM 임포트 호환) |
| `docs/research/mcp-server-creation-and-deployment.md` | 배경 리서치 — SDK API, 배포 플랫폼 비교 |

## 자주 쓰는 명령

```bash
npm install                # 의존성 설치
npm run dev:stdio          # tsx로 stdio 서버 실행 (개발)
npm run dev:http           # tsx로 HTTP 서버 실행 (개발)
npm run build              # TypeScript 컴파일 → dist/
npm run start:stdio        # dist/stdio.js 실행
npm run start:http         # dist/http.js 실행
npm run inspect            # MCP Inspector로 디버깅
```

## 작업 시 반드시 지켜야 할 것

### 1. stdio 모드에서 stdout 오염 금지

`console.log`, `print`, `process.stdout.write` 같이 stdout으로 어떤 텍스트라도 내보내면 JSON-RPC 프레임이 깨져 클라이언트가 연결을 끊습니다. **모든 로깅은 `console.error`(stderr)로**.

### 2. Tool 입력은 항상 zod로 검증

LLM은 잘못된 인자(타입 오류, 누락된 필드)를 보낼 수 있습니다. `z.string()`, `z.number()`, `z.enum([...])` 등으로 스키마를 명시해야 SDK가 자동 검증·에러 응답을 처리합니다.

### 3. Resource vs Tool vs Prompt 구분

| 종류 | 언제 쓰는가 |
|------|-----------|
| Tool | 모델이 **행동(action)**을 취할 때 — API 호출, 계산, 파일 쓰기 |
| Resource | 모델이 **컨텍스트(data)**를 읽을 때 — 파일 내용, DB 쿼리 결과 |
| Prompt | 유저가 명시적으로 호출하는 **재사용 가능한 템플릿** — 슬래시 명령 같은 것 |

새 능력을 추가할 때 이 분류를 먼저 정한 뒤 구현하세요.

### 4. 원격 배포 전 인증 추가 필수

현재 `http.ts`는 인증 없음. 프로덕션에 띄우려면 최소한:
- Bearer 토큰 검증 (간단)
- OAuth 2.1 (MCP 2026 spec 권장)
- DNS rebinding 방지 (`allowedHosts` 검증)
- CORS 헤더 (브라우저 클라이언트 지원 시)

## 전송 방식 결정 가이드

- **로컬 데스크톱 클라이언트(Claude Desktop, Cursor)** → `stdio`
- **원격 서버, 멀티 사용자, 웹 클라이언트** → `Streamable HTTP` (`/mcp` 단일 엔드포인트)
- **구식 SSE(`/sse` + `/messages`)는 deprecated** — 신규 코드에 쓰지 말 것 (MCP spec 2025-03-26)

## 코드 변경 시 자기검증 체크

1. `npm run build` 통과 — TypeScript 에러 없음
2. `npm run inspect`로 새/변경 도구가 Inspector UI에 보이는지 확인
3. stdio 모드라면 `console.log` 사용 안 했는지 검사
4. zod 스키마가 새 도구의 모든 인자를 커버하는지 확인

## 참고

- 공식 문서: <https://modelcontextprotocol.io/docs/develop/build-server>
- MCP Spec 2025-03-26 (Streamable HTTP): <https://modelcontextprotocol.io/specification/2025-03-26>
- 사내 리서치: [`docs/research/mcp-server-creation-and-deployment.md`](./docs/research/mcp-server-creation-and-deployment.md)
