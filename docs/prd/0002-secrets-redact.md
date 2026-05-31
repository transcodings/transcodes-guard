---
id: secrets-redact
title: Secrets Pattern Detection & Block (PreToolUse)
status: draft
priority: P1
effort: S
value: high
category: PreToolUse hook
owner: unassigned
created: 2026-05-07
updated: 2026-05-07
version: 0.1
depends_on: []
related: [audit-emit, policy-yaml]
references:
  - docs/research/ai-security-mcp-competitive-landscape.md
  - hooks/danger-patterns.json
tags: [secrets, credentials, pre-tool-use, leak-prevention, regex]
---

# Secrets Pattern Detection & Block (PreToolUse)

## 컨텍스트 & 문제 정의

현재 PreToolUse hook은 *명령*에 대한 위험 패턴(`rm -rf`, `dd`, `curl|bash` 등)만 검사한다. 도구 입력에 **하드코딩된 secret**(API key, password, token, 개인키)이 들어가는 케이스는 차단되지 않는다.

리서치 결과 Datadog·Snyk는 secrets를 *egress redaction*(전송 후 마스킹)으로 다루는 반면, 우리 hook은 *pre-execution blocking*이 가능한 위치에 있다 — 더 강한 보호. 거의 어떤 벤더도 PreToolUse 단계 secrets 차단을 제공하지 않으므로 차별점.

패턴 검사 인프라(`danger-patterns.json` + regex 매칭)가 이미 있어 *재사용*만 하면 되는 가장 작은 고가치 작업.

## 목표 (Goals)

1. 도구 입력에 secret 패턴이 매칭되면 PreToolUse 단계에서 exit 2 차단.
2. 적용 대상: Bash(`command`), Edit(`new_string`/`old_string`), Write(`content`), MultiEdit(`edits[].new_string`).
3. secret 패턴은 별도 파일(`hooks/secrets-patterns.json`)에 두어 `danger-patterns.json`과 같이 코드 변경 없이 추가 가능.
4. 차단 메시지는 **secret 값 자체를 노출하지 않는다** — 패턴 ID와 reason만.

## 비목표 (Non-Goals)

- Redaction(자동 마스킹 후 통과) — V1.0에서는 차단만.
- 파일 시스템 스캐닝(저장된 파일에서 secret 발견) — 별도 도구.
- 고엔트로피 자동 탐지(.env 파일 전수 검사) — false positive 우려, V1.1.
- 사용자 정의 가능한 redaction 형식 — V1.1.

## 사용 시나리오

- 모델이 prompt 학습 데이터에 들어있던 *남의* AWS key를 그대로 명령에 사용 → 차단.
- 모델이 사용자가 채팅에 붙여넣은 토큰을 `curl -H "Authorization: bearer ..."`로 보내려 시도 → 차단.
- 사용자가 실수로 대화 중에 노출한 password가 `Edit`으로 코드에 박힐 뻔할 때 → 차단.

## 기능 요구사항

### FR-1. 패턴 파일 스키마

`hooks/secrets-patterns.json`:
```json
{
  "patterns": [
    {
      "id": "aws-access-key",
      "regex": "\\bAKIA[0-9A-Z]{16}\\b",
      "reason": "AWS Access Key ID pattern"
    },
    {
      "id": "github-pat-classic",
      "regex": "\\bghp_[A-Za-z0-9]{36}\\b",
      "reason": "GitHub personal access token (classic)"
    }
  ]
}
```

`danger-patterns.json`과 동일 schema라 코드 재사용 용이.

### FR-2. 초기 패턴 셋(8개)

| ID | Regex (요약) | 대상 |
|----|------------|------|
| `aws-access-key` | `\bAKIA[0-9A-Z]{16}\b` | AWS Access Key ID |
| `gcp-api-key` | `\bAIza[0-9A-Za-z_-]{35}\b` | Google API key |
| `github-pat-classic` | `\bghp_[A-Za-z0-9]{36}\b` | GitHub PAT |
| `github-pat-fine` | `\bgithub_pat_[A-Za-z0-9_]{82}\b` | GitHub fine-grained PAT |
| `slack-bot-token` | `\bxox[bp]-[0-9A-Za-z-]{10,}` | Slack bot token |
| `jwt-token` | `\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b` | JWT |
| `pem-private-key` | `-----BEGIN [A-Z ]*PRIVATE KEY-----` | PEM private key block |
| `bearer-in-cmd` | `(?i)\bauthorization:\s*bearer\s+[A-Za-z0-9._-]{20,}` | Bearer token in HTTP header |

추가 패턴은 코드 빌드 없이 JSON 수정만으로 적용.

### FR-3. 적용 대상 도구·필드

`tool_input` 분석:
- `Bash` → `command` 문자열 검사
- `Edit` → `old_string` + `new_string` 모두 검사
- `Write` → `content` 검사
- `MultiEdit` → `edits[]`의 모든 `old_string`/`new_string`

위 외 도구(Read 등)는 통과.

### FR-4. 차단 메시지 (secret 값 비노출)

```
⛔ transcodes-guard: BLOCKED — secret pattern detected

Reason: matched pattern `aws-access-key` — AWS Access Key ID pattern
Field: tool_input.command
Tool: Bash

Command (with secret hidden): aws s3 cp file.txt s3://bucket/ --access-key=***REDACTED***...

This invocation contains a credential pattern. Move it to environment 
variables or a secrets manager and retry.
```

원래 명령 전체를 그대로 보여주지 않고, 매칭된 부분을 `***REDACTED***`로 치환한 *snippet*만 표시 (앞뒤 30글자 컨텍스트).

### FR-5. 검사 순서

`pre-tool-use.ts`의 체크 체인:
1. `checkPatternMatch` (위험 명령 — 기존)
2. `checkRmGitTracked` (git tracked 의미 분석 — 기존)
3. **`checkSecretMatch` (이 PRD에서 신설)** ← 추가

세 체크 중 어느 하나라도 BlockResult 반환 시 즉시 차단.

## 구현 스케치

신규 파일:
- `hooks/secrets-patterns.json` — 위 FR-2의 8개 패턴.

수정 파일:
- `hooks/pre-tool-use.ts`:
  - `loadSecretPatterns()` 추가(loadPatterns()와 거의 동일).
  - `checkSecretMatch(payload, secretConfig)` 함수 추가:
    - tool에 따라 분석 대상 필드 선택(FR-3).
    - 각 필드 텍스트에 대해 모든 패턴 regex 적용.
    - 매치 시 `{reason, details: ["field=...", "snippet=..."], command: <redacted-snippet>}` 반환.
  - `main()`의 체크 체인에 추가.
  - `emitBlock()`은 그대로 사용 가능(이미 reason+details+command 구조).

## 트레이드오프 & 리스크

| 결정 | 트레이드오프 |
|------|-------------|
| 차단만 (redact 안 함) | 단순·확정적 ↔ 모델이 자주 부딪히면 워크플로 마찰 |
| 명시적 패턴만 (entropy 안 봄) | False positive 낮음 ↔ 신규/커스텀 토큰 미감지 |
| Edit/Write도 검사 | 노출 경로 광범위 차단 ↔ 코드에 *예시* secret 박는 정상 케이스(README 코드 블록 등) 차단 가능성 |
| Bash payload 전체 검사 | 안전 ↔ heredoc 큰 페이로드는 검사 시간 증가(현실적으로 < 1ms) |

리스크:
- 합법적 시나리오(예: 사용자가 의도적으로 dev key를 코드에 박는 테스트) → 패턴 ID 보고 사용자가 직접 `secrets-patterns.json`에서 빼거나 `policy-yaml`(별도 PRD)의 override로 임시 우회.
- regex 우회(zero-width space 삽입, 변수 치환) — 한계 인지하고 1차 방어선으로 수용.

## 미해결 질문

1. README 등 *문서* 안에 들어간 예시 secret도 차단 대상인가? — 차단 대상으로 시작, 거짓 양성 발생 시 사용자가 패턴 조정.
2. `bearer-in-cmd` 패턴이 정상 API 호출(`bearer $TOKEN`)을 못 잡고 *literal* token만 잡는가? — `\$\w+`는 패턴에 포함시키지 않으므로 변수 참조는 통과. ✓
3. 차단 메시지 snippet의 컨텍스트 길이(30글자) 적절한가? — 너무 길면 secret 부분 노출 위험, 너무 짧으면 디버깅 불편. 기본 30, 향후 환경변수로 조정.

## 검증 기준 (Acceptance Criteria)

- [ ] `hooks/secrets-patterns.json` 신설, 8개 패턴 등록.
- [ ] `Bash` 명령에 AWS key(`AKIAEXAMPLE...`) 포함 → 차단(exit 2), 메시지에 `aws-access-key` 패턴 ID 노출, secret 본문은 `***REDACTED***`.
- [ ] `Edit`로 코드에 `bearer abcdef1234567890...` 삽입 시도 → 차단.
- [ ] `Write`로 `.env` 파일에 `password="hardcoded123456"` 작성 시도 → 차단.
- [ ] `Read`(secrets 패턴 포함 파일을 읽기) → 통과(검사 대상 외).
- [ ] 정상 명령(secret 없음) → 통과.
- [ ] 차단 시 audit 레코드(`audit-emit` 기능 시) `block_reason`에 `secret pattern: aws-access-key` 형태 기록.
- [ ] JSON 오타로 `secrets-patterns.json` 파싱 실패 → fail-open(exit 0), stderr 디버그 메시지 1줄.
