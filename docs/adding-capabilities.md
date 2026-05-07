# 능력(capability) 추가 절차

이 문서는 새 도구·리소스·프롬프트를 추가할 때 따라 하는 체크리스트다. 모든 작업은 **`src/server.ts` 안의 `createServer()`** 한 함수에서 끝난다.

## 공통 사전 준비

```bash
npm install         # 한 번만
npm run dev:stdio   # 별도 터미널에 띄워두면 코드 변경 즉시 반영(tsx)
```

또는 `npm run inspect`로 Inspector UI를 띄워두고 호출 검증.

## 새 도구(Tool) 추가

**언제**: 모델이 어떤 **행동**을 취하길 원할 때 — 외부 API 호출, 계산, DB 쓰기 등.

```ts
import { z } from "zod";

server.registerTool(
  "record-action",                          // 1. 도구 ID. 영소문자-하이픈 권장.
  {
    title: "Record Action",                 // 2. UI에 노출되는 이름.
    description:                            // 3. LLM이 읽는 설명. 호출 판단의 근거.
      "Records an AI agent action with timestamp and metadata.",
    inputSchema: {                          // 4. 인자 zod 스키마.
      action: z.string().min(1),
      timestamp: z.string().datetime().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async ({ action, timestamp, metadata }) => {
    // 5. 본 로직.
    const result = await doWork({ action, timestamp, metadata });
    return {
      content: [{ type: "text", text: `Recorded: ${result.id}` }],
    };
  },
);
```

핵심 함정:

- **description이 짧고 정확해야 LLM이 올바르게 부른다.** "Records an action" 같은 모호한 한 줄은 비슷한 도구가 여러 개일 때 잘못 선택된다. *무엇을, 어떤 입력으로, 어떤 결과인지* 명시.
- **inputSchema는 모든 인자를 zod로.** 누락된 키는 SDK가 거부하지 못한다.
- **반환은 `content` 배열.** 단일 결과여도 배열에 담는다.

## 새 리소스(Resource) 추가

**언제**: 모델이 **컨텍스트를 읽기만** 할 때 — 파일 내용, 쿼리 결과, 정적 데이터.

```ts
server.registerResource(
  "recent-actions",
  "tracker://actions/recent",   // URI 스키마. 의미 있는 네임스페이스 선택.
  {
    title: "Recent Actions",
    description: "Last 50 recorded actions, newest first.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify(await fetchRecent(50)),
    }],
  }),
);
```

핵심 규칙: **부수효과 금지.** 호출 카운트 증가, 캐시 갱신, 로깅(메트릭) 모두 도구로 빼라. 리소스는 멱등 읽기여야 한다.

## 새 프롬프트(Prompt) 추가

**언제**: 유저가 **명시적으로** 부를 재사용 가능한 템플릿 — 슬래시 명령처럼.

```ts
server.registerPrompt(
  "daily-summary",
  {
    title: "Daily Action Summary",
    description: "Generate a summary of today's recorded actions.",
    argsSchema: { date: z.string().optional() },
  },
  ({ date }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Summarize all actions recorded on ${date ?? "today"} grouped by hour.`,
      },
    }],
  }),
);
```

프롬프트는 LLM이 자율 호출하지 않는다. 클라이언트 UI에서 유저가 선택해야 동작.

## 검증

추가 후 다음 순서로:

1. **빌드**: `npm run build`. 타입 에러 없으면 통과.
2. **Inspector**: `npm run inspect` → 새 항목이 목록에 보이는지, 실제 호출이 의도대로 응답하는지.
3. **(선택) 실제 클라이언트**: Claude Desktop / Code에 등록해 자연어로 호출 — description이 LLM 호출 판단에 충분한지 확인.

문제가 보이면 description부터 더 구체적으로 다듬어라. 모델 호출 정확도는 거의 description의 품질에 달려 있다.

## 다음 단계 (capability가 늘어나면)

여러 도구가 쌓이면 `src/server.ts`가 비대해진다. 그 시점에 분리 고려:

- 도구별 파일 분리: `src/tools/recordAction.ts`로 빼고 `server.ts`는 등록만 담당.
- `src/tools/index.ts`에서 일괄 등록 헬퍼.

지금은 hello-world 단계라 분리 불필요 — 도구가 5개 이상 쌓일 때 다시 검토.
