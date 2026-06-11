# Phase 3 / Unit B — SHA384 매니페스트 + S3/CloudFront 배포

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M2
> 상태: 🗑 **Superseded (2026-06-10, v2 전환)** — CDN 번들 배포 자체가 폐기됨. 무결성 검증·revision 개념은 [Unit G](./G-policy-bundle.md)의 정책 번들로 계승. 근거: [`boundary-redesign.md`](../../research/boundary-redesign.md). 이하는 기록용 원문.
> ~~규모: **L** · 선행: [A](./A-obfuscate-build-done.md) · 외부 의존: **AWS 인프라·도메인·secrets** · 상태: ⚠️ Blocked (인프라)~~

## 규모 산정

- **L (Large)** — 복수 PR + **사람이 프로비저닝해야 하는 외부 인프라**.
- 내부 phasing(권장):
  - **B1 인프라** — S3 버킷 + CloudFront 배포 + IAM + `cdn.transcodes.dev` 도메인/인증서. (IaC 또는 콘솔; **코드만으로 완결 불가**, human 필요.)
  - **B2 배포 파이프라인** — A 산출물의 SHA384 계산 → S3 sync → CloudFront invalidation → 매니페스트 게시. (`.github/workflows/` 신규 + secrets.)
- 워크플로 yaml은 작성 가능하나 **secrets/도메인/버킷 없이는 동작·검증 불가**가 핵심 blocker.

## 요구사항

[A](./A-obfuscate-build-done.md) 산출물(`guard-<version>.mjs`)의 SHA384를 계산해서:
1. **로더 소스에 핀 상수로 박고** ([Unit C](./C-cdn-loader.md)와 연동)
2. 별도 **매니페스트(JSON)로도 게시**

## CDN 경로

메이저 버전 단위 분리: `cdn.transcodes.dev/guard/v1/guard-<ver>-<sha384>.mjs` (split.md §4.3).

## 인프라

- S3 버킷 + CloudFront 배포.
- `.github/workflows/`에 배포 워크플로 신규(S3 sync + CloudFront invalidation).
- **필요 secrets**: AWS 자격(OIDC 권장) / 배포 타깃 / 도메인.

## 무결성

Node에 SRI 표준이 없으므로 `crypto.createHash('sha384')`로 자체 검증 구현(split.md §2.3, §2.5). 게시된 SHA384 == 로컬 계산값 == 로더 핀 상수, 셋의 일치가 신뢰 사슬.

## 미설계 세부

- 매니페스트 스키마(version / sha384 / url 필드).
- 버전 핀 갱신 절차(→ OQ3).
- CloudFront 캐시 정책(immutable + 해시 파일명).

## blocking Open Questions

- **OQ2 (blocker)** — CDN 도메인 `cdn.transcodes.dev` 확정? S3+CloudFront vs 대안? **인프라 착수 전 확정 필수.**
- **OQ3 (blocker, 공유 with C)** — 버전 핀 갱신 흐름. 새 backend 배포 시 로더 핀 상수 갱신/릴리스 방법(`gate-contract` 메이저 bump 연동?).

## 수용 기준

- 배포 워크플로가 번들 업로드 + 매니페스트 게시 + CloudFront 무효화 완료.
- 게시된 SHA384가 로컬(A) 계산값과 일치.
- (B2 한정) 워크플로 dry-run/스테이징 검증.

## 산출 파일(예상)

- `.github/workflows/cdn-deploy.yml`
- 매니페스트 게시 스크립트 + 스키마 정의
- IaC(선택) — 버킷/배포/IAM 정의
- (인프라 자체는 코드 외 — human 프로비저닝)
