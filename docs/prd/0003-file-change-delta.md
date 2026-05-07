---
id: file-change-delta
title: Predicted vs Actual File Change Delta
status: draft
priority: P1
effort: S
value: high
category: PreToolUse hook, PostToolUse hook
owner: unassigned
created: 2026-05-07
updated: 2026-05-07
version: 0.1
depends_on: [audit-emit]
related: [secrets-redact, policy-yaml]
references:
  - docs/research/ai-security-mcp-competitive-landscape.md
  - hooks/pre-tool-use.ts
tags: [audit, integrity, post-tool-use, git, anomaly-detection]
---

# Predicted vs Actual File Change Delta

## 컨텍스트 & 문제 정의

현재 PreToolUse hook은 `rm -rf X` 명령의 영향 파일을 `git ls-files`로 *예측*하지만, 실제 어떤 파일이 변경됐는지에 대한 사후 검증은 없다. AI가 의도와 다른 파일을 만지거나(환각·체이닝 명령 부작용), regex 우회로 hook을 통과하더라도 audit 기록만 보면 알 수 없다.

리서치에서 어떤 벤더도 "predicted vs actual diff" 기능을 제공하지 않음을 확인. 우리는 PreToolUse 단계에서 이미 git 인프라를 사용하므로 *그 자산을 PostToolUse에서 한 번 더 활용*하는 것이 자연스러운 진화. 가장 작은 추가 노력으로 환각/우회 탐지 신호를 확보.

`audit-emit`이 출력 채널을 제공하므로 본 PRD는 그 위에 데이터 신호 한 줄을 추가하는 형태.

## 목표 (Goals)

1. PreToolUse에서 도구 호출의 *예상 영향 파일 목록*을 세션 상태 파일에 기록.
2. PostToolUse에서 *실제 변경된 파일*을 `git status --porcelain`로 측정 후 예측과 비교.
3. mismatch(예측 외 파일이 변경됨, 예측한 파일이 변경 안 됨) → audit 레코드에 `delta` 필드로 첨부.
4. 차단은 하지 않음 — 관찰성(observability)만. PostToolUse는 차단할 수 없는 위치이기도 함.

## 비목표 (Non-Goals)

- mismatch 시 자동 롤백 — git이 사용자에게 책임 위임.
- non-git 디렉터리에서의 동작 — git repo 안에서만 측정, 밖이면 skip.
- Bash 명령 전체에 대한 정밀 영향 분석 — 복잡한 chain은 best-effort.
- 세션 종료 후 누적 분석 — `anomaly-baseline`(별도 PRD).

## 사용 시나리오

- 모델이 `Edit` 으로 `src/server.ts`만 수정해 달라 했는데 부작용으로 `src/stdio.ts`도 변경됨 → audit에 alarm 플래그.
- 모델이 hook 우회를 시도해 `rm -rf src` 변형(`rm -r src/`)을 통과시킨 경우, 실제 삭제 후 PostToolUse에서 mismatch 감지(차단은 못 하지만 추적).
- 정상 케이스(예측 ⊇ 실제) → mismatch 없음, audit에 평이한 `delta: {ok: true}`.

## 기능 요구사항

### FR-1. 예측 데이터 모델

PreToolUse가 다음 도구별로 예측 파일 목록을 산출:

| 도구 | 예측 출처 |
|------|----------|
| `Edit` | `tool_input.file_path` 1개 |
| `Write` | `tool_input.file_path` 1개 (신규 또는 덮어쓰기) |
| `MultiEdit` | `tool_input.file_path` 1개 |
| `Bash` (rm/mv/cp/touch 등) | 기존 `extractRmTargets` 일반화한 token 분석 |
| `Bash` (그 외) | 예측 불가 → `predicted: null`(델타 검사 skip) |

### FR-2. 세션 상태 파일

위치: `${TMPDIR:-/tmp}/ai-action-tracker-${session_id}.json`

스키마:
```json
{
  "session_id": "abc-123",
  "predictions": {
    "<tool_use_id>": {
      "ts": "2026-05-07T...",
      "tool": "Edit",
      "predicted": ["src/server.ts"],
      "git_root": "/home/cyprien/Documents/transcodes/ai-action-tracker"
    }
  }
}
```

`predictions`는 호출 ID별 누적. SessionEnd 시 전체 파일 삭제(별도 PRD에서 다룸; 본 PRD는 cleanup 미포함).

### FR-3. 실제 변경 측정

PostToolUse 시점에:
- 동일 `git_root`에서 `git status --porcelain --untracked-files=all` 실행.
- 출력 파싱 → modified/added/deleted/renamed 파일 목록 `actual: string[]` 산출.
- 이 측정은 *세션 누적 변경*을 반영 — PostToolUse 단일 호출의 변경분을 분리하려면 PreToolUse 시점 stash가 필요한데 너무 invasive. V1.0에서는 누적 비교로 단순화.
- 단순화에 따른 의미: `actual ⊇ predicted` 조건이 깨질 때만(=예측한 파일이 실제 변경 목록에 없음) mismatch 플래그. 반대로 `actual`이 더 큰 것은 *과거 호출의 잔존 변경*일 수 있어 alarm 안 함.

### FR-4. delta 페이로드

audit 레코드에 추가 필드:
```json
{
  ...,
  "delta": {
    "checked": true,
    "predicted": ["src/server.ts"],
    "actual_subset_of_session_changes": ["src/server.ts"],
    "missing_from_actual": [],
    "ok": true
  }
}
```

`predicted: null`이거나 `git_root` 외부 호출이면:
```json
{ "delta": { "checked": false, "reason": "outside-git-or-unpredictable" } }
```

mismatch 시 `ok: false` + `missing_from_actual` 채움.

### FR-5. 성능

- `git status --porcelain` ~30~80ms (typical repo). 매 PostToolUse마다 추가 비용.
- 비예측 도구(`Read`, `Glob`, etc.)는 PostToolUse에서 즉시 skip.

## 구현 스케치

수정 파일:
- `hooks/pre-tool-use.ts`:
  - `predictAffectedFiles(payload)` 함수 추가 → tool별 예측.
  - 검사 통과(차단 안 됨) 시 세션 상태 파일에 `predictions[tool_use_id]` append.
- `hooks/post-tool-use.ts` (audit-emit PRD에서 신설):
  - `computeActualChanges(git_root)` → `git status --porcelain` 호출 후 파싱.
  - `computeDelta(predicted, actual)` 함수.
  - audit record에 `delta` 필드 첨부 후 emit.

신규 파일:
- `hooks/lib/session-state.ts` — 세션 상태 파일 read/write/append 유틸.

## 트레이드오프 & 리스크

| 결정 | 트레이드오프 |
|------|-------------|
| 누적 변경 비교(non-stash) | 단순 ↔ 단일 호출 변경분 격리 못 함 |
| 차단 안 함 (관찰만) | 사용자 워크플로 방해 안 함 ↔ 실시간 방어는 못 함 |
| 세션 상태 파일 | 단순 JSON ↔ 다중 동시 hook 실행 시 race(append-only 라인 기반으로 회피) |
| Bash 일반 명령은 skip | 단순·정확 ↔ 커버리지 낮음 |

리스크:
- 세션 상태 파일이 누적되며 커지는 경우(긴 세션에서 수백 호출) — V1에서는 cap 없음. SessionEnd cleanup이 필수 follow-up이지만 본 PRD 범위 외.
- non-git 디렉터리에서 호출 → 검사 skip되며 false negative 가능.

## 미해결 질문

1. *PreToolUse 호출 시점 stash → PostToolUse에서 stash diff*로 단일 호출 격리 가능. 너무 invasive(working tree 일시 수정)인데 가치가 큰가? V2 후보.
2. `git status` 대신 `git diff --name-only HEAD` 가 더 빠른가? — 측정 후 결정.
3. `tool_response`에 변경 파일이 명시돼 있는 도구(Edit, Write)는 git 호출 없이 그대로 사용 가능 — 최적화 여지.

## 검증 기준 (Acceptance Criteria)

- [ ] `Edit`로 `src/server.ts` 수정 → audit record `delta.ok: true`, `predicted: ["src/server.ts"]`.
- [ ] `Bash`로 `rm -rf src/non-tracked` 호출(non-tracked, 통과) → `delta.checked: false` (예측 불가능 또는 git 외부) 또는 `delta.ok: true` (변경 없음).
- [ ] 모델이 `Edit` 명세상은 한 파일 수정인데 실제로 다른 파일 변경되는 인공적 케이스 → `delta.ok: false` + `missing_from_actual` 채워짐.
- [ ] 세션 상태 파일이 `${TMPDIR:-/tmp}/ai-action-tracker-${session_id}.json` 위치에 생성됨.
- [ ] non-git 디렉터리에서 호출 → `delta.checked: false, reason: "outside-git-or-unpredictable"`.
- [ ] PostToolUse 추가 비용이 평균 100ms 이하.
- [ ] 세션 상태 파일 읽기/쓰기 실패 시 fail-open — audit emit은 정상 동작, `delta: null`만.
