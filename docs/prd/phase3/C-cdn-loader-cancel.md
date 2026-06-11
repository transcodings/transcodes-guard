# Phase 3 / Unit C — CDN 로더 (`backend.ts` 교체)

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M3
> 상태: 🗑 **Superseded (2026-06-10, v2 전환)** — 코드 로더가 폐기됨(`backend.ts` seam은 정적 import 그대로 유지). fail-closed·캐시·동시성 설계는 [Unit G](./G-policy-bundle.md)의 *정책 번들* fetch로 계승(코드가 아니라 데이터를 받는다). OQ1/3/4는 소멸 — 부모 §7 처분표. 이하는 기록용 원문.
> ~~규모: **L** · 선행: [A](./A-obfuscate-build-done.md), [B](./B-cdn-deploy-cancel.md) · 외부 의존: **설계 결정(OQ1/3/4)** · 상태: ⚠️ Blocked (결정 선행)~~

## 규모 산정

- **L (Large)** — 복수 PR + 보안 임계 경로 + 결정 선행.
- 내부 phasing(권장):
  - **C1 로더 코어** — fetch → SHA384 검증 → 캐시 → `import()` → `setGateBackend()`. fail-closed 정책, 동시성, TTL. (위치는 OQ4.)
  - **C2 seam 통합** — `public/plugins/*/backend.ts` 4개를 로더 호출로 교체 + 23종 smoke + 평문 inline 제거 확인.
- 게이트 보안 거동을 바꾸므로 **fail-closed 재설계**가 난이도·리스크의 핵심.

## 요구사항

`public/plugins/*/backend.ts`의 정적 import를 로더로 교체. 책임: **fetch → SHA384 검증 → 로컬 캐시 → `import()` → `setGateBackend()`.**

## 캐시 경로

`~/.transcodes/cache/guard-<version>-<sha384>.mjs` — 이미 CLI가 관리하는 디렉토리. **반드시 `@transcodes-guard/plugin-paths`의 `cacheDir()`로 해석**(CLAUDE.md: 경로 하드코딩 금지).

## Node 제약

HTTPS URL 직접 `import()` 불가 → **캐시 후 로컬 파일 `import()`가 유일한 현실안**(split.md §2.3 방식 1).

## fallback 정책 (보안 핵심)

네트워크 실패/검증 실패 시 거동. 게이트는 보안 컴포넌트 → **deny-by-default 또는 캐시된 마지막 검증본 사용** 중 결정 필요(→ OQ1).

기존 `denyByDefaultBackend`([`noop.ts`](../../../public/packages/gate-contract/src/noop.ts))와 정합 검토 — **미주입 시 hook 경로 `pass`는 "이 빌드는 출하 안 됨" 전제**였다(noop.ts 주석). **출하 로더에서는 fail-closed(deny) 거동으로 재설계 필요.** 부모 §6 "로더 fail-open" 위험과 직결.

## call site 불변

`getGateBackend()` 호출부(mcp-server-core + hooks)는 **변경 0** — seam 설계의 핵심. 로더 도입은 "누가 `setGateBackend()`를 호출하는가"만 바꾼다.

## docstring 번호 정정

`backend.ts`·`registry.ts`의 "Phase 2 (CDN)" 번호를 phase3 기준으로 정정(부모 §1, [Unit E](./E-lint-promotion-done.md)와 함께).

## 미설계 세부

- 캐시 무효화/TTL.
- 오프라인 폴백(OQ1과 연동).
- 버전 핀 갱신(OQ3).
- 동시성(여러 hook이 동시에 첫 fetch — 락/원자적 rename).

## blocking Open Questions

- **OQ1 (blocker)** — 로더 fallback 정책: 검증 실패/오프라인 시 deny-by-default vs 캐시된 마지막 검증본? (보안 vs 가용성.) **설계 확정 전 착수 불가.**
- **OQ3 (blocker, 공유 with B)** — 버전 핀 갱신 흐름.
- **OQ4 (blocker)** — 로더 패키지 위치: `@transcodes-guard/loader` 별도 public 패키지 vs `backend.ts` 인라인?
- **OQ5 (affects)** — public dist 평문 제거 타이밍(A~C 과도기).

## 수용 기준

- 캐시 미스 → fetch → SHA384 검증 → 주입 정상 동작.
- 검증 실패/오프라인 시 **안전 거동(fail-closed, OQ1 결정대로)**.
- 4개 호스트 **23종 smoke 통과**.
- `getGateBackend()` 호출부 변경 0(diff로 확인).
- public dist에 private 평문 inline 0.

## 산출 파일(예상)

- 로더 모듈: `@transcodes-guard/loader`(신규 패키지) 또는 `public/plugins/*/backend.ts` 인라인 (OQ4)
- `public/plugins/{claude-code,codex,antigravity,cursor}/backend.ts` 교체
- SHA384 핀 상수 소스(B와 연동)
- smoke 픽스처/CI 갱신
