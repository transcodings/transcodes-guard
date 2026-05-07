# Product Requirements Documents (PRD)

이 디렉터리는 `ai-action-tracker-mcp`에 신규로 추가될 기능에 대한 PRD(Product Requirements Document) 모음이다. 각 문서는 *왜 이 기능이 필요하고, 무엇을 만들지, 어떻게 검증할지*를 한 곳에 정리해 다른 작업자가 cold-read 가능하도록 한다.

## 파일 명명 규칙

```
NNNN-<slug>.md
```

- `NNNN` — 4자리 숫자 prefix(생성 순서). 단순 정렬용이며 의존성이나 우선순위와 무관.
- `<slug>` — 영소문자-하이픈 ID. frontmatter `id` 필드와 동일하게 유지.

예: `0001-audit-emit.md`, `0002-secrets-redact.md`.

우선순위 변경 시 파일명을 바꾸지 않는다 — `priority` frontmatter 필드만 갱신.

## 필수 frontmatter (12개)

각 PRD는 YAML frontmatter로 시작한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | slug | 파일명 slug과 동일. 다른 PRD에서 참조할 때 사용 |
| `title` | string | 인간이 읽는 제목. 본문 H1과 일치 |
| `status` | enum | 라이프사이클 상태 — 아래 표 참조 |
| `priority` | enum | `P0` / `P1` / `P2` |
| `effort` | enum | `S`(반나절~1일) / `M`(1~3일) / `L`(1주+) — 1인 기준 추정 |
| `value` | enum | `low` / `med` / `high` — 사용자/제품 가치 |
| `category` | string | 아키텍처 위치(아래 표 참조) |
| `owner` | string | 담당자 이름 또는 `unassigned` |
| `created` | YYYY-MM-DD | 문서 최초 작성일 |
| `updated` | YYYY-MM-DD | 마지막 수정일 |
| `version` | string | 문서 버전(0.1, 1.0 ...) — 의미 있는 변경 시 minor 증가 |
| `depends_on` | list of slug | 이 PRD가 시작되려면 먼저 `shipped`여야 하는 다른 PRD들 |

## 선택 frontmatter (3개)

| 필드 | 설명 |
|------|------|
| `related` | 의존은 아니지만 관련된 PRD slug 목록 |
| `references` | 외부 자료(리서치 리포트 경로, 공식문서 URL, 이슈 등) |
| `tags` | 검색용 태그 |

## 허용되는 enum 값

### `status` (라이프사이클)

```
draft ──→ approved ──→ in-progress ──→ shipped
            │
            └──→ archived (취소된 경우)
```

| 값 | 의미 |
|------|------|
| `draft` | 작성 중. 토론 환영. 결정 미확정 |
| `approved` | 의사결정자 승인 완료. 다음 릴리스 후보 |
| `in-progress` | 작업 중. `owner` 필드 갱신 필수 |
| `shipped` | 머지·배포 완료. 변경 사항은 새 PRD 작성 권장 |
| `archived` | 진행 안 하기로 결정. 사유는 본문 첫 줄에 명시 |

### `priority`

| 값 | 의미 |
|------|------|
| `P0` | 필수. 다음 릴리스에 반드시 포함 |
| `P1` | 중요. 분기 내 |
| `P2` | 권장. 분기 외에서도 가능 |

### `category` (아키텍처 위치)

| 값 | 설명 |
|------|------|
| `PreToolUse hook` | 도구 호출 *전* 차단/검증 |
| `PostToolUse hook` | 도구 호출 *후* 로깅/감사/관찰 |
| `Stop hook` | 모델 응답 종료 시 |
| `SessionEnd hook` | 세션 종료 시 정리 |
| `MCP tool` | 모델 호출 가능한 advisory tool (`createServer()`에 등록) |
| `MCP resource` | 모델/사용자가 읽는 컨텍스트 |
| `MCP prompt` | 사용자 명시 호출 템플릿 |
| `infrastructure` | hook 진입점·빌드 시스템·배포 등 |

복합 영역인 경우 콤마로 나열: `PreToolUse hook, infrastructure`.

## 본문 구조 (권장 섹션 9개)

```markdown
## 컨텍스트 & 문제 정의
## 목표 (Goals)
## 비목표 (Non-Goals)
## 사용 시나리오
## 기능 요구사항
## 구현 스케치
## 트레이드오프 & 리스크
## 미해결 질문
## 검증 기준 (Acceptance Criteria)
```

- 모든 섹션은 **한국어** 작성. 코드 식별자·기술 용어·필드명은 원문 유지(영어).
- 검증 기준은 체크리스트 형식(`- [ ] ...`) 권장.
- 코드 예시는 *스케치* 수준 — 실제 구현 전에 변경 가능함을 전제.

## 한 줄짜리 minimal 예시

```yaml
---
id: my-feature
title: My Feature
status: draft
priority: P1
effort: M
value: high
category: PreToolUse hook
owner: unassigned
created: 2026-05-07
updated: 2026-05-07
version: 0.1
depends_on: []
---

# My Feature

## 컨텍스트 & 문제 정의
...
```

## 참고

- 본 PRD 시리즈의 출발점: [`../research/ai-security-mcp-competitive-landscape.md`](../research/ai-security-mcp-competitive-landscape.md) — "즉시 권장 4개" 섹션이 PRD 0001~0004의 근거.
- 코드 컨벤션: [`../../CLAUDE.md`](../../CLAUDE.md), [`../../.claude/rules/mcp-server.md`](../../.claude/rules/mcp-server.md).
- Hook 사양: [Claude Code hooks docs](https://code.claude.com/docs/en/hooks).
