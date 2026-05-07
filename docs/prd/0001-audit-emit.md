---
id: audit-emit
title: Audit Trail Emission (PostToolUse JSON-Lines)
status: draft
priority: P1
effort: M
value: high
category: PostToolUse hook, infrastructure
owner: unassigned
created: 2026-05-07
updated: 2026-05-07
version: 0.1
depends_on: []
related: [secrets-redact, file-change-delta, policy-yaml]
references:
  - docs/research/ai-security-mcp-competitive-landscape.md
  - https://code.claude.com/docs/en/hooks
tags: [audit, observability, post-tool-use, jsonl, siem]
---

# Audit Trail Emission (PostToolUse JSON-Lines)

## 컨텍스트 & 문제 정의

현재 `ai-action-tracker-mcp`의 hook은 PreToolUse 차단만 수행하며, 어떤 도구가 언제 어떻게 호출됐는지에 대한 *기록*은 남지 않는다. 차단 메시지는 stderr 일회성이고 후속 분석이 불가능하다.

리서치 ([ai-security-mcp-competitive-landscape](../research/ai-security-mcp-competitive-landscape.md)) 결과, Dashlane / MintMCP / Snyk / Integrate.io / MCP Manager 등 거의 모든 경쟁 제품이 감사 로깅을 baseline으로 제공한다. 이 기능 없이는 사후 분석·SIEM 연동·컴플라이언스 리포팅이 불가능하다.

PostToolUse hook 진입점 자체가 아직 없으므로 본 PRD는 **인프라(새 hook 진입점) + 첫 활용처(audit emit)** 를 함께 다룬다. 이후 PRD들(`secrets-redact`/`file-change-delta`/`policy-yaml`)은 이 채널을 공유한다.

## 목표 (Goals)

1. `hooks/post-tool-use.ts` PostToolUse hook 진입점 신설.
2. 모든 도구 호출에 대해 1줄 JSON-Lines 레코드를 표준 채널로 emit.
3. 출력 채널 선택 가능: stderr(기본) / 파일 / HTTP webhook — 환경변수로 결정.
4. fail-open 원칙 유지(PreToolUse hook과 동일): hook 자체 버그가 사용자 워크플로를 막지 않는다.
5. 후속 PRD가 추가 신호를 동일 채널로 emit할 수 있도록 스키마와 채널 인터페이스를 모듈화.

## 비목표 (Non-Goals)

- SIEM-specific 스키마 변환(Splunk CIM, ECS 등) — 다운스트림 컨슈머 책임.
- 로그 암호화·서명 — Phase 3 후보.
- 보존 정책·로테이션 — 운영자/SIEM 영역.
- 실시간 분석·이상 탐지 — 별도 PRD(`anomaly-baseline`).
- `tool_response`(도구 출력 결과) 본문 캡처 — V1.0에서는 메타데이터만, secrets 누출 위험.

## 사용 시나리오

- **운영자**: `tail -f` 또는 `jq`로 audit 로그를 즉석 검사 → 의심 동작 탐지.
- **컴플라이언스 담당자**: 일정 기간 audit 파일을 SIEM에 수집해 SOC2/ISO 감사 증거 확보.
- **개발자(디버깅)**: hook이 무엇을 차단했는지 / 왜 차단했는지를 사후 추적.

## 기능 요구사항

### FR-1. JSON-Lines 스키마

호출당 1줄, 줄바꿈 구분 JSON 객체:

```json
{
  "ts": "2026-05-07T14:21:08+09:00",
  "session_id": "abc-123",
  "tool_use_id": "toolu_01abc",
  "tool": "Bash",
  "args": { "command": "ls -la" },
  "outcome": "success",
  "duration_ms": 47,
  "blocked": false,
  "block_reason": null,
  "cwd": "/home/cyprien/Documents/transcodes/ai-action-tracker"
}
```

| 필드 | 타입 | 의미 |
|------|------|------|
| `ts` | RFC3339 | 호출 종료 시각 |
| `session_id` | string | Claude Code 세션 ID(payload에서 그대로) |
| `tool_use_id` | string | 호출 ID(payload에서 그대로) |
| `tool` | string | 도구 이름 |
| `args` | object | 도구 입력. secrets 패턴은 `***REDACTED***`로 치환 (`secrets-redact`와 코드 공유) |
| `outcome` | enum | `success` / `error` / `blocked` |
| `duration_ms` | number \| null | PreToolUse → PostToolUse 경과 시간. 측정 불가면 null |
| `blocked` | bool | PreToolUse hook이 차단했는지 |
| `block_reason` | string \| null | 차단 시 PRE 단계의 reason |
| `cwd` | string \| null | 실행 디렉터리 |

### FR-2. 출력 채널

`AI_TRACKER_AUDIT_DEST` 환경변수로 분기:
- 미설정 또는 `stderr`(기본) → stderr에 raw JSON-Lines.
- 절대경로(`/var/log/...`) → append 모드 파일 쓰기.
- `http://`/`https://` → POST 요청, body=JSON 객체, fire-and-forget(응답 무시, 1초 타임아웃).

### FR-3. duration 측정

PostToolUse만으로는 호출 *시작* 시각 파악 불가. 두 단계 접근:
- (a) Claude Code payload에 `start_ts` 필드가 있으면 사용.
- (b) 미제공 시 `duration_ms: null`. 향후 PreToolUse에서 session-state 파일에 시작 시각을 기록하는 방식으로 확장.

### FR-4. fail-open

JSON 직렬화 실패·파일 쓰기 실패·webhook timeout 등 모든 예외 → exit 0, stderr에 1줄 디버그 메시지(`audit-emit error: ...`).

### FR-5. PreToolUse 차단 시 audit emit

PreToolUse가 exit 2로 차단하면 PostToolUse는 발화되지 않을 가능성이 큼(Claude Code 사양 검증 필요). 검증 결과 미발화 확정 시, PreToolUse hook이 차단 직전에 `outcome: "blocked"` 레코드를 동일 채널로 직접 emit. 코드 공유 모듈은 `hooks/lib/emit.ts`에 둔다.

## 구현 스케치

신규 파일:
- `hooks/post-tool-use.ts` — PostToolUse 진입점.
- `hooks/lib/emit.ts` — 출력 채널 결정 + JSON-Lines 직렬화 공유 모듈. PreToolUse도 차단 시 import해서 호출.

기존 파일 수정:
- `hooks/pre-tool-use.ts` — 차단 직전 `emitAuditRecord({outcome: "blocked", ...})` 호출 추가.
- `package.json` — `bin`에 `ai-action-tracker-audit` 추가, scripts에 `dev:audit`/`start:audit`.
- `docs/hook-installation.md` — PostToolUse hook 등록 절차 추가.

진입점 의사 코드:

```ts
// hooks/post-tool-use.ts
import { emitAuditRecord } from "./lib/emit.js";

interface PostToolUsePayload {
  session_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd?: string;
  start_ts?: string;
}

async function main() {
  const raw = await readStdin();
  const payload = JSON.parse(raw) as PostToolUsePayload;
  emitAuditRecord({
    ts: new Date().toISOString(),
    session_id: payload.session_id,
    tool_use_id: payload.tool_use_id,
    tool: payload.tool_name,
    args: payload.tool_input,
    outcome: "success",
    duration_ms: payload.start_ts ? Date.now() - Date.parse(payload.start_ts) : null,
    blocked: false,
    block_reason: null,
    cwd: payload.cwd ?? null,
  });
}

main().catch((err) => {
  process.stderr.write(`audit-emit error: ${err}\n`);
  process.exit(0);
});
```

## 트레이드오프 & 리스크

| 결정 | 트레이드오프 |
|------|-------------|
| JSON-Lines | SIEM/jq 친화 ↔ 사람이 직접 읽기 불편(필요 시 `jq` 사용 안내) |
| Webhook fire-and-forget | 빠름 ↔ 누락 감지 어려움(V2에서 dead-letter file로 보강) |
| `args` 전체를 redact 후 기록 | 후속 분석 가치 ↔ payload 비대(1MB 초과 시 truncate, V1.1) |
| 기본 stderr | zero-config ↔ stderr 노이즈 증가(운영자가 환경변수로 옮김) |

리스크:
- PostToolUse spec이 Claude Code에서 변경될 가능성 — 모든 payload 필드 optional 처리.
- 대량 webhook 트래픽 → 외부 호스트 부담. rate limiting은 별도 PRD.

## 미해결 질문

1. PreToolUse가 exit 2 차단하면 PostToolUse가 발화되는가? — 공식 사양 확인 필요. 미발화 시 FR-5 코드 공유 패턴 필수.
2. `tool_response`(도구 결과) 포함 여부 — V1.0 제외, V1.1에서 옵션 플래그.
3. 다중 호출 동시 발생 시 stderr 인터리빙 → `jq` 정렬 가정으로 충분한가? 라인 단위 atomic 쓰기는 Node.js에서 보장되므로 줄 단위 손상은 없음.

## 검증 기준 (Acceptance Criteria)

- [ ] `hooks/post-tool-use.ts` 빌드 통과(`npm run build`).
- [ ] `.claude/settings.local.json`에 PostToolUse hook 등록 후 임의 Bash 호출 → stderr에 1줄 JSON 출력.
- [ ] 출력이 `jq -c .`로 파싱 성공.
- [ ] `AI_TRACKER_AUDIT_DEST=/tmp/audit.log` 설정 시 파일에 append되며 stderr에는 안 나옴.
- [ ] `AI_TRACKER_AUDIT_DEST=https://invalid-host.local/`로 설정해도 hook이 stalled되지 않고 즉시 종료(타임아웃 ≤ 2s).
- [ ] 잘못된 stdin payload → exit 0, stderr 디버그 1줄.
- [ ] PreToolUse가 차단한 호출도 `outcome: "blocked"` + `block_reason` 채워진 record 1줄 emit.
- [ ] 새 hook 추가가 기존 PreToolUse 동작에 회귀 없음(기존 9가지 차단 시나리오 통과).
