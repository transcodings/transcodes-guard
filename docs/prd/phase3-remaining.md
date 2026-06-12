# Phase 3 v2 — 잔여 작업

> 갱신: 2026-06-13. 이 문서가 phase3의 **남은 일 전부**다. 완료·취소된 단위 문서(A·E·H·G·B·C·D·F)와 부모 인덱스는 제거됐다 — 이력은 PR #44/#48/#50/#52/#54/#382.

**이미 완료(맥락용):** 정책 번들 게이트의 핵심 경로는 완성됐다 — 클라이언트(G1/G2/G3, npm 0.14.0), 백엔드 guard 모듈(`/v1/guard` B-1 번들 + B-2 룰 CRUD + 부팅 인덱스 자동생성, PR #382 머지), 서버 결정 봉합(H, #54), 난독화 폐기(A), lint 경계 승격(E, #48).

남은 일은 셋: ① 룰 쓰기 경로의 백엔드 일원화, ② 백엔드 보안 마감(§2)·검증(§3)·게이팅(§4), ③ 공개 트랙(라이선스 I → 공개 J).

---

## 1. MCP 룰 쓰기 → 백엔드 배선 (진행 중)

**목표:** 제품 본질은 조직 내 다수 인간/AI 에이전트의 공동 관리다 — 룰은 관리자가 통제하는 **공통 제약**이어야 한다. 따라서 per-user 로컬 파일(`saveUserToolRules`) 방식을 제거하고, 룰을 백엔드 프로젝트 정책(B-2)으로 일원화한다.

- `add_tool_rule`/`update_tool_rule`/`remove_tool_rule`(MCP) → 로컬 JSONC 대신 **B-2 CRUD**(`POST/PUT/DELETE /v1/guard/rules`) 호출. 쓰기 후 `refreshPolicyBundle({force})`로 캐시 갱신 → 다음 훅에 즉시 반영.
- `loadMergedToolRules`를 **baseline → bundle 2계층**으로 축소(user 레이어 완전 제거). `danger-rules`의 `load/save/add/update/removeUserToolRule`·`getUserToolRulesPath`·`userToolRulesFileExists` 제거, `ToolRuleSource`에서 `'user'` 제거.
- 영향: `gate-contract` seam을 async화(`addToolRule`/`updateToolRule`/`removeToolRule`), `stepup-core`에 백엔드 쓰기 flow 신설, `private/cli` 대시보드를 백엔드 flow로 전환, dist 재빌드.
- **결정(확정):** ① 프로젝트 공유 정책(B-2 그대로), ② user 레이어 완전 제거, ③ 쓰기 권한 게이팅은 지금 하지 않음(→ §4).

### 수용 기준
- [ ] 세 MCP 툴이 백엔드에 쓰고, 로컬 `user-tool-rules.json`을 더는 읽지·쓰지 않는다.
- [ ] 쓰기 후 캐시가 갱신돼 다음 PreToolUse 훅이 새 룰을 적용한다.
- [ ] 토큰 없으면 명확한 에러(로컬 폴백 없음). 빌드·type-check·smoke green + dist 재빌드 커밋.

## 2. `check-permission`의 `@SkipAuth` 제거 (후속, 블록됨)

`POST /v1/auth/role/check-permission`이 여전히 `@SkipAuth()` — body의 project_id/member_id만으로 무인증 권한 조회가 가능해 "결정 권한 봉합"(H) 취지와 어긋난다.

- **블로커(실재):** 소비자 전수 조사 결과 백엔드 내부 `src/toolkit/sdk/domain/domain.rbac.ts`의 Toolkit SDK가 이 엔드포인트를 **토큰 없이**(`credentials:'include'`만) 호출 중. `@SkipAuth` 제거 시 401로 파손. → SDK 호출 경로의 토큰 전달 마이그레이션이 선행돼야 하는 별도 PR.
- 전환 후 body의 project_id/member_id를 Principal claim과 대조(불일치 403)하면 봉합 완성.

## 3. 백엔드 e2e 검증

- staging/실백엔드 대상 1회: `transcodes policy refresh` → 캐시 생성 → 훅 gate 확인(§1 배선 후, J 체크리스트 "정책 번들 fetch end-to-end" 사전 충족).
- guard B-1/B-2 controller e2e(supertest): 무토큰 401 · 304 · CRUD→revision 반영. (단위 테스트는 #382에서 완료, e2e는 미작성.)

## 4. 룰 쓰기 권한 게이팅 (후속)

§1은 "게이팅 없이 배선만"으로 확정 — 일단 토큰 있는 누구나 B-2에 쓸 수 있다. 관리자 통제 강화는 후속:

- 후보 A(권장): 룰 변경(add/update/remove)을 **step-up MFA로 게이팅** — 에이전트가 자신을 묶는 제약을 바꾸려면 사람의 승인 필요(게이트의 자기보호·독풋팅).
- 후보 B: B-2 쓰기 엔드포인트에 RBAC level 체크(관리자/owner만) 추가.

## 5. Unit I — 라이선스 전환 + `private/` flatten (게이트: **D1**)

보이는 코드의 상업적 보호를 난독화가 아니라 **라이선스**로 전환하고, 정책 데이터가 백엔드로 분리돼 "비밀"이 사라진 `private/` 구분을 해체한다. 규모 **M**(1~2 PR + 사업 결정 1건 + 워크스페이스 재배치). 라이선스는 한 번 공개하면 비가역.

### D1 — 라이선스 선택 (human 결정, 본 단위의 게이트)
권고: **FSL-1.1-Apache-2.0** — 2년 후 해당 버전이 Apache-2.0으로 자동 전환(DOSP). 경쟁 SaaS 제공은 "Protected Use"로 금지. dev-tool 선례(Sentry), 낮은 커뮤니티 반발.

| 선택지 | 전환 | 비고 |
|---|---|---|
| **FSL-1.1-Apache-2.0 (권고)** | 2년 → Apache-2.0 | 시한부 OSS 약속이 신뢰 서사와 정합 |
| BUSL-1.1 | ≤4년 → GPL-호환 | Additional Use Grant 자유도↑, HashiCorp 평판 비용 |
| ELv2 | 없음(영구) | 라이선스 키 우회 금지 명시, OSS 전환 부재 |

결정 시 함께 확정: 기여자 동의(사내 단일 — 간단) · npm `license` 필드 일괄 갱신 · 외부 기여 정책(CLA).

### private/ 해체 + flatten (D1 후)
```
public/packages/* + private/packages/*  →  packages/*
public/plugins/*                        →  plugins/*
private/cli                             →  cli
```
- 루트 `workspaces` 3-glob(`packages/*`·`plugins/*`·`cli`). turbo.json 변경 불요(워크스페이스 glob에서 패키지 인식).
- `git mv`로 이동(rename 추적), scope 리네임 `@transcodes-guard-private/*` → `@transcodes-guard/*`.
- 경로 참조 일괄 갱신(biome overrides, CI 경로, tsup/tsconfig, CLAUDE.md).
- **유지:** `GateBackend` DI seam(backend.ts 4개) — 비밀 경계가 아니라 코드 경계로 재정의. E의 `noRestrictedImports`는 "seam 외 `gate-backend` import 금지" 아키텍처 규칙으로 **재조준**(제거 아님). publish-surface 게이트는 발행 통제가 남는 패키지에만 잔존.

### 수용 기준
- [ ] 루트 LICENSE + 전 패키지 `license` 필드 일관(D1 반영).
- [ ] `private/`·`public/` 디렉토리 부재(flatten 완료), 루트 `workspaces` 3-glob, 빌드·type-check·smoke green.
- [ ] seam 외 `gate-backend` import 시 biome error 유지. npm tarball에 LICENSE 포함 + `files` allowlist(`npm publish --dry-run` CI).

## 6. Unit J — 공개 전환 (선행: I)

본 리포(또는 1회 필터링 사본)를 외부 공개하고, 4호스트 설치 경로가 공개 리포에서 동작함을 검증한다. 규모 **S**(대부분 human, 공개는 비가역 스위치).

- **D4 해소(2026-06-12):** 전수 스캔 2종 + 수동 감사 전부 클린 → **본 리포 직접 공개(filter-repo 불요)** 확정.
  - gitleaks v8(189 커밋) leaks 0 · trufflehog v3.95.5(7260 chunks) verified/unverified 0 · JWT형 grep 0건.
- 남은 것: 공개 직전 재스캔 1회 → repo public 전환 → 4호스트 설치 검증(번들 fetch 포함) → 1주 모니터링.
- **I 전 공개 금지** — 라이선스 없는 공개가 되므로. G·I 선행.

### 수용 기준
- [ ] 공개 상태에서 4호스트 설치 + 게이트 동작(번들 fetch 포함) 검증 기록.
- [ ] 히스토리 시크릿 0(공개 직전 재스캔) · 공개 후 1주 모니터링 이상 신고 0.

---

## 실행 순서

```
[클라이언트] §1 룰 쓰기 백엔드 배선(진행 중) ──┐
[백엔드]    §2 @SkipAuth 제거(SDK 토큰 선행) ─┼─→ §3 e2e 검증 ─→ §4 게이팅(후속)
[human]    D1 결정 ─→ §5 Unit I(flatten) ──┴──────────────────→ §6 Unit J 공개
```
