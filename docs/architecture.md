# 아키텍처

이 문서는 코드를 읽기 전에 알아두면 좋은 **설계 의도**를 정리한다. 비자명한 변경(transport 추가, 인증 도입, stateful 세션 등)을 시작하기 전에 한 번 읽어보길 권한다.

## 1. transport-agnostic 분리

```
       src/server.ts
     createServer() → McpServer
              │
       ┌──────┴───────┐
       ↓              ↓
  src/stdio.ts   src/http.ts
  (로컬 진입)     (원격 진입)
```

`server.ts`는 **transport를 모른다.** 도구·리소스·프롬프트만 정의하고 `McpServer` 인스턴스를 반환한다. `stdio.ts`와 `http.ts`는 각자 적합한 `*Transport`를 만들고 `server.connect(transport)` 한 줄로 연결한다.

이 분리의 효과:

- **변경 영역 축소**: 새 capability 추가 → `server.ts` 한 파일만 수정. 진입점은 안 건드린다.
- **양쪽 동시 노출**: 같은 도구를 로컬 데스크탑과 원격 SaaS에서 동시에 제공 가능.
- **테스트 용이성**: 진짜 transport 없이 `createServer()`만 호출해서 단위 검증 가능 (테스트는 아직 없지만 추가 시 이점이 살아난다).

만약 진입점에 capability를 등록하면 위 이점이 깨진다. **새 도구는 무조건 `server.ts`로**.

## 2. Streamable HTTP를 쓰는 이유

MCP 사양 **2025-03-26**에서 도입된 새 전송. 직전 사양(2024-11-05)의 SSE 기반 dual-endpoint(`/sse` 스트림 + `/messages` POST)는 **deprecated** 상태다.

| 차원 | SSE (구) | Streamable HTTP (신) |
|------|---------|---------------------|
| 엔드포인트 | 두 개 (`/sse`, `/messages`) | 단일 (`/mcp`) |
| 세션 | 단일 SSE 연결 필요 | stateless 가능 |
| 수평 확장 | 세션 어피니티 필요 | 어피니티 없이 가능 |
| 클라이언트 호환 | 구식 클라이언트 전용 | Claude 2026, Cursor 등 신규 |
| spec 상태 | deprecated (호환 유지) | current |

신규 클라이언트는 Streamable HTTP를 우선한다. 구 SSE 클라이언트만 지원하는 요구가 들어오면 **둘 다** 노출하는 방향으로 (대체가 아니라 병행).

## 3. Capability 분류

MCP는 모델 ↔ 서버 인터페이스를 세 종류로 나눈다. 잘못 분류하면 클라이언트 UX가 망가진다.

| 종류 | 의미 | 호출 주체 | 부수효과 | 예시 |
|------|------|---------|---------|------|
| **Tool** | 모델이 행동을 취함 | 모델 자율 | 허용 | API 호출, 계산, 기록 |
| **Resource** | 모델이 컨텍스트를 읽음 | 모델/유저 읽기 요청 | **금지** | 파일 내용, 상태 조회, 정적 데이터 |
| **Prompt** | 재사용 가능 템플릿 | **유저 명시 호출** | 허용 | 슬래시 명령, 정형 프롬프트 |

자주 헷갈리는 케이스:

- "오늘 등록된 액션 목록" → 읽기만 하면 Resource. 등록 기능을 같이 두려면 별개의 Tool로 분리.
- "데일리 요약 생성 명령" → 유저가 슬래시 명령처럼 부르고 싶다면 Prompt. 모델이 자율 판단해 부르길 원하면 Tool.
- "DB에서 데이터 가져오기" → 부수효과 없으면 Resource. 캐시 갱신·로깅이 동반되면 Tool.

## 4. 인증 — 현재 부재

`src/http.ts`에는 인증 로직이 없다. **로컬 개발에는 OK, 비-루프백 배포에는 절대 안 된다.**

배포 전 최소한 다음 중 하나를 추가:

| 방식 | 구현 부담 | 비고 |
|------|---------|------|
| Bearer 토큰 | 낮음 (10줄) | 단일 토큰 환경 변수, 모든 `/mcp` 요청 헤더 검증 |
| OAuth 2.1 | 높음 (라이브러리 필요) | MCP 2026 spec 권장. Cloudflare Workers `McpAgent`는 자동 |
| API Key per client | 중간 | DB/KV 스토어 필요 |

추가 보안 권장:

- **DNS rebinding 방지**: `Host` 헤더 allowlist 검증.
- **CORS**: 브라우저 클라이언트 지원 시만. 그 외는 닫아둔다.
- **rate limiting**: LLM이 무한 루프에 빠질 가능성 — 클라이언트별 제한.

## 5. 자기검증 사이클

새 capability를 추가하면 다음 순서로 검증:

1. `npm run build` — 타입 정합성.
2. `npm run inspect` — 도구·리소스·프롬프트가 Inspector UI에 보이는지, 실제 호출이 통하는지.
3. (선택) 실제 클라이언트 등록(Claude Desktop·Code) 후 자연어로 호출 시도 — `description`의 LLM 친화도 확인.

테스트 프레임워크가 없는 현 단계에서는 이 3단계가 최선.

## 참고 자료

- MCP 사양 2025-03-26: <https://modelcontextprotocol.io/specification/2025-03-26>
- 공식 빌드 가이드: <https://modelcontextprotocol.io/docs/develop/build-server>
- 사내 리서치: [`research/mcp-server-creation-and-deployment.md`](./research/mcp-server-creation-and-deployment.md) — 8개 외부 자료 종합 + 7개 배포 플랫폼 비교
