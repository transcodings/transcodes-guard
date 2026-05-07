---
id: policy-yaml
title: Policy YAML Engine (Generalized PreToolUse Rules)
status: draft
priority: P2
effort: M
value: med
category: PreToolUse hook, infrastructure
owner: unassigned
created: 2026-05-07
updated: 2026-05-07
version: 0.1
depends_on: [secrets-redact]
related: [audit-emit, file-change-delta]
references:
  - docs/research/ai-security-mcp-competitive-landscape.md
  - hooks/danger-patterns.json
tags: [policy, configuration, pre-tool-use, governance, override]
---

# Policy YAML Engine (Generalized PreToolUse Rules)

## 컨텍스트 & 문제 정의

현재 PreToolUse 차단 룰은 `hooks/danger-patterns.json`(8개) 평면 regex 리스트다. `secrets-redact` PRD에서 `secrets-patterns.json`이 추가되며, 향후 `version-pin-check`/`network-egress-policy` 등이 더해지면 *별개 JSON 파일이 분기마다 늘어난다*.

또한 로드맵의 "additional authentication" 모듈이 사용자 인증 후 *일시적 차단 우회*를 제공할 예정인데, 평면 JSON은 이런 동적 override를 표현할 수 없다.

본 PRD는 모든 룰을 단일 **policy YAML**로 통합하고, 조건부 적용·역할/세션 컨텍스트·시한부 override를 표현 가능하게 한다.

## 목표 (Goals)

1. 단일 `hooks/policies.yaml`에 위험 패턴 + secret 패턴 + 향후 룰을 통합.
2. 룰별 `match`(필터)와 `effect`(`deny` / `allow` / `warn`) 분리.
3. 시한부 override 표현(`additional-authentication` 모듈이 갱신할 데이터 모델 제공).
4. 기존 8개 + secret 8개 = 16개 룰을 새 schema로 마이그레이션 시 동작 동등성 확보.
5. 빌드 의존 추가 — `yaml` npm 패키지(소형, 검증된 라이브러리).

## 비목표 (Non-Goals)

- Rego/CEL 같은 full policy DSL — Phase 3.
- 분산 정책(per-org, 원격 fetch) — V2 이후.
- 룰 간 우선순위 그래프 — V1.0은 선언 순서대로 평가.
- GUI/관리자 콘솔 — 텍스트 편집만.

## 사용 시나리오

- 운영자가 `policies.yaml` 한 파일만 검수해 모든 차단 동작 파악.
- "additional-authentication" 모듈이 사용자 OTP 인증 통과 시 `overrides:` 섹션에 `{rule_id, session_id, until}` 항목 자동 append → 다음 hook 호출 시 해당 룰만 일시 우회.
- 팀 단위로 정책 파일을 git 관리 → `git blame`으로 룰 추가 이유 추적.

## 기능 요구사항

### FR-1. 정책 schema (v1)

```yaml
version: 1

rules:
  # 위험 명령 패턴 (현재 danger-patterns.json 마이그레이션)
  - id: rm-rf-root
    effect: deny
    match:
      tool: Bash
      regex: '\brm\s+(-[rRf]+\s+)+(/[^\s]*|~[^\s]*|\$HOME[^\s]*)'
    reason: "Recursive removal of an absolute path, ~, or $HOME"
    tags: [destructive, filesystem]

  # 시크릿 패턴 (secrets-redact 마이그레이션)
  - id: secret-aws-access-key
    effect: deny
    match:
      tool: [Bash, Edit, Write, MultiEdit]
      field: ['command', 'new_string', 'old_string', 'content', 'edits[].new_string']
      regex: '\bAKIA[0-9A-Z]{16}\b'
    reason: "AWS Access Key ID pattern"
    tags: [secret, leak-prevention]

  # 향후 확장: 조건부 룰
  - id: prod-deploy-business-hours
    effect: warn
    match:
      tool: Bash
      regex: 'kubectl\s+apply.*production'
    conditions:
      - type: time-window
        outside: "09:00-18:00 Asia/Seoul Mon-Fri"
    reason: "Production deploy outside business hours — warn-only"

overrides:
  # additional-authentication 모듈이 추가하는 시한부 우회
  # 예: 사용자가 OTP 인증 후 5분간 rm-rf-root 우회 허용
  # - rule_id: rm-rf-root
  #   session_id: abc-123
  #   until: '2026-05-07T15:30:00+09:00'
  #   granted_by: user
  #   granted_at: '2026-05-07T15:25:00+09:00'
```

### FR-2. 매칭 의미

각 룰의 `match`:
- `tool`: 단일 문자열 또는 배열. 적용 도구 필터.
- `field`: 검사할 `tool_input` 필드 경로(콤마 표현 또는 dot-notation). 미지정 시 도구 기본 필드(`Bash` → `command`, `Edit` → `new_string`+`old_string`, etc.)
- `regex`: JS RegExp 문자열.

### FR-3. effect

| 값 | 동작 |
|----|------|
| `deny` | exit 2, stderr 차단 메시지 |
| `allow` | 명시적 허용(deny 룰을 덮어쓰는 용도, 예: "rm-rf-broad는 deny지만 `rm -rf node_modules`는 allow") |
| `warn` | 통과시키되 audit 레코드에 `warn_reason` 첨부 |

평가 순서: 첫 매치된 `deny`/`allow`로 결정. `warn`은 비차단이므로 누적 가능.

### FR-4. override 적용

```ts
function isOverridden(ruleId: string, session: string, now: Date): boolean {
  for (const o of policy.overrides ?? []) {
    if (o.rule_id !== ruleId) continue;
    if (o.session_id !== session) continue;
    if (Date.parse(o.until) < now.getTime()) continue;
    return true;
  }
  return false;
}
```

`deny` 룰이 매칭됐어도 활성 override가 있으면 통과. audit에 `overridden_by` 레코드 추가.

### FR-5. 마이그레이션

V1 출시 시 `hooks/policies.yaml` 한 파일로 시작.
- 기존 `danger-patterns.json` 8개 → `rules`에 그대로 변환.
- `secrets-redact` PRD의 8개 → `rules`에 변환(field 필터 명시).
- 기존 JSON 파일은 deprecated로 표시(README에 안내), 다음 마이너 버전에서 제거.

`hooks/pre-tool-use.ts`:
- `loadPatterns()` → `loadPolicy()` 로 교체. 반환 타입은 새 schema.
- `checkPatternMatch` / `checkSecretMatch`를 `evaluatePolicy(payload, policy, sessionId, now)` 단일 함수로 통합.

## 구현 스케치

신규 파일:
- `hooks/policies.yaml` — 마이그레이션된 16개 룰 + overrides 빈 배열.
- `hooks/lib/policy.ts` — YAML 로더 + evaluator + override 검사.

수정 파일:
- `hooks/pre-tool-use.ts` — 체크 체인 단순화: `evaluatePolicy()` 하나만 호출.
- `package.json` — dependencies에 `yaml` (npm) 추가.
- `tsconfig.json`/build — 변경 없음(YAML은 런타임 read).

코드 스케치:

```ts
// hooks/lib/policy.ts
import yaml from "yaml";
import { readFileSync } from "node:fs";

export interface Policy {
  version: number;
  rules: Rule[];
  overrides?: Override[];
}

export interface Rule {
  id: string;
  effect: "deny" | "allow" | "warn";
  match: { tool: string | string[]; field?: string | string[]; regex: string };
  reason: string;
  tags?: string[];
  conditions?: Condition[];
}

export function loadPolicy(): Policy {
  // 검색 경로는 pre-tool-use.ts와 동일 패턴 (here, ../../hooks/)
}

export function evaluate(
  payload: ToolUsePayload,
  policy: Policy,
  ctx: { sessionId: string; now: Date },
): { effect: "deny" | "allow" | "warn" | "pass"; rule?: Rule; warnings: Rule[] } {
  // 1. 모든 deny/allow 룰을 순회하며 첫 매치 찾기
  // 2. 매치된 deny에 활성 override 있으면 pass로 격하
  // 3. warn 룰은 누적
}
```

## 트레이드오프 & 리스크

| 결정 | 트레이드오프 |
|------|-------------|
| YAML 채택 | 사람 친화·multiline regex 가독성 ↔ JSON 대비 파싱 복잡, dependency 추가 |
| 단일 파일(policies.yaml) | 검수 용이 ↔ 룰 수백 개로 늘면 관리 어려움(향후 `rules.d/*.yaml` 디렉터리로 split) |
| 선언 순서 평가 | 단순 ↔ 우선순위 명시 어려움(같은 도구·다른 effect 혼재 시 주의) |
| override를 같은 파일에 둠 | 단일 진실 소스 ↔ 인증 모듈이 정책 파일을 동적으로 수정하는 결합 발생(file lock 필요) |

리스크:
- 잘못된 YAML(syntax 에러) → fail-open(exit 0). 정책 미적용 상태로 모든 명령 통과 가능 → 운영 위험. CI에서 policy validate 단계 필수.
- override 항목 누적으로 파일 비대화 — `until` 경과한 항목을 SessionEnd hook 또는 PostToolUse 부산물로 정리.
- 동시성: 여러 hook이 동시에 overrides 추가 시 race — V1은 단순 file lock 또는 append-only file로 회피.

## 미해결 질문

1. `field` 경로의 dot-notation 문법(예: `edits[].new_string`)을 어떻게 파싱? — 단순 split + array glob 처리. JSONPath 도입은 over-engineering.
2. `conditions` 일반화 — V1.0은 `time-window`만 구현, 차후 `cwd-glob`, `git-branch`, `env-var` 추가 가능. 인터페이스 확장성 미리 설계.
3. override 발급 흐름 — additional-authentication 모듈이 어떤 인터페이스로 항목을 추가하는가? CLI(`hook-cli grant rm-rf-root --until 5m`)? MCP tool 호출? — 별도 PRD 필요.
4. policy 파일이 git에 체크인되면 secrets 패턴 자체가 노출 — regex 자체는 secret이 아니므로 OK, 다만 reason에 회사 내부 정보 박지 않도록 README 가이드.

## 검증 기준 (Acceptance Criteria)

- [ ] `hooks/policies.yaml` 신설, 기존 8개 + secret 8개 = 16개 룰 마이그레이션.
- [ ] 기존 9가지 차단 시나리오 모두 새 정책 엔진에서 동일하게 차단.
- [ ] `evaluatePolicy` 결과의 reason이 PRD 0001/0002와 동일 포맷으로 audit emit.
- [ ] `overrides:` 섹션에 활성(`until` 미래) 항목 추가 시 해당 룰 우회.
- [ ] 만료(`until` 과거) 항목은 무시.
- [ ] `policies.yaml`에 syntax 에러 → exit 0(fail-open) + stderr 디버그 1줄 + 모든 호출 통과.
- [ ] `npm test` 또는 `npm run build`에 정책 validate 단계 추가(YAML schema check).
- [ ] V1.1 마이그레이션 가이드: 기존 `danger-patterns.json`/`secrets-patterns.json` 사용자에게 자동 변환 스크립트 제공(또는 deprecation warning).
