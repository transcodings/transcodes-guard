# Phase 3 v2 / Unit H — 결정 권한 봉합 (server decision authority)

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M8
> 규모: **S** · 선행: 없음 · 외부 의존: 결정 감사 API(사내, 부분) · 상태: ✅ **Ready**
> 근거: [`boundary-redesign.md`](../../research/boundary-redesign.md) §1 (결정 권한은 이미 절반 서버에 있음 — 잔여 갭만 봉합)

## 규모 산정

- **S (Small)** — 단일 PR 가능. 기존 백엔드 경로(`checkRbacPermission`, step-up recheck)는 완성돼 있고, 로컬 우회 잔재 2건만 처리.

## 요구사항

게이트의 **판정**이 항상 서버 권한 또는 명시적 fail-closed로 귀결되도록 잔여 갭을 막는다. 클라이언트가 공개되어도(Unit I) 우회 가치가 없는 상태가 목표다.

## 작업 항목

### H1 — `rbac-check.ts`의 좌표 불일치 fail-closed

현행 `extractPermission`은 응답 payload에서 (resource, action) 일치 항목이 없으면 `?? payload[0]` 로 **첫 항목의 permission을 차용**한다 — 다른 좌표의 권한으로 판정하는 셈. 일치 항목이 없으면 `null`을 반환해 호출자의 기존 fail-closed(`?? 2`, step-up 강제)로 떨어뜨린다.

- 회귀 주의: 백엔드가 단일 항목 배열로 응답하면서 resource/action 필드를 생략하는 케이스가 실재하는지 백엔드 응답 스펙 확인 — 실재하면 백엔드 수정이 선행(필드 항상 포함)이고, 클라이언트 폴백 유지는 답이 아니다.

### H2 — 게이트 결정 감사 로그

deny/step-up/allow-by-verified 결정을 백엔드로 전송(fire-and-forget, 실패 무시·비차단). 회피 시도 가시성이 "정책 공개로 탐지 회피" 위험(부모 §6)의 보상 통제다.

- hook 임계 경로 비차단: 전송은 `queueMicrotask`/타이머가 아니라 **응답 출력 후** 시도하고 짧은 timeout으로 끊는다(hook 프로세스 수명 내).
- 전송 내용: 좌표·결정·rule id·fp(명령 원문은 보내지 않는다 — 민감 데이터 최소화; 필요 시 해시).
- 백엔드 수신 API가 없으면 1차는 스키마 합의 + 클라이언트 측 구현, 활성화는 API 합류 시(부분 외부 의존).

### H3 — step-up 경로 점검 (검증만, 변경 없을 수 있음)

verified fast-path의 백엔드 sid recheck(MEMORY: 위조 sid 거부 확인됨)와 pending TTL 규칙이 v2 전제("클라이언트는 공개돼도 우회 불가")를 만족하는지 점검 체크리스트만 수행. 변경이 나오면 별도 이슈로 분리(범위 고정).

## blocking / 관련 결정

- 없음. **즉시 착수 가능.** H2의 백엔드 API만 부분 의존(스키마 선행 가능).

## 수용 기준

- 좌표 불일치 응답 → `null` → step-up 강제(level 2)가 단위 테스트로 고정.
- `payload[0]` 폴백 제거 후 기존 smoke(특히 RBAC level 분기) 전부 green.
- 감사 전송이 hook 결정 출력의 지연을 만들지 않음(timeout 짧게, 실패 무시 확인).
- H3 체크리스트 결과가 PR 본문에 기록됨.

## 산출 파일(예상)

- `private/packages/stepup-core/src/rbac-check.ts` (H1)
- `private/packages/stepup-core/src/` 결정 감사 전송 모듈 (H2)
- 단위 테스트 + smoke 갱신
- (백엔드 — 코드 외) 결정 감사 수신 API(스키마 합의 우선)
