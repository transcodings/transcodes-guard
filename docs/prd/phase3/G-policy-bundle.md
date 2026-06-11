# Phase 3 v2 / Unit G — 정책 번들 분리 (policy-as-data)

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M7
> 규모: **L** · 선행: 없음 · 외부 의존: **백엔드 룰 저장소 + CRUD + 번들 읽기 뷰(사내) — §백엔드 구현 명세가 단일 소스** · 상태: 🔧 **In progress** (G1 → [#52](https://github.com/transcodings/ai-action-tracker-mcp/pull/52))
> 근거: [`boundary-redesign.md`](../../research/boundary-redesign.md) §2 (OPA 번들 패턴 + 운영 파라미터)

## 규모 산정

- **L (Large)** — 복수 PR + 백엔드 룰 저장소/API + 보안 임계(fail-closed) + 4호스트 smoke 갱신.
- 내부 phasing(권장):
  - **G1 번들 계약 + 클라이언트 코어** — 번들 스키마/manifest 검증/캐시 읽기·쓰기. 백엔드 API와 병행 개발 가능(픽스처 우선). → 🎉 **PR #52** (`stepup-core/src/policy-bundle.ts`, 단위 테스트 18종)
  - **G2 refresh 배선** — SessionStart 계열 훅 4종 + MCP 서버 기동 시 TTL refresh(비차단). G1 fetch에 envelope unwrap 보정 포함(§백엔드 구현 명세 B-1).
  - **G3 데이터 이관** — 시스템 tool-rules를 번들 소스-오브-트루스에서 내장 baseline/org 번들로 분리, `loadMergedToolRules()` 병합 순서 개편.

## 요구사항

시스템/조직 정책(tool-rules, 향후 danger-pattern 추가분)을 **코드·번들에 굽지 않고** 백엔드가 org-scoped로 배포한다. 클라이언트는 fetch → 무결성 검증 → 로컬 캐시 → 동기 로컬 평가.

## 백엔드 구현 명세 — 무엇을 만들어야 하는가 (단일 소스, 2026-06-10 탐사 기준)

> 대상 리포: `transcode-backend-nestjs-v1` (사내). 이 섹션이 백엔드 작업의 **유일한 명세**다 — 다른 섹션·문서에 흩어졌던 사실관계를 여기로 통합한다.

### 0. 전제 사실 (탐사로 확정)

| 사실 | 출처 |
|---|---|
| 정책/룰 저장소가 백엔드에 **존재하지 않음** — 전부 신규 모듈 | 리포 전수 탐사 (RBAC 매트릭스·SW 캐시 룰뿐) |
| 스택: NestJS 11 + **MongoDB native driver**(ORM 없음) + Redis, class-validator DTO, Vitest | `package.json`, `src/global/pipes/validation.pipe.ts` |
| 인증: `X-Transcodes-Token` → `AuthGuard`/`MatVerifier` → `@Principal()`에 `organizationId/projectId/memberId` claim | `src/global/guards/auth.guard.ts` |
| **모든 응답이 envelope으로 래핑**: `{ logId, success, statusCode, payload: [...], error }` — 단일 객체도 배열화 | `src/global/interceptors/response.interceptor.ts` |
| 테넌트 패턴은 **project 중심** (`_project_id` 필터; org는 project의 상위) | entity 전반, → D5 |

### 1. 만들 것 A — 룰 저장소 (단일 소스-오브-트루스)

- MongoDB 엔티티: 클라이언트 `ToolRule` 스키마 미러(`id, toolName, reason, stepupAction(CRUD enum), stepupResource, consume_in_hook?`) + 스코프 키(D5) + 단조 증가 `revision` 관리.
- **시드**: 현 `private/packages/danger-rules/src/data/tool-rules.json`의 시스템 룰 13종을 저장소에 적재. G3 배포 전에 서빙 가능 상태여야 한다(안 그러면 G3 배포 순간 기존 보호가 후퇴).
- **read-only로 짓지 않는다.** "custom rule의 리모트 관리"는 별도 시스템이 아니라 이 저장소의 쓰기 주체가 하나 늘어나는 것(같은 스키마·같은 스코프·같은 배포 채널 — 재발명 금지). revision 증가는 쓰기 시점에 일어난다.

### 2. 만들 것 B — 엔드포인트 2종

**B-1. 번들 읽기 뷰** (G2·G3의 소비 대상):

```
GET /v1/guard/policy-bundle?revision=<클라이언트 보유 revision>
  인증: @AuthPolicy('apitoken') — X-Transcodes-Token. 스코프는 @Principal() claim에서.
  → 200: payload[0] = { revision: string, rules: ToolRule[], manifest: { sha384: string } }
  → 304: 쿼리 revision이 현재와 동일 (본문 없음)
```

- **manifest.sha384** = `manifest` 필드를 제외한 번들 객체의 **canonical JSON(객체 키 재귀 정렬, 공백 없음)** hex SHA-384. 클라이언트(#52)가 핀 해시 테스트로 고정한 계약 — 백엔드는 동일 캐노니컬라이제이션으로 계산해야 한다(참조 구현: `stepup-core/src/policy-bundle.ts`의 `policyBundleSha384`). 해시 대상은 번들 객체이지 envelope이 아니다.
- `revision`은 단조 증가 식별자 — v1 OQ3(버전 핀)을 대체. 클라이언트는 핀하지 않고 최신을 따른다.
- 304 메커니즘은 revision 쿼리 파라미터로 G1에 구현됨. 백엔드가 ETag를 선호하면 클라이언트 fetch만 소폭 수정.
- 클라이언트 측 소비: `payload[0]` unwrap(기존 `rbac-check.ts` 패턴) → zod 파싱(미지 필드는 해시에 포함하되 제거 — 전방 호환) → 검증 후 활성화. G1(#52)은 본문 직접 수신을 가정했으므로 **unwrap 보정은 G2 범위**.

**B-2. 룰 CRUD** (쓰기 — 콘솔이 1차 소비자, MCP 툴 이전은 후속 단위):

```
POST / PUT / DELETE /v1/guard/rules[/:id]
  인증: @AuthPolicy('apitoken' | 'firebase')
  쓰기 성공 시 revision 증가 → 다음 번들 fetch에 반영
```

- MCP 툴(`add_user_tool_rule` 계열)의 쓰기 경로를 로컬 파일 → 이 CRUD로 이전하는 작업은 **G 범위 밖**(후속 단위로 문서화). 단, 설계는 처음부터 그 소비자를 전제한다.

### 3. 만들지 않는 것 (명시적 비범위)

- **결정 감사 수신 API** — 불필요. Unit H가 기존 `POST /v1/audit/logs`(`src/audit/`)를 재사용한다([H 문서](./H-server-decision.md) H2).
- **Ed25519 서명 인프라** — D3: 1차는 TLS + SHA-384 manifest. detached signature는 실위협 등장 시.
- **위험 분류 API** — NG2: 분류는 로컬 평가. 백엔드는 데이터 배포·판정·승인·감사만.

### 4. 단계별 요구 수준 (클라이언트 머지 게이트)

| 클라이언트 단계 | 백엔드 선행 요건 |
|---|---|
| G1 (#52, 완료) | 없음 — 픽스처로 개발·검증 |
| **G2** (refresh 배선) | **B-1 엔드포인트 실존** (시드 데이터는 최소여도 됨) |
| **G3** (데이터 이관) | **저장소 + 시스템 룰 13종 시드 + B-1 서빙 안정화** |

### 5. 걸린 결정

- **D5 — 스코프 org vs project**: 본 문서는 org-scoped로 기술해 왔으나 백엔드 테넌트 패턴은 project 중심. 토큰 claim에 둘 다 있어 기술적으론 양쪽 가능 — **project 권고**. 채택 시 클라이언트 캐시 파일명은 `policy-bundle.<projectId>.json`(G2에서 반영).
- **D2 — 시스템 룰 기밀성**: 권고(비밀 아님)대로면 baseline에 시스템 룰 전체를 둬도 됨 — 그 경우 번들의 역할은 "조직 커스텀 + 갱신 채널"로 좁아지고 G3의 "dist에서 제거" 범위도 줄어든다.
- **D3 — 무결성 방식**: 기본값(TLS+SHA-384)으로 확정 착수. blocker 아님.

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

§백엔드 구현 명세의 **§4 단계별 요구 수준**(G2·G3 머지 게이트)과 **§5 걸린 결정**(D2·D3·D5)이 단일 소스다 — 여기 중복 기재하지 않는다.

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
- (백엔드) §백엔드 구현 명세의 룰 저장소 + 엔드포인트 2종 + 시스템 룰 시드
