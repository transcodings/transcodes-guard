# Phase 3 v2 / Unit I — 라이선스 전환 + private/ 해체

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M9
> 규모: **M** · 선행: [G](./G-policy-bundle.md) (정책 데이터가 코드에서 분리된 후) · 외부 의존: **D1 라이선스 결정(human, 사업)** · 상태: ⚠️ **Gated (결정)**
> 근거: [`boundary-redesign.md`](../../research/boundary-redesign.md) §3 (FSL 권고 + "엔진 공개·데이터 비공개"의 법적 성립)

## 규모 산정

- **M (Medium)** — 1~2 PR + 사업 결정 1건 + 워크스페이스 재배치. 코드 로직 변경은 거의 없음(이동·메타데이터·규칙 정리).
- 리스크: 라이선스는 **한 번 공개하면 해당 버전에 비가역**. D1은 대표 승인 필수.

## 요구사항

보이는 코드의 상업적 보호를 기술(난독화)이 아니라 **라이선스**로 전환하고, "비밀"이 사라진 `private/` 구분을 해체한다.

## D1 — 라이선스 선택 (human 결정, 본 단위의 게이트)

권고: **FSL-1.1-Apache-2.0** — 2년 후 해당 버전이 Apache-2.0으로 자동 전환(DOSP). 경쟁 SaaS·대체 서비스 제공은 "Protected Use"로 금지. dev-tool 선례(Sentry)와 가장 낮은 커뮤니티 반발 실적.

| 선택지 | 전환 | 비고 |
|---|---|---|
| **FSL-1.1-Apache-2.0 (권고)** | 2년 → Apache-2.0 | 시한부 OSS 약속이 신뢰 서사와 정합 |
| BUSL-1.1 | ≤4년 → GPL-호환 | Additional Use Grant 설계 자유도 ↑, HashiCorp 평판 비용 |
| ELv2 | 없음(영구) | 라이선스 키 우회 금지 조항 명시적, OSS 전환 부재 |

결정 시 함께 확정: ① 기존 기여자 동의 절차(현재 사실상 사내 단일 — 간단) ② npm 발행 패키지의 `license` 필드 일괄 갱신 ③ 외부 기여 수령 정책(CLA 여부).

## private/ 해체 (G 완료 후)

G로 정책 데이터가 분리되면 `private/packages/*`에 남는 것은 전부 "공개 가능한 클라이언트 코드"다:

- `stepup-core` · `gate-backend` · `transcodes-mcp-tools` · `danger-rules`(잔여 레지스트리 코드) → `public/packages/`로 이동(이름·scope 정리 포함: `@transcodes-guard-private/*` → `@transcodes-guard/*`).
- `private/cli/` → `public/cli/` 또는 `cli/` — v1 OQ7(CLI 미러 포함) 소멸의 구체화.
- **유지하는 것**: `GateBackend` DI seam(backend.ts 4개) — 비밀 경계가 아니라 코드 경계(테스트 주입·구현 교체)로 재정의. seam 구조는 바꾸지 않는다(2단계 불변식).

## 경계 규칙 정리 (E 산출물의 운명)

E(#48)가 승격한 biome `noRestrictedImports`는 private scope 소멸과 함께 대상을 잃는다:

- 규칙을 제거하지 말고 **재조준**: "`gate-backend` 구현 패키지는 seam(backend.ts) 외에서 import 금지"라는 *아키텍처* 규칙으로 존속(scope 이름만 갱신). DI 우회 import를 계속 막는다.
- publish-surface CI 게이트(`"private": true` 강제)는 npm 발행 통제 목적이 남는 패키지에만 잔존(발행 대상은 `publishConfig`로 명시 — split.md §3.2 files allowlist 권고 이행).

## 부수 정리

- README/docs의 "비공개" 서술 갱신 + LICENSE 파일 배치(루트 + 패키지별 `license` 필드).
- `cdn-dist/`·`build:cdn`(A 산출물): 스크립트는 보존(shelved), README에서 비참조화.
- biome 메시지·CLAUDE.md의 경계 서술을 I 이후 상태로 갱신.

## blocking / 관련 결정

- **D1 (blocker)** — 위. 결정 전 착수 불가(이동 자체가 라이선스 헤더와 엮임).
- G 선행 — 정책 데이터가 코드에 남은 채 이동하면 "조직 정책 비공개"(보호 자산 1)가 깨진다.

## 수용 기준

- 루트 LICENSE + 전 패키지 `license` 필드 일관(D1 결정 반영).
- `private/` 디렉토리 부재, 빌드·type-check·23종 smoke green.
- seam 외 `gate-backend` import 시 biome error(재조준된 규칙) 유지.
- npm 발행 표면: 발행 패키지의 tarball에 LICENSE 포함 + `files` allowlist 점검(`npm publish --dry-run` CI step — split.md §3.2).

## 산출 파일(예상)

- `LICENSE` (루트) + 패키지별 `package.json` 갱신
- 워크스페이스 이동 diff (`private/packages/*` → `public/packages/*`, scope 리네임)
- `biome.json` 경계 규칙 재조준 · CI publish-surface 게이트 조정
- CLAUDE.md / README 갱신
