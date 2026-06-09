# Phase 3 / Unit D — public 미러 자동화

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M5
> 규모: **M** · 선행: [A](./A-obfuscate-build.md)~[C](./C-cdn-loader.md)(사실상 — 평문 누출 제거가 선행돼야 안전) · 외부 의존: **target public repo·OQ7 결정** · 상태: ⚠️ **Blocked (결정)**

## 규모 산정

- **M (Medium)** — 1~2 PR + 결정(OQ7) + target repo 준비.
- 작업: filter-repo 미러 워크플로 + files allowlist + CLI 처리 + 검증 체크리스트 자동화.
- 리스크: **비공개 코드 영구 노출**(되돌리기 불가) → `--dry-run` + 수동 감사 필수. 그래서 A~C로 평문 누출이 제거된 뒤에 돌리는 게 안전.

## 요구사항

`git filter-repo --invert-paths --path private/`로 private 히스토리를 완전 제거한 미러를 `transcodes-guard` public repo로 push하는 워크플로.

## 타이밍 제약

공개 push 전에 디렉토리 분리가 끝나야 force-push 마찰이 없음 — **1단계로 이미 충족**(split.md §5.2).

## CLI tarball 예외

CLI tarball 빌드 job은 **full repo에서** 실행(미러 아님) — tsup이 private deps를 inline해야 함(release-dist.md).

## ⚠️ CLI 경로 충돌 (OQ7)

CLI(`@bigstrider/transcodes-cli`) 소스는 현재 **`private/cli/`** 에 있다. `--invert-paths --path private/`는 **CLI 소스까지 미러에서 제거** → public 미러에 control plane(enable/disable/tokens) 소스가 **0줄**이 된다.

- npm 발행은 위 "full repo 빌드" job이 커버한다.
- 그러나 "미러 = 배포 채널"([Unit F](./F-public-release.md)) · "CLI는 게이트의 human control plane"(CLAUDE.md)과 정합하려면 **미러에 CLI를 둘지 결정 필요.**
- 두 갈래: (a) 미러는 npm 발행 CLI를 **참조만** 하고 소스는 비공개 / (b) CLI를 `public/`으로 **이동**해 미러에 포함.

## 검증 체크리스트

- private 히스토리 제거 확인(현재·과거 커밋 전부).
- files allowlist 확인.
- 백엔드 endpoint/도구명 잔존은 **metafile/모듈그래프 기준**(grep 보조 — [A 참조](./A-obfuscate-build.md)의 "grep unreliable").
- `--dry-run` filter-repo 사전 점검(mapping.md §검증).
- 공개 전 **수동 감사** 1회.

## blocking Open Questions

- **OQ7 (blocker)** — CLI 미러 포함 여부(위 충돌). 미러 allowlist 설계가 여기 의존.
- **OQ6 (affects)** — CLI tarball의 private inline(CDN 모델 밖에 둘지).
- **OQ5 (affects)** — public dist 평문 제거 타이밍(미러에 들어가는 dist 상태).

## 수용 기준

- 미러 리포에 `private/` 경로가 **현재·과거 커밋 어디에도 없음**.
- public만으로 빌드/타입체크 그린.
- CLI 미러 포함 방침(OQ7) 반영.

## 산출 파일(예상)

- `.github/workflows/mirror.yml` (filter-repo + push)
- allowlist/검증 스크립트
- (target public repo는 코드 외 — 준비 필요)
