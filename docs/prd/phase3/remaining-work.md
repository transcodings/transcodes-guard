# Phase 3 v2 — 잔여 작업 (단일 목록)

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 작성: 2026-06-12 (백엔드 `dev` 최신 재탐사 기준)
> 완료 단위 문서(A·E·H)는 제거됨 — 내역은 PR #44 / #48 / #54. G의 클라이언트 측도 완료(#52·#58·#60·#65·#67·#70, fail-closed 매트릭스 4행 smoke/단위 테스트 검증).

이 문서가 phase3의 **남은 일 전부**다. 크게 셋: ① 백엔드 리포 작업(아래 상세 스펙 — 본 문서가 단일 명세, G 문서 §백엔드 구현 명세를 대체), ② D1 결정 → Unit I, ③ Unit J 공개.

---

## 1. 백엔드 리포 작업 — `transcode-backend-nestjs-v1`

> 사실관계는 2026-06-12 `dev`(HEAD `1644c6f7`) 재탐사로 재확인함. 파일:라인은 그 시점 기준.

### 1-0. 재확인된 전제 (스펙의 근거)

| 사실 | 근거 |
|---|---|
| 인증 데코레이터는 `@AuthPolicy('firebase' \| 'apitoken')`, 무지정 시 둘 다 허용 | `src/global/decorators/auth-policy.decorator.ts:23-25` |
| apitoken 채널 = `X-Transcodes-Token` 헤더, `req.principal`에 `{organizationId, projectId, memberId}` (MAT claim `organization_id/project_id/member_id`에서 변환) | `src/global/guards/auth.guard.ts:156-163`, `src/auth/verifiers/mat.verifier.ts:68-76` |
| 응답 envelope `{logId, success, statusCode, payload: T[], error}` — 단일 객체도 배열화, **`_` 접두 필드 제거 + `_id`→`id` 변환** | `src/global/types.ts:7-12`, `src/global/interceptors/response.interceptor.ts:42-102` (필드 변환 line 30, 배열화 line 87) |
| 304 등 raw 응답은 `@Res()` 직접 사용 선례 있음 | `src/gateway/gateway.controller.ts:68` |
| MongoDB native driver + `BaseRepository<T>`(`collectionName` 선언), 테넌트 필터 `{_project_id: toObjectId(...)}` | `src/database/mongodb/repositories/base.repository.ts:32-39`, `src/audit/audit.service.ts:242` |
| 인덱스는 엔티티 파일이 아니라 컬렉션 셋업에서 선언(주석 문서화 관례는 service doc comment) | `src/audit/audit.service.ts:131-152` |
| URI versioning `defaultVersion '1'` → `@Controller('guard')` = `/v1/guard` | `src/main.ts:45-49` |
| `POST /v1/auth/role/check-permission`은 **여전히 `@SkipAuth()`** | `src/auth/auth.role.controller.ts:162` |
| `POST /v1/audit/logs`는 `@SkipAuth()` — guard 결정 감사(H2)가 이미 사용 중, 변경 불요 | `src/audit/audit.controller.ts:79` |
| 'guard policy bundle / tool-rule' 관련 기존 코드 **없음** — 전부 신규 | dev 전수 검색 |
| 테스트는 Vitest(`.spec.ts`) + `Test.createTestingModule`, mock repository 헬퍼 | `vitest.config.ts`, `test/helpers/` |

### 1-1. 신규 모듈 `src/guard/` (audit 모듈 구성 복제)

```
src/guard/
  guard.module.ts            # AppModule imports 배열에 등록 (src/app.module.ts)
  guard.controller.ts        # @Controller('guard') → /v1/guard
  guard.service.ts           # 번들 조립 + canonical SHA-384 + revision 관리
  project-guard-rules.repository.ts   # BaseRepository<ProjectGuardRule>
  dtos/
    GuardRuleResponse.dto.ts
    CreateGuardRule.dto.ts / UpdateGuardRule.dto.ts
    PolicyBundleResponse.dto.ts
  params/guard.params.ts     # revision 쿼리 DTO
```

### 1-2. 엔티티 — `project_guard_rules` 컬렉션

클라이언트 `ToolRule` 스키마의 미러 + 테넌트 스코프(D5: **project**):

```ts
// src/database/mongodb/entities/project-guard-rule.entity.ts
{
  _id: ObjectId,
  _project_id: ObjectId,        // 테넌트 필터 관례
  rule_id: string,              // 클라이언트 ToolRule.id — /^[a-z0-9][a-z0-9-]*$/, (project, rule_id) unique
  tool_name: string,            // 정확 일치 매칭 대상 (regex 불허 — 클라이언트와 동일 제약)
  reason: string,
  stepup_action: 'create'|'read'|'update'|'delete',
  stepup_resource: string,
  consume_in_hook?: boolean,
  created_at: Date, updated_at: Date,
}
```

- **revision**: 별도 컬렉션 `project_guard_policy_meta` `{_project_id, revision: number}` — 룰 쓰기(생성/수정/삭제) 성공 시 `$inc: {revision: 1}` (application-level 증가는 passkey `prev_counter` 선례). 클라이언트 계약상 revision은 **string** — 응답 시 `String(revision)`.
- 인덱스(컬렉션 셋업 + service doc comment 관례): `{_project_id: 1, rule_id: 1}` unique · `{_project_id: 1, tool_name: 1}`.
- **시드**: ai-action-tracker `private/packages/danger-rules/src/data/tool-rules.json`의 시스템 룰 13종. D2(비밀 아님) 채택으로 클라이언트 baseline에도 전체가 잔존하므로, 시드 전이라도 보호 후퇴는 없다 — 시드의 역할은 "조직 커스텀의 출발점 + 갱신 채널 검증"으로 축소. 시드 스코프는 시스템 전역이 아니라 project 생성 시 복사(또는 빈 상태 시작) 중 택일 — 구현 시 결정, 클라이언트는 어느 쪽이든 동작.

### 1-3. 엔드포인트 B-1 — 번들 읽기 뷰 (클라이언트 G2/G3의 소비 대상)

```
GET /v1/guard/policy-bundle?revision=<클라이언트 보유 revision>
  @AuthPolicy('apitoken')               // X-Transcodes-Token, 스코프는 @Principal().projectId
  쿼리 DTO: { revision?: string }       // @IsOptional() @IsString()

  → 200 (revision 불일치 또는 미보유):
    payload[0] = {
      revision: string,                  // 현재 meta revision
      rules: [{ id, toolName, reason, stepupAction, stepupResource, consume_in_hook? }],
      manifest: { sha384: string }
    }
  → 304 (쿼리 revision == 현재 revision): 본문 없음 — @Res() 직접 사용(gateway.controller 선례)
```

**계약 핵심 — 클라이언트가 핀 테스트로 고정한 것들 (위반 시 클라이언트가 번들 활성화를 거부):**

1. **camelCase 필드명**: 클라이언트 zod 스키마는 `toolName/stepupAction/stepupResource`를 기대한다. 엔티티는 snake_case이므로 service에서 **DTO로 명시 변환**해야 한다.
2. **manifest.sha384** = `manifest` 필드를 제외한 번들 객체 `{revision, rules}`의 **canonical JSON**(객체 키 재귀 정렬, 배열 순서 유지, 공백 없음, undefined 필드 제거) hex SHA-384. 참조 구현: ai-action-tracker `private/packages/stepup-core/src/policy-bundle.ts`의 `canonicalJson`/`policyBundleSha384` — 핀 회귀 해시가 클라이언트 테스트에 박혀 있으므로 **동일 캐노니컬라이제이션을 포팅**하고, 같은 픽스처로 양 리포 교차 테스트를 둘 것.
3. **해시는 envelope 바깥이 아니라 payload[0] 내용물 기준**. response interceptor가 `_` 접두 필드를 제거하고 `_id→id`를 변환하므로(line 30), **해시 계산은 interceptor를 통과한 뒤의 최종 형태와 일치해야 한다** — 안전한 방법: service가 ObjectId/underscore 필드가 전혀 없는 plain DTO를 만들고 그 객체로 해시를 계산해 그대로 반환.
4. 미지 필드 추가는 안전(클라이언트는 해시에 포함 후 스키마에서 제거 — 전방 호환). 단 추가하는 순간부터 해시 대상이므로 양쪽 픽스처 갱신 필요.

### 1-4. 엔드포인트 B-2 — 룰 CRUD (콘솔이 1차 소비자)

```
POST   /v1/guard/rules        @AuthPolicy('firebase', 'apitoken')
PUT    /v1/guard/rules/:id    (:id = rule_id)
DELETE /v1/guard/rules/:id
```

- body DTO 검증(class-validator): `rule_id` 패턴, `tool_name` 비공백·셸 명령 금지(공백/메타문자 거부 — 클라이언트 `detectShellCommand`와 동일 규칙), `stepup_action` `@IsIn(['create','read','update','delete'])`, `stepup_resource` 비공백.
- 쓰기 성공 시 meta revision `$inc` → 다음 B-1 fetch에 반영. 응답은 갱신된 룰 + 새 revision.
- MCP 툴(`add_user_tool_rule` 계열)의 쓰기 경로 이전은 **후속 단위**(범위 밖) — 단 스키마는 이 소비자를 전제.

### 1-5. 보안 수정 — `check-permission`의 `@SkipAuth` 제거

- `src/auth/auth.role.controller.ts:162`의 `@SkipAuth()`를 제거하고 `@AuthPolicy('apitoken')`으로 전환. 현재는 body의 project_id/member_id만으로 **무인증 권한 레벨 조회**가 가능해 "결정 권한 봉합"(H) 취지와 어긋난다.
- 호환성: transcodes-guard 클라이언트는 이미 `X-Transcodes-Token`을 보낸다(`stepup-core/src/rbac-check.ts`) — 클라이언트 변경 불요. **다른 내부 소비자(Toolkit SDK 등)가 무토큰 호출 중인지 사전 조사 필수** — 이것이 이 항목의 유일한 위험.
- 전환 후 body의 project_id/member_id를 Principal claim과 대조(불일치 시 403)하면 봉합이 완성된다.

### 1-6. 테스트 (Vitest)

- service 단위: canonical 해시 핀(클라이언트 픽스처와 동일 입력→동일 출력), revision 증가, 304 분기.
- controller e2e(supertest): 무토큰 401 · 타 project 토큰의 교차 접근 차단 · 304 · CRUD→revision 반영.

### 1-7. 백엔드 완료 후 ai-action-tracker 측 후속 (소규모)

- staging/실백엔드 대상 end-to-end 1회: `transcodes policy refresh` → 캐시 생성 → 훅 gate 확인 (J 체크리스트 "정책 번들 fetch end-to-end"의 사전 충족).
- G 문서 상태를 Done으로 마감, 본 문서에서 §1 제거.

## 2. Unit I — 라이선스 + `private/` 해체 (게이트: **D1**)

- 유일한 미결 결정 **D1**(FSL-1.1-Apache-2.0 권고, 사업 결정 — 대표 승인).
- 결정 즉시 착수 가능, 외부 의존 없음. 범위·수용 기준은 [`I-license.md`](./I-license.md) (M 규모: LICENSE + flatten + scope 리네임 + biome 재조준 + publish-surface 게이트 조정).

## 3. Unit J — 공개 전환 (선행: G 백엔드 마감 + I)

- D4는 해소됨(2026-06-12 스캔 클린 → 직접 공개, filter-repo 불요) — [`J-public-flip.md`](./J-public-flip.md) D4 절.
- 남은 것: 공개 직전 재스캔 1회 → repo public 전환 → 4호스트 설치 검증 → 1주 모니터링. 대부분 human 작업.

## 실행 순서

```
[백엔드] guard 모듈(1-1~1-4) ──┐
[백엔드] @SkipAuth 제거(1-5)  ─┼─→ e2e 확인(1-7) ─→ G 마감
[human]  D1 결정 ─→ I ────────┴────────────────────→ J 공개
```
