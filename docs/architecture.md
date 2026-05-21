# 아키텍처

이 문서는 코드를 읽기 전에 알아두면 좋은 **설계 의도**를 정리한다. 비자명한 변경(transport 추가, 인증 도입, stateful 세션 등)을 시작하기 전에 한 번 읽어보길 권한다.

## 1. transport-agnostic 분리

```
       plugins/ai-action-tracker/src/server.ts
     createServer() → McpServer
              │
       ┌──────┴───────┐
       ↓              ↓
  src/stdio.ts   src/http.ts
  (로컬 진입)     (원격 진입)
```

`plugins/ai-action-tracker/src/server.ts`는 **transport를 모른다.** 도구·리소스·프롬프트만 정의하고 `McpServer` 인스턴스를 반환한다. `stdio.ts`와 `http.ts`는 각자 적합한 `*Transport`를 만들고 `server.connect(transport)` 한 줄로 연결한다.

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

`plugins/ai-action-tracker/src/http.ts`에는 인증 로직이 없다. **로컬 개발에는 OK, 비-루프백 배포에는 절대 안 된다.**

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

## 5. Step-up MFA & Hook Orchestra

위험한 Bash 명령은 단일 `PreToolUse` hook으로 차단만 하면 부족하다. 차단 직후 사용자가 인증을 끝낼 때까지 AI는 외부 상황을 못 보고, hook이 끝나는 순간 "왜 차단됐는지 / 다음에 뭘 해야 하는지"를 자연어 stderr 한 줄로만 받게 된다. 이 분기에서 AI가 폴링·재시도 프로토콜을 잊거나 명령이 무단 실행됐다고 오해할 여지가 생긴다.

해결: 4개 hook을 묶고, 그 사이를 **단일 공유 상태 파일**로 동기화한다.

```
        ┌─────────────────────────────────────────┐
        │  ~/.cache/.../stepup-pending.json       │  ← 단일 진실원천
        │  { sid, command, status, browserUrl, … }│
        └────────▲──────────────▲────────▲────────┘
                 │ write/read   │ read   │ read
                 │              │        │
        ┌────────┴───┐   ┌──────┴────┐  ┌┴────────┐   ┌────────────┐
        │ PreToolUse │   │UserPrompt-│  │  Stop   │   │SessionStart│
        │ (Bash)     │   │  Submit   │  │         │   │            │
        └────────────┘   └───────────┘  └─────────┘   └────────────┘
        permission       additional     decision +    additional
        Decision +       Context        reason        Context
        systemMessage                   (block)       (primer)
```

| Hook | 트리거 | 채널 | 역할 |
|------|-------|-----|------|
| `PreToolUse` (Bash + matched MCP) | 매 Bash 호출 + `tool-rules.json` 매칭 MCP 도구 호출 | stdout JSON `hookSpecificOutput.permissionDecision: "deny" \| "allow"` + `systemMessage` | 위험 패턴/룰 매치 시 step-up 세션 생성, pending 파일 write, **호출 차단**. 신속 경로(verified 존재) 시 **명시적 `"allow"` JSON emit** — exit 0만으로는 settings.json deny 규칙·내장 safety를 override 못 함. fast-path consume은 룰의 `consume_in_hook` 플래그로 분기: **Bash** + **MCP user 룰**(`consume_in_hook=true`, 기본)은 hook이 직접 정리, **MCP system 룰**(`consume_in_hook=false`, 기본)은 도구 핸들러의 `withStepupVerifiedSid`가 verified sid를 `X-Step-Up-Session-Id` 헤더로 백엔드에 전달한 후 `finally`에서 정리. MCP 룰 매치 시 `block.command`에 `tool_input` JSON(200자 cap)을 결합해 후속 reminder/pending 파일에서 어떤 인자로 차단됐는지 표시. |
| `SessionStart` | 세션 시작·resume·clear·compact | `hookSpecificOutput.additionalContext` | 프로토콜 1회 사전 주입. 이월된 pending이 있으면 sid·URL 함께 노출. |
| `UserPromptSubmit` | 매 사용자 메시지 | `hookSpecificOutput.additionalContext` | 사용자 메시지에 "완료" 류 키워드 + pending 존재 → `poll_stepup_session_wait` 재개 신호. |
| `Stop` | AI 응답 종료 직전 | top-level `{ decision: "block", reason }` (Stop은 `hookSpecificOutput.hookEventName` enum에 없어 v2 wrapper 사용 시 validator reject) | dangling pending(status=`pending`) 시 reminder. orphan 상태(verified 잔존 + pending 부재/status=`verified`, 또는 verified 부재 + pending.status=`verified`)는 turn이 끝난 시점이므로 in-flight일 수 없다고 보고 조용히 reap — 거짓 reminder 방지 + system 룰의 deferred consume 실패 backstop. |

차단 신호는 의도적으로 `permissionDecision: "deny"` 1급 채널을 쓴다. `exit 2 + stderr` 텍스트도 가능하지만, 후자는 모델 입장에서 "tool 오류 출력" 흐름이라 hallucination/오해석 여지가 더 크다. v2 JSON은 spec에 정의된 모델 컨텍스트 채널이라 결정론이 더 높다. stderr는 사용자 가독용 1줄 요약(`STEPUP-PENDING sid=…`)만 유지.

상태 동기화는 두 파일로 분리되어 있다:

- `stepup-verified.json` — single-shot verified record. PreToolUse 신속 경로의 통과권. `consumeVerified()` 직후 삭제.
- `stepup-pending.json` — pending 세션 메타데이터. 보조 3개 hook의 컨텍스트 원천. PreToolUse 신속 경로 또는 `expiresAt` 초과 시 정리.

자세한 절차·검증은 `docs/prd/`(필요 시) 또는 `plugins/ai-action-tracker/src/stepup/` 코드 헤더 docstring 참조. 새 민감 기능은 이 orchestra를 소비하고, hook을 추가로 늘리지 않는 것을 권장.

### 알려진 제약: 동시 MCP 호출 race

`verified.json`은 단일 파일(`{sid, verifiedAt}`)이며 hook 프로세스 간 IPC 채널이 없다. system 룰(`consume_in_hook=false`)로 보호된 MCP 도구 두 개를 병렬 호출하면 두 hook 프로세스가 모두 `readVerified()`를 통과해 같은 sid로 백엔드에 도달할 수 있다. backstop은 **Transcodes 백엔드의 `X-Step-Up-Session-Id` 재사용 거부 정책**(replay protection)이다. client-side fix는 단일 파일 모델 + IPC 부재로 깔끔한 해법이 없어 의도적으로 미적용. 동일 sid로 다중 backend mutate가 회피 불가한 경우 해당 도구 룰을 `consume_in_hook=true`로 재등록해 hook-side에서 즉시 소비하도록 만들 수 있다(단 sid를 백엔드 헤더에 실을 수 없게 됨).

## 6. 자기검증 사이클

새 capability를 추가하면 다음 순서로 검증:

1. `npm run build` — 타입 정합성.
2. `npm run inspect` — 도구·리소스·프롬프트가 Inspector UI에 보이는지, 실제 호출이 통하는지.
3. (선택) 실제 클라이언트 등록(Claude Desktop·Code) 후 자연어로 호출 시도 — `description`의 LLM 친화도 확인.

테스트 프레임워크가 없는 현 단계에서는 이 3단계가 최선.

## 참고 자료

- MCP 사양 2025-03-26: <https://modelcontextprotocol.io/specification/2025-03-26>
- 공식 빌드 가이드: <https://modelcontextprotocol.io/docs/develop/build-server>
- 사내 리서치: [`research/mcp-server-creation-and-deployment.md`](./research/mcp-server-creation-and-deployment.md) — 8개 외부 자료 종합 + 7개 배포 플랫폼 비교
