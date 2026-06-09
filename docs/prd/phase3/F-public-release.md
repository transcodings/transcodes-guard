# Phase 3 / Unit F — public 미러 공개

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M6
> 규모: **S** (대부분 human) · 선행: **A~E 전부** · 외부 의존: 위 전부 · 상태: 🚫 **Gated (최종 스위치)**

## 규모 산정

- **S (Small)** — 코드 작업은 적으나 **되돌릴 수 없는 human 스위치**.
- 작업: repo 공개 전환 + 호스트별 설치 동작 확인 + CDN 로더 fetch 확인.
- 리스크: 공개는 비가역 — A~E + [D 검증 체크리스트](./D-mirror-automation.md)가 전부 그린이어야 한다.

## 요구사항

`transcodes-guard` public repo를 외부 공개로 전환한다.

## 선행 조건

- [A](./A-obfuscate-build.md) · [B](./B-cdn-deploy.md) · [C](./C-cdn-loader.md) · [E](./E-lint-promotion.md) **전부 완료**.
- [D](./D-mirror-automation.md) 검증 체크리스트 **그린**(private 히스토리/평문 누출 0, 수동 감사 통과).

## 배포 채널

미러 리포 자체가 곧 배포 채널(호스트가 repo URL로 직접 plugin 설치 — distribution.md). npm은 Claude Code 한정 선택 채널.

## blocking Open Questions

- 직접 blocker는 없으나 **A~E의 모든 OQ가 해소돼야 도달** 가능.

## 수용 기준

- 공개 리포에서 **호스트별 설치가 동작**(claude-code / codex / antigravity / cursor).
- **CDN 로더가 backend를 정상 fetch**(캐시 미스→fetch→검증→주입).
- 공개 후 private 코드/히스토리 노출 0(공개 직후 재감사).

## 산출물

- 공개 전환된 `transcodes-guard` public repo.
- 호스트별 설치 검증 기록.
