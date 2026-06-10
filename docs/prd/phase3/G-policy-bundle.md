# Phase 3 v2 / Unit G — 정책 번들 분리 (policy-as-data)

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M7
> 규모: **L** · 선행: 없음 · 외부 의존: **백엔드 룰 저장소 + CRUD + 번들 읽기 뷰(사내, §백엔드 범위)** · 상태: 🔧 **In progress** (G1 → [#52](https://github.com/transcodings/ai-action-tracker-mcp/pull/52))
> 근거: [`boundary-redesign.md`](../../research/boundary-redesign.md) §2 (OPA 번들 패턴 + 운영 파라미터)

## 규모 산정

- **L (Large)** — 복수 PR + 백엔드 룰 저장소/API + 보안 임계(fail-closed) + 4호스트 smoke 갱신.
- 내부 phasing(권장):
  - **G1 번들 계약 + 클라이언트 코어** — 번들 스키마/manifest 검증/캐시 읽기·쓰기. 백엔드 API와 병행 개발 가능(픽스처 우선). → 🎉 **PR #52** (`stepup-core/src/policy-bundle.ts`, 단위 테스트 18종)
  - **G2 refresh 배선** — SessionStart 계열 훅 4종 + MCP 서버 기동 시 TTL refresh(비차단). G1 fetch에 envelope unwrap 보정 포함(아래 §번들 계약).
  - **G3 데이터 이관** — 시스템 tool-rules를 번들 소스-오브-트루스에서 내장 baseline/org 번들로 분리, `loadMergedToolRules()` 병합 순서 개편.

## 요구사항

시스템/조직 정책(tool-rules, 향후 danger-pattern 추가분)을 **코드·번들에 굽지 않고** 백엔드가 org-scoped로 배포한다. 클라이언트는 fetch → 무결성 검증 → 로컬 캐시 → 동기 로컬 평가.

## 번들 계약 (초안 — 백엔드와 합의 필요. G1 클라이언트 구현 기준 갱신: 2026-06-10)

```
GET /v1/guard/policy-bundle?revision=<현재 revision>   (X-Transcodes-Token 인증)
  → 200 { ..., payload: [ { revision: string, rules: ToolRule[],
                            manifest: { sha384: string } } ] }
  → 304 (revision 동일)
```

- `revision`은 단조 증가 식별자 — v1 OQ3(버전 핀 갱신)을 대체한다. 클라이언트는 핀하지 않고 최신 revision을 따른다.
- **envelope (백엔드 탐사로 확정)**: 백엔드의 글로벌 `NormalizeResponseInterceptor`가 모든 응답을 `{ logId, success, statusCode, payload: [...], error }`로 감싸고 단일 객체도 배열화한다. 클라이언트는 `payload[0]`을 unwrap한 뒤 검증한다(기존 `rbac-check.ts`와 동일 패턴). **manifest 해시의 대상은 번들 객체(payload[0]에서 manifest 제외)이지 envelope이 아니다.** G1(#52)은 본문 직접 수신을 가정했으므로 G2에서 fetch에 unwrap 한 줄 보정.
- 무결성: 번들 객체의 **canonical JSON(객체 키 재귀 정렬, 공백 없음)** SHA-384 == manifest 값 검증 후 활성화(OPA "검증 후 활성화" 패턴). 캐노니컬라이제이션은 #52의 핀 해시 테스트로 고정 — 백엔드는 동일 규칙으로 계산해야 한다. 서명 방식 상세는 D3 — 1차는 TLS+해시, detached signature는 후속.
- 스키마 검증: zod — 백엔드 응답도 신뢰하지 않는다(부분 손상 번들로 게이트가 죽지 않게). 미지 필드는 해시에 포함하되 파싱에서 제거(전방 호환).
- **스코프(D5, 결정 필요)**: 본 문서는 org-scoped로 기술해 왔으나, 백엔드의 테넌트 패턴은 project 중심이다(`_project_id` 필터, RBAC role/resource도 project 스코프). 토큰에 organizationId/projectId 둘 다 있으므로 기술적으론 양쪽 가능 — 백엔드 데이터 모델을 따라 **project 스코프 권고**. 채택 시 캐시 파일명은 `policy-bundle.<projectId>.json`.

## 백엔드 범위 (탐사 결과 재정의: 2026-06-10)

백엔드(`transcode-backend-nestjs-v1`)에 기존 정책/룰 저장소는 **없다**(RBAC 매트릭스와 무관) — 신규 모듈이다. 범위는 "읽기 API 1본"이 아니라:

```
[룰 저장소 — 단일 소스-오브-트루스 (project/org-scoped, D5)]
  POST/PUT/DELETE /v1/guard/rules     ← 쓰기: 콘솔 + (후속) MCP 툴 add/update/remove
  GET /v1/guard/policy-bundle         ← 읽기 뷰: 저장소 스냅샷 + revision + manifest
```

- **번들 API를 read-only로 짓지 않는다.** "custom rule의 리모트 관리"는 별도 시스템이 아니라 이 저장소의 쓰기 주체가 하나 늘어나는 것이다(같은 스키마·같은 스코프·같은 배포 채널 — 재발명 금지). revision 증가는 쓰기 시점에 일어난다.
- MCP 툴(`add_user_tool_rule` 계열)의 쓰기 경로를 로컬 파일 → 백엔드 CRUD로 이전하는 작업은 **G 범위 밖**(후속 단위로 문서화). 단, 저장소/CRUD 설계는 처음부터 그 소비자를 전제한다.
- 모듈 컨벤션: NestJS 11 + MongoDB native driver, class-validator DTO, `@AuthPolicy('apitoken')`, `@Principal()`로 스코프 claim 소비.

## 캐시 (클라이언트)

- 위치: `cacheDir()/policy-bundle.<org>.json` — **반드시 `@transcodes-guard/plugin-paths`로 해석**(CLAUDE.md 경로 규칙).
- 원자적 쓰기: temp 파일 + rename(여러 hook 동시 기동 대비 — v1 C의 동시성 우려를 계승).
- TTL: 기본 **1h** (정책 변경 빈도 낮음; OPA의 10–120s 폴링은 상주 데몬 전제라 부적합 — hook은 단명 프로세스). `transcodes` CLI에 강제 갱신 명령 추가(`transcodes policy refresh`, 선택).

## refresh 배선 (hook 임계 경로 비차단 — 설계 불변식 2)

- **PreToolUse는 캐시만 읽는다. 네트워크 0.**
- refresh 시점: ① SessionStart 계열 훅(claude-code/codex/cursor `session-start`, antigravity `pre-invocation` invocationNum=1) ② MCP 서버 기동 ③ TTL 만료 시 다음 ①②에서.
- refresh 실패는 조용히 로깅(console.error)하고 기존 캐시 유지 — 실패가 세션을 막지 않는다.

## fail-closed 매트릭스 (보안 핵심 — v1 OQ1의 계승·해소)

| 상태 | 분류(위험 여부) | gated 좌표의 판정 |
|---|---|---|
| 유효 캐시(TTL 내) | baseline + org 번들 | 정상(RBAC/step-up 경로) |
| 캐시 만료 + 백엔드 불가 | baseline + **만료 번들 유지**(last-known-good) | 정상 — 단 stale 경고를 deny/추가 컨텍스트 메시지에 표기 |
| 캐시 없음 + 백엔드 불가 | **baseline only** | 시스템 보호 도구(tool-rules 대상)는 **deny** + 사유 메시지 |
| RBAC 질의 실패 | — | 기존대로 `?? 2`(step-up 강제) — H와 정합 |

- 내장 baseline = 공개 `danger-patterns` + **최소 시스템 룰 셋**(고위험 admin 도구의 deny 좌표) — 번들 없이도 바닥 보호가 동작한다(설계 불변식 3). Claude Code managed-settings의 "캐시 자가영속 + 강제 갱신 시 fail-closed" 패턴을 차용(agentpatterns).
- break-glass: 게이트 무력화는 기존 비대칭 규칙대로 **human의 `transcodes disable`** 뿐. 번들 경로에 새 우회를 만들지 않는다(`.claude/rules/stepup-gate.md` 선행 필독).

## 병합 순서 (G3)

`loadMergedToolRules()`: 내장 baseline → org 번들(우선) → user rules(최우선, 기존 유지). 충돌 시 동일 `id`는 org 번들이 baseline을 덮고, user는 둘 다 덮는다(기존 user-rule 의미론 보존).

## 미설계 세부 (착수 후 결정)

- ~~304/ETag vs revision 쿼리 파라미터~~ — G1에서 revision 쿼리 파라미터로 구현. 백엔드가 ETag를 선호하면 fetch만 소폭 수정.
- baseline에 남길 최소 시스템 룰 셋의 범위(D2와 연동).
- 번들에 danger-patterns 추가분을 포함할지 1차 범위에서 tool-rules만 할지(권장: 1차 tool-rules만). G1 스키마는 미지 필드 전방 호환으로 `patterns` 자리를 열어 둠.
- **로컬 user 레이어의 처분** — custom rule이 저장소/번들로 들어오면 `user-tool-rules.json`의 역할은 (a) 오프라인 폴백 (b) 머신 개인 오버라이드 (c) 폐지 중 결정 필요. **G3의 병합 순서 구현 전에 정해야 한다**(안 정하면 곧 깨질 의미론을 구현하게 됨).

## blocking / 관련 결정

- **D2 (affects)** — 시스템 tool-rules 기밀성. 권고(비밀 아님)대로면 baseline에 시스템 룰 전체를 둬도 됨 — 그 경우 번들은 "조직 커스텀 + 갱신 채널" 역할.
- **D3 (affects)** — 무결성 방식. 기본값(TLS+SHA-384)으로 착수 가능, blocker 아님.
- **D5 (affects, 신설)** — 번들 스코프 org vs project. 권고: project(백엔드 테넌트 패턴 정합). 캐시 파일명·토큰 claim 사용처에 영향.
- 백엔드 룰 저장소 일정 — G1은 픽스처로 선행 완료(#52), G2·G3 머지 전 합류 필요.

## 수용 기준

- PreToolUse 임계 경로에 네트워크 호출 0 (코드 검토 + smoke로 확인).
- 번들 fetch → SHA-384 검증 → 원자적 캐시 → 다음 hook에서 반영.
- 위 fail-closed 매트릭스 4행이 각각 smoke로 재현됨(특히 "캐시 없음+불가 → gated deny").
- 손상/스키마 불일치 번들 → 활성화 거부 + 기존 캐시 유지.
- 시스템 tool-rules가 plugin dist에서 제거되고(또는 baseline 최소셋만 잔존) 23종 smoke 통과(번들 픽스처 주입 방식 갱신 포함).

## 산출 파일(예상)

- `private/packages/stepup-core/src/policy-bundle.ts` (fetch/검증/캐시; I 이후 위치 재배치)
- `private/packages/danger-rules/src/` 병합 순서 개편 + baseline 분리
- 훅 4종 session-start 계열 + MCP 서버 기동 refresh 배선
- 번들 스키마(zod) + 픽스처 + smoke 갱신
- (백엔드 — 코드 외) 정책 번들 API 1본
