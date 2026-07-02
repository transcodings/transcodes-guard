# Prompt-session resource/action grouping

> **한 줄:** 같은 resource/action은 프롬프트 세션 안에서 한 번만 승인. 다른 묶음이면 별도. Delete는 예외 (항상 매번).

Guard v3 step-up UX: 동일 `(resource, action)` 좌표를 프롬프트 세션 단위로 묶어 MFA 재승인 횟수를 줄인다. **판정은 전부 백엔드.** 클라이언트는 `prompt_session_id` 버킷만 관리한다.

---

## 규칙

| Rule | 내용 |
|------|------|
| 1 | 명령마다 AI 분류 → `(resource, action)` |
| 2 | 같은 프롬프트 세션 + 같은 좌표 + 이미 승인됨 → **재승인 스킵** |
| 3 | 다른 `(resource, action)` → **별도 승인** |
| 4 | `delete` → **그룹핑·TTL·lock 전부 무시, 매번 승인** |

### 예시

```
#1 system/read  → 승인 ✅
#2 system/read  → 스킵 (grant hit)
#3 gmail/read   → 승인 ✅ (다른 묶음)
#4 system/delete → 승인 ✅ (delete는 매번)

총 승인: 3번 (4번 명령)
```

---

## 그룹 리셋 조건

| # | 조건 | 클라이언트 | 백엔드 |
|---|------|-----------|--------|
| 1 | **프롬프트 완료** (새 사용자 프롬프트) | `rotatePromptSession()` (user-prompt-submit hook) | 새 `prompt_session_id` → grant miss |
| 2 | **5분 윈도우 만료** | `getPromptSessionId()` TTL 300s, `prompt-session.json` 교체 | Redis grant TTL 300s 만료 |
| 3 | **명시적 lock** | `clearPromptSession()` / MCP `end_stepup_grouping` | 다음 evaluate 시 grant miss |

**회전하지 않는 경우:** step-up 대기 중 `"done"`, `"auth passed"` 등 completion prompt. deny → WebAuthn → retry는 같은 프롬프트 턴 안에서 끝나므로 버킷 ID를 유지한다.

---

## 역할 분담

```
클라이언트 (transcodes-guard)
  - prompt_session_id 발급 / 회전 / 삭제
  - POST /guard/evaluate body에 prompt_session_id 포함
  - permission 0/1/2 그대로 순종 (grouping/delete 판정 없음)

백엔드 (transcode-backend)
  - AI classify → resource/action
  - RBAC matrix → permission 0/1/2
  - grant read: permission 2 + grant hit + action≠delete → permission 1
  - grant write: WebAuthn finalize 시 Redis 기록 (delete 제외)
```

---

## End-to-end 흐름

```
[새 프롬프트]
  hook → rotatePromptSession() → ps_abc

[명령 #1 — system/read]
  pre-tool-use → evaluate(prompt_session_id=ps_abc)
  backend: classify system/read, matrix permission 2, grant miss
  → step-up sid 생성 (세션 JSON에 promptSessionId 저장)
  → user WebAuthn → finalizeStepUpAfterMfa
  → recordGuardGrant(system, read, ps_abc)  Redis EX 300s

[명령 #2 — system/read, 다른 command]
  evaluate(prompt_session_id=ps_abc)
  → grant hit → permission 1 → hook 통과 (step-up 없음)

[명령 #3 — gmail/read]
  → grant miss → step-up

[명령 #4 — delete]
  → grant read/write 모두 skip → step-up (매번)

[리셋: 새 프롬프트 | 5분 | lock]
  → grant miss → 다시 물어봄
```

---

## 클라이언트 구현 (`ai-action-tracker-mcp`)

### State: `packages/stepup-core/src/prompt-session.ts`

파일: `~/.transcodes/state/prompt-session.json`

```json
{ "id": "ps_xxx", "createdAt": 1782962339898 }
```

| API | 용도 |
|-----|------|
| `getPromptSessionId()` | PreToolUse evaluate 시 ID (TTL 만료 시 자동 mint) |
| `rotatePromptSession()` | 새 프롬프트 → 무조건 새 ID |
| `clearPromptSession()` | 명시적 lock |

- `PROMPT_SESSION_TTL_MS = 300_000` (5분)
- ID 형식: `ps_` + 9 bytes base64url
- IO 실패 시 fail-open (fresh in-memory ID, gate 블록 안 함)

### Evaluate 연동

- `evaluate.ts` → `evaluateAction({ promptSessionId: getPromptSessionId() })`
- `rbac-check.ts` → body `prompt_session_id`

### Hooks (리셋 #1)

- `plugins/claude-code/hooks/user-prompt-submit.ts`
- `plugins/codex/hooks/user-prompt-submit.ts`
- `plugins/cursor/hooks/before-submit-prompt.ts`

```typescript
if (!COMPLETION_PATTERN.test(parsed.prompt)) {
  backend.rotatePromptSession();
}
```

### MCP tool (리셋 #3)

- `end_stepup_grouping` → `clearPromptSession()`
- 보안: 약화 불가. 다음 명령부터 grant miss → **더 자주** 물어봄.

### 계약

- `gate-contract/backend.ts` — `rotatePromptSession`, `clearPromptSession`
- `gate-backend/index.ts` — stepup-core binding
- `gate-contract/noop.ts` — stub

### 기존 fp fast-path와의 관계

| 레이어 | 키 | 용도 |
|--------|-----|------|
| 기존 `stepup-verified.<fp>.json` | `sha256(command)` | 완전 동일 명령 재시도 (single-shot consume) |
| 신규 Redis grant | `(promptSession, resource, action)` | 같은 좌표·다른 명령 스킵 |

독립 동작. grant는 서버 only.

---

## 백엔드 구현 (`transcode-backend-nestjs-v1-main`)

상세: [docs/guard-prompt-session-grant.md](../../../transcode-backend-nestjs-v1-main/docs/guard-prompt-session-grant.md)

### API

`POST /v1/guard/evaluate` — optional body field:

```json
{ "prompt_session_id": "ps_xxx" }
```

omit → 그룹핑 비활성 (하위 호환).

### Redis grant

```
Key:  guard:grant:{projectId}:{memberId}:{promptSessionId}:{resource}:{action}
TTL:  300s (GUARD_GRANT_TTL)
Value: verifiedAt ISO timestamp
```

- **Write:** `finalizeStepUpAfterMfa` — `promptSessionId` + resource + action 있고 action≠delete
- **Read:** `createStepUpRedirectSession` — matrixPolicy=guard, permission=2, promptSessionId 있고 action≠delete, grant hit → `permission: 1`, sid 미생성

### 변경 파일

| File | Change |
|------|--------|
| `src/guard/dtos/EvaluateAction.dto.ts` | `prompt_session_id?` |
| `src/auth/types/temp-session.constants.ts` | `GUARD_GRANT_*` |
| `src/auth/types/temp-session.types.ts` | `McpStepUpSessionData.promptSessionId?` |
| `src/auth/models/temp-session.service.ts` | grant read/write, sid에 promptSessionId 저장 |
| `src/guard/guard.evaluate.service.ts` | promptSessionId threading |
| `src/guard/guard.controller.ts` | DTO → service |

---

## 배포

1. **Backend** deploy (grant Redis logic)
2. **Guard plugin** release (prompt-session + hooks + `end_stepup_grouping`)

Backend만 올리고 client가 `prompt_session_id`를 안 보내면 그룹핑 off — 기존과 동일.

---

## 검증

```bash
# client
cd ai-action-tracker-mcp && npm run type-check && npm test -w @transcodes-guard/stepup-core

# backend
cd transcode-backend-nestjs-v1-main && pnpm type-check
```

수동 E2E:

- [ ] 같은 `(resource, action)` 2회 → 1회만 step-up
- [ ] 다른 resource → 별도 step-up
- [ ] delete → 매번 step-up
- [ ] 새 프롬프트 → grant miss
- [ ] 5분 후 → grant miss
- [ ] `end_stepup_grouping` → grant miss
